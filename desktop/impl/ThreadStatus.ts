import type {ReactNode} from 'react';
import {errorMessage, type ErrorMessageProps} from '@xh/hoist/cmp/error';
import {Icon} from '@xh/hoist/icon';
import {wait} from '@xh/hoist/promise';
import type {ChatThreadsModel} from '../../threads';
import type {ThreadLabels} from './ThreadLabels';

/**
 * "Thread not found", with New Chat, for a thread the store reports missing. New Chat starts a
 * thread and focuses its composer, as the button that took the click goes.
 * @internal
 */
export function threadNotFound(
    threadsModel: ChatThreadsModel,
    labels: ThreadLabels,
    props: ErrorMessageProps & {key?: string} = {}
): ReactNode {
    return errorMessage({
        error: true,
        title: `${labels.title} not found`,
        message: 'This conversation does not exist, or it was deleted.',
        actionFn: () => startNewThread(threadsModel),
        actionButtonProps: {text: 'New Chat', icon: Icon.add()},
        ...props
    });
}

/**
 * The selected thread's failed load, with Retry.
 * @internal
 */
export function threadLoadFailed(
    threadsModel: ChatThreadsModel,
    labels: ThreadLabels,
    props: ErrorMessageProps & {key?: string} = {}
): ReactNode {
    return errorMessage({
        error: threadsModel.loadError,
        title: `Couldn't load this ${labels.singular}`,
        actionFn: () => threadsModel.reloadThreadAsync(),
        actionButtonProps: {text: 'Retry', icon: Icon.refresh()},
        ...props
    });
}

/**
 * Start a new thread, and focus its composer once it renders.
 * @internal
 */
export function startNewThread(threadsModel: ChatThreadsModel) {
    const chatModel = threadsModel.newThread();
    wait().then(() => chatModel?.composerModel.focus());
}
