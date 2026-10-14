import {
    cloneDeep,
    compact,
    countBy,
    differenceBy,
    findLast,
    findLastIndex,
    intersection,
    isArray,
    isEmpty,
    isFunction,
    isString,
    keys,
    maxBy,
    noop,
    omit,
    pick,
    pickBy
} from 'lodash';
import type {ReactNode} from 'react';
import type {PlainObject, TrackOptions} from '@xh/hoist/core';
import {HoistModel, managed, XH} from '@xh/hoist/core';
import {action, bindable, bindableRef, computed, observable, observableRef} from '@xh/hoist/mobx';
import {apiDeprecated, throwIf} from '@xh/hoist/utils/js';
import {
    ChatArtifactRegistry,
    type ChatArtifact,
    type ChatDataSource
} from '../genui/ChatArtifactRegistry';
import type {ChatUiCatalog} from '../genui/ChatUiCatalog';
import {CHAT_UI_DOCUMENT_DATA_TYPE} from '../genui/ChatUiDocument';
import {isChatArtifact, mergeArtifacts} from '../genui/impl/artifacts';
import type {
    ChatEvent,
    ChatRunContext,
    ChatRunRef,
    ChatRunRequest,
    ChatRunTrigger,
    ChatTransport
} from '../transport';
import {ChatAbortError, type ChatAbortReason} from './ChatAbortError';
import {ChatComposerModel, type ChatComposerConfig} from './ChatComposerModel';
import type {ChatContextProvider} from './ChatContextProvider';
import type {
    ChatFeedback,
    ChatFeedbackConfig,
    ChatFeedbackRating,
    ChatFeedbackSpec,
    ChatFeedbackSubmitter
} from './ChatFeedback';
import {ChatMessage, type ChatMessageSpec} from './ChatMessage';
import type {ChatDataPart, ChatFilePart, ChatPart, ChatToolCallPart} from './ChatPart';
import {ChatRunError} from './ChatRunError';
import {ChatToolResult, type ChatToolUndo} from './ChatToolResult';
import type {ChatToolSpec} from './ChatToolSpec';
import {isAbortError, raceAbort} from '../impl/abort';
import {ChatStreamReducer} from './impl/ChatStreamReducer';
import {genChatId} from '../impl/ids';
import {
    createTextPart,
    getClientToolCalls,
    settleOpenParts,
    settleStreamingParts,
    updatePart
} from './impl/messageUtils';

/** Configuration for a {@link ChatModel}. */
export interface ChatModelConfig {
    /** Connection to the backend that runs the model or agent. */
    transport: ChatTransport;

    /** Tools the model may call, and display config for tools the backend runs. */
    tools?: ChatToolSpec[];

    /**
     * Generative UI components the model can show - see `ChatUiCatalog`. The chat adds the
     * catalog's tools to its own, so the app lists only its own `tools`:
     *
     *  - In client mode, the component tools for the catalog's `tools` mode, and the document
     *    tool for its `document` mode.
     *  - In server mode, the catalog's display tools. The server registers the tools and answers
     *    their calls. The chat renders the calls, and never sends these tools to the model.
     *
     * Text in replies renders the catalog's component tags, data parts of type `xh.chat.ui`
     * render as documents, and each request carries the catalog's version - see
     * `ChatRunRequest.catalogVersion`. Throws if a catalog tool has the name of another tool in
     * `tools`. Default none.
     */
    catalog?: ChatUiCatalog;

    /**
     * Loads the rows of artifacts that are not yet in the browser - see {@link ChatModel.artifacts}.
     * Default none: components show only the rows sent inline.
     */
    dataSource?: ChatDataSource;

    /**
     * Live context to send with every step, such as the state of a component that the model's
     * tools act on. Each provider runs before each step, so the model sees changes made since the
     * last one, and the results travel as `ChatRunRequest.context`. Default none.
     */
    contextProviders?: ChatContextProvider[];

    /**
     * Maximum steps - model calls - in one assistant turn. Each round of client tool calls takes
     * one more. Default 10.
     */
    maxSteps?: number;

    /**
     * Messages to start with, such as a greeting or restored history. Messages left in progress
     * are closed, as with {@link ChatModel.loadMessages}.
     */
    initialMessages?: ChatMessageSpec[];

    /**
     * Identifies the conversation to the backend. Default a new UUID. In server mode, a new
     * thread's id may be replaced once by the server's - see {@link ChatModel.threadId}.
     */
    threadId?: string;

    /**
     * Who owns the conversation history. Default 'client'.
     *
     *  - `client` - the browser holds the history, and each request carries all of it. Suits a
     *    helper agent whose backend keeps no state.
     *  - `server` - a backend agent service holds the history and the threads. Each request
     *    carries only what the server has not seen, with the turn's ids, and the server's thread
     *    and message ids are recorded as they arrive. A stop asks the transport to cancel the run,
     *    while a clear, a load or a detach leaves it running on the server.
     */
    historyMode?: ChatHistoryMode;

    /** Initial value of {@link ChatModel.runOptions}. Default null. */
    runOptions?: PlainObject;

    /**
     * Rewrites model text as it streams, before it is stored - for example to strip markup that
     * a model leaks, such as `<thinking>` tags. Called on each change to a text part of a reply,
     * with all of the part's text so far, and once more when the part is done. Must be pure and
     * fast. Not applied to user messages, or to messages loaded as history.
     */
    textTransform?: ChatTextTransform;

    /** Feedback on assistant messages - see {@link ChatModel.submitFeedbackAsync}. */
    feedback?: ChatFeedbackConfig;

    /**
     * True, or options, to record each finished turn with Hoist activity tracking. Each turn
     * tracks once, in category `Chat`, with its timing, step and tool call counts, finish reason,
     * error code and ids - never message text. Feedback is tracked too. Default false.
     */
    track?: boolean | ChatTrackOptions;

    /** Config for the managed {@link ChatComposerModel}. */
    composer?: ChatComposerConfig;

    /**
     * Decides whether the user may send now. Return the reason sending must wait - such as
     * 'Choose a document first.' - or null to allow it. Read as a computed value, so the composer
     * updates as the observables it reads change. While it returns a reason, the composer
     * disables Send and shows the reason, and `sendAsync` and `editMessageAsync` do nothing.
     */
    sendBlocker?: () => string;

    /**
     * Renderers for data parts, keyed by `dataType`. Data parts carry app- and protocol-defined
     * content, such as generative UI. Parts without a renderer display as JSON.
     */
    dataRenderers?: Record<string, ChatDataRenderer>;

    /**
     * Called when an assistant turn ends - complete, failed, or stopped - with its final message.
     * Not called when a turn pauses for the user, but called when a paused turn is later closed.
     * Also called for a turn that `clear`, `loadMessages`, `retryAsync`, `regenerateAsync` or
     * `editMessageAsync` stops or closes, just before its message is discarded.
     */
    onTurnComplete?: (message: ChatMessage) => void;
}

/** Who owns the conversation history - see {@link ChatModelConfig.historyMode}. */
export type ChatHistoryMode = 'client' | 'server';

/**
 * Creates a new thread on the backend before its first run - see
 * {@link ChatModel.setThreadCreator}. Resolves to the id the backend gave the thread.
 */
export type ChatThreadCreator = (spec: ChatThreadCreatorSpec) => Promise<string>;

/** Passed to a {@link ChatThreadCreator}. */
export interface ChatThreadCreatorSpec {
    /** The thread's provisional id - minted by the browser. */
    threadId: string;

    /** The user message that starts the thread's first turn. */
    userMessage: ChatMessage;
}

