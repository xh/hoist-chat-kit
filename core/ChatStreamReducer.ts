import type {PlainObject} from '@xh/hoist/core';
import {logDebug, logWarn} from '@xh/hoist/utils/js';
import {
    findLast,
    isBoolean,
    isEmpty,
    isNil,
    isPlainObject,
    isString,
    omit,
    omitBy,
    pick
} from 'lodash';
import type {ChatEvent} from '../transport';
import type {ChatMessage, ChatMessageSpec} from './ChatMessage';
import type {ChatTextTransform} from './ChatModel';
import type {
    ChatDataPart,
    ChatPart,
    ChatProviderData,
    ChatReasoningPart,
    ChatTextPart,
    ChatToolCallPart
} from './ChatPart';
import {CHAT_SUBAGENT_DATA_TYPE, type ChatSubagentData} from './ChatSubagent';
import {mergeArtifacts} from '../impl/artifacts';
import {getRunOutcome} from '@ag-ui/client';
import type {RunFinishedEvent as AgUiRunFinishedEvent, RunFinishedOutcome} from '@ag-ui/core';
import {genChatId} from '../impl/ids';
import type {ChatInterrupt} from './ChatInterrupt';
import {isRunningSubagent, SUBAGENT_UNFINISHED} from './impl/messageUtils';
import {parsePartialJson} from './impl/parsePartialJson';

/**
 * Applies the {@link ChatEvent}s of one step - one model call - to the assistant message being
 * built. `ChatModel` uses it for every step. Apps that run a transport without `ChatModel` use it
 * to fold the stream into a `ChatMessage` of their own.
 *
 * Create one reducer per step, with the step's index. Pass each batch of events to `apply()` as
 * they arrive, then call `finish()` once when the stream ends:
 *
 * ```ts
 * const reducer = new ChatStreamReducer(0);
 * let reply = new ChatMessage({role: 'assistant', status: 'pending'});
 * for await (const event of transport.run(request)) {
 *     reply = reducer.apply(reply, [event]);
 * }
 * reply = reducer.finish(reply);
 * ```
 *
 * The reducer never mutates its input: it returns a new message, holding new objects for only the
 * parts that changed, or the same message if nothing changed. Content moves a `pending` message to
 * `streaming`, and a `RUN_ERROR` event moves it to `error`. The reducer never marks a message
 * `complete` - the caller does that once the turn is done.
 *
 * Its own state maps the text and reasoning message ids of the step onto part ids, so a backend
 * may reuse those from one step to the next. Tool call parts take the tool call id as their own
 * id, so tool call ids must be unique within a turn. A later step of the same turn gets a new
 * reducer and the message that the earlier step left.
 *
 * Text parts store the result of the `textTransform`, if one is given. The reducer keeps the raw
 * text of each part it writes, and transforms the whole of it on each change, so a transform sees
 * the complete text so far rather than its own earlier output.
 *
 * Events the kit does not act on, and unknown event types, are ignored.
 */
export class ChatStreamReducer {
    /** Index of the step within the turn - set as the `step` of each new part. */
    readonly step: number;

    /** True once the step's `RUN_FINISHED` event has arrived. */
    get isRunFinished(): boolean {
        return this.runFinished;
    }

    /** Thread id reported by the step's `RUN_STARTED` event, or null. */
    get runThreadId(): string {
        return this.threadId;
    }

    /** Run id reported by the step's `RUN_STARTED` event, or null. */
    get runId(): string {
        return this.startedRunId;
    }

    /** Server id of the turn's user message, from an `xh.chat.message` event, or null. */
    get userServerId(): string {
        return this.userMessageServerId;
    }

    /** The outcome of the step's last `RUN_FINISHED`, or null. */
    get outcome(): RunFinishedOutcome {
        return this.lastOutcome;
    }

    /** Run id of the step's last `RUN_FINISHED`, or null. */
    get finishedRunId(): string {
        return this.lastFinishedRunId;
    }

