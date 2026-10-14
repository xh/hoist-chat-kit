import type {PlainObject} from '@xh/hoist/core';

/**
 * Streaming event from a chat backend - the kit's wire vocabulary.
 *
 * These are the events of the AG-UI protocol (version 1.0), with the same `type` strings and
 * field names, so any AG-UI agent server can drive the kit directly. The kit mirrors the types it
 * reads rather than depending on `@ag-ui/core`. Events the kit does not act on are still accepted
 * and ignored.
 *
 * One AG-UI run is one step of a kit turn: a single model call, from `RUN_STARTED` to
 * `RUN_FINISHED` or `RUN_ERROR`. AG-UI's own `STEP_STARTED` and `STEP_FINISHED` events mark
 * stages within a run, such as the nodes of an agent graph. They are not kit steps, and the kit
 * ignores them.
 *
 * Kit-specific content (sources, citations, data parts, files, provider data) travels as AG-UI
 * `CUSTOM` events named with the `xh.chat.` prefix - see {@link ChatCustomEventName}.
 *
 * @see https://docs.ag-ui.com/concepts/events
 */
export type ChatEvent =
    | RunStartedEvent
    | RunFinishedEvent
    | RunErrorEvent
    | StepStartedEvent
    | StepFinishedEvent
    | TextMessageStartEvent
    | TextMessageContentEvent
    | TextMessageEndEvent
    | TextMessageChunkEvent
    | ReasoningStartEvent
    | ReasoningMessageStartEvent
    | ReasoningMessageContentEvent
    | ReasoningMessageEndEvent
    | ReasoningMessageChunkEvent
    | ReasoningEndEvent
    | ReasoningEncryptedValueEvent
    | ToolCallStartEvent
    | ToolCallArgsEvent
    | ToolCallEndEvent
    | ToolCallChunkEvent
    | ToolCallResultEvent
    | ActivitySnapshotEvent
    | ChatCustomEvent
    | IgnoredEvent;

/** Discriminator values for {@link ChatEvent}. */
export type ChatEventType = ChatEvent['type'];

/** Fields common to all events. */
export interface ChatEventBase {
    /** Epoch millis when the event was created. */
    timestamp?: number;

    /** Provider-native event this one was translated from, for debugging. */
    rawEvent?: any;

    /** Open-ended extra information. */
    metadata?: PlainObject;
}

//------------------
// Lifecycle
//------------------
/** A run - one step of the turn - has started. */
export interface RunStartedEvent extends ChatEventBase {
    type: 'RUN_STARTED';
    threadId: string;
    runId: string;
}

/**
 * The run has finished normally. A stream that ends without this event, or `RUN_ERROR`, fails the
 * turn as incomplete.
 */
export interface RunFinishedEvent extends ChatEventBase {
    type: 'RUN_FINISHED';
    threadId: string;
    runId: string;

    /** The agent's result, if any. Not used by the kit. */
    result?: any;

    /** How the run ended. Maps to the finish reason when `metadata.finishReason` is not given. */
    outcome?: {type: 'success' | 'interrupt' | 'cancelled'; [key: string]: any};

    /** Token counts for the run, recorded as `metadata.usage` on the message. */
    usage?: ChatTokenUsage[];
}

/** The run has failed. Its `code` is recorded as `metadata.errorCode` on the message. */
export interface RunErrorEvent extends ChatEventBase {
    type: 'RUN_ERROR';

    /** Error text, shown to the user. */
    message: string;

    /** Machine-readable error code, such as `overloaded_error`. */
    code?: string;
}

/** A stage within the run has started - not a kit step. Ignored. */
export interface StepStartedEvent extends ChatEventBase {
    type: 'STEP_STARTED';
    stepName: string;
}

/** A stage within the run has finished - not a kit step. Ignored. */
export interface StepFinishedEvent extends ChatEventBase {
    type: 'STEP_FINISHED';
    stepName: string;
}

