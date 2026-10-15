import {act, fireEvent, render, screen, within} from '@testing-library/react';
import {XH} from '@xh/hoist/core';
import {wait} from '@xh/hoist/promise';
import {initTestAppAsync} from '@xh/hoist/test-support';
import {beforeAll, beforeEach, describe, expect, it, onTestFinished, vi} from 'vitest';
import {ChatModel} from '../../../core';
import {ChatThreadsModel, type LocalChatThread, LocalChatThreadStore} from '../../../threads';
import {ScriptedChatTransport, textEvents} from '../../../transport';
import {chatWorkspace, type ChatWorkspaceProps} from './ChatWorkspace';
import {type ChatWorkspaceConfig, ChatWorkspaceModel} from './ChatWorkspaceModel';

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

        it('gives the side panel 400 px and the sidebar its rail at 900 px, leaving the rest', () => {
            const {model} = setup({sidePanelOpen: true});
            model.setWidth(900);

            expect(model).toMatchObject({sidebarMode: 'rail', sidePanelWidth: 400});
            // The user's saved width stays as it was.
            expect(model.sidePanelModel.size).toBe(520);
        });

        it('opens the sidebar at 240 px between 1,000 and 1,279 px, and the side panel at 460', () => {
            const {model} = setup();
            model.setWidth(1100);
            expect(model).toMatchObject({sidebarMode: 'open', sidebarWidth: 240});

            model.openSidePanel();
            expect(model).toMatchObject({sidebarMode: 'rail', sidePanelWidth: 460});
        });

        it('narrows the side panel so that the conversation keeps its minimum', () => {
            const {model} = setup({sidePanelOpen: true});

            // 788 - 40 for the rail - 8 for the splitter - 380 for the conversation.
            model.setWidth(788);
            expect(model.sidePanelWidth).toBe(360);

            // 1,000 - 40 - 8 - 480.
            model.sidePanelModel.size = 900;
            model.setWidth(1000);
            expect(model.sidePanelWidth).toBe(472);
        });

        it('gives way with the sidebar first, when a wide workspace cannot fit both panels', () => {
            const {model} = setup({sidePanelOpen: true});
            model.setWidth(1440);
            model.sidebarModel.size = 400;
            expect(model).toMatchObject({sidebarMode: 'open', sidePanelWidth: 520});

            model.setWidth(1300);
            expect(model).toMatchObject({sidebarMode: 'rail', sidePanelWidth: 520});
        });

        it("holds the user's width in the band where they set it and wider, not narrower", () => {
            const {model} = setup();
            model.setWidth(1100);
            model.sidebarModel.size = 300;
            expect(model.sidebarWidth).toBe(300);

            model.setWidth(1440);
            expect(model.sidebarWidth).toBe(300);

            model.setWidth(900);
            model.expandSidebar();
            expect(model.sidebarWidth).toBe(240);
            expect(model.sidebarModel.size).toBe(300);
        });

        it('lays out from its measured width on the first render, with no wait', () => {
            stubRootWidth(900);
            renderWorkspace({}, {documentRenderer: () => 'Viewer'}, model =>
                model.sidePanel.open({
                    type: 'document',
                    source: {type: 'source', id: 'd1', title: 'Reserves Policy'}
                })
            );

            expect(screen.queryByRole('listbox')).toBeNull();
            expect(screen.getByRole('button', {name: 'Expand sidebar'})).toBeTruthy();
            expect(sidePanelBox().style.width).toBe('408px');
        });

        it('applies a resize at once, and the last of a burst once it settles', async () => {
            const {model} = renderWorkspace();

            reportWidth(900);
            expect(model.width).toBe(900);

            reportWidth(1000);
            reportWidth(1300);
            expect(model.width).toBe(900);
            await act(() => wait(150));
            expect(model.width).toBe(1300);
        });

        it('measures for a new model, when the model it renders changes', () => {
            const {model, rerender} = renderWorkspace(),
                {model: next} = setup();
            rerender(chatWorkspace({model: next}));

            reportWidth(900);
            expect(next.width).toBe(900);
            expect(model.width).toBeNull();
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

    describe('side panel requests', () => {
        const viewer = () => 'App document viewer';

        it("opens a cited document beside the conversation, in the app's viewer", async () => {
            const {model, threadsModel} = renderWorkspace(
                {chatPanelProps: {citationMarkers: true}},
                {documentRenderer: viewer, threads: CITED_THREADS}
            );
            await resizeTo(1440);
            await act(() => threadsModel.selectThreadAsync('t3'));

            fireEvent.click(screen.getByRole('button', {name: /^Source 1:/}));
            expect(model.sidePanel.request).toMatchObject({citation: 1, page: 7});
            expect(model.isSidePanelShown).toBe(true);
            expect(screen.getByText('App document viewer')).toBeTruthy();
            expect(screen.getByRole('button', {name: 'Back to 1'})).toBeTruthy();

            fireEvent.click(screen.getByRole('button', {name: 'Close'}));
            expect(model.sidePanel.request).toBeNull();
            expect(document.activeElement).toBe(screen.getByRole('button', {name: /^Source 1:/}));
        });

        it('opens a document in a new tab, with a toast, when too narrow for the panel', async () => {
            const open = vi.fn(),
                toast = vi.spyOn(XH, 'toast').mockImplementation(() => null);
            vi.stubGlobal('open', open);
            onTestFinished(() => {
                toast.mockRestore();
                vi.unstubAllGlobals();
            });
            const {model, threadsModel} = renderWorkspace(
                {chatPanelProps: {citationMarkers: true}},
                {documentRenderer: viewer, threads: CITED_THREADS}
            );
            await resizeTo(700);
            await act(() => threadsModel.selectThreadAsync('t3'));

            fireEvent.click(screen.getByRole('button', {name: /^Source 1:/}));
            expect(model.sidePanel.request).toBeNull();
            expect(open).toHaveBeenCalledWith(
                'https://docs.example/reserves.pdf',
                '_blank',
                'noopener,noreferrer'
            );
            expect(toast).toHaveBeenCalledTimes(1);
        });

        it('shows the request in place of the app content, which returns once it closes', () => {
            const {model} = renderWorkspace(
                {sidePanel: () => 'Policy document'},
                {documentRenderer: viewer, sidePanelOpen: true}
            );
            expect(screen.getByText('Policy document')).toBeTruthy();

            act(() =>
                model.sidePanel.open({
                    type: 'document',
                    source: {type: 'source', id: 'd1', title: 'Reserves Policy'}
                })
            );
            expect(screen.queryByText('Policy document')).toBeNull();
            expect(screen.getByText('App document viewer')).toBeTruthy();

            act(() => model.sidePanel.close());
            expect(screen.getByText('Policy document')).toBeTruthy();
        });

        it('closes the request when the thread changes', async () => {
            const {model, threadsModel} = renderWorkspace({}, {documentRenderer: viewer});
            act(() =>
                model.sidePanel.open({
                    type: 'document',
                    source: {type: 'source', id: 'd1', title: 'Reserves Policy'}
                })
            );

            await act(() => threadsModel.selectThreadAsync('t1'));
            expect(model.sidePanel.request).toBeNull();
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

// A thread whose reply cites a document and a web page.
const CITED_THREADS: LocalChatThread[] = [
    {
        id: 't3',
        title: 'Reserves',
        lastActivityAt: NOW,
        messages: [
            {role: 'user', content: 'How many months of reserves?'},
            {
                id: 'a3',
                role: 'assistant',
                parts: [
                    {type: 'text', id: 'x1', text: 'Six months [1].', state: 'done'},
                    {
                        type: 'source',
                        id: 'd1',
                        sourceType: 'document',
                        title: 'Reserves Policy',
                        marker: 1,
                        url: 'https://docs.example/reserves.pdf',
                        metadata: {page: 7}
                    }
                ]
            }
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

function setup({
    sidePanelOpen = false,
    documentRenderer = undefined,
    threads = THREADS
}: Partial<Pick<ChatWorkspaceConfig, 'sidePanelOpen' | 'documentRenderer'>> & {
    threads?: LocalChatThread[];
} = {}) {
    const store = new LocalChatThreadStore({threads}),
        transport = new ScriptedChatTransport({responses: [textEvents('Hi.')], delayMs: 0}),
        threadsModel = new ChatThreadsModel({
            store,
            createChatModel: ({threadId}) =>
                new ChatModel({transport, threadId, historyMode: 'server'})
        }),
        model = new ChatWorkspaceModel({threadsModel, sidePanelOpen, documentRenderer});
    onTestFinished(() => {
        model.destroy();
        threadsModel.destroy();
    });
    return {model, threadsModel, store};
}

function renderWorkspace(
    props: Omit<ChatWorkspaceProps, 'model'> = {},
    config: Parameters<typeof setup>[0] = {},
    beforeRender: (model: ChatWorkspaceModel) => void = null
) {
    const ret = setup(config);
    beforeRender?.(ret.model);
    return {...ret, ...render(chatWorkspace({model: ret.model, ...props}))};
}

/** Give the workspace's element a width, as the browser lays it out, for its first measure. */
function stubRootWidth(width: number) {
    const original = HTMLElement.prototype.getBoundingClientRect,
        spy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
            this: HTMLElement
        ) {
            return this.classList.contains('xh-chat-workspace')
                ? ({width, height: 600} as DOMRect)
                : original.call(this);
        });
    onTestFinished(() => spy.mockRestore());
}

/** Report a new size from the latest ResizeObserver, without waiting. */
function reportWidth(width: number) {
    const entry = {contentRect: {width, height: 600}} as ResizeObserverEntry;
    act(() => resizeCallbacks.at(-1)([entry], null));
}

function sidePanelBox(): HTMLElement {
    return document.querySelector('.xh-chat-workspace__side-panel');
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
