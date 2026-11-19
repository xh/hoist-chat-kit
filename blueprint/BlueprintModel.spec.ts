import type {PlainObject} from '@xh/hoist/core';
import {
    SumAggregator,
    SuppliedAggregator,
    UniqueAggregator,
    WeightedAverageAggregator
} from '@xh/hoist/data';
import {XH} from '@xh/hoist/core';
import {runInAction} from '@xh/hoist/mobx';
import {wait} from '@xh/hoist/promise';
import {initTestAppAsync} from '@xh/hoist/test-support';
import {LocalDate} from '@xh/hoist/utils/datetime';
import {beforeAll, describe, expect, it, onTestFinished, vi} from 'vitest';
import {
    ARTIFACTS,
    loadBlueprint,
    portfolioCatalog,
    scenarioRegistry
} from '../test/blueprintFixtures';
import type {Blueprint} from './Blueprint';
import type {
    BlueprintDataProvider,
    BlueprintDataRequest,
    BlueprintDataUpdate
} from './BlueprintDataProvider';
import {BlueprintModel} from './BlueprintModel';
import {FakeBlueprintDataProvider} from './FakeBlueprintDataProvider';

/**
 * A blueprint at runtime: the document is the source of truth, variables carry every value that
 * moves, and each source loads one merged request through the app's data provider.
 */
