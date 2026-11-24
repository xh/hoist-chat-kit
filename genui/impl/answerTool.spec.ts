import {fireEvent, render, screen} from '@testing-library/react';
import {fragment} from '@xh/hoist/cmp/layout';
import {XH} from '@xh/hoist/core';
import {initTestAppAsync} from '@xh/hoist/test-support';
import type {ReactElement} from 'react';
import {beforeAll, describe, expect, it, onTestFinished, vi} from 'vitest';
import type {Blueprint, BlueprintDataProvider} from '../../blueprint';
import {ChatMessage, type ChatModel, type ChatToolCallPart} from '../../core';
import {chatUiStackSpec, chatUiStatCardsSpec, chatUiTextSpec} from '../../desktop/cmp/genui';
import {keepArtifactRows} from '../../impl/ArtifactRows';
import {portfolioCatalog, scenarioRegistry} from '../../test/blueprintFixtures';
import {ChatArtifactRegistry} from '../ChatArtifactRegistry';
import {ChatUiCatalog} from '../ChatUiCatalog';
import {CubeGridWidgetModel} from '../../desktop/cmp/blueprint/CubeGridWidget';

/**
 * `show_ui` takes an answer blueprint: it reads the app's datasets and the chat's artifacts, loads
 * within the chat's bounds, and shows nothing for an answer with errors.
 */
