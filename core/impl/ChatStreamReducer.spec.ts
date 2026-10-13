import {describe, expect, it, vi} from 'vitest';
import type {ChatEvent} from '../../transport';
import {ChatMessage} from '../ChatMessage';
import type {
    ChatDataPart,
    ChatFilePart,
    ChatReasoningPart,
    ChatSourcePart,
    ChatTextPart,
    ChatToolCallPart
} from '../ChatPart';
import {ChatStreamReducer} from './ChatStreamReducer';

/**
 * ChatStreamReducer turns the AG-UI events of each model call into the parts of the assistant
 * message. Every transport and codec feeds it, so it must apply each supported event exactly,
 * tolerate events out of the ideal order, and ignore what it does not know. Its output must also
 * keep unchanged parts by identity, which lets memoized components skip re-rendering them.
 */
describe('ChatStreamReducer', () => {
    describe('run events', () => {
        it('records usage and the finish reason from RUN_FINISHED', () => {
            const message = reduce([
                {type: 'RUN_STARTED', threadId: 't', runId: 'r'},
                {
                    type: 'RUN_FINISHED',
                    threadId: 't',
                    runId: 'r',
                    usage: [{inputTokens: 10, outputTokens: 20}],
                    metadata: {finishReason: 'stop', model: 'claude'}
                }
            ]);

            expect(message.metadata).toEqual({
                finishReason: 'stop',
                model: 'claude',
                usage: [{inputTokens: 10, outputTokens: 20}]
            });
        });

        it.each([
            ['success', 'stop'],
            ['interrupt', 'other'],
            ['cancelled', 'other']
        ] as const)('maps outcome %s to finish reason %s when none is given', (type, reason) => {
            const message = reduce([
                {type: 'RUN_FINISHED', threadId: 't', runId: 'r', outcome: {type}}
            ]);
            expect(message.metadata.finishReason).toBe(reason);
        });

        it('appends the usage of each step to that of earlier steps', () => {
            const first = reduce([
                    {type: 'RUN_FINISHED', threadId: 't', runId: 'r1', usage: [{inputTokens: 1}]}
                ]),
                second = new ChatStreamReducer(1).apply(first, [
                    {type: 'RUN_FINISHED', threadId: 't', runId: 'r2', usage: [{inputTokens: 2}]}
                ]);

            expect(second.metadata.usage).toEqual([{inputTokens: 1}, {inputTokens: 2}]);
        });

        it('marks the message failed on RUN_ERROR, recording its code', () => {
            const message = reduce([
                {type: 'RUN_ERROR', message: 'Rate limit exceeded', code: 'rate_limit_error'}
            ]);
            expect(message.status).toBe('error');
            expect(message.error).toBe('Rate limit exceeded');
            expect(message.metadata.errorCode).toBe('rate_limit_error');
        });

        it('leaves the message unchanged for lifecycle-only events', () => {
            const message = pendingMessage(),
                result = new ChatStreamReducer(0).apply(message, [
                    {type: 'RUN_STARTED', threadId: 't', runId: 'r'},
                    {type: 'STEP_STARTED', stepName: 'plan'},
                    {type: 'STEP_FINISHED', stepName: 'plan'}
                ]);
            expect(result).toBe(message);
        });
    });

    describe('text', () => {
        it('streams text into a part, and marks it done on TEXT_MESSAGE_END', () => {
            const reducer = new ChatStreamReducer(0);
            let message = reducer.apply(pendingMessage(), [
                {type: 'TEXT_MESSAGE_START', messageId: 'm1', role: 'assistant'},
                {type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'Hello, '},
                {type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'world'}
            ]);
            expect(message.status).toBe('streaming');
            expect(message.parts).toMatchObject([
                {type: 'text', text: 'Hello, world', state: 'streaming', step: 0}
            ]);

            message = reducer.apply(message, [{type: 'TEXT_MESSAGE_END', messageId: 'm1'}]);
            expect(message.parts[0]).toMatchObject({state: 'done'});
        });

        it('opens a text part only on its first content', () => {
            const message = reduce([
                {type: 'TEXT_MESSAGE_START', messageId: 'm1'},
                {type: 'TEXT_MESSAGE_END', messageId: 'm1'}
            ]);
            expect(message.parts).toEqual([]);
            expect(message.status).toBe('pending');
        });

        it('keeps separate text messages in separate parts', () => {
            const message = reduce([
                ...text('m1', 'First.'),
                {type: 'TOOL_CALL_START', toolCallId: 'c1', toolCallName: 'lookup'},
                {type: 'TOOL_CALL_END', toolCallId: 'c1'},
                ...text('m2', 'Second.')
            ]);
            expect(message.parts.map(it => it.type)).toEqual(['text', 'toolCall', 'text']);
            expect(message.text).toBe('First.\n\nSecond.');
        });

        it('starts and extends text with TEXT_MESSAGE_CHUNK', () => {
            const message = reduce([
                {type: 'TEXT_MESSAGE_CHUNK', messageId: 'm1', role: 'assistant', delta: 'One '},
                {type: 'TEXT_MESSAGE_CHUNK', delta: 'two '},
                {type: 'TEXT_MESSAGE_CHUNK', messageId: 'm1', delta: 'three'}
            ]);
            expect(message.parts).toHaveLength(1);
            expect(message.text).toBe('One two three');
        });

        it('accepts content with no start event', () => {
            const message = reduce([{type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'Hi'}]);
            expect(message.text).toBe('Hi');
        });

        it('gives each step its own parts, even when a backend reuses message ids', () => {
            const first = reduce(text('m1', 'Step one.')),
                second = new ChatStreamReducer(1).apply(first, text('m1', 'Step two.'));

            expect(second.parts).toMatchObject([
                {text: 'Step one.', step: 0},
                {text: 'Step two.', step: 1}
            ]);
        });
    });

    describe('reasoning', () => {
        it('streams reasoning into a part with start and end times', () => {
            const reducer = new ChatStreamReducer(0);
            let message = reducer.apply(pendingMessage(), [
                {type: 'REASONING_START', messageId: 'r1'}
            ]);
            const opened = message.parts[0] as ChatReasoningPart;
            expect(opened).toMatchObject({type: 'reasoning', text: '', state: 'streaming'});
            expect(opened.startedAt).toBeTypeOf('number');
            expect(opened.endedAt).toBeNull();

            message = reducer.apply(message, [
                {type: 'REASONING_MESSAGE_START', messageId: 'r1', role: 'reasoning'},
                {type: 'REASONING_MESSAGE_CONTENT', messageId: 'r1', delta: 'Let me '},
                {type: 'REASONING_MESSAGE_CONTENT', messageId: 'r1', delta: 'think.'},
                {type: 'REASONING_MESSAGE_END', messageId: 'r1'},
                {type: 'REASONING_END', messageId: 'r1'}
            ]);
            const closed = message.parts[0] as ChatReasoningPart;
            expect(message.parts).toHaveLength(1);
            expect(closed).toMatchObject({text: 'Let me think.', state: 'done'});
            expect(closed.endedAt).toBeTypeOf('number');
        });

        it('puts a reasoning span and its first message in one part, when their ids differ', () => {
            const message = reduce([
                {type: 'REASONING_START', messageId: 'span'},
                {type: 'REASONING_MESSAGE_START', messageId: 'msg', role: 'reasoning'},
                {type: 'REASONING_MESSAGE_CONTENT', messageId: 'msg', delta: 'Thinking'},
                {type: 'REASONING_MESSAGE_END', messageId: 'msg'},
                {type: 'REASONING_END', messageId: 'span'}
            ]);
            expect(message.parts).toHaveLength(1);
            expect(message.parts[0]).toMatchObject({text: 'Thinking', state: 'done'});
        });

        it('starts and extends reasoning with REASONING_MESSAGE_CHUNK', () => {
            const message = reduce([
                {type: 'REASONING_MESSAGE_CHUNK', messageId: 'r1', delta: 'Hmm, '},
                {type: 'REASONING_MESSAGE_CHUNK', delta: 'yes.'}
            ]);
            expect(message.parts).toMatchObject([{type: 'reasoning', text: 'Hmm, yes.'}]);
        });

        it('stores an encrypted value on its reasoning part', () => {
            const message = reduce([
                ...reasoning('r1', 'Thinking'),
                {
                    type: 'REASONING_ENCRYPTED_VALUE',
                    subtype: 'message',
                    entityId: 'r1',
                    encryptedValue: 'sig-123'
                }
            ]);
            expect(message.parts[0]).toMatchObject({text: 'Thinking', encryptedValue: 'sig-123'});
        });

        it('keeps an encrypted value with no reasoning text in a part of its own', () => {
            // Redacted thinking must still go back to the provider with the history.
            const message = reduce([
                {
                    type: 'REASONING_ENCRYPTED_VALUE',
                    subtype: 'message',
                    entityId: 'r1',
                    encryptedValue: 'redacted'
                }
            ]);
            expect(message.parts).toMatchObject([
                {type: 'reasoning', text: '', state: 'done', encryptedValue: 'redacted'}
            ]);
        });

        it('merges provider data into a reasoning part, by provider key', () => {
            const message = reduce([
                ...reasoning('r1', 'Thinking'),
                custom('xh.chat.providerData', {
                    subtype: 'message',
                    entityId: 'r1',
                    data: {anthropic: {a: 1}, other: {b: 2}}
                }),
                custom('xh.chat.providerData', {
                    subtype: 'message',
                    entityId: 'r1',
                    data: {anthropic: {c: 3}}
                })
            ]);
            expect((message.parts[0] as ChatReasoningPart).providerData).toEqual({
                anthropic: {c: 3},
                other: {b: 2}
            });
        });

        it('keeps provider data with no reasoning text in a part of its own', () => {
            const message = reduce([
                custom('xh.chat.providerData', {
                    subtype: 'message',
                    entityId: 'r1',
                    data: {anthropic: {redactedData: 'abc'}}
                })
            ]);
            expect(message.parts).toMatchObject([
                {type: 'reasoning', text: '', providerData: {anthropic: {redactedData: 'abc'}}}
            ]);
        });

        it('stores an encrypted value for a tool call on its tool call part', () => {
            const message = reduce([
                {type: 'TOOL_CALL_START', toolCallId: 'c1', toolCallName: 'search'},
                {type: 'TOOL_CALL_END', toolCallId: 'c1'},
                {
                    type: 'REASONING_ENCRYPTED_VALUE',
                    subtype: 'tool-call',
                    entityId: 'c1',
                    encryptedValue: 'sig-456'
                }
            ]);
            expect(message.parts).toMatchObject([
                {type: 'toolCall', id: 'c1', encryptedValue: 'sig-456'}
            ]);
        });
    });

    describe('tool calls', () => {
        it('streams arguments with a best-effort parse into the input', () => {
            const message = reduce([
                {type: 'TOOL_CALL_START', toolCallId: 'c1', toolCallName: 'getWeather'},
                {type: 'TOOL_CALL_ARGS', toolCallId: 'c1', delta: '{"city": "New'},
                {type: 'TOOL_CALL_ARGS', toolCallId: 'c1', delta: ' Yo'}
            ]);
            expect(message.parts[0]).toMatchObject({
                type: 'toolCall',
                id: 'c1',
                toolName: 'getWeather',
                state: 'input-streaming',
                inputText: '{"city": "New Yo',
                input: {city: 'New Yo'},
                step: 0
            });
        });

        it('parses the complete input on TOOL_CALL_END', () => {
            const message = reduce(toolCall('c1', 'getWeather', '{"city": "Paris"}'));
            expect(message.parts[0]).toMatchObject({
                state: 'input-available',
                input: {city: 'Paris'}
            });
        });

        it('treats empty arguments as an empty input', () => {
            const message = reduce(toolCall('c1', 'toggleTheme', ''));
            expect(message.parts[0]).toMatchObject({state: 'input-available', input: {}});
        });

        it.each([
            ['malformed JSON', '{"city": '],
            ['a non-object', '["Paris"]']
        ])('fails a call whose arguments are %s', (_, args) => {
            const part = reduce(toolCall('c1', 'getWeather', args)).parts[0] as ChatToolCallPart;
            expect(part.state).toBe('output-error');
            expect(part.errorText).toMatch(/^Invalid tool input/);
        });

        it('starts and extends a call with TOOL_CALL_CHUNK', () => {
            const message = reduce([
                {type: 'TOOL_CALL_CHUNK', toolCallId: 'c1', toolCallName: 'search', delta: '{"q":'},
                {type: 'TOOL_CALL_CHUNK', delta: ' "hoist"}'},
                {type: 'TOOL_CALL_END', toolCallId: 'c1'}
            ]);
            expect(message.parts[0]).toMatchObject({
                toolName: 'search',
                state: 'input-available',
                input: {q: 'hoist'}
            });
        });

        it('records a backend result on TOOL_CALL_RESULT, parsing JSON content', () => {
            const message = reduce([
                ...toolCall('c1', 'webSearch', '{"q": "hoist"}'),
                {
                    type: 'TOOL_CALL_RESULT',
                    messageId: 'res1',
                    toolCallId: 'c1',
                    content: '{"hits": 3}'
                }
            ]);
            expect(message.parts[0]).toMatchObject({
                state: 'output-available',
                output: {hits: 3},
                providerExecuted: true
            });
        });

        it('keeps a non-JSON result as text', () => {
            const message = reduce([
                ...toolCall('c1', 'webSearch', '{}'),
                {type: 'TOOL_CALL_RESULT', messageId: 'res1', toolCallId: 'c1', content: 'Done.'}
            ]);
            expect((message.parts[0] as ChatToolCallPart).output).toBe('Done.');
        });

        it('marks a call as run by the backend on xh.chat.providerExecuted', () => {
            const message = reduce([
                {type: 'TOOL_CALL_START', toolCallId: 'c1', toolCallName: 'webSearch'},
                custom('xh.chat.providerExecuted', {toolCallId: 'c1'}),
                {type: 'TOOL_CALL_END', toolCallId: 'c1'}
            ]);
            expect(message.parts[0]).toMatchObject({
                state: 'input-available',
                providerExecuted: true
            });
        });

        it('stores provider data for a tool call on its part', () => {
            const message = reduce([
                ...toolCall('c1', 'webSearch', '{}'),
                custom('xh.chat.providerData', {
                    subtype: 'tool-call',
                    entityId: 'c1',
                    data: {anthropic: {resultBlock: {type: 'x'}}}
                })
            ]);
            expect(message.parts[0]).toMatchObject({
                providerData: {anthropic: {resultBlock: {type: 'x'}}}
            });
        });

        it('warns of, and ignores, a second call with an id already used in the turn', () => {
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {}),
                first = reduce(toolCall('c1', 'lookup', '{"id": 1}')),
                second = new ChatStreamReducer(1).apply(
                    first,
                    toolCall('c1', 'lookup', '{"id": 2}')
                );

            expect(second.toolCalls).toHaveLength(1);
            expect(second.toolCalls[0]).toMatchObject({step: 0, input: {id: 1}});
            expect(String(warn.mock.calls[0])).toContain('already used');
        });

        it('ignores a result for an unknown tool call', () => {
            const message = pendingMessage(),
                result = new ChatStreamReducer(0).apply(message, [
                    {type: 'TOOL_CALL_RESULT', messageId: 'res1', toolCallId: 'nope', content: 'x'}
                ]);
            expect(result).toBe(message);
        });
    });

    describe('data and kit extensions', () => {
        it('adds a data part on ACTIVITY_SNAPSHOT, and replaces it on the next one', () => {
            const snapshot = (content, replace?: boolean): ChatEvent => ({
                type: 'ACTIVITY_SNAPSHOT',
                messageId: 'a1',
                activityType: 'progress',
                content,
                replace
            });

            let message = reduce([snapshot({pct: 10})]);
            expect(message.parts).toMatchObject([
                {type: 'data', id: 'a1', dataType: 'progress', data: {pct: 10}}
            ]);

            message = new ChatStreamReducer(0).apply(message, [snapshot({pct: 50})]);
            expect(message.parts).toHaveLength(1);
            expect((message.parts[0] as ChatDataPart).data).toEqual({pct: 50});

            message = new ChatStreamReducer(0).apply(message, [snapshot({pct: 0}, false)]);
            expect((message.parts[0] as ChatDataPart).data).toEqual({pct: 50});
        });

        it('adds source, data and file parts from xh.chat events', () => {
            const message = reduce([
                custom('xh.chat.source', {id: 's1', url: 'https://xh.io', title: 'XH'}),
                custom('xh.chat.data', {id: 'd1', dataType: 'chart', data: {series: []}}),
                custom('xh.chat.file', {name: 'a.png', mediaType: 'image/png', url: '/a.png'})
            ]);
            const [source, data, file] = message.parts as [
                ChatSourcePart,
                ChatDataPart,
                ChatFilePart
            ];

            expect(source).toEqual({
                type: 'source',
                id: 's1',
                step: 0,
                url: 'https://xh.io',
                title: 'XH'
            });
            expect(data).toMatchObject({type: 'data', id: 'd1', dataType: 'chart'});
            expect(file).toMatchObject({type: 'file', name: 'a.png', url: '/a.png'});
            expect(file.id).toBeTruthy();
        });

        it('attaches citations to the current text part', () => {
            const message = reduce([
                {type: 'TEXT_MESSAGE_START', messageId: 'm1'},
                {type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'Hoist is fast.'},
                custom('xh.chat.citation', {id: 'c1', sourceId: 's1', citedText: 'fast'}),
                {type: 'TEXT_MESSAGE_END', messageId: 'm1'},
                custom('xh.chat.citation', {id: 'c2', url: 'https://xh.io'})
            ]);
            expect((message.parts[0] as ChatTextPart).citations).toEqual([
                {id: 'c1', sourceId: 's1', citedText: 'fast'},
                {id: 'c2', url: 'https://xh.io'}
            ]);
        });
    });

    describe('unknown and ignored events', () => {
        it('ignores unsupported events and unknown event types without throwing', () => {
            const message = pendingMessage(),
                events = [
                    {type: 'STATE_SNAPSHOT', snapshot: {}},
                    {type: 'MESSAGES_SNAPSHOT', messages: []},
                    {type: 'RAW', event: {}},
                    {type: 'CUSTOM', name: 'acme.unknown', value: 1},
                    {type: 'SOMETHING_NEW', payload: 1}
                ] as ChatEvent[];

            expect(new ChatStreamReducer(0).apply(message, events)).toBe(message);
        });
    });

    describe('immutability', () => {
        it('replaces only the parts that changed, and never mutates its input', () => {
            const reducer = new ChatStreamReducer(0),
                before = reducer.apply(pendingMessage(), [
                    ...reasoning('r1', 'Thinking'),
                    {type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'Hi'}
                ]),
                [reasoningPart, textPart] = before.parts,
                after = reducer.apply(before, [
                    {type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: ' there'}
                ]);

            expect(after).not.toBe(before);
            expect(after.parts[0]).toBe(reasoningPart);
            expect(after.parts[1]).not.toBe(textPart);
            expect((textPart as ChatTextPart).text).toBe('Hi');
            expect(before.text).toBe('Hi');
        });
    });

    describe('finish', () => {
        it('closes open parts and parses unfinished tool input when the stream ends', () => {
            const reducer = new ChatStreamReducer(0),
                streamed = reducer.apply(pendingMessage(), [
                    {type: 'REASONING_START', messageId: 'r1'},
                    {type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'Hi'},
                    {type: 'TOOL_CALL_START', toolCallId: 'c1', toolCallName: 'lookup'},
                    {type: 'TOOL_CALL_ARGS', toolCallId: 'c1', delta: '{"id": 7}'},
                    FINISHED
                ]),
                finished = reducer.finish(streamed);

            expect(finished.status).toBe('streaming');
            expect(finished.parts).toMatchObject([
                {type: 'reasoning', state: 'done'},
                {type: 'text', state: 'done'},
                {type: 'toolCall', state: 'input-available', input: {id: 7}}
            ]);
        });

        it('leaves parts of earlier steps alone', () => {
            const first = reduce([{type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'Hi'}]),
                reducer = new ChatStreamReducer(1),
                finishedRun = reducer.apply(first, [FINISHED]);
            expect(reducer.finish(finishedRun).parts).toBe(finishedRun.parts);
        });

        it('fails a message whose stream ended without RUN_FINISHED', () => {
            const reducer = new ChatStreamReducer(0),
                streamed = reducer.apply(pendingMessage(), text('m1', 'Partial')),
                finished = reducer.finish(streamed);

            expect(finished).toMatchObject({
                status: 'error',
                error: 'The response ended before it was complete.',
                metadata: {errorCode: 'incomplete-stream'}
            });
            expect(finished.text).toBe('Partial');
        });

        it('keeps the error of a stream that ended with RUN_ERROR', () => {
            const reducer = new ChatStreamReducer(0),
                failed = reducer.apply(pendingMessage(), [{type: 'RUN_ERROR', message: 'Boom'}]);
            expect(reducer.finish(failed)).toMatchObject({status: 'error', error: 'Boom'});
        });
    });
});

