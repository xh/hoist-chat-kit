import {
    compact,
    difference,
    differenceBy,
    find,
    isEmpty,
    keys,
    omit,
    pickBy,
    some,
    union,
    without
} from 'lodash';
import type {LoadSpec} from '@xh/hoist/core';
import {HoistModel, managed, TaskObserver, XH} from '@xh/hoist/core';
import {action, bindable, computed, observable, observableRef} from '@xh/hoist/mobx';
import {debounced, throwIf} from '@xh/hoist/utils/js';
import {ChatKit, type ChatModel} from '../core';
import {genChatId} from '../impl/ids';
import type {
    ChatConversation,
    ChatConversationEndedEarly,
    ChatConversationSpec,
    ChatSeedSpec
} from './ChatConversation';
import type {ChatThreadPage, ChatThreadStore, ChatThreadSummary} from './ChatThreadStore';
import {ChatModelConversation} from './impl/ChatModelConversation';
import {ChatModelDrafts} from './impl/ChatModelDrafts';
import {OpenThread} from './impl/OpenThread';
import {isNotFound, UNTITLED_THREAD} from './impl/threadUtils';

/** Configuration for a {@link ChatThreadsModel}. */
export interface ChatThreadsConfig {
    /** Adapter to the backend that stores the threads. */
    store: ChatThreadStore;

    /**
     * Create the chat for a thread. Pass `threadId` to the `ChatModel` config, and wire the
     * transport, tools and other config as for any chat. Called each time a thread opens: when
     * it is selected, or created with `newThread`. The threads model loads each thread's history
     * through the store's `loadMessagesAsync`, which this option requires.
     *
     * Give this or `createConversation`, not both.
     */
    createChatModel?: (spec: ChatConversationSpec) => ChatModel;

    /**
     * Create the conversation for a thread, for an app whose conversation runs on another
     * library rather than on a `ChatModel`. The conversation loads the thread's history itself -
     * see {@link ChatConversation}. Called each time a thread opens, as for `createChatModel`.
     *
     * Give this or `createChatModel`, not both.
     */
    createConversation?: (spec: ChatConversationSpec) => ChatConversation;

    /**
     * A route whose parameter holds the selected thread's id, for deep links. The selection and
     * the parameter then stay in sync both ways.
     */
    route?: ChatThreadsRoute;
}

/** @deprecated - use {@link ChatConversationSpec}. */
export type ChatThreadChatSpec = ChatConversationSpec;

/** A route that holds the selected thread - see {@link ChatThreadsConfig.route}. */
export interface ChatThreadsRoute {
    /** Fully qualified name of the route, such as 'default.chat'. */
    name: string;

    /** Name of the route parameter that holds the thread id, such as 'threadId'. */
    param: string;

    /**
     * Fully qualified name of the route that holds a thread, when it is a child of `name` with
     * the parameter in its path, such as 'default.chat.thread' with path '/:threadId'. The model
     * then navigates to it when a thread is selected, and back to `name` when none is. Default
     * none: the model stays on the current route and only sets or clears the parameter.
     */
    threadRoute?: string;
}

/** How a thread's last run ended early - see {@link ChatThreadsModel.endedEarlyThreads}. */
export interface ChatThreadEndedEarly {
    /** `failed` for a run that ended in an error, `interrupted` for one the server cut short. */
    runEnd: 'interrupted' | 'failed';

    /** Why the run ended so, for a tooltip, or null. */
    reason: string;
}

