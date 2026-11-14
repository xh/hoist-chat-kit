import {XH} from '@xh/hoist/core';
import {observable} from '@xh/hoist/mobx';
import {initTestAppAsync} from '@xh/hoist/test-support';
import {beforeAll, describe, expect, it, onTestFinished, vi} from 'vitest';
import {
    type ChatEvent,
    type ChatTransport,
    errorEvents,
    interruptEvents,
    ScriptedChatTransport,
    scriptedDelay,
    type ScriptedResponse,
    textEvents,
    toolCallEvents
} from '../transport';
import {ChatModel, type ChatModelConfig} from './ChatModel';

/**
 * An agent shares its state with the app, such as its to-do list, and the app may change it. Both
 * sides patch the same value, so the chat must hold exactly what the agent holds: a delta applied
 * to the wrong base corrupts the state for the rest of the thread. These specs hold the chat to
 * AG-UI's rules for it, and to one writer at a time.
 */
describe('ChatModel agent state', () => {
    beforeAll(async () => {
        await initTestAppAsync();
    });

    it("holds an empty object, or the config's state, until the agent or the app sets it", () => {
        expect(createModel({responses: []}).model.agentState).toEqual({});
        expect(
            createModel({responses: [], agentState: {todos: ['Plan']}}).model.agentState
        ).toEqual({todos: ['Plan']});
    });

    it("follows the agent's snapshots and deltas as a turn runs, as an observable", async () => {
        const {model} = createModel({
                responses: [
                    [
                        snapshot({todos: ['Plan']}),
                        delta({op: 'add', path: '/todos/-', value: 'Review'}),
                        textEvents('Done.')
                    ]
                ]
            }),
            seen: any[] = [];
        model.addReaction({track: () => model.agentState, run: it => seen.push(it)});

        await model.sendAsync('Plan the work');

        expect(model.agentState).toEqual({todos: ['Plan', 'Review']});
        expect(seen.at(-1)).toBe(model.agentState);
        expect(model.lastMessage).toMatchObject({status: 'complete', text: 'Done.'});
    });

    it('sends the state it holds with every run, each step with what the step before left', async () => {
        const {model, transport} = createModel({
            responses: [
                [snapshot({todos: ['Plan']}), toolCallEvents('ping', {})],
                [delta({op: 'add', path: '/done', value: true}), textEvents('Done.')],
                textEvents('Again.')
            ],
            tools: [{name: 'ping', execute: () => 'pong'}]
        });

        await model.sendAsync('Plan the work');
        await model.sendAsync('And again');

        expect(transport.requests.map(it => it.agentState)).toEqual([
            {},
            {todos: ['Plan']},
            {todos: ['Plan'], done: true}
        ]);
    });

    it('patches the state the app set, which the request sent', async () => {
        const {model, transport} = createModel({
            responses: [[delta({op: 'add', path: '/todos/-', value: 'Review'}), textEvents('Ok.')]]
        });

        model.setAgentState({todos: ['Plan']});
        await model.sendAsync('Add a review');

        expect(transport.requests[0].agentState).toEqual({todos: ['Plan']});
        expect(model.agentState).toEqual({todos: ['Plan', 'Review']});
    });

    it('takes no change from the app while a turn runs, with a warning', async () => {
        const {model} = createModel({
                responses: [[snapshot({todos: ['Plan']}), textEvents('Working'), HANG]]
            }),
            logWarn = vi.spyOn(model, 'logWarn').mockImplementation(() => {}),
            sent = model.sendAsync('Plan the work');
        await vi.waitFor(() => expect(model.agentState).toEqual({todos: ['Plan']}));

        model.setAgentState({todos: []});

        expect(model.agentState).toEqual({todos: ['Plan']});
        expect(logWarn).toHaveBeenCalledWith(expect.stringContaining('a turn is in progress'));

        model.stop();
        await sent;
        model.setAgentState({todos: []});
        expect(model.agentState).toEqual({todos: []});
    });

    it('takes a change while a turn waits for the user, and sends it with the answer', async () => {
        const {model, transport} = createModel({
            responses: [
                [snapshot({floor: null}), interruptEvents([{id: 'q1', reason: 'input_required'}])],
                textEvents('Booked.')
            ]
        });
        await model.sendAsync('Book a room');
        expect(model.isAwaitingUser).toBe(true);

        model.setAgentState({floor: 3});
        model.answerInterrupt('q1', {ok: true});
        await model.submitInterruptsAsync();

        expect(transport.requests[1].agentState).toEqual({floor: 3});
        expect(model.agentState).toEqual({floor: 3});
    });

    it('keeps the state, and the turn, when a delta does not apply', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {}),
            {model} = createModel({
                responses: [
                    [
                        snapshot({plan: {status: 'open'}}),
                        delta(
                            {op: 'replace', path: '/plan/status', value: 'closed'},
                            {op: 'replace', path: '/absent/deeper', value: 1}
                        ),
                        textEvents('Done.')
                    ]
                ]
            });

        await model.sendAsync('Close the plan');

        expect(model.agentState).toEqual({plan: {status: 'open'}});
        expect(model.lastMessage).toMatchObject({status: 'complete', text: 'Done.'});
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('Failed to apply state patch'));
    });

    it('keeps what a failed run changed, and sends it with the retry', async () => {
        const {model, transport} = createModel({
            responses: [
                [snapshot({todos: ['Plan']}), errorEvents('Overloaded.')],
                textEvents('Done.')
            ]
        });
        vi.spyOn(model, 'logWarn').mockImplementation(() => {});

        await model.sendAsync('Plan the work');
        expect(model.status).toBe('error');
        await model.retryAsync();

        expect(transport.requests[1].agentState).toEqual({todos: ['Plan']});
    });

    it('resets to an empty object when the app sets null', () => {
        const {model} = createModel({responses: [], agentState: {todos: ['Plan']}});

        model.setAgentState(null);

        expect(model.agentState).toEqual({});
    });

    it('starts a cleared or loaded thread with no state, even from a turn in progress', async () => {
        const {model} = createModel({
            responses: [
                [snapshot({todos: ['Plan']}), textEvents('Done.')],
                [snapshot({todos: ['Plan', 'Review']}), textEvents('Working'), HANG]
            ]
        });

        await model.sendAsync('Plan the work');
        model.clear();
        expect(model.agentState).toEqual({});

        const sent = model.sendAsync('Plan it again');
        await vi.waitFor(() => expect(model.agentState).toEqual({todos: ['Plan', 'Review']}));
        model.loadMessages([{role: 'user', content: 'An older thread'}], 't-old');
        await sent;

        expect(model.agentState).toEqual({});
    });
    it('holds a plain copy of what the app sets, so that an observable in it breaks no delta', async () => {
        const selection = observable.array(['a']),
            {model} = createModel({
                responses: [
                    [delta({op: 'add', path: '/selection/-', value: 'b'}), textEvents('Ok.')]
                ]
            });

        model.setAgentState({selection});
        selection.push('z');
        expect(model.agentState).toEqual({selection: ['a']});

        await model.sendAsync('Select b');

        expect(model.agentState).toEqual({selection: ['a', 'b']});
        expect(model.lastMessage).toMatchObject({status: 'complete', text: 'Ok.'});
    });

    it("holds an empty object for an agent's null snapshot, and sends it with the next run", async () => {
        const {model, transport} = createModel({
            responses: [
                [snapshot({todos: ['Plan']}), snapshot(null), textEvents('Cleared.')],
                [delta({op: 'add', path: '/todos', value: []}), textEvents('Done.')]
            ]
        });

        await model.sendAsync('Clear the plan');
        expect(model.agentState).toEqual({});
        await model.sendAsync('Start again');

        expect(transport.requests[1].agentState).toEqual({});
        expect(model.agentState).toEqual({todos: []});
    });

    it('keeps the same value while text streams, and for a snapshot equal to it', async () => {
        const {model} = createModel({
            responses: [
                [
                    snapshot({todos: ['Plan']}),
                    textEvents('One.'),
                    scriptedDelay(60),
                    textEvents('Two.'),
                    scriptedDelay(60),
                    snapshot({todos: ['Plan']}),
                    textEvents('Three.')
                ]
            ]
        });
        let stateChanges = 0,
            messageChanges = 0;
        model.addReaction(
            {track: () => model.agentState, run: () => stateChanges++},
            {track: () => model.messages, run: () => messageChanges++}
        );

        await model.sendAsync('Plan the work');

        expect(messageChanges).toBeGreaterThan(3);
        expect(stateChanges).toBe(1);
    });

    it.each(['stop', 'detach'] as const)(
        'keeps a change the app makes after a %s, over events that arrive late',
        async action => {
            let releaseLate: () => void;
            const late = new Promise<void>(resolve => (releaseLate = resolve)),
                transport: ChatTransport = {
                    async *run({threadId, runId}) {
                        yield {type: 'RUN_STARTED', threadId, runId};
                        yield snapshot({todos: ['Plan']});
                        yield* textEvents('Working');
                        await late;
                        yield snapshot({todos: ['Late']});
                        yield {type: 'RUN_FINISHED', threadId, runId};
                    }
                },
                model = new ChatModel({transport, historyMode: 'server'});
            onTestFinished(() => model.destroy());
            const sent = model.sendAsync('Plan the work');
            await vi.waitFor(() => expect(model.agentState).toEqual({todos: ['Plan']}));

            model[action]();
            model.setAgentState({todos: ['Mine']});
            releaseLate();
            await sent;

            expect(model.agentState).toEqual({todos: ['Mine']});
        }
    );

    it('sends the state as it stands with a regenerate and an edit, with no roll back', async () => {
        const {model, transport} = createModel({
            responses: [
                [snapshot({todos: ['Plan']}), textEvents('First.')],
                textEvents('Second.'),
                textEvents('Third.')
            ]
        });
        await model.sendAsync('Plan the work');

        await model.regenerateAsync();
        model.setAgentState({todos: ['Plan', 'Mine']});
        await model.editMessageAsync(model.messages[0].id, 'Plan it better');

        expect(transport.requests.map(it => it.agentState)).toEqual([
            {},
            {todos: ['Plan']},
            {todos: ['Plan', 'Mine']}
        ]);
    });

    it("refuses a change from a client tool's execute, which runs within its turn", async () => {
        const {model, transport} = createModel({
                responses: [
                    [snapshot({todos: ['Plan']}), toolCallEvents('finish', {})],
                    textEvents('Done.')
                ],
                tools: [
                    {
                        name: 'finish',
                        execute: () => {
                            model.setAgentState({todos: []});
                            return 'ok';
                        }
                    }
                ]
            }),
            logWarn = vi.spyOn(model, 'logWarn').mockImplementation(() => {});

        await model.sendAsync('Finish the plan');

        expect(logWarn).toHaveBeenCalledWith(expect.stringContaining('a turn is in progress'));
        expect(transport.requests[1].agentState).toEqual({todos: ['Plan']});
        expect(model.agentState).toEqual({todos: ['Plan']});
    });

    it('refuses a change while a turn runs on the server, which the load after it would discard', () => {
        const {model} = createModel({responses: [], agentState: {todos: ['Plan']}}),
            logWarn = vi.spyOn(model, 'logWarn').mockImplementation(() => {});
        model.setStatusRefresher(async () => {}, {isRunningOnServer: () => true});

        expect(model.canSetAgentState).toBe(false);
        model.setAgentState({todos: []});

        expect(model.agentState).toEqual({todos: ['Plan']});
        expect(logWarn).toHaveBeenCalledWith(expect.stringContaining('runs on the server'));
    });

    it('takes the state given with a load, even while a turn runs on the server', () => {
        const {model} = createModel({responses: []});
        model.setStatusRefresher(async () => {}, {isRunningOnServer: () => true});

        model.loadMessages([{role: 'user', content: 'Plan the work'}], 't1', {
            agentState: {todos: ['Plan']}
        });

        expect(model.agentState).toEqual({todos: ['Plan']});
    });

    describe('prepareAgentState', () => {
        it('sets the state before each step, for the request to carry and the deltas to patch', async () => {
            let sector = 'Energy';
            const {model, transport} = createModel({
                responses: [
                    [
                        delta({op: 'add', path: '/todos', value: ['Plan']}),
                        toolCallEvents('ping', {})
                    ],
                    textEvents('Done.'),
                    textEvents('Again.')
                ],
                tools: [
                    {
                        name: 'ping',
                        execute: () => {
                            sector = 'Tech';
                            return 'pong';
                        }
                    }
                ],
                prepareAgentState: (state, request) => ({
                    ...state,
                    sector,
                    step: request.stepIndex
                })
            });

            await model.sendAsync('Plan the work');
            model.clear();
            await model.sendAsync('And in a new thread');

            expect(transport.requests.map(it => it.agentState)).toEqual([
                {sector: 'Energy', step: 0},
                {sector: 'Tech', step: 1, todos: ['Plan']},
                // A cleared chat has no state, and the next run still carries the app's values.
                {sector: 'Tech', step: 0}
            ]);
            expect(model.agentState).toBe(transport.requests[2].agentState);
        });

        it('leaves the state as it is when it returns nothing, or an equal state', async () => {
            let returnsNothing = true;
            const {model, transport} = createModel({
                    responses: [textEvents('One.'), textEvents('Two.')],
                    agentState: {todos: ['Plan']},
                    prepareAgentState: state => (returnsNothing ? undefined : {...state})
                }),
                held = model.agentState;

            await model.sendAsync('One');
            returnsNothing = false;
            await model.sendAsync('Two');

            expect(model.agentState).toBe(held);
            expect(transport.requests.map(it => it.agentState)).toEqual([held, held]);
        });

        it('fails the turn, with Retry, when it throws', async () => {
            vi.spyOn(XH, 'handleException').mockImplementation(() => {});
            const {model, transport} = createModel({
                responses: [textEvents('Hi.')],
                prepareAgentState: () => {
                    throw new Error('No selection.');
                }
            });

            await model.sendAsync('Hi');

            expect(model.status).toBe('error');
            expect(model.lastError.message).toBe('No selection.');
            expect(transport.requests).toEqual([]);
        });
    });
});

//------------------
// Helpers
//------------------
const HANG = scriptedDelay(60_000);

function snapshot(state: any): ChatEvent {
    return {type: 'STATE_SNAPSHOT', snapshot: state};
}

function delta(...operations: any[]): ChatEvent {
    return {type: 'STATE_DELTA', delta: operations};
}

function createModel({
    responses,
    ...config
}: Partial<ChatModelConfig> & {responses: ScriptedResponse[]}): {
    model: ChatModel;
    transport: ScriptedChatTransport;
} {
    const transport = new ScriptedChatTransport({responses, delayMs: 0}),
        model = new ChatModel({transport, ...config});
    onTestFinished(() => model.destroy());
    return {model, transport};
}
