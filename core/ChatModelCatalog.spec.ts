import {initTestAppAsync} from '@xh/hoist/test-support';
import {beforeAll, describe, expect, it, onTestFinished, vi} from 'vitest';
import {type ChatArtifact, ChatUiCatalog, type ChatUiComponentSpec} from '../genui';
import {type ChatEvent, ScriptedChatTransport, textEvents, toolCallEvents} from '../transport';
import {ChatModel, type ChatModelConfig} from './ChatModel';
import {chatToolResult} from './ChatToolResult';

/**
 * A chat that takes a generative UI catalog adds the catalog's tools for its history mode, keeps
 * the artifacts its components show by reference, and records the catalog version on replies
 * that show its UI. Apps rely on each, so that one config wires a catalog into a chat in either
 * mode, and stored replies keep rendering after the catalog changes.
 */
describe('ChatModel catalog', () => {
    beforeAll(async () => {
        await initTestAppAsync();
    });

    describe('tools', () => {
        it('adds the component tools in client mode, and sends them to the model', async () => {
            const catalog = createCatalog(),
                {model, transport} = createModel({
                    catalog,
                    tools: [{name: 'search', execute: () => 'Found.'}],
                    responses: [textEvents('Hi.')]
                });

            await model.sendAsync('Hi');

            expect(model.tools.map(it => it.name)).toEqual(['search', 'show_note']);
            expect(transport.requests[0].tools.map(it => it.name)).toEqual(['search', 'show_note']);
        });

        it('adds the document tool for a catalog with the document mode', () => {
            const {model} = createModel({catalog: createCatalog({modes: ['tools', 'document']})});
            expect(model.tools.map(it => it.name)).toEqual(['show_note', 'show_ui']);
        });

        it('adds no tools for a catalog with only the tags mode', () => {
            const {model} = createModel({catalog: createCatalog({modes: ['tags']})});
            expect(model.tools).toEqual([]);
        });

        it('adds display tools in server mode, and never sends them to the model', async () => {
            const catalog = createCatalog(),
                {model, transport} = createModel({
                    catalog,
                    historyMode: 'server',
                    responses: [textEvents('Hi.')]
                });

            await model.sendAsync('Hi');

            expect(model.tools).toEqual(catalog.displayTools);
            expect(model.getToolSpec('show_note').execute).toBeUndefined();
            expect(transport.requests[0].tools).toEqual([]);
        });

        it('adds a catalog tool the app also listed only once', () => {
            const catalog = createCatalog(),
                {model} = createModel({catalog, tools: [...catalog.tools]});
            expect(model.tools.map(it => it.name)).toEqual(['show_note']);
        });

        it('throws for an app tool with the name of a catalog tool', () => {
            expect(
                () =>
                    new ChatModel({
                        transport: new ScriptedChatTransport(),
                        catalog: createCatalog(),
                        tools: [{name: 'show_note', execute: () => null}]
                    })
            ).toThrow(/show_note have the names of catalog tools/);
        });
    });

    it('sends the catalog version with each request, or null without a catalog', async () => {
        const catalog = createCatalog(),
            withCatalog = createModel({catalog, responses: [textEvents('Hi.')]}),
            without = createModel({responses: [textEvents('Hi.')]});

        await withCatalog.model.sendAsync('Hi');
        await without.model.sendAsync('Hi');

        expect(withCatalog.transport.requests[0].catalogVersion).toBe(catalog.version);
        expect(without.transport.requests[0].catalogVersion).toBeNull();
    });

    describe('artifacts', () => {
        it('records artifacts from xh.chat.artifact events and backend tool results', async () => {
            const {model} = createModel({
                responses: [
                    [
                        ...toolCallEvents('query', {}, {toolCallId: 'q1'}),
                        {
                            type: 'TOOL_CALL_RESULT',
                            messageId: 'r1',
                            toolCallId: 'q1',
                            content: 'Saved as sales.',
                            metadata: {artifacts: [artifact('sales', 3)]}
                        },
                        {type: 'CUSTOM', name: 'xh.chat.artifact', value: artifact('costs', 2)},
                        ...textEvents('Done.')
                    ]
                ]
            });

            await model.sendAsync('Query');

            expect(model.artifacts.get('sales').totalRows).toBe(3);
            expect(model.artifacts.get('costs').totalRows).toBe(2);
            expect(model.lastMessage.metadata.artifacts.map(it => it.id)).toEqual([
                'sales',
                'costs'
            ]);
        });

        it('ignores an artifact event without an id, columns or row count', async () => {
            const warn = silenceWarnings(),
                {model} = createModel({
                    responses: [
                        [
                            {type: 'CUSTOM', name: 'xh.chat.artifact', value: {id: 'x'}},
                            ...textEvents('Done.')
                        ]
                    ]
                });

            await model.sendAsync('Query');

            expect(model.artifacts.get('x')).toBeNull();
            expect(model.lastMessage.metadata.artifacts).toBeUndefined();
            expect(warn).toHaveBeenCalled();
        });

        it('records the artifacts a client tool returns, replacing one with the same id', async () => {
            const {model} = createModel({
                tools: [
                    {
                        name: 'query',
                        execute: ({total}) =>
                            chatToolResult('Saved as sales.', {
                                artifacts: [artifact('sales', total)]
                            })
                    }
                ],
                responses: [
                    toolCallEvents('query', {total: 3}),
                    toolCallEvents('query', {total: 5}),
                    textEvents('Done.')
                ]
            });

            await model.sendAsync('Query');

            expect(model.artifacts.get('sales').totalRows).toBe(5);
            expect(model.lastMessage.metadata.artifacts).toEqual([artifact('sales', 5)]);
        });

        it('restores artifacts from history, and drops them with the thread', () => {
            const {model} = createModel({
                initialMessages: [
                    {role: 'user', parts: [{type: 'text', id: 't1', text: 'Query', state: 'done'}]},
                    {role: 'assistant', parts: [], metadata: {artifacts: [artifact('sales', 3)]}}
                ]
            });
            expect(model.artifacts.get('sales')).not.toBeNull();

            model.loadMessages([
                {role: 'assistant', parts: [], metadata: {artifacts: [artifact('costs', 2)]}}
            ]);
            expect(model.artifacts.get('sales')).toBeNull();
            expect(model.artifacts.get('costs')).not.toBeNull();

            model.clear();
            expect(model.artifacts.get('costs')).toBeNull();
        });

        it('loads rows through the configured data source', async () => {
            const loadAsync = vi.fn(async ({offset, limit}) => ({
                    columns: [],
                    rows: Array.from({length: limit}, (_, idx) => ({n: offset + idx})),
                    totalRows: 50
                })),
                {model} = createModel({
                    dataSource: {loadAsync},
                    initialMessages: [
                        {role: 'assistant', parts: [], metadata: {artifacts: [artifact('big', 50)]}}
                    ]
                });

            const frame = await model.artifacts.loadRangeAsync('big', 10, 2);

            expect(frame.rows.map(it => it.n)).toEqual([10, 11]);
            expect(loadAsync).toHaveBeenCalledExactlyOnceWith(
                expect.objectContaining({artifactId: 'big', offset: 10, limit: 2})
            );
        });
    });

    describe('catalog version on replies', () => {
        it('records the version on a reply that calls a catalog tool', async () => {
            const catalog = createCatalog(),
                {model} = createModel({
                    catalog,
                    responses: [toolCallEvents('show_note', {text: 'Hi'}), textEvents('Done.')]
                });

            await model.sendAsync('Show');

            expect(model.lastMessage.metadata.catalogVersion).toBe(catalog.version);
        });

        it('records the version on a reply whose text holds a component tag', async () => {
            const catalog = createCatalog({modes: ['tags']}),
                {model} = createModel({
                    catalog,
                    responses: [textEvents(`See ${catalog.formatTag('note', {text: 'Hi'})}.`)]
                });

            await model.sendAsync('Show');

            expect(model.lastMessage.metadata.catalogVersion).toBe(catalog.version);
        });

        it('completes a reply whose tag names a member every object inherits', async () => {
            const {model} = createModel({
                catalog: createCatalog({modes: ['tags']}),
                responses: [textEvents('Odd: <ui-constructor/>.')]
            });

            await model.sendAsync('Hi');

            expect(model.lastMessage.status).toBe('complete');
        });

        it('records no version on a reply that shows no catalog UI', async () => {
            const {model} = createModel({
                catalog: createCatalog(),
                responses: [textEvents('Just text, and <b>markup</b>.')]
            });

            await model.sendAsync('Hi');

            expect(model.lastMessage.metadata.catalogVersion).toBeUndefined();
        });
    });
});

//------------------
// Helpers
//------------------
const NOTE: ChatUiComponentSpec<{text: string}> = {
    name: 'note',
    description: 'A short note.',
    props: {type: 'object', required: ['text'], properties: {text: {type: 'string'}}},
    render: ({text}) => text
};

function createCatalog(config: Partial<ConstructorParameters<typeof ChatUiCatalog>[0]> = {}) {
    return new ChatUiCatalog({components: [NOTE], ...config});
}

function createModel({
    responses = [],
    ...config
}: Partial<ChatModelConfig> & {responses?: ChatEvent[][]}): {
    model: ChatModel;
    transport: ScriptedChatTransport;
} {
    const transport = new ScriptedChatTransport({responses, delayMs: 0}),
        model = new ChatModel({transport, ...config});
    onTestFinished(() => model.destroy());
    return {model, transport};
}

function artifact(id: string, totalRows: number): ChatArtifact {
    return {id, columns: [{name: 'n', type: 'number'}], totalRows};
}

function silenceWarnings() {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    onTestFinished(() => warn.mockRestore());
    return warn;
}
