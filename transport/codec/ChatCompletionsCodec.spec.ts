import {findLast} from 'lodash';
import type {PlainObject} from '@xh/hoist/core';
import {hoistCore, initTestAppAsync} from '@xh/hoist/test-support';
import {beforeAll, describe, expect, it} from 'vitest';
import {ChatMessage, type ChatPart, type ChatToolCallPart} from '../../core';
import {ChatStreamReducer} from '../../core/ChatStreamReducer';
import type {ChatEvent} from '../ChatEvent';
import type {ChatRunRequest} from '../ChatTransport';
import {SseChatTransport} from '../SseChatTransport';
import {ChatCompletionsCodec} from './ChatCompletionsCodec';

/**
 * ChatCompletionsCodec is the bring your own LLM seam: most enterprise gateways speak the OpenAI
 * chat completions format. Requests must rebuild the history as the API expects - every
 * `tool_calls` entry answered by a `tool` message - or the next call fails. Decoding must turn
 * the chunk stream, with tool calls split into fragments by index, into the kit's parts, and
 * finish each step even though the `[DONE]` sentinel never reaches the codec.
 */
describe('ChatCompletionsCodec', () => {
    beforeAll(async () => {
        await initTestAppAsync();
    });

    describe('encodeRequest', () => {
        it('builds a streaming body with a system message, the messages, tools and usage', async () => {
            const codec = new ChatCompletionsCodec({
                    system: 'Be brief.',
                    model: 'gpt-test',
                    params: {temperature: 0.2}
                }),
                body = await codec.encodeRequest(
                    request([user('Hi')], {
                        tools: [{name: 'getWeather', description: 'Weather.', parameters: SCHEMA}]
                    })
                );

            expect(body).toEqual({
                model: 'gpt-test',
                temperature: 0.2,
                messages: [
                    {role: 'system', content: 'Be brief.'},
                    {role: 'user', content: 'Hi'}
                ],
                tools: [
                    {
                        type: 'function',
                        function: {name: 'getWeather', description: 'Weather.', parameters: SCHEMA}
                    }
                ],
                stream: true,
                stream_options: {include_usage: true}
            });
        });

        it('leaves out the model, tools and usage request when not wanted', async () => {
            const body = await new ChatCompletionsCodec({includeUsage: false}).encodeRequest(
                request([user('Hi')])
            );
            expect(body).toEqual({messages: [{role: 'user', content: 'Hi'}], stream: true});
        });

        it('sends the context of a user message after its text', async () => {
            const question = new ChatMessage({
                    role: 'user',
                    content: 'Why did it drop?',
                    metadata: {context: {ticker: 'XYZ'}}
                }),
                body = await new ChatCompletionsCodec().encodeRequest(request([question]));

            expect(body.messages).toEqual([
                {
                    role: 'user',
                    content:
                        'Why did it drop?\n\n<message-context>\n{"ticker":"XYZ"}\n</message-context>'
                }
            ]);
        });

        it('builds the system prompt per call, then system messages, and sends live context last', async () => {
            const codec = new ChatCompletionsCodec({system: async req => `Run ${req.runId}.`}),
                system = new ChatMessage({role: 'system', content: 'Use metric units.'}),
                body = await codec.encodeRequest(
                    request([system, user('Hi')], {
                        context: [
                            {name: 'grid', description: 'The grid.', value: {sortBy: ['name']}},
                            {name: 'note', description: null, value: 'Plain text.'}
                        ]
                    })
                );

            expect(body.messages).toEqual([
                {role: 'system', content: 'Run r1.\n\nUse metric units.'},
                {role: 'user', content: 'Hi'},
                {
                    role: 'user',
                    content:
                        '<context name="grid">\nThe grid.\n{"sortBy":["name"]}\n</context>\n\n' +
                        '<context name="note">\nPlain text.\n</context>'
                }
            ]);
        });

        it('sends tool calls from a decoded stream back as tool_calls with tool messages', async () => {
            const reply = reduce(PARALLEL_TOOL_STREAM),
                [paris, tokyo] = reply.toolCalls,
                answered = reply.withChanges({
                    parts: reply.parts.map(part =>
                        part.id === paris.id
                            ? {...part, state: 'output-available', output: {tempC: 18}}
                            : part.id === tokyo.id
                              ? {...part, state: 'output-error', errorText: 'No such city.'}
                              : part
                    ) as ChatPart[]
                }),
                body = await new ChatCompletionsCodec().encodeRequest(
                    request([user('Weather?'), answered])
                );

            expect(body.messages).toEqual([
                {role: 'user', content: 'Weather?'},
                {
                    role: 'assistant',
                    content: 'Checking both.',
                    tool_calls: [
                        {
                            id: 'call_paris',
                            type: 'function',
                            function: {name: 'getWeather', arguments: '{"city":"Paris"}'}
                        },
                        {
                            id: 'call_tokyo',
                            type: 'function',
                            function: {name: 'getWeather', arguments: '{"city":"Tokyo"}'}
                        }
                    ]
                },
                {role: 'tool', tool_call_id: 'call_paris', content: '{"tempC":18}'},
                {role: 'tool', tool_call_id: 'call_tokyo', content: 'Error: No such city.'}
            ]);
        });

        it('sends each step of a turn as its own assistant message, with no reasoning', async () => {
            const reply = new ChatMessage({
                    role: 'assistant',
                    parts: [
                        {
                            type: 'reasoning',
                            id: 'r',
                            step: 0,
                            text: 'Hmm.',
                            state: 'done',
                            startedAt: 1,
                            endedAt: 2
                        },
                        toolCall('c1', 0, {
                            state: 'output-denied',
                            errorText: 'The user denied this tool call.'
                        }),
                        {type: 'text', id: 't', step: 1, text: 'Understood.', state: 'done'}
                    ]
                }),
                body = await new ChatCompletionsCodec().encodeRequest(request([user('Go'), reply]));

            expect(body.messages).toEqual([
                {role: 'user', content: 'Go'},
                {
                    role: 'assistant',
                    content: null,
                    tool_calls: [
                        {
                            id: 'c1',
                            type: 'function',
                            function: {name: 'getWeather', arguments: '{"city":"Paris"}'}
                        }
                    ]
                },
                {role: 'tool', tool_call_id: 'c1', content: 'The user denied this tool call.'},
                {role: 'assistant', content: 'Understood.'}
            ]);
        });

        it('sends images, PDFs and text files as parts, and names other attachments', async () => {
            const message = new ChatMessage({
                    role: 'user',
                    parts: [
                        file('a.png', 'image/png', {data: 'iVBO'}),
                        file('b.jpg', 'image/jpeg', {url: 'https://x.io/b.jpg'}),
                        file('c.pdf', 'application/pdf', {data: 'JVBE'}),
                        file('d.json', 'application/json', {data: btoa('{"a":1}')}),
                        file('e.zip', 'application/zip', {data: 'UEsD'}),
                        {type: 'text', id: 't', text: 'What are these?', state: 'done'}
                    ]
                }),
                body = await new ChatCompletionsCodec().encodeRequest(request([message]));

            expect(body.messages[0].content).toEqual([
                {type: 'image_url', image_url: {url: 'data:image/png;base64,iVBO'}},
                {type: 'image_url', image_url: {url: 'https://x.io/b.jpg'}},
                {
                    type: 'file',
                    file: {filename: 'c.pdf', file_data: 'data:application/pdf;base64,JVBE'}
                },
                {type: 'text', text: '<file name="d.json">\n{"a":1}\n</file>'},
                {
                    type: 'text',
                    text: "[Attachment 'e.zip' (application/zip) not sent - the model cannot read this file type.]"
                },
                {type: 'text', text: 'What are these?'}
            ]);
        });

        it('passes the finished body through prepareBody', async () => {
            const codec = new ChatCompletionsCodec({
                    prepareBody: (body, req) => ({...body, user: req.threadId})
                }),
                body = await codec.encodeRequest(request([user('Hi')]));
            expect(body.user).toBe('t1');
        });

        it('throws for a chat in server mode, which sends no history', async () => {
            await expect(
                new ChatCompletionsCodec().encodeRequest(
                    request([user('Hi')], {historyMode: 'server'})
                )
            ).rejects.toThrow("historyMode 'server'");
        });
    });

    describe('createDecoder', () => {
        it('streams text, and finishes once, with the usage of the chunk after the finish reason', () => {
            const events = decode(TEXT_STREAM);

            expect(events).toEqual([
                {type: 'RUN_STARTED', threadId: 't1', runId: 'r1'},
                {type: 'TEXT_MESSAGE_START', messageId: expect.any(String), role: 'assistant'},
                {type: 'TEXT_MESSAGE_CONTENT', messageId: expect.any(String), delta: 'Hello'},
                {type: 'TEXT_MESSAGE_CONTENT', messageId: expect.any(String), delta: ' there.'},
                {type: 'TEXT_MESSAGE_END', messageId: expect.any(String)},
                {
                    type: 'RUN_FINISHED',
                    threadId: 't1',
                    runId: 'r1',
                    metadata: {finishReason: 'stop', stopReason: 'stop', model: 'gpt-test'},
                    usage: [
                        {
                            model: 'gpt-test',
                            inputTokens: 20,
                            outputTokens: 4,
                            totalTokens: 24,
                            reasoningTokens: 0,
                            cachedInputTokens: 16
                        }
                    ]
                }
            ]);

            const message = reduce(TEXT_STREAM);
            expect(message.text).toBe('Hello there.');
            expect(message.metadata).toMatchObject({finishReason: 'stop', stopReason: 'stop'});
            expect(message.metadata.usage).toEqual([expect.objectContaining({totalTokens: 24})]);
        });

        it('assembles parallel tool calls from fragments split across chunks', () => {
            const message = reduce(PARALLEL_TOOL_STREAM);

            expect(message.text).toBe('Checking both.');
            expect(message.toolCalls).toMatchObject([
                {id: 'call_paris', toolName: 'getWeather', input: {city: 'Paris'}},
                {id: 'call_tokyo', toolName: 'getWeather', input: {city: 'Tokyo'}}
            ]);
            expect(message.toolCalls.map(it => it.state)).toEqual([
                'input-available',
                'input-available'
            ]);
            expect(message.metadata.finishReason).toBe('tool-calls');
        });

        it.each([
            ['stop', 'stop'],
            ['length', 'length'],
            ['tool_calls', 'tool-calls'],
            ['function_call', 'tool-calls'],
            ['content_filter', 'content-filter'],
            ['something_new', 'other']
        ])('maps finish reason %s to %s', (finishReason, expected) => {
            const events = decode([chunk({content: 'Hi'}), chunk({}, finishReason)]),
                finished = findLast(events, it => it.type === 'RUN_FINISHED');
            expect(finished).toMatchObject({metadata: {finishReason: expected}});
        });

        it('reads usage sent with the finish reason, and ignores a repeat of it', () => {
            const usage = {prompt_tokens: 5, completion_tokens: 2, total_tokens: 7},
                message = reduce([
                    chunk({content: 'Hi'}),
                    {...chunk({}, 'stop'), usage},
                    {...chunk(null), usage}
                ]);
            expect(message.metadata.usage).toEqual([
                {model: 'gpt-test', inputTokens: 5, outputTokens: 2, totalTokens: 7}
            ]);
        });

        it('finishes at the end of a stream whose usage chunk never comes', () => {
            const stream = [chunk({content: 'Hi'}), chunk({}, 'stop')],
                decoder = new ChatCompletionsCodec().createDecoder(request([]));

            expect(stream.flatMap(raw => decoder(raw)).map(it => it.type)).not.toContain(
                'RUN_FINISHED'
            );
            expect(decoder.flush()).toEqual([
                {
                    type: 'RUN_FINISHED',
                    threadId: 't1',
                    runId: 'r1',
                    metadata: {finishReason: 'stop', stopReason: 'stop', model: 'gpt-test'}
                }
            ]);
            expect(decoder.flush()).toEqual([]);
            expect(reduce(stream).status).not.toBe('error');
        });

        it('finishes on the finish reason when it asks for no usage', () => {
            const decoder = new ChatCompletionsCodec({includeUsage: false}).createDecoder(
                request([])
            );
            expect(decoder(chunk({}, 'stop')).at(-1)).toMatchObject({type: 'RUN_FINISHED'});
            expect(decoder.flush()).toEqual([]);
        });

        it('decodes reasoning_content as reasoning, and a refusal as text', () => {
            const message = reduce([
                chunk({role: 'assistant', reasoning_content: 'Think'}),
                chunk({reasoning_content: 'ing.'}),
                chunk({refusal: 'I cannot help with that.'}),
                chunk({}, 'stop')
            ]);

            expect(message.parts.map(it => it.type)).toEqual(['reasoning', 'text']);
            expect(message.parts[0]).toMatchObject({text: 'Thinking.', state: 'done'});
            expect(message.text).toBe('I cannot help with that.');
        });

        it('turns an error record into RUN_ERROR, with its code or type', () => {
            expect(
                decode([
                    chunk({content: 'Partial'}),
                    {
                        error: {
                            message: 'Rate limited.',
                            type: 'requests',
                            code: 'rate_limit_exceeded'
                        }
                    }
                ]).at(-1)
            ).toEqual({type: 'RUN_ERROR', message: 'Rate limited.', code: 'rate_limit_exceeded'});

            expect(decode([{error: {message: 'Boom', type: 'server_error', code: null}}])).toEqual([
                {type: 'RUN_ERROR', message: 'Boom', code: 'server_error'}
            ]);
        });

        it.each([
            ['with', TEXT_STREAM],
            ['without', TEXT_STREAM.slice(0, -1)]
        ])(
            'decodes an SSE stream %s a usage chunk, through SseChatTransport, to one finish',
            async (_, stream) => {
                const body = stream.map(it => `data: ${JSON.stringify(it)}\n\n`).join('');
                hoistCore.route(
                    'POST',
                    'llm/openai',
                    () =>
                        new Response(`${body}data: [DONE]\n\n`, {
                            headers: {'Content-Type': 'text/event-stream'}
                        })
                );

                const transport = new SseChatTransport({
                        url: 'llm/openai',
                        codec: new ChatCompletionsCodec({system: 'Be brief.'})
                    }),
                    events: ChatEvent[] = [];
                for await (const event of transport.run(request([user('Hi')]))) events.push(event);

                expect(events.map(it => it.type)).toEqual([
                    'RUN_STARTED',
                    'TEXT_MESSAGE_START',
                    'TEXT_MESSAGE_CONTENT',
                    'TEXT_MESSAGE_CONTENT',
                    'TEXT_MESSAGE_END',
                    'RUN_FINISHED'
                ]);
                const [req] = hoistCore.requestsTo('llm/openai');
                expect(req.json.messages[0]).toEqual({role: 'system', content: 'Be brief.'});
            }
        );
    });
});

