import {last} from 'lodash';
import {HoistBase, XH} from '@xh/hoist/core';
import {action, observable, observableRef} from '@xh/hoist/mobx';
import {wait} from '@xh/hoist/promise';
import {initTestAppAsync} from '@xh/hoist/test-support';
import {beforeAll, describe, expect, it, onTestFinished, vi} from 'vitest';
import {ChatKit} from '../core';
import type {
    ChatConversation,
    ChatConversationEndedEarly,
    ChatConversationSpec
} from './ChatConversation';
import {type ChatThreadsConfig, ChatThreadsModel} from './ChatThreadsModel';
import {LocalChatThreadStore} from '../test/support/LocalChatThreadStore';

/**
 * The thread layer over a conversation of the app's own, from `createConversation`. An app whose
 * conversation runs on another library keeps the kit's thread list and its model this way. The
 * threads model must drive that conversation as it drives a `ChatModel`: open it on selection,
 * load its history through it, keep it open while its turn runs, and close it when idle.
 */
describe('ChatThreadsModel with an app conversation', () => {
    beforeAll(async () => {
        await initTestAppAsync();
    });

    describe('config', () => {
        it('needs either createChatModel or createConversation, not both or neither', () => {
            const store = new LocalChatThreadStore();
            expect(() => new ChatThreadsModel({store})).toThrow('createChatModel or');
            expect(
                () =>
                    new ChatThreadsModel({
                        store,
                        createChatModel: () => null,
                        createConversation: () => null
                    })
            ).toThrow('not both');
        });

        it('needs no loadMessagesAsync from the store, as the conversation loads its history', () => {
            const {model} = setup({store: storeWithoutHistory()});
            expect(model.store.loadMessagesAsync).toBeUndefined();
        });

        it('still needs loadMessagesAsync with createChatModel', () => {
            expect(
                () =>
                    new ChatThreadsModel({
                        store: storeWithoutHistory(),
                        createChatModel: () => null
                    })
            ).toThrow('loadMessagesAsync');
        });

        it('throws if a conversation takes another thread id', async () => {
            const {model} = setup({createConversation: () => new TestConversation('other', true)});
            expect(() => model.newThread()).toThrow('given threadId');
        });
    });

    describe('opening threads', () => {
        it('opens a conversation for a selected thread and loads its history through it', async () => {
            const {model, store, conversations} = setup();
            await model.loadAsync();

            const selecting = model.selectThreadAsync('t1'),
                [conversation] = conversations;
            expect(conversation.spec).toEqual({threadId: 't1', isNew: false, seed: null});
            expect(conversation.loadCalls).toBe(1);
            expect(model.isThreadLoading).toBe(true);

            conversation.finishLoad();
            await selecting;

            expect(model.isThreadLoading).toBe(false);
            expect(model.conversation).toBe(conversation);
            expect(model.chatModel).toBeNull();
            expect(store.calls.map(it => it.method)).not.toContain('loadMessagesAsync');
        });

        it('opens a new thread with its seed, and loads nothing', () => {
            const {model, conversations} = setup(),
                seed = {draft: 'Summarize', runOptions: {scope: 'all'}},
                ret = model.newThread(seed),
                [conversation] = conversations;

            expect(ret).toBeNull();
            expect(conversation.spec).toMatchObject({isNew: true, seed});
            expect(conversation.loadCalls).toBe(0);
            expect(model.selectedThreadId).toBe(conversation.threadId);
            expect(model.isThreadLoading).toBe(false);
        });

        it('closes and destroys the conversation of a thread the user leaves', async () => {
            const {model, conversations} = setup();
            model.newThread();
            const [first] = conversations;

            await selectAsync(model, conversations, 't1');

            expect(first.isDestroyed).toBe(true);
            expect(model.conversation).toBe(last(conversations));
        });

        it('marks a thread not found when its load rejects with a 404', async () => {
            const {model, conversations} = setup(),
                selecting = model.selectThreadAsync('gone');

            conversations[0].failLoad(Object.assign(new Error('Not found'), {httpStatus: 404}));
            await selecting;

            expect(model.isThreadNotFound).toBe(true);
            expect(model.loadError).toBeNull();
        });

        it('reports a failed load, and loads again on reload', async () => {
            spyHandleException();
            const {model, conversations} = setup(),
                selecting = model.selectThreadAsync('t1'),
                [conversation] = conversations;

            conversation.failLoad(new Error('Load failed'));
            await selecting;
            expect(model.loadError.message).toBe('Load failed');

            const reloading = model.reloadThreadAsync();
            expect(conversation.loadCalls).toBe(2);
            conversation.finishLoad();
            await reloading;
            expect(model.loadError).toBeNull();
        });

        it('ignores a reload while a turn runs', async () => {
            const {model, conversations} = setup();
            await selectAsync(model, conversations, 't1');
            const [conversation] = conversations;
            conversation.set({isBusy: true});

            await model.reloadThreadAsync();

            expect(conversation.loadCalls).toBe(1);
        });

        it('never shows a failed load of a thread the user left in the next thread', async () => {
            const {model, conversations} = setup(),
                selecting = model.selectThreadAsync('t1'),
                [first] = conversations;

            await selectAsync(model, conversations, 't2');
            first.failLoad(new Error('Late failure'));
            await selecting;

            expect(model.selectedThreadId).toBe('t2');
            expect(model.loadError).toBeNull();
        });
    });

    describe('turns', () => {
        it('keeps a busy conversation open in the background, and lists its thread as running', async () => {
            const {model, conversations} = setup();
            await selectAsync(model, conversations, 't1');
            const [first] = conversations;
            first.set({isBusy: true});

            await selectAsync(model, conversations, 't2');

            expect(first.isDestroyed).toBe(false);
            expect(model.runningThreadIds).toEqual(['t1']);
        });

        it('marks a turn that ends away as a new reply, and closes its conversation', async () => {
            const {model, conversations} = setup();
            await selectAsync(model, conversations, 't1');
            const [first] = conversations;
            first.set({isBusy: true});
            await selectAsync(model, conversations, 't2');

            first.set({isBusy: false});

            expect(model.finishedAwayThreadIds).toEqual(['t1']);
            expect(model.runningThreadIds).toEqual([]);
            expect(first.isDestroyed).toBe(true);
        });

        it('marks a turn that ends in the selected thread while the chat is hidden, until it shows', async () => {
            const {model, conversations} = setup();
            await selectAsync(model, conversations, 't1');
            const [first] = conversations;
            model.isChatShown = false;
            first.set({isBusy: true});

            first.set({isBusy: false});
            expect(model.isSelectionShown).toBe(false);
            expect(model.finishedAwayThreadIds).toEqual(['t1']);
            expect(first.isDestroyed).toBe(false);

            model.isChatShown = true;
            await wait();
            expect(model.finishedAwayThreadIds).toEqual([]);
        });

        it('marks a turn that ends early away, with its reason', async () => {
            const {model, conversations} = setup();
            await selectAsync(model, conversations, 't1');
            const [first] = conversations;
            first.set({isBusy: true});
            await selectAsync(model, conversations, 't2');

            first.set({isBusy: false, endedEarly: {runEnd: 'failed', reason: 'Agent down'}});

            expect(model.endedEarlyThreads.t1).toEqual({runEnd: 'failed', reason: 'Agent down'});
            expect(model.finishedAwayThreadIds).toEqual([]);
        });

        it('marks nothing for a turn the user cancelled away, and closes its conversation', async () => {
            const {model, conversations} = setup();
            await selectAsync(model, conversations, 't1');
            const [first] = conversations;
            first.set({isBusy: true});
            await selectAsync(model, conversations, 't2');

            first.set({isBusy: false, endedEarly: {runEnd: 'cancelled', reason: null}});

            expect(model.finishedAwayThreadIds).toEqual([]);
            expect(model.endedEarlyThreads).toEqual({});
            expect(first.isDestroyed).toBe(true);
        });

        it('keeps a conversation that waits for the user open, and lists it as awaiting', async () => {
            const {model, conversations} = setup();
            await selectAsync(model, conversations, 't1');
            const [first] = conversations;
            first.set({isBusy: true});
            await selectAsync(model, conversations, 't2');

            first.set({isBusy: false, isAwaitingUser: true});

            expect(model.awaitingThreadIds).toEqual(['t1']);
            expect(first.isDestroyed).toBe(false);
        });

        it("lists a new thread when its turn starts, under the conversation's title", () => {
            const {model, conversations} = setup();
            model.newThread();
            const [conversation] = conversations;
            conversation.title = 'Q3 budget';

            conversation.set({isBusy: true});

            expect(model.threads[0]).toMatchObject({id: conversation.threadId, title: 'Q3 budget'});
        });

        it('re-keys a new thread whose conversation adopts the backend id mid-turn', () => {
            const {model, conversations} = setup();
            model.newThread();
            const [conversation] = conversations;
            conversation.set({isBusy: true});

            conversation.set({threadId: 'srv-1'});

            expect(model.selectedThreadId).toBe('srv-1');
            expect(model.threads[0].id).toBe('srv-1');
            expect(model.conversation).toBe(conversation);
        });

        it('reloads the list after a turn ends, for a title the backend set', async () => {
            const {model, store, conversations} = setup();
            await model.loadAsync();
            vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout', 'Date']});
            onTestFinished(() => {
                vi.useRealTimers();
            });
            model.newThread();
            const [conversation] = conversations;
            conversation.set({isBusy: true});
            store.saveThread({id: conversation.threadId, title: 'Named by the server'});

            conversation.set({isBusy: false});
            await vi.advanceTimersByTimeAsync(1000);

            expect(model.threads[0]).toMatchObject({
                id: conversation.threadId,
                title: 'Named by the server'
            });
        });
    });

    describe('saved threads', () => {
        it('drops an unsaved new thread when it closes', () => {
            const clearLocalData = spyClearLocalData(),
                {model, conversations} = setup();
            model.newThread();
            const [first] = conversations;

            model.newThread();

            expect(clearLocalData).toHaveBeenCalledWith([first.threadId]);
        });

        it('counts a new thread saved once the conversation says so', () => {
            const clearLocalData = spyClearLocalData(),
                {model, conversations} = setup();
            model.newThread();
            const [first] = conversations;
            first.set({isSaved: true});

            model.newThread();

            expect(clearLocalData).not.toHaveBeenCalled();
        });

        it('keeps a new thread unsaved after a turn that never reached the backend', () => {
            const clearLocalData = spyClearLocalData(),
                {model, conversations} = setup();
            model.newThread();
            const [first] = conversations;
            first.set({isSaved: false});
            first.set({isBusy: true});
            first.set({isBusy: false});

            model.newThread();

            expect(clearLocalData).toHaveBeenCalledWith([first.threadId]);
        });

        it('drops the row of an unsaved thread once its chat closes', () => {
            spyClearLocalData();
            const {model, conversations} = setup();
            model.newThread();
            const [first] = conversations;
            first.set({isSaved: false});
            first.set({isBusy: true});
            expect(model.threads.map(it => it.id)).toContain(first.threadId);
            first.set({isBusy: false});

            model.newThread();

            expect(model.threads.map(it => it.id)).not.toContain(first.threadId);
        });

        it('counts a new thread saved once a turn ends, for a conversation with no isSaved', () => {
            const clearLocalData = spyClearLocalData(),
                {model, conversations} = setup();
            model.newThread();
            const [first] = conversations;
            first.set({isBusy: true});
            first.set({isBusy: false});

            model.newThread();

            expect(clearLocalData).not.toHaveBeenCalled();
        });

        it('leaves a new thread unsaved after a cancelled turn, for a conversation with no isSaved', () => {
            const clearLocalData = spyClearLocalData(),
                {model, conversations} = setup();
            model.newThread();
            const [first] = conversations;
            first.set({isBusy: true});
            first.set({isBusy: false, endedEarly: {runEnd: 'cancelled'}});

            model.newThread();

            expect(clearLocalData).toHaveBeenCalledWith([first.threadId]);
        });

        it('takes a null isSaved as left out', () => {
            const clearLocalData = spyClearLocalData(),
                {model, conversations} = setup();
            model.newThread();
            const [first] = conversations;
            first.set({isSaved: null});
            first.set({isBusy: true});
            first.set({isBusy: false});

            model.newThread();

            expect(clearLocalData).not.toHaveBeenCalled();
        });
    });

    describe('deletes', () => {
        it('stops and destroys the conversation of a deleted thread, and opens a new one', async () => {
            const {model, conversations} = setup();
            await model.loadAsync();
            await selectAsync(model, conversations, 't1');
            const [first] = conversations;
            first.set({isBusy: true});

            await model.deleteThreadsAsync(['t1']);

            expect(first.stopCalls).toBe(1);
            expect(first.isDestroyed).toBe(true);
            expect(model.threads.map(it => it.id)).toEqual(['t2']);
            expect(last(conversations).spec.isNew).toBe(true);
            expect(model.selectedThreadId).toBe(last(conversations).threadId);
        });
    });
});

