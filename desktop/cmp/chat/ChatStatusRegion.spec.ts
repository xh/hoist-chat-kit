import {act, fireEvent, render, screen} from '@testing-library/react';
import {XH} from '@xh/hoist/core';
import {initTestAppAsync} from '@xh/hoist/test-support';
import {afterEach, beforeAll, describe, expect, it, onTestFinished, vi} from 'vitest';
import {chatAnnouncer, ChatKit, ChatModel, type ChatModelConfig} from '../../../core';
import {type ChatEvent, errorEvents, ScriptedChatTransport, textEvents} from '../../../transport';
import {chatStatusRegion} from './ChatStatusRegion';

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
        await chatModel.sendAsync('Hi');
        const retry = vi.spyOn(chatModel, 'retryAsync').mockResolvedValue();
        renderRegion(chatModel);

        expect(regionText()).toBe('The reply failed. Model timed out.');
        expect(chatAnnouncer.assertive?.text).toBe('The reply failed. Model timed out.');
        fireEvent.click(screen.getByRole('button', {name: 'Try Again'}));
        expect(retry).toHaveBeenCalledTimes(1);
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

    it('shows a reply in progress, with Esc to stop when the host can stop', async () => {
        vi.useFakeTimers();
        const chatModel = createModel({responses: [textEvents('A long answer.')], delayMs: 50});
        const done = chatModel.sendAsync('Hi');
        renderRegion(chatModel, {assistantName: 'Analyst'});

        expect(regionText()).toBe('Analyst is working · Esc to stop');
        await act(() => vi.advanceTimersByTimeAsync(5000));
        await done;
        expect(regionText()).toBeNull();
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

function renderRegion(chatModel: ChatModel, props: {assistantName?: string} = {}) {
    return render(chatStatusRegion({model: chatModel.composerModel, ...props}));
}

function regionText(): string {
    return document.querySelector('.xh-chat-status-region__text')?.textContent ?? null;
}

async function settleAsync(promise: Promise<void>) {
    await vi.advanceTimersByTimeAsync(100);
    await promise;
}