describe('show_ui with answer blueprints', () => {
    beforeAll(async () => {
        await initTestAppAsync();
    });

    const ROWS = [
        {id: 'a', mktVal: 100, sector: 'Energy'},
        {id: 'b', mktVal: 250, sector: 'Technology'}
    ];

    function setup(opts: {isLatest?: boolean} = {}) {
        const provider = {
                loadAsync: vi.fn(async () => ({rows: ROWS}))
            } satisfies BlueprintDataProvider,
            artifacts = new ChatArtifactRegistry(),
            chatModel = {
                messages: [
                    {id: 'm1', role: 'assistant'},
                    ...(opts.isLatest === false ? [{id: 'm2', role: 'assistant'}] : [])
                ],
                artifacts,
                getMessage: () => null
            } as unknown as ChatModel,
            catalog = new ChatUiCatalog({
                components: [chatUiStackSpec(), chatUiTextSpec(), chatUiStatCardsSpec()],
                modes: ['document'],
                answers: {dataCatalog: portfolioCatalog, dataProvider: provider}
            });
        return {catalog, provider, artifacts, chatModel};
    }

    const answer = (source: object): Blueprint => ({
        sources: {pos: source},
        root: 'cards',
        elements: {
            cards: {component: 'statCard', config: {source: 'pos', field: 'mktVal'}}
        }
    });
    const DATASET = {dataset: 'positions', params: {asOf: '2026-11-19'}};

    function show(catalog: ChatUiCatalog, chatModel: ChatModel, input: object) {
        const part: ChatToolCallPart = {
            type: 'tool-call',
            id: 't1',
            toolCallId: 't1',
            toolName: 'show_ui',
            state: 'output-available',
            input
        } as any;
        return render(
            fragment({
                children: catalog.documentTool.renderer(part, {chatModel, messageId: 'm1'})
            }) as ReactElement
        );
    }

    it('describes the registry, with no reserved widget', () => {
        const {catalog} = setup(),
            {parameters, description} = catalog.documentTool,
            names = parameters.properties.elements.additionalProperties.properties.component.enum;
        expect(names).toEqual(
            expect.arrayContaining(['statCard', 'tileFrame', 'cubeGrid', 'markdown', 'box'])
        );
        // A translated component's bridge is the kit's to place, never the model's.
        ['fallback', 'text', 'stack', 'chatUiCallout', 'section'].forEach(it =>
            expect(names).not.toContain(it)
        );
        expect(description).toContain('statCard: Stat card.');
    });

    it('names the config keys of each widget with few, marking those it requires', () => {
        const {description} = setup().catalog.documentTool,
            line = (name: string) =>
                description.split('\n').find(it => it.startsWith(`- ${name}:`));
        expect(line('markdown')).toMatch(/ Config: .*text \(required\)\.$/);
        expect(line('cubeGrid')).not.toContain('Config:');
    });

    it("names each widget's slot lists, in users' words", () => {
        const line = (name: string) =>
            setup()
                .catalog.documentTool.description.split('\n')
                .find(it => it.startsWith(`- ${name}:`));
        expect(line('panel')).toMatch(/ Slots: tbar \(A toolbar along the top/);
        expect(line('panel')).toMatch(/headerItems \(Inputs in the panel's header/);
        expect(line('dashboard')).toMatch(/Each child reference may hold: headerItems \(/);
    });

    it('lists the values of a short enum beside its key', () => {
        const line = setup()
            .catalog.documentTool.description.split('\n')
            .find(it => it.startsWith('- box:'));
        expect(line).toContain('direction (column, row)');
        expect(line).toContain('align (stretch, start, center, end)');
    });

    it("offers the app's own widgets and types, beside chat kit's", () => {
        const app = scenarioRegistry(),
            catalog = new ChatUiCatalog({
                components: [chatUiTextSpec()],
                answers: {registry: app}
            }),
            {registry} = catalog;
        Object.keys(app.widgets).forEach(it => expect(registry.widgets[it]).toBeTruthy());
        Object.keys(app.variableTypes).forEach(it =>
            expect(registry.variableTypes[it]).toBeTruthy()
        );
        expect(registry.widgets.text).toBeTruthy();
        expect(registry.actions.send).toBeTruthy();
    });

    it('shows nothing for an answer with errors, and gives the model its issues', async () => {
        const {catalog, chatModel} = setup(),
            run = (input: object) => catalog.documentTool.execute(input, {chatModel} as any);
        expect(await run(answer(DATASET))).toContain('Rendered an answer of 1 element');
        expect(() => run(answer({dataset: 'nope'}))).toThrow(/Invalid answer[\s\S]*nope/);
        expect(() => run(answer({artifact: 'art_never'}))).toThrow(
            /Invalid answer[\s\S]*unknown artifact 'art_never'/
        );
    });

    describe('a button aimed at a tool only the model may call', () => {
        const forged = {
            root: 'b',
            elements: {
                b: {
                    component: 'buttonGroup',
                    config: {
                        buttons: [
                            {
                                label: 'Refresh',
                                action: {
                                    type: 'callTool',
                                    name: 'unlock',
                                    confirm: {title: 'Refresh data', message: 'Reload the figures?'}
                                }
                            }
                        ]
                    }
                }
            }
        };
        const withTool = () => {
            const ret = setup(),
                execute = vi.fn();
            (ret.chatModel as any).getToolSpec = (name: string) =>
                name === 'unlock' ? {name, execute, allowActions: false} : null;
            return {...ret, execute};
        };

        it('refuses the answer, and tells the model why', () => {
            const {catalog, chatModel} = withTool();
            expect(() => catalog.documentTool.execute(forged, {chatModel} as any)).toThrow(
                /Invalid answer[\s\S]*'unlock' runs only when the model calls it/
            );
        });

        it('disables its button on a stored answer, saying why, and never asks the user', async () => {
            const {catalog, chatModel, execute} = withTool(),
                confirm = vi.spyOn(XH, 'confirm');
            onTestFinished(() => {
                vi.restoreAllMocks();
            });
            show(catalog, chatModel, forged);
            const button = (await screen.findByText('Refresh')).closest('button');
            expect(button.disabled).toBe(true);
            expect(button.title).toMatch(/'unlock' runs only when the model calls it/);
            fireEvent.click(button);
            expect(confirm).not.toHaveBeenCalled();
            expect(execute).not.toHaveBeenCalled();
        });
    });

    it('draws a widget in its chat card when the answer names no presentation', async () => {
        const {catalog, chatModel} = setup(),
            {container} = show(catalog, chatModel, {
                sources: {
                    pnl: {
                        inline: {
                            fields: [
                                {name: 'x', type: 'string', isDimension: true},
                                {name: 'v', type: 'number'}
                            ],
                            rows: [{x: 'a', v: 1}]
                        }
                    }
                },
                root: 'c',
                elements: {
                    c: {
                        component: 'chart',
                        config: {source: 'pnl', type: 'column', x: 'x', y: ['v']}
                    }
                }
            });
        await vi.waitFor(() => expect(container.querySelector('.xh-chat-ui-chart')).toBeTruthy());
    });

    describe('a grid in an answer', () => {
        const grid = (config: object) => ({
            sources: {
                pnl: {
                    inline: {
                        fields: [
                            {name: 'sector', type: 'string', isDimension: true},
                            {name: 'v', type: 'number'}
                        ],
                        rows: [
                            {sector: 'a', v: 1},
                            {sector: 'b', v: 2}
                        ]
                    }
                }
            },
            root: 'g',
            elements: {
                g: {component: 'cubeGrid', config: {source: 'pnl', columnState: ['v'], ...config}}
            }
        });
        const drawn = async (config: object) => {
            const {catalog, chatModel} = setup(),
                {container} = show(catalog, chatModel, grid(config));
            await vi.waitFor(() =>
                expect(
                    container.querySelector('.xh-chat-ui-grid, .xh-blueprint-cube-grid')
                ).toBeTruthy()
            );
            return container;
        };

        it('draws in its chat card when flat and unstyled', async () => {
            const container = await drawn({});
            expect(container.querySelector('.xh-chat-ui-grid')).toBeTruthy();
            expect(container.querySelector('.xh-blueprint-cube-grid')).toBeNull();
        });

        it('draws as a grid panel of its default height when grouped, as the card draws flat', async () => {
            const container = await drawn({groupBy: ['sector']}),
                panel = container.querySelector<HTMLElement>('.xh-chat-ui-answer-panel');
            expect(panel.querySelector('.xh-blueprint-cube-grid')).toBeTruthy();
            // In chat kit's card frame, at full width, so the grid fills it in a stack or a tab.
            expect(panel.querySelector('.xh-chat-ui-frame .xh-blueprint-cube-grid')).toBeTruthy();
            expect(panel.style).toMatchObject({
                height: 'calc(300px + 2 * var(--xh-border-width))',
                width: '100%',
                display: 'flex'
            });
            expect(container.querySelector('.xh-chat-ui-grid')).toBeNull();
        });

        it('draws its title in the header strip of its frame, above the height of its content', async () => {
            const height = vi.spyOn(CubeGridWidgetModel.prototype, 'contentHeight', 'get');
            onTestFinished(() => height.mockRestore());
            height.mockReturnValue(120);
            const container = await drawn({groupBy: ['sector'], title: 'By sector'}),
                panel = container.querySelector<HTMLElement>('.xh-chat-ui-answer-panel');
            expect(panel.querySelector('.xh-chat-ui-frame__title')?.textContent).toBe('By sector');
            expect(panel.style.height).toBe(
                'calc(120px + 2 * var(--xh-border-width) + var(--xh-chat-part-header-height, 28px))'
            );
        });

        it('sizes to its content, up to its default height', async () => {
            const height = vi.spyOn(CubeGridWidgetModel.prototype, 'contentHeight', 'get');
            onTestFinished(() => height.mockRestore());
            const panelHeight = async (content: number) => {
                height.mockReturnValue(content);
                const container = await drawn({groupBy: ['sector']});
                return container.querySelector<HTMLElement>('.xh-chat-ui-answer-panel').style
                    .height;
            };
            expect(await panelHeight(120)).toBe('calc(120px + 2 * var(--xh-border-width))');
            expect(await panelHeight(900)).toBe('calc(300px + 2 * var(--xh-border-width))');
            expect(await panelHeight(null)).toBe('calc(300px + 2 * var(--xh-border-width))');
        });

        it('fills the width of a stack and of a tab, as at the root', async () => {
            const {catalog, chatModel} = setup(),
                {sources, elements} = grid({groupBy: ['sector']}),
                {container} = show(catalog, chatModel, {
                    sources,
                    root: 'tabs',
                    elements: {
                        tabs: {
                            component: 'tabContainer',
                            config: {},
                            children: [
                                {id: 'g', title: 'Grid'},
                                {id: 'col', title: 'Stack'}
                            ]
                        },
                        col: {component: 'stack', config: {}, children: [{id: 'g2'}]},
                        g: elements.g,
                        g2: elements.g
                    }
                });
            await vi.waitFor(() =>
                expect(container.querySelector('.xh-chat-ui-answer-panel')).toBeTruthy()
            );
            container.querySelectorAll<HTMLElement>('.xh-chat-ui-answer-panel').forEach(panel => {
                expect(panel.querySelector('.xh-chat-ui-frame')).toBeTruthy();
                expect(panel.style).toMatchObject({
                    height: 'calc(300px + 2 * var(--xh-border-width))',
                    width: '100%',
                    display: 'flex'
                });
            });
        });

        it('draws as a grid panel when styled, as the card ignores styles', async () => {
            const container = await drawn({treeStyle: 'colors'});
            expect(container.querySelector('.xh-blueprint-cube-grid')).toBeTruthy();
        });
    });

    it('renders a reply stored as a catalog document as it always has', () => {
        const {catalog, chatModel} = setup();
        show(catalog, chatModel, {
            root: 'top',
            elements: {
                top: {component: 'stack', props: {}, children: ['t']},
                t: {component: 'text', props: {text: 'Stored reply'}}
            }
        });
        expect(screen.getByText('Stored reply')).toBeTruthy();
    });

    it("loads a dataset through the app's provider in the latest reply", async () => {
        const {catalog, provider, chatModel} = setup();
        show(catalog, chatModel, answer(DATASET));
        await vi.waitFor(() => expect(provider.loadAsync).toHaveBeenCalledOnce());
        expect(await screen.findByText('Market Value')).toBeTruthy();
    });

    it('holds the dataset of an earlier reply until the user asks for current data', async () => {
        const {catalog, provider, chatModel} = setup({isLatest: false});
        show(catalog, chatModel, answer(DATASET));
        expect(await screen.findByText('Data from an earlier reply.')).toBeTruthy();
        expect(provider.loadAsync).not.toHaveBeenCalled();

        fireEvent.click(screen.getByText('Load current data'));
        await vi.waitFor(() => expect(provider.loadAsync).toHaveBeenCalledOnce());
    });

    it("reads a chat's artifact through the dataset it names", async () => {
        const {catalog, artifacts, chatModel} = setup();
        artifacts.add({
            id: 'art_1',
            columns: [{name: 'mktVal', type: 'number'}],
            rows: [{mktVal: 100}, {mktVal: 250}],
            totalRows: 2,
            metadata: {dataset: 'positions'}
        });
        const load = vi.spyOn(artifacts, 'loadRangeAsync'),
            {container} = show(catalog, chatModel, answer({artifact: 'art_1'}));
        await vi.waitFor(() => expect(load).toHaveBeenCalledWith('art_1', 0, 2));
        await vi.waitFor(() =>
            expect(container.querySelector('.xh-stat-card__value')?.textContent).toMatch(/\d/)
        );
    });

    describe('adding an answer to the host', () => {
        function withHost(isAvailable: boolean) {
            const {chatModel} = setup(),
                add = vi.fn(),
                catalog = new ChatUiCatalog({
                    components: [chatUiStackSpec(), chatUiTextSpec(), chatUiStatCardsSpec()],
                    answers: {
                        dataCatalog: portfolioCatalog,
                        dataProvider: {loadAsync: async () => ({rows: ROWS})},
                        addToHost: {isAvailable: () => isAvailable, add}
                    }
                }),
                input = answer(DATASET),
                message = new ChatMessage({
                    id: 'm1',
                    role: 'assistant',
                    parts: [
                        {id: 'p0', type: 'text', text: 'Here.', state: 'done'},
                        {
                            id: 't1',
                            type: 'toolCall',
                            toolName: 'show_ui',
                            state: 'output-available',
                            input
                        } as any
                    ]
                });
            (chatModel as any).getMessage = (id: string) => (id === 'm1' ? message : null);
            return {catalog, chatModel, add, input};
        }

        it('offers a button that adds the answer by its ID, once the answer is complete', async () => {
            const {catalog, chatModel, add, input} = withHost(true);
            show(catalog, chatModel, input);
            fireEvent.click(await screen.findByText('Add to dashboard'));
            expect(add).toHaveBeenCalledWith('m1:0', chatModel);
        });

        it('offers no button while the app says the user may not add', async () => {
            const {catalog, chatModel, input} = withHost(false);
            show(catalog, chatModel, input);
            expect(await screen.findByText('Market Value')).toBeTruthy();
            expect(screen.queryByText('Add to dashboard')).toBeNull();
        });
    });

    describe("a query's artifact kept without its rows, as after a reload", () => {
        const keep = (artifacts: ChatArtifactRegistry) =>
            artifacts.add({
                id: 'art_2',
                columns: [{name: 'mktVal', type: 'number'}],
                totalRows: 2,
                metadata: {
                    dataset: 'positions',
                    request: {
                        dataset: 'positions',
                        params: {asOf: '2026-11-19'},
                        fields: ['mktVal']
                    }
                }
            });

        it('shows the rows the model saw while the chat holds them, with no query', async () => {
            const {catalog, provider, artifacts, chatModel} = setup();
            keep(artifacts);
            keepArtifactRows(chatModel, 'art_2', [{mktVal: 100}, {mktVal: 250}]);
            const {container} = show(catalog, chatModel, answer({artifact: 'art_2'}));
            await vi.waitFor(() =>
                expect(container.querySelector('.xh-stat-card__value')?.textContent).toMatch(/\d/)
            );
            expect(provider.loadAsync).not.toHaveBeenCalled();
        });

        it("runs its request again through the app's provider once its rows are gone", async () => {
            const {catalog, provider, artifacts, chatModel} = setup();
            keep(artifacts);
            show(catalog, chatModel, answer({artifact: 'art_2'}));
            await vi.waitFor(() =>
                expect(provider.loadAsync).toHaveBeenCalledWith(
                    expect.objectContaining({dataset: 'positions', fields: ['mktVal']}),
                    undefined,
                    undefined
                )
            );
        });

        it('waits in an earlier reply until the user asks for current data', async () => {
            const {catalog, provider, artifacts, chatModel} = setup({isLatest: false});
            keep(artifacts);
            show(catalog, chatModel, answer({artifact: 'art_2'}));
            expect(await screen.findByText('Data from an earlier reply.')).toBeTruthy();
            expect(provider.loadAsync).not.toHaveBeenCalled();

            fireEvent.click(screen.getByText('Load current data'));
            await vi.waitFor(() => expect(provider.loadAsync).toHaveBeenCalledOnce());
        });

        it('says it is no longer available, with no request to run', async () => {
            const {catalog, artifacts, chatModel} = setup();
            artifacts.add({id: 'art_3', columns: [{name: 'mktVal', type: 'number'}], totalRows: 2});
            show(catalog, chatModel, answer({artifact: 'art_3'}));
            expect(
                await screen.findByText('The data for this answer is no longer available.')
            ).toBeTruthy();
        });
    });
});
