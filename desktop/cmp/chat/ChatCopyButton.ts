import {hoistCmp, HoistModel, type HoistProps, useLocalModel, XH} from '@xh/hoist/core';
import {button} from '@xh/hoist/desktop/cmp/button';
import {Icon} from '@xh/hoist/icon';
import {action, observable} from '@xh/hoist/mobx';
import {copyToClipboard} from '@xh/hoist/utils/js';

/** Props for {@link ChatCopyButton}. */
export interface ChatCopyButtonProps extends HoistProps {
    /** Function returning the text to copy. */
    getCopyText: () => string;

    /** True to label the button "Copy" / "Copied", rather than show an icon alone. */
    showText?: boolean;

    /** What the button copies, as its label or tooltip. Default 'Copy'. */
    label?: string;
}

/**
 * Copy button that confirms in place - its icon turns to a check for a moment once the copy
 * succeeds - rather than with a toast, which would draw the eye away from the message. The kit's
 * message actions, code blocks and side panel use it. It needs no `ChatModel`, so an app can put
 * it in a message footer of its own.
 */
export const [ChatCopyButton, chatCopyButton] = hoistCmp.withFactory<ChatCopyButtonProps>({
    displayName: 'ChatCopyButton',
    className: 'xh-chat-copy-button',

    render({className, getCopyText, showText = false, label: copyLabel = 'Copy'}) {
        const impl = useLocalModel(ChatCopyButtonLocalModel),
            label = impl.copied ? 'Copied' : copyLabel;

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
            clearTimeout(this.resetTimer);
            this.resetTimer = setTimeout(() => this.setCopied(false), 1500);
        } catch (e) {
            XH.handleException(e, {
                message: 'Could not copy to the clipboard.',
                alertType: 'toast',
                logOnServer: false
            });
        }
    }

    override destroy() {
        clearTimeout(this.resetTimer);
        super.destroy();
    }

    private resetTimer: ReturnType<typeof setTimeout> = null;

    @action
    private setCopied(copied: boolean) {
        this.copied = copied;
    }
}
