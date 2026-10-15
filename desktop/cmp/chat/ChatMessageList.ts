import type {ReactElement, ReactNode} from 'react';
import {div, vbox} from '@xh/hoist/cmp/layout';
import {type BoxProps, hoistCmp, type HoistProps, useLocalModel, uses} from '@xh/hoist/core';
import {button} from '@xh/hoist/desktop/cmp/button';
import {Icon} from '@xh/hoist/icon';
import {throwIf} from '@xh/hoist/utils/js';
import {useComposedRefs, useOnResize} from '@xh/hoist/utils/react';
import type {
    ChatImagePolicy,
    ChatMarkdownComponents,
    ChatMarkdownPlugins
} from '../../../cmp/markdown';
import {type ChatMessage, ChatModel, type ChatTranscript, isChatModel} from '../../../core';
import '../../../styles/vars.scss';
import {chatEmptyState} from './ChatEmptyState';
import './ChatMessageList.scss';
import {type ChatMessageRenderFn, type ChatSourceClickFn, chatMessageView} from './ChatMessageView';
import type {ChatSuggestion} from './ChatSuggestions';
import {chatAnnouncerRegions} from './impl/ChatAnnouncerRegions';
import {chatErrorBoundary} from './impl/ChatErrorBoundary';
import type {ChatAnnounceSteps} from './impl/ChatStepAnnouncer';
import {ChatMessageListLocalModel} from './impl/ChatMessageListLocalModel';
import {refuseFileDrop} from './impl/FileDrop';
import {getFailureCause, isReplyNotSent} from './impl/ReplyFailure';

/** Props for {@link ChatMessageList}. */
export interface ChatMessageListProps extends HoistProps<ChatModel>, BoxProps {
    /**
     * A read-only conversation to show in place of a `ChatModel` - an app's own
     * {@link ChatTranscript}. Default the list's `ChatModel`, from props or context.
     */
    host?: ChatTranscript;

    /** Content to show when the conversation has no messages, in place of the default. */
    emptyState?: ReactNode;

    /**
     * Suggested prompts for the default empty state. They fill the chat's composer, and show only
     * when the list shows a `ChatModel`.
     */
    suggestions?: Array<ChatSuggestion | string>;

    /** Name shown on assistant messages. Default 'Assistant'. */
    assistantName?: string;

    /** Icon shown on assistant messages. Default from `ChatKit.defaults.assistantIcon`. */
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
     * True to render citation markers in assistant text, such as `[1]` and `[1, 2]`, as buttons for
     * the sources they cite. `[n]` cites the source with `marker` n, or the nth source when no
     * source has a marker. Default false.
     */
    citationMarkers?: boolean;

    /**
     * Called when the user clicks a source in a reply's source list, a citation chip or a citation
     * marker - for example to open a document in the app's own viewer. Default opens the source's
     * `url` in a new tab. Pass a stable function.
     */
    onSourceClick?: ChatSourceClickFn;

    /**
     * Plugins to add to the markdown pipeline of assistant messages, after the kit's own - for
     * example `remark-math` and `rehype-katex` for math. Pass a stable object.
     */
    markdownPlugins?: ChatMarkdownPlugins;

    /**
     * Buttons to add to each message's action bar, after the built-in ones - Copy, Edit,
     * Regenerate, Undo and the feedback thumbs. Called for user and assistant messages, once a
     * reply's turn ends. Pass a stable function.
     */
    messageActions?: ChatMessageRenderFn;

    /**
     * Items to add to the header of each assistant message, after its name and time taken - for
     * example a model name or a cost. Pass a stable function.
     */
    messageHeaderItems?: ChatMessageRenderFn;

    /**
     * Which steps of a running reply the screen reader announcer reads as they finish: none,
     * failures or all. Default from `ChatKit.defaults.announceSteps`.
     */
    announceSteps?: ChatAnnounceSteps;
}

