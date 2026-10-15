import {isString} from 'lodash';
import type {ReactElement} from 'react';
import {div, span} from '@xh/hoist/cmp/layout';
import {hoistCmp, type HoistProps, uses} from '@xh/hoist/core';
import {button} from '@xh/hoist/desktop/cmp/button';
import {ChatComposerModel, ChatModel} from '../../../core';
import '../../../styles/vars.scss';
import './ChatSuggestions.scss';

/** A suggested prompt, shown as a card that fills the composer with it. */
export interface ChatSuggestion {
    /** Label for the card. */
    text: string;

    /** A line under the label, saying what the prompt finds. */
    description?: string;

    /** Message to put in the composer when clicked. Defaults to `text`. */
    prompt?: string;

    /** Icon for the card. */
    icon?: ReactElement;
}

/** Props for {@link ChatSuggestions}. */
export interface ChatSuggestionsProps extends HoistProps<ChatModel> {
    /** Prompts to offer, as specs or as plain strings. */
    suggestions: Array<ChatSuggestion | string>;

    /** Called with the suggestion the user clicks, in place of filling the composer. */
    onSelect?: (suggestion: ChatSuggestion) => void;

    /**
     * The composer that a click fills, for a layout with no `ChatModel` - see
     * `ChatComposerHost`. Default the composer of the `ChatModel` from props or context.
     */
    composerModel?: ChatComposerModel;
}

/**
 * Suggested prompts, as cards with an icon, a label and an optional description. A click puts
 * the prompt in the composer and focuses it, and never sends it, so that the user reads and can
 * edit the prompt first. The cards hide once the composer has text, and show again if it empties.
 * Pass `onSelect` to act on a click in place of filling the composer.
 *
 * Renders nothing with no composer to fill - from `composerModel`, or a `ChatModel` in props or
 * context - and no `onSelect`.
 */
export const [ChatSuggestions, chatSuggestions] = hoistCmp.withFactory<ChatSuggestionsProps>({
    displayName: 'ChatSuggestions',
    model: uses(ChatModel, {optional: true}),
    className: 'xh-chat-suggestions',

    render({model, className, suggestions, onSelect, composerModel}, ref) {
        const composer = composerModel ?? model?.composerModel ?? null;
        if (!suggestions?.length || (!composer && !onSelect) || composer?.text) return null;

        return div({
            ref,
            className,
            items: suggestions.map((it, idx) => {
                const suggestion: ChatSuggestion = isString(it) ? {text: it} : it;
                return button({
                    key: `${idx}-${suggestion.text}`,
                    className: 'xh-chat-suggestions__card',
                    icon: suggestion.icon,
                    text: span({
                        className: 'xh-chat-suggestions__body',
                        items: [
                            span({
                                className: 'xh-chat-suggestions__label',
                                item: suggestion.text
                            }),
                            suggestion.description
                                ? span({
                                      className: 'xh-chat-suggestions__description',
                                      item: suggestion.description
                                  })
                                : null
                        ]
                    }),
                    minimal: true,
                    onClick: () => {
                        if (onSelect) {
                            onSelect(suggestion);
                            return;
                        }
                        composer.text = suggestion.prompt ?? suggestion.text;
                        composer.focus();
                    }
                });
            })
        });
    }
});
