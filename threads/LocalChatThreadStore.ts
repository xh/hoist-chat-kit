import {cloneDeep, find, omit, orderBy, pull, remove} from 'lodash';
import {wait} from '@xh/hoist/promise';
import {type ChatFeedbackSpec, ChatMessage, type ChatMessageSpec} from '../core';
import {genChatId} from '../impl/ids';
import type {
    ChatMessagePage,
    ChatMessageQuery,
    ChatThreadCreateSpec,
    ChatThreadPage,
    ChatThreadQuery,
    ChatThreadStore,
    ChatThreadSummary
} from './ChatThreadStore';
import {titleFromText} from './impl/threadUtils';

/** Configuration for a {@link LocalChatThreadStore}. */
export interface LocalChatThreadStoreConfig {
    /** Threads to start with. */
    threads?: LocalChatThread[];

    /** Latency of each call, in milliseconds. Default 0. */
    delayMs?: number;

    /**
     * True to mint thread ids, as a backend that creates its threads does. The store then
     * implements `createThreadAsync`. Default false.
     */
    mintIds?: boolean;

    /** Optional methods to leave out, to show how the threads model works without them. */
    omit?: LocalChatThreadStoreOptionalMethod[];

    /** False to act as a backend that cannot edit - see `ChatThreadStore.allowEdit`. */
    allowEdit?: boolean;

    /** False to act as a backend that cannot regenerate - see `ChatThreadStore.allowRegenerate`. */
    allowRegenerate?: boolean;
}

/** A thread held by a {@link LocalChatThreadStore}: its summary and its messages. */
export interface LocalChatThread extends Partial<ChatThreadSummary> {
    id: string;

    /** Messages of the thread, oldest first. */
    messages?: ChatMessageSpec[];
}

/** An optional method that a {@link LocalChatThreadStore} can leave out. */
export type LocalChatThreadStoreOptionalMethod =
    'renameThreadAsync' | 'deleteThreadsAsync' | 'pinThreadAsync' | 'submitFeedbackAsync';

/** A method of a {@link ChatThreadStore}. */
export type ChatThreadStoreMethod = keyof ChatThreadStore;

/** A call made to a {@link LocalChatThreadStore} - see {@link LocalChatThreadStore.calls}. */
export interface LocalChatThreadStoreCall {
    method: ChatThreadStoreMethod;
    args: any[];

    /** True while the call waits to be released - see {@link LocalChatThreadStore.hold}. */
    isHeld: boolean;

    /** Let a held call complete. */
    release(): void;

    /** Fail a held call. */
    fail(error?: Error): void;
}

/**
 * A {@link ChatThreadStore} that holds its threads in memory, for tests, demos and offline
 * development. It answers as a backend would: threads most recently active first, history in
 * pages, a missing thread as a 404, and a delete of a missing thread as a success.
 *
 * Tests control its timing. `hold()` makes calls to a method wait until the test releases or fails
 * each one, which forces responses out of order. `failNext()` fails the next call to a method.
 * A held read answers with the data as it was when called. A held write takes effect when
 * released.
 *
 * The store does not see the chat's runs. Record what a backend would with {@link saveThread} -
 * from a scripted transport's `respond`, or from a chat's `onTurnComplete`.
 */
export class LocalChatThreadStore implements ChatThreadStore {
    /** Latency of each call, in milliseconds. */
    readonly delayMs: number;

    /** Calls made to the store, oldest first. */
    readonly calls: LocalChatThreadStoreCall[] = [];

    readonly allowEdit: boolean;
    readonly allowRegenerate: boolean;

    createThreadAsync?: (spec: ChatThreadCreateSpec) => Promise<ChatThreadSummary>;
    renameThreadAsync?: (threadId: string, title: string) => Promise<void>;
    deleteThreadsAsync?: (threadIds: string[]) => Promise<void>;
    pinThreadAsync?: (threadId: string, pinned: boolean) => Promise<void>;
    submitFeedbackAsync?: (spec: ChatFeedbackSpec) => Promise<void>;

