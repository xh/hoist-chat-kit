import type {PlainObject} from '@xh/hoist/core';
import {describe, expect, it} from 'vitest';
import {
    ChatMessage,
    type ChatPart,
    type ChatReasoningPart,
    type ChatTextPart,
    type ChatToolCallPart
} from '../../core';
import {ChatStreamReducer} from '../../core/impl/ChatStreamReducer';
import type {ChatEvent} from '../ChatEvent';
import type {ChatRunRequest} from '../ChatTransport';
import {AnthropicCodec} from './AnthropicCodec';

/**
 * AnthropicCodec lets a Hoist server relay Claude's stream with no translation of its own, so it
 * owns two contracts the API enforces strictly. Requests must rebuild the history exactly as
 * Anthropic expects - alternating turns, every tool_use answered, thinking signatures intact - or
 * the next call fails with a 400. Decoding must turn Anthropic's block stream into the kit's
 * parts without losing what the next request has to send back.
 */
describe('AnthropicCodec', () => {
    describe('encodeRequest', () => {
        it('builds a streaming Messages API body with model, system, messages and tools', async () => {
            const codec = new AnthropicCodec({
                    system: 'Be brief.',
                    model: 'claude-opus-5-5',
                    maxTokens: 16000,
                    params: {
                        thinking: {type: 'adaptive'},
                        tools: [{type: 'web_search_20260209', name: 'web_search'}]
                    }
                }),
                body = await codec.encodeRequest(
                    request([user('Hi')], {
                        tools: [{name: 'getWeather', description: 'Weather.', parameters: SCHEMA}]
                    })
                );

            expect(body).toEqual({
                model: 'claude-opus-5-5',
                max_tokens: 16000,
                system: 'Be brief.',
                thinking: {type: 'adaptive'},
                messages: [{role: 'user', content: [{type: 'text', text: 'Hi'}]}],
                tools: [
                    {type: 'web_search_20260209', name: 'web_search'},
                    {name: 'getWeather', description: 'Weather.', input_schema: SCHEMA}
                ],
                stream: true
            });
        });

        it('leaves out the model, token limit and tools when the server owns them', async () => {
            const body = await encode(new AnthropicCodec(), [user('Hi')]);
            expect(Object.keys(body).sort()).toEqual(['messages', 'stream']);
        });

        it('builds the system prompt per call, appending system messages from the history', async () => {
            const codec = new AnthropicCodec({system: async req => `Run ${req.runId}.`}),
                system = new ChatMessage({role: 'system', content: 'Use metric units.'});

            const body = await encode(codec, [system, user('Hi')]);

            expect(body.system).toBe('Run r1.\n\nUse metric units.');
            expect(body.messages).toHaveLength(1);
        });

        it('sends a system prompt given as blocks, with system messages as further blocks', async () => {
            const codec = new AnthropicCodec({
                    system: () => [
                        {type: 'text', text: 'Static.'},
                        {type: 'text', text: 'Live.'}
                    ]
                }),
                system = new ChatMessage({role: 'system', content: 'Use metric units.'});

            const body = await encode(codec, [system, user('Hi')]);

            expect(body.system).toEqual([
                {type: 'text', text: 'Static.'},
                {type: 'text', text: 'Live.'},
                {type: 'text', text: 'Use metric units.'}
            ]);
        });

        it('takes the system prompt from params only when none is configured', async () => {
            const params = {system: 'From params.'};

            expect((await encode(new AnthropicCodec({params}), [user('Hi')])).system).toBe(
                'From params.'
            );
            expect(
                (await encode(new AnthropicCodec({params, system: 'Configured.'}), [user('Hi')]))
                    .system
            ).toBe('Configured.');
        });

        it('marks cache breakpoints on the last system block and the last tool', async () => {
            const codec = new AnthropicCodec({
                    system: 'Be brief.',
                    cacheControl: true,
                    params: {tools: [{type: 'web_search_20260209', name: 'web_search'}]}
                }),
                body = await codec.encodeRequest(
                    request([user('Hi')], {tools: [{name: 'getWeather', parameters: SCHEMA}]})
                );

            expect(body.system).toEqual([
                {type: 'text', text: 'Be brief.', cache_control: {type: 'ephemeral'}}
            ]);
            expect(body.tools).toEqual([
                {type: 'web_search_20260209', name: 'web_search'},
                {name: 'getWeather', input_schema: SCHEMA, cache_control: {type: 'ephemeral'}}
            ]);
        });

        it('keeps a breakpoint the app placed on its own system block', async () => {
            const marked = {type: 'text', text: 'Static.', cache_control: {type: 'ephemeral'}},
                codec = new AnthropicCodec({system: [marked], cacheControl: true});

            expect((await encode(codec, [user('Hi')])).system).toEqual([marked]);
        });

        it('passes the finished body through prepareBody', async () => {
            const codec = new AnthropicCodec({
                    model: 'claude-opus-5-5',
                    prepareBody: async (body, req) => ({...body, metadata: {user_id: req.threadId}})
                }),
                body = await encode(codec, [user('Hi')]);

            expect(body).toMatchObject({model: 'claude-opus-5-5', metadata: {user_id: 't1'}});
        });

        it('throws a clear error rather than encode a request with no user content', async () => {
            const greeting = new ChatMessage({role: 'assistant', content: 'How can I help?'});
            await expect(encode(new AnthropicCodec(), [greeting])).rejects.toThrow(
                'no user content'
            );
        });

        it('splits an assistant turn into assistant and tool_result turns per step', async () => {
            const assistant = new ChatMessage({
                role: 'assistant',
                parts: [
                    reasoning('Check both cities.', 'sig-1', 0),
                    text('Checking.', 0),
                    toolCall('call1', 0, {output: {tempC: 18}}),
                    toolCall('call2', 0, {state: 'output-denied', errorText: 'Denied.'}),
                    text('Paris is 18°C.', 1)
                ]
            });

            const {messages} = await encode(new AnthropicCodec(), [
                user('Weather?'),
                assistant,
                user('Thanks')
            ]);

            expect(messages).toEqual([
                {role: 'user', content: [{type: 'text', text: 'Weather?'}]},
                {
                    role: 'assistant',
                    content: [
                        {type: 'thinking', thinking: 'Check both cities.', signature: 'sig-1'},
                        {type: 'text', text: 'Checking.'},
                        {type: 'tool_use', id: 'call1', name: 'getWeather', input: {city: 'Paris'}},
                        {type: 'tool_use', id: 'call2', name: 'getWeather', input: {city: 'Paris'}}
                    ]
                },
                {
                    role: 'user',
                    content: [
                        {type: 'tool_result', tool_use_id: 'call1', content: '{"tempC":18}'},
                        {
                            type: 'tool_result',
                            tool_use_id: 'call2',
                            content: 'Denied.',
                            is_error: true
                        }
                    ]
                },
                {role: 'assistant', content: [{type: 'text', text: 'Paris is 18°C.'}]},
                {role: 'user', content: [{type: 'text', text: 'Thanks'}]}
            ]);
        });

        it('ends a follow-up step with the tool results of the turn in progress', async () => {
            const inProgress = new ChatMessage({
                role: 'assistant',
                status: 'streaming',
                parts: [toolCall('call1', 0, {state: 'output-error', errorText: 'Failed.'})]
            });

            const {messages} = await encode(new AnthropicCodec(), [user('Weather?'), inProgress]);

            expect(messages.at(-1)).toEqual({
                role: 'user',
                content: [
                    {type: 'tool_result', tool_use_id: 'call1', content: 'Failed.', is_error: true}
                ]
            });
        });

        it('puts the tool results of a closed turn ahead of the next user text', async () => {
            const closed = new ChatMessage({
                role: 'assistant',
                parts: [toolCall('call1', 0, {state: 'output-denied', errorText: 'Moved on.'})]
            });

            const {messages} = await encode(new AnthropicCodec(), [
                user('Delete it'),
                closed,
                user('Never mind')
            ]);

            expect(messages.at(-1)).toEqual({
                role: 'user',
                content: [
                    {
                        type: 'tool_result',
                        tool_use_id: 'call1',
                        content: 'Moved on.',
                        is_error: true
                    },
                    {type: 'text', text: 'Never mind'}
                ]
            });
        });

        it('leaves out empty, pending and leading assistant messages, and unfinished calls', async () => {
            const greeting = new ChatMessage({role: 'assistant', content: 'How can I help?'}),
                unfinished = new ChatMessage({
                    role: 'assistant',
                    parts: [
                        reasoning('No signature - interrupted.', null, 0),
                        text('  ', 0),
                        toolCall('call1', 0, {state: 'approval-requested'})
                    ]
                }),
                pending = new ChatMessage({role: 'assistant', status: 'pending'});

            const {messages} = await encode(new AnthropicCodec(), [
                greeting,
                user('Hi'),
                unfinished,
                pending
            ]);

            expect(messages).toEqual([{role: 'user', content: [{type: 'text', text: 'Hi'}]}]);
        });

        it('sends images, PDFs and text files as content blocks ahead of the text', async () => {
            const message = new ChatMessage({
                role: 'user',
                parts: [
                    text('Summarize these.'),
                    file('photo.png', 'image/png', {data: 'iVBO'}),
                    file('report.pdf', 'application/pdf', {url: 'https://x/report.pdf'}),
                    file('notes.txt', 'text/plain', {data: base64Utf8('Ünïcode notes')}),
                    file('data.json', 'application/json', {data: base64Utf8('{"a": 1}')})
                ]
            });

            const [{content}] = (await encode(new AnthropicCodec(), [message])).messages;

            expect(content).toEqual([
                {type: 'image', source: {type: 'base64', media_type: 'image/png', data: 'iVBO'}},
                {
                    type: 'document',
                    title: 'report.pdf',
                    source: {type: 'url', url: 'https://x/report.pdf'}
                },
                {
                    type: 'document',
                    title: 'notes.txt',
                    source: {type: 'text', media_type: 'text/plain', data: 'Ünïcode notes'}
                },
                {
                    type: 'document',
                    title: 'data.json',
                    source: {type: 'text', media_type: 'text/plain', data: '{"a": 1}'}
                },
                {type: 'text', text: 'Summarize these.'}
            ]);
        });

        it('names an attachment the API cannot take, so the model knows it was left out', async () => {
            const message = new ChatMessage({
                role: 'user',
                parts: [file('data.xlsx', 'application/vnd.ms-excel', {data: 'UEsD'})]
            });

            const {messages} = await encode(new AnthropicCodec(), [message]);

            expect(messages).toEqual([
                {
                    role: 'user',
                    content: [
                        {
                            type: 'text',
                            text: "[Attachment 'data.xlsx' (application/vnd.ms-excel) not sent - the model cannot read this file type.]"
                        }
                    ]
                }
            ]);
        });

        it('sends a backend tool call with its result, and drops one that never got a result', async () => {
            const assistant = new ChatMessage({
                role: 'assistant',
                parts: [
                    toolCall('call1', 0, {
                        providerExecuted: true,
                        output: 'found',
                        encryptedValue: 'sig-from-another-backend'
                    }),
                    toolCall('srvtoolu_2', 0, {
                        providerExecuted: true,
                        state: 'output-error',
                        errorText: 'No result.'
                    })
                ]
            });

            const {messages} = await encode(new AnthropicCodec(), [user('Search'), assistant]);

            expect(messages.slice(1)).toEqual([
                {
                    role: 'assistant',
                    content: [
                        {type: 'tool_use', id: 'call1', name: 'getWeather', input: {city: 'Paris'}}
                    ]
                },
                {
                    role: 'user',
                    content: [{type: 'tool_result', tool_use_id: 'call1', content: 'found'}]
                }
            ]);
        });
    });

    describe('createDecoder', () => {
        it('decodes a text stream, with usage and the finish reason on RUN_FINISHED', () => {
            const events = decode([
                messageStart({input_tokens: 25, cache_read_input_tokens: 100, output_tokens: 1}),
                {type: 'content_block_start', index: 0, content_block: {type: 'text', text: ''}},
                {type: 'ping'},
                textDelta(0, 'Hello'),
                textDelta(0, '!'),
                {type: 'content_block_stop', index: 0},
                messageDelta('end_turn', {output_tokens: 15}),
                {type: 'message_stop'}
            ]);

            expect(events).toEqual([
                {type: 'RUN_STARTED', threadId: 't1', runId: 'r1'},
                {type: 'TEXT_MESSAGE_START', messageId: 'text-0', role: 'assistant'},
                {type: 'TEXT_MESSAGE_CONTENT', messageId: 'text-0', delta: 'Hello'},
                {type: 'TEXT_MESSAGE_CONTENT', messageId: 'text-0', delta: '!'},
                {type: 'TEXT_MESSAGE_END', messageId: 'text-0'},
                {
                    type: 'RUN_FINISHED',
                    threadId: 't1',
                    runId: 'r1',
                    metadata: {
                        finishReason: 'stop',
                        stopReason: 'end_turn',
                        model: 'claude-opus-5-5'
                    },
                    usage: [
                        {
                            provider: 'anthropic',
                            model: 'claude-opus-5-5',
                            inputTokens: 125,
                            outputTokens: 15,
                            totalTokens: 140,
                            cachedInputTokens: 100,
                            cacheWriteInputTokens: 0
                        }
                    ]
                }
            ]);
        });

        it.each([
            ['end_turn', 'stop'],
            ['stop_sequence', 'stop'],
            ['max_tokens', 'length'],
            ['model_context_window_exceeded', 'length'],
            ['tool_use', 'tool-calls'],
            ['refusal', 'content-filter'],
            ['pause_turn', 'other']
        ])('reports stop reason %s as finish reason %s', (stopReason, finishReason) => {
            const events = decode([
                messageStart(),
                messageDelta(stopReason),
                {type: 'message_stop'}
            ]);
            expect(events.at(-1)).toMatchObject({metadata: {finishReason, stopReason}});
        });

        it('streams tool calls, with their input as argument fragments', () => {
            const message = reduce([
                messageStart(),
                {type: 'content_block_start', index: 0, content_block: {type: 'text', text: ''}},
                textDelta(0, 'Let me check.'),
                {type: 'content_block_stop', index: 0},
                {
                    type: 'content_block_start',
                    index: 1,
                    content_block: {type: 'tool_use', id: 'toolu_1', name: 'getWeather', input: {}}
                },
                jsonDelta(1, ''),
                jsonDelta(1, '{"city":'),
                jsonDelta(1, ' "Paris"}'),
                {type: 'content_block_stop', index: 1},
                messageDelta('tool_use'),
                {type: 'message_stop'}
            ]);

            expect(message.parts).toMatchObject([
                {type: 'text', text: 'Let me check.', state: 'done'},
                {
                    type: 'toolCall',
                    id: 'toolu_1',
                    toolName: 'getWeather',
                    state: 'input-available',
                    inputText: '{"city": "Paris"}',
                    input: {city: 'Paris'}
                }
            ]);
            expect(message.metadata.finishReason).toBe('tool-calls');
        });

        it('keeps thinking signatures and redacted thinking for the next request', async () => {
            const message = reduce([
                messageStart(),
                {
                    type: 'content_block_start',
                    index: 0,
                    content_block: {type: 'thinking', thinking: '', signature: ''}
                },
                {
                    type: 'content_block_delta',
                    index: 0,
                    delta: {type: 'thinking_delta', thinking: 'GCD is '}
                },
                {
                    type: 'content_block_delta',
                    index: 0,
                    delta: {type: 'thinking_delta', thinking: '21.'}
                },
                {
                    type: 'content_block_delta',
                    index: 0,
                    delta: {type: 'signature_delta', signature: 'EqQB'}
                },
                {type: 'content_block_stop', index: 0},
                {
                    type: 'content_block_start',
                    index: 1,
                    content_block: {type: 'redacted_thinking', data: 'EmwKAhgB'}
                },
                {type: 'content_block_stop', index: 1},
                {type: 'content_block_start', index: 2, content_block: {type: 'text', text: ''}},
                textDelta(2, 'It is **21**.'),
                {type: 'content_block_stop', index: 2},
                messageDelta('end_turn'),
                {type: 'message_stop'}
            ]);

            const [thinking, redacted] = message.parts as ChatReasoningPart[];
            expect(thinking).toMatchObject({
                type: 'reasoning',
                text: 'GCD is 21.',
                state: 'done',
                encryptedValue: 'EqQB'
            });
            expect(redacted).toMatchObject({
                type: 'reasoning',
                text: '',
                state: 'done',
                providerData: {anthropic: {redactedData: 'EmwKAhgB'}}
            });
            expect(redacted.encryptedValue).toBeUndefined();

            // The parts round-trip into the blocks Anthropic requires back, unchanged.
            const {messages} = await encode(new AnthropicCodec(), [user('GCD?'), message]);
            expect(messages[1].content).toEqual([
                {type: 'thinking', thinking: 'GCD is 21.', signature: 'EqQB'},
                {type: 'redacted_thinking', data: 'EmwKAhgB'},
                {type: 'text', text: 'It is **21**.'}
            ]);
        });

        it('joins text blocks split around citations into one text part with its citations', () => {
            const message = reduce([
                messageStart(),
                {type: 'content_block_start', index: 0, content_block: {type: 'text', text: ''}},
                textDelta(0, 'According to the docs, '),
                {type: 'content_block_stop', index: 0},
                {
                    type: 'content_block_start',
                    index: 1,
                    content_block: {type: 'text', text: '', citations: []}
                },
                {
                    type: 'content_block_delta',
                    index: 1,
                    delta: {
                        type: 'citations_delta',
                        citation: {
                            type: 'web_search_result_location',
                            url: 'https://example.com/sky',
                            title: 'Why the sky is blue',
                            cited_text: 'Rayleigh scattering...',
                            encrypted_index: 'Eo8B'
                        }
                    }
                },
                textDelta(1, 'the sky is blue'),
                {type: 'content_block_stop', index: 1},
                {
                    type: 'content_block_start',
                    index: 2,
                    content_block: {type: 'text', text: '', citations: []}
                },
                {
                    type: 'content_block_delta',
                    index: 2,
                    delta: {
                        type: 'citations_delta',
                        citation: {
                            type: 'page_location',
                            document_title: 'Optics.pdf',
                            cited_text: 'Short wavelengths scatter more.',
                            start_page_number: 3,
                            end_page_number: 4
                        }
                    }
                },
                textDelta(2, ' at noon.'),
                {type: 'content_block_stop', index: 2},
                messageDelta('end_turn'),
                {type: 'message_stop'}
            ]);

            expect(message.parts).toHaveLength(1);
            const [part] = message.parts as ChatTextPart[];
            expect(part.text).toBe('According to the docs, the sky is blue at noon.');
            expect(part.citations).toMatchObject([
                {
                    url: 'https://example.com/sky',
                    title: 'Why the sky is blue',
                    citedText: 'Rayleigh scattering...'
                },
                {title: 'Optics.pdf', citedText: 'Short wavelengths scatter more.'}
            ]);
        });

        it('decodes server tool calls with their results, and sends them back verbatim', async () => {
            const resultBlock = {
                    type: 'web_search_tool_result',
                    tool_use_id: 'srvtoolu_1',
                    content: [
                        {
                            type: 'web_search_result',
                            title: 'NYC weather',
                            url: 'https://weather.example/nyc',
                            encrypted_content: 'Ev0D',
                            page_age: null
                        }
                    ]
                },
                message = reduce([
                    messageStart(),
                    {
                        type: 'content_block_start',
                        index: 0,
                        content_block: {
                            type: 'server_tool_use',
                            id: 'srvtoolu_1',
                            name: 'web_search',
                            input: {}
                        }
                    },
                    jsonDelta(0, '{"query": "weather NYC"}'),
                    {type: 'content_block_stop', index: 0},
                    {type: 'content_block_start', index: 1, content_block: resultBlock},
                    {type: 'content_block_stop', index: 1},
                    messageDelta('end_turn'),
                    {type: 'message_stop'}
                ]);

            const [call] = message.parts as ChatToolCallPart[];
            expect(call).toMatchObject({
                type: 'toolCall',
                id: 'srvtoolu_1',
                toolName: 'web_search',
                state: 'output-available',
                input: {query: 'weather NYC'},
                output: resultBlock.content,
                providerExecuted: true,
                providerData: {anthropic: {resultBlock}}
            });
            expect(call.encryptedValue).toBeUndefined();

            const {messages} = await encode(new AnthropicCodec(), [user('Weather?'), message]);
            expect(messages).toEqual([
                {role: 'user', content: [{type: 'text', text: 'Weather?'}]},
                {
                    role: 'assistant',
                    content: [
                        {
                            type: 'server_tool_use',
                            id: 'srvtoolu_1',
                            name: 'web_search',
                            input: {query: 'weather NYC'}
                        },
                        resultBlock
                    ]
                }
            ]);
        });

        it('marks a server tool call as run by the backend from its start', () => {
            const events = decode([
                messageStart(),
                {
                    type: 'content_block_start',
                    index: 0,
                    content_block: {type: 'server_tool_use', id: 'srvtoolu_1', name: 'web_search'}
                }
            ]);

            expect(events.slice(1)).toEqual([
                {type: 'TOOL_CALL_START', toolCallId: 'srvtoolu_1', toolCallName: 'web_search'},
                {
                    type: 'CUSTOM',
                    name: 'xh.chat.providerExecuted',
                    value: {toolCallId: 'srvtoolu_1'}
                }
            ]);
        });

        it('decodes an error event as RUN_ERROR, with the error type as its code', () => {
            const events = decode([
                {type: 'error', error: {type: 'overloaded_error', message: 'Overloaded'}}
            ]);
            expect(events).toEqual([
                {type: 'RUN_ERROR', message: 'Overloaded', code: 'overloaded_error'}
            ]);
        });

        it('ignores unknown events and blocks, and their deltas', () => {
            const events = decode([
                messageStart(),
                {type: 'some_future_event', detail: 1},
                {type: 'content_block_start', index: 0, content_block: {type: 'fallback'}},
                {type: 'content_block_delta', index: 0, delta: {type: 'future_delta', x: 1}},
                {type: 'content_block_stop', index: 0},
                {type: 'content_block_delta', index: 9, delta: {type: 'text_delta', text: 'orphan'}}
            ]);
            expect(events).toEqual([{type: 'RUN_STARTED', threadId: 't1', runId: 'r1'}]);
        });

        it('reads the event type from the SSE event name when the data has none', () => {
            const decoder = new AnthropicCodec().createDecoder(request([]));
            expect(decoder({error: {type: 'api_error', message: 'Boom'}}, 'error')).toEqual([
                {type: 'RUN_ERROR', message: 'Boom', code: 'api_error'}
            ]);
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
        messages,
        tools: [],
        signal: new AbortController().signal,
        ...changes
    };
}

function user(content: string): ChatMessage {
    return new ChatMessage({role: 'user', content});
}

function text(value: string, step?: number): ChatTextPart {
    return {type: 'text', id: `text-${value}`, step, text: value, state: 'done'};
}

function reasoning(value: string, encryptedValue: string, step: number): ChatReasoningPart {
    return {
        type: 'reasoning',
        id: `reasoning-${value}`,
        step,
        text: value,
        state: 'done',
        startedAt: 1,
        endedAt: 2,
        encryptedValue
    };
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

function messageStart(usage: PlainObject = {input_tokens: 10, output_tokens: 1}): PlainObject {
    return {
        type: 'message_start',
        message: {
            id: 'msg_1',
            type: 'message',
            role: 'assistant',
            content: [],
            model: 'claude-opus-5-5',
            stop_reason: null,
            stop_sequence: null,
            usage
        }
    };
}

function messageDelta(stopReason: string, usage: PlainObject = {output_tokens: 20}): PlainObject {
    return {type: 'message_delta', delta: {stop_reason: stopReason, stop_sequence: null}, usage};
}

function textDelta(index: number, value: string): PlainObject {
    return {type: 'content_block_delta', index, delta: {type: 'text_delta', text: value}};
}

function jsonDelta(index: number, partialJson: string): PlainObject {
    return {
        type: 'content_block_delta',
        index,
        delta: {type: 'input_json_delta', partial_json: partialJson}
    };
}

/** Base64 of the UTF-8 bytes of `value`, as a file read from disk would be. */
function base64Utf8(value: string): string {
    return btoa(String.fromCharCode(...new TextEncoder().encode(value)));
}

function encode(codec: AnthropicCodec, messages: ChatMessage[]): Promise<PlainObject> {
    return Promise.resolve(codec.encodeRequest(request(messages)));
}

/** Decode a recorded stream - the `data` of each SSE event, in order. */
function decode(stream: PlainObject[]): ChatEvent[] {
    const decoder = new AnthropicCodec().createDecoder(request([]));
    return stream.flatMap(raw => decoder(raw));
}

/** Decode a recorded stream and reduce it into an assistant message, as ChatModel does. */
function reduce(stream: PlainObject[]): ChatMessage {
    const reducer = new ChatStreamReducer(0),
        message = new ChatMessage({role: 'assistant', status: 'pending'});
    return reducer.finish(reducer.apply(message, decode(stream)));
}
