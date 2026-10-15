import {initTestAppAsync} from '@xh/hoist/test-support';
import {beforeAll, describe, expect, it, onTestFinished} from 'vitest';
import {ChatMessage, ChatModel, ChatStreamReducer} from '../core';
import {type ChatRunRequest, createChatRunRequest} from './ChatTransport';
import {
    errorEvents,
    reasoningEvents,
    ScriptedChatTransport,
    textEvents,
    toolCallEvents
} from './ScriptedChatTransport';

/**
 * Apps can use the kit's transports and codecs with their own state, without ChatModel. They build
 * a request with createChatRunRequest, run it, and fold the events into a message with
 * ChatStreamReducer. The request must match what ChatModel sends, so a backend cannot tell the two
 * apart.
 */
describe('createChatRunRequest', () => {
    beforeAll(() => initTestAppAsync());

    it('matches the request ChatModel sends for the first step of a turn', async () => {
        const transport = new ScriptedChatTransport({responses: [textEvents('Hi.')], delayMs: 0}),
            chatModel = new ChatModel({transport});
        onTestFinished(() => chatModel.destroy());
        chatModel.runOptions = {scope: 'docs'};

        await chatModel.sendAsync('Hello');

        // The chat adds its own activity callback, which an app's request has no need for.
        const [{onActivity, ...sent}] = transport.requests,
            userMessage = chatModel.messages[0],
            request = createChatRunRequest({messages: [userMessage]});

        expect(onActivity).toBeInstanceOf(Function);
        expect(request).toEqual({
            ...sent,
            threadId: expect.any(String),
            runId: expect.any(String),
            messages: [userMessage],
            signal: expect.any(AbortSignal)
        });
        expect(request.runOptions).toEqual({scope: 'docs'});
    });

    it('defaults every field but the messages', () => {
        const userMessage = new ChatMessage({role: 'user', content: 'Hello'}),
            messages = [new ChatMessage({role: 'assistant', content: 'Welcome.'}), userMessage],
            request = createChatRunRequest({messages});

        expect(request).toEqual({
            threadId: expect.any(String),
            runId: expect.any(String),
            historyMode: 'client',
            trigger: 'submit',
            turnId: userMessage.id,
            stepIndex: 0,
            messages,
            newMessages: [userMessage],
            replacedMessageId: null,
            runOptions: null,
            catalogVersion: null,
            tools: [],
            context: [],
            signal: expect.any(AbortSignal)
        });
        expect(request.threadId).not.toBe(request.runId);
        expect(request.signal.aborted).toBe(false);
    });

    it('keeps the fields the spec sets, and ignores those it leaves undefined', () => {
        const controller = new AbortController(),
            request = createChatRunRequest({
                messages: [],
                threadId: 't1',
                historyMode: 'server',
                runOptions: null,
                tools: undefined,
                signal: controller.signal
            });

        expect(request).toMatchObject({
            threadId: 't1',
            historyMode: 'server',
            turnId: null,
            newMessages: [],
            runOptions: null,
            tools: []
        });
        expect(request.signal).toBe(controller.signal);
    });

    describe('with a transport and ChatStreamReducer, without ChatModel', () => {
        it('folds a streamed reply into an assistant message', async () => {
            const transport = new ScriptedChatTransport({
                    responses: [
                        [
                            reasoningEvents('Need the forecast.'),
                            textEvents('Checking Paris.'),
                            toolCallEvents('getWeather', {city: 'Paris'}, {toolCallId: 'c1'})
                        ]
                    ],
                    delayMs: 0
                }),
                request = createChatRunRequest({
                    messages: [new ChatMessage({role: 'user', content: 'Weather in Paris?'})]
                }),
                reply = await runStep(transport, request);

            expect(reply.status).toBe('streaming');
            expect(reply.metadata.runId).toBe(request.runId);
            expect(reply.text).toBe('Checking Paris.');
            expect(reply.parts).toMatchObject([
                {type: 'reasoning', text: 'Need the forecast.', state: 'done', step: 0},
                {type: 'text', text: 'Checking Paris.', state: 'done', step: 0},
                {
                    type: 'toolCall',
                    id: 'c1',
                    toolName: 'getWeather',
                    state: 'input-available',
                    input: {city: 'Paris'},
                    step: 0
                }
            ]);
            expect(transport.requests).toEqual([request]);
        });

        it('fails the message when the run reports an error', async () => {
            const transport = new ScriptedChatTransport({
                    responses: [errorEvents('The model is overloaded.', 'overloaded_error')],
                    delayMs: 0
                }),
                request = createChatRunRequest({
                    messages: [new ChatMessage({role: 'user', content: 'Hi'})]
                }),
                reply = await runStep(transport, request);

            expect(reply).toMatchObject({status: 'error', error: 'The model is overloaded.'});
            expect(reply.metadata.errorCode).toBe('overloaded_error');
        });
    });
});

//------------------
// Helpers
//------------------
/** Run one step and fold its events into a new assistant message, one event at a time. */
async function runStep(
    transport: ScriptedChatTransport,
    request: ChatRunRequest
): Promise<ChatMessage> {
    const reducer = new ChatStreamReducer(request.stepIndex);
    let reply = new ChatMessage({role: 'assistant', status: 'pending'});
    for await (const event of transport.run(request)) {
        reply = reducer.apply(reply, [event]);
    }
    return reducer.finish(reply);
}
