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
import {StatCardStripWidgetModel} from './StatCardStripWidget';

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

    describe('statCardStrip', () => {
        it('shows each field rolled up by the Cube, with its format, and counts rows', async () => {
            const cards = widget(StatCardStripWidgetModel, open(), 'headline');
            await vi.waitFor(() => expect(text(cards.cards[3].value)).toBe('3'));

            expect(cards.cards.map(it => it.title)).toEqual([
                'Gross Exposure',
                'Net Exposure',
                'Day P&L',
                'Positions'
            ]);
            // A ledger format keeps a hidden ')' after a positive value, to align it.
            expect(text(cards.cards[0].value)).toMatch(/^0\.0m/);
            expect(text(cards.cards[2].value)).toMatch(/^4/);
            expect(text(cards.cards[3].value)).toBe('3');
        });

        it('computes an agg a card names over the rows', async () => {
            const bp = loadBlueprint('p2-linked-dashboard.json');
            bp.elements.headline.config.cards = [{field: 'pnlDay', agg: 'MIN', label: 'Worst'}];
            const cards = widget(StatCardStripWidgetModel, open(bp), 'headline');
            await vi.waitFor(() => expect(text(cards.cards[0].value)).toBe('(2)'));
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
            cards = widget(StatCardStripWidgetModel, model, 'now');

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

        await vi.waitFor(() => expect(text(cards.cards[0].value)).toBeTruthy());
        expect(cards.cards[0].title).toBe('Conditions');
    });

    it("formats a chart's value axis by its field's kind, as a percent for a fraction", async () => {
        const model = new BlueprintModel({
            blueprint: loadBlueprint('w2-two-cities.json'),
            catalog: weatherCatalog,
            registry: scenarioRegistry(),
            dataProvider: new FakeBlueprintDataProvider({catalog: weatherCatalog})
        });
        onTestFinished(() => model.destroy());
        const chart = widget(ChartWidgetModel, model, 'precipChartA');
        await vi.waitFor(() => expect(chart.chartModel.series[0]?.data.length).toBeGreaterThan(1));

        const {formatter} = chart.chartModel.highchartsConfig.yAxis.labels;
        expect(String(formatter.call({value: 0.5}))).toMatch(/^50(\.0+)?%$/);
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
