import {hoistCmp, useContextModel, XH} from '@xh/hoist/core';
import {button, type ButtonProps} from '@xh/hoist/desktop/cmp/button';
import {Icon} from '@xh/hoist/icon';
import {throwIf} from '@xh/hoist/utils/js';
import {ChatModel} from '../../../core';

/** Props for {@link ChatClearButton}. */
export interface ChatClearButtonProps extends ButtonProps {
    /** The chat to clear. Defaults to the {@link ChatModel} in context. */
    chatModel?: ChatModel;
}

/**
 * A button that clears a conversation and starts a new thread, for a chat panel's header. It is
 * disabled while the conversation is empty. While a reply streams, it asks the user to confirm
 * first, as clearing stops the reply.
 *
 * ```ts
 * chatPanel({model: chatModel, headerItems: [chatClearButton()]});
 * ```
 *
 * Pass `onClick` to do more than clear - for example to also discard saved history.
 */
export const [ChatClearButton, chatClearButton] = hoistCmp.withFactory<ChatClearButtonProps>({
    displayName: 'ChatClearButton',
    model: false,
    className: 'xh-chat-clear-button',

    render({chatModel, ...props}, ref) {
        const contextModel = useContextModel(ChatModel),
            model = chatModel ?? contextModel;
        throwIf(!model, 'ChatClearButton requires a ChatModel - in props or in context.');

        return button({
            ref,
            icon: Icon.reset(),
            tooltip: 'Clear conversation',
            'aria-label': 'Clear conversation',
            disabled: model.isEmpty,
            onClick: () => clearAsync(model).catchDefault(),
            ...props
        });
    }
});

//------------------
// Implementation
//------------------
async function clearAsync(chatModel: ChatModel) {
    if (chatModel.isBusy) {
        const confirmed = await XH.confirm({
            title: 'Clear conversation',
            message: 'Stop the reply in progress and clear the conversation?',
            confirmProps: {text: 'Clear', intent: 'danger'}
        });
        if (!confirmed) return;
    }
    chatModel.clear();
}
