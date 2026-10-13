import {div, span} from '@xh/hoist/cmp/layout';
import {hoistCmp, HoistModel, type HoistProps, useLocalModel} from '@xh/hoist/core';
import {button} from '@xh/hoist/desktop/cmp/button';
import {Icon} from '@xh/hoist/icon';
import {action, observable} from '@xh/hoist/mobx';
import {chatMarkdown} from '../../../cmp/markdown';
import type {ChatReasoningPart} from '../../../core';
import '../../../styles/vars.scss';
import './ChatReasoning.scss';
import {formatElapsed} from './impl/ChatFormat';

export interface ChatReasoningProps extends HoistProps {
    /** The reasoning part to show. */
    part: ChatReasoningPart;
}

/**
 * The model's reasoning ahead of its answer, as a disclosure. Shows a shimmering "Thinking..."
 * and the reasoning text as it streams, then collapses to "Thought for 12s" once done. The user
 * can open or close it at any time.
 */
export const [ChatReasoning, chatReasoning] = hoistCmp.withFactory<ChatReasoningProps>({
    displayName: 'ChatReasoning',
    model: false,
    className: 'xh-chat-reasoning',

    render({className, part}) {
        const impl = useLocalModel(ChatReasoningLocalModel),
            {text, state} = part,
            isStreaming = state === 'streaming',
            hasText = !!text?.trim(),
            isExpanded = hasText && (impl.expanded ?? isStreaming),
            label = span({
                className: 'xh-chat-reasoning__label',
                item: isStreaming ? 'Thinking...' : getDoneLabel(part)
            });

        return div({
            className: isStreaming ? `${className} xh-chat-reasoning--streaming` : className,
            items: [
                hasText
                    ? button({
                          className: 'xh-chat-reasoning__toggle',
                          text: label,
                          rightIcon: isExpanded ? Icon.chevronUp() : Icon.chevronDown(),
                          'aria-expanded': isExpanded,
                          onClick: () => impl.setExpanded(!isExpanded)
                      })
                    : div({className: 'xh-chat-reasoning__toggle', item: label}),
                isExpanded
                    ? div({
                          className: 'xh-chat-reasoning__body',
                          item: chatMarkdown({content: text, isStreaming})
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
    return elapsed != null ? `Thought for ${formatElapsed(elapsed)}` : 'Thought process';
}
