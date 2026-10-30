import type {ReactNode} from 'react';
import {div} from '@xh/hoist/cmp/layout';
import {hoistCmp, type HoistProps, uses} from '@xh/hoist/core';
import {panel, type PanelProps} from '@xh/hoist/desktop/cmp/panel';
import {getTestId} from '@xh/hoist/utils/js';
import type {ChatImagePolicy, ChatMarkdownPlugins} from '../../../cmp/markdown';
import {ChatModel} from '../../../core';
import {classNames} from '../../../impl/ClassNames';
import '../../../styles/vars.scss';
import {chatComposer, type ChatComposerProps} from './ChatComposer';
import {chatEmptyState, type ChatEmptyStateProps} from './ChatEmptyState';
import {chatMessageList, type ChatMessageListProps} from './ChatMessageList';
import type {ChatSourceClickFn} from './ChatMessageView';
import './ChatPanel.scss';
import '../../impl/ChatMotion.scss';
import {chatStatusRegion} from './ChatStatusRegion';
import {composerCenteredProvider} from './impl/ComposerPlacement';
import {type ChatSuggestion, chatSuggestions} from './ChatSuggestions';
import {refuseFileDrop} from './impl/FileDrop';
import {getChatHotkeys} from '../../impl/ChatShortcuts';

/** Props for {@link ChatPanel}. */
export interface ChatPanelProps
    extends HoistProps<ChatModel>, Omit<PanelProps, 'model' | 'modelConfig' | 'modelRef'> {
    /**
     * Content to show in the message list when the conversation has no messages, in place of the
     * default empty state. The composer then stays at the bottom.
     */
    emptyState?: ReactNode;

    /**
     * Heading, supporting text and icon of the default empty state - for example
     * `{title: 'What do you want to know?', text: 'Analyst answers from 38 policy documents.'}` -
     * and content of the app's own around it:
     *
     *  - `header` - above the heading, such as a logo.
     *  - `belowComposer` - right under the centered composer, above the suggestions, such as a
     *    line of help.
     *  - `footer` - at the foot of the space under the composer, such as a tagline.
     */
    emptyStateProps?: Pick<ChatEmptyStateProps, 'header' | 'title' | 'text' | 'icon' | 'footer'> & {
        belowComposer?: ReactNode;
    };

    /**
     * Suggested prompts for the default empty state, as cards under the composer. A click fills
     * the composer, and never sends.
     */
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
 * A complete chat: the message list, the status region and the composer, in a Hoist
 * {@link Panel}. The status region and composer share the message column's width.
 *
 * An empty conversation shows the default empty state, with the composer centered at about 40%
 * of the height: the heading and supporting text above it, and the suggestions below. Each
 * settles in, in that order - see the README's Motion section. The first send moves the composer
 * to the bottom in one frame, with no animation, and focus stays in it.
 * Pass `emptyState` to show other content in the list instead, with the composer at the bottom.
 *
 * With focus in the panel, outside a text field, `/` focuses the composer - see
 * `ChatKit.defaults.shortcuts`.
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
            className,
            emptyState,
            emptyStateProps,
            suggestions,
            allowImages,
            citationMarkers,
            onSourceClick,
            markdownPlugins,
            composerProps,
            messageListProps,
            testId,
            hotkeys,
            ...rest
        } = props;

        // The composer keeps its place in the tree across the move, so that it keeps focus.
        const isCentered = model.isEmpty && emptyState == null && !messageListProps?.emptyState,
            {footer, belowComposer, ...headProps} = emptyStateProps ?? {};
        return panel({
            ref,
            testId,
            className: classNames(className, {'xh-chat-panel--empty': isCentered}),
            hotkeys: [
                ...getChatHotkeys({focusComposer: () => model.composerModel.focus()}),
                ...(hotkeys ?? [])
            ],
            ...rest,
            items: [
                isCentered
                    ? div({
                          key: 'emptyHead',
                          className: 'xh-chat-panel__empty-head',
                          item: chatEmptyState(headProps)
                      })
                    : chatMessageList({
                          key: 'list',
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
                    key: 'footer',
                    // Centered, the composer settles in after the heading. Docked, it holds still.
                    className: classNames('xh-chat-panel__footer', {
                        'xh-chat-settle xh-chat-settle--2': isCentered
                    }),
                    onDragOver: refuseFileDrop,
                    onDrop: refuseFileDrop,
                    item: composerCenteredProvider({
                        value: isCentered,
                        items: [
                            chatStatusRegion({
                                model: model.composerModel,
                                assistantName: messageListProps?.assistantName
                            }),
                            chatComposer({
                                model: model.composerModel,
                                testId: getTestId(testId, 'composer'),
                                ...composerProps
                            })
                        ]
                    })
                }),
                isCentered
                    ? div({
                          key: 'emptyTail',
                          // The tail settles as one: the suggestions within it come and go as the
                          // composer fills and empties, and must not settle again.
                          className: 'xh-chat-panel__empty-tail xh-chat-settle xh-chat-settle--3',
                          items: [
                              belowComposer != null
                                  ? div({
                                        key: 'belowComposer',
                                        className: 'xh-chat-panel__below-composer',
                                        item: belowComposer
                                    })
                                  : null,
                              chatSuggestions({key: 'suggestions', model, suggestions}),
                              footer != null
                                  ? div({
                                        key: 'footer',
                                        className: 'xh-chat-empty-state__footer',
                                        item: footer
                                    })
                                  : null
                          ]
                      })
                    : null
            ]
        });
    }
});
