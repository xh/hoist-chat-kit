import type {ReactElement, ReactNode} from 'react';
import {div} from '@xh/hoist/cmp/layout';
import {hoistCmp, type HoistProps} from '@xh/hoist/core';
import {Icon} from '@xh/hoist/icon';
import {withDefault} from '@xh/hoist/utils/js';
import '../../../styles/vars.scss';
import './ChatEmptyState.scss';
import {type ChatSuggestion, chatSuggestions} from './ChatSuggestions';

/** Props for {@link ChatEmptyState}. */
export interface ChatEmptyStateProps extends HoistProps {
    /** Icon above the title. Default a sparkles icon. Set to null for none. */
    icon?: ReactElement;

    /** Heading. Default 'How can I help?'. */
    title?: ReactNode;

    /** Supporting text below the heading - for example, what the assistant can do. */
    text?: ReactNode;

    /** Suggested prompts, shown as chips that send them. */
    suggestions?: Array<ChatSuggestion | string>;
}

/**
 * Welcome content for a conversation with no messages: an icon, a heading, supporting text and
 * suggested prompts. Any children render below the suggestions.
 *
 * Must be rendered within a {@link ChatModel} context for its suggestions to send, as it is by
 * {@link ChatMessageList}.
 */
export const [ChatEmptyState, chatEmptyState] = hoistCmp.withFactory<ChatEmptyStateProps>({
    displayName: 'ChatEmptyState',
    model: false,
    className: 'xh-chat-empty-state',

    render({className, icon, title, text, suggestions, children}, ref) {
        icon = withDefault(icon, Icon.ai());
        title = withDefault(title, 'How can I help?');

        return div({
            ref,
            className,
            items: [
                icon ? div({className: 'xh-chat-empty-state__icon', item: icon}) : null,
                title ? div({className: 'xh-chat-empty-state__title', item: title}) : null,
                text ? div({className: 'xh-chat-empty-state__text', item: text}) : null,
                suggestions?.length ? chatSuggestions({suggestions}) : null,
                children
            ]
        });
    }
});
