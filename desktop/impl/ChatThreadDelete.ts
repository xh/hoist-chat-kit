import {flatMap} from 'lodash';
import {XH} from '@xh/hoist/core';
import {Icon} from '@xh/hoist/icon';
import {
    type ChatThreadGroup,
    type ChatThreadsModel,
    type ChatThreadSummary,
    groupThreadsByRecency
} from '../../threads';
import {getThreadLabels, type ThreadLabels} from './ThreadLabels';

/** Options for {@link deleteThreadAsync}. */
export interface DeleteThreadOptions {
    /** The word for a thread, in the confirm. Default 'thread'. */
    labels?: ThreadLabels;

    /**
     * True to open the next thread in the list's order when the open thread is deleted - the one
     * below it, else the one above. False to leave the threads model to open a new chat. Default
     * true.
     */
    selectNext?: boolean;

    /**
     * Called once the user confirms, as the delete starts, with the id of the thread next to the
     * deleted one, or null. Moves focus.
     */
    onDeleting?: (nextId: string) => void;
}

/**
 * Ask the user to confirm the delete of a thread, with focus on Cancel.
 * @returns true if the user confirmed.
 * @internal
 */
export function confirmDeleteThreadAsync(
    thread: ChatThreadSummary,
    labels: ThreadLabels = getThreadLabels()
): Promise<boolean> {
    return XH.confirm({
        title: `Delete ${labels.singular}?`,
        message: `"${thread.title}" is removed for you. This can't be undone.`,
        confirmProps: {text: 'Delete', icon: Icon.delete(), intent: 'danger'},
        cancelProps: {autoFocus: true}
    });
}

/**
 * Confirm with the user, then delete a thread. If the thread was open, the next one in the list's
 * order opens - the one below it, else the one above - or a new chat if none is left, or if
 * `selectNext` is false. The thread list and the workspace's Thread actions menu both delete
 * through here.
 *
 * @returns true if the user confirmed.
 * @internal
 */
export async function deleteThreadAsync(
    threadsModel: ChatThreadsModel,
    thread: ChatThreadSummary,
    {labels, selectNext = true, onDeleting}: DeleteThreadOptions = {}
): Promise<boolean> {
    const ids = getListedThreadIds(threadsModel),
        index = ids.indexOf(thread.id),
        nextId = index >= 0 ? (ids[index + 1] ?? ids[index - 1] ?? null) : null;
    if (!(await confirmDeleteThreadAsync(thread, labels))) return false;

    // The next thread opens before the delete, so that the model does not open a new thread
    // first - the user lands once, not twice.
    const wasSelected = threadsModel.selectedThreadId === thread.id;
    if (wasSelected && selectNext && nextId) threadsModel.selectThreadAsync(nextId).catchDefault();
    const deletion = threadsModel.deleteThreadsAsync([thread.id]);
    onDeleting?.(nextId);
    await deletion;
    return true;
}

/**
 * The groups a thread list shows: one group of results while searching, else groups by recency.
 * @internal
 */
export function getThreadGroups(threadsModel: ChatThreadsModel): ChatThreadGroup[] {
    const {threads} = threadsModel;
    if (!threads.length) return [];
    if (!threadsModel.search?.trim()) return groupThreadsByRecency(threads);

    const label = threads.length === 1 ? '1 result' : `${threads.length} results`;
    return [{key: null, label, threads}];
}

/**
 * Ids of the threads in the order a thread list shows them.
 * @internal
 */
export function getListedThreadIds(threadsModel: ChatThreadsModel): string[] {
    return flatMap(getThreadGroups(threadsModel), it => it.threads.map(thread => thread.id));
}
