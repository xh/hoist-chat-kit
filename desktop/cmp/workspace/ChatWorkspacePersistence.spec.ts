import type {PersistOptions} from '@xh/hoist/core';
import {wait} from '@xh/hoist/promise';
import {initTestAppAsync} from '@xh/hoist/test-support';
import {beforeAll, beforeEach, describe, expect, it, onTestFinished} from 'vitest';
import {ChatModel} from '../../../core';
import {LocalChatThreadStore} from '../../../test/support/LocalChatThreadStore';
import {ChatThreadsModel} from '../../../threads';
import {ScriptedChatTransport, textEvents} from '../../../transport';
import {ChatWorkspaceModel} from './ChatWorkspaceModel';

/**
 * What the workspace saves per user. Users rely on a reload keeping the panel widths and the
 * sidebar's collapsed state they chose. A reload opens a new chat, never the thread last open, so
 * the user picks a thread from the list.
 */
describe('ChatWorkspace persistence', () => {
    let persistWith: PersistOptions;

    beforeAll(async () => {
        await initTestAppAsync();
    });

    beforeEach(() => {
        persistWith = {localStorageKey: `chatWorkspaceSpec${++keyCount}`};
    });

    it('keeps the panel widths and the collapsed sidebar across a reload', async () => {
        const first = createWorkspace(persistWith);
        first.sidebarModel.size = 320;
        first.sidePanelModel.size = 600;
        first.collapseSidebar();
        await leaveAsync(first);

        const second = createWorkspace(persistWith);

        expect(second.sidebarModel.size).toBe(320);
        expect(second.sidePanelModel.size).toBe(600);
        expect(second.sidebarModel.collapsed).toBe(true);
    });

    it('opens a new chat after a reload, not the thread last open', async () => {
        const first = createWorkspace(persistWith);
        await first.loadAsync();
        await first.threadsModel.selectThreadAsync('t2');
        await leaveAsync(first);

        const second = createWorkspace(persistWith);
        await second.loadAsync();
        await wait(50);

        expect(second.threadsModel.selectedSummary).toBeNull();
        expect(second.threadsModel.chatModel.isEmpty).toBe(true);
    });

    it('starts with the default widths without persistWith', async () => {
        const first = createWorkspace(null);
        first.sidebarModel.size = 320;
        await leaveAsync(first);

        const second = createWorkspace(null);

        expect(second.sidebarModel.size).toBe(260);
    });
});

//------------------
// Helpers
//------------------
let keyCount = 0;

function createWorkspace(persistWith: PersistOptions): ChatWorkspaceModel {
    const transport = new ScriptedChatTransport({responses: [textEvents('Hi.')], delayMs: 0}),
        threadsModel = new ChatThreadsModel({
            store: new LocalChatThreadStore({
                threads: ['t1', 't2'].map((id, idx) => ({
                    id,
                    title: `Thread ${id}`,
                    lastActivityAt: Date.now() - idx,
                    messages: [{role: 'assistant', content: `Hello from ${id}.`}]
                }))
            }),
            createChatModel: ({threadId}) =>
                new ChatModel({transport, threadId, historyMode: 'server'})
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