/** Rewrites model text before it is stored - see {@link ChatModelConfig.textTransform}. */
export type ChatTextTransform = (text: string, context: ChatTextTransformContext) => string;

/** Passed to a {@link ChatTextTransform}. */
export interface ChatTextTransformContext {
    /** The assistant message being built, as it was before the change. */
    message: ChatMessage;

    /** True while more text may arrive for the part, false for its final text. */
    isStreaming: boolean;
}

/** Activity tracking options for a chat - see {@link ChatModelConfig.track}. */
export interface ChatTrackOptions extends Pick<TrackOptions, 'category' | 'severity' | 'logData'> {}

/**
 * Renders a {@link ChatDataPart} - see {@link ChatModelConfig.dataRenderers}.
 *
 * The chat renders the result as the body of a component of its own, so the renderer may call
 * React hooks, such as `useLocalModel()` for a model it owns. It re-renders only when its part
 * changes, or when an observable it reads changes.
 */
export type ChatDataRenderer = (part: ChatDataPart, context: ChatPartRenderContext) => ReactNode;

/**
 * Passed to the renderers of a message's parts - {@link ChatToolSpec.renderer} and
 * {@link ChatDataRenderer}.
 *
 * The context is stable for the life of its message, while the message itself is replaced on every
 * streamed change. A renderer that needs the whole message reads it with
 * `chatModel.getMessage(messageId)`, and then re-renders whenever the message changes.
 */
export interface ChatPartRenderContext {
    /** The chat that shows the part - for example to send a message or answer a tool call. */
    chatModel: ChatModel;

    /** Id of the message that holds the part. */
    messageId: string;
}

/**
 * State of the conversation.
 *
 *  - `ready` - idle, and ready for the user's next message. A turn paused for the user is ready -
 *    see {@link ChatModel.isAwaitingUser}.
 *  - `submitted` - a turn has started and no content has arrived yet.
 *  - `streaming` - content is arriving, or client tools are running.
 *  - `error` - the last turn failed. See `lastError`.
 */
export type ChatStatus = 'ready' | 'submitted' | 'streaming' | 'error';

/** A user message to send - see {@link ChatModel.sendAsync}. */
export interface ChatSendSpec {
    /** Text of the message. Trimmed. */
    text?: string;

    /** Files to attach, sent ahead of the text. */
    files?: ChatFilePart[];

    /** App data to record on the user message. */
    metadata?: PlainObject;
}

/**
 * Model for one conversation with an LLM or agent: the message history, the status of the
 * current turn, and the run loop that streams responses and executes client tools.
 *
 * Each user message starts a turn, which builds one assistant message. A turn makes one or more
 * steps - model calls - through the {@link ChatTransport}. When a step ends with calls to client
 * tools - those with an `execute` function - the chat runs them in order and starts another step
 * with their results, up to `maxSteps`.
 *
 * A turn pauses while tool calls wait for the user: for approval (see
 * {@link ChatToolSpec.needsApproval}), or for the result of an interactive tool (see
 * {@link ChatToolSpec.interactive}), given via {@link addToolOutputAsync}. While paused, the chat
 * is `ready`, its last message is `paused`, and {@link waitingToolCalls} lists the calls to answer.
 * The turn resumes once every waiting call is answered. Sending a new message instead closes the
 * waiting calls, so that the history stays valid for the model.
 *
 * A client tool makes its change undoable by returning {@link chatToolResult} with an `undo`
 * function. The user can then undo the changes of the latest reply that made any - see
 * {@link undoTurnAsync}.
 *
 * The chat serves two shapes of conversation - see {@link ChatModelConfig.historyMode}. In client
 * mode the browser owns the history. In server mode an agent service owns it, and the chat sends
 * each turn's new message and records the server's ids. Kit message ids never change: server ids
 * are kept in `metadata.serverId` and `metadata.runId`.
 *
 * Only one turn runs at a time. Render the model with a desktop `ChatPanel`, or with the
 * lower-level message list and composer components.
 */
export class ChatModel extends HoistModel {
    declare config: ChatModelConfig;

    //-----------------------
    // Immutable Properties
    //-----------------------
    /** Connection to the backend that runs the model or agent. */
    readonly transport: ChatTransport;

    /**
     * Tools the model may call, and display config for tools the backend runs. Includes the tools
     * of the `catalog`.
     */
    readonly tools: ChatToolSpec[];

    /** Generative UI components the model can show, or null. */
    readonly catalog: ChatUiCatalog;

    /**
     * Result sets that generative UI components show by reference, by id - see
     * `ChatArtifactRegistry`. Fed by each reply's `xh.chat.artifact` events and tool results, by
     * client tools that return artifacts with {@link chatToolResult}, and by the
     * `metadata.artifacts` of messages loaded as history. Cleared with the thread, by `clear` and
     * `loadMessages`.
     */
    @managed readonly artifacts: ChatArtifactRegistry;

    /** Live context to send with every step. */
    readonly contextProviders: ChatContextProvider[];

    /** Maximum steps - model calls - in one assistant turn. */
    readonly maxSteps: number;

    /** Who owns the conversation history. */
    readonly historyMode: ChatHistoryMode;

    /** Feedback config, with its defaults applied. */
    readonly feedback: ChatFeedbackConfig;

    /** Renderers for data parts, keyed by `dataType`. */
    readonly dataRenderers: Record<string, ChatDataRenderer>;

    /** Draft text and attachments for the next message. */
    @managed readonly composerModel: ChatComposerModel;

    //-----------------------
    // Observable State
    //-----------------------
    /**
     * Identifies the conversation to the backend. A new id is generated by `clear`, and by
     * `loadMessages` unless it is given one. In server mode, the first run of a new thread may
     * report the server's id for it on `RUN_STARTED`, which replaces this one, once. A thread
     * creator - see {@link setThreadCreator} - replaces it the same way, in either mode. Set only
     * by the chat. (observable)
     */
    get threadId(): string {
        return this._threadId;
    }

    /** Conversation history, oldest first. Replaced, never mutated, on change. (observable) */
    @observableRef accessor messages: ChatMessage[] = [];

    /**
     * Options for the next turn that the user picks in the UI, such as a document scope, an agent
     * profile or tool toggles. `sendAsync` records a copy on the user message, as
     * `metadata.runOptions`, and every request of the turn carries that copy, so a change while a
     * turn runs never reaches it. A retry, regenerate or edit re-runs with the copy recorded on
     * its user message. Replace the value to change it. (bindable)
     */
    @bindableRef accessor runOptions: PlainObject;

    /**
     * True if the backend holds messages older than the first one loaded - set by the code that
     * pages in history, such as a thread layer, alongside {@link prependMessages}. (bindable)
     */
    @bindable accessor hasOlderMessages: boolean = false;

    /** State of the conversation. (observable) */
    @observable accessor status: ChatStatus = 'ready';

    /**
     * Error from the last turn, or null. A {@link ChatRunError} for an error the run reported, else
     * the error thrown - such as a Hoist `FetchException`. (observable)
     */
    @observableRef accessor lastError: Error = null;

    /** True while a turn is in progress. A turn paused for the user is not busy. */
    @computed
    get isBusy(): boolean {
        return this.status === 'submitted' || this.status === 'streaming';
    }

    /**
     * Why sending must wait, from the `sendBlocker` or a blocker added with
     * {@link addSendBlocker}, or null if the user may send.
     */
    @computed
    get sendBlockedReason(): string {
        for (const blocker of this.sendBlockers) {
            const reason = blocker();
            if (reason) return reason;
        }
        return null;
    }

    /** True if the conversation has no messages. */
    @computed
    get isEmpty(): boolean {
        return isEmpty(this.messages);
    }

