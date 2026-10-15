import {type HoistRoute, type PersistOptions, XH} from '@xh/hoist/core';
import {wait} from '@xh/hoist/promise';
import {initTestAppAsync, TestAppModel} from '@xh/hoist/test-support';
import {beforeAll, beforeEach, describe, expect, it, onTestFinished, vi} from 'vitest';
import {ChatModel} from '../../../core';
import {ChatThreadsModel, LocalChatThreadStore} from '../../../threads';
import {ScriptedChatTransport, textEvents} from '../../../transport';
import {ChatWorkspaceModel} from './ChatWorkspaceModel';

/**
 * The workspace's saved thread. Users rely on a reload, or a new workspace model, returning them
 * to the thread they had open rather than a new chat. A deep link, a thread the user picks before
 * the list loads, and a thread the store no longer lists all come before the saved one.
 */
describe('ChatWorkspace selected thread persistence', () => {
    let persistWith: PersistOptions;

    beforeAll(async () => {
        await initTestAppAsync({modelClass: RoutedTestModel});
    });

    beforeEach(async () => {
        persistWith = {localStorageKey: `chatWorkspaceSpec${++keyCount}`};
        await navigateAsync('default.other');
    });

    it('returns to the thread the user had open, once the list shows it', async () => {
        const first = createWorkspace(persistWith);
        await first.loadAsync();
        await first.threadsModel.selectThreadAsync('t2');
        await leaveAsync(first);

        const second = createWorkspace(persistWith);
        expect(second.threadsModel.chatModel.isEmpty).toBe(true);

        await second.loadAsync();
        await vi.waitFor(() => expect(second.threadsModel.selectedThreadId).toBe('t2'));
    });

    it('starts a new chat when the store no longer lists the saved thread', async () => {
        const first = createWorkspace(persistWith);
        await first.loadAsync();
        await first.threadsModel.selectThreadAsync('t2');
        await leaveAsync(first);

        const second = createWorkspace(persistWith, ['t1']),
            newThreadId = second.threadsModel.selectedThreadId;
        await second.loadAsync();

        expect(second.threadsModel.selectedThreadId).toBe(newThreadId);
    });

    it('keeps a thread the user picks before the list loads', async () => {
        const first = createWorkspace(persistWith);
        await first.loadAsync();
        await first.threadsModel.selectThreadAsync('t2');
        await leaveAsync(first);

        const second = createWorkspace(persistWith);
        await second.threadsModel.selectThreadAsync('t1');
        await second.loadAsync();

        expect(second.threadsModel.selectedThreadId).toBe('t1');
    });

    it('leaves the thread a route selects in place of the saved one', async () => {
        const first = createWorkspace(persistWith, undefined, true);
        await first.loadAsync();
        await first.threadsModel.selectThreadAsync('t2');
        await leaveAsync(first);

        await navigateAsync('default.chat', {threadId: 't1'});
        const second = createWorkspace(persistWith, undefined, true);
        await second.loadAsync();

        expect(second.threadsModel.selectedThreadId).toBe('t1');
    });

    it('starts a new chat without persistWith', async () => {
        const first = createWorkspace(null);
        await first.loadAsync();
        await first.threadsModel.selectThreadAsync('t2');
        await leaveAsync(first);

        const second = createWorkspace(null);
        await second.loadAsync();

        expect(second.threadsModel.selectedSummary).toBeNull();
    });
});

//------------------
// Helpers
//------------------
let keyCount = 0;

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

function createWorkspace(
    persistWith: PersistOptions,
    threadIds = ['t1', 't2'],
    routed = false
): ChatWorkspaceModel {
    const transport = new ScriptedChatTransport({responses: [textEvents('Hi.')], delayMs: 0}),
        threadsModel = new ChatThreadsModel({
            store: new LocalChatThreadStore({
                threads: threadIds.map((id, idx) => ({
                    id,
                    title: `Thread ${id}`,
                    lastActivityAt: Date.now() - idx,
                    messages: [{role: 'assistant', content: `Hello from ${id}.`}]
                }))
            }),
            createChatModel: ({threadId}) =>
                new ChatModel({transport, threadId, historyMode: 'server'}),
            route: routed ? {name: 'default.chat', param: 'threadId'} : null
        }),
        ret = new ChatWorkspaceModel({threadsModel, persistWith});
    onTestFinished(() => {
        if (!ret.isDestroyed) ret.destroy();
        threadsModel.destroy();
    });
    return ret;
}

/** Destroy a workspace once its debounced writes to persistence land, as on a reload. */
async function leaveAsync(model: ChatWorkspaceModel) {
    await wait(300);
    model.destroy();
}

async function navigateAsync(name: string, params: Record<string, string> = {}) {
    XH.navigate(name, params);
    await vi.waitFor(() => expect(XH.routerState.name).toBe(name));
}
