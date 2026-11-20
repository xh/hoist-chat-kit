import {render} from '@testing-library/react';
import {initTestAppAsync} from '@xh/hoist/test-support';
import type {ReactElement} from 'react';
import {beforeAll, describe, expect, it} from 'vitest';
import {portfolioCatalog, scenarioRegistry} from '../../test/blueprintFixtures';
import {fieldDisplay} from './renderers';

/**
 * A `number[]` field draws as a sparkline. Every row of a column shares one scale, so the rows
 * compare, and a group row draws nothing, as a series never rolls up.
 */
describe('sparkline renderer', () => {
    beforeAll(async () => {
        await initTestAppAsync();
    });

    const field = portfolioCatalog.getDataset('positions').fields.pnlHistory,
        ctx = {
            catalog: portfolioCatalog,
            blueprint: {},
            registry: scenarioRegistry(),
            columnRange: () => ({min: -10, max: 30})
        },
        svgOf = (el: unknown) =>
            render(el as ReactElement).container.querySelector('.xh-sparkline') as HTMLElement;

    it('draws a series field as a sparkline by default, on the scale of its column', () => {
        const display = fieldDisplay(field, {}, ctx),
            el = display.render([1, 5, 3]) as ReactElement<any>;
        expect(svgOf(el)).toBeTruthy();
        expect(el.props).toMatchObject({min: -10, max: 30});
    });

    it('takes a type and a color from its config', () => {
        const el = fieldDisplay(
            field,
            {renderer: {name: 'sparkline', type: 'bar', colorBy: 'sign'}},
            ctx
        ).render([1, -2]) as ReactElement<any>;
        expect(el.props).toMatchObject({type: 'bar', colorBy: 'sign'});
    });

    it('draws a group row on its own scale, as a total does not compare with its rows', () => {
        const el = fieldDisplay(field, {}, ctx).render([1, 2], null, true) as ReactElement<any>;
        expect(el.props.min).toBeUndefined();
        expect(el.props.max).toBeUndefined();
    });

    it('draws nothing for no series', () => {
        expect(fieldDisplay(field, {}, ctx).render(null)).toBeNull();
    });
});
