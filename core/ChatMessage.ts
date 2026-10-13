import type {PlainObject} from '@xh/hoist/core';
import {isEmpty} from 'lodash';
import type {ChatPart, ChatTextPart, ChatToolCallPart} from './ChatPart';
import {genChatId} from './impl/ids';

/** Author of a message. */
export type ChatRole = 'user' | 'assistant' | 'system';

/**
 * Lifecycle of a message.
 *
 *  - `pending` - an assistant message waiting for its first content.
 *  - `streaming` - content is arriving.
 *  - `complete` - finished normally.
 *  - `error` - the turn failed, with a message in `error`.
 *  - `aborted` - the user stopped the turn. Content received so far is kept.
 */
export type ChatMessageStatus = 'pending' | 'streaming' | 'complete' | 'error' | 'aborted';

/** Plain-object form of a {@link ChatMessage} - for initial messages and stored history. */
export interface ChatMessageSpec {
    /** Unique id. Generated if not provided. */
    id?: string;

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
     * Open-ended data about the message. The kit records `elapsedMs`, `finishReason` and
     * `usage` on assistant messages. Apps may add their own keys.
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
    readonly id: string;
    readonly role: ChatRole;
    readonly parts: ChatPart[];
    readonly status: ChatMessageStatus;
    readonly createdAt: number;
    readonly error: string;
    readonly metadata: PlainObject;

    constructor(spec: ChatMessageSpec) {
        const {id, role, parts, content, status, createdAt, error, metadata} = spec;
        this.id = id ?? genChatId();
        this.role = role;
        this.parts = parts ?? (content != null ? [textPart(content)] : []);
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

    get isUser(): boolean {
        return this.role === 'user';
    }

    get isAssistant(): boolean {
        return this.role === 'assistant';
    }

    /** True while the message awaits or receives content. */
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

//------------------
// Implementation
//------------------
function textPart(text: string): ChatTextPart {
    return {type: 'text', id: genChatId(), text, state: 'done'};
}
