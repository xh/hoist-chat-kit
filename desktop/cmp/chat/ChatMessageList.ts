import type {ReactElement, ReactNode} from 'react';
import {div, vbox} from '@xh/hoist/cmp/layout';
import {type BoxProps, hoistCmp, type HoistProps, useLocalModel, uses} from '@xh/hoist/core';
import {button} from '@xh/hoist/desktop/cmp/button';
import {Icon} from '@xh/hoist/icon';
import {useComposedRefs, useOnResize} from '@xh/hoist/utils/react';
import type {ChatImagePolicy, ChatMarkdownComponents} from '../../../cmp/markdown';
import {ChatModel} from '../../../core';
import '../../../styles/vars.scss';
import {chatEmptyState} from './ChatEmptyState';
import './ChatMessageList.scss';
import {type ChatMessageRenderFn, chatMessageView} from './ChatMessageView';
import type {ChatSuggestion} from './ChatSuggestions';
import {chatErrorBanner} from './impl/ChatErrorBanner';
import {ChatMessageListLocalModel} from './impl/ChatMessageListLocalModel';
import {refuseFileDrop} from './impl/FileDrop';

/** Props for {@link ChatMessageList}. */
export interface ChatMessageListProps extends HoistProps<ChatModel>, BoxProps {
    /** Content to show when the conversation has no messages, in place of the default. */
    emptyState?: ReactNode;

    /** Suggested prompts for the default empty state. */
    suggestions?: Array<ChatSuggestion | string>;

    /** Name shown on assistant messages. Default 'Assistant'. */
    assistantName?: string;

    /** Icon shown on assistant messages. Default a sparkles icon. */
    assistantIcon?: ReactElement;

    /**
     * Components to render in place of standard markdown elements in assistant messages. Pass a
     * stable object.
     */
    markdownComponents?: ChatMarkdownComponents;

    /**
     * Images in assistant messages to load. Default false: images show as links, as loading one
     * sends a request that could leak data - see {@link ChatMarkdownProps.allowImages}.
     */
    allowImages?: ChatImagePolicy;

    /**
     * Buttons to add to each message's action bar, after Copy, Edit and Regenerate - for example
     * thumbs up and down for feedback. Called for user and assistant messages, once a reply's turn
     * ends. Pass a stable function.
     */
    messageActions?: ChatMessageRenderFn;

    /**
     * Items to add to the header of each assistant message, after its name and time taken - for
     * example a model name or a cost. Pass a stable function.
     */
    messageHeaderItems?: ChatMessageRenderFn;
}

/**
 * The scrolling list of messages in a conversation, in a centered column.
 *
 * Follows a streaming reply by staying scrolled to the bottom, until the user scrolls up to read.
 * A button then offers a way back down. Sending a message always returns to the bottom.
 *
 * Shows an empty state when the conversation has no messages, and the error that ended the last
 * turn - with Retry and Edit - after the last message.
 */
export const [ChatMessageList, chatMessageList] = hoistCmp.withFactory<ChatMessageListProps>({
    displayName: 'ChatMessageList',
    model: uses(ChatModel),
    className: 'xh-chat-message-list',

    render(
        {
            model,
            className,
            emptyState,
            suggestions,
            assistantName,
            assistantIcon,
            markdownComponents,
            allowImages,
            messageActions,
            messageHeaderItems,
            ...rest
        },
        ref
    ) {
        const impl = useLocalModel(ChatMessageListLocalModel),
            viewportRef = useComposedRefs<HTMLDivElement>(
                useOnResize(impl.onViewportResize),
                impl.viewportRef
            ),
            contentRef = useOnResize(impl.onContentResize),
            {messages, isEmpty, isBusy} = model,
            lastIdx = messages.length - 1;

        return vbox({
            ref,
            className,
            onDragOver: refuseFileDrop,
            onDrop: refuseFileDrop,
            ...rest,
            items: [
                div({
                    ref: viewportRef,
                    className: 'xh-chat-message-list__viewport',
                    role: 'log',
                    'aria-label': 'Conversation',
                    'aria-busy': isBusy,
                    onScroll: impl.onScroll,
                    onWheel: impl.onWheel,
                    onClickCapture: impl.onClickCapture,
                    item: div({
                        ref: contentRef,
                        className: 'xh-chat-message-list__content',
                        items: isEmpty
                            ? [emptyState ?? chatEmptyState({suggestions})]
                            : [
                                  ...messages.map((message, idx) =>
                                      chatMessageView({
                                          key: message.id,
                                          message,
                                          chatModel: model,
                                          isLast: idx === lastIdx,
                                          assistantName,
                                          assistantIcon,
                                          markdownComponents,
                                          allowImages,
                                          messageActions,
                                          messageHeaderItems,
                                          isEditing: impl.editingId === message.id,
                                          onEditingChange: impl.onEditingChange
                                      })
                                  ),
                                  chatErrorBanner({key: 'error', onEdit: impl.editLastUserMessage})
                              ]
                    })
                }),
                impl.isAtBottom
                    ? null
                    : div({
                          className: 'xh-chat-message-list__scroll-button',
                          item: button({
                              icon: Icon.arrowDown(),
                              tooltip: 'Scroll to bottom',
                              'aria-label': 'Scroll to bottom',
                              onClick: () => impl.scrollToBottom(true)
                          })
                      })
            ]
        });
    }
});