    /** The most recent message, or null. */
    @computed
    get lastMessage(): ChatMessage {
        return this.messages[this.messages.length - 1] ?? null;
    }

    /**
     * Tool calls the paused turn is waiting on - calls to approve or deny, and calls to
     * interactive tools awaiting their result. Empty unless a turn is paused.
     */
    @computed
    get waitingToolCalls(): ChatToolCallPart[] {
        const {lastMessage} = this;
        if (this.isBusy || !lastMessage?.isAssistant) return [];
        return lastMessage.toolCalls.filter(it => this.isWaitingToolCall(it));
    }

    /** True if a turn is paused, waiting for the user to answer its tool calls. */
    @computed
    get isAwaitingUser(): boolean {
        return !isEmpty(this.waitingToolCalls);
    }

    /** Tool calls waiting for the user to approve or deny them - a subset of `waitingToolCalls`. */
    @computed
    get pendingApprovals(): ChatToolCallPart[] {
        return this.waitingToolCalls.filter(it => it.state === 'approval-requested');
    }

    /** True if the chat can submit feedback - from `feedback.submitAsync`, or the thread layer. */
    @computed
    get canSubmitFeedback(): boolean {
        return !!(this.feedback.submitAsync ?? this.feedbackSubmitter);
    }

    /**
     * Id of the reply whose changes the user can undo now, or null - see {@link undoTurnAsync}.
     * Only the latest reply that holds undoable changes qualifies, once its turn has ended, and
     * only while no turn is running or waiting for the user.
     */
    @computed
    get undoableMessageId(): string {
        if (this.isBusy || this.isAwaitingUser || this.isUndoing) return null;
        const message = findLast(this.messages, it => !isEmpty(this.undoStacks[it.id]));
        return message && !message.isStreaming && message.status !== 'paused' ? message.id : null;
    }

    constructor(config: ChatModelConfig) {
        super();
        const {
            transport,
            tools: appTools = [],
            catalog = null,
            dataSource = null,
            contextProviders = [],
            maxSteps = 10,
            initialMessages = [],
            threadId,
            historyMode = 'client',
            runOptions = null,
            textTransform = null,
            feedback,
            track = false,
            composer,
            dataRenderers = {},
            sendBlocker,
            onTurnComplete
        } = config;
        throwIf(!transport, 'ChatModel requires a transport.');
        throwIf(!(maxSteps >= 1), 'ChatModel maxSteps must be at least 1.');
        throwIf(
            historyMode !== 'client' && historyMode !== 'server',
            `ChatModel historyMode must be 'client' or 'server' - got '${historyMode}'.`
        );
        // Catalog tools that the app also listed, by identity, are added once.
        const catalogTools = getCatalogTools(catalog, historyMode).filter(
                it => !appTools.includes(it)
            ),
            clashes = intersection(
                appTools.map(it => it.name),
                catalogTools.map(it => it.name)
            ),
            tools = [...appTools, ...catalogTools];
        throwIf(
            !isEmpty(clashes),
            `ChatModel tools ${clashes.join(', ')} have the names of catalog tools. Rename them, ` +
                'or leave catalog tools out of the tools config - the chat adds them.'
        );
        const dupeNames = keys(pickBy(countBy(tools, 'name'), count => count > 1));
        throwIf(
            !isEmpty(dupeNames),
            `ChatModel tool names must be unique - found ${dupeNames.join(', ')} more than once.`
        );

        this.transport = transport;
        this.tools = tools;
        this.catalog = catalog;
        this.artifacts = new ChatArtifactRegistry({dataSource});
        this.contextProviders = contextProviders;
        this.maxSteps = maxSteps;
        this.historyMode = historyMode;
        this.feedback = {commentOn: 'negative', requireComment: false, ...feedback};
        this._threadId = threadId ?? genChatId();
        // An id given with history is the backend's. A new thread's may yet be replaced by it.
        this.isThreadIdProvisional = threadId == null || isEmpty(initialMessages);
        this.runOptions = runOptions;
        this.textTransform = textTransform;
        this.trackOptions = track === true ? {} : track || null;
        this.dataRenderers = {...catalog?.createDataRenderers(), ...dataRenderers};
        this.sendBlockers = sendBlocker ? [sendBlocker] : [];
        this.onTurnComplete = onTurnComplete;
        this.modelTools = tools.filter(
            it => it.sendToModel ?? (it.execute != null || !!it.interactive)
        );
        this.messages = restoreMessages(initialMessages);
        this.addArtifactsOf(this.messages);
        tools.forEach(it => {
            apiDeprecated('ChatToolSpec.approvalPreview', {
                test: it.approvalPreview,
                msg: `Set preview: true on tool '${it.name}' instead.`,
                source: this
            });
            if (it.interactive && !it.execute && !it.renderer) {
                this.logWarn(
                    `Interactive tool '${it.name}' has no renderer. The default tool call card ` +
                        'cannot answer it, so its calls wait with no way for the user to resume.'
                );
            }
        });
        this.composerModel = new ChatComposerModel({...composer, chatModel: this});
    }

    override destroy() {
        const {turn} = this;
        if (turn) {
            turn.abortController.abort(new ChatAbortError('destroy'));
            clearTimeout(turn.flushTimer);
            this.turn = null;
        }
        super.destroy();
    }

    //------------------
    // Actions
    //------------------
    /**
     * Send a user message and stream the reply, running any client tools the model calls.
     * Defaults to the composer's draft, which is then cleared. Does nothing while busy, while the
     * `sendBlocker` gives a reason to wait, or if there is no text or file to send.
     *
     * Tool calls left waiting for the user by the previous turn - including one restored with
     * `loadMessages` - are closed, approvals as denied, so that the history stays valid for the
     * model.
     *
     * @returns a promise that resolves when the turn ends or pauses, however it ends.
     */
    async sendAsync(input?: string | ChatSendSpec): Promise<void> {
        if (this.isTurnRunning) {
            this.logDebug('Send ignored - a turn is already in progress.');
            return;
        }
        if (this.sendBlockedReason) {
            this.logDebug('Send ignored - blocked.', this.sendBlockedReason);
            return;
        }

        const {composerModel} = this,
            fromComposer = input == null,
            spec: ChatSendSpec = fromComposer
                ? {text: composerModel.text, files: composerModel.attachments}
                : isString(input)
                  ? {text: input}
                  : input,
            text = spec.text?.trim(),
            parts: ChatPart[] = [...(spec.files ?? [])];

        if (text) parts.push(createTextPart(text));
        if (isEmpty(parts)) return;

        const runOptions = cloneDeep(this.runOptions),
            metadata = runOptions != null ? {...spec.metadata, runOptions} : spec.metadata,
            message = new ChatMessage({role: 'user', parts, metadata});
        await this.runNewTurnAsync('submit', () => {
            if (fromComposer) composerModel.clear();
            return [...this.messages, message];
        });
    }

    /**
     * Stop the current turn, running or paused. Content received so far is kept, with status
     * 'aborted'. If a step is in flight, the chat also asks the transport to cancel the run - see
     * {@link ChatTransport.cancelAsync}.
     */
    stop() {
        this.abortTurn('stop');
    }

    /**
     * Stop following the current turn, without cancelling it. The message is kept as 'aborted',
     * as with `stop`. In server mode, a turn with a step in flight is marked `metadata.detached`,
     * as the server finishes it on its own, and a reload of the thread later shows its answer.
     */
    detach() {
        this.abortTurn('detach');
    }

