import {act, fireEvent, render, screen} from '@testing-library/react';
import {span} from '@xh/hoist/cmp/layout';
import {wait} from '@xh/hoist/promise';
import {initTestAppAsync} from '@xh/hoist/test-support';
import {beforeAll, describe, expect, it, onTestFinished} from 'vitest';
import {ChatModel} from '../../../core';
import {LocalChatThreadStore} from '../../../test/support/LocalChatThreadStore';
import {ChatThreadsModel} from '../../../threads';
import {ScriptedChatTransport} from '../../../transport';
import {chatThreadStatus} from './ChatThreadStatus';

/**
 * The selected thread's status, for an app that shows its threads in a frame of its own. The app
 * relies on the workspace's states - loading, "not found" and a failed load - showing in place of
 * its conversation, and on the conversation showing otherwise.
 */
describe('ChatThreadStatus', () => {
    beforeAll(() => initTestAppAsync());

    it('shows its children for a loaded thread', async () => {
        const {threadsModel} = renderStatus();
        await act(() => threadsModel.selectThreadAsync('t1'));

        expect(screen.getByText('Conversation')).toBeTruthy();
    });

    it('shows a placeholder in place of an empty chat while its history loads', async () => {
        const {threadsModel, container} = renderStatus(20);
        act(() => {
            threadsModel.selectThreadAsync('t1');
        });

        expect(container.querySelector('.xh-chat-thread-status--loading')).toBeTruthy();
        expect(screen.queryByText('Conversation')).toBeNull();
        await act(() => wait(40));
        expect(screen.getByText('Conversation')).toBeTruthy();
    });

    it('shows "not found" for a missing thread, in the app\'s word, and New Chat opens one', async () => {
        const {threadsModel} = renderStatus(0, 'chat');
        await act(() => threadsModel.selectThreadAsync('deleted'));

        expect(screen.getByText('Chat not found')).toBeTruthy();
        expect(screen.queryByText('Conversation')).toBeNull();

        fireEvent.click(screen.getByRole('button', {name: 'New Chat'}));
        await act(() => wait());
        expect(threadsModel.selectedThreadId).not.toBe('deleted');
        expect(screen.getByText('Conversation')).toBeTruthy();
    });

    it('keeps the conversation for a failed reload with messages on screen', async () => {
        const {threadsModel, store} = renderStatus();
        await act(() => threadsModel.selectThreadAsync('t1'));
        store.failNext('loadMessagesAsync', new Error('Request timed out.'));
        await act(() => threadsModel.reloadThreadAsync());

        expect(threadsModel.loadError).not.toBeNull();
        expect(screen.getByText('Conversation')).toBeTruthy();
        expect(screen.queryByText("Couldn't load this thread")).toBeNull();
    });

    it('shows a failed load with Retry, which loads the thread', async () => {
        const {threadsModel, store} = renderStatus();
        store.failNext('loadMessagesAsync', new Error('Request timed out.'));
        await act(() => threadsModel.selectThreadAsync('t1'));

        expect(screen.getByText("Couldn't load this thread")).toBeTruthy();
        expect(screen.queryByText('Conversation')).toBeNull();

        fireEvent.click(screen.getByRole('button', {name: 'Retry'}));
        await act(() => wait());
        expect(threadsModel.loadError).toBeNull();
        expect(screen.getByText('Conversation')).toBeTruthy();
    });
});

//------------------
// Helpers
//------------------
function renderStatus(storeDelayMs: number = 0, threadNoun: string = null) {
    const store = new LocalChatThreadStore({
            threads: [
                {
                    id: 't1',
                    title: 'Budget review',
                    messages: [
                        {role: 'user', content: 'Hi'},
                        {role: 'assistant', content: 'Reply one'}
                    ]
                }
            ],
            delayMs: storeDelayMs
        }),
        threadsModel = new ChatThreadsModel({
            store,
            createChatModel: ({threadId}) =>
                new ChatModel({
                    transport: new ScriptedChatTransport(),
                    threadId,
                    historyMode: 'server'
                })
        });
    onTestFinished(() => threadsModel.destroy());
    const result = render(
        chatThreadStatus({
            model: threadsModel,
            threadNoun,
            item: span('Conversation')
        })
    );
    return {...result, threadsModel, store};
}
