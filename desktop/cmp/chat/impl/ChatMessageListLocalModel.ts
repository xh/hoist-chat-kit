import {findLast} from 'lodash';
import type {MouseEvent, WheelEvent} from 'react';
import {HoistModel, lookup} from '@xh/hoist/core';
import {action, observable} from '@xh/hoist/mobx';
import {createObservableRef} from '@xh/hoist/utils/react';
import {type ChatMessage, ChatModel} from '../../../../core';

/**
 * Local model for a ChatMessageList: the stick-to-bottom scroll rules and the edit state.
 *
 * While a reply streams, the list stays scrolled to the bottom, so the reply stays in view. A
 * scroll or wheel up releases it, so the user can read back. Scrolling back to within a few pixels
 * of the bottom, or sending a message, sticks it again. Content the user opens stays where it is,
 * unless it is in the last message of a list at the bottom - which then follows it down, so that
 * it opens into view rather than below the fold.
 *
 * @internal
 */
export class ChatMessageListLocalModel extends HoistModel {
    override xhImpl = true;

    @lookup(ChatModel) chatModel: ChatModel;

    readonly viewportRef = createObservableRef<HTMLDivElement>();

    /** False while the user has scrolled well away from the bottom. (observable) */
    @observable accessor isAtBottom = true;

    /** Id of the user message being edited, if any. (observable) */
    @observable accessor editingId: string = null;

    /** True while the list follows new content at the bottom. */
    get isSticky(): boolean {
        return this._isSticky;
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
                if (!isBusy && this._isSticky) this.scrollToBottom();
            },
            debounce: 0
        });
    }

    scrollToBottom(smooth: boolean = false) {
        const el = this.viewportRef.current;
        if (!el) return;
        this._isSticky = true;
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
            this._isSticky = true;
        } else if (scrollTop < this.lastScrollTop) {
            this._isSticky = false;
        }
        this.lastScrollTop = scrollTop;
        this.setIsAtBottom(this._isSticky || distance <= BUTTON_THRESHOLD_PX);
    };

    // A wheel up escapes at once, before the scroll it causes lands - but only once the content
    // overflows. Before that the wheel scrolls nothing, and no scroll would ever re-stick the list.
    onWheel = (e: WheelEvent) => {
        const el = this.viewportRef.current;
        if (e.deltaY < 0 && el && el.scrollHeight > el.clientHeight) this._isSticky = false;
    };

    // Content grows below the fold as a reply streams, so follow it then. Otherwise content grows
    // because the user opened something - a tool call, say - which must stay where it is, unless
    // it is in the last message, which would otherwise open out of view.
    onContentResize = () => {
        const isOpeningLast = this.lastClickAt > Date.now() - OPEN_FOLLOW_MS;
        this.followContent(this.chatModel.isBusy || isOpeningLast);
    };

    onClickCapture = (e: MouseEvent) => {
        const isInLast = !!(e.target as Element).closest?.('.xh-chat-message--last');
        this.lastClickAt = isInLast ? Date.now() : 0;
    };
    onViewportResize = () => this.followContent(true);

    onEditingChange = (message: ChatMessage, isEditing: boolean) => {
        this.setEditingId(isEditing ? message.id : null);
    };

    editLastUserMessage = () => {
        const message = findLast(this.chatModel.messages, 'isUser');
        if (message) this.setEditingId(message.id);
    };

    //------------------
    // Implementation
    //------------------
    private _isSticky = true;
    private lastScrollTop = 0;

    /** When the user last clicked in the last message, or 0. */
    private lastClickAt = 0;

    @action
    private setEditingId(id: string) {
        this.editingId = id;
    }

    @action
    private setIsAtBottom(isAtBottom: boolean) {
        this.isAtBottom = isAtBottom;
    }

    private followContent(follow: boolean) {
        if (this._isSticky && follow) {
            this.scrollToBottom();
        } else {
            this.onScroll();
        }
    }
}

// Within this distance of the bottom, the list sticks to the bottom as content grows.
const STICK_THRESHOLD_PX = 8;

// Content that grows this soon after a click in the last message is content the user opened.
const OPEN_FOLLOW_MS = 1000;

// Beyond this distance from the bottom, the scroll-to-bottom button shows.
const BUTTON_THRESHOLD_PX = 80;
