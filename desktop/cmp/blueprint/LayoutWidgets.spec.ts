import {render, screen} from '@testing-library/react';
import type {PlainObject} from '@xh/hoist/core';
import {initTestAppAsync} from '@xh/hoist/test-support';
import {beforeAll, describe, expect, it, onTestFinished} from 'vitest';
import {portfolioCatalog, scenarioRegistry} from '../../../test/blueprintFixtures';
import {
    type Blueprint,
    type BlueprintElement,
    BlueprintModel,
    validateBlueprint
} from '../../../blueprint';
import {blueprintView} from './BlueprintView';
import {DashCanvasWidgetModel} from './DashCanvasWidget';
import {DashContainerWidgetModel} from './DashContainerWidget';
import {PanelWidgetModel} from './PanelWidget';

/**
 * Layout widgets arrange their children and have no chrome. A `box` sizes each child by its
 * reference, and a `separator` or `spacer` takes its parent's direction. A container adds chrome,
 * and shows its `emptyText` while it has no children.
 */
describe('layout and container widgets', () => {
    beforeAll(async () => {
        await initTestAppAsync();
    });

    function show(root: string, elements: Record<string, BlueprintElement>) {
        const blueprint: Blueprint = {schema: {blueprint: 1}, root, elements},
            model = new BlueprintModel({
                blueprint,
                catalog: portfolioCatalog,
                registry: scenarioRegistry(),
                dataProvider: null,
                mode: 'run'
            });
        onTestFinished(() => model.destroy());
        return {model, ...render(blueprintView({model}))};
    }

    const emptyPanel = (text: string): BlueprintElement => ({
        component: 'panel',
        config: {emptyText: text}
    });

    it("warns of a tileFrame's minimum tile size over its maximum", () => {
        const issues = validateBlueprint(
            {
                schema: {blueprint: 1},
                root: 'tiles',
                elements: {
                    tiles: {
                        component: 'tileFrame',
                        config: {minTileWidth: 300, maxTileWidth: 200, minTileHeight: 50},
                        children: []
                    }
                }
            },
            {catalog: portfolioCatalog, registry: scenarioRegistry()}
        );
        expect(issues.map(it => [it.code, it.path])).toEqual([
            ['tileFrame.minOverMax', '/elements/tiles/config/minTileWidth']
        ]);
    });

    describe('box', () => {
        it('lays out its children along its direction, sizing each by its reference', () => {
            const {container} = show('row', {
                    row: {
                        component: 'box',
                        config: {direction: 'row'},
                        children: [{id: 'left', flex: 2}, {id: 'right', width: 200}, {id: 'rest'}]
                    },
                    left: emptyPanel('Left'),
                    right: emptyPanel('Right'),
                    rest: emptyPanel('Rest')
                }),
                box = container.querySelector('.xh-blueprint-box') as HTMLElement,
                items = [...box.children] as HTMLElement[];
            expect(box.style.flexDirection).toBe('row');
            expect(items.map(it => it.textContent)).toEqual(['Left', 'Right', 'Rest']);
            expect(items[0].style.flex).toMatch(/^2/);
            expect(items[1].style.width).toBe('200px');
            expect(items[1].style.flex).toMatch(/^none|^0 0/);
            expect(items[2].style.flex).toMatch(/^1/);
        });

        it('warns at align when another align leaves a grid or chart no room across it', () => {
            const check = (align: string) =>
                validateBlueprint(
                    {
                        schema: {blueprint: 1},
                        root: 'row',
                        variables: {
                            asOf: {
                                type: 'localDate',
                                setBy: 'prompt',
                                default: {value: '2026-03-02'}
                            }
                        },
                        sources: {
                            positions: {dataset: 'positions', params: {asOf: {$var: 'asOf'}}}
                        },
                        elements: {
                            row: {component: 'box', config: {align}, children: [{id: 'grid'}]},
                            grid: {
                                component: 'cubeGrid',
                                config: {source: 'positions', columnState: ['mktVal']}
                            }
                        }
                    },
                    {catalog: portfolioCatalog, registry: scenarioRegistry()}
                ).map(it => [it.code, it.path]);
            expect(check('center')).toEqual([['box.alignCollapses', '/elements/row/config/align']]);
            expect(check('stretch')).toEqual([]);
        });

        it('fills its parent as a frame by default, or sizes to its content as a box', () => {
            const filled = show('col', {
                    col: {component: 'box', config: {}, children: [{id: 'a'}]},
                    a: emptyPanel('A')
                }).container.querySelector('.xh-blueprint-box') as HTMLElement,
                sized = show('col', {
                    col: {component: 'box', config: {fill: false}, children: [{id: 'a'}]},
                    a: emptyPanel('A')
                }).container.querySelector('.xh-blueprint-box') as HTMLElement;
            expect(filled.style.flexDirection).toBe('column');
            expect(filled.style.flex).toMatch(/^1/);
            expect(sized.style.flex).toBe('');
        });

        it('draws a separator across its direction, and a spacer along it', () => {
            const {container} = show('row', {
                    row: {
                        component: 'box',
                        config: {direction: 'row'},
                        children: [{id: 'a'}, {id: 'rule'}, {id: 'gap'}, {id: 'fill'}, {id: 'b'}]
                    },
                    a: emptyPanel('A'),
                    rule: {component: 'separator', config: {label: 'or'}},
                    gap: {component: 'spacer', config: {size: 24}},
                    fill: {component: 'spacer', config: {}},
                    b: emptyPanel('B')
                }),
                rule = container.querySelector('[role="separator"]'),
                items = [...container.querySelector('.xh-blueprint-box').children] as HTMLElement[];
            expect(rule.getAttribute('aria-orientation')).toBe('vertical');
            expect(rule.textContent).toBe('or');
            expect(items[1].style.flex).toMatch(/^none|^0 0/);
            expect(items[2].style.width).toBe('24px');
            expect(items[3].style.flex).toMatch(/^1/);
        });

        it('shrinks the slot of a collapsed panel to its header', () => {
            const {container} = show('col', {
                    col: {component: 'box', config: {}, children: [{id: 'a'}, {id: 'b'}]},
                    a: {
                        component: 'panel',
                        config: {title: 'A', collapsible: true, collapsed: true}
                    },
                    b: emptyPanel('B')
                }),
                items = [...container.querySelector('.xh-blueprint-box').children] as HTMLElement[];
            expect(items[0].style.flex).toMatch(/^none|^0 0/);
            expect(items[1].style.flex).toMatch(/^1/);
        });

        it('draws a separator in a column across it, as a horizontal rule', () => {
            const {container} = show('col', {
                col: {component: 'box', config: {}, children: [{id: 'rule'}]},
                rule: {component: 'separator', config: {}}
            });
            expect(
                container.querySelector('[role="separator"]').getAttribute('aria-orientation')
            ).toBe('horizontal');
        });
    });

    describe('panel', () => {
        it('draws a titled panel over its children', () => {
            show('page', {
                page: {component: 'panel', config: {title: 'Risk'}, children: [{id: 'a'}]},
                a: emptyPanel('Inside')
            });
            expect(screen.getByText('Risk')).toBeTruthy();
            expect(screen.getByText('Inside')).toBeTruthy();
        });

        it("draws Hoist's card in place of its chrome, with its card style", () => {
            const {container} = show('page', {
                page: {
                    component: 'panel',
                    config: {title: 'Group', style: 'card'},
                    children: [{id: 'a'}]
                },
                a: emptyPanel('Inside')
            });
            const card = container.querySelector('.xh-card');
            expect(card).toBeTruthy();
            expect(card.textContent).toContain('Group');
            expect(card.textContent).toContain('Inside');
        });

        it('collapses as its config says, and keeps a collapse by the user transient', async () => {
            const {model} = show('page', {
                page: {
                    component: 'panel',
                    config: {title: 'Risk', collapsible: true, collapsed: true},
                    children: [{id: 'a'}]
                },
                a: emptyPanel('Inside')
            });
            expect(screen.queryByText('Inside')).toBeNull();
            model.setTransientValue('/elements/page/config/collapsed', false);
            expect(await screen.findByText('Inside')).toBeTruthy();

            const page = new PanelWidgetModel({
                blueprintModel: model,
                id: 'page',
                renderElement: () => null
            });
            onTestFinished(() => page.destroy());
            page.panelModel.setCollapsed(true);
            expect(model.effective.elements.page.config.collapsed).toBe(true);
            page.panelModel.setCollapsed(false);
            expect(model.effective.elements.page.config.collapsed).toBe(false);
            expect(model.blueprint.elements.page.config.collapsed).toBe(true);
        });
    });

    describe('tileFrame', () => {
        it('draws a Hoist TileFrame', () => {
            const {container} = show('tiles', {
                tiles: {
                    component: 'tileFrame',
                    config: {minTileWidth: 100},
                    children: [{id: 'a'}, {id: 'b'}]
                },
                a: {component: 'markdown', config: {text: 'One'}},
                b: {component: 'markdown', config: {text: 'Two'}}
            });
            // TileFrame draws its tiles once it has a size, which jsdom never gives it.
            expect(container.querySelector('.xh-tile-frame')).toBeTruthy();
        });

        it('refuses a layout widget or a container as a tile', () => {
            expect(() =>
                show('tiles', {
                    tiles: {component: 'tileFrame', config: {}, children: [{id: 'inner'}]},
                    inner: emptyPanel('Inner')
                })
            ).toThrow(/tileFrame cannot hold 'inner'/);
        });
    });

    describe('dashContainer', () => {
        const container = (layout?: object[]) => ({
                tabs: {
                    component: 'dashContainer',
                    config: layout ? {layout} : {},
                    children: [{id: 'a', title: 'First'}, {id: 'b'}]
                },
                a: emptyPanel('A'),
                b: {component: 'panel', config: {title: 'Second', emptyText: 'B'}}
            }),
            open = (elements: Record<string, BlueprintElement>) => {
                const model = new BlueprintModel({
                    blueprint: {schema: {blueprint: 1}, root: 'tabs', elements},
                    catalog: portfolioCatalog,
                    registry: scenarioRegistry(),
                    dataProvider: null,
                    mode: 'run'
                });
                onTestFinished(() => model.destroy());
                const ret = new DashContainerWidgetModel({
                    blueprintModel: model,
                    id: 'tabs',
                    renderElement: () => null
                });
                onTestFinished(() => ret.destroy());
                return {model, widget: ret};
            };

        it('offers a view per child, titled by its reference or its title', () => {
            const {widget} = open(container());
            expect(widget.containerModel.viewSpecs.map(it => [it.id, it.title])).toEqual([
                ['a', 'First'],
                ['b', 'Second']
            ]);
        });

        it('lays its children out as its layout says, or as tabs of one stack', () => {
            const layout = [
                {
                    type: 'row',
                    content: [
                        {type: 'view', id: 'a'},
                        {type: 'view', id: 'b'}
                    ]
                }
            ];
            expect(open(container(layout)).widget.layout).toEqual(layout);
            expect(open(container()).widget.layout).toEqual([
                {
                    type: 'stack',
                    content: [
                        {type: 'view', id: 'a'},
                        {type: 'view', id: 'b'}
                    ]
                }
            ]);
        });

        it("keeps a user's rearrangement transient in run mode", () => {
            const {model, widget} = open(container()),
                next = [
                    {
                        type: 'column',
                        content: [
                            {type: 'view', id: 'b'},
                            {type: 'view', id: 'a'}
                        ]
                    }
                ];
            widget.noteLayout(next);
            expect(model.effective.elements.tabs.config.layout).toEqual(next);
            expect(model.blueprint.elements.tabs.config.layout).toBeUndefined();
        });

        it('keeps only the shape, sizes and views of a layout, never a title', () => {
            const {widget} = open(container());
            widget.noteLayout([
                {
                    type: 'stack',
                    title: '<img src=x>',
                    content: [{type: 'view', id: 'a', title: '<img src=x>', width: 50}]
                }
            ]);
            expect(widget.layout).toEqual([
                {type: 'stack', content: [{type: 'view', id: 'a', width: 50}]}
            ]);
        });

        it('gives GoldenLayout titles that hold no markup, as it sets them as HTML', () => {
            const elements = container();
            (elements.tabs.children as PlainObject[])[0].title = '<img src=x onerror=alert(1)>';
            elements.b.config.title = 'P&L <b>bold</b>';
            const titles = open(elements).widget.containerModel.viewSpecs.map(it => it.title);
            expect(titles.every(it => !/[<>]/.test(it))).toBe(true);
            expect(titles[1]).toContain('P&L');
        });

        it('refuses a layout item with a key GoldenLayout state may hold but a blueprint may not', () => {
            const issues = validateBlueprint(
                {
                    schema: {blueprint: 1},
                    root: 'tabs',
                    elements: container([
                        {type: 'stack', content: [{type: 'view', id: 'a', title: 'x'}]}
                    ])
                },
                {catalog: portfolioCatalog, registry: scenarioRegistry()}
            );
            expect(issues.map(it => it.path)).toContain(
                '/elements/tabs/config/layout/0/content/0/title'
            );
        });

        it('refuses a layout view that names no child', () => {
            const issues = validateBlueprint(
                {
                    schema: {blueprint: 1},
                    root: 'tabs',
                    elements: container([{type: 'stack', content: [{type: 'view', id: 'nope'}]}])
                },
                {catalog: portfolioCatalog, registry: scenarioRegistry()}
            );
            expect(issues.map(it => it.code)).toContain('dashContainer.unknownView');
        });
    });

    describe('titles with variables', () => {
        const FUND = {type: 'string', setBy: 'prompt', default: {value: 'Oak Mount'}} as const;

        it('fills tab, canvas cell and panel titles from variables, and follows them', async () => {
            const model = new BlueprintModel({
                blueprint: {
                    schema: {blueprint: 1},
                    variables: {fund: FUND},
                    root: 'tabs',
                    elements: {
                        tabs: {
                            component: 'tabContainer',
                            children: [{id: 'canvas', title: 'Funds: {fund}'}]
                        },
                        canvas: {
                            component: 'dashCanvas',
                            children: [
                                {id: 'tiles', x: 0, y: 0, w: 6, h: 4},
                                {id: 'pnl', x: 6, y: 0, w: 6, h: 4}
                            ]
                        },
                        tiles: {component: 'tileFrame', config: {title: 'Tiles for {fund}'}},
                        pnl: {component: 'panel', config: {title: 'P&L for {fund}', emptyText: 'x'}}
                    }
                },
                catalog: portfolioCatalog,
                registry: scenarioRegistry(),
                dataProvider: null,
                mode: 'run'
            });
            const of = <T>(Cls: new (c: any) => T, id: string): T => {
                const ret = new Cls({blueprintModel: model, id, renderElement: () => null});
                onTestFinished(() => (ret as any).destroy());
                return ret;
            };
            onTestFinished(() => model.destroy());
            render(blueprintView({model}));
            const canvas = of(DashCanvasWidgetModel, 'canvas'),
                panel = of(PanelWidgetModel, 'pnl');
            expect(await screen.findByText('Funds: Oak Mount')).toBeTruthy();
            expect(canvas.titles.tiles).toBe('Tiles for Oak Mount');
            expect(panel.resolvedConfig.title).toBe('P&L for Oak Mount');

            model.setVariable('fund', 'Elm Street');
            expect(await screen.findByText('Funds: Elm Street')).toBeTruthy();
            expect(canvas.titles.tiles).toBe('Tiles for Elm Street');
            expect(panel.resolvedConfig.title).toBe('P&L for Elm Street');
        });

        it("fills a dashContainer's view titles, from its references and its children", () => {
            const model = new BlueprintModel({
                    blueprint: {
                        schema: {blueprint: 1},
                        variables: {fund: FUND},
                        root: 'views',
                        elements: {
                            views: {
                                component: 'dashContainer',
                                children: [{id: 'a', title: 'A <b>{fund}</b>'}, {id: 'b'}]
                            },
                            a: emptyPanel('A'),
                            b: {component: 'panel', config: {title: 'B {fund}', emptyText: 'B'}}
                        }
                    },
                    catalog: portfolioCatalog,
                    registry: scenarioRegistry(),
                    dataProvider: null,
                    mode: 'run'
                }),
                widget = new DashContainerWidgetModel({
                    blueprintModel: model,
                    id: 'views',
                    renderElement: () => null
                });
            onTestFinished(() => {
                widget.destroy();
                model.destroy();
            });
            expect(widget.containerModel.viewSpecs.map(it => it.title)).toEqual([
                'A ‹b›Oak Mount‹/b›',
                'B Oak Mount'
            ]);
        });
    });

    it("leaves a panel's title to the panel, so a canvas cell does not repeat it", () => {
        const {model} = show('canvas', {
                canvas: {
                    component: 'dashCanvas',
                    children: [{id: 'pnl', x: 0, y: 0, w: 6, h: 4}]
                },
                pnl: {component: 'panel', config: {title: 'Positions', emptyText: 'x'}}
            }),
            canvas = new DashCanvasWidgetModel({
                blueprintModel: model,
                id: 'canvas',
                renderElement: () => null
            });
        onTestFinished(() => canvas.destroy());
        expect(canvas.titles.pnl).toBeNull();
    });

    describe('emptyText', () => {
        it('shows in a container with no children', () => {
            show('page', {
                page: {
                    component: 'panel',
                    config: {title: 'Page', emptyText: 'Nothing yet'},
                    children: []
                }
            });
            expect(screen.getByText('Nothing yet')).toBeTruthy();
        });

        it('shows in empty tabs and an empty canvas', () => {
            show('tabs', {
                tabs: {component: 'tabContainer', config: {emptyText: 'No tabs'}, children: []}
            });
            show('canvas', {
                canvas: {component: 'dashCanvas', config: {emptyText: 'No widgets'}, children: []}
            });
            expect(screen.getByText('No tabs')).toBeTruthy();
            expect(screen.getByText('No widgets')).toBeTruthy();
        });
    });
});
