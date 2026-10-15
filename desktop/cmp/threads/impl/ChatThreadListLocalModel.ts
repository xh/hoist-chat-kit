import type {KeyboardEvent as ReactKeyboardEvent} from 'react';
import {find, findIndex, flatMap, isFunction} from 'lodash';
import {HoistModel} from '@xh/hoist/core';
import {action, bindable, computed, observable} from '@xh/hoist/mobx';
import {wait} from '@xh/hoist/promise';
import {
    type ChatThreadGroup,
    type ChatThreadListHost,
    type ChatThreadSummary,
    groupThreadsByRecency
} from '../../../../threads';
import {confirmDeleteThreadAsync} from './confirmDeleteThread';

/**
 * Selects a model that can back a thread list - see {@link ChatThreadListHost}. An arrow function,
 * as Hoist reads a function with a prototype as a model class.
 */
export const isChatThreadListHost = (model: unknown): boolean => {
    const host = model as ChatThreadListHost;
    return !!host && 'threads' in host && isFunction(host.selectThreadAsync);
};

/**
 * Local model for a ChatThreadList: the groups to show, the row being renamed, keyboard focus,
 * and the confirm before a delete. Reads the host from the component's props, or else from a
 * model in context.
 *
 * @internal
 */
export class ChatThreadListLocalModel extends HoistModel {
    override xhImpl = true;

    /** Id of the thread whose title is being edited, or null. (observable) */
    @observable accessor renamingThreadId: string = null;

    /** Title in the rename input. (bindable) */
    @bindable accessor renameText: string = null;

    /** Id of the row that holds keyboard focus, or null. (observable) */
    @observable accessor focusThreadId: string = null;

    /** Id of the row whose More menu is open, or null. (observable) */
    @observable accessor menuThreadId: string = null;

    get host(): ChatThreadListHost {
        return (
            (this.componentProps.model as unknown as ChatThreadListHost) ??
            (this.lookupModel(isChatThreadListHost) as unknown as ChatThreadListHost) ??
            null
        );
    }

    /** The search text, trimmed, or null. */
    @computed
    get searchQuery(): string {
        return this.host?.search?.trim() || null;
    }

    /** Groups to show: one group of results while searching, else groups by recency. */
    @computed
    get groups(): ChatThreadGroup[] {
        const threads = this.host?.threads ?? [];
        if (!threads.length) return [];
        if (this.searchQuery == null) return groupThreadsByRecency(threads);

        const label = threads.length === 1 ? '1 result' : `${threads.length} results`;
        return [{key: null, label, threads}];
    }

    /** Ids of the threads in the order the list shows them. */
    @computed
    get orderedThreadIds(): string[] {
        return flatMap(this.groups, it => it.threads.map(thread => thread.id));
    }

    /** Id of the row that takes focus on Tab: the focused row, else the selected, else the first. */
    @computed
    get tabbableThreadId(): string {
        const ids = this.orderedThreadIds,
            candidates = [this.focusThreadId, this.host?.selectedThreadId];
        return find(candidates, it => it != null && ids.includes(it)) ?? ids[0] ?? null;
    }

    /** True while the list loads and has no threads to show yet. */
    get isLoadingFirst(): boolean {
        const {host} = this;
        return !!host?.listTask?.isPending && !host.threads?.length;
    }

    override onLinked() {
        // Scroll the selected row into view when the selection changes, or when the selected
        // thread first appears in the list, as after a deep link.
        this.addReaction({
            track: () => {
                const id = this.host?.selectedThreadId;
                return [id, this.orderedThreadIds.includes(id)];
            },
            run: ([id]) => this.scrollRowIntoView(id as string),
            equals: 'structural'
        });
    }

    //------------------
    // Actions
    //------------------
    newThread() {
        this.cancelRename();
        this.host.newThread();
    }

    selectThread(threadId: string) {
        if (this.renamingThreadId === threadId) return;
        this.setFocusThreadId(threadId);
        this.host.selectThreadAsync(threadId).catchDefault();
    }

    setSearch(value: string) {
        this.host.search = value;
    }

    loadMore() {
        const {host} = this;
        if (host.hasMoreThreads && host.loadMoreThreadsAsync && !host.listTask?.isPending) {
            host.loadMoreThreadsAsync().catchDefault();
        }
    }

    retryList() {
        this.host.refreshAsync?.().catchDefault();
    }

    togglePin(thread: ChatThreadSummary) {
        this.host.pinThreadAsync(thread.id, !thread.pinned).catchDefault();
    }

    @action
    startRename(thread: ChatThreadSummary) {
        if (!this.canRename) return;
        this.renamingThreadId = thread.id;
        this.renameText = thread.title;
        this.focusThreadId = thread.id;
    }

    /** Save the rename in progress, if the title changed, and return focus to its row. */
    saveRename() {
        const threadId = this.renamingThreadId,
            title = this.renameText?.trim(),
            thread = this.findThread(threadId);
        if (threadId == null) return;

        this.endRename();
        if (title && thread && title !== thread.title) {
            this.host.renameThreadAsync(threadId, title).catchDefault();
        }
        this.focusRow(threadId);
    }

    /** Leave the rename in progress, keeping the old title, and return focus to its row. */
    cancelRename() {
        const threadId = this.renamingThreadId;
        if (threadId == null) return;
        this.endRename();
        this.focusRow(threadId);
    }

