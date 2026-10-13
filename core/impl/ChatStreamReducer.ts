import type {PlainObject} from '@xh/hoist/core';
import {logDebug} from '@xh/hoist/utils/js';
import {findLast, isPlainObject, isString, pick} from 'lodash';
import type {ChatEvent} from '../../transport';
import type {ChatMessage, ChatMessageSpec} from '../ChatMessage';
import type {ChatPart, ChatReasoningPart, ChatTextPart, ChatToolCallPart} from '../ChatPart';
import {genChatId} from './ids';
import {parsePartialJson} from './parsePartialJson';

/**
 * Applies the {@link ChatEvent}s of one model call to the assistant message being built.
 *
 * Create one reducer per model call (step) and pass it each batch of events as they arrive. The
 * reducer never mutates its input: it returns a new message, holding new objects for only the
 * parts that changed, or the same message if nothing changed. Its own state maps the event ids of
 * the call onto part ids, so a backend may reuse ids from one call to the next.
 *
 * Events the kit does not act on, and unknown event types, are ignored.
 * @internal
 */
export class ChatStreamReducer {
    /** Index of the model call within the turn - set as the `step` of each new part. */
    readonly step: number;

    private partIds = new Map<string, string>();
    private openTextId: string = null;
    private lastTextId: string = null;
    private openReasoningId: string = null;
    private lastToolCallId: string = null;

    constructor(step: number) {
        this.step = step;
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

        return commitDraft(message, draft);
    }

    /**
     * Close out the model call when its stream ends: mark open text and reasoning parts done, and
     * parse the input of any tool call whose arguments never saw an end event.
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
            case 'REASONING_MESSAGE_START':
                this.openReasoning(draft, event.messageId);
                break;
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
            case 'REASONING_ENCRYPTED_VALUE':
                if (event.subtype === 'message') {
                    this.setEncryptedValue(draft, event.entityId, event.encryptedValue);
                } else {
                    this.setToolCallEncryptedValue(draft, event.entityId, event.encryptedValue);
                }
                break;

            case 'TOOL_CALL_START':
                this.startToolCall(draft, event.toolCallId, event.toolCallName);
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
                    this.startToolCall(draft, id, event.toolCallName);
                }
                this.appendToolArgs(draft, id, event.delta);
                break;
            }
            case 'TOOL_CALL_RESULT':
                this.setToolResult(draft, event.toolCallId, event.content);
                break;

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

            case 'CUSTOM':
                this.applyCustom(draft, event.name, event.value ?? {});
                break;

            case 'RUN_FINISHED': {
                const {metadata} = draft,
                    finishReason =
                        event.metadata?.finishReason ??
                        event.outcome?.type ??
                        metadata.finishReason ??
                        null;
                draft.metadata = {...metadata, ...event.metadata, finishReason};
                if (event.usage) {
                    draft.metadata.usage = [...(metadata.usage ?? []), ...event.usage];
                }
                draft.changed = true;
                break;
            }
            case 'RUN_ERROR':
                draft.status = 'error';
                draft.error = event.message ?? 'Unknown error.';
                draft.changed = true;
                break;

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
        putPart(
            draft,
            part
                ? {...part, text: part.text + delta}
                : {type: 'text', id, step: this.step, text: delta, state: 'streaming'}
        );
        this.openTextId = this.lastTextId = id;
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

    // Providers may send an encrypted value with no readable text (e.g. redacted thinking). It
    // still has to go back with the history, so it gets a part of its own.
    private setToolCallEncryptedValue(draft: Draft, toolCallId: string, encryptedValue: string) {
        const part = getPart<ChatToolCallPart>(draft, toolCallId);
        if (part) {
            putPart(draft, {...part, encryptedValue});
        } else {
            logDebug(['Ignored encrypted value for unknown tool call', toolCallId], this);
        }
    }

    private setEncryptedValue(draft: Draft, messageId: string, encryptedValue: string) {
        const id = this.partIds.get(reasoningKey(messageId)),
            part =
                getPart<ChatReasoningPart>(draft, id) ??
                (findLast(
                    draft.parts,
                    it => it.type === 'reasoning' && it.step === this.step
                ) as ChatReasoningPart);

        if (part) {
            putPart(draft, {...part, encryptedValue});
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
                encryptedValue
            });
        }
    }

    //------------------
    // Tool calls
    //------------------
    private startToolCall(draft: Draft, toolCallId: string, toolName: string) {
        if (toolCallId == null || getPart(draft, toolCallId)) return;
        putPart(draft, {
            type: 'toolCall',
            id: toolCallId,
            step: this.step,
            toolName,
            state: 'input-streaming',
            inputText: '',
            input: null,
            output: null,
            errorText: null
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
                errorText: `Invalid tool input: ${e.message}`
            });
        }
    }

    private setToolResult(draft: Draft, toolCallId: string, content: string | PlainObject[]) {
        if (!getPart(draft, toolCallId)) {
            logDebug(['Ignored result for unknown tool call', toolCallId], this);
            return;
        }
        this.endToolCall(draft, toolCallId);
        putPart(draft, {
            ...getPart<ChatToolCallPart>(draft, toolCallId),
            state: 'output-available',
            output: isString(content) ? parseIfJson(content) : content,
            providerExecuted: true
        });
    }

    //------------------
    // Kit extensions
    //------------------
    private applyCustom(draft: Draft, name: string, value: PlainObject) {
        const {step} = this,
            id = value.id ?? genChatId();

        switch (name) {
            case 'xh.chat.source':
                putPart(draft, {type: 'source', id, step, ...pick(value, SOURCE_KEYS)});
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
            default:
                logDebug(['Ignored custom event', name], this);
        }
    }

    //------------------
    // Shared
    //------------------
    private endStreamingPart(draft: Draft, id: string) {
        const part = getPart<ChatTextPart | ChatReasoningPart>(draft, id);
        if (part?.state !== 'streaming') return;
        putPart(
            draft,
            part.type === 'reasoning'
                ? {...part, state: 'done', endedAt: Date.now()}
                : {...part, state: 'done'}
        );
    }
}

//------------------
// Implementation
//------------------
const SOURCE_KEYS = ['url', 'title', 'snippet'],
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
}

function createDraft(message: ChatMessage): Draft {
    const {parts, status, error, metadata} = message;
    return {
        parts: [...parts],
        status,
        error,
        metadata,
        changed: false,
        dirtyToolCalls: new Set()
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
