import type {ReactNode} from 'react';
import {div} from '@xh/hoist/cmp/layout';
import {hoistCmp, type HoistProps, uses} from '@xh/hoist/core';
import {panel, type PanelProps} from '@xh/hoist/desktop/cmp/panel';
import {getTestId} from '@xh/hoist/utils/js';
import {ChatModel} from '../../../core';
import '../../../styles/vars.scss';
import {chatComposer, type ChatComposerProps} from './ChatComposer';
import {chatMessageList, type ChatMessageListProps} from './ChatMessageList';
import './ChatPanel.scss';
import type {ChatSuggestion} from './ChatSuggestions';

export interface ChatPanelProps
    extends HoistProps<ChatModel>, Omit<PanelProps, 'model' | 'modelConfig' | 'modelRef'> {
    /** Content to show when the conversation has no messages, in place of the default. */
    emptyState?: ReactNode;

    /** Suggested prompts for the default empty state. */
    suggestions?: Array<ChatSuggestion | string>;

    /** Props for the composer - for example, `leftItems` for a model picker. */
    composerProps?: Omit<ChatComposerProps, 'model' | 'modelConfig' | 'modelRef'>;

    /** Props for the message list - for example, `assistantName`. */
    messageListProps?: Omit<ChatMessageListProps, 'model' | 'modelConfig' | 'modelRef'>;
}

/**
 * A complete chat: the message list above the composer, in a Hoist {@link Panel}.
 *
 * The quickest way to put a {@link ChatModel} on screen. Accepts all Panel props - `title`,
 * `icon`, `headerItems`, `tbar`, `compactHeader` and so on - for the surrounding chrome. For a
 * custom layout, compose a {@link ChatMessageList} and a {@link ChatComposer} directly.
 */
export const [ChatPanel, chatPanel] = hoistCmp.withFactory<ChatPanelProps>({
    displayName: 'ChatPanel',
    model: uses(ChatModel),
    className: 'xh-chat-panel',

    render(props, ref) {
        const {model, emptyState, suggestions, composerProps, messageListProps, testId, ...rest} =
            props;

        return panel({
            ref,
            testId,
            ...rest,
            items: [
                chatMessageList({
                    model,
                    emptyState,
                    suggestions,
                    testId: getTestId(testId, 'messages'),
                    ...messageListProps
                }),
                div({
                    className: 'xh-chat-panel__footer',
                    item: chatComposer({
                        model: model.composerModel,
                        testId: getTestId(testId, 'composer'),
                        ...composerProps
                    })
                })
            ]
        });
    }
});