    /**
     * Confirm with the user, then delete a thread. Focus moves to the next row down, and if the
     * thread was open, that row's thread opens.
     */
    async deleteThreadAsync(thread: ChatThreadSummary) {
        if (!this.canDelete) return;
        const {host} = this,
            ids = this.orderedThreadIds,
            index = ids.indexOf(thread.id),
            nextId = ids[index + 1] ?? ids[index - 1] ?? null,
            confirmed = await confirmDeleteThreadAsync(thread);

        if (!confirmed) {
            this.focusRow(thread.id);
            return;
        }

        const wasSelected = host.selectedThreadId === thread.id,
            deletion = host.deleteThreadsAsync([thread.id]);
        if (wasSelected && nextId) host.selectThreadAsync(nextId).catchDefault();
        if (nextId) this.focusRow(nextId);
        await deletion;
    }

    @action
    setFocusThreadId(threadId: string) {
        this.focusThreadId = threadId;
    }

    @action
    setMenuThreadId(threadId: string) {
        this.menuThreadId = threadId;
    }

    get canRename(): boolean {
        return !!(this.host?.canRename && this.host.renameThreadAsync);
    }

    get canPin(): boolean {
        return !!(this.host?.canPin && this.host.pinThreadAsync);
    }

    get canDelete(): boolean {
        return !!(this.host?.canDelete && this.host.deleteThreadsAsync);
    }

    //------------------
    // Keyboard
    //------------------
    // TODO(D66): the global keyboard map - New Chat, F6 between regions, `/` for the composer -
    // belongs to `ChatKit.defaults.shortcuts`. Only the list's own keys live here.
    onListKeyDown = (e: ReactKeyboardEvent<HTMLElement>) => {
        const target = e.target as HTMLElement,
            row = target.closest<HTMLElement>('[role="option"]'),
            threadId = this.threadIdOfRow(row);
        if (threadId == null || this.renamingThreadId) return;

        const thread = this.findThread(threadId),
            isOnRow = target === row;

        switch (e.key) {
            case 'ArrowDown':
            case 'ArrowUp':
            case 'Home':
            case 'End':
                e.preventDefault();
                this.moveFocus(threadId, e.key);
                break;
            case 'Enter':
            case ' ':
                if (!isOnRow) return;
                e.preventDefault();
                this.selectThread(threadId);
                break;
            case 'F2':
                e.preventDefault();
                if (thread) this.startRename(thread);
                break;
            case 'Delete':
                e.preventDefault();
                if (thread) this.deleteThreadAsync(thread).catchDefault();
                break;
            case 'ArrowRight':
            case 'ArrowLeft':
                e.preventDefault();
                this.moveAmongActions(row, target, e.key === 'ArrowRight' ? 1 : -1);
                break;
        }
    };

    // Typed as Hoist's TextInput types its onKeyDown.
    onRenameKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            this.saveRename();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            this.cancelRename();
        }
    };

    onSearchKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape' && this.host.search) {
            e.preventDefault();
            e.stopPropagation();
            this.setSearch(null);
        }
    };

    /** Load the next page when the user scrolls near the end of the list. */
    onBodyScroll = (e: {currentTarget: HTMLElement}) => {
        const {scrollTop, scrollHeight, clientHeight} = e.currentTarget;
        if (scrollHeight - scrollTop - clientHeight < LOAD_MORE_THRESHOLD_PX) this.loadMore();
    };

    /** DOM id of a thread's row. */
    rowDomId(threadId: string): string {
        return `${this.rowDomIdPrefix}${threadId}`;
    }

    //------------------
    // Implementation
    //------------------
    private get rowDomIdPrefix(): string {
        return `${this.xhId}-row-`;
    }

    private threadIdOfRow(row: HTMLElement): string {
        const prefix = this.rowDomIdPrefix;
        return row?.id.startsWith(prefix) ? row.id.slice(prefix.length) : null;
    }

    @action
    private endRename() {
        this.renamingThreadId = null;
        this.renameText = null;
    }

    private findThread(threadId: string): ChatThreadSummary {
        return find(this.host?.threads, {id: threadId}) ?? null;
    }

    private moveFocus(threadId: string, key: string) {
        const ids = this.orderedThreadIds,
            index = findIndex(ids, it => it === threadId);
        let next: string;
        switch (key) {
            case 'ArrowDown':
                next = ids[Math.min(index + 1, ids.length - 1)];
                break;
            case 'ArrowUp':
                next = ids[Math.max(index - 1, 0)];
                break;
            case 'Home':
                next = ids[0];
                break;
            case 'End':
                next = ids[ids.length - 1];
                break;
        }
        if (next) this.focusRow(next, false);
    }

    /** Step from a row to its buttons and back, with the arrow keys. */
    private moveAmongActions(row: HTMLElement, target: HTMLElement, step: number) {
        const items = [row, ...Array.from(row.querySelectorAll<HTMLElement>('button'))],
            index = items.indexOf(target.closest('button') ?? row),
            next = items[index + step];
        next?.focus();
    }

    /** Focus a row - after the next render if `deferred`, as when an input or a dialog closes. */
    private focusRow(threadId: string, deferred: boolean = true) {
        this.setFocusThreadId(threadId);
        const focus = () => this.findRowEl(threadId)?.focus();
        deferred ? wait().then(focus) : focus();
    }

    private scrollRowIntoView(threadId: string) {
        if (threadId == null) return;
        wait().then(() => this.findRowEl(threadId)?.scrollIntoView?.({block: 'nearest'}));
    }

    private findRowEl(threadId: string): HTMLElement {
        return document.getElementById(this.rowDomId(threadId));
    }
}

/** Distance from the end of the list, in pixels, at which the next page loads. */
const LOAD_MORE_THRESHOLD_PX = 112;
