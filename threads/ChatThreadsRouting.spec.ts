import {HoistBase, type HoistRoute, XH} from '@xh/hoist/core';
import {action, observable} from '@xh/hoist/mobx';
import {wait} from '@xh/hoist/promise';
import {initTestAppAsync, TestAppModel} from '@xh/hoist/test-support';
import {beforeAll, beforeEach, describe, expect, it, onTestFinished, vi} from 'vitest';
import {ChatModel} from '../core';
import {
    type ChatEvent,
    type ChatRunRequest,
    ScriptedChatTransport,
    type ScriptedChatTransportConfig,
    textEvents
} from '../transport';
import type {ChatConversation} from './ChatConversation';
import {ChatThreadsModel, type ChatThreadsRoute} from './ChatThreadsModel';
import {LocalChatThreadStore} from '../test/support/LocalChatThreadStore';

/**
 * Route binding for ChatThreadsModel, against Hoist's real router. A deep link must open its
 * thread, and a selection must show in the URL without adding a history entry, so that Back
 * leaves the chat rather than stepping through every thread the user looked at.
 */
describe('ChatThreadsModel route binding', () => {
    beforeAll(async () => {
        await initTestAppAsync({modelClass: RoutedTestModel});
    });

    beforeEach(async () => {
        await navigateAsync('default.other');
    });

    it('selects the thread in a deep link', async () => {
        await navigateAsync('default.chat', {threadId: 't1'});

        const model = createModel();

        await vi.waitFor(() => expect(model.chatModel?.lastMessage?.text).toBe('Hello.'));
        expect(model.selectedThreadId).toBe('t1');
    });

    it('marks a deep-linked thread that the store reports missing as not found', async () => {
        await navigateAsync('default.chat', {threadId: 'deleted'});

        const model = createModel();

        await vi.waitFor(() => expect(model.isThreadNotFound).toBe(true));
        expect(model.selectedThreadId).toBe('deleted');

        model.newThread();
        await vi.waitFor(() => expect(XH.routerState.params.threadId).toBeUndefined());
        expect(model.isThreadNotFound).toBe(false);
    });

    it('keeps a new thread out of the route until its first send, so a reload opens a new chat', async () => {
        await navigateAsync('default.chat', {threadId: 't1'});
        const first = createModel();
        await vi.waitFor(() => expect(first.selectedThreadId).toBe('t1'));

        first.newThread();
        await vi.waitFor(() => expect(XH.routerState.params.threadId).toBeUndefined());
        first.destroy();

        const second = createModel();
        await wait(50);
        expect(second.selectedThreadId).toBeNull();
        expect(second.isThreadNotFound).toBe(false);
    });

    it('follows the route to another thread', async () => {
        await navigateAsync('default.chat', {threadId: 't1'});
        const model = createModel();

        await navigateAsync('default.chat', {threadId: 't2'});

        await vi.waitFor(() => expect(model.selectedThreadId).toBe('t2'));
    });

    it('puts the selection in the route, with no new history entry', async () => {
        await navigateAsync('default.chat');
        const model = createModel(),
            historyLength = window.history.length;

        await model.selectThreadAsync('t2');

        await vi.waitFor(() => expect(XH.routerState.params.threadId).toBe('t2'));
        expect(window.history.length).toBe(historyLength);
    });

    it('fills a route with no thread from the selection', async () => {
        const model = createModel();
        await model.selectThreadAsync('t1');

        await navigateAsync('default.chat');

        await vi.waitFor(() => expect(XH.routerState.params.threadId).toBe('t1'));
    });

    it("puts a new thread in the route under the server's id, once its reply starts", async () => {
        await navigateAsync('default.chat');
        const model = createModel(),
            chatModel = model.newThread(),
            localId = chatModel.threadId,
            navigate = vi.spyOn(XH, 'navigate');
        onTestFinished(() => navigate.mockRestore());
        await wait(50);
        expect(XH.routerState.params.threadId).toBeUndefined();

        await chatModel.sendAsync('Hello');

        expect(chatModel.threadId).toBe('srv-1');
        await vi.waitFor(() => expect(XH.routerState.params.threadId).toBe('srv-1'));
        expect(navigate.mock.calls.map(it => it[1]?.threadId)).not.toContain(localId);
    });

    it('keeps a new thread out of the route after a turn that never reached the backend', async () => {
        await navigateAsync('default.chat');
        vi.spyOn(XH, 'handleException').mockImplementation(() => {});
        const failing = createModel(() => {
                throw new Error('Network down.');
            }),
            failed = failing.newThread();
        await failed.sendAsync('Hello');
        expect(failed.status).toBe('error');
        await wait(50);
        expect(XH.routerState.params.threadId).toBeUndefined();
        failing.destroy();

        const stopping = createModel(untilAborted),
            stopped = stopping.newThread(),
            sent = stopped.sendAsync('Hello');
        stopped.stop();
        await sent;

        await wait(50);
        expect(XH.routerState.params.threadId).toBeUndefined();
    });

    it('never puts a thread in the route that is deleted before its first reply', async () => {
        await navigateAsync('default.chat', {threadId: 't1'});
        const model = createModel(untilAborted),
            navigate = vi.spyOn(XH, 'navigate');
        await vi.waitFor(() => expect(model.selectedThreadId).toBe('t1'));
        const chatModel = model.newThread(),
            {threadId} = chatModel;
        chatModel.sendAsync('Hello');

        await model.deleteThreadsAsync([threadId]);
        await wait(50);

        expect(navigate.mock.calls.map(it => it[1]?.threadId)).not.toContain(threadId);
        expect(XH.routerState.params.threadId).toBeUndefined();
    });

    it('keeps a chat cleared and loaded with only a greeting out of the route', async () => {
        await navigateAsync('default.chat', {threadId: 't1'});
        const model = createModel();
        await vi.waitFor(() => expect(model.selectedThreadId).toBe('t1'));

        model.chatModel.loadMessages([{role: 'assistant', content: 'Ask me anything.'}]);

        await vi.waitFor(() => expect(XH.routerState.params.threadId).toBeUndefined());
    });

    it("puts an app conversation's new thread in the route under the id it adopts", async () => {
        await navigateAsync('default.chat');
        const opened: AppConversation[] = [],
            model = new ChatThreadsModel({
                store: new LocalChatThreadStore(),
                createConversation: ({threadId}) => {
                    const ret = new AppConversation(threadId);
                    opened.push(ret);
                    return ret;
                },
                route: {name: 'default.chat', param: 'threadId'}
            }),
            navigate = vi.spyOn(XH, 'navigate');
        onTestFinished(() => {
            navigate.mockRestore();
            model.destroy();
        });
        model.newThread();
        const [conversation] = opened,
            localId = conversation.threadId;
        conversation.set({isBusy: true});

        // Saved before the new id, in one action - the route must wait for the re-key.
        conversation.set({isSaved: true, threadId: 'srv-1'});

        await vi.waitFor(() => expect(XH.routerState.params.threadId).toBe('srv-1'));
        expect(model.selectedThreadId).toBe('srv-1');
        expect(navigate.mock.calls.map(it => it[1]?.threadId)).not.toContain(localId);
        expect(opened).toHaveLength(1);
    });

    it('marks a reply that finishes while the user is on another route as new', async () => {
        await navigateAsync('default.chat', {threadId: 't1'});
        // A reply with no server id, so that the thread keeps its id through the turn.
        const model = createModel(() => [textEvents('Still here.')]);
        await vi.waitFor(() => expect(model.selectedThreadId).toBe('t1'));

        await navigateAsync('default.other');
        await vi.waitFor(() => expect(model.isSelectionShown).toBe(false));
        await model.chatModel.sendAsync({text: 'Still here?'});

        expect(model.finishedAwayThreadIds).toEqual(['t1']);

        await navigateAsync('default.chat', {threadId: 't1'});
        await vi.waitFor(() => expect(model.isSelectionShown).toBe(true));
        expect(model.finishedAwayThreadIds).toEqual([]);
        expect(model.selectedThreadId).toBe('t1');
    });

    it('keeps the mark on a hidden thread when a deep link returns to another', async () => {
        await navigateAsync('default.chat', {threadId: 't1'});
        const model = createModel(() => [textEvents('Still here.')]);
        await vi.waitFor(() => expect(model.selectedThreadId).toBe('t1'));

        await navigateAsync('default.other');
        await vi.waitFor(() => expect(model.isSelectionShown).toBe(false));
        await model.chatModel.sendAsync({text: 'Still here?'});
        expect(model.finishedAwayThreadIds).toEqual(['t1']);

        await navigateAsync('default.chat', {threadId: 't2'});
        await vi.waitFor(() => expect(model.selectedThreadId).toBe('t2'));

        expect(model.isSelectionShown).toBe(true);
        expect(model.finishedAwayThreadIds).toEqual(['t1']);
    });

    it('hides the selection while the app says its chat is hidden, even on the route', async () => {
        await navigateAsync('default.chat', {threadId: 't1'});
        const model = createModel();
        await vi.waitFor(() => expect(model.selectedThreadId).toBe('t1'));

        model.isChatShown = false;
        expect(model.isSelectionShown).toBe(false);

        await navigateAsync('default.chat', {threadId: 't2'});
        await vi.waitFor(() => expect(model.selectedThreadId).toBe('t2'));
        expect(model.isSelectionShown).toBe(false);

        model.isChatShown = true;
        expect(model.isSelectionShown).toBe(true);
    });

    it('leaves other routes alone', async () => {
        const model = createModel();

        await model.selectThreadAsync('t1');

        expect(XH.routerState.name).toBe('default.other');
        expect(XH.routerState.params).toEqual({});
    });

    describe('with a child route for the thread', () => {
        it('selects the thread in a deep link to the child route', async () => {
            await navigateAsync('default.linked.thread', {threadId: 't1'});

            const model = createLinkedModel();

            await vi.waitFor(() => expect(model.chatModel?.lastMessage?.text).toBe('Hello.'));
            expect(model.selectedThreadId).toBe('t1');
        });

        it('navigates to the child route on selection, with no new history entry', async () => {
            await navigateAsync('default.linked.thread', {threadId: 't1'});
            const model = createLinkedModel(),
                navigate = vi.spyOn(XH, 'navigate');
            onTestFinished(() => navigate.mockRestore());
            await vi.waitFor(() => expect(model.selectedThreadId).toBe('t1'));

            await model.selectThreadAsync('t2');

            await vi.waitFor(() => expect(XH.routerState.params.threadId).toBe('t2'));
            expect(XH.routerState.name).toBe('default.linked.thread');
            expect(navigate).toHaveBeenCalledWith(
                'default.linked.thread',
                {threadId: 't2'},
                {replace: true}
            );
        });

        it('lands a selection made on the base route on the child route', async () => {
            await navigateAsync('default.linked');
            const model = createLinkedModel();

            await model.selectThreadAsync('t1');

            await vi.waitFor(() => expect(XH.routerState.name).toBe('default.linked.thread'));
            expect(XH.routerState.params.threadId).toBe('t1');
        });

        it('returns to the base route for a new thread', async () => {
            await navigateAsync('default.linked.thread', {threadId: 't1'});
            const model = createLinkedModel();
            await vi.waitFor(() => expect(model.selectedThreadId).toBe('t1'));

            model.newThread();

            await vi.waitFor(() => expect(XH.routerState.name).toBe('default.linked'));
            expect(XH.routerState.params.threadId).toBeUndefined();
        });
    });
});

