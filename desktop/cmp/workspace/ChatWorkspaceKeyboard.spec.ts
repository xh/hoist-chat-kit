import {act, fireEvent, render, screen} from '@testing-library/react';
import {button} from '@xh/hoist/desktop/cmp/button';
import {wait} from '@xh/hoist/promise';
import {initTestAppAsync} from '@xh/hoist/test-support';
import {afterEach, beforeAll, beforeEach, describe, expect, it, onTestFinished, vi} from 'vitest';
import {ChatKit, ChatModel, type ChatShortcuts} from '../../../core';
import {ChatThreadsModel, type LocalChatThread, LocalChatThreadStore} from '../../../threads';
import {ScriptedChatTransport, textEvents} from '../../../transport';
import {chatWorkspace} from './ChatWorkspace';
import {ChatWorkspaceModel} from './ChatWorkspaceModel';

/**
 * The workspace's keyboard map. Users rely on each shortcut acting only inside the chat, and on
 * Escape doing one thing per press in the region with focus. Apps rely on every binding being
 * remappable or droppable through `ChatKit.defaults.shortcuts`, as browsers bind some keys.
 */
describe('ChatWorkspace keyboard', () => {
    let saved: ChatShortcuts;

    beforeAll(async () => {
        await initTestAppAsync();
        Element.prototype.scrollTo ??= () => {};
    });

    beforeEach(() => {
        vi.stubGlobal('ResizeObserver', NoopResizeObserver);
        saved = {...ChatKit.defaults.shortcuts};
    });

    afterEach(() => {
        ChatKit.defaults.shortcuts = saved;
    });

    describe('newChat', () => {
        it('starts a new thread on Ctrl/Cmd+Shift+O, and focuses its composer', async () => {
            const {threadsModel} = await renderWorkspace(),
                first = threadsModel.selectedThreadId;

            press(composerInput(), {key: 'O', ctrlKey: true, shiftKey: true});
            await settle();

            expect(threadsModel.selectedThreadId).not.toBe(first);
            expect(document.activeElement).toBe(composerInput());
        });

        it('takes a remapped combo, and drops the default', async () => {
            ChatKit.defaults.shortcuts.newChat = 'alt+n';
            const {threadsModel} = await renderWorkspace(),
                first = threadsModel.selectedThreadId;

            press(composerInput(), {key: 'O', ctrlKey: true, shiftKey: true});
            expect(threadsModel.selectedThreadId).toBe(first);

            press(composerInput(), {key: 'n', altKey: true});
            expect(threadsModel.selectedThreadId).not.toBe(first);
        });

        it('does nothing when set to null', async () => {
            ChatKit.defaults.shortcuts.newChat = null;
            const {threadsModel} = await renderWorkspace(),
                first = threadsModel.selectedThreadId;

            press(composerInput(), {key: 'O', ctrlKey: true, shiftKey: true});
            expect(threadsModel.selectedThreadId).toBe(first);
        });
    });

    describe('focusComposer', () => {
        it('focuses the composer on / from outside a text field', async () => {
            await renderWorkspace();
            const row = screen.getByRole('row', {name: /^Budget review/});
            row.focus();

            press(row, {key: '/'});
            expect(document.activeElement).toBe(composerInput());
        });

        it('leaves / to a text field, and to a remap', async () => {
            ChatKit.defaults.shortcuts.focusComposer = null;
            await renderWorkspace();
            const row = screen.getByRole('row', {name: /^Budget review/});
            row.focus();

            press(row, {key: '/'});
            expect(document.activeElement).toBe(row);

            ChatKit.defaults.shortcuts.focusComposer = '/';
            const search = screen.getByLabelText('Search threads');
            search.focus();
            press(search, {key: '/'});
            expect(document.activeElement).toBe(search);
        });
    });

    describe('cycleRegions', () => {
        it('moves through the thread list, conversation, composer and side panel on F6', async () => {
            await renderWorkspace();
            const inSidePanel = () =>
                !!document.activeElement.closest('.xh-chat-workspace__side-panel');
            composerInput().focus();

            press(composerInput(), {key: 'F6'});
            expect(inSidePanel()).toBe(true);

            press(document.activeElement, {key: 'F6'});
            expect(document.activeElement.getAttribute('role')).toBe('row');

            press(document.activeElement, {key: 'F6'});
            expect(document.activeElement.getAttribute('role')).toBe('article');

            press(document.activeElement, {key: 'F6'});
            expect(document.activeElement).toBe(composerInput());

            press(document.activeElement, {key: 'F6', shiftKey: true});
            expect(document.activeElement.getAttribute('role')).toBe('article');

            press(document.activeElement, {key: 'F6', shiftKey: true});
            press(document.activeElement, {key: 'F6', shiftKey: true});
            expect(inSidePanel()).toBe(true);
        });
    });

    describe('toggleSidebar', () => {
        it('has no default, and toggles the sidebar once mapped', async () => {
            const {model} = await renderWorkspace();
            press(composerInput(), {key: 'b', ctrlKey: true});
            expect(model.sidebarModel.collapsed).toBe(false);

            ChatKit.defaults.shortcuts.toggleSidebar = 'mod+b';
            const second = await renderWorkspace();
            press(composerInputs()[1], {key: 'b', ctrlKey: true});
            expect(second.model.sidebarModel.collapsed).toBe(true);
        });
    });

    describe('Escape', () => {
        it('closes the side panel with focus there, and leaves a running reply alone', async () => {
            const {model, threadsModel} = await renderWorkspace(),
                stop = startLongReply(threadsModel.chatModel);
            const sideButton = screen.getByRole('button', {name: 'Side panel action'});
            sideButton.focus();

            press(sideButton, {key: 'Escape'});
            await settle();

            expect(model.isSidePanelOpen).toBe(false);
            expect(stop).not.toHaveBeenCalled();
            expect(document.activeElement).toBe(composerInput());
        });

        it('stops a running reply from the composer, and leaves the side panel open', async () => {
            const {model, threadsModel} = await renderWorkspace(),
                stop = startLongReply(threadsModel.chatModel);
            composerInput().focus();

            press(composerInput(), {key: 'Escape'});

            expect(stop).toHaveBeenCalledOnce();
            expect(model.isSidePanelOpen).toBe(true);
        });

        it('stops a running reply from the conversation, and returns focus to the composer', async () => {
            const {threadsModel} = await renderWorkspace(),
                stop = startLongReply(threadsModel.chatModel);
            const message = screen.getAllByRole('article').at(-1);
            message.focus();

            press(message, {key: 'Escape'});

            expect(stop).toHaveBeenCalledOnce();
            expect(document.activeElement).toBe(composerInput());
        });

        it('cancels an inline edit first, and stops nothing', async () => {
            const {threadsModel} = await renderWorkspace(),
                stop = vi.spyOn(threadsModel.chatModel, 'stop');
            fireEvent.click(screen.getAllByRole('button', {name: 'Edit'})[0]);
            const box = screen.getByRole('textbox', {name: 'Edit message'});

            press(box, {key: 'Escape'});

            expect(screen.queryByRole('textbox', {name: 'Edit message'})).toBeNull();
            expect(stop).not.toHaveBeenCalled();
        });
    });
});