/** Token counts for one step, as reported on `RUN_FINISHED`. */
export interface ChatTokenUsage {
    /** Provider that served the call, e.g. 'anthropic'. */
    provider?: string;

    /** Model that served the call. */
    model?: string;

    /** Input tokens, including those read from or written to a prompt cache. */
    inputTokens?: number;

    /** Output tokens, including reasoning. */
    outputTokens?: number;

    /** Input plus output tokens. */
    totalTokens?: number;

    /** Output tokens spent on reasoning, where reported. */
    reasoningTokens?: number;

    /** Input tokens read from a prompt cache. */
    cachedInputTokens?: number;

    /** Input tokens written to a prompt cache. */
    cacheWriteInputTokens?: number;
}

//------------------
// Text
//------------------
/** A text message has started. Its part opens with its first content. */
export interface TextMessageStartEvent extends ChatEventBase {
    type: 'TEXT_MESSAGE_START';
    messageId: string;
    role?: 'developer' | 'system' | 'assistant' | 'user';
}

/** A fragment of a text message. */
export interface TextMessageContentEvent extends ChatEventBase {
    type: 'TEXT_MESSAGE_CONTENT';
    messageId: string;
    delta: string;
}

/** A text message has ended. */
export interface TextMessageEndEvent extends ChatEventBase {
    type: 'TEXT_MESSAGE_END';
    messageId: string;
}

/** Convenience form that opens, extends, or continues a text message. */
export interface TextMessageChunkEvent extends ChatEventBase {
    type: 'TEXT_MESSAGE_CHUNK';
    messageId?: string;
    role?: 'developer' | 'system' | 'assistant' | 'user';
    delta?: string;
}

//------------------
// Reasoning
//------------------
/** A span of reasoning has started. */
export interface ReasoningStartEvent extends ChatEventBase {
    type: 'REASONING_START';
    messageId: string;
}

/** A reasoning message, within a reasoning span, has started. */
export interface ReasoningMessageStartEvent extends ChatEventBase {
    type: 'REASONING_MESSAGE_START';
    messageId: string;
    role: 'reasoning';
}

/** A fragment of a reasoning message. */
export interface ReasoningMessageContentEvent extends ChatEventBase {
    type: 'REASONING_MESSAGE_CONTENT';
    messageId: string;
    delta: string;
}

/** A reasoning message has ended. */
export interface ReasoningMessageEndEvent extends ChatEventBase {
    type: 'REASONING_MESSAGE_END';
    messageId: string;
}

/** Convenience form that opens, extends, or continues a reasoning message. */
export interface ReasoningMessageChunkEvent extends ChatEventBase {
    type: 'REASONING_MESSAGE_CHUNK';
    messageId?: string;
    delta?: string;
}

/** A span of reasoning has ended. */
export interface ReasoningEndEvent extends ChatEventBase {
    type: 'REASONING_END';
    messageId: string;
}

/** A signature for a reasoning message or tool call, such as an Anthropic thinking signature. */
export interface ReasoningEncryptedValueEvent extends ChatEventBase {
    type: 'REASONING_ENCRYPTED_VALUE';
    subtype: 'tool-call' | 'message';
    entityId: string;
    encryptedValue: string;
}

//------------------
// Tool calls
//------------------
/** The model has started a tool call. */
export interface ToolCallStartEvent extends ChatEventBase {
    type: 'TOOL_CALL_START';
    toolCallId: string;
    toolCallName: string;
    parentMessageId?: string;
}

/** A fragment of a tool call's arguments. */
export interface ToolCallArgsEvent extends ChatEventBase {
    type: 'TOOL_CALL_ARGS';
    toolCallId: string;

    /** Fragment of the arguments' JSON text. */
    delta: string;
}

/** The model has finished writing a tool call's arguments. */
export interface ToolCallEndEvent extends ChatEventBase {
    type: 'TOOL_CALL_END';
    toolCallId: string;
}