    /**
     * Re-run the last user message, replacing everything after it - typically the reply that
     * failed. Does nothing while busy or while a send blocker gives a reason to wait. See
     * `onTurnComplete` for a turn this closes.
     */
    async retryAsync(): Promise<void> {
        if (this.isTurnRunning || this.sendBlockedReason) return;

        const {messages} = this,
            idx = findLastIndex(messages, it => it.isUser);
        if (idx === -1) return;
        const replaced = messages.slice(idx + 1).find(it => it.isAssistant);
        await this.runNewTurnAsync(
            'retry',
            () => this.messages.slice(0, idx + 1),
            replaced?.id ?? null
        );
    }

    /**
     * Replace an assistant reply with a new one, discarding any later messages. Ignored while
     * busy, while a send blocker gives a reason to wait, and for a reply with no user message
     * before it, such as a greeting.
     *
     * @param messageId - default the last assistant message.
     */
    async regenerateAsync(messageId?: string): Promise<void> {
        if (this.isTurnRunning || this.sendBlockedReason) return;

        const {messages} = this,
            idx = findLastIndex(messages, it =>
                messageId != null ? it.id === messageId : it.isAssistant
            );
        if (!messages[idx]?.isAssistant) {
            this.logWarn('Regenerate ignored - no such assistant message.', messageId);
            return;
        }
        if (!messages.slice(0, idx).some(it => it.isUser)) {
            this.logDebug('Regenerate ignored - no user message before the reply.');
            return;
        }
        await this.runNewTurnAsync(
            'regenerate',
            () => this.messages.slice(0, idx),
            messages[idx].id
        );
    }

    /**
     * Change the text of a user message and re-run from it, discarding later messages. Files
     * attached to the message are kept.
     */
    async editMessageAsync(messageId: string, text: string): Promise<void> {
        if (this.isTurnRunning || this.sendBlockedReason) return;

        const idx = findLastIndex(this.messages, it => it.id === messageId),
            message = this.messages[idx];
        if (!message?.isUser) {
            this.logWarn('Edit ignored - no such user message.', messageId);
            return;
        }

        const parts: ChatPart[] = message.parts.filter(it => it.type !== 'text');
        if (text?.trim()) parts.push(createTextPart(text.trim()));
        if (isEmpty(parts)) return;
        await this.runNewTurnAsync('edit', () => [
            ...this.messages.slice(0, idx),
            message.withChanges({parts})
        ]);
    }

    /**
     * Approve a tool call that is waiting for approval. The turn continues - running the tool -
     * once no other call is waiting.
     */
    async approveToolCallAsync(toolCallId: string): Promise<void> {
        const turn = this.getPausedTurn(toolCallId, it => it.state === 'approval-requested');
        if (!turn) return;

        turn.approvedIds.add(toolCallId);
        this.updateToolCall(turn, toolCallId, {state: 'input-available'});
        await this.resumeTurnAsync(turn);
    }

    /**
     * Deny a tool call that is waiting for approval. The model is told of the denial, with the
     * given reason, once no other call is waiting.
     */
    async denyToolCallAsync(toolCallId: string, reason?: string): Promise<void> {
        const turn = this.getPausedTurn(toolCallId, it => it.state === 'approval-requested');
        if (!turn) return;

        this.updateToolCall(turn, toolCallId, {
            state: 'output-denied',
            errorText: reason ?? 'The user denied this tool call.'
        });
        await this.resumeTurnAsync(turn);
    }

    /**
     * Provide the result of a call to an interactive tool - one the user answers through its tool
     * call card or a custom renderer, declared with {@link ChatToolSpec.interactive}. The turn
     * continues once no other call is waiting.
     */
    async addToolOutputAsync(toolCallId: string, output: any): Promise<void> {
        const turn = this.getPausedTurn(
            toolCallId,
            it => it.state === 'input-available' && this.isInteractive(it)
        );
        if (!turn) return;

        this.updateToolCall(turn, toolCallId, {state: 'output-available', output});
        await this.resumeTurnAsync(turn);
    }

    /**
     * True if the user can undo the changes of a reply now - see {@link undoableMessageId}. Reads
     * observable state, so a component that calls it re-renders when the answer changes.
     */
    canUndoTurn(messageId: string): boolean {
        return messageId != null && this.undoableMessageId === messageId;
    }

    /**
     * Undo the changes that the tool calls of a reply made, newest first, by running the undo
     * functions they returned through {@link chatToolResult}. The reply is then marked
     * `metadata.undone`. Does nothing unless {@link canUndoTurn} is true for the reply.
     *
     * Undo functions live in memory only, so a reply loaded from history cannot be undone. If one
     * throws, the undo stops there and a toast reports it. The changes not yet undone stay, so the
     * user can try again.
     */
    async undoTurnAsync(messageId: string): Promise<void> {
        if (!this.canUndoTurn(messageId)) {
            this.logWarn('Undo ignored - the reply has no changes to undo now.', messageId);
            return;
        }

        const undos = this.undoStacks[messageId];
        this.setUndoing(true);
        try {
            for (const [idx, undo] of undos.entries()) {
                try {
                    await undo();
                } catch (e) {
                    this.setUndoStack(messageId, undos.slice(idx));
                    XH.handleException(e, {
                        message: 'The change could not be undone.',
                        alertType: 'toast'
                    });
                    return;
                }
            }
            this.markUndone(messageId);
        } finally {
            this.setUndoing(false);
        }

        const {metadata} = this.getMessage(messageId) ?? {};
        this.trackActivity('Turn undone', {
            changes: undos.length,
            threadId: this.threadId,
            messageId,
            serverId: metadata?.serverId ?? null,
            runId: metadata?.runId ?? null,
            historyMode: this.historyMode
        });
    }

    /**
     * Rate an assistant message, or clear its rating. The rating shows at once, as
     * `metadata.feedback`, and is then sent through `feedback.submitAsync`, or else the thread
     * layer's submitter. If the submit fails, the rating reverts - unless the user has rated the
     * message again since - and a toast says so. History restores a rating from the same key.
     *
     * @param rating - the rating, or null to clear it.
     * @param comment - the user's comment. Required for a rating that asks for one, if
     *      `feedback.requireComment` is set.
     * @returns a promise that resolves once the submit ends, whether or not it succeeded.
     */
    async submitFeedbackAsync(
        messageId: string,
        rating: ChatFeedbackRating,
        comment?: string
    ): Promise<void> {
        const message = this.getMessage(messageId);
        if (!message?.isAssistant) {
            this.logWarn('Feedback ignored - no such assistant message.', messageId);
            return;
        }

        const submitAsync = this.feedback.submitAsync ?? this.feedbackSubmitter,
            {requireComment, commentOn} = this.feedback;
        comment = comment?.trim() || null;
        throwIf(
            !submitAsync,
            'ChatModel cannot submit feedback - configure feedback.submitAsync, or use the chat ' +
                'in a thread layer that supplies a submitter.'
        );
        throwIf(
            rating && requireComment && !comment && (commentOn === 'both' || commentOn === rating),
            `A comment is required with ${rating} feedback.`
        );

        const prior: ChatFeedback = message.metadata.feedback ?? null,
            feedback: ChatFeedback = rating ? (comment ? {rating, comment} : {rating}) : null,
            {threadId} = this,
            spec: ChatFeedbackSpec = {
                threadId,
                messageId,
                serverId: message.metadata.serverId ?? null,
                runId: message.metadata.runId ?? null,
                rating: rating ?? null,
                comment
            };

        this.setFeedback(messageId, feedback);
        try {
            await submitAsync(spec);
        } catch (e) {
            if ((this.getMessage(messageId)?.metadata.feedback ?? null) === feedback) {
                this.setFeedback(messageId, prior);
            }
            XH.handleException(e, {
                message: 'Your feedback was not saved. Try again.',
                alertType: 'toast'
            });
            return;
        }

        this.trackActivity('Feedback submitted', {
            rating: spec.rating,
            hasComment: !!comment,
            threadId,
            messageId,
            serverId: spec.serverId,
            runId: spec.runId,
            historyMode: this.historyMode
        });
    }

