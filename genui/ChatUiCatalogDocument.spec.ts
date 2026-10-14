import {act, render, screen, waitFor} from '@testing-library/react';
import {fragment} from '@xh/hoist/cmp/layout';
import type {PlainObject} from '@xh/hoist/core';
import {initTestAppAsync} from '@xh/hoist/test-support';
import type {ReactNode} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {beforeAll, describe, expect, it, onTestFinished, vi} from 'vitest';
import {ChatModel, type ChatPartRenderContext, type ChatToolCallPart} from '../core';
import {ScriptedChatTransport, toolCallEvents, textEvents} from '../transport';
import {ChatArtifactRegistry, type ChatDataHandle} from './ChatArtifactRegistry';
import {ChatUiCatalog, type ChatUiCatalogConfig} from './ChatUiCatalog';
import type {ChatUiComponentSpec, ChatUiDocumentContext} from './ChatUiComponentSpec';
import type {ChatUiDocument} from './ChatUiDocument';
import {validateSchema} from './impl/validateSchema';

/**
 * Every generative UI answer is a flat document of elements keyed by id. Apps rely on the catalog
 * to report each structural and props problem in a form the model can fix, to repair only what
 * loses nothing, to render a streaming document as far as it has arrived, and to contain each
 * broken element in a fallback so the rest of the answer still shows.
 */
