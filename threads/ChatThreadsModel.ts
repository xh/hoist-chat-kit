import {
    cloneDeep,
    compact,
    difference,
    differenceBy,
    findLast,
    isEmpty,
    isEqual,
    keys,
    omit,
    pickBy,
    some,
    union,
    uniq,
    without
} from 'lodash';
import type {LoadSpec, PlainObject} from '@xh/hoist/core';
import {HoistModel, managed, TaskObserver, XH} from '@xh/hoist/core';
import {action, bindable, computed, observable, observableRef} from '@xh/hoist/mobx';
import {debounced, throwIf} from '@xh/hoist/utils/js';
import {ChatKit, type ChatModel, type ChatThreadCreatorSpec} from '../core';
import {genChatId} from '../impl/ids';
import type {ChatThreadListHost} from './ChatThreadListHost';
import type {
    ChatMessagePage,
    ChatThreadPage,
    ChatThreadStore,
    ChatThreadSummary
} from './ChatThreadStore';
import {OpenThread} from './impl/OpenThread';
import {isNotFound, titleFromText} from './impl/threadUtils';

/** Configuration for a {@link ChatThreadsModel}. */
export interface ChatThreadsConfig {
    /** Adapter to the backend that stores the threads. */
    store: ChatThreadStore;

    /**
     * Create the chat for a thread. Pass `threadId` to the `ChatModel` config, and wire the
     * transport, tools and other config as for any chat. Called each time a thread opens: when
     * it is selected, or created with `newThread`.
     */
    createChatModel: (spec: ChatThreadChatSpec) => ChatModel;

    /** Threads to list per page. Default 50. */
    pageSize?: number;

    /** Messages to load per page of a thread's history. Default 50. */
    historyPageSize?: number;

    /**
     * True to let threads run turns at the same time. Default true. If false, a thread cannot
     * send while another thread's turn runs - for a backend that runs one turn per user.
     */
    allowConcurrentTurns?: boolean;

    /**
     * A route whose parameter holds the selected thread's id, for deep links. The selection and
     * the parameter then stay in sync both ways.
     */
    route?: ChatThreadsRoute;
}

/** Passed to {@link ChatThreadsConfig.createChatModel}. */
export interface ChatThreadChatSpec {
    /** Id of the thread. The chat must take it as its `threadId`. */
    threadId: string;

    /** True for a new thread, false for one whose history the threads model is about to load. */
    isNew: boolean;
}

/** A route that holds the selected thread - see {@link ChatThreadsConfig.route}. */
export interface ChatThreadsRoute {
    /** Fully qualified name of the route, such as 'default.chat'. */
    name: string;

    /** Name of the route parameter that holds the thread id, such as 'threadId'. */
    param: string;
}

/** How to start a new thread - see {@link ChatThreadsModel.newThread}. */
export interface ChatSeedSpec {
    /** Draft text to put in the composer. */
    draft?: string;

    /** Run options for the new chat, in place of those `createChatModel` gives it. */
    runOptions?: PlainObject;
}

/**
 * Model for a user's threads - conversations stored by a backend - and the chats open on them.
 * The app implements a {@link ChatThreadStore} against its backend, and supplies a
 * `createChatModel` function that builds the chat for a thread.
 *
 * The model lists the threads a page at a time, with server-side search, and renames and deletes
 * them at once, rolling back with a toast if the store fails. It holds a `ChatModel` for
 * each open thread: the selected one, and any other with a turn running. A turn therefore runs on
 * in the background when the user switches threads, and the list shows its thread as running. A
 * chat that is neither selected nor busy is destroyed. The thread's draft and run options are kept
 * for when it opens again.
 *
 * Every async result is checked before it is applied. A thread list applies only if no newer list
 * has, with pending renames and deletes laid over it. A thread's history applies only to the
 * chat that asked for it, while that chat is open. Each chat applies only its own run's events, as
 * the threads model never routes events itself.
 *
 * A new thread's id may change once, when its chat adopts the backend's id - see
 * {@link ChatModel.threadId}. The model then re-keys the thread, its summary, the selection and
 * the route.
 */
export class ChatThreadsModel extends HoistModel implements ChatThreadListHost {
    declare config: ChatThreadsConfig;