//------------------
// Helpers
//------------------
/** A conversation of an app's own, whose state the test sets. */
class AppConversation extends HoistBase implements ChatConversation {
    @observable accessor threadId: string;
    @observable accessor isBusy = false;
    @observable accessor isSaved = false;

    constructor(threadId: string) {
        super();
        this.threadId = threadId;
    }

    async loadAsync() {}

    stop() {}

    @action
    set(changes: Partial<Pick<AppConversation, 'threadId' | 'isBusy' | 'isSaved'>>) {
        Object.assign(this, changes);
    }
}

class RoutedTestModel extends TestAppModel {
    override getRoutes(): HoistRoute[] {
        return [
            {
                name: 'default',
                path: '/app',
                children: [
                    {name: 'chat', path: '/chat?threadId'},
                    {
                        name: 'linked',
                        path: '/linked',
                        children: [{name: 'thread', path: '/:threadId'}]
                    },
                    {name: 'other', path: '/other'}
                ]
            }
        ];
    }
}

const CHAT_ROUTE: ChatThreadsRoute = {name: 'default.chat', param: 'threadId'},
    LINKED_ROUTE: ChatThreadsRoute = {
        name: 'default.linked',
        param: 'threadId',
        threadRoute: 'default.linked.thread'
    };

function createModel(
    respond: ScriptedChatTransportConfig['respond'] = () => [
        runStarted('srv-1'),
        textEvents('Hi there.')
    ],
    route: ChatThreadsRoute = CHAT_ROUTE
): ChatThreadsModel {
    const transport = new ScriptedChatTransport({respond, delayMs: 0}),
        model = new ChatThreadsModel({
            store: new LocalChatThreadStore({
                threads: [
                    {id: 't1', messages: [{role: 'assistant', content: 'Hello.'}]},
                    {id: 't2', messages: []}
                ]
            }),
            createChatModel: ({threadId}) =>
                new ChatModel({transport, threadId, historyMode: 'server'}),
            route
        });
    onTestFinished(() => model.destroy());
    return model;
}

/** A model bound to a base route with a child route for the thread. */
function createLinkedModel(): ChatThreadsModel {
    return createModel(undefined, LINKED_ROUTE);
}

async function navigateAsync(name: string, params: Record<string, string> = {}) {
    XH.navigate(name, params);
    await vi.waitFor(() => expect(XH.routerState.name).toBe(name));
}

function runStarted(threadId: string): ChatEvent {
    return {type: 'RUN_STARTED', threadId, runId: 'run-1'};
}

/** A response that never comes, and fails once the request is aborted. */
function untilAborted(request: ChatRunRequest): Promise<never> {
    return new Promise((_, reject) =>
        request.signal.addEventListener('abort', () => reject(request.signal.reason))
    );
}
