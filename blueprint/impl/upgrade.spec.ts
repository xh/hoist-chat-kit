import {describe, expect, it} from 'vitest';
import {upgradeBlueprint} from './upgrade';

/**
 * A blueprint written in an older form opens in the current one, so stored blueprints and seeds
 * keep working after the format changes.
 */
describe('upgradeBlueprint', () => {
    const grid = (config: object) =>
        ({
            root: 'grid',
            elements: {grid: {component: 'cubeGrid', config: {source: 'positions', ...config}}}
        }) as any;

    it("renames a grid's summaryRow to showSummary, with true as 'top'", () => {
        expect(upgradeBlueprint(grid({summaryRow: true})).elements.grid.config).toEqual({
            source: 'positions',
            showSummary: 'top'
        });
        expect(upgradeBlueprint(grid({summaryRow: false})).elements.grid.config).toEqual({
            source: 'positions'
        });
        expect(upgradeBlueprint(grid({summaryRow: {$var: 'totals'}})).elements.grid.config).toEqual(
            {source: 'positions', showSummary: {$var: 'totals'}}
        );
    });

    it('returns a current blueprint as it is', () => {
        const current = grid({showSummary: 'bottom'});
        expect(upgradeBlueprint(current)).toBe(current);
    });

    it('moves slot-marked child references into their slot lists', () => {
        const old = {
            root: 'page',
            elements: {
                page: {component: 'panel', children: [{id: 'body'}, {id: 'top', slot: 'tbar'}]}
            }
        } as any;
        expect(upgradeBlueprint(old).elements.page).toEqual({
            component: 'panel',
            children: [{id: 'body'}],
            tbar: [{id: 'top'}]
        });
    });
});