    //-----------------------
    // Immutable Properties
    //-----------------------
    /** Adapter to the backend that stores the threads. */
    readonly store: ChatThreadStore;

    /** Threads to list per page. */
    readonly pageSize: number;

    /** Messages to load per page of a thread's history. */
    readonly historyPageSize: number;

    /** True if threads may run turns at the same time. */
    readonly allowConcurrentTurns: boolean;

    /** The route that holds the selected thread, or null. */
    readonly route: ChatThreadsRoute;

    /** Tracks loads of the thread list - the first page, a refresh, or a further page. */
    @managed readonly listTask = TaskObserver.trackLast();

    /** Tracks the load of the selected thread's history. */
    @managed readonly loadTask = TaskObserver.trackLast();

    /** Tracks the load of older history for the selected thread. */
    @managed readonly olderMessagesTask = TaskObserver.trackLast();

    //-----------------------
    // Observable State
    //-----------------------
    /** Id of the selected thread, or null before the first selection. (observable) */
    @observable accessor selectedThreadId: string = null;

    /** Text to search the threads for. The list reloads, debounced, when it changes. (bindable) */
    @bindable accessor search: string = null;

    /** Error from the last load of the thread list, or null. The list keeps its threads. */
    @observableRef accessor listError: Error = null;

    /**
     * The threads to list, in the store's order. Threads started here that the store has not yet
     * listed come first, unless a search is active. Pending renames and deletes show at once.
     */
    @computed
    get threads(): ChatThreadSummary[] {
        const {listedThreads, localThreads, listedSearch, pendingChanges} = this,
            all = listedSearch == null ? [...localThreads, ...listedThreads] : listedThreads;
        return compact(all.map(thread => applyChanges(thread, pendingChanges)));
    }

    /** The selected thread's chat, or null. */
    @computed
    get chatModel(): ChatModel {
        return this.selectedThread?.chatModel ?? null;
    }

    /** The selected thread's summary, or null if it is not in the list. */
    @computed
    get selectedSummary(): ChatThreadSummary {
        return this.threads.find(it => it.id === this.selectedThreadId) ?? null;
    }

    /**
     * Ids of the threads with a turn running: those running here, and those the store reports as
     * running, such as a turn that runs on after its chat was closed.
     */
    @computed
    get runningThreadIds(): string[] {
        const local = Object.values(this.openThreads)
                .filter(it => it.chatModel.isBusy)
                .map(it => it.chatModel.threadId),
            remote = this.threads.filter(it => it.isRunning).map(it => it.id);
        return union(local, remote);
    }

    /**
     * Ids of the threads whose turn is paused, waiting for the user to approve a tool call or
     * answer an interactive tool. Their chats stay open in the background until the user does.
     */
    @computed
    get awaitingThreadIds(): string[] {
        return Object.values(this.openThreads)
            .filter(it => it.chatModel.isAwaitingUser)
            .map(it => it.chatModel.threadId);
    }

    /**
     * Ids of the threads whose turn finished in the background, since the user last selected
     * them. Held for the session only. A thread list shows each as having a new reply.
     */
    @observableRef accessor finishedAwayThreadIds: string[] = [];

    /** True if the store has more threads to list - see {@link loadMoreThreadsAsync}. */
    @computed
    get hasMoreThreads(): boolean {
        return this.nextCursor != null;
    }

    /**
     * Why the selected thread's history failed to load, or null. Sends wait in that thread - and
     * only that thread - until {@link reloadThreadAsync} succeeds.
     */
    @computed
    get loadError(): Error {
        return this.selectedThread?.loadError ?? null;
    }

    /** True if the store can rename threads. */
    get canRename(): boolean {
        return !!this.store.renameThreadAsync;
    }

    /** True if the store can delete threads. */
    get canDelete(): boolean {
        return !!this.store.deleteThreadsAsync;
    }

    /** True if the store's search covers message text, not just titles. */
    get searchesMessages(): boolean {
        return !!this.store.searchesMessages;
    }

