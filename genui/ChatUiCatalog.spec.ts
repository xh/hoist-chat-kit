import {fragment} from '@xh/hoist/cmp/layout';
import type {PlainObject} from '@xh/hoist/core';
import {initTestAppAsync} from '@xh/hoist/test-support';
import {sortBy} from 'lodash';
import type {ReactNode} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {beforeAll, describe, expect, it, onTestFinished, vi} from 'vitest';
import {
    ChatModel,
    type ChatDataPart,
    type ChatPartRenderContext,
    type ChatToolCallPart,
    type ChatToolCallState,
    type ChatToolSpec
} from '../core';
import {ScriptedChatTransport, textEvents, toolCallEvents} from '../transport';
import type {ChatUiAdapter} from './ChatUiAdapter';
import {ChatUiCatalog} from './ChatUiCatalog';
import type {ChatUiComponentSpec} from './ChatUiComponentSpec';

/**
 * ChatUiCatalog turns app components into tools the model calls to show UI. Apps rely on it to
 * send the model an exact schema per component, reject invalid props with errors the model can act
 * on, render components as their props stream, and draw protocol payloads with the same components.
 */
describe('ChatUiCatalog', () => {
    beforeAll(async () => {
        await initTestAppAsync();
    });

    describe('tools', () => {
        it('declares one inline client tool per component, with its props as the schema', () => {
            const catalog = createCatalog(),
                [metrics, note] = catalog.tools;

            expect(catalog.tools.map(it => it.name)).toEqual(['show_metrics', 'add_note']);
            expect(metrics).toMatchObject({
                parameters: METRICS.props,
                display: 'inline',
                displayName: 'Metrics'
            });
            expect(metrics.execute).toBeTypeOf('function');
            expect(metrics.description).toContain('A row of KPI tiles.');
            expect(metrics.description).toContain('shows the component to the user');
            expect(note.parameters).toBe(NOTE.props);
        });

        it('requires unique component and tool names', () => {
            expect(() => new ChatUiCatalog({components: [METRICS, METRICS]})).toThrow('unique');
            expect(
                () =>
                    new ChatUiCatalog({
                        components: [METRICS, {...NOTE, toolName: 'show_metrics'}]
                    })
            ).toThrow('unique');
            expect(() => new ChatUiCatalog({components: []})).toThrow('at least one');
        });
    });

    describe('execute', () => {
        it('confirms valid props to the model', async () => {
            const tool = createCatalog().tools[0];
            expect(await execute(tool, {items: [{label: 'Revenue', value: 12}]})).toBe(
                'Rendered metrics for the user.'
            );
        });

        it('throws an error that lists each problem, so the model can correct itself', async () => {
            const tool = createCatalog().tools[0];

            await expect(
                execute(tool, {items: [{label: 'Revenue', value: 'high'}]})
            ).rejects.toThrow('items[0].value: expected number, got string');
            await expect(execute(tool, {})).rejects.toThrow('nothing was shown');
        });

        it('applies the component validate function after the schema', async () => {
            const tool = createCatalog().tools[0],
                items = [
                    {label: 'A', value: 1},
                    {label: 'A', value: 2}
                ];
            await expect(execute(tool, {items})).rejects.toThrow('labels must be unique');
        });
    });

    describe('validate', () => {
        it('checks the schema, then the validate function, of the named component', () => {
            const catalog = createCatalog();

            expect(catalog.validate('metrics', {items: [{label: 'A', value: 1}]})).toEqual([]);
            expect(catalog.validate('metrics', {items: []})).toEqual([
                'items: expected at least 1 item, got 0'
            ]);
            expect(catalog.validate('chart', {})).toEqual(["Unknown component 'chart'."]);
        });

        it('skips checks that streaming props could still pass', () => {
            const catalog = createCatalog(),
                partial = {items: [{label: 'A', value: 1}, {label: 'A'}]};

            expect(catalog.validate('metrics', partial, {isPartial: true})).toEqual([]);
            expect(catalog.validate('metrics', partial)).not.toEqual([]);
        });
    });

    describe('instructions', () => {
        it('describes when to show UI, the rules, and each component with its example', () => {
            const {instructions} = createCatalog({
                instructions: 'Use metrics for portfolio summaries.'
            });

            expect(instructions).toContain('Show one component per call.');
            expect(instructions).toContain('in the order the schema lists them');
            expect(instructions).toContain('within the limits of the schema');
            expect(instructions).toContain('Prefer a component for tabular and numeric results');
            expect(instructions).toContain('Use text for explanation');
            expect(instructions).toContain('### show_metrics\nA row of KPI tiles.');
            expect(instructions).toContain(
                'Example props: {"items":[{"label":"Revenue","value":1250000}]}'
            );
            expect(instructions).toContain('### add_note\nA short note.');
            expect(instructions.endsWith('Use metrics for portfolio summaries.')).toBe(true);
        });
    });

    describe('renderer', () => {
        it.each<[ChatToolCallState, boolean]>([
            ['input-streaming', true],
            ['input-available', false],
            ['running', false],
            ['output-available', false]
        ])('renders a %s call with isPartial %s', (state, isPartial) => {
            const render = vi.fn(() => 'tiles'),
                tool = createCatalog({components: [{...METRICS, render}]}).tools[0],
                context = renderContext(),
                part = callPart(state, {items: [{label: 'A', value: 1}]});

            expect(markup(tool.renderer(part, context))).toBe('tiles');
            expect(render).toHaveBeenCalledWith(part.input, {
                ...context,
                part,
                isPartial,
                children: []
            });
        });

        it('renders streaming props that are incomplete but could still become valid', () => {
            const render = vi.fn((props: PlainObject) => `${props.items?.length ?? 0} tiles`),
                tool = createCatalog({components: [{...METRICS, render}]}).tools[0];

            expect(
                markup(
                    tool.renderer(
                        callPart('input-streaming', {items: [{label: 'Reve'}]}),
                        renderContext()
                    )
                )
            ).toBe('1 tiles');
            expect(markup(tool.renderer(callPart('input-streaming', null), renderContext()))).toBe(
                '0 tiles'
            );
            expect(render.mock.calls.map(it => it[0])).toEqual([{items: [{label: 'Reve'}]}, {}]);
        });

        it('renders nothing for props that are invalid', () => {
            const render = vi.fn(() => 'tiles'),
                tool = createCatalog({components: [{...METRICS, render}]}).tools[0],
                badInput = {items: [{label: 'A', value: 'x'}]};

            expect(
                tool.renderer(callPart('input-streaming', badInput), renderContext())
            ).toBeNull();
            expect(
                tool.renderer(callPart('output-error', {items: []}), renderContext())
            ).toBeNull();
            expect(render).not.toHaveBeenCalled();
        });
    });

    describe('createDataRenderers', () => {
        const PANEL: ChatUiComponentSpec = {
                name: 'panel',
                description: 'A titled container.',
                props: {type: 'object', required: ['title'], properties: {title: {type: 'string'}}},
                render: ({title}, {children}) =>
                    fragment({items: [`[${title}: `, ...children, ']']})
            },
            ADAPTER: ChatUiAdapter = {
                dataType: 'test-ui',
                translate: payload =>
                    payload.panels.map(it => ({
                        component: 'panel',
                        props: {title: it.title},
                        children: it.notes.map(text => ({component: 'note', props: {text}}))
                    }))
            };

        it('renders translated nodes, with their children, through the catalog', () => {
            const catalog = createCatalog({components: [PANEL, NOTE]}),
                renderers = catalog.createDataRenderers([ADAPTER]),
                part = dataPart({
                    panels: [
                        {title: 'Q3', notes: ['up', 'flat']},
                        {title: 'Q4', notes: []}
                    ]
                }),
                context = renderContext();

            expect(Object.keys(renderers)).toEqual(['test-ui']);
            expect(markup(renderers['test-ui'](part, context))).toBe('[Q3: (up)(flat)][Q4: ]');
        });

        it('passes the data part and the chat to each component', () => {
            const render = vi.fn(() => 'note'),
                catalog = createCatalog({components: [PANEL, {...NOTE, render}]}),
                part = dataPart({panels: [{title: 'Q3', notes: ['up']}]}),
                context = renderContext();

            markup(catalog.createDataRenderers([ADAPTER])['test-ui'](part, context));

            expect(render).toHaveBeenCalledWith(
                {text: 'up'},
                {
                    ...context,
                    part,
                    isPartial: false,
                    children: []
                }
            );
        });

        it('leaves out nodes with unknown components or invalid props', () => {
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {}),
                catalog = createCatalog({components: [PANEL, NOTE]}),
                adapter: ChatUiAdapter = {
                    dataType: 'test-ui',
                    translate: () => [
                        {component: 'note', props: {text: 'kept'}},
                        {component: 'note', props: {text: 7}},
                        {component: 'chart', props: {}}
                    ]
                },
                context = renderContext();
            onTestFinished(() => warn.mockRestore());

            const result = catalog.createDataRenderers([adapter])['test-ui'](dataPart({}), context);

            expect(markup(result)).toBe('(kept)');
            expect(warn).toHaveBeenCalledTimes(2);
        });
    });

    describe('with a ChatModel', () => {
        it('renders a component as its props stream, then confirms the render to the model', async () => {
            const renders: Array<{itemCount: number; isPartial: boolean}> = [],
                catalog = createCatalog({
                    components: [
                        {
                            ...METRICS,
                            render: ({items}, {isPartial}) => {
                                renders.push({itemCount: items?.length ?? 0, isPartial});
                                return null;
                            }
                        }
                    ]
                }),
                items = [
                    {label: 'Revenue', value: 1250000},
                    {label: 'Margin', value: 0.31},
                    {label: 'Headcount', value: 42}
                ],
                transport = new ScriptedChatTransport({
                    responses: [
                        toolCallEvents('show_metrics', {items}, {toolCallId: 'c1', chunkSize: 16}),
                        textEvents('Revenue is up.')
                    ],
                    // Slower than the chat's stream batching, so each chunk renders on its own.
                    delayMs: 40
                }),
                chatModel = createModel(transport, catalog.tools);

            // Render the call on each change, as the chat's message list would.
            chatModel.addReaction({
                track: () => chatModel.lastMessage,
                run: message => {
                    const part = message?.toolCalls[0];
                    if (part) {
                        markup(
                            chatModel
                                .getToolSpec(part.toolName)
                                .renderer(part, {chatModel, messageId: message.id})
                        );
                    }
                }
            });

            await chatModel.sendAsync('How are we doing?');

            const call = chatModel.lastMessage.toolCalls[0],
                sentCall = transport.requests[1].messages.at(-1).toolCalls[0];
            expect(call).toMatchObject({
                state: 'output-available',
                input: {items},
                output: 'Rendered metrics for the user.'
            });
            expect(sentCall.output).toBe('Rendered metrics for the user.');
            expect(chatModel.lastMessage).toMatchObject({
                status: 'complete',
                text: 'Revenue is up.'
            });

            // Partial renders grow item by item, then the complete props render as final.
            const partialCounts = renders.filter(it => it.isPartial).map(it => it.itemCount);
            expect(partialCounts.length).toBeGreaterThan(1);
            expect(partialCounts).toEqual(sortBy(partialCounts));
            expect(renders.at(-1)).toEqual({itemCount: 3, isPartial: false});
        });

        it('returns invalid props to the model as an error result', async () => {
            const catalog = createCatalog(),
                transport = new ScriptedChatTransport({
                    responses: [
                        toolCallEvents('show_metrics', {items: [{label: 'Revenue'}]}),
                        textEvents('Sorry.')
                    ],
                    delayMs: 0
                }),
                chatModel = createModel(transport, catalog.tools);

            await chatModel.sendAsync('How are we doing?');

            expect(chatModel.lastMessage.toolCalls[0]).toMatchObject({
                state: 'output-error',
                errorText: expect.stringContaining('items[0].value: required')
            });
        });
    });
});

