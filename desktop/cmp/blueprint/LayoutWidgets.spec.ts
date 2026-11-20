import {render, screen} from '@testing-library/react';
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