    private readonly textTransform: ChatTextTransform;
    private partIds = new Map<string, string>();
    private rawTexts = new Map<string, string>();
    /** Length of the text a revising part replaced, by part id - see `ChatTextPart.revising`. */
    private revisingLengths = new Map<string, number>();
    private openTextId: string = null;
    private lastTextId: string = null;
    private openReasoningId: string = null;
    private lastToolCallId: string = null;
    private runFinished = false;
    private threadId: string = null;
    private startedRunId: string = null;
    private userMessageServerId: string = null;
    private lastOutcome: RunFinishedOutcome = null;
    private lastFinishedRunId: string = null;

    /**
     * @param step - zero-based index of the step within its turn - the request's `stepIndex`.
     * @param opts.textTransform - rewrites model text before it is stored - see
     *      `ChatModelConfig.textTransform`.
     */
    constructor(step: number, opts: {textTransform?: ChatTextTransform} = {}) {
        this.step = step;
        this.textTransform = opts.textTransform ?? null;
    }

    /** Apply a batch of events, returning the updated message. */
    apply(message: ChatMessage, events: ChatEvent[]): ChatMessage {
        const draft = createDraft(message);
        events.forEach(event => this.applyEvent(draft, event));

        // Parse streaming tool arguments once per batch, rather than once per fragment.
        draft.dirtyToolCalls.forEach(id => {
            const part = getPart<ChatToolCallPart>(draft, id),
                input = parsePartialJson(part.inputText);
            if (isPlainObject(input)) putPart(draft, {...part, input});
        });

        this.transformTexts(draft, message);
        return commitDraft(message, draft);
    }

    /**
     * Close out the step when its stream ends: mark open text and reasoning parts done, and parse
     * the input of any tool call whose arguments never saw an end event. A stream that ended with
     * neither `RUN_FINISHED` nor `RUN_ERROR` - such as a dropped connection - fails the message,
     * with error code `incomplete-stream`. A run that finished with nothing at all in the message
     * fails it too, with error code `empty-response`, rather than show a blank reply. A sub-agent
     * still running ends with the run: complete if the run finished, else failed.
     */
    finish(message: ChatMessage): ChatMessage {
        const draft = createDraft(message);
        draft.parts.forEach(part => {
            if (part.step !== this.step) return;
            if (part.type === 'toolCall') {
                this.endToolCall(draft, part.id);
            } else if (part.type === 'text' || part.type === 'reasoning') {
                this.endStreamingPart(draft, part.id);
            }
        });

        if (draft.status !== 'error') {
            if (!this.runFinished) {
                setError(draft, 'The response ended before it was complete.', 'incomplete-stream');
            } else if (isEmpty(draft.parts) && this.lastOutcome?.type !== 'interrupt') {
                setError(draft, 'The response ended without any content.', 'empty-response');
            }
        }

        // A sub-agent ends with its run, whether or not its end event came.
        const isFailed = draft.status === 'error';
        draft.parts.forEach(part => {
            // A sub-agent continued from an earlier step ends with this run too.
            if (!isRunningSubagent(part)) return;
            this.endSubagent(
                draft,
                part.id,
                isFailed ? {status: 'error', error: SUBAGENT_UNFINISHED} : {status: 'complete'}
            );
        });

        this.transformTexts(draft, message);
        return commitDraft(message, draft);
    }

    /**
     * Mark the step's streaming text parts done, for a turn that ends before its stream does, so
     * that the `textTransform` sees their final text.
     */
    settleText(message: ChatMessage): ChatMessage {
        const draft = createDraft(message);
        draft.parts.forEach(part => {
            if (part.step === this.step && part.type === 'text') {
                this.endStreamingPart(draft, part.id);
            }
        });
        this.transformTexts(draft, message);
        return commitDraft(message, draft);
    }

