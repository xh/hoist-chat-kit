import {render} from '@testing-library/react';
import {initTestAppAsync} from '@xh/hoist/test-support';
import type {ReactElement} from 'react';
import {beforeAll, describe, expect, it} from 'vitest';
import {portfolioCatalog, scenarioRegistry} from '../../test/blueprintFixtures';
import {fieldDisplay} from './renderers';

/**
 * A bar fills by a value's share of the largest in its column, or of the max its config gives,
 * and a group or summary row shows its value as text, as a bar there would not compare.
 */
describe('bar renderer', () => {
    beforeAll(async () => {
        await initTestAppAsync();
    });

    const field = portfolioCatalog.getDataset('positions').fields.mktVal,
        ctx = {catalog: portfolioCatalog, blueprint: {}, registry: scenarioRegistry()},
        widthOf = (el: unknown) =>
            (
                render(el as ReactElement).container.querySelector(
                    '.xh-blueprint-bar__fill'
                ) as HTMLElement
            )?.style.width;

    it('fills by the share of the largest value in its column', () => {
        const display = fieldDisplay(field, {renderer: 'bar'}, {...ctx, columnMax: () => -200});
        expect(widthOf(display.render(50))).toBe('25%');
        expect(widthOf(display.render(-200))).toBe('100%');
    });

    it('fills by the share of the max its config gives', () => {
        const display = fieldDisplay(
            field,
            {renderer: {name: 'bar', max: 100}},
            {...ctx, columnMax: () => 1000}
        );
        expect(widthOf(display.render(50))).toBe('50%');
    });

    it('shows a group row as its value, with no bar', () => {
        const display = fieldDisplay(field, {renderer: 'bar'}, {...ctx, columnMax: () => 200}),
            {container} = render(display.render(500, null, true) as ReactElement);
        expect(container.querySelector('.xh-blueprint-bar')).toBeNull();
        expect(container.textContent).not.toBe('');
    });
});
