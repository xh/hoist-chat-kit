import {initTestAppAsync} from '@xh/hoist/test-support';
import {beforeAll, describe, expect, it, onTestFinished, vi} from 'vitest';
import {
    errorEvents,
    reasoningEvents,
    ScriptedChatTransport,
    type ScriptedResponse,
    textEvents,
    toolCallEvents
} from '../transport';
import {ChatModel, type ChatModelConfig} from './ChatModel';
import type {ChatToolCallPart} from './ChatPart';

/**
 * ChatModel's run loop, driven end to end by ScriptedChatTransport. Apps rely on it to stream
 * replies, run client tools between model calls, pause for approval, and recover from stops and
 * errors without leaving the conversation in a state the model would reject.
 */
describe('ChatModel', () => {
    beforeAll(async () => {
        await initTestAppAsync();
    });

    describe('sendAsync', () => {
        it('appends the user message and streams the assistant reply', async () => {
            const model = createModel([textEvents('Hello there.')]);

            await model.sendAsync('Hi');

            const [user, assistant] = model.messages;
            expect(user).toMatchObject({role: 'user', text: 'Hi', status: 'complete'});
            expect(assistant).toMatchObject({role: 'assistant', status: 'complete'});
            expect(assistant.text).toBe('Hello there.');
            expect(model.status).toBe('ready');
        });

        it('sends the composer draft, with its attachments, and clears it', async () => {
            const model = createModel([textEvents('Got it.')]),
                {composerModel} = model,
                file = {type: 'file', id: 'f1', name: 'a.png', mediaType: 'image/png'} as const;
            composerModel.text = '  Look at this  ';
            composerModel.attachments = [file];

            await model.sendAsync();

            expect(model.messages[0].parts).toMatchObject([
                file,
                {type: 'text', text: 'Look at this'}
            ]);
            expect(composerModel.text).toBe('');
            expect(composerModel.attachments).toEqual([]);
        });

        it('does nothing when there is nothing to send', async () => {
            const model = createModel([]);
            await model.sendAsync('   ');
            expect(model.messages).toEqual([]);
        });

        it('sends the history, the in-progress message and the model tools in each request', async () => {
            const transport = new ScriptedChatTransport({
                    responses: [textEvents('Hi.')],
                    delayMs: 0
                }),
                model = createModel({
                    transport,
                    tools: [
                        {name: 'client', execute: () => 'ok'},
                        {name: 'display', displayName: 'Server tool'},
                        {name: 'declared', sendToModel: true},
                        {name: 'hidden', execute: () => 'ok', sendToModel: false}
                    ],
                    initialMessages: [{role: 'assistant', content: 'Welcome!'}]
                });

            await model.sendAsync('Hello');

            const [request] = transport.requests;
            expect(request.threadId).toBe(model.threadId);
            expect(request.messages.map(it => it.role)).toEqual(['assistant', 'user', 'assistant']);
            expect(request.messages[2].parts).toEqual([]);
            expect(request.tools.map(it => it.name)).toEqual(['client', 'declared']);
        });

        it('records elapsed time, finish reason and usage on the reply', async () => {
            const model = createModel([
                [
                    textEvents('Done.'),
                    {
                        type: 'RUN_FINISHED',
                        threadId: 't',
                        runId: 'r',
                        usage: [{inputTokens: 5, outputTokens: 2}],
                        metadata: {finishReason: 'end_turn'}
                    }
                ]
            ]);

            await model.sendAsync('Hi');

            expect(model.lastMessage.metadata).toMatchObject({
                finishReason: 'end_turn',
                usage: [{inputTokens: 5, outputTokens: 2}]
            });
            expect(model.lastMessage.metadata.elapsedMs).toBeTypeOf('number');
        });

        it('ignores a second send while a turn runs, even in the same tick', async () => {
            const transport = new ScriptedChatTransport({
                    responses: [textEvents('One.'), textEvents('Two.')],
                    delayMs: 0
                }),
                model = createModel({transport});

            await Promise.all([model.sendAsync('First'), model.sendAsync('Second')]);

            expect(transport.requests).toHaveLength(1);
            expect(model.messages.map(it => it.text)).toEqual(['First', 'One.']);
        });

        it('calls onTurnComplete with the finished reply', async () => {
            const onTurnComplete = vi.fn(),
                model = createModel({
                    transport: scripted([textEvents('Done.')]),
                    onTurnComplete
                });

            await model.sendAsync('Hi');

            expect(onTurnComplete).toHaveBeenCalledExactlyOnceWith(model.lastMessage);
            expect(onTurnComplete.mock.calls[0][0].status).toBe('complete');
        });
    });

    describe('streaming', () => {
        it('moves from submitted to streaming at the first content', async () => {
            vi.useFakeTimers();
            const model = createModel({
                    transport: new ScriptedChatTransport({
                        responses: [textEvents('Hello world, how are you?')],
                        delayMs: 100
                    })
                }),
                done = model.sendAsync('Hi');

            expect(model.status).toBe('submitted');
            expect(model.lastMessage.status).toBe('pending');
            expect(model.isBusy).toBe(true);

            await vi.advanceTimersByTimeAsync(300);
            expect(model.status).toBe('streaming');
            expect(model.lastMessage.status).toBe('streaming');

            await vi.advanceTimersByTimeAsync(5000);
            await done;
            expect(model.status).toBe('ready');
        });

        it('applies streamed events in batches, at most every 32ms', async () => {
            vi.useFakeTimers();
            const model = createModel({
                    transport: new ScriptedChatTransport({
                        responses: [textEvents('abcdefghijklmnopqrst', {chunkSize: 1})],
                        delayMs: 4
                    })
                }),
                updates: string[] = [];
            model.addReaction({
                track: () => model.lastMessage,
                run: message => updates.push(message.text)
            });

            const done = model.sendAsync('Hi');
            await vi.advanceTimersByTimeAsync(40);
            const afterFirstFlush = updates.at(-1);

            await vi.advanceTimersByTimeAsync(1000);
            await done;

            // 22 events arrive 4ms apart - a few batched updates, not one per event.
            expect(afterFirstFlush.length).toBeGreaterThan(1);
            expect(updates.length).toBeLessThan(10);
            expect(model.lastMessage.text).toBe('abcdefghijklmnopqrst');
        });
    });

    describe('stop', () => {
        it('aborts the stream and keeps the partial reply as aborted', async () => {
            vi.useFakeTimers();
            const onTurnComplete = vi.fn(),
                transport = new ScriptedChatTransport({
                    responses: [
                        [reasoningEvents('Thinking hard.'), textEvents('A long, long answer.')]
                    ],
                    delayMs: 50
                }),
                model = createModel({transport, onTurnComplete}),
                done = model.sendAsync('Hi');

            await vi.advanceTimersByTimeAsync(600);
            model.stop();
            await done;

            const {lastMessage} = model;
            expect(transport.requests[0].signal.aborted).toBe(true);
            expect(lastMessage.status).toBe('aborted');
            expect(lastMessage.parts.length).toBeGreaterThan(0);
            expect(
                lastMessage.parts.every(it => !('state' in it) || it.state !== 'streaming')
            ).toBe(true);
            expect(model.status).toBe('ready');
            expect(onTurnComplete).toHaveBeenCalledOnce();
        });

        it('ends the turn even when a running tool ignores the signal', async () => {
            const model = createModel({
                transport: scripted([toolCallEvents('slow', {}, {toolCallId: 'c1'})]),
                tools: [{name: 'slow', execute: () => new Promise(() => {})}]
            });

            const done = model.sendAsync('Go');
            await vi.waitFor(() => expect(toolCall(model, 'c1').state).toBe('running'));
            model.stop();
            await done;

            expect(toolCall(model, 'c1')).toMatchObject({
                state: 'output-error',
                errorText: 'Stopped by the user.'
            });
        });
    });

    describe('errors', () => {
        it('fails the turn on RUN_ERROR, keeping content received so far', async () => {
            const model = createModel([[textEvents('Partial'), errorEvents('Overloaded')]]);

            await model.sendAsync('Hi');

            expect(model.status).toBe('error');
            expect(model.lastError.message).toBe('Overloaded');
            expect(model.lastMessage).toMatchObject({status: 'error', error: 'Overloaded'});
            expect(model.lastMessage.text).toBe('Partial');
        });

        it('fails the turn when the transport throws', async () => {
            const model = createModel({
                transport: new ScriptedChatTransport({
                    respond: () => {
                        throw new Error('Connection refused');
                    }
                })
            });

            await model.sendAsync('Hi');

            expect(model.status).toBe('error');
            expect(model.lastMessage.error).toBe('Connection refused');
        });

        it('re-runs the last user turn on retry, replacing the failed reply', async () => {
            const model = createModel([errorEvents('Overloaded'), textEvents('Recovered.')]);
            await model.sendAsync('Hi');

            await model.retryAsync();

            expect(model.messages.map(it => it.text)).toEqual(['Hi', 'Recovered.']);
            expect(model.status).toBe('ready');
            expect(model.lastError).toBeNull();
        });
    });

    describe('regenerateAsync and editMessageAsync', () => {
        it('replaces the last reply on regenerate', async () => {
            const transport = scripted([textEvents('First try.'), textEvents('Second try.')]),
                model = createModel({transport});
            await model.sendAsync('Hi');

            await model.regenerateAsync();

            expect(model.messages.map(it => it.text)).toEqual(['Hi', 'Second try.']);
            expect(transport.requests[1].messages.map(it => it.text)).toEqual(['Hi', '']);
        });

        it('re-runs from an edited user message, discarding later messages', async () => {
            const model = createModel([
                textEvents('Paris is sunny.'),
                textEvents('Rome is warm.'),
                textEvents('London is grey.')
            ]);
            await model.sendAsync('Paris?');
            await model.sendAsync('Rome?');

            await model.editMessageAsync(model.messages[0].id, 'London?');

            expect(model.messages.map(it => it.text)).toEqual(['London?', 'London is grey.']);
        });
    });

    describe('client tools', () => {
        it('runs client tools and sends their results back in another step', async () => {
            const execute = vi.fn(({city}) => ({city, tempC: 18})),
                transport = scripted([
                    toolCallEvents('getWeather', {city: 'Paris'}, {toolCallId: 'c1'}),
                    textEvents('It is 18°C in Paris.')
                ]),
                model = createModel({transport, tools: [{name: 'getWeather', execute}]});

            await model.sendAsync('Weather in Paris?');

            expect(execute).toHaveBeenCalledWith(
                {city: 'Paris'},
                expect.objectContaining({chatModel: model, toolCallId: 'c1'})
            );
            expect(transport.requests).toHaveLength(2);
            expect(toolCall(model, 'c1')).toMatchObject({
                state: 'output-available',
                output: {city: 'Paris', tempC: 18},
                step: 0
            });
            expect(transport.requests[1].messages.at(-1).toolCalls[0].state).toBe(
                'output-available'
            );
            expect(model.messages).toHaveLength(2);
            expect(model.lastMessage.text).toBe('It is 18°C in Paris.');
        });

        it('sends a thrown tool error back to the model as an error result', async () => {
            const model = createModel({
                transport: scripted([
                    toolCallEvents('getWeather', {city: 'Atlantis'}, {toolCallId: 'c1'}),
                    textEvents('I could not find Atlantis.')
                ]),
                tools: [
                    {
                        name: 'getWeather',
                        execute: () => {
                            throw new Error('Unknown city');
                        }
                    }
                ]
            });

            await model.sendAsync('Weather in Atlantis?');

            expect(toolCall(model, 'c1')).toMatchObject({
                state: 'output-error',
                errorText: 'Unknown city'
            });
            expect(model.lastMessage.status).toBe('complete');
        });

        it('fails a call to an unknown tool and lets the model recover', async () => {
            const transport = scripted([
                    toolCallEvents('teleport', {}, {toolCallId: 'c1'}),
                    textEvents('I cannot do that.')
                ]),
                model = createModel({transport});

            await model.sendAsync('Teleport me');

            expect(toolCall(model, 'c1')).toMatchObject({
                state: 'output-error',
                errorText: "No handler for tool 'teleport'."
            });
            expect(transport.requests).toHaveLength(2);
        });

        it('ends the turn without another call when only backend tools ran', async () => {
            const transport = scripted([
                    [
                        toolCallEvents('webSearch', {q: 'x'}, {result: 'found'}),
                        textEvents('Here you go.')
                    ]
                ]),
                model = createModel({transport});

            await model.sendAsync('Search');

            expect(transport.requests).toHaveLength(1);
            expect(model.lastMessage.status).toBe('complete');
        });

        it('stops after maxSteps model calls', async () => {
            const transport = new ScriptedChatTransport({
                    respond: () => toolCallEvents('ping', {}),
                    delayMs: 0
                }),
                model = createModel({
                    transport,
                    maxSteps: 3,
                    tools: [{name: 'ping', execute: () => 'pong'}]
                });

            await model.sendAsync('Loop forever');

            expect(transport.requests).toHaveLength(3);
            expect(model.lastMessage.toolCalls.map(it => it.step)).toEqual([0, 1, 2]);
            expect(model.lastMessage.status).toBe('complete');
            expect(model.status).toBe('ready');
        });
    });

    describe('approvals', () => {
        it('pauses for approval, then runs the tool and continues once approved', async () => {
            const execute = vi.fn(() => 'Dashboard reset.'),
                transport = scripted([
                    toolCallEvents('resetDashboard', {}, {toolCallId: 'c1'}),
                    textEvents('Your dashboard is reset.')
                ]),
                model = createModel({
                    transport,
                    tools: [{name: 'resetDashboard', execute, needsApproval: true}]
                });

            await model.sendAsync('Reset it');

            expect(model.status).toBe('ready');
            expect(model.isBusy).toBe(false);
            expect(model.pendingApprovals.map(it => it.id)).toEqual(['c1']);
            expect(execute).not.toHaveBeenCalled();

            await model.approveToolCallAsync('c1');

            expect(execute).toHaveBeenCalledOnce();
            expect(toolCall(model, 'c1').state).toBe('output-available');
            expect(model.pendingApprovals).toEqual([]);
            expect(model.lastMessage).toMatchObject({status: 'complete'});
            expect(model.lastMessage.text).toBe('Your dashboard is reset.');
        });

        it('tells the model of a denial, without running the tool', async () => {
            const execute = vi.fn(),
                transport = scripted([
                    toolCallEvents('deleteView', {name: 'Q3'}, {toolCallId: 'c1'}),
                    textEvents('Okay, I left it.')
                ]),
                model = createModel({
                    transport,
                    tools: [{name: 'deleteView', execute, needsApproval: () => true}]
                });
            await model.sendAsync('Delete Q3');

            await model.denyToolCallAsync('c1', 'Keep that view.');

            expect(execute).not.toHaveBeenCalled();
            expect(toolCall(model, 'c1')).toMatchObject({
                state: 'output-denied',
                errorText: 'Keep that view.'
            });
            expect(transport.requests).toHaveLength(2);
        });

        it('waits until every call in the step is answered', async () => {
            const transport = scripted([
                    [
                        toolCallEvents('remove', {id: 1}, {toolCallId: 'c1'}),
                        toolCallEvents('remove', {id: 2}, {toolCallId: 'c2'})
                    ],
                    textEvents('Removed one.')
                ]),
                model = createModel({
                    transport,
                    tools: [{name: 'remove', execute: () => 'ok', needsApproval: true}]
                });
            await model.sendAsync('Remove both');

            await model.approveToolCallAsync('c1');
            expect(transport.requests).toHaveLength(1);
            expect(toolCall(model, 'c1').state).toBe('input-available');

            await model.denyToolCallAsync('c2');
            expect(transport.requests).toHaveLength(2);
            expect(toolCall(model, 'c1').state).toBe('output-available');
        });

        it('denies waiting calls when the user sends a new message instead', async () => {
            const model = createModel({
                transport: scripted([
                    toolCallEvents('remove', {}, {toolCallId: 'c1'}),
                    textEvents('Sure.')
                ]),
                tools: [{name: 'remove', execute: () => 'ok', needsApproval: true}]
            });
            await model.sendAsync('Remove it');

            await model.sendAsync('Never mind');

            const abandoned = model.messages[1];
            expect(abandoned.status).toBe('complete');
            expect(abandoned.toolCalls[0].state).toBe('output-denied');
            expect(model.lastMessage.text).toBe('Sure.');
        });
    });

    describe('addToolOutputAsync', () => {
        it('pauses for a tool the user answers, then continues with the answer', async () => {
            const transport = scripted([
                    toolCallEvents('pickCity', {options: ['Paris', 'Rome']}, {toolCallId: 'c1'}),
                    textEvents('Rome it is.')
                ]),
                model = createModel({transport, tools: [{name: 'pickCity', sendToModel: true}]});

            await model.sendAsync('Help me pick');
            expect(model.status).toBe('ready');
            expect(toolCall(model, 'c1').state).toBe('input-available');

            await model.addToolOutputAsync('c1', {city: 'Rome'});

            expect(toolCall(model, 'c1')).toMatchObject({
                state: 'output-available',
                output: {city: 'Rome'}
            });
            expect(model.lastMessage.text).toBe('Rome it is.');
        });
    });

    describe('history', () => {
        it('loads, clears and saves messages', () => {
            const model = createModel([]);

            model.loadMessages([
                {role: 'user', content: 'Hi'},
                {role: 'assistant', content: 'Hello!'}
            ]);
            const specs = model.getMessageSpecs();
            expect(specs.map(it => it.role)).toEqual(['user', 'assistant']);

            model.clear();
            expect(model.isEmpty).toBe(true);

            model.loadMessages(specs);
            expect(model.lastMessage.text).toBe('Hello!');
        });
    });
});

//------------------
// Helpers
//------------------
function scripted(responses: ScriptedResponse[]): ScriptedChatTransport {
    return new ScriptedChatTransport({responses, delayMs: 0});
}

function createModel(config: ScriptedResponse[] | ChatModelConfig): ChatModel {
    const model = new ChatModel(Array.isArray(config) ? {transport: scripted(config)} : config);
    onTestFinished(() => model.destroy());
    return model;
}

function toolCall(model: ChatModel, id: string): ChatToolCallPart {
    return model.lastMessage.toolCalls.find(it => it.id === id);
}