    constructor(config: ChatThreadsConfig) {
        super();
        const {
            store,
            createChatModel,
            pageSize = 50,
            historyPageSize = 50,
            allowConcurrentTurns = true,
            route = null
        } = config;
        throwIf(!store, 'ChatThreadsModel requires a store.');
        throwIf(!createChatModel, 'ChatThreadsModel requires a createChatModel function.');

        this.store = store;
        this.createChatModel = createChatModel;
        this.pageSize = pageSize;
        this.historyPageSize = historyPageSize;
        this.allowConcurrentTurns = allowConcurrentTurns;
        this.route = route;

        this.addReaction({
            track: () => this.searchQuery,
            run: () => this.loadAsync(),
            debounce: SEARCH_DEBOUNCE_MS
        });
        if (route) {
            this.addReaction(
                {
                    track: () => XH.routerState,
                    run: () => this.syncFromRoute(),
                    fireImmediately: true
                },
                {
                    track: () => this.selectedThreadId,
                    run: () => this.syncToRoute()
                }
            );
        }
    }

    /** Load the first page of threads, for the current search, or reload as many as are listed. */
    override async doLoadAsync(loadSpec: LoadSpec) {
        // Ordered by a count of our own rather than `loadSpec.isStale`, as a list applies unless a
        // newer list has already applied, and further pages are checked against the same count.
        const search = this.searchQuery,
            listNumber = this.listCount++,
            limit =
                search === this.listedSearch
                    ? Math.max(this.pageSize, this.listedThreads.length)
                    : this.pageSize;

        try {
            const page = await this.store.listThreadsAsync({search, limit}).linkTo(this.listTask);
            if (this.isListCurrent(listNumber, search)) this.applyThreadPage(page, listNumber);
        } catch (e) {
            if (!this.isListCurrent(listNumber, search)) return;
            this.setListError(e);
            XH.handleException(e, {showAlert: false});
        }
    }

    override destroy() {
        XH.safeDestroy(Object.values(this.openThreads));
        super.destroy();
    }

    //------------------
    // Actions
    //------------------
    /**
     * Start a new thread, and select it. The thread exists only here until its first turn - when
     * the store's `createThreadAsync`, if any, creates it, or else the backend creates it on the
     * first run.
     *
     * @returns the new thread's chat.
     */
    newThread(seed: ChatSeedSpec = {}): ChatModel {
        const {chatModel} = this.openThread(genChatId(), true);
        if (seed.draft != null) chatModel.composerModel.text = seed.draft;
        if (seed.runOptions !== undefined) chatModel.runOptions = seed.runOptions;
        this.setSelectedThreadId(chatModel.threadId);
        return chatModel;
    }

    /**
     * Select a thread, opening its chat and loading its history if it is not open already. A
     * thread the store does not have opens empty.
     *
     * @returns a promise that resolves once the history has loaded, or failed to - see
     *      {@link loadError}.
     */
    async selectThreadAsync(threadId: string): Promise<void> {
        throwIf(threadId == null, 'selectThreadAsync requires a thread id.');
        if (threadId === this.selectedThreadId) return;

        const isOpen = !!this.openThreads[threadId],
            thread = this.openThreads[threadId] ?? this.openThread(threadId, false);
        this.setSelectedThreadId(threadId);
        if (!isOpen) await this.loadHistoryAsync(thread);
    }

    /**
     * Reload the selected thread's history - after a failed load, or to catch up on a turn the
     * backend finished on its own. Ignored while the thread's turn runs.
     */
    async reloadThreadAsync(): Promise<void> {
        const thread = this.selectedThread;
        if (!thread || thread.chatModel.isBusy) return;
        await this.loadHistoryAsync(thread);
    }

    /**
     * Load the page of older messages for the selected thread, ahead of those shown. Sets the
     * chat's `hasOlderMessages` to show whether more remain.
     */
    async loadOlderMessagesAsync(): Promise<void> {
        const thread = this.selectedThread;
        if (!thread?.olderCursor || thread.loadState !== 'loaded') return;

        thread.olderLoad ??= this.doLoadOlderMessagesAsync(thread).finally(() => {
            thread.olderLoad = null;
        });
        await thread.olderLoad;
    }

    /** Load the next page of threads, if the store has more - see {@link hasMoreThreads}. */
    async loadMoreThreadsAsync(): Promise<void> {
        if (this.nextCursor == null) return;

        this.moreThreadsLoad ??= this.doLoadMoreThreadsAsync().finally(() => {
            this.moreThreadsLoad = null;
        });
        await this.moreThreadsLoad;
    }

