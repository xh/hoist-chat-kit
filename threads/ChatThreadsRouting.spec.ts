import {type HoistRoute, XH} from '@xh/hoist/core';
import {wait} from '@xh/hoist/promise';
import {initTestAppAsync, TestAppModel} from '@xh/hoist/test-support';
import {beforeAll, beforeEach, describe, expect, it, onTestFinished, vi} from 'vitest';
import {ChatModel} from '../core';
import {type ChatEvent, ScriptedChatTransport, textEvents} from '../transport';
import {ChatThreadsModel} from './ChatThreadsModel';
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

    it('leaves other routes alone', async () => {
        const model = createModel();

        await model.selectThreadAsync('t1');

        expect(XH.routerState.name).toBe('default.other');
        expect(XH.routerState.params).toEqual({});
    });
});

//------------------
// Helpers
//------------------
class RoutedTestModel extends TestAppModel {
    override getRoutes(): HoistRoute[] {
        return [
            {
                name: 'default',
                path: '/app',
                children: [
                    {name: 'chat', path: '/chat?threadId'},
                    {name: 'other', path: '/other'}
                ]
            }
        ];
    }
}

function createModel(): ChatThreadsModel {
    const transport = new ScriptedChatTransport({
            respond: () => [runStarted('srv-1'), textEvents('Hi there.')],
            delayMs: 0
        }),
        model = new ChatThreadsModel({
            store: new LocalChatThreadStore({
                threads: [
                    {id: 't1', messages: [{role: 'assistant', content: 'Hello.'}]},
                    {id: 't2', messages: []}
                ]
            }),
            createChatModel: ({threadId}) =>
                new ChatModel({transport, threadId, historyMode: 'server'}),
            route: {name: 'default.chat', param: 'threadId'}
        });
    onTestFinished(() => model.destroy());
    return model;
}

async function navigateAsync(name: string, params: Record<string, string> = {}) {
    XH.navigate(name, params);
    await vi.waitFor(() => expect(XH.routerState.name).toBe(name));
}

function runStarted(threadId: string): ChatEvent {
    return {type: 'RUN_STARTED', threadId, runId: 'run-1'};
}
