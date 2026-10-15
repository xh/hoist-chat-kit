import type {Awaitable, PlainObject, TrackOptions} from '@xh/hoist/core';
import {XH} from '@xh/hoist/core';
import type {PromiseTimeoutSpec} from '@xh/hoist/promise';
import type {FetchOptions} from '@xh/hoist/svc';
import {throwIf} from '@xh/hoist/utils/js';
import {isFunction} from 'lodash';
import type {ChatCodec} from './ChatCodec';
import type {ChatEvent} from './ChatEvent';
import type {ChatRunRef, ChatRunRequest, ChatTransport} from './ChatTransport';
import {AgUiCodec} from './codec/AgUiCodec';
import {abortable} from './impl/streams';

/**
 * A transport setting given as a value, or as a function of the request that returns one. The
 * function may be async, for example to fetch a short-lived token before each step.
 */
export type HttpChatTransportValue<T> = T | ((request: ChatRunRequest) => Awaitable<T>);

/** Configuration shared by the kit's HTTP transports. */
export interface HttpChatTransportConfig {
    /**
     * Endpoint to post to - or a function to build it per request, e.g. to route a thread to its
     * own agent. Relative urls resolve against `XH.baseUrl`, as with `XH.fetchJson`.
     */
    url: HttpChatTransportValue<string>;

    /** Encodes requests and decodes the streamed records. Default an {@link AgUiCodec}. */
    codec?: ChatCodec;

    /**
     * Extra headers for each request, e.g. to authenticate with an agent server - or a function
     * to build them per request, e.g. to send a fresh token, or the thread and run ids for the
     * server to count turns.
     */
    headers?: HttpChatTransportValue<PlainObject>;

    /** Query string parameters for each request, or a function to build them per request. */
    params?: HttpChatTransportValue<PlainObject>;

    /** Track each step with Hoist activity tracking, as with `FetchOptions.track`. */
    track?: string | TrackOptions;

    /**
     * Time to wait for the server to start its response. Default the `FetchService` default. No
     * timeout applies once the response is streaming - see `idleTimeout`.
     */
    timeout?: PromiseTimeoutSpec;

    /**
     * Longest time, in milliseconds, to wait for data from the server - from the request to its
     * first record, then between records. Any record resets the timer, as does any other data,
     * such as an SSE comment. A server with long silent stretches, such as an agent running a
     * slow tool, sends heartbeats: an SSE comment, or an `{"type": "xh.heartbeat"}` record, which
     * the transport reads as data and never decodes. When the timer fires, the transport closes
     * the connection and fails the step with error code `stalled`. Set it longer than
     * `ChatKit.defaults.stallAfterMs`, after which the chat shows the reply as stalled while it
     * still waits. Default none.
     */
    idleTimeout?: number;

    /**
     * Endpoint to post to when the user stops a run, for a backend that does not stop when the
     * client disconnects - or a function of the run to build it. The body is the run's ids,
     * `{threadId, runId, turnId}`, and the request carries the `headers` and `params` of the
     * stopped step. Default none: a stop only closes the connection.
     */
    cancelUrl?: string | ((run: ChatRunRef) => Awaitable<string>);
}

/** One record read from a streamed response, for the codec to decode. */
export interface HttpChatRecord {
    /**
     * The parsed record - an NDJSON line, or the `data` of an SSE event. Null for data that
     * completes no record, such as an SSE comment: it shows only that the server is still there.
     */
    data: PlainObject;

    /** The SSE `event` name, for framings that have one. */
    eventName?: string;
}

/**
 * Base class for transports that post each step to an HTTP endpoint, as a JSON body built by a
 * {@link ChatCodec}, and read the events from a streamed response. Requests go through Hoist's
 * `FetchService`, so they carry Hoist's default headers and correlation ids, and a failed request
 * throws Hoist's usual `FetchException`, with the server's error details.
 *
 * The base class owns the request, the decoding and the cancellation: a stop - or a caller that
 * stops reading early - closes the connection, so the server can stop generating. For a backend
 * that keeps running after a disconnect, a `cancelUrl` also posts a cancel on a stop. A subclass
 * supplies the framing, by implementing {@link fetchRecords}.
 *
 * A failed request throws as is, so a `FetchException` keeps Hoist's `isRoutine` flag from the
 * server. The chat reports it with `XH.handleException`, which logs a routine exception quietly,
 * not as a client error. An error the backend reports within the stream - an AG-UI `RUN_ERROR`,
 * or an Anthropic `error` event - is part of the conversation instead: the chat shows it, with
 * Retry, and never reports it as an exception.
 */
export abstract class HttpChatTransport implements ChatTransport {
    /** Endpoint to post to, or a function to build it. */
    readonly url: HttpChatTransportValue<string>;

    /** Encodes requests and decodes the streamed records. */
    readonly codec: ChatCodec;

