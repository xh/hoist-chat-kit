import {describe, expect, it} from 'vitest';
import {ChatMessage} from './ChatMessage';
import {type ChatToolCallPart, isToolCallFinal} from './ChatPart';

/**
 * ChatMessage, the immutable record behind every message in a chat. Apps build messages from
 * stored specs, and save them back with `toSpec()`, so construction defaults and the round trip
 * through JSON must hold exactly.
 */
describe('ChatMessage', () => {
    describe('constructor', () => {
        it('fills in an id, status, timestamp and metadata', () => {
            const message = new ChatMessage({role: 'user', content: 'Hi'});

            expect(message.id).toBeTruthy();
            expect(message.status).toBe('complete');
            expect(message.createdAt).toBeTypeOf('number');
            expect(message.error).toBeNull();
            expect(message.metadata).toEqual({});
        });

        it('expands `content` into a single text part', () => {
            const message = new ChatMessage({role: 'user', content: 'Hello'});
            expect(message.parts).toMatchObject([{type: 'text', text: 'Hello', state: 'done'}]);
        });

        it('uses `parts` in preference to `content`', () => {
            const message = new ChatMessage({
                role: 'assistant',
                content: 'ignored',
                parts: [{type: 'text', id: 'p1', text: 'kept', state: 'done'}]
            });
            expect(message.text).toBe('kept');
        });
    });

    describe('getters', () => {
        it('joins text parts with blank lines, and lists tool calls in order', () => {
            const message = new ChatMessage({
                role: 'assistant',
                parts: [
                    {type: 'text', id: 't1', text: 'Checking.', state: 'done'},
                    toolCall('c1'),
                    {type: 'text', id: 't2', text: 'Done.', state: 'done'},
                    toolCall('c2')
                ]
            });

            expect(message.text).toBe('Checking.\n\nDone.');
            expect(message.toolCalls.map(it => it.id)).toEqual(['c1', 'c2']);
        });

        it('reports a pending or streaming message as streaming', () => {
            expect(new ChatMessage({role: 'assistant', status: 'pending'}).isStreaming).toBe(true);
            expect(new ChatMessage({role: 'assistant', status: 'streaming'}).isStreaming).toBe(
                true
            );
            expect(new ChatMessage({role: 'assistant', status: 'aborted'}).isStreaming).toBe(false);
        });
    });

    describe('withChanges', () => {
        it('returns a new message with the changes, leaving the original as it was', () => {
            const original = new ChatMessage({role: 'assistant', status: 'pending'}),
                changed = original.withChanges({status: 'complete', metadata: {elapsedMs: 5}});

            expect(changed).not.toBe(original);
            expect(changed.id).toBe(original.id);
            expect(changed.createdAt).toBe(original.createdAt);
            expect(changed.status).toBe('complete');
            expect(changed.metadata).toEqual({elapsedMs: 5});
            expect(original.status).toBe('pending');
        });
    });

    describe('toSpec', () => {
        it('round-trips through JSON to an equal message', () => {
            const original = new ChatMessage({
                    role: 'assistant',
                    parts: [
                        {type: 'text', id: 't1', text: 'See chart.', state: 'done'},
                        toolCall('c1'),
                        {type: 'file', id: 'f1', name: 'a.png', mediaType: 'image/png', data: 'AA'}
                    ],
                    metadata: {elapsedMs: 1200, finishReason: 'end_turn'}
                }),
                restored = new ChatMessage(JSON.parse(JSON.stringify(original.toSpec())));

            expect(restored).toEqual(original);
        });
    });
});

describe('isToolCallFinal', () => {
    it.each([
        ['input-streaming', false],
        ['input-available', false],
        ['approval-requested', false],
        ['running', false],
        ['output-available', true],
        ['output-error', true],
        ['output-denied', true]
    ] as const)('reports %s as final: %s', (state, expected) => {
        expect(isToolCallFinal({...toolCall('c1'), state})).toBe(expected);
    });
});

//------------------
// Helpers
//------------------
function toolCall(id: string): ChatToolCallPart {
    return {
        type: 'toolCall',
        id,
        toolName: 'lookup',
        state: 'output-available',
        inputText: '{}',
        input: {},
        output: 'ok',
        errorText: null
    };
}
