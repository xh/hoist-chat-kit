import {initTestAppAsync} from '@xh/hoist/test-support';
import {beforeAll, describe, expect, it, onTestFinished} from 'vitest';
import {
    AgUiCodec,
    type ChatEvent,
    type RunFinishedEvent,
    interruptEvents,
    ScriptedChatTransport,
    subagentEvents,
    textEvents,
    toolCallEvents
} from '../transport';
import {ChatModel} from './ChatModel';
import type {ChatDataPart, ChatReasoningPart, ChatToolCallPart} from './ChatPart';
import {replayChatEvents} from './replayChatEvents';

/**
 * A backend that stores each turn's AG-UI events rebuilds its threads from them. The reply must
 * read as it did live - timed by when things happened, not by when the thread loaded - and end in
 * the state the live chat would have left it in, so that the conversation can carry on.
 */
describe('replayChatEvents', () => {
    beforeAll(() => initTestAppAsync());

    it('rebuilds a finished turn, timed by its events rather than the load', () => {
        const call = toolCallEvents('search', {q: 'rates'}, {toolCallId: 'c1', result: 'ok'}),
            agent = subagentEvents('Researcher', [], {subagentRunId: 's1'}) as ChatEvent[],
            spec = replayChatEvents([
                ...at(1000, [STARTED, ...reasoningOpen('r1', 'Planning.')]),
                ...at(2000, [...reasoningClose('r1'), ...call.slice(0, -1)]),
                ...at(5000, [...call.slice(-1), agent[0]]),
                ...at(8000, agent.slice(1)),
                ...at(9000, textEvents('Done.')),
                ...at(10000, [FINISHED])
            ]);

        expect(spec).toMatchObject({role: 'assistant', status: 'complete', createdAt: 1000});
        expect(spec.metadata).toMatchObject({elapsedMs: 9000, endedAt: 10000});
        const [reasoning, tool, subagent] = spec.parts as [
            ChatReasoningPart,
            ChatToolCallPart,
            ChatDataPart
        ];
        expect([reasoning.startedAt, reasoning.endedAt]).toEqual([1000, 2000]);
        expect([tool.startedAt, tool.endedAt]).toEqual([2000, 5000]);
        expect([subagent.data.startedAt, subagent.data.endedAt]).toEqual([5000, 8000]);
        expect(spec.parts[3]).toMatchObject({type: 'text', text: 'Done.', state: 'done'});
    });

    it('fails a turn that ended in RUN_ERROR, closing what it left open at its end', () => {
        const spec = replayChatEvents(failedTurn('overloaded'));

        expect(spec).toMatchObject({status: 'error', error: 'Model overloaded.'});
        expect(spec.metadata.errorCode).toBe('overloaded');
        expect(spec.parts[0]).toMatchObject({state: 'output-error', endedAt: 4000});
        expect((spec.parts[1] as ChatDataPart).data).toMatchObject({
            status: 'error',
            endedAt: 4000
        });
    });

    it('takes the status the backend recorded, leaving out the details of a failure', () => {
        const spec = replayChatEvents(failedTurn('execution_cancelled'), {status: 'aborted'});

        expect(spec).toMatchObject({status: 'aborted', error: null});
        expect(spec.metadata).not.toHaveProperty('errorCode');
        expect(spec.metadata).not.toHaveProperty('detached');
        expect(spec.parts[0]).toMatchObject({cancelled: true, endedAt: 4000});
        expect((spec.parts[1] as ChatDataPart).data.status).toBe('cancelled');
    });

    it('leaves a turn with no end detached, unless the backend says how it ended', () => {
        const events = [...at(1000, [STARTED]), ...at(3000, textEvents('Working').slice(0, -1))],
            spec = replayChatEvents(events, {decoder: new AgUiCodec().createDecoder()});

        expect(spec).toMatchObject({
            status: 'aborted',
            metadata: {detached: true, elapsedMs: 2000}
        });
        expect(spec.parts[0]).toMatchObject({text: 'Working', state: 'done'});
        expect(replayChatEvents(events, {status: 'aborted'}).metadata).not.toHaveProperty(
            'detached'
        );
    });

    it('pauses a turn that ended on interrupts, so the user can still answer and approve', () => {
        const spec = replayChatEvents([
                STARTED,
                ...toolCallEvents('transfer_funds', {amount: 50}, {toolCallId: 's1'}),
                interrupted([QUESTION, {id: 'a1', reason: 'tool_call', toolCallId: 's1'}])
            ]),
            model = new ChatModel({transport: new ScriptedChatTransport({responses: []})});
        onTestFinished(() => model.destroy());

        model.loadMessages([{role: 'user', content: 'Pay Bob'}, spec]);
        expect(model.lastMessage.status).toBe('paused');
        expect(model.openInterrupts.map(it => it.id)).toEqual(['q1', 'a1']);
        // As live, the server's call waits on the user's approval, not on a tool of the chat.
        expect(model.pendingApprovals.map(it => it.id)).toEqual(['s1']);
    });

    it('replays a run after a finished one as the next step, with the answers it carried', () => {
        const spec = replayChatEvents([
            ...at(1000, [STARTED, ...textEvents('Checking.')]),
            ...at(1500, [{type: 'SUBAGENT_STARTED', subagentRunId: 's1', name: 'Planner'}]),
            ...at(2000, [interrupted([QUESTION])]),
            ...at(60000, [{type: 'RUN_STARTED', threadId: 't', runId: 'r2'}]),
            ...at(62000, [
                ...textEvents('Booked.'),
                {type: 'RUN_FINISHED', threadId: 't', runId: 'r2'}
            ])
        ]);

        expect(spec.status).toBe('complete');
        expect(spec.parts.map(it => it.step)).toEqual([0, 0, 1]);
        // A sub-agent left running ends with its run, as live, not as the turn moves on.
        expect((spec.parts[1] as ChatDataPart).data).toMatchObject({
            status: 'complete',
            endedAt: 2000
        });
        expect(spec.metadata.interrupts).toMatchObject([{id: 'q1', delivered: true}]);
        // The user's minute on the question is not time the reply took.
        expect(spec.metadata.elapsedMs).toBe(3000);
    });

    it('closes a browser tool call of an earlier step while paused, as its result is not stored', () => {
        const waits: ChatEvent = {
                type: 'SUBAGENT_FINISHED',
                subagentRunId: 's1',
                outcome: {type: 'suspended'}
            } as ChatEvent,
            spec = replayChatEvents([
                STARTED,
                ...toolCallEvents('get_selection', {}, {toolCallId: 'c1'}),
                {type: 'SUBAGENT_STARTED', subagentRunId: 's1', name: 'Planner'},
                waits,
                FINISHED,
                {type: 'RUN_STARTED', threadId: 't', runId: 'r2'},
                {type: 'SUBAGENT_STARTED', subagentRunId: 's1', name: 'Planner'},
                waits,
                {...interrupted([QUESTION]), runId: 'r2'} as ChatEvent
            ]);

        expect(spec.status).toBe('paused');
        expect(spec.parts[0]).toMatchObject({state: 'output-error'});
        // A sub-agent from an earlier step that waits on the question still waits.
        expect((spec.parts[1] as ChatDataPart).data.status).toBe('waiting');
    });

    it('fails only its own reply on a record the decoder rejects, keeping what came before', () => {
        const spec = replayChatEvents([STARTED, ...textEvents('Hi.'), STARTED], {
            decoder: new AgUiCodec().createDecoder()
        });

        expect(spec).toMatchObject({
            status: 'error',
            error: expect.stringMatching(/Invalid AG-UI/)
        });
        expect(spec.metadata.errorCode).toBe('invalid-stream');
        expect(spec.parts[0]).toMatchObject({text: 'Hi.'});
    });

    it("keeps the app's id and metadata, and claims no duration without timestamps", () => {
        const spec = replayChatEvents([STARTED, ...textEvents('Hi.'), FINISHED], {
            id: 'a1',
            metadata: {serverId: 's1', version: 3}
        });

        expect(spec).toMatchObject({id: 'a1', status: 'complete'});
        expect(spec.metadata).toMatchObject({serverId: 's1', version: 3, runStarted: true});
        expect(spec.metadata).not.toHaveProperty('elapsedMs');
    });
});

