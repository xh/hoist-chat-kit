import type {PlainObject} from '@xh/hoist/core';
import {HoistModel, managed, XH} from '@xh/hoist/core';
import {action, computed, observable, observableRef} from '@xh/hoist/mobx';
import {throwIf} from '@xh/hoist/utils/js';
import {findLast, findLastIndex, isEmpty, isFunction, isString, maxBy} from 'lodash';
import type {ReactNode} from 'react';
import type {ChatEvent, ChatRunRequest, ChatTransport} from '../transport';
import {ChatComposerModel, type ChatComposerConfig} from './ChatComposerModel';
import {ChatMessage, type ChatMessageSpec} from './ChatMessage';
import type {ChatDataPart, ChatFilePart, ChatPart, ChatToolCallPart} from './ChatPart';
import {ChatRunError} from './ChatRunError';
import type {ChatToolSpec} from './ChatToolSpec';
import {isAbortError, raceAbort} from './impl/abort';
import {ChatStreamReducer} from './impl/ChatStreamReducer';
import {genChatId} from './impl/ids';
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
     * Maximum steps - model calls - in one assistant turn. Each round of client tool calls takes
     * one more. Default 10.
     */
    maxSteps?: number;

    /**
     * Messages to start with, such as a greeting or restored history. Messages left in progress
     * are closed, as with {@link ChatModel.loadMessages}.
     */
    initialMessages?: ChatMessageSpec[];

    /** Identifies the conversation to the backend. Default a new UUID. */
    threadId?: string;

    /** Config for the managed {@link ChatComposerModel}. */
    composer?: ChatComposerConfig;

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

