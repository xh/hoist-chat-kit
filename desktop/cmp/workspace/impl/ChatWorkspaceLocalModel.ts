import type {KeyboardEvent} from 'react';
import {HoistModel, lookup} from '@xh/hoist/core';
import {action, observable} from '@xh/hoist/mobx';
import {wait} from '@xh/hoist/promise';
import {createObservableRef} from '@xh/hoist/utils/react';
import {
    type ChatHotkeyConfig,
    type ChatRegion,
    cycleChatRegions,
    getChatHotkeys
} from '../../../impl/ChatShortcuts';
import {ChatWorkspaceModel} from '../ChatWorkspaceModel';
import {startNewThread} from '../../../impl/ThreadStatus';

/**
 * Local model for a ChatWorkspace: the history popover of a narrow workspace, focus moves between
 * the rail and the sidebar's search, and the workspace's keyboard shortcuts - see
 * `ChatKit.defaults.shortcuts`.
 *
 * @internal
 */
export class ChatWorkspaceLocalModel extends HoistModel {
    override xhImpl = true;

    @lookup(ChatWorkspaceModel) private model: ChatWorkspaceModel;

    /** True while the history popover is open. (observable) */
    @observable accessor isHistoryOpen = false;

    /** The sidebar's search input. */
    readonly searchInputRef = createObservableRef<HTMLInputElement>();

    /** The workspace's body, which holds every region that F6 moves between. */
    readonly bodyRef = createObservableRef<HTMLDivElement>();

    /** The workspace's hotkeys, from `ChatKit.defaults.shortcuts`. */
    get hotkeys(): ChatHotkeyConfig[] {
        return getChatHotkeys({
            newChat: () => this.newChat(),
            focusComposer: () => this.focusComposer(),
            cycleRegions: back => cycleChatRegions(this.bodyRef.current, REGIONS, back),
            toggleSidebar: () => this.model.toggleSidebar()
        });
    }

    override onLinked() {
        // Choosing a thread, or starting one, closes the history popover.
        this.addReaction({
            track: () => this.model.threadsModel.selectedThreadId,
            run: () => this.setHistoryOpen(false)
        });
    }

    @action
    setHistoryOpen(isOpen: boolean) {
        this.isHistoryOpen = isOpen;
    }

    /** Start a new thread, and focus its composer - the New Chat button keeps no focus. */
    newChat() {
        startNewThread(this.model.threadsModel);
    }

    focusComposer() {
        this.model.threadsModel.chatModel?.composerModel.focus();
    }

    /**
     * Escape in the app's side panel closes it, unless something inside took the key - a popup,
     * say. Focus goes to the composer, as the panel goes.
     */
    onSidePanelKeyDown = (e: KeyboardEvent) => {
        if (e.key !== 'Escape' || e.defaultPrevented) return;
        e.preventDefault();
        this.model.closeSidePanel();
        wait().then(() => this.focusComposer());
    };

    /** Expand the sidebar from its rail, and focus its search input. */
    openSearch() {
        this.model.expandSidebar();
        wait().then(() => this.searchInputRef.current?.focus());
    }
}

// The regions F6 moves between, in order. Each lands on its natural focus: the thread list's
// current row, the last message, the composer's input.
const REGIONS: ChatRegion[] = [
    {
        selector: '.xh-chat-workspace__sidebar, .xh-chat-workspace__rail',
        focusSelector: '.xh-chat-thread-list__list [tabindex="0"]'
    },
    {
        selector: '.xh-chat-message-list',
        focusSelector: '.xh-chat-message[role="article"][tabindex="0"]'
    },
    {selector: '.xh-chat-composer', focusSelector: 'textarea'},
    {selector: '.xh-chat-workspace__side-panel'}
];
