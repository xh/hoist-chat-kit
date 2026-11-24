import {render} from '@testing-library/react';
import {initTestAppAsync} from '@xh/hoist/test-support';
import {beforeAll, describe, expect, it} from 'vitest';
import {loadBlueprint, portfolioCatalog} from '../test/blueprintFixtures';
import {formatValue, resolveFormat} from './formats';

/**
 * Formats layer from the kind, through the catalog and the blueprint, to the widget. A blueprint
 * that redefines a named format changes every field whose kind uses it.
 */
describe('formats', () => {
    beforeAll(async () => {
        await initTestAppAsync();
    });

    const mktVal = portfolioCatalog.getDataset('positions').fields.mktVal,
        text = (blueprint, overrides = []) =>
            String(
                formatValue(
                    1234567,
                    mktVal,
                    resolveFormat(mktVal, overrides, {catalog: portfolioCatalog, blueprint}),
                    portfolioCatalog,
                    true
                )
            );

    it('shows a date that does not parse as its text, rather than throwing', () => {
        const day = {name: 'd', type: 'localDate'};
        expect(formatValue('', day, {}, portfolioCatalog)).toBe('');
        expect(formatValue('soon', day, {}, portfolioCatalog)).toBe('soon');
    });

    it("takes the catalog's named format through the field's kind", () => {
        expect(text({})).toBe('1.2m');
    });

    it('takes a named format the blueprint redefines, in place of the catalog one', () => {
        expect(text(loadBlueprint('p3-morning-report.json'))).toBe('1,234,567');
    });

    it("lets a widget's format change options of the named one", () => {
        expect(text({}, [{name: 'mv', precision: 2}])).toBe('1.23m');
    });

    describe('an auto scale', () => {
        const value = {name: 'v', type: 'number'} as const,
            auto = (v: number, asText = true) =>
                formatValue(
                    v,
                    value,
                    {scale: 'auto', precision: 2, prefix: '$', labelCls: null},
                    portfolioCatalog,
                    asText
                );

        it('compacts a value past 100K to K, M, B or T, and keeps its precision while whole', () => {
            expect(auto(48_500_000_000)).toBe('$48.5B');
            expect(auto(1_234_567)).toBe('$1.23M');
            expect(auto(99_999)).toBe('$99,999.00');
        });

        it('shows the full value in a tooltip, only where it differs', () => {
            expect(render(auto(1_234_567, false) as any).container.innerHTML).toContain(
                'title="$1,234,567.00"'
            );
            expect(render(auto(12, false) as any).container.innerHTML).not.toContain('title=');
        });
    });
});
