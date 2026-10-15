import {XH} from '@xh/hoist/core';
import {observable, runInAction} from '@xh/hoist/mobx';
import {initTestAppAsync} from '@xh/hoist/test-support';
import {beforeAll, describe, expect, it, onTestFinished, vi} from 'vitest';
import {
    type ChatEvent,
    type ChatTransport,
    errorEvents,
    reasoningEvents,
    ScriptedChatTransport,
    type ScriptedResponse,
    textEvents,
    toolCallEvents
} from '../transport';
import type {ChatMessageSpec} from './ChatMessage';
import {ChatModel, type ChatModelConfig} from './ChatModel';
import type {ChatFilePart, ChatToolCallPart} from './ChatPart';
import {ChatRunError} from './ChatRunError';
import type {ChatToolSpec} from './ChatToolSpec';

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
                        {name: 'hidden', execute: () => 'ok', sendToModel: false},
                        {name: 'interactive', interactive: true}
                    ],
                    initialMessages: [{role: 'assistant', content: 'Welcome!'}]
                });

            await model.sendAsync('Hello');

            const [request] = transport.requests;
            expect(request.threadId).toBe(model.threadId);
            expect(request.messages.map(it => it.role)).toEqual(['assistant', 'user', 'assistant']);
            expect(request.messages[2].parts).toEqual([]);
            expect(request.tools.map(it => it.name)).toEqual(['client', 'declared', 'interactive']);
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
                        metadata: {finishReason: 'stop'}
                    }
                ]
            ]);

            await model.sendAsync('Hi');

            expect(model.lastMessage.metadata).toMatchObject({
                finishReason: 'stop',
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

        it('throws on a missing transport or an invalid step limit', () => {
            expect(() => new ChatModel({transport: null})).toThrow('requires a transport');
            expect(() => new ChatModel({transport: scripted([]), maxSteps: null})).toThrow(
                'maxSteps'
            );
            expect(() => new ChatModel({transport: scripted([]), maxSteps: 0})).toThrow('maxSteps');
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

        it('aborts the signal passed to a running tool', async () => {
            let toolSignal: AbortSignal;
            const model = createModel({
                transport: scripted([toolCallEvents('slow', {}, {toolCallId: 'c1'})]),
                tools: [
                    {
                        name: 'slow',
                        execute: (input, {signal}) => {
                            toolSignal = signal;
                            return new Promise(() => {});
                        }
                    }
                ]
            });

            const done = model.sendAsync('Go');
            await vi.waitFor(() => expect(toolCall(model, 'c1').state).toBe('running'));
            expect(toolSignal.aborted).toBe(false);
            model.stop();
            await done;

            expect(toolSignal.aborted).toBe(true);
        });

        it('lets a new turn start at once, ignoring the old stream as it settles', async () => {
            let release: () => void;
            const gate = new Promise<void>(resolve => (release = resolve));
            async function* slowStream(): AsyncGenerator<ChatEvent> {
                yield* textEvents('Old start.');
                await gate;
                yield* textEvents('Late.');
            }
            const transport = new ScriptedChatTransport({
                    respond: (req, {requestIndex}) =>
                        requestIndex === 0 ? slowStream() : textEvents('New.'),
                    delayMs: 0
                }),
                model = createModel({transport});

            const oldDone = model.sendAsync('Old');
            await vi.waitFor(() => expect(model.lastMessage.text).toBe('Old start.'));
            model.stop();
            await model.sendAsync('New');
            release();
            await oldDone;

            expect(model.messages.map(it => it.text)).toEqual(['Old', 'Old start.', 'New', 'New.']);
            expect(model.messages.map(it => it.status)).toEqual([
                'complete',
                'aborted',
                'complete',
                'complete'
            ]);
        });

        it('aborts the turn when the model is destroyed mid-turn', async () => {
            const transport = scripted([toolCallEvents('slow', {}, {toolCallId: 'c1'})]),
                model = new ChatModel({
                    transport,
                    tools: [{name: 'slow', execute: () => new Promise(() => {})}]
                });

            const done = model.sendAsync('Go');
            await vi.waitFor(() => expect(toolCall(model, 'c1').state).toBe('running'));
            model.destroy();
            await done;

            expect(transport.requests[0].signal.aborted).toBe(true);
        });
    });

    describe('errors', () => {
        it('fails the turn on RUN_ERROR, keeping content received so far and the error code', async () => {
            const onTurnComplete = vi.fn(),
                model = createModel({
                    transport: scripted([
                        [textEvents('Partial'), errorEvents('Overloaded', 'overloaded_error')]
                    ]),
                    onTurnComplete
                });

            await model.sendAsync('Hi');

            expect(model.status).toBe('error');
            expect(model.lastError).toBeInstanceOf(ChatRunError);
            expect(model.lastError).toMatchObject({
                message: 'Overloaded',
                code: 'overloaded_error'
            });
            expect(model.lastMessage).toMatchObject({
                status: 'error',
                error: 'Overloaded',
                metadata: {errorCode: 'overloaded_error'}
            });
            expect(model.lastMessage.text).toBe('Partial');
            expect(onTurnComplete).toHaveBeenCalledExactlyOnceWith(model.lastMessage);
        });

        it('fails the turn on a RUN_ERROR after tools ran, keeping their results', async () => {
            const model = createModel({
                transport: scripted([
                    toolCallEvents('getWeather', {city: 'Paris'}, {toolCallId: 'c1'}),
                    errorEvents('Overloaded', 'overloaded_error')
                ]),
                tools: [{name: 'getWeather', execute: () => ({tempC: 18})}]
            });

            await model.sendAsync('Weather?');

            expect(model.status).toBe('error');
            expect(model.lastMessage.status).toBe('error');
            expect(toolCall(model, 'c1')).toMatchObject({
                state: 'output-available',
                output: {tempC: 18}
            });
        });

        it('fails the turn when the stream ends before the run finished', async () => {
            const transport: ChatTransport = {
                    async *run() {
                        yield* textEvents('Partial');
                    }
                },
                model = createModel({transport});

            await model.sendAsync('Hi');

            expect(model.status).toBe('error');
            expect(model.lastError).toMatchObject({code: 'incomplete-stream'});
            expect(model.lastMessage).toMatchObject({
                status: 'error',
                error: 'The response ended before it was complete.',
                metadata: {errorCode: 'incomplete-stream'}
            });
            expect(model.lastMessage.text).toBe('Partial');
        });

        it('fails the turn when the transport throws, reporting it to Hoist', async () => {
            const handleException = vi.spyOn(XH, 'handleException').mockImplementation(() => {}),
                error = new Error('Connection refused'),
                model = createModel({
                    transport: new ScriptedChatTransport({
                        respond: () => {
                            throw error;
                        }
                    })
                });

            await model.sendAsync('Hi');

            expect(model.status).toBe('error');
            expect(model.lastError).toBe(error);
            expect(model.lastMessage.error).toBe('Connection refused');
            expect(handleException).toHaveBeenCalledExactlyOnceWith(error, {showAlert: false});
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

        it('keeps the files of an edited message', async () => {
            const file: ChatFilePart = {
                    type: 'file',
                    id: 'f1',
                    name: 'a.png',
                    mediaType: 'image/png'
                },
                transport = scripted([textEvents('A cat.'), textEvents('A dog.')]),
                model = createModel({transport});
            await model.sendAsync({text: 'What is this?', files: [file]});

            await model.editMessageAsync(model.messages[0].id, 'What animal is this?');

            expect(transport.requests[1].messages[0].parts).toMatchObject([
                file,
                {type: 'text', text: 'What animal is this?'}
            ]);
        });

        it('ignores regenerate for a reply with no user message before it', async () => {
            const transport = scripted([]),
                model = createModel({
                    transport,
                    initialMessages: [{role: 'assistant', content: 'Welcome!'}]
                });

            await model.regenerateAsync();

            expect(transport.requests).toEqual([]);
            expect(model.lastMessage.text).toBe('Welcome!');
        });
    });

    describe('client tools', () => {
        it('requires unique tool names, so that no call reaches the wrong tool', () => {
            expect(() =>
                createModel({
                    transport: scripted([]),
                    tools: [{name: 'lookup'}, {name: 'show_grid'}, {name: 'lookup'}]
                })
            ).toThrow('found lookup more than once');
        });

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

        it('fails a call to a backend tool that sent no result, so the turn never waits on it', async () => {
            const transport = scripted([
                    toolCallEvents('webSearch', {q: 'x'}, {toolCallId: 'c1'}),
                    textEvents('Search is unavailable.')
                ]),
                model = createModel({
                    transport,
                    tools: [{name: 'webSearch', displayName: 'Web search'}]
                });

            await model.sendAsync('Search');

            expect(toolCall(model, 'c1')).toMatchObject({
                state: 'output-error',
                errorText: "No result for tool 'webSearch' - the backend runs it, and sent none."
            });
            expect(transport.requests).toHaveLength(2);
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
            expect(model.lastMessage.metadata.finishReason).toBe('max-steps');
            expect(model.status).toBe('ready');
        });
    });

    describe('approvals', () => {
        it('times the reply without the time it waited for approval', async () => {
            vi.useFakeTimers({toFake: ['Date']});
            onTestFinished(() => {
                vi.useRealTimers();
            });
            vi.setSystemTime(0);

            const advance = (ms: number) => vi.setSystemTime(Date.now() + ms),
                transport = new ScriptedChatTransport({
                    delayMs: 0,
                    respond: (req, {stepIndex}) => {
                        advance(300);
                        return stepIndex === 0
                            ? toolCallEvents('remove', {}, {toolCallId: 'c1'})
                            : textEvents('Removed.');
                    }
                }),
                model = createModel({
                    transport,
                    tools: [removeTool({execute: () => advance(500)})]
                });

            await model.sendAsync('Remove it');
            expect(model.lastMessage.metadata.elapsedMs).toBe(300);

            advance(60_000); // The user takes a minute to decide.
            await model.approveToolCallAsync('c1');

            expect(model.lastMessage.status).toBe('complete');
            expect(model.lastMessage.metadata.elapsedMs).toBe(1100);
        });

        it("records the user's words with an approval on the call", async () => {
            const model = createModel({
                transport: scripted([
                    toolCallEvents('resetDashboard', {}, {toolCallId: 'c1'}),
                    textEvents('Reset.')
                ]),
                tools: [{name: 'resetDashboard', execute: () => 'Done.', needsApproval: true}]
            });
            await model.sendAsync('Reset it');

            await model.approveToolCallAsync('c1', '  Only the layout.  ');

            expect(model.lastMessage.toolCalls[0]).toMatchObject({
                state: 'output-available',
                approvalReason: 'Only the layout.'
            });
        });

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

            const statuses: string[] = [];
            model.addReaction({
                track: () => model.lastMessage?.status,
                run: status => statuses.push(status)
            });

            await model.sendAsync('Reset it');

            expect(model.status).toBe('ready');
            expect(model.isBusy).toBe(false);
            expect(model.isAwaitingUser).toBe(true);
            expect(model.pendingApprovals.map(it => it.id)).toEqual(['c1']);
            expect(model.waitingToolCalls.map(it => it.id)).toEqual(['c1']);
            expect(model.lastMessage.status).toBe('paused');
            expect(model.lastMessage.isStreaming).toBe(false);
            expect(execute).not.toHaveBeenCalled();

            await model.approveToolCallAsync('c1');

            expect(execute).toHaveBeenCalledOnce();
            expect(toolCall(model, 'c1').state).toBe('output-available');
            expect(model.isAwaitingUser).toBe(false);
            expect(model.pendingApprovals).toEqual([]);
            expect(model.lastMessage).toMatchObject({status: 'complete'});
            expect(model.lastMessage.text).toBe('Your dashboard is reset.');
            expect(statuses.slice(-3)).toEqual(['paused', 'streaming', 'complete']);
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

        it('denies waiting calls and ends the turn as aborted when stopped while paused', async () => {
            const onTurnComplete = vi.fn(),
                model = createModel({
                    transport: scripted([toolCallEvents('remove', {}, {toolCallId: 'c1'})]),
                    tools: [{name: 'remove', execute: () => 'ok', needsApproval: true}],
                    onTurnComplete
                });
            await model.sendAsync('Remove it');

            model.stop();

            expect(model.status).toBe('ready');
            expect(model.isAwaitingUser).toBe(false);
            expect(model.lastMessage.status).toBe('aborted');
            expect(toolCall(model, 'c1')).toMatchObject({
                state: 'output-denied',
                errorText: 'Stopped by the user.'
            });
            expect(onTurnComplete).toHaveBeenCalledExactlyOnceWith(model.lastMessage);
        });
    });

    describe('dataRefreshedAt', () => {
        it('reads the app refresh time from its config, as it changes', () => {
            const state = observable({refreshedAt: 1000}),
                model = createModel({
                    transport: scripted([textEvents('Hi.')]),
                    dataRefreshedAt: () => state.refreshedAt
                });
            expect(model.dataRefreshedAt).toBe(1000);

            runInAction(() => (state.refreshedAt = 2000));
            expect(model.dataRefreshedAt).toBe(2000);
            expect(createModel({transport: scripted([])}).dataRefreshedAt).toBeNull();
        });
    });

    describe('getMessage', () => {
        it('returns a message by id, as it now is, or null', async () => {
            const model = createModel([textEvents('Hello there.')]);
            await model.sendAsync('Hi');

            const reply = model.lastMessage;
            expect(model.getMessage(reply.id)).toBe(reply);
            expect(model.getMessage('missing')).toBeNull();
        });
    });

    describe('addToolOutputAsync', () => {
        it('warns of an interactive tool with no renderer, which no one could answer', () => {
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
            onTestFinished(() => warn.mockRestore());

            createModel({
                transport: scripted([]),
                tools: [
                    {name: 'ask', interactive: true},
                    {name: 'pick', interactive: true, renderer: () => null}
                ]
            });

            expect(warn).toHaveBeenCalledTimes(1);
            expect(String(warn.mock.calls[0])).toContain("Interactive tool 'ask' has no renderer");
        });

        it('pauses for a tool the user answers, then continues with the answer', async () => {
            const transport = scripted([
                    toolCallEvents('pickCity', {options: ['Paris', 'Rome']}, {toolCallId: 'c1'}),
                    textEvents('Rome it is.')
                ]),
                model = createModel({transport, tools: [{name: 'pickCity', interactive: true}]});

            await model.sendAsync('Help me pick');
            expect(model.status).toBe('ready');
            expect(model.lastMessage.status).toBe('paused');
            expect(toolCall(model, 'c1').state).toBe('input-available');
            expect(model.waitingToolCalls.map(it => it.id)).toEqual(['c1']);
            expect(model.pendingApprovals).toEqual([]);

            await model.addToolOutputAsync('c1', {city: 'Rome'});

            expect(toolCall(model, 'c1')).toMatchObject({
                state: 'output-available',
                output: {city: 'Rome'}
            });
            expect(model.lastMessage.text).toBe('Rome it is.');
        });

        it('fails a waiting call when the user sends a new message instead', async () => {
            const model = createModel({
                transport: scripted([
                    toolCallEvents('pickCity', {}, {toolCallId: 'c1'}),
                    textEvents('Okay.')
                ]),
                tools: [{name: 'pickCity', interactive: true}]
            });
            await model.sendAsync('Help me pick');

            await model.sendAsync('Forget it');

            expect(model.messages[1].toolCalls[0]).toMatchObject({
                state: 'output-error',
                errorText: 'No result - the conversation moved on.'
            });
            expect(model.lastMessage.text).toBe('Okay.');
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

        it('starts a new thread on clear, and takes the thread id of loaded messages', () => {
            const model = createModel([]),
                {threadId} = model;

            model.clear();
            expect(model.threadId).not.toBe(threadId);

            model.loadMessages([{role: 'user', content: 'Hi'}], 'thread-7');
            expect(model.threadId).toBe('thread-7');
        });

        it.each(['initialMessages', 'loadMessages'])(
            'closes a message saved mid-stream, via %s',
            via => {
                const specs: ChatMessageSpec[] = [
                        {role: 'user', content: 'Look it up'},
                        {
                            role: 'assistant',
                            status: 'streaming',
                            parts: [
                                {
                                    type: 'text',
                                    id: 't1',
                                    step: 0,
                                    text: 'Partial',
                                    state: 'streaming'
                                },
                                {...callPart('c1'), state: 'running'}
                            ]
                        }
                    ],
                    model =
                        via === 'initialMessages'
                            ? createModel({transport: scripted([]), initialMessages: specs})
                            : createModel([]);
                if (via === 'loadMessages') model.loadMessages(specs);

                const {lastMessage} = model;
                expect(lastMessage.status).toBe('aborted');
                expect(lastMessage.isStreaming).toBe(false);
                expect(lastMessage.parts).toMatchObject([
                    {type: 'text', state: 'done'},
                    {
                        type: 'toolCall',
                        state: 'output-error',
                        errorText: 'Not completed - the response was interrupted.'
                    }
                ]);
            }
        );

        it('closes a paused turn that is not at the end of the history', async () => {
            const specs = await pausedTurnSpecs(),
                model = createModel([]);

            model.loadMessages([...specs, {role: 'user', content: 'Hi'}]);

            expect(model.messages[1].status).toBe('complete');
            expect(model.messages[1].toolCalls[0].state).toBe('output-denied');
            expect(model.isAwaitingUser).toBe(false);
        });

        it('resumes a paused turn at the end of loaded history once approved', async () => {
            const specs = await pausedTurnSpecs(),
                execute = vi.fn(() => 'Removed.'),
                transport = scripted([textEvents('It is gone.')]),
                model = createModel({transport, tools: [removeTool({execute})]});

            model.loadMessages(specs, 'thread-1');
            expect(model.lastMessage.status).toBe('paused');
            expect(model.pendingApprovals.map(it => it.id)).toEqual(['c1']);

            await model.approveToolCallAsync('c1');

            expect(execute).toHaveBeenCalledOnce();
            expect(transport.requests[0].threadId).toBe('thread-1');
            expect(model.lastMessage).toMatchObject({status: 'complete'});
            expect(model.lastMessage.text).toBe('It is gone.');
        });

        it('resumes a paused turn at the end of loaded history once denied', async () => {
            const specs = await pausedTurnSpecs(),
                execute = vi.fn(),
                transport = scripted([textEvents('Okay, I kept it.')]),
                model = createModel({transport, tools: [removeTool({execute})]});
            model.loadMessages(specs);

            await model.denyToolCallAsync('c1', 'Keep it.');

            expect(execute).not.toHaveBeenCalled();
            expect(transport.requests[0].messages[1].toolCalls[0]).toMatchObject({
                state: 'output-denied',
                errorText: 'Keep it.'
            });
            expect(model.lastMessage.text).toBe('Okay, I kept it.');
        });

        it('closes a loaded paused turn when the user sends a new message instead', async () => {
            const specs = await pausedTurnSpecs(),
                execute = vi.fn(),
                model = createModel({
                    transport: scripted([textEvents('Sure.')]),
                    tools: [removeTool({execute})]
                });
            model.loadMessages(specs);

            await model.sendAsync('Never mind');

            const closed = model.messages[1];
            expect(closed.status).toBe('complete');
            expect(closed.toolCalls[0].state).toBe('output-denied');
            expect(model.lastMessage.text).toBe('Sure.');

            await model.approveToolCallAsync('c1');
            expect(execute).not.toHaveBeenCalled();
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

function callPart(id: string): ChatToolCallPart {
    return {
        type: 'toolCall',
        id,
        step: 0,
        toolName: 'lookup',
        state: 'input-available',
        inputText: '{}',
        input: {},
        output: null,
        errorText: null
    };
}

function removeTool(changes: Partial<ChatToolSpec> = {}): ChatToolSpec {
    return {name: 'remove', execute: () => 'ok', needsApproval: true, ...changes};
}

/** Stored history - through JSON - that ends with a turn paused for approval of call 'c1'. */
async function pausedTurnSpecs(): Promise<ChatMessageSpec[]> {
    const model = createModel({
        transport: scripted([toolCallEvents('remove', {}, {toolCallId: 'c1'})]),
        tools: [removeTool()]
    });
    await model.sendAsync('Remove it');
    return JSON.parse(JSON.stringify(model.getMessageSpecs()));
}
