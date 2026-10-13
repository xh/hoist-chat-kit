import {findLast} from 'lodash';
import type {ReactElement, ReactNode, WheelEvent} from 'react';
import {div} from '@xh/hoist/cmp/layout';
import {
    hoistCmp,
    HoistModel,
    type HoistProps,
    type LayoutProps,
    type TestSupportProps,
    useLocalModel,
    uses
} from '@xh/hoist/core';
import {button} from '@xh/hoist/desktop/cmp/button';
import {Icon} from '@xh/hoist/icon';
import {action, observable} from '@xh/hoist/mobx';
import {TEST_ID} from '@xh/hoist/utils/js';
import {
    createObservableRef,
    getLayoutProps,
    useComposedRefs,
    useOnResize
} from '@xh/hoist/utils/react';
import type {ChatMarkdownComponents} from '../../../cmp/markdown';
import {type ChatMessage, ChatModel} from '../../../core';
import '../../../styles/vars.scss';
import {chatEmptyState} from './ChatEmptyState';
import {chatErrorBanner} from './ChatErrorBanner';
import './ChatMessageList.scss';
import {chatMessageView} from './ChatMessageView';
import type {ChatSuggestion} from './ChatSuggestions';

export interface ChatMessageListProps extends HoistProps<ChatModel>, LayoutProps, TestSupportProps {
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

    render({
        model,
        className,
        emptyState,
        suggestions,
        assistantName,
        assistantIcon,
        markdownComponents,
        testId,
        ...rest
    }) {
        const impl = useLocalModel(() => new ChatMessageListLocalModel(model)),
            viewportRef = useComposedRefs<HTMLDivElement>(
                useOnResize(impl.onViewportResize),
                impl.viewportRef
            ),
            contentRef = useOnResize(impl.onContentResize),
            {messages, isEmpty} = model,
            lastIdx = messages.length - 1;

        return div({
            className,
            style: getLayoutProps(rest),
            [TEST_ID]: testId,
            items: [
                div({
                    ref: viewportRef,
                    className: 'xh-chat-message-list__viewport',
                    onScroll: impl.onScroll,
                    onWheel: impl.onWheel,
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
// Within this distance of the bottom, the list sticks to the bottom as content grows.
const STICK_THRESHOLD_PX = 8;

// Beyond this distance from the bottom, the scroll-to-bottom button shows.
const BUTTON_THRESHOLD_PX = 80;

class ChatMessageListLocalModel extends HoistModel {
    override xhImpl = true;

    readonly chatModel: ChatModel;
    readonly viewportRef = createObservableRef<HTMLDivElement>();

    /** False while the user has scrolled away from the bottom. (observable) */
    @observable accessor isAtBottom = true;

    /** Id of the user message being edited, if any. (observable) */
    @observable accessor editingId: string = null;

    private isSticky = true;
    private lastScrollTop = 0;

    constructor(chatModel: ChatModel) {
        super();
        this.chatModel = chatModel;
    }

    override onLinked() {
        // Return to the bottom whenever the user sends a message, even if scrolled up.
        this.addReaction({
            track: () => findLast(this.chatModel.messages, 'isUser')?.id,
            run: () => this.scrollToBottom()
        });

        // Show the end of a finished reply - its action bar appears as the turn ends.
        this.addReaction({
            track: () => this.chatModel.isBusy,
            run: isBusy => {
                if (!isBusy && this.isSticky) this.scrollToBottom();
            },
            debounce: 0
        });
    }

    scrollToBottom(smooth: boolean = false) {
        const el = this.viewportRef.current;
        if (!el) return;
        this.isSticky = true;
        el.scrollTo({top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto'});
        this.setIsAtBottom(true);
    }

    onScroll = () => {
        const el = this.viewportRef.current;
        if (!el) return;

        // Content that shrinks while at the bottom also lowers scrollTop, so test distance first.
        const {scrollTop} = el,
            distance = el.scrollHeight - scrollTop - el.clientHeight;
        if (distance <= STICK_THRESHOLD_PX) {
            this.isSticky = true;
        } else if (scrollTop < this.lastScrollTop) {
            this.isSticky = false;
        }
        this.lastScrollTop = scrollTop;
        this.setIsAtBottom(this.isSticky || distance <= BUTTON_THRESHOLD_PX);
    };

    // A wheel up escapes at once, before the scroll it causes lands.
    onWheel = (e: WheelEvent) => {
        if (e.deltaY < 0) this.isSticky = false;
    };

    // Content grows below the fold as a reply streams, so follow it then. Otherwise content grows
    // because the user opened something - a tool call, say - which must stay where it is.
    onContentResize = () => this.followContent(this.chatModel.isBusy);
    onViewportResize = () => this.followContent(true);

    onEditingChange = (message: ChatMessage, isEditing: boolean) => {
        this.setEditingId(isEditing ? message.id : null);
    };

    editLastUserMessage = () => {
        const message = findLast(this.chatModel.messages, 'isUser');
        if (message) this.setEditingId(message.id);
    };

    @action
    private setEditingId(id: string) {
        this.editingId = id;
    }

    @action
    private setIsAtBottom(isAtBottom: boolean) {
        this.isAtBottom = isAtBottom;
    }

    private followContent(follow: boolean) {
        if (this.isSticky && follow) {
            this.scrollToBottom();
        } else {
            this.onScroll();
        }
    }
}
