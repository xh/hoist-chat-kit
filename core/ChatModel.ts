import type {PlainObject} from '@xh/hoist/core';
import {HoistModel, managed} from '@xh/hoist/core';
import {action, computed, observable, observableRef} from '@xh/hoist/mobx';
import {findLast, findLastIndex, isEmpty, isFunction, isString, maxBy} from 'lodash';
import type {ReactNode} from 'react';
import type {ChatEvent, ChatRunRequest, ChatTransport} from '../transport';
import {ChatComposerModel, type ChatComposerConfig} from './ChatComposerModel';
import {ChatMessage, type ChatMessageSpec} from './ChatMessage';
import type {
    ChatDataPart,
    ChatFilePart,
    ChatPart,
    ChatTextPart,
    ChatToolCallPart,
    ChatToolCallState
} from './ChatPart';
import type {ChatToolSpec} from './ChatToolSpec';
import {ChatStreamReducer} from './impl/ChatStreamReducer';
import {genChatId} from './impl/ids';
import {getClientToolCalls, settleOpenParts, updatePart} from './impl/messageUtils';

/** Configuration for a {@link ChatModel}. */
export interface ChatModelConfig {
    /** Connection to the backend that runs the model or agent. */
    transport: ChatTransport;

    /** Tools the model may call, and display config for tools the backend runs. */
    tools?: ChatToolSpec[];

    /**
     * Maximum model calls in one assistant turn. Each round of client tool calls takes one more.
     * Default 10.
     */
    maxSteps?: number;

    /** Messages to start with, such as a greeting or restored history. */
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

    /** Called when an assistant turn ends - complete, failed, or stopped. */
    onTurnComplete?: (message: ChatMessage) => void;
}

/** Renders a {@link ChatDataPart}. */
export type ChatDataRenderer = (part: ChatDataPart, message: ChatMessage) => ReactNode;

/**
 * State of the conversation.
 *
 *  - `ready` - idle, and ready for the user's next message.
 *  - `submitted` - a turn has started and no content has arrived yet.
 *  - `streaming` - content is arriving, or client tools are running.
 *  - `error` - the last turn failed. See `lastError`.
 */
export type ChatStatus = 'ready' | 'submitted' | 'streaming' | 'error';

/** A user message to send - see {@link ChatModel.sendAsync}. */
export interface ChatSendSpec {
    text?: string;
    files?: ChatFilePart[];
    metadata?: PlainObject;
}

/**
 * Model for one conversation with an LLM or agent: the message history, the status of the
 * current turn, and the run loop that streams responses and executes client tools.
 *
 * Each user message starts a turn, which builds one assistant message. A turn makes one or more
 * model calls ("steps") through the {@link ChatTransport}. When a step ends with calls to client
 * tools - those with an `execute` function - the model runs them in order and makes another call
 * with their results, up to `maxSteps`. A turn pauses, with status 'ready', while tool calls wait
 * for the user: for approval (see {@link ChatToolSpec.needsApproval}), or for a result given via
 * {@link addToolOutputAsync}. It resumes once every waiting call is answered.
 *
 * Only one turn runs at a time. Render the model with a desktop `ChatPanel`, or with the
 * lower-level message list and composer components.
 */
export class ChatModel extends HoistModel {
    declare config: ChatModelConfig;

    //-----------------------
    // Immutable Properties
    //-----------------------
    readonly transport: ChatTransport;
    readonly tools: ChatToolSpec[];
    readonly maxSteps: number;
    readonly threadId: string;
    readonly dataRenderers: Record<string, ChatDataRenderer>;

    /** Draft text and attachments for the next message. */
    @managed readonly composerModel: ChatComposerModel;

    //-----------------------
    // Observable State
    //-----------------------
    /** Conversation history, oldest first. Replaced, never mutated, on change. (observable) */
    @observableRef accessor messages: ChatMessage[] = [];

    /** State of the conversation. (observable) */
    @observable accessor status: ChatStatus = 'ready';

    /** Error from the last turn, or null. (observable) */
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

