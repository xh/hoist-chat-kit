import {describe, expect, it, vi} from 'vitest';
import type {ChatEvent, RunFinishedEvent} from '../transport';
import {ChatMessage} from './ChatMessage';
import type {
    ChatDataPart,
    ChatFilePart,
    ChatReasoningPart,
    ChatSourcePart,
    ChatTextPart,
    ChatToolCallPart
} from './ChatPart';
import {ChatStreamReducer} from './ChatStreamReducer';
import {CHAT_SUBAGENT_DATA_TYPE} from './ChatSubagent';

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
                runId: 'r',
                runStarted: true,
                finishReason: 'stop',
                model: 'claude',
                usage: [{inputTokens: 10, outputTokens: 20}]
            });
        });

        it.each([
            ['success', 'stop', {type: 'success'}],
            ['interrupt', 'other', {type: 'interrupt', interrupts: []}],
            ['cancelled', 'other', {type: 'cancelled'}]
        ] as Array<[string, string, RunFinishedEvent['outcome']]>)(
            'maps outcome %s to finish reason %s when none is given',
            (_, reason, outcome) => {
                const message = reduce([
                    {type: 'RUN_FINISHED', threadId: 't', runId: 'r', outcome}
                ]);
                expect(message.metadata.finishReason).toBe(reason);
            }
        );

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

        it('keeps the first error of a run over a later one', () => {
            const message = reduce([
                {type: 'RUN_STARTED', threadId: 't', runId: 'r1'},
                {type: 'RUN_ERROR', message: 'Busy', code: 'busy'},
                {type: 'RUN_ERROR', message: 'The server stopped responding.', code: 'stalled'}
            ]);
            expect(message).toMatchObject({error: 'Busy', metadata: {errorCode: 'busy'}});
        });

        it('clears a failed run when the stream starts a new one, as AG-UI allows', () => {
            const message = reduce([
                {type: 'RUN_STARTED', threadId: 't', runId: 'r1'},
                {type: 'RUN_ERROR', message: 'Busy', code: 'busy', metadata: {retrySafe: false}},
                {type: 'RUN_STARTED', threadId: 't', runId: 'r2'},
                ...text('m1', 'Second try.'),
                {type: 'RUN_FINISHED', threadId: 't', runId: 'r2'}
            ]);
            expect(message).toMatchObject({status: 'streaming', error: null, text: 'Second try.'});
            expect(message.metadata).toMatchObject({runId: 'r2'});
            expect(message.metadata).not.toHaveProperty('errorCode');
            expect(message.metadata).not.toHaveProperty('retrySafe');
        });

        it('leaves the message unchanged for stage events', () => {
            const message = pendingMessage(),
                result = new ChatStreamReducer(0).apply(message, [
                    {type: 'STEP_STARTED', stepName: 'plan'},
                    {type: 'STEP_FINISHED', stepName: 'plan'}
                ]);
            expect(result).toBe(message);
        });

        it('records the run id of RUN_STARTED, and reports its thread id', () => {
            const reducer = new ChatStreamReducer(0),
                message = reducer.apply(pendingMessage(), [
                    {type: 'RUN_STARTED', threadId: 'server-thread', runId: 'server-run'}
                ]);

            expect(message.metadata).toEqual({runId: 'server-run', runStarted: true});
            expect(message.parts).toEqual([]);
            expect(message.status).toBe('pending');
            expect(reducer.runThreadId).toBe('server-thread');
            expect(reducer.runId).toBe('server-run');
        });

        it('records the server id of the reply from xh.chat.message', () => {
            const reducer = new ChatStreamReducer(0),
                message = reducer.apply(pendingMessage(), [
                    custom('xh.chat.message', {role: 'assistant', serverId: 'q-7'}),
                    {type: 'RUN_FINISHED', threadId: 't', runId: 'r', result: {messageId: 'other'}}
                ]);

            expect(message.metadata.serverId).toBe('q-7');
            expect(reducer.userServerId).toBeNull();
        });

        it('takes the server id of the reply from RUN_FINISHED when no event reported one', () => {
            const message = reduce([
                {type: 'RUN_FINISHED', threadId: 't', runId: 'r', result: {messageId: 'q-8'}}
            ]);
            expect(message.metadata.serverId).toBe('q-8');
        });

        it('reports the server id of the user message, leaving the reply alone', () => {
            const reducer = new ChatStreamReducer(0),
                message = pendingMessage(),
                result = reducer.apply(message, [
                    custom('xh.chat.message', {role: 'user', serverId: 'u-7'})
                ]);

            expect(result).toBe(message);
            expect(reducer.userServerId).toBe('u-7');
        });

        it('records the wait the backend asks for on RUN_ERROR', () => {
            const message = reduce([
                {
                    type: 'RUN_ERROR',
                    message: 'Still answering.',
                    code: 'duplicate_in_progress',
                    metadata: {retryAfterSeconds: 20}
                }
            ]);

            expect(message).toMatchObject({
                status: 'error',
                metadata: {errorCode: 'duplicate_in_progress', retryAfterSeconds: 20}
            });
        });

        it('records whether the backend says a retry is safe on RUN_ERROR', () => {
            const message = reduce([
                {
                    type: 'RUN_ERROR',
                    message: 'The write may have run.',
                    code: 'tool_failed',
                    metadata: {retrySafe: false}
                }
            ]);

            expect(message.metadata).toMatchObject({errorCode: 'tool_failed', retrySafe: false});
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

    describe('text replace', () => {
        it('empties the open text part on a reset, and appends what follows', () => {
            const reducer = new ChatStreamReducer(0);
            let message = reducer.apply(pendingMessage(), [
                {type: 'TEXT_MESSAGE_CHUNK', delta: 'A first try'},
                custom('xh.chat.textReplace', {text: ''})
            ]);
            expect(message.parts).toMatchObject([{type: 'text', text: '', state: 'streaming'}]);

            message = reducer.apply(message, [{type: 'TEXT_MESSAGE_CHUNK', delta: 'The answer.'}]);
            expect(message.parts).toHaveLength(1);
            expect(message.text).toBe('The answer.');
        });

        it('sets the final text of the last text part when none is open', () => {
            const reducer = new ChatStreamReducer(0),
                message = reducer.apply(pendingMessage(), [
                    ...text('m1', 'Streamed [1].'),
                    custom('xh.chat.textReplace', {text: 'Final [1].'})
                ]);

            expect(message.parts).toMatchObject([
                {type: 'text', text: 'Final [1].', state: 'done'}
            ]);
        });

        it('adds a text part when the reply has none', () => {
            const reducer = new ChatStreamReducer(0),
                message = reducer.apply(pendingMessage(), [
                    custom('xh.chat.textReplace', {text: 'Only the final text.'})
                ]);

            expect(message.text).toBe('Only the final text.');
            expect(reducer.finish(message).parts[0]).toMatchObject({state: 'done'});
        });

        it('adds no part for an empty replace when the reply has no text', () => {
            const message = pendingMessage(),
                result = new ChatStreamReducer(0).apply(message, [
                    custom('xh.chat.textReplace', {text: ''})
                ]);
            expect(result).toBe(message);
        });
    });

    describe('text transform', () => {
        it('transforms all the text so far on each change, never its own output', () => {
            const calls = [],
                textTransform = (text: string, {isStreaming}) => {
                    calls.push([text, isStreaming]);
                    return text.replace(/<thinking>[\s\S]*?(<\/thinking>|$)/g, '');
                },
                reducer = new ChatStreamReducer(0, {textTransform});

            let message = reducer.apply(pendingMessage(), [
                {type: 'TEXT_MESSAGE_START', messageId: 'm1'},
                {type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: '<thinking>Plan'}
            ]);
            expect(message.text).toBe('');

            message = reducer.apply(message, [
                {type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: ' it.</thinking>Paris'},
                {type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: ' is sunny.'}
            ]);
            expect(message.text).toBe('Paris is sunny.');

            message = reducer.apply(message, [{type: 'TEXT_MESSAGE_END', messageId: 'm1'}]);
            expect(message.text).toBe('Paris is sunny.');
            expect(calls).toEqual([
                ['<thinking>Plan', true],
                ['<thinking>Plan it.</thinking>Paris is sunny.', true],
                ['<thinking>Plan it.</thinking>Paris is sunny.', false]
            ]);
        });

        it('transforms text set by a replace', () => {
            const reducer = new ChatStreamReducer(0, {textTransform: it => it.toUpperCase()}),
                message = reducer.apply(pendingMessage(), [
                    custom('xh.chat.textReplace', {text: 'final'})
                ]);
            expect(message.text).toBe('FINAL');
        });

        it('gives the final text to the transform when a turn ends before its stream', () => {
            const textTransform = vi.fn((text: string) => text),
                reducer = new ChatStreamReducer(0, {textTransform}),
                streamed = reducer.apply(pendingMessage(), [
                    {type: 'TEXT_MESSAGE_CHUNK', delta: 'Partial'}
                ]),
                settled = reducer.settleText(streamed);

            expect(settled.parts).toMatchObject([{type: 'text', state: 'done'}]);
            expect(textTransform).toHaveBeenLastCalledWith('Partial', {
                message: streamed,
                isStreaming: false
            });
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

        it("keeps a result's metadata apart from the call's, less the artifacts it records", () => {
            const message = reduce([
                {
                    type: 'TOOL_CALL_START',
                    toolCallId: 'c1',
                    toolCallName: 'runSql',
                    metadata: {source: 'warehouse'}
                },
                {type: 'TOOL_CALL_END', toolCallId: 'c1'},
                {
                    type: 'TOOL_CALL_RESULT',
                    messageId: 'res1',
                    toolCallId: 'c1',
                    content: 'ok',
                    metadata: {
                        table: {columns: ['desk'], rows: [['Rates']]},
                        artifacts: [
                            {id: 'a1', columns: [{name: 'n', type: 'number'}], totalRows: 3}
                        ]
                    }
                }
            ]);
            const call = message.parts[0] as ChatToolCallPart;

            expect(call.metadata).toEqual({source: 'warehouse'});
            expect(call.resultMetadata).toEqual({table: {columns: ['desk'], rows: [['Rates']]}});
            expect(message.metadata.artifacts).toHaveLength(1);
        });

        it('leaves out of the result metadata the error that the call itself holds', () => {
            const message = reduce([
                ...toolCall('c1', 'runSql', '{}'),
                {
                    type: 'TOOL_CALL_RESULT',
                    messageId: 'res1',
                    toolCallId: 'c1',
                    content: 'Timed out.',
                    metadata: {isError: true, query: 'q1'}
                }
            ]);
            const call = message.parts[0] as ChatToolCallPart;

            expect(call.state).toBe('output-error');
            expect(call.resultMetadata).toEqual({query: 'q1'});
        });

        it('keeps no result metadata for a result that sends none', () => {
            const message = reduce([
                ...toolCall('c1', 'webSearch', '{}'),
                {type: 'TOOL_CALL_RESULT', messageId: 'res1', toolCallId: 'c1', content: 'Done.'}
            ]);
            expect((message.parts[0] as ChatToolCallPart).resultMetadata).toBeUndefined();
        });

        it('keeps a non-JSON result as text', () => {
            const message = reduce([
                ...toolCall('c1', 'webSearch', '{}'),
                {type: 'TOOL_CALL_RESULT', messageId: 'res1', toolCallId: 'c1', content: 'Done.'}
            ]);
            expect((message.parts[0] as ChatToolCallPart).output).toBe('Done.');
        });

        it.each([
            ['metadata.error', {error: 'Quota exceeded.'}, 'ignored', 'Quota exceeded.'],
            ['metadata.isError', {isError: true}, 'Quota exceeded.', 'Quota exceeded.'],
            ['metadata.isError with no content', {isError: true}, '', 'The tool failed.']
        ])('fails a backend call whose result sets %s', (_, metadata, content, errorText) => {
            const message = reduce([
                ...toolCall('c1', 'webSearch', '{}'),
                {type: 'TOOL_CALL_RESULT', messageId: 'res1', toolCallId: 'c1', content, metadata}
            ]);
            expect(message.parts[0]).toMatchObject({
                state: 'output-error',
                output: null,
                errorText,
                providerExecuted: true
            });
        });

        it('reads the error text of an isError result from its text parts', () => {
            const message = reduce([
                ...toolCall('c1', 'webSearch', '{}'),
                {
                    type: 'TOOL_CALL_RESULT',
                    messageId: 'res1',
                    toolCallId: 'c1',
                    content: [{type: 'text', text: 'Index offline.'}],
                    metadata: {isError: true}
                }
            ]);
            expect((message.parts[0] as ChatToolCallPart).errorText).toBe('Index offline.');
        });

        it('fails a backend call on xh.chat.toolError', () => {
            const message = reduce([
                ...toolCall('c1', 'webSearch', '{}'),
                custom('xh.chat.toolError', {toolCallId: 'c1', message: 'Index offline.'})
            ]);
            expect(message.parts[0]).toMatchObject({
                state: 'output-error',
                errorText: 'Index offline.',
                providerExecuted: true
            });
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

        it('keeps the sub-agent an activity came from', () => {
            const message = reduce([
                {
                    type: 'ACTIVITY_SNAPSHOT',
                    messageId: 'a1',
                    activityType: 'skill',
                    content: {skillId: 'equity-research'},
                    subagentRunId: 'run-1'
                },
                custom('xh.chat.data', {
                    id: 'd1',
                    dataType: 'skill',
                    data: {},
                    subagentRunId: 'run-1'
                })
            ]);
            expect(message.parts).toMatchObject([
                {type: 'data', id: 'a1', dataType: 'skill', subagentRunId: 'run-1'},
                {type: 'data', id: 'd1', dataType: 'skill', subagentRunId: 'run-1'}
            ]);
        });

        it('adds source, data and file parts from xh.chat events', () => {
            const message = reduce([
                custom('xh.chat.source', {
                    id: 's1',
                    url: 'https://xh.io',
                    title: 'XH',
                    marker: 1,
                    metadata: {documentId: 'd-7', excerpt: 'Hoist is fast.'},
                    ignored: true
                }),
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
                title: 'XH',
                marker: 1,
                metadata: {documentId: 'd-7', excerpt: 'Hoist is fast.'},
                sourceType: 'url'
            });
            expect(data).toMatchObject({type: 'data', id: 'd1', dataType: 'chart'});
            expect(file).toMatchObject({type: 'file', name: 'a.png', url: '/a.png'});
            expect(file.id).toBeTruthy();
        });

        it('defaults a source with a url to a url source, and one without to a document', () => {
            const message = reduce([
                custom('xh.chat.source', {id: 's1', url: 'https://xh.io'}),
                custom('xh.chat.source', {id: 's2', title: 'Credit Guidelines v4'}),
                custom('xh.chat.source', {
                    id: 's3',
                    url: 'https://xh.io/a',
                    sourceType: 'document'
                }),
                custom('xh.chat.source', {id: 's4', title: 'Rates', sourceType: 'url'}),
                custom('xh.chat.source', {id: 's5', title: 'Notes', sourceType: 'pdf'})
            ]);
            expect((message.parts as ChatSourcePart[]).map(it => it.sourceType)).toEqual([
                'url',
                'document',
                'document',
                'url',
                'document'
            ]);
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

    describe('interrupts', () => {
        it('records the questions of an interrupted run on the reply, and keeps the outcome', () => {
            const reducer = new ChatStreamReducer(0),
                question = {id: 'q1', reason: 'input_required', message: 'Which region?'},
                message = reducer.finish(
                    reducer.apply(pendingMessage(), [
                        {type: 'RUN_STARTED', threadId: 't', runId: 'r1'},
                        {
                            type: 'RUN_FINISHED',
                            threadId: 't',
                            runId: 'r1',
                            outcome: {type: 'interrupt', interrupts: [question]}
                        }
                    ])
                );

            expect(reducer.outcome).toEqual({type: 'interrupt', interrupts: [question]});
            expect(reducer.finishedRunId).toBe('r1');
            expect(message.status).not.toBe('error');
            expect(message.metadata.interrupts).toEqual([
                {...question, runId: 'r1', step: 0, response: null, delivered: false}
            ]);
        });

        it('adds the questions of a later step to those the reply already holds', () => {
            const first = reduce([
                    {
                        type: 'RUN_FINISHED',
                        threadId: 't',
                        runId: 'r1',
                        outcome: {type: 'interrupt', interrupts: [{id: 'q1', reason: 'a'}]}
                    }
                ]),
                second = new ChatStreamReducer(1).apply(first, [
                    {
                        type: 'RUN_FINISHED',
                        threadId: 't',
                        runId: 'r2',
                        outcome: {type: 'interrupt', interrupts: [{id: 'q1', reason: 'b'}]}
                    }
                ]);
            expect(second.metadata.interrupts.map(it => [it.runId, it.reason])).toEqual([
                ['r1', 'a'],
                ['r2', 'b']
            ]);
        });

        it('keeps a suspended sub-agent waiting past the run, and runs it again when it continues', () => {
            const reducer = new ChatStreamReducer(0),
                waiting = reducer.finish(
                    reducer.apply(pendingMessage(), [
                        {type: 'SUBAGENT_STARTED', subagentRunId: 's1', name: 'Planner'},
                        {
                            type: 'SUBAGENT_FINISHED',
                            subagentRunId: 's1',
                            outcome: {type: 'suspended', interruptIds: ['q1']}
                        },
                        {
                            type: 'RUN_FINISHED',
                            threadId: 't',
                            runId: 'r1',
                            outcome: {type: 'interrupt', interrupts: [{id: 'q1', reason: 'a'}]}
                        }
                    ])
                );
            expect(waiting.parts[0]).toMatchObject({data: {status: 'waiting', endedAt: null}});

            const resumed = new ChatStreamReducer(1).apply(waiting, [
                {type: 'SUBAGENT_STARTED', subagentRunId: 's1', name: 'Planner'}
            ]);
            expect(resumed.parts).toHaveLength(1);
            expect(resumed.parts[0]).toMatchObject({data: {status: 'running', endedAt: null}});
        });
    });

    describe('server ids', () => {
        it("keeps a text message's id on its part, apart from the part's own id", () => {
            const [part] = reduce(text('m1', 'Hi')).parts;
            expect(part).toMatchObject({type: 'text', serverId: 'm1'});
            expect(part.id).not.toBe('m1');
        });

        it('keeps the reasoning message id, not the span id, on a reasoning part', () => {
            const [part] = reduce([
                {type: 'REASONING_START', messageId: 'span1'},
                {type: 'REASONING_MESSAGE_START', messageId: 'r1', role: 'reasoning'},
                {type: 'REASONING_MESSAGE_CONTENT', messageId: 'r1', delta: 'Hmm.'}
            ]).parts;
            expect(part).toMatchObject({type: 'reasoning', serverId: 'r1'});
        });

        it("keeps a call's parent message id, and the id of its result's tool message", () => {
            const message = reduce([
                {
                    type: 'TOOL_CALL_START',
                    toolCallId: 'c1',
                    toolCallName: 'a',
                    parentMessageId: 'm1'
                },
                {type: 'TOOL_CALL_END', toolCallId: 'c1'},
                {type: 'TOOL_CALL_RESULT', toolCallId: 'c1', messageId: 't1', content: 'ok'},
                {type: 'TOOL_CALL_START', toolCallId: 'c2', toolCallName: 'b'},
                {type: 'TOOL_CALL_END', toolCallId: 'c2'},
                {
                    type: 'TOOL_CALL_RESULT',
                    toolCallId: 'c2',
                    messageId: 't2',
                    content: 'Boom',
                    metadata: {isError: true}
                }
            ]);
            expect(message.parts).toMatchObject([
                {id: 'c1', parentServerId: 'm1', resultServerId: 't1'},
                {id: 'c2', state: 'output-error', resultServerId: 't2'}
            ]);
            expect(message.parts[1]).not.toHaveProperty('parentServerId');
        });

        it('sets no server id on text a kit event adds', () => {
            const [part] = reduce([custom('xh.chat.textReplace', {text: 'Final.'})]).parts;
            expect(part).toMatchObject({type: 'text', text: 'Final.'});
            expect(part).not.toHaveProperty('serverId');
        });
    });

    describe('metadata', () => {
        it("merges each event's metadata into its text part, key by key, the last write winning", () => {
            const [part] = reduce([
                {type: 'TEXT_MESSAGE_START', messageId: 'm1', metadata: {a: 1, b: 1, list: [1, 2]}},
                {type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'Hi', metadata: {b: 2}},
                {type: 'TEXT_MESSAGE_END', messageId: 'm1', metadata: {list: [3], c: null}}
            ]).parts;
            expect((part as ChatTextPart).metadata).toEqual({a: 1, b: 2, list: [3], c: null});
        });

        it('merges metadata into a reasoning message, but not from its span', () => {
            const [part] = reduce([
                {type: 'REASONING_START', messageId: 'span1', metadata: {span: true}},
                {type: 'REASONING_MESSAGE_START', messageId: 'r1', role: 'reasoning'},
                {type: 'REASONING_MESSAGE_CONTENT', messageId: 'r1', delta: 'Hmm.'},
                {type: 'REASONING_MESSAGE_END', messageId: 'r1', metadata: {model: 'x'}}
            ]).parts;
            expect((part as ChatReasoningPart).metadata).toEqual({model: 'x'});
        });

        it("merges a call's metadata onto the call, and keeps its result's off it", () => {
            const [part] = reduce([
                {type: 'TOOL_CALL_START', toolCallId: 'c1', toolCallName: 'a', metadata: {n: 1}},
                {type: 'TOOL_CALL_ARGS', toolCallId: 'c1', delta: '{}', metadata: {bytes: 2}},
                {type: 'TOOL_CALL_END', toolCallId: 'c1', metadata: {n: 2}},
                {
                    type: 'TOOL_CALL_RESULT',
                    toolCallId: 'c1',
                    messageId: 't1',
                    content: 'ok',
                    metadata: {cached: true}
                }
            ]).parts;
            expect((part as ChatToolCallPart).metadata).toEqual({n: 2, bytes: 2});
        });

        it('keeps the metadata of a second start for an id already used off the first call', () => {
            const [part] = reduce([
                {type: 'TOOL_CALL_START', toolCallId: 'c1', toolCallName: 'a', metadata: {n: 1}},
                {type: 'TOOL_CALL_START', toolCallId: 'c1', toolCallName: 'b', metadata: {n: 2}}
            ]).parts;
            expect((part as ChatToolCallPart).metadata).toEqual({n: 1});
        });

        it('adds no metadata to a part whose events carry none', () => {
            const [part] = reduce(text('m1', 'Hi')).parts;
            expect(part).not.toHaveProperty('metadata');
        });
    });

    describe('a call that starts a sub-agent', () => {
        const started = (parentToolCallId: string): ChatEvent => ({
            type: 'SUBAGENT_STARTED',
            subagentRunId: 'sa1',
            name: 'Researcher',
            parentToolCallId
        });

        it('records the sub-agent on the call that its parentToolCallId names', () => {
            const message = reduce([...toolCall('task1', 'task', '{}'), started('task1')]);
            expect(message.toolCalls[0].spawnedSubagentRunId).toBe('sa1');
        });

        it('links the call when it arrives after the sub-agent names it', () => {
            const message = reduce([started('task1'), ...toolCall('task1', 'task', '{}')]);
            expect(message.toolCalls[0].spawnedSubagentRunId).toBe('sa1');
        });

        it('keeps the first sub-agent to name the call, in either order', () => {
            const second = {...started('task1'), subagentRunId: 'sa2'} as ChatEvent,
                callFirst = reduce([...toolCall('task1', 'task', '{}'), started('task1'), second]),
                callLast = reduce([started('task1'), second, ...toolCall('task1', 'task', '{}')]);

            expect(callFirst.toolCalls[0].spawnedSubagentRunId).toBe('sa1');
            expect(callLast.toolCalls[0].spawnedSubagentRunId).toBe('sa1');
        });

        it('links nothing for a parent call not in the reply', () => {
            const message = reduce([...toolCall('c1', 'lookup', '{}'), started('elsewhere')]);
            expect(message.toolCalls[0].spawnedSubagentRunId).toBeUndefined();
        });
    });

    describe('superseded attempts', () => {
        // An attempt a retry replaced: its text and call stream live, then end marked, and the
        // call gets a closing result that says it never ran.
        const SUPERSEDED = {superseded: true};
        const abandoned: ChatEvent[] = [
            {type: 'TEXT_MESSAGE_START', messageId: 'm1'},
            {type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'Let me look'},
            {type: 'TOOL_CALL_START', toolCallId: 'c1', toolCallName: 'search'},
            {type: 'TOOL_CALL_ARGS', toolCallId: 'c1', delta: '{"q": "lim'},
            {type: 'TEXT_MESSAGE_END', messageId: 'm1', metadata: SUPERSEDED},
            {type: 'TOOL_CALL_END', toolCallId: 'c1', metadata: SUPERSEDED},
            {
                type: 'TOOL_CALL_RESULT',
                toolCallId: 'c1',
                messageId: 'c1:superseded',
                content: 'This model attempt was superseded. The tool was not executed.',
                // The backend sends a boolean `error`, which AG-UI's types do not allow.
                metadata: {...SUPERSEDED, error: true}
            } as unknown as ChatEvent
        ];

        it('drops the marked parts and the result that closes them, and keeps the retry', () => {
            const message = reduce([
                ...abandoned,
                ...toolCall('c2', 'search', '{"q": "limits"}'),
                ...text('m2', 'Two desks are over.')
            ]);

            expect(message.parts.map(it => it.id)).toEqual(['c2', expect.any(String)]);
            expect(message.text).toBe('Two desks are over.');
            expect(message.toolCalls.map(it => it.id)).toEqual(['c2']);
            expect(message.metadata.supersededCount).toBe(2);
        });

        it('shows the parts while they stream, and drops them when their marked end arrives', () => {
            const reducer = new ChatStreamReducer(0),
                streaming = reducer.apply(pendingMessage(), abandoned.slice(0, 4));
            expect(streaming.text).toBe('Let me look');
            expect(streaming.toolCalls).toHaveLength(1);

            const ended = reducer.apply(streaming, abandoned.slice(4));
            expect(ended.parts).toEqual([]);
            expect(ended.metadata.supersededCount).toBe(2);
        });

        it("keeps another lane's call that arrives between the marks", () => {
            const [, , start, args, textEnd, callEnd, result] = abandoned,
                message = reduce([
                    start,
                    args,
                    ...toolCall('s1', 'lookup', '{}'),
                    textEnd,
                    callEnd,
                    result
                ]);

            expect(message.parts.map(it => it.id)).toEqual(['s1']);
            expect(message.metadata.supersededCount).toBe(1);
        });

        it('ignores later events for a dropped text or call, so neither comes back', () => {
            const message = reduce([
                ...abandoned,
                {type: 'TEXT_MESSAGE_START', messageId: 'm1'},
                {type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'Back'},
                {type: 'TOOL_CALL_START', toolCallId: 'c1', toolCallName: 'search'},
                {type: 'TOOL_CALL_ARGS', toolCallId: 'c1', delta: '{}'}
            ]);

            expect(message.parts).toEqual([]);
            expect(message.metadata.supersededCount).toBe(2);
        });

        it('drops text with a transform, when its content and marked end share a batch', () => {
            const message = new ChatStreamReducer(0, {
                textTransform: text => text.toUpperCase()
            }).apply(pendingMessage(), [...abandoned, ...text('m2', 'Answer')]);

            expect(message.text).toBe('ANSWER');
            expect(message.metadata.supersededCount).toBe(2);
        });

        it('counts nothing for marked text that never had content', () => {
            const message = reduce([
                {type: 'TEXT_MESSAGE_START', messageId: 'm1'},
                {type: 'TEXT_MESSAGE_END', messageId: 'm1', metadata: SUPERSEDED},
                ...text('m2', 'Answer')
            ]);

            expect(message.text).toBe('Answer');
            expect(message.metadata.supersededCount).toBeUndefined();
        });

        it('drops only on `superseded: true`, not on other marks', () => {
            const message = reduce([
                {type: 'TEXT_MESSAGE_START', messageId: 'm1'},
                {type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'Kept'},
                {
                    type: 'TEXT_MESSAGE_END',
                    messageId: 'm1',
                    metadata: {attemptStatus: 'superseded', superseded: 'yes'}
                }
            ]);

            expect(message.text).toBe('Kept');
            expect((message.parts[0] as ChatTextPart).state).toBe('done');
        });

        it('keeps the partial text of a failed run that marks nothing', () => {
            const message = reduce([
                {type: 'TEXT_MESSAGE_START', messageId: 'm1'},
                {type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'Partial'},
                {type: 'RUN_ERROR', message: 'Provider error.'}
            ]);

            expect(message.text).toBe('Partial');
            expect(message.status).toBe('error');
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

    describe('sub-agents and timing', () => {
        it('records a sub-agent as a data part, and the calls it makes as its own', () => {
            const message = reduce([
                {
                    type: 'SUBAGENT_STARTED',
                    subagentRunId: 'sa1',
                    name: 'Limits Checker',
                    description: 'Compare exposure'
                },
                {
                    type: 'TOOL_CALL_START',
                    toolCallId: 'c1',
                    toolCallName: 'read_policy',
                    subagentRunId: 'sa1'
                },
                {type: 'TOOL_CALL_END', toolCallId: 'c1'},
                {type: 'SUBAGENT_FINISHED', subagentRunId: 'sa1', result: '2 desks over limit.'},
                FINISHED
            ]);

            const [agent, call] = message.parts as [ChatDataPart, ChatToolCallPart];
            expect(agent).toMatchObject({
                type: 'data',
                id: 'sa1',
                dataType: CHAT_SUBAGENT_DATA_TYPE,
                data: {
                    name: 'Limits Checker',
                    description: 'Compare exposure',
                    status: 'complete',
                    result: '2 desks over limit.'
                }
            });
            expect(agent.data.endedAt).toBeGreaterThanOrEqual(agent.data.startedAt);
            expect(call.subagentRunId).toBe('sa1');
        });

        it('fails a sub-agent on SUBAGENT_ERROR, and ignores the end of one it never saw', () => {
            const message = reduce([
                {type: 'SUBAGENT_STARTED', subagentRunId: 'sa1', name: 'Checker'},
                {type: 'SUBAGENT_ERROR', subagentRunId: 'sa1', message: 'Out of budget.'},
                {type: 'SUBAGENT_FINISHED', subagentRunId: 'unknown'},
                FINISHED
            ]);
            expect(message.parts).toHaveLength(1);
            expect((message.parts[0] as ChatDataPart).data).toMatchObject({
                status: 'error',
                error: 'Out of budget.'
            });
        });

        it('fails a sub-agent left running when the run fails or the stream drops', () => {
            const errored = new ChatStreamReducer(0),
                failed = errored.finish(
                    errored.apply(pendingMessage(), [
                        {type: 'SUBAGENT_STARTED', subagentRunId: 'sa1', name: 'Checker'},
                        {type: 'RUN_ERROR', message: 'Boom'}
                    ])
                ),
                dropped = new ChatStreamReducer(0),
                cut = dropped.finish(
                    dropped.apply(pendingMessage(), [
                        {type: 'SUBAGENT_STARTED', subagentRunId: 'sa1', name: 'Checker'}
                    ])
                );

            [failed, cut].forEach(message => {
                const {data} = message.parts[0] as ChatDataPart;
                expect(data).toMatchObject({status: 'error', error: 'The agent did not finish.'});
                expect(data.endedAt).toEqual(expect.any(Number));
            });
        });

        it('completes a sub-agent whose run finished without its end event', () => {
            const reducer = new ChatStreamReducer(0),
                message = reducer.finish(
                    reducer.apply(pendingMessage(), [
                        {type: 'SUBAGENT_STARTED', subagentRunId: 'sa1', name: 'Checker'},
                        FINISHED
                    ])
                );
            expect((message.parts[0] as ChatDataPart).data).toMatchObject({
                status: 'complete',
                endedAt: expect.any(Number)
            });
        });

        it('records when a tool call starts and when its result arrives', () => {
            const message = reduce([
                ...toolCall('c1', 'lookup', '{}'),
                {type: 'TOOL_CALL_RESULT', messageId: 'm', toolCallId: 'c1', content: 'ok'},
                FINISHED
            ]);
            const call = message.parts[0] as ChatToolCallPart;
            expect(call.startedAt).toEqual(expect.any(Number));
            expect(call.endedAt).toBeGreaterThanOrEqual(call.startedAt);
        });

        it('times parts by event timestamps only when asked, so a server clock cannot skew a live reply', () => {
            const events: ChatEvent[] = [
                    {
                        type: 'TOOL_CALL_START',
                        toolCallId: 'c1',
                        toolCallName: 'lookup',
                        timestamp: 1000
                    },
                    {type: 'TOOL_CALL_END', toolCallId: 'c1'},
                    {
                        type: 'TOOL_CALL_RESULT',
                        messageId: 'm',
                        toolCallId: 'c1',
                        content: 'ok',
                        timestamp: 4000
                    }
                ],
                callOf = (reducer: ChatStreamReducer) =>
                    reducer.apply(pendingMessage(), events).parts[0] as ChatToolCallPart;

            expect(callOf(new ChatStreamReducer(0)).startedAt).toBeGreaterThan(4000);
            const replayed = callOf(new ChatStreamReducer(0, {useEventTimestamps: true}));
            expect([replayed.startedAt, replayed.endedAt]).toEqual([1000, 4000]);
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
