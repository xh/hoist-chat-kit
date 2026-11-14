import {initTestAppAsync} from '@xh/hoist/test-support';
import {beforeAll, describe, expect, it, onTestFinished, vi} from 'vitest';
import {
    type ChatEvent,
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