//------------------
// Helpers
//------------------
const FINISHED: ChatEvent = {type: 'RUN_FINISHED', threadId: 't', runId: 'r'};

function pendingMessage(): ChatMessage {
    return new ChatMessage({role: 'assistant', status: 'pending'});
}

function reduce(events: ChatEvent[]): ChatMessage {
    return new ChatStreamReducer(0).apply(pendingMessage(), events);
}

function text(messageId: string, content: string): ChatEvent[] {
    return [
        {type: 'TEXT_MESSAGE_START', messageId},
        {type: 'TEXT_MESSAGE_CONTENT', messageId, delta: content},
        {type: 'TEXT_MESSAGE_END', messageId}
    ];
}

function reasoning(messageId: string, content: string): ChatEvent[] {
    return [
        {type: 'REASONING_START', messageId},
        {type: 'REASONING_MESSAGE_CONTENT', messageId, delta: content},
        {type: 'REASONING_END', messageId}
    ];
}

function toolCall(toolCallId: string, toolCallName: string, args: string): ChatEvent[] {
    return [
        {type: 'TOOL_CALL_START', toolCallId, toolCallName},
        {type: 'TOOL_CALL_ARGS', toolCallId, delta: args},
        {type: 'TOOL_CALL_END', toolCallId}
    ];
}

function custom(name: string, value: any): ChatEvent {
    return {type: 'CUSTOM', name, value};
}