    /**
     * Rename a thread. The new title shows at once, and reverts with a toast if the store fails.
     * Requires the store's `renameThreadAsync` - see {@link canRename}.
     */
    async renameThreadAsync(threadId: string, title: string): Promise<void> {
        throwIf(!this.canRename, 'The thread store cannot rename threads.');
        title = title?.trim();
        throwIf(!title, 'A thread title cannot be empty.');

        await this.changeThreadsAsync(
            [threadId],
            {title},
            'The conversation was not renamed.',
            () => this.store.renameThreadAsync(threadId, title)
        );
    }

    /**
     * Delete threads. They leave the list at once, and return with a toast if the store fails.
     * Their chats close, and a turn running in one is stopped. If the selected thread is deleted,
     * a new thread is selected. Requires the store's `deleteThreadsAsync` - see {@link canDelete}.
     */
    async deleteThreadsAsync(threadIds: string[]): Promise<void> {
        throwIf(!this.canDelete, 'The thread store cannot delete threads.');
        if (isEmpty(threadIds)) return;

        this.closeThreads(threadIds);
        if (threadIds.includes(this.selectedThreadId)) this.newThread();

        await this.changeThreadsAsync(
            threadIds,
            null,
            threadIds.length > 1
                ? 'The conversations were not deleted.'
                : 'The conversation was not deleted.',
            () => this.deleteFromStoreAsync(threadIds)
        );
    }

    //------------------
    // Implementation
    //------------------
    private readonly createChatModel: (spec: ChatThreadChatSpec) => ChatModel;

    // Threads with an open chat, by thread id.
    @observableRef private accessor openThreads: Record<string, OpenThread> = {};

    // Threads from the store's applied list and its further pages, as the store sent them.
    @observableRef private accessor listedThreads: ChatThreadSummary[] = [];

    // Threads started here that the store has not listed yet, newest first.
    @observableRef private accessor localThreads: ChatThreadSummary[] = [];

    // Renames and deletes, laid over the threads until a list requested after they ended.
    @observableRef private accessor pendingChanges: PendingChange[] = [];

    // Search of the applied list, and its cursor for the next page.
    @observable private accessor listedSearch: string = null;
    @observable private accessor nextCursor: string = null;

    // Lists requested, and the number of the last one applied - see `isListCurrent`.
    private listCount = 0;
    private appliedListNumber = -1;

    private moreThreadsLoad: Promise<void> = null;

    // Calls to the store's `createThreadAsync`, by local id - resolving to the thread's id.
    private readonly threadCreates = new Map<string, Promise<string>>();

    // Drafts and run options of closed threads, for when they open again.
    private readonly drafts = new Map<string, ThreadDraft>();

    // The run options each chat was built with, so that a draft keeps only the user's changes.
    private readonly defaultRunOptions = new WeakMap<ChatModel, PlainObject>();

    @computed
    private get selectedThread(): OpenThread {
        return this.openThreads[this.selectedThreadId] ?? null;
    }

    @computed
    private get searchQuery(): string {
        return this.search?.trim() || null;
    }

    /** True if a list result may apply: no newer list has, and its search is still current. */
    private isListCurrent(listNumber: number, search: string): boolean {
        return (
            !this.isDestroyed && listNumber > this.appliedListNumber && search === this.searchQuery
        );
    }

    //------------------------
    // Open threads
    //------------------------
    /** Create the chat for a thread, and wire it to this model. */
    private openThread(threadId: string, isNew: boolean): OpenThread {
        const {store} = this,
            chatModel = this.createChatModel({threadId, isNew});
        throwIf(
            chatModel?.threadId !== threadId,
            'ChatThreadsConfig.createChatModel must pass the given threadId to the ChatModel.'
        );

        if (store.submitFeedbackAsync && !chatModel.feedback.submitAsync) {
            chatModel.setFeedbackSubmitter(spec => store.submitFeedbackAsync(spec));
        }
        if (store.createThreadAsync) {
            chatModel.setThreadCreator(spec => this.createThreadAsync(spec));
        }

        const thread = new OpenThread({
            chatModel,
            isLoaded: isNew,
            onThreadIdChange: (it, prevThreadId) => this.onThreadIdChange(it, prevThreadId),
            onBusyChange: it => this.onBusyChange(it)
        });
        chatModel.addSendBlocker(() => this.getSendBlockedReason(thread));
        chatModel.setStatusRefresher(() => this.refreshStatusAsync(thread));
        this.defaultRunOptions.set(chatModel, chatModel.runOptions ?? null);
        this.restoreDraft(threadId, chatModel);
        this.putOpenThread(threadId, thread);
        return thread;
    }

