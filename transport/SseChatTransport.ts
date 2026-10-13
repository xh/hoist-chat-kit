import {XH} from '@xh/hoist/core';
import type {FetchOptions} from '@xh/hoist/svc';
import {logDebug} from '@xh/hoist/utils/js';
import {
    HttpChatTransport,
    type HttpChatRecord,
    type HttpChatTransportConfig
} from './HttpChatTransport';
import {SseParser} from './impl/SseParser';

/** Configuration for a {@link SseChatTransport}. */
export interface SseChatTransportConfig extends HttpChatTransportConfig {}

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
 *    Comments (keep-alives), `[DONE]` sentinels and data that is not JSON are skipped.
 *  - It ends the response when the step ends, after the codec's closing record -
 *    `RUN_FINISHED` in AG-UI, `message_stop` from Anthropic. A response that ends without one
 *    fails the turn as incomplete. It should stop work when the client disconnects. The transport
 *    closes the connection when the user stops the turn.
 */
export class SseChatTransport extends HttpChatTransport {
    protected override async *fetchRecords(opts: FetchOptions): AsyncGenerator<HttpChatRecord> {
        const response: Response = await XH.fetch({
            ...opts,
            headers: {Accept: 'text/event-stream', ...opts.headers}
        });
        if (!response.body) return;

        const reader = response.body.getReader(),
            parser = new SseParser();
        while (true) {
            const {done, value} = await reader.read();
            if (done) return;
            for (const {event, data} of parser.feed(value)) {
                if (data === '[DONE]') continue;
                const record = parseJson(data);
                if (record) {
                    yield {data: record, eventName: event};
                } else {
                    logDebug(['Skipped SSE data that is not JSON', data], this);
                }
            }
        }
    }
}

//------------------
// Implementation
//------------------
function parseJson(data: string): any {
    try {
        return JSON.parse(data);
    } catch (ignored) {
        return null;
    }
}
