import type {PlainObject} from '@xh/hoist/core';
import type {ChatFeedbackSpec, ChatMessageSpec} from '../core';

/**
 * Adapter between a {@link ChatThreadsModel} and the backend that stores an app's threads. The app
 * implements it against its own API, mapping the backend's records to and from the kit's shapes.
 *
 * Only `listThreadsAsync` and `loadMessagesAsync` are required. The threads model hides each
 * action whose method the store leaves out - for example, it cannot rename a thread without
 * `renameThreadAsync`.
 *
 * A store reports a thread that does not exist with an empty page, or by throwing an error with
 * `httpStatus` 404, as Hoist's `FetchService` does. The threads model shows such a thread as
 * empty. Any other error fails the load.
 */
export interface ChatThreadStore {
    /** A page of the user's threads, most recently active first. */
    listThreadsAsync(query: ChatThreadQuery): Promise<ChatThreadPage>;

    /** A page of a thread's messages - the newest, or those older than the query's cursor. */
    loadMessagesAsync(query: ChatMessageQuery): Promise<ChatMessagePage>;

    /**
     * Create a thread on the backend, for a backend that mints its own thread ids. The threads
     * model calls it before the first run of a new thread, and runs the thread under the id it
     * returns. Must be idempotent per `localId`: a second call after a lost response must return
     * the same thread, never create another. Leave it out if the backend takes the id the browser
     * mints, and creates the thread on its first run.
     */
    createThreadAsync?(spec: ChatThreadCreateSpec): Promise<ChatThreadSummary>;

    /** Rename a thread. */
    renameThreadAsync?(threadId: string, title: string): Promise<void>;

    /** Delete threads. Deleting a thread that does not exist succeeds. */
    deleteThreadsAsync?(threadIds: string[]): Promise<void>;

    /** Pin a thread, or unpin it. */
    pinThreadAsync?(threadId: string, pinned: boolean): Promise<void>;

    /**
     * Save a user's rating of a message. The threads model gives it to each chat it creates, unless
     * the chat has a `feedback.submitAsync` of its own.
     */
    submitFeedbackAsync?(spec: ChatFeedbackSpec): Promise<void>;
}

/** One thread, as shown in a thread list. */
export interface ChatThreadSummary {
    /** The thread's id. */
    id: string;

    /** Title to show for the thread. */
    title: string;

    /** When the thread last changed, in epoch milliseconds. Drives sorting and recency groups. */
    lastActivityAt: number;

    /** When the thread was created, in epoch milliseconds. */
    createdAt?: number;

    /** True if the user has pinned the thread. */
    pinned?: boolean;

    /** True if the backend reports a run in progress in the thread. */
    isRunning?: boolean;

    /**
     * How the thread's last run ended, if the backend reports it. A thread list marks a run the
     * server cut short as `interrupted`, and one that ended in an error as `failed`.
     */
    lastRunEnd?: 'complete' | 'interrupted' | 'failed';

    /** Why the last run ended as it did, for a thread list to show in a tooltip. */
    lastRunReason?: string;

    /** App data about the thread. */
    metadata?: PlainObject;
}

/** Query for {@link ChatThreadStore.listThreadsAsync}. */
export interface ChatThreadQuery {
    /** Text to search for, or null for all threads. */
    search?: string;

    /** Cursor from the previous page, or null for the first page. */
    cursor?: string;

    /** Most threads to return. */
    limit?: number;
}

/** A page of threads. */
export interface ChatThreadPage {
    threads: ChatThreadSummary[];

    /** Cursor for the next page, or null if there is none. */
    nextCursor?: string;
}

/** Query for {@link ChatThreadStore.loadMessagesAsync}. */
export interface ChatMessageQuery {
    threadId: string;

    /** Cursor from the previous page, to load older messages, or null for the newest. */
    cursor?: string;

    /** Most messages to return. */
    limit?: number;
}

/** A page of a thread's messages, oldest first. */
export interface ChatMessagePage {
    messages: ChatMessageSpec[];

    /** Cursor for the page of older messages, or null if there are none. */
    nextCursor?: string;
}

/** Passed to {@link ChatThreadStore.createThreadAsync}. */
export interface ChatThreadCreateSpec {
    /** The id the browser minted for the thread - the key that makes the call idempotent. */
    localId: string;

    /** A title for the thread, from the start of its first message. */
    title?: string;
}