    constructor({
        threads = [],
        delayMs = 0,
        mintIds = false,
        omit = [],
        allowEdit = true,
        allowRegenerate = true
    }: LocalChatThreadStoreConfig = {}) {
        this.delayMs = delayMs;
        this.allowEdit = allowEdit;
        this.allowRegenerate = allowRegenerate;
        threads.forEach(it => this.saveThread(it));

        if (mintIds) {
            this.createThreadAsync = spec =>
                this.callAsync('createThreadAsync', [spec], 'write', () => this.createThread(spec));
        }
        if (!omit.includes('renameThreadAsync')) {
            this.renameThreadAsync = (threadId, title) =>
                this.callAsync('renameThreadAsync', [threadId, title], 'write', () => {
                    this.getOrThrow(threadId).title = title;
                });
        }
        if (!omit.includes('deleteThreadsAsync')) {
            this.deleteThreadsAsync = threadIds =>
                this.callAsync('deleteThreadsAsync', [threadIds], 'write', () => {
                    remove(this.threads, it => threadIds.includes(it.id));
                });
        }
        if (!omit.includes('pinThreadAsync')) {
            this.pinThreadAsync = (threadId, pinned) =>
                this.callAsync('pinThreadAsync', [threadId, pinned], 'write', () => {
                    this.getOrThrow(threadId).pinned = pinned;
                });
        }
        if (!omit.includes('submitFeedbackAsync')) {
            this.submitFeedbackAsync = spec =>
                this.callAsync('submitFeedbackAsync', [spec], 'write', () =>
                    this.saveFeedback(spec)
                );
        }
    }

    listThreadsAsync(query: ChatThreadQuery): Promise<ChatThreadPage> {
        return this.callAsync('listThreadsAsync', [query], 'read', () => this.listThreads(query));
    }

    loadMessagesAsync(query: ChatMessageQuery): Promise<ChatMessagePage> {
        return this.callAsync('loadMessagesAsync', [query], 'read', () => this.loadMessages(query));
    }

    //------------------------
    // Backend state
    //------------------------
    /**
     * Add a thread, or update one, as the backend would on a run. Fields left out keep their
     * values. A new thread with no title takes one from its first user message, and
     * `lastActivityAt` defaults to now.
     */
    saveThread(thread: LocalChatThread) {
        const now = Date.now(),
            existing = find(this.threads, {id: thread.id}),
            saved: LocalChatThread = {
                createdAt: now,
                messages: [],
                ...cloneDeep(existing),
                lastActivityAt: now,
                ...cloneDeep(thread)
            };
        if (saved.title == null) {
            const firstUserMessage = find(saved.messages, {role: 'user'});
            saved.title = titleFromText(firstUserMessage && new ChatMessage(firstUserMessage).text);
        }
        pull(this.threads, existing);
        this.threads.push(saved);
    }

    /** A copy of a thread, or null if the store does not have it. */
    getThread(threadId: string): LocalChatThread {
        return cloneDeep(find(this.threads, {id: threadId})) ?? null;
    }

    //------------------------
    // Test controls
    //------------------------
    /**
     * Hold calls to a method: each waits until the test calls `release()` or `fail()` on it - see
     * {@link heldCalls}. Pass false to stop holding new calls. Calls already held stay held.
     */
    hold(method: ChatThreadStoreMethod, isHeld: boolean = true) {
        if (isHeld) {
            this.heldMethods.add(method);
        } else {
            this.heldMethods.delete(method);
        }
    }

    /** Calls still held, oldest first - for one method, or for all. */
    heldCalls(method?: ChatThreadStoreMethod): LocalChatThreadStoreCall[] {
        return this.calls.filter(it => it.isHeld && (!method || it.method === method));
    }

    /** Fail the next call to a method. */
    failNext(method: ChatThreadStoreMethod, error: Error = new Error(`${method} failed.`)) {
        this.failures.set(method, error);
    }