describe('ChatUiCatalog documents', () => {
    beforeAll(() => initTestAppAsync());

    describe('validateDocument', () => {
        it('accepts a nested document with children and slots', () => {
            expect(createCatalog().validateDocument(NESTED)).toEqual([]);
        });

        it.each<[string, PlainObject, string[]]>([
            ['a document that is not an object', [] as any, ['expected object, got array']],
            ['a missing root', {elements: {}}, ['root: required']],
            ['missing elements', {root: 'a'}, ['elements: required']],
            [
                'a root that names no element',
                {root: 'a', elements: {}},
                ["root: unknown element 'a'"]
            ],
            [
                'a child id that names no element',
                doc({top: stack(['n1', 'gone']), n1: noteEl('a')}),
                ["elements.top.children[1]: unknown element 'gone'"]
            ],
            [
                'a cycle',
                doc({top: stack(['a']), a: stack(['b']), b: stack(['a'])}),
                ["elements.b.children[0]: 'a' is already a child of 'top'"]
            ],
            [
                'a cycle away from the root',
                doc({top: stack([]), a: stack(['b']), b: stack(['a'])}),
                ['elements.a: cycle a > b > a']
            ],
            [
                'the root as a child',
                doc({top: stack(['top'])}),
                ["elements.top.children[0]: 'top' is the root of the document"]
            ],
            [
                'a child under two parents',
                doc({top: stack(['a', 'b']), a: stack(['n']), b: stack(['n']), n: noteEl('x')}),
                ["elements.b.children[0]: 'n' is already a child of 'a'"]
            ],
            [
                'children on a component that takes none',
                doc({top: {...noteEl('x'), children: ['n']}, n: noteEl('y')}),
                ["elements.top.children: component 'note' takes no children"]
            ],
            [
                'an unknown slot',
                doc({top: {...stack([]), slots: {footer: []}}}),
                ["elements.top.slots.footer: component 'stack' has no slot 'footer'"]
            ],
            [
                'a child id that is not a string',
                doc({top: stack([7 as any])}),
                ['elements.top.children[0]: expected string, got number']
            ],
            [
                'an unknown component',
                doc({top: {component: 'chart', props: {}}}),
                ["elements.top.component: unknown component 'chart'"]
            ],
            [
                'an element that is not an object',
                doc({top: 'note' as any}),
                ['elements.top: expected object, got string']
            ],
            [
                'invalid props, with their paths',
                doc({top: stack(['n']), n: {component: 'note', props: {text: 7}}}),
                ['elements.n.props.text: expected string, got number']
            ],
            [
                'a failed validate function, under the element path',
                doc({top: noteEl('bad')}),
                ['elements.top.props.text: must not be "bad"']
            ]
        ])('reports %s', (_, document, errors) => {
            expect(createCatalog().validateDocument(document as ChatUiDocument)).toEqual(errors);
        });

        it('names an element with an odd id in brackets', () => {
            expect(
                createCatalog().validateDocument(
                    doc({top: stack(['my note']), 'my note': {component: 'note', props: {text: 1}}})
                )
            ).toEqual(['elements["my note"].props.text: expected string, got number']);
        });

        it('applies the element, depth and inline row caps', () => {
            const catalog = createCatalog({
                limits: {maxElements: 3, maxDepth: 2, maxInlineRows: 2}
            });

            expect(
                catalog.validateDocument(
                    doc({
                        top: stack(['a', 'b', 'c']),
                        a: noteEl('a'),
                        b: noteEl('b'),
                        c: noteEl('c')
                    })
                )
            ).toEqual(['elements: expected at most 3 elements, got 4']);
            expect(
                catalog.validateDocument(doc({top: stack(['a']), a: stack(['b']), b: noteEl('b')}))
            ).toEqual(['elements.b: more than 2 levels deep']);
            expect(
                catalog.validateDocument(
                    doc({top: {component: 'list', props: {items: ['a', 'b', 'c']}}})
                )
            ).toEqual([
                'elements.top.props.items: expected at most 2 items inline, got 3 - pass large data by reference'
            ]);
        });

        it('accepts a partial document that could still become valid', () => {
            const catalog = createCatalog(),
                partial = {
                    root: 'top',
                    elements: {
                        top: stack(['n1', 'n2']),
                        n1: {component: 'no'},
                        n2: {component: 'note', props: {}}
                    }
                };

            expect(catalog.validateDocument(partial as any, {isPartial: true})).toEqual([]);
            expect(catalog.validateDocument({} as any, {isPartial: true})).toEqual([]);
            expect(catalog.validateDocument(partial as any)).toEqual([
                "elements.n1.component: unknown component 'no'"
            ]);
        });

        it('waits for the last child id of the last element, which may be cut short', () => {
            const catalog = createCatalog(),
                cut = doc({top: stack(['n1']), n1: noteEl('a'), n12: stack(['n1'])});

            expect(catalog.validateDocument(cut, {isPartial: true})).toEqual([]);
            expect(catalog.validateDocument(cut)).toEqual([
                "elements.n12.children[0]: 'n1' is already a child of 'top'"
            ]);
        });

        it('still reports what no further streaming could fix', () => {
            const catalog = createCatalog();
            expect(
                catalog.validateDocument(doc({top: stack(['top', 'a'])}), {isPartial: true})
            ).toEqual(["elements.top.children[0]: 'top' is the root of the document"]);
            expect(
                catalog.validateDocument(doc({top: {component: 'zzz'}} as any), {isPartial: true})
            ).toEqual(["elements.top.component: unknown component 'zzz'"]);
        });
    });

    describe('repairDocument', () => {
        it('drops unknown keys, at the top and on elements', () => {
            const input = {
                root: 'top',
                catalogVersion: 'v1',
                version: 2,
                elements: {top: {...noteEl('a'), id: 'top', visible: true}}
            } as any;
            expect(createCatalog().repairDocument(input)).toEqual({
                root: 'top',
                catalogVersion: 'v1',
                elements: {top: noteEl('a')}
            });
        });

        it('takes a list of elements with unique ids as a map', () => {
            const input = {
                root: 'a',
                elements: [
                    {id: 'a', ...stack(['b'])},
                    {id: 'b', ...noteEl('x')}
                ]
            };
            expect(createCatalog().repairDocument(input as any)).toEqual(
                doc({a: stack(['b']), b: noteEl('x')}, 'a')
            );
        });

        it('leaves a list of elements with duplicate ids for the checks to report', () => {
            const input = {
                    root: 'a',
                    elements: [
                        {id: 'a', ...noteEl('x')},
                        {id: 'a', ...noteEl('y')}
                    ]
                },
                catalog = createCatalog();
            expect(catalog.validateDocument(catalog.repairDocument(input as any))).toEqual([
                'elements: expected object, got array'
            ]);
        });

        it('takes type as the component, adds empty props, and wraps a single child id', () => {
            const input = {
                root: 'top',
                elements: {top: {type: 'stack', children: 'n'}, n: noteEl('x')}
            };
            expect(createCatalog().repairDocument(input as any)).toEqual(
                doc({top: stack(['n']), n: noteEl('x')})
            );
        });

        it('moves declared props written beside props into props, without overwriting', () => {
            const input = {root: 'n', elements: {n: {component: 'note', text: 'moved', props: {}}}},
                kept = {
                    root: 'n',
                    elements: {n: {component: 'note', text: 'lost', props: {text: 'kept'}}}
                },
                catalog = createCatalog();

            expect(catalog.repairDocument(input as any).elements.n.props).toEqual({text: 'moved'});
            expect(catalog.repairDocument(kept as any).elements.n.props).toEqual({text: 'kept'});
        });

        it('leaves its input as it was', () => {
            const input = {
                    root: 'top',
                    extra: 1,
                    elements: {top: {type: 'note', props: {text: 'a'}}}
                },
                copy = structuredClone(input);
            createCatalog().repairDocument(input as any);
            expect(input).toEqual(copy);
        });
    });

    describe('migrateDocument', () => {
        it('upgrades a document from an older version, through each migration in turn', () => {
            const catalog = createCatalog({
                    migrations: {
                        v1: d => ({
                            ...d,
                            catalogVersion: 'v2',
                            elements: renameNotes(d, 'v1', 'v2')
                        }),
                        v2: d => ({
                            ...d,
                            catalogVersion: null,
                            elements: renameNotes(d, 'v2', 'now')
                        })
                    }
                }),
                old = {...doc({top: noteEl('v1')}), catalogVersion: 'v1'};

            expect(catalog.migrateDocument(old).elements.top.props.text).toBe('now');
        });

        it("renders a document with no version of its own through its message's version", () => {
            const catalog = createCatalog({
                    migrations: {
                        v1: d => ({
                            ...d,
                            catalogVersion: null,
                            elements: renameNotes(d, 'v1', 'now')
                        })
                    }
                }),
                context = {
                    ...documentContext(),
                    chatModel: {
                        getMessage: () => ({metadata: {catalogVersion: 'v1'}})
                    } as unknown as ChatModel
                };

            expect(markup(catalog.renderDocument(doc({top: noteEl('v1')}), context))).toBe('(now)');
        });

        it("renders a stored tag for a renamed component through the catalog's migrations", () => {
            const catalog = createCatalog({
                    migrations: {
                        v1: d => ({
                            ...d,
                            catalogVersion: null,
                            elements: {root: {...d.elements.root, component: 'note'}}
                        })
                    }
                }),
                [segment] = catalog.parseTags('<ui-memo text="hi"/>'),
                context = {
                    ...documentContext(),
                    chatModel: {
                        getMessage: () => ({metadata: {catalogVersion: 'v1'}})
                    } as unknown as ChatModel
                };

            expect(markup(catalog.renderSegment(segment, context))).toBe('(hi)');
        });

        it('leaves a current document, or one with no migration, as it is', () => {
            const migrate = vi.fn(),
                catalog = createCatalog({migrations: {v1: migrate}}),
                current = {...doc({top: noteEl('a')}), catalogVersion: catalog.version},
                unknown = {...doc({top: noteEl('a')}), catalogVersion: 'v0'};

            expect(catalog.migrateDocument(current)).toBe(current);
            expect(catalog.migrateDocument(unknown)).toBe(unknown);
            expect(migrate).not.toHaveBeenCalled();
        });
    });

    describe('renderDocument', () => {
        it('renders elements with their children and named slots', () => {
            expect(markup(createCatalog().renderDocument(NESTED, documentContext()))).toBe(
                '[(Head)(a)(b)]'
            );
        });

        it('renders a placeholder for a child that has not arrived', () => {
            const partial = {root: 'top', elements: {top: stack(['n1', 'n2']), n1: noteEl('a')}},
                html = markup(
                    createCatalog().renderDocument(partial, documentContext({isPartial: true}))
                );

            expect(html).toContain('(a)');
            expect(html).toContain('Building…');
        });

        it('renders a placeholder while the root or a component name streams', () => {
            const catalog = createCatalog(),
                context = documentContext({isPartial: true});

            expect(markup(catalog.renderDocument({} as any, context))).toContain('Building…');
            expect(
                markup(
                    catalog.renderDocument(
                        {root: 'n', elements: {n: {component: 'no'}}} as any,
                        context
                    )
                )
            ).toContain('Building…');
        });

        it('renders a fallback for an element with a problem, and the rest of the document', () => {
            const warn = silenceWarnings(),
                broken = doc({
                    top: stack(['ok', 'bad', 'gone']),
                    ok: noteEl('fine'),
                    bad: {component: 'note', props: {text: 1}}
                }),
                html = markup(createCatalog().renderDocument(broken, documentContext()));

            expect(html).toContain('(fine)');
            expect(html).toContain('This note could not be displayed.');
            expect(html).toContain('elements.bad.props.text: expected string, got number');
            expect(html).toContain('elements.gone: missing');
            expect(warn).toHaveBeenCalledTimes(2);
        });

        it('renders one fallback for a document whose structure is broken', () => {
            silenceWarnings();
            const html = markup(
                createCatalog().renderDocument(
                    doc({top: stack(['a']), a: stack(['top'])}),
                    documentContext()
                )
            );
            expect(html).toContain('This content could not be displayed.');
            expect(html).not.toContain('Building');
        });

        it('repairs the document before it renders', () => {
            const input = {root: 'n', elements: {n: {type: 'note', text: 'repaired'}}};
            expect(markup(createCatalog().renderDocument(input as any, documentContext()))).toBe(
                '(repaired)'
            );
        });

        it('contains an element that throws in a fallback, and renders the rest', () => {
            silenceWarnings();
            const error = vi.spyOn(console, 'error').mockImplementation(() => {});
            onTestFinished(() => error.mockRestore());

            const boom: ChatUiComponentSpec = {
                    name: 'boom',
                    description: 'Throws.',
                    props: {type: 'object'},
                    render: () => {
                        throw new Error('Kaboom');
                    }
                },
                catalog = createCatalog({components: [STACK, NOTE, boom]});

            const {container} = render(
                fragment(
                    catalog.renderDocument(
                        doc({
                            top: stack(['b', 'n']),
                            b: {component: 'boom', props: {}},
                            n: noteEl('alive')
                        }),
                        documentContext()
                    )
                )
            );

            expect(container.textContent).toContain('(alive)');
            expect(screen.getByText('This boom could not be displayed.')).toBeTruthy();
            expect(screen.getByText('Kaboom')).toBeTruthy();
        });

        it('gives an element that threw while partial another try once complete', () => {
            silenceWarnings();
            const error = vi.spyOn(console, 'error').mockImplementation(() => {});
            onTestFinished(() => error.mockRestore());

            const fragile: ChatUiComponentSpec = {
                    name: 'fragile',
                    description: 'Throws on partial props.',
                    props: {type: 'object'},
                    render: (_, {isPartial}) => {
                        if (isPartial) throw new Error('Not yet');
                        return 'whole';
                    }
                },
                catalog = createCatalog({components: [fragile]}),
                fragileDoc = doc({top: {component: 'fragile', props: {}}}),
                {container, rerender} = render(
                    fragment(catalog.renderDocument(fragileDoc, documentContext({isPartial: true})))
                );
            expect(container.textContent).toContain('Not yet');

            rerender(fragment(catalog.renderDocument(fragileDoc, documentContext())));
            expect(container.textContent).toBe('whole');
        });

        it('uses the configured fallback and placeholder', () => {
            silenceWarnings();
            const catalog = createCatalog({
                fallback: ({component, errors}) => `!${component}:${errors.length}`,
                placeholder: ({displayName}) => `…${displayName}`
            });

            expect(
                markup(
                    catalog.renderDocument(
                        doc({top: {component: 'note', props: {text: 1}}}),
                        documentContext()
                    )
                )
            ).toBe('!note:1');
            expect(
                markup(
                    catalog.renderDocument(
                        {root: 'top', elements: {}},
                        documentContext({isPartial: true})
                    )
                )
            ).toBe('…null');
        });

        it('passes the element and its rendered children to the component', () => {
            const renderStack = vi.fn(() => 'stack'),
                catalog = createCatalog({components: [{...STACK, render: renderStack}, NOTE]});

            markup(
                catalog.renderDocument(doc({top: stack(['n']), n: noteEl('x')}), documentContext())
            );

            const [props, context] = renderStack.mock.calls[0] as any[];
            expect(props).toEqual({});
            expect(context.element).toEqual({id: 'top', ...stack(['n'])});
            expect(markup(context.children)).toBe('(x)');
            expect(context.catalog).toBe(catalog);
        });
    });

    describe('document tool', () => {
        it('takes a document over the catalog components as its input schema', () => {
            const {documentTool} = createCatalog();

            expect(documentTool).toMatchObject({name: 'show_ui', display: 'inline'});
            expect(documentTool.description).toContain('- stack (default, header):');
            expect(documentTool.description).toContain('- note: A short note.');
            expect(validateSchema(NESTED, documentTool.parameters)).toEqual([]);
            expect(
                validateSchema(
                    doc({top: {component: 'note', props: {text: 1}}}),
                    documentTool.parameters
                )
            ).not.toEqual([]);
            expect(
                validateSchema(
                    doc({top: {...noteEl('a'), children: ['x']}}),
                    documentTool.parameters
                )
            ).not.toEqual([]);
        });

        it('confirms a valid document to the model, and rejects an invalid one with each problem', async () => {
            const {documentTool} = createCatalog(),
                run = (input: PlainObject) =>
                    Promise.resolve().then(() =>
                        documentTool.execute(input, {
                            chatModel: null,
                            toolCallId: 'c1',
                            signal: null
                        })
                    );

            expect(await run(NESTED)).toBe(
                'Rendered a UI of 4 components for the user: stack, note.'
            );
            await expect(run(doc({top: stack(['gone'])}))).rejects.toThrow(
                "nothing was shown. Fix and retry:\n- elements.top.children[0]: unknown element 'gone'"
            );
        });

        it('renders a streaming document, and nothing for a complete one that fails', () => {
            silenceWarnings();
            const {documentTool} = createCatalog(),
                context = renderContext();

            expect(
                markup(
                    documentTool.renderer(
                        callPart('input-streaming', {root: 'top', elements: {top: stack(['n'])}}),
                        context
                    )
                )
            ).toMatch(/^\[<div[^>]*>Building…<\/div>\]$/);
            expect(
                documentTool.renderer(
                    callPart('output-error', doc({top: stack(['gone'])})),
                    context
                )
            ).toBeNull();
        });

        it('renders a document shown by the model as it streams', async () => {
            const catalog = createCatalog(),
                transport = new ScriptedChatTransport({
                    responses: [
                        toolCallEvents('show_ui', NESTED, {chunkSize: 20}),
                        textEvents('Done.')
                    ],
                    delayMs: 0
                }),
                chatModel = new ChatModel({transport, tools: [catalog.documentTool]});
            onTestFinished(() => chatModel.destroy());

            await chatModel.sendAsync('Summarize.');

            const call = chatModel.lastMessage.toolCalls[0];
            expect(call.state).toBe('output-available');
            expect(
                markup(
                    catalog.documentTool.renderer(call, {
                        chatModel,
                        messageId: chatModel.lastMessage.id
                    })
                )
            ).toBe('[(Head)(a)(b)]');
        });

        it('offers display-only tools for a server-run loop', () => {
            const {displayTools} = createCatalog();

            expect(displayTools.map(it => it.name)).toEqual([
                'show_stack',
                'show_note',
                'show_list',
                'show_ui'
            ]);
            displayTools.forEach(it => {
                expect(it.execute).toBeUndefined();
                expect(it).toMatchObject({sendToModel: false, display: 'inline'});
                expect(it.renderer).toBeTypeOf('function');
            });
        });
    });

    describe('reference props', () => {
        const TABLE: ChatUiComponentSpec<{data: string}> = {
            name: 'table',
            description: 'A table over an artifact.',
            props: {type: 'object', required: ['data'], properties: {data: {type: 'string'}}},
            dataProps: [{name: 'data', pageSize: 2}],
            render: (_, {data}) => describeHandle(data.data)
        };

        it('resolves a reference prop to a handle with the first page of inline rows', () => {
            const registry = new ChatArtifactRegistry({
                    artifacts: [
                        {
                            id: 'sales',
                            columns: COLUMNS,
                            rows: [{r: 'A'}, {r: 'B'}, {r: 'C'}],
                            totalRows: 3
                        }
                    ]
                }),
                catalog = createCatalog({components: [TABLE], artifacts: () => registry});

            expect(markup(catalog.renderDocument(tableDoc('sales'), documentContext()))).toBe(
                'ready:A,B of 3'
            );
        });

        it("reads the chat's own registry when the catalog has no artifacts config", () => {
            const catalog = createCatalog({components: [TABLE]}),
                chatModel = new ChatModel({
                    transport: new ScriptedChatTransport(),
                    initialMessages: [
                        {
                            role: 'assistant',
                            parts: [],
                            metadata: {
                                artifacts: [
                                    {id: 'sales', columns: COLUMNS, rows: [{r: 'A'}], totalRows: 1}
                                ]
                            }
                        }
                    ]
                });
            onTestFinished(() => chatModel.destroy());

            expect(
                markup(catalog.renderDocument(tableDoc('sales'), {...documentContext(), chatModel}))
            ).toBe('ready:A of 1');
        });

        it('resolves a reference to a missing artifact as missing, or waiting while streaming', () => {
            const catalog = createCatalog({components: [TABLE]}),
                chatModel = {getMessage: () => ({isStreaming: true})} as any;

            expect(markup(catalog.renderDocument(tableDoc('sales'), documentContext()))).toBe(
                'missing'
            );
            expect(
                markup(
                    catalog.renderDocument(tableDoc('sales'), {
                        ...documentContext(),
                        chatModel,
                        messageId: 'm1'
                    })
                )
            ).toBe('waiting');
        });

        it('loads the first page from the data source, and renders again once it arrives', async () => {
            let resolveLoad: (rows: PlainObject[]) => void;
            const loadAsync = vi.fn(
                    () =>
                        new Promise<any>(
                            resolve =>
                                (resolveLoad = rows =>
                                    resolve({columns: COLUMNS, rows, totalRows: 9}))
                        )
                ),
                registry = new ChatArtifactRegistry({
                    dataSource: {loadAsync},
                    artifacts: [{id: 'sales', columns: COLUMNS, totalRows: 9}]
                }),
                catalog = createCatalog({components: [TABLE], artifacts: () => registry});

            render(fragment(catalog.renderDocument(tableDoc('sales'), documentContext())));
            expect(screen.getByText('loading')).toBeTruthy();
            expect(loadAsync).toHaveBeenCalledExactlyOnceWith(
                expect.objectContaining({artifactId: 'sales', offset: 0, limit: 2})
            );

            await act(async () => resolveLoad([{r: 'X'}, {r: 'Y'}]));
            await waitFor(() => expect(screen.getByText('ready:X,Y of 9')).toBeTruthy());
            expect(loadAsync).toHaveBeenCalledTimes(1);
        });
    });
});