    //------------------
    // Implementation
    //------------------
    private applyEvent(draft: Draft, event: ChatEvent) {
        switch (event.type) {
            case 'TEXT_MESSAGE_START':
                this.openText(event.messageId);
                break;
            case 'TEXT_MESSAGE_CONTENT':
                this.appendText(draft, event.messageId, event.delta);
                break;
            case 'TEXT_MESSAGE_END':
                this.endText(draft, event.messageId);
                break;
            case 'TEXT_MESSAGE_CHUNK':
                this.appendText(draft, event.messageId, event.delta);
                break;

            case 'REASONING_START':
                this.openReasoning(draft, event.messageId);
                break;
            case 'REASONING_MESSAGE_START': {
                // The message id, not the span's, names the reasoning message in AG-UI's history.
                const part = getPart<ChatReasoningPart>(
                    draft,
                    this.openReasoning(draft, event.messageId)
                );
                if (part) putPart(draft, {...part, serverId: event.messageId});
                break;
            }
            case 'REASONING_MESSAGE_CONTENT':
            case 'REASONING_MESSAGE_CHUNK':
                this.appendReasoning(draft, event.messageId, event.delta);
                break;
            case 'REASONING_MESSAGE_END':
                this.endReasoning(draft, event.messageId);
                break;
            case 'REASONING_END':
                this.endReasoning(draft, event.messageId);
                draft.parts.forEach(part => {
                    if (part.type === 'reasoning' && part.step === this.step) {
                        this.endStreamingPart(draft, part.id);
                    }
                });
                break;
            case 'REASONING_ENCRYPTED_VALUE': {
                const {subtype, entityId, encryptedValue} = event;
                if (subtype === 'message') {
                    this.updateReasoning(draft, entityId, {encryptedValue});
                } else {
                    this.updateToolCall(draft, entityId, {encryptedValue});
                }
                break;
            }

            case 'TOOL_CALL_START':
                this.startToolCall(draft, event);
                break;
            case 'TOOL_CALL_ARGS':
                this.appendToolArgs(draft, event.toolCallId, event.delta);
                break;
            case 'TOOL_CALL_END':
                this.endToolCall(draft, event.toolCallId);
                break;
            case 'TOOL_CALL_CHUNK': {
                const id = event.toolCallId ?? this.lastToolCallId;
                if (!getPart(draft, id) && event.toolCallName) {
                    this.startToolCall(draft, {...event, toolCallId: id});
                }
                this.appendToolArgs(draft, id, event.delta);
                break;
            }
            case 'TOOL_CALL_RESULT': {
                const {toolCallId, content, metadata, messageId} = event;
                if (isString(metadata?.error) || metadata?.isError) {
                    const errorText = isString(metadata.error)
                        ? metadata.error
                        : contentText(content);
                    this.setToolError(draft, toolCallId, errorText, messageId);
                } else {
                    this.setToolResult(draft, toolCallId, content, messageId);
                }
                if (metadata?.artifacts != null) addArtifacts(draft, metadata.artifacts);
                break;
            }

            case 'ACTIVITY_SNAPSHOT':
                // An explicit `replace: false` asks to keep existing content - see AG-UI.
                if (event.replace === false && getPart(draft, event.messageId)) break;
                putPart(draft, {
                    type: 'data',
                    id: event.messageId,
                    step: this.step,
                    dataType: event.activityType,
                    data: event.content
                });
                break;

            case 'SUBAGENT_STARTED': {
                const {subagentRunId, name, description, parentSubagentRunId, parentToolCallId} =
                    event;
                if (subagentRunId == null) break;
                // A later run continues a sub-agent that waited on the user.
                const existing = getPart<ChatDataPart>(draft, subagentRunId);
                if (existing) {
                    if (existing.data?.status === 'waiting') {
                        const resumed = {...existing.data, status: 'running', endedAt: null};
                        putPart(draft, {...existing, data: resumed});
                    }
                    break;
                }
                const data: ChatSubagentData = {
                    name: name ?? 'Agent',
                    ...omitBy({description, parentSubagentRunId, parentToolCallId}, isNil),
                    status: 'running',
                    startedAt: Date.now(),
                    endedAt: null
                };
                putPart(draft, {
                    type: 'data',
                    id: subagentRunId,
                    step: this.step,
                    dataType: CHAT_SUBAGENT_DATA_TYPE,
                    data
                });
                break;
            }
            case 'SUBAGENT_FINISHED':
                if (event.outcome?.type === 'suspended') {
                    this.endSubagent(draft, event.subagentRunId, {status: 'waiting'});
                    break;
                }
                this.endSubagent(draft, event.subagentRunId, {
                    status: 'complete',
                    ...(event.result !== undefined ? {result: event.result} : {})
                });
                break;
            case 'SUBAGENT_ERROR':
                this.endSubagent(draft, event.subagentRunId, {
                    status: 'error',
                    error: event.message ?? 'The agent failed.'
                });
                break;

            case 'CUSTOM':
                this.applyCustom(draft, event.name, event.value ?? {});
                break;

            case 'RUN_STARTED':
                // A stream may start a new run after one fails, which clears the failure.
                if (draft.status === 'error') clearError(draft);
                this.runFinished = false;
                this.threadId = event.threadId ?? null;
                this.startedRunId = event.runId ?? null;
                // Marks a reply whose run the backend began. A reply that failed without it was
                // never sent.
                setMetadata(draft, {runStarted: true});
                if (event.runId != null) setMetadata(draft, {runId: event.runId});
                break;
            case 'RUN_FINISHED': {
                const {metadata} = draft,
                    finishReason =
                        event.metadata?.finishReason ??
                        outcomeFinishReason(event.outcome?.type) ??
                        metadata.finishReason ??
                        null;
                draft.metadata = {...metadata, ...event.metadata, finishReason};
                if (event.usage) {
                    draft.metadata.usage = [...(metadata.usage ?? []), ...event.usage];
                }
                // A fallback for agents that report the message's id only at the end.
                const serverId = event.result?.messageId;
                if (serverId != null && metadata.serverId == null) {
                    draft.metadata.serverId = serverId;
                }
                // An interrupted run records its questions on the reply, to answer in the next run.
                this.lastOutcome = getRunOutcome(event as AgUiRunFinishedEvent) ?? null;
                this.lastFinishedRunId = event.runId ?? null;
                if (this.lastOutcome?.type === 'interrupt') {
                    const raised: ChatInterrupt[] = this.lastOutcome.interrupts.map(it => ({
                        ...it,
                        runId: event.runId,
                        step: this.step,
                        response: null,
                        delivered: false
                    }));
                    draft.metadata.interrupts = [...(metadata.interrupts ?? []), ...raised];
                }
                draft.changed = true;
                this.runFinished = true;
                break;
            }
            case 'RUN_ERROR': {
                // The first error of a run stands, such as over the stalled error of a backend
                // that holds the stream open after its own.
                if (draft.status === 'error') break;
                setError(draft, event.message ?? 'Unknown error.', event.code);
                const {retryAfterSeconds, retrySafe} = event.metadata ?? {};
                if (retryAfterSeconds != null) setMetadata(draft, {retryAfterSeconds});
                if (isBoolean(retrySafe)) setMetadata(draft, {retrySafe});
                break;
            }

            default:
                logDebug(['Ignored event', event.type], this);
        }
    }

