import {GridModel} from '@xh/hoist/cmp/grid';
import {initTestAppAsync} from '@xh/hoist/test-support';
import {map} from 'lodash';
import {beforeAll, describe, expect, it, onTestFinished, vi} from 'vitest';
import type {ChatToolSpec} from '../core';
import {
    type ChatEvent,
    ScriptedChatTransport,
    scriptedDelay,
    textEvents,
    toolCallEvents
} from '../transport';
import {type ChatAssistantConfig, ChatAssistantModel} from './ChatAssistantModel';
import type {ChatToolGroup} from './ChatToolGroup';
import {gridTools} from './gridTools';

/**
 * A helper owns one short-lived conversation about one component. It must build its chat from
 * the component's tool groups, decide between dock and popover by the component's own width,
 * badge its button while closed, bridge to the app's main chat only through the app's seam, and
 * keep Undo honest once the component changes by other means.
 */
describe('ChatAssistantModel', () => {
    beforeAll(() => initTestAppAsync());

    describe('the chat', () => {
        it("builds one chat from the groups' tools, context, prompts and the app's own", () => {
            const gridModel = createGrid(),
                group = gridTools(gridModel, {title: 'Positions grid'}),
                appTool: ChatToolSpec = {name: 'lookup_trade', execute: () => 'ok'},
                transport = vi.fn(() => new ScriptedChatTransport()),
                model = createModel({
                    groups: group,
                    tools: [appTool],
                    prompt: 'Positions are in USD.',
                    transport
                });

            expect(model.title).toBe('Positions grid');
            expect(model.kind).toBe('grid');
            expect(map(model.chatModel.tools, 'name')).toEqual([
                ...map(group.tools, 'name'),
                'lookup_trade'
            ]);
            expect(model.chatModel.contextProviders).toEqual([group.contextProvider]);
            expect(transport).toHaveBeenCalledWith(model.systemPrompt);
            expect(model.systemPrompt).toContain('the helper for one component of the app');
            expect(model.systemPrompt).toContain(group.prompt);
            expect(model.systemPrompt.endsWith('Positions are in USD.')).toBe(true);
        });

        it('keeps the live schemas of the wrapped tools', () => {
            const gridModel = createGrid(),
                model = createModel({groups: gridTools(gridModel)}),
                groupTool = model.chatModel.getToolSpec('group_grid');

            gridModel.setColumns([{field: 'name'}, {field: 'desk'}]);
            expect(groupTool.parameters.properties.columns.items.enum).toEqual(['name', 'desk']);
        });

        it("shows a group tool's calls as change lines only where the tool kept the card default", () => {
            const changeLine = () => null,
                group: ChatToolGroup = {
                    ...gridTools(createGrid()),
                    tools: [
                        {name: 'plain', execute: () => 'ok'},
                        {name: 'quiet', display: 'hidden', execute: () => 'ok'},
                        {name: 'logged', display: 'timeline', execute: () => 'ok'}
                    ]
                },
                model = createModel({groups: group});
            model.renderers.changeLine = changeLine;
            const {chatModel} = model;

            expect(chatModel.getToolSpec('plain').display).toBe('inline');
            expect(chatModel.getToolSpec('plain').renderer).toBe(changeLine);
            expect(chatModel.getToolSpec('quiet').display).toBe('hidden');
            expect(chatModel.getToolSpec('logged').display).toBe('timeline');
            expect(chatModel.getToolSpec('logged').renderer).toBeUndefined();
        });

        it('is disabled, with no chat, when no backend is configured', () => {
            const model = new ChatAssistantModel({groups: gridTools(createGrid())});
            onTestFinished(() => model.destroy());

            expect(model.isEnabled).toBe(false);
            expect(model.chatModel).toBeNull();
            expect(model.badge).toBeNull();
        });

        it('cites only the docs pages it was given, and never invents a link', () => {
            const docs = [{title: 'Grid > Column autosizing', url: 'https://example.com/autosize'}],
                withDocs = createModel({groups: gridTools(createGrid(), {docs})}),
                without = createModel({groups: gridTools(createGrid())});

            expect(withDocs.docs).toEqual(docs);
            expect(withDocs.systemPrompt).toContain(
                '- [Grid > Column autosizing](https://example.com/autosize)'
            );
            expect(without.systemPrompt).toContain('You have no documentation pages.');
        });
    });

    describe('conversation lifetime (A2)', () => {
        it('keeps the conversation across close and reopen, in memory only', async () => {
            const model = createModel({}, [textEvents('Hi.')]),
                setItem = vi.spyOn(Storage.prototype, 'setItem');

            model.open();
            await model.chatModel.sendAsync('Hello');
            model.close();
            model.open();

            expect(map(model.chatModel.messages, 'text')).toEqual(['Hello', 'Hi.']);
            expect(setItem.mock.calls.filter(([key]) => key.includes('Assistant'))).toEqual([]);
        });

        it('starts over without touching the component', async () => {
            const gridModel = createGrid(),
                model = createModel({groups: gridTools(gridModel)}, [
                    toolCallEvents('group_grid', {columns: ['region']}),
                    textEvents('Grouped.')
                ]);
            await model.chatModel.sendAsync('Group by region');

            model.startOver();

            expect(model.chatModel.isEmpty).toBe(true);
            expect(gridModel.groupBy).toEqual(['region']);
        });

        it('drops the conversation with the model', () => {
            const model = createModel(),
                {chatModel} = model;

            model.destroy();
            expect(chatModel.isDestroyed).toBe(true);
        });
    });

    describe('container mode', () => {
        it('docks at 740 px or wider, else opens as a popover', () => {
            const model = createModel();
            expect(model.mode).toBe('dock');

            model.setComponentWidth(739);
            expect(model.mode).toBe('popover');

            model.setComponentWidth(740);
            expect(model.mode).toBe('dock');
        });

        it('allows one open popover helper per page, keeping the conversation of the other', () => {
            const first = createModel(),
                second = createModel(),
                docked = createModel();
            [first, second].forEach(it => it.setComponentWidth(480));

            first.open();
            docked.open();
            second.open();

            expect(first.isOpen).toBe(false);
            expect(second.isPopoverOpen).toBe(true);
            expect(docked.isDockOpen).toBe(true);
            expect(first.chatModel.isDestroyed).toBe(false);
        });
    });

    describe('badge', () => {
        it('shows nothing while the helper is open', async () => {
            const model = createModel({}, [textEvents('Done.')]);
            model.open();
            await model.chatModel.sendAsync('Hello');
            expect(model.badge).toBeNull();
        });

        it('shows busy while a turn runs closed, then reply ready until opened', async () => {
            const model = createModel({}, [[scriptedDelay(50), textEvents('Done.')]]),
                sent = model.chatModel.sendAsync('Hello');

            await vi.waitFor(() => expect(model.badge).toBe('busy'));
            await sent;
            expect(model.badge).toBe('ready');

            model.open();
            expect(model.badge).toBeNull();
            model.close();
            expect(model.badge).toBeNull();
        });

        it('asks for attention while a turn waits for the user, closed', async () => {
            const tool: ChatToolSpec = {
                    name: 'remove_rows',
                    needsApproval: true,
                    execute: () => 'Removed.'
                },
                model = createModel({tools: [tool]}, [toolCallEvents('remove_rows', {})]);

            await model.chatModel.sendAsync('Remove the rows');

            expect(model.chatModel.isAwaitingUser).toBe(true);
            expect(model.badge).toBe('attention');
        });

        it('shows a failure from a turn that ended while closed', async () => {
            const model = createModel({}, [
                [{type: 'RUN_ERROR', message: 'Upstream failed'} as ChatEvent]
            ]);
            await model.chatModel.sendAsync('Hello');
            expect(model.badge).toBe('error');
        });
    });

    describe('Ask in chat', () => {
        it('offers the bridge only when the app wires it, and asks through it', () => {
            const onAskInChat = vi.fn(),
                bridged = createModel({onAskInChat}),
                plain = createModel();

            expect(bridged.chatModel.getToolSpec('ask_in_chat')).toBeTruthy();
            expect(bridged.systemPrompt).toContain('call ask_in_chat');
            expect(plain.chatModel.getToolSpec('ask_in_chat')).toBeNull();
            expect(plain.canAskInChat).toBe(false);

            bridged.askInChat('What is our VaR limit?');
            expect(onAskInChat).toHaveBeenCalledWith('What is our VaR limit?');
        });
    });

    describe('changes', () => {
        it('flashes what each call changed, and shows it again on demand', async () => {
            const gridModel = createGrid(),
                group = {...gridTools(gridModel), highlight: vi.fn()} as ChatToolGroup,
                model = createModel({groups: group}, [
                    toolCallEvents('group_grid', {columns: ['region']}, {toolCallId: 'call1'}),
                    textEvents('Grouped.')
                ]);

            await model.chatModel.sendAsync('Group by region');

            expect(group.highlight).toHaveBeenCalledWith([{type: 'groups'}]);
            expect(model.getChangeTargets('call1')).toEqual([{type: 'groups'}]);

            model.showChange('call1');
            expect(group.highlight).toHaveBeenLastCalledWith([{type: 'groups'}], {scroll: true});
        });

        it('retires Undo once the component changes by hand, and says why', async () => {
            const gridModel = createGrid(),
                model = createModel({groups: gridTools(gridModel, {title: 'Positions grid'})}, [
                    toolCallEvents('group_grid', {columns: ['region']}),
                    textEvents('Grouped.')
                ]);
            await model.chatModel.sendAsync('Group by region');
            const replyId = model.chatModel.lastMessage.id;

            expect(model.chatModel.canUndoTurn(replyId)).toBe(true);
            expect(model.getUndoRetiredReason(replyId)).toBeNull();

            gridModel.setSortBy('region');

            expect(model.getUndoRetiredReason(replyId)).toBe(
                "Positions grid has changed since, so these changes can't be undone."
            );
        });

        it('keeps Undo when only column widths change, as autosize does', async () => {
            const gridModel = createGrid(),
                model = createModel({groups: gridTools(gridModel)}, [
                    toolCallEvents('group_grid', {columns: ['region']}),
                    textEvents('Grouped.')
                ]);
            await model.chatModel.sendAsync('Group by region');
            const replyId = model.chatModel.lastMessage.id;

            gridModel.updateColumnState([{colId: 'name', width: 321}]);

            expect(model.getUndoRetiredReason(replyId)).toBeNull();
        });

        it('keeps Undo while the component is as the reply left it', async () => {
            const gridModel = createGrid(),
                model = createModel({groups: gridTools(gridModel)}, [
                    toolCallEvents('group_grid', {columns: ['region']}),
                    textEvents('Grouped.')
                ]);
            await model.chatModel.sendAsync('Group by region');
            const replyId = model.chatModel.lastMessage.id;

            await model.chatModel.undoTurnAsync(replyId);

            expect(gridModel.groupBy).toEqual([]);
            expect(model.chatModel.lastMessage.metadata.undone).toBe(true);
        });
    });
});

//------------------
// Helpers
//------------------
function createGrid(): GridModel {
    const ret = new GridModel({
        columns: [{field: 'name'}, {field: 'region'}, {field: {name: 'price', type: 'number'}}]
    });
    ret.loadData([
        {id: 1, name: 'Boston', region: 'AMER', price: 40},
        {id: 2, name: 'Tokyo', region: 'APAC', price: 120}
    ]);
    onTestFinished(() => ret.destroy());
    return ret;
}

/** A helper over a new grid by default, with a scripted transport of the given responses. */
function createModel(
    config: Partial<ChatAssistantConfig> = {},
    responses: Array<ChatEvent[] | Array<ChatEvent[] | ReturnType<typeof scriptedDelay>>> = []
): ChatAssistantModel {
    const ret = new ChatAssistantModel({
        groups: gridTools(createGrid()),
        transport: new ScriptedChatTransport({responses: responses as any, delayMs: 0}),
        ...config
    });
    onTestFinished(() => ret.destroy());
    return ret;
}
