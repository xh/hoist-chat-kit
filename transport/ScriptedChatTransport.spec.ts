import {initTestAppAsync} from '@xh/hoist/test-support';
import {beforeAll, describe, expect, it, onTestFinished, vi} from 'vitest';
import {ChatMessage, ChatModel} from '../core';
import {ChatStreamReducer} from '../core/ChatStreamReducer';
import type {ChatEvent} from './ChatEvent';
import type {ChatRunRequest} from './ChatTransport';
import {
    interruptEvents,
    citationEvents,
    errorEvents,
    noAnswerEvents,
    reasoningEvents,
    ScriptedChatTransport,
    scriptedDelay,
    type ScriptedRequestContext,
    sourceEvents,
    textEvents,
    toolCallEvents
} from './ScriptedChatTransport';

/**
 * ScriptedChatTransport drives the kit's own tests and the offline Toolbox demos. Its streams must
 * be well-formed AG-UI runs that the chat reduces into the intended parts, paced like a real model,
 * and it must stop at once when the user stops a turn.
 */
describe('ScriptedChatTransport', () => {
    beforeAll(() => initTestAppAsync());

    describe('run', () => {
        it('plays one scripted response per request, inside RUN_STARTED and RUN_FINISHED', async () => {
            const transport = new ScriptedChatTransport({
                responses: [textEvents('One', {messageId: 'm1'}), textEvents('Two')],
                delayMs: 0
            });

            const first = await collect(transport.run(request('r1'))),
                second = await collect(transport.run(request('r2')));

            expect(first.map(it => it.type)).toEqual([
                'RUN_STARTED',
                'TEXT_MESSAGE_START',
                'TEXT_MESSAGE_CONTENT',
                'TEXT_MESSAGE_END',
                'RUN_FINISHED'
            ]);
            expect(first[0]).toEqual({type: 'RUN_STARTED', threadId: 't1', runId: 'r1'});
            expect(second.at(-1)).toEqual({type: 'RUN_FINISHED', threadId: 't1', runId: 'r2'});
            expect(transport.requests.map(it => it.runId)).toEqual(['r1', 'r2']);
        });

        it('ends a run with interrupts, filling in the run ids, and supports interrupts', async () => {
            const transport = new ScriptedChatTransport({
                    responses: [interruptEvents([{id: 'q1', reason: 'input_required'}])],
                    delayMs: 0
                }),
                events = await collect(transport.run(request('r1')));

            expect(transport.supportsInterrupts).toBe(true);
            expect(events).toEqual([
                {type: 'RUN_STARTED', threadId: 't1', runId: 'r1'},
                {
                    type: 'RUN_FINISHED',
                    threadId: 't1',
                    runId: 'r1',
                    outcome: {type: 'interrupt', interrupts: [{id: 'q1', reason: 'input_required'}]}
                }
            ]);
        });

        it('keeps lifecycle events that a response provides', async () => {
            const finished: ChatEvent = {
                    type: 'RUN_FINISHED',
                    threadId: 't1',
                    runId: 'r1',
                    usage: [{outputTokens: 3}]
                },
                transport = new ScriptedChatTransport({
                    responses: [[textEvents('Hi'), finished]],
                    delayMs: 0
                });

            const events = await collect(transport.run(request('r1')));

            expect(events.filter(it => it.type === 'RUN_FINISHED')).toEqual([finished]);
        });

        it('ends the response after a RUN_ERROR', async () => {
            const transport = new ScriptedChatTransport({
                responses: [[errorEvents('Overloaded', 'overloaded'), textEvents('never sent')]],
                delayMs: 0
            });

            const events = await collect(transport.run(request('r1')));

            expect(events.map(it => it.type)).toEqual(['RUN_STARTED', 'RUN_ERROR']);
            expect(events[1]).toMatchObject({message: 'Overloaded', code: 'overloaded'});
        });

        it('asks `respond` for each response', async () => {
            const respond = vi.fn((req: ChatRunRequest, {requestIndex}: ScriptedRequestContext) =>
                    textEvents(`Request ${requestIndex} for ${req.runId}`)
                ),
                transport = new ScriptedChatTransport({respond, delayMs: 0});

            const events = await collect(transport.run(request('r1')));

            expect(respond).toHaveBeenCalledWith(
                transport.requests[0],
                expect.objectContaining({requestIndex: 0, turnIndex: 0, stepIndex: 0, attempt: 0})
            );
            expect(textOf(events)).toBe('Request 0 for r1');
        });

        it('tells `respond` the turn, the step within it, and the attempt at a message', async () => {
            const contexts: ScriptedRequestContext[] = [],
                transport = new ScriptedChatTransport({
                    delayMs: 0,
                    respond: (req, context) => {
                        contexts.push(context);
                        return context.stepIndex === 0 && context.turnIndex === 0
                            ? toolCallEvents('lookup', {q: 'x'})
                            : textEvents(`Answer to ${context.userMessage.text}`);
                    }
                }),
                chatModel = new ChatModel({
                    transport,
                    tools: [{name: 'lookup', execute: () => 'found'}]
                });
            onTestFinished(() => chatModel.destroy());

            await chatModel.sendAsync('First');
            await chatModel.sendAsync('Second');
            await chatModel.regenerateAsync();

            expect(
                contexts.map(({requestIndex, turnIndex, stepIndex, attempt}) => [
                    requestIndex,
                    turnIndex,
                    stepIndex,
                    attempt
                ])
            ).toEqual([
                [0, 0, 0, 0],
                [1, 0, 1, 0],
                [2, 1, 0, 0],
                [3, 2, 0, 1]
            ]);
            expect(contexts[3].userMessage.text).toBe('Second');
            expect(contexts.map(it => it.userMessage.id)).toEqual(
                transport.requests.map(it => it.turnId)
            );
        });

        it('builds citation events that attach to the text before them', async () => {
            const transport = new ScriptedChatTransport({
                    delayMs: 0,
                    responses: [
                        [
                            textEvents('Hoist streams NDJSON.'),
                            citationEvents([{sourceId: 's1', title: 'Docs'}]),
                            sourceEvents([{id: 's1', url: 'https://xh.io', title: 'Docs'}])
                        ]
                    ]
                }),
                chatModel = new ChatModel({transport});
            onTestFinished(() => chatModel.destroy());

            await chatModel.sendAsync('How?');

            const [textPart] = chatModel.lastMessage.parts;
            expect(textPart).toMatchObject({
                type: 'text',
                citations: [{sourceId: 's1', title: 'Docs', id: expect.any(String)}]
            });
        });

        it('passes an async iterable response through as is', async () => {
            async function* stream(): AsyncGenerator<ChatEvent> {
                yield* textEvents('Streamed');
            }
            const transport = new ScriptedChatTransport({responses: [stream()]});

            const events = await collect(transport.run(request('r1')));

            expect(textOf(events)).toBe('Streamed');
        });

        it('fails a request that has no scripted response', async () => {
            const transport = new ScriptedChatTransport({responses: []});
            await expect(collect(transport.run(request('r1')))).rejects.toThrow(
                'no response for request 1'
            );
        });
    });

    describe('pacing', () => {
        it('waits delayMs before each event, plus any scripted delay', async () => {
            vi.useFakeTimers();
            const transport = new ScriptedChatTransport({
                    responses: [[scriptedDelay(500), textEvents('Hi', {messageId: 'm1'})]],
                    delayMs: 20
                }),
                received: ChatEvent[] = [],
                done = drain(transport.run(request('r1')), received);

            await vi.advanceTimersByTimeAsync(519);
            expect(received).toEqual([]);

            await vi.advanceTimersByTimeAsync(1);
            expect(received.map(it => it.type)).toEqual(['RUN_STARTED', 'TEXT_MESSAGE_START']);

            await vi.advanceTimersByTimeAsync(20);
            expect(received.map(it => it.type)).toContain('TEXT_MESSAGE_CONTENT');

            await vi.advanceTimersByTimeAsync(1000);
            await done;
            expect(received.at(-1).type).toBe('RUN_FINISHED');
        });

        it('stops with an abort error as soon as the signal aborts', async () => {
            vi.useFakeTimers();
            const controller = new AbortController(),
                transport = new ScriptedChatTransport({
                    responses: [textEvents('A long answer that takes a while to stream.')],
                    delayMs: 1000
                }),
                received: ChatEvent[] = [],
                done = drain(transport.run(request('r1', controller.signal)), received),
                assertion = expect(done).rejects.toMatchObject({name: 'AbortError'});

            await vi.advanceTimersByTimeAsync(2000);
            controller.abort();
            await assertion;

            const count = received.length;
            await vi.advanceTimersByTimeAsync(10_000);
            expect(received).toHaveLength(count);
            expect(vi.getTimerCount()).toBe(0);
        });
    });

    describe('stopping while a response is pending', () => {
        it('stops at once while an async respond is still pending', async () => {
            const controller = new AbortController(),
                transport = new ScriptedChatTransport({respond: () => new Promise(() => {})}),
                done = drain(transport.run(request('r1', controller.signal)), []),
                assertion = expect(done).rejects.toMatchObject({name: 'AbortError'});

            controller.abort();
            await assertion;
        });

        it('stops at once while an async iterable response waits on its next event', async () => {
            const controller = new AbortController(),
                received: ChatEvent[] = [],
                transport = new ScriptedChatTransport({
                    respond: async function* () {
                        yield* textEvents('Hello');
                        await new Promise(() => {});
                    }
                }),
                done = drain(transport.run(request('r1', controller.signal)), received),
                assertion = expect(done).rejects.toMatchObject({name: 'AbortError'});

            await vi.waitFor(() => expect(received.length).toBeGreaterThan(0));
            controller.abort();
            await assertion;
        });
    });

    describe('event builders', () => {
        it('builds source events with their citation marker and metadata', async () => {
            const reducer = new ChatStreamReducer(0),
                message = reducer.apply(
                    new ChatMessage({role: 'assistant', status: 'pending'}),
                    sourceEvents([
                        {id: 's1', title: 'Guide', marker: 2, metadata: {documentId: 'd-7'}}
                    ])
                );

            expect(message.parts).toEqual([
                {
                    type: 'source',
                    id: 's1',
                    step: 0,
                    title: 'Guide',
                    marker: 2,
                    metadata: {documentId: 'd-7'},
                    sourceType: 'document'
                }
            ]);
        });

        it('builds a fixed "not found" reply as a reserved data part', () => {
            const message = new ChatStreamReducer(0).apply(
                new ChatMessage({role: 'assistant', status: 'pending'}),
                noAnswerEvents({documents: [{name: 'Reserves Policy'}], documentCount: 4})
            );
            expect(message.parts).toMatchObject([
                {
                    type: 'data',
                    dataType: 'xh.chat.noAnswer',
                    data: {documents: [{name: 'Reserves Policy'}], documentCount: 4}
                }
            ]);
        });

        it('splits text into small chunks that rejoin to the original', () => {
            const text = 'Here is **bold** text,\n\nand a second paragraph.',
                deltas = textEvents(text, {chunkSize: 4})
                    .filter(it => it.type === 'TEXT_MESSAGE_CONTENT')
                    .map(it => (it as any).delta);

            expect(deltas.length).toBeGreaterThan(8);
            expect(deltas.every(it => it.trim().length <= 4)).toBe(true);
            expect(deltas.join('')).toBe(text);
        });

        it('builds a multi-step conversation that the chat reduces into the intended parts', async () => {
            const transport = new ScriptedChatTransport({
                    responses: [
                        [
                            reasoningEvents('Need the forecast.', {encryptedValue: 'sig'}),
                            toolCallEvents('getWeather', {city: 'Paris'}, {toolCallId: 'c1'}),
                            toolCallEvents('webSearch', {q: 'Paris'}, {result: {hits: 2}})
                        ],
                        [
                            textEvents('Sunny and **18°C**.'),
                            sourceEvents([{url: 'https://example.com', title: 'Forecast'}])
                        ]
                    ],
                    delayMs: 0
                }),
                stepOne = await collect(transport.run(request('r1'))),
                stepTwo = await collect(transport.run(request('r2')));

            let message = new ChatMessage({role: 'assistant', status: 'pending'});
            message = new ChatStreamReducer(0).apply(message, stepOne);
            message = new ChatStreamReducer(1).apply(message, stepTwo);

            expect(message.parts).toMatchObject([
                {
                    type: 'reasoning',
                    text: 'Need the forecast.',
                    state: 'done',
                    encryptedValue: 'sig'
                },
                {type: 'toolCall', id: 'c1', state: 'input-available', input: {city: 'Paris'}},
                {
                    type: 'toolCall',
                    toolName: 'webSearch',
                    state: 'output-available',
                    output: {hits: 2},
                    providerExecuted: true
                },
                {type: 'text', text: 'Sunny and **18°C**.', state: 'done', step: 1},
                {type: 'source', url: 'https://example.com', title: 'Forecast', step: 1}
            ]);
        });
    });
});

//------------------
// Helpers
//------------------
function request(runId: string, signal = new AbortController().signal): ChatRunRequest {
    return {
        threadId: 't1',
        runId,
        historyMode: 'client',
        trigger: 'submit',
        turnId: null,
        stepIndex: 0,
        messages: [],
        newMessages: [],
        replacedMessageId: null,
        runOptions: null,
        catalogVersion: null,
        tools: [],
        context: [],
        signal
    };
}

async function collect(events: AsyncIterable<ChatEvent>): Promise<ChatEvent[]> {
    const ret: ChatEvent[] = [];
    await drain(events, ret);
    return ret;
}

async function drain(events: AsyncIterable<ChatEvent>, into: ChatEvent[]) {
    for await (const event of events) into.push(event);
}

function textOf(events: ChatEvent[]): string {
    return events
        .filter(it => it.type === 'TEXT_MESSAGE_CONTENT')
        .map(it => (it as any).delta)
        .join('');
}
