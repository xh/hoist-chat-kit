import type {TaskObserver} from '@xh/hoist/core';
import type {ChatThreadSummary} from './ChatThreadStore';

/**
 * What a thread list needs from the model that holds the threads. `ChatThreadsModel` implements
 * it. Implement it on a `HoistModel` of your own to show the kit's thread list over threads the
 * app holds, without a `ChatThreadsModel`.
 *
 * The list reads these members in render, so make them observable for the list to update as they
 * change. Leave out an optional action to hide its control.
 */
export interface ChatThreadListHost {
    /** The threads to list. The list groups them by recency - see `groupThreadsByRecency()`. */
    readonly threads: ChatThreadSummary[];

    /** Id of the selected thread, or null. */
    readonly selectedThreadId: string;

    /** Text to search the threads for, or null. The list's search input reads and writes it. */
    search?: string;

    /**
     * True if the search covers the text of messages, not just titles. Without it, the list says
     * "Searching titles" while it searches. See `ChatThreadStore.searchesMessages`.
     */
    readonly searchesMessages?: boolean;

    /** Ids of the threads with a turn running. Each shows as working. */
    readonly runningThreadIds?: string[];

    /** Ids of the threads whose turn waits for the user. Each shows as needing attention. */
    readonly awaitingThreadIds?: string[];

    /** Ids of the threads whose turn finished while the user was away. Each shows a new reply. */
    readonly finishedAwayThreadIds?: string[];

    /** Error from the last load of the list, or null. The list shows it in place of the rows. */
    readonly listError?: Error;

    /** Tracks loads of the list. The list shows a skeleton while the first load is pending. */
    readonly listTask?: TaskObserver;

    /** True if there are more threads to list - see {@link loadMoreThreadsAsync}. */
    readonly hasMoreThreads?: boolean;

    /** True to show Rename. Requires {@link renameThreadAsync}. */
    readonly canRename?: boolean;

    /** True to show Delete. Requires {@link deleteThreadsAsync}. */
    readonly canDelete?: boolean;

    /** True to show Pin and Unpin. Requires {@link pinThreadAsync}. */
    readonly canPin?: boolean;

    /** Start a new thread, and select it. */
    newThread(): unknown;

    /** Select a thread. */
    selectThreadAsync(threadId: string): Promise<unknown>;

    /** Rename a thread. */
    renameThreadAsync?(threadId: string, title: string): Promise<unknown>;

    /** Pin a thread, or unpin it. */
    pinThreadAsync?(threadId: string, pinned: boolean): Promise<unknown>;

    /** Delete threads. The list confirms with the user first. */
    deleteThreadsAsync?(threadIds: string[]): Promise<unknown>;

    /** Load the next page of threads. The list shows Load More while `hasMoreThreads`. */
    loadMoreThreadsAsync?(): Promise<unknown>;

    /** Reload the list. The list offers it as Retry after a failed load. */
    refreshAsync?(): Promise<unknown>;
}