    /** Tool calls waiting for the user to approve or deny them. */
    @computed
    get pendingApprovals(): ChatToolCallPart[] {
        const {lastMessage} = this;
        return lastMessage?.isAssistant
            ? lastMessage.toolCalls.filter(it => it.state === 'approval-requested')
            : [];
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
        this.transport = transport;
        this.tools = tools;
        this.maxSteps = maxSteps;
        this.threadId = threadId ?? genChatId();
        this.dataRenderers = dataRenderers;
        this.onTurnComplete = onTurnComplete;
        this.modelTools = tools.filter(it => it.sendToModel ?? it.execute != null);
        this.messages = initialMessages.map(it => new ChatMessage(it));
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
     * Tool calls left waiting for the user by the previous turn are closed - approvals as denied -
     * so that the history stays valid for the model.
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

        if (fromComposer) composerModel.clear();
        this.closePausedTurn();
        const message = new ChatMessage({role: 'user', parts, metadata: spec.metadata});
        await this.runNewTurnAsync([...this.messages, message]);
    }

    /** Stop the current turn. Content received so far is kept, with status 'aborted'. */
    stop() {
        const {turn} = this;
        if (!turn) return;
        turn.abortController.abort();
        this.endTurn(turn, 'aborted');
    }

    /** Re-run the last user turn after an error, replacing the failed reply. */
    async retryAsync(): Promise<void> {
        if (this.isTurnRunning) return;
        this.closePausedTurn();

        const {messages} = this,
            idx = findLastIndex(messages, it => it.isUser);
        if (idx === -1) return;
        await this.runNewTurnAsync(messages.slice(0, idx + 1));
    }

    /**
     * Replace an assistant reply with a new one, discarding any later messages.
     * @param messageId - default the last assistant message.
     */
    async regenerateAsync(messageId?: string): Promise<void> {
        if (this.isTurnRunning) return;
        this.closePausedTurn();

        const {messages} = this,
            idx = findLastIndex(messages, it =>
                messageId != null ? it.id === messageId : it.isAssistant
            );
        if (!messages[idx]?.isAssistant) {
            this.logWarn('Regenerate ignored - no such assistant message.', messageId);
            return;
        }
        await this.runNewTurnAsync(messages.slice(0, idx));
    }

    /**
     * Change the text of a user message and re-run from it, discarding later messages. Files
     * attached to the message are kept.
     */
    async editMessageAsync(messageId: string, text: string): Promise<void> {
        if (this.isTurnRunning) return;
        this.closePausedTurn();

        const {messages} = this,
            idx = findLastIndex(messages, it => it.id === messageId),
            message = messages[idx];
        if (!message?.isUser) {
            this.logWarn('Edit ignored - no such user message.', messageId);
            return;
        }

        const parts: ChatPart[] = message.parts.filter(it => it.type !== 'text');
        if (text?.trim()) parts.push(createTextPart(text.trim()));
        if (isEmpty(parts)) return;
        await this.runNewTurnAsync([...messages.slice(0, idx), message.withChanges({parts})]);
    }

    /**
     * Approve a tool call that is waiting for approval. The turn continues - running the tool -
     * once no other call is waiting.
     */
    async approveToolCallAsync(toolCallId: string): Promise<void> {
        const turn = this.getPausedTurn(toolCallId, 'approval-requested');
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
        const turn = this.getPausedTurn(toolCallId, 'approval-requested');
        if (!turn) return;

        this.updateToolCall(turn, toolCallId, {
            state: 'output-denied',
            errorText: reason ?? 'The user denied this tool call.'
        });
        await this.resumeTurnAsync(turn);
    }

    /**
     * Provide the result of a tool call the user answers interactively - for tools rendered as a
     * form or a choice - and continue the turn.
     *
     * Such tools are declared with a {@link ChatToolSpec} that has no `execute`. A turn whose
     * model call ends with a call to one pauses until this method gives its result.
     */
    async addToolOutputAsync(toolCallId: string, output: any): Promise<void> {
        const turn = this.getPausedTurn(toolCallId, 'input-available');
        if (!turn) return;

        this.updateToolCall(turn, toolCallId, {state: 'output-available', output});
        await this.resumeTurnAsync(turn);
    }

    /** Remove all messages. Stops any turn in progress. */
    clear() {
        this.loadMessages([]);
    }

