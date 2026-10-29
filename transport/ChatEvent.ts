import type * as AgUi from '@ag-ui/core';
import type {PlainObject} from '@xh/hoist/core';

/**
 * Streaming event from a chat backend - the kit's wire vocabulary.
 *
 * These are the events of the AG-UI protocol (version 1.0), typed from `@ag-ui/core`. Each kit
 * type takes its fields from the official type of the same name, and widens `type` to its string,
 * so code can write `{type: 'RUN_STARTED', ...}` as well as `EventType.RUN_STARTED`. Any AG-UI
 * agent server can drive the kit directly. Events the kit does not act on are still accepted and
 * ignored.
 *
 * One AG-UI run is one step of a kit turn: a single model call, from `RUN_STARTED` to
 * `RUN_FINISHED` or `RUN_ERROR`. AG-UI's own `STEP_STARTED` and `STEP_FINISHED` events put a
 * progress label over part of a run, such as a node of an agent graph. They are not kit steps.
 * `AgUiCodec` checks their rules, and the kit does not show them - see D109.
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
    | SubagentStartedEvent
    | SubagentFinishedEvent
    | SubagentErrorEvent
    | ChatCustomEvent
    | IgnoredEvent;

/** Discriminator values for {@link ChatEvent}. */
export type ChatEventType = ChatEvent['type'];

/** Fields common to all events: `timestamp`, `rawEvent` and `metadata`. */
export type ChatEventBase = Omit<AgUi.BaseEvent, 'type'>;

/** Token counts for one step, as reported on `RUN_FINISHED`. */
export type ChatTokenUsage = AgUi.TokenUsage;

//------------------
// Lifecycle
//------------------
/**
 * A run - one step of the turn - has started. Its `runId` is recorded on the message as
 * `metadata.runId`. In server mode, the first run of a new thread may report the server's own
 * `threadId`, which the chat adopts. AG-UI requires it as the first event of every stream.
 */
export interface RunStartedEvent extends Wire<AgUi.RunStartedEvent> {}

/**
 * The run has finished normally. A stream sends it once, as its last event. A stream that ends
 * without this event, or `RUN_ERROR`, fails the turn as incomplete.
 */
export interface RunFinishedEvent extends Wire<AgUi.RunFinishedEvent> {
    /**
     * The agent's result, if any. A `messageId` in it is recorded as the reply's
     * `metadata.serverId`, unless an `xh.chat.message` event reported one first.
     */
    result?: any;

    /** How the run ended. Maps to the finish reason when `metadata.finishReason` is not given. */
    outcome?: AgUi.RunFinishedOutcome;

    /** Token counts for the run, recorded as `metadata.usage` on the message. */
    usage?: ChatTokenUsage[];
}

/**
 * The run has failed. Its `code` is recorded as `metadata.errorCode` on the message. A
 * `metadata.retryAfterSeconds` - the wait the backend asks for before a retry - is recorded on
 * the message too, and becomes `ChatRunError.retryAfterSeconds`. A `metadata.retrySafe: false`
 * says that a resend of the turn could run work twice, such as a write. It is recorded as
 * `metadata.retrySafe`, and the composer then offers Refresh Status rather than Try Again - see
 * `isChatRetrySafe()`.
 */
export interface RunErrorEvent extends Wire<AgUi.RunErrorEvent> {
    /** Error text, shown to the user. */
    message: string;

    /** Machine-readable error code, such as `overloaded_error`. */
    code?: string;
}

/** A progress label over part of the run has started - not a kit step. Checked, not shown. */
export interface StepStartedEvent extends Wire<AgUi.StepStartedEvent> {}

/** A progress label over part of the run has finished - not a kit step. Checked, not shown. */
export interface StepFinishedEvent extends Wire<AgUi.StepFinishedEvent> {}

//------------------
// Text
//------------------
/** A text message has started. Its part opens with its first content. */
export interface TextMessageStartEvent extends Wire<AgUi.TextMessageStartEvent> {}

/** A fragment of a text message. */
export interface TextMessageContentEvent extends Wire<AgUi.TextMessageContentEvent> {}

