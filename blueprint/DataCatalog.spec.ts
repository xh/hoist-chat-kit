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

    it("resolves what the model may see: a field's own access, else its dataset's, else the catalog's, else schema", () => {
        const c = new DataCatalog({
            datasets: {
                positions: {
                    params: {},
                    modelAccess: 'rows',
                    fields: [
                        {name: 'sector', type: 'string'},
                        {name: 'salary', type: 'number', modelAccess: 'none'},
                        {name: 'pnl', type: 'number', modelAccess: 'schema'}
                    ]
                },
                trades: {params: {}, fields: [{name: 'qty', type: 'number'}]},
                secret: {
                    params: {},
                    modelAccess: 'none',
                    fields: [{name: 'x', type: 'number', modelAccess: 'rows'}]
                }
            }
        });
        expect(c.modelAccessOf('positions')).toBe('rows');
        expect(c.modelAccessOf('positions', 'sector')).toBe('rows');
        expect(c.modelAccessOf('positions', 'salary')).toBe('none');
        expect(c.modelAccessOf('positions', 'pnl')).toBe('schema');
        expect(c.modelAccessOf('trades')).toBe('schema');
        expect(c.modelAccessOf('trades', 'qty')).toBe('schema');
        // A hidden dataset hides every field, whatever the field says.
        expect(c.modelAccessOf('secret', 'x')).toBe('none');

        const open = new DataCatalog({
            modelAccess: 'rows',
            datasets: {trades: {params: {}, fields: [{name: 'qty', type: 'number'}]}}
        });
        expect(open.modelAccessOf('trades', 'qty')).toBe('rows');
    });

    it('refuses a modelAccess it does not know', () => {
        expect(
            () =>
                new DataCatalog({
                    datasets: {
                        trades: {
                            params: {},
                            fields: [{name: 'qty', type: 'number', modelAccess: 'all' as any}]
                        }
                    }
                })
        ).toThrow(/modelAccess 'all' of field 'qty'/);
        expect(() => new DataCatalog({modelAccess: 'open' as any, datasets: {}})).toThrow(
            /modelAccess 'open' of the catalog/
        );
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

    it("takes a format label chosen by a dataset param, and refuses an unknown param or a value that isn't text", () => {
        const wind = (label: object): DataCatalogJson => ({
            formats: {speed: {precision: 0, label}},
            kinds: {speed: {base: 'number', format: 'speed', aggregator: 'AVG'}},
            datasets: {
                weather: {
                    params: {units: {type: 'string', options: {values: ['imperial', 'metric']}}},
                    fields: [{name: 'windSpeed', type: 'number', kind: 'speed'}]
                }
            }
        });
        expect(
            () =>
                new DataCatalog(wind({param: 'units', values: {imperial: ' mph', metric: ' m/s'}}))
        ).not.toThrow();
        expect(() => new DataCatalog(wind({param: 'unit', values: {metric: ' m/s'}}))).toThrow(
            /label of field 'windSpeed' of dataset 'weather' reads param 'unit'/
        );
        expect(() => new DataCatalog(wind({param: 'units', values: {metric: 3}}))).toThrow(
            /label of field 'windSpeed' of dataset 'weather'.*text/
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
