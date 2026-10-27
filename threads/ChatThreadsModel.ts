import {
    compact,
    difference,
    differenceBy,
    find,
    isEmpty,
    keyBy,
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
     * the thread then shown counts as seen a moment later, and its marks clear. A selection made
     * as the chat shows, by the app or by the route binding, is the one that counts, and a thread
     * left while hidden keeps its marks.
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
    @computed
    get finishedAwayThreadIds(): string[] {
        return without(this.finishedAwayHere, this.shownThreadId);
    }

    /**
     * Threads whose last run ended early, by thread id: failed, or cut short by the server. A
     * thread list marks each row. Two sources feed it:
     *
     *  - A turn that ended early while the user was not looking, in this session. The mark holds
     *    until the user sees the thread, or a new turn starts in it.
     *  - The store's `lastRunEnd` and `lastRunReason`, for a thread the user is not looking at,
     *    and whose turn neither runs nor waits here, unless the user has seen the thread since
     *    its last activity in this session.
     */
    @computed
    get endedEarlyThreads(): Record<string, ChatThreadEndedEarly> {
        const ret: Record<string, ChatThreadEndedEarly> = {},
            {shownThreadId, openThreads, seenActivityAt} = this;
        this.threads.forEach(({id, lastRunEnd, lastRunReason, lastActivityAt}) => {
            if (lastRunEnd !== 'interrupted' && lastRunEnd !== 'failed') return;
            // Not for a thread whose turn runs or waits here: the store's mark is of an earlier
            // run. A hidden selection, idle, keeps it.
            const conversation = openThreads[id]?.conversation;
            if (conversation?.isBusy || conversation?.isAwaitingUser) return;
            if (lastActivityAt <= (seenActivityAt[id] ?? -Infinity)) return;
            ret[id] = {runEnd: lastRunEnd, reason: lastRunReason ?? null};
        });
        return omit({...ret, ...this.endedEarlyHere}, shownThreadId);
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
        // The one place a thread counts as seen: the thread the user looks at, as it changes. It
        // follows by a tick, so that a selection made as the chat shows - by the app in its next
        // statement, or by the route binding - is the one that counts, and a thread selected
        // while hidden keeps its marks until it shows.
        this.addReaction({
            track: () => this.shownThreadId,
            run: () => {
                // The thread looked at until now is the one last marked shown here - not the
                // reaction's previous value, which under the debounce may be a thread shown for
                // less than the tick. It keeps any mark that came since, as a turn may end in the
                // tick after the chat hides. The thread looked at now has no marks.
                const {lastShownId, shownThreadId} = this;
                if (!this.hasUnseenMark(lastShownId)) this.noteSeen(lastShownId);
                this.markSeen(shownThreadId);
                this.lastShownId = shownThreadId;
            },
            debounce: SEEN_ON_SHOW_MS
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

    // Threads whose turn ended here, to take the turn's activity as seen once the user has seen
    // the turn end, as a server clock that runs ahead may date the activity after the seen time.
    // By thread id: the number of the first list request that can report the turn, and the
    // activity a list reported before the user saw the turn end.
    private readonly seenOnNextList = new Map<string, TurnEndWait>();

    // Threads whose turn ended early in the background, in this session - see `endedEarlyThreads`.
    @observableRef private accessor endedEarlyHere: Record<string, ChatThreadEndedEarly> = {};

    // Threads whose turn finished in the background, in this session - see `finishedAwayThreadIds`.
    @observableRef private accessor finishedAwayHere: string[] = [];

    // The thread last counted as seen for being shown - the one the user looked at until now.
    private lastShownId: string = null;

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
            // A new turn: its reply is the one to see now.
            this.clearMarks(threadId);
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
        const isShown = threadId === this.shownThreadId,
            isCancelled = endedEarly?.runEnd === 'cancelled';
        // A cancelled turn the user did not watch leaves no mark, and no wait.
        if (!isShown && isCancelled) return;
        this.seenOnNextList.set(threadId, {listNumber: this.listCount, reportedActivityAt: null});
        if (isShown) {
            this.markSeen(threadId);
            return;
        }
        if (isThreadEndedEarly(endedEarly)) {
            this.endedEarlyHere = {...this.endedEarlyHere, [threadId]: endedEarly};
        } else {
            this.finishedAwayHere = union(this.finishedAwayHere, [threadId]);
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
        this.raiseSeen(threadId, Math.max(Date.now(), listed));
    }

    /**
     * Raise the seen activity of threads whose turn ended here, once the user has seen it end, to
     * the activity the store lists for them - see `seenOnNextList`. Only a list requested after
     * the turn ended counts, and a thread the user has not seen keeps waiting. An unfiltered list
     * that leaves a thread out ends its wait.
     */
    @action
    private noteSeenFromList(threads: ChatThreadSummary[], listNumber: number, search: string) {
        const byId = keyBy(threads, 'id');
        this.seenOnNextList.forEach((wait, id) => {
            if (listNumber < wait.listNumber) return;
            const listed = byId[id];
            if (!listed && search != null) return;
            if (!listed) {
                this.seenOnNextList.delete(id);
                return;
            }
            // Not until the user has seen the turn end. The seeing then takes the latest
            // reported activity - even if a search hides the thread by then.
            if (this.hasUnseenMark(id)) {
                wait.reportedActivityAt = listed.lastActivityAt ?? 0;
                return;
            }
            this.seenOnNextList.delete(id);
            this.raiseSeen(id, listed.lastActivityAt ?? 0);
        });
    }

    /** Raise a thread's seen activity to a time, if later. */
    @action
    private raiseSeen(threadId: string, activityAt: number) {
        const seen = Math.max(this.seenActivityAt[threadId] ?? 0, activityAt);
        this.seenActivityAt = {...this.seenActivityAt, [threadId]: seen};
    }

    @action
    private setSelectedThreadId(threadId: string) {
        // Seen follows the shown thread, in its reaction.
        this.selectedThreadId = threadId;
        this.loadTask.clear();
        this.closeIdleThreads();
    }

    /**
     * Record that the user has seen a thread as of now, and clear its marks. A turn that ended
     * here and that a list has reported meanwhile counts as seen at the activity it reported.
     * One not yet reported keeps its wait - see `seenOnNextList`.
     */
    @action
    private markSeen(threadId: string) {
        if (threadId == null) return;
        const listed = find(this.threads, {id: threadId})?.lastActivityAt ?? 0,
            wait = this.seenOnNextList.get(threadId);
        this.raiseSeen(threadId, Math.max(Date.now(), listed, wait?.reportedActivityAt ?? 0));
        if (wait?.reportedActivityAt != null) this.seenOnNextList.delete(threadId);
        this.clearMarks(threadId);
    }

    /** Clear a thread's new-reply and ended-early marks. */
    @action
    private clearMarks(threadId: string) {
        this.finishedAwayHere = without(this.finishedAwayHere, threadId);
        if (this.endedEarlyHere[threadId]) {
            this.endedEarlyHere = omit(this.endedEarlyHere, threadId);
        }
    }

    /** True if a thread carries a mark for a turn the user has not seen end. */
    private hasUnseenMark(threadId: string): boolean {
        return this.finishedAwayHere.includes(threadId) || !!this.endedEarlyHere[threadId];
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
            if (this.lastShownId === id) this.lastShownId = null;
        });
        // After the chats close, as a composer saves its draft when destroyed.
        ChatKit.clearLocalData(threadIds);
        this.openThreads = omit(this.openThreads, threadIds);
        this.finishedAwayHere = difference(this.finishedAwayHere, threadIds);
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

    /**
     * Record activity in a conversation's thread, adding a summary for a thread not listed yet.
     * A turn that starts makes the store's last run end stale, until the next list.
     */
    @action
    private noteActivity(conversation: ChatConversation) {
        const {threadId, isBusy} = conversation,
            lastActivityAt = Date.now();
        if (this.hasThread(threadId)) {
            this.updateThread(
                threadId,
                isBusy ? {lastActivityAt, lastRunEnd: null, lastRunReason: null} : {lastActivityAt}
            );
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
        // What this model holds by thread id. A conversation may adopt its id and start its
        // turn in one action, so a mark may still sit under the old id.
        if (this.lastShownId === prevThreadId) this.lastShownId = threadId;
        const seen = this.seenActivityAt[prevThreadId];
        if (seen != null) {
            this.seenActivityAt = {...omit(this.seenActivityAt, prevThreadId), [threadId]: seen};
        }
        this.finishedAwayHere = this.finishedAwayHere.map(it =>
            it === prevThreadId ? threadId : it
        );
        const endedEarly = this.endedEarlyHere[prevThreadId];
        if (endedEarly) {
            this.endedEarlyHere = {
                ...omit(this.endedEarlyHere, prevThreadId),
                [threadId]: endedEarly
            };
        }
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
        }
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
        if (this.routeThreadIdParam === threadId) return;

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

/** Wait after the selection shows before it counts as seen - the next tick. */
const SEEN_ON_SHOW_MS = 0;

/** True for a turn that failed or was interrupted - the ends a thread list marks. */
function isThreadEndedEarly(
    endedEarly: ChatConversationEndedEarly
): endedEarly is ChatThreadEndedEarly {
    return endedEarly?.runEnd === 'failed' || endedEarly?.runEnd === 'interrupted';
}

/** A turn that ended here, waiting to count as seen at the activity a list gives it. */
interface TurnEndWait {
    /** Number of the first list request that can report the turn. */
    listNumber: number;

    /** The activity a list reported for the turn before the user saw it end, or null. */
    reportedActivityAt: number;
}

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