//------------------
// Recorded streams
//------------------
/** A `chat.completion.chunk` with one choice - or none, for a usage chunk. */
function chunk(
    delta: PlainObject,
    finishReason: string = null,
    choices?: PlainObject[]
): PlainObject {
    return {
        id: 'chatcmpl-1',
        object: 'chat.completion.chunk',
        created: 1791997893,
        model: 'gpt-test',
        choices:
            choices ??
            (delta ? [{index: 0, delta, logprobs: null, finish_reason: finishReason}] : []),
        usage: null
    };
}

const TEXT_STREAM: PlainObject[] = [
    chunk({role: 'assistant', content: '', refusal: null}),
    chunk({content: 'Hello'}),
    chunk({content: ' there.'}),
    chunk({}, 'stop'),
    {
        ...chunk(null),
        usage: {
            prompt_tokens: 20,
            completion_tokens: 4,
            total_tokens: 24,
            prompt_tokens_details: {cached_tokens: 16, audio_tokens: 0},
            completion_tokens_details: {reasoning_tokens: 0, audio_tokens: 0}
        }
    }
];

/** Text, then two calls: ids and names in each first fragment, arguments split by index. */
const PARALLEL_TOOL_STREAM: PlainObject[] = [
    chunk({role: 'assistant', content: 'Checking both.'}),
    chunk({
        tool_calls: [
            {
                index: 0,
                id: 'call_paris',
                type: 'function',
                function: {name: 'getWeather', arguments: ''}
            }
        ]
    }),
    chunk({tool_calls: [{index: 0, function: {arguments: '{"ci'}}]}),
    chunk({
        tool_calls: [
            {
                index: 1,
                id: 'call_tokyo',
                type: 'function',
                function: {name: 'getWeather', arguments: '{"city":'}
            }
        ]
    }),
    chunk({tool_calls: [{index: 0, function: {arguments: 'ty":"Paris"}'}}]}),
    chunk({tool_calls: [{index: 1, function: {arguments: '"Tokyo"}'}}]}),
    chunk({}, 'tool_calls')
];

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

function user(content: string): ChatMessage {
    return new ChatMessage({role: 'user', content});
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

function file(name: string, mediaType: string, source: {data?: string; url?: string}): ChatPart {
    return {type: 'file', id: name, name, mediaType, ...source};
}

/** Decode a recorded stream - the `data` of each SSE event, in order - then flush the decoder. */
function decode(stream: PlainObject[]): ChatEvent[] {
    const decoder = new ChatCompletionsCodec().createDecoder(request([]));
    return [...stream.flatMap(raw => decoder(raw)), ...decoder.flush()];
}

/** Decode a recorded stream and reduce it into an assistant message, as ChatModel does. */
function reduce(stream: PlainObject[]): ChatMessage {
    const reducer = new ChatStreamReducer(0),
        message = new ChatMessage({role: 'assistant', status: 'pending'});
    return reducer.finish(reducer.apply(message, decode(stream)));
}
