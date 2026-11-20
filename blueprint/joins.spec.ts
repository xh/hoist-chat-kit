import type {PlainObject} from '@xh/hoist/core';
import {isString, pick} from 'lodash';
import {wait} from '@xh/hoist/promise';
import {initTestAppAsync} from '@xh/hoist/test-support';
import {beforeAll, describe, expect, it, onTestFinished, vi} from 'vitest';
import type {Blueprint, JoinDecl} from './Blueprint';
import type {BlueprintDataRequest, BlueprintDataUpdate} from './BlueprintDataProvider';
import {BlueprintModel} from './BlueprintModel';
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

        it('refuses a join on a field that is not a dimension', () => {
            expect(
                codes(
                    blueprint([
                        ...good,
                        {source: 'funds', on: {mktVal: 'nav'}, fields: ['manager']}
                    ])
                )
            ).toContainEqual(['join.keyNotDimension', '/sources/positions/joins/2/on/mktVal']);
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

    describe('at runtime', () => {
        beforeAll(async () => {
            await initTestAppAsync();
        });

        const ROWS: Record<string, PlainObject[]> = {
            positions: [
                {id: 'a1', fund: 'A', symbol: 'X', sector: 'Tech', mktVal: 10},
                {id: 'a2', fund: 'A', symbol: 'Y', sector: 'Energy', mktVal: 20},
                {id: 'b1', fund: 'B', symbol: 'X', sector: 'Tech', mktVal: 30},
                {id: 'c1', fund: 'C', symbol: 'Z', sector: 'Tech', mktVal: 40}
            ],
            funds: [
                {id: 'A', fund: 'A', nav: 100, manager: 'Ann'},
                {id: 'B', fund: 'B', nav: 200, manager: 'Bob'}
            ],
            instruments: [
                {id: 'X', symbol: 'X', issuer: 'Xco'},
                {id: 'Y', symbol: 'Y', issuer: 'Yco'}
            ],
            prices: [
                {id: 'X1', symbol: 'X', day: '2026-03-01', close: 9, volume: 1},
                {id: 'X2', symbol: 'X', day: '2026-03-02', close: 11, volume: 2},
                {id: 'Y1', symbol: 'Y', day: '2026-03-02', close: 5, volume: 4}
            ]
        };

        /** A provider that records each request, and pushes a dataset's rows when asked. */
        function provider() {
            const subs: Record<
                string,
                {req: BlueprintDataRequest; push: (u: BlueprintDataUpdate) => void}
            > = {};
            return {
                subs,
                loadAsync: async () => ({rows: []}),
                subscribe(req: BlueprintDataRequest, push: (u: BlueprintDataUpdate) => void) {
                    subs[req.dataset] = {req, push};
                    return () => {};
                },
                send: async (
                    dataset: string,
                    update: BlueprintDataUpdate = {replace: ROWS[dataset]}
                ) => {
                    await vi.waitFor(() => expect(subs[dataset]).toBeTruthy());
                    // As a server does, it sends only the fields asked for.
                    const fields = [
                            'id',
                            ...subs[dataset].req.fields.map(it => (isString(it) ? it : it.name))
                        ],
                        only = (rows: PlainObject[]) => rows?.map(it => pick(it, fields));
                    subs[dataset].push({
                        ...update,
                        replace: only(update.replace),
                        add: only(update.add),
                        update: only(update.update)
                    });
                    await wait();
                }
            };
        }

        function open(
            joins: JoinDecl[],
            columns: string[],
            groupBy: string[] = ['sector'],
            filter: PlainObject = null
        ) {
            const dataProvider = provider(),
                model = new BlueprintModel({
                    blueprint: {
                        schema: {blueprint: 1},
                        variables: {
                            asOf: {
                                type: 'localDate',
                                setBy: 'prompt',
                                default: {value: '2026-03-02'}
                            }
                        },
                        sources: {
                            positions: {
                                dataset: 'positions',
                                params: {asOf: {$var: 'asOf'}},
                                joins,
                                ...(filter ? {filter} : {})
                            },
                            funds: {dataset: 'funds', params: {asOf: {$var: 'asOf'}}},
                            instruments: {dataset: 'instruments'},
                            prices: {dataset: 'prices', params: {asOf: {$var: 'asOf'}}}
                        },
                        root: 'grid',
                        elements: {
                            grid: {
                                component: 'cubeGrid',
                                config: {source: 'positions', groupBy, columnState: columns}
                            }
                        }
                    },
                    catalog,
                    registry,
                    dataProvider
                });
            onTestFinished(() => model.destroy());
            const positions = model.getSource('positions'),
                view = (dimensions: string[], filter: PlainObject = null) => {
                    const ret = positions.cube.createView({
                        query: {dimensions, filter: filter as any, includeRoot: true}
                    });
                    onTestFinished(() => ret.destroy());
                    return ret.result.rows[0];
                },
                leaf = (id: string) => positions.cube.store.getById(id)?.data;
            return {model, dataProvider, positions, view, leaf};
        }

        const fundJoin: JoinDecl = {
            source: 'funds',
            on: {fund: 'fund'},
            fields: ['nav', 'manager'],
            as: {nav: 'fundNav'}
        };

        it('copies a joined dimension onto each row, so the primary groups by it', async () => {
            const {dataProvider, view, leaf} = open(
                [{source: 'instruments', on: {symbol: 'symbol'}, fields: ['issuer']}],
                ['mktVal'],
                ['issuer']
            );
            await dataProvider.send('positions');
            await dataProvider.send('instruments');
            await vi.waitFor(() => expect(leaf('a1').issuer).toBe('Xco'));
            expect(leaf('c1').issuer).toBeNull();
            const byIssuer = view(['issuer']).children.map(it => [String(it.cubeLabel), it.mktVal]);
            expect(Object.fromEntries(byIssuer)).toEqual({Xco: 40, Yco: 20, null: 40});
        });

        it('shows a coarser measure on the rows that pin its key, and totals it once per key at the root', async () => {
            const {dataProvider, view} = open([fundJoin], ['fundNav']);
            await dataProvider.send('positions');
            await dataProvider.send('funds');
            await vi.waitFor(() => expect(view([]).fundNav).toBe(300));
            const byFund = view(['fund']).children;
            expect(Object.fromEntries(byFund.map(it => [it.cubeLabel, it.fundNav]))).toEqual({
                A: 100,
                B: 200,
                C: null
            });
            expect(view(['sector']).children.every(it => it.fundNav == null)).toBe(true);
            expect(view([], {field: 'sector', op: '=', value: 'Energy'}).fundNav).toBe(100);
        });

        it("reduces a finer secondary to the key, by each field's aggregator, before it joins", async () => {
            const {dataProvider, leaf} = open(
                [{source: 'prices', on: {symbol: 'symbol'}, fields: ['close', 'volume']}],
                ['close', 'volume'],
                ['symbol']
            );
            await dataProvider.send('positions');
            await dataProvider.send('prices');
            await vi.waitFor(() => expect(leaf('a1').close).toBe(11));
            expect(leaf('a1').volume).toBe(3);
            expect(leaf('a2')).toMatchObject({close: 5, volume: 4});
        });

        it('asks the secondary for the joined fields widgets show, and the primary for its key', async () => {
            const {dataProvider} = open([fundJoin], ['mktVal', 'fundNav']);
            await vi.waitFor(() => expect(dataProvider.subs.funds).toBeTruthy());
            const {positions, funds} = dataProvider.subs;
            expect(positions.req.fields).toEqual(expect.arrayContaining(['fund', 'mktVal']));
            expect(positions.req.fields).not.toContain('fundNav');
            expect(funds.req.fields).toEqual(expect.arrayContaining(['fund', 'nav']));
            expect(funds.req.fields).not.toContain('manager');
        });

        it('matches no row on a null key', async () => {
            const {dataProvider, leaf} = open([fundJoin], ['fundNav']);
            await dataProvider.send('positions', {
                replace: [
                    ...ROWS.positions,
                    {id: 'n1', fund: null, symbol: 'X', sector: 'Tech', mktVal: 1}
                ]
            });
            await dataProvider.send('funds', {
                replace: [...ROWS.funds, {id: 'N', fund: null, nav: 999, manager: 'Nobody'}]
            });
            await vi.waitFor(() => expect(leaf('a1').fundNav).toBe(100));
            expect(leaf('n1').fundNav).toBeNull();
        });

        it('reduces a joined source once per change of it', async () => {
            const {dataProvider, leaf, model} = open(
                [{source: 'prices', on: {symbol: 'symbol'}, fields: ['volume']}],
                ['volume'],
                ['symbol']
            );
            await dataProvider.send('prices');
            const prices = model.getSource('prices'),
                spy = vi.spyOn(prices.cube, 'createView');
            await dataProvider.send('positions');
            await dataProvider.send('positions', {update: [{...ROWS.positions[0], mktVal: 11}]});
            await vi.waitFor(() => expect(leaf('a1').volume).toBe(3));
            expect(spy.mock.calls.length).toBeLessThanOrEqual(1);
        });

        it('follows a tick from either side, a new key from the primary included', async () => {
            const {dataProvider, leaf} = open([fundJoin], ['fundNav']);
            await dataProvider.send('positions');
            await dataProvider.send('funds');
            await vi.waitFor(() => expect(leaf('a1').fundNav).toBe(100));

            await dataProvider.send('funds', {
                update: [{id: 'A', fund: 'A', nav: 150, manager: 'Ann'}]
            });
            await vi.waitFor(() => expect(leaf('a1').fundNav).toBe(150));
            expect(leaf('a2').fundNav).toBe(150);

            await dataProvider.send('positions', {
                add: [{id: 'b2', fund: 'B', symbol: 'Y', sector: 'Energy', mktVal: 5}]
            });
            await vi.waitFor(() => expect(leaf('b2')?.fundNav).toBe(200));
        });

        describe('a source filter on a joined field', () => {
            const ANN = {field: 'manager', op: '=', value: 'Ann'};

            it('waits for the joined source, then asks for its matching keys only, and filters in the browser', async () => {
                const {dataProvider, leaf} = open([fundJoin], ['mktVal'], ['sector'], ANN);
                await wait();
                expect(dataProvider.subs.positions).toBeUndefined();

                await dataProvider.send('funds');
                await vi.waitFor(() => expect(dataProvider.subs.positions).toBeTruthy());
                expect(dataProvider.subs.positions.req.filter).toEqual({
                    field: 'fund',
                    op: '=',
                    value: ['A']
                });

                await dataProvider.send('positions');
                await vi.waitFor(() => expect(leaf('a1')).toBeTruthy());
                expect(leaf('a2')).toBeTruthy();
                expect(leaf('b1')).toBeUndefined();

                await dataProvider.send('funds', {
                    update: [{id: 'B', fund: 'B', nav: 200, manager: 'Ann'}]
                });
                await vi.waitFor(() => expect(leaf('b1')?.manager).toBe('Ann'));
            });

            it('asks for the keys in order, so an unchanged set never reloads', async () => {
                const {dataProvider} = open([fundJoin], ['mktVal'], ['sector'], ANN);
                await dataProvider.send('funds', {
                    replace: [
                        {id: 'B', fund: 'B', nav: 200, manager: 'Ann'},
                        {id: 'A', fund: 'A', nav: 100, manager: 'Ann'}
                    ]
                });
                await vi.waitFor(() => expect(dataProvider.subs.positions).toBeTruthy());
                expect(dataProvider.subs.positions.req.filter).toMatchObject({value: ['A', 'B']});
            });

            it('says why the source waits, while its joined source cannot load', async () => {
                const {model, positions} = open([fundJoin], ['mktVal'], ['sector'], ANN);
                model.blueprint.variables.other = {type: 'localDate', setBy: 'prompt'};
                model.setBlueprint({
                    ...model.blueprint,
                    sources: {
                        ...model.blueprint.sources,
                        funds: {dataset: 'funds', params: {asOf: {$var: 'other'}}}
                    }
                });
                await wait();
                expect(model.getSource('positions').joinWait).toBe('Waiting for funds');
                expect(positions).toBeTruthy();
            });

            it('filters in the browser alone, past its cap of keys', async () => {
                const {dataProvider, leaf} = open([fundJoin], ['mktVal'], ['sector'], ANN);
                const many = Array.from({length: 2001}, (_, n) => ({
                    id: `F${n}`,
                    fund: `F${n}`,
                    nav: 1,
                    manager: 'Ann'
                }));
                await dataProvider.send('funds', {replace: [...many, ...ROWS.funds]});
                await vi.waitFor(() => expect(dataProvider.subs.positions).toBeTruthy());
                expect(dataProvider.subs.positions.req.filter).toBeUndefined();
                await dataProvider.send('positions');
                await vi.waitFor(() => expect(leaf('a1')).toBeTruthy());
                expect(leaf('b1')).toBeUndefined();
            });
        });
    });
});
