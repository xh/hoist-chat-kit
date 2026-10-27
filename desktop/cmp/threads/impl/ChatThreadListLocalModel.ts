import type {KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent} from 'react';
import {find, findIndex} from 'lodash';
import {HoistModel, lookup} from '@xh/hoist/core';
import {action, bindable, computed, observable} from '@xh/hoist/mobx';
import {wait} from '@xh/hoist/promise';
import {type ChatThreadGroup, ChatThreadsModel, type ChatThreadSummary} from '../../../../threads';
import {
    canDeleteThreadNow,
    deleteThreadAsync,
    getListedThreadIds,
    getThreadGroups
} from '../../../impl/ChatThreadDelete';
import {getThreadLabels, type ThreadLabels} from '../../../impl/ThreadLabels';
import type {ChatThreadListProps} from '../ChatThreadList';

/**
 * Local model for a ChatThreadList: the groups to show, the row being renamed, keyboard focus,
 * and the confirm before a delete.
 *
 * @internal
 */
export class ChatThreadListLocalModel extends HoistModel {
    override xhImpl = true;

    /** The threads the list shows. */
    @lookup(ChatThreadsModel) model: ChatThreadsModel;

    /** The list's props. */
    get props(): ChatThreadListProps {
        return this.componentProps as ChatThreadListProps;
    }

    /** True if the list groups its threads by recency - see `ChatThreadListProps.groupByRecency`. */
    get groupByRecency(): boolean {
        return this.props.groupByRecency !== false;
    }

    /** The word for a thread, in the list's text - see `ChatThreadListProps.threadNoun`. */
    get labels(): ThreadLabels {
        return getThreadLabels(this.props.threadNoun);
    }

    /** Id of the thread whose title is being edited, or null. (observable) */
    @observable accessor renamingThreadId: string = null;

    /** Title in the rename input. (bindable) */
    @bindable accessor renameText: string = null;

    /** Id of the row that holds keyboard focus, or null. (observable) */
    @observable accessor focusThreadId: string = null;

    /** Id of the row whose More menu is open, or null. (observable) */
    @observable accessor menuThreadId: string = null;

    /** The search text, trimmed, or null. */
    @computed
    get searchQuery(): string {
        return this.model.search?.trim() || null;
    }

    /** Groups to show: one group of results while searching, else groups by recency. */
    @computed
    get groups(): ChatThreadGroup[] {
        return getThreadGroups(this.model, this.groupByRecency);
    }

    /** Ids of the threads in the order the list shows them. */
    @computed
    get orderedThreadIds(): string[] {
        return getListedThreadIds(this.model, this.groupByRecency);
    }

    /** Id of the row that takes focus on Tab: the focused row, else the selected, else the first. */
    @computed
    get tabbableThreadId(): string {
        const ids = this.orderedThreadIds,
            candidates = [this.focusThreadId, this.model.selectedThreadId];
        return find(candidates, it => it != null && ids.includes(it)) ?? ids[0] ?? null;
    }

    /** True while the list loads and has no threads to show yet. */
    get isLoadingFirst(): boolean {
        const {model} = this;
        return model.listTask.isPending && !model.threads.length;
    }

    override onLinked() {
        // Scroll the selected row into view when the selection changes, or when the selected
        // thread first appears in the list, as after a deep link.
        this.addReaction({
            track: () => {
                const id = this.model.selectedThreadId;
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
        this.model.newThread();
    }

    selectThread(threadId: string) {
        if (this.renamingThreadId === threadId) return;
        this.setFocusThreadId(threadId);
        this.model.selectThreadAsync(threadId).catchDefault();
    }

    /**
     * A click on a row, or Enter on it: tell the app, then select the thread. Focus lands on the
     * row, so that the row's keys work after a click on its link. One action, so that reactions
     * on what the app does in `onThreadClick`, such as show its chat, run after the selection
     * has changed. The callback itself runs before: it gets the thread as its argument.
     */
    @action
    clickThread(thread: ChatThreadSummary) {
        if (this.renamingThreadId === thread.id) return;
        this.props.onThreadClick?.(thread);
        this.focusRow(thread.id, false);
        this.selectThread(thread.id);
    }

    /**
     * A click with Meta, Ctrl or Shift on a row's link opens the thread in a new tab or window,
     * and leaves the row. A plain click goes to the row. A middle click never reaches here.
     */
    onLinkClick = (e: ReactMouseEvent) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey) {
            e.stopPropagation();
            return;
        }
        e.preventDefault();
    };

    setSearch(value: string) {
        this.model.search = value;
    }

    retryList() {
        this.model.refreshAsync().catchDefault();
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
            this.model.renameThreadAsync(threadId, title).catchDefault();
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
        if (!this.canDeleteThread(thread)) return;
        const selectNext = this.props.selectNextOnDelete !== false,
            wasSelected = this.model.selectedThreadId === thread.id,
            confirmed = await deleteThreadAsync(this.model, thread, {
                labels: this.labels,
                groupByRecency: this.groupByRecency,
                selectNext,
                // The next row takes focus, unless a new chat opens in the deleted thread's place.
                onDeleting: nextId => {
                    if (nextId && (selectNext || !wasSelected)) this.focusRow(nextId);
                }
            });
        if (!confirmed) this.focusRow(thread.id);
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
        return this.model.canRename;
    }

    get canDelete(): boolean {
        return this.model.canDelete;
    }

    /** True if the user may delete a thread now - see `ChatThreadListProps.enableDeleteRunning`. */
    canDeleteThread(thread: ChatThreadSummary): boolean {
        return canDeleteThreadNow(this.model, thread, this.props.enableDeleteRunning);
    }

    //------------------
    // Keyboard
    //------------------
    // TODO(D66): the global keyboard map - New Chat, F6 between regions, `/` for the composer -
    // belongs to `ChatKit.defaults.shortcuts`. Only the list's own keys live here.
    onListKeyDown = (e: ReactKeyboardEvent<HTMLElement>) => {
        const target = e.target as HTMLElement,
            row = target.closest<HTMLElement>('[role="row"]'),
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
                if (thread) this.clickThread(thread);
                break;
            case 'F2':
                e.preventDefault();
                if (thread) this.startRename(thread);
                break;
            case 'Delete':
            case 'Backspace':
                // A Mac laptop sends Backspace for its delete key - taken on the row alone.
                if (e.key === 'Backspace' && !isOnRow) return;
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
        if (e.key === 'Escape' && this.model.search) {
            e.preventDefault();
            e.stopPropagation();
            this.setSearch(null);
        }
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
        return find(this.model.threads, {id: threadId}) ?? null;
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