    //------------------
    // Text
    //------------------
    private openText(messageId: string): string {
        const id = genChatId();
        this.partIds.set(textKey(messageId), id);
        this.openTextId = id;
        return id;
    }

    // Text parts open lazily, on their first content, so an empty message leaves no part.
    private appendText(draft: Draft, messageId: string, delta: string) {
        const id =
            messageId != null
                ? (this.partIds.get(textKey(messageId)) ?? this.openText(messageId))
                : (this.openTextId ?? this.openText(genChatId()));
        if (!delta) return;

        const part = getPart<ChatTextPart>(draft, id);
        this.putText(
            draft,
            part ?? {
                type: 'text',
                id,
                step: this.step,
                text: '',
                state: 'streaming',
                ...(messageId != null ? {serverId: messageId} : {})
            },
            this.getRawText(part) + delta
        );
        this.openTextId = this.lastTextId = id;
    }

    // Replaces the text of the open text part, or else of the turn's last text part. An open part
    // with no content yet, or a turn with no text, gets a new part.
    private replaceText(draft: Draft, text: string) {
        const {openTextId} = this,
            part =
                openTextId != null
                    ? getPart<ChatTextPart>(draft, openTextId)
                    : (findLast(draft.parts, it => it.type === 'text') as ChatTextPart);
        if (part) {
            // Shorter text for a part that still streams is a rewrite, which keeps the part
            // `revising` until its text is as long as the text first replaced.
            const replacedLength = this.getRawText(part).length;
            if (part.state === 'streaming' && text.length < replacedLength) {
                const heldLength = this.revisingLengths.get(part.id) ?? 0;
                this.revisingLengths.set(part.id, Math.max(heldLength, replacedLength));
            }
            this.putText(draft, part, text);
        } else if (text) {
            this.appendText(draft, null, text);
        }
    }

