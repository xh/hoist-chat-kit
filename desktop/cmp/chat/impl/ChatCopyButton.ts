import {hoistCmp, HoistModel, type HoistProps, useLocalModel} from '@xh/hoist/core';
import {clipboardButton} from '@xh/hoist/desktop/cmp/clipboard';
import {Icon} from '@xh/hoist/icon';
import {action, observable} from '@xh/hoist/mobx';
import {debounced} from '@xh/hoist/utils/js';

interface ChatCopyButtonProps extends HoistProps {
    /** Function returning the text to copy. */
    getCopyText: () => string;

    /** True to label the button "Copy" / "Copied", rather than show an icon alone. */
    showText?: boolean;
}

/**
 * Copy button that confirms in place - its icon turns to a check for a moment - rather than with
 * a toast, which would draw the eye away from the message.
 * @internal
 */
export const chatCopyButton = hoistCmp.factory<ChatCopyButtonProps>({
    displayName: 'ChatCopyButton',
    className: 'xh-chat-copy-button',

    render({className, getCopyText, showText = false}) {
        const impl = useLocalModel(ChatCopyButtonLocalModel),
            {copied} = impl;

        return clipboardButton({
            className,
            icon: copied ? Icon.check() : Icon.copy(),
            text: showText ? (copied ? 'Copied' : 'Copy') : null,
            tooltip: showText ? null : copied ? 'Copied' : 'Copy',
            getCopyText: () => {
                impl.noteCopied();
                return getCopyText();
            }
        });
    }
});

class ChatCopyButtonLocalModel extends HoistModel {
    override xhImpl = true;

    @observable accessor copied = false;

    @action
    noteCopied() {
        this.copied = true;
        this.resetCopied();
    }

    @debounced(1500)
    @action
    private resetCopied() {
        this.copied = false;
    }
}
