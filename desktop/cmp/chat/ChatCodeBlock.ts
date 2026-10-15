import {code, div, pre, span} from '@xh/hoist/cmp/layout';
import {hoistCmp, HoistModel, type HoistProps, useLocalModel} from '@xh/hoist/core';
import {button} from '@xh/hoist/desktop/cmp/button';
import {action, observable} from '@xh/hoist/mobx';
import {pluralize} from '@xh/hoist/utils/js';
import '../../../styles/vars.scss';
import './ChatCodeBlock.scss';
import {chatCopyButton} from './impl/ChatCopyButton';

/** Props for {@link ChatCodeBlock}. */
export interface ChatCodeBlockProps extends HoistProps {
    /** Source code to display. */
    content: string;

    /** Language of the code, as given on a markdown fence - shown as the block's label. */
    language?: string;
}

/**
 * A block of code in a card: a header strip with its language and a Copy button, over the code
 * in a single `pre`. Long lines scroll sideways rather than wrap. A block of more than 20 lines
 * shows its first 20, with a button to show the rest.
 *
 * Renders fenced code blocks in chat messages, and may be used directly to show code or data.
 */
export const [ChatCodeBlock, chatCodeBlock] = hoistCmp.withFactory<ChatCodeBlockProps>({
    displayName: 'ChatCodeBlock',
    className: 'xh-chat-code-block',

    render({className, content, language}, ref) {
        const impl = useLocalModel(ChatCodeBlockLocalModel),
            lines = (content ?? '').split('\n'),
            hiddenCount = impl.isExpanded ? 0 : Math.max(0, lines.length - COLLAPSED_LINES),
            shown = hiddenCount ? lines.slice(0, COLLAPSED_LINES).join('\n') : content;

        return div({
            ref,
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
                        item: shown
                    })
                }),
                hiddenCount
                    ? div({
                          className: 'xh-chat-code-block__footer',
                          item: button({
                              text: `Show ${pluralize('more line', hiddenCount, true)}`,
                              onClick: () => impl.setExpanded(true)
                          })
                      })
                    : null
            ]
        });
    }
});

//------------------
// Implementation
//------------------
// A longer block shows this many lines until the user asks for the rest.
const COLLAPSED_LINES = 20;

class ChatCodeBlockLocalModel extends HoistModel {
    override xhImpl = true;

    @observable accessor isExpanded = false;

    @action
    setExpanded(isExpanded: boolean) {
        this.isExpanded = isExpanded;
    }
}
