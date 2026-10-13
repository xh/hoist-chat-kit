import type {PlainObject, TrackOptions} from '@xh/hoist/core';
import type {PromiseTimeoutSpec} from '@xh/hoist/promise';
import type {FetchOptions} from '@xh/hoist/svc';
import {throwIf} from '@xh/hoist/utils/js';
import type {ChatCodec} from './ChatCodec';
import type {ChatEvent} from './ChatEvent';
import type {ChatRunRequest, ChatTransport} from './ChatTransport';
import {AgUiCodec} from './codec/AgUiCodec';
import {abortable} from './impl/streams';

/** Configuration shared by the kit's HTTP transports. */
export interface HttpChatTransportConfig {
    /** Endpoint to post to. Relative urls resolve against `XH.baseUrl`, as with `XH.fetchJson`. */
    url: string;

    /** Encodes requests and decodes the streamed records. Default an {@link AgUiCodec}. */
    codec?: ChatCodec;

    /** Extra headers for each request, e.g. to authenticate with an agent server. */
    headers?: PlainObject;

    /** Query string parameters for each request. */
    params?: PlainObject;

    /** Track each step with Hoist activity tracking, as with `FetchOptions.track`. */
    track?: string | TrackOptions;

    /**
     * Time to wait for the server to start its response. Default the `FetchService` default. No
     * timeout applies once the response is streaming.
     */
    timeout?: PromiseTimeoutSpec;
}

/** One record read from a streamed response, for the codec to decode. */
export interface HttpChatRecord {
    /** The parsed record - an NDJSON line, or the `data` of an SSE event. */
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
 * stops reading early - closes the connection, so the server can stop generating. A subclass
 * supplies the framing, by implementing {@link fetchRecords}.
 */
export abstract class HttpChatTransport implements ChatTransport {
    /** Endpoint to post to. */
    readonly url: string;

    /** Encodes requests and decodes the streamed records. */
    readonly codec: ChatCodec;

    /** Extra headers for each request, or null. */
    readonly headers: PlainObject;

    /** Query string parameters for each request, or null. */
    readonly params: PlainObject;

    /** Activity tracking for each step, or null. */
    readonly track: string | TrackOptions;

    /** Time to wait for the server to start its response. */
    readonly timeout: PromiseTimeoutSpec;

    constructor({
        url,
        codec = new AgUiCodec(),
        headers = null,
        params = null,
        track = null,
        timeout
    }: HttpChatTransportConfig) {
        throwIf(!url, 'A chat transport url is required.');
        this.url = url;
        this.codec = codec;
        this.headers = headers;
        this.params = params;
        this.track = track;
        // Left undefined when not configured, as null would disable the FetchService timeout.
        this.timeout = timeout;
    }

    async *run(request: ChatRunRequest): AsyncGenerator<ChatEvent> {
        const {url, codec, headers, params, track, timeout} = this,
            {signal} = request;
        signal.throwIfAborted();

        const body = await codec.encodeRequest(request);
        signal.throwIfAborted();

        // Hoist releases a request's `autoAbortKey` once its response starts, so a key could not
        // cancel the stream. A signal of our own covers the whole response, and also closes the
        // connection when the caller stops reading early.
        const aborter = new AbortController(),
            decode = codec.createDecoder(request);
        try {
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
            for await (const {data, eventName} of abortable(records, signal)) {
                yield* decode(data, eventName);
            }
        } finally {
            aborter.abort();
        }
    }

    /**
     * Post the request and read the records of its streamed response, in arrival order.
     *
     * @param opts - the request, ready for `FetchService`. Implementations may add headers, but
     *      must pass `fetchOpts` through, as it carries the signal that cancels the stream.
     */
    protected abstract fetchRecords(opts: FetchOptions): AsyncGenerator<HttpChatRecord>;
}
