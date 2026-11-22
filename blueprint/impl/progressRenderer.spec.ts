import {render} from '@testing-library/react';
import {initTestAppAsync} from '@xh/hoist/test-support';
import type {ReactElement} from 'react';
import {beforeAll, describe, expect, it} from 'vitest';
import {portfolioCatalog, scenarioRegistry} from '../../test/blueprintFixtures';
import {BUILT_IN_WIDGETS} from './builtInWidgets';
import {fieldDisplay} from './renderers';

/**
 * A value draws as a bar filled to its share of a max, a fixed number or another field of its row,
 * with a mark at a target, and its formatted value beside it.
 */
describe('progress renderer', () => {
    beforeAll(async () => {
        await initTestAppAsync();
    });

    const field = portfolioCatalog.getDataset('positions').fields.grossExposure,
        ctx = {catalog: portfolioCatalog, blueprint: {}, registry: scenarioRegistry()},
        draw = (renderer: object, value: number, record: object = null) =>
            fieldDisplay(field, {renderer}, ctx).render(value, record) as ReactElement<any>;

    it('fills to its share of a fixed max, or of a field of its row', () => {
        expect(draw({name: 'progress', max: 200}, 50).props).toMatchObject({value: 50, max: 200});
        expect(
            draw({name: 'progress', maxField: 'netExposure', target: 80}, 50, {netExposure: 400})
                .props
        ).toMatchObject({value: 50, max: 400, target: 80});
    });

    it("colors the fill by an intent, and ignores one Hoist's ProgressBar does not take", () => {
        expect(draw({name: 'progress', intent: 'warning'}, 0.5).props.intent).toBe('warning');
        expect(draw({name: 'progress', intent: 'loud'}, 0.5).props).not.toHaveProperty('intent');
    });

    it('shows its value formatted as its field is', () => {
        const {container} = render(draw({name: 'progress', max: 1e9}, 5e8));
        expect(container.querySelector('.xh-progress-bar')).toBeTruthy();
        expect(container.textContent).toMatch(/500/);
    });

    it('has a grid ask for the fields its config names', () => {
        const grid = BUILT_IN_WIDGETS.find(it => it.name === 'cubeGrid'),
            demand = grid.demand({
                source: 'positions',
                columnState: ['grossExposure'],
                columns: {
                    grossExposure: {
                        renderer: {name: 'progress', maxField: 'netExposure', targetField: 'pnlDay'}
                    }
                }
            });
        expect(demand.positions.fields).toEqual(
            expect.arrayContaining(['grossExposure', 'netExposure', 'pnlDay'])
        );
    });
});
