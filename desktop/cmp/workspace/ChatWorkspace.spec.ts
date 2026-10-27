import {act, fireEvent, render, screen, within} from '@testing-library/react';
import {XH} from '@xh/hoist/core';
import {wait} from '@xh/hoist/promise';
import {initTestAppAsync} from '@xh/hoist/test-support';
import {beforeAll, beforeEach, describe, expect, it, onTestFinished, vi} from 'vitest';
import {type ChatMessageSpec, ChatModel} from '../../../core';
import {
    type LocalChatThread,
    LocalChatThreadStore
} from '../../../test/support/LocalChatThreadStore';
import {ChatThreadsModel} from '../../../threads';
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

        it('shows the rail at 900 px, and cuts the side panel to leave the conversation 380 px', () => {
            const {model} = setup({sidePanelOpen: true});
            model.setWidth(900);

            // 900 - 40 for the rail - 8 for the splitter - 380 for the conversation.
            expect(model).toMatchObject({sidebarMode: 'rail', sidePanelWidth: 472});
            // The user's saved width stays as it was.
            expect(model.sidePanelModel.size).toBe(520);
        });

        it('shows each panel at its one saved width where there is room', () => {
            const {model} = setup();
            model.setWidth(1100);
            expect(model).toMatchObject({sidebarMode: 'open', sidebarWidth: 260});

            model.openSidePanel();
            expect(model).toMatchObject({sidebarMode: 'rail', sidePanelWidth: 520});
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

        it('reserves the rail at the width its theme variable sets', () => {
            const computed = window.getComputedStyle;
            vi.spyOn(window, 'getComputedStyle').mockImplementation((el, pseudo) => {
                const ret = computed(el, pseudo);
                return {
                    ...ret,
                    getPropertyValue: (name: string) =>
                        name === '--xh-chat-sidebar-rail-width'
                            ? ' 56px'
                            : ret.getPropertyValue(name)
                } as CSSStyleDeclaration;
            });
            onTestFinished(() => vi.mocked(window.getComputedStyle).mockRestore());
            const {model} = renderWorkspace({}, {sidePanelOpen: true});

            // 788 - 56 for the rail - 8 for the splitter - 380 for the conversation.
            model.setWidth(788);
            expect(model.sidePanelWidth).toBe(344);
        });

        it('cuts the side panel, and keeps the sidebar open, when a wide workspace cannot fit both', () => {
            const {model} = setup({sidePanelOpen: true});
            model.setWidth(1440);
            model.sidebarModel.size = 400;
            expect(model).toMatchObject({sidebarMode: 'open', sidePanelWidth: 520});

            // 1,300 - 408 for the sidebar - 8 for the splitter - 480 for the conversation.
            model.setWidth(1300);
            expect(model).toMatchObject({
                sidebarMode: 'open',
                sidebarWidth: 400,
                sidePanelWidth: 404
            });
        });

        it("keeps the user's one sidebar width at every width that shows it open", () => {
            const {model} = setup();
            model.setWidth(1100);
            model.sidebarModel.size = 300;
            expect(model.sidebarWidth).toBe(300);

            model.setWidth(1440);
            expect(model.sidebarWidth).toBe(300);

            model.setWidth(900);
            model.expandSidebar();
            expect(model.sidebarWidth).toBe(300);
            expect(model.sidebarModel.size).toBe(300);
        });

        it('shows a document, a table and a chart at the one side panel width', () => {
            const {model} = setup();
            model.setWidth(1440);
            model.sidePanelModel.size = 600;

            [DOCUMENT_REQUEST, TABLE_REQUEST, CHART_REQUEST].forEach(request => {
                model.sidePanel.open(request);
                expect(model).toMatchObject({sidebarMode: 'open', sidePanelWidth: 600});
            });
        });

        it('narrows a table so that the conversation keeps its minimum', () => {
            const {model} = setup();
            model.sidePanelModel.size = 900;
            model.sidePanel.open(TABLE_REQUEST);

            // 1,100 - 40 for the rail - 8 for the splitter - 480 for the conversation.
            model.setWidth(1100);
            expect(model.sidePanelWidth).toBe(572);

            // 900 - 40 - 8 - 380.
            model.setWidth(900);
            expect(model.sidePanelWidth).toBe(472);
        });

        it('resizes the sidebar and the side panel against the conversation, their sibling', () => {
            // Resize containers' offsetWidth, each a panel's size plus its 8 px splitter.
            const widths: Record<string, number> = {
                'xh-chat-workspace__sidebar': 268,
                'xh-chat-workspace__side-panel': 528
            };
            const offsetSpy = vi
                    .spyOn(HTMLElement.prototype, 'offsetWidth', 'get')
                    .mockImplementation(function (this: HTMLElement) {
                        const key = Object.keys(widths).find(it => this.classList.contains(it));
                        return key ? widths[key] : 0;
                    }),
                clientSpy = vi
                    .spyOn(HTMLElement.prototype, 'clientWidth', 'get')
                    .mockImplementation(function (this: HTMLElement) {
                        return this.classList.contains('xh-chat-workspace__main') ? 600 : 0;
                    });
            onTestFinished(() => {
                offsetSpy.mockRestore();
                clientSpy.mockRestore();
            });
            stubRootWidth(1440);
            const {model} = renderWorkspace({sidePanel: 'Notes'}, {sidePanelOpen: true}),
                main = document.querySelector('.xh-chat-workspace__main'),
                sidebarEl = document.querySelector<HTMLElement>('.xh-chat-workspace__sidebar'),
                sidePanelEl = document.querySelector<HTMLElement>('.xh-chat-workspace__side-panel');
            expect(sidebarEl.nextElementSibling).toBe(main);
            expect(sidePanelEl.previousElementSibling).toBe(main);

            // Hoist's DraggerModel starts from the resize container's offsetWidth, which includes
            // the splitter, so a drag of N px grows the panel by more than N.
            act(() => dragPanel(sidebarEl, 40));
            expect(model.sidebarModel.size).toBe(308);

            act(() => dragPanel(sidePanelEl, -40));
            expect(model.sidePanelModel.size).toBe(568);
        });

        it('lays out from its measured width on the first render, with no wait', () => {
            stubRootWidth(900);
            renderWorkspace({}, {documentRenderer: () => 'Viewer'}, model =>
                model.sidePanel.open({
                    type: 'document',
                    source: {type: 'source', id: 'd1', title: 'Reserves Policy'}
                })
            );

            expect(screen.queryByRole('treegrid')).toBeNull();
            expect(screen.getByRole('button', {name: 'Expand sidebar'})).toBeTruthy();
            // Cut to 472 for the conversation.
            expect(shownWidth('side-panel')).toBe('472px');
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

            fireEvent.click(screen.getByRole('row', {name: /^Budget review/}));
            await act(() => wait());

            expect(threadsModel.selectedThreadId).toBe('t1');
            expect(heading()).toBe('Budget review');
        });

        it("shows a plain pane while a thread loads, not a new chat's empty state", async () => {
            const {container, threadsModel} = renderWorkspace(
                {chatPanelProps: {suggestions: [{text: 'Summarize the budget'}]}},
                {storeDelayMs: 50}
            );
            await act(() => threadsModel.loadAsync());
            expect(screen.getByText('Summarize the budget')).toBeTruthy();

            let selected: Promise<void>;
            act(() => {
                selected = threadsModel.selectThreadAsync('t1');
            });
            expect(threadsModel.isThreadLoading).toBe(true);
            expect(container.querySelector('.xh-chat-workspace__loading')).toBeTruthy();
            expect(container.querySelector('.xh-chat-panel--empty')).toBeNull();
            expect(screen.queryByText('Summarize the budget')).toBeNull();

            await act(() => selected);
            expect(threadsModel.isThreadLoading).toBe(false);
            expect(container.querySelector('.xh-chat-workspace__loading')).toBeNull();
            expect(screen.getByRole('textbox', {name: /message/i})).toBeTruthy();
        });

        it('collapses to a rail with New Chat and search, and expands again', async () => {
            const {model} = renderWorkspace();
            await resizeTo(1440);

            fireEvent.click(screen.getByRole('button', {name: 'Collapse sidebar'}));
            expect(model.sidebarModel.collapsed).toBe(true);
            const rail = screen.getByRole('navigation', {name: 'Threads'});
            expect(screen.queryByRole('treegrid')).toBeNull();
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

        it('opens the next thread when the open one is deleted from the header, as from the list', async () => {
            const {threadsModel} = renderWorkspace(),
                confirm = vi.spyOn(XH, 'confirm').mockResolvedValue(true);
            onTestFinished(() => confirm.mockRestore());
            await act(() => threadsModel.loadAsync());
            await act(() => threadsModel.selectThreadAsync('t1'));

            fireEvent.click(screen.getByRole('button', {name: 'Thread actions'}));
            fireEvent.click(await screen.findByText('Delete...'));
            await act(() => wait(50));

            expect(threadsModel.threads.map(it => it.id)).toEqual(['t2']);
            expect(threadsModel.selectedThreadId).toBe('t2');
            expect(document.activeElement).toBe(
                document.querySelector(
                    '.xh-chat-workspace__conversation .xh-chat-composer textarea'
                )
            );
        });

        it("applies the thread list's enableNewChat and threadNoun to its own chrome", async () => {
            const {threadsModel} = renderWorkspace({
                threadListProps: {enableNewChat: false, threadNoun: 'chat'}
            });
            await act(() => threadsModel.loadAsync());
            await act(() => threadsModel.selectThreadAsync('t1'));
            await resizeTo(1300);

            expect(screen.queryByRole('button', {name: 'New Chat'})).toBeNull();
            expect(screen.getByRole('navigation', {name: 'Chats'})).toBeTruthy();
            expect(screen.getByRole('treegrid', {name: 'Chats'})).toBeTruthy();
            expect(screen.getByRole('button', {name: 'Chat actions'})).toBeTruthy();
        });

        it("gives every New Chat button the thread list's newChatButtonProps, less text", async () => {
            const {unmount} = renderWorkspace();
            await resizeTo(900);
            expect(newChatIntents()).toEqual(['primary', 'primary']);
            unmount();

            renderWorkspace({
                threadListProps: {newChatButtonProps: {intent: 'success', text: 'Ask'}}
            });
            // The rail and the header each show New Chat at 900 px, and the header alone at 700.
            await resizeTo(900);
            expect(newChatIntents()).toEqual(['success', 'success']);
            expect(screen.queryByText('Ask')).toBeNull();

            await resizeTo(700);
            expect(newChatIntents()).toEqual(['success']);
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
            expect(sidePanelHeader().classList).toContain('xh-panel-header--compact');
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

            fireEvent.click(screen.getByRole('button', {name: 'Close'}));
            expect(model.sidePanel.request).toBeNull();
            expect(document.activeElement).toBe(screen.getByRole('button', {name: /^Source 1:/}));
        });

        it('frames a request with a compact header, unless requestPanelProps asks for a full one', async () => {
            const {model, threadsModel, unmount} = renderWorkspace(
                {chatPanelProps: {citationMarkers: true}},
                {documentRenderer: viewer, threads: CITED_THREADS}
            );
            await resizeTo(1440);
            await act(() => threadsModel.selectThreadAsync('t3'));
            fireEvent.click(screen.getByRole('button', {name: /^Source 1:/}));
            expect(model.sidePanel.request).not.toBeNull();
            expect(sidePanelHeader().classList).toContain('xh-panel-header--compact');
            unmount();

            const full = renderWorkspace(
                {
                    chatPanelProps: {citationMarkers: true},
                    requestPanelProps: {compactHeader: false}
                },
                {documentRenderer: viewer, threads: CITED_THREADS}
            );
            await resizeTo(1440);
            await act(() => full.threadsModel.selectThreadAsync('t3'));
            fireEvent.click(screen.getByRole('button', {name: /^Source 1:/}));
            expect(sidePanelHeader().classList).not.toContain('xh-panel-header--compact');
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

        it('shows "Thread not found", with no composer, even when the chat starts with a greeting', async () => {
            const {threadsModel} = renderWorkspace(
                {},
                {initialMessages: [{role: 'assistant', content: 'Ask me anything.'}]}
            );
            await act(() => threadsModel.selectThreadAsync('deleted'));

            expect(heading()).toBe('Thread not found');
            expect(document.querySelector('.xh-chat-workspace__not-found')).not.toBeNull();
            expect(document.querySelector('.xh-chat-composer')).toBeNull();
        });

        it('shows "Thread not found" for a thread the store reports missing, with New Chat', async () => {
            const {threadsModel} = renderWorkspace();
            await act(() => threadsModel.selectThreadAsync('deleted'));

            expect(
                screen.getByText('This conversation does not exist, or it was deleted.')
            ).toBeTruthy();
            expect(heading()).toBe('Thread not found');
            expect(document.querySelector('.xh-chat-composer')).toBeNull();

            const notFound = document.querySelector<HTMLElement>('.xh-chat-workspace__not-found');
            fireEvent.click(within(notFound).getByRole('button', {name: 'New Chat'}));
            await act(() => wait());

            expect(threadsModel.selectedThreadId).not.toBe('deleted');
            expect(threadsModel.isThreadNotFound).toBe(false);
            expect(heading()).toBe('New chat');
            expect(screen.queryByText('Thread not found')).toBeNull();
            expect(document.querySelector('.xh-chat-composer')).not.toBeNull();
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

// Side panel requests. The layout reads only their type.
const DOCUMENT_REQUEST = {
        type: 'document' as const,
        source: {type: 'source' as const, id: 'd1', title: 'Reserves Policy'}
    },
    TABLE_REQUEST = {type: 'table' as const, artifactId: 'r1'},
    CHART_REQUEST = {
        type: 'chart' as const,
        artifactId: 'r1',
        view: {type: 'line' as const, x: 'date', y: ['nav']}
    };

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
    threads = THREADS,
    initialMessages = undefined,
    storeDelayMs = 0
}: Partial<Pick<ChatWorkspaceConfig, 'sidePanelOpen' | 'documentRenderer'>> & {
    threads?: LocalChatThread[];
    initialMessages?: ChatMessageSpec[];
    storeDelayMs?: number;
} = {}) {
    const store = new LocalChatThreadStore({threads, delayMs: storeDelayMs}),
        transport = new ScriptedChatTransport({responses: [textEvents('Hi.')], delayMs: 0}),
        threadsModel = new ChatThreadsModel({
            store,
            createChatModel: ({threadId}) =>
                new ChatModel({transport, threadId, historyMode: 'server', initialMessages})
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

/** A panel's width that shows, from the CSS variable the workspace sets for its content. */
function shownWidth(panel: 'sidebar' | 'side-panel'): string {
    return document
        .querySelector<HTMLElement>('.xh-chat-workspace__body')
        .style.getPropertyValue(`--xh-chat-workspace-${panel}-width`);
}

/** Drag a resizable panel's dragger by `dx` pixels, as the browser reports a drag. */
function dragPanel(panelEl: HTMLElement, dx: number) {
    const dragger = panelEl.querySelector('.xh-resizable-dragger'),
        fire = (type: string, clientX: number) =>
            dragger.dispatchEvent(
                Object.assign(new Event(type, {bubbles: true}), {
                    clientX,
                    clientY: 10,
                    screenX: clientX,
                    screenY: 10,
                    buttons: 1
                })
            );
    fire('dragstart', 300);
    fire('drag', 300 + dx);
    fire('dragend', 300 + dx);
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

/** The intent of each New Chat button that shows, on the rail or in the header. */
function newChatIntents(): string[] {
    return screen
        .getAllByRole('button', {name: 'New Chat'})
        .map(it => /xh-button--intent-(\w+)/.exec(it.className)[1]);
}

/** The header of the panel in the side panel slot. */
function sidePanelHeader(): HTMLElement {
    return document.querySelector('.xh-chat-workspace__side-panel .xh-panel-header');
}

function heading(): string {
    return screen.getByRole('heading', {level: 2}).textContent;
}
