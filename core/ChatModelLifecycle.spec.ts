import {type PlainObject, type TrackOptions, XH} from '@xh/hoist/core';
import {initTestAppAsync} from '@xh/hoist/test-support';
import {beforeAll, describe, expect, it, onTestFinished, vi} from 'vitest';
import {
    type ChatEvent,
    type ChatRunRef,
    errorEvents,
    ScriptedChatTransport,
    type ScriptedResponse,
    textEvents,
    toolCallEvents
} from '../transport';
import {ChatAbortError} from './ChatAbortError';
import {ChatModel, type ChatModelConfig} from './ChatModel';
import {ChatRunError} from './ChatRunError';

/**
 * The run lifecycle of a ChatModel, in both conversation shapes. A server-owned conversation
 * depends on each request naming its turn and carrying only what the server has not seen, on the
 * server's ids landing on the right messages, and on a stop that cancels the run while a clear or
 * a detach leaves it running. Apps also rely on run options being fixed at send time, and on one
 * activity track per turn.
 */
describe('ChatModel run lifecycle', () => {
    beforeAll(async () => {
        await initTestAppAsync();
    });

    describe('run requests', () => {
        it('names the trigger, turn and step of each request, and sends what is new', async () => {
            const transport = scripted([
                    toolCallEvents('lookup', {}, {toolCallId: 'c1'}),
                    textEvents('Found it.')
                ]),
                model = createModel({transport, tools: [{name: 'lookup', execute: () => 'ok'}]});

            await model.sendAsync('Find it');

            const [first, second] = transport.requests,
                [user, reply] = model.messages;
            expect(first).toMatchObject({
                historyMode: 'client',
                trigger: 'submit',
                turnId: user.id,
                stepIndex: 0,
                replacedMessageId: null
            });
            expect(first.newMessages.map(it => it.id)).toEqual([user.id]);
            expect(second).toMatchObject({trigger: 'continue', turnId: user.id, stepIndex: 1});
            expect(second.newMessages.map(it => it.id)).toEqual([reply.id]);
            expect(second.newMessages[0].toolCalls[0].state).toBe('output-available');
            expect(second.messages.map(it => it.id)).toEqual([user.id, reply.id]);
        });

        it('reuses the turn id on retry, and names the reply it replaces', async () => {
            const transport = scripted([errorEvents('Overloaded'), textEvents('Recovered.')]),
                model = createModel({transport});
            await model.sendAsync('Hi');
            const failedId = model.lastMessage.id;

            await model.retryAsync();

            const [first, retry] = transport.requests;
            expect(retry).toMatchObject({
                trigger: 'retry',
                turnId: first.turnId,
                replacedMessageId: failedId
            });
            expect(retry.newMessages.map(it => it.id)).toEqual([first.turnId]);
        });

        it('sends regenerate and edit with their triggers', async () => {
            const transport = scripted([textEvents('One.'), textEvents('Two.'), textEvents('3.')]),
                model = createModel({transport});
            await model.sendAsync('Count');
            const [user, reply] = model.messages;

            await model.regenerateAsync();
            await model.editMessageAsync(user.id, 'Count again');

            const [, regenerate, edit] = transport.requests;
            expect(regenerate).toMatchObject({
                trigger: 'regenerate',
                turnId: user.id,
                replacedMessageId: reply.id
            });
            expect(edit).toMatchObject({trigger: 'edit', turnId: user.id, replacedMessageId: null});
            expect(edit.newMessages[0].text).toBe('Count again');
        });

        it('copies the run options at send time, so a later change never reaches the turn', async () => {
            let release: () => void;
            const gate = new Promise<void>(resolve => (release = resolve)),
                transport = scripted([toolCallEvents('wait', {}), textEvents('Done.')]),
                options = {scope: ['doc-1']},
                model = createModel({
                    transport,
                    runOptions: options,
                    tools: [{name: 'wait', execute: () => gate}]
                });

            const done = model.sendAsync('Summarize');
            await vi.waitFor(() => expect(model.lastMessage.toolCalls[0]?.state).toBe('running'));
            options.scope.push('doc-2');
            model.runOptions = {scope: ['doc-3']};
            release();
            await done;

            const [first, second] = transport.requests;
            expect(first.runOptions).toEqual({scope: ['doc-1']});
            expect(second.runOptions).toBe(first.runOptions);
            expect(model.messages[0].metadata.runOptions).toEqual({scope: ['doc-1']});
        });

        it('re-runs a turn with the run options recorded on its user message', async () => {
            const transport = scripted([errorEvents('Overloaded'), textEvents('Recovered.')]),
                model = createModel({transport, runOptions: {profile: 'fast'}});
            await model.sendAsync('Hi');

            model.runOptions = {profile: 'deep'};
            await model.retryAsync();

            expect(transport.requests[1].runOptions).toEqual({profile: 'fast'});
        });

        it('sends null run options, and records none, when there are none', async () => {
            const transport = scripted([textEvents('Hi.')]),
                model = createModel({transport});

            await model.sendAsync('Hi');

            expect(transport.requests[0].runOptions).toBeNull();
            expect(model.messages[0].metadata).not.toHaveProperty('runOptions');
        });

        it('rejects an unknown history mode', () => {
            expect(
                () => new ChatModel({transport: scripted([]), historyMode: 'shared' as any})
            ).toThrow('historyMode');
        });
    });

    describe('server ids', () => {
        it('records the run id and server ids, and never changes a kit id', async () => {
            const model = createModel([
                [
                    runStarted('t-any', 'run-7'),
                    custom('xh.chat.message', {role: 'user', serverId: 'srv-user'}),
                    custom('xh.chat.message', {role: 'assistant', serverId: 'srv-reply'}),
                    textEvents('Hello.')
                ]
            ]);

            const done = model.sendAsync('Hi'),
                [user, reply] = model.messages;
            await done;

            expect(model.messages.map(it => it.id)).toEqual([user.id, reply.id]);
            expect(model.messages[0].metadata.serverId).toBe('srv-user');
            expect(model.messages[1].metadata).toMatchObject({
                serverId: 'srv-reply',
                runId: 'run-7'
            });
        });

        it('adopts the server thread id from the first run of a new thread, once', async () => {
            const transport = scripted([
                    [runStarted('srv-thread', 'r1'), textEvents('One.')],
                    [runStarted('srv-other', 'r2'), textEvents('Two.')]
                ]),
                model = createModel({transport, historyMode: 'server'}),
                localId = model.threadId;

            await model.sendAsync('First');
            expect(model.threadId).toBe('srv-thread');

            await model.sendAsync('Second');
            expect(model.threadId).toBe('srv-thread');
            expect(transport.requests.map(it => it.threadId)).toEqual([localId, 'srv-thread']);
        });

        it('adopts again after a clear, which starts a new thread', async () => {
            const model = createModel({
                transport: scripted([
                    [runStarted('srv-1', 'r1'), textEvents('One.')],
                    [runStarted('srv-2', 'r2'), textEvents('Two.')]
                ]),
                historyMode: 'server'
            });
            await model.sendAsync('First');

            model.clear();
            await model.sendAsync('Second');

            expect(model.threadId).toBe('srv-2');
        });

        it('keeps the id of a thread loaded with one', async () => {
            const model = createModel({
                transport: scripted([[runStarted('srv-other', 'r1'), textEvents('Hi.')]]),
                historyMode: 'server'
            });
            model.loadMessages([{role: 'user', content: 'Earlier'}], 'srv-known');

            await model.sendAsync('Hi');

            expect(model.threadId).toBe('srv-known');
        });

        it('keeps its own thread id in client mode', async () => {
            const model = createModel([[runStarted('srv-thread', 'r1'), textEvents('Hi.')]]),
                {threadId} = model;

            await model.sendAsync('Hi');

            expect(model.threadId).toBe(threadId);
        });
    });

    describe('stop, detach and cancel', () => {
        it('stops with reason stop, and asks the transport to cancel the run', async () => {
            const transport = new CancellableTransport({
                    responses: [[runStarted('t', 'srv-run'), textEvents('A long, slow answer.')]],
                    delayMs: 20
                }),
                model = createModel({transport, historyMode: 'server'});

            const done = model.sendAsync('Hi');
            await vi.waitFor(() => expect(model.lastMessage.text).not.toBe(''));
            model.stop();
            await done;

            const [request] = transport.requests,
                reason = request.signal.reason;
            expect(reason).toBeInstanceOf(ChatAbortError);
            expect(reason).toMatchObject({name: 'AbortError', reason: 'stop'});
            expect(transport.cancelAsync).toHaveBeenCalledExactlyOnceWith({
                threadId: model.threadId,
                runId: 'srv-run',
                turnId: model.messages[0].id,
                request
            });
            expect(model.lastMessage.status).toBe('aborted');
            expect(model.lastMessage.metadata).not.toHaveProperty('detached');
        });

        it('detaches without a cancel, and marks the reply detached in server mode', async () => {
            const transport = new CancellableTransport({
                    responses: [textEvents('A long, slow answer.')],
                    delayMs: 20
                }),
                model = createModel({transport, historyMode: 'server'});

            const done = model.sendAsync('Hi');
            await vi.waitFor(() => expect(model.lastMessage.text).not.toBe(''));
            model.detach();
            await done;

            expect(transport.requests[0].signal.reason).toMatchObject({reason: 'detach'});
            expect(transport.cancelAsync).not.toHaveBeenCalled();
            expect(model.lastMessage).toMatchObject({
                status: 'aborted',
                metadata: {detached: true}
            });
        });

        it.each([
            ['server', true],
            ['client', false]
        ] as const)(
            'aborts a running turn on clear with no cancel, in %s mode',
            async (historyMode, isDetached) => {
                const transport = new CancellableTransport({
                        responses: [textEvents('A long, slow answer.')],
                        delayMs: 20
                    }),
                    onTurnComplete = vi.fn(),
                    model = createModel({transport, historyMode, onTurnComplete});

                const done = model.sendAsync('Hi');
                await vi.waitFor(() => expect(model.lastMessage.text).not.toBe(''));
                model.clear();
                await done;

                const [reply] = onTurnComplete.mock.calls[0];
                expect(transport.requests[0].signal.reason).toMatchObject({reason: 'clear'});
                expect(transport.cancelAsync).not.toHaveBeenCalled();
                expect(reply.status).toBe('aborted');
                expect(!!reply.metadata.detached).toBe(isDetached);
            }
        );

        it('sends no cancel for a stop while a client tool runs', async () => {
            const transport = new CancellableTransport({
                    responses: [toolCallEvents('slow', {}, {toolCallId: 'c1'})],
                    delayMs: 0
                }),
                model = createModel({
                    transport,
                    tools: [{name: 'slow', execute: () => new Promise(() => {})}]
                });

            const done = model.sendAsync('Go');
            await vi.waitFor(() => expect(model.lastMessage.toolCalls[0]?.state).toBe('running'));
            model.stop();
            await done;

            expect(transport.cancelAsync).not.toHaveBeenCalled();
        });

        it('logs a failed cancel, and never shows it', async () => {
            const transport = new CancellableTransport({
                    responses: [textEvents('A long, slow answer.')],
                    delayMs: 20
                }),
                model = createModel({transport}),
                logWarn = vi.spyOn(model, 'logWarn').mockImplementation(() => {});
            transport.cancelAsync.mockRejectedValue(new Error('No such run'));

            const done = model.sendAsync('Hi');
            await vi.waitFor(() => expect(model.lastMessage.text).not.toBe(''));
            model.stop();
            await done;

            await vi.waitFor(() => expect(logWarn).toHaveBeenCalled());
            expect(model.status).toBe('ready');
            expect(model.lastError).toBeNull();
        });

        it('aborts with reason destroy when the model is destroyed mid-turn', async () => {
            const transport = new CancellableTransport({
                    responses: [textEvents('A long, slow answer.')],
                    delayMs: 20
                }),
                model = new ChatModel({transport});

            const done = model.sendAsync('Hi');
            await vi.waitFor(() => expect(model.lastMessage.text).not.toBe(''));
            model.destroy();
            await done;

            expect(transport.requests[0].signal.reason).toMatchObject({reason: 'destroy'});
            expect(transport.cancelAsync).not.toHaveBeenCalled();
        });
    });

    describe('textTransform', () => {
        it('rewrites streamed text before it is stored', async () => {
            const seen: string[] = [],
                model = createModel({
                    transport: scripted([
                        textEvents('<thinking>Look it up.</thinking>It is sunny.', {chunkSize: 3})
                    ]),
                    textTransform: text => text.replace(/<thinking>[\s\S]*?(<\/thinking>|$)/g, '')
                });
            model.addReaction({
                track: () => model.lastMessage?.text,
                run: text => seen.push(text)
            });

            await model.sendAsync('Weather?');

            expect(model.lastMessage.text).toBe('It is sunny.');
            expect(seen.every(it => !it?.includes('thinking'))).toBe(true);
            expect(model.messages[0].text).toBe('Weather?');
        });
    });

    describe('errors', () => {
        it('carries the wait the backend asks for on the run error', async () => {
            const model = createModel([
                errorEvents('Still answering.', 'duplicate_in_progress', {retryAfterSeconds: 30})
            ]);

            await model.sendAsync('Hi');

            expect(model.lastError).toBeInstanceOf(ChatRunError);
            expect(model.lastError).toMatchObject({
                code: 'duplicate_in_progress',
                retryAfterSeconds: 30
            });
            expect(model.lastMessage.metadata.retryAfterSeconds).toBe(30);
        });

        it('leaves retryAfterSeconds null when the backend gives none', async () => {
            const model = createModel([errorEvents('Overloaded', 'overloaded_error')]);
            await model.sendAsync('Hi');
            expect((model.lastError as ChatRunError).retryAfterSeconds).toBeNull();
        });

        it('fails a run that finishes with no content, rather than show a blank reply', async () => {
            const model = createModel([[]]);

            await model.sendAsync('Hi');

            expect(model.status).toBe('error');
            expect(model.lastError).toMatchObject({code: 'empty-response'});
            expect(model.lastMessage.error).toBe('The response ended without any content.');
        });
    });

    describe('thread layer seams', () => {
        it('blocks sends with an added blocker, after the configured one', async () => {
            const state = {configured: null, added: 'Wait for the history.'},
                transport = scripted([textEvents('Hi.')]),
                model = createModel({transport, sendBlocker: () => state.configured});
            model.addSendBlocker(() => state.added);

            expect(model.sendBlockedReason).toBe('Wait for the history.');
            await model.sendAsync('Hi');
            expect(transport.requests).toEqual([]);

            state.configured = 'Choose a document.';
            expect(model.sendBlockedReason).toBe('Choose a document.');
        });

        it('blocks retry and regenerate while blocked, as it blocks sends', async () => {
            const state = {reason: null},
                transport = scripted([textEvents('First.'), textEvents('Second.')]),
                model = createModel({transport, sendBlocker: () => state.reason});
            await model.sendAsync('Hi');
            expect(transport.requests).toHaveLength(1);

            state.reason = 'Another thread is running.';
            await model.retryAsync();
            await model.regenerateAsync();
            expect(transport.requests).toHaveLength(1);

            state.reason = null;
            await model.regenerateAsync();
            expect(transport.requests).toHaveLength(2);
        });
    });

    describe('activity tracking', () => {
        it('tracks each finished turn once, with counts and ids but no message text', async () => {
            const track = spyTrack(),
                model = createModel({
                    transport: scripted([
                        [
                            runStarted('t', 'run-1'),
                            toolCallEvents('lookup', {}),
                            toolCallEvents('fail', {})
                        ],
                        textEvents('Secret answer.')
                    ]),
                    tools: [
                        {name: 'lookup', execute: () => 'ok'},
                        {
                            name: 'fail',
                            execute: () => {
                                throw new Error('Nope');
                            }
                        }
                    ],
                    track: {category: 'Assistant'}
                });

            await model.sendAsync('Secret question');

            expect(track).toHaveBeenCalledOnce();
            const options = track.mock.calls[0][0] as TrackOptions;
            expect(options).toMatchObject({
                category: 'Assistant',
                message: 'Turn complete',
                data: {
                    steps: 2,
                    toolCalls: 2,
                    toolErrors: 1,
                    errorCode: null,
                    threadId: model.threadId,
                    runId: expect.any(String),
                    historyMode: 'client'
                }
            });
            expect((options.data as PlainObject).elapsedMs).toBeTypeOf('number');
            expect(JSON.stringify(options)).not.toContain('Secret');
        });

        it('tracks a failed turn with its error code', async () => {
            const track = spyTrack(),
                model = createModel({
                    transport: scripted([errorEvents('Overloaded', 'overloaded_error')]),
                    track: true
                });

            await model.sendAsync('Hi');

            expect(track).toHaveBeenCalledExactlyOnceWith(
                expect.objectContaining({
                    category: 'Chat',
                    message: 'Turn failed',
                    data: expect.objectContaining({errorCode: 'overloaded_error', steps: 1})
                })
            );
        });

        it('tracks nothing by default', async () => {
            const track = spyTrack(),
                model = createModel([textEvents('Hi.')]);
            await model.sendAsync('Hi');
            expect(track).not.toHaveBeenCalled();
        });
    });
});

//------------------
// Helpers
//------------------
class CancellableTransport extends ScriptedChatTransport {
    readonly cancelAsync = vi.fn<(run: ChatRunRef) => Promise<void>>(async () => {});
}

function scripted(responses: ScriptedResponse[]): ScriptedChatTransport {
    return new ScriptedChatTransport({responses, delayMs: 0});
}

function createModel(config: ScriptedResponse[] | ChatModelConfig): ChatModel {
    const model = new ChatModel(Array.isArray(config) ? {transport: scripted(config)} : config);
    onTestFinished(() => model.destroy());
    return model;
}

function runStarted(threadId: string, runId: string): ChatEvent {
    return {type: 'RUN_STARTED', threadId, runId};
}

function custom(name: string, value: any): ChatEvent {
    return {type: 'CUSTOM', name, value};
}

function spyTrack() {
    const track = vi.spyOn(XH, 'track').mockImplementation(() => {});
    onTestFinished(() => track.mockRestore());
    return track;
}