    /** Store a text part with new raw text, to be transformed when the batch is committed. */
    private putText(draft: Draft, part: ChatTextPart, rawText: string) {
        this.rawTexts.set(part.id, rawText);
        const {revising: _revising, ...rest} = part,
            heldLength = this.revisingLengths.get(part.id);
        if (heldLength != null && rawText.length >= heldLength) {
            this.revisingLengths.delete(part.id);
        }
        putPart(
            draft,
            this.revisingLengths.has(part.id)
                ? {...rest, text: rawText, revising: true}
                : {...rest, text: rawText}
        );
        draft.dirtyTexts.add(part.id);
    }

    private getRawText(part: ChatTextPart): string {
        return part ? (this.rawTexts.get(part.id) ?? part.text) : '';
    }

    // Transforms once per batch, rather than once per fragment.
    private transformTexts(draft: Draft, message: ChatMessage) {
        const {textTransform} = this;
        if (!textTransform) return;
        draft.dirtyTexts.forEach(id => {
            const part = getPart<ChatTextPart>(draft, id),
                text = textTransform(this.getRawText(part), {
                    message,
                    isStreaming: part.state === 'streaming'
                });
            putPart(draft, {...part, text});
        });
    }

    private endText(draft: Draft, messageId: string) {
        const id = this.partIds.get(textKey(messageId));
        if (id == null) return;
        this.endStreamingPart(draft, id);
        if (this.openTextId === id) this.openTextId = null;
    }

    //------------------
    // Reasoning
    //------------------
    // A reasoning span (REASONING_START) and the first message within it
    // (REASONING_MESSAGE_START) may carry different ids - both map to the same part.
    private openReasoning(draft: Draft, messageId: string): string {
        const key = reasoningKey(messageId),
            existingId = this.partIds.get(key);
        if (existingId != null) return existingId;

        const open = getPart<ChatReasoningPart>(draft, this.openReasoningId);
        if (open?.state === 'streaming' && !open.text) {
            this.partIds.set(key, open.id);
            return open.id;
        }

        const id = genChatId();
        putPart(draft, {
            type: 'reasoning',
            id,
            step: this.step,
            text: '',
            state: 'streaming',
            startedAt: Date.now(),
            endedAt: null
        });
        this.partIds.set(key, id);
        this.openReasoningId = id;
        return id;
    }

    private appendReasoning(draft: Draft, messageId: string, delta: string) {
        const id =
            messageId != null
                ? this.openReasoning(draft, messageId)
                : (this.openReasoningId ?? this.openReasoning(draft, genChatId()));
        if (!delta) return;

        const part = getPart<ChatReasoningPart>(draft, id);
        putPart(draft, {...part, text: part.text + delta});
    }

    private endReasoning(draft: Draft, messageId: string) {
        const id = this.partIds.get(reasoningKey(messageId));
        if (id == null) return;
        this.endStreamingPart(draft, id);
        if (this.openReasoningId === id) this.openReasoningId = null;
    }