//------------------
// Helpers
//------------------
class NoopResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
}

const THREADS: LocalChatThread[] = [
    {
        id: 't1',
        title: 'Budget review',
        lastActivityAt: Date.now(),
        messages: [
            {role: 'user', content: 'Hi'},
            {role: 'assistant', content: 'Reply one'}
        ]
    }
];

async function renderWorkspace() {
    const store = new LocalChatThreadStore({threads: THREADS}),
        transport = new ScriptedChatTransport({responses: [textEvents('Hi.')], delayMs: 0}),
        threadsModel = new ChatThreadsModel({
            store,
            createChatModel: ({threadId}) =>
                new ChatModel({transport, threadId, historyMode: 'server'})
        }),
        model = new ChatWorkspaceModel({threadsModel, sidePanelOpen: true});
    onTestFinished(() => {
        model.destroy();
        threadsModel.destroy();
    });

    render(
        chatWorkspace({
            model,
            sidePanel: button({text: 'Side panel action'}),
            sidePanelProps: {title: 'Details'}
        })
    );
    await act(() => threadsModel.loadAsync());
    await act(() => threadsModel.selectThreadAsync('t1'));
    return {model, threadsModel};
}

// Mark the chat as running a reply, with its stop spied on.
function startLongReply(chatModel: ChatModel) {
    const stop = vi.spyOn(chatModel, 'stop').mockImplementation(() => {});
    vi.spyOn(chatModel, 'isBusy', 'get').mockReturnValue(true);
    return stop;
}

function composerInputs(): HTMLElement[] {
    return Array.from(document.querySelectorAll<HTMLElement>('.xh-chat-composer textarea'));
}

function composerInput(): HTMLElement {
    return composerInputs()[0];
}

function press(target: Element, init: KeyboardEventInit) {
    fireEvent.keyDown(target, init);
}

async function settle() {
    await act(() => wait(10));
}
