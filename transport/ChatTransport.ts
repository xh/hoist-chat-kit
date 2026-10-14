import type {PlainObject} from '@xh/hoist/core';
import type {ChatHistoryMode, ChatMessage, ChatToolSpec} from '../core';
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

    /**
     * Ask the backend to cancel a run, for a backend that does not stop when the client
     * disconnects. The chat calls it, without waiting, when the user stops a turn while a step is
     * in flight - never for a detach, a clear or a load. A failure is logged, never shown.
     */
    cancelAsync?(run: ChatRunRef): Promise<void>;

    /**
     * Reattach to a run still in progress on the server, for example after a page reload, and
     * yield its events from the start. Reserved - the kit does not call it yet.
     */
    resume?(run: ChatRunRef, signal: AbortSignal): AsyncIterable<ChatEvent>;
}

/**
 * What started a step - see {@link ChatRunRequest.trigger}.
 *
 *  - `submit` - the user sent a new message.
 *  - `retry` - the user re-ran a turn, typically one that failed.
 *  - `regenerate` - the user asked for a new reply to a turn.
 *  - `edit` - the user changed a message and re-ran from it.
 *  - `continue` - a later step of a turn, after client tools ran or the user answered them.
 */
export type ChatRunTrigger = 'submit' | 'retry' | 'regenerate' | 'edit' | 'continue';

/** Everything a transport needs to run one step. */
export interface ChatRunRequest {
    /**
     * Identifies the conversation. Changes when the chat is cleared or loaded, and in server mode
     * once more, when the first run reports the server's id for a new thread.
     */
    threadId: string;

    /** Identifies this step - unique per model call. Sent as the AG-UI run id. */
    runId: string;

    /**
     * Who owns the history. In `client` mode a codec sends `messages`. In `server` mode the
     * backend holds the history, and a codec sends `newMessages` and the turn's ids instead.
     */
    historyMode: ChatHistoryMode;

    /** What started this step. */
    trigger: ChatRunTrigger;

    /**
     * Id of the user message this turn answers - the same for every step of the turn, and for a
     * retry, regenerate or edit of it. A backend that keys runs by it pairs it with `trigger`: it
     * replays a finished run for a `retry`, and starts a new one for a `regenerate` or `edit`.
     */
    turnId: string;

    /** Zero-based index of the step - the model call - within its turn. */
    stepIndex: number;

    /**
     * The conversation so far, oldest first, in both modes. The last message is the assistant
     * message being built, holding the parts of earlier steps in this turn - or no parts on the
     * first step.
     */
    messages: ChatMessage[];

    /**
     * What the server has not seen yet: the user message on the first step of a turn, or the
     * assistant message on a `continue` step, whose last step holds the results of the tool calls
     * the client answered.
     */
    newMessages: ChatMessage[];

    /** Id of the assistant message that a `retry` or `regenerate` replaces, or null. */
    replacedMessageId: string;

    /**
     * Options the user picked for this turn, such as a document scope or an agent profile - a
     * copy of `ChatModel.runOptions` taken when the user sent the message, or null.
     */
    runOptions: PlainObject;

    /** Tools the model may call - only those to be sent to the model. */
    tools: ChatToolSpec[];

    /**
     * Aborts the step. Its `reason` is a `ChatAbortError`, which says why the turn stopped.
     */
    signal: AbortSignal;
}

/** Identifies a run to cancel or resume - see {@link ChatTransport.cancelAsync}. */
export interface ChatRunRef {
    /** The conversation that holds the run. */
    threadId: string;

    /** The run - the id the backend reported on `RUN_STARTED`, or else the step's own id. */
    runId: string;

    /** Id of the user message the run answers. */
    turnId: string;

    /**
     * For a cancel, the request of the step in flight, for a transport that builds headers or a
     * url from it. Its signal has already aborted.
     */
    request?: ChatRunRequest;
}
