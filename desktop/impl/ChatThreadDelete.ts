import {flatMap} from 'lodash';
import {span} from '@xh/hoist/cmp/layout';
import {type MenuItem, XH} from '@xh/hoist/core';
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

    /** False if the list shows the threads in the store's order, with no recency groups. */
    groupByRecency?: boolean;

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
    {labels, groupByRecency = true, selectNext = true, onDeleting}: DeleteThreadOptions = {}
): Promise<boolean> {
    const ids = getListedThreadIds(threadsModel, groupByRecency),
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
 * The Delete item of a thread's menu, for the list's row menu and the workspace's header menu.
 * Disabled, it says why on hover: Hoist menu items take no tooltip, but the label is a node.
 * @internal
 */
export function deleteMenuItem(
    canDelete: boolean,
    canDeleteNow: boolean,
    actionFn: () => void
): MenuItem {
    return {
        text: canDeleteNow ? 'Delete...' : span({title: DELETE_RUNNING_TIP, item: 'Delete...'}),
        icon: Icon.delete(),
        intent: 'danger',
        omit: !canDelete,
        disabled: !canDeleteNow,
        actionFn
    };
}

/** Why Delete is disabled while a thread's turn runs - see `enableDeleteRunning`. */
const DELETE_RUNNING_TIP = 'A reply is in progress. Wait for it to end, then delete.';

/**
 * The groups a thread list shows: one group of results while searching, else groups by recency -
 * or one plain group, with no label, when `groupByRecency` is false.
 * @internal
 */
export function getThreadGroups(
    threadsModel: ChatThreadsModel,
    groupByRecency: boolean
): ChatThreadGroup[] {
    const {threads} = threadsModel;
    if (!threads.length) return [];
    if (threadsModel.search?.trim()) {
        const label = threads.length === 1 ? '1 result' : `${threads.length} results`;
        return [{key: null, label, threads}];
    }
    return groupByRecency ? groupThreadsByRecency(threads) : [{key: null, label: null, threads}];
}

/**
 * Ids of the threads in the order a thread list shows them.
 * @internal
 */
export function getListedThreadIds(
    threadsModel: ChatThreadsModel,
    groupByRecency: boolean
): string[] {
    return flatMap(getThreadGroups(threadsModel, groupByRecency), it =>
        it.threads.map(thread => thread.id)
    );
}
