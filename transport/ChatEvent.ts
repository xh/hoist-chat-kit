import type {PlainObject} from '@xh/hoist/core';

/**
 * Streaming event from a chat backend - the kit's wire vocabulary.
 *
 * These are the events of the AG-UI protocol (version 1.0), with the same `type` strings and
 * field names, so any AG-UI agent server can drive the kit directly. The kit mirrors the types it
 * reads rather than depending on `@ag-ui/core`. Events the kit does not act on are still accepted
 * and ignored.
 *
 * Kit-specific content (sources, citations, data parts, files) travels as AG-UI `CUSTOM` events
 * named with the `xh.chat.` prefix - see {@link ChatCustomEventName}.
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
    | CustomEvent
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
export interface RunStartedEvent extends ChatEventBase {
    type: 'RUN_STARTED';
    threadId: string;
    runId: string;
}

export interface RunFinishedEvent extends ChatEventBase {
    type: 'RUN_FINISHED';
    threadId: string;
    runId: string;
    result?: any;
    outcome?: {type: 'success' | 'interrupt' | 'cancelled'; [key: string]: any};
    usage?: ChatTokenUsage[];
}

export interface RunErrorEvent extends ChatEventBase {
    type: 'RUN_ERROR';
    message: string;
    code?: string;
}

export interface StepStartedEvent extends ChatEventBase {
    type: 'STEP_STARTED';
    stepName: string;
}

export interface StepFinishedEvent extends ChatEventBase {
    type: 'STEP_FINISHED';
    stepName: string;
}

/** Token counts for one model call, as reported on `RUN_FINISHED`. */
export interface ChatTokenUsage {
    provider?: string;
    model?: string;
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    reasoningTokens?: number;
    cachedInputTokens?: number;
    cacheWriteInputTokens?: number;
}

//------------------
// Text
//------------------
export interface TextMessageStartEvent extends ChatEventBase {
    type: 'TEXT_MESSAGE_START';
    messageId: string;
    role?: 'developer' | 'system' | 'assistant' | 'user';
}

export interface TextMessageContentEvent extends ChatEventBase {
    type: 'TEXT_MESSAGE_CONTENT';
    messageId: string;
    delta: string;
}

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
export interface ReasoningStartEvent extends ChatEventBase {
    type: 'REASONING_START';
    messageId: string;
}

export interface ReasoningMessageStartEvent extends ChatEventBase {
    type: 'REASONING_MESSAGE_START';
    messageId: string;
    role: 'reasoning';
}

export interface ReasoningMessageContentEvent extends ChatEventBase {
    type: 'REASONING_MESSAGE_CONTENT';
    messageId: string;
    delta: string;
}

export interface ReasoningMessageEndEvent extends ChatEventBase {
    type: 'REASONING_MESSAGE_END';
    messageId: string;
}

export interface ReasoningMessageChunkEvent extends ChatEventBase {
    type: 'REASONING_MESSAGE_CHUNK';
    messageId?: string;
    delta?: string;
}

export interface ReasoningEndEvent extends ChatEventBase {
    type: 'REASONING_END';
    messageId: string;
}

/** Opaque provider data for a reasoning message or tool call, such as a thinking signature. */
export interface ReasoningEncryptedValueEvent extends ChatEventBase {
    type: 'REASONING_ENCRYPTED_VALUE';
    subtype: 'tool-call' | 'message';
    entityId: string;
    encryptedValue: string;
}

//------------------
// Tool calls
//------------------
export interface ToolCallStartEvent extends ChatEventBase {
    type: 'TOOL_CALL_START';
    toolCallId: string;
    toolCallName: string;
    parentMessageId?: string;
}

export interface ToolCallArgsEvent extends ChatEventBase {
    type: 'TOOL_CALL_ARGS';
    toolCallId: string;

    /** Fragment of the arguments' JSON text. */
    delta: string;
}

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

/** Result of a tool the backend ran. */
export interface ToolCallResultEvent extends ChatEventBase {
    type: 'TOOL_CALL_RESULT';
    messageId: string;
    toolCallId: string;
    content: string | PlainObject[];
    role?: 'tool';
}

//------------------
// Generative UI
//------------------
/** A typed activity payload to render in the message, such as a progress card or a form. */
export interface ActivitySnapshotEvent extends ChatEventBase {
    type: 'ACTIVITY_SNAPSHOT';
    messageId: string;
    activityType: string;
    content: PlainObject;
    replace?: boolean;
}

//------------------
// Extension
//------------------
export interface CustomEvent extends ChatEventBase {
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
 */
export type ChatCustomEventName =
    'xh.chat.source' | 'xh.chat.citation' | 'xh.chat.data' | 'xh.chat.file';
