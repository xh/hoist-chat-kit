import {useEffect} from 'react';
import {act, fireEvent, render, screen, within} from '@testing-library/react';
import {div} from '@xh/hoist/cmp/layout';
import {hoistCmp, HoistBase, XH} from '@xh/hoist/core';
import {observable} from '@xh/hoist/mobx';
import {wait} from '@xh/hoist/promise';
import {initTestAppAsync} from '@xh/hoist/test-support';
import {beforeAll, beforeEach, describe, expect, it, onTestFinished, vi} from 'vitest';
import {LocalChatThreadStore} from '../../../test/support/LocalChatThreadStore';
import {type ChatConversation, ChatThreadsModel} from '../../../threads';
import {chatWorkspace} from './ChatWorkspace';
import {ChatWorkspaceModel} from './ChatWorkspaceModel';

/**
 * The workspace over a conversation of the app's own, shown by the app's own view. An app whose
 * conversation runs on another library keeps the workspace's sidebar, header and states, and puts
 * its view where the `ChatPanel` would be. The view must stay mounted as the selection changes,
 * as it may hold state that a remount would lose.
 */
describe('ChatWorkspace with a conversation view', () => {
    beforeAll(async () => {
        await initTestAppAsync();
    });

    beforeEach(() => {
        vi.stubGlobal(
            'ResizeObserver',
            class {
                observe() {}
                unobserve() {}
                disconnect() {}
            }
        );
    });

    it("throws without a view for a conversation of the app's own", async () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        onTestFinished(() => consoleError.mockRestore());
        const threadsModel = new ChatThreadsModel({
                store: new LocalChatThreadStore({threads: THREADS}),
                createConversation: ({threadId}) => new TestConversation(threadId)
            }),
            model = new ChatWorkspaceModel({threadsModel});
        onTestFinished(() => {
            model.destroy();
            threadsModel.destroy();
        });

        expect(() => render(chatWorkspace({model}))).toThrow('conversationView');
    });

    it("shows the app's view in place of a chat panel, beside the thread list", async () => {
        const {threadsModel} = await renderWorkspaceAsync();
        await act(() => threadsModel.selectThreadAsync('t1'));

        expect(screen.getByText('Showing t1')).toBeTruthy();
        expect(screen.getByRole('treegrid', {name: 'Threads'})).toBeTruthy();
        expect(document.querySelector('.xh-chat-composer')).toBeNull();
        expect(heading()).toBe('Budget review');
    });

    it('keeps one view mounted as the selection changes', async () => {
        const {threadsModel} = await renderWorkspaceAsync();
        await act(() => threadsModel.selectThreadAsync('t1'));
        await act(() => threadsModel.selectThreadAsync('t2'));

        expect(screen.getByText('Showing t2')).toBeTruthy();
        expect(heading()).toBe('Travel plans');
        expect(viewMounts).toBe(1);
    });

    it('shows "Thread not found" for a missing thread, and New Chat opens a new one', async () => {
        const {threadsModel} = await renderWorkspaceAsync();
        await act(() => threadsModel.selectThreadAsync('t1'));
        await act(() => threadsModel.selectThreadAsync('deleted'));

        expect(heading()).toBe('Thread not found');
        expect(isViewShown()).toBe(false);
        const notFound = document.querySelector<HTMLElement>('.xh-chat-workspace__not-found');
        fireEvent.click(within(notFound).getByRole('button', {name: 'New Chat'}));
        await act(() => wait());

        expect(threadsModel.isThreadNotFound).toBe(false);
        expect(heading()).toBe('New chat');
        expect(screen.getByText(`Showing ${threadsModel.selectedThreadId}`)).toBeTruthy();
        expect(isViewShown()).toBe(true);
        expect(viewMounts).toBe(1);
    });

    it("shows a failed load in the view's place, with Retry, and keeps the view mounted", async () => {
        const handleException = vi.spyOn(XH, 'handleException').mockImplementation(() => {});
        onTestFinished(() => handleException.mockRestore());
        const {threadsModel} = await renderWorkspaceAsync();
        failingThreadIds.add('t2');
        await act(() => threadsModel.selectThreadAsync('t2'));

        expect(screen.getByText("Couldn't load this thread")).toBeTruthy();
        expect(isViewShown()).toBe(false);

        failingThreadIds.delete('t2');
        fireEvent.click(screen.getByRole('button', {name: 'Retry'}));
        await act(() => wait());

        expect(threadsModel.loadError).toBeNull();
        expect(screen.getByText('Showing t2')).toBeTruthy();
        expect(isViewShown()).toBe(true);
        expect(viewMounts).toBe(1);
    });
});

//------------------
// Helpers
//------------------
const NOW = Date.now();

const THREADS = [
    {id: 't1', title: 'Budget review', lastActivityAt: NOW - 1000},
    {id: 't2', title: 'Travel plans', lastActivityAt: NOW - 2000}
];

// Threads whose load fails, and the number of times the app's view has mounted.
const failingThreadIds = new Set<string>();
let viewMounts = 0;

/** A conversation an app writes over another library: it loads at once, or fails. */
class TestConversation extends HoistBase implements ChatConversation {
    @observable accessor threadId: string;
    @observable accessor isBusy = false;

    constructor(threadId: string) {
        super();
        this.threadId = threadId;
    }

    async loadAsync() {
        await wait();
        if (this.threadId === 'deleted') {
            throw Object.assign(new Error('Not found'), {httpStatus: 404});
        }
        if (failingThreadIds.has(this.threadId)) throw new Error('Load failed');
    }

    stop() {}
}

/** The app's view: one component for every thread, that follows the selection. */
const appView = hoistCmp.factory<ChatThreadsModel>({
    render({model}) {
        useEffect(() => {
            viewMounts++;
        }, []);
        return div(`Showing ${model.conversation?.threadId}`);
    }
});

async function renderWorkspaceAsync() {
    failingThreadIds.clear();
    viewMounts = 0;
    const threadsModel = new ChatThreadsModel({
            store: new LocalChatThreadStore({threads: THREADS}),
            createConversation: ({threadId}) => new TestConversation(threadId)
        }),
        model = new ChatWorkspaceModel({threadsModel});
    onTestFinished(() => {
        model.destroy();
        threadsModel.destroy();
    });
    render(chatWorkspace({model, conversationView: appView({model: threadsModel})}));
    await act(() => model.loadAsync());
    return {model, threadsModel};
}

/** True if the app's view shows, rather than hides under a message. */
function isViewShown(): boolean {
    const el = document.querySelector<HTMLElement>('.xh-chat-workspace__conversation');
    return el.style.display !== 'none';
}

function heading(): string {
    return screen.getByRole('heading', {level: 2}).textContent;
}
