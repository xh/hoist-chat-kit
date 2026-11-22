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
        expect(map.lanes.map(it => it.title)).toEqual([
            'Variables',
            'Sources',
            'Presets',
            'Elements'
        ]);
        expect(groupsOf(map, 'Variables')).toEqual({
            Prompts: ['fund', 'asOf'],
            Computed: ['priceStart', 'yearStart'],
            'Set by widgets': ['grouping', 'selection', 'symbol'],
            'Set by actions': ['pnlFilter']
        });
        expect(groupsOf(map, 'Sources')).toEqual({'': ['positions', 'orders', 'prices']});
        expect(groupsOf(map, 'Presets')).toEqual({'': ['posViews']});
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
        expect(Object.keys(elements)).toHaveLength(3);
    });

    it('collapses a tile frame, wiring what its tiles read to it', () => {
        const {map} = open(),
            headline = map.lanes.at(-1).groups[0].nodes.find(it => it.id === 'headline');
        expect(headline.detail).toBe('4 tiles');
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
