import {hoistCmp, HoistModel, type HoistProps, useLocalModel, XH} from '@xh/hoist/core';
import {button} from '@xh/hoist/desktop/cmp/button';
import {Icon} from '@xh/hoist/icon';
import {action, observable} from '@xh/hoist/mobx';
import {copyToClipboard, debounced} from '@xh/hoist/utils/js';

interface ChatCopyButtonProps extends HoistProps {
    /** Function returning the text to copy. */
    getCopyText: () => string;

    /** True to label the button "Copy" / "Copied", rather than show an icon alone. */
    showText?: boolean;
}

/**
 * Copy button that confirms in place - its icon turns to a check for a moment once the copy
 * succeeds - rather than with a toast, which would draw the eye away from the message.
 * @internal
 */
export const chatCopyButton = hoistCmp.factory<ChatCopyButtonProps>({
    displayName: 'ChatCopyButton',
    className: 'xh-chat-copy-button',

    render({className, getCopyText, showText = false}) {
        const impl = useLocalModel(ChatCopyButtonLocalModel),
            label = impl.copied ? 'Copied' : 'Copy';

        return button({
            className,
            icon: impl.copied ? Icon.check() : Icon.copy(),
            text: showText ? label : null,
            tooltip: showText ? null : label,
            'aria-label': showText ? null : label,
            onClick: () => impl.copyAsync(getCopyText())
        });
    }
});

class ChatCopyButtonLocalModel extends HoistModel {
    override xhImpl = true;

    @observable accessor copied = false;

    async copyAsync(text: string) {
        try {
            await copyToClipboard(text);
            this.setCopied(true);
            this.resetCopied();
        } catch (e) {
            XH.handleException(e, {
                message: 'Could not copy to the clipboard.',
                alertType: 'toast',
                logOnServer: false
            });
        }
    }

    @action
    private setCopied(copied: boolean) {
        this.copied = copied;
    }

    @debounced(1500)
    private resetCopied() {
        this.setCopied(false);
    }
}