//------------------
// Helpers
//------------------
interface Metric {
    label: string;
    value: number;
}

const METRICS: ChatUiComponentSpec<{items: Metric[]}> = {
    name: 'metrics',
    description: 'A row of KPI tiles.',
    props: {
        type: 'object',
        required: ['items'],
        additionalProperties: false,
        properties: {
            items: {
                type: 'array',
                minItems: 1,
                maxItems: 6,
                items: {
                    type: 'object',
                    required: ['label', 'value'],
                    properties: {label: {type: 'string'}, value: {type: 'number'}}
                }
            }
        }
    },
    validate: ({items}) => {
        const labels = items.map(it => it.label);
        return new Set(labels).size === labels.length ? [] : ['items: labels must be unique'];
    },
    render: () => null,
    example: {items: [{label: 'Revenue', value: 1250000}]}
};

const NOTE: ChatUiComponentSpec<{text: string}> = {
    name: 'note',
    toolName: 'add_note',
    description: 'A short note.',
    props: {type: 'object', required: ['text'], properties: {text: {type: 'string'}}},
    render: ({text}) => `(${text})`
};

function createCatalog(
    config: {components?: ChatUiComponentSpec<any>[]; instructions?: string} = {}
): ChatUiCatalog {
    return new ChatUiCatalog({components: [METRICS, NOTE], ...config});
}

function createModel(transport: ScriptedChatTransport, tools: ChatToolSpec[]): ChatModel {
    const model = new ChatModel({transport, tools});
    onTestFinished(() => model.destroy());
    return model;
}

function execute(tool: ChatToolSpec, input: PlainObject): Promise<any> {
    return Promise.resolve().then(() =>
        tool.execute(input, {
            chatModel: null,
            toolCallId: 'c1',
            signal: new AbortController().signal
        })
    );
}

function renderContext(): ChatPartRenderContext {
    return {chatModel: createModel(new ScriptedChatTransport(), []), messageId: 'm1'};
}

function callPart(state: ChatToolCallState, input: PlainObject): ChatToolCallPart {
    return {
        type: 'toolCall',
        id: 'c1',
        toolName: 'show_metrics',
        state,
        inputText: JSON.stringify(input),
        input,
        output: null,
        errorText: null
    };
}

function dataPart(data: any): ChatDataPart {
    return {type: 'data', id: 'd1', dataType: 'test-ui', data};
}

function markup(content: ReactNode): string {
    return renderToStaticMarkup(fragment({items: content}));
}
