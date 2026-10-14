import {XH} from '@xh/hoist/core';
import {initTestAppAsync} from '@xh/hoist/test-support';
import {beforeAll, describe, expect, it, onTestFinished, vi} from 'vitest';
import {type ChatEvent, ScriptedChatTransport, textEvents, toolCallEvents} from '../transport';
import {ChatModel, type ChatModelConfig} from './ChatModel';

/**
 * Context providers are how a helper agent tells the model what its component looks like now. Each
 * step must carry fresh context - including changes the model's own tools made in the step
 * before - or the model acts on stale state.
 */
describe('ChatModel context providers', () => {
    beforeAll(async () => {
        await initTestAppAsync();
    });

    it('sends the context of every provider, in order, with each step', async () => {
        let hidden = [];
        const {model, transport} = createModel({
            responses: [toolCallEvents('hide', {column: 'id'}), textEvents('Done.')],
            tools: [
                {
                    name: 'hide',
                    execute: ({column}) => {
                        hidden = [...hidden, column];
                        return 'Hidden.';
                    }
                }
            ],
            contextProviders: [
                {name: 'grid', description: 'The grid.', getContext: () => ({hidden})},
                {name: 'step', getContext: async req => `Step ${req.stepIndex}.`}
            ]
        });

        await model.sendAsync('Hide the id column');

        const [first, second] = transport.requests;
        expect(first.context).toEqual([
            {name: 'grid', description: 'The grid.', value: {hidden: []}},
            {name: 'step', description: null, value: 'Step 0.'}
        ]);
        expect(second.context).toEqual([
            {name: 'grid', description: 'The grid.', value: {hidden: ['id']}},
            {name: 'step', description: null, value: 'Step 1.'}
        ]);
    });

    it('leaves out a provider that returns null for a step', async () => {
        const {model, transport} = createModel({
            responses: [textEvents('Hi.')],
            contextProviders: [{name: 'empty', getContext: () => null}]
        });

        await model.sendAsync('Hi');

        expect(transport.requests[0].context).toEqual([]);
    });

    it('fails the turn, with Retry, when a provider throws', async () => {
        vi.spyOn(XH, 'handleException').mockImplementation(() => {});
        const {model, transport} = createModel({
            responses: [textEvents('Hi.')],
            contextProviders: [
                {
                    name: 'broken',
                    getContext: () => {
                        throw new Error('No grid.');
                    }
                }
            ]
        });

        await model.sendAsync('Hi');

        expect(model.status).toBe('error');
        expect(model.lastError.message).toBe('No grid.');
        expect(transport.requests).toEqual([]);
    });

    it('stops at once while a provider is still working, and sends nothing', async () => {
        const {model, transport} = createModel({
                responses: [textEvents('Hi.')],
                contextProviders: [{name: 'slow', getContext: () => new Promise(() => {})}]
            }),
            sent = model.sendAsync('Hi');

        await vi.waitFor(() => expect(model.status).toBe('submitted'));
        model.stop();
        await sent;

        expect(model.lastMessage.status).toBe('aborted');
        expect(transport.requests).toEqual([]);
    });
});

//------------------
// Helpers
//------------------
function createModel({
    responses,
    ...config
}: Partial<ChatModelConfig> & {responses: ChatEvent[][]}): {
    model: ChatModel;
    transport: ScriptedChatTransport;
} {
    const transport = new ScriptedChatTransport({responses, delayMs: 0}),
        model = new ChatModel({transport, ...config});
    onTestFinished(() => model.destroy());
    return {model, transport};
}
