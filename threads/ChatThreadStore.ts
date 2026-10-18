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
    /**
     * True if the search of `listThreadsAsync` covers the text of messages, not just titles. A
     * store that sets it may return each match's `snippet`. Without it, a thread list says
     * "Searching titles" while it searches.
     */
    readonly searchesMessages?: boolean;

    /**
     * The user's threads, most recently active first. The store decides how many to return, such
     * as the most recent 100.
     */
    listThreadsAsync(query: ChatThreadQuery): Promise<ChatThreadPage>;

    /** A thread's messages, oldest first. */
    loadMessagesAsync(query: ChatMessageQuery): Promise<ChatMessagePage>;

    /** Rename a thread. */
    renameThreadAsync?(threadId: string, title: string): Promise<void>;

    /** Delete threads. Deleting a thread that does not exist succeeds. */
    deleteThreadsAsync?(threadIds: string[]): Promise<void>;

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

    /** True if the backend reports a run in progress in the thread. */
    isRunning?: boolean;

    /**
     * How the thread's last run ended, if the backend reports it. A thread list marks a run the
     * server cut short as `interrupted`, and one that ended in an error as `failed`.
     */
    lastRunEnd?: 'complete' | 'interrupted' | 'failed';

    /** Why the last run ended as it did, for a thread list to show in a tooltip. */
    lastRunReason?: string;

    /**
     * For a search result, the passage of the thread that matched, as plain text - see
     * {@link ChatThreadStore.searchesMessages}. A thread list shows it under the title.
     */
    snippet?: string;

    /** App data about the thread. */
    metadata?: PlainObject;
}

/** Query for {@link ChatThreadStore.listThreadsAsync}. */
export interface ChatThreadQuery {
    /** Text to search for, or null for all threads. */
    search?: string;
}

/** The threads that {@link ChatThreadStore.listThreadsAsync} returns. */
export interface ChatThreadPage {
    threads: ChatThreadSummary[];
}

/** Query for {@link ChatThreadStore.loadMessagesAsync}. */
export interface ChatMessageQuery {
    threadId: string;
}

/** A thread's messages, oldest first. */
export interface ChatMessagePage {
    messages: ChatMessageSpec[];

    /**
     * Cursor for older messages, for a backend that returns history a page at a time, or null if
     * there are none. Not yet read by the kit, which shows the messages returned. It leaves room
     * to page in older history later.
     */
    nextCursor?: string;
}
