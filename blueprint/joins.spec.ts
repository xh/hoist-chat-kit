import {describe, expect, it} from 'vitest';
import type {Blueprint, JoinDecl} from './Blueprint';
import {BlueprintRegistry} from './BlueprintRegistry';
import {DataCatalog} from './DataCatalog';
import {joinFields} from './impl/joins';
import {validateBlueprint} from './validateBlueprint';

/**
 * A source joins others by keys they share. The datasets' keys give each join's grain, and the
 * grain picks how each joined field reaches the primary's rows: copied onto each row, keyed to the
 * rows that pin the join's key, or reduced to the key first.
 */
describe('joins', () => {
    const dim = (name: string, type = 'string') => ({name, type, isDimension: true}),
        asOf = {asOf: {type: 'localDate', required: true}},
        catalog = new DataCatalog({
            datasets: {
                positions: {
                    key: ['fund', 'symbol'],
                    params: asOf,
                    fields: [
                        dim('fund'),
                        dim('symbol'),
                        dim('sector'),
                        {name: 'mktVal', type: 'number', aggregator: 'SUM'}
                    ]
                },
                pnl: {
                    key: ['fund', 'symbol'],
                    params: asOf,
                    fields: [
                        dim('fund'),
                        dim('symbol'),
                        {name: 'pnl', type: 'number', aggregator: 'SUM'}
                    ]
                },
                funds: {
                    key: ['fund'],
                    params: asOf,
                    fields: [
                        dim('fund'),
                        {name: 'manager', type: 'string'},
                        {name: 'nav', type: 'number', aggregator: 'SUM'},
                        {name: 'mktVal', type: 'number', aggregator: 'SUM'}
                    ]
                },
                instruments: {
                    key: ['symbol'],
                    params: {},
                    fields: [dim('symbol'), dim('issuer'), {name: 'beta', type: 'number'}]
                },
                prices: {
                    key: ['symbol', 'day'],
                    params: asOf,
                    fields: [
                        dim('symbol'),
                        dim('day', 'localDate'),
                        {
                            name: 'close',
                            type: 'number',
                            aggregator: {type: 'last', orderField: 'day'}
                        },
                        {name: 'open', type: 'number', aggregator: {type: 'first'}},
                        {name: 'volume', type: 'number', aggregator: 'SUM'},
                        {name: 'note', type: 'string'}
                    ]
                },
                trades: {
                    params: {},
                    fields: [dim('symbol'), {name: 'qty', type: 'number', aggregator: 'SUM'}]
                }
            }
        }),
        registry = new BlueprintRegistry();

    const modesOf = (primary: string, join: JoinDecl) =>
        Object.fromEntries(
            joinFields(join, catalog.getDataset(primary), catalog.getDataset(join.source)).map(
                it => [it.name, [it.mode, it.reduce]]
            )
        );

    describe('grain', () => {
        it('copies a same-grain measure onto each row', () => {
            expect(
                modesOf('positions', {
                    source: 'pnl',
                    on: {fund: 'fund', symbol: 'symbol'},
                    fields: ['pnl']
                })
            ).toEqual({pnl: ['row', false]});
        });

        it('keys a coarser measure to the rows that pin its key, and copies a coarser dimension', () => {
            expect(
                modesOf('positions', {
                    source: 'funds',
                    on: {fund: 'fund'},
                    fields: ['nav', 'manager'],
                    as: {nav: 'fundNav'}
                })
            ).toEqual({fundNav: ['keyed', false], manager: ['row', false]});
            expect(
                modesOf('positions', {
                    source: 'instruments',
                    on: {symbol: 'symbol'},
                    fields: ['issuer']
                })
            ).toEqual({issuer: ['row', false]});
        });

        it('reduces a finer secondary to the join key first', () => {
            expect(
                modesOf('positions', {
                    source: 'prices',
                    on: {symbol: 'symbol'},
                    fields: ['close', 'volume']
                })
            ).toEqual({close: ['keyed', true], volume: ['keyed', true]});
        });
    });

    describe('validation', () => {
        const blueprint = (
                joins: JoinDecl[],
                extra: Partial<Blueprint['sources']> = {}
            ): Blueprint => ({
                schema: {blueprint: 1},
                variables: {
                    asOf: {type: 'localDate', setBy: 'prompt', default: {resolver: 'today'}}
                },
                sources: {
                    positions: {dataset: 'positions', params: {asOf: {$var: 'asOf'}}, joins},
                    funds: {dataset: 'funds', params: {asOf: {$var: 'asOf'}}},
                    instruments: {dataset: 'instruments'},
                    prices: {dataset: 'prices', params: {asOf: {$var: 'asOf'}}},
                    trades: {dataset: 'trades'},
                    ...extra
                },
                root: 'grid',
                elements: {
                    grid: {
                        component: 'cubeGrid',
                        config: {source: 'positions', groupBy: ['issuer'], columnState: ['fundNav']}
                    }
                }
            }),
            codes = (bp: Blueprint) =>
                validateBlueprint(bp, {catalog, registry}).map(it => [it.code, it.path]);

        const good: JoinDecl[] = [
            {source: 'funds', on: {fund: 'fund'}, fields: ['nav'], as: {nav: 'fundNav'}},
            {source: 'instruments', on: {symbol: 'symbol'}, fields: ['issuer']}
        ];

        it('lets a widget name a joined field under the primary, by its alias', () => {
            expect(codes(blueprint(good))).toEqual([]);
        });

        it('refuses a join to no source, to itself, or past one level', () => {
            const bp = blueprint([
                {source: 'nope', on: {fund: 'fund'}, fields: ['nav']},
                {source: 'positions', on: {fund: 'fund'}, fields: ['mktVal']},
                ...good
            ]);
            bp.sources.funds.joins = [
                {source: 'instruments', on: {fund: 'symbol'}, fields: ['issuer']}
            ];
            expect(codes(bp)).toEqual(
                expect.arrayContaining([
                    ['join.unknownSource', '/sources/positions/joins/0/source'],
                    ['join.self', '/sources/positions/joins/1/source'],
                    ['join.chained', '/sources/funds/joins/0']
                ])
            );
        });

        it('refuses unknown fields, mismatched types, a missing key and a name taken twice', () => {
            expect(
                codes(
                    blueprint([
                        {
                            source: 'funds',
                            on: {fund: 'nope'},
                            fields: ['nav', 'gone', 'mktVal'],
                            as: {nav: 'fundNav'}
                        },
                        {source: 'prices', on: {symbol: 'day'}, fields: ['close']},
                        {source: 'trades', on: {symbol: 'symbol'}, fields: ['qty']},
                        {source: 'instruments', on: {symbol: 'symbol'}, fields: ['issuer']}
                    ])
                )
            ).toEqual([
                ['join.unknownField', '/sources/positions/joins/0/on/fund'],
                ['join.unknownField', '/sources/positions/joins/0/fields/1'],
                ['join.fieldCollision', '/sources/positions/joins/0/fields/2'],
                ['join.typeMismatch', '/sources/positions/joins/1/on/symbol'],
                ['join.noKey', '/sources/positions/joins/2/source']
            ]);
        });

        it('refuses a reduced field with no aggregator, or a last with no order field', () => {
            expect(
                codes(
                    blueprint([
                        ...good,
                        {
                            source: 'prices',
                            on: {symbol: 'symbol'},
                            fields: ['close', 'note', 'open']
                        }
                    ])
                )
            ).toEqual([
                ['join.noReduction', '/sources/positions/joins/2/fields/1'],
                ['join.lastNeedsOrder', '/sources/positions/joins/2/fields/2']
            ]);
        });

        it('warns of a parameter both sides take but bind differently', () => {
            const bp = blueprint(good);
            bp.variables.other = {type: 'localDate', setBy: 'prompt', default: {resolver: 'today'}};
            bp.sources.funds.params = {asOf: {$var: 'other'}};
            expect(
                validateBlueprint(bp, {catalog, registry}).map(it => [it.code, it.severity])
            ).toContainEqual(['join.paramMismatch', 'warning']);
        });
    });
});
