import {act, fireEvent, render, screen} from '@testing-library/react';
import {fragment} from '@xh/hoist/cmp/layout';
import {creates, hoistCmp, HoistModel, XH} from '@xh/hoist/core';
import {wait} from '@xh/hoist/promise';
import {initTestAppAsync} from '@xh/hoist/test-support';
import {beforeAll, beforeEach, describe, expect, it, onTestFinished, vi} from 'vitest';
import {
    chatAnnouncer,
    ChatMessage,
    type ChatMessageListHost,
    ChatModel,
    chatToolResult
} from '../../../core';
import {ScriptedChatTransport, textEvents, toolCallEvents} from '../../../transport';
import {chatMessageList} from './ChatMessageList';

/**
 * Undo of the changes a reply made. A failed undo must show where the user asked for it, with
 * Retry, and never as a toast. Once the changes are undone the reply says so, and offers no Redo.
 */
describe('ChatMessageView undo', () => {
    beforeAll(() => initTestAppAsync());

    beforeEach(() => {
        vi.stubGlobal('ResizeObserver', NoopResizeObserver);
        Element.prototype.scrollTo ??= () => {};
        chatAnnouncer.clear();
    });

    it('shows a failed undo inline with Retry, then notes the changes undone', async () => {
        const handleException = vi.spyOn(XH, 'handleException').mockImplementation(() => {});
        onTestFinished(() => handleException.mockRestore());
        const undo = vi.fn().mockRejectedValueOnce(new Error('The grid is locked.')),
            chatModel = new ChatModel({
                transport: new ScriptedChatTransport({
                    responses: [toolCallEvents('filter', {}), textEvents('Filtered.')],
                    delayMs: 0
                }),
                tools: [{name: 'filter', execute: () => chatToolResult('Done.', {undo})}]
            });
        onTestFinished(() => chatModel.destroy());
        await chatModel.sendAsync('Filter the grid');
        render(chatMessageList({model: chatModel}));

        await act(() => fireEvent.click(screen.getByRole('button', {name: 'Undo changes'})));

        const line = document.querySelector('.xh-chat-message__undo-failed');
        expect(line.textContent).toContain("Couldn't undo the changes.");
        expect(line.textContent).toContain('The grid is locked.');
        expect(handleException).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({showAlert: false})
        );
        expect(chatAnnouncer.assertive?.text).toBe('Change not undone.');

        await act(() => fireEvent.click(screen.getByRole('button', {name: 'Retry'})));

        expect(undo).toHaveBeenCalledTimes(2);
        expect(document.querySelector('.xh-chat-message__undo-failed')).toBeNull();
        expect(screen.getByText('Changes undone.')).toBeTruthy();
        expect(screen.queryByRole('button', {name: 'Undo changes'})).toBeNull();
        expect(screen.queryByRole('button', {name: /Redo/})).toBeNull();
    });

    it("shows the rejection of a plain host's undo, while the reply can still be undone", async () => {
        let canUndo = true;
        const host: ChatMessageListHost = {
            messages: [new ChatMessage({id: 'a1', role: 'assistant', content: 'Changed it.'})],
            isBusy: false,
            canUndoTurn: () => canUndo,
            undoTurnAsync: vi.fn(() => Promise.reject(new Error('Offline.')))
        };
        const {rerender} = render(appContext({item: chatMessageList({host})}));

        await act(() => fireEvent.click(screen.getByRole('button', {name: 'Undo changes'})));
        expect(document.querySelector('.xh-chat-message__undo-failed').textContent).toContain(
            'Offline.'
        );

        // Retry could not work once the reply can no longer be undone, so the line goes.
        canUndo = false;
        rerender(appContext({item: chatMessageList({host: {...host}})}));
        expect(document.querySelector('.xh-chat-message__undo-failed')).toBeNull();
    });
});

/**
 * Where keyboard focus goes after an action whose button goes away. It must never drop to the
 * page, which leaves a keyboard user at the top of the document.
 */
describe('ChatMessageView focus after an action', () => {
    beforeAll(() => initTestAppAsync());

    beforeEach(() => {
        vi.stubGlobal('ResizeObserver', NoopResizeObserver);
        Element.prototype.scrollTo ??= () => {};
    });

    it('moves focus to the reply once Undo succeeds', async () => {
        const chatModel = new ChatModel({
            transport: new ScriptedChatTransport({
                responses: [toolCallEvents('filter', {}), textEvents('Filtered.')],
                delayMs: 0
            }),
            tools: [{name: 'filter', execute: () => chatToolResult('Done.', {undo: vi.fn()})}]
        });
        onTestFinished(() => chatModel.destroy());
        await chatModel.sendAsync('Filter the grid');
        render(chatMessageList({model: chatModel}));

        const undo = screen.getByRole('button', {name: 'Undo changes'});
        act(() => undo.focus());
        await act(() => fireEvent.click(undo));
        await act(() => wait());

        expect(screen.queryByRole('button', {name: 'Undo changes'})).toBeNull();
        expect(document.activeElement).toBe(document.querySelector('.xh-chat-message--assistant'));
    });

    it('moves focus to the composer on Regenerate', () => {
        const composerModel = {focus: vi.fn()},
            host: ChatMessageListHost = {
                messages: [
                    new ChatMessage({id: 'u1', role: 'user', content: 'Hi'}),
                    new ChatMessage({id: 'a1', role: 'assistant', content: 'Hello.'})
                ],
                isBusy: false,
                regenerateAsync: vi.fn(() => Promise.resolve()),
                composerModel
            };
        render(appContext({item: chatMessageList({host})}));

        fireEvent.click(screen.getByRole('button', {name: 'Regenerate'}));
        expect(host.regenerateAsync).toHaveBeenCalledWith('a1');
        expect(composerModel.focus).toHaveBeenCalled();
    });

    it('moves focus to the reply on Allow or Deny, as the approval goes', () => {
        const host: ChatMessageListHost = {
            messages: [
                new ChatMessage({
                    id: 'a1',
                    role: 'assistant',
                    status: 'paused',
                    parts: [
                        {
                            type: 'toolCall',
                            id: 'c1',
                            toolName: 'insert_rows',
                            state: 'approval-requested',
                            inputText: '{}',
                            input: {},
                            output: null,
                            errorText: null
                        }
                    ]
                })
            ],
            isBusy: false,
            approveToolCallAsync: vi.fn(() => Promise.resolve()),
            denyToolCallAsync: vi.fn(() => Promise.resolve())
        };
        render(appContext({item: chatMessageList({host})}));

        const allow = screen.getByRole('button', {name: 'Allow'});
        act(() => allow.focus());
        fireEvent.click(allow);
        expect(host.approveToolCallAsync).toHaveBeenCalledWith('c1', undefined);
        expect(document.activeElement).toBe(document.querySelector('.xh-chat-message--assistant'));
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

class AppStandInModel extends HoistModel {}

const appContext = hoistCmp.factory({
    displayName: 'TestAppContext',
    model: creates(AppStandInModel),
    render: ({children}) => fragment(children)
});
