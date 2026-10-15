import {act, fireEvent, render, screen, within} from '@testing-library/react';
import {wait} from '@xh/hoist/promise';
import {initTestAppAsync} from '@xh/hoist/test-support';
import {beforeAll, beforeEach, describe, expect, it, onTestFinished, vi} from 'vitest';
import {ChatModel} from '../../../core';
import {ChatThreadsModel, type LocalChatThread, LocalChatThreadStore} from '../../../threads';
import {ScriptedChatTransport, textEvents} from '../../../transport';
import {chatWorkspace, type ChatWorkspaceProps} from './ChatWorkspace';
import {ChatWorkspaceModel} from './ChatWorkspaceModel';

/**
 * The workspace's contract. Apps rely on it to fill its parent and lay itself out by its own
 * width: the sidebar narrows to its rail and then hides as the workspace narrows, the side panel
 * shows only where there is room, and the user's collapse of the sidebar holds. The conversation
 * always shows the selected thread's chat, and a failed load in its place.
 */
describe('ChatWorkspace', () => {
    beforeAll(async () => {
        await initTestAppAsync();
        // jsdom has no layout, so no scrolling. The message list scrolls to the latest message.
        Element.prototype.scrollTo ??= () => {};
    });

    beforeEach(() => {
        resizeCallbacks.length = 0;
        vi.stubGlobal('ResizeObserver', CapturingResizeObserver);
    });

    describe('layout', () => {
        it('picks the sidebar from its own width, never the viewport', () => {
            const {model} = setup();

            expect(widthToMode(model, 1440)).toBe('open');
            expect(widthToMode(model, 1100)).toBe('open');
            expect(widthToMode(model, 900)).toBe('rail');
            expect(widthToMode(model, 700)).toBe('hidden');
        });

        it('shows the rail while the side panel is open, between 1,000 and 1,279 px', () => {
            const {model} = setup();
            model.setWidth(1100);

            model.openSidePanel();
            expect(model.sidebarMode).toBe('rail');

            model.closeSidePanel();
            expect(model.sidebarMode).toBe('open');
        });

        it('keeps a user expand of the rail at its width, closing the side panel under 1,000 px', () => {
            const {model} = setup({sidePanelOpen: true});
            model.setWidth(900);
            expect(model.sidebarMode).toBe('rail');

            model.expandSidebar();
            expect(model).toMatchObject({sidebarMode: 'open', isSidePanelOpen: false});

            model.setWidth(1100);
            model.setWidth(900);
            expect(model.sidebarMode).toBe('rail');
        });

        it("holds the user's collapse at any width that shows a sidebar", () => {
            const {model} = setup();
            model.collapseSidebar();

            expect(widthToMode(model, 1440)).toBe('rail');
            expect(model.sidebarModel.collapsed).toBe(true);
        });

        it('shows the side panel only where there is room, keeping it open', () => {
            const {model} = setup({sidePanelOpen: true});

            model.setWidth(800);
            expect(model.isSidePanelShown).toBe(true);

            model.setWidth(700);
            expect(model).toMatchObject({isSidePanelShown: false, isSidePanelOpen: true});
        });

        it('sets compact density at 380 px or less, measured on its own element', async () => {
            const {container} = renderWorkspace();
            const root = container.querySelector('.xh-chat-workspace');

            await resizeTo(380);
            expect(root.classList.contains('xh-chat--compact')).toBe(true);

            await resizeTo(1200);
            expect(root.classList.contains('xh-chat--compact')).toBe(false);
        });
    });

    describe('sidebar', () => {
        it('lists the threads beside the selected thread, titled in the header', async () => {
            const {threadsModel} = renderWorkspace();
            expect(heading()).toBe('New chat');
            await act(() => threadsModel.loadAsync());

            fireEvent.click(screen.getByRole('option', {name: /^Budget review/}));
            await act(() => wait());

            expect(threadsModel.selectedThreadId).toBe('t1');
            expect(heading()).toBe('Budget review');
        });

        it('collapses to a rail with New Chat and search, and expands again', async () => {
            const {model} = renderWorkspace();
            await resizeTo(1440);

            fireEvent.click(screen.getByRole('button', {name: 'Collapse sidebar'}));
            expect(model.sidebarModel.collapsed).toBe(true);
            const rail = screen.getByRole('navigation', {name: 'Threads'});
            expect(screen.queryByRole('listbox')).toBeNull();
            expect(within(rail).getByRole('button', {name: 'New Chat'})).toBeTruthy();

            fireEvent.click(screen.getByRole('button', {name: 'Search threads'}));
            expect(model.sidebarModel.collapsed).toBe(false);
            expect(screen.getByLabelText('Search threads')).toBeTruthy();
        });

        it('starts a new thread from the rail', async () => {
            const {model, threadsModel} = renderWorkspace(),
                first = threadsModel.selectedThreadId;
            act(() => model.collapseSidebar());

            const rail = screen.getByRole('navigation', {name: 'Threads'});
            fireEvent.click(within(rail).getByRole('button', {name: 'New Chat'}));

            expect(threadsModel.selectedThreadId).not.toBe(first);
        });

        it('offers the list from the header when too narrow for a sidebar', async () => {
            renderWorkspace();
            await resizeTo(700);

            expect(screen.queryByRole('navigation', {name: 'Threads'})).toBeNull();
            expect(screen.getByRole('button', {name: 'Threads'})).toBeTruthy();
        });
    });

    describe('slots', () => {
        it('shows the notice line and the side panel the app supplies', async () => {
            const {model} = renderWorkspace({
                notice: 'This assistant sees data as of 06:00.',
                sidePanel: () => 'Policy document',
                sidePanelProps: {title: 'Sources'}
            });
            expect(screen.getByText('This assistant sees data as of 06:00.')).toBeTruthy();
            expect(screen.queryByText('Policy document')).toBeNull();

            act(() => model.openSidePanel());
            expect(screen.getByRole('complementary', {name: 'Sources'})).toBeTruthy();
            expect(screen.getByText('Policy document')).toBeTruthy();

            fireEvent.click(screen.getByRole('button', {name: 'Close side panel'}));
            expect(model.isSidePanelOpen).toBe(false);
            expect(screen.queryByText('Policy document')).toBeNull();
        });

        it('replaces the header, or hides it, with the header prop', () => {
            const {unmount} = renderWorkspace({header: 'Custom header'});
            expect(screen.getByText('Custom header')).toBeTruthy();
            unmount();

            renderWorkspace({header: null});
            expect(screen.queryByRole('heading')).toBeNull();
        });
    });

    describe('conversation', () => {
        it("shows a failed thread load in the pane, with Retry, and never the last thread's messages", async () => {
            const {store, threadsModel} = renderWorkspace();
            await act(() => threadsModel.selectThreadAsync('t1'));
            expect(screen.getByText('Hi')).toBeTruthy();

            store.failNext('loadMessagesAsync', new Error('Request timed out.'));
            await act(() => threadsModel.selectThreadAsync('t2'));
            expect(screen.queryByText('Hi')).toBeNull();
            expect(screen.getByText("Couldn't load this thread")).toBeTruthy();

            fireEvent.click(screen.getByRole('button', {name: 'Retry'}));
            await act(() => wait());
            expect(threadsModel.loadError).toBeNull();
            expect(screen.getByText('Hello')).toBeTruthy();
        });
    });
});