    /**
     * Supply the feedback submitter to use when `feedback.submitAsync` is not configured. A
     * thread layer calls this when it creates the chat, with its store's submitter.
     */
    @action
    setFeedbackSubmitter(submitAsync: ChatFeedbackSubmitter) {
        this.feedbackSubmitter = submitAsync;
    }

    /**
     * Add a reason for sending to wait, checked after the configured `sendBlocker`. It blocks
     * sends just as the `sendBlocker` does. A thread layer calls this when it creates the chat,
     * for example to block sends until the thread's history has loaded.
     */
    @action
    addSendBlocker(blocker: () => string) {
        this.sendBlockers = [...this.sendBlockers, blocker];
    }

    /**
     * Supply a function that creates a new thread on the backend. The chat awaits it before the
     * first request of a new thread - one whose id is still provisional - and adopts the id it
     * returns. A failure fails the turn, with Retry, and the retry calls it again. A thread layer
     * calls this when it creates the chat, if its store creates threads.
     */
    @action
    setThreadCreator(createAsync: ChatThreadCreator) {
        this.threadCreator = createAsync;
    }

    /** Remove all messages and start a new thread. Stops any turn in progress. */
    clear() {
        this.replaceThread([], null, 'clear');
    }

    /**
     * Replace the conversation with the given messages, as a new thread. Stops any turn in
     * progress.
     *
     * Messages saved while in progress are closed, so the conversation can continue: a message
     * that was pending or streaming becomes 'aborted', with its unfinished tool calls failed. A
     * paused turn at the end of the history stays paused, so the user can still answer its tool
     * calls - or send a new message, which closes them. A paused turn earlier in the history is
     * closed.
     *
     * In server mode, a turn still running on the server is detached rather than cancelled - see
     * {@link detach}.
     *
     * @param threadId - id of the loaded conversation, to send to the backend. Default a new id.
     */
    loadMessages(specs: ChatMessageSpec[], threadId?: string) {
        this.replaceThread(specs, threadId, 'load');
    }

    /**
     * Add older messages ahead of the conversation, for history loaded a page at a time. Messages
     * already present, by id, are skipped. Messages left in progress are closed, as with
     * `loadMessages`. Set {@link hasOlderMessages} alongside, to show whether more remain.
     */
    @action
    prependMessages(specs: ChatMessageSpec[]) {
        const older = restoreMessages(differenceBy(specs, this.messages, 'id'), false);
        if (isEmpty(older)) return;
        this.messages = [...older, ...this.messages];
        this.addArtifactsOf(older);
    }

    /** The conversation as plain objects, for storage. */
    getMessageSpecs(): ChatMessageSpec[] {
        return this.messages.map(it => it.toSpec());
    }

    /** A message in the conversation, by id, or null. Reads the observable `messages`. */
    getMessage(id: string): ChatMessage {
        return findLast(this.messages, it => it.id === id) ?? null;
    }

    /** The spec for a tool, by name, or null. */
    getToolSpec(name: string): ChatToolSpec {
        return this.tools.find(it => it.name === name) ?? null;
    }

    //------------------
    // Implementation
    //------------------
    private readonly onTurnComplete: (message: ChatMessage) => void;
    private readonly modelTools: ChatToolSpec[];
    private readonly textTransform: ChatTextTransform;
    private readonly trackOptions: ChatTrackOptions;

    @observable private accessor _threadId: string;
    @observableRef private accessor feedbackSubmitter: ChatFeedbackSubmitter = null;
    @observableRef private accessor sendBlockers: Array<() => string>;
    private threadCreator: ChatThreadCreator = null;

    // Undo functions of each reply's tool calls, newest first, keyed by message id.
    @observableRef private accessor undoStacks: Record<string, ChatToolUndo[]> = {};
    @observable private accessor isUndoing: boolean = false;

    // True until the first run of a new thread, whose server may report its own id for it.
    private isThreadIdProvisional: boolean;

    // Current turn - running or paused. Not observable, so it can guard against a second send in
    // the same tick, before any MobX state could change.
    private turn: ChatTurn = null;

    private get isTurnRunning(): boolean {
        return !!this.turn?.isRunning;
    }

    private isCurrent(turn: ChatTurn): boolean {
        return this.turn === turn;
    }

    private isInteractive(call: ChatToolCallPart): boolean {
        const spec = this.getToolSpec(call.toolName);
        return !!spec?.interactive && !spec.execute;
    }

    /** True for a call that a paused turn waits on - for approval, or for the user's result. */
    private isWaitingToolCall(call: ChatToolCallPart): boolean {
        return (
            !call.providerExecuted &&
            (call.state === 'approval-requested' ||
                (call.state === 'input-available' && this.isInteractive(call)))
        );
    }

    /**
     * Start a turn on the history built by `getHistory`, run once the previous turn - if paused -
     * is closed.
     */
    private async runNewTurnAsync(
        trigger: ChatRunTrigger,
        getHistory: () => ChatMessage[],
        replacedMessageId: string = null
    ) {
        const turn = this.startTurn(trigger, getHistory, replacedMessageId);
        await this.runTurnAsync(turn, false);
    }

    private async resumeTurnAsync(turn: ChatTurn) {
        if (this.hasWaitingToolCalls(turn)) return;
        await this.runTurnAsync(turn, true);
    }

    /** Run a turn's steps until it ends or pauses. A resumed turn starts with its tool calls. */
    private async runTurnAsync(turn: ChatTurn, isResume: boolean) {
        turn.isRunning = true;
        if (isResume) this.markResumed(turn);

        try {
            if (!isResume) {
                await this.createThreadAsync(turn);
                if (!this.isCurrent(turn)) return;
                await this.runStepAsync(turn);
            }

            while (this.isCurrent(turn)) {
                const {status, error, metadata} = this.getTurnMessage(turn);
                // An error the backend reported in the stream - or a stream that ended early - is
                // conversation state, shown with Retry, not an exception to report.
                if (status === 'error') {
                    const runError = new ChatRunError(
                        error,
                        metadata.errorCode ?? null,
                        metadata.retryAfterSeconds ?? null
                    );
                    this.logWarn('Turn failed', runError);
                    this.endTurn(turn, 'error', runError);
                    return;
                }

                const outcome = await this.runToolCallsAsync(turn);
                if (!this.isCurrent(turn)) return;

                if (outcome === 'paused') {
                    this.pauseTurn(turn);
                    return;
                }
                if (outcome === 'done') {
                    this.endTurn(turn, 'complete');
                    return;
                }
                if (turn.step + 1 >= this.maxSteps) {
                    this.logWarn(`Turn ended at the limit of ${this.maxSteps} steps.`);
                    this.updateTurnMessage(turn, message =>
                        message.withChanges({
                            metadata: {...message.metadata, finishReason: 'max-steps'}
                        })
                    );
                    this.endTurn(turn, 'complete');
                    return;
                }

                turn.step++;
                await this.runStepAsync(turn);
            }
        } catch (e) {
            if (!this.isCurrent(turn)) return;
            // Hoist's handler logs a routine exception - such as a rate limit - quietly, and
            // reports the rest as client errors. The chat shows the error itself.
            if (!isAbortError(e)) XH.handleException(e, {showAlert: false});
            this.endTurn(turn, 'error', e);
        }
    }

