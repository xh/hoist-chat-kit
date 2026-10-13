import type {PlainObject} from '@xh/hoist/core';
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
    /** Build the request body for one model call. */
    encodeRequest(request: ChatRunRequest): PlainObject;

    /**
     * Create a decoder for one model call. Decoders may hold state across the records of a call,
     * such as block indexes or accumulated tool arguments.
     */
    createDecoder(): ChatDecoder;
}

/**
 * Decodes one record from the backend - a parsed NDJSON line, or the parsed `data` of an SSE
 * frame - into zero or more events.
 *
 * @param raw - the parsed record.
 * @param eventName - the SSE `event` field, if the transport has one.
 */
export type ChatDecoder = (raw: PlainObject, eventName?: string) => ChatEvent[];
