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
    type ChatModelConfig,
    type ChatPartRenderContext,
    type ChatToolCallPart,
    type ChatToolCallState,
    type ChatToolSpec
} from '../core';
import {ScriptedChatTransport, dataEvents, textEvents, toolCallEvents} from '../transport';
import type {ChatUiAdapter} from './ChatUiAdapter';
import {ChatUiCatalog, type ChatUiCatalogConfig} from './ChatUiCatalog';
import type {ChatUiComponentSpec, ChatUiDocumentContext} from './ChatUiComponentSpec';
import type {ChatUiDocument} from './ChatUiDocument';
import type {ChatUiTextFormat} from './ChatUiTextFormat';
import type {ChatUiDocumentSegment} from './ChatUiTextSegment';
import {chatUiTagFormat} from './formats/ChatUiTagFormat';
import {hashJson} from './impl/hash';

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

        it('offers a component that is not standalone only inside a document', () => {
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {}),
                catalog = createCatalog({
                    components: [METRICS, {...NOTE, standalone: false}],
                    modes: ['tools', 'tags', 'document']
                }),
                doc = {root: 'n', elements: {n: {component: 'note', props: {text: 'hi'}}}};
            onTestFinished(() => warn.mockRestore());

            expect(catalog.tools.map(it => it.name)).toEqual(['show_metrics']);
            expect(catalog.displayTools.map(it => it.name)).toEqual(['show_metrics', 'show_ui']);
            expect(catalog.toToolSchemas().map(it => it.name)).toEqual(['show_metrics', 'show_ui']);
            expect(catalog.instructions).not.toContain('add_note');
            expect(catalog.instructions).not.toContain('ui-note');
            expect(catalog.documentTool.description).toContain('- note: A short note.');

            const tag = '<ui-note text="hi"/>';
            expect(catalog.parseText(tag)).toEqual([
                {
                    type: 'fallback',
                    component: 'note',
                    name: 'note',
                    props: {text: 'hi'},
                    errors: ["'note' shows only inside a document"],
                    source: tag
                }
            ]);
            expect(
                markup(
                    catalog.documentTool.renderer(
                        {...callPart('output-available', doc), toolName: 'show_ui'},
                        renderContext()
                    )
                )
            ).toBe('(hi)');
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

    describe('schema check', () => {
        it.each([
            ['$ref', {$ref: '#/$defs/row'}],
            ['$defs', {$defs: {row: {type: 'string'}}}],
            ['allOf', {allOf: [{type: 'string'}]}],
            ['not', {not: {type: 'string'}}],
            ['if', {if: {type: 'string'}, then: {minLength: 1}}],
            ['exclusiveMinimum', {type: 'number', exclusiveMinimum: 0}],
            ['uniqueItems', {type: 'array', uniqueItems: true}],
            ['multipleOf', {type: 'number', multipleOf: 5}],
            ['prefixItems', {type: 'array', prefixItems: [{type: 'string'}]}],
            ['array-form items', {type: 'array', items: [{type: 'string'}]}],
            ['patternProperties', {type: 'object', patternProperties: {'^x': {}}}],
            ['dependentRequired', {type: 'object', dependentRequired: {a: ['b']}}]
        ])('refuses a schema that uses %s, which it cannot check', (keyword, schema) => {
            expect(() => catalogWithProp(schema)).toThrow(`${keyword} at properties.value`);
        });

        it('finds unsupported keywords in nested subschemas, and names each path', () => {
            const props = {
                type: 'object',
                properties: {
                    rows: {type: 'array', items: {type: 'object', minProperties: 1}},
                    mode: {anyOf: [{type: 'string'}, {type: 'number', exclusiveMaximum: 9}]}
                }
            };
            expect(() => new ChatUiCatalog({components: [{...NOTE, props}]})).toThrow(
                'minProperties at properties.rows.items; ' +
                    'exclusiveMaximum at properties.mode.anyOf[1]'
            );
        });

        it('allows annotations such as title, description, default and format', () => {
            expect(() =>
                catalogWithProp({
                    type: 'string',
                    title: 'Value',
                    description: 'A value.',
                    default: 'x',
                    format: 'date',
                    examples: ['y']
                })
            ).not.toThrow();
        });

        it('allows extension keywords that start with x-, and sends them to the model as is', () => {
            const value = {type: 'string', 'x-app-hint': {format: 'ticker'}},
                catalog = catalogWithProp(value);
            expect(catalog.tools[0].parameters).toEqual({
                type: 'object',
                properties: {value}
            });
        });

        it('refuses a pattern that does not compile as a Unicode regular expression', () => {
            expect(() => catalogWithProp({type: 'string', pattern: '^\\_+$'})).toThrow(
                "is not a valid regular expression with the 'u' flag"
            );
        });

        it('rejects inherited keys as unknown under additionalProperties false', () => {
            const props = {...NOTE.props, additionalProperties: false},
                catalog = new ChatUiCatalog({components: [{...NOTE, props}]});
            ['toString', 'constructor', '__proto__'].forEach(key =>
                expect(catalog.validate('note', JSON.parse(`{"text": "x", "${key}": 1}`))).toEqual([
                    `${key}: unknown property`
                ])
            );
        });
    });

    describe('props schema', () => {
        it('requires an object schema, which the checks of each prop rely on', () => {
            expect(
                () => new ChatUiCatalog({components: [{...NOTE, props: {properties: {}}}]})
            ).toThrow("must have a props schema of type 'object'");
        });

        it('lets a number still streaming match an enum it could still become', () => {
            const catalog = catalogWithProp({type: 'integer', enum: [10, 20]});
            expect(catalog.validate('note', {value: 1}, {isPartial: true})).toEqual([]);
            expect(catalog.validate('note', {value: 1})).toEqual(['value: expected one of 10, 20']);
        });
    });

    describe('execute', () => {
        it('confirms valid props to the model', async () => {
            const tool = createCatalog().tools[0];
            expect(await execute(tool, {items: [{label: 'Revenue', value: 12}]})).toBe(
                'Rendered metrics for the user.'
            );
        });

        it('tells the model what it showed, with the component result function', async () => {
            const tool = new ChatUiCatalog({
                components: [{...NOTE, result: ({text}) => `Showed a note: ${text}`}]
            }).tools[0];
            expect(await execute(tool, {text: 'Hi'})).toBe('Showed a note: Hi');
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
        it('describes when to show UI, the rules, and each component tool with its example', () => {
            const {instructions} = createCatalog({
                instructions: 'Use metrics for portfolio summaries.'
            });

            expect(instructions).toContain('Show one component per call.');
            expect(instructions).toContain('in the order the schema lists them');
            expect(instructions).toContain('within the limits of the schema');
            expect(instructions).toContain('Prefer a component for tabular and numeric results');
            expect(instructions).toContain('Use text for explanation');
            expect(instructions).toContain(
                '#### show_metrics\nExample props: {"items":[{"label":"Revenue","value":1250000}]}'
            );
            expect(instructions).toContain('#### add_note');
            expect(instructions.endsWith('Use metrics for portfolio summaries.')).toBe(true);
        });

        it('sends each component description once, in its tool', () => {
            const catalog = createCatalog();
            expect(catalog.instructions).not.toContain('A row of KPI tiles.');
            expect(catalog.tools[0].description).toContain('A row of KPI tiles.');
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
            expect(render).toHaveBeenCalledWith(
                part.input,
                expect.objectContaining({
                    ...context,
                    part,
                    isPartial,
                    element: {id: 'root', component: 'metrics', props: part.input},
                    children: [],
                    slots: {},
                    data: {}
                })
            );
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

    describe('renderer for a call with a result', () => {
        it('renders a fallback for invalid props, as a display tool call gets no error', () => {
            const tool = createCatalog().displayTools[0],
                html = markup(
                    tool.renderer(
                        callPart('output-available', {items: [{label: 'A', value: 'x'}]}),
                        renderContext()
                    )
                );
            expect(html).toContain('could not be displayed');
            expect(html).toContain('expected number, got string');
        });
    });

    describe('createDataRenderers', () => {
        const PANEL: ChatUiComponentSpec = {
                name: 'panel',
                description: 'A titled container.',
                props: {type: 'object', required: ['title'], properties: {title: {type: 'string'}}},
                slots: ['default'],
                render: ({title}, {children}) =>
                    fragment({items: [`[${title}: `, ...children, ']']})
            },
            ADAPTER: ChatUiAdapter = {
                dataType: 'test-ui',
                translate: payload => ({
                    root: 'top',
                    elements: {
                        top: {component: 'panel', props: {title: 'All'}, children: ['q3', 'q4']},
                        ...Object.fromEntries(
                            payload.panels.map(it => [
                                it.title.toLowerCase(),
                                {
                                    component: 'panel',
                                    props: {title: it.title},
                                    children: it.notes.map((_, idx) => `${it.title}-${idx}`)
                                }
                            ])
                        ),
                        ...Object.fromEntries(
                            payload.panels.flatMap(it =>
                                it.notes.map((text, idx) => [
                                    `${it.title}-${idx}`,
                                    {component: 'note', props: {text}}
                                ])
                            )
                        )
                    }
                })
            };

        it('renders translated documents, with their children, through the catalog', () => {
            const catalog = createCatalog({components: [PANEL, NOTE]}),
                renderers = catalog.createDataRenderers([ADAPTER]),
                part = dataPart({
                    panels: [
                        {title: 'Q3', notes: ['up', 'flat']},
                        {title: 'Q4', notes: []}
                    ]
                }),
                context = renderContext();

            expect(Object.keys(renderers)).toEqual(['xh.chat.ui', 'test-ui']);
            expect(markup(renderers['test-ui'](part, context))).toBe(
                '[All: [Q3: (up)(flat)][Q4: ]]'
            );
        });

        it('renders documents sent as xh.chat.ui data parts, with no adapter', () => {
            const catalog = createCatalog({components: [PANEL, NOTE]}),
                part: ChatDataPart = {
                    type: 'data',
                    id: 'd1',
                    dataType: 'xh.chat.ui',
                    data: {
                        root: 'p',
                        elements: {
                            p: {component: 'panel', props: {title: 'T'}, children: ['n']},
                            n: {component: 'note', props: {text: 'hi'}}
                        }
                    }
                };

            expect(markup(catalog.createDataRenderers()['xh.chat.ui'](part, renderContext()))).toBe(
                '[T: (hi)]'
            );
        });

        it('passes the data part, the chat and the element to each component', () => {
            const render = vi.fn(() => 'note'),
                catalog = createCatalog({components: [PANEL, {...NOTE, render}]}),
                part = dataPart({panels: [{title: 'Q3', notes: ['up']}]}),
                context = renderContext();

            markup(catalog.createDataRenderers([ADAPTER])['test-ui'](part, context));

            expect(render).toHaveBeenCalledWith(
                {text: 'up'},
                expect.objectContaining({
                    ...context,
                    part,
                    isPartial: false,
                    element: {id: 'Q3-0', component: 'note', props: {text: 'up'}},
                    children: []
                })
            );
        });

        it('renders a fallback for elements with unknown components or invalid props', () => {
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {}),
                catalog = createCatalog({components: [PANEL, NOTE]}),
                adapter: ChatUiAdapter = {
                    dataType: 'test-ui',
                    translate: () => ({
                        root: 'top',
                        elements: {
                            top: {
                                component: 'panel',
                                props: {title: 'T'},
                                children: ['a', 'b', 'c']
                            },
                            a: {component: 'note', props: {text: 'kept'}},
                            b: {component: 'note', props: {text: 7}},
                            c: {component: 'chart', props: {}}
                        }
                    })
                },
                context = renderContext();
            onTestFinished(() => warn.mockRestore());

            const html = markup(
                catalog.createDataRenderers([adapter])['test-ui'](dataPart({}), context)
            );

            expect(html).toContain('(kept)');
            expect(html).toContain('This note could not be displayed.');
            expect(html).toContain('elements.b.props.text: expected string, got number');
            expect(html).toContain('elements.c.component: unknown component &#x27;chart&#x27;');
            expect(warn).toHaveBeenCalledTimes(2);
        });

        it('logs each fallback once, however often it renders', () => {
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {}),
                catalog = createCatalog(),
                part = dataPart(null),
                context = renderContext(),
                doc = {root: 'x', elements: {x: {component: 'chart', props: {}}}};
            onTestFinished(() => warn.mockRestore());

            markup(catalog.renderDocument(doc, {...context, part, isPartial: false}));
            markup(catalog.renderDocument(doc, {...context, part, isPartial: false}));

            expect(warn).toHaveBeenCalledTimes(1);
        });

        it('passes the reply streaming state to an adapter, and renders its document as partial while it says so', async () => {
            const states: boolean[] = [],
                renders: boolean[] = [],
                adapter: ChatUiAdapter = {
                    dataType: 'test-ui',
                    translate: (payload, {catalog, isPartial}) => {
                        states.push(isPartial);
                        expect(catalog).toBeInstanceOf(ChatUiCatalog);
                        return {
                            root: 'n',
                            elements: {n: {component: 'note', props: {text: payload.text}}},
                            isPartial
                        };
                    }
                },
                catalog = createCatalog({
                    components: [
                        {
                            ...NOTE,
                            render: (_, {isPartial}) => {
                                renders.push(isPartial);
                                return null;
                            }
                        }
                    ]
                }),
                chatModel = createStreamingModel(
                    [...dataEvents('test-ui', {text: 'hi'}), ...textEvents('Done.')],
                    catalog.createDataRenderers([adapter])
                );

            await chatModel.sendAsync('Go');

            expect(states[0]).toBe(true);
            expect(states.at(-1)).toBe(false);
            expect(renders[0]).toBe(true);
            expect(renders.at(-1)).toBe(false);
        });

        it('renders a placeholder while a streaming adapter throws, and a fallback once the reply ends', async () => {
            const error = vi.spyOn(console, 'error').mockImplementation(() => {}),
                adapter: ChatUiAdapter = {
                    dataType: 'test-ui',
                    translate: () => {
                        throw new Error('half a program');
                    }
                },
                catalog = createCatalog({placeholder: () => 'PLACEHOLDER'}),
                outputs: string[] = [],
                chatModel = createStreamingModel(
                    [...dataEvents('test-ui', {}), ...textEvents('Done.')],
                    catalog.createDataRenderers([adapter]),
                    html => outputs.push(html)
                );
            onTestFinished(() => error.mockRestore());

            await chatModel.sendAsync('Go');

            expect(outputs[0]).toBe('PLACEHOLDER');
            expect(outputs.at(-1)).toContain('could not be displayed');
            expect(outputs.at(-1)).toContain('half a program');
        });

        it('renders an xh.chat.ui data part complete while its reply streams unless the document says isPartial', async () => {
            const renders: boolean[] = [],
                catalog = createCatalog({
                    components: [
                        {
                            ...NOTE,
                            render: (_, {isPartial}) => {
                                renders.push(isPartial);
                                return null;
                            }
                        }
                    ]
                }),
                doc = {root: 'n', elements: {n: {component: 'note', props: {text: 'hi'}}}},
                complete = createStreamingModel(
                    [...dataEvents('xh.chat.ui', doc), ...textEvents('Some more text.')],
                    catalog.createDataRenderers()
                );

            await complete.sendAsync('Go');

            expect(renders.length).toBeGreaterThan(1);
            expect(renders.every(it => it === false)).toBe(true);

            renders.length = 0;
            const growing = createStreamingModel(
                [
                    ...dataEvents('xh.chat.ui', {...doc, isPartial: true}, {id: 'd1'}),
                    ...textEvents('Some more text.'),
                    ...dataEvents('xh.chat.ui', doc, {id: 'd1'})
                ],
                catalog.createDataRenderers()
            );

            await growing.sendAsync('Go');

            expect(renders[0]).toBe(true);
            expect(renders.at(-1)).toBe(false);
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

    describe('text formats', () => {
        it('defaults to the tag format, and lists it in textFormats', () => {
            const catalog = createCatalog(),
                text = 'Note:\n<ui-note text="hi"/>';

            expect(catalog.textFormats.map(it => it.name)).toEqual(['tags']);
            expect(catalog.parseText(text)).toEqual(catalog.parseTags(text));
        });

        it('refuses a mode that names no configured format, and accepts a format name as a mode', () => {
            expect(() => createCatalog({modes: ['brace']})).toThrow(
                'ChatUiCatalog modes must be one or more of tools, document, tags.'
            );
            expect(() => createCatalog({textFormats: [braceFormat()], modes: ['tags']})).toThrow(
                'one or more of tools, document, brace'
            );

            expect(() => createCatalog({textFormats: [braceFormat(), braceFormat()]})).toThrow(
                'text format names must be unique'
            );
            expect(() => createCatalog({textFormats: [{...braceFormat(), name: 'tools'}]})).toThrow(
                'text format names must be unique'
            );

            const catalog = createCatalog({textFormats: [braceFormat()], modes: ['brace']});
            expect(catalog.modes).toEqual(['brace']);
            expect(catalog.instructions).toContain('### Brace tokens');
            expect(catalog.instructions).not.toContain('### Component tags');
            expect(catalog.toPrompt({modes: ['tools']})).not.toContain('### Brace tokens');
        });

        it('parseText runs the configured formats in order over the markdown segments', () => {
            const brace = braceFormat(),
                parse = vi.spyOn(brace, 'parse'),
                catalog = createCatalog({textFormats: [chatUiTagFormat(), brace]}),
                segments = catalog.parseText('A <ui-note text="hi"/> B {{metrics}} C', {
                    messageId: 'm1',
                    partId: 'p1'
                });

            expect(segments).toEqual([
                {type: 'markdown', text: 'A '},
                {
                    type: 'component',
                    element: {component: 'note', props: {text: 'hi'}},
                    source: '<ui-note text="hi"/>'
                },
                {type: 'markdown', text: ' B '},
                {type: 'document', document: METRICS_DOC, isPartial: false, source: '{{metrics}}'},
                {type: 'markdown', text: ' C'}
            ]);
            expect(parse.mock.calls.map(it => it[0])).toEqual(['A ', ' B {{metrics}} C']);
            expect(parse.mock.calls[0][1]).toEqual({
                catalog,
                isStreaming: false,
                messageId: 'm1',
                partId: 'p1',
                index: 0
            });
        });

        it('passes each format the index of the markdown piece it parses', () => {
            const brace = braceFormat(),
                parse = vi.spyOn(brace, 'parse'),
                catalog = createCatalog({textFormats: [chatUiTagFormat(), brace]});

            catalog.parseText('A <ui-note text="hi"/> B', {messageId: 'm1', partId: 'p1'});

            expect(parse.mock.calls.map(([text, ctx]) => [text, ctx.index])).toEqual([
                ['A ', 0],
                [' B', 1]
            ]);
        });

        it('leaves text as markdown when a format throws, and warns once per message', () => {
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {}),
                broken: ChatUiTextFormat = {
                    name: 'broken',
                    parse: () => {
                        throw new Error('half-written');
                    },
                    toPrompt: () => ''
                },
                catalog = createCatalog({textFormats: [chatUiTagFormat(), broken]}),
                text = 'A <ui-note text="hi"/> B';
            onTestFinished(() => warn.mockRestore());

            const segments = catalog.parseText(text, {messageId: 'm1', isStreaming: true});
            catalog.parseText(text, {messageId: 'm1'});

            expect(segments.map(it => it.type)).toEqual(['markdown', 'component', 'markdown']);
            expect(segments[0]).toEqual({type: 'markdown', text: 'A '});
            expect(segments[2]).toEqual({type: 'markdown', text: ' B'});
            expect(warn).toHaveBeenCalledTimes(1);

            catalog.parseText(text, {messageId: 'm2'});
            expect(warn).toHaveBeenCalledTimes(2);
        });

        it('reuses a component segment by format and source, and never one with no source', () => {
            let emptyText = 'one';
            const catalog = createCatalog({
                    textFormats: [
                        tokenFormat('a', '{{a}}', '{{x}}', () => 'from a'),
                        tokenFormat('b', '{{b}}', '{{x}}', () => 'from b'),
                        tokenFormat('e', '{{e}}', '', () => emptyText)
                    ]
                }),
                elementTexts = (text: string) =>
                    catalog
                        .parseText(text)
                        .filter(it => it.type === 'component')
                        .map(it => it.element.props.text);

            expect(elementTexts('{{a}} {{b}}')).toEqual(['from a', 'from b']);
            expect(catalog.parseText('{{a}}')[0]).toBe(catalog.parseText('{{a}}')[0]);

            expect(elementTexts('{{e}}')).toEqual(['one']);
            emptyText = 'two';
            expect(elementTexts('{{e}}')).toEqual(['two']);
        });

        it('renders a document segment, partial with placeholders, then complete', () => {
            const catalog = createCatalog({components: [STACK, NOTE]}),
                elements = {
                    top: {component: 'stack', props: {}, children: ['a', 'b']},
                    a: {component: 'note', props: {text: 'a'}}
                },
                partial = markup(
                    catalog.renderSegment(
                        documentSegment({root: 'top', elements}, true),
                        textContext()
                    )
                ),
                complete = markup(
                    catalog.renderSegment(
                        documentSegment(
                            {
                                root: 'top',
                                elements: {...elements, b: {component: 'note', props: {text: 'b'}}}
                            },
                            false
                        ),
                        textContext()
                    )
                );

            expect(partial).toContain('[(a)');
            expect(partial).toContain('Building…');
            expect(complete).toBe('[(a)(b)]');
        });

        it('renders one fallback for a document segment whose structure is broken', () => {
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {}),
                catalog = createCatalog({components: [STACK, NOTE]}),
                html = markup(
                    catalog.renderSegment(
                        documentSegment(
                            {
                                root: 'top',
                                elements: {
                                    top: {component: 'stack', props: {}, children: ['a']},
                                    a: {component: 'stack', props: {}, children: ['top']}
                                }
                            },
                            false
                        ),
                        textContext()
                    )
                );
            onTestFinished(() => warn.mockRestore());

            expect(html.split('This content could not be displayed.')).toHaveLength(2);
            expect(html).not.toContain('Building');
            expect(warn).toHaveBeenCalledTimes(1);
        });

        it('holds a partial fence as markdown while streaming', () => {
            const text = 'Code:\n```\n<ui-note text="a"/>';
            expect(createCatalog().parseText(text, {isStreaming: true})).toEqual([
                {type: 'markdown', text}
            ]);
        });

        it('toCopyText returns text with no UI unchanged, and words for each element of a document', () => {
            const catalog = createCatalog({
                    components: [
                        {...STACK, result: () => ' '},
                        {...NOTE, result: ({text}) => `Noted ${text}.`},
                        METRICS
                    ]
                }),
                plain = 'Just **text**.\n\nMore.\n';

            expect(catalog.toCopyText(catalog.parseText(plain))).toBe(plain);
            expect(
                catalog.toCopyText([
                    {type: 'markdown', text: 'Intro.\n'},
                    documentSegment(
                        {
                            root: 'top',
                            elements: {
                                top: {
                                    component: 'stack',
                                    props: {},
                                    children: ['n', 'chart'],
                                    slots: {header: ['m']}
                                },
                                n: {component: 'note', props: {text: 'a'}},
                                chart: {component: 'chart', props: {}},
                                m: METRICS_DOC.elements.m
                            }
                        },
                        false
                    ),
                    {type: 'markdown', text: '\n'},
                    ...catalog.parseTags('<ui-note text="hi"/>'),
                    {type: 'placeholder', component: 'note', source: '<ui-note'},
                    {
                        type: 'fallback',
                        component: null,
                        name: 'chart',
                        props: {},
                        errors: ['unknown'],
                        source: '<ui-chart/>'
                    },
                    {type: 'markdown', text: '\nEnd.'}
                ])
            ).toBe('Intro.\n\nShowed metrics.\nNoted a.\n\nNoted hi.\n\nEnd.');
        });

        it('changes version when the formats change', () => {
            const base = createCatalog().version;

            expect(createCatalog({textFormats: [chatUiTagFormat()]}).version).toBe(base);
            expect(
                createCatalog({textFormats: [chatUiTagFormat(), braceFormat()]}).version
            ).not.toBe(base);
            expect(createCatalog({textFormats: []}).version).not.toBe(base);
            expect(
                createCatalog({textFormats: [{...chatUiTagFormat(), version: '2'}]}).version
            ).not.toBe(base);
        });

        it('keeps the version a catalog had before text formats, with the default format', () => {
            const catalog = new ChatUiCatalog({components: [NOTE]});

            expect(catalog.version).toBe(
                hashJson({
                    components: [
                        {
                            name: 'note',
                            toolName: 'add_note',
                            description: NOTE.description,
                            props: NOTE.props
                        }
                    ],
                    modes: ['tools'],
                    instructions: null,
                    tagPrefix: 'ui-',
                    documentToolName: 'show_ui',
                    limits: catalog.limits
                })
            );
        });

        it('refuses a mode it does not know in toPrompt, toToolSchemas and toExport', () => {
            const catalog = createCatalog(),
                error = 'ChatUiCatalog modes must be one or more of tools, document, tags.';

            expect(() => catalog.toPrompt({modes: ['brace']})).toThrow(error);
            expect(() => catalog.toToolSchemas({modes: ['tool' as any]})).toThrow(error);
            expect(() => catalog.toExport({modes: ['tools', 'brace']})).toThrow(error);
        });

        it('toExport holds the version, tools, prompt and each format export', () => {
            const brace = {
                    ...braceFormat(),
                    toExport: ({catalog}) => ({count: catalog.components.length})
                },
                catalog = createCatalog({
                    textFormats: [chatUiTagFormat(), brace],
                    modes: ['tools', 'brace']
                });

            expect(catalog.toExport()).toEqual({
                version: catalog.version,
                tools: catalog.toToolSchemas(),
                prompt: catalog.instructions,
                formats: {brace: {count: 2}}
            });
            expect(catalog.toExport({modes: ['document']})).toMatchObject({
                tools: [{name: 'show_ui'}],
                prompt: catalog.toPrompt({modes: ['document']})
            });
            expect(createCatalog().toExport().formats).toEqual({});
            expect(JSON.parse(JSON.stringify(catalog.toExport()))).toEqual(catalog.toExport());
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

/** A catalog with one component whose `value` prop has the given schema. */
function catalogWithProp(schema: PlainObject): ChatUiCatalog {
    return new ChatUiCatalog({
        components: [{...NOTE, props: {type: 'object', properties: {value: schema}}}]
    });
}

const STACK: ChatUiComponentSpec = {
    name: 'stack',
    description: 'A vertical stack.',
    props: {type: 'object', properties: {}},
    slots: ['default', 'header'],
    render: (_, {children, slots}) =>
        fragment({items: ['[', ...(slots.header ?? []), ...children, ']']})
};

const METRICS_DOC: ChatUiDocument = {
    root: 'm',
    elements: {m: {component: 'metrics', props: {items: [{label: 'Revenue', value: 12}]}}}
};

/** A text format that reads `{{metrics}}` as a document of one metrics element. */
function braceFormat(): ChatUiTextFormat {
    return {
        name: 'brace',
        parse: text =>
            text
                .split(/(\{\{metrics\}\})/)
                .filter(it => it)
                .map(it =>
                    it === '{{metrics}}'
                        ? {type: 'document', document: METRICS_DOC, isPartial: false, source: it}
                        : {type: 'markdown', text: it}
                ),
        toPrompt: () => '### Brace tokens\n\nWrite `{{metrics}}` to show the metrics.'
    };
}

/** A text format that reads `token` as a note, with the given source and text. */
function tokenFormat(
    name: string,
    token: string,
    source: string,
    getText: () => string
): ChatUiTextFormat {
    return {
        name,
        parse: text =>
            text.split(token).flatMap((it, idx) => [
                ...(idx > 0
                    ? [
                          {
                              type: 'component' as const,
                              element: {component: 'note', props: {text: getText()}},
                              source
                          }
                      ]
                    : []),
                ...(it ? [{type: 'markdown' as const, text: it}] : [])
            ]),
        toPrompt: () => ''
    };
}

function documentSegment(document: ChatUiDocument, isPartial: boolean): ChatUiDocumentSegment {
    return {type: 'document', document, isPartial, source: ''};
}

function textContext(): Omit<ChatUiDocumentContext, 'isPartial'> {
    return {
        chatModel: null,
        messageId: 'm1',
        part: {type: 'text', id: 't1', text: '', state: 'done'}
    };
}

function createCatalog(config: Partial<ChatUiCatalogConfig> = {}): ChatUiCatalog {
    return new ChatUiCatalog({components: [METRICS, NOTE], ...config});
}

function createModel(transport: ScriptedChatTransport, tools: ChatToolSpec[]): ChatModel {
    const model = new ChatModel({transport, tools});
    onTestFinished(() => model.destroy());
    return model;
}

/** A chat whose data parts render on each update, as the message list would render them. */
function createStreamingModel(
    events: any[],
    dataRenderers: ChatModelConfig['dataRenderers'],
    onRender: (html: string) => void = () => {}
): ChatModel {
    const model = new ChatModel({
        transport: new ScriptedChatTransport({responses: [events], delayMs: 20}),
        dataRenderers
    });
    onTestFinished(() => model.destroy());
    model.addReaction({
        track: () => model.lastMessage,
        run: message => {
            const part = message?.parts.find(it => it.type === 'data') as ChatDataPart;
            if (part) {
                onRender(
                    markup(
                        model.dataRenderers[part.dataType](part, {
                            chatModel: model,
                            messageId: message.id
                        })
                    )
                );
            }
        }
    });
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
