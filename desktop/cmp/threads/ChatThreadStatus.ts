import {placeholder} from '@xh/hoist/cmp/layout';
import {mask} from '@xh/hoist/cmp/mask';
import {hoistCmp, type HoistProps, type TestSupportProps, uses} from '@xh/hoist/core';
import {getTestId} from '@xh/hoist/utils/js';
import {ChatThreadsModel} from '../../../threads';
import {classNames} from '../../../impl/ClassNames';
import {getThreadLabels} from '../../impl/ThreadLabels';
import {threadLoadFailed, threadNotFound} from '../../impl/ThreadStatus';
import '../../../styles/vars.scss';
import './ChatThreadStatus.scss';

/** Props for {@link ChatThreadStatus}. */
export interface ChatThreadStatusProps extends HoistProps<ChatThreadsModel>, TestSupportProps {
    /**
     * The word for a thread in the status text, such as 'chat' - as
     * `ChatThreadListProps.threadNoun`. Default 'thread'.
     */
    threadNoun?: string;
}

/**
 * The selected thread's status, for a frame of the app's own around a {@link ChatThreadsModel} -
 * the states that `ChatWorkspace` shows in place of its conversation. Wrap the conversation in it:
 *
 *  - While a thread's history loads into an empty chat - a plain pane under the load mask, not a
 *    new chat's empty state.
 *  - For a thread that the store reports missing - "Thread not found", with New Chat.
 *  - For a history that failed to load - the error, with Retry.
 *
 * Otherwise it renders its children, such as the thread's `chatPanel`. A state unmounts them,
 * unlike `ChatWorkspace`, which keeps an app's own view mounted and hidden. To mask a thread that
 * reloads with messages on screen, pass the model's `loadTask` to the panel's `mask`.
 */
export const [ChatThreadStatus, chatThreadStatus] = hoistCmp.withFactory<ChatThreadStatusProps>({
    displayName: 'ChatThreadStatus',
    model: uses(ChatThreadsModel),
    className: 'xh-chat-thread-status',

    render({model, className, threadNoun, testId, children}) {
        const labels = getThreadLabels(threadNoun),
            isEmpty = model.chatModel?.isEmpty ?? true;

        if (model.isThreadNotFound) {
            return threadNotFound(model, labels, {
                className: classNames(className, 'xh-chat-thread-status--not-found'),
                testId: getTestId(testId, 'notFound')
            });
        }
        if (model.loadError && isEmpty) {
            return threadLoadFailed(model, labels, {
                className: classNames(className, 'xh-chat-thread-status--load-error'),
                testId: getTestId(testId, 'loadError')
            });
        }
        if (model.isThreadLoading && isEmpty) {
            return placeholder({
                className: classNames(className, 'xh-chat-thread-status--loading'),
                testId: getTestId(testId, 'loading'),
                item: mask({bind: model.loadTask, spinner: true})
            });
        }
        return children ?? null;
    }
});
