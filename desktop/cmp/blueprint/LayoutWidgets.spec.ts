import {act, render, screen} from '@testing-library/react';
import type {PlainObject} from '@xh/hoist/core';
import {initTestAppAsync} from '@xh/hoist/test-support';
import {cloneDeep} from 'lodash';
import type {ReactElement} from 'react';
import {beforeAll, describe, expect, it, onTestFinished, vi} from 'vitest';
import {portfolioCatalog, scenarioRegistry} from '../../../test/blueprintFixtures';
import {
    type Blueprint,
    type BlueprintElement,
    type ChildRef,
    BlueprintDesignModel,
    BlueprintModel,
    validateBlueprint
} from '../../../blueprint';
import {paletteDrag} from './impl/paletteDrag';
import {blueprintView} from './BlueprintView';
import {DashCanvasWidgetModel} from './DashCanvasWidget';
import {dashContainerWidget, DashContainerWidgetModel} from './DashContainerWidget';
import {BlueprintViewModel} from './impl/BlueprintViewModel';
import {MarkdownWidgetModel} from './MarkdownWidget';
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

        it('gives inputs, buttons and toolbars their own size along it, and a share to the rest', () => {
            const {container} = show('col', {
                    col: {
                        component: 'box',
                        config: {direction: 'column'},
                        children: [{id: 'buttons'}, {id: 'body'}, {id: 'stretched', flex: 2}]
                    },
                    buttons: {
                        component: 'buttonGroup',
                        config: {buttons: [{label: 'Refresh', action: {type: 'refresh'}}]}
                    },
                    body: emptyPanel('Body'),
                    stretched: {
                        component: 'buttonGroup',
                        config: {buttons: [{label: 'Go', action: {type: 'refresh'}}]}
                    }
                }),
                items = [
                    ...container.querySelectorAll('.xh-blueprint-box > .xh-blueprint-box__item')
                ] as HTMLElement[];
            expect(items.map(it => it.style.flex)).toEqual([
                expect.stringMatching(/^(none|0 0 auto)$/),
                expect.stringMatching(/^1/),
                expect.stringMatching(/^2/)
            ]);
        });

        it('gives text its own height in a column, a share across a row, and a share where flex says', () => {
            const text = (t: string) => ({component: 'markdown', config: {text: t}}),
                flexOf = (root: string, elements: Record<string, BlueprintElement>) =>
                    (
                        [
                            ...show(root, elements).container.querySelectorAll(
                                `.xh-blueprint-box > .xh-blueprint-box__item`
                            )
                        ] as HTMLElement[]
                    ).map(it => it.style.flex);
            expect(
                flexOf('col', {
                    col: {
                        component: 'box',
                        config: {direction: 'column'},
                        children: [{id: 'head'}, {id: 'note'}, {id: 'body'}, {id: 'long', flex: 1}]
                    },
                    head: text('A heading'),
                    note: {component: 'callout', config: {text: 'A caveat'}},
                    body: emptyPanel('Body'),
                    long: text('Scrolls in its share')
                })
            ).toEqual([
                expect.stringMatching(/^(none|0 0 auto)$/),
                expect.stringMatching(/^(none|0 0 auto)$/),
                expect.stringMatching(/^1/),
                expect.stringMatching(/^1/)
            ]);
            expect(
                flexOf('row', {
                    row: {
                        component: 'box',
                        config: {direction: 'row'},
                        children: [{id: 'a'}, {id: 'b'}]
                    },
                    a: text('Left'),
                    b: text('Right')
                })
            ).toEqual([expect.stringMatching(/^1/), expect.stringMatching(/^1/)]);
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

        it('draws its card style as a compact panel header in a bordered frame, never a card legend', () => {
            const {container} = show('page', {
                page: {
                    component: 'panel',
                    config: {title: 'Group', style: 'card'},
                    children: [{id: 'a'}]
                },
                a: emptyPanel('Inside')
            });
            expect(container.querySelector('.xh-card')).toBeNull();
            const frame = container.querySelector('.xh-blueprint-panel--card');
            expect(frame.querySelector('.xh-panel-header').textContent).toContain('Group');
            expect(frame.textContent).toContain('Inside');
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

        it('never collapses in a canvas cell, which has no header to expand it from', () => {
            const {model} = show('canvas', {
                    canvas: {
                        component: 'dashCanvas',
                        children: [{id: 'page', x: 0, y: 0, w: 6, h: 4}]
                    },
                    page: {
                        component: 'panel',
                        config: {title: 'Risk', collapsible: true, collapsed: true},
                        children: [{id: 'a'}]
                    },
                    a: emptyPanel('Inside')
                }),
                page = new PanelWidgetModel({
                    blueprintModel: model,
                    id: 'page',
                    renderElement: () => null
                });
            onTestFinished(() => page.destroy());
            expect(page.panelModel.collapsible).toBe(false);
            expect(page.panelModel.collapsed).toBe(false);
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

        const designing = (elements: Record<string, BlueprintElement>) => {
            const model = new BlueprintModel({
                    blueprint: {schema: {blueprint: 1}, root: 'tabs', elements},
                    catalog: portfolioCatalog,
                    registry: scenarioRegistry(),
                    dataProvider: null,
                    mode: 'design',
                    access: 'write'
                }),
                design = new BlueprintDesignModel({blueprintModel: model}),
                widget = new DashContainerWidgetModel({
                    blueprintModel: model,
                    id: 'tabs',
                    renderElement: () => null
                });
            onTestFinished(() => {
                widget.destroy();
                design.destroy();
                model.destroy();
            });
            return {model, design, widget};
        };

        it('adds a widget dragged from the palette where it drops, as one edit', () => {
            const {model, design, widget} = designing(container()),
                version = model.version;
            expect(widget.externalDrag()).toBeNull();
            paletteDrag.start({
                component: 'markdown',
                size: {w: 4, h: 2},
                add: (parent, opts) => design.addWidget('markdown', parent, opts)
            });
            onTestFinished(() => paletteDrag.end());
            expect(widget.externalDrag()).toBe('markdown');

            widget.onDropExternal('markdown', {view: 'b', zone: 'right'});
            const added = model.blueprint.elements.tabs.children.at(-1).id;
            expect(model.version).toBe(version + 1);
            expect(widget.layout).toEqual([
                {
                    type: 'row',
                    content: [
                        {
                            type: 'stack',
                            width: 50,
                            content: [
                                {type: 'view', id: 'a'},
                                {type: 'view', id: 'b'}
                            ]
                        },
                        {type: 'stack', width: 50, content: [{type: 'view', id: added}]}
                    ]
                }
            ]);
            expect(widget.layout.flatMap(stackIds)).toContain(added);
            expect(paletteDrag.current).toBeNull();
        });

        it('moves every view to every place without a pointer, refusing with a reason or leaving a valid blueprint', () => {
            const elements = {
                    tabs: {
                        component: 'dashContainer',
                        config: {
                            layout: [
                                {
                                    type: 'row',
                                    content: [
                                        {type: 'view', id: 'a'},
                                        {
                                            type: 'column',
                                            content: [
                                                {type: 'stack', content: [{type: 'view', id: 'b'}]},
                                                {type: 'view', id: 'c'}
                                            ]
                                        }
                                    ]
                                }
                            ]
                        },
                        children: [{id: 'a'}, {id: 'b'}, {id: 'c'}]
                    },
                    a: emptyPanel('A'),
                    b: emptyPanel('B'),
                    c: emptyPanel('C')
                },
                zones = ['center', 'left', 'right', 'top', 'bottom'] as const,
                roots = ['root-left', 'root-right', 'root-top', 'root-bottom'] as const;
            for (const id of ['a', 'b', 'c']) {
                for (const target of [
                    ...['a', 'b', 'c'].flatMap(view => [
                        ...zones.map(zone => ({view, zone})),
                        {view, zone: 'tab' as const, index: 0}
                    ]),
                    ...roots.map(zone => ({zone}))
                ]) {
                    const {model, widget} = designing(cloneDeep(elements)),
                        version = model.version,
                        refusal = widget.moveView(id, target);
                    if (refusal) {
                        expect(model.version, `${id} → ${JSON.stringify(target)}`).toBe(version);
                    } else {
                        expect(model.version, `${id} → ${JSON.stringify(target)}`).toBe(
                            version + 1
                        );
                        expect(
                            model.issues.filter(it => it.severity === 'error'),
                            `${id} → ${JSON.stringify(target)}`
                        ).toEqual([]);
                    }
                }
            }
        });

        it('shows a view moved into a stack, and names the move for undo', () => {
            const {model, widget} = designing(
                container([
                    {
                        type: 'row',
                        content: [
                            {type: 'stack', content: [{type: 'view', id: 'a'}]},
                            {type: 'stack', content: [{type: 'view', id: 'b'}]}
                        ]
                    }
                ])
            );
            expect(widget.moveView('b', {view: 'a', zone: 'center'})).toBeNull();
            expect(widget.shown).toEqual(['b']);
            expect(model.undoDescription).toBe('Move b');
        });

        it('says why a move would be refused, and allows a valid one', () => {
            const {widget} = designing(container());
            expect(widget.canMove('b', {view: 'a', zone: 'left'})).toBeNull();
        });

        it("resets a reader's rearrangement, and offers to only once there is one", () => {
            const {model, widget} = open(container());
            expect(widget.isRearranged).toBe(false);
            widget.noteLayout([
                {
                    type: 'column',
                    content: [
                        {type: 'view', id: 'b'},
                        {type: 'view', id: 'a'}
                    ]
                }
            ]);
            expect(widget.isRearranged).toBe(true);
            widget.resetLayout();
            expect(widget.isRearranged).toBe(false);
            expect(model.effective.elements.tabs.config.layout).toBeUndefined();
        });

        it('offers a view per child, titled by its reference or its title', () => {
            const {widget} = open(container());
            expect(widget.titles).toEqual({a: 'First', b: 'Second'});
        });

        it('adds a child its layout leaves out to its first stack', () => {
            const {widget} = open(
                container([
                    {type: 'row', content: [{type: 'stack', content: [{type: 'view', id: 'a'}]}]}
                ])
            );
            expect(widget.layout).toEqual([
                {
                    type: 'row',
                    content: [
                        {
                            type: 'stack',
                            content: [
                                {type: 'view', id: 'a'},
                                {type: 'view', id: 'b'}
                            ]
                        }
                    ]
                }
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
                {
                    type: 'stack',
                    content: [
                        {type: 'view', id: 'a', width: 50},
                        {type: 'view', id: 'b'}
                    ]
                }
            ]);
        });

        it('shows tab titles as text, never as markup', () => {
            const elements = container();
            (elements.tabs.children as PlainObject[])[0].title = '<img src=x onerror=alert(1)>';
            const {widget} = open(elements),
                {container: el} = render(dashContainerWidget({model: widget}) as ReactElement);
            expect(el.querySelector('img')).toBeNull();
            expect(el.querySelector('[role=tab]').textContent).toBe('<img src=x onerror=alert(1)>');
        });

        it('reports the views no tab shows, and shows one asked for', async () => {
            const {widget} = open(container());
            render(dashContainerWidget({model: widget}) as ReactElement);
            expect(widget.hiddenViews).toEqual(['b']);
            await act(async () => widget.activateView('b'));
            expect(widget.hiddenViews).toEqual(['a']);
        });

        it('refuses a layout item with a key a blueprint layout does not take, such as a title', () => {
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
            expect(Object.values(widget.titles)).toEqual(['A <b>Oak Mount</b>', 'B Oak Mount']);
        });
    });

    describe('canvas cells', () => {
        const cells = (mode: 'run' | 'design' = 'run') => {
            const model = new BlueprintModel({
                    blueprint: {
                        root: 'canvas',
                        elements: {
                            canvas: {
                                component: 'dashCanvas',
                                children: [
                                    {id: 'pnl', x: 0, y: 0, w: 6, h: 4},
                                    {id: 'tiles', x: 6, y: 0, w: 6, h: 2},
                                    {id: 'grid', x: 0, y: 4, w: 1, h: 4}
                                ]
                            },
                            pnl: {
                                component: 'panel',
                                config: {title: 'Positions', icon: 'chart-line', style: 'card'},
                                children: [{id: 'body'}],
                                headerItems: [{id: 'pick'}]
                            },
                            body: emptyPanel('Inside'),
                            pick: {component: 'switchInput'},
                            tiles: {component: 'tileFrame'},
                            grid: {component: 'cubeGrid', config: {source: 'positions'}}
                        },
                        sources: {positions: {dataset: 'positions', params: {asOf: '2026-11-20'}}}
                    },
                    catalog: portfolioCatalog,
                    registry: scenarioRegistry(),
                    dataProvider: null,
                    mode,
                    access: 'write',
                    isAnswer: true
                }),
                view = new BlueprintViewModel(model);
            onTestFinished(() => {
                view.destroy();
                model.destroy();
            });
            const canvas = view.getWidgetModel('canvas') as DashCanvasWidgetModel;
            return {model, view, canvas};
        };

        it("hands a panel's title, icon and header items to its cell, and draws it frameless there", () => {
            const {view, canvas} = cells();
            expect(canvas.titles.pnl).toBe('Positions');
            expect(canvas.cellHasHeader('pnl')).toBe(true);
            expect(canvas.headerItemsFor('pnl')).toHaveLength(1);
            const {container} = render(view.renderElement('pnl') as ReactElement);
            expect(container.querySelector('.xh-card')).toBeNull();
            expect(container.querySelector('.xh-blueprint-panel--card')).toBeNull();
            expect(container.querySelector('.xh-panel-header')).toBeNull();
            expect(container.textContent).toContain('Inside');
        });

        it('draws a cell header with the icon, title and items, marked as the view header', () => {
            const {view} = cells(),
                {container} = renderCanvas(view);
            const frame = container.querySelector('[data-blueprint-view="pnl"]');
            expect(frame.getAttribute('data-blueprint-canvas')).toBe('canvas');
            const header = frame.querySelector('[data-blueprint-view-header]');
            expect(header.querySelector('.xh-blueprint-dash-canvas__cell-title').textContent).toBe(
                'Positions'
            );
            expect(header.querySelector('svg')).toBeTruthy();
        });

        it('hides the header of a cell with no title and no header items', () => {
            const {canvas, view} = cells();
            expect(canvas.cellHasHeader('tiles')).toBe(false);
            const {container} = renderCanvas(view);
            expect(
                container.querySelector(
                    '[data-blueprint-view="tiles"] [data-blueprint-view-header]'
                )
            ).toBeNull();
        });

        it('shows the column grid and element ids in design mode only', () => {
            const run = cells('run');
            expect(
                renderCanvas(run.view).container.querySelector('.xh-layout-grid__background')
            ).toBeNull();
            expect(run.canvas.headerItemsFor('pnl')).toHaveLength(1);
            const design = cells('design');
            expect(
                renderCanvas(design.view).container.querySelector('.xh-layout-grid__background')
            ).toBeTruthy();
            const [idItem] = design.canvas.headerItemsFor('pnl') as any[];
            expect(idItem.props.className).toBe('xh-blueprint-dash-canvas__cell-id');
            // A cell with no header stays without one, id or not.
            expect(design.canvas.cellHasHeader('tiles')).toBe(false);
        });

        function renderCanvas(view: BlueprintViewModel) {
            // jsdom has no layout: the canvas waits for a measured width before it draws cells.
            const spy = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1200);
            onTestFinished(() => spy.mockRestore());
            return render(view.renderElement('canvas') as ReactElement);
        }
    });

    describe('clipped text', () => {
        const textCell = (mode: 'run' | 'design', below: ChildRef[] = []) => {
            const model = new BlueprintModel({
                    blueprint: {
                        root: 'canvas',
                        elements: {
                            canvas: {
                                component: 'dashCanvas',
                                children: [{id: 'note', x: 0, y: 0, w: 6, h: 1}, ...below]
                            },
                            note: {component: 'markdown', config: {text: 'A long note'}},
                            ...(below.length ? {grid: emptyPanel('Grid')} : {})
                        }
                    },
                    catalog: portfolioCatalog,
                    registry: scenarioRegistry(),
                    dataProvider: null,
                    mode,
                    access: 'write'
                }),
                note = new MarkdownWidgetModel({
                    blueprintModel: model,
                    id: 'note',
                    renderElement: () => null
                });
            onTestFinished(() => {
                note.destroy();
                model.destroy();
            });
            return {model, note};
        };

        it('offers to grow a clipped text cell in design mode, by its overflow, in one edit', () => {
            const {model, note} = textCell('design');
            expect(note.canGrow).toBe(false);
            note.setOverflow(70);
            expect(note.canGrow).toBe(true);
            const before = model.history.length;
            note.makeTaller();
            // 70px past a 50px row and an 8px gap takes two more rows.
            expect(model.blueprint.elements.canvas.children[0].h).toBe(3);
            expect(model.history.length).toBe(before + 1);
        });

        it('moves the cells below down as it grows, in the same edit', () => {
            const {model, note} = textCell('design', [{id: 'grid', x: 3, y: 1, w: 6, h: 2}]);
            note.setOverflow(70);
            note.makeTaller();
            const [noteCell, gridCell] = model.blueprint.elements.canvas.children;
            expect(noteCell.h).toBe(3);
            expect(gridCell.y).toBe(3);
            expect(model.issues.filter(it => it.severity === 'error')).toEqual([]);
            model.undo();
            expect(model.blueprint.elements.canvas.children[1].y).toBe(1);
        });

        it('never offers to grow in run mode', () => {
            const {note} = textCell('run');
            note.setOverflow(70);
            expect(note.canGrow).toBe(false);
        });
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
            const {container} = show('canvas', {
                canvas: {component: 'dashCanvas', config: {emptyText: 'No widgets'}, children: []}
            });
            expect(screen.getByText('No tabs')).toBeTruthy();
            expect(screen.getByText('No widgets')).toBeTruthy();
            // The hint lies over a live canvas, which still takes a drop.
            expect(container.querySelector('.xh-layout-grid')).toBeTruthy();
        });
    });
});

function stackIds(item: PlainObject): string[] {
    return item.type === 'view' ? [item.id] : (item.content ?? []).flatMap(stackIds);
}
