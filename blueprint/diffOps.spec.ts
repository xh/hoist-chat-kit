import {describe, expect, it} from 'vitest';
import {loadBlueprint, scenarioFiles} from '../test/blueprintFixtures';
import type {Blueprint} from './Blueprint';
import {applyOps} from './applyOps';
import {diffOps} from './diffOps';

/**
 * The edit that turns one blueprint into another, so that a whole new blueprint, as from a JSON
 * editor, applies as one edit, with a version and history.
 */
describe('diffOps', () => {
    const roundTrip = (from: Blueprint, to: Blueprint) => {
        const ops = diffOps(from, to);
        if (!ops.length) return from;
        const {result, issue} = applyOps(from, ops);
        expect(issue).toBeUndefined();
        return result;
    };

    const blueprints = scenarioFiles()
        .map(it => [it, loadBlueprint(it)] as const)
        .filter(([, bp]) => bp.elements);

    it.each(blueprints.map(([name]) => [name]))(
        'turns every other scenario blueprint into %s',
        name => {
            const to = loadBlueprint(name);
            blueprints.forEach(([, from]) => expect(roundTrip(from, to)).toEqual(to));
        }
    );

    it('gives no ops for equal blueprints', () => {
        const bp = loadBlueprint('p2-linked-dashboard.json');
        expect(diffOps(bp, structuredClone(bp))).toEqual([]);
    });

    it('sets and removes at object-key depth, and sets a changed array whole', () => {
        const from = loadBlueprint('p2-linked-dashboard.json'),
            to = structuredClone(from);
        to.elements.posGrid.config.groupBy = ['sector'];
        to.elements.posGrid.config.title = 'Positions';
        delete to.variables.selection;
        expect(diffOps(from, to)).toEqual([
            {op: 'remove', path: '/variables/selection'},
            {op: 'set', path: '/elements/posGrid/config/groupBy', value: ['sector']},
            {op: 'set', path: '/elements/posGrid/config/title', value: 'Positions'}
        ]);
    });

    it('adds and removes an element with its child reference', () => {
        const from = loadBlueprint('p2-linked-dashboard.json'),
            to = structuredClone(from);
        to.elements.note = {component: 'statCard', config: {source: 'positions', field: 'mktVal'}};
        to.elements.dashboard.children = [
            ...to.elements.dashboard.children.filter(it => it.id !== 'ordersGrid'),
            {id: 'note', x: 0, y: 20, w: 4, h: 2}
        ];
        delete to.elements.ordersGrid;
        expect(roundTrip(from, to)).toEqual(to);
        expect(diffOps(from, to).map(it => [it.op, it.path])).toEqual(
            expect.arrayContaining([
                ['set', '/elements/note'],
                ['remove', '/elements/ordersGrid'],
                ['set', '/elements/dashboard/children']
            ])
        );
    });

    it('builds from an empty blueprint, and changes the root', () => {
        const to = loadBlueprint('p1-one-grid.json');
        expect(roundTrip({}, to)).toEqual(to);
        expect(roundTrip(to, {...to, root: 'other'})).toEqual({...to, root: 'other'});
    });

    it('escapes a key that holds / or ~ in its path', () => {
        const from: Blueprint = {formats: {}},
            to: Blueprint = {formats: {'a/b~c': {precision: 1}}};
        expect(diffOps(from, to)).toEqual([
            {op: 'set', path: '/formats/a~1b~0c', value: {precision: 1}}
        ]);
        expect(roundTrip(from, to)).toEqual(to);
    });

    it('replaces a value whose type changes', () => {
        const from: Blueprint = {formats: {pnl: {precision: 1}}},
            to = {formats: {pnl: 'other'}} as unknown as Blueprint;
        expect(diffOps(from, to)).toEqual([{op: 'set', path: '/formats/pnl', value: 'other'}]);
    });
});
