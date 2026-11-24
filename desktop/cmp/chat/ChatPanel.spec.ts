import {act, fireEvent, render, screen} from '@testing-library/react';
import {div, span} from '@xh/hoist/cmp/layout';
import {initTestAppAsync} from '@xh/hoist/test-support';
import {beforeAll, beforeEach, describe, expect, it, onTestFinished, vi} from 'vitest';
import {chatAnnouncer, ChatKit, ChatModel} from '../../../core';
import {errorEvents, ScriptedChatTransport, textEvents} from '../../../transport';
import {chatComposerPill} from './ChatComposerPill';
import {chatPanel} from './ChatPanel';
import {chatSuggestions} from './ChatSuggestions';

/**
 * The panel's empty state and its first send (P5, D71). A suggestion must only fill the composer,
 * never send - the user reads the prompt first - and the composer must survive the move to the
 * bottom, so that focus never leaves it.
 */
describe('ChatPanel', () => {
    beforeAll(() => initTestAppAsync());

    // jsdom has no layout, and so no ResizeObserver. The setup unstubs globals after each test.
    beforeEach(() => {
        vi.stubGlobal('ResizeObserver', NoopResizeObserver);
        Element.prototype.scrollTo ??= () => {};
        chatAnnouncer.clear();
    });

    it('centers the composer in an empty chat, between the heading and the suggestions', () => {
        renderPanel(createModel(), {emptyStateProps: {title: 'What do you want to know?'}});

        const panel = document.querySelector('.xh-chat-panel'),
            order = ['__empty-head', '__footer', '__empty-tail'].map(it =>
                panel.querySelector(`.xh-chat-panel${it}`)
            );
        expect(panel.classList.contains('xh-chat-panel--empty')).toBe(true);
        expect(order.every(Boolean)).toBe(true);
        expect(order[0].textContent).toBe('What do you want to know?');
        expect(order[1].querySelector('textarea')).toBeTruthy();
        expect(order[2].querySelectorAll('.xh-chat-suggestions__card')).toHaveLength(2);
    });

    it('tells a pill to open down while the composer is centered, and up once it docks', async () => {
        const chatModel = createModel(),
            pill = chatComposerPill({text: 'Model', menuItems: [{text: 'Fast'}]}),
            placement = () => document.querySelector('.xh-chat-composer-pill__popover').classList;
        renderPanel(chatModel, {composerProps: {bottomItems: pill}});

        const button = () => screen.getByRole('button', {name: 'Model'});
        fireEvent.click(button());
        expect(placement()).toContain('bp6-popover-placement-bottom');
        fireEvent.click(button());

        await act(() => chatModel.sendAsync('Hi'));
        fireEvent.click(button());
        expect(placement()).toContain('bp6-popover-placement-top');
    });

    it("shows the app's own header content above the heading of the empty state", () => {
        renderPanel(createModel(), {
            emptyStateProps: {
                header: span({className: 'app-logo', children: 'Acme'}),
                title: 'What do you want to know?'
            }
        });

        const head = document.querySelector('.xh-chat-panel__empty-head'),
            header = head.querySelector('.xh-chat-empty-state__header');
        expect(header.querySelector('.app-logo').textContent).toBe('Acme');
        expect(header.nextElementSibling.textContent).toBe('What do you want to know?');
    });

    it("shows the app's own content right under the composer, and its footer below the suggestions", () => {
        renderPanel(createModel(), {
            emptyStateProps: {
                title: 'What do you want to know?',
                belowComposer: span({
                    className: 'app-help',
                    children: 'Shift+Enter for a new line.'
                }),
                footer: span({
                    className: 'app-note',
                    children: 'Answers come from policy documents.'
                })
            }
        });
        const below = document.querySelector('.xh-chat-panel__empty-tail').firstElementChild;
        expect(below.querySelector('.app-help')).not.toBeNull();
        expect(below.nextElementSibling.classList).toContain('xh-chat-suggestions');

        const head = document.querySelector('.xh-chat-panel__empty-head'),
            tail = document.querySelector('.xh-chat-panel__empty-tail'),
            footer = tail.querySelector('.xh-chat-empty-state__footer');
        expect(head.querySelector('.app-note')).toBeNull();
        expect(footer.querySelector('.app-note').textContent).toBe(
            'Answers come from policy documents.'
        );
        expect(footer.previousElementSibling.classList).toContain('xh-chat-suggestions');
    });

    it('fills the composer from a suggestion, and never sends it', () => {
        const chatModel = createModel(),
            send = vi.spyOn(chatModel, 'sendAsync');
        renderPanel(chatModel);

        fireEvent.click(screen.getByRole('button', {name: /Loans short on reserves/}));

        expect(chatModel.composerModel.text).toBe('Which loans are short on reserves?');
        expect(document.activeElement).toBe(input());
        expect(send).not.toHaveBeenCalled();
    });

    it('hides the suggestions while the composer has text', () => {
        const chatModel = createModel();
        renderPanel(chatModel);

        act(() => (chatModel.composerModel.text = 'My own question'));
        expect(document.querySelector('.xh-chat-suggestions')).toBeNull();

        act(() => (chatModel.composerModel.text = ''));
        expect(document.querySelector('.xh-chat-suggestions')).toBeTruthy();
    });

    it('calls onSelect in place of filling the composer', () => {
        const chatModel = createModel(),
            onSelect = vi.fn();
        render(chatSuggestions({model: chatModel, suggestions: SUGGESTIONS, onSelect}));

        fireEvent.click(screen.getByRole('button', {name: /Concentration by region/}));

        expect(onSelect).toHaveBeenCalledWith(SUGGESTIONS[0]);
        expect(chatModel.composerModel.text).toBe('');
    });

    it('keeps the same composer through the first send, and shows the thread', async () => {
        const chatModel = createModel();
        renderPanel(chatModel);
        const before = input();

        await act(() => chatModel.sendAsync('Hello'));

        expect(input()).toBe(before);
        expect(document.querySelector('.xh-chat-panel--empty')).toBeNull();
        expect(document.querySelector('.xh-chat-message-list')).toBeTruthy();
    });

    it('keeps the composer at the bottom under a custom empty state', () => {
        renderPanel(createModel(), {emptyState: 'Nothing here yet'});

        expect(document.querySelector('.xh-chat-panel--empty')).toBeNull();
        expect(screen.getByText('Nothing here yet')).toBeTruthy();
    });

    it('focuses the composer on / from a message, and keeps any app hotkeys', async () => {
        const chatModel = createModel(),
            onKeyDown = vi.fn();
        await chatModel.sendAsync('Hello');
        renderPanel(chatModel, {hotkeys: [{combo: 'alt+k', label: 'App key', onKeyDown}]});
        const message = screen.getAllByRole('article').at(-1);
        message.focus();

        fireEvent.keyDown(message, {key: '/'});
        expect(document.activeElement).toBe(input());

        fireEvent.keyDown(message, {key: 'k', altKey: true});
        expect(onKeyDown).toHaveBeenCalledOnce();
    });

    it('speaks to screen readers before the first reply, with no message list', () => {
        renderPanel(createModel());
        expect(document.querySelector('.xh-chat-message-list')).toBeNull();

        act(() => chatAnnouncer.announce('Sending is blocked.', 'assertive'));

        expect(document.querySelector('.xh-chat-announcer [role="alert"]').textContent).toBe(
            'Sending is blocked.'
        );
    });

    it("never reads the last thread's announcement into a panel that mounts after it", () => {
        const {unmount} = renderPanel(createModel());
        act(() => chatAnnouncer.announce('Analyst replied after 2 seconds.'));
        expect(document.querySelector('.xh-chat-announcer').textContent).toBe(
            'Analyst replied after 2 seconds.'
        );
        unmount();

        renderPanel(createModel());

        expect(chatAnnouncer.polite?.text).toBe('Analyst replied after 2 seconds.');
        document.querySelectorAll('.xh-chat-announcer').forEach(it => {
            expect(it.textContent).toBe('');
        });
    });

    it('shows the status region above the composer', async () => {
        const chatModel = createModel([errorEvents('Model timed out.')]);
        await chatModel.sendAsync('Hi');
        renderPanel(chatModel);

        const footer = document.querySelector('.xh-chat-panel__footer');
        expect(footer.firstElementChild.classList.contains('xh-chat-status-region')).toBe(true);
        expect(footer.lastElementChild.classList.contains('xh-chat-composer')).toBe(true);
    });

    it('shows a reply on its way for a turn running on the server, with nothing saved yet', () => {
        const chatModel = createModel([]);
        chatModel.setStatusRefresher(async () => {}, {
            isAutomatic: () => true,
            isRunningOnServer: () => true
        });
        renderPanel(chatModel);

        expect(
            document.querySelector('.xh-chat-message-list__awaiting-reply').textContent
        ).toContain('Still working on the server');
        expect(document.querySelector('.xh-chat-empty-state')).toBeNull();
        expect(document.querySelector('.xh-chat-panel--empty')).toBeNull();
        expect(document.querySelector('.xh-chat-composer--busy')).toBeTruthy();
        expect(document.querySelector('.xh-chat-status-region')).toBeNull();
    });

    it("shows a reply on its way after the user's question, while the server writes it", () => {
        const chatModel = createModel([]);
        chatModel.loadMessages([{role: 'user', content: 'Rates?'}]);
        chatModel.setStatusRefresher(async () => {}, {
            isAutomatic: () => true,
            isRunningOnServer: () => true
        });
        renderPanel(chatModel);

        const items = document.querySelector('.xh-chat-message-list__content').children;
        expect(items[items.length - 1].className).toContain('xh-chat-message-list__awaiting-reply');
        expect(document.querySelector('.xh-chat-status-region')).toBeNull();
    });

    it('passes statusRegionProps to the status region', async () => {
        const chatModel = createModel([errorEvents('Model timed out.')], 0);
        await chatModel.sendAsync('Hi');
        renderPanel(chatModel, {statusRegionProps: {className: 'app-status'}});

        expect(document.querySelector('.xh-chat-status-region.app-status')).toBeTruthy();
    });
    it('sets compact density at 380 px or less, measured on its own element', () => {
        const resizeTo = stubPanelResize();
        renderPanel(createModel());

        const panel = document.querySelector('.xh-chat-panel');
        expect(panel.classList).not.toContain('xh-chat--compact');

        resizeTo(380);
        expect(panel.classList).toContain('xh-chat--compact');

        resizeTo(381);
        expect(panel.classList).not.toContain('xh-chat--compact');
    });

    it('takes its compact width from ChatKit.defaults.compactMaxWidth, and none when null', () => {
        const saved = ChatKit.defaults.compactMaxWidth,
            resizeTo = stubPanelResize();
        onTestFinished(() => {
            ChatKit.defaults.compactMaxWidth = saved;
        });
        renderPanel(createModel());

        const panel = document.querySelector('.xh-chat-panel');

        ChatKit.defaults.compactMaxWidth = 500;
        resizeTo(450);
        expect(panel.classList).toContain('xh-chat--compact');

        ChatKit.defaults.compactMaxWidth = null;
        resizeTo(300);
        expect(panel.classList).not.toContain('xh-chat--compact');
    });

    describe('file drops', () => {
        const file = new File(['x'], 'notes.txt', {type: 'text/plain'}),
            fileDrag = {dataTransfer: {types: ['Files'], files: [file]}},
            hint = () => document.querySelector('.xh-chat-drop-hint');

        it('takes a file dropped anywhere on the panel, and focuses the composer', async () => {
            const chatModel = createModel(),
                {composerModel} = chatModel;
            composerModel.enableAttachments = true;
            renderPanel(chatModel);
            await act(() => chatModel.sendAsync('Hi'));
            const list = document.querySelector('.xh-chat-message-list');

            fireEvent.dragEnter(list, fileDrag);
            expect(hint().classList).toContain('xh-chat-panel__drop-hint');
            expect(hint().textContent).toContain(composerModel.attachmentTip);
            expect(document.querySelectorAll('.xh-chat-drop-hint')).toHaveLength(1);

            await act(async () => {
                fireEvent.drop(list, fileDrag);
            });
            await vi.waitFor(() => expect(composerModel.attachments).toHaveLength(1));
            expect(composerModel.attachments[0].name).toBe('notes.txt');
            expect(hint()).toBeNull();
            expect(document.activeElement).toBe(input());
        });

        it('shows one hint, over the panel, for a drag over the composer', () => {
            const chatModel = createModel();
            chatModel.composerModel.enableAttachments = true;
            renderPanel(chatModel);

            fireEvent.dragEnter(input(), fileDrag);
            expect(document.querySelectorAll('.xh-chat-drop-hint')).toHaveLength(1);
            expect(document.querySelector('.xh-chat-composer__drop-hint')).toBeNull();

            fireEvent.dragLeave(input(), fileDrag);
            expect(hint()).toBeNull();
        });

        it('clears the hint when an element under the drag was removed before it left', async () => {
            const chatModel = createModel();
            chatModel.composerModel.enableAttachments = true;
            renderPanel(chatModel);
            await act(() => chatModel.sendAsync('Hi'));
            const list = document.querySelector('.xh-chat-message-list'),
                child = list.querySelector('.xh-chat-message');

            fireEvent.dragEnter(list, fileDrag);
            fireEvent.dragEnter(child, fileDrag);
            // As when a streaming reply re-renders: the leave of a removed element never bubbles.
            child.remove();
            fireEvent.dragLeave(list, fileDrag);
            expect(hint()).toBeNull();
        });

        it("leaves a file to an app's own drop zone inside the panel", () => {
            const chatModel = createModel(),
                addFiles = vi.spyOn(chatModel.composerModel, 'addFilesAsync'),
                take = (e: {preventDefault: () => void}) => e.preventDefault();
            chatModel.composerModel.enableAttachments = true;
            renderPanel(chatModel, {
                emptyState: div({
                    className: 'app-drop-zone',
                    onDragEnter: take,
                    onDragOver: take,
                    onDrop: take
                })
            });
            const zone = document.querySelector('.app-drop-zone');

            fireEvent.dragEnter(zone, fileDrag);
            expect(hint()).toBeNull();
            fireEvent.drop(zone, fileDrag);
            expect(addFiles).not.toHaveBeenCalled();
        });

        it('refuses a file while attachments are off, so the browser does not open it', () => {
            const chatModel = createModel(),
                addFiles = vi.spyOn(chatModel.composerModel, 'addFilesAsync');
            renderPanel(chatModel);
            const head = document.querySelector('.xh-chat-panel__empty-head');

            fireEvent.dragEnter(head, fileDrag);
            expect(hint()).toBeNull();
            // False means that a handler prevented the browser's default.
            expect(fireEvent.dragOver(head, fileDrag)).toBe(false);
            expect(fireEvent.drop(head, fileDrag)).toBe(false);
            expect(addFiles).not.toHaveBeenCalled();
        });

        it('leaves a drag with no files alone, such as one of text', () => {
            const chatModel = createModel();
            chatModel.composerModel.enableAttachments = true;
            renderPanel(chatModel);
            const textDrag = {dataTransfer: {types: ['text/plain'], files: []}};

            fireEvent.dragEnter(input(), textDrag);
            expect(hint()).toBeNull();
            expect(fireEvent.drop(input(), textDrag)).toBe(true);
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

/** Stub ResizeObserver, and return a function that resizes the panel's own element by hand. */
function stubPanelResize(): (width: number) => void {
    const callbacks: ResizeObserverCallback[] = [];
    vi.stubGlobal(
        'ResizeObserver',
        class {
            constructor(private callback: ResizeObserverCallback) {}
            observe(el: Element) {
                if (el.classList?.contains('xh-chat-panel')) callbacks.push(this.callback);
            }
            unobserve() {}
            disconnect() {}
        }
    );
    const entry = (width: number) => ({contentRect: {width, height: 600}}) as ResizeObserverEntry;
    return width => act(() => callbacks.forEach(it => it([entry(width)], null)));
}

function createModel(responses = [textEvents('Hi.')], delayMs = 0): ChatModel {
    const model = new ChatModel({
        transport: new ScriptedChatTransport({responses, delayMs}),
        composer: {drafts: 'memory'}
    });
    onTestFinished(() => model.destroy());
    return model;
}

function renderPanel(chatModel: ChatModel, props: Record<string, any> = {}) {
    return render(chatPanel({model: chatModel, suggestions: SUGGESTIONS, ...props}));
}

const SUGGESTIONS = [
    {text: 'Concentration by region', description: 'Office against the 40% cap'},
    {text: 'Loans short on reserves', prompt: 'Which loans are short on reserves?'}
];

function input(): HTMLTextAreaElement {
    return screen.getByLabelText('Message') as HTMLTextAreaElement;
}
