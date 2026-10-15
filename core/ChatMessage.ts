import type {PlainObject} from '@xh/hoist/core';
import {isEmpty} from 'lodash';
import type {ChatPart, ChatTextPart, ChatToolCallPart} from './ChatPart';
import {genChatId} from '../impl/ids';
import {createTextPart} from './impl/messageUtils';

/** Author of a message. */
export type ChatRole = 'user' | 'assistant' | 'system';

/**
 * Lifecycle of a message.
 *
 *  - `pending` - an assistant message waiting for its first content.
 *  - `streaming` - content is arriving, or client tools are running.
 *  - `paused` - the turn is waiting for the user to answer its tool calls - to approve or deny
 *    them, or to give their result. See {@link ChatModel.waitingToolCalls}. The message returns to
 *    `streaming` when the turn resumes.
 *  - `complete` - finished normally.
 *  - `error` - the turn failed, with a message in `error`.
 *  - `aborted` - the user stopped the turn, or it was interrupted. Content received so far is kept.
 */
export type ChatMessageStatus =
    'pending' | 'streaming' | 'paused' | 'complete' | 'error' | 'aborted';

/** Plain-object form of a {@link ChatMessage} - for initial messages and stored history. */
export interface ChatMessageSpec {
    /** Unique id. Generated if not provided. */
    id?: string;

    /** Author of the message. */
    role: ChatRole;

    /** Ordered content of the message. */
    parts?: ChatPart[];

    /** Shorthand for a message with a single text part. Ignored if `parts` is provided. */
    content?: string;

    /** Default 'complete'. */
    status?: ChatMessageStatus;

    /** Epoch millis. Defaults to now. */
    createdAt?: number;

    /** Error message, for a message with status 'error'. */
    error?: string;

    /**
     * Open-ended data about the message. The kit records `elapsedMs`, `endedAt` (epoch millis),
     * `finishReason`, `stopReason`, `usage`, `runStarted: true` once the backend reports the run
     * began, and, for a failed turn, `errorCode`, `retryAfterSeconds` and `retrySafe` on assistant
     * messages, and `undone: true` on a reply whose changes the user undid. Apps may add their
     * own keys.
     */
    metadata?: PlainObject;
}

/**
 * One message in a conversation - an immutable record of its author, status and ordered parts.
 *
 * Messages are created and replaced by {@link ChatModel} as a conversation progresses: each change
 * to a streaming message produces a new instance. Compare messages by `id`, not by identity, to
 * track one across updates.
 */
export class ChatMessage {
    /** Unique id, stable across the instances that replace this message as it changes. */
    readonly id: string;

    /** Author of the message. */
    readonly role: ChatRole;

    /** Ordered content of the message. */
    readonly parts: ChatPart[];

    /** Where the message is in its lifecycle. */
    readonly status: ChatMessageStatus;

    /** Epoch millis when the message was created - for an assistant reply, when its turn began. */
    readonly createdAt: number;

    /** Error message, for a message with status 'error' - else null. */
    readonly error: string;

    /** Open-ended data about the message - see {@link ChatMessageSpec.metadata}. */
    readonly metadata: PlainObject;

    constructor(spec: ChatMessageSpec) {
        const {id, role, parts, content, status, createdAt, error, metadata} = spec;
        this.id = id ?? genChatId();
        this.role = role;
        this.parts = parts ?? (content != null ? [createTextPart(content)] : []);
        this.status = status ?? 'complete';
        this.createdAt = createdAt ?? Date.now();
        this.error = error ?? null;
        this.metadata = metadata ?? {};
    }

    /** Text of all text parts, separated by blank lines. */
    get text(): string {
        return this.parts
            .filter(it => it.type === 'text')
            .map(it => (it as ChatTextPart).text)
            .join('\n\n');
    }

    /** Tool call parts, in call order. */
    get toolCalls(): ChatToolCallPart[] {
        return this.parts.filter(it => it.type === 'toolCall') as ChatToolCallPart[];
    }

    /** True for a message written by the user. */
    get isUser(): boolean {
        return this.role === 'user';
    }

    /** True for a message written by the model. */
    get isAssistant(): boolean {
        return this.role === 'assistant';
    }

    /** True while the message awaits or receives content. A paused message is not streaming. */
    get isStreaming(): boolean {
        return this.status === 'pending' || this.status === 'streaming';
    }

    /** True if the message has no parts. */
    get isEmpty(): boolean {
        return isEmpty(this.parts);
    }

    /** A copy of this message with the given changes applied. */
    withChanges(changes: Partial<ChatMessageSpec>): ChatMessage {
        return new ChatMessage({...this.toSpec(), ...changes});
    }

    /** This message as a plain object, suitable for JSON serialization. */
    toSpec(): ChatMessageSpec {
        const {id, role, parts, status, createdAt, error, metadata} = this;
        return {id, role, parts, status, createdAt, error, metadata};
    }
}
