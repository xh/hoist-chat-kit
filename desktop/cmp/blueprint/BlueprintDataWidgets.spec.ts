import {render} from '@testing-library/react';
import {initTestAppAsync} from '@xh/hoist/test-support';
import type {ReactElement} from 'react';
import {beforeAll, describe, expect, it, onTestFinished, vi} from 'vitest';
import {
    loadBlueprint,
    portfolioCatalog,
    scenarioRegistry,
    weatherCatalog
} from '../../../test/blueprintFixtures';
import type {Blueprint, BlueprintDataProvider, BlueprintDataUpdate} from '../../../blueprint';
import {BlueprintModel, FakeBlueprintDataProvider} from '../../../blueprint';
import {ChartWidgetModel} from './ChartWidget';
import {CubeGridWidgetModel} from './CubeGridWidget';
import {statCardWidget, StatCardWidgetModel} from './StatCardWidget';

/**
 * The P2 data widgets: stat cards and a chart over a source, and grid cells drawn by registry
 * renderers. A filter bound to a selection updates a widget in the browser, with no reload.
 */
describe('blueprint data widgets', () => {
    beforeAll(async () => {
        await initTestAppAsync();
    });

    const POSITIONS = [
            {
                id: 'a',
                strategy: 'Credit',
                trader: 'Fred Corn',
                sector: 'Energy',
                mktVal: 100,
                pnlDay: 1,
                grossExposure: 100,
                netExposure: 100
            },
            {
                id: 'b',
                strategy: 'Credit',
                trader: 'Susan Major',
                sector: 'Energy',
                mktVal: -50,
                pnlDay: -2,
                grossExposure: 50,
                netExposure: -50
            },
            {
                id: 'c',
                strategy: 'Global Macro',
                trader: 'Fred Corn',
                sector: 'Technology',
                mktVal: 300,
                pnlDay: 5,
                grossExposure: 300,
                netExposure: 300
            }
        ],
        ORDERS = [
            {
                id: 'o1',
                strategy: 'Credit',
                trader: 'Fred Corn',
                symbol: 'XOM',
                dir: 'Buy',
                quantity: 10,
                price: 100,
                mktVal: 1000,
                time: 1
            }
        ];

    const provider: BlueprintDataProvider = {
        loadAsync: async () => ({rows: []}),
        subscribe: vi.fn((req, push: (u: BlueprintDataUpdate) => void) => {
            queueMicrotask(() => push({replace: req.dataset === 'orders' ? ORDERS : POSITIONS}));
            return () => {};
        })
    };

    function open(blueprint: Blueprint = loadBlueprint('p2-linked-dashboard.json')) {
        const ret = new BlueprintModel({
            blueprint,
            catalog: portfolioCatalog,
            registry: scenarioRegistry(),
            dataProvider: provider
        });
        onTestFinished(() => ret.destroy());
        return ret;
    }

    function widget<T>(Cls: new (c: any) => T, blueprintModel: BlueprintModel, id: string): T {
        const ret = new Cls({blueprintModel, id, renderElement: () => null});
        onTestFinished(() => (ret as any).destroy());
        return ret;
    }

    const text = (node: unknown) => render(node as ReactElement).container.textContent;

    describe('statCard', () => {
        const card = (model: BlueprintModel, id: string) =>
            widget(StatCardWidgetModel, model, id).card;

        it('shows its field rolled up by the Cube, with its format, or counts rows', async () => {
            const model = open(),
                gross = widget(StatCardWidgetModel, model, 'headlineGrossExposure'),
                pnl = widget(StatCardWidgetModel, model, 'headlinePnlDay'),
                count = widget(StatCardWidgetModel, model, 'headlinePositions');
            await vi.waitFor(() => expect(text(count.card.value)).toBe('3'));

            expect([gross, pnl, count].map(it => it.card.title)).toEqual([
                'Gross Exposure',
                'Day P&L',
                'Positions'
            ]);
            // A ledger format keeps a hidden ')' after a positive value, to align it.
            expect(text(gross.card.value)).toMatch(/^0\.0m/);
            expect(text(pnl.card.value)).toMatch(/^4/);
        });

        it('computes an agg it names over the rows', async () => {
            const bp = loadBlueprint('p2-linked-dashboard.json');
            bp.elements.headlinePnlDay.config = {
                source: 'positions',
                field: 'pnlDay',
                agg: 'MIN',
                label: 'Worst'
            };
            const model = open(bp);
            await vi.waitFor(() => expect(text(card(model, 'headlinePnlDay').value)).toBe('(2)'));
        });

        it('shows the value of an inline source of one row, as computed', async () => {
            const bp = loadBlueprint('p2-linked-dashboard.json');
            bp.sources.tomorrow = {
                inline: {
                    fields: [{name: 'maxChance', label: 'Highest Chance', type: 'number'}],
                    rows: [{maxChance: 0.8}]
                }
            } as any;
            bp.elements.headlinePnlDay.config = {source: 'tomorrow', field: 'maxChance'};
            const model = open(bp);
            await vi.waitFor(() =>
                expect(text(card(model, 'headlinePnlDay').value)).toMatch(/0\.8/)
            );
        });

        it('fills its tile, so a tileFrame lays cards out', () => {
            const {container} = render(
                statCardWidget({model: widget(StatCardWidgetModel, open(), 'headlinePnlDay')})
            );
            expect(container.querySelector('.xh-stat-card')).toBeTruthy();
        });
    });

    describe('statCard deltas', () => {
        const withDelta = (config: object) => {
            const bp = loadBlueprint('p2-linked-dashboard.json');
            bp.elements.headlinePnlDay.config = {
                source: 'positions',
                field: 'mktVal',
                deltaField: 'pnlDay',
                deltaFormat: {precision: 0},
                ...config
            };
            return widget(StatCardWidgetModel, open(bp), 'headlinePnlDay');
        };
        const html = (node: unknown) => render(node as ReactElement).container.innerHTML;

        it('shows its change with an arrow in color, said in words, and its label', async () => {
            const model = withDelta({deltaLabel: 'vs yesterday', intent: 'warning'});
            await vi.waitFor(() => expect(model.card.subValue).toBeTruthy());
            const {card} = model;
            expect(text(card.subValue)).toMatch(/^▴\s?4/);
            expect(html(card.subValue)).toContain('xh-pos-val');
            expect(html(card.subValue)).toContain('aria-label="up 4"');
            expect(card.detail).toBe('vs yesterday');
            expect(card.intent).toBe('warning');
        });

        it('shows a rise in the negative color for a figure where up is bad', async () => {
            const model = withDelta({invert: true});
            await vi.waitFor(() => expect(model.card.subValue).toBeTruthy());
            expect(html(model.card.subValue)).toContain('xh-neg-val');
        });

        it('refuses a delta field the source lacks', () => {
            const bp = loadBlueprint('p2-linked-dashboard.json');
            bp.elements.headlinePnlDay.config = {
                source: 'positions',
                field: 'mktVal',
                deltaField: 'nope'
            };
            expect(
                open()
                    .validate(bp)
                    .map(it => it.path)
            ).toContain('/elements/headlinePnlDay/config/deltaField');
        });

        it('refuses a card with no field, unless it counts', () => {
            const bp = loadBlueprint('p2-linked-dashboard.json');
            bp.elements.headlinePnlDay.config = {source: 'positions'};
            expect(
                open()
                    .validate(bp)
                    .map(it => it.code)
            ).toContain('statCard.noField');
        });
    });

    describe('chart', () => {
        it('groups by a dimension x, with a series per y', async () => {
            const chart = widget(ChartWidgetModel, open(), 'sectorChart');
            await vi.waitFor(() => expect(chart.chartModel.series[0]?.data).toHaveLength(2));

            expect(chart.chartModel.highchartsConfig.xAxis.categories).toEqual([
                'Energy',
                'Technology'
            ]);
            expect(chart.chartModel.series[0].data).toEqual([-1, 5]);
        });

        it('titles its axes from xTitle and yTitle, in place of the field labels', async () => {
            const bp = loadBlueprint('p2-linked-dashboard.json');
            Object.assign(bp.elements.sectorChart.config, {xTitle: 'Sector', yTitle: 'USD'});
            const chart = widget(ChartWidgetModel, open(bp), 'sectorChart');
            await vi.waitFor(() => expect(chart.chartModel.series[0]?.data).toHaveLength(2));
            const {xAxis, yAxis} = chart.chartModel.highchartsConfig;
            expect(xAxis.title.text).toBe('Sector');
            expect(yAxis.title.text).toBe('USD');
        });

        it('follows a selection through its bound filter, with no reload', async () => {
            const model = open(),
                chart = widget(ChartWidgetModel, model, 'sectorChart');
            await vi.waitFor(() => expect(chart.chartModel.series[0]?.data).toHaveLength(2));
            const subscriptions = vi.mocked(provider.subscribe).mock.calls.length;

            model.setOutput('posGrid', 'selection', {
                field: 'strategy',
                op: '=',
                value: 'Global Macro'
            });
            await vi.waitFor(() => expect(chart.chartModel.series[0].data).toEqual([5]));
            expect(vi.mocked(provider.subscribe).mock.calls.length).toBe(subscriptions);
        });
    });

    it("asks its source for server values at each of its grid's levels, until it goes", () => {
        const bp = loadBlueprint('p2-linked-dashboard.json');
        bp.elements.posGrid.config.columnState = ['mktVal', 'var95'];
        const model = open(bp),
            grid = new CubeGridWidgetModel({
                blueprintModel: model,
                id: 'posGrid',
                renderElement: () => null
            }),
            source = model.getSource('positions');

        expect(source.groupingSets).toEqual([[], ['strategy'], ['strategy', 'trader']]);
        grid.destroy();
        expect(source.groupingSets).toEqual([]);
    });

    it('keeps its selection output through a tick that changes the selected row', async () => {
        const model = open(),
            grid = widget(CubeGridWidgetModel, model, 'posGrid'),
            gridModel = grid.cubeGridModel.innerGridModel,
            {cube} = model.getSource('positions');
        await vi.waitFor(() => expect(gridModel.store.count).toBeGreaterThan(0));

        await gridModel.selectAsync(
            gridModel.store.allRecords.find(it => it.data.cubeLabel === 'Credit')
        );
        const selection = model.getVariable('selection').value;
        expect(selection).toBeTruthy();

        await cube.updateDataAsync({update: [{...POSITIONS[0], mktVal: 999}]});
        await vi.waitFor(() =>
            expect(gridModel.selectedRecord.data.mktVal).not.toBe(
                POSITIONS[0].mktVal + POSITIONS[1].mktVal
            )
        );
        expect(model.getVariable('selection').value).toBe(selection);
    });

    it('draws a group label with the renderer of the dimension it groups by', async () => {
        const bp = loadBlueprint('p2-linked-dashboard.json');
        bp.elements.ordersGrid.config.groupBy = ['dir'];
        const grid = widget(CubeGridWidgetModel, open(bp), 'ordersGrid'),
            gridModel = grid.cubeGridModel.innerGridModel;
        await vi.waitFor(() =>
            expect(gridModel.store.allRecords.some(it => it.data.cubeDimension === 'dir')).toBe(
                true
            )
        );

        const col = gridModel.getColumn('cubeLabel'),
            record = gridModel.store.allRecords.find(it => it.data.cubeDimension === 'dir'),
            {container} = render(
                col.renderer(record.data.cubeLabel, {
                    record,
                    column: col,
                    gridModel
                } as any) as ReactElement
            );
        expect(container.querySelector('.xh-badge')?.textContent).toBe('Buy');
    });

    it("shows a source's override of a field in every widget over the source", async () => {
        const bp = loadBlueprint('p2-linked-dashboard.json');
        bp.sources.positions.fields = {
            pnlDay: {label: 'Today', align: 'center', description: 'P&L since the open.'}
        };
        const model = open(bp),
            gridModel = widget(CubeGridWidgetModel, model, 'posGrid').cubeGridModel.innerGridModel,
            pnl = widget(StatCardWidgetModel, model, 'headlinePnlDay');
        expect(gridModel.getColumn('pnlDay')).toMatchObject({
            headerName: 'Today',
            headerTooltip: 'P&L since the open.',
            align: 'center'
        });
        expect(pnl.card.title).toBe('Today');
    });

    it("names a field instance's column by its label", () => {
        const bp = loadBlueprint('p5-risk-report.json'),
            model = open(bp),
            [id] = Object.entries(bp.elements).find(
                ([, el]) =>
                    el.component === 'cubeGrid' && JSON.stringify(el.config).includes('shockDown10')
            ),
            gridModel = widget(CubeGridWidgetModel, model, id).cubeGridModel.innerGridModel;
        expect(gridModel.getColumn('shockDown10').displayName).toBe('Shocked P&L (-10%)');
    });

    it("runs W1 on the fake provider: a time chart's rows by time, and current conditions", async () => {
        const model = new BlueprintModel({
            blueprint: loadBlueprint('w1-one-city.json'),
            catalog: weatherCatalog,
            registry: scenarioRegistry(),
            dataProvider: new FakeBlueprintDataProvider({catalog: weatherCatalog})
        });
        onTestFinished(() => model.destroy());
        const chart = widget(ChartWidgetModel, model, 'tempChart'),
            conditions = widget(StatCardWidgetModel, model, 'nowConditions');

        await vi.waitFor(() => expect(chart.chartModel.series[0]?.data.length).toBeGreaterThan(1));
        expect(chart.chartModel.highchartsConfig.xAxis.type).toBe('datetime');
        const times = chart.chartModel.series[0].data.map(it => it[0]),
            {cube} = model.getSource('forecast'),
            leafTimes = cube.records
                .map(it => new Date(it.data.time).getTime())
                .sort((a, b) => a - b);
        expect(times).toEqual(leafTimes);
        expect(times[0]).toBeGreaterThan(1e12);
        expect(chart.chartModel.series.map(it => it.name)).toEqual(['Temperature', 'Feels Like']);

        await vi.waitFor(() => expect(text(conditions.card.value)).toBeTruthy());
        expect(conditions.card.title).toBe('Conditions');
    });

    it("formats a chart's value axis by its field's kind, as 0% to 100% for a fraction", async () => {
        const model = new BlueprintModel({
            blueprint: loadBlueprint('w2-two-cities.json'),
            catalog: weatherCatalog,
            registry: scenarioRegistry(),
            dataProvider: new FakeBlueprintDataProvider({catalog: weatherCatalog})
        });
        onTestFinished(() => model.destroy());
        const chart = widget(ChartWidgetModel, model, 'precipChartA');
        await vi.waitFor(() => expect(chart.chartModel.series[0]?.data.length).toBeGreaterThan(1));

        const {yAxis} = chart.chartModel.highchartsConfig;
        expect(yAxis).toMatchObject({min: 0, max: 1});
        expect(String(yAxis.labels.formatter.call({value: 0.5}))).toBe('50%');
    });

    it('draws bars on the rows of the deepest level shown, scaled to the largest of them', async () => {
        const bp = loadBlueprint('p2-linked-dashboard.json');
        bp.elements.posGrid.config.columns = {mktVal: {renderer: 'bar'}};
        bp.elements.posGrid.config.columnState = ['mktVal'];
        const grid = widget(CubeGridWidgetModel, open(bp), 'posGrid'),
            gridModel = grid.cubeGridModel.innerGridModel;
        await vi.waitFor(() => expect(gridModel.store.count).toBeGreaterThan(0));

        const col = gridModel.getColumn('mktVal'),
            records = gridModel.store.allRecords,
            deepest = records.filter(it => !it.allChildren.length),
            groups = records.filter(it => it.allChildren.length),
            widthOf = (record: any) => {
                const cell = col.renderer(record.data.mktVal, {
                        record,
                        column: col,
                        gridModel
                    } as any),
                    fill = render(cell as ReactElement).container.querySelector(
                        '.xh-blueprint-bar__fill'
                    ) as HTMLElement;
                return fill?.style.width ?? null;
            },
            widths = deepest.map(widthOf);
        expect(deepest.length).toBeGreaterThan(1);
        expect(widths).toContain('100%');
        expect(widths.some(it => it !== '100%')).toBe(true);
        groups.forEach(it => expect(widthOf(it)).toBeNull());
    });

    it('draws a cell with the renderer its field names, as a badge for an order direction', async () => {
        const grid = widget(CubeGridWidgetModel, open(), 'ordersGrid'),
            gridModel = grid.cubeGridModel.innerGridModel;
        await vi.waitFor(() => expect(gridModel.store.count).toBeGreaterThan(0));

        const col = gridModel.getColumn('dir'),
            record = gridModel.store.allRecords.find(it => it.data.dir === 'Buy'),
            cell = col.renderer('Buy', {record, column: col, gridModel} as any);
        const {container} = render(cell as ReactElement);
        expect(container.querySelector('.xh-badge')).toBeTruthy();
        expect(container.textContent).toBe('Buy');
        expect(col.exportValue).toBeTruthy();
    });
});