    // Providers may send an encrypted value or provider data with no readable text (e.g. for
    // redacted thinking). It still has to go back with the history, so it gets a part of its own.
    private updateReasoning(draft: Draft, messageId: string, changes: Partial<ChatReasoningPart>) {
        const part = this.findReasoning(draft, messageId);
        if (part) {
            putPart(draft, {...part, ...changes});
        } else {
            const now = Date.now();
            putPart(draft, {
                type: 'reasoning',
                id: genChatId(),
                step: this.step,
                text: '',
                state: 'done',
                startedAt: now,
                endedAt: now,
                ...changes
            });
        }
    }

    /** The reasoning part for a message id - or, failing that, the last one of this step. */
    private findReasoning(draft: Draft, messageId: string): ChatReasoningPart {
        const id = this.partIds.get(reasoningKey(messageId));
        return (
            getPart<ChatReasoningPart>(draft, id) ??
            (findLast(
                draft.parts,
                it => it.type === 'reasoning' && it.step === this.step
            ) as ChatReasoningPart) ??
            null
        );
    }

    private updateToolCall(draft: Draft, toolCallId: string, changes: Partial<ChatToolCallPart>) {
        const part = getPart<ChatToolCallPart>(draft, toolCallId);
        if (part) {
            putPart(draft, {...part, ...changes});
        } else {
            logDebug(['Ignored update for unknown tool call', toolCallId], this);
        }
    }

    //------------------
    // Tool calls
    //------------------
    private startToolCall(
        draft: Draft,
        {
            toolCallId,
            toolCallName,
            parentMessageId,
            subagentRunId
        }: {
            toolCallId: string;
            toolCallName?: string;
            parentMessageId?: string;
            subagentRunId?: string;
        }
    ) {
        if (toolCallId == null) return;
        if (getPart(draft, toolCallId)) {
            logWarn(['Ignored tool call with an id already used in this turn', toolCallId], this);
            return;
        }
        putPart(draft, {
            type: 'toolCall',
            id: toolCallId,
            step: this.step,
            toolName: toolCallName,
            state: 'input-streaming',
            inputText: '',
            input: null,
            output: null,
            errorText: null,
            startedAt: Date.now(),
            ...omitBy({subagentRunId, parentServerId: parentMessageId}, isNil)
        });
        this.lastToolCallId = toolCallId;
    }

    private appendToolArgs(draft: Draft, toolCallId: string, delta: string) {
        const part = getPart<ChatToolCallPart>(draft, toolCallId);
        if (!delta || part?.state !== 'input-streaming') return;
        putPart(draft, {...part, inputText: part.inputText + delta});
        draft.dirtyToolCalls.add(part.id);
    }

    private endToolCall(draft: Draft, toolCallId: string) {
        const part = getPart<ChatToolCallPart>(draft, toolCallId);
        if (part?.state !== 'input-streaming') return;

        draft.dirtyToolCalls.delete(part.id);
        try {
            const input = part.inputText.trim() ? JSON.parse(part.inputText) : {};
            if (!isPlainObject(input)) throw new Error('Input must be a JSON object.');
            putPart(draft, {...part, input, state: 'input-available'});
        } catch (e) {
            putPart(draft, {
                ...part,
                input: null,
                state: 'output-error',
                errorText: `Invalid tool input: ${e.message}`,
                endedAt: Date.now()
            });
        }
    }

    private setToolResult(
        draft: Draft,
        toolCallId: string,
        content: string | PlainObject[],
        resultServerId: string = null
    ) {
        this.finishToolCall(draft, toolCallId, {
            state: 'output-available',
            output: isString(content) ? parseIfJson(content) : content,
            ...omitBy({resultServerId}, isNil)
        });
    }

    private setToolError(
        draft: Draft,
        toolCallId: string,
        errorText: string,
        resultServerId: string = null
    ) {
        this.finishToolCall(draft, toolCallId, {
            state: 'output-error',
            output: null,
            errorText: errorText || 'The tool failed.',
            ...omitBy({resultServerId}, isNil)
        });
    }