    /** Create a new thread on the backend, if a creator is set, and adopt the id it returns. */
    private async createThreadAsync(turn: ChatTurn) {
        const {threadCreator} = this;
        if (!threadCreator || !this.isThreadIdProvisional) return;

        const spec = {threadId: this.threadId, userMessage: this.getMessage(turn.turnId)},
            threadId = await raceAbort(
                Promise.resolve(threadCreator(spec)),
                turn.abortController.signal
            );
        if (this.isCurrent(turn) && threadId != null) this.adoptThreadId(threadId);
    }

    /** Run the context providers for a step, in order, skipping any that return null. */
    private async getContextAsync(request: ChatRunRequest): Promise<ChatRunContext[]> {
        const {contextProviders} = this,
            values = await raceAbort(
                Promise.all(contextProviders.map(it => it.getContext(request))),
                request.signal
            );
        return compact(
            contextProviders.map(({name, description}, idx) =>
                values[idx] != null
                    ? {name, description: description ?? null, value: values[idx]}
                    : null
            )
        );
    }

    /** Make one step - one model call - streaming its events into the turn's message. */
    private async runStepAsync(turn: ChatTurn) {
        const {step, turnId} = turn,
            isFirstStep = step === 0,
            request: ChatRunRequest = {
                threadId: this.threadId,
                runId: genChatId(),
                historyMode: this.historyMode,
                trigger: isFirstStep ? turn.trigger : 'continue',
                turnId,
                stepIndex: step,
                messages: this.messages,
                newMessages: [this.getMessage(isFirstStep ? turnId : turn.messageId)],
                replacedMessageId: turn.replacedMessageId,
                runOptions: turn.runOptions,
                catalogVersion: this.catalog?.version ?? null,
                tools: this.modelTools,
                context: [],
                signal: turn.abortController.signal
            };
        if (!isEmpty(this.contextProviders)) {
            request.context = await this.getContextAsync(request);
            if (!this.isCurrent(turn)) return;
        }

        turn.reducer = new ChatStreamReducer(step, {textTransform: this.textTransform});
        turn.request = request;

        try {
            // Batch events, so a fast stream re-renders at most once per STREAM_FLUSH_MS.
            for await (const event of this.transport.run(request)) {
                if (!this.isCurrent(turn)) return;
                turn.pendingEvents.push(event);
                if (event.type === 'RUN_ERROR') break;
                turn.flushTimer ??= setTimeout(() => this.flush(turn), STREAM_FLUSH_MS);
            }
        } finally {
            turn.request = null;
        }

        if (!this.isCurrent(turn)) return;
        this.flush(turn);
        this.updateTurnMessage(turn, message => turn.reducer.finish(message));
    }

    /**
     * Resolve the client tool calls of the turn's current step: fail calls that nothing will
     * answer, ask for approval where required, then run the rest in order.
     *
     * @returns 'done' if the step made no client tool calls, 'paused' if calls wait on the user,
     *      else 'continue' - the results go back to the model in another step.
     */
    private async runToolCallsAsync(turn: ChatTurn): Promise<'done' | 'paused' | 'continue'> {
        const calls = getClientToolCalls(this.getTurnMessage(turn), turn.step);
        if (isEmpty(calls)) return 'done';

        calls.forEach(call => {
            if (call.state !== 'input-available') return;
            const spec = this.getToolSpec(call.toolName);
            if (!spec) {
                this.updateToolCall(turn, call.id, {
                    state: 'output-error',
                    errorText: `No handler for tool '${call.toolName}'.`
                });
            } else if (spec.execute) {
                if (!turn.approvedIds.has(call.id) && needsApproval(spec, call)) {
                    this.updateToolCall(turn, call.id, {state: 'approval-requested'});
                }
            } else if (!spec.interactive) {
                this.updateToolCall(turn, call.id, {
                    state: 'output-error',
                    errorText: `No result for tool '${call.toolName}' - the backend runs it, and sent none.`
                });
            }
        });
        if (this.hasWaitingToolCalls(turn)) return 'paused';

        for (const call of getClientToolCalls(this.getTurnMessage(turn), turn.step)) {
            if (call.state === 'input-available') await this.executeToolAsync(turn, call);
            if (!this.isCurrent(turn)) break;
        }
        return 'continue';
    }

    private async executeToolAsync(turn: ChatTurn, call: ChatToolCallPart) {
        const {execute} = this.getToolSpec(call.toolName),
            {signal} = turn.abortController,
            context = {chatModel: this, toolCallId: call.id, signal};

        this.updateToolCall(turn, call.id, {state: 'running'});
        try {
            const pending = Promise.resolve(execute(call.input ?? {}, context));
            // Keep the undo even if the turn stops first, as the tool's change may still land.
            pending.then(result => {
                if (result instanceof ChatToolResult && result.undo) {
                    this.addUndo(turn.messageId, result.undo);
                }
            }, noop);

            // Race the abort, so that stop() ends the turn even if the tool ignores the signal.
            const result = await raceAbort(pending, signal),
                output = result instanceof ChatToolResult ? result.output : result;
            if (this.isCurrent(turn)) {
                if (result instanceof ChatToolResult && result.artifacts) {
                    this.recordArtifacts(turn, result.artifacts);
                }
                this.updateToolCall(turn, call.id, {
                    state: 'output-available',
                    output: output ?? null
                });
            }
        } catch (e) {
            if (this.isCurrent(turn)) {
                this.logWarn(`Tool '${call.toolName}' failed`, e);
                this.updateToolCall(turn, call.id, {
                    state: 'output-error',
                    errorText: errorText(e)
                });
            }
        }
    }

    /** True if any tool call in the turn's current step waits for the user. */
    private hasWaitingToolCalls(turn: ChatTurn): boolean {
        return getClientToolCalls(this.getTurnMessage(turn), turn.step).some(it =>
            this.isWaitingToolCall(it)
        );
    }

    /**
     * The paused turn holding the given tool call, if the call is in the expected state. Restores
     * the turn of a paused message loaded with the history.
     */
    private getPausedTurn(
        toolCallId: string,
        isExpected: (call: ChatToolCallPart) => boolean
    ): ChatTurn {
        const call = this.lastMessage?.toolCalls.find(it => it.id === toolCallId),
            turn = !this.isTurnRunning && call && isExpected(call) ? this.getOrRestoreTurn() : null;

        if (!turn) {
            this.logWarn(`Tool call ignored - '${toolCallId}' is not waiting for the user.`);
        }
        return turn;
    }

    /** The current turn, or one rebuilt for a paused message at the end of the history. */
    private getOrRestoreTurn(): ChatTurn {
        if (this.turn) return this.turn;

        const {lastMessage, messages} = this;
        if (lastMessage?.status !== 'paused') return null;

        const userMessage = findLast(messages, it => it.isUser) ?? null;
        this.turn = createTurn(lastMessage, maxBy(lastMessage.parts, 'step')?.step ?? 0, false, {
            trigger: 'continue',
            turnId: userMessage?.id ?? null,
            replacedMessageId: null,
            runOptions: this.getTurnRunOptions(userMessage)
        });
        return this.turn;
    }

    /** End a paused turn because the user moved on. Its waiting tool calls are closed. */
    private closePausedTurn() {
        const turn = this.getOrRestoreTurn();
        if (turn) this.endTurn(turn, 'complete');
    }

    /**
     * End the current turn early. A stop cancels a step in flight. In server mode, any other
     * reason leaves a step in flight to finish on the server, and marks its message detached.
     */
    private abortTurn(reason: ChatAbortReason) {
        const {turn} = this;
        if (!turn) return;

        // Apply events already received, so the run ref holds any server ids they reported.
        this.flush(turn);
        const run = reason === 'stop' ? this.getRunRef(turn) : null,
            detached = reason !== 'stop' && !!turn.request && this.historyMode === 'server';

        turn.abortController.abort(new ChatAbortError(reason));
        this.endTurn(turn, 'aborted', null, detached);
        if (run) this.cancelRun(run);
    }

