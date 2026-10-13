import {XH} from '@xh/hoist/core';
import type {FetchOptions} from '@xh/hoist/svc';
import {
    HttpChatTransport,
    type HttpChatRecord,
    type HttpChatTransportConfig
} from './HttpChatTransport';

/** Configuration for a {@link HoistChatTransport}. */
export interface HoistChatTransportConfig extends HttpChatTransportConfig {}

/**
 * Transport for a chat endpoint on the app's own hoist-core server - the default choice for Hoist
 * apps. It posts each step with `XH.fetchNdjson`, so requests carry Hoist's authentication,
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
 *  - It ends the response when the step ends, after the codec's closing record -
 *    `RUN_FINISHED` in AG-UI, `message_stop` from Anthropic. A response that ends without one
 *    fails the turn as incomplete. A failure before streaming starts should render as a Hoist
 *    error (a non-2xx status with an exception body). A failure mid-stream should be sent as an
 *    error record - `RUN_ERROR` in AG-UI.
 *  - It should stop work when the client disconnects. The transport closes the connection when
 *    the user stops the turn.
 */
export class HoistChatTransport extends HttpChatTransport {
    protected override async *fetchRecords(opts: FetchOptions): AsyncGenerator<HttpChatRecord> {
        for await (const data of XH.fetchNdjson(opts).lines) {
            yield {data};
        }
    }
}