    // Results come from the backend, so the call is marked as run there.
    private finishToolCall(draft: Draft, toolCallId: string, changes: Partial<ChatToolCallPart>) {
        if (!getPart(draft, toolCallId)) {
            logDebug(['Ignored result for unknown tool call', toolCallId], this);
            return;
        }
        this.endToolCall(draft, toolCallId);
        putPart(draft, {
            ...getPart<ChatToolCallPart>(draft, toolCallId),
            ...changes,
            providerExecuted: true,
            endedAt: Date.now()
        });
    }

    //------------------
    // Sub-agents
    //------------------
    private endSubagent(draft: Draft, subagentRunId: string, changes: Partial<ChatSubagentData>) {
        const part = getPart<ChatDataPart>(draft, subagentRunId);
        if (part?.dataType !== CHAT_SUBAGENT_DATA_TYPE) {
            logDebug(['Ignored end of unknown sub-agent', subagentRunId], this);
            return;
        }
        const endedAt = changes.status === 'waiting' ? null : Date.now();
        putPart(draft, {...part, data: {...part.data, ...changes, endedAt}});
    }

    //------------------
    // Kit extensions
    //------------------
    private applyCustom(draft: Draft, name: string, value: PlainObject) {
        const {step} = this,
            id = value.id ?? genChatId();

        switch (name) {
            case 'xh.chat.source': {
                const source = pick(value, SOURCE_KEYS);
                putPart(draft, {
                    type: 'source',
                    id,
                    step,
                    ...source,
                    sourceType: SOURCE_TYPES.includes(value.sourceType)
                        ? value.sourceType
                        : source.url
                          ? 'url'
                          : 'document'
                });
                break;
            }
            case 'xh.chat.textReplace':
                this.replaceText(draft, value.text ?? '');
                break;
            case 'xh.chat.message':
                if (value.serverId == null) break;
                if (value.role === 'user') {
                    this.userMessageServerId = value.serverId;
                } else {
                    setMetadata(draft, {serverId: value.serverId});
                }
                break;
            case 'xh.chat.citation': {
                const part = getPart<ChatTextPart>(draft, this.openTextId ?? this.lastTextId);
                if (!part) {
                    logDebug('Ignored citation with no text part to attach to', this);
                    break;
                }
                const citation = {id, ...pick(value, CITATION_KEYS)};
                putPart(draft, {...part, citations: [...(part.citations ?? []), citation]});
                break;
            }
            case 'xh.chat.data':
                putPart(draft, {
                    type: 'data',
                    id,
                    step,
                    dataType: value.dataType,
                    data: value.data
                });
                break;
            case 'xh.chat.file':
                putPart(draft, {
                    type: 'file',
                    id,
                    step,
                    name: value.name,
                    mediaType: value.mediaType,
                    ...pick(value, FILE_KEYS)
                });
                break;
            case 'xh.chat.artifact':
                addArtifacts(draft, value);
                break;
            case 'xh.chat.providerData':
                this.mergeProviderData(draft, value.subtype, value.entityId, value.data ?? {});
                break;
            case 'xh.chat.providerExecuted':
                this.updateToolCall(draft, value.toolCallId, {providerExecuted: true});
                break;
            case 'xh.chat.toolError':
                this.setToolError(draft, value.toolCallId, value.message);
                break;
            default:
                logDebug(['Ignored custom event', name], this);
        }
    }

    // Merged by provider key, so that each provider's entry replaces only its own earlier one.
    private mergeProviderData(
        draft: Draft,
        subtype: 'message' | 'tool-call',
        entityId: string,
        data: ChatProviderData
    ) {
        if (subtype === 'message') {
            const part = this.findReasoning(draft, entityId);
            this.updateReasoning(draft, entityId, {
                providerData: {...part?.providerData, ...data}
            });
        } else {
            const part = getPart<ChatToolCallPart>(draft, entityId);
            this.updateToolCall(draft, entityId, {providerData: {...part?.providerData, ...data}});
        }
    }

