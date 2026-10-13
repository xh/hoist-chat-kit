import {type PlainObject, XH} from '@xh/hoist/core';
import type {PromiseTimeoutSpec} from '@xh/hoist/promise';
import type {ChatCodec} from './ChatCodec';
import type {ChatEvent} from './ChatEvent';
import type {ChatRunRequest, ChatTransport} from './ChatTransport';
import {AgUiCodec} from './codec/AgUiCodec';
import {type SseEvent, SseParser} from './impl/SseParser';
import {abortable} from './impl/streams';

/** Configuration for a {@link SseChatTransport}. */
export interface SseChatTransportConfig {
    /** Endpoint to post to. Relative urls resolve against `XH.baseUrl`. */
    url: string;

    /** Encodes requests and decodes the data of each event. Default an {@link AgUiCodec}. */
    codec?: ChatCodec;

    /** Extra headers for each request, e.g. to authenticate with an agent server. */
    headers?: PlainObject;

    /** Query string parameters for each request. */
    params?: PlainObject;

    /**
     * Time to wait for the server to start its response. Default the `FetchService` default. No
     * timeout applies once the response is streaming.
     */
    timeout?: PromiseTimeoutSpec;
}

/**
 * Transport for a backend that streams Server-Sent Events - an AG-UI agent server, or a proxy
 * that relays a provider's SSE stream as is. Requests go through `XH.fetch`, so they carry
 * Hoist's default headers and a failed request throws Hoist's usual `FetchException`.
 *
 * Server contract:
 *
 *  - The endpoint receives a POST with a JSON body - the request encoded by the `codec` - and an
 *    `Accept: text/event-stream` header. With the default {@link AgUiCodec}, the body is an AG-UI
 *    `RunAgentInput`, as AG-UI's HTTP agents expect.
 *  - It responds with `text/event-stream`. The `data` of each event is one JSON record in the
 *    codec's format - AG-UI events by default, or Anthropic stream events with an
 *    {@link AnthropicCodec}. The `event` name is passed to the codec along with the data.
 *    Comments (keep-alives) and `[DONE]` sentinels are skipped.
 *  - It ends the response when the model call ends, and should stop work when the client
 *    disconnects. The transport closes the connection when the user stops the turn.
 */
export class SseChatTransport implements ChatTransport {
    readonly url: string;
    readonly codec: ChatCodec;
    readonly headers: PlainObject;
    readonly params: PlainObject;
    readonly timeout: PromiseTimeoutSpec;

    constructor({
        url,
        codec = new AgUiCodec(),
        headers = null,
        params = null,
        timeout
    }: SseChatTransportConfig) {
        this.url = url;
        this.codec = codec;
        this.headers = headers;
        this.params = params;
        // Left undefined when not configured, as null would disable the FetchService timeout.
        this.timeout = timeout;
    }

    async *run(request: ChatRunRequest): AsyncGenerator<ChatEvent> {
        const {url, codec, headers, params, timeout} = this,
            {signal} = request;
        signal.throwIfAborted();

        // A signal of our own also closes the connection when the caller stops reading early.
        const aborter = new AbortController(),
            decode = codec.createDecoder(request);
        try {
            const response: Response = await XH.fetch({
                url,
                method: 'POST',
                body: JSON.stringify(codec.encodeRequest(request)),
                headers: {
                    'Content-Type': 'application/json',
                    Accept: 'text/event-stream',
                    ...headers
                },
                params,
                timeout,
                fetchOpts: {signal: AbortSignal.any([signal, aborter.signal])}
            });

            for await (const {event, data} of abortable(readEvents(response), signal)) {
                if (data === '[DONE]') continue;
                yield* decode(JSON.parse(data), event);
            }
        } finally {
            aborter.abort();
        }
    }
}

//------------------
// Implementation
//------------------
async function* readEvents(response: Response): AsyncGenerator<SseEvent> {
    const reader = response.body.getReader(),
        parser = new SseParser();
    while (true) {
        const {done, value} = await reader.read();
        if (done) return;
        yield* parser.feed(value);
    }
}
