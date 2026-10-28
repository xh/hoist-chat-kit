import {initTestAppAsync} from '@xh/hoist/test-support';
import {beforeAll, describe, expect, it, onTestFinished, vi} from 'vitest';
import {
    type ChatEvent,
    type ChatTransport,
    errorEvents,
    interruptEvents,
    ScriptedChatTransport,
    type ScriptedResponse,
    textEvents,
    toolCallEvents
} from '../transport';
import {ChatModel, type ChatModelConfig} from './ChatModel';

/**
 * A server agent asks the user a question, or asks to run a tool, by ending its run with AG-UI's
 * `interrupt` outcome. AG-UI requires the next run on the thread to cover every interrupt of that
 * run, answered or declined, and never to answer an expired one. These specs hold the chat to
 * that, whatever the user does next: answer, decline, move on, stop or reload.
 */
describe('ChatModel interrupts', () => {
    beforeAll(async () => {
        await initTestAppAsync();
    });

    it('pauses on an interrupted run, holding its questions on the reply', async () => {
        const onTurnPause = vi.fn(),
            model = createModel({transport: scripted([ask(QUESTION)]), onTurnPause});

        await model.sendAsync('Book a room');

        const reply = model.lastMessage;
        expect(reply.status).toBe('paused');
        expect(model.isAwaitingUser).toBe(true);
        expect(model.status).toBe('ready');
        expect(model.openInterrupts.map(it => it.id)).toEqual(['q1']);
        expect(reply.metadata.interrupts).toMatchObject([
            {id: 'q1', message: 'Which floor?', response: null, delivered: false}
        ]);
        expect(onTurnPause).toHaveBeenCalledExactlyOnceWith(reply);
    });

    it('resumes with every answer once the user submits, and delivers them', async () => {
        const transport = scripted([ask(QUESTION, {...QUESTION, id: 'q2'}), textEvents('Booked.')]),
            model = createModel({transport});
        await model.sendAsync('Book a room');

        model.answerInterrupt('q1', {floor: 3});
        expect(model.openInterrupts.map(it => it.id)).toEqual(['q2']);
        await model.submitInterruptsAsync();
        expect(transport.requests).toHaveLength(1);

        model.declineInterrupt('q2');
        await model.submitInterruptsAsync();

        const resumed = transport.requests[1];
        expect(resumed).toMatchObject({trigger: 'continue', stepIndex: 1});
        expect(resumed.resume).toEqual([
            {interruptId: 'q1', status: 'resolved', payload: {floor: 3}},
            {interruptId: 'q2', status: 'cancelled'}
        ]);
        expect(model.lastMessage).toMatchObject({status: 'complete', text: 'Booked.'});
        expect(model.isAwaitingUser).toBe(false);
        expect(model.lastMessage.metadata.interrupts.map(it => it.delivered)).toEqual([true, true]);
    });

    it('lets the user change an answer before submitting', async () => {
        const transport = scripted([ask(QUESTION), textEvents('Done.')]),
            model = createModel({transport});
        await model.sendAsync('Book a room');

        model.answerInterrupt('q1', {floor: 1});
        model.declineInterrupt('q1');
        model.answerInterrupt('q1', {floor: 2});
        await model.submitInterruptsAsync();

        expect(transport.requests[1].resume).toEqual([
            {interruptId: 'q1', status: 'resolved', payload: {floor: 2}}
        ]);
    });

    it('declines every open question in the first request of a new message', async () => {
        const transport = scripted([ask(QUESTION), textEvents('Sure.')]),
            model = createModel({transport});
        await model.sendAsync('Book a room');
        const paused = model.lastMessage;

        await model.sendAsync('Never mind, book a desk');

        expect(transport.requests[1]).toMatchObject({trigger: 'submit', stepIndex: 0});
        expect(transport.requests[1].resume).toEqual([{interruptId: 'q1', status: 'cancelled'}]);
        expect(model.getMessage(paused.id).metadata.interrupts[0]).toMatchObject({
            response: {status: 'cancelled', declinedBy: 'skipped'},
            delivered: true
        });
        expect(model.lastMessage.text).toBe('Sure.');
    });

    it('declines the questions of a reply that a regenerate throws away', async () => {
        const transport = scripted([ask(QUESTION), textEvents('Again.')]),
            model = createModel({transport});
        await model.sendAsync('Book a room');

        await model.regenerateAsync();

        expect(transport.requests[1].resume).toEqual([{interruptId: 'q1', status: 'cancelled'}]);
    });

    it('declines on stop, and sends the declines with the next request', async () => {
        const transport = scripted([ask(QUESTION), textEvents('Ok.')]),
            model = createModel({transport});
        await model.sendAsync('Book a room');

        model.stop();
        expect(model.isAwaitingUser).toBe(false);
        await model.sendAsync('Something else');

        expect(transport.requests[1].resume).toEqual([{interruptId: 'q1', status: 'cancelled'}]);
    });

    it('declines the answers of a resumed run the user stops, so they never go twice', async () => {
        const transport = new ScriptedChatTransport({
                respond: (_, {requestIndex}) =>
                    [ask(QUESTION), textEvents('Working on it...'), textEvents('Ok.')][
                        requestIndex
                    ],
                delayMs: 50
            }),
            model = createModel({transport});
        await model.sendAsync('Book a room');

        model.answerInterrupt('q1', {floor: 3});
        const resuming = model.submitInterruptsAsync();
        await vi.waitFor(() => expect(transport.requests).toHaveLength(2));
        model.stop();
        await resuming;
        await model.sendAsync('Something else');

        expect(transport.requests[2].resume).toEqual([{interruptId: 'q1', status: 'cancelled'}]);
    });

    it('sends an answer again when the resumed run fails and the user tries again', async () => {
        const transport = scripted([ask(QUESTION), errorEvents('Busy'), textEvents('Booked.')]),
            model = createModel({transport});
        await model.sendAsync('Book a room');
        model.answerInterrupt('q1', {floor: 3});
        await model.submitInterruptsAsync();
        expect(model.lastMessage.status).toBe('error');

        await model.retryAsync();

        expect(transport.requests[2].resume).toEqual([
            {interruptId: 'q1', status: 'resolved', payload: {floor: 3}}
        ]);
    });

    it('counts an expired question as declined, and never answers it', async () => {
        const expired = {...QUESTION, id: 'q2', expiresAt: '2000-01-01T00:00:00Z'},
            transport = scripted([ask(QUESTION, expired), textEvents('Ok.')]),
            model = createModel({transport});
        await model.sendAsync('Book a room');

        expect(model.openInterrupts.map(it => it.id)).toEqual(['q1']);
        model.answerInterrupt('q2', {floor: 1});
        model.answerInterrupt('q1', {floor: 3});
        await model.submitInterruptsAsync();

        expect(transport.requests[1].resume).toEqual([
            {interruptId: 'q1', status: 'resolved', payload: {floor: 3}},
            {interruptId: 'q2', status: 'cancelled'}
        ]);
    });

    it('restores open questions with a reloaded conversation', async () => {
        const first = createModel([ask(QUESTION)]);
        await first.sendAsync('Book a room');
        const specs = first.getMessageSpecs(),
            transport = scripted([textEvents('Booked.')]),
            second = createModel({transport});

        second.loadMessages(specs, first.threadId);
        expect(second.openInterrupts.map(it => it.id)).toEqual(['q1']);
        second.answerInterrupt('q1', {floor: 3});
        await second.submitInterruptsAsync();

        expect(transport.requests[0]).toMatchObject({trigger: 'continue'});
        expect(transport.requests[0].resume).toEqual([
            {interruptId: 'q1', status: 'resolved', payload: {floor: 3}}
        ]);
        expect(second.lastMessage.text).toBe('Booked.');
    });

    it('runs client tool calls first, and sends their results with the answers', async () => {
        const execute = vi.fn(() => ({rooms: 4})),
            transport = scripted([
                [toolCallEvents('count_rooms', {}, {toolCallId: 'c1'}), ...ask(QUESTION)],
                textEvents('Booked.')
            ]),
            model = createModel({transport, tools: [{name: 'count_rooms', execute}]});
        await model.sendAsync('Book a room');

        expect(execute).toHaveBeenCalledOnce();
        expect(model.lastMessage.status).toBe('paused');
        model.answerInterrupt('q1', {floor: 3});
        await model.submitInterruptsAsync();

        const resumed = transport.requests[1];
        expect(resumed.resume).toHaveLength(1);
        expect(resumed.messages.at(-1).toolCalls[0]).toMatchObject({
            id: 'c1',
            state: 'output-available'
        });
    });

    it('sends submitted answers even at the step limit', async () => {
        const transport = scripted([ask(QUESTION), textEvents('Booked.')]),
            model = createModel({transport, maxSteps: 1});
        await model.sendAsync('Book a room');

        model.answerInterrupt('q1', {floor: 3});
        await model.submitInterruptsAsync();

        expect(transport.requests).toHaveLength(2);
        expect(model.lastMessage.text).toBe('Booked.');
    });

    it('pauses again when the resumed run asks more', async () => {
        const transport = scripted([
                ask(QUESTION),
                ask({...QUESTION, id: 'q2'}),
                textEvents('Ok.')
            ]),
            model = createModel({transport});
        await model.sendAsync('Book a room');
        model.answerInterrupt('q1', {floor: 3});
        await model.submitInterruptsAsync();

        expect(model.lastMessage.status).toBe('paused');
        expect(model.openInterrupts.map(it => it.id)).toEqual(['q2']);
        model.answerInterrupt('q2', {floor: 4});
        await model.submitInterruptsAsync();

        expect(transport.requests[2].resume).toEqual([
            {interruptId: 'q2', status: 'resolved', payload: {floor: 4}}
        ]);
        expect(model.lastMessage.metadata.interrupts.map(it => it.delivered)).toEqual([true, true]);
    });

    it('holds a submit back while a client approval still waits', async () => {
        const transport = scripted([
                [toolCallEvents('book', {}, {toolCallId: 'c1'}), ...ask(QUESTION)],
                textEvents('Booked.')
            ]),
            model = createModel({
                transport,
                tools: [{name: 'book', execute: () => 'ok', needsApproval: true}]
            });
        await model.sendAsync('Book a room');

        model.answerInterrupt('q1', {floor: 3});
        await model.submitInterruptsAsync();
        expect(transport.requests).toHaveLength(1);
        expect(model.pendingInterrupts).toHaveLength(1);

        await model.approveToolCallAsync('c1');
        await model.submitInterruptsAsync();
        expect(transport.requests[1].resume).toHaveLength(1);
        expect(model.lastMessage.text).toBe('Booked.');
    });

    it('restores only the questions of the last reply, and only those it never delivered', async () => {
        const first = createModel([ask(QUESTION)]);
        await first.sendAsync('Book a room');
        const [user, paused] = first.getMessageSpecs(),
            answered = {...paused, id: 'old', metadata: {interrupts: [{...QUESTION, runId: 'x'}]}},
            later = new ChatModel({transport: scripted([])});
        onTestFinished(() => later.destroy());

        later.loadMessages([user, answered, {id: 'u2', role: 'user', content: 'Hi'}]);
        expect(later.pendingInterrupts).toEqual([]);
        later.loadMessages([user, paused]);
        expect(later.pendingInterrupts.map(it => it.id)).toEqual(['q1']);
    });

    it('drops the answers of a resumed run that a server-mode detach leaves running', async () => {
        const transport = new ScriptedChatTransport({
                respond: (_, {requestIndex}) =>
                    [ask(QUESTION), textEvents('Working on it...'), textEvents('Ok.')][
                        requestIndex
                    ],
                delayMs: 50
            }),
            model = createModel({transport, historyMode: 'server'});
        await model.sendAsync('Book a room');

        model.answerInterrupt('q1', {floor: 3});
        const resuming = model.submitInterruptsAsync();
        await vi.waitFor(() => expect(transport.requests).toHaveLength(2));
        model.detach();
        await resuming;
        await model.sendAsync('Something else');

        expect(transport.requests[2].resume).toBeNull();
    });

    it('shows no answer panels for a run that fails after its interrupts, and declines them next', async () => {
        const runs = [
                [
                    {type: 'RUN_STARTED', threadId: 't', runId: 'r1'},
                    toolCallEvents('transfer_funds', {}, {toolCallId: 's1'}),
                    {
                        type: 'RUN_FINISHED',
                        threadId: 't',
                        runId: 'r1',
                        outcome: {
                            type: 'interrupt',
                            interrupts: [{id: 'a1', reason: 'tool_call', toolCallId: 's1'}]
                        }
                    },
                    {type: 'RUN_ERROR', message: 'Lost the checkpoint.'}
                ],
                [{type: 'RUN_STARTED', threadId: 't', runId: 'r2'}, ...textEvents('Ok.'), FINISHED]
            ].map(it => it.flat() as ChatEvent[]),
            requests = [],
            transport: ChatTransport = {
                supportsInterrupts: true,
                async *run(request) {
                    requests.push(request);
                    yield* runs[requests.length - 1];
                }
            },
            model = createModel({transport});
        await model.sendAsync('Pay Bob');

        expect(model.lastMessage.status).toBe('error');
        expect(model.isAwaitingUser).toBe(false);
        expect(model.pendingApprovals).toEqual([]);

        await model.sendAsync('Try something else');
        expect(requests[1].resume).toEqual([{interruptId: 'a1', status: 'cancelled'}]);
    });

    describe('server approvals', () => {
        it("treats an unlisted tool as the server's even when a display spec resolves for it", async () => {
            const transport = scripted([
                    [
                        toolCallEvents('transfer_funds', {amount: 50}, {toolCallId: 's1'}),
                        ...interruptEvents([{id: 'a1', reason: 'tool_call', toolCallId: 's1'}])
                    ],
                    textEvents('Sent.')
                ]),
                model = createModel({
                    transport,
                    getToolSpec: name => ({name, display: 'timeline'})
                });
            await model.sendAsync('Pay Bob');

            expect(model.lastMessage.toolCalls[0]).toMatchObject({
                state: 'approval-requested',
                providerExecuted: true,
                awaitsResume: true
            });
        });

        it('asks to approve a server call an interrupt names, and answers with {approved}', async () => {
            const transport = scripted([
                    [
                        toolCallEvents('transfer_funds', {amount: 50}, {toolCallId: 's1'}),
                        ...interruptEvents([{id: 'a1', reason: 'tool_call', toolCallId: 's1'}])
                    ],
                    textEvents('Sent.')
                ]),
                model = createModel({transport});
            await model.sendAsync('Pay Bob');

            const call = model.lastMessage.toolCalls[0];
            expect(call).toMatchObject({
                state: 'approval-requested',
                providerExecuted: true,
                awaitsResume: true
            });
            expect(model.pendingApprovals.map(it => it.id)).toEqual(['s1']);

            await model.approveToolCallAsync('s1');

            expect(transport.requests[1].resume).toEqual([
                {interruptId: 'a1', status: 'resolved', payload: {approved: true}}
            ]);
            expect(model.lastMessage.text).toBe('Sent.');
        });

        it('denies with the shape the schema asks for, and the user reason', async () => {
            const schema = {
                    type: 'object',
                    properties: {behavior: {enum: ['allow', 'deny']}, message: {type: 'string'}}
                },
                transport = scripted([
                    [
                        toolCallEvents('transfer_funds', {}, {toolCallId: 's1'}),
                        ...interruptEvents([
                            {
                                id: 'a1',
                                reason: 'tool_approval',
                                toolCallId: 's1',
                                responseSchema: schema
                            }
                        ])
                    ],
                    textEvents('Cancelled.')
                ]),
                model = createModel({transport});
            await model.sendAsync('Pay Bob');

            await model.denyToolCallAsync('s1', 'Too much');

            expect(transport.requests[1].resume).toEqual([
                {
                    interruptId: 'a1',
                    status: 'resolved',
                    payload: {behavior: 'deny', message: 'Too much'}
                }
            ]);
            expect(model.lastMessage.toolCalls[0]).toMatchObject({
                state: 'output-denied',
                errorText: 'Too much'
            });
        });

        it('waits for Submit when an approval is one of several interrupts', async () => {
            const transport = scripted([
                    [
                        toolCallEvents('transfer_funds', {}, {toolCallId: 's1'}),
                        ...interruptEvents([
                            {id: 'a1', reason: 'tool_call', toolCallId: 's1'},
                            QUESTION
                        ])
                    ],
                    textEvents('Sent.')
                ]),
                model = createModel({transport});
            await model.sendAsync('Pay Bob');

            await model.approveToolCallAsync('s1');
            expect(transport.requests).toHaveLength(1);
            model.answerInterrupt('q1', {floor: 2});
            await model.submitInterruptsAsync();

            expect(transport.requests[1].resume).toEqual([
                {interruptId: 'a1', status: 'resolved', payload: {approved: true}},
                {interruptId: 'q1', status: 'resolved', payload: {floor: 2}}
            ]);
        });

        it('leaves a server call it cannot run waiting for the server, never failing it', async () => {
            const model = createModel([
                [
                    toolCallEvents('lookup', {}, {toolCallId: 's1'}),
                    ...interruptEvents([{id: 'q1', reason: 'input_required', message: 'Which?'}])
                ]
            ]);
            await model.sendAsync('Find it');

            expect(model.lastMessage.toolCalls[0]).toMatchObject({
                state: 'input-available',
                providerExecuted: true,
                awaitsResume: true
            });

            await model.sendAsync('Moving on');
            expect(model.messages[1].toolCalls[0].state).toBe('input-available');
        });
    });

    it('fails a reply with interrupts that the transport cannot answer', async () => {
        const scriptedTransport = scripted([ask(QUESTION)]),
            transport: ChatTransport = {run: request => scriptedTransport.run(request)},
            model = createModel({transport});

        await model.sendAsync('Book a room');

        expect(model.lastError).toMatchObject({code: 'unsupported-interrupt'});
        expect(model.isAwaitingUser).toBe(false);
    });
});

//------------------
// Helpers
//------------------
const FINISHED: ChatEvent = {type: 'RUN_FINISHED', threadId: 't', runId: 'r2'};

const QUESTION = {
    id: 'q1',
    reason: 'input_required',
    message: 'Which floor?',
    responseSchema: {type: 'object', properties: {floor: {type: 'integer'}}}
};

function ask(...interrupts: PlainInterrupt[]): ChatEvent[] {
    return interruptEvents(interrupts);
}

type PlainInterrupt = Parameters<typeof interruptEvents>[0][number];

function scripted(responses: ScriptedResponse[]): ScriptedChatTransport {
    return new ScriptedChatTransport({responses, delayMs: 0});
}

function createModel(config: ScriptedResponse[] | ChatModelConfig): ChatModel {
    const model = new ChatModel(Array.isArray(config) ? {transport: scripted(config)} : config);
    onTestFinished(() => model.destroy());
    return model;
}
