import {fireEvent, render} from '@testing-library/react';
import {initTestAppAsync} from '@xh/hoist/test-support';
import type {ReactElement} from 'react';
import {beforeAll, describe, expect, it, onTestFinished, vi} from 'vitest';
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
        expect(Object.keys(elements)).toEqual([
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
});