/**
 * The scrolling list of messages in a conversation, in a centered column.
 *
 * Shows a `ChatModel`, from props or context, or any {@link ChatTranscript} passed as `host`.
 * A transcript renders read-only: its parts show, but actions such as Edit, Regenerate, feedback
 * and approvals need a `ChatModel`.
 *
 * Follows a streaming reply by staying scrolled to the bottom, until the user scrolls up to read.
 * A button then offers a way back down. Sending a message always returns to the bottom.
 *
 * Shows an empty state when the conversation has no messages. A failed reply shows what happened
 * inline, with Edit Prompt, and a message whose turn never started shows "Not sent". The thread's
 * next action, such as Try Again, belongs to the composer's status region.
 *
 * Each message is a focusable `article`. With one focused, Up and Down move between messages.
 * Escape stops a reply in progress while focus is in the list.
 *
 * The list is a `role="log"` region with `aria-live="off"`, so screen readers never hear tokens.
 * It renders the regions of the kit's announcer instead, which read each reply once as it
 * finishes: the assistant's name, its tool count and time, then its first paragraph. Steps that
 * fail while a reply runs are read too, or every step with `announceSteps: 'all'`.
 */
export const [ChatMessageList, chatMessageList] = hoistCmp.withFactory<ChatMessageListProps>({
    displayName: 'ChatMessageList',
    model: uses(ChatModel, {optional: true}),
    className: 'xh-chat-message-list',

    render(
        {
            model,
            host: hostProp,
            className,
            emptyState,
            suggestions,
            assistantName,
            assistantIcon,
            markdownComponents,
            allowImages,
            citationMarkers,
            onSourceClick,
            markdownPlugins,
            messageActions,
            messageHeaderItems,
            announceSteps,
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
            host: ChatTranscript = hostProp ?? model;
        throwIf(!host, 'ChatMessageList needs a ChatModel, or a host.');

        const {messages} = host,
            chatModel = isChatModel(host) ? host : null,
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
                    // A log for structure and navigation, which never speaks: the announcer's
                    // regions read finished replies, and never tokens.
                    role: 'log',
                    'aria-live': 'off',
                    'aria-label': 'Conversation',
                    'aria-busy': !!chatModel?.isBusy,
                    onScroll: impl.onScroll,
                    onWheel: impl.onWheel,
                    onClickCapture: impl.onClickCapture,
                    onKeyDown: impl.onKeyDown,
                    item: div({
                        ref: contentRef,
                        className: 'xh-chat-message-list__content',
                        items: !messages.length
                            ? [
                                  emptyState ??
                                      chatEmptyState({
                                          suggestions,
                                          composerModel: chatModel?.composerModel
                                      })
                              ]
                            : messages.map((message, idx) =>
                                  chatErrorBoundary({
                                      key: message.id,
                                      subject: 'message',
                                      resetKey: message.status,
                                      item: chatMessageView({
                                          message,
                                          host,
                                          isLast: idx === lastIdx,
                                          notSentReason: getNotSentReason(
                                              message,
                                              messages[idx + 1]
                                          ),
                                          assistantName,
                                          assistantIcon,
                                          markdownComponents,
                                          allowImages,
                                          citationMarkers,
                                          onSourceClick,
                                          markdownPlugins,
                                          messageActions,
                                          messageHeaderItems,
                                          announceSteps,
                                          isEditing: impl.editingId === message.id,
                                          onEditingChange: impl.onEditingChange,
                                          onEditPrompt: impl.onEditPrompt
                                      })
                                  })
                              )
                    })
                }),
                chatAnnouncerRegions(),
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

//------------------
// Implementation
//------------------
// Why a user message was never sent - the cause of the failed reply after it - or null.
function getNotSentReason(message: ChatMessage, next: ChatMessage): string {
    return message.isUser && isReplyNotSent(next) ? getFailureCause(next) : null;
}
