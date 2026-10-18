import {findLast} from 'lodash';
import type {PlainObject} from '@xh/hoist/core';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {
    ChatMessage,
    type ChatPart,
    type ChatReasoningPart,
    type ChatTextPart,
    type ChatToolCallPart
} from '../../core';
import type {ChatEvent} from '../ChatEvent';
import type {ChatRunRequest} from '../ChatTransport';
import {AgUiCodec} from './AgUiCodec';

/**
 * AgUiCodec is the default codec, so its RunAgentInput is what every AG-UI agent server and most
 * Hoist chat endpoints receive. A malformed history - a tool call without its result, a lost
 * reasoning signature - fails the agent's next model call, often far from the cause.
 */
describe('AgUiCodec', () => {
    describe('encodeRequest', () => {
        it('sends live context after its own, with descriptions and values as text', () => {
            const codec = new AgUiCodec({context: [{description: 'App.', value: 'From app.'}]}),
                body = codec.encodeRequest(
                    request([user('Hi')], {
                        context: [
                            {name: 'grid', description: 'The grid.', value: {sortBy: ['name']}},
                            {name: 'note', description: null, value: 'Plain text.'}
                        ]
                    })
                );

            expect(body.context).toEqual([
                {description: 'App.', value: 'From app.'},
                {description: 'The grid.', value: '{"sortBy":["name"]}'},
                {description: 'note', value: 'Plain text.'}
            ]);
        });

        it('encodes a RunAgentInput with the run ids, tools, and empty defaults', () => {
            const body = new AgUiCodec().encodeRequest(
                request([user('Hi')], {
                    tools: [
                        {
                            name: 'getWeather',
                            description: 'Weather for a city.',
                            parameters: SCHEMA
                        },
                        {name: 'ping'}
                    ]
                })
            );

            expect(body).toEqual({
                threadId: 't1',
                runId: 'r1',
                protocolVersion: '1.0',
                state: {},
                messages: [{id: 'u1', role: 'user', content: 'Hi'}],
                tools: [
                    {name: 'getWeather', description: 'Weather for a city.', parameters: SCHEMA},
                    {name: 'ping', description: '', parameters: {type: 'object', properties: {}}}
                ],
                context: [],
                forwardedProps: {}
            });
        });

        it("sends the context of the turn's user message as a context entry", () => {
            const question = new ChatMessage({
                    id: 'u1',
                    role: 'user',
                    content: 'Why did it drop?',
                    metadata: {context: {ticker: 'XYZ'}}
                }),
                body = new AgUiCodec().encodeRequest(request([question]));

            expect(body.messages).toEqual([{id: 'u1', role: 'user', content: 'Why did it drop?'}]);
            expect(body.context).toEqual([
                {description: expect.stringMatching(/user's message/), value: '{"ticker":"XYZ"}'}
            ]);
        });

        it('builds context and forwarded props per run when given functions', () => {
            const codec = new AgUiCodec({
                    context: req => [{description: 'Run', value: req.runId}],
                    forwardedProps: req => ({threadId: req.threadId})
                }),
                body = codec.encodeRequest(request([user('Hi')]));

            expect(body.context).toEqual([{description: 'Run', value: 'r1'}]);
            expect(body.forwardedProps).toEqual({threadId: 't1'});
        });

        it('sends the agent state as a value, or built per run by a function', () => {
            const fixed = new AgUiCodec({state: {sector: 'Energy'}}),
                built = new AgUiCodec({state: req => ({run: req.runId})});

            expect(fixed.encodeRequest(request([user('Hi')])).state).toEqual({sector: 'Energy'});
            expect(built.encodeRequest(request([user('Hi')])).state).toEqual({run: 'r1'});
        });

        it('sends user attachments as content parts', () => {
            const message = new ChatMessage({
                id: 'u1',
                role: 'user',
                parts: [
                    {type: 'text', id: 'p1', text: 'What is this?', state: 'done'},
                    {type: 'file', id: 'p2', name: 'a.png', mediaType: 'image/png', data: 'iVBO'},
                    {
                        type: 'file',
                        id: 'p3',
                        name: 'b.pdf',
                        mediaType: 'application/pdf',
                        url: 'https://x/b.pdf'
                    }
                ]
            });

            const [encoded] = new AgUiCodec().encodeRequest(request([message])).messages;

            expect(encoded.content).toEqual([
                {type: 'text', text: 'What is this?'},
                {type: 'image', source: {type: 'data', value: 'iVBO', mimeType: 'image/png'}},
                {
                    type: 'document',
                    source: {type: 'url', value: 'https://x/b.pdf', mimeType: 'application/pdf'}
                }
            ]);
        });

        it('splits an assistant turn into reasoning, assistant and tool messages per step', () => {
            const assistant = new ChatMessage({
                id: 'a1',
                role: 'assistant',
                status: 'streaming',
                parts: [
                    {
                        type: 'reasoning',
                        id: 'r-0',
                        step: 0,
                        text: 'Look it up.',
                        state: 'done',
                        startedAt: 1,
                        endedAt: 2,
                        encryptedValue: 'sig'
                    },
                    {type: 'text', id: 'x-0', step: 0, text: 'Checking.', state: 'done'},
                    toolCall('call1', 0, {output: {tempC: 18}, encryptedValue: 'opaque'}),
                    toolCall('call2', 0, {state: 'output-error', errorText: 'Timed out.'}),
                    toolCall('call3', 0, {state: 'output-denied', errorText: 'Denied.'}),
                    toolCall('call4', 1, {state: 'output-available', output: 'done'})
                ]
            });

            const {messages} = new AgUiCodec().encodeRequest(request([user('Hi'), assistant]));

            expect(messages.slice(1)).toEqual([
                {id: 'r-0', role: 'reasoning', content: 'Look it up.', encryptedValue: 'sig'},
                {
                    id: 'a1',
                    role: 'assistant',
                    content: 'Checking.',
                    toolCalls: [
                        {
                            id: 'call1',
                            type: 'function',
                            function: {name: 'getWeather', arguments: '{"city":"Paris"}'},
                            encryptedValue: 'opaque'
                        },
                        expect.objectContaining({id: 'call2'}),
                        expect.objectContaining({id: 'call3'})
                    ]
                },
                {id: 'call1-result', role: 'tool', toolCallId: 'call1', content: '{"tempC":18}'},
                {
                    id: 'call2-result',
                    role: 'tool',
                    toolCallId: 'call2',
                    content: 'Timed out.',
                    error: 'Timed out.'
                },
                {
                    id: 'call3-result',
                    role: 'tool',
                    toolCallId: 'call3',
                    content: 'Denied.',
                    error: 'Denied.'
                },
                {
                    id: 'a1-1',
                    role: 'assistant',
                    toolCalls: [expect.objectContaining({id: 'call4'})]
                },
                {id: 'call4-result', role: 'tool', toolCallId: 'call4', content: 'done'}
            ]);
        });

        it('leaves out unfinished tool calls and empty messages', () => {
            const unfinished = new ChatMessage({
                    id: 'a1',
                    role: 'assistant',
                    parts: [toolCall('call1', 0, {state: 'approval-requested'})]
                }),
                pending = new ChatMessage({id: 'a2', role: 'assistant', status: 'pending'});

            const {messages} = new AgUiCodec().encodeRequest(
                request([user('Hi'), unfinished, pending])
            );

            expect(messages).toEqual([{id: 'u1', role: 'user', content: 'Hi'}]);
        });

        it('sends system messages with their text', () => {
            const system = new ChatMessage({id: 's1', role: 'system', content: 'Be brief.'});
            const {messages} = new AgUiCodec().encodeRequest(request([system, user('Hi')]));
            expect(messages[0]).toEqual({id: 's1', role: 'system', content: 'Be brief.'});
        });
    });

    describe('the official request check', () => {
        // The official client warns on what it strips. Keep the test output quiet.
        beforeEach(() => {
            vi.spyOn(console, 'warn').mockImplementation(() => {});
        });

        it('strips fields that AG-UI does not define, with a warning', () => {
            const body = new AgUiCodec({
                context: [{description: 'App.', value: 'v', extra: 1} as any]
            }).encodeRequest(request([user('Hi')]));
            expect(body.context).toEqual([{description: 'App.', value: 'v'}]);
            expect(console.warn).toHaveBeenCalledOnce();
        });

        it('fails a request with a malformed field, naming the field', () => {
            const codec = new AgUiCodec({context: [{description: 'App.', value: 42 as any}]});
            expect(() => codec.encodeRequest(request([user('Hi')]))).toThrow(
                expect.objectContaining({
                    code: 'invalid-request',
                    message: expect.stringMatching(
                        /^Invalid AG-UI request: malformed RunAgentInput: context\.0\.value - /
                    )
                })
            );
        });
    });

    describe('server ids in the history', () => {
        it("sends each message of a reply with the server's id, each result after its call", () => {
            const reply = new ChatMessage({
                    id: 'a1',
                    role: 'assistant',
                    status: 'complete',
                    parts: [
                        {...reasoningPart('k1', 'Weighing it.'), serverId: 'r1'},
                        textPart('k2', 'Checking.', {serverId: 'm1'}),
                        toolCall('c1', 0, {parentServerId: 'm1', resultServerId: 't1'}),
                        textPart('k3', 'Done.', {serverId: 'm2'})
                    ]
                }),
                {messages} = new AgUiCodec().encodeRequest(request([user('Hi'), reply]));

            expect(messages).toEqual([
                {id: 'u1', role: 'user', content: 'Hi'},
                {id: 'r1', role: 'reasoning', content: 'Weighing it.'},
                {
                    id: 'm1',
                    role: 'assistant',
                    content: 'Checking.',
                    toolCalls: [expect.objectContaining({id: 'c1'})]
                },
                {id: 't1', role: 'tool', toolCallId: 'c1', content: 'null'},
                {id: 'm2', role: 'assistant', content: 'Done.'}
            ]);
        });

        it("sends the server's id for a message the server reported one for", () => {
            const question = new ChatMessage({
                    id: 'u1',
                    role: 'user',
                    content: 'Hi',
                    metadata: {serverId: 'srv-u1'}
                }),
                reply = new ChatMessage({
                    id: 'a1',
                    role: 'assistant',
                    status: 'complete',
                    parts: [textPart('k1', 'Hello.')],
                    metadata: {serverId: 'srv-a1'}
                }),
                {messages} = new AgUiCodec().encodeRequest(request([question, reply]));

            expect(messages.map(it => it.id)).toEqual(['srv-u1', 'srv-a1']);
        });

        it('joins a reopened message without a break, and falls back for an id reused later', () => {
            const reply = new ChatMessage({
                    id: 'a1',
                    role: 'assistant',
                    status: 'complete',
                    parts: [
                        textPart('k1', 'Hel', {serverId: 'm1'}),
                        textPart('k2', 'lo.', {serverId: 'm1'}),
                        textPart('k3', 'Again.', {serverId: 'm1', step: 1})
                    ]
                }),
                {messages} = new AgUiCodec().encodeRequest(request([user('Hi'), reply]));

            expect(messages.slice(1)).toEqual([
                {id: 'm1', role: 'assistant', content: 'Hello.'},
                {id: 'a1-1', role: 'assistant', content: 'Again.'}
            ]);
        });
    });

    describe('unique ids in one request', () => {
        it("keeps a reply's server id for the part that names it, not for a step before it", () => {
            const reply = new ChatMessage({
                    id: 'a1',
                    role: 'assistant',
                    status: 'complete',
                    metadata: {serverId: 'M'},
                    parts: [
                        toolCall('c1', 0, {providerExecuted: true}),
                        textPart('k1', 'Answer.', {serverId: 'M', step: 1})
                    ]
                }),
                {messages} = new AgUiCodec().encodeRequest(request([user('Hi'), reply]));

            expect(messages.slice(1).map(it => [it.id, it.role])).toEqual([
                ['a1', 'assistant'],
                ['c1-result', 'tool'],
                ['M', 'assistant']
            ]);
        });

        it('gives reasoning and text that share a server id an id each', () => {
            const reply = new ChatMessage({
                    id: 'a1',
                    role: 'assistant',
                    status: 'complete',
                    parts: [
                        {...reasoningPart('k1', 'Hmm.'), serverId: 'X'},
                        textPart('k2', 'Hi.', {serverId: 'X'})
                    ]
                }),
                {messages} = new AgUiCodec().encodeRequest(request([user('Hi'), reply]));

            expect(messages.slice(1).map(it => [it.id, it.role])).toEqual([
                ['X', 'reasoning'],
                ['a1', 'assistant']
            ]);
        });

        it('gives a server id that two replies reuse to the first only', () => {
            const reply = (id: string, text: string) =>
                    new ChatMessage({
                        id,
                        role: 'assistant',
                        status: 'complete',
                        parts: [textPart(`${id}-t`, text, {serverId: 'msg-1'})]
                    }),
                {messages} = new AgUiCodec().encodeRequest(
                    request([user('Hi'), reply('a1', 'One.'), reply('a2', 'Two.')])
                );

            expect(messages.map(it => it.id)).toEqual(['u1', 'msg-1', 'a2']);
        });
    });

    describe('encodeRequest in server mode', () => {
        it('sends the whole history, with the turn in forwardedProps', () => {
            const earlier = new ChatMessage({id: 'u0', role: 'user', content: 'Earlier'}),
                question = user('Hi'),
                body = new AgUiCodec({forwardedProps: {tenant: 'emea'}}).encodeRequest(
                    request([earlier, question], {
                        historyMode: 'server',
                        newMessages: [question],
                        runOptions: {scope: ['doc-1']}
                    })
                );

            expect(body.messages).toEqual([
                {id: 'u0', role: 'user', content: 'Earlier'},
                {id: 'u1', role: 'user', content: 'Hi'}
            ]);
            expect(body.forwardedProps).toEqual({
                turnId: 'u1',
                trigger: 'submit',
                runOptions: {scope: ['doc-1']},
                tenant: 'emea'
            });
        });

        it('sends the replaced reply on a regenerate, and lets the app override a key', () => {
            const question = user('Hi'),
                body = new AgUiCodec({forwardedProps: () => ({trigger: 'custom'})}).encodeRequest(
                    request([question], {
                        historyMode: 'server',
                        trigger: 'regenerate',
                        newMessages: [question],
                        replacedMessageId: 'a0'
                    })
                );

            expect(body.forwardedProps).toEqual({
                turnId: 'u1',
                trigger: 'custom',
                replacedMessageId: 'a0'
            });
        });

        it('sends the whole reply on a continue step, each tool result after its call', () => {
            const reply = new ChatMessage({
                    id: 'a1',
                    role: 'assistant',
                    status: 'streaming',
                    parts: [
                        {type: 'text', id: 'x-0', step: 0, text: 'Checking.', state: 'done'},
                        toolCall('srv1', 0, {output: 'From the server.', providerExecuted: true}),
                        toolCall('call1', 0, {output: {tempC: 18}})
                    ]
                }),
                {messages} = new AgUiCodec().encodeRequest(
                    request([user('Hi'), reply], {
                        historyMode: 'server',
                        trigger: 'continue',
                        stepIndex: 1,
                        newMessages: [reply]
                    })
                );

            expect(messages).toEqual([
                {id: 'u1', role: 'user', content: 'Hi'},
                {
                    id: 'a1',
                    role: 'assistant',
                    content: 'Checking.',
                    toolCalls: [
                        expect.objectContaining({id: 'srv1'}),
                        expect.objectContaining({id: 'call1'})
                    ]
                },
                {id: 'srv1-result', role: 'tool', toolCallId: 'srv1', content: 'From the server.'},
                {id: 'call1-result', role: 'tool', toolCallId: 'call1', content: '{"tempC":18}'}
            ]);
        });

        it('sends only the new user message with newMessagesOnly', () => {
            const earlier = new ChatMessage({id: 'u0', role: 'user', content: 'Earlier'}),
                question = user('Hi'),
                {messages} = new AgUiCodec({newMessagesOnly: true}).encodeRequest(
                    request([earlier, question], {historyMode: 'server', newMessages: [question]})
                );
            expect(messages).toEqual([{id: 'u1', role: 'user', content: 'Hi'}]);
        });

        it('sends only the client calls of the last step, with their results and parent, with newMessagesOnly', () => {
            const reply = new ChatMessage({
                    id: 'a1',
                    role: 'assistant',
                    status: 'streaming',
                    parts: [
                        textPart('k1', 'Checking.', {serverId: 'm1'}),
                        toolCall('srv1', 0, {output: 'From the server.', providerExecuted: true}),
                        toolCall('call1', 0, {output: {tempC: 18}, parentServerId: 'm1'})
                    ]
                }),
                {messages} = new AgUiCodec({newMessagesOnly: true}).encodeRequest(
                    request([user('Hi'), reply], {
                        historyMode: 'server',
                        trigger: 'continue',
                        stepIndex: 1,
                        newMessages: [reply]
                    })
                );

            expect(messages).toEqual([
                {id: 'm1', role: 'assistant', toolCalls: [expect.objectContaining({id: 'call1'})]},
                {id: 'call1-result', role: 'tool', toolCallId: 'call1', content: '{"tempC":18}'}
            ]);
        });

        it('sends the whole history with newMessagesOnly in client mode', () => {
            const earlier = new ChatMessage({id: 'u0', role: 'user', content: 'Earlier'}),
                question = user('Hi'),
                {messages} = new AgUiCodec({newMessagesOnly: true}).encodeRequest(
                    request([earlier, question], {newMessages: [question]})
                );
            expect(messages).toHaveLength(2);
        });

        it('sends the catalog version with the turn', () => {
            const question = user('Hi'),
                body = new AgUiCodec().encodeRequest(
                    request([question], {
                        historyMode: 'server',
                        newMessages: [question],
                        catalogVersion: 'v1'
                    })
                );
            expect(body.forwardedProps).toEqual({
                turnId: 'u1',
                trigger: 'submit',
                catalogVersion: 'v1'
            });
        });

        it('leaves forwardedProps to the app in client mode', () => {
            const body = new AgUiCodec({forwardedProps: {tenant: 'emea'}}).encodeRequest(
                request([user('Hi')], {runOptions: {scope: ['doc-1']}})
            );
            expect(body.forwardedProps).toEqual({tenant: 'emea'});
        });
    });

    describe('createDecoder', () => {
        // The official client warns on what it strips or drops. Keep the test output quiet.
        beforeEach(() => {
            vi.spyOn(console, 'warn').mockImplementation(() => {});
        });

        it('passes a conforming stream through, in order', () => {
            const stream = [
                STARTED,
                {type: 'TEXT_MESSAGE_START', messageId: 'm1', role: 'assistant'},
                {type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'Hi'},
                {type: 'TEXT_MESSAGE_END', messageId: 'm1'},
                {type: 'STATE_DELTA', delta: []},
                FINISHED
            ];
            expect(decodeAll(stream)).toEqual(stream);
        });

        it('expands chunk events into start, content and end events', () => {
            const events = decodeAll([
                STARTED,
                {type: 'TEXT_MESSAGE_CHUNK', messageId: 'm1', role: 'assistant', delta: 'Hi'},
                {type: 'TEXT_MESSAGE_CHUNK', messageId: 'm1', delta: ' there'},
                FINISHED
            ]);
            expect(events.map(it => it.type)).toEqual([
                'RUN_STARTED',
                'TEXT_MESSAGE_START',
                'TEXT_MESSAGE_CONTENT',
                'TEXT_MESSAGE_CONTENT',
                'TEXT_MESSAGE_END',
                'RUN_FINISHED'
            ]);
        });

        it('drops events of an unknown type and strips unknown fields, with a warning', () => {
            const events = decodeAll([
                STARTED,
                {type: 'SOMETHING_NEW'},
                {delta: 'no type'},
                {...FINISHED, extra: true}
            ]);
            expect(events).toEqual([STARTED, FINISHED]);
            expect(console.warn).toHaveBeenCalledTimes(3);
        });

        it('fails a stream that does not open with RUN_STARTED, coded invalid-stream', () => {
            const decode = new AgUiCodec().createDecoder();
            expect(() =>
                decode({type: 'TEXT_MESSAGE_START', messageId: 'm1', role: 'assistant'})
            ).toThrow(
                expect.objectContaining({
                    name: 'ChatRunError',
                    code: 'invalid-stream',
                    message: "Invalid AG-UI stream: First event must be 'RUN_STARTED'",
                    cause: expect.any(Error)
                })
            );
        });

        it('fails an event with a malformed field, naming the field', () => {
            const decode = new AgUiCodec().createDecoder();
            decode(STARTED);
            decode({type: 'TEXT_MESSAGE_START', messageId: 'm1', role: 'assistant'});
            expect(() =>
                decode({type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 42})
            ).toThrow(/^Invalid AG-UI stream: malformed TEXT_MESSAGE_CONTENT event: delta - /);
        });

        it('fails a run that finishes with a message still open, and every record after', () => {
            const decode = new AgUiCodec().createDecoder();
            decode(STARTED);
            decode({type: 'TEXT_MESSAGE_START', messageId: 'm1', role: 'assistant'});
            expect(() => decode(FINISHED)).toThrow('text messages are still active');
            expect(() => decode(STARTED)).toThrow('text messages are still active');
        });

        it('leaves a stream that ends before RUN_FINISHED for the chat to fail', () => {
            const decode = new AgUiCodec().createDecoder();
            decode(STARTED);
            decode({type: 'TEXT_MESSAGE_START', messageId: 'm1', role: 'assistant'});
            expect(decode.flush()).toEqual([]);
        });
    });
});

//------------------
// Helpers
//------------------
const SCHEMA = {type: 'object', properties: {city: {type: 'string'}}},
    STARTED = {type: 'RUN_STARTED', threadId: 't1', runId: 'r1'},
    FINISHED = {type: 'RUN_FINISHED', threadId: 't1', runId: 'r1'};

function decodeAll(records: PlainObject[]): ChatEvent[] {
    const decode = new AgUiCodec().createDecoder();
    return [...records.flatMap(it => decode(it)), ...decode.flush()];
}

function request(messages: ChatMessage[], changes: Partial<ChatRunRequest> = {}): ChatRunRequest {
    return {
        threadId: 't1',
        runId: 'r1',
        historyMode: 'client',
        trigger: 'submit',
        turnId: findLast(messages, it => it.isUser)?.id ?? null,
        stepIndex: 0,
        messages,
        newMessages: [],
        replacedMessageId: null,
        runOptions: null,
        catalogVersion: null,
        tools: [],
        context: [],
        signal: new AbortController().signal,
        ...changes
    };
}

function user(text: string): ChatMessage {
    return new ChatMessage({id: 'u1', role: 'user', content: text});
}

function toolCall(id: string, step: number, changes: Partial<ChatToolCallPart> = {}): ChatPart {
    return {
        type: 'toolCall',
        id,
        step,
        toolName: 'getWeather',
        state: 'output-available',
        inputText: '{"city":"Paris"}',
        input: {city: 'Paris'},
        output: null,
        errorText: null,
        ...changes
    };
}

function textPart(id: string, text: string, changes: Partial<ChatTextPart> = {}): ChatTextPart {
    return {type: 'text', id, step: 0, text, state: 'done', ...changes};
}

function reasoningPart(id: string, text: string): ChatReasoningPart {
    return {type: 'reasoning', id, step: 0, text, state: 'done', startedAt: 0, endedAt: 0};
}
