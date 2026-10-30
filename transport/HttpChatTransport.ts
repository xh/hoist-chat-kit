import type {Awaitable, PlainObject, TrackOptions} from '@xh/hoist/core';
import {XH} from '@xh/hoist/core';
import type {PromiseTimeoutSpec} from '@xh/hoist/promise';
import type {FetchOptions} from '@xh/hoist/svc';
import {throwIf} from '@xh/hoist/utils/js';
import {isFunction} from 'lodash';
import {raceAbort} from '../impl/abort';
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
     * Options for the browser's `fetch`, as with `FetchOptions.fetchOpts`. Hoist sends cookies
     * with every request (`credentials: 'include'`), which a cross-origin backend must allow with
     * `Access-Control-Allow-Credentials: true`. For a backend that authenticates by header alone,
     * pass `{credentials: 'omit'}`. The transport sets its own `signal`, so a signal here is
     * ignored. Default none.
     */
    fetchOpts?: PlainObject;

    /**
     * False to send no correlation id header with each request, as with
     * `FetchOptions.correlationId`. Use it for a cross-origin backend whose CORS rules do not
     * allow the header, in an app that sets `FetchService.defaults.autoGenCorrelationIds`. True
     * to send one even when the app does not. Default the `FetchService` default.
     */
    correlationId?: boolean;

    /**
     * Endpoint to post to when the user stops a run, for a backend that does not stop when the
     * client disconnects - or a function of the run to build it. The body is the run's ids,
     * `{threadId, runId, turnId}`, and the request carries the `headers` and `params` of the
     * stopped step, and the `fetchOpts` and `correlationId`. Default none: a stop only closes the connection.
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

    /** True, as the transport calls `onRequestSent` before it sends each request. */
    readonly reportsRequestSent = true;

    /** True if the codec sends the `resume` list that answers interrupts. */
    get supportsInterrupts(): boolean {
        return this.codec.supportsInterrupts === true;
    }

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

    /** Options for the browser's `fetch`, or null. */
    readonly fetchOpts: PlainObject;

    /** True or false to send a correlation id header or not, or undefined for the default. */
    readonly correlationId: boolean;

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
        fetchOpts = null,
        correlationId,
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
        this.fetchOpts = fetchOpts;
        // Left undefined when not configured, so the FetchService default applies.
        this.correlationId = correlationId;
        this.cancelUrl = cancelUrl;
    }

    async *run(request: ChatRunRequest): AsyncGenerator<ChatEvent> {
        const {codec, track, timeout, idleTimeout} = this,
            {signal} = request;
        signal.throwIfAborted();

        // Raced against the signal, so that a stop during a slow token fetch settles at once.
        const [body, url, headers, params] = await raceAbort(
            Promise.all([
                codec.encodeRequest(request),
                resolveValue(this.url, request),
                resolveValue(this.headers, request),
                resolveValue(this.params, request)
            ]),
            signal
        );
        signal.throwIfAborted();
        // Serialized before the request counts as sent, as a body that cannot be never goes.
        const json = JSON.stringify(body);

        // Hoist releases a request's `autoAbortKey` once its response starts, so a key could not
        // cancel the stream. A signal of our own covers the whole response, and the `finally`
        // below fires it when the caller stops reading early, so the connection closes.
        // FetchService joins it with its own signal, so its `timeout` still aborts the fetch.
        const aborter = new AbortController(),
            stall = new AbortController(),
            decode = codec.createDecoder(request);

        // The idle timer runs only while waiting on the server, not while the caller handles
        // what it read.
        let idleTimer: ReturnType<typeof setTimeout> = null;
        const startIdleTimer = () => {
            if (idleTimeout != null) idleTimer = setTimeout(() => stall.abort(), idleTimeout);
        };

        // True once the decoder has yielded RUN_FINISHED with no RUN_STARTED after it. A stall
        // then means a server that holds a finished response open, not a failed reply.
        let isRunFinished = false;
        try {
            startIdleTimer();
            request.onRequestSent?.();
            const records = this.fetchRecords({
                url,
                method: 'POST',
                body: json,
                headers: {'Content-Type': 'application/json', ...headers},
                params,
                track,
                timeout,
                correlationId: this.correlationId,
                fetchOpts: {...this.fetchOpts, signal: AbortSignal.any([signal, aborter.signal])}
            });
            for await (const {data, eventName} of abortable(
                records,
                AbortSignal.any([signal, stall.signal])
            )) {
                clearTimeout(idleTimer);
                request.onActivity?.();
                if (data != null && data.type !== HEARTBEAT_TYPE) {
                    for (const event of decode(data, eventName)) {
                        if (event.type === 'RUN_STARTED') isRunFinished = false;
                        if (event.type === 'RUN_FINISHED') isRunFinished = true;
                        yield event;
                    }
                }
                startIdleTimer();
            }
            if (decode.flush) yield* decode.flush();
        } catch (e) {
            if (!stall.signal.aborted || signal.aborted) throw e;
            if (isRunFinished) return;
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
        await XH.postJson({
            url,
            body: {threadId, runId, turnId},
            headers,
            params,
            correlationId: this.correlationId,
            fetchOpts: this.fetchOpts
        });
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
