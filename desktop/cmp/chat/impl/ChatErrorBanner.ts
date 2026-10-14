import {div} from '@xh/hoist/cmp/layout';
import {hoistCmp, type HoistProps, uses} from '@xh/hoist/core';
import {button} from '@xh/hoist/desktop/cmp/button';
import {Icon} from '@xh/hoist/icon';
import {ChatModel} from '../../../../core';
import '../../../../styles/vars.scss';
import './ChatErrorBanner.scss';

interface ChatErrorBannerProps extends HoistProps<ChatModel> {
    /** Called when the user chooses to edit their last message. Shows an Edit button if given. */
    onEdit?: () => void;
}

/**
 * The error that ended the last turn, with a button to retry it. Renders nothing unless the
 * conversation's status is 'error'.
 * @internal
 */
export const chatErrorBanner = hoistCmp.factory<ChatErrorBannerProps>({
    displayName: 'ChatErrorBanner',
    model: uses(ChatModel),
    className: 'xh-chat-error-banner',

    render({model, className, onEdit}) {
        if (model.status !== 'error') return null;

        const message =
            model.lastError?.message || model.lastMessage?.error || 'Something went wrong.';

        return div({
            className,
            role: 'alert',
            items: [
                div({className: 'xh-chat-error-banner__icon', item: Icon.warningCircle()}),
                div({className: 'xh-chat-error-banner__message', item: message}),
                div({
                    className: 'xh-chat-error-banner__actions',
                    items: [
                        onEdit ? button({text: 'Edit', icon: Icon.edit(), onClick: onEdit}) : null,
                        button({
                            text: 'Retry',
                            icon: Icon.refresh(),
                            outlined: true,
                            onClick: () => model.retryAsync().catchDefault()
                        })
                    ]
                })
            ]
        });
    }
});
