import {isString} from 'lodash';
import type {ReactElement} from 'react';
import {div} from '@xh/hoist/cmp/layout';
import {hoistCmp, type HoistProps, uses} from '@xh/hoist/core';
import {button} from '@xh/hoist/desktop/cmp/button';
import {ChatModel} from '../../../core';
import '../../../styles/vars.scss';
import './ChatSuggestions.scss';

/** A suggested prompt, shown as a chip that sends it. */
export interface ChatSuggestion {
    /** Label for the chip. */
    text: string;

    /** Message to send when clicked. Defaults to `text`. */
    prompt?: string;

    /** Icon for the chip. */
    icon?: ReactElement;
}

export interface ChatSuggestionsProps extends HoistProps<ChatModel> {
    /** Prompts to offer, as specs or as plain strings. */
    suggestions: Array<ChatSuggestion | string>;

    /** Called with the suggestion the user clicks, in place of sending it. */
    onSelect?: (suggestion: ChatSuggestion) => void;
}

/**
 * Suggested prompts, as chips that send the prompt when clicked. Disabled while a reply is in
 * progress.
 */
export const [ChatSuggestions, chatSuggestions] = hoistCmp.withFactory<ChatSuggestionsProps>({
    displayName: 'ChatSuggestions',
    model: uses(ChatModel),
    className: 'xh-chat-suggestions',

    render({model, className, suggestions, onSelect}) {
        if (!suggestions?.length) return null;

        return div({
            className,
            items: suggestions.map(it => {
                const suggestion: ChatSuggestion = isString(it) ? {text: it} : it;
                return button({
                    key: suggestion.text,
                    className: 'xh-chat-suggestions__chip',
                    text: suggestion.text,
                    icon: suggestion.icon,
                    outlined: true,
                    disabled: model.isBusy,
                    onClick: () =>
                        onSelect
                            ? onSelect(suggestion)
                            : model.sendAsync(suggestion.prompt ?? suggestion.text).catchDefault()
                });
            })
        });
    }
});
