import {act, fireEvent, render, screen} from '@testing-library/react';
import {fragment} from '@xh/hoist/cmp/layout';
import {creates, hoistCmp, HoistModel} from '@xh/hoist/core';
import {initTestAppAsync} from '@xh/hoist/test-support';
import {beforeAll, beforeEach, describe, expect, it, vi} from 'vitest';
import {ChatMessage, type ChatMessageListHost, type ChatToolCallPart, ChatKit} from '../../../core';
import {chatMessageList} from './ChatMessageList';

/**
 * The approval a tool call waits for. Users rely on Allow and Deny saying what happens, on a
 * reason reaching the agent with either decision, and on a request never taking the keyboard
 * from someone typing. No key ever allows a call by itself.
 */
describe('ChatToolCall approval', () => {
    beforeAll(() => initTestAppAsync());

    beforeEach(() => {
        vi.stubGlobal('ResizeObserver', NoopResizeObserver);
        Element.prototype.scrollTo ??= () => {};
    });

    it('offers Allow first, then Deny, with an optional reason sent with either', () => {
        const host = createHost();
        renderList(host);

        const bar = document.querySelector('.xh-chat-tool-call__approval-bar'),
            labels = Array.from(bar.querySelectorAll('button')).map(it => it.textContent);
        expect(labels).toEqual(['Allow', 'Deny']);
        expect(document.querySelector('.xh-chat-tool-call--attention')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', {name: 'Allow'}));
        expect(host.approveToolCallAsync).toHaveBeenCalledWith('c1', undefined);

        typeReason('Only Ops clears the log');
        fireEvent.click(screen.getByRole('button', {name: 'Deny'}));
        expect(host.denyToolCallAsync).toHaveBeenCalledWith('c1', 'Only Ops clears the log');

        typeReason('  Checked the rows  ');
        fireEvent.click(screen.getByRole('button', {name: 'Allow'}));
        expect(host.approveToolCallAsync).toHaveBeenLastCalledWith('c1', 'Checked the rows');
    });

    it('decides nothing on Enter in the reason, nor on any shortcut', () => {
        const host = createHost();
        renderList(host);

        const reason = screen.getByRole('textbox', {name: 'Reason, sent to the agent'});
        fireEvent.keyDown(reason, {key: 'Enter'});

        const log = screen.getByRole('log');
        for (const combo of Object.values(ChatKit.defaults.shortcuts)) {
            if (combo) fireEvent.keyDown(log, keyEventFor(combo));
        }
        fireEvent.keyDown(log, {key: 'Enter'});

        expect(host.approveToolCallAsync).not.toHaveBeenCalled();
        expect(host.denyToolCallAsync).not.toHaveBeenCalled();
    });

    it('takes focus to Allow only from the conversation, with the composer empty', () => {
        const pending = createHost({messages: []}),
            {rerender} = renderList(pending);
        const log = screen.getByRole('log');
        log.tabIndex = -1;
        log.focus();

        act(() => {
            pending.messages = [approvalReply()];
        });
        rerender(appContext({item: chatMessageList({host: {...pending}})}));
        expect(document.activeElement).toBe(screen.getByRole('button', {name: 'Allow'}));
    });

    it('leaves focus alone while the user types in the composer', () => {
        const host = createHost({composerModel: {focus: () => {}, text: 'Half a question'}});
        const outside = document.createElement('input');
        document.body.appendChild(outside);
        outside.focus();

        renderList(host);

        expect(document.activeElement).toBe(outside);
        outside.remove();
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

function approvalCall(): ChatToolCallPart {
    return {
        type: 'toolCall',
        id: 'c1',
        toolName: 'insert_rows',
        state: 'approval-requested',
        step: 0,
        inputText: '{"table":"risk_notes"}',
        input: {table: 'risk_notes'},
        output: null,
        errorText: null
    };
}

function approvalReply(): ChatMessage {
    return new ChatMessage({
        id: 'a1',
        role: 'assistant',
        status: 'paused',
        parts: [approvalCall()]
    });
}

function createHost(rest: Partial<ChatMessageListHost> = {}): ChatMessageListHost & {
    messages: ChatMessage[];
} {
    return {
        messages: [approvalReply()],
        isBusy: false,
        approveToolCallAsync: vi.fn(() => Promise.resolve()),
        denyToolCallAsync: vi.fn(() => Promise.resolve()),
        ...rest
    } as any;
}

function renderList(host: ChatMessageListHost) {
    return render(appContext({item: chatMessageList({host})}));
}

function typeReason(value: string) {
    fireEvent.change(screen.getByRole('textbox', {name: 'Reason, sent to the agent'}), {
        target: {value}
    });
}

// A keydown for a combo such as `mod+shift+o`, as a user's keyboard sends it.
function keyEventFor(combo: string): KeyboardEventInit {
    const parts = combo.split('+'),
        key = parts.pop();
    return {
        key: key.length === 1 ? key : key.toUpperCase(),
        ctrlKey: parts.includes('mod') || parts.includes('ctrl'),
        shiftKey: parts.includes('shift'),
        altKey: parts.includes('alt')
    };
}