    //------------------
    // Implementation
    //------------------
    private readonly threads: LocalChatThread[] = [];
    private readonly heldMethods = new Set<ChatThreadStoreMethod>();
    private readonly failures = new Map<ChatThreadStoreMethod, Error>();
    private readonly mintedIds = new Map<string, string>();

    private async callAsync<T>(
        method: ChatThreadStoreMethod,
        args: any[],
        kind: 'read' | 'write',
        work: () => T
    ): Promise<T> {
        const failure = this.failures.get(method) ?? null,
            isHeld = this.heldMethods.has(method);
        this.failures.delete(method);

        // A read answers with the data as it is now, however late the answer arrives.
        let readResult: T, readError: any;
        if (kind === 'read' && !failure) {
            try {
                readResult = cloneDeep(work());
            } catch (e) {
                readError = e;
            }
        }

        let release: () => void, fail: (error: Error) => void;
        const gate = isHeld
                ? new Promise<void>((resolve, reject) => {
                      release = resolve;
                      fail = reject;
                  })
                : null,
            call: LocalChatThreadStoreCall = {
                method,
                args,
                isHeld,
                release: () => {
                    call.isHeld = false;
                    release?.();
                },
                fail: (error = new Error(`${method} failed.`)) => {
                    call.isHeld = false;
                    fail?.(error);
                }
            };
        this.calls.push(call);

        if (gate) {
            await gate;
        } else if (this.delayMs) {
            await wait(this.delayMs);
        }
        if (failure) throw failure;
        if (kind === 'write') return cloneDeep(work());
        if (readError) throw readError;
        return readResult;
    }

    private listThreads({search, cursor, limit = 50}: ChatThreadQuery): ChatThreadPage {
        const term = search?.toLowerCase(),
            matches = orderBy(
                this.threads.filter(it => !term || it.title.toLowerCase().includes(term)),
                'lastActivityAt',
                'desc'
            ),
            start = cursor ? Number(cursor) : 0,
            end = start + limit;
        return {
            threads: matches.slice(start, end).map(toSummary),
            nextCursor: end < matches.length ? String(end) : null
        };
    }

    private loadMessages({threadId, cursor, limit = 50}: ChatMessageQuery): ChatMessagePage {
        const {messages} = this.getOrThrow(threadId),
            end = cursor ? Number(cursor) : messages.length,
            start = Math.max(0, end - limit);
        return {messages: messages.slice(start, end), nextCursor: start > 0 ? String(start) : null};
    }

    private createThread({localId, title}: ChatThreadCreateSpec): ChatThreadSummary {
        let threadId = this.mintedIds.get(localId);
        if (!threadId) {
            threadId = genChatId();
            this.mintedIds.set(localId, threadId);
            this.saveThread({id: threadId, title});
        }
        return toSummary(this.getOrThrow(threadId));
    }

    private saveFeedback({threadId, messageId, rating, comment}: ChatFeedbackSpec) {
        const message = find(this.getOrThrow(threadId).messages, {id: messageId});
        if (!message) throw notFound(`Message '${messageId}'`);
        const metadata = omit(message.metadata, 'feedback');
        message.metadata = rating
            ? {...metadata, feedback: comment ? {rating, comment} : {rating}}
            : metadata;
    }

    private getOrThrow(threadId: string): LocalChatThread {
        const ret = find(this.threads, {id: threadId});
        if (!ret) throw notFound(`Thread '${threadId}'`);
        return ret;
    }
}

//------------------
// Implementation
//------------------
function toSummary(thread: LocalChatThread): ChatThreadSummary {
    return omit(thread, 'messages') as ChatThreadSummary;
}

/** An error that reports a missing record as a 404, as Hoist's `FetchService` does. */
function notFound(what: string): Error {
    return Object.assign(new Error(`${what} not found.`), {httpStatus: 404});
}