    /** The run of the step in flight, or null if no step is in flight. */
    private getRunRef(turn: ChatTurn): ChatRunRef {
        const {request, reducer, turnId} = turn;
        if (!request) return null;
        return {threadId: this.threadId, runId: reducer.runId ?? request.runId, turnId, request};
    }

    private cancelRun(run: ChatRunRef) {
        const {transport} = this;
        if (!transport.cancelAsync) return;
        // A promise of its own, so that a cancel which throws at once is logged the same way.
        new Promise(resolve => resolve(transport.cancelAsync(run))).catch(e =>
            this.logWarn('Failed to cancel the run', run.runId, e)
        );
    }

    private endTurn(
        turn: ChatTurn,
        status: 'complete' | 'error' | 'aborted',
        error: any = null,
        detached: boolean = false
    ) {
        this.flush(turn);
        if (error && !(error instanceof Error)) error = new Error(String(error));

        const message = this.settleTurn(turn, status, error, detached);
        if (!message) return;
        this.trackTurn(turn, message);
        try {
            this.onTurnComplete?.(message);
        } catch (e) {
            this.logError('Error in onTurnComplete', e);
        }
    }

    private trackTurn(turn: ChatTurn, message: ChatMessage) {
        const {toolCalls, metadata, status} = message;
        this.trackActivity(
            TURN_TRACK_MESSAGES[status],
            {
                elapsedMs: metadata.elapsedMs,
                steps: turn.step + 1,
                toolCalls: toolCalls.length,
                toolErrors: toolCalls.filter(it => it.state === 'output-error').length,
                finishReason: metadata.finishReason ?? null,
                errorCode: metadata.errorCode ?? null,
                threadId: this.threadId,
                runId: metadata.runId ?? null,
                historyMode: this.historyMode
            },
            metadata.elapsedMs
        );
    }

    private trackActivity(message: string, data: PlainObject, elapsed?: number) {
        const {trackOptions} = this;
        if (!trackOptions) return;
        XH.track({category: 'Chat', ...trackOptions, message, data, elapsed});
    }

    //------------------------
    // Observable state changes
    //------------------------
    @action
    private replaceThread(specs: ChatMessageSpec[], threadId: string, reason: ChatAbortReason) {
        this.abortTurn(reason);
        this._threadId = threadId ?? genChatId();
        this.isThreadIdProvisional = threadId == null;
        this.messages = restoreMessages(specs);
        this.artifacts.clear();
        this.addArtifactsOf(this.messages);
        this.undoStacks = {};
        this.hasOlderMessages = false;
        this.status = 'ready';
        this.lastError = null;
    }

    /** Close any paused turn, then start a new one on the history from `getHistory`. */
    @action
    private startTurn(
        trigger: ChatRunTrigger,
        getHistory: () => ChatMessage[],
        replacedMessageId: string
    ): ChatTurn {
        this.closePausedTurn();

        const history = getHistory(),
            userMessage = findLast(history, it => it.isUser),
            message = new ChatMessage({role: 'assistant', status: 'pending'}),
            turn = createTurn(message, 0, true, {
                trigger,
                turnId: userMessage.id,
                replacedMessageId,
                runOptions: this.getTurnRunOptions(userMessage)
            });
        this.turn = turn;
        this.messages = [...history, message];
        // Replies discarded by a retry, regenerate or edit take their undo functions with them.
        this.undoStacks = pick(
            this.undoStacks,
            history.map(it => it.id)
        );
        this.status = 'submitted';
        this.lastError = null;
        return turn;
    }

    @action
    private markResumed(turn: ChatTurn) {
        turn.runningSince = Date.now();
        this.status = 'streaming';
        this.updateTurnMessage(turn, message =>
            message.status === 'streaming' ? message : message.withChanges({status: 'streaming'})
        );
    }

    @action
    private pauseTurn(turn: ChatTurn) {
        turn.isRunning = false;
        this.status = 'ready';
        // Time spent waiting for the user is not time taken by the reply.
        const elapsedMs = stopTurnClock(turn);
        this.updateTurnMessage(turn, message =>
            settleStreamingParts(message).withChanges({
                status: 'paused',
                metadata: {...message.metadata, elapsedMs}
            })
        );
    }

    @action
    private settleTurn(
        turn: ChatTurn,
        status: 'complete' | 'error' | 'aborted',
        error: Error,
        detached: boolean
    ): ChatMessage {
        clearTimeout(turn.flushTimer);
        this.turn = null;
        this.status = status === 'error' ? 'error' : 'ready';
        this.lastError = error;

        let message = this.getTurnMessage(turn);
        if (!message) return null;

        // A turn that ends before its stream does gives the text transform its final call.
        if (turn.reducer) message = turn.reducer.settleText(message);
        const metadata: PlainObject = {...message.metadata, elapsedMs: stopTurnClock(turn)};
        if (detached) metadata.detached = true;
        // Stored with the reply, so that its UI can migrate once the catalog changes.
        if (this.showsCatalogUi(message)) metadata.catalogVersion = this.catalog.version;

        const settled = settleOpenParts(message, SETTLE_REASONS[status]).withChanges({
            status,
            error: error ? errorText(error) : null,
            metadata
        });
        this.replaceMessage(settled);
        return settled;
    }

    @action
    private flush(turn: ChatTurn) {
        clearTimeout(turn.flushTimer);
        turn.flushTimer = null;

        const events = turn.pendingEvents;
        if (isEmpty(events) || !this.isCurrent(turn)) return;
        turn.pendingEvents = [];

        const message = turn.reducer.apply(this.getTurnMessage(turn), events);
        this.replaceMessage(message);
        this.addArtifactsOf([message]);
        this.applyServerIds(turn);
        if (message.status === 'streaming' && this.status === 'submitted') {
            this.status = 'streaming';
        }
    }

    /** Adopt a new thread's server id, and record the server id of the turn's user message. */
    private applyServerIds(turn: ChatTurn) {
        const {runThreadId, userServerId} = turn.reducer;
        if (this.historyMode === 'server' && this.isThreadIdProvisional && runThreadId != null) {
            this.adoptThreadId(runThreadId);
        }

        const userMessage = userServerId != null ? this.getMessage(turn.turnId) : null;
        if (userMessage && userMessage.metadata.serverId !== userServerId) {
            this.replaceMessage(
                userMessage.withChanges({
                    metadata: {...userMessage.metadata, serverId: userServerId}
                })
            );
        }
    }

    /** Replace a new thread's provisional id with the backend's, which is then fixed. */
    @action
    private adoptThreadId(threadId: string) {
        this.isThreadIdProvisional = false;
        if (threadId !== this.threadId) {
            this.logDebug('Adopted the server thread id', threadId);
            this._threadId = threadId;
        }
    }

    /** Record artifacts that a client tool produced on the turn's reply, and in the registry. */
    @action
    private recordArtifacts(turn: ChatTurn, artifacts: ChatArtifact[]) {
        this.updateTurnMessage(turn, message => {
            const current = message.metadata.artifacts,
                merged = mergeArtifacts(current, artifacts);
            return merged === current || isEmpty(merged)
                ? message
                : message.withChanges({metadata: {...message.metadata, artifacts: merged}});
        });
        const message = this.getTurnMessage(turn);
        if (message) this.addArtifactsOf([message]);
    }

