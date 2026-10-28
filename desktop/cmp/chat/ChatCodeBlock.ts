import {code, div, pre, span} from '@xh/hoist/cmp/layout';
import {creates, hoistCmp, HoistModel, type HoistProps} from '@xh/hoist/core';
import {button} from '@xh/hoist/desktop/cmp/button';
import {action, observable} from '@xh/hoist/mobx';
import {pluralize} from '@xh/hoist/utils/js';
import '../../../styles/vars.scss';
import './ChatCodeBlock.scss';
import {chatCopyButton} from './ChatCopyButton';

/** Props for {@link ChatCodeBlock}. */
export interface ChatCodeBlockProps extends HoistProps {
    /** Source code to display. */
    content: string;

    /** Language of the code, as given on a markdown fence - shown as the block's label. */
    language?: string;

    /** True while the code still streams. The block shows in full until it ends. */
    isStreaming?: boolean;
}

/**
 * A block of code in a card: a header strip with its language and a Copy button, over the code
 * in a single `pre`. Long lines scroll sideways rather than wrap. A block of more than 20 lines
 * shows its first 20, with a button to show the rest and then to show fewer - once it has
 * finished streaming. A final newline counts as no line.
 *
 * Renders fenced code blocks in chat messages, and may be used directly to show code or data. It
 * needs no model in context, and sets its own font size and line height.
 */
export const [ChatCodeBlock, chatCodeBlock] = hoistCmp.withFactory<ChatCodeBlockProps>({
    displayName: 'ChatCodeBlock',
    className: 'xh-chat-code-block',
    // Its own model, kept out of context, so that it needs no model above it.
    model: creates(() => new ChatCodeBlockLocalModel(), {publishMode: 'none'}),

    render({model, className, content, language, isStreaming = false}, ref) {
        const impl = model as ChatCodeBlockLocalModel,
            text = (content ?? '').replace(/\n$/, ''),
            lines = text.split('\n'),
            extraCount = isStreaming ? 0 : Math.max(0, lines.length - COLLAPSED_LINES),
            isCollapsed = extraCount > 0 && !impl.isExpanded,
            shown = isCollapsed ? lines.slice(0, COLLAPSED_LINES).join('\n') : text;

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
                // One button that stays in place, so that keyboard focus stays on it.
                extraCount
                    ? div({
                          className: 'xh-chat-code-block__footer',
                          item: button({
                              text: isCollapsed
                                  ? `Show ${pluralize('more line', extraCount, true)}`
                                  : 'Show fewer lines',
                              'aria-expanded': !isCollapsed,
                              onClick: () => impl.setExpanded(isCollapsed)
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
