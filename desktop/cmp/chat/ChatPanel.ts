import type {ReactNode} from 'react';
import {div} from '@xh/hoist/cmp/layout';
import {hoistCmp, type HoistProps, uses} from '@xh/hoist/core';
import {panel, type PanelProps} from '@xh/hoist/desktop/cmp/panel';
import {getTestId} from '@xh/hoist/utils/js';
import type {ChatImagePolicy, ChatMarkdownPlugins} from '../../../cmp/markdown';
import {ChatModel} from '../../../core';
import '../../../styles/vars.scss';
import {chatComposer, type ChatComposerProps} from './ChatComposer';
import {chatMessageList, type ChatMessageListProps} from './ChatMessageList';
import type {ChatSourceClickFn} from './ChatMessageView';
import './ChatPanel.scss';
import type {ChatSuggestion} from './ChatSuggestions';
import {refuseFileDrop} from './impl/FileDrop';

/** Props for {@link ChatPanel}. */
export interface ChatPanelProps
    extends HoistProps<ChatModel>, Omit<PanelProps, 'model' | 'modelConfig' | 'modelRef'> {
    /** Content to show when the conversation has no messages, in place of the default. */
    emptyState?: ReactNode;

    /** Suggested prompts for the default empty state. */
    suggestions?: Array<ChatSuggestion | string>;

    /**
     * Images in assistant messages to load. Default false: images show as links, as loading one
     * sends a request that could leak data. See {@link ChatMarkdownProps.allowImages}.
     */
    allowImages?: ChatImagePolicy;

    /**
     * True to render citation markers in assistant text, such as `[1]`, as buttons for the sources
     * they cite. See {@link ChatMessageListProps.citationMarkers}. Default false.
     */
    citationMarkers?: boolean;

    /**
     * Called when the user clicks a source, a citation chip or a citation marker. Default opens the
     * source's `url` in a new tab. Pass a stable function.
     */
    onSourceClick?: ChatSourceClickFn;

    /**
     * Plugins to add to the markdown pipeline of assistant messages, such as those for math. See
     * {@link ChatMarkdownPlugins}. Pass a stable object.
     */
    markdownPlugins?: ChatMarkdownPlugins;

    /** Props for the composer - for example `placeholder`, or `leftItems` for a model picker. */
    composerProps?: Omit<ChatComposerProps, 'model' | 'modelConfig' | 'modelRef'>;

    /**
     * Props for the message list - for example `assistantName`, or `messageActions` to add
     * feedback buttons to each message.
     */
    messageListProps?: Omit<ChatMessageListProps, 'model' | 'modelConfig' | 'modelRef'>;
}

/**
 * A complete chat: the message list above the composer, in a Hoist {@link Panel}.
 *
 * The quickest way to put a {@link ChatModel} on screen. Accepts all Panel props - `title`,
 * `icon`, `headerItems`, `tbar`, `compactHeader` and so on - for the surrounding chrome. For a
 * custom layout, compose a {@link ChatMessageList} and a {@link ChatComposer} directly.
 *
 * To make the chat collapsible or resizable, wrap it in a panel that owns a `PanelModel` -
 * `panel({modelConfig: {side: 'right', defaultSize: 420}, item: chatPanel({model})})`.
 */
export const [ChatPanel, chatPanel] = hoistCmp.withFactory<ChatPanelProps>({
    displayName: 'ChatPanel',
    model: uses(ChatModel),
    className: 'xh-chat-panel',

    render(props, ref) {
        const {
            model,
            emptyState,
            suggestions,
            allowImages,
            citationMarkers,
            onSourceClick,
            markdownPlugins,
            composerProps,
            messageListProps,
            testId,
            ...rest
        } = props;

        return panel({
            ref,
            testId,
            ...rest,
            items: [
                chatMessageList({
                    model,
                    emptyState,
                    suggestions,
                    allowImages,
                    citationMarkers,
                    onSourceClick,
                    markdownPlugins,
                    testId: getTestId(testId, 'messages'),
                    ...messageListProps
                }),
                div({
                    className: 'xh-chat-panel__footer',
                    onDragOver: refuseFileDrop,
                    onDrop: refuseFileDrop,
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
