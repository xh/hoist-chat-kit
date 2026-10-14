import type {Awaitable, PlainObject} from '@xh/hoist/core';
import type {ChatEvent} from './ChatEvent';
import type {ChatRunRequest} from './ChatTransport';

/**
 * Translates between the kit and one backend wire format, for transports that carry JSON over
 * HTTP. A codec encodes each {@link ChatRunRequest} into a request body, and decodes the records
 * that come back into {@link ChatEvent}s.
 *
 * {@link AgUiCodec} speaks the AG-UI protocol. {@link AnthropicCodec} speaks the Anthropic
 * Messages API, so a server can relay Anthropic's stream without translating it.
 */
export interface ChatCodec {
    /**
     * Build the request body for one step. May be async, for codecs that gather live context
     * before each call.
     */
    encodeRequest(request: ChatRunRequest): Awaitable<PlainObject>;

    /**
     * Create a decoder for one step. Decoders may hold state across the records of a step, such
     * as block indexes or accumulated tool arguments.
     *
     * @param request - the step to decode, for decoders that stamp its ids on their events.
     */
    createDecoder(request: ChatRunRequest): ChatDecoder;
}

/**
 * Decodes one record from the backend - a parsed NDJSON line, or the parsed `data` of an SSE
 * frame - into zero or more events.
 *
 * A decoder may hold events back until a later record, or the end of the stream, completes them -
 * such as a finish that waits for the usage record after it. It returns them from `flush`, which a
 * transport calls once, after the last record of a stream that ended normally.
 */
export interface ChatDecoder {
    /**
     * @param raw - the parsed record.
     * @param eventName - the SSE `event` field, if the transport has one.
     */
    (raw: PlainObject, eventName?: string): ChatEvent[];

    /** Events held back for the end of the stream. Optional. */
    flush?: () => ChatEvent[];
}