//------------------
// Helpers
//------------------
const STACK: ChatUiComponentSpec = {
        name: 'stack',
        description: 'A vertical stack.',
        props: {type: 'object', additionalProperties: false, properties: {}},
        slots: ['default', 'header'],
        render: (_, {children, slots}) =>
            fragment({items: ['[', ...(slots.header ?? []), ...children, ']']})
    },
    NOTE: ChatUiComponentSpec<{text: string}> = {
        name: 'note',
        description: 'A short note.\nMore detail.',
        props: {type: 'object', properties: {text: {type: 'string'}}},
        validate: ({text}) => (text === 'bad' ? ['text: must not be "bad"'] : []),
        render: ({text}) => `(${text})`
    },
    LIST: ChatUiComponentSpec = {
        name: 'list',
        description: 'A list.',
        props: {type: 'object', properties: {items: {type: 'array', items: {type: 'string'}}}},
        render: () => null
    },
    COLUMNS = [{name: 'r', type: 'string' as const}];

const NESTED: ChatUiDocument = {
    root: 'top',
    elements: {
        top: {...stack(['a', 'b']), slots: {header: ['h']}},
        h: {component: 'note', props: {text: 'Head'}},
        a: {component: 'note', props: {text: 'a'}},
        b: {component: 'note', props: {text: 'b'}}
    }
};

