import type {ReactElement, ReactNode} from 'react';
import {div, span} from '@xh/hoist/cmp/layout';
import {hoistCmp, type HoistProps} from '@xh/hoist/core';
import {withDefault} from '@xh/hoist/utils/js';
import {ChatKit} from '../../../core';
import '../../../styles/vars.scss';
import './ChatEmptyState.scss';
import {type ChatSuggestion, chatSuggestions} from './ChatSuggestions';

/** Props for {@link ChatEmptyState}. */
export interface ChatEmptyStateProps extends HoistProps {
    /**
     * Icon that leads the supporting text. Default from `ChatKit.defaults.assistantIcon`. Set to
     * null for none.
     */
    icon?: ReactElement;

    /** Heading. Default 'How can I help?'. */
    title?: ReactNode;

    /**
     * Supporting text below the heading, saying who answers and from what - for example "Analyst
     * answers from loan data and 38 policy documents."
     */
    text?: ReactNode;

    /** Suggested prompts, shown as cards that fill the composer. */
    suggestions?: Array<ChatSuggestion | string>;
}

/**
 * Welcome content for a conversation with no messages: a heading, a line on what the assistant
 * can do, and suggested prompts. Any children render below the suggestions. It shows no
 * illustration - the supporting text carries the assistant's identity.
 *
 * `ChatPanel` renders its own empty state, with the composer centered between the heading and the
 * suggestions. Render this one where the message list shows it, or in a custom layout. Must be
 * rendered within a {@link ChatModel} context for its suggestions to fill the composer.
 */
export const [ChatEmptyState, chatEmptyState] = hoistCmp.withFactory<ChatEmptyStateProps>({
    displayName: 'ChatEmptyState',
    model: false,
    className: 'xh-chat-empty-state',

    render({className, icon, title, text, suggestions, children}, ref) {
        icon = withDefault(icon, ChatKit.defaults.assistantIcon());
        title = withDefault(title, 'How can I help?');

        return div({
            ref,
            className,
            items: [
                title ? div({className: 'xh-chat-empty-state__title', item: title}) : null,
                text
                    ? div({
                          className: 'xh-chat-empty-state__text',
                          items: [
                              icon
                                  ? span({className: 'xh-chat-empty-state__icon', item: icon})
                                  : null,
                              span({item: text})
                          ]
                      })
                    : null,
                suggestions?.length ? chatSuggestions({suggestions}) : null,
                children
            ]
        });
    }
});
