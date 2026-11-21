import {describe, expect, it} from 'vitest';
import {PLANNING_REGISTRY, portfolioCatalog, weatherCatalog} from '../test/blueprintFixtures';
import {DataCatalog, type DataCatalogJson} from './DataCatalog';

/** The Data Catalog resolves shared fields and kind defaults, and refuses a kind it cannot resolve. */
describe('DataCatalog', () => {
    const catalog = (fields: any[], params = {}): DataCatalogJson => ({
        kinds: {pnl: {base: 'currency:USD', format: 'pnl', aggregator: 'SUM'}},
        datasets: {positions: {params, fields}}
    });

    it('loads the scenario catalogs', () => {
        expect(PLANNING_REGISTRY).toBeTruthy();
        expect(portfolioCatalog.getDataset('positions').params.asOf.type).toBe('localDate');
        expect(weatherCatalog.getDataset('weather')).toBeTruthy();
    });

    it('gives a field its kind defaults, and the field its own values over them', () => {
        const c = new DataCatalog(
            catalog([
                {name: 'pnlDay', type: 'number', kind: 'pnl'},
                {name: 'pnlMtd', type: 'number', kind: 'pnl', aggregator: 'MAX'}
            ])
        );
        expect(c.getDataset('positions').fields.pnlDay.aggregator).toBe('SUM');
        expect(c.getDataset('positions').fields.pnlMtd.aggregator).toBe('MAX');
    });

    it('takes built-in kinds and its own for fields and parameters', () => {
        expect(
            () =>
                new DataCatalog(
                    catalog(
                        [
                            {name: 'a', type: 'number', kind: 'fraction'},
                            {name: 'b', type: 'number', kind: 'currency:EUR'},
                            {
                                name: 'c',
                                type: 'number',
                                kind: 'pnl',
                                params: {shock: {type: 'number', kind: 'bps'}}
                            }
                        ],
                        {notional: {type: 'number', kind: 'shares'}}
                    )
                )
        ).not.toThrow();
    });

    it('refuses an unknown kind on a field', () => {
        expect(() => new DataCatalog(catalog([{name: 'a', type: 'number', kind: 'nope'}]))).toThrow(
            /'nope'.*'a'/
        );
    });

    it('refuses a key that names a field its dataset lacks, naming both', () => {
        const keyed = (key: string[]): DataCatalogJson => ({
            datasets: {
                orders: {
                    key,
                    params: {},
                    fields: [
                        {name: 'orderId', type: 'string'},
                        {name: 'symbol', type: 'string', isDimension: true}
                    ]
                }
            }
        });
        // A key need not be a dimension: a join checks that where its grain needs one.
        expect(() => new DataCatalog(keyed(['orderId']))).not.toThrow();
        expect(() => new DataCatalog(keyed(['orderId', 'fund']))).toThrow(
            /key field 'fund' of dataset 'orders'/
        );
    });

    it("refuses an unknown kind on a dataset's or a field's parameter", () => {
        expect(
            () => new DataCatalog(catalog([], {asOf: {type: 'localDate', kind: 'nope'}}))
        ).toThrow(/asOf/);
        expect(
            () =>
                new DataCatalog(
                    catalog([
                        {name: 'a', type: 'number', params: {shock: {type: 'number', kind: 'nope'}}}
                    ])
                )
        ).toThrow(/shock/);
    });
});
