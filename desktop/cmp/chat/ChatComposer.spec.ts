import {fireEvent, render, screen} from '@testing-library/react';
import {initTestAppAsync} from '@xh/hoist/test-support';
import {beforeAll, beforeEach, describe, expect, it, onTestFinished, vi} from 'vitest';
import {ChatModel, type ChatModelConfig} from '../../../core';
import {ScriptedChatTransport, textEvents} from '../../../transport';
import {chatComposer} from './ChatComposer';

/**
 * The composer's keyboard and clipboard handling. Apps rely on Enter to send, Shift+Enter for a
 * new line, an IME's Enter to confirm a candidate rather than send, Up arrow to recall the last
 * message, and a paste of text never turning into an attachment.
 */
describe('ChatComposer', () => {
    beforeAll(() => initTestAppAsync());

    // jsdom has no layout, and so no ResizeObserver. The setup unstubs globals after each test.
    beforeEach(() => vi.stubGlobal('ResizeObserver', NoopResizeObserver));

    it('sends the draft on Enter', () => {
        const chatModel = createModel(),
            send = vi.spyOn(chatModel, 'sendAsync');
        renderComposer(chatModel);

        typeDraft(chatModel, 'Hello');
        fireEvent.keyDown(input(), {key: 'Enter'});

        expect(send).toHaveBeenCalledTimes(1);
    });

    it('does not send on Shift+Enter, or on an Enter that confirms an IME candidate', () => {
        const chatModel = createModel(),
            send = vi.spyOn(chatModel, 'sendAsync');
        renderComposer(chatModel);

        typeDraft(chatModel, 'Hello');
        fireEvent.keyDown(input(), {key: 'Enter', shiftKey: true});
        fireEvent.keyDown(input(), {key: 'Enter', keyCode: 229});
        fireEvent.keyDown(input(), {key: 'Enter', isComposing: true});

        expect(send).not.toHaveBeenCalled();
    });

    it('does not send an empty draft', () => {
        const chatModel = createModel(),
            send = vi.spyOn(chatModel, 'sendAsync');
        renderComposer(chatModel);

        fireEvent.keyDown(input(), {key: 'Enter'});

        expect(send).not.toHaveBeenCalled();
    });

    it('recalls the last user message on Up arrow in an empty input', () => {
        const chatModel = createModel({
            initialMessages: [
                {role: 'user', content: 'First'},
                {role: 'assistant', content: 'Reply'},
                {role: 'user', content: 'Second'}
            ]
        });
        renderComposer(chatModel);

        fireEvent.keyDown(input(), {key: 'ArrowUp'});

        expect(chatModel.composerModel.text).toBe('Second');
    });

    it('attaches pasted files, but lets a paste with text through', () => {
        const chatModel = createModel({composer: {enableAttachments: true}}),
            addFiles = vi
                .spyOn(chatModel.composerModel, 'addFilesAsync')
                .mockResolvedValue(undefined),
            file = new File(['x'], 'cells.png', {type: 'image/png'});
        renderComposer(chatModel);

        fireEvent.paste(input(), {clipboardData: {files: [file], types: ['Files', 'text/plain']}});
        expect(addFiles).not.toHaveBeenCalled();

        fireEvent.paste(input(), {clipboardData: {files: [file], types: ['Files']}});
        expect(addFiles).toHaveBeenCalledWith([file]);
    });

    it('shows its placeholder prop, with a default', () => {
        const chatModel = createModel(),
            {rerender} = renderComposer(chatModel);
        expect(input().getAttribute('placeholder')).toBe('Send a message...');

        rerender(chatComposer({model: chatModel.composerModel, placeholder: 'Ask away'}));
        expect(input().getAttribute('placeholder')).toBe('Ask away');
    });

    it('disables Send while a send blocker gives a reason, and states the reason', () => {
        const chatModel = createModel({sendBlocker: () => 'Choose a document first.'});
        renderComposer(chatModel);
        typeDraft(chatModel, 'Summarize it');

        const send = screen.getByRole('button', {name: 'Send'});
        expect(send.hasAttribute('disabled')).toBe(true);
        expect(send.getAttribute('title')).toBe('Choose a document first.');
        expect(screen.getByRole('status').textContent).toBe('Choose a document first.');
        expect(send.getAttribute('aria-describedby')).toBe(screen.getByRole('status').id);
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

function createModel(config: Partial<ChatModelConfig> = {}): ChatModel {
    const model = new ChatModel({
        transport: new ScriptedChatTransport({responses: [textEvents('Hi.')], delayMs: 0}),
        ...config
    });
    onTestFinished(() => model.destroy());
    return model;
}

function renderComposer(chatModel: ChatModel) {
    return render(chatComposer({model: chatModel.composerModel}));
}

function input(): HTMLTextAreaElement {
    return screen.getByLabelText('Message') as HTMLTextAreaElement;
}

function typeDraft(chatModel: ChatModel, text: string) {
    chatModel.composerModel.text = text;
}
