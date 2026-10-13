import type {ChatMessage, ChatToolSpec} from '../core';
import type {ChatEvent} from './ChatEvent';

/**
 * Connection between a {@link ChatModel} and the backend that runs the model or agent.
 *
 * A transport runs one step - one model call - per {@link run} and yields {@link ChatEvent}s as
 * they arrive. The chat model drives the conversation - including any tool round trips - and never
 * sees the wire format, so the same UI works against a Hoist server, an AG-UI agent, or a scripted
 * demo.
 *
 * The kit provides {@link HoistChatTransport} (NDJSON from a hoist-core endpoint),
 * {@link SseChatTransport} (Server-Sent Events, e.g. from an AG-UI server), and
 * {@link ScriptedChatTransport} (canned events for tests and demos). Implement this interface
 * directly for any other backend.
 */
export interface ChatTransport {
    /**
     * Run one step.
     *
     * Implementations must stop and settle promptly when `request.signal` aborts. They should
     * throw on a failure to connect, and either throw or yield a `RUN_ERROR` event for a failure
     * mid-stream. A complete run ends with a `RUN_FINISHED` event. A stream that ends without one
     * fails the turn as incomplete.
     *
     * @returns events in arrival order, ending when the run ends.
     */
    run(request: ChatRunRequest): AsyncIterable<ChatEvent>;
}

/** Everything a transport needs to run one step. */
export interface ChatRunRequest {
    /** Identifies the conversation. Changes only when the chat is cleared or loaded. */
    threadId: string;

    /** Identifies this step - unique per model call. Sent as the AG-UI run id. */
    runId: string;

    /**
     * The conversation so far, oldest first. The last message is the assistant message being
     * built, holding the parts of earlier steps in this turn - or no parts on the first step.
     */
    messages: ChatMessage[];

    /** Tools the model may call - only those to be sent to the model. */
    tools: ChatToolSpec[];

    /** Aborts the step. */
    signal: AbortSignal;
}
