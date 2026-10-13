import {type PlainObject, type TrackOptions, XH} from '@xh/hoist/core';
import type {PromiseTimeoutSpec} from '@xh/hoist/promise';
import type {ChatCodec} from './ChatCodec';
import type {ChatEvent} from './ChatEvent';
import type {ChatRunRequest, ChatTransport} from './ChatTransport';
import {AgUiCodec} from './codec/AgUiCodec';
import {abortable} from './impl/streams';

/** Configuration for a {@link HoistChatTransport}. */
export interface HoistChatTransportConfig {
    /** Endpoint to post to. Relative urls resolve against `XH.baseUrl`, as with `XH.fetchJson`. */
    url: string;

    /** Encodes requests and decodes the streamed records. Default an {@link AgUiCodec}. */
    codec?: ChatCodec;

    /** Query string parameters for each request. */
    params?: PlainObject;

    /** Track each model call with Hoist activity tracking, as with `FetchOptions.track`. */
    track?: string | TrackOptions;

    /**
     * Time to wait for the server to start its response. Default the `FetchService` default. No
     * timeout applies once the response is streaming.
     */
    timeout?: PromiseTimeoutSpec;
}

/**
 * Transport for a chat endpoint on the app's own hoist-core server - the default choice for Hoist
 * apps. It posts each model call with `XH.fetchNdjson`, so requests carry Hoist's authentication,
 * correlation ids and tracing, and a failed request throws Hoist's usual `FetchException`, with
 * the server's error details.
 *
 * Server contract:
 *
 *  - The endpoint receives a POST with a JSON body - the request encoded by the `codec`. With the
 *    default {@link AgUiCodec}, that is an AG-UI `RunAgentInput`.
 *  - It responds with `application/x-ndjson`: one JSON record per line, in the codec's format -
 *    AG-UI events by default, or Anthropic stream events with an {@link AnthropicCodec}. It must
 *    flush after each line, so that tokens reach the user as they are generated.
 *  - It ends the response when the model call ends. A failure before streaming starts should
 *    render as a Hoist error (a non-2xx status with an exception body). A failure mid-stream
 *    should be sent as an error record - `RUN_ERROR` in AG-UI.
 *  - It should stop work when the client disconnects. The transport closes the connection when
 *    the user stops the turn.
 */
export class HoistChatTransport implements ChatTransport {
    readonly url: string;
    readonly codec: ChatCodec;
    readonly params: PlainObject;
    readonly track: string | TrackOptions;
    readonly timeout: PromiseTimeoutSpec;

    constructor({
        url,
        codec = new AgUiCodec(),
        params = null,
        track = null,
        timeout
    }: HoistChatTransportConfig) {
        this.url = url;
        this.codec = codec;
        this.params = params;
        this.track = track;
        // Left undefined when not configured, as null would disable the FetchService timeout.
        this.timeout = timeout;
    }

    async *run(request: ChatRunRequest): AsyncGenerator<ChatEvent> {
        const {url, codec, params, track, timeout} = this,
            {signal} = request;
        signal.throwIfAborted();

        // Hoist releases a request's `autoAbortKey` once its response starts, so a key could not
        // cancel the stream. A signal of our own covers the whole response, and also closes the
        // connection when the caller stops reading early.
        const aborter = new AbortController(),
            decode = codec.createDecoder(request),
            {lines} = XH.fetchNdjson({
                url,
                method: 'POST',
                body: JSON.stringify(codec.encodeRequest(request)),
                headers: {'Content-Type': 'application/json'},
                params,
                track,
                timeout,
                fetchOpts: {signal: AbortSignal.any([signal, aborter.signal])}
            });

        try {
            for await (const record of abortable(lines, signal)) {
                yield* decode(record);
            }
        } finally {
            aborter.abort();
        }
    }
}