//------------------
// Helpers
//------------------
const NOW = Date.now();

const THREADS: LocalChatThread[] = [
    {
        id: 't1',
        title: 'Budget review',
        lastActivityAt: NOW,
        messages: [
            {role: 'user', content: 'Hi'},
            {role: 'assistant', content: 'Reply one'}
        ]
    },
    {
        id: 't2',
        title: 'Travel',
        lastActivityAt: NOW - 1000,
        messages: [
            {role: 'user', content: 'Hello'},
            {role: 'assistant', content: 'Reply two'}
        ]
    }
];

/** Callbacks of the workspace's ResizeObserver, to resize it by hand. */
const resizeCallbacks: ResizeObserverCallback[] = [];

class CapturingResizeObserver {
    constructor(callback: ResizeObserverCallback) {
        resizeCallbacks.push(callback);
    }
    observe() {}
    unobserve() {}
    disconnect() {}
}

function setup({sidePanelOpen = false}: {sidePanelOpen?: boolean} = {}) {
    const store = new LocalChatThreadStore({threads: THREADS}),
        transport = new ScriptedChatTransport({responses: [textEvents('Hi.')], delayMs: 0}),
        threadsModel = new ChatThreadsModel({
            store,
            createChatModel: ({threadId}) =>
                new ChatModel({transport, threadId, historyMode: 'server'})
        }),
        model = new ChatWorkspaceModel({threadsModel, sidePanelOpen});
    onTestFinished(() => {
        model.destroy();
        threadsModel.destroy();
    });
    return {model, threadsModel, store};
}

function renderWorkspace(props: Omit<ChatWorkspaceProps, 'model'> = {}) {
    const ret = setup();
    return {...ret, ...render(chatWorkspace({model: ret.model, ...props}))};
}

function widthToMode(model: ChatWorkspaceModel, width: number) {
    model.setWidth(width);
    return model.sidebarMode;
}

/** Report a new size from every ResizeObserver, and wait out the workspace's debounce. */
async function resizeTo(width: number) {
    const entry = {contentRect: {width, height: 600}} as ResizeObserverEntry;
    resizeCallbacks.forEach(it => it([entry], null));
    await act(() => wait(150));
}

function heading(): string {
    return screen.getByRole('heading', {level: 2}).textContent;
}