/** Renders a {@link ChatDataPart}. */
export type ChatDataRenderer = (part: ChatDataPart, message: ChatMessage) => ReactNode;

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

    /** Tools the model may call, and display config for tools the backend runs. */
    readonly tools: ChatToolSpec[];

    /** Maximum steps - model calls - in one assistant turn. */
    readonly maxSteps: number;

    /** Renderers for data parts, keyed by `dataType`. */
    readonly dataRenderers: Record<string, ChatDataRenderer>;

    /** Draft text and attachments for the next message. */
    @managed readonly composerModel: ChatComposerModel;

    //-----------------------
    // Observable State
    //-----------------------
    /**
     * Identifies the conversation to the backend. A new id is generated by `clear`, and by
     * `loadMessages` unless it is given one. (observable)
     */
    @observable accessor threadId: string;

    /** Conversation history, oldest first. Replaced, never mutated, on change. (observable) */
    @observableRef accessor messages: ChatMessage[] = [];

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

    /** True if the conversation has no messages. */
    @computed
    get isEmpty(): boolean {
        return this.messages.length === 0;
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

    constructor(config: ChatModelConfig) {
        super();
        const {
            transport,
            tools = [],
            maxSteps = 10,
            initialMessages = [],
            threadId,
            composer,
            dataRenderers = {},
            onTurnComplete
        } = config;
        throwIf(!transport, 'ChatModel requires a transport.');
        throwIf(!(maxSteps >= 1), 'ChatModel maxSteps must be at least 1.');

        this.transport = transport;
        this.tools = tools;
        this.maxSteps = maxSteps;
        this.threadId = threadId ?? genChatId();
        this.dataRenderers = dataRenderers;
        this.onTurnComplete = onTurnComplete;
        this.modelTools = tools.filter(
            it => it.sendToModel ?? (it.execute != null || !!it.interactive)
        );
        this.messages = restoreMessages(initialMessages);
        this.composerModel = new ChatComposerModel({...composer, chatModel: this});
    }

    override destroy() {
        const {turn} = this;
        if (turn) {
            turn.abortController.abort();
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
     * Defaults to the composer's draft, which is then cleared. Does nothing while busy, or if
     * there is no text or file to send.
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

        const message = new ChatMessage({role: 'user', parts, metadata: spec.metadata});
        await this.runNewTurnAsync(() => {
            if (fromComposer) composerModel.clear();
            return [...this.messages, message];
        });
    }

    /**
     * Stop the current turn, running or paused. Content received so far is kept, with status
     * 'aborted'.
     */
    stop() {
        const {turn} = this;
        if (!turn) return;
        turn.abortController.abort();
        this.endTurn(turn, 'aborted');
    }

    /**
     * Re-run the last user message, replacing everything after it - typically the reply that
     * failed. See `onTurnComplete` for a turn this closes.
     */
    async retryAsync(): Promise<void> {
        if (this.isTurnRunning) return;

        const idx = findLastIndex(this.messages, it => it.isUser);
        if (idx === -1) return;
        await this.runNewTurnAsync(() => this.messages.slice(0, idx + 1));
    }

    /**
     * Replace an assistant reply with a new one, discarding any later messages. Ignored for a
     * reply with no user message before it, such as a greeting.
     *
     * @param messageId - default the last assistant message.
     */
    async regenerateAsync(messageId?: string): Promise<void> {
        if (this.isTurnRunning) return;

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
        await this.runNewTurnAsync(() => this.messages.slice(0, idx));
    }

    /**
     * Change the text of a user message and re-run from it, discarding later messages. Files
     * attached to the message are kept.
     */
    async editMessageAsync(messageId: string, text: string): Promise<void> {
        if (this.isTurnRunning) return;

        const idx = findLastIndex(this.messages, it => it.id === messageId),
            message = this.messages[idx];
        if (!message?.isUser) {
            this.logWarn('Edit ignored - no such user message.', messageId);
            return;
        }

        const parts: ChatPart[] = message.parts.filter(it => it.type !== 'text');
        if (text?.trim()) parts.push(createTextPart(text.trim()));
        if (isEmpty(parts)) return;
        await this.runNewTurnAsync(() => [
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

    /** Remove all messages and start a new thread. Stops any turn in progress. */
    clear() {
        this.loadMessages([]);
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
     * @param threadId - id of the loaded conversation, to send to the backend. Default a new id.
     */
    @action
    loadMessages(specs: ChatMessageSpec[], threadId?: string) {
        this.stop();
        this.threadId = threadId ?? genChatId();
        this.messages = restoreMessages(specs);
        this.status = 'ready';
        this.lastError = null;
    }

    /** The conversation as plain objects, for storage. */
    getMessageSpecs(): ChatMessageSpec[] {
        return this.messages.map(it => it.toSpec());
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
    private async runNewTurnAsync(getHistory: () => ChatMessage[]) {
        const turn = this.startTurn(getHistory);
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
            if (!isResume) await this.runStepAsync(turn);

            while (this.isCurrent(turn)) {
                const {status, error, metadata} = this.getTurnMessage(turn);
                if (status === 'error') {
                    const runError = new ChatRunError(error, metadata.errorCode ?? null);
                    this.logError('Turn failed', runError);
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
            if (!isAbortError(e)) XH.handleException(e, {showAlert: false});
            this.endTurn(turn, 'error', e);
        }
    }

    /** Make one step - one model call - streaming its events into the turn's message. */
    private async runStepAsync(turn: ChatTurn) {
        turn.reducer = new ChatStreamReducer(turn.step);
        const request: ChatRunRequest = {
            threadId: this.threadId,
            runId: genChatId(),
            messages: this.messages,
            tools: this.modelTools,
            signal: turn.abortController.signal
        };

        // Batch events, so a fast stream re-renders at most once per STREAM_FLUSH_MS.
        for await (const event of this.transport.run(request)) {
            if (!this.isCurrent(turn)) return;
            turn.pendingEvents.push(event);
            if (event.type === 'RUN_ERROR') break;
            turn.flushTimer ??= setTimeout(() => this.flush(turn), STREAM_FLUSH_MS);
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
            // Race the abort, so that stop() ends the turn even if the tool ignores the signal.
            const output = await raceAbort(
                Promise.resolve(execute(call.input ?? {}, context)),
                signal
            );
            if (this.isCurrent(turn)) {
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

        const {lastMessage} = this;
        if (lastMessage?.status !== 'paused') return null;

        this.turn = createTurn(lastMessage, maxBy(lastMessage.parts, 'step')?.step ?? 0, false);
        return this.turn;
    }

    /** End a paused turn because the user moved on. Its waiting tool calls are closed. */
    private closePausedTurn() {
        const turn = this.getOrRestoreTurn();
        if (turn) this.endTurn(turn, 'complete');
    }

    private endTurn(turn: ChatTurn, status: 'complete' | 'error' | 'aborted', error: any = null) {
        this.flush(turn);
        if (error && !(error instanceof Error)) error = new Error(String(error));

        const message = this.settleTurn(turn, status, error);
        if (!message) return;
        try {
            this.onTurnComplete?.(message);
        } catch (e) {
            this.logError('Error in onTurnComplete', e);
        }
    }

    //------------------------
    // Observable state changes
    //------------------------
    /** Close any paused turn, then start a new one on the history from `getHistory`. */
    @action
    private startTurn(getHistory: () => ChatMessage[]): ChatTurn {
        this.closePausedTurn();

        const message = new ChatMessage({role: 'assistant', status: 'pending'}),
            turn = createTurn(message, 0, true);
        this.turn = turn;
        this.messages = [...getHistory(), message];
        this.status = 'submitted';
        this.lastError = null;
        return turn;
    }

    @action
    private markResumed(turn: ChatTurn) {
        this.status = 'streaming';
        this.updateTurnMessage(turn, message =>
            message.status === 'streaming' ? message : message.withChanges({status: 'streaming'})
        );
    }

    @action
    private pauseTurn(turn: ChatTurn) {
        turn.isRunning = false;
        this.status = 'ready';
        this.updateTurnMessage(turn, message =>
            settleStreamingParts(message).withChanges({status: 'paused'})
        );
    }

    @action
    private settleTurn(
        turn: ChatTurn,
        status: 'complete' | 'error' | 'aborted',
        error: Error
    ): ChatMessage {
        clearTimeout(turn.flushTimer);
        this.turn = null;
        this.status = status === 'error' ? 'error' : 'ready';
        this.lastError = error;

        const message = this.getTurnMessage(turn);
        if (!message) return null;

        const settled = settleOpenParts(message, SETTLE_REASONS[status]).withChanges({
            status,
            error: error ? errorText(error) : null,
            metadata: {...message.metadata, elapsedMs: Date.now() - turn.startedAt}
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
        if (message.status === 'streaming' && this.status === 'submitted') {
            this.status = 'streaming';
        }
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
        return findLast(this.messages, it => it.id === turn.messageId) ?? null;
    }
}

//------------------
// Implementation
//------------------
/** Longest wait before streamed events are applied to the message. */
const STREAM_FLUSH_MS = 32;

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

    /** Index of the current step. */
    step: number;

    startedAt: number;
    abortController: AbortController;

    /** False while paused for the user. */
    isRunning: boolean;

    /** Tool calls the user has approved, which must not be sent for approval again. */
    approvedIds: Set<string>;

    reducer: ChatStreamReducer;
    pendingEvents: ChatEvent[];
    flushTimer: ReturnType<typeof setTimeout>;
}

function createTurn(message: ChatMessage, step: number, isRunning: boolean): ChatTurn {
    return {
        messageId: message.id,
        step,
        startedAt: message.createdAt,
        abortController: new AbortController(),
        isRunning,
        approvedIds: new Set(),
        reducer: null,
        pendingEvents: [],
        flushTimer: null
    };
}

/** Messages from stored specs, with anything left in progress closed - see `loadMessages`. */
function restoreMessages(specs: ChatMessageSpec[]): ChatMessage[] {
    const messages = specs.map(it => new ChatMessage(it)),
        lastIdx = messages.length - 1;

    return messages.map((message, idx) => {
        switch (message.status) {
            case 'paused':
                return idx === lastIdx && message.isAssistant
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

function needsApproval(spec: ChatToolSpec, call: ChatToolCallPart): boolean {
    const {needsApproval} = spec;
    return isFunction(needsApproval) ? needsApproval(call.input ?? {}) : !!needsApproval;
}

function errorText(e: any): string {
    return e?.message ?? String(e);
}
