import {act, fireEvent, render, screen} from '@testing-library/react';
import {fragment} from '@xh/hoist/cmp/layout';
import {creates, hoistCmp, HoistModel} from '@xh/hoist/core';
import {initTestAppAsync} from '@xh/hoist/test-support';
import {runInAction} from '@xh/hoist/mobx';
import {beforeAll, beforeEach, describe, expect, it, onTestFinished, vi} from 'vitest';
import {
    ChatKit,
    ChatMessage,
    type ChatMessageSpec,
    ChatModel,
    type ChatModelConfig,
    type ChatToolCallPart
} from '../../../core';
import {ScriptedChatTransport} from '../../../transport';
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
        const chatModel = createChat();
        renderList(chatModel);

        const bar = document.querySelector('.xh-chat-tool-call__approval-bar'),
            labels = Array.from(bar.querySelectorAll('button')).map(it => it.textContent);
        expect(labels).toEqual(['Allow', 'Deny']);
        expect(document.querySelector('.xh-chat-tool-call--attention')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', {name: 'Allow'}));
        expect(chatModel.approveToolCallAsync).toHaveBeenCalledWith('c1', undefined);

        typeReason('Only Ops clears the log');
        fireEvent.click(screen.getByRole('button', {name: 'Deny'}));
        expect(chatModel.denyToolCallAsync).toHaveBeenCalledWith('c1', 'Only Ops clears the log');

        typeReason('  Checked the rows  ');
        fireEvent.click(screen.getByRole('button', {name: 'Allow'}));
        expect(chatModel.approveToolCallAsync).toHaveBeenLastCalledWith('c1', 'Checked the rows');
    });

    it('decides nothing on Enter in the reason, nor on any shortcut', () => {
        const chatModel = createChat();
        renderList(chatModel);

        const reason = screen.getByRole('textbox', {name: 'Reason, sent to the agent'});
        fireEvent.keyDown(reason, {key: 'Enter'});

        const log = screen.getByRole('log');
        for (const combo of Object.values(ChatKit.defaults.shortcuts)) {
            if (combo) fireEvent.keyDown(log, keyEventFor(combo));
        }
        fireEvent.keyDown(log, {key: 'Enter'});

        expect(chatModel.approveToolCallAsync).not.toHaveBeenCalled();
        expect(chatModel.denyToolCallAsync).not.toHaveBeenCalled();
    });

    it('takes focus to Allow only from the conversation, with the composer empty', () => {
        const chatModel = createChat({}, []);
        renderList(chatModel);
        const log = screen.getByRole('log');
        log.tabIndex = -1;
        log.focus();

        act(() =>
            runInAction(() => {
                chatModel.messages = [new ChatMessage(approvalReply())];
            })
        );
        expect(document.activeElement).toBe(screen.getByRole('button', {name: 'Allow'}));
    });

    it('leaves focus alone while the user types in the composer', () => {
        const chatModel = createChat();
        runInAction(() => {
            chatModel.composerModel.text = 'Half a question';
        });
        const outside = document.createElement('input');
        document.body.appendChild(outside);
        outside.focus();

        renderList(chatModel);

        expect(document.activeElement).toBe(outside);
        outside.remove();
    });
});

/**
 * The display modes a tool can choose besides the default row (D23). Apps rely on an answer tool
 * showing its result as the answer, and on a hidden tool staying out of sight unless it needs the
 * user.
 */
describe('ChatToolCall display modes', () => {
    beforeAll(() => initTestAppAsync());

    beforeEach(() => {
        vi.stubGlobal('ResizeObserver', NoopResizeObserver);
        Element.prototype.scrollTo ??= () => {};
    });

    it('shows the output of an answer tool as the answer, with no row', () => {
        const chatModel = createChat({tools: [{name: 'final_answer', display: 'answer'}]}, [
            reply(toolCall('final_answer', {output: 'HY Credit is **over** its limit.'}))
        ]);
        const {container} = renderList(chatModel);

        const answer = container.querySelector('.xh-chat-tool-call__answer');
        expect(answer.textContent).toBe('HY Credit is over its limit.');
        expect(answer.querySelector('strong')).toBeTruthy();
        expect(container.querySelector('.xh-chat-tool-call__header')).toBeNull();
    });

    it('shows nothing for a hidden tool, until a call waits for approval', () => {
        const tools = [
                {name: 'log_event', display: 'hidden' as const},
                {name: 'insert_rows', display: 'hidden' as const}
            ],
            {container, unmount} = renderList(createChat({tools}, [reply(toolCall('log_event'))]));
        expect(container.querySelector('.xh-chat-tool-call')).toBeNull();
        unmount();

        renderList(createChat({tools}));
        expect(screen.getByRole('button', {name: 'Allow'})).toBeTruthy();
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

function toolCall(toolName: string, rest: Partial<ChatToolCallPart> = {}): ChatToolCallPart {
    return {
        type: 'toolCall',
        id: 'c1',
        toolName,
        state: 'output-available',
        step: 0,
        inputText: '{}',
        input: {},
        output: 'ok',
        errorText: null,
        ...rest
    };
}

function reply(part: ChatToolCallPart): ChatMessageSpec {
    return {id: 'a1', role: 'assistant', status: 'complete', parts: [part]};
}

function approvalReply(): ChatMessageSpec {
    return {id: 'a1', role: 'assistant', status: 'paused', parts: [approvalCall()]};
}

// A chat whose decisions on calls are spied on, and decide nothing.
function createChat(
    config: Partial<ChatModelConfig> = {},
    initialMessages: ChatMessageSpec[] = [approvalReply()]
): ChatModel {
    const chatModel = new ChatModel({
        transport: new ScriptedChatTransport(),
        initialMessages,
        ...config
    });
    onTestFinished(() => chatModel.destroy());
    vi.spyOn(chatModel, 'approveToolCallAsync').mockResolvedValue();
    vi.spyOn(chatModel, 'denyToolCallAsync').mockResolvedValue();
    return chatModel;
}

function renderList(chatModel: ChatModel) {
    return render(appContext({item: chatMessageList({model: chatModel})}));
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
