import {act, fireEvent, render, screen} from '@testing-library/react';
import {XH} from '@xh/hoist/core';
import {initTestAppAsync} from '@xh/hoist/test-support';
import {afterEach, beforeAll, describe, expect, it, onTestFinished, vi} from 'vitest';
import {chatAnnouncer, ChatKit, ChatModel, type ChatModelConfig} from '../../../core';
import {type ChatEvent, errorEvents, ScriptedChatTransport, textEvents} from '../../../transport';
import {chatStatusRegion, type ChatStatusRegionProps} from './ChatStatusRegion';

/**
 * The status region holds the thread's one next action (D64). These specs pin what it offers for
 * each state, since the wrong action - Try Again where a resend could run a write twice - does
 * harm, and a countdown that retries must stop when the user cancels.
 */
describe('ChatStatusRegion', () => {
    beforeAll(() => initTestAppAsync());

    afterEach(() => {
        chatAnnouncer.clear();
        ChatKit.clearLocalData();
    });

    it('renders nothing while there is nothing to say', () => {
        const {container} = renderRegion(createModel());
        expect(container.querySelector('.xh-chat-status-region')).toBeNull();
    });

    it('offers Try Again for a failure that is retry-safe, and announces it at once', async () => {
        const chatModel = createModel({responses: [errorEvents('Model timed out.')]});
        renderRegion(chatModel);
        await act(() => chatModel.sendAsync('Hi'));
        const retry = vi.spyOn(chatModel, 'retryAsync').mockResolvedValue();

        expect(regionText()).toBe('The reply failed. Model timed out.');
        expect(chatAnnouncer.assertive?.text).toBe('The reply failed. Model timed out.');
        fireEvent.click(screen.getByRole('button', {name: 'Try Again'}));
        expect(retry).toHaveBeenCalledTimes(1);
    });

    it('withdraws the announcement of a status once it passes', async () => {
        const chatModel = createModel({
            responses: [errorEvents('Model timed out.'), textEvents('Recovered.')]
        });
        renderRegion(chatModel);
        await act(() => chatModel.sendAsync('Hi'));
        expect(chatAnnouncer.assertive?.text).toBe('The reply failed. Model timed out.');

        await act(() => chatModel.retryAsync());

        expect(regionText()).toBeNull();
        expect(chatAnnouncer.assertive).toBeNull();
    });

    it('never announces the status a thread already had when the region mounts or the thread opens', async () => {
        const chatModel = createModel({
            threadId: 't1',
            responses: [errorEvents('Model timed out.'), errorEvents('Service down.')]
        });
        await chatModel.sendAsync('Hi');
        renderRegion(chatModel);

        expect(regionText()).toBe('The reply failed. Model timed out.');
        expect(chatAnnouncer.assertive).toBeNull();

        act(() =>
            chatModel.loadMessages(
                [
                    {role: 'user', content: 'Earlier'},
                    {role: 'assistant', content: '', status: 'error', error: 'Old failure.'}
                ],
                't2'
            )
        );
        expect(regionText()).toBe('The reply failed. Old failure.');
        expect(chatAnnouncer.assertive).toBeNull();
    });

    it('says a dropped server run may still be running, and offers Refresh Status with a thread layer', async () => {
        const chatModel = createModel({
            historyMode: 'server',
            // The code the kit gives a stream that ends before its run does.
            responses: [
                errorEvents('The response ended before it was complete.', 'incomplete-stream')
            ]
        });
        await chatModel.sendAsync('Add the note');
        const {rerender} = renderRegion(chatModel);

        expect(regionText()).toBe(
            'The response ended before it was complete. It may still be running.'
        );
        expect(screen.getByRole('button', {name: 'Try Again'})).toBeTruthy();

        const refresh = vi.fn(async () => {});
        chatModel.setStatusRefresher(refresh);
        rerender(chatStatusRegion({model: chatModel.composerModel}));

        expect(screen.queryByRole('button', {name: 'Try Again'})).toBeNull();
        fireEvent.click(screen.getByRole('button', {name: 'Refresh Status'}));
        expect(refresh).toHaveBeenCalledTimes(1);
    });

    it('counts down the wait the server asks for, then retries', async () => {
        vi.useFakeTimers();
        const chatModel = createModel({
            responses: [errorEvents('Already being handled.', 'duplicate', {retryAfterSeconds: 30})]
        });
        await settleAsync(chatModel.sendAsync('Hi'));
        const retry = vi.spyOn(chatModel, 'retryAsync').mockResolvedValue();
        renderRegion(chatModel);

        expect(regionText()).toBe('Already being handled. Waiting to retry, 30 s.');
        await act(() => vi.advanceTimersByTimeAsync(10_000));
        expect(regionText()).toBe('Already being handled. Waiting to retry, 20 s.');
        expect(retry).not.toHaveBeenCalled();

        await act(() => vi.advanceTimersByTimeAsync(20_000));
        expect(retry).toHaveBeenCalledTimes(1);
    });

    it('retries a turn whose wait ran out while no region showed, once a region mounts', async () => {
        vi.useFakeTimers();
        const chatModel = createModel({
            responses: [errorEvents('Already being handled.', 'duplicate', {retryAfterSeconds: 30})]
        });
        await settleAsync(chatModel.sendAsync('Hi'));
        const retry = vi.spyOn(chatModel, 'retryAsync').mockResolvedValue();
        await vi.advanceTimersByTimeAsync(30_000);
        expect(retry).not.toHaveBeenCalled();

        renderRegion(chatModel);

        expect(retry).toHaveBeenCalledTimes(1);
    });

    it('retries once when two regions show one composer', async () => {
        vi.useFakeTimers();
        const chatModel = createModel({
            responses: [errorEvents('Already being handled.', 'duplicate', {retryAfterSeconds: 30})]
        });
        await settleAsync(chatModel.sendAsync('Hi'));
        const retry = vi.spyOn(chatModel, 'retryAsync').mockResolvedValue();
        renderRegion(chatModel);
        renderRegion(chatModel);

        await act(() => vi.advanceTimersByTimeAsync(30_000));

        expect(retry).toHaveBeenCalledTimes(1);
    });

    it('retries on its own at most 3 times, then offers Try Again', async () => {
        vi.useFakeTimers();
        const failure = () =>
                errorEvents('Already being handled.', 'duplicate', {retryAfterSeconds: 5}),
            chatModel = createModel({responses: [1, 2, 3, 4, 5].map(failure)}),
            retry = vi.spyOn(chatModel, 'retryAsync');
        renderRegion(chatModel);
        await act(() => settleAsync(chatModel.sendAsync('Hi')));

        for (let i = 0; i < 5; i++) {
            await act(() => vi.advanceTimersByTimeAsync(5_100));
        }

        expect(retry).toHaveBeenCalledTimes(3);
        expect(regionText()).toBe('The reply failed. Already being handled.');
        expect(screen.getByRole('button', {name: 'Try Again'})).toBeTruthy();
    });

    it('stops the countdown on Cancel, and offers Try Again', async () => {
        vi.useFakeTimers();
        const chatModel = createModel({
            responses: [errorEvents('Already being handled.', 'duplicate', {retryAfterSeconds: 30})]
        });
        await settleAsync(chatModel.sendAsync('Hi'));
        const retry = vi.spyOn(chatModel, 'retryAsync').mockResolvedValue();
        renderRegion(chatModel);

        fireEvent.click(screen.getByRole('button', {name: 'Cancel'}));
        await act(() => vi.advanceTimersByTimeAsync(30_000));

        expect(retry).not.toHaveBeenCalled();
        expect(regionText()).toBe('The reply failed. Already being handled.');
        expect(screen.getByRole('button', {name: 'Try Again'})).toBeTruthy();
        // The user's own Cancel is not met with an interruption.
        expect(chatAnnouncer.assertive).toBeNull();
    });

    it('shows a failure with a wait as a plain failure, with no action, in a chat that cannot retry', async () => {
        vi.useFakeTimers();
        const chatModel = createModel({
            responses: [
                errorEvents('Already being handled.', 'duplicate', {retryAfterSeconds: 30})
            ],
            allowRetry: false
        });
        renderRegion(chatModel);
        await settleAsync(chatModel.sendAsync('Hi'));

        expect(regionText()).toBe('The reply failed. Already being handled.');
        expect(chatAnnouncer.assertive?.text).toBe('The reply failed. Already being handled.');
        const region = document.querySelector('.xh-chat-status-region');
        expect(region.querySelector('[data-icon="clock"]')).toBeNull();
        expect(region.querySelector('button')).toBeNull();
    });

    it('says the draft is kept while offline, ahead of a failure', async () => {
        const chatModel = createModel({responses: [errorEvents('Model timed out.')]});
        await chatModel.sendAsync('Hi');
        renderRegion(chatModel);

        act(() => window.dispatchEvent(new Event('offline')));
        expect(regionText()).toBe("Offline. Your draft is kept; send it when you're back online.");
        expect(screen.queryByRole('button')).toBeNull();

        act(() => window.dispatchEvent(new Event('online')));
        expect(regionText()).toBe('The reply failed. Model timed out.');
    });

    it('shows why sending must wait before anything else', async () => {
        const chatModel = createModel({
            responses: [errorEvents('Model timed out.')],
            sendBlocker: () => (chatModel.isEmpty ? null : 'Wait for the conversation to load.')
        });
        await chatModel.sendAsync('Hi');
        renderRegion(chatModel);

        expect(regionText()).toBe('Wait for the conversation to load.');
    });

    it('shows no line while a reply is in progress - the reply shows its own progress', async () => {
        vi.useFakeTimers();
        const chatModel = createModel({responses: [textEvents('A long answer.')], delayMs: 50});
        const done = chatModel.sendAsync('Hi');
        renderRegion(chatModel);

        expect(chatModel.composerModel.getStatus().type).toBe('busy');
        expect(regionText()).toBeNull();
        await act(() => vi.advanceTimersByTimeAsync(5000));
        await done;
    });

    it('offers Discard for a restored draft', () => {
        XH.localStorageService.set('xhChat.draft.t1', {text: 'Compare', savedAt: Date.now()});
        const chatModel = createModel({threadId: 't1'});
        renderRegion(chatModel);

        expect(regionText()).toMatch(/^Draft from .+ restored\.$/);
        fireEvent.click(screen.getByRole('button', {name: 'Discard'}));

        expect(chatModel.composerModel.text).toBe('');
        expect(regionText()).toBeNull();
    });
});

//------------------
// Helpers
//------------------
interface ModelSpec extends Partial<ChatModelConfig> {
    responses?: ChatEvent[][];
    delayMs?: number;
}

function createModel({responses = [textEvents('Hi.')], delayMs = 0, ...config}: ModelSpec = {}) {
    const model = new ChatModel({
        transport: new ScriptedChatTransport({responses, delayMs}),
        ...config
    });
    onTestFinished(() => model.destroy());
    return model;
}

function renderRegion(chatModel: ChatModel, props: Omit<ChatStatusRegionProps, 'model'> = {}) {
    return render(chatStatusRegion({model: chatModel.composerModel, ...props}));
}

function regionText(): string {
    return document.querySelector('.xh-chat-status-region__text')?.textContent ?? null;
}

async function settleAsync(promise: Promise<void>) {
    await vi.advanceTimersByTimeAsync(100);
    await promise;
}
