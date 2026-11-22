import {describe, expect, it} from 'vitest';
import {loadBlueprint} from '../../test/blueprintFixtures';
import {traceWiring, wiringFor, wiringGraph, type WiringRef} from './wiring';

/**
 * What reads and sets what in a blueprint, from its declarations alone: the wiring card of each
 * selection, and the graph the Map draws.
 */
describe('wiring', () => {
    const p3 = loadBlueprint('p3-morning-report.json'),
        ids = (refs: WiringRef[]) => refs.map(it => it.id).sort(),
        labels = (refs: WiringRef[]) => refs.map(it => it.label ?? it.id).sort();

    it("gives an element's sources and variables read, variables set and controlling presets", () => {
        const posGrid = wiringFor(p3, {kind: 'element', id: 'posGrid'});
        expect(ids(posGrid.reads)).toEqual(['grouping', 'pnlFilter', 'positions']);
        expect(ids(posGrid.sets)).toEqual(['selection', 'symbol']);
        expect(ids(posGrid.presets)).toEqual(['posViews']);
        expect(ids(wiringFor(p3, {kind: 'element', id: 'pnlButtons'}).sets)).toEqual(['pnlFilter']);
        expect(ids(wiringFor(p3, {kind: 'element', id: 'reportActions'}).reads)).toEqual([
            'asOf',
            'fund'
        ]);
    });

    it("gives a variable's writers and readers, a source by its parameter", () => {
        const asOf = wiringFor(p3, {kind: 'variable', id: 'asOf'});
        expect(asOf.setBy).toEqual([{kind: 'prompt', id: 'asOf'}]);
        expect(labels(asOf.readBy)).toEqual(
            ['orders', 'positions', 'prices.end', 'priceStart', 'reportActions', 'yearStart'].sort()
        );
        expect(ids(wiringFor(p3, {kind: 'variable', id: 'grouping'}).setBy)).toEqual([
            'groupChooser'
        ]);
        const yearStart = wiringFor(p3, {kind: 'variable', id: 'yearStart'});
        expect(yearStart.setBy).toEqual([{kind: 'resolver', id: 'yearStart'}]);
        expect(ids(yearStart.reads)).toEqual(['asOf']);
        expect(ids(wiringFor(p3, {kind: 'variable', id: 'pnlFilter'}).setBy)).toEqual([
            'pnlButtons'
        ]);
    });

    it("gives a source's parameters, readers, and what it waits for", () => {
        const prices = wiringFor(p3, {kind: 'source', id: 'prices'});
        expect(ids(prices.reads)).toEqual(['asOf', 'priceStart', 'symbol']);
        expect(ids(prices.readBy)).toEqual(['priceChart']);
        expect(ids(prices.waitsFor)).toEqual(['symbol']);
        expect(wiringFor(p3, {kind: 'source', id: 'positions'}).waitsFor).toEqual([]);
        const joined = loadBlueprint('p8-joined-positions.json');
        expect(ids(wiringFor(joined, {kind: 'source', id: 'funds'}).readBy)).toEqual(['positions']);
    });

    it("gives a preset group's controlled paths and its selectors", () => {
        const posViews = wiringFor(p3, {kind: 'preset', id: 'posViews'});
        expect(posViews.presets).toEqual([
            {kind: 'element', id: 'posGrid', path: '/config/columnState'}
        ]);
        expect(ids(posViews.readBy)).toEqual(['posViewsSelector']);
    });

    it('traces what feeds a selection and what it feeds, through the whole graph', () => {
        const graph = wiringGraph(p3),
            {upstream, downstream} = traceWiring(graph, {kind: 'element', id: 'posGrid'}),
            names = (it: {id: string}[]) => it.map(n => n.id).sort();
        expect(graph.nodes).toHaveLength(18 + 3 + 8 + 1);
        expect(names(upstream)).toEqual(
            ['asOf', 'fund', 'grouping', 'pnlFilter', 'posViews', 'positions', 'yearStart'].sort()
        );
        expect(names(downstream)).toEqual(
            ['ordersGrid', 'priceChart', 'prices', 'selection', 'symbol'].sort()
        );
    });
});