//------------------
// Helpers
//------------------
const STARTED: ChatEvent = {type: 'RUN_STARTED', threadId: 't', runId: 'r'},
    FINISHED: ChatEvent = {type: 'RUN_FINISHED', threadId: 't', runId: 'r'},
    QUESTION = {id: 'q1', reason: 'input_required', message: 'Which floor?'};

/** The end of a run that asks the user questions. */
function interrupted(interrupts: Parameters<typeof interruptEvents>[0]): ChatEvent {
    return {...(interruptEvents(interrupts)[0] as RunFinishedEvent), threadId: 't', runId: 'r'};
}

/** Events stamped with a time, as a backend stores them. */
function at(timestamp: number, events: ChatEvent[]): ChatEvent[] {
    return events.map(it => ({...it, timestamp}));
}

function reasoningOpen(messageId: string, text: string): ChatEvent[] {
    return [
        {type: 'REASONING_START', messageId},
        {type: 'REASONING_MESSAGE_START', messageId, role: 'reasoning'},
        {type: 'REASONING_MESSAGE_CONTENT', messageId, delta: text}
    ];
}

function reasoningClose(messageId: string): ChatEvent[] {
    return [
        {type: 'REASONING_MESSAGE_END', messageId},
        {type: 'REASONING_END', messageId}
    ];
}

/** A turn that failed while a tool call waited on its result, and a sub-agent ran. */
function failedTurn(code: string): ChatEvent[] {
    return [
        ...at(1000, [STARTED]),
        ...at(2000, [
            ...toolCallEvents('search', {}, {toolCallId: 'c1'}),
            {type: 'SUBAGENT_STARTED', subagentRunId: 's1', name: 'Researcher'}
        ]),
        ...at(4000, [{type: 'RUN_ERROR', message: 'Model overloaded.', code}])
    ];
}
