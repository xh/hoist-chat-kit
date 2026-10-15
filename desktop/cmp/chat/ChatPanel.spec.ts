import {act, fireEvent, render, screen} from '@testing-library/react';
import {initTestAppAsync} from '@xh/hoist/test-support';
import {beforeAll, beforeEach, describe, expect, it, onTestFinished, vi} from 'vitest';
import {ChatModel} from '../../../core';
import {errorEvents, ScriptedChatTransport, textEvents} from '../../../transport';
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
    beforeEach(() => vi.stubGlobal('ResizeObserver', NoopResizeObserver));

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

    it('shows the status region above the composer', async () => {
        const chatModel = createModel([errorEvents('Model timed out.')]);
        await chatModel.sendAsync('Hi');
        renderPanel(chatModel);

        const footer = document.querySelector('.xh-chat-panel__footer');
        expect(footer.firstElementChild.classList.contains('xh-chat-status-region')).toBe(true);
        expect(footer.lastElementChild.classList.contains('xh-chat-composer')).toBe(true);
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

function createModel(responses = [textEvents('Hi.')]): ChatModel {
    const model = new ChatModel({
        transport: new ScriptedChatTransport({responses, delayMs: 0}),
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
