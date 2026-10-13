import {code, div, pre, span} from '@xh/hoist/cmp/layout';
import {hoistCmp, type HoistProps} from '@xh/hoist/core';
import '../../../styles/vars.scss';
import './ChatCodeBlock.scss';
import {chatCopyButton} from './impl/ChatCopyButton';

export interface ChatCodeBlockProps extends HoistProps {
    /** Source code to display. */
    content: string;

    /** Language of the code, as given on a markdown fence - shown as the block's label. */
    language?: string;
}

/**
 * A block of code, with its language and a copy button in a header bar. Long lines scroll
 * horizontally rather than wrap.
 *
 * Renders fenced code blocks in chat messages, and may be used directly to show code or data.
 */
export const [ChatCodeBlock, chatCodeBlock] = hoistCmp.withFactory<ChatCodeBlockProps>({
    displayName: 'ChatCodeBlock',
    model: false,
    className: 'xh-chat-code-block',

    render({className, content, language}) {
        return div({
            className,
            items: [
                div({
                    className: 'xh-chat-code-block__header',
                    items: [
                        span({
                            className: 'xh-chat-code-block__language',
                            item: language || 'text'
                        }),
                        chatCopyButton({getCopyText: () => content, showText: true})
                    ]
                }),
                pre({
                    className: 'xh-chat-code-block__body',
                    item: code({
                        className: language ? `language-${language}` : undefined,
                        item: content
                    })
                })
            ]
        });
    }
});