    /** Replace the conversation with the given messages. Stops any turn in progress. */
    loadMessages(specs: ChatMessageSpec[]) {
        this.stop();
        this.resetMessages(specs.map(it => new ChatMessage(it)));
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

    private async runNewTurnAsync(history: ChatMessage[]) {
        const message = new ChatMessage({role: 'assistant', status: 'pending'}),
            turn: ChatTurn = {
                messageId: message.id,
                step: 0,
                startedAt: Date.now(),
                abortController: new AbortController(),
                isRunning: true,
                approvedIds: new Set(),
                reducer: null,
                pendingEvents: [],
                flushTimer: null
            };

        this.turn = turn;
        this.beginTurn([...history, message]);
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
                const {status, error} = this.getTurnMessage(turn);
                if (status === 'error') {
                    this.endTurn(turn, 'error', new Error(error));
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
                    this.endTurn(turn, 'complete');
                    return;
                }

                turn.step++;
                await this.runStepAsync(turn);
            }
        } catch (e) {
            if (this.isCurrent(turn)) this.endTurn(turn, 'error', e);
        }
    }

    /** Make one model call, streaming its events into the turn's message. */
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
     * Resolve the client tool calls of the turn's current step: fail calls to unknown tools, ask
     * for approval where required, then run the rest in order.
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
            } else if (
                spec.execute &&
                !turn.approvedIds.has(call.id) &&
                needsApproval(spec, call)
            ) {
                this.updateToolCall(turn, call.id, {state: 'approval-requested'});
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
            const output = await Promise.race([
                execute(call.input ?? {}, context),
                rejectOnAbort(signal)
            ]);
            if (this.isCurrent(turn)) {
                this.updateToolCall(turn, call.id, {
                    state: 'output-available',
                    output: output ?? null
                });
            }
        } catch (e) {
            if (this.isCurrent(turn)) {
                this.updateToolCall(turn, call.id, {
                    state: 'output-error',
                    errorText: errorText(e)
                });
            }
        }
    }

    /** True if any tool call in the turn's current step waits for approval or a user result. */
    private hasWaitingToolCalls(turn: ChatTurn): boolean {
        return getClientToolCalls(this.getTurnMessage(turn), turn.step).some(
            it =>
                it.state === 'approval-requested' ||
                (it.state === 'input-available' && !this.getToolSpec(it.toolName)?.execute)
        );
    }

    /** The paused turn holding a tool call in the given state - restored if history was loaded. */
    private getPausedTurn(toolCallId: string, state: ChatToolCallState): ChatTurn {
        const {lastMessage} = this,
            call = lastMessage?.toolCalls.find(it => it.id === toolCallId);

        if (this.isTurnRunning || call?.state !== state) {
            this.logWarn(`Tool call ignored - '${toolCallId}' is not waiting for the user.`);
            return null;
        }

        this.turn ??= {
            messageId: lastMessage.id,
            step: maxBy(lastMessage.parts, 'step')?.step ?? 0,
            startedAt: Date.now(),
            abortController: new AbortController(),
            isRunning: false,
            approvedIds: new Set(),
            reducer: null,
            pendingEvents: [],
            flushTimer: null
        };
        return this.turn;
    }

    /** End a paused turn because the user moved on. Its waiting tool calls are closed. */
    private closePausedTurn() {
        if (this.turn) this.endTurn(this.turn, 'complete');
    }

    private endTurn(turn: ChatTurn, status: 'complete' | 'error' | 'aborted', error: Error = null) {
        this.flush(turn);
        if (error) {
            error = error instanceof Error ? error : new Error(String(error));
            this.logError('Turn failed', error);
        }

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
    @action
    private beginTurn(messages: ChatMessage[]) {
        this.messages = messages;
        this.status = 'submitted';
        this.lastError = null;
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

    @action
    private resetMessages(messages: ChatMessage[]) {
        this.messages = messages;
        this.status = 'ready';
        this.lastError = null;
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
    error: 'Not completed - the turn failed.'
};

/** State of one assistant turn, from the first model call to the end of the last. */
interface ChatTurn {
    /** The assistant message the turn builds. */
    messageId: string;

    /** Index of the current model call. */
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

function needsApproval(spec: ChatToolSpec, call: ChatToolCallPart): boolean {
    const {needsApproval} = spec;
    return isFunction(needsApproval) ? needsApproval(call.input ?? {}) : !!needsApproval;
}

function createTextPart(text: string): ChatTextPart {
    return {type: 'text', id: genChatId(), text, state: 'done'};
}

function rejectOnAbort(signal: AbortSignal): Promise<never> {
    return new Promise((_, reject) =>
        signal.addEventListener('abort', () => reject(signal.reason), {once: true})
    );
}

function errorText(e: any): string {
    return e?.message ?? String(e);
}
