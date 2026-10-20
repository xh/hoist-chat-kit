import {act, fireEvent, render, screen} from '@testing-library/react';
import {div} from '@xh/hoist/cmp/layout';
import {hoistCmp, uses} from '@xh/hoist/core';
import {Icon} from '@xh/hoist/icon';
import {initTestAppAsync} from '@xh/hoist/test-support';
import {beforeAll, beforeEach, describe, expect, it, onTestFinished, vi} from 'vitest';
import {chatAnnouncer, ChatComposerModel, ChatModel, type ChatModelConfig} from '../../../core';
import type {ChatComposerHost} from '../../../core/ChatComposerHost';
import {ScriptedChatTransport, textEvents} from '../../../transport';
import {chatComposer, type ChatComposerProps} from './ChatComposer';
import {chatStatusRegion} from './ChatStatusRegion';

/**
 * The composer's keyboard and clipboard handling. Apps rely on Enter to send, Shift+Enter for a
 * new line, an IME's Enter to confirm a candidate rather than send, Up arrow to recall the last
 * message, and a paste of text never turning into an attachment.
 */
describe('ChatComposer', () => {
    beforeAll(() => initTestAppAsync());

    // jsdom has no layout, and so no ResizeObserver. The setup unstubs globals after each test.
    beforeEach(() => {
        vi.stubGlobal('ResizeObserver', NoopResizeObserver);
        chatAnnouncer.clear();
    });

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

        const send = screen.getByRole('button', {name: 'Send'}),
            reason = document.getElementById(send.getAttribute('aria-describedby')),
            wrapper = send.parentElement;
        expect(send.hasAttribute('disabled')).toBe(true);
        expect(send.getAttribute('title')).toBe('Choose a document first.');
        expect(reason.textContent).toBe('Choose a document first.');
        // A disabled button cannot take focus, so its wrapper carries the reason to the keyboard.
        expect(wrapper.tabIndex).toBe(0);
        expect(wrapper.getAttribute('aria-describedby')).toBe(reason.id);
    });

    it('disables Send while offline, and keeps the draft', () => {
        const chatModel = createModel();
        renderComposer(chatModel);
        act(() => typeDraft(chatModel, 'Hello'));

        act(() => window.dispatchEvent(new Event('offline')));
        const send = screen.getByRole('button', {name: 'Send'});
        expect(send.hasAttribute('disabled')).toBe(true);
        expect(send.getAttribute('title')).toBe("You're offline");
        expect(input().value).toBe('Hello');

        act(() => window.dispatchEvent(new Event('online')));
        expect(screen.getByRole('button', {name: 'Send'}).hasAttribute('disabled')).toBe(false);
    });

    it('puts a named Stop in place of Send while a reply runs, and focuses the input after', async () => {
        vi.useFakeTimers();
        const chatModel = createModel({}, 50);
        renderComposer(chatModel);

        const done = chatModel.sendAsync('Hello');
        await act(() => vi.advanceTimersByTimeAsync(10));
        const stop = screen.getByRole('button', {name: 'Stop'});
        expect(stop.textContent).toBe('Stop');
        expect(screen.queryByRole('button', {name: 'Send'})).toBeNull();

        fireEvent.click(stop);
        await act(() => vi.advanceTimersByTimeAsync(10));
        await done;
        expect(screen.getByRole('button', {name: 'Send'})).toBeTruthy();
        expect(document.activeElement).toBe(input());
    });

    it('restyles Send with sendButtonProps, keeping what it does', () => {
        const chatModel = createModel(),
            send = vi.spyOn(chatModel, 'sendAsync');
        renderComposer(chatModel, {
            sendButtonProps: {
                icon: Icon.add(),
                text: 'Ask',
                intent: 'success',
                className: 'app-send'
            }
        });

        const button = screen.getByRole('button', {name: 'Ask'});
        expect(button.classList).toContain('xh-chat-composer__send');
        expect(button.classList).toContain('app-send');
        expect(button.classList).toContain('xh-button--intent-success');
        expect(button.querySelector('.fa-plus')).toBeTruthy();
        expect(button.hasAttribute('disabled')).toBe(true);

        act(() => typeDraft(chatModel, 'Hello'));
        fireEvent.click(screen.getByRole('button', {name: 'Ask'}));
        expect(send).toHaveBeenCalledTimes(1);
    });

    it('restyles Stop with stopButtonProps, keeping its name', async () => {
        vi.useFakeTimers();
        const chatModel = createModel({}, 50);
        renderComposer(chatModel, {stopButtonProps: {intent: 'danger', className: 'app-stop'}});

        const done = chatModel.sendAsync('Hello');
        await act(() => vi.advanceTimersByTimeAsync(10));
        const stop = screen.getByRole('button', {name: 'Stop'});
        expect(stop.classList).toContain('xh-chat-composer__stop');
        expect(stop.classList).toContain('app-stop');
        expect(stop.classList).toContain('xh-button--intent-danger');

        fireEvent.click(stop);
        await act(() => vi.advanceTimersByTimeAsync(10));
        await done;
    });

    it('uses the composer of the ChatModel in context', () => {
        const chatModel = createModel(),
            send = vi.spyOn(chatModel, 'sendAsync');
        render(chatHost({model: chatModel}));

        typeDraft(chatModel, 'Hello');
        fireEvent.keyDown(input(), {key: 'Enter'});

        expect(send).toHaveBeenCalledTimes(1);
    });

    it('names files left out to screen readers through the announcer', async () => {
        const chatModel = createModel({composer: {enableAttachments: true, accept: ['.csv']}}),
            {container} = renderComposer(chatModel);

        await act(() =>
            chatModel.composerModel.addFilesAsync([
                new File(['x'], 'notes.txt', {type: 'text/plain'})
            ])
        );

        expect(container.querySelector('.xh-chat-composer__attachment-errors').textContent).toBe(
            "'notes.txt' is not an accepted file type."
        );
        expect(chatAnnouncer.assertive?.text).toBe("'notes.txt' is not an accepted file type.");
        expect(container.querySelector('[role="alert"]:not(.xh-chat-announcer *)')).toBeNull();
    });

    it('renders the announcer regions, for a layout with no message list', () => {
        const {container} = renderHostComposerView(createHost());

        expect(container.querySelector('.xh-chat-announcer [aria-live="polite"]')).toBeTruthy();
    });

    describe('with a host of its own', () => {
        it('sends the draft through the host on Enter, and clears it', () => {
            const host = createHost(),
                composer = renderHostComposer(host);

            composer.text = 'Hello';
            fireEvent.keyDown(input(), {key: 'Enter'});

            expect(host.sendAsync).toHaveBeenCalledExactlyOnceWith({text: 'Hello', files: []});
            expect(composer.text).toBe('');
        });

        it('works over a host of four members, recalling and sending, with no status region', () => {
            const host: ChatComposerHost = {
                    isBusy: false,
                    sendBlockedReason: null,
                    messages: [{isUser: true, text: 'Show my limits'}],
                    sendAsync: vi.fn(async () => {})
                },
                composer = new ChatComposerModel({host});
            onTestFinished(() => composer.destroy());
            render(div(chatStatusRegion({model: composer}), chatComposer({model: composer})));

            fireEvent.keyDown(input(), {key: 'ArrowUp'});
            expect(composer.text).toBe('Show my limits');
            fireEvent.keyDown(input(), {key: 'Enter'});
            expect(host.sendAsync).toHaveBeenCalledExactlyOnceWith({
                text: 'Show my limits',
                files: []
            });

            // A blocked host has a status, but the region shows it only for a ChatModel.
            const blocked = new ChatComposerModel({
                host: {...host, sendBlockedReason: 'Read-only'}
            });
            onTestFinished(() => blocked.destroy());
            const {container} = render(chatStatusRegion({model: blocked}));
            expect(blocked.getStatus().type).toBe('blocked');
            expect(container.querySelector('.xh-chat-status-region')).toBeNull();
        });

        it('keeps a disabled Send while busy, with no Stop', () => {
            renderHostComposer(createHost({isBusy: true}));

            expect(screen.queryByRole('button', {name: 'Stop'})).toBeNull();
            expect(screen.getByRole('button', {name: 'Send'}).hasAttribute('disabled')).toBe(true);
        });
    });
});

