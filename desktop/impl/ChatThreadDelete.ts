import {flatMap} from 'lodash';
import {XH} from '@xh/hoist/core';
import {Icon} from '@xh/hoist/icon';
import {
    type ChatThreadGroup,
    type ChatThreadsModel,
    type ChatThreadSummary,
    groupThreadsByRecency
} from '../../threads';

/**
 * Ask the user to confirm the delete of a thread, with focus on Cancel.
 * @returns true if the user confirmed.
 * @internal
 */
export function confirmDeleteThreadAsync(thread: ChatThreadSummary): Promise<boolean> {
    return XH.confirm({
        title: 'Delete thread?',
        message: `"${thread.title}" is removed for you. This can't be undone.`,
        confirmProps: {text: 'Delete', icon: Icon.delete(), intent: 'danger'},
        cancelProps: {autoFocus: true}
    });
}

/**
 * Confirm with the user, then delete a thread. If the thread was open, the next one in the list's
 * order opens - the one below it, else the one above - or a new chat if none is left. The thread
 * list and the workspace's Thread actions menu both delete through here.
 *
 * @param onDeleting - called once the user confirms, as the delete starts, with the id of the
 *      thread next to the deleted one, or null. Moves focus.
 * @returns true if the user confirmed.
 * @internal
 */
export async function deleteThreadAsync(
    threadsModel: ChatThreadsModel,
    thread: ChatThreadSummary,
    onDeleting?: (nextId: string) => void
): Promise<boolean> {
    const ids = getListedThreadIds(threadsModel),
        index = ids.indexOf(thread.id),
        nextId = index >= 0 ? (ids[index + 1] ?? ids[index - 1] ?? null) : null;
    if (!(await confirmDeleteThreadAsync(thread))) return false;

    const wasSelected = threadsModel.selectedThreadId === thread.id,
        deletion = threadsModel.deleteThreadsAsync([thread.id]);
    if (wasSelected && nextId) threadsModel.selectThreadAsync(nextId).catchDefault();
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