    /**
     * Reload a thread's history, to learn how a run ended that its chat lost sight of. A turn
     * still running here - one that stalled - is detached first, as the server may finish it.
     */
    private async refreshStatusAsync(thread: OpenThread): Promise<void> {
        if (thread.loadState === 'loading') return;
        if (thread.chatModel.isBusy) thread.chatModel.detach();
        await this.loadHistoryAsync(thread);
    }

    private getSendBlockedReason(thread: OpenThread): string {
        switch (thread.loadState) {
            case 'loading':
                return 'Wait for the conversation to load.';
            case 'failed':
                return 'The conversation did not load. Reload it to continue.';
        }

        const {threadId} = thread.chatModel;
        if (!this.allowConcurrentTurns && this.runningThreadIds.some(it => it !== threadId)) {
            return 'Wait for the reply in another conversation to finish.';
        }
        return null;
    }

    /**
     * The thread creator for each chat. Calls the store once per local id - a retry of the first
     * turn reuses the call - and again only if it failed. The store is idempotent per local id, so
     * a retry after a lost response finds the thread already created.
     */
    private createThreadAsync({threadId: localId, userMessage}: ChatThreadCreatorSpec) {
        let ret = this.threadCreates.get(localId);
        if (!ret) {
            ret = this.store
                .createThreadAsync({localId, title: titleFromText(userMessage?.text)})
                .then(summary => {
                    this.updateThread(localId, omit(summary, 'id'));
                    return summary.id;
                });
            ret.catch(() => this.threadCreates.delete(localId));
            this.threadCreates.set(localId, ret);
        }
        return ret;
    }

    /**
     * Delete threads from the store, with the backend's ids for those whose create is in flight or
     * done. A thread deleted during its first turn's create still has its backend thread deleted.
     */
    private async deleteFromStoreAsync(threadIds: string[]): Promise<void> {
        const creates = threadIds.map(id => this.threadCreates.get(id)).filter(Boolean);
        if (isEmpty(creates)) return this.store.deleteThreadsAsync(threadIds);

        threadIds.forEach(id => this.threadCreates.delete(id));
        const created = await Promise.all(creates.map(it => it.catch(() => null)));
        return this.store.deleteThreadsAsync(uniq([...threadIds, ...compact(created)]));
    }

    @action
    private onThreadIdChange(thread: OpenThread, prevThreadId: string) {
        const {threadId, isBusy} = thread.chatModel;
        if (this.openThreads[prevThreadId] !== thread) return;

        // A chat changes its thread id mid-turn only to adopt the backend's id for the same thread.
        // Otherwise the app cleared it, or loaded other messages into it, and it holds a new thread.
        if (isBusy) {
            this.rekeyThread(prevThreadId, threadId);
        } else {
            thread.resetLoad();
        }
        this.openThreads = {...omit(this.openThreads, prevThreadId), [threadId]: thread};
        if (this.selectedThreadId === prevThreadId) this.selectedThreadId = threadId;
    }

    private onBusyChange(thread: OpenThread) {
        const {chatModel} = thread;
        this.noteActivity(chatModel);
        if (!chatModel.isBusy) {
            // A turn that pauses for the user has not finished - the thread lists as awaiting.
            if (!chatModel.isAwaitingUser) this.noteFinishedAway(chatModel.threadId);
            // The backend may have set a title, or the thread's place in the list may change.
            this.refreshThreadsSoon();
            this.closeIdleThreads();
        }
    }

    // Turns that end close together reload the list once.
    @debounced(1000)
    private refreshThreadsSoon() {
        if (!this.isDestroyed) this.refreshAsync();
    }

