import type {ResumeEntry} from '@ag-ui/core';
import type {PlainObject} from '@xh/hoist/core';
import {findLast, isUndefined, omitBy} from 'lodash';
import type {ChatHistoryMode, ChatMessage, ChatToolSpec} from '../core';
import {genChatId} from '../impl/ids';
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
     * True if the transport can send a `resume` list, to answer the interrupts a server agent
     * raises - see `ChatModel.openInterrupts`. A run that ends with interrupts on a transport that
     * cannot answer them fails, with code `unsupported-interrupt`. Default false.
     */
    readonly supportsInterrupts?: boolean;

    /**
     * Ask the backend to cancel a run, for a backend that does not stop when the client
     * disconnects. The chat calls it, without waiting, when the user stops a turn while a step is
     * in flight - never for a detach, a clear or a load. A failure is logged, never shown.
     */
    cancelAsync?(run: ChatRunRef): Promise<void>;

    /**
     * Reattach to a run still in progress on the server, for example after a page reload, and
     * yield its events from the start - AG-UI's `connect`. Reserved - the kit does not call it yet.
     */
    reconnect?(run: ChatRunRef, signal: AbortSignal): AsyncIterable<ChatEvent>;
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
     * Who owns the history. In `server` mode the backend holds it, and a codec also sends the
     * turn's ids. A codec for a backend that takes only what it has not seen sends `newMessages`
     * in place of `messages`. `AgUiCodec` sends `messages` in both modes, as AG-UI requires.
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

    /**
     * Version of the chat's generative UI catalog - see `ChatUiCatalog.version` - or null if it
     * has none. A server that registers the catalog's tools from an export compares it with its
     * own, to detect drift.
     */
    catalogVersion: string;

    /**
     * Responses to the interrupts the thread's last interrupted run raised, as AG-UI resume
     * entries - or null. It covers every interrupt of that run, answered or declined, as AG-UI
     * requires - see `ChatModel.openInterrupts`. `AgUiCodec` sends it as `RunAgentInput.resume`.
     * Optional.
     */
    resume?: ResumeEntry[];

    /** Tools the model may call - only those to be sent to the model. */
    tools: ChatToolSpec[];

    /**
     * Live context for this step, from the chat's context providers, in their configured order -
     * see `ChatModelConfig.contextProviders`. Empty if the chat has none.
     */
    context: ChatRunContext[];

    /**
     * Aborts the step. Its `reason` is a `ChatAbortError`, which says why the turn stopped.
     */
    signal: AbortSignal;

    /**
     * Called by the transport each time it reads data from the server, whether or not the data
     * decodes to an event - including heartbeats, such as an SSE comment. The chat counts the time
     * since the last call to show a quiet reply as stalled - see `ChatModel.lastActivityAt`. The
     * kit's HTTP transports call it for each record. A transport that does not call it still
     * reports activity through the events it yields. Optional.
     */
    onActivity?: () => void;
}

/**
 * Input to {@link createChatRunRequest}: the messages to send, plus any request fields to set
 * rather than default.
 */
export interface ChatRunRequestSpec extends Partial<ChatRunRequest> {
    /**
     * The conversation so far, oldest first. `ChatModel` also appends the empty assistant message
     * it is about to build. The kit's codecs skip an empty message, so that is optional here.
     */
    messages: ChatMessage[];
}

/**
 * Build a {@link ChatRunRequest} for the first step of a new turn, for an app that runs a
 * transport without `ChatModel`. Fields left out of the spec match what `ChatModel` sends for
 * that step in client mode:
 *
 *  - `threadId` and `runId` - new ids.
 *  - `historyMode` - 'client'. `trigger` - 'submit'. `stepIndex` - 0.
 *  - `turnId` - id of the last user message. `newMessages` - that message alone.
 *  - `runOptions` - the `metadata.runOptions` of that message, or null.
 *  - `replacedMessageId`, `catalogVersion` and `resume` - null. `tools` and `context` - empty.
 *  - `signal` - the signal of a new `AbortController`, which nothing aborts. Pass your own
 *    signal to be able to stop the step.
 *
 * Fold the events of the step into a message with a `ChatStreamReducer`.
 */
export function createChatRunRequest(spec: ChatRunRequestSpec): ChatRunRequest {
    const {messages} = spec,
        userMessage = findLast(messages, it => it.isUser) ?? null;
    return {
        threadId: genChatId(),
        runId: genChatId(),
        historyMode: 'client',
        trigger: 'submit',
        turnId: userMessage?.id ?? null,
        stepIndex: 0,
        messages,
        newMessages: userMessage ? [userMessage] : [],
        replacedMessageId: null,
        runOptions: userMessage?.metadata.runOptions ?? null,
        catalogVersion: null,
        resume: null,
        tools: [],
        context: [],
        signal: new AbortController().signal,
        ...omitBy(spec, isUndefined)
    };
}

/**
 * One piece of live context for a step, from a `ChatContextProvider`. Codecs send each piece to
 * the model in their own format: an AG-UI `context` entry, or a section of the system prompt.
 */
export interface ChatRunContext {
    /** Name of the provider, such as 'grid'. */
    name: string;

    /** What the context is, for the model - or null. */
    description: string;

    /** The context - text, or an object that codecs send as JSON. */
    value: string | PlainObject;
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
