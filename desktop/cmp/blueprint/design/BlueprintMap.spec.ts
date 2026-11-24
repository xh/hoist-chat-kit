import {act, fireEvent, render} from '@testing-library/react';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {initTestAppAsync} from '@xh/hoist/test-support';
import type {ReactElement} from 'react';
import {beforeAll, beforeEach, describe, expect, it, onTestFinished, vi} from 'vitest';
import {
    BlueprintDesignModel,
    BlueprintModel,
    FakeBlueprintDataProvider
} from '../../../../blueprint';
import {
    loadBlueprint,
    portfolioCatalog,
    scenarioRegistry
} from '../../../../test/blueprintFixtures';
import {blueprintMap, BlueprintMapModel} from './BlueprintMap';

/**
 * The Map: every variable, source, preset group and element in lanes, with the wires between
 * them. It shares the design model's selection, and traces what feeds and what is fed by it.
 */
describe('BlueprintMap', () => {
    beforeAll(async () => {
        await initTestAppAsync();
    });

    function open() {
        const model = new BlueprintModel({
                blueprint: loadBlueprint('p3-morning-report.json'),
                catalog: portfolioCatalog,
                registry: scenarioRegistry(),
                dataProvider: new FakeBlueprintDataProvider({catalog: portfolioCatalog}),
                mode: 'design',
                access: 'write'
            }),
            design = new BlueprintDesignModel({blueprintModel: model}),
            map = new BlueprintMapModel(design);
        onTestFinished(() => {
            map.destroy();
            design.destroy();
            model.destroy();
        });
        return {model, design, map};
    }

    const groupsOf = (map: BlueprintMapModel, lane: string) =>
        Object.fromEntries(
            map.lanes
                .find(it => it.title === lane)
                .groups.map(g => [g.title, g.nodes.map(n => n.id)])
        );

    it('lays out variables by what sets them, sources, presets, and elements by tab', () => {
        const {map} = open();
        expect(map.lanes.map(it => it.title)).toEqual(['Variables', 'Sources', 'Elements']);
        expect(groupsOf(map, 'Variables')).toEqual({
            Prompts: ['fund', 'asOf'],
            Computed: ['priceStart', 'yearStart'],
            'Set by widgets': ['grouping', 'selection', 'symbol'],
            'Set by actions': ['pnlFilter']
        });
        expect(groupsOf(map, 'Sources')).toEqual({
            '': ['positions', 'orders', 'prices'],
            Presets: ['posViews']
        });
        const elements = groupsOf(map, 'Elements');
        expect(Object.values(elements).flat()).toEqual([
            'fundInput',
            'asOfInput',
            'reportActions',
            'headline',
            'sectorChart',
            'regionChart',
            'posViewsSelector',
            'groupChooser',
            'pnlButtons',
            'posGrid',
            'priceChart',
            'ordersGrid'
        ]);
        // The root panel's inputs lead, in no tab.
        expect(Object.keys(elements)).toEqual([
            '',
            'Overview tab · overview',
            'Positions tab · positions',
            'Orders tab · orders'
        ]);
    });

    it('sums up each node: a variable by its value or writer, a source by its parameters', () => {
        const {map} = open(),
            node = (key: string) =>
                map.lanes.flatMap(it => it.groups.flatMap(g => g.nodes)).find(it => it.key === key);
        expect(node('variable:yearStart').detail).toBe('yearStart(asOf)');
        expect(node('variable:priceStart').detail).toBe('dateOffset(asOf, months -3)');
        expect(node('variable:grouping').detail).toBe('← groupChooser');
        expect(node('variable:symbol').detail).toBe('← posGrid selected');
        expect(node('variable:pnlFilter').detail).toBe('← pnlButtons');
        expect(node('source:positions').detail).toBe('dataset positions');
        expect(node('source:positions').ports).toEqual([
            'asOf',
            'fund',
            'retYtd.start',
            'retYtd.end'
        ]);
        expect(node('preset:posViews')).toMatchObject({
            detail: 'Columns',
            line: 'P&L view · Risk view'
        });
        expect(node('element:headline').detail).toBe('Tiles · 4 stat cards');
        expect(node('element:posGrid').detail).toBe('Grid');
        // A variable's wire to a source lands on the parameter it binds.
        const ports = map.edges
            .filter(it => it.from === 'variable:asOf' && it.to === 'source:positions')
            .map(it => it.toPort);
        expect(ports).toEqual(['asOf', 'retYtd.end']);
    });

    it('draws a container that reads, such as tabs titled from a variable', () => {
        const {design, map} = open();
        expect(
            map.lanes
                .at(-1)
                .groups.flatMap(g => g.nodes)
                .map(it => it.id)
        ).not.toContain('tabs');
        design.setChildTitle('positions', '{fund} book');
        expect(
            map.lanes
                .at(-1)
                .groups.flatMap(g => g.nodes)
                .map(it => it.id)
        ).toContain('tabs');
        expect(map.edges.some(it => it.from === 'variable:fund' && it.to === 'element:tabs')).toBe(
            true
        );
    });

    it('collapses a tile frame, wiring what its tiles read to it', () => {
        const {map} = open();
        expect(map.lanes.at(-1).groups[0].nodes.map(it => it.id)).not.toContain('headlineMktVal');
        expect(
            map.edges.some(it => it.from === 'source:positions' && it.to === 'element:headline')
        ).toBe(true);
        expect(map.edges.some(it => it.to === 'element:headlineMktVal')).toBe(false);
    });

    it('traces the selection: upstream, downstream and presets, dimming the rest', () => {
        const {design, map} = open();
        expect(map.stateOf('element:posGrid')).toBeNull();
        design.select({kind: 'element', id: 'posGrid'});
        const keys = (state: string) =>
            map.lanes
                .flatMap(it => it.groups.flatMap(g => g.nodes))
                .filter(it => map.stateOf(it.key) === state)
                .map(it => it.id)
                .sort();
        expect(map.stateOf('element:posGrid')).toBe('focus');
        expect(keys('upstream')).toEqual(
            ['asOf', 'fund', 'grouping', 'pnlFilter', 'positions', 'yearStart'].sort()
        );
        expect(keys('preset')).toEqual(['posViews']);
        expect(keys('downstream')).toEqual(
            ['ordersGrid', 'priceChart', 'prices', 'selection', 'symbol'].sort()
        );
        expect(map.stateOf('element:regionChart')).toBe('dim');

        // A hover previews its own trace over the selection's.
        map.setHoverKey('variable:symbol');
        expect(map.stateOf('variable:symbol')).toBe('focus');
        expect(map.stateOf('element:posGrid')).toBe('dim');
    });

    it('selects on a click and opens an element on a double-click', () => {
        const {model, design} = open(),
            onOpenElement = vi.fn(),
            {container} = render(
                blueprintMap({designModel: design, onOpenElement}) as ReactElement
            ),
            node = (key: string) => container.querySelector(`[data-map-node="${key}"]`);
        fireEvent.click(node('source:prices'));
        expect(design.selection).toEqual({kind: 'source', id: 'prices'});
        fireEvent.doubleClick(node('element:priceChart'));
        expect(design.selectedElementId).toBe('priceChart');
        expect(onOpenElement).toHaveBeenCalledWith('priceChart');
        expect(container.querySelector('svg.xh-blueprint-map__edges')).toBeTruthy();
        expect(model.history).toHaveLength(0);
    });

    it('reads as lanes of options, which the arrows move through and Enter selects', async () => {
        const {design} = open(),
            {container} = render(blueprintMap({designModel: design}) as ReactElement),
            lanes = container.querySelectorAll('[role=listbox]'),
            options = (lane: Element) =>
                [...lane.querySelectorAll('[role=option]')] as HTMLElement[];
        expect(lanes).toHaveLength(3);
        expect(lanes[0].getAttribute('aria-label')).toBe('Variables');
        expect(lanes[0].querySelector('[role=group]').getAttribute('aria-label')).toBe('Prompts');
        expect(container.querySelectorAll('[role=option][tabindex="0"]')).toHaveLength(1);
        expect(container.querySelector('svg').getAttribute('aria-hidden')).toBe('true');

        const [fund, asOf] = options(lanes[0]);
        fund.focus();
        fireEvent.keyDown(fund, {key: 'ArrowDown'});
        expect(document.activeElement).toBe(asOf);
        // Focus previews its trace, as hover does.
        await vi.waitFor(() => expect(asOf.className).toContain('xh-blueprint-map__node--focus'));
        fireEvent.keyDown(asOf, {key: 'ArrowRight'});
        expect(document.activeElement).toBe(options(lanes[1])[0]);
        fireEvent.keyDown(document.activeElement, {key: 'Enter'});
        expect(design.selection).toEqual({kind: 'source', id: 'positions'});
        await vi.waitFor(() =>
            expect(options(lanes[1])[0].getAttribute('aria-selected')).toBe('true')
        );
        expect(asOf.getAttribute('aria-label')).toMatch(/^asOf, .*feeds the selection/);
    });

    describe('legend', () => {
        beforeEach(() => window.localStorage.clear());

        const show = (design: BlueprintDesignModel, showLegend?: boolean) =>
            render(blueprintMap({designModel: design, showLegend}) as ReactElement).container;

        it('floats over the map in a corner, not scrolling with it, unless the host hides it', () => {
            const {design} = open(),
                container = show(design),
                legend = container.querySelector('.xh-blueprint-map__legend'),
                scroll = container.querySelector('.xh-blueprint-map__scroll');
            expect(legend).not.toBeNull();
            expect(scroll.contains(legend)).toBe(false);
            expect(legend.querySelectorAll('.xh-blueprint-map__legend-item')).toHaveLength(4);
            expect(show(design, false).querySelector('.xh-blueprint-map__legend')).toBeNull();
        });

        it('folds to its header, and stays folded for the user next time', async () => {
            const {design} = open(),
                container = show(design),
                header = () =>
                    container.querySelector<HTMLElement>('.xh-blueprint-map__legend-header'),
                items = (c: Element) => c.querySelectorAll('.xh-blueprint-map__legend-item');
            expect(header().textContent).toBe('Legend');
            expect(header().getAttribute('aria-expanded')).toBe('true');
            act(() => {
                fireEvent.click(header());
            });
            expect(items(container)).toHaveLength(0);
            expect(header().getAttribute('aria-expanded')).toBe('false');
            // A map opened again remembers, once the choice is written.
            await act(() => new Promise(resolve => setTimeout(resolve, 300)));
            expect(items(show(open().design))).toHaveLength(0);
            act(() => {
                fireEvent.click(header());
            });
            expect(items(container)).toHaveLength(4);
        });
    });

    it('scrolls the map itself on both axes, with nothing around it scrolling too', () => {
        const {design} = open(),
            {container} = render(blueprintMap({designModel: design}) as ReactElement),
            scroll = container.querySelector<HTMLElement>('.xh-blueprint-map__scroll');
        expect(scroll.style.overflow).toBe('auto');
        for (let el = scroll.parentElement; el && el !== container; el = el.parentElement) {
            expect(el.style.overflow).not.toBe('auto');
        }
    });

    describe('panning', () => {
        function setup() {
            const {design} = open(),
                {container} = render(blueprintMap({designModel: design}) as ReactElement),
                scroll = container.querySelector<HTMLElement>('.xh-blueprint-map__scroll'),
                background = container.querySelector<HTMLElement>('.xh-blueprint-map__content'),
                node = container.querySelector<HTMLElement>('.xh-blueprint-map__node'),
                at = {left: 100, top: 100};
            // jsdom keeps no scroll position.
            Object.defineProperties(scroll, {
                scrollLeft: {
                    get: () => at.left,
                    set: (v: number) => {
                        at.left = v;
                    },
                    configurable: true
                },
                scrollTop: {
                    get: () => at.top,
                    set: (v: number) => {
                        at.top = v;
                    },
                    configurable: true
                }
            });
            return {design, scroll, background, node, at};
        }

        function drag(target: Element, button: number, dx: number, dy: number) {
            const down = {button, buttons: 1 << [0, 2, 1][button], pointerId: 1},
                scroll = target.closest('.xh-blueprint-map__scroll');
            fireEvent.pointerDown(target, {...down, clientX: 200, clientY: 200});
            fireEvent.pointerMove(scroll, {...down, clientX: 200 + dx / 2, clientY: 200 + dy / 2});
            fireEvent.pointerMove(scroll, {...down, clientX: 200 + dx, clientY: 200 + dy});
            fireEvent.pointerUp(scroll, {...down, clientX: 200 + dx, clientY: 200 + dy});
        }

        it('pans by the drag on a right or middle drag anywhere, over a node too', () => {
            const {node, at} = setup();
            drag(node, 2, -50, -30);
            expect(at).toEqual({left: 150, top: 130});
            drag(node, 1, 20, 10);
            expect(at).toEqual({left: 130, top: 120});
        });

        it('pans on a left drag over the background, and never on a node', () => {
            const {background, node, at} = setup();
            drag(node, 0, -50, -30);
            expect(at).toEqual({left: 100, top: 100});
            drag(background, 0, -50, -30);
            expect(at).toEqual({left: 150, top: 130});
        });

        it('leaves a press that hardly moves to be a click', () => {
            const {design, node, scroll, at} = setup();
            drag(node, 2, 2, 1);
            drag(scroll.querySelector('.xh-blueprint-map__content'), 0, 2, 1);
            expect(at).toEqual({left: 100, top: 100});
            fireEvent.click(node);
            expect(design.selection).not.toBeNull();
        });

        it('swallows the click that ends a pan, and the context menu after a moved right drag', () => {
            const {background, scroll} = setup(),
                fire = (type: string) => {
                    const e = new MouseEvent(type, {bubbles: true, cancelable: true});
                    background.dispatchEvent(e);
                    return e.defaultPrevented;
                };
            drag(background, 0, 40, 0);
            expect(fire('click')).toBe(true);
            expect(fire('click')).toBe(false);
            drag(background, 2, 40, 0);
            expect(fire('contextmenu')).toBe(true);
            // A right-click that does not move keeps the browser's menu, where it comes on release.
            drag(background, 2, 0, 0);
            expect(fire('contextmenu')).toBe(false);
            expect(scroll.classList).not.toContain('xh-blueprint-map__scroll--panning');
        });
    });

    it('keeps a node the same size in every state, so a hover moves nothing', () => {
        const scss = readFileSync(path.join(import.meta.dirname, 'BlueprintMap.scss'), 'utf8'),
            node = blockAfter(scss, '&__node {'),
            states = [...node.matchAll(/^\s{4}&[^{]*\{/gm)].map(it => blockAfter(node, it[0])),
            sizing =
                /^\s*(border|border-width|padding[\w-]*|margin[\w-]*|font-size|font-weight|width|height)\s*:/m;
        expect(states.length).toBeGreaterThan(4);
        expect(states.filter(it => sizing.test(it))).toEqual([]);
    });
});

// The body of the first block that opens with `head`, to its matching brace.
function blockAfter(text: string, head: string): string {
    const start = text.indexOf(head) + head.length;
    let depth = 1,
        at = start;
    while (depth && at < text.length) {
        if (text[at] === '{') depth++;
        if (text[at] === '}') depth--;
        at++;
    }
    return text.slice(start, at - 1);
}