//------------------
// Helpers
//------------------
const chatHost = hoistCmp.factory({
    model: uses(ChatModel),
    render: () => chatComposer()
});

class NoopResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
}

function createModel(config: Partial<ChatModelConfig> = {}, delayMs = 0): ChatModel {
    const model = new ChatModel({
        transport: new ScriptedChatTransport({responses: [textEvents('Hi.')], delayMs}),
        ...config
    });
    onTestFinished(() => model.destroy());
    return model;
}

function renderComposer(chatModel: ChatModel, props: Partial<ChatComposerProps> = {}) {
    return render(chatComposer({model: chatModel.composerModel, ...props}));
}

function createHost(config: Partial<ChatComposerHost> = {}): ChatComposerHost {
    return {isBusy: false, sendAsync: vi.fn(async () => {}), ...config};
}

function renderHostComposerView(host: ChatComposerHost) {
    const composer = new ChatComposerModel({host});
    onTestFinished(() => composer.destroy());
    return render(chatComposer({model: composer}));
}

function renderHostComposer(host: ChatComposerHost): ChatComposerModel {
    const composer = new ChatComposerModel({host});
    onTestFinished(() => composer.destroy());
    render(chatComposer({model: composer}));
    return composer;
}

function input(): HTMLTextAreaElement {
    return screen.getByLabelText('Message') as HTMLTextAreaElement;
}

function typeDraft(chatModel: ChatModel, text: string) {
    chatModel.composerModel.text = text;
}
