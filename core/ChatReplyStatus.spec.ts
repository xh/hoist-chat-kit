import {afterEach, describe, expect, it} from 'vitest';
import type {ChatEvent} from '../transport';
import {ChatKit} from './ChatKit';
import {ChatMessage, type ChatMessageSpec} from './ChatMessage';
import type {ChatPart, ChatToolCallState} from './ChatPart';
import {
    type ChatReplyStatus,
    type ChatReplyStatusSpec,
    getChatReplyStatus,
    getChatRetryWaitMs
} from './ChatReplyStatus';
import {ChatStreamReducer} from './ChatStreamReducer';

/**
 * The display status of a reply, read against the status vocabulary of the design's P6 matrix.
 * Components show one icon, label and color per status, so each reading of message state, turn
 * activity and the clock must land on exactly one of the 13 values.
 */
describe('getChatReplyStatus', () => {
    const NOW = 1_000_000;

    afterEach(() => {
        ChatKit.defaults.stallAfterMs = 30_000;
    });

    const cases: Array<[string, ChatReplyStatus, Partial<ChatReplyStatusSpec>]> = [
        ['a finished reply is idle', 'idle', {message: reply({status: 'complete'})}],
        [
            'a reply with no content yet is submitted',
            'submitted',
            {message: reply({status: 'pending'}), lastActivityAt: NOW}
        ],
        [
            'a reply that is reasoning is submitted',
            'submitted',
            {message: reply({status: 'streaming', parts: [reasoning()]}), lastActivityAt: NOW}
        ],
        [
            'a reply starting its next step after a tool is submitted',
            'submitted',
            {message: reply({status: 'streaming', parts: [call('output-available')]})}
        ],
        [
            'a reply whose text arrives is streaming',
            'streaming',
            {message: reply({status: 'streaming', parts: [text()]}), lastActivityAt: NOW - 1000}
        ],
        [
            'a reply whose text is rewritten is recomposing',
            'recomposing',
            {
                message: reply({
                    status: 'streaming',
                    parts: [{...text(), revising: true} as ChatPart]
                })
            }
        ],
        [
            'a reply with a tool call in progress is running a tool',
            'runningTool',
            {message: reply({status: 'streaming', parts: [text(), call('running')]})}
        ],
        [
            'a reply whose tool call input streams is running a tool',
            'runningTool',
            {message: reply({status: 'streaming', parts: [call('input-streaming')]})}
        ],
        [
            'a turn waiting for the user is paused',
            'paused',
            {message: reply({status: 'paused', parts: [call('approval-requested')]})}
        ],
        [
            'a failure with a wait still running is waiting to retry',
            'waitingToRetry',
            {
                message: reply({
                    status: 'error',
                    createdAt: NOW - 5000,
                    metadata: {elapsedMs: 1000, retryAfterSeconds: 42}
                })
            }
        ],
        [
            'a reply left running on the server is detached',
            'detached',
            {message: reply({status: 'aborted', metadata: {detached: true}})}
        ],
        [
            'a reply with no data for the stall time is stalled',
            'stalled',
            {message: reply({status: 'streaming', parts: [text()]}), lastActivityAt: NOW - 30_000}
        ],
        [
            'a run the server interrupted is interrupted',
            'interrupted',
            {message: reply({status: 'error', metadata: {errorCode: 'interrupted'}})}
        ],
        [
            'a run the server cancelled is cancelled by the server',
            'cancelledByServer',
            {message: reply({status: 'error', metadata: {errorCode: 'cancelled'}})}
        ],
        [
            'any other failure is an error',
            'error',
            {message: reply({status: 'error', metadata: {errorCode: 'overloaded_error'}})}
        ],
        ['a reply the user stopped is aborted', 'aborted', {message: reply({status: 'aborted'})}]
    ];

    it.each(cases)('%s', (_, expected, spec) => {
        expect(getChatReplyStatus({now: NOW, ...spec} as ChatReplyStatusSpec)).toBe(expected);
    });

    it('covers every status of the vocabulary', () => {
        const covered = new Set(cases.map(([, status]) => status));
        expect([...covered].sort()).toEqual(
            [
                'idle',
                'submitted',
                'streaming',
                'recomposing',
                'runningTool',
                'paused',
                'waitingToRetry',
                'detached',
                'stalled',
                'interrupted',
                'cancelledByServer',
                'error',
                'aborted'
            ].sort()
        );
    });

    describe('stalled', () => {
        const streaming = reply({status: 'streaming', parts: [text()]});

        it('starts once the stall time passes with no data', () => {
            const status = (lastActivityAt: number) =>
                getChatReplyStatus({message: streaming, lastActivityAt, now: NOW});
            expect(status(NOW - 29_999)).toBe('streaming');
            expect(status(NOW - 30_000)).toBe('stalled');
        });

        it('wins over a tool call in progress, whose spinner it replaces', () => {
            const message = reply({status: 'streaming', parts: [call('running')]});
            expect(getChatReplyStatus({message, lastActivityAt: NOW - 60_000, now: NOW})).toBe(
                'stalled'
            );
        });

        it('never applies while no step is in flight, such as while a client tool runs', () => {
            const message = reply({status: 'streaming', parts: [call('running')]});
            expect(getChatReplyStatus({message, lastActivityAt: null, now: NOW})).toBe(
                'runningTool'
            );
        });

        it('never applies to a reply that has ended or paused', () => {
            const paused = reply({status: 'paused', parts: [call('approval-requested')]});
            expect(getChatReplyStatus({message: paused, lastActivityAt: 0, now: NOW})).toBe(
                'paused'
            );
        });

        it('reads its threshold from the spec, else from ChatKit.defaults', () => {
            const spec = {message: streaming, lastActivityAt: NOW - 10_000, now: NOW};
            expect(getChatReplyStatus({...spec, stallAfterMs: 5000})).toBe('stalled');

            expect(getChatReplyStatus(spec)).toBe('streaming');
            ChatKit.defaults.stallAfterMs = 10_000;
            expect(getChatReplyStatus(spec)).toBe('stalled');
        });
    });

    describe('waiting to retry', () => {
        const failed = reply({
            status: 'error',
            createdAt: NOW,
            metadata: {elapsedMs: 2000, retryAfterSeconds: 10}
        });

        it('runs from the end of the failed turn, then reads as an error', () => {
            expect(getChatRetryWaitMs(failed, NOW + 2000)).toBe(10_000);
            expect(getChatRetryWaitMs(failed, NOW + 11_500)).toBe(500);
            expect(getChatReplyStatus({message: failed, now: NOW + 11_999})).toBe('waitingToRetry');
            expect(getChatReplyStatus({message: failed, now: NOW + 12_000})).toBe('error');
            expect(getChatRetryWaitMs(failed, NOW + 12_000)).toBeNull();
        });

        it('runs from when the turn ended, after any time paused for the user', () => {
            const pausedLong = reply({
                status: 'error',
                createdAt: NOW,
                metadata: {elapsedMs: 2000, endedAt: NOW + 60_000, retryAfterSeconds: 10}
            });
            expect(getChatRetryWaitMs(pausedLong, NOW + 65_000)).toBe(5000);
            expect(getChatReplyStatus({message: pausedLong, now: NOW + 65_000})).toBe(
                'waitingToRetry'
            );
        });

        it('never applies to a failure without a wait', () => {
            expect(getChatRetryWaitMs(reply({status: 'error'}), NOW)).toBeNull();
        });
    });

    describe('recomposing', () => {
        const reducer = () => new ChatStreamReducer(0),
            pending = () => new ChatMessage({role: 'assistant', status: 'pending'}),
            status = (message: ChatMessage) => getChatReplyStatus({message, now: NOW});

        it('starts when the server replaces the streaming text with shorter text', () => {
            const message = reducer().apply(pending(), [
                chunk('HY Credit is over its limit by 4%.'),
                replace('HY Credit')
            ]);

            expect(message.text).toBe('HY Credit');
            expect(message.parts[0]).toMatchObject({revising: true});
            expect(status(message)).toBe('recomposing');
        });

        it('ends once the new text is as long as the text it replaced', () => {
            const stream = reducer();
            let message = stream.apply(pending(), [chunk('A first try'), replace('')]);
            expect(status(message)).toBe('recomposing');

            message = stream.apply(message, [chunk('The answer')]);
            expect(status(message)).toBe('recomposing');

            message = stream.apply(message, [chunk('.')]);
            expect(message.parts[0]).not.toHaveProperty('revising');
            expect(status(message)).toBe('streaming');
        });

        it('ends when the text part ends', () => {
            const stream = reducer();
            let message = stream.apply(pending(), [
                {type: 'TEXT_MESSAGE_START', messageId: 'm1', role: 'assistant'},
                {type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'A long first try'},
                replace('Short')
            ]);
            message = stream.apply(message, [{type: 'TEXT_MESSAGE_END', messageId: 'm1'}]);

            expect(message.parts[0]).not.toHaveProperty('revising');
            expect(status(message)).toBe('streaming');
        });

        it('never starts for a replace that is as long, or for text that has ended', () => {
            const longer = reducer().apply(pending(), [chunk('Draft'), replace('Final text')]),
                ended = reducer().apply(pending(), [
                    {type: 'TEXT_MESSAGE_START', messageId: 'm1', role: 'assistant'},
                    {type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'Streamed [1].'},
                    {type: 'TEXT_MESSAGE_END', messageId: 'm1'},
                    replace('Final.')
                ]);

            expect(status(longer)).toBe('streaming');
            expect(status(ended)).toBe('streaming');
        });
    });

    it('reads a message that is not from the assistant as idle', () => {
        const message = new ChatMessage({role: 'user', content: 'Hi', status: 'pending'});
        expect(getChatReplyStatus({message, now: NOW})).toBe('idle');
    });
});

//------------------
// Helpers
//------------------
function chunk(delta: string): ChatEvent {
    return {type: 'TEXT_MESSAGE_CHUNK', delta};
}

function replace(text: string): ChatEvent {
    return {type: 'CUSTOM', name: 'xh.chat.textReplace', value: {text}};
}

function reply(spec: Partial<ChatMessageSpec>): ChatMessage {
    return new ChatMessage({id: 'a1', role: 'assistant', parts: [], ...spec});
}

function text(): ChatPart {
    return {type: 'text', id: 't1', text: 'HY Credit is', state: 'streaming', step: 0};
}

function reasoning(): ChatPart {
    return {
        type: 'reasoning',
        id: 'r1',
        text: 'Checking limits',
        state: 'streaming',
        startedAt: 0,
        endedAt: null,
        step: 0
    };
}

function call(state: ChatToolCallState): ChatPart {
    return {
        type: 'toolCall',
        id: 'c1',
        toolName: 'query',
        state,
        step: 0,
        inputText: '{}',
        input: {},
        output: null,
        errorText: null
    };
}