/**
 * Model for a user's threads - conversations stored by a backend - and the chats open on them.
 * The app implements a {@link ChatThreadStore} against its backend, and supplies a
 * `createChatModel` function that builds the chat for a thread. An app whose conversation runs on
 * another library supplies `createConversation` instead - see {@link ChatConversation}.
 *
 * The model lists the threads, with server-side search, and renames and deletes them at once,
 * rolling back with a toast if the store fails. It holds a conversation for each open thread: the
 * selected one, and any other with a turn running. A turn therefore runs on in the background
 * when the user switches threads, and the list shows its thread as running. A conversation that is
 * neither selected nor busy is destroyed. For a `ChatModel`, the thread's draft, run options and
 * unsent feedback comments are kept for when it opens again.
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
export class ChatThreadsModel extends HoistModel {
    declare config: ChatThreadsConfig;

    //-----------------------
    // Immutable Properties
    //-----------------------
    /** Adapter to the backend that stores the threads. */
    readonly store: ChatThreadStore;

    /** The route that holds the selected thread, or null. */
    readonly route: ChatThreadsRoute;

    /** Tracks loads of the thread list. */
    @managed readonly listTask = TaskObserver.trackLast();

    /** Tracks the load of the selected thread's history. */
    @managed readonly loadTask = TaskObserver.trackLast();

    //-----------------------
    // Observable State
    //-----------------------
    /** Id of the selected thread, or null before the first selection. (observable) */
    @observable accessor selectedThreadId: string = null;

    /** Text to search the threads for. The list reloads, debounced, when it changes. (bindable) */
    @bindable accessor search: string = null;

    /**
     * True while the app shows its chat. Default true. (bindable)
     *
     * The selection outlives the view that shows it. An app that keeps its chat behind a tab or
     * in a collapsed panel sets this false while the chat is out of view, and true as it shows
     * again. An app that always shows its chat leaves it alone. A route binding adds a condition
     * of its own - see {@link isSelectionShown}, which the model and the list read.
     */
    @bindable accessor isChatShown: boolean = true;

    /**
     * True while the user can see the selected thread: the app shows its chat, and with a
     * `route`, the router is on that route or a child of it.
     *
     * While false, a turn that ends in the selected thread counts as away - the list marks a new
     * reply, or a turn that ended early - and the list shows no selection. When it turns true,
     * the selected thread counts as seen, and its marks clear - unless the route names another
     * thread, which the route binding selects and marks seen instead. The thread left while
     * hidden keeps its marks.
     */
    @computed
    get isSelectionShown(): boolean {
        return this.isChatShown && (!this.route || this.isOnRoute);
    }

    /** Id of the thread the user is looking at: the selected thread while shown, else null. */
    @computed
    get shownThreadId(): string {
        return this.isSelectionShown ? this.selectedThreadId : null;
    }

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

    /**
     * The selected thread's chat, or null. Always null for conversations of the app's own, from
     * `createConversation` - read {@link conversation} for those.
     */
    @computed
    get chatModel(): ChatModel {
        return this.selectedThread?.chatModel ?? null;
    }

    /**
     * The selected thread's conversation, or null: the conversation `createConversation` made, or
     * the kit's own conversation around the `ChatModel` that `createChatModel` made.
     */
    @computed
    get conversation(): ChatConversation {
        return this.selectedThread?.conversation ?? null;
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
                .filter(it => it.conversation.isBusy)
                .map(it => it.conversation.threadId),
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
            .filter(it => it.conversation.isAwaitingUser)
            .map(it => it.conversation.threadId);
    }

    /**
     * Ids of the threads whose turn finished while the user was not looking at them: another
     * thread was selected, or the selected thread was hidden. A thread leaves it when the user
     * sees it. Held for the session only. A thread list shows each as having a new reply.
     */
    @observableRef accessor finishedAwayThreadIds: string[] = [];

    /**
     * Threads whose last run ended early, by thread id: failed, or cut short by the server. A
     * thread list marks each row. Two sources feed it:
     *
     *  - A turn that ended early while the user was not looking, in this session. The mark holds
     *    until the user sees the thread, or a new turn starts in it.
     *  - The store's `lastRunEnd` and `lastRunReason`, for a thread with no open chat, unless the
     *    user has seen the thread since its last activity in this session.
     */
    @computed
    get endedEarlyThreads(): Record<string, ChatThreadEndedEarly> {
        const ret: Record<string, ChatThreadEndedEarly> = {},
            {openThreads, seenActivityAt} = this;
        this.threads.forEach(({id, lastRunEnd, lastRunReason, lastActivityAt}) => {
            if (lastRunEnd !== 'interrupted' && lastRunEnd !== 'failed') return;
            if (openThreads[id] || lastActivityAt <= (seenActivityAt[id] ?? -Infinity)) return;
            ret[id] = {runEnd: lastRunEnd, reason: lastRunReason ?? null};
        });
        return {...ret, ...this.endedEarlyHere};
    }

    /**
     * Why the selected thread's history failed to load, or null. Sends wait in that thread - and
     * only that thread - until {@link reloadThreadAsync} succeeds.
     */
    @computed
    get loadError(): Error {
        return this.selectedThread?.loadError ?? null;
    }

    /**
     * True if the store reported the selected thread missing, with a 404. A deep link to a
     * deleted thread is the usual cause. A workspace shows "Thread not found" in place of its
     * chat.
     */
    @computed
    get isThreadNotFound(): boolean {
        return this.selectedThread?.loadState === 'notFound';
    }

    /**
     * True while the selected thread's history loads. Its chat holds no messages until the load
     * ends, so a layout shows a plain placeholder in its place, rather than a new chat's empty
     * state. A workspace does.
     */
    @computed
    get isThreadLoading(): boolean {
        return this.selectedThread?.loadState === 'loading';
    }

    /** True if the store can rename threads. */
    get canRename(): boolean {
        return !!this.store.renameThreadAsync;
    }

    /** True if the store can delete threads. */
    get canDelete(): boolean {
        return !!this.store.deleteThreadsAsync;
    }

    constructor(config: ChatThreadsConfig) {
        super();
        const {store, createChatModel, createConversation, route = null} = config;
        throwIf(!store, 'ChatThreadsModel requires a store.');
        throwIf(
            !createChatModel === !createConversation,
            'ChatThreadsModel requires a createChatModel or a createConversation function, not both.'
        );
        throwIf(
            createChatModel && !store.loadMessagesAsync,
            'ChatThreadsModel with createChatModel requires a store with loadMessagesAsync.'
        );

        this.store = store;
        this.createChatModel = createChatModel ?? null;
        this.createConversation = createConversation ?? null;
        this.route = route;

        this.addReaction({
            track: () => this.searchQuery,
            run: () => this.loadAsync(),
            debounce: SEARCH_DEBOUNCE_MS
        });
        this.addReaction({
            track: () => this.isSelectionShown,
            run: isShown => {
                if (!isShown) return;
                // A route that names another thread is about to select it, and marks that one
                // seen. The thread the user left while hidden keeps its marks.
                const routeId = this.routeThreadIdParam;
                if (routeId == null || routeId === this.selectedThreadId) {
                    this.markSeen(this.selectedThreadId);
                }
            }
        });
        if (route) {
            this.addReaction(
                {
                    track: () => XH.routerState,
                    run: () => this.syncFromRoute(),
                    fireImmediately: true
                },
                {
                    track: () => this.routeThreadId,
                    run: () => this.syncToRoute()
                }
            );
        }
    }

    /** Load the threads, for the current search. */
    override async doLoadAsync(loadSpec: LoadSpec) {
        // Ordered by a count of our own rather than `loadSpec.isStale`, as a list applies unless a
        // newer list has already applied.
        const search = this.searchQuery,
            listNumber = this.listCount++;

        try {
            const page = await this.store.listThreadsAsync({search}).linkTo(this.listTask);
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
     * Start a new thread, and select it. The thread exists only here until its first turn, when
     * the backend creates it. A backend that mints its own id reports it on `RUN_STARTED`.
     *
     * @returns the new thread's chat, or null for a conversation of the app's own - see
     *      {@link conversation}.
     */
    newThread(seed: ChatSeedSpec = {}): ChatModel {
        const thread = this.openThread(genChatId(), true, seed),
            {chatModel} = thread;
        if (chatModel) {
            if (seed.draft != null) chatModel.composerModel.text = seed.draft;
            if (seed.runOptions !== undefined) chatModel.runOptions = seed.runOptions;
        }
        this.setSelectedThreadId(thread.conversation.threadId);
        return chatModel;
    }

    /**
     * Select a thread, opening its chat and loading its history if it is not open already. A
     * thread that the store reports missing opens empty - see {@link isThreadNotFound}.
     *
     * @returns a promise that resolves once the history has loaded, or failed to - see
     *      {@link loadError}.
     */
    async selectThreadAsync(threadId: string): Promise<void> {
        throwIf(threadId == null, 'selectThreadAsync requires a thread id.');
        if (threadId === this.selectedThreadId) {
            // A click on the hidden selection asks to see it. Off the route, that is a navigation.
            this.navigateToSelection();
            return;
        }

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
        if (!thread || thread.conversation.isBusy) return;
        await this.loadHistoryAsync(thread);
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
     * Their chats close, a turn running in one is stopped, and their drafts are removed - from
     * memory and from local storage. If the selected thread is deleted, a new thread is selected.
     * Requires the store's `deleteThreadsAsync` - see {@link canDelete}.
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
            () => this.store.deleteThreadsAsync(threadIds)
        );
    }

    //------------------
    // Implementation
    //------------------
    private readonly createChatModel: (spec: ChatConversationSpec) => ChatModel;
    private readonly createConversation: (spec: ChatConversationSpec) => ChatConversation;

    // Threads with an open chat, by thread id.
    @observableRef private accessor openThreads: Record<string, OpenThread> = {};

    // Threads from the store's applied list, as the store sent them.
    @observableRef private accessor listedThreads: ChatThreadSummary[] = [];

    // Threads started here that the store has not listed yet, newest first.
    @observableRef private accessor localThreads: ChatThreadSummary[] = [];

    // When the user last saw each thread, in this session, by id - see `endedEarlyThreads`.
    @observableRef private accessor seenActivityAt: Record<string, number> = {};

    // Threads whose turn ended here and the user has seen end, to take the seen activity from the
    // next list, which may report it by a server clock that runs ahead: the number of the first
    // list request that can report the turn, by thread id. A new turn in the thread ends the wait.
    private readonly seenOnNextList = new Map<string, number>();

    // The same number for a turn that ended away, held until the user sees its mark - the list
    // that reports the turn may be in flight by then.
    private readonly awayTurnListNumbers = new Map<string, number>();

    // Threads whose turn ended early in the background, in this session - see `endedEarlyThreads`.
    @observableRef private accessor endedEarlyHere: Record<string, ChatThreadEndedEarly> = {};

    // Renames and deletes, laid over the threads until a list requested after they ended.
    @observableRef private accessor pendingChanges: PendingChange[] = [];

    // Search of the applied list.
    @observable private accessor listedSearch: string = null;

    // Lists requested, and the number of the last one applied - see `isListCurrent`.
    private listCount = 0;
    private appliedListNumber = -1;

    // Drafts, run options and feedback comments of closed chats, for when they open again.
    private readonly drafts = new ChatModelDrafts();

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
    /** Create the conversation for a thread, and wire it to this model. */
    private openThread(threadId: string, isNew: boolean, seed: ChatSeedSpec = null): OpenThread {
        const spec = {threadId, isNew, seed};
        let conversation: ChatConversation;
        if (this.createChatModel) {
            conversation = this.createChatModelConversation(spec, () => thread);
        } else {
            conversation = this.createConversation(spec);
            throwIf(
                conversation?.threadId !== threadId,
                'ChatThreadsConfig.createConversation must give the conversation the given threadId.'
            );
        }

        const thread = new OpenThread({
            conversation,
            isLoaded: isNew,
            onThreadIdChange: (it, prevThreadId) => this.onThreadIdChange(it, prevThreadId),
            onBusyChange: it => this.onBusyChange(it)
        });
        this.putOpenThread(threadId, thread);
        return thread;
    }

    /**
     * Create the chat for a thread with `createChatModel`, as the kit's own conversation.
     * @param getThread - the open thread the conversation will belong to, once it exists.
     */
    private createChatModelConversation(
        spec: ChatConversationSpec,
        getThread: () => OpenThread
    ): ChatModelConversation {
        const chatModel = this.createChatModel(spec);
        throwIf(
            chatModel?.threadId !== spec.threadId,
            'ChatThreadsConfig.createChatModel must pass the given threadId to the ChatModel.'
        );

        return new ChatModelConversation({
            chatModel,
            store: this.store,
            drafts: this.drafts,
            getSendBlockedReason: () => this.getSendBlockedReason(getThread()),
            refreshStatusAsync: () => this.refreshStatusAsync(getThread())
        });
    }

    /**
     * Reload a thread's history, to learn how a run ended that its chat lost sight of. A turn
     * still running here - one that stalled - is detached first, as the server may finish it.
     */
    private async refreshStatusAsync(thread: OpenThread): Promise<void> {
        if (thread.loadState === 'loading') return;
        const conversation = thread.conversation as ChatModelConversation;
        if (conversation.isBusy) conversation.detach();
        await this.loadHistoryAsync(thread);
    }

    private getSendBlockedReason(thread: OpenThread): string {
        switch (thread.loadState) {
            case 'loading':
                return 'Wait for the conversation to load.';
            case 'failed':
                return 'The conversation did not load. Reload it to continue.';
            case 'notFound':
                return 'This conversation does not exist. Start a new chat.';
        }
        return null;
    }

    @action
    private onThreadIdChange(thread: OpenThread, prevThreadId: string) {
        const {conversation, chatModel} = thread,
            {threadId, isBusy} = conversation;
        if (this.openThreads[prevThreadId] !== thread) return;

        // A conversation changes its thread id mid-turn only to adopt the backend's id for the
        // same thread. Otherwise the app cleared it, or loaded other messages into it, and it
        // holds a new thread.
        if (isBusy) {
            this.rekeyThread(prevThreadId, threadId);
        } else {
            thread.resetLoad();
            // A cleared chat holds a thread the backend has not seen. Loaded history with a user
            // message is saved - a greeting alone is not. A conversation of the app's own says
            // through its `isSaved`, or holds a loaded thread if it leaves that out.
            thread.setSaved(
                chatModel ? some(chatModel.messages, 'isUser') : (conversation.isSaved ?? true)
            );
        }
        this.openThreads = {...omit(this.openThreads, prevThreadId), [threadId]: thread};
        if (this.selectedThreadId === prevThreadId) this.selectedThreadId = threadId;
    }

    private onBusyChange(thread: OpenThread) {
        const {conversation} = thread,
            {threadId} = conversation;
        this.noteActivity(conversation);
        if (conversation.isBusy) {
            this.clearEndedEarly(threadId);
            this.seenOnNextList.delete(threadId);
            this.awayTurnListNumbers.delete(threadId);
            return;
        }

        // The backend has seen the thread once a run of it started. A turn that failed before
        // any response, or stopped before the run started, leaves it unsaved. A conversation of
        // the app's own that does not report `isSaved` counts as saved once a turn ends, unless
        // the turn was cancelled - the store's list decides then.
        const endedEarly = conversation.endedEarly ?? null;
        if (conversation instanceof ChatModelConversation) {
            if (conversation.hasRunStarted) thread.setSaved(true);
        } else if (conversation.isSaved == null && endedEarly?.runEnd !== 'cancelled') {
            thread.setSaved(true);
        }
        // A turn that pauses for the user has not finished - the thread lists as awaiting.
        if (!conversation.isAwaitingUser) this.noteTurnEnd(threadId, endedEarly);
        // The backend may have set a title, or the thread's place in the list may change.
        this.refreshThreadsSoon();
        this.closeIdleThreads();
    }

    // Turns that end close together reload the list once.
    @debounced(1000)
    private refreshThreadsSoon() {
        if (!this.isDestroyed) this.refreshAsync();
    }

    /**
     * Mark a thread whose turn ended while the user was not looking at it - another thread was
     * selected, or the selected thread was hidden: as ended early if it did, else as finished
     * away. A turn the user cancelled leaves no mark, as there is no reply to see.
     */
    @action
    private noteTurnEnd(threadId: string, endedEarly: ChatConversationEndedEarly) {
        if (threadId === this.shownThreadId) {
            this.noteSeen(threadId);
            // The next list may report the turn's activity by a server clock that runs ahead.
            this.seenOnNextList.set(threadId, this.listCount);
            return;
        }
        if (endedEarly?.runEnd === 'cancelled') return;
        this.awayTurnListNumbers.set(threadId, this.listCount);
        if (endedEarly?.runEnd) {
            this.endedEarlyHere = {...this.endedEarlyHere, [threadId]: endedEarly};
        } else {
            this.finishedAwayThreadIds = union(this.finishedAwayThreadIds, [threadId]);
        }
    }

    /**
     * Record that the user has seen a thread as of now, or as of its listed activity if that is
     * later - a server's clock may run ahead.
     */
    @action
    private noteSeen(threadId: string) {
        if (threadId == null) return;
        const listed = find(this.threads, {id: threadId})?.lastActivityAt ?? 0;
        this.seenActivityAt = {...this.seenActivityAt, [threadId]: Math.max(Date.now(), listed)};
    }

    /**
     * Raise the seen activity of threads whose turn the user watched end to the activity the
     * store lists for them - see `seenOnNextList`. Only a list requested after the turn ended
     * counts. An unfiltered one that leaves a thread out ends its wait.
     */
    @action
    private noteSeenFromList(threads: ChatThreadSummary[], listNumber: number, search: string) {
        this.seenOnNextList.forEach((firstListNumber, id) => {
            if (listNumber < firstListNumber) return;
            const listed = find(threads, {id});
            if (!listed && search != null) return;
            this.seenOnNextList.delete(id);
            if (!listed) return;
            const seen = Math.max(this.seenActivityAt[id] ?? 0, listed.lastActivityAt ?? 0);
            this.seenActivityAt = {...this.seenActivityAt, [id]: seen};
        });
    }

    @action
    private clearEndedEarly(threadId: string) {
        if (this.endedEarlyHere[threadId])
            this.endedEarlyHere = omit(this.endedEarlyHere, threadId);
    }

    @action
    private setSelectedThreadId(threadId: string) {
        // The user has seen the thread they open, and the one they leave, as of now - if they
        // can see the selection at all, and unless the one they leave still carries a mark they
        // have not seen, as one selected while hidden does. A hidden selection counts as seen
        // once it shows.
        const prevId = this.selectedThreadId;
        if (this.isSelectionShown) {
            if (!this.hasUnseenMark(prevId)) this.noteSeen(prevId);
            this.markSeen(threadId);
        }
        this.selectedThreadId = threadId;
        this.loadTask.clear();
        this.closeIdleThreads();
    }

    /**
     * Record that the user has seen a thread as of now, and clear its marks. A mark is for a turn
     * that ended here, which the next list may report by a server clock that runs ahead, so the
     * seen time takes that activity too - see `seenOnNextList`.
     */
    @action
    private markSeen(threadId: string) {
        if (threadId == null) return;
        this.noteSeen(threadId);
        if (this.hasUnseenMark(threadId)) {
            const listNumber = this.awayTurnListNumbers.get(threadId) ?? this.listCount;
            this.seenOnNextList.set(threadId, listNumber);
        }
        this.awayTurnListNumbers.delete(threadId);
        this.finishedAwayThreadIds = without(this.finishedAwayThreadIds, threadId);
        this.clearEndedEarly(threadId);
    }

    /** True if a thread carries a mark for a turn the user has not seen end. */
    private hasUnseenMark(threadId: string): boolean {
        return this.finishedAwayThreadIds.includes(threadId) || !!this.endedEarlyHere[threadId];
    }

    @action
    private putOpenThread(threadId: string, thread: OpenThread) {
        this.openThreads = {...this.openThreads, [threadId]: thread};
    }

    /**
     * Close the chats that are not selected, and neither run a turn nor wait for the user, keeping
     * their drafts. A chat whose turn ended early in the background stays open until the user has
     * seen it, as a backend may not store a failed turn, and the chat holds its error and Retry.
     */
    @action
    private closeIdleThreads() {
        const idle = pickBy(
            this.openThreads,
            (thread, id) =>
                id !== this.selectedThreadId &&
                !thread.conversation.isBusy &&
                !thread.conversation.isAwaitingUser &&
                !this.endedEarlyHere[id]
        );
        if (isEmpty(idle)) return;

        // A thread the backend never saw can never be listed or opened again, so its drafts go.
        const unsavedIds: string[] = [];
        Object.entries(idle).forEach(([id, thread]) => {
            if (this.isThreadSaved(thread)) {
                const {conversation} = thread;
                if (conversation instanceof ChatModelConversation) conversation.saveDraft(id);
            } else {
                unsavedIds.push(id);
            }
            thread.destroy();
        });
        // After the chats close, as a composer saves its draft when destroyed.
        if (!isEmpty(unsavedIds)) ChatKit.clearLocalData(unsavedIds);
        this.openThreads = omit(this.openThreads, keys(idle));
    }

    /** True if the backend may have a thread: saved by its chat, or listed by the store. */
    private isThreadSaved(thread: OpenThread): boolean {
        const {threadId} = thread.conversation;
        return thread.isSaved || some(this.listedThreads, {id: threadId});
    }

    /**
     * Close the chats of threads being deleted, stopping any turn, and drop their drafts - from
     * memory and from local storage.
     */
    @action
    private closeThreads(threadIds: string[]) {
        threadIds.forEach(id => {
            const thread = this.openThreads[id];
            thread?.conversation.stop();
            thread?.destroy();
            this.drafts.remove(id);
            this.seenOnNextList.delete(id);
            this.awayTurnListNumbers.delete(id);
        });
        // After the chats close, as a composer saves its draft when destroyed.
        ChatKit.clearLocalData(threadIds);
        this.openThreads = omit(this.openThreads, threadIds);
        this.finishedAwayThreadIds = difference(this.finishedAwayThreadIds, threadIds);
        this.endedEarlyHere = omit(this.endedEarlyHere, threadIds);
    }

    //------------------------
    // History
    //------------------------
    private async loadHistoryAsync(thread: OpenThread) {
        const {threadId} = thread.conversation,
            loadKey = thread.beginLoad();

        try {
            await thread.conversation.loadAsync().linkTo(this.loadTask);
            if (thread.isLoadCurrent(loadKey)) thread.endLoad();
        } catch (e) {
            if (!thread.isLoadCurrent(loadKey)) {
                this.logWarn(`Discarded a failed load of thread ${threadId}, no longer open`, e);
            } else if (isNotFound(e)) {
                thread.endLoadNotFound();
            } else {
                thread.endLoad(e);
                XH.handleException(e, {showAlert: false});
            }
        }
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
        this.localThreads = differenceBy(this.localThreads, threads, 'id');
        this.noteSeenFromList(threads, listNumber, this.listedSearch);
        this.pendingChanges = this.pendingChanges.filter(it => listNumber < it.doneBefore);
        this.listError = null;
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

    /** Record activity in a conversation's thread, adding a summary for a thread not listed yet. */
    @action
    private noteActivity(conversation: ChatConversation) {
        const {threadId} = conversation,
            lastActivityAt = Date.now();
        if (this.hasThread(threadId)) {
            this.updateThread(threadId, {lastActivityAt});
            return;
        }

        const title = conversation.title || UNTITLED_THREAD;
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
        [this.seenOnNextList, this.awayTurnListNumbers].forEach(map => {
            if (!map.has(prevThreadId)) return;
            map.set(threadId, map.get(prevThreadId));
            map.delete(prevThreadId);
        });
    }

    //------------------------
    // Route binding
    //------------------------
    /** The thread id in the route's parameter, or null - with a `route`, on it or not. */
    private get routeThreadIdParam(): string {
        return this.route ? (XH.routerState?.params?.[this.route.param] ?? null) : null;
    }

    @computed
    private get isOnRoute(): boolean {
        const name = XH.routerState?.name,
            routeName = this.route.name;
        return name === routeName || !!name?.startsWith(routeName + '.');
    }

    /**
     * Select the thread in the route. A route with no thread takes the selection. Off the route,
     * the selection stays, hidden, for the user's return.
     */
    private syncFromRoute() {
        if (!this.isOnRoute) return;

        const threadId = this.routeThreadIdParam;
        if (threadId == null) {
            this.syncToRoute();
        } else if (threadId !== this.selectedThreadId) {
            this.selectThreadAsync(threadId);
        } else if (this.isSelectionShown && this.hasUnseenMark(threadId)) {
            // Shown while the router still named the thread left behind, so not yet seen.
            this.markSeen(threadId);
        }
    }

    /** Bring the router to the selected thread from another route, as a click on its row asks. */
    private navigateToSelection() {
        const {route} = this;
        if (!route || this.isOnRoute) return;
        const threadId = this.routeThreadId;
        XH.navigate(
            threadId && route.threadRoute ? route.threadRoute : route.name,
            threadId ? {[route.param]: threadId} : {}
        );
    }

    /**
     * The thread id for the route: the selected thread's, once the backend may have it - see
     * `OpenThread.isSaved` - else null, which leaves the route on its base path.
     */
    @computed
    private get routeThreadId(): string {
        const {selectedThreadId: threadId, selectedThread: thread} = this;
        return thread && this.isThreadSaved(thread) ? threadId : null;
    }

    /** Put the selected thread in the route, replacing the current history entry. */
    private syncToRoute() {
        if (!this.isOnRoute) return;

        const {name, params} = XH.routerState,
            {param, threadRoute} = this.route,
            threadId = this.routeThreadId;
        if ((params[param] ?? null) === threadId) return;

        const target = threadRoute ? (threadId ? threadRoute : this.route.name) : name;
        XH.navigate(
            target,
            {...omit(params, param), ...(threadId ? {[param]: threadId} : {})},
            {replace: true}
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

/** A thread with a change applied, or null if the change deletes it. */
function applyChange(thread: ChatThreadSummary, change: PendingChange): ChatThreadSummary {
    if (thread.id !== change.threadId) return thread;
    return change.changes ? {...thread, ...change.changes} : null;
}

function applyChanges(thread: ChatThreadSummary, changes: PendingChange[]): ChatThreadSummary {
    return changes.reduce((ret, change) => ret && applyChange(ret, change), thread);
}