//------------------
// Implementation
//------------------
const THREADS = [
    {id: 't1', title: 'Budget', lastActivityAt: Date.now() - 1000},
    {id: 't2', title: 'Travel', lastActivityAt: Date.now() - 2000}
];

/** A conversation an app might write over another library, with loads the test controls. */
class TestConversation extends HoistBase implements ChatConversation {
    @observable accessor threadId: string;
    @observable accessor isBusy = false;
    @observable accessor isAwaitingUser = false;
    @observable accessor isSaved: boolean = undefined;
    @observableRef accessor endedEarly: ChatConversationEndedEarly = null;
    title: string = null;

    loadCalls = 0;
    stopCalls = 0;
    private pendingLoad: {resolve: () => void; reject: (e: Error) => void} = null;

    constructor(
        threadId: string,
        readonly isNew: boolean,
        readonly spec: ChatConversationSpec = null
    ) {
        super();
        this.threadId = threadId;
    }

    loadAsync(): Promise<void> {
        this.loadCalls++;
        return new Promise((resolve, reject) => (this.pendingLoad = {resolve, reject}));
    }

    finishLoad() {
        this.pendingLoad.resolve();
    }

    failLoad(e: Error) {
        this.pendingLoad.reject(e);
    }

    stop() {
        this.stopCalls++;
        this.set({isBusy: false});
    }

