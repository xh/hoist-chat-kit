import {sortBy} from 'lodash';
import {render} from '@testing-library/react';
import {initTestAppAsync} from '@xh/hoist/test-support';
import type {PlainObject} from '@xh/hoist/core';
import type {ReactElement} from 'react';
import {beforeAll, describe, expect, it, onTestFinished, vi} from 'vitest';
import {
    loadBlueprint,
    portfolioCatalog,
    scenarioRegistry,
    weatherCatalog
} from '../../../test/blueprintFixtures';
import type {Blueprint, BlueprintDataProvider, BlueprintDataUpdate} from '../../../blueprint';
import {BlueprintModel, DataCatalog, FakeBlueprintDataProvider} from '../../../blueprint';
import {ChartWidgetModel} from './ChartWidget';
import {GaugeWidgetModel} from './GaugeWidget';
import {HeatmapWidgetModel} from './HeatmapWidget';
import {propertyTableWidget, PropertyTableWidgetModel} from './PropertyTableWidget';
import {TreemapWidgetModel} from './TreemapWidget';
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
                netExposure: 100,
                pnlHistory: [1, 2]
            },
            {
                id: 'b',
                strategy: 'Credit',
                trader: 'Susan Major',
                sector: 'Energy',
                mktVal: -50,
                pnlDay: -2,
                grossExposure: 50,
                netExposure: -50,
                pnlHistory: [-3, 4]
            },
            {
                id: 'c',
                strategy: 'Global Macro',
                trader: 'Fred Corn',
                sector: 'Technology',
                mktVal: 300,
                pnlDay: 5,
                grossExposure: 300,
                netExposure: 300,
                pnlHistory: [5, 6]
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

        it('steps a number to its compact form in a narrow card, unless its format names a scale', async () => {
            const bp = loadBlueprint('p2-linked-dashboard.json');
            bp.sources.big = {
                inline: {fields: [{name: 'total', type: 'number'}], rows: [{total: 4500000}]}
            } as any;
            bp.elements.headlinePnlDay.config = {source: 'big', field: 'total'};
            const model = open(bp),
                plain = widget(StatCardWidgetModel, model, 'headlinePnlDay'),
                gross = widget(StatCardWidgetModel, model, 'headlineGrossExposure');
            await vi.waitFor(() => expect(text(plain.card.value)).toBe('4,500,000'));
            plain.setWidth(120);
            expect(text(plain.card.value)).toBe('4.5M');
            plain.setWidth(400);
            expect(text(plain.card.value)).toBe('4,500,000');

            // A scale the card's format names, or its field's, holds however narrow the card.
            bp.elements.headlinePnlDay.config = {
                ...bp.elements.headlinePnlDay.config,
                format: {scale: 'millions'}
            };
            const scaled = widget(StatCardWidgetModel, open(bp), 'headlinePnlDay');
            await vi.waitFor(() => expect(text(scaled.card.value)).toMatch(/^4\.\d+m$/));
            scaled.setWidth(120);
            expect(text(scaled.card.value)).toMatch(/^4\.\d+m$/);
            await vi.waitFor(() => expect(text(gross.card.value)).toMatch(/^0\.0m/));
            gross.setWidth(120);
            expect(text(gross.card.value)).toMatch(/^0\.0m/);
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

    describe('propertyTable', () => {
        const withTable = (config: object) => {
            const bp = loadBlueprint('p2-linked-dashboard.json');
            bp.elements.props = {
                component: 'propertyTable',
                config: {source: 'positions', ...config}
            };
            bp.elements.dashboard.children.push({id: 'props', x: 0, y: 14, w: 4, h: 4});
            return bp;
        };

        it('shows the totals of the rows its filter leaves, each field labeled and formatted', async () => {
            const table = widget(
                PropertyTableWidgetModel,
                open(
                    withTable({
                        fields: ['mktVal', {field: 'pnlDay', label: 'Today'}],
                        filter: {field: 'sector', op: '=', value: 'Energy'}
                    })
                ),
                'props'
            );
            await vi.waitFor(() => expect(text(table.entries[1]?.value)).toMatch(/^\(1\)/));
            expect(table.entries.map(it => it.label)).toEqual(['Market Value', 'Today']);
            expect(text(table.entries[1].value)).toMatch(/^\(1\)/);
        });

        it("shows one row's own values, where its filter leaves one", async () => {
            const table = widget(
                PropertyTableWidgetModel,
                open(
                    withTable({
                        fields: ['strategy', 'trader', 'beta'],
                        filter: {field: 'strategy', op: '=', value: 'Global Macro'}
                    })
                ),
                'props'
            );
            await vi.waitFor(() => expect(text(table.entries[0]?.value)).toBe('Global Macro'));
            expect(text(table.entries[1].value)).toBe('Fred Corn');
        });

        it('shows a dimension where every row its filter leaves shares one value', async () => {
            const table = widget(
                PropertyTableWidgetModel,
                open(
                    withTable({
                        fields: ['sector', 'strategy', 'trader'],
                        filter: {field: 'sector', op: '=', value: 'Energy'}
                    })
                ),
                'props'
            );
            await vi.waitFor(() => expect(text(table.entries[0]?.value)).toBe('Energy'));
            expect(text(table.entries[1].value)).toBe('Credit');
            expect(text(table.entries[2].value)).not.toMatch(/Fred|Susan/);
        });

        it('formats each field by its own format, over an inline source too', async () => {
            const bp = withTable({
                source: 'fund',
                fields: [{field: 'nav', format: {scale: 'millions', precision: 1, label: true}}]
            });
            bp.sources.fund = {
                inline: {
                    fields: [{name: 'nav', label: 'NAV', type: 'number', kind: 'number'}],
                    rows: [{nav: 3754900000}]
                }
            } as any;
            const table = widget(PropertyTableWidgetModel, open(bp), 'props');
            await vi.waitFor(() => expect(text(table.entries[0]?.value)).toBe('3,754.9m'));
        });

        it('draws its title over its values, outside a dashboard, which heads its cell itself', () => {
            const bp = withTable({title: 'Fund snapshot', fields: ['mktVal']}),
                model = open(bp),
                onDashboard = render(
                    propertyTableWidget({model: widget(PropertyTableWidgetModel, model, 'props')})
                ).container;
            expect(onDashboard.textContent).not.toContain('Fund snapshot');

            bp.elements.box = {component: 'box', config: {}, children: [{id: 'props'}]};
            bp.elements.dashboard.children = bp.elements.dashboard.children.map(it =>
                it.id === 'props' ? {...it, id: 'box'} : it
            );
            const inBox = render(
                propertyTableWidget({model: widget(PropertyTableWidgetModel, open(bp), 'props')})
            ).container;
            expect(inBox.textContent).toContain('Fund snapshot');
        });

        it("takes an inline field's type from its values, where it gives none", async () => {
            const bp = withTable({
                source: 'snap',
                fields: [{field: 'nav', format: {scale: 'millions', precision: 1, label: true}}]
            });
            bp.sources.snap = {
                inline: {fields: [{name: 'nav', kind: 'number'}], rows: [{nav: 3754900000}]}
            } as any;
            const model = open(bp),
                table = widget(PropertyTableWidgetModel, model, 'props');
            expect(model.getSource('snap').fields.nav.type).toBe('number');
            await vi.waitFor(() => expect(text(table.entries[0]?.value)).toBe('3,754.9m'));
        });

        it('refuses a field its source lacks', () => {
            expect(
                open()
                    .validate(withTable({fields: ['mktVal', {field: 'nope'}]}))
                    .map(it => [it.code, it.path])
            ).toContainEqual(['field.unknown', '/elements/props/config/fields/1/field']);
        });
    });

    describe('series', () => {
        it('draws a series column as sparklines on one scale, with no sort or export', async () => {
            const bp = loadBlueprint('p2-linked-dashboard.json');
            Object.assign(bp.elements.posGrid.config, {
                groupBy: [],
                columnState: ['mktVal', 'pnlHistory']
            });
            const grid = widget(CubeGridWidgetModel, open(bp), 'posGrid'),
                gm = () => grid.cubeGridModel.innerGridModel;
            await vi.waitFor(() => expect(gm().store.allRecords.length).toBe(3));
            const column = gm().getColumn('pnlHistory'),
                leaf = gm().store.allRecords.find(it => it.data.pnlHistory),
                el = column.renderer(leaf.data.pnlHistory, {record: leaf} as any) as any;
            expect(column.sortable).toBe(false);
            expect(column.excludeFromExport).toBe(true);
            expect(el.props).toMatchObject({min: -3, max: 6});
        });

        it('sums an additive series point by point at each group, aligned from its end', async () => {
            const bp = loadBlueprint('p2-linked-dashboard.json');
            Object.assign(bp.elements.posGrid.config, {
                groupBy: ['strategy'],
                columnState: ['pnlHistory']
            });
            const grid = widget(CubeGridWidgetModel, open(bp), 'posGrid'),
                gm = () => grid.cubeGridModel.innerGridModel;
            await vi.waitFor(() => expect(gm().store.allRecords.length).toBeGreaterThan(1));
            const credit = gm().store.allRecords.find(it => it.data.cubeLabel === 'Credit');
            expect(credit.data.pnlHistory).toEqual([-2, 6]);
        });

        it('shows a dimension it does not group by on a group row whose rows share it', async () => {
            const bp = loadBlueprint('p2-linked-dashboard.json');
            Object.assign(bp.elements.posGrid.config, {
                groupBy: ['strategy'],
                columnState: ['sector', 'trader']
            });
            const grid = widget(CubeGridWidgetModel, open(bp), 'posGrid'),
                gm = () => grid.cubeGridModel.innerGridModel,
                group = (label: string) =>
                    gm().store.allRecords.find(it => it.data.cubeLabel === label)?.data;
            await vi.waitFor(() => expect(group('Credit')).toBeTruthy());
            expect(group('Credit')).toMatchObject({sector: 'Energy', trader: null});
            expect(group('Global Macro')).toMatchObject({
                sector: 'Technology',
                trader: 'Fred Corn'
            });
        });

        it("draws a stat card's trend under its figure, from its source's one row", async () => {
            const bp = loadBlueprint('p2-linked-dashboard.json');
            bp.sources.fund = {
                inline: {
                    fields: [
                        {name: 'pnl', type: 'number'},
                        {name: 'hist', type: 'number[]', kind: 'pnl'}
                    ],
                    rows: [{pnl: 5, hist: [1, 3, 2]}]
                }
            } as any;
            bp.elements.headlinePnlDay.config = {
                source: 'fund',
                field: 'pnl',
                trend: 'hist',
                deltaLabel: 'vs prior'
            };
            const card = widget(StatCardWidgetModel, open(bp), 'headlinePnlDay');
            await vi.waitFor(() =>
                expect(
                    render(card.card.detail as unknown as ReactElement).container.querySelector(
                        '.xh-sparkline'
                    )
                ).toBeTruthy()
            );
            // In the rest of the line after the delta's label, not cut off past the card's edge.
            const trend = render(
                card.card.detail as unknown as ReactElement
            ).container.querySelector('.xh-blueprint-stat-card__trend');
            expect(trend.firstElementChild.textContent).toBe('vs prior');
            expect(trend.querySelector('.xh-sparkline')).not.toBeNull();
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

        it('marks a card with no field unfinished, unless it counts', () => {
            const bp = loadBlueprint('p2-linked-dashboard.json');
            bp.elements.headlinePnlDay.config = {source: 'positions'};
            expect(
                open()
                    .validate(bp)
                    .map(it => it.code)
            ).toContain('config.incomplete');
        });
    });

    describe('gauge', () => {
        const withGauge = (config: object = {}) => {
            const bp = loadBlueprint('p2-linked-dashboard.json');
            bp.elements.gauge = {
                component: 'gauge',
                config: {source: 'positions', value: 'mktVal', min: 0, max: 1000, ...config}
            };
            bp.elements.dashboard.children.push({id: 'gauge', x: 0, y: 14, w: 3, h: 4});
            return bp;
        };

        it("draws its measure's total on a solid gauge, from min to max, colored by its stops, leaving its title to its container", async () => {
            const gauge = widget(
                GaugeWidgetModel,
                open(
                    withGauge({
                        title: 'Gross <b>exposure</b>',
                        stops: [
                            {at: 0.5, color: '#55bf3b'},
                            {at: 0.9, color: '#df5353'}
                        ]
                    })
                ),
                'gauge'
            );
            await vi.waitFor(() => expect(gauge.chartModel.series[0]?.data).toEqual([350]));
            const {chart, title, yAxis} = gauge.chartModel.highchartsConfig;
            expect(chart.type).toBe('solidgauge');
            expect(title.text).toBeNull();
            expect(yAxis).toMatchObject({
                min: 0,
                max: 1000,
                stops: [
                    [0.5, '#55bf3b'],
                    [0.9, '#df5353']
                ]
            });
            const label = gauge.chartModel.series[0].dataLabels.formatter.call({y: 350});
            expect(label).not.toContain('<');
        });

        it('draws a total outside its range at the end of its arc, and labels the real total', async () => {
            const gauge = widget(GaugeWidgetModel, open(withGauge({min: 500})), 'gauge');
            await vi.waitFor(() => expect(gauge.chartModel.series[0]?.data).toEqual([500]));
            // The label reads the real total, whatever the arc draws.
            const {formatter} = gauge.chartModel.series[0].dataLabels;
            expect(formatter.call({y: 500})).toBe(formatter.call({y: 9e9}));
        });

        it('draws its own title, escaped, where its parent draws none, as in a box', async () => {
            const bp = withGauge({title: 'Gross <b>exposure</b>'});
            bp.elements.row = {component: 'box', children: [{id: 'gauge'}]};
            bp.elements.dashboard.children = bp.elements.dashboard.children.map(it =>
                it.id === 'gauge' ? {...it, id: 'row'} : it
            );
            const gauge = widget(GaugeWidgetModel, open(bp), 'gauge');
            await vi.waitFor(() => expect(gauge.chartModel.series[0]?.data).toEqual([350]));
            expect(gauge.chartModel.highchartsConfig.title.text).toBe(
                'Gross &lt;b&gt;exposure&lt;/b&gt;'
            );
        });

        it('refuses a min that is not under its max, and a stop color that is not hex', () => {
            const codes = (config: object) =>
                open()
                    .validate(withGauge(config))
                    .map(it => [it.code, it.path]);
            expect(codes({min: 10, max: 10})).toEqual([
                ['gauge.minNotUnderMax', '/elements/gauge/config/min']
            ]);
            expect(codes({stops: [{at: 0.5, color: 'url(x)'}]})).toEqual([
                ['schema.invalid', '/elements/gauge/config/stops/0/color']
            ]);
        });
    });

    describe('heatmap', () => {
        const withHeatmap = (config: object = {}) => {
            const bp = loadBlueprint('p2-linked-dashboard.json');
            bp.elements.heat = {
                component: 'heatmap',
                config: {
                    source: 'positions',
                    x: 'sector',
                    y: 'strategy',
                    value: 'pnlDay',
                    ...config
                }
            };
            bp.elements.dashboard.children.push({id: 'heat', x: 0, y: 14, w: 6, h: 4});
            bp.variables.picked = {type: 'filter', setBy: {element: 'heat', output: 'selection'}};
            return bp;
        };

        it('draws a cell per pair of its dimensions, colored by its value', async () => {
            const heat = widget(HeatmapWidgetModel, open(withHeatmap()), 'heat');
            await vi.waitFor(() => expect(heat.chartModel.series[0]?.data.length).toBe(2));
            const config = heat.chartModel.highchartsConfig;
            expect(config.chart.type).toBe('heatmap');
            expect(config.xAxis.categories).toEqual(['Energy', 'Technology']);
            expect(config.yAxis.categories).toEqual(['Credit', 'Global Macro']);
            expect(sortBy(heat.chartModel.series[0].data, ['x', 'y'])).toEqual([
                expect.objectContaining({x: 0, y: 0, value: -1}),
                expect.objectContaining({x: 1, y: 1, value: 5})
            ]);
        });

        it('escapes its labels and series name, which Highcharts reads as markup', async () => {
            const bp = withHeatmap({source: 'inl', x: 'a', y: 'b', value: 'v'});
            bp.sources.inl = {
                inline: {
                    fields: [
                        {name: 'a', type: 'string', isDimension: true},
                        {name: 'b', type: 'string', isDimension: true},
                        {name: 'v', label: '<i>Value</i>', type: 'number', aggregator: 'SUM'}
                    ],
                    rows: [{a: '<b>X</b>', b: 'P&L', v: 1}]
                }
            } as any;
            const heat = widget(HeatmapWidgetModel, open(bp), 'heat');
            await vi.waitFor(() => expect(heat.chartModel.series[0]?.data.length).toBe(1));
            const {xAxis, yAxis} = heat.chartModel.highchartsConfig;
            expect(xAxis.categories).toEqual(['&lt;b&gt;X&lt;/b&gt;']);
            expect(yAxis.categories).toEqual(['P&amp;L']);
            expect(heat.chartModel.series[0].name).toBe('&lt;i&gt;Value&lt;/i&gt;');
        });

        it('publishes the cell clicked as its selection, and clears it on a second click', async () => {
            const model = open(withHeatmap()),
                heat = widget(HeatmapWidgetModel, model, 'heat');
            await vi.waitFor(() => expect(heat.chartModel.series[0]?.data.length).toBe(2));
            heat.selectCell(0, 0);
            expect(model.getVariable('picked').value).toEqual({
                op: 'AND',
                filters: [
                    {field: 'sector', op: '=', value: 'Energy'},
                    {field: 'strategy', op: '=', value: 'Credit'}
                ]
            });
            heat.selectCell(0, 0);
            expect(model.getVariable('picked').value).toBeNull();
        });

        it('outlines the cell selected, and names its x and y in its tooltip', async () => {
            const heat = widget(HeatmapWidgetModel, open(withHeatmap()), 'heat'),
                cell = (x: number, y: number) =>
                    heat.chartModel.series[0].data.find((it: any) => it.x === x && it.y === y);
            await vi.waitFor(() => expect(heat.chartModel.series[0]?.data.length).toBe(2));
            heat.selectCell(0, 0);
            await vi.waitFor(() => expect(cell(0, 0).borderWidth).toBeGreaterThan(0));
            expect(cell(1, 1).borderWidth).toBeFalsy();

            const {pointFormatter} = heat.chartModel.highchartsConfig.tooltip,
                point = {
                    x: 0,
                    y: 0,
                    value: -1,
                    series: {xAxis: {categories: ['Energy']}, yAxis: {categories: ['Credit']}}
                };
            expect(pointFormatter.call(point)).toMatch(/^Energy, Credit: /);
        });

        it('refuses an x or y that is not a dimension', () => {
            expect(
                open()
                    .validate(withHeatmap({y: 'mktVal'}))
                    .map(it => [it.code, it.path])
            ).toContainEqual(['field.notDimension', '/elements/heat/config/y']);
        });
    });

    describe('treemap', () => {
        const withTreemap = (config: object = {}) => {
            const bp = loadBlueprint('p2-linked-dashboard.json');
            bp.elements.map = {
                component: 'treemap',
                config: {
                    source: 'positions',
                    groupBy: ['sector'],
                    value: 'mktVal',
                    heat: 'pnlDay',
                    ...config
                }
            };
            bp.elements.dashboard.children.push({id: 'map', x: 0, y: 14, w: 6, h: 4});
            bp.variables.picked = {type: 'filter', setBy: {element: 'map', output: 'selection'}};
            return bp;
        };

        it('draws a node per group, sized by its value and colored by its heat', async () => {
            const map = widget(TreemapWidgetModel, open(withTreemap()), 'map');
            await vi.waitFor(() => expect(map.store.rootRecords).toHaveLength(2));
            expect(
                sortBy(
                    map.store.rootRecords.map(it => [it.data.cubeLabel, it.data.mktVal]),
                    0
                )
            ).toEqual([
                ['Energy', 50],
                ['Technology', 300]
            ]);
            expect(map.treeMapModel).toMatchObject({
                valueField: 'mktVal',
                heatField: 'pnlDay',
                colorMode: 'linear'
            });
        });

        it("publishes the node clicked as its selection, a filter of the node's group path", async () => {
            const model = open(withTreemap({groupBy: ['sector', 'strategy'], maxDepth: 2})),
                map = widget(TreemapWidgetModel, model, 'map'),
                picked = () => model.getVariable('picked').value;
            await vi.waitFor(() => expect(map.store.rootRecords).toHaveLength(2));
            const energy = map.store.rootRecords.find(it => it.data.cubeLabel === 'Energy'),
                [credit] = energy.children;

            map.select(credit);
            expect(picked()).toEqual({
                op: 'AND',
                filters: [
                    {field: 'sector', op: '=', value: 'Energy'},
                    {field: 'strategy', op: '=', value: 'Credit'}
                ]
            });
            map.select(credit);
            expect(picked()).toBeNull();
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

        it('draws the measures of y2 on a second axis, on the right', async () => {
            const bp = loadBlueprint('p2-linked-dashboard.json');
            Object.assign(bp.elements.sectorChart.config, {
                type: 'spline',
                y: ['pnlDay'],
                y2: ['mktVal'],
                y2Title: 'Value'
            });
            const chart = widget(ChartWidgetModel, open(bp), 'sectorChart');
            await vi.waitFor(() => expect(chart.chartModel.series).toHaveLength(2));
            const {yAxis, chart: chartConfig} = chart.chartModel.highchartsConfig;
            expect(chartConfig.type).toBe('spline');
            expect(yAxis).toHaveLength(2);
            expect(yAxis[0].title.text).toBe('Day P&amp;L');
            expect(yAxis[1]).toMatchObject({opposite: true, title: {text: 'Value'}});
            expect(chart.chartModel.series.map(it => it.yAxis ?? 0)).toEqual([0, 1]);
        });

        it("writes the axis and tooltips in a field's own scale, never stepping to compact form", async () => {
            const bp = loadBlueprint('p2-linked-dashboard.json');
            Object.assign(bp.elements.sectorChart.config, {y: ['pnlDay'], y2: ['mktVal']});
            const chart = widget(ChartWidgetModel, open(bp), 'sectorChart');
            await vi.waitFor(() => expect(chart.chartModel.series).toHaveLength(2));
            const [, second] = chart.chartModel.highchartsConfig.yAxis,
                tip = chart.chartModel.series[1].tooltip.pointFormatter.call({
                    y: 2500000,
                    color: '#000',
                    series: {name: 'Market Value'}
                });
            // mktVal's format writes millions as "2.5m". Compact form would write "2.5M".
            expect(second.labels.formatter.call({value: 2500000})).toMatch(/2\.5m/);
            expect(tip).toMatch(/2\.5m/);
        });

        it("writes the primary series' tooltips in its field's scale too", async () => {
            const bp = loadBlueprint('p2-linked-dashboard.json');
            Object.assign(bp.elements.sectorChart.config, {y: ['mktVal']});
            const chart = widget(ChartWidgetModel, open(bp), 'sectorChart');
            await vi.waitFor(() => expect(chart.chartModel.series[0]?.data).toHaveLength(2));
            const tip = chart.chartModel.series[0].tooltip?.pointFormatter.call({
                y: -110975723,
                color: '#000',
                series: {name: 'Market Value'}
            });
            expect(tip).toMatch(/\(111\.0m\)/);
        });

        it('drops the trailing zeros of a round axis tick, keeping the decimals of any other', async () => {
            const bp = loadBlueprint('p2-linked-dashboard.json');
            Object.assign(bp.elements.sectorChart.config, {y: ['mktVal'], y2: ['grossExposure']});
            const chart = widget(ChartWidgetModel, open(bp), 'sectorChart');
            await vi.waitFor(() => expect(chart.chartModel.series).toHaveLength(2));
            const [first, second] = chart.chartModel.highchartsConfig.yAxis,
                tick = (axis: PlainObject, value: number) => axis.labels.formatter.call({value});
            expect(tick(first, 280000000)).toMatch(/^280m$/);
            expect(tick(first, -282500000)).toMatch(/^\(282\.5m\)$/);
            expect(tick(second, 1000000000)).toMatch(/^1,000m$/);
        });

        it("formats the second axis and its tooltips as y2's own field, with no fraction clamp", async () => {
            const bp = loadBlueprint('p2-linked-dashboard.json');
            Object.assign(bp.elements.sectorChart.config, {
                type: 'column',
                y: ['yield'],
                y2: ['mktVal']
            });
            const chart = widget(ChartWidgetModel, open(bp), 'sectorChart');
            await vi.waitFor(() => expect(chart.chartModel.series).toHaveLength(2));
            const [, second] = chart.chartModel.highchartsConfig.yAxis,
                y2Series = chart.chartModel.series[1];
            expect(second.min).toBeUndefined();
            expect(second.max).toBeUndefined();
            expect(second.labels.formatter.call({value: 2500000})).not.toContain('%');
            const tip = y2Series.tooltip.pointFormatter.call({
                y: 2500000,
                color: '#000',
                series: {name: 'Market Value'}
            });
            expect(tip).not.toContain('%');
        });

        it("labels its axis and tooltips with a unit its source's params choose", async () => {
            const catalog = new DataCatalog({
                    formats: {
                        speed: {
                            precision: 0,
                            label: {param: 'units', values: {imperial: ' mph', metric: ' m/s'}}
                        }
                    },
                    kinds: {speed: {base: 'number', format: 'speed', aggregator: 'AVG'}},
                    datasets: {
                        wind: {
                            params: {units: {type: 'string'}},
                            fields: [
                                {name: 'city', type: 'string', isDimension: true},
                                {name: 'windSpeed', type: 'number', kind: 'speed'}
                            ]
                        }
                    }
                }),
                model = new BlueprintModel({
                    blueprint: {
                        variables: {units: {type: 'string', default: {value: 'metric'}}},
                        sources: {w: {dataset: 'wind', params: {units: {$var: 'units'}}}},
                        root: 'c',
                        elements: {
                            c: {
                                component: 'chart',
                                config: {source: 'w', type: 'column', x: 'city', y: ['windSpeed']}
                            }
                        }
                    },
                    catalog,
                    registry: scenarioRegistry(),
                    dataProvider: new FakeBlueprintDataProvider({catalog})
                });
            onTestFinished(() => model.destroy());
            const chart = widget(ChartWidgetModel, model, 'c');
            await vi.waitFor(() => expect(chart.chartModel.series).toHaveLength(1));
            const {yAxis} = chart.chartModel.highchartsConfig,
                [series] = chart.chartModel.series;
            expect(yAxis.labels.formatter.call({value: 12})).toBe('12 m/s');
            expect(
                series.tooltip.pointFormatter.call({y: 12, color: '#000', series: {name: 'Wind'}})
            ).toContain('<b>12 m/s</b>');
        });

        it('refuses y2 beside a groupBy, which splits its first y only', () => {
            const bp = loadBlueprint('p2-linked-dashboard.json');
            Object.assign(bp.elements.sectorChart.config, {groupBy: 'strategy', y2: ['mktVal']});
            expect(
                open()
                    .validate(bp)
                    .map(it => it.code)
            ).toContain('chart.y2WithGroupBy');
        });

        it('merges its highchartsConfig over the config it builds', async () => {
            const bp = loadBlueprint('p2-linked-dashboard.json');
            bp.elements.sectorChart.config.highchartsConfig = {
                title: {text: 'Sector P&L'},
                legend: {enabled: false}
            };
            const chart = widget(ChartWidgetModel, open(bp), 'sectorChart');
            await vi.waitFor(() => expect(chart.chartModel.series[0]?.data).toHaveLength(2));
            const config = chart.chartModel.highchartsConfig;
            expect(config.title.text).toBe('Sector P&L');
            expect(config.legend.enabled).toBe(false);
            expect(config.xAxis.categories).toEqual(['Energy', 'Technology']);
        });

        it('drops a highchartsConfig that fails its checks once resolved', async () => {
            const chart = widget(
                    ChartWidgetModel,
                    open(loadBlueprint('p2-linked-dashboard.json')),
                    'sectorChart'
                ),
                {resolvedConfig} = chart;
            vi.spyOn(chart, 'resolvedConfig', 'get').mockReturnValue({
                ...resolvedConfig,
                highchartsConfig: {title: {text: '<img src=x onerror=alert(1)>'}}
            });
            await vi.waitFor(() => expect(chart.chartModel.series[0]?.data).toHaveLength(2));
            (chart as any).updateChart();
            expect(JSON.stringify(chart.chartModel.highchartsConfig)).not.toContain('<img');
        });

        it('publishes the point clicked as its selection, and clears it on a second click', async () => {
            const bp = loadBlueprint('p2-linked-dashboard.json');
            bp.variables.picked = {
                type: 'filter',
                setBy: {element: 'sectorChart', output: 'selection'}
            };
            Object.assign(bp.elements.sectorChart.config, {groupBy: 'strategy'});
            const model = open(bp),
                chart = widget(ChartWidgetModel, model, 'sectorChart'),
                picked = () => model.getVariable('picked').value;
            await vi.waitFor(() => expect(chart.chartModel.series.length).toBeGreaterThan(0));
            const series = chart.chartModel.series.findIndex(it => it.name === 'Credit');

            chart.selectPoint(series, 0);
            expect(picked()).toEqual({
                op: 'AND',
                filters: [
                    {field: 'sector', op: '=', value: 'Energy'},
                    {field: 'strategy', op: '=', value: 'Credit'}
                ]
            });
            chart.selectPoint(series, 0);
            expect(picked()).toBeNull();
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