    /** Mark a thread whose turn ended while another thread was selected. */
    @action
    private noteFinishedAway(threadId: string) {
        if (threadId === this.selectedThreadId) return;
        this.finishedAwayThreadIds = union(this.finishedAwayThreadIds, [threadId]);
    }

    @action
    private setSelectedThreadId(threadId: string) {
        this.selectedThreadId = threadId;
        this.finishedAwayThreadIds = without(this.finishedAwayThreadIds, threadId);
        this.loadTask.clear();
        this.olderMessagesTask.clear();
        this.closeIdleThreads();
    }

    @action
    private putOpenThread(threadId: string, thread: OpenThread) {
        this.openThreads = {...this.openThreads, [threadId]: thread};
    }

    /**
     * Close the chats that are not selected, and neither run a turn nor wait for the user, keeping
     * their drafts.
     */
    @action
    private closeIdleThreads() {
        const idle = pickBy(
            this.openThreads,
            (thread, id) =>
                id !== this.selectedThreadId &&
                !thread.chatModel.isBusy &&
                !thread.chatModel.isAwaitingUser
        );
        if (isEmpty(idle)) return;

        Object.entries(idle).forEach(([id, thread]) => {
            this.saveDraft(id, thread.chatModel);
            thread.destroy();
        });
        this.openThreads = omit(this.openThreads, keys(idle));
    }

    /**
     * Close the chats of threads being deleted, stopping any turn, and drop their drafts - from
     * memory and from local storage.
     */
    @action
    private closeThreads(threadIds: string[]) {
        threadIds.forEach(id => {
            const thread = this.openThreads[id];
            thread?.chatModel.stop();
            thread?.destroy();
            this.drafts.delete(id);
        });
        // After the chats close, as a composer saves its draft when destroyed.
        ChatKit.clearLocalData(threadIds);
        this.openThreads = omit(this.openThreads, threadIds);
        this.finishedAwayThreadIds = difference(this.finishedAwayThreadIds, threadIds);
    }

    /** Keep the draft of a closed chat, if the user changed its text or run options. */
    private saveDraft(threadId: string, chatModel: ChatModel) {
        const {composerModel, runOptions} = chatModel,
            isChanged =
                composerModel.text || !isEqual(runOptions, this.defaultRunOptions.get(chatModel));
        if (isChanged) {
            this.drafts.set(threadId, {text: composerModel.text, runOptions});
        }
    }

    private restoreDraft(threadId: string, chatModel: ChatModel) {
        const draft = this.drafts.get(threadId);
        if (!draft) return;
        this.drafts.delete(threadId);
        chatModel.composerModel.text = draft.text;
        chatModel.runOptions = draft.runOptions;
    }

    //------------------------
    // History
    //------------------------
    private async loadHistoryAsync(thread: OpenThread) {
        const {chatModel} = thread,
            {threadId} = chatModel,
            loadKey = thread.beginLoad();

        try {
            const page = await this.store
                .loadMessagesAsync({threadId, limit: this.historyPageSize})
                .linkTo(this.loadTask);
            if (thread.isLoadCurrent(loadKey)) this.applyHistory(thread, threadId, page);
        } catch (e) {
            if (!thread.isLoadCurrent(loadKey)) {
                this.logWarn(`Discarded a failed load of thread ${threadId}, no longer open`, e);
            } else if (isNotFound(e)) {
                thread.endLoad();
            } else {
                thread.endLoad(e);
                XH.handleException(e, {showAlert: false});
            }
        }
    }

    @action
    private applyHistory(thread: OpenThread, threadId: string, page: ChatMessagePage) {
        const {chatModel} = thread;
        chatModel.loadMessages(page.messages ?? [], threadId);
        chatModel.hasOlderMessages = page.nextCursor != null;
        // TODO(design-open B4) - run options, such as a document scope, belong to the thread.
        // The thread opens with those of its last question, unless the user changed them here.
        const lastRunOptions = findLast(chatModel.messages, it => it.isUser)?.metadata.runOptions;
        if (
            lastRunOptions != null &&
            isEqual(chatModel.runOptions, this.defaultRunOptions.get(chatModel))
        ) {
            chatModel.runOptions = cloneDeep(lastRunOptions);
        }
        thread.olderCursor = page.nextCursor ?? null;
        thread.endLoad();
    }