function createCatalog(config: Partial<ChatUiCatalogConfig> = {}): ChatUiCatalog {
    return new ChatUiCatalog({components: [STACK, NOTE, LIST], ...config});
}

function doc(elements: Record<string, PlainObject>, root: string = 'top'): ChatUiDocument {
    return {root, elements: elements as any};
}

function stack(children: string[]): PlainObject & {component: string; props: PlainObject} {
    return {component: 'stack', props: {}, children};
}

function noteEl(text: string) {
    return {component: 'note', props: {text}};
}

function tableDoc(data: string): ChatUiDocument {
    return doc({t: {component: 'table', props: {data}}}, 't');
}

function renameNotes(d: ChatUiDocument, from: string, to: string) {
    const top = d.elements.top;
    return {
        ...d.elements,
        top: {...top, props: {text: top.props.text === from ? to : top.props.text}}
    };
}

function describeHandle(handle: ChatDataHandle): string {
    const {state, frame, totalRows} = handle;
    return state === 'ready'
        ? `ready:${frame.rows.map(it => it.r).join(',')} of ${totalRows}`
        : state;
}

function renderContext(): ChatPartRenderContext {
    return {chatModel: null, messageId: 'm1'};
}

function documentContext(opts: {isPartial?: boolean} = {}): ChatUiDocumentContext {
    return {
        ...renderContext(),
        part: {type: 'data', id: 'd1', dataType: 'xh.chat.ui', data: null},
        isPartial: !!opts.isPartial
    };
}

function callPart(state: ChatToolCallPart['state'], input: PlainObject): ChatToolCallPart {
    return {
        type: 'toolCall',
        id: 'c1',
        toolName: 'show_ui',
        state,
        inputText: JSON.stringify(input),
        input,
        output: null,
        errorText: null
    };
}

function silenceWarnings() {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    onTestFinished(() => warn.mockRestore());
    return warn;
}

function markup(content: ReactNode): string {
    return renderToStaticMarkup(fragment({items: content}))
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>');
}