    /** Add the artifacts recorded on messages to the registry, skipping those it holds already. */
    private addArtifactsOf(messages: ChatMessage[]) {
        const added = messages
            .flatMap(it => (isArray(it.metadata.artifacts) ? it.metadata.artifacts : []))
            .filter(it => isChatArtifact(it) && this.artifacts.get(it.id) !== it);
        if (!isEmpty(added)) this.artifacts.add(added);
    }

    /** True if a message shows UI from the chat's catalog - a call to its tools, a tag or a document. */
    private showsCatalogUi(message: ChatMessage): boolean {
        const {catalog} = this;
        if (!catalog) return false;

        return message.parts.some(part => {
            switch (part.type) {
                case 'toolCall':
                    return catalog.displayTools.some(it => it.name === part.toolName);
                case 'data':
                    return part.dataType === CHAT_UI_DOCUMENT_DATA_TYPE;
                case 'text':
                    return catalog.parseTags(part.text).some(it => it.type !== 'markdown');
                default:
                    return false;
            }
        });
    }

    @action
    private addUndo(messageId: string, undo: ChatToolUndo) {
        if (!this.getMessage(messageId)) return;
        this.setUndoStack(messageId, [undo, ...(this.undoStacks[messageId] ?? [])]);
    }

    @action
    private setUndoStack(messageId: string, undos: ChatToolUndo[]) {
        this.undoStacks = {...this.undoStacks, [messageId]: undos};
    }

    @action
    private setUndoing(isUndoing: boolean) {
        this.isUndoing = isUndoing;
    }

    @action
    private markUndone(messageId: string) {
        this.undoStacks = omit(this.undoStacks, messageId);
        const message = this.getMessage(messageId);
        if (message) {
            this.replaceMessage(
                message.withChanges({metadata: {...message.metadata, undone: true}})
            );
        }
    }

    @action
    private setFeedback(messageId: string, feedback: ChatFeedback) {
        const message = this.getMessage(messageId);
        if (!message) return;
        const {metadata} = message;
        this.replaceMessage(
            message.withChanges({
                metadata: feedback ? {...metadata, feedback} : omit(metadata, 'feedback')
            })
        );
    }

    @action
    private updateToolCall(turn: ChatTurn, toolCallId: string, changes: Partial<ChatToolCallPart>) {
        this.updateTurnMessage(turn, message => updatePart(message, toolCallId, changes));
    }

    @action
    private updateTurnMessage(turn: ChatTurn, fn: (message: ChatMessage) => ChatMessage) {
        const message = this.getTurnMessage(turn);
        if (message) this.replaceMessage(fn(message));
    }

    private replaceMessage(message: ChatMessage) {
        const idx = findLastIndex(this.messages, it => it.id === message.id);
        if (idx === -1 || this.messages[idx] === message) return;

        const messages = [...this.messages];
        messages[idx] = message;
        this.messages = messages;
    }

    private getTurnMessage(turn: ChatTurn): ChatMessage {
        return this.getMessage(turn.messageId);
    }

    /** The options a turn runs with - those recorded on its user message, or the current ones. */
    private getTurnRunOptions(userMessage: ChatMessage): PlainObject {
        return userMessage?.metadata.runOptions ?? cloneDeep(this.runOptions) ?? null;
    }
}

//------------------
// Implementation
//------------------
/** Longest wait before streamed events are applied to the message. */
const STREAM_FLUSH_MS = 32;

/** Activity tracking message for a finished turn, by how it ended. */
const TURN_TRACK_MESSAGES = {
    complete: 'Turn complete',
    error: 'Turn failed',
    aborted: 'Turn stopped'
};

/** Error text for tool calls left unfinished when a turn ends, by how it ended. */
const SETTLE_REASONS = {
    complete: 'No result - the conversation moved on.',
    aborted: 'Stopped by the user.',
    error: 'Not completed - the turn failed.',
    interrupted: 'Not completed - the response was interrupted.'
};

/** State of one assistant turn, from its first step to its last. */
interface ChatTurn {
    /** The assistant message the turn builds. */
    messageId: string;

    /** Id of the user message the turn answers - see `ChatRunRequest.turnId`. */
    turnId: string;

    /** What started the turn. Steps after the first are sent as `continue`. */
    trigger: ChatRunTrigger;

    /** The assistant message the turn replaces, for a retry or regenerate. */
    replacedMessageId: string;

    /** Copy of the run options the turn was sent with. */
    runOptions: PlainObject;

    /** Request of the step in flight, or null between steps. */
    request: ChatRunRequest;

    /** Index of the current step. */
    step: number;

    /**
     * Time the turn has run, in milliseconds, up to `runningSince`. Excludes time paused for the
     * user, so that it measures the reply alone.
     */
    activeMs: number;

    /** When the turn last started or resumed running, or null while paused. */
    runningSince: number;

    abortController: AbortController;

    /** False while paused for the user. */
    isRunning: boolean;

    /** Tool calls the user has approved, which must not be sent for approval again. */
    approvedIds: Set<string>;

    reducer: ChatStreamReducer;
    pendingEvents: ChatEvent[];
    flushTimer: ReturnType<typeof setTimeout>;
}

function createTurn(
    message: ChatMessage,
    step: number,
    isRunning: boolean,
    context: Pick<ChatTurn, 'turnId' | 'trigger' | 'replacedMessageId' | 'runOptions'>
): ChatTurn {
    return {
        ...context,
        messageId: message.id,
        request: null,
        step,
        // A turn restored while paused resumes from the time recorded when it paused.
        activeMs: isRunning ? 0 : (message.metadata?.elapsedMs ?? 0),
        runningSince: isRunning ? message.createdAt : null,
        abortController: new AbortController(),
        isRunning,
        approvedIds: new Set(),
        reducer: null,
        pendingEvents: [],
        flushTimer: null
    };
}

/** Stop the clock of a turn, and return the time it has run. */
function stopTurnClock(turn: ChatTurn): number {
    if (turn.runningSince != null) {
        turn.activeMs += Date.now() - turn.runningSince;
        turn.runningSince = null;
    }
    return turn.activeMs;
}

/**
 * Messages from stored specs, with anything left in progress closed - see `loadMessages`.
 *
 * @param isLatest - true if the specs end the conversation, so a paused turn at their end stays
 *      paused. False for older history, which closes it.
 */
function restoreMessages(specs: ChatMessageSpec[], isLatest: boolean = true): ChatMessage[] {
    const messages = specs.map(it => new ChatMessage(it)),
        lastIdx = messages.length - 1;

    return messages.map((message, idx) => {
        switch (message.status) {
            case 'paused':
                return isLatest && idx === lastIdx && message.isAssistant
                    ? settleStreamingParts(message)
                    : settleOpenParts(message, SETTLE_REASONS.complete).withChanges({
                          status: 'complete'
                      });
            case 'pending':
            case 'streaming':
                return settleOpenParts(message, SETTLE_REASONS.interrupted).withChanges({
                    status: 'aborted'
                });
            default:
                return settleOpenParts(message, SETTLE_REASONS.interrupted);
        }
    });
}

/** The tools a catalog adds to a chat - see {@link ChatModelConfig.catalog}. */
function getCatalogTools(catalog: ChatUiCatalog, historyMode: ChatHistoryMode): ChatToolSpec[] {
    if (!catalog) return [];
    if (historyMode === 'server') return catalog.displayTools;

    const {modes} = catalog;
    return [
        ...(modes.includes('tools') ? catalog.tools : []),
        ...(modes.includes('document') ? [catalog.documentTool] : [])
    ];
}

function needsApproval(spec: ChatToolSpec, call: ChatToolCallPart): boolean {
    const {needsApproval} = spec;
    return isFunction(needsApproval) ? needsApproval(call.input ?? {}) : !!needsApproval;
}

function errorText(e: any): string {
    return e?.message ?? String(e);
}