    private async doLoadOlderMessagesAsync(thread: OpenThread) {
        const {chatModel, olderCursor: cursor, loadKey} = thread,
            {threadId} = chatModel;

        try {
            const page = await this.store
                .loadMessagesAsync({threadId, cursor, limit: this.historyPageSize})
                .linkTo(this.olderMessagesTask);
            if (thread.isLoadCurrent(loadKey) && thread.olderCursor === cursor) {
                this.applyOlderMessages(thread, page);
            }
        } catch (e) {
            if (!thread.isLoadCurrent(loadKey)) {
                this.logWarn(`Discarded a failed load of thread ${threadId}, no longer open`, e);
                return;
            }
            XH.handleException(e, {
                message: 'Older messages did not load. Try again.',
                alertType: 'toast'
            });
        }
    }

    @action
    private applyOlderMessages(thread: OpenThread, page: ChatMessagePage) {
        const {chatModel} = thread;
        chatModel.prependMessages(page.messages ?? []);
        chatModel.hasOlderMessages = page.nextCursor != null;
        thread.olderCursor = page.nextCursor ?? null;
    }

    //------------------------
    // Thread list
    //------------------------
    @action
    private setListError(e: Error) {
        this.listError = e;
    }

    @action
    private applyThreadPage(page: ChatThreadPage, listNumber: number) {
        const threads = page.threads ?? [];
        this.appliedListNumber = listNumber;
        this.listedSearch = this.searchQuery;
        this.listedThreads = threads;
        this.nextCursor = page.nextCursor ?? null;
        this.localThreads = differenceBy(this.localThreads, threads, 'id');
        this.pendingChanges = this.pendingChanges.filter(it => listNumber < it.doneBefore);
        this.listError = null;
    }

    private async doLoadMoreThreadsAsync() {
        const {nextCursor: cursor, appliedListNumber, listedSearch: search} = this,
            // The page continues the applied list, and applies only while that list is current.
            isCurrent = () =>
                !this.isDestroyed &&
                this.appliedListNumber === appliedListNumber &&
                this.nextCursor === cursor &&
                this.searchQuery === search;

        try {
            const page = await this.store
                .listThreadsAsync({search, cursor, limit: this.pageSize})
                .linkTo(this.listTask);
            if (isCurrent()) this.appendThreadPage(page);
        } catch (e) {
            if (!isCurrent()) return;
            XH.handleException(e, {
                message: 'More conversations did not load. Try again.',
                alertType: 'toast'
            });
        }
    }

    @action
    private appendThreadPage(page: ChatThreadPage) {
        const threads = differenceBy(page.threads ?? [], this.listedThreads, 'id');
        this.listedThreads = [...this.listedThreads, ...threads];
        this.nextCursor = page.nextCursor ?? null;
        this.localThreads = differenceBy(this.localThreads, threads, 'id');
    }

    /**
     * Change threads at once, then in the store. The change shows until a list requested after
     * the store call ended applies - so a list already in flight cannot undo it - and is dropped
     * at once if the call fails.
     *
     * @param changes - fields to change, or null to delete the threads.
     */
    private async changeThreadsAsync(
        threadIds: string[],
        changes: Partial<ChatThreadSummary>,
        failureMessage: string,
        saveAsync: () => Promise<void>
    ) {
        const pending = threadIds.map(threadId => ({threadId, changes, doneBefore: Infinity}));
        this.addPendingChanges(pending);
        try {
            await saveAsync();
            this.commitPendingChanges(pending);
        } catch (e) {
            this.dropPendingChanges(pending);
            XH.handleException(e, {message: failureMessage, alertType: 'toast'});
        }
    }

    @action
    private addPendingChanges(changes: PendingChange[]) {
        this.pendingChanges = [...this.pendingChanges, ...changes];
    }

    /** Apply succeeded changes to the threads, and keep them only until the next list. */
    @action
    private commitPendingChanges(changes: PendingChange[]) {
        changes.forEach(change => {
            change.doneBefore = this.listCount;
            this.listedThreads = compact(this.listedThreads.map(it => applyChange(it, change)));
            this.localThreads = compact(this.localThreads.map(it => applyChange(it, change)));
        });
    }