    /** Extra headers for each request, a function to build them, or null. */
    readonly headers: HttpChatTransportValue<PlainObject>;

    /** Query string parameters for each request, a function to build them, or null. */
    readonly params: HttpChatTransportValue<PlainObject>;

    /** Activity tracking for each step, or null. */
    readonly track: string | TrackOptions;

    /** Time to wait for the server to start its response. */
    readonly timeout: PromiseTimeoutSpec;

    /** Longest wait for data from the server, in milliseconds, or null for no limit. */
    readonly idleTimeout: number;

    /** Endpoint to post a cancel to, a function to build it, or null. */
    readonly cancelUrl: HttpChatTransportConfig['cancelUrl'];

    constructor({
        url,
        codec = new AgUiCodec(),
        headers = null,
        params = null,
        track = null,
        timeout,
        idleTimeout = null,
        cancelUrl = null
    }: HttpChatTransportConfig) {
        throwIf(!url, 'A chat transport url is required.');
        this.url = url;
        this.codec = codec;
        this.headers = headers;
        this.params = params;
        this.track = track;
        // Left undefined when not configured, as null would disable the FetchService timeout.
        this.timeout = timeout;
        this.idleTimeout = idleTimeout;
        this.cancelUrl = cancelUrl;
    }

    async *run(request: ChatRunRequest): AsyncGenerator<ChatEvent> {
        const {codec, track, timeout, idleTimeout} = this,
            {signal} = request;
        signal.throwIfAborted();

        const [body, url, headers, params] = await Promise.all([
            codec.encodeRequest(request),
            resolveValue(this.url, request),
            resolveValue(this.headers, request),
            resolveValue(this.params, request)
        ]);
        signal.throwIfAborted();

        // Hoist releases a request's `autoAbortKey` once its response starts, so a key could not
        // cancel the stream. A signal of our own covers the whole response, and also closes the
        // connection when the caller stops reading early. FetchService spreads `fetchOpts` last,
        // so this signal replaces its own: its `timeout` then rejects the request but cannot
        // abort the fetch. The `finally` below closes the connection in that case too.
        const aborter = new AbortController(),
            stall = new AbortController(),
            decode = codec.createDecoder(request);

        // The idle timer runs only while waiting on the server, not while the caller handles
        // what it read.
        let idleTimer: ReturnType<typeof setTimeout> = null;
        const startIdleTimer = () => {
            if (idleTimeout != null) idleTimer = setTimeout(() => stall.abort(), idleTimeout);
        };

        try {
            startIdleTimer();
            const records = this.fetchRecords({
                url,
                method: 'POST',
                body: JSON.stringify(body),
                headers: {'Content-Type': 'application/json', ...headers},
                params,
                track,
                timeout,
                fetchOpts: {signal: AbortSignal.any([signal, aborter.signal])}
            });
            for await (const {data, eventName} of abortable(
                records,
                AbortSignal.any([signal, stall.signal])
            )) {
                clearTimeout(idleTimer);
                request.onActivity?.();
                if (data != null && data.type !== HEARTBEAT_TYPE) yield* decode(data, eventName);
                startIdleTimer();
            }
            if (decode.flush) yield* decode.flush();
        } catch (e) {
            if (!stall.signal.aborted || signal.aborted) throw e;
            yield {
                type: 'RUN_ERROR',
                message: 'The server stopped responding.',
                code: 'stalled'
            };
        } finally {
            clearTimeout(idleTimer);
            aborter.abort();
        }
    }

    /** Post the run's ids to the `cancelUrl`, if one is configured. */
    async cancelAsync(run: ChatRunRef): Promise<void> {
        const {cancelUrl} = this;
        if (!cancelUrl) return;

        const {threadId, runId, turnId, request} = run,
            [url, headers, params] = await Promise.all([
                isFunction(cancelUrl) ? cancelUrl(run) : cancelUrl,
                request ? resolveValue(this.headers, request) : null,
                request ? resolveValue(this.params, request) : null
            ]);
        await XH.postJson({url, body: {threadId, runId, turnId}, headers, params});
    }

    /**
     * Post the request and read the records of its streamed response, in arrival order.
     *
     * @param opts - the request, ready for `FetchService`. Implementations may add headers, but
     *      must pass `fetchOpts` through, as it carries the signal that cancels the stream.
     */
    protected abstract fetchRecords(opts: FetchOptions): AsyncGenerator<HttpChatRecord>;
}

//------------------
// Implementation
//------------------
/** Type of an NDJSON record that a server sends only to show it is still there. */
const HEARTBEAT_TYPE = 'xh.heartbeat';

function resolveValue<T>(value: HttpChatTransportValue<T>, request: ChatRunRequest): Awaitable<T> {
    return isFunction(value) ? value(request) : value;
}