/** A text message has ended. */
export interface TextMessageEndEvent extends Wire<AgUi.TextMessageEndEvent> {}

/**
 * Convenience form that opens, extends, or continues a text message. The kit's AG-UI decoder
 * expands chunks into start, content and end events before the chat sees them.
 */
export interface TextMessageChunkEvent extends Wire<AgUi.TextMessageChunkEvent> {}

//------------------
// Reasoning
//------------------
/** A span of reasoning has started. */
export interface ReasoningStartEvent extends Wire<AgUi.ReasoningStartEvent> {}

/** A reasoning message, within a reasoning span, has started. */
export interface ReasoningMessageStartEvent extends Wire<AgUi.ReasoningMessageStartEvent> {}

/** A fragment of a reasoning message. */
export interface ReasoningMessageContentEvent extends Wire<AgUi.ReasoningMessageContentEvent> {}

/** A reasoning message has ended. */
export interface ReasoningMessageEndEvent extends Wire<AgUi.ReasoningMessageEndEvent> {}

/** Convenience form that opens, extends, or continues a reasoning message. */
export interface ReasoningMessageChunkEvent extends Wire<AgUi.ReasoningMessageChunkEvent> {}

/** A span of reasoning has ended. */
export interface ReasoningEndEvent extends Wire<AgUi.ReasoningEndEvent> {}

/** A signature for a reasoning message or tool call, such as an Anthropic thinking signature. */
export interface ReasoningEncryptedValueEvent extends Wire<AgUi.ReasoningEncryptedValueEvent> {}

//------------------
// Tool calls
//------------------
/** The model has started a tool call. */
export interface ToolCallStartEvent extends Wire<AgUi.ToolCallStartEvent> {
    /** The sub-agent that made the call - see {@link SubagentStartedEvent}. */
    subagentRunId?: string;
}

/** A fragment of a tool call's arguments, as JSON text. */
export interface ToolCallArgsEvent extends Wire<AgUi.ToolCallArgsEvent> {}

/** The model has finished writing a tool call's arguments. */
export interface ToolCallEndEvent extends Wire<AgUi.ToolCallEndEvent> {}

/** Convenience form that opens or extends a tool call. Expanded like a text chunk. */
export interface ToolCallChunkEvent extends Wire<AgUi.ToolCallChunkEvent> {
    /** The sub-agent that made the call - see {@link SubagentStartedEvent}. */
    subagentRunId?: string;
}

/**
 * Result of a tool the backend ran.
 *
 * AG-UI's event has no error field, so the kit reads a failure from `metadata`. A result with
 * `metadata.error` (the error text) or `metadata.isError: true` (with the error text as `content`)
 * fails the call: its part moves to `output-error`, with the text as `errorText`. The
 * `xh.chat.toolError` custom event does the same for a backend that cannot set `metadata`.
 *
 * A result may also carry the result sets the tool produced, as `metadata.artifacts` - a list of
 * `ChatArtifact`. They are recorded on the reply as the `xh.chat.artifact` event records them.
 */
export interface ToolCallResultEvent extends Wire<AgUi.ToolCallResultEvent> {
    /** The result - JSON-parsed into the part's `output` when it parses. */
    content: string | AgUi.ContentPart[];

    /** Set `error` or `isError` to report that the tool failed, and `artifacts` to add data. */
    metadata?: PlainObject & {error?: string; isError?: boolean; artifacts?: PlainObject[]};
}

//------------------
// Generative UI
//------------------
/**
 * A typed activity payload to render in the message, such as a progress card or a form. Its
 * `activityType` becomes the `dataType` of its data part, and its `subagentRunId` the part's. A
 * `replace: false` keeps the existing content of a part with the same id.
 */
export interface ActivitySnapshotEvent extends Wire<AgUi.ActivitySnapshotEvent> {}

//------------------
// Sub-agents
//------------------
/**
 * An agent has handed part of its work to a sub-agent. Tool calls the sub-agent makes carry its
 * `subagentRunId`. The kit records the sub-agent as a data part of type `xh.chat.subagent`, and
 * the activity timeline nests its calls under it.
 */
