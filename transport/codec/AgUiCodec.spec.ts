import {findLast} from 'lodash';
import {describe, expect, it} from 'vitest';
import {ChatMessage, type ChatPart, type ChatToolCallPart} from '../../core';
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

    describe('encodeRequest in server mode', () => {
        it('sends only the new user message, with the turn in forwardedProps', () => {
            const earlier = new ChatMessage({id: 'u0', role: 'user', content: 'Earlier'}),
                question = user('Hi'),
                body = new AgUiCodec({forwardedProps: {tenant: 'emea'}}).encodeRequest(
                    request([earlier, question], {
                        historyMode: 'server',
                        newMessages: [question],
                        runOptions: {scope: ['doc-1']}
                    })
                );

            expect(body.messages).toEqual([{id: 'u1', role: 'user', content: 'Hi'}]);
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

        it('sends the last step of the reply, with its tool results, on a continue step', () => {
            const reply = new ChatMessage({
                    id: 'a1',
                    role: 'assistant',
                    status: 'streaming',
                    parts: [
                        {type: 'text', id: 'x-0', step: 0, text: 'Checking.', state: 'done'},
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
                {
                    id: 'a1',
                    role: 'assistant',
                    content: 'Checking.',
                    toolCalls: [expect.objectContaining({id: 'call1'})]
                },
                {id: 'call1-result', role: 'tool', toolCallId: 'call1', content: '{"tempC":18}'}
            ]);
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
        it('passes known events through unchanged and drops unknown records', () => {
            const decode = new AgUiCodec().createDecoder(),
                content = {type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'Hi'},
                state = {type: 'STATE_DELTA', delta: []};

            expect(decode(content)).toEqual([content]);
            expect(decode(state)).toEqual([state]);
            expect(decode({type: 'SOMETHING_NEW'})).toEqual([]);
            expect(decode({delta: 'no type'})).toEqual([]);
        });
    });
});

//------------------
// Helpers
//------------------
const SCHEMA = {type: 'object', properties: {city: {type: 'string'}}};

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