    //------------------
    // Shared
    //------------------
    private endStreamingPart(draft: Draft, id: string) {
        const part = getPart<ChatTextPart | ChatReasoningPart>(draft, id);
        if (part?.state !== 'streaming') return;
        if (part.type === 'reasoning') {
            putPart(draft, {...part, state: 'done', endedAt: Date.now()});
        } else {
            const {revising: _revising, ...rest} = part;
            this.revisingLengths.delete(id);
            putPart(draft, {...rest, state: 'done'});
            // The transform sees the final text with `isStreaming: false`.
            draft.dirtyTexts.add(id);
        }
    }
}

//------------------
// Implementation
//------------------
const SOURCE_KEYS = ['url', 'title', 'snippet', 'marker', 'metadata'],
    SOURCE_TYPES = ['url', 'document'],
    CITATION_KEYS = ['title', 'url', 'citedText', 'sourceId'],
    FILE_KEYS = ['size', 'url', 'data'];

/** Working copy of a message, changed in place while a batch of events is applied. */
interface Draft {
    parts: ChatPart[];
    status: ChatMessageSpec['status'];
    error: string;
    metadata: PlainObject;
    changed: boolean;
    dirtyToolCalls: Set<string>;
    dirtyTexts: Set<string>;
}

function createDraft(message: ChatMessage): Draft {
    const {parts, status, error, metadata} = message;
    return {
        parts: [...parts],
        status,
        error,
        metadata,
        changed: false,
        dirtyToolCalls: new Set(),
        dirtyTexts: new Set()
    };
}

function commitDraft(message: ChatMessage, draft: Draft): ChatMessage {
    if (!draft.changed) return message;
    const {parts, status, error, metadata} = draft;
    return message.withChanges({parts, status, error, metadata});
}

function getPart<T extends ChatPart>(draft: Draft, id: string): T {
    return id == null ? null : ((draft.parts.find(it => it.id === id) as T) ?? null);
}

/** Replace the part with the same id, or append it. Content moves a pending message to streaming. */
function putPart(draft: Draft, part: ChatPart) {
    const {parts} = draft,
        idx = parts.findIndex(it => it.id === part.id);
    if (idx === -1) {
        parts.push(part);
    } else {
        parts[idx] = part;
    }
    if (draft.status === 'pending') draft.status = 'streaming';
    draft.changed = true;
}

/** The finish reason for an AG-UI `RUN_FINISHED` outcome, for runs that report no reason. */
function outcomeFinishReason(outcomeType: string): string {
    if (outcomeType == null) return null;
    return outcomeType === 'success' ? 'stop' : 'other';
}

function setMetadata(draft: Draft, changes: PlainObject) {
    draft.metadata = {...draft.metadata, ...changes};
    draft.changed = true;
}

/** Record artifacts on the reply, as `metadata.artifacts` - see `ChatArtifact`. */
function addArtifacts(draft: Draft, artifacts: unknown) {
    const current = draft.metadata.artifacts,
        merged = mergeArtifacts(current, artifacts);
    if (merged !== current && merged.length) setMetadata(draft, {artifacts: merged});
}

function clearError(draft: Draft) {
    draft.status = 'streaming';
    draft.error = null;
    draft.metadata = omit(draft.metadata, ['errorCode', 'retryAfterSeconds', 'retrySafe']);
    draft.changed = true;
}

function setError(draft: Draft, error: string, errorCode: string) {
    draft.status = 'error';
    draft.error = error;
    if (errorCode != null) draft.metadata = {...draft.metadata, errorCode};
    draft.changed = true;
}

/** Tool result content as text - as is if a string, else the text of its text parts. */
function contentText(content: string | PlainObject[]): string {
    if (isString(content)) return content;
    return (content ?? [])
        .filter(it => it.type === 'text')
        .map(it => it.text)
        .join('\n');
}

function parseIfJson(text: string): any {
    try {
        return JSON.parse(text);
    } catch (ignored) {
        return text;
    }
}

function textKey(messageId: string): string {
    return `text:${messageId}`;
}

function reasoningKey(messageId: string): string {
    return `reasoning:${messageId}`;
}