export interface SubagentStartedEvent extends Wire<AgUi.SubagentStartedEvent> {}

/**
 * A sub-agent has finished its work. Its `result`, when text, shows as its result line in the
 * timeline.
 */
export interface SubagentFinishedEvent extends Wire<AgUi.SubagentFinishedEvent> {}

/** A sub-agent has failed. */
export interface SubagentErrorEvent extends Wire<AgUi.SubagentErrorEvent> {}

//------------------
// Extension
//------------------
/**
 * An application-defined event. The kit acts on those named in {@link ChatCustomEventName} and
 * ignores the rest.
 */
export interface ChatCustomEvent extends Wire<AgUi.CustomEvent> {}

/** AG-UI events the kit accepts but does not act on. */
export type IgnoredEvent =
    | Wire<AgUi.RawEvent>
    | Wire<AgUi.StateSnapshotEvent>
    | Wire<AgUi.StateDeltaEvent>
    | Wire<AgUi.MessagesSnapshotEvent>
    | Wire<AgUi.ActivityDeltaEvent>;

/**
 * Names of the `CUSTOM` events with which a backend sends kit-specific content:
 *
 *  - `xh.chat.source` - value `{id?, sourceType?, url?, title?, snippet?, marker?, metadata?}`,
 *    appends a source part. `marker` is the number that cites it in the text, as in `[1]`.
 *    `sourceType` is `url` for a web page or `document` for a document of the app's own, and
 *    defaults to `url` when the source has a `url`, else `document`.
 *  - `xh.chat.citation` - value `{id?, title?, url?, citedText?, sourceId?}`, cites a source
 *    from the current text part.
 *  - `xh.chat.data` - value `{id?, dataType, data, subagentRunId?}`, adds or replaces a data
 *    part. The `dataType` `xh.chat.noAnswer` is reserved for a fixed "not found" reply, with
 *    `data` a `ChatNoAnswerData` - the kit renders it from a built-in template.
 *  - `xh.chat.file` - value `{id?, name, mediaType, size?, url?, data?}`, appends a file part.
 *  - `xh.chat.providerData` - value `{subtype: 'message' | 'tool-call', entityId, data}`, merges
 *    `data` into the `providerData` of a reasoning part or tool call, by provider key. Ids follow
 *    `REASONING_ENCRYPTED_VALUE`.
 *  - `xh.chat.providerExecuted` - value `{toolCallId}`, marks a tool call as run by the backend
 *    before its result arrives, so that the chat never runs it as a client tool.
 *  - `xh.chat.toolError` - value `{toolCallId, message}`, fails a tool call the backend ran, in
 *    place of its result. The part moves to `output-error`, with `message` as its `errorText`.
 *  - `xh.chat.textReplace` - value `{text}`, sets the text of the open text part, or else of the
 *    reply's last text part. Covers a backend that resets its answer (`text: ''`) or sends its
 *    final text whole.
 *  - `xh.chat.message` - value `{role: 'assistant' | 'user', serverId}`, records the server's id
 *    for the turn's reply or its user message, as `metadata.serverId`.
 *  - `xh.chat.artifact` - value `{id, columns, rows?, totalRows, metadata?}`, a result set that
 *    generative UI components show by reference - see `ChatArtifact`. Recorded on the reply in
 *    `metadata.artifacts`, replacing one with the same id, and added to the chat's artifact
 *    registry.
 */
export type ChatCustomEventName =
    | 'xh.chat.source'
    | 'xh.chat.citation'
    | 'xh.chat.data'
    | 'xh.chat.file'
    | 'xh.chat.providerData'
    | 'xh.chat.providerExecuted'
    | 'xh.chat.toolError'
    | 'xh.chat.textReplace'
    | 'xh.chat.message'
    | 'xh.chat.artifact';

//------------------
// Implementation
//------------------
/** An official AG-UI event type, with its `type` widened from the enum member to its string. */
type Wire<E extends AgUi.BaseEvent> = Omit<E, 'type'> & {type: `${E['type']}`};
