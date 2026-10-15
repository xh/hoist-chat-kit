import {XH} from '@xh/hoist/core';
import {Icon} from '@xh/hoist/icon';
import type {ChatThreadSummary} from '../../../../threads';

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
