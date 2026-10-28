import {div, span} from '@xh/hoist/cmp/layout';
import {creates, hoistCmp, HoistModel, type HoistProps} from '@xh/hoist/core';
import {button} from '@xh/hoist/desktop/cmp/button';
import {Icon} from '@xh/hoist/icon';
import {action, observable} from '@xh/hoist/mobx';
import {
    type ChatImagePolicy,
    type ChatMarkdownComponents,
    type ChatMarkdownPlugins,
    chatMarkdown
} from '../../../cmp/markdown';
import type {ChatReasoningPart} from '../../../core';
import '../../../styles/vars.scss';
import './ChatReasoning.scss';
import {formatElapsed} from './impl/ChatFormat';
import {classNames} from '../../../impl/ClassNames';
import {useChatMarkdownComponents} from './ChatMarkdownComponents';

/** Props for {@link ChatReasoning}. */
export interface ChatReasoningProps extends HoistProps {
    /** The reasoning part to show. */
    part: ChatReasoningPart;

    /** Components to render in place of standard markdown elements. Pass a stable object. */
    markdownComponents?: ChatMarkdownComponents;

    /** Images to load in the reasoning text - see {@link ChatMarkdownProps.allowImages}. */
    allowImages?: ChatImagePolicy;

    /** Plugins to add to the markdown pipeline. Pass a stable object. */
    markdownPlugins?: ChatMarkdownPlugins;
}

/**
 * The model's reasoning ahead of its answer, as a quiet disclosure: a meta-size line with no frame,
 * "Thinking…" while it streams and "Thought for 12s" once done. Collapsed by default. It opens in
 * place, with the reasoning text indented below.
 *
 * Reasoning with no text to show - a provider that sends it only in encrypted form - renders
 * nothing. The message view reports its duration in the message header instead.
 */
export const [ChatReasoning, chatReasoning] = hoistCmp.withFactory<ChatReasoningProps>({
    displayName: 'ChatReasoning',
    className: 'xh-chat-reasoning',
    // Its own model, kept out of context, so that it needs no model above it.
    model: creates(() => new ChatReasoningLocalModel(), {publishMode: 'none'}),

    render({model, className, part, markdownComponents, markdownPlugins, allowImages}, ref) {
        const impl = model as ChatReasoningLocalModel,
            components = useChatMarkdownComponents(markdownComponents),
            {text, state} = part,
            isStreaming = state === 'streaming';

        if (!text?.trim()) return null;

        const {isExpanded} = impl;
        return div({
            ref,
            className: classNames(className, {
                'xh-chat-reasoning--streaming': isStreaming,
                'xh-chat-reasoning--expanded': isExpanded
            }),
            items: [
                button({
                    className: 'xh-chat-reasoning__toggle',
                    icon: isExpanded ? Icon.groupRowExpanded() : Icon.groupRowCollapsed(),
                    text: span({
                        className: 'xh-chat-reasoning__label',
                        item: isStreaming ? 'Thinking…' : getDoneLabel(part)
                    }),
                    'aria-expanded': isExpanded,
                    onClick: () => impl.setExpanded(!isExpanded)
                }),
                isExpanded
                    ? div({
                          className: 'xh-chat-reasoning__body',
                          item: chatMarkdown({
                              content: text,
                              isStreaming,
                              components,
                              markdownPlugins,
                              allowImages
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
class ChatReasoningLocalModel extends HoistModel {
    override xhImpl = true;

    /** True while the user has the reasoning open. Closed by default. */
    @observable accessor isExpanded = false;

    @action
    setExpanded(isExpanded: boolean) {
        this.isExpanded = isExpanded;
    }
}

function getDoneLabel({startedAt, endedAt}: ChatReasoningPart): string {
    const elapsed = startedAt != null && endedAt != null ? endedAt - startedAt : null;
    if (elapsed == null) return 'Thought process';
    return elapsed < 1000 ? 'Thought briefly' : `Thought for ${formatElapsed(elapsed)}`;
}
