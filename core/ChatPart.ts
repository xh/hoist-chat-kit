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
     * Zero-based index of the step - the model call within an assistant turn - that produced this
     * part. A turn that runs tools spans several steps. Absent on the parts of user messages.
     */
    step?: number;
}

/** Markdown text written by the user or the model. */
export interface ChatTextPart extends ChatPartBase {
    type: 'text';

    /** The text, in markdown. Grows while the part streams. */
    text: string;

    /** `streaming` while more text may arrive, then `done`. */
    state: ChatPartState;

    /** Sources the model cited for this text, in citation order. */
    citations?: ChatCitation[];

    /**
     * True while the part streams after the server replaced its text with shorter text, with
     * `xh.chat.textReplace`, until the new text is as long as the text it replaced. A view can
     * keep the replaced text on screen meanwhile. Gone once the part is done.
     */
    revising?: boolean;
}

/** The model's visible reasoning ("thinking") ahead of its answer. */
export interface ChatReasoningPart extends ChatPartBase {
    type: 'reasoning';

    /** The reasoning, in markdown. Empty when the provider sends only an encrypted form. */
    text: string;

    /** `streaming` while more reasoning may arrive, then `done`. */
    state: ChatPartState;

    /** Epoch millis when reasoning began. */
    startedAt: number;

    /** Epoch millis when reasoning ended - null while streaming. */
    endedAt: number;

    /**
     * Signature or encrypted form of the reasoning (such as an Anthropic thinking signature) that
     * must be sent back with the history for the provider to accept it. Never displayed.
     */
    encryptedValue?: string;

    /** Opaque provider data - see {@link ChatProviderData}. */
    providerData?: ChatProviderData;
}

/** A call by the model to a tool, with its input and - once run - its output. */
export interface ChatToolCallPart extends ChatPartBase {
    type: 'toolCall';

    /** Name of the tool called - see {@link ChatToolSpec.name}. */
    toolName: string;

    /** Where the call is in its lifecycle. */
    state: ChatToolCallState;

    /** Arguments as streamed, normally a JSON document. */
    inputText: string;

    /** Parsed arguments - a best-effort parse while streaming, null if unparseable. */
    input: PlainObject;

    /** Result of the call, once `output-available`. JSON-parsed when the result was JSON. */
    output: any;

    /** Failure or denial message, for `output-error` and `output-denied`. */
    errorText: string;

    /** The user's words with an approval - see `ChatModel.approveToolCallAsync()`. */
    approvalReason?: string;

    /**
     * True if the call was still open when the user stopped the turn. Its state is `output-error`
     * or `output-denied`, so that the history still gives the model a result, but views show it
     * as cancelled rather than failed - see {@link isToolCallCancelled}.
     */
    cancelled?: boolean;

    /** True if the backend ran the tool and streamed its result, rather than the browser. */
    providerExecuted?: boolean;

    /** Epoch millis when the call started streaming, if known. */
    startedAt?: number;

    /** Epoch millis when the call ended - succeeded, failed or was denied - if known. */
    endedAt?: number;

    /**
     * The sub-agent that made the call, if any - the id of a data part of type
     * `xh.chat.subagent`. See {@link ChatSubagentData}.
     */
    subagentRunId?: string;

    /** Signature for the call that must go back with the history. Never displayed. */
    encryptedValue?: string;

    /** Opaque provider data - see {@link ChatProviderData}. */
    providerData?: ChatProviderData;
}

/** A file attached by the user or produced by the model. */
export interface ChatFilePart extends ChatPartBase {
    type: 'file';

    /** File name, for display and as a title for the model. */
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

/**
 * What kind of thing a source is - see {@link ChatSourcePart.sourceType}.
 *
 *  - `url` - a web page, opened in a new tab.
 *  - `document` - a document of the app's own, such as a file in a document library, opened in
 *    the app's document viewer.
 */
export type ChatSourceType = 'url' | 'document';

/** A source the model consulted, such as a web page or a document. */
export interface ChatSourcePart extends ChatPartBase {
    type: 'source';

    /**
     * What kind of thing the source is. A `document` opens in the chat's side panel, where the app
     * renders it, and a `url` opens in a new tab. The stream reducer defaults it to `url` for a
     * source with a `url`, else `document`. A source built some other way and missing it is read
     * the same way.
     */
    sourceType?: ChatSourceType;

    /** Location of the source, if it has one. */
    url?: string;

    /** Title to display for the source. */
    title?: string;

    /** Short excerpt of the source, for display. */
    snippet?: string;

    /**
     * Number that cites this source in the message text, as in `[1]`. When no source of a message
     * has a marker, `[n]` refers to the nth source, counting from 1.
     */
    marker?: number;

    /**
     * App-defined data about the source, such as a document id. The kit reads these keys when
     * present, and shows nothing it is not given:
     *
     *  - `excerpt` - the cited passage, shown in the citation card and the sources list in place
     *    of `snippet`.
     *  - `fileName` - the document's file name, shown after its title and used for its file icon.
     *  - `page` - the page the passage is on, shown as "p. 41" and sent with a document request.
     *  - `favicon` - an icon for a web page, as a `data:` image URI or an image URL. A URL loads
     *    only if the chat's `allowImages` permits it, else a letter tile shows.
     */
    metadata?: PlainObject;
}

/**
 * App- or protocol-defined content, rendered by the renderer registered for its `dataType` - see
 * {@link ChatModelConfig.dataRenderers}. This is the seam for generative UI: AG-UI activities,
 * A2UI surfaces, OpenUI payloads and MCP App resources all arrive as data parts.
 */
export interface ChatDataPart extends ChatPartBase {
    type: 'data';

    /** Kind of content - selects the renderer. */
    dataType: string;

    /** The content, in the form its renderer expects. */
    data: any;
}

/** A citation attached to a span of model text. */
export interface ChatCitation {
    /** Unique within its text part. */
    id: string;

    /** Title of the cited source. */
    title?: string;

    /** Location of the cited source. */
    url?: string;

    /** The quoted passage that supports the text. */
    citedText?: string;

    /** Id of the {@link ChatSourcePart} this citation refers to, if any. */
    sourceId?: string;
}

/**
 * Data that a provider attaches to a part and needs back with the history, such as a server tool's
 * result block. Keyed by provider name, e.g. `{anthropic: {...}}`, so that data from one provider
 * never reaches another's codec. Only the codec for that provider reads it. Never displayed.
 */
export type ChatProviderData = Record<string, PlainObject>;

/** True if a tool call has finished, in success, failure, or denial. */
export function isToolCallFinal(part: ChatToolCallPart): boolean {
    return FINAL_STATES.has(part.state);
}

/** True if a tool call was still open when the user stopped its turn - see `cancelled`. */
export function isToolCallCancelled(part: ChatToolCallPart): boolean {
    return !!part.cancelled;
}

/** True if a tool call failed - not counting one cancelled by a stop. */
export function isToolCallFailed(part: ChatToolCallPart): boolean {
    return part.state === 'output-error' && !part.cancelled;
}

//------------------
// Implementation
//------------------
const FINAL_STATES: ReadonlySet<ChatToolCallState> = new Set([
    'output-available',
    'output-error',
    'output-denied'
]);
