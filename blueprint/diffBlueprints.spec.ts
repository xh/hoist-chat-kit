import {cloneDeep} from 'lodash';
import {describe, expect, it} from 'vitest';
import {loadBlueprint} from '../test/blueprintFixtures';
import type {Blueprint} from './Blueprint';
import {diffBlueprints} from './diffBlueprints';

/** How one version of a blueprint differs from another, part by part, for a person to read. */
describe('diffBlueprints', () => {
    const p3 = () => loadBlueprint('p3-morning-report.json') as Blueprint;

    it('finds nothing between equal blueprints', () => {
        const diff = diffBlueprints(p3(), p3());
        expect(diff.isEmpty).toBe(true);
        expect(diff.elements).toEqual({added: [], removed: [], renamed: [], changed: []});
    });

    it('lists what each part added, removed and changed, with the paths that changed', () => {
        const a = p3(),
            b = cloneDeep(a);
        b.elements.posGrid.config.title = 'Book';
        b.elements.posGrid.config.sortBy = 'mktVal|desc';
        delete b.elements.priceChart;
        b.elements.positions.children = b.elements.positions.children.filter(
            it => it.id !== 'priceChart'
        );
        b.elements.note = {component: 'markdown', config: {text: 'Hi'}};
        delete b.variables.symbol;
        b.sources.prices.params = {...b.sources.prices.params, extra: 1};
        b.formats = {...b.formats, pct1: {precision: 1}};

        const diff = diffBlueprints(a, b);
        expect(diff.isEmpty).toBe(false);
        expect(diff.elements.added).toEqual(['note']);
        expect(diff.elements.removed).toEqual(['priceChart']);
        expect(diff.elements.changed).toEqual([
            {id: 'posGrid', paths: ['/config/sortBy', '/config/title']},
            {id: 'positions', paths: ['/children']}
        ]);
        expect(diff.variables.removed).toEqual(['symbol']);
        expect(diff.sources.changed).toEqual([{id: 'prices', paths: ['/params/extra']}]);
        expect(diff.formats.added).toEqual(['pct1']);
    });

    it('pairs an id with its new name where the renames allow, rather than a removal and an addition', () => {
        const a = p3(),
            b = cloneDeep(a);
        b.elements.positionsGrid = b.elements.posGrid;
        delete b.elements.posGrid;
        b.elements.positions.children = b.elements.positions.children.map(it =>
            it.id === 'posGrid' ? {...it, id: 'positionsGrid'} : it
        );
        // Without renames, it reads as one gone and another new.
        expect(diffBlueprints(a, b).elements).toMatchObject({
            added: ['positionsGrid'],
            removed: ['posGrid']
        });

        const diff = diffBlueprints(a, b, [
            {kind: 'element', from: 'posGrid', to: 'positionsGrid'}
        ]);
        expect(diff.elements).toEqual({
            added: [],
            removed: [],
            renamed: [{from: 'posGrid', to: 'positionsGrid'}],
            changed: []
        });
    });

    it('notes other top-level changes, such as the root, and leaves out the schema map', () => {
        const a = p3(),
            b = {...cloneDeep(a), root: 'overview', schema: {blueprint: 99}} as Blueprint;
        expect(diffBlueprints(a, b).other).toEqual(['root']);
    });
});