describe('BlueprintModel', () => {
    beforeAll(async () => {
        await initTestAppAsync();
    });

    const today = () => LocalDate.currentAppDay().isoString;

    /** A provider that records each subscription, and lets the test push updates to it. */
    class RecordingProvider implements BlueprintDataProvider {
        subs: {
            req: BlueprintDataRequest;
            push: (u: BlueprintDataUpdate) => void;
            isOpen: boolean;
        }[] = [];
        loadAsync = vi.fn(async () => ({rows: []}));
        loadAggregatesAsync = vi.fn(async (req: BlueprintDataRequest) => ({
            aggregates: req.groupBy.map(set => ({dims: {}, values: {var95: set.length}}))
        }));

        subscribe(req: BlueprintDataRequest, push: (u: BlueprintDataUpdate) => void) {
            const sub = {req, push, isOpen: true};
            this.subs.push(sub);
            return () => (sub.isOpen = false);
        }

        get last() {
            return this.subs.at(-1);
        }
    }

    function open(
        blueprint: Blueprint,
        dataProvider: BlueprintDataProvider = new RecordingProvider()
    ) {
        const ret = new BlueprintModel({
            blueprint,
            catalog: portfolioCatalog,
            registry: scenarioRegistry(),
            dataProvider,
            artifacts: ARTIFACTS
        });
        onTestFinished(() => ret.destroy());
        return ret;
    }

    /** Open a blueprint, and wait for its sources to start, as they do once its widgets exist. */
    async function opened(
        blueprint: Blueprint,
        dataProvider: BlueprintDataProvider = new RecordingProvider()
    ) {
        const ret = open(blueprint, dataProvider);
        await wait();
        return ret;
    }

    const p1 = () => loadBlueprint('p1-one-grid.json'),
        p2 = () => loadBlueprint('p2-linked-dashboard.json'),
        p3 = () => loadBlueprint('p3-morning-report.json');

    describe('the blueprint', () => {
        it('refuses a blueprint with errors, and keeps the current one', () => {
            const model = open(p1()),
                bad = p1();
            bad.elements.posGrid.config.groupBy = ['mktVal'];

            expect(model.setBlueprint(bad).map(it => it.code)).toEqual(['field.notDimension']);
            expect(model.blueprint.elements.posGrid.config.groupBy).toEqual(['sector', 'symbol']);
            expect(model.version).toBe(1);
        });

        it('applies an edit as one unit, and moves to a new version', () => {
            const model = open(p1()),
                {version, issues} = model.applyEdit({
                    base: 1,
                    ops: [{op: 'set', path: '/elements/posGrid/config/groupBy', value: ['region']}]
                });
            expect(issues).toEqual([]);
            expect(version).toBe(2);
            expect(model.blueprint.elements.posGrid.config.groupBy).toEqual(['region']);
        });

        it('keeps its version for an edit that changes nothing', () => {
            const model = open(p1());
            model.applyEdit({
                ops: [
                    {
                        op: 'set',
                        path: '/elements/posGrid/config/groupBy',
                        value: ['sector', 'symbol']
                    }
                ]
            });
            expect(model.version).toBe(1);
            expect(model.history).toEqual([]);
        });

        it('keeps its version when set to a blueprint equal to the current one', () => {
            const model = open(p1()),
                {variables} = model;
            expect(model.setBlueprint(p1())).toEqual([]);
            expect(model.version).toBe(1);
            expect(model.variables).toBe(variables);
        });

        it('records each applied edit in its history, until the blueprint is replaced', () => {
            const model = open(p1()),
                ops = [{op: 'set', path: '/elements/posGrid/config/groupBy', value: ['region']}];
            model.applyEdit({author: 'user', ops: ops as any});
            expect(model.history).toEqual([{author: 'user', ops, version: 2}]);

            model.setBlueprint(p1());
            expect(model.history).toEqual([]);
        });

        it('refuses an edit whose result has errors, or that is based on an old version', () => {
            const model = open(p1());
            expect(
                model.applyEdit({
                    ops: [{op: 'set', path: '/elements/posGrid/config/source', value: 'x'}]
                }).issues[0].code
            ).toBe('source.unknown');
            expect(
                model.applyEdit({base: 0, ops: [{op: 'remove', path: '/variables/asOf/label'}]})
                    .issues[0].code
            ).toBe('edit.staleBase');
            expect(model.version).toBe(1);
        });
    });

    describe('variables', () => {
        it('takes its default from a resolver until a prompt sets it', () => {
            const model = open(p1()),
                asOf = model.getVariable('asOf');
            expect(asOf.value).toBe(today());
            expect(asOf.isSet).toBe(false);

            model.setVariable('asOf', '2026-07-01');
            expect(asOf.value).toBe('2026-07-01');
            expect(asOf.isSet).toBe(true);

            model.resetVariable('asOf');
            expect(asOf.value).toBe(today());
        });

        it('computes a resolver variable again when its inputs change', () => {
            const model = open(p3());
            model.setVariable('asOf', '2026-05-20');
            expect(model.getVariable('yearStart').value).toBe('2026-01-01');
            expect(model.getVariable('priceStart').value).toBe('2026-02-20');

            model.setVariable('asOf', '2025-03-03');
            expect(model.getVariable('yearStart').value).toBe('2025-01-01');
        });

        it('takes a widget output, and refuses to be set directly', () => {
            const model = open(p2()),
                selection = model.getVariable('selection'),
                filter = {field: 'strategy', op: '=', value: 'Credit'};

            expect(selection.value).toBeNull();
            model.setOutput('posGrid', 'selection', filter);
            expect(selection.value).toEqual(filter);
            expect(() => model.setVariable('selection', null)).toThrow();
        });

        it('joins several writers of a filter with AND, skipping a writer with no value', () => {
            const bp = p2();
            bp.variables.selection.setBy = [
                {element: 'posGrid', output: 'selection'},
                {element: 'ordersGrid', output: 'selection'}
            ];
            bp.elements.ordersGrid.config.filter = null;
            delete bp.elements.ordersGrid.config.filter;
            const model = open(bp),
                a = {field: 'strategy', op: '=', value: 'Credit'},
                b = {field: 'symbol', op: '=', value: 'AAPL'};

            model.setOutput('ordersGrid', 'selection', b);
            expect(model.getVariable('selection').value).toEqual(b);
            model.setOutput('posGrid', 'selection', a);
            expect(model.getVariable('selection').value).toEqual({op: 'AND', filters: [a, b]});
        });

        it('takes one field of an output that has a field argument', () => {
            const bp = p2();
            bp.variables.symbol = {
                type: 'string',
                setBy: {element: 'posGrid', output: 'selected', field: 'trader'}
            };
            const model = open(bp);
            model.setOutput('posGrid', 'selected', {strategy: 'Credit', trader: 'Fred Corn'});
            expect(model.getVariable('symbol').value).toBe('Fred Corn');
        });

        it('keeps a value through an edit that leaves its declaration alone', () => {
            const model = open(p1());
            model.setVariable('asOf', '2026-07-01');
            model.applyEdit({
                ops: [{op: 'set', path: '/elements/posGrid/config/groupBy', value: ['region']}]
            });
            expect(model.getVariable('asOf').value).toBe('2026-07-01');
        });
    });

    describe('sources', () => {
        it('merges its widgets demands into one request', async () => {
            const provider = new RecordingProvider();
            await opened(p2(), provider);
            const req = provider.subs.find(it => it.req.dataset === 'positions').req;

            expect(req.params).toEqual({asOf: today()});
            expect(req.fields).toEqual(
                expect.arrayContaining([
                    'mktVal',
                    'pnlDay',
                    'grossExposure',
                    'netExposure',
                    'sector'
                ])
            );
            // P2 shows no server field, so it needs no grouping sets.
            expect(req.groupBy).toEqual([]);
        });

        it('requests every field its Cube needs, including the dimensions it groups by', async () => {
            const provider = new RecordingProvider();
            await opened(p1(), provider);
            expect(provider.last.req.fields).toEqual(['mktVal', 'pnlDay', 'sector', 'symbol']);
        });

        it('requests the dimensions that a bound selection filter and a chart read', async () => {
            const provider = new RecordingProvider();
            await opened(p2(), provider);
            const fieldsOf = (dataset: string) =>
                provider.subs.find(it => it.req.dataset === dataset).req.fields;

            expect(fieldsOf('positions')).toEqual(
                expect.arrayContaining(['strategy', 'trader', 'sector', 'pnlDay'])
            );
            expect(fieldsOf('orders')).toEqual(
                expect.arrayContaining(['strategy', 'trader', 'dir', 'time'])
            );
        });

        it('requests the field an output argument reads', async () => {
            const provider = new RecordingProvider(),
                bp = p2();
            bp.variables.picked = {
                type: 'string',
                setBy: {element: 'posGrid', output: 'selected', field: 'fund'}
            };
            await opened(bp, provider);
            expect(provider.subs.find(it => it.req.dataset === 'positions').req.fields).toContain(
                'fund'
            );
        });

        it('keeps its subscription when an edit regroups, reorders or drops a field', async () => {
            const provider = new RecordingProvider(),
                model = await opened(p1(), provider),
                set = (path: string, value: unknown) =>
                    model.applyEdit({
                        ops: [{op: 'set', path: `/elements/posGrid/config${path}`, value}]
                    });

            set('/columnState', ['pnlDay', 'mktVal']);
            set('/groupBy', ['symbol']);
            set('/columnState', ['pnlDay']);
            expect(provider.subs).toHaveLength(1);
            expect(provider.last.isOpen).toBe(true);
        });

        it('loads again on refresh', async () => {
            const provider = new RecordingProvider(),
                model = await opened(p1(), provider);
            await model.refreshAsync();
            expect(provider.subs).toHaveLength(2);
            expect(provider.subs[0].isOpen).toBe(false);
        });

        it('reloads in place, with the same Cube, when an edit changes its parameters', async () => {
            const provider = new RecordingProvider(),
                bp = p1();
            bp.variables.asOf2 = {type: 'localDate', default: {value: '2026-07-01'}};
            const model = await opened(bp, provider),
                {cube} = model.getSource('positions');
            model.applyEdit({
                ops: [{op: 'set', path: '/sources/positions/params/asOf', value: {$var: 'asOf2'}}]
            });
            expect(model.getSource('positions').cube).toBe(cube);
            expect(provider.last.req.params).toEqual({asOf: '2026-07-01'});
        });

        it("labels a field instance by its own label, or its field's and its parameters'", async () => {
            const model = await opened(loadBlueprint('p5-risk-report.json')),
                source = model.getSource('positions');
            expect(source.fieldLabel('shockDown10')).toBe('Shocked P&L (-10%)');
            expect(source.fieldLabel('shockUp5')).toBe('Shocked P&L (+5%)');
            expect(source.fieldLabel('mktVal')).toBe('Market Value');

            const bp = loadBlueprint('p5-risk-report.json');
            (bp.sources.positions.fields.shockDown10 as any).label = 'Down 10%';
            model.setBlueprint(bp);
            expect(model.getSource('positions').fieldLabel('shockDown10')).toBe('Down 10%');
        });

        it('labels an instance with bound parameters by their current values', async () => {
            const bp = p2();
            bp.variables.yearStart = {
                type: 'localDate',
                setBy: 'resolver',
                compute: {resolver: 'yearStart', args: {from: {$var: 'asOf'}}}
            };
            bp.sources.positions.fields = {
                retYtd: {field: 'return', params: {start: {$var: 'yearStart'}, end: {$var: 'asOf'}}}
            };
            const model = await opened(bp),
                source = model.getSource('positions');
            model.setVariable('asOf', '2026-05-20');
            expect(source.fieldLabel('retYtd')).toBe('Return (2026-01-01, 2026-05-20)');
            model.setVariable('asOf', '2025-03-03');
            expect(source.fieldLabel('retYtd')).toBe('Return (2025-01-01, 2025-03-03)');
        });

        it('builds a new Cube when a replaced blueprint adds a field instance', async () => {
            const model = await opened(p1()),
                {cube} = model.getSource('positions'),
                bp = p1();
            bp.variables.yearStart = {
                type: 'localDate',
                setBy: 'resolver',
                compute: {resolver: 'yearStart', args: {from: {$var: 'asOf'}}}
            };
            bp.sources.positions.fields = {
                retYtd: {field: 'return', params: {start: {$var: 'yearStart'}, end: {$var: 'asOf'}}}
            };
            bp.elements.posGrid.config.columnState = ['mktVal', 'retYtd'];
            expect(model.setBlueprint(bp)).toEqual([]);

            const source = model.getSource('positions');
            expect(source.cube).not.toBe(cube);
            expect(source.fields.retYtd).toBeTruthy();
            expect(source.cube.getField('retYtd')).toBeTruthy();
        });

        it('keeps its subscription when a replaced blueprint only regroups', async () => {
            const provider = new RecordingProvider(),
                model = await opened(p1(), provider),
                bp = p1();
            bp.elements.posGrid.config.groupBy = ['symbol'];
            model.setBlueprint(bp);
            expect(provider.subs).toHaveLength(1);
        });

        it('subscribes again for a field it has not loaded', async () => {
            const provider = new RecordingProvider(),
                model = await opened(p1(), provider);
            model.applyEdit({
                ops: [{op: 'set', path: '/elements/posGrid/config/columnState', value: ['region']}]
            });
            expect(provider.subs).toHaveLength(2);
            expect(provider.last.req.fields).toContain('region');
        });

        it('sends its fields in a stable order', async () => {
            const provider = new RecordingProvider();
            await opened(p2(), provider);
            const {fields} = provider.subs.find(it => it.req.dataset === 'positions').req;
            expect(fields).toEqual([...fields].sort());
        });

        it('keeps its subscription when a selection filters its widgets', async () => {
            const provider = new RecordingProvider(),
                model = await opened(p2(), provider),
                count = provider.subs.length;
            model.setOutput('posGrid', 'selection', {field: 'strategy', op: '=', value: 'Credit'});
            expect(provider.subs).toHaveLength(count);
        });

        it('subscribes only, and loads the snapshot and changes into its Cube', async () => {
            const provider = new RecordingProvider(),
                model = await opened(p1(), provider),
                {cube} = model.getSource('positions'),
                row = (id: string, mktVal: number) => ({
                    id,
                    sector: 'Energy',
                    symbol: 'XOM',
                    mktVal
                });

            provider.last.push({replace: [row('a', 1), row('b', 2)]});
            await vi.waitFor(() => expect(cube.records.length).toBe(2));
            expect(provider.loadAsync).not.toHaveBeenCalled();

            provider.last.push({add: [row('c', 3)], update: [row('a', 10)], remove: ['b']});
            await vi.waitFor(() =>
                expect(cube.records.map(it => [it.id, it.data.mktVal])).toEqual([
                    ['a', 10],
                    ['c', 3]
                ])
            );
        });

        it('loads with loadAsync when the provider cannot subscribe', async () => {
            const rows: PlainObject[] = [{id: 'a', sector: 'Energy', symbol: 'XOM', mktVal: 1}],
                provider = {loadAsync: vi.fn(async () => ({rows}))},
                model = await opened(p1(), provider);
            await vi.waitFor(() =>
                expect(model.getSource('positions').cube.records.length).toBe(1)
            );
            expect(provider.loadAsync).toHaveBeenCalledOnce();
        });

        it('subscribes again when a parameter changes, and ends the old subscription', async () => {
            const provider = new RecordingProvider(),
                model = await opened(p1(), provider),
                first = provider.last;

            model.setVariable('asOf', '2026-07-01');
            expect(first.isOpen).toBe(false);
            expect(provider.last.req.params).toEqual({asOf: '2026-07-01'});
            expect(provider.subs).toHaveLength(2);
        });

        it('subscribes again when an edit changes what its widgets need', async () => {
            const provider = new RecordingProvider(),
                model = await opened(p1(), provider);
            model.applyEdit({
                ops: [
                    {
                        op: 'set',
                        path: '/elements/posGrid/config/columnState',
                        value: ['mktVal', 'pnlMtd']
                    }
                ]
            });
            expect(provider.subs).toHaveLength(2);
            expect(provider.last.req.fields).toContain('pnlMtd');
        });

        it('waits while a required parameter has no value', async () => {
            const provider = new RecordingProvider(),
                model = await opened(p1(), provider);
            model.setVariable('asOf', null);
            expect(model.getSource('positions').isWaiting).toBe(true);
            expect(provider.subs).toHaveLength(1);
            expect(provider.last.isOpen).toBe(false);
        });

        it('sends field instances as objects, with their parameters resolved', async () => {
            const provider = new RecordingProvider(),
                bp = p2();
            bp.variables.yearStart = {
                type: 'localDate',
                setBy: 'resolver',
                compute: {resolver: 'yearStart', args: {from: {$var: 'asOf'}}}
            };
            bp.sources.positions.fields = {
                retYtd: {field: 'return', params: {start: {$var: 'yearStart'}, end: {$var: 'asOf'}}}
            };
            bp.elements.posGrid.config.columnState = ['mktVal', 'retYtd'];
            const model = await opened(bp, provider);
            model.setVariable('asOf', '2026-05-20');
            const {req} = provider.subs.find(it => it.isOpen && it.req.dataset === 'positions');
            expect(req.fields).toContainEqual({
                name: 'retYtd',
                field: 'return',
                params: {start: '2026-01-01', end: '2026-05-20'}
            });
        });

        it('runs P1 on the fake provider, grouped by sector through a Cube view', async () => {
            const model = await opened(
                    p1(),
                    new FakeBlueprintDataProvider({catalog: portfolioCatalog})
                ),
                {cube} = model.getSource('positions');
            await vi.waitFor(() => expect(cube.records.length).toBeGreaterThan(0));

            const view = cube.createView({query: {dimensions: ['sector'], includeRoot: true}}),
                [root] = view.result.rows,
                total = cube.records.reduce((sum, it) => sum + it.data.mktVal, 0);
            expect(root.children.length).toBeGreaterThan(1);
            expect(root.mktVal).toBeCloseTo(total);
            view.destroy();
        });

        it('takes each Cube aggregator from the catalog, and rolls up no number without one', async () => {
            const bp = p1();
            bp.sources.stats = {
                inline: {
                    fields: [
                        {name: 'label', type: 'string'},
                        {name: 'price', type: 'number'}
                    ],
                    rows: [{label: 'a', price: 1}]
                }
            };
            const model = await opened(bp),
                positions = model.getSource('positions').cube,
                stats = model.getSource('stats').cube;
            expect(positions.getField('mktVal').aggregator).toBeInstanceOf(SumAggregator);
            expect(positions.getField('beta').aggregator).toBeInstanceOf(WeightedAverageAggregator);
            expect(positions.getField('var95').aggregator).toBeInstanceOf(SuppliedAggregator);
            expect(stats.getField('price').aggregator).toBeNull();
            expect(stats.getField('label').aggregator).toBeInstanceOf(UniqueAggregator);
        });

        it('ends its subscription when the blueprint closes', async () => {
            const provider = new RecordingProvider(),
                model = new BlueprintModel({
                    blueprint: p1(),
                    catalog: portfolioCatalog,
                    registry: scenarioRegistry(),
                    dataProvider: provider
                });
            await wait();
            model.destroy();
            expect(provider.last.isOpen).toBe(false);
        });
    });

    describe('server roll-ups', () => {
        const ROWS = [
            {id: 'a', sector: 'Energy', symbol: 'XOM', mktVal: 1, var95: 10},
            {id: 'b', sector: 'Energy', symbol: 'SHEL', mktVal: 2, var95: 20}
        ];

        /** P1 with a server field as a column. */
        const p1Var = () => {
            const bp = p1();
            bp.elements.posGrid.config.columnState = ['mktVal', 'var95'];
            return bp;
        };

        /** A View over a source, registered as a widget showing `fields` would register it. */
        function view(
            model: BlueprintModel,
            dimensions: string[],
            fields: string[] = ['var95'],
            filter = null
        ) {
            const source = model.getSource('positions'),
                ret = source.cube.createView({
                    query: {dimensions, filter, includeRoot: true},
                    connect: true
                }),
                remove = source.addView(ret, () => fields);
            onTestFinished(() => {
                remove();
                ret.destroy();
            });
            return ret;
        }

        /** Open a blueprint with Views registered before its sources start, as widgets do. */
        async function openWithViews(
            provider: RecordingProvider,
            ...views: [string[], string[]?][]
        ) {
            const model = open(p1Var(), provider),
                ret = views.map(([dims, fields]) => view(model, dims, fields));
            await wait();
            return {model, views: ret};
        }

        it('subscribes with the grouping sets of Views showing a server field', async () => {
            const provider = new RecordingProvider();
            await openWithViews(provider, [['sector', 'symbol']], [['region'], ['mktVal']]);
            expect(provider.last.req.groupBy).toEqual([[], ['sector'], ['sector', 'symbol']]);
        });

        it('fetches each set once on open, with server values arriving with the rows', async () => {
            const provider = new RecordingProvider(),
                {views} = await openWithViews(provider, [['sector']]);
            provider.last.push({
                replace: ROWS,
                aggregates: [
                    {dims: {}, values: {var95: 25}},
                    {dims: {sector: 'Energy'}, values: {var95: 24}}
                ]
            });
            await vi.waitFor(() => expect(views[0].result.rows[0]?.var95).toBe(25));
            expect(views[0].result.rows[0].children[0].var95).toBe(24);
            expect(provider.subs).toHaveLength(1);
            expect(provider.loadAggregatesAsync).not.toHaveBeenCalled();
        });

        it('fetches only the sets it lacks, keeping its subscription', async () => {
            const provider = new RecordingProvider(),
                {model} = await openWithViews(provider, [['sector']]);

            view(model, ['sector', 'symbol']);
            await vi.waitFor(() => expect(provider.loadAggregatesAsync).toHaveBeenCalledTimes(1));
            expect(provider.loadAggregatesAsync.mock.calls[0][0].groupBy).toEqual([
                ['sector', 'symbol']
            ]);
            expect(provider.subs).toHaveLength(1);
        });

        it('fetches the sets a View needs after it regroups, or folds a filter in', async () => {
            const provider = new RecordingProvider(),
                {views} = await openWithViews(provider, [['sector']]),
                [v] = views;

            v.updateQuery({dimensions: ['symbol']});
            await vi.waitFor(() => expect(provider.loadAggregatesAsync).toHaveBeenCalledTimes(1));
            expect(provider.loadAggregatesAsync.mock.calls[0][0].groupBy).toEqual([['symbol']]);

            v.updateQuery({filter: {field: 'sector', op: '=', value: 'Energy'}});
            await vi.waitFor(() => expect(provider.loadAggregatesAsync).toHaveBeenCalledTimes(2));
            expect(provider.loadAggregatesAsync.mock.calls[1][0].groupBy).toEqual([
                ['sector', 'symbol']
            ]);
        });

        it('merges server values from a push with its row changes', async () => {
            const provider = new RecordingProvider(),
                {views} = await openWithViews(provider, [['sector']]),
                [v] = views;
            provider.last.push({
                replace: ROWS,
                aggregates: [
                    {dims: {}, values: {var95: 25}},
                    {dims: {sector: 'Energy'}, values: {var95: 24}}
                ]
            });
            await vi.waitFor(() => expect(v.result.rows[0]?.var95).toBe(25));

            provider.last.push({
                update: [{...ROWS[0], var95: 11}],
                aggregates: [{dims: {sector: 'Energy'}, values: {var95: 26}}]
            });
            await vi.waitFor(() => expect(v.result.rows[0].children[0].var95).toBe(26));
            expect(v.result.rows[0].var95).toBe(25);
        });

        it('fetches its sets again after a snapshot that replaced their values', async () => {
            const provider = new RecordingProvider(),
                {model} = await openWithViews(provider, [['sector']]);
            provider.loadAggregatesAsync.mockImplementation(async req => ({
                aggregates: req.groupBy.map(set => ({
                    dims: set.length ? {symbol: 'XOM'} : {},
                    values: {var95: 99}
                }))
            }));
            const v = view(model, ['symbol']);
            await vi.waitFor(() => expect(provider.loadAggregatesAsync).toHaveBeenCalledTimes(1));

            // A snapshot, as after a reconnect, carries only the sets subscribed with.
            provider.last.push({replace: ROWS, aggregates: []});
            await vi.waitFor(() => expect(provider.loadAggregatesAsync).toHaveBeenCalledTimes(2));
            expect(provider.loadAggregatesAsync.mock.calls[1][0].groupBy).toEqual([['symbol']]);
            await vi.waitFor(() =>
                expect(v.result.rows[0]?.children.find(it => it.cubeLabel === 'XOM')?.var95).toBe(
                    99
                )
            );
        });

        it('fetches no set alone when a regroup also needs a field it has not loaded', async () => {
            const provider = new RecordingProvider(),
                {model, views} = await openWithViews(provider, [['sector']]);

            runInAction(() => {
                model.applyEdit({
                    ops: [
                        {
                            op: 'set',
                            path: '/elements/posGrid/config/groupBy',
                            value: ['region']
                        }
                    ]
                });
                views[0].updateQuery({dimensions: ['region']});
                // As when the set reaction runs before the one that restarts the source.
                const source = model.getSource('positions') as any;
                source.loadMissingSets(source.groupingSets);
            });
            await wait(20);
            expect(provider.subs).toHaveLength(2);
            expect(provider.last.req.groupBy).toContainEqual(['region']);
            expect(provider.loadAggregatesAsync).not.toHaveBeenCalled();
        });

        it('does not fetch a set again when a snapshot lands while it is on its way', async () => {
            const provider = new RecordingProvider(),
                {model} = await openWithViews(provider, [['sector']]);
            let resolve: (v: any) => void;
            provider.loadAggregatesAsync.mockReturnValueOnce(new Promise(r => (resolve = r)));

            view(model, ['symbol']);
            await vi.waitFor(() => expect(provider.loadAggregatesAsync).toHaveBeenCalledTimes(1));
            provider.last.push({replace: ROWS, aggregates: []});
            await wait(20);
            resolve({aggregates: []});
            await wait(20);
            expect(provider.loadAggregatesAsync).toHaveBeenCalledTimes(1);
        });

        it('keeps its rows when sets fail to load, and fetches them again on the next change', async () => {
            const provider = new RecordingProvider(),
                {model} = await openWithViews(provider, [['sector']]),
                source = model.getSource('positions');
            provider.loadAggregatesAsync.mockRejectedValueOnce(new Error('boom'));
            const toast = vi.spyOn(XH, 'warningToast').mockReturnValue(null);
            onTestFinished(() => toast.mockRestore());

            view(model, ['symbol']);
            await vi.waitFor(() => expect(source.aggregatesError?.sets).toEqual([['symbol']]));
            expect(source.lastError).toBeNull();
            expect(toast).toHaveBeenCalledWith(expect.stringMatching(/boom/));

            view(model, ['region']);
            await vi.waitFor(() => expect(provider.loadAggregatesAsync).toHaveBeenCalledTimes(2));
            expect(provider.loadAggregatesAsync.mock.calls[1][0].groupBy).toEqual([
                ['region'],
                ['symbol']
            ]);
            await vi.waitFor(() => expect(source.aggregatesError).toBeNull());
        });

        it('shows server values from the fake provider on group rows', async () => {
            const model = open(p1Var(), new FakeBlueprintDataProvider({catalog: portfolioCatalog})),
                v = view(model, ['sector']);
            await vi.waitFor(() => expect(v.result.rows[0]?.children[0]?.var95).toBeGreaterThan(0));

            const [root] = v.result.rows,
                {cube} = model.getSource('positions'),
                leafTotal = cube.records.reduce((total, it) => total + it.data.var95, 0);
            expect(root.var95).toBeCloseTo(leafTotal * 0.8);
        });

        it('loads again with every set when its provider cannot fetch sets alone', async () => {
            const provider = new RecordingProvider();
            delete (provider as any).loadAggregatesAsync;
            const {model} = await openWithViews(provider, [['sector']]);
            view(model, ['symbol']);
            expect(provider.subs).toHaveLength(2);
            expect(provider.last.req.groupBy).toEqual([[], ['sector'], ['symbol']]);
        });
    });
});
