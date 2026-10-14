import {div, span} from '@xh/hoist/cmp/layout';
import {hoistCmp, HoistModel, type HoistProps, useLocalModel} from '@xh/hoist/core';
import {button} from '@xh/hoist/desktop/cmp/button';
import {Icon} from '@xh/hoist/icon';
import {action, observable} from '@xh/hoist/mobx';
import {
    type ChatImagePolicy,
    type ChatMarkdownComponents,
    chatMarkdown
} from '../../../cmp/markdown';
import type {ChatReasoningPart} from '../../../core';
import '../../../styles/vars.scss';
import './ChatReasoning.scss';
import {formatElapsed} from './impl/ChatFormat';
import {classNames} from '../../../impl/ClassNames';
import {useChatMarkdownComponents} from './impl/MarkdownComponents';

/** Props for {@link ChatReasoning}. */
export interface ChatReasoningProps extends HoistProps {
    /** The reasoning part to show. */
    part: ChatReasoningPart;

    /** Components to render in place of standard markdown elements. Pass a stable object. */
    markdownComponents?: ChatMarkdownComponents;

    /** Images to load in the reasoning text - see {@link ChatMarkdownProps.allowImages}. */
    allowImages?: ChatImagePolicy;
}

/**
 * The model's reasoning ahead of its answer, as a disclosure. Shows a shimmering "Thinking..."
 * and the reasoning text as it streams, then collapses to "Thought for 12s" once done. The user
 * can open or close it at any time.
 *
 * Reasoning with no text to show - a provider that sends it only in encrypted form - shows
 * "Thinking..." while it streams and nothing once done. The message view reports its duration in
 * the message header instead.
 */
export const [ChatReasoning, chatReasoning] = hoistCmp.withFactory<ChatReasoningProps>({
    displayName: 'ChatReasoning',
    className: 'xh-chat-reasoning',

    render({className, part, markdownComponents, allowImages}, ref) {
        const impl = useLocalModel(ChatReasoningLocalModel),
            components = useChatMarkdownComponents(markdownComponents),
            {text, state} = part,
            isStreaming = state === 'streaming',
            hasText = !!text?.trim();

        if (!hasText && !isStreaming) return null;

        const isExpanded = hasText && (impl.expanded ?? isStreaming),
            label = span({
                className: 'xh-chat-reasoning__label',
                item: isStreaming ? 'Thinking...' : getDoneLabel(part)
            }),
            icon = Icon.clock({className: 'xh-chat-reasoning__icon'});

        return div({
            ref,
            className: classNames(className, {
                'xh-chat-reasoning--streaming': isStreaming,
                'xh-chat-reasoning--expanded': isExpanded
            }),
            items: [
                hasText
                    ? button({
                          className: 'xh-chat-reasoning__toggle',
                          icon,
                          text: label,
                          rightIcon: isExpanded ? Icon.chevronUp() : Icon.chevronDown(),
                          'aria-expanded': isExpanded,
                          onClick: () => impl.setExpanded(!isExpanded)
                      })
                    : div({className: 'xh-chat-reasoning__toggle', items: [icon, label]}),
                isExpanded
                    ? div({
                          className: 'xh-chat-reasoning__body',
                          item: chatMarkdown({content: text, isStreaming, components, allowImages})
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

    /** Set once the user opens or closes the disclosure - until then it follows the stream. */
    @observable accessor expanded: boolean = null;

    @action
    setExpanded(expanded: boolean) {
        this.expanded = expanded;
    }
}

function getDoneLabel({startedAt, endedAt}: ChatReasoningPart): string {
    const elapsed = startedAt != null && endedAt != null ? endedAt - startedAt : null;
    if (elapsed == null) return 'Thought process';
    return elapsed < 1000 ? 'Thought briefly' : `Thought for ${formatElapsed(elapsed)}`;
}