    @action
    private dropPendingChanges(changes: PendingChange[]) {
        this.pendingChanges = difference(this.pendingChanges, changes);
    }

    /** Record activity in a chat's thread, adding a summary for a thread not listed yet. */
    @action
    private noteActivity(chatModel: ChatModel) {
        const {threadId} = chatModel,
            lastActivityAt = Date.now();
        if (this.hasThread(threadId)) {
            this.updateThread(threadId, {lastActivityAt});
            return;
        }

        const userMessage = findLast(chatModel.messages, it => it.isUser),
            title = titleFromText(userMessage?.text);
        this.localThreads = [
            {id: threadId, title, lastActivityAt, createdAt: lastActivityAt},
            ...this.localThreads
        ];
    }

    private hasThread(threadId: string): boolean {
        return some(this.listedThreads, {id: threadId}) || some(this.localThreads, {id: threadId});
    }

    @action
    private updateThread(threadId: string, changes: Partial<ChatThreadSummary>) {
        const update = (thread: ChatThreadSummary) =>
            thread.id === threadId ? {...thread, ...changes} : thread;
        this.listedThreads = this.listedThreads.map(update);
        this.localThreads = this.localThreads.map(update);
    }

    /** Give a thread the id its chat adopted, merging it into any summary listed under that id. */
    @action
    private rekeyThread(prevThreadId: string, threadId: string) {
        const isListed = this.hasThread(threadId),
            rekey = (thread: ChatThreadSummary) =>
                thread.id === prevThreadId ? {...thread, id: threadId} : thread,
            keep = (thread: ChatThreadSummary) => !isListed || thread.id !== prevThreadId;

        this.listedThreads = this.listedThreads.filter(keep).map(rekey);
        this.localThreads = this.localThreads.filter(keep).map(rekey);
        // Changed in place, so that the store call that made a change still ends it.
        this.pendingChanges.forEach(it => {
            if (it.threadId === prevThreadId) it.threadId = threadId;
        });
        this.pendingChanges = [...this.pendingChanges];
        this.finishedAwayThreadIds = this.finishedAwayThreadIds.map(it =>
            it === prevThreadId ? threadId : it
        );
    }

    //------------------------
    // Route binding
    //------------------------
    private isOnRoute(): boolean {
        const name = XH.routerState?.name,
            routeName = this.route.name;
        return name === routeName || !!name?.startsWith(routeName + '.');
    }

    /** Select the thread in the route. A route with no thread takes the selection. */
    private syncFromRoute() {
        if (!this.isOnRoute()) return;

        const threadId = XH.routerState.params[this.route.param] ?? null;
        if (threadId == null) {
            this.syncToRoute();
        } else if (threadId !== this.selectedThreadId) {
            this.selectThreadAsync(threadId);
        }
    }

    /** Put the selected thread in the route, replacing the current history entry. */
    private syncToRoute() {
        if (!this.isOnRoute()) return;

        const {name, params} = XH.routerState,
            {param} = this.route,
            threadId = this.selectedThreadId;
        if ((params[param] ?? null) === threadId) return;

        XH.navigate(
            name,
            {...omit(params, param), ...(threadId ? {[param]: threadId} : {})},
            {
                replace: true
            }
        );
    }
}

//------------------
// Implementation
//------------------
/** Wait after the search changes before the list reloads. */
const SEARCH_DEBOUNCE_MS = 300;

/** A rename or delete, laid over the threads - see `changeThreadsAsync`. */
interface PendingChange {
    threadId: string;

    /** Fields changed, or null for a delete. */
    changes: Partial<ChatThreadSummary>;

    /** Number of the first list requested after the store call succeeded, or Infinity. */
    doneBefore: number;
}

/** Draft and run options of a closed thread. */
interface ThreadDraft {
    text: string;
    runOptions: PlainObject;
}

/** A thread with a change applied, or null if the change deletes it. */
function applyChange(thread: ChatThreadSummary, change: PendingChange): ChatThreadSummary {
    if (thread.id !== change.threadId) return thread;
    return change.changes ? {...thread, ...change.changes} : null;
}

function applyChanges(thread: ChatThreadSummary, changes: PendingChange[]): ChatThreadSummary {
    return changes.reduce((ret, change) => ret && applyChange(ret, change), thread);
}
