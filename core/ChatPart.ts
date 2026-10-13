import type {PlainObject} from '@xh/hoist/core';

/**
 * One typed piece of a {@link ChatMessage}. A message holds an ordered list of parts - text,
 * reasoning, tool calls, files, sources and app-defined data - so that the UI can render each
 * kind with its own component as it streams in.
 *
 * Parts are plain, immutable objects. The kit replaces a part (and its message) whenever it
 * changes, so memoized components re-render only what changed.
 */
export type ChatPart =
    | ChatTextPart
    | ChatReasoningPart
    | ChatToolCallPart
    | ChatFilePart
    | ChatSourcePart
    | ChatDataPart;

/** Discriminator values for {@link ChatPart}. */
export type ChatPartType = ChatPart['type'];

/** Streaming state of a text or reasoning part. */
export type ChatPartState = 'streaming' | 'done';

/**
 * Lifecycle of a tool call. Names follow the Vercel AI SDK tool part states, with the addition of
 * `running` for tools executed in the browser.
 *
 *  - `input-streaming` - the model is still writing the call's arguments.
 *  - `input-available` - arguments are complete and the call has not run yet.
 *  - `approval-requested` - the call is waiting for the user to approve or deny it.
 *  - `running` - a client-side tool is executing.
 *  - `output-available` - the call finished, with its result in `output`.
 *  - `output-error` - the call failed, with a message in `errorText`.
 *  - `output-denied` - the user denied the call.
 */
export type ChatToolCallState =
    | 'input-streaming'
    | 'input-available'
    | 'approval-requested'
    | 'running'
    | 'output-available'
    | 'output-error'
    | 'output-denied';

/** Properties shared by all parts. */
export interface ChatPartBase {
    /** Unique within its message. For tool calls, the provider's tool call id. */
    id: string;

    /**
     * Zero-based index of the model call, within an assistant turn, that produced this part. A
     * turn that runs tools spans several steps. Null for user messages.
     */
    step?: number;
}

/** Markdown text written by the user or the model. */
export interface ChatTextPart extends ChatPartBase {
    type: 'text';
    text: string;
    state: ChatPartState;

    /** Sources the model cited for this text, in citation order. */
    citations?: ChatCitation[];
}

/** The model's visible reasoning ("thinking") ahead of its answer. */
export interface ChatReasoningPart extends ChatPartBase {
    type: 'reasoning';
    text: string;
    state: ChatPartState;

    /** Epoch millis when reasoning began. */
    startedAt: number;

    /** Epoch millis when reasoning ended - null while streaming. */
    endedAt: number;

    /**
     * Opaque provider data (such as an Anthropic thinking signature) that must be sent back with
     * the history for the provider to accept it. Never displayed.
     */
    encryptedValue?: string;
}

/** A call by the model to a tool, with its input and - once run - its output. */
export interface ChatToolCallPart extends ChatPartBase {
    type: 'toolCall';
    toolName: string;
    state: ChatToolCallState;

    /** Arguments as streamed, normally a JSON document. */
    inputText: string;

    /** Parsed arguments - a best-effort parse while streaming, null if unparseable. */
    input: PlainObject;

    /** Result of the call, once `output-available`. JSON-parsed when the result was JSON. */
    output: any;

    /** Failure or denial message, for `output-error` and `output-denied`. */
    errorText: string;

    /** True if the backend ran the tool and streamed its result, rather than the browser. */
    providerExecuted?: boolean;
}

/** A file attached by the user or produced by the model. */
export interface ChatFilePart extends ChatPartBase {
    type: 'file';
    name: string;

    /** MIME type, such as `image/png` or `application/pdf`. */
    mediaType: string;

    /** Size in bytes, if known. */
    size?: number;

    /** Location of the file content, when not inlined via `data`. */
    url?: string;

    /** File content, base64-encoded. */
    data?: string;
}

/** A source the model consulted, such as a web page or a document. */
export interface ChatSourcePart extends ChatPartBase {
    type: 'source';
    url?: string;
    title?: string;
    snippet?: string;
}

/**
 * App- or protocol-defined content, rendered by the renderer registered for its `dataType` - see
 * {@link ChatModelConfig.dataRenderers}. This is the seam for generative UI: AG-UI activities,
 * A2UI surfaces, OpenUI payloads and MCP App resources all arrive as data parts.
 */
export interface ChatDataPart extends ChatPartBase {
    type: 'data';
    dataType: string;
    data: any;
}

/** A citation attached to a span of model text. */
export interface ChatCitation {
    id: string;
    title?: string;
    url?: string;

    /** The quoted passage that supports the text. */
    citedText?: string;

    /** Id of the {@link ChatSourcePart} this citation refers to, if any. */
    sourceId?: string;
}

/** Terminal tool call states - the call will not change again. */
export const TOOL_CALL_FINAL_STATES: ReadonlySet<ChatToolCallState> = new Set([
    'output-available',
    'output-error',
    'output-denied'
]);

/** True if a tool call has finished, in success, failure, or denial. */
export function isToolCallFinal(part: ChatToolCallPart): boolean {
    return TOOL_CALL_FINAL_STATES.has(part.state);
}