/** Convenience form that opens or extends a tool call. */
export interface ToolCallChunkEvent extends ChatEventBase {
    type: 'TOOL_CALL_CHUNK';
    toolCallId?: string;
    toolCallName?: string;
    parentMessageId?: string;
    delta?: string;
}

/**
 * Result of a tool the backend ran.
 *
 * AG-UI's event has no error field, so the kit reads a failure from `metadata`. A result with
 * `metadata.error` (the error text) or `metadata.isError: true` (with the error text as `content`)
 * fails the call: its part moves to `output-error`, with the text as `errorText`. The
 * `xh.chat.toolError` custom event does the same for a backend that cannot set `metadata`.
 */
export interface ToolCallResultEvent extends ChatEventBase {
    type: 'TOOL_CALL_RESULT';
    messageId: string;
    toolCallId: string;

    /** The result - JSON-parsed into the part's `output` when it parses. */
    content: string | PlainObject[];
    role?: 'tool';

    /** Set `error` or `isError` to report that the tool failed - see above. */
    metadata?: PlainObject & {error?: string; isError?: boolean};
}

//------------------
// Generative UI
//------------------
/** A typed activity payload to render in the message, such as a progress card or a form. */
export interface ActivitySnapshotEvent extends ChatEventBase {
    type: 'ACTIVITY_SNAPSHOT';
    messageId: string;

    /** Kind of activity - becomes the `dataType` of its data part. */
    activityType: string;
    content: PlainObject;

    /** False to keep the existing content of a part with the same id. Default true. */
    replace?: boolean;
}

//------------------
// Extension
//------------------
/**
 * An application-defined event. The kit acts on those named in {@link ChatCustomEventName} and
 * ignores the rest.
 */
export interface ChatCustomEvent extends ChatEventBase {
    type: 'CUSTOM';
    name: string;
    value: any;
}

/** AG-UI events the kit accepts but does not act on. */
export interface IgnoredEvent extends ChatEventBase {
    type:
        | 'RAW'
        | 'STATE_SNAPSHOT'
        | 'STATE_DELTA'
        | 'MESSAGES_SNAPSHOT'
        | 'ACTIVITY_DELTA'
        | 'SUBAGENT_STARTED'
        | 'SUBAGENT_FINISHED'
        | 'SUBAGENT_ERROR';
    [key: string]: any;
}

/**
 * Names of the `CUSTOM` events with which a backend sends kit-specific content:
 *
 *  - `xh.chat.source` - value `{id?, url?, title?, snippet?}`, appends a source part.
 *  - `xh.chat.citation` - value `{id?, title?, url?, citedText?, sourceId?}`, cites a source
 *    from the current text part.
 *  - `xh.chat.data` - value `{id?, dataType, data}`, adds or replaces a data part.
 *  - `xh.chat.file` - value `{id?, name, mediaType, size?, url?, data?}`, appends a file part.
 *  - `xh.chat.providerData` - value `{subtype: 'message' | 'tool-call', entityId, data}`, merges
 *    `data` into the `providerData` of a reasoning part or tool call, by provider key. Ids follow
 *    `REASONING_ENCRYPTED_VALUE`.
 *  - `xh.chat.providerExecuted` - value `{toolCallId}`, marks a tool call as run by the backend
 *    before its result arrives, so that the chat never runs it as a client tool.
 *  - `xh.chat.toolError` - value `{toolCallId, message}`, fails a tool call the backend ran, in
 *    place of its result. The part moves to `output-error`, with `message` as its `errorText`.
 */
export type ChatCustomEventName =
    | 'xh.chat.source'
    | 'xh.chat.citation'
    | 'xh.chat.data'
    | 'xh.chat.file'
    | 'xh.chat.providerData'
    | 'xh.chat.providerExecuted'
    | 'xh.chat.toolError';
