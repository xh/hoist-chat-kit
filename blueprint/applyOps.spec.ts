import {describe, expect, it} from 'vitest';
import {
    ARTIFACTS,
    loadBlueprint,
    portfolioCatalog,
    scenarioRegistry
} from '../test/blueprintFixtures';
import type {BlueprintOp} from './Blueprint';
import {applyOps} from './applyOps';
import {validateBlueprint} from './validateBlueprint';

/**
 * Every change to a blueprint is an edit. An edit applies to a copy, as one unit, and refuses an
 * operation it cannot apply without touching the original.
 */
describe('applyOps', () => {
    const p2 = () => loadBlueprint('p2-linked-dashboard.json'),
        apply = (ops: any[]) => applyOps(p2(), ops as BlueprintOp[]);

    it('sets and removes values at a path, creating objects on the way', () => {
        const {result} = apply([
            {op: 'set', path: '/elements/posGrid/config/groupBy', value: ['sector']},
            {op: 'set', path: '/formats/pnl/precision', value: 2},
            {op: 'remove', path: '/elements/sectorChart/config/title'}
        ]);
        expect(result.elements.posGrid.config.groupBy).toEqual(['sector']);
        expect(result.formats).toEqual({pnl: {precision: 2}});
        expect(result.elements.sectorChart.config).not.toHaveProperty('title');
    });

    it('leaves the original untouched, and applies nothing when an op fails', () => {
        const bp = p2(),
            before = JSON.stringify(bp),
            {result, issue} = applyOps(bp, [
                {op: 'set', path: '/elements/posGrid/config/groupBy', value: ['sector']},
                {op: 'remove', path: '/elements/nope/config'}
            ]);
        expect(result).toBeUndefined();
        expect(issue).toMatchObject({code: 'edit.badOp', op: 1, path: '/elements/nope/config'});
        expect(JSON.stringify(bp)).toBe(before);
    });

    it('refuses a path that indexes into an array', () => {
        const {issue} = apply([{op: 'set', path: '/elements/dashboard/children/0/w', value: 3}]);
        expect(issue).toMatchObject({code: 'edit.badOp', op: 0});
    });

    it('refuses an empty edit', () => {
        expect(apply([]).issue.code).toBe('edit.noOps');
    });

    it('refuses an unknown op', () => {
        expect(apply([{op: 'patch', path: '/root'}]).issue.message).toMatch(/unknown op 'patch'/);
    });

    describe('addElement', () => {
        it('makes the first element of an empty blueprint its root', () => {
            const {result} = applyOps({}, [
                {op: 'addElement', id: 'grid', element: {component: 'cubeGrid'}}
            ]);
            expect(result.root).toBe('grid');
        });

        it('needs a parent once the blueprint has a root', () => {
            expect(
                apply([{op: 'addElement', id: 'x', element: {component: 'chart'}}]).issue
            ).toBeDefined();
        });

        it('places a child reference in its parent, at an index or at the end', () => {
            const {result} = apply([
                {
                    op: 'addElement',
                    id: 'first',
                    element: {component: 'chart'},
                    parent: 'dashboard',
                    child: {x: 0, y: 20, w: 2, h: 2},
                    index: 0
                },
                {op: 'addElement', id: 'last', element: {component: 'chart'}, parent: 'dashboard'}
            ]);
            const ids = result.elements.dashboard.children.map(it => it.id);
            expect(ids[0]).toBe('first');
            expect(ids.at(-1)).toBe('last');
            expect(result.elements.dashboard.children[0]).toEqual({
                id: 'first',
                x: 0,
                y: 20,
                w: 2,
                h: 2
            });
        });

        it('refuses an ID with characters a path would need to escape', () => {
            expect(
                apply([{op: 'addElement', id: 'a/b', element: {}, parent: 'dashboard'}]).issue
            ).toBeDefined();
        });
    });

    it('removes an element and its child reference, but not one with children', () => {
        const {result} = apply([{op: 'removeElement', id: 'ordersGrid'}]);
        expect(result.elements).not.toHaveProperty('ordersGrid');
        expect(result.elements.dashboard.children.map(it => it.id)).not.toContain('ordersGrid');

        expect(apply([{op: 'removeElement', id: 'dashboard'}]).issue.message).toMatch(/children/);
    });

    it('moves a child reference, keeping its placement within the same parent', () => {
        const {result} = apply([
            {op: 'moveElement', id: 'ordersGrid', parent: 'dashboard', index: 0}
        ]);
        expect(result.elements.dashboard.children[0]).toEqual({
            id: 'ordersGrid',
            x: 0,
            y: 9,
            w: 12,
            h: 5
        });
    });

    describe('renameId', () => {
        it('renames an element and every reference to it, keeping the blueprint valid', () => {
            const {result} = apply([
                {op: 'renameId', kind: 'element', from: 'posGrid', to: 'positionsGrid'}
            ]);
            expect(result.variables.selection.setBy).toEqual({
                element: 'positionsGrid',
                output: 'selection'
            });
            expect(result.elements.dashboard.children.map(it => it.id)).toContain('positionsGrid');
            const issues = validateBlueprint(result, {
                catalog: portfolioCatalog,
                registry: scenarioRegistry(),
                artifacts: ARTIFACTS
            });
            expect(issues).toEqual([]);
        });

        it('renames the root', () => {
            const {result} = apply([
                {op: 'renameId', kind: 'element', from: 'dashboard', to: 'main'}
            ]);
            expect(result.root).toBe('main');
        });

        it('renames a variable in bindings and actions', () => {
            const {result} = apply([
                {op: 'renameId', kind: 'variable', from: 'selection', to: 'sel'}
            ]);
            expect(result.variables).toHaveProperty('sel');
            expect(result.elements.sectorChart.config.filter).toEqual({$var: 'sel'});
        });

        it('renames a source in widget configs', () => {
            const {result} = apply([
                {op: 'renameId', kind: 'source', from: 'orders', to: 'trades'}
            ]);
            expect(result.sources).toHaveProperty('trades');
            expect(result.elements.ordersGrid.config.source).toBe('trades');
        });

        it('renames paths that name an element, as in presets', () => {
            const bp = loadBlueprint('p3-morning-report.json'),
                [group] = Object.keys(bp.presets),
                path = bp.presets[group].controls[0].path,
                id = path.split('/')[2],
                {result} = applyOps(bp, [
                    {op: 'renameId', kind: 'element', from: id, to: 'renamed'}
                ]);
            expect(result.presets[group].controls[0].path).toBe(
                path.replace(`/elements/${id}/`, '/elements/renamed/')
            );
        });

        it('refuses a name already taken', () => {
            expect(
                apply([{op: 'renameId', kind: 'element', from: 'posGrid', to: 'ordersGrid'}]).issue
            ).toBeDefined();
        });
    });

    describe('forbidden names', () => {
        const isClean = () => expect(({} as any).x).toBeUndefined();

        it.each([
            ['a path through __proto__', {op: 'set', path: '/__proto__/x', value: 1}],
            [
                'a path through constructor',
                {op: 'set', path: '/elements/posGrid/constructor/prototype/x', value: 1}
            ],
            [
                'a path ending in prototype',
                {op: 'set', path: '/elements/posGrid/prototype', value: {x: 1}}
            ],
            ['removing through __proto__', {op: 'remove', path: '/__proto__/x'}],
            [
                'an element called __proto__',
                {
                    op: 'addElement',
                    id: '__proto__',
                    element: {component: 'chart'},
                    parent: 'dashboard'
                }
            ],
            [
                'renaming to constructor',
                {op: 'renameId', kind: 'variable', from: 'asOf', to: 'constructor'}
            ]
        ])('refuses %s, leaving Object.prototype alone', (_, op) => {
            const {result, issue} = apply([op]);
            expect(result).toBeUndefined();
            expect(issue.code).toBe('path.forbidden');
            isClean();
        });
    });
});
