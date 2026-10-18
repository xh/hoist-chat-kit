import {act, fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import {fragment} from '@xh/hoist/cmp/layout';
import {creates, hoistCmp, HoistModel} from '@xh/hoist/core';
import {initTestAppAsync} from '@xh/hoist/test-support';
import {beforeAll, beforeEach, describe, expect, it, onTestFinished, vi} from 'vitest';
import {ChatModel} from '../../../core';
import {
    type ChatEvent,
    interruptEvents,
    ScriptedChatTransport,
    textEvents,
    toolCallEvents
} from '../../../transport';
import {chatMessageList} from './ChatMessageList';

/**
 * The questions a server agent asks through AG-UI interrupts, as the user sees them. Users rely
 * on a lone choice answering in one click, on several questions ending in a review they can
 * change, on Decline always being there, and on an answered question staying in the transcript.
 */
describe('ChatInterrupts', () => {
    beforeAll(() => initTestAppAsync());

    beforeEach(() => {
        vi.stubGlobal('ResizeObserver', NoopResizeObserver);
        Element.prototype.scrollTo ??= () => {};
    });

    it('answers a lone choice in one click, and keeps the answer as a line', async () => {
        const {chatModel, transport} = await askAsync([
            {
                id: 'q1',
                reason: 'input_required',
                message: 'How often?',
                responseSchema: {
                    type: 'object',
                    properties: {
                        cadence: {
                            oneOf: [
                                {const: 'daily', title: 'Daily', description: 'Every morning'},
                                {const: 'weekly', title: 'Weekly'}
                            ]
                        }
                    }
                }
            }
        ]);
        const panel = screen.getByRole('group', {name: 'Question'});
        expect(within(panel).getByText('How often?')).toBeTruthy();
        expect(within(panel).getByText('Every morning')).toBeTruthy();

        fireEvent.click(within(panel).getByRole('button', {name: /Weekly/}));

        await waitFor(() => expect(chatModel.lastMessage.status).toBe('complete'));
        expect(transport.requests[1].resume).toEqual([
            {interruptId: 'q1', status: 'resolved', payload: {cadence: 'weekly'}}
        ]);
        expect(screen.queryByRole('group', {name: 'Question'})).toBeNull();
        expect(document.querySelector('.xh-chat-interrupts__record').textContent).toContain(
            'How often?Weekly'
        );
    });

    it('sends a text answer, and declines with Decline', async () => {
        const {transport} = await askAsync([{id: 'q1', reason: 'input_required', message: 'Why?'}]);

        fireEvent.change(screen.getByRole('textbox', {name: 'Your answer'}), {
            target: {value: 'Budget'}
        });
        fireEvent.click(screen.getByRole('button', {name: 'Send'}));
        await waitFor(() => expect(transport.requests).toHaveLength(2));
        expect(transport.requests[1].resume).toEqual([
            {interruptId: 'q1', status: 'resolved', payload: 'Budget'}
        ]);

        const second = await askAsync([{id: 'q2', reason: 'input_required', message: 'Why?'}]);
        fireEvent.click(screen.getAllByRole('button', {name: 'Decline'}).at(-1));
        await waitFor(() => expect(second.transport.requests).toHaveLength(2));
        expect(second.transport.requests[1].resume).toEqual([
            {interruptId: 'q2', status: 'cancelled'}
        ]);
    });

    it('steps through several questions, then submits from a review the user can change', async () => {
        const {transport} = await askAsync([
            {
                id: 'q1',
                reason: 'input_required',
                message: 'Ready?',
                responseSchema: {type: 'boolean'}
            },
            {
                id: 'q2',
                reason: 'input_required',
                message: 'Region?',
                responseSchema: {type: 'string', enum: ['EU', 'US']}
            }
        ]);
        const panel = () => screen.getByRole('group', {name: 'Questions'});
        expect(within(panel()).getByText('1 of 2')).toBeTruthy();

        fireEvent.click(within(panel()).getByRole('button', {name: /Yes/}));
        expect(within(panel()).getByText('2 of 2')).toBeTruthy();
        fireEvent.click(within(panel()).getByRole('button', {name: /EU/}));

        expect(within(panel()).getByText('Review')).toBeTruthy();
        expect(transport.requests).toHaveLength(1);
        fireEvent.click(within(panel()).getAllByRole('button', {name: 'Change'})[1]);
        fireEvent.click(within(panel()).getByRole('button', {name: /US/}));
        fireEvent.click(within(panel()).getByRole('button', {name: 'Submit'}));

        await waitFor(() => expect(transport.requests).toHaveLength(2));
        expect(transport.requests[1].resume).toEqual([
            {interruptId: 'q1', status: 'resolved', payload: true},
            {interruptId: 'q2', status: 'resolved', payload: 'US'}
        ]);
    });

    it('builds a form for simple fields, and sends a date as YYYY-MM-DD', async () => {
        const {transport} = await askAsync([
            {
                id: 'q1',
                reason: 'input_required',
                message: 'When and how many?',
                responseSchema: {
                    type: 'object',
                    properties: {
                        start: {type: 'string', format: 'date', default: '2026-11-02'},
                        count: {type: 'integer', title: 'Count', minimum: 1},
                        note: {type: 'string'}
                    },
                    required: ['count']
                }
            }
        ]);

        fireEvent.click(screen.getByRole('button', {name: 'Send'}));
        await waitFor(() => expect(screen.getByText(/Count is required/)).toBeTruthy());
        expect(transport.requests).toHaveLength(1);

        const count = document.querySelector<HTMLInputElement>('.xh-number-input input');
        fireEvent.focus(count);
        fireEvent.change(count, {target: {value: '4'}});
        fireEvent.blur(count);
        fireEvent.click(screen.getByRole('button', {name: 'Send'}));

        await waitFor(() => expect(transport.requests).toHaveLength(2));
        expect(transport.requests[1].resume).toEqual([
            {interruptId: 'q1', status: 'resolved', payload: {start: '2026-11-02', count: 4}}
        ]);
    });

    it('offers only Decline for a schema it cannot render', async () => {
        await askAsync([
            {
                id: 'q1',
                reason: 'input_required',
                message: 'Address?',
                responseSchema: {type: 'object', properties: {street: {type: 'object'}}}
            }
        ]);
        expect(screen.getByText('This question cannot be answered here.')).toBeTruthy();
        expect(screen.queryByRole('button', {name: 'Send'})).toBeNull();
        expect(screen.getByRole('button', {name: 'Decline'})).toBeTruthy();
    });

    it('asks to approve a server call in the agent words, on the call', async () => {
        const {transport} = await askAsync(
            [{id: 'a1', reason: 'tool_call', toolCallId: 's1', message: 'Send $50 to Bob?'}],
            toolCallEvents('transfer_funds', {amount: 50}, {toolCallId: 's1'})
        );
        expect(screen.getByText('Send $50 to Bob?')).toBeTruthy();
        expect(screen.queryByRole('group', {name: 'Question'})).toBeNull();

        await act(() => fireEvent.click(screen.getByRole('button', {name: 'Allow'})));

        await waitFor(() => expect(transport.requests).toHaveLength(2));
        expect(transport.requests[1].resume).toEqual([
            {interruptId: 'a1', status: 'resolved', payload: {approved: true}}
        ]);
    });
});

//------------------
// Helpers
//------------------
type PlainInterrupt = Parameters<typeof interruptEvents>[0][number];

/** Send a message that the agent answers with these interrupts, and render the chat. */
async function askAsync(interrupts: PlainInterrupt[], before: ChatEvent[] = []) {
    const transport = new ScriptedChatTransport({
            responses: [[...before, ...interruptEvents(interrupts)], textEvents('Thanks.')],
            delayMs: 0
        }),
        chatModel = new ChatModel({transport});
    onTestFinished(() => chatModel.destroy());

    await chatModel.sendAsync('Help me');
    render(appContext({item: chatMessageList({model: chatModel})}));
    return {chatModel, transport};
}

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
