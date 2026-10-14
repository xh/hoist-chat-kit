import {XH} from '@xh/hoist/core';
import {initTestAppAsync} from '@xh/hoist/test-support';
import {beforeAll, describe, expect, it, onTestFinished, vi} from 'vitest';
import {type ChatEvent, ScriptedChatTransport, textEvents, toolCallEvents} from '../transport';
import {ChatModel, type ChatModelConfig} from './ChatModel';
import {chatToolResult} from './ChatToolResult';
import type {ChatToolSpec} from './ChatToolSpec';

/**
 * Undo is the safety net of a helper agent: every change its tools make to a component can be
 * reverted from the reply. Undo must run the changes back in reverse order, only for the latest
 * reply that made any - as later state builds on it - and never while a turn is under way.
 */
describe('ChatModel undo', () => {
    beforeAll(async () => {
        await initTestAppAsync();
    });

    it('records undo functions from tool results, and sends the plain result to the model', async () => {
        const state = createState(),
            {model, transport} = createModel(
                [setTool(state)],
                [
                    [
                        ...toolCallEvents('set', {value: 'a'}),
                        ...toolCallEvents('set', {value: 'b'})
                    ],
                    textEvents('Done.')
                ]
            );

        await model.sendAsync('Set a then b');

        const reply = model.lastMessage;
        expect(model.canUndoTurn(reply.id)).toBe(true);
        expect(model.undoableMessageId).toBe(reply.id);
        expect(reply.toolCalls.map(it => it.output)).toEqual(['Set a.', 'Set b.']);
        expect(transport.requests[1].messages.at(-1).toolCalls[0].output).toBe('Set a.');
    });

    it('runs the undo functions newest first, then marks the reply undone', async () => {
        const state = createState(),
            {model} = createModel(
                [setTool(state)],
                [
                    [
                        ...toolCallEvents('set', {value: 'a'}),
                        ...toolCallEvents('set', {value: 'b'})
                    ],
                    textEvents('Done.')
                ]
            );
        await model.sendAsync('Set a then b');
        const reply = model.lastMessage;
        expect(state.values).toEqual(['a', 'b']);

        await model.undoTurnAsync(reply.id);

        expect(state.undone).toEqual(['b', 'a']);
        expect(state.values).toEqual([]);
        expect(model.lastMessage.metadata.undone).toBe(true);
        expect(model.canUndoTurn(reply.id)).toBe(false);
    });

    it('offers only the latest reply with changes, then the one before it once undone', async () => {
        const state = createState(),
            {model} = createModel(
                [setTool(state)],
                [
                    toolCallEvents('set', {value: 'a'}),
                    textEvents('Set a.'),
                    toolCallEvents('set', {value: 'b'}),
                    textEvents('Set b.'),
                    textEvents('Nothing to change.')
                ]
            );
        await model.sendAsync('Set a');
        const first = model.lastMessage;
        await model.sendAsync('Set b');
        const second = model.lastMessage;
        await model.sendAsync('Just chat');

        expect(model.undoableMessageId).toBe(second.id);
        expect(model.canUndoTurn(first.id)).toBe(false);

        await model.undoTurnAsync(first.id);
        expect(state.values).toEqual(['a', 'b']);

        await model.undoTurnAsync(second.id);
        expect(model.undoableMessageId).toBe(first.id);
    });

    it('offers no undo while a turn waits for approval', async () => {
        const state = createState(),
            {model} = createModel(
                [setTool(state), {name: 'reset', execute: () => 'ok', needsApproval: true}],
                [toolCallEvents('set', {value: 'a'}), textEvents('Set.'), toolCallEvents('reset')]
            );
        await model.sendAsync('Set a');
        const reply = model.lastMessage;

        await model.sendAsync('Reset');
        expect(model.isAwaitingUser).toBe(true);
        expect(model.canUndoTurn(reply.id)).toBe(false);

        await model.denyToolCallAsync(model.pendingApprovals[0].id);
        expect(model.canUndoTurn(reply.id)).toBe(true);
    });

    it('stops at an undo that throws, reports it, and keeps the rest for another try', async () => {
        const handleException = vi.spyOn(XH, 'handleException').mockImplementation(() => {}),
            state = createState(),
            failing = vi.fn().mockRejectedValueOnce(new Error('Locked.')).mockResolvedValue(null),
            {model} = createModel(
                [
                    setTool(state),
                    {name: 'lock', execute: () => chatToolResult('Locked.', {undo: failing})}
                ],
                [
                    [...toolCallEvents('set', {value: 'a'}), ...toolCallEvents('lock')],
                    textEvents('Ok.')
                ]
            );
        await model.sendAsync('Set and lock');
        const reply = model.lastMessage;

        await model.undoTurnAsync(reply.id);

        expect(handleException).toHaveBeenCalledWith(
            expect.objectContaining({message: 'Locked.'}),
            expect.objectContaining({alertType: 'toast'})
        );
        expect(state.undone).toEqual([]);
        expect(model.lastMessage.metadata.undone).toBeUndefined();
        expect(model.canUndoTurn(reply.id)).toBe(true);

        await model.undoTurnAsync(reply.id);
        expect(state.undone).toEqual(['a']);
        expect(model.lastMessage.metadata.undone).toBe(true);
    });

    it('blocks sends while an undo runs', async () => {
        let finishUndo: () => void;
        const {model} = createModel(
            [
                {
                    name: 'slow',
                    execute: () =>
                        chatToolResult('Done.', {
                            undo: () => new Promise<void>(resolve => (finishUndo = resolve))
                        })
                }
            ],
            [toolCallEvents('slow'), textEvents('Ok.'), textEvents('Again.')]
        );
        await model.sendAsync('Change it');
        const reply = model.lastMessage,
            undone = model.undoTurnAsync(reply.id);

        expect(model.sendBlockedReason).toBe('Wait for the changes to be undone.');
        await model.sendAsync('Next');
        expect(model.lastMessage).toBe(reply);

        finishUndo();
        await undone;
        expect(model.sendBlockedReason).toBeNull();
    });

    it('drops the undo functions of replies that a regenerate or clear discards', async () => {
        const state = createState(),
            {model} = createModel(
                [setTool(state)],
                [toolCallEvents('set', {value: 'a'}), textEvents('Set.'), textEvents('Again.')]
            );
        await model.sendAsync('Set a');

        await model.regenerateAsync();
        expect(model.undoableMessageId).toBeNull();

        model.clear();
        expect(model.undoableMessageId).toBeNull();
    });

    it('tracks an undone turn when tracking is on', async () => {
        const track = vi.spyOn(XH, 'track').mockImplementation(() => {}),
            state = createState(),
            {model} = createModel(
                [setTool(state)],
                [toolCallEvents('set', {value: 'a'}), textEvents('Set.')],
                {track: true}
            );
        await model.sendAsync('Set a');
        const reply = model.lastMessage;

        await model.undoTurnAsync(reply.id);

        expect(track).toHaveBeenCalledWith(
            expect.objectContaining({
                category: 'Chat',
                message: 'Turn undone',
                data: expect.objectContaining({changes: 1, messageId: reply.id})
            })
        );
    });
});

//------------------
// Helpers
//------------------
interface TestState {
    values: string[];
    undone: string[];
}

function createState(): TestState {
    return {values: [], undone: []};
}

/** A tool that appends a value to the state, and undoes that by removing it again. */
function setTool(state: TestState): ChatToolSpec {
    return {
        name: 'set',
        execute: ({value}) => {
            state.values = [...state.values, value];
            return chatToolResult(`Set ${value}.`, {
                undo: () => {
                    state.values = state.values.filter(it => it !== value);
                    state.undone = [...state.undone, value];
                }
            });
        }
    };
}

function createModel(
    tools: ChatToolSpec[],
    responses: ChatEvent[][],
    config: Partial<ChatModelConfig> = {}
): {model: ChatModel; transport: ScriptedChatTransport} {
    const transport = new ScriptedChatTransport({responses, delayMs: 0}),
        model = new ChatModel({transport, tools, ...config});
    onTestFinished(() => model.destroy());
    return {model, transport};
}