    @action
    set(changes: Partial<Pick<TestConversation, MutableKey>>) {
        Object.assign(this, changes);
    }
}

type MutableKey = 'threadId' | 'isBusy' | 'isAwaitingUser' | 'isSaved' | 'endedEarly';

function setup(config: Partial<ChatThreadsConfig> = {}) {
    const conversations: TestConversation[] = [],
        model = new ChatThreadsModel({
            store: new LocalChatThreadStore({threads: THREADS}),
            createConversation: spec => {
                const ret = new TestConversation(spec.threadId, spec.isNew, spec);
                conversations.push(ret);
                return ret;
            },
            ...config
        });
    onTestFinished(() => model.destroy());
    return {model, store: model.store as LocalChatThreadStore, conversations};
}

/** Select a thread, and finish the load of its new conversation. */
async function selectAsync(
    model: ChatThreadsModel,
    conversations: TestConversation[],
    threadId: string
) {
    const count = conversations.length,
        selecting = model.selectThreadAsync(threadId);
    if (conversations.length > count) last(conversations).finishLoad();
    await selecting;
    await wait();
}

function storeWithoutHistory(): LocalChatThreadStore {
    const ret = new LocalChatThreadStore({threads: THREADS});
    (ret as any).loadMessagesAsync = undefined;
    return ret;
}

function spyHandleException() {
    const ret = vi.spyOn(XH, 'handleException').mockImplementation(() => {});
    onTestFinished(() => ret.mockRestore());
    return ret;
}

function spyClearLocalData() {
    const ret = vi.spyOn(ChatKit, 'clearLocalData');
    onTestFinished(() => ret.mockRestore());
    return ret;
}
