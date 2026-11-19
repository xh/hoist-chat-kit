import {initTestAppAsync} from '@xh/hoist/test-support';
import {beforeAll, describe, expect, it} from 'vitest';
import {loadBlueprint, portfolioCatalog} from '../../test/blueprintFixtures';
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

    it("takes the catalog's named format through the field's kind", () => {
        expect(text({})).toBe('1.2m');
    });

    it('takes a named format the blueprint redefines, in place of the catalog one', () => {
        expect(text(loadBlueprint('p3-morning-report.json'))).toBe('1,234,567');
    });

    it("lets a widget's format change options of the named one", () => {
        expect(text({}, [{name: 'mv', precision: 2}])).toBe('1.23m');
    });
});
