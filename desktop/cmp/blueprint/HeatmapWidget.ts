import {chart, ChartModel} from '@xh/hoist/cmp/chart';
import {hoistCmp, managed, type PlainObject, uses} from '@xh/hoist/core';
import type {Cube, View} from '@xh/hoist/data';
import {action, observableRef} from '@xh/hoist/mobx';
import {compact, escape, isEqual, isFinite, sortBy, uniqBy} from 'lodash';
import {
    BlueprintWidgetModel,
    type BlueprintWidgetConfig,
    type HeatmapWidgetConfig
} from '../../../blueprint';
import {formatValue, resolveFormat} from '../../../blueprint/impl/formats';
import {setChartConfig} from './impl/chartConfig';

/**
 * The `heatmap` widget: a Highcharts heatmap over its source grouped by `x` and `y`, each cell
 * colored by the total of `value`. A click publishes the cell as its `selection` output.
 */
export class HeatmapWidgetModel extends BlueprintWidgetModel<HeatmapWidgetConfig> {
    @managed readonly chartModel = new ChartModel();
    @managed @observableRef accessor view: View = null;

    constructor(config: BlueprintWidgetConfig) {
        super(config);
        this.setCube(this.source?.cube);
        this.addReaction(
            {track: () => this.source?.cube, run: cube => this.setCube(cube)},
            {
                track: () => this.query,
                run: query => this.view?.updateQuery(query),
                equals: 'structural'
            },
            {
                track: () => [this.view?.result, this.resolvedConfig, this.selection],
                run: () => this.updateChart(),
                fireImmediately: true
            }
        );
    }

    /** Publish a cell as the `selection` output, by its x and y index. Selecting it again clears it. */
    @action
    selectCell(x: number, y: number) {
        const keys = this.cellKeys;
        if (!keys || x >= keys.x.length || y >= keys.y.length) return;
        const {x: xField, y: yField} = this.resolvedConfig,
            filter = {
                op: 'AND',
                filters: [
                    {field: xField, op: '=', value: keys.x[x]},
                    {field: yField, op: '=', value: keys.y[y]}
                ]
            };
        this.selection = isEqual(filter, this.selection) ? null : filter;
        this.setOutput('selection', this.selection);
    }

    //------------------
    // Implementation
    //------------------
    @observableRef private accessor selection: PlainObject = null;

    // The x and y value of each column and row of cells.
    private cellKeys: {x: unknown[]; y: unknown[]} = null;

    private readonly onCellClick = (e: any) => this.selectCell(e.point.x, e.point.y);

    private get query(): PlainObject {
        const {x, y} = this.resolvedConfig;
        return {
            // An unfinished map, with no x or y yet, queries what it has.
            dimensions: compact([x, y]),
            filter: this.blueprintModel.resolveFilter(this.element?.config.filter),
            includeRoot: false
        };
    }

    private setCube(cube: Cube) {
        this.registerView(null);
        this.view?.destroy();
        this.view = cube ? cube.createView({query: this.query as any, connect: true}) : null;
        this.registerView(this.view);
    }

    private updateChart() {
        const {view, source, chartModel} = this,
            {value, colorMode = 'diverging'} = this.resolvedConfig;
        if (!view || !source?.fields[value]) {
            chartModel.setSeries([]);
            return;
        }
        const xRows = sortBy(view.result.rows, 'cubeLabel'),
            yRows = sortBy(
                uniqBy(
                    xRows.flatMap(it => it.children ?? []),
                    'cubeLabelValue'
                ),
                'cubeLabel'
            ),
            yIndex = new Map(yRows.map((it, idx) => [it.cubeLabelValue, idx])),
            selected = this.selection?.filters?.map(it => it.value),
            data = xRows.flatMap((row, x) =>
                (row.children ?? []).map(cell => ({
                    x,
                    y: yIndex.get(cell.cubeLabelValue),
                    value: cell[value] ?? null,
                    ...(isEqual(selected, [row.cubeLabelValue, cell.cubeLabelValue])
                        ? {borderWidth: 2, borderColor: SELECTED}
                        : {})
                }))
            ),
            values = data.map(it => it.value).filter(isFinite) as number[],
            maxAbs = values.reduce((max, v) => Math.max(max, Math.abs(v)), 0) || 1,
            def = source.fields[value],
            {catalog, blueprint} = this.blueprintModel,
            opts = resolveFormat(def, source.displayOf(value).formats, {catalog, blueprint});
        this.cellKeys = {
            x: xRows.map(it => it.cubeLabelValue),
            y: yRows.map(it => it.cubeLabelValue)
        };
        setChartConfig(
            chartModel,
            {
                chart: {type: 'heatmap'},
                title: {text: null},
                legend: {enabled: true},
                // Highcharts reads labels as markup.
                xAxis: {categories: xRows.map(it => escape(String(it.cubeLabel)))},
                yAxis: {
                    categories: yRows.map(it => escape(String(it.cubeLabel))),
                    title: {text: null}
                },
                colorAxis:
                    colorMode === 'diverging'
                        ? {
                              min: -maxAbs,
                              max: maxAbs,
                              stops: [
                                  [0, NEG],
                                  [0.5, MID],
                                  [1, POS]
                              ]
                          }
                        : {minColor: MID, maxColor: POS},
                tooltip: {
                    // The categories are escaped already.
                    pointFormatter: function (this: any) {
                        const xLabel = this.series.xAxis.categories[this.x],
                            yLabel = this.series.yAxis.categories[this.y],
                            formatted = formatValue(this.value, def, opts, catalog, true) ?? '';
                        return `${xLabel}, ${yLabel}: ${formatted}`;
                    }
                },
                plotOptions: {series: {point: {events: {click: this.onCellClick}}}}
            },
            {def, opts}
        );
        chartModel.setSeries([
            {type: 'heatmap', name: escape(source.fieldLabel(value)), data} as any
        ]);
    }
}

export const [HeatmapWidget, heatmapWidget] = hoistCmp.withFactory({
    displayName: 'HeatmapWidget',
    className: 'xh-blueprint-heatmap',
    model: uses(HeatmapWidgetModel),
    render({model, className}) {
        return chart({model: model.chartModel, className});
    }
});

const NEG = '#d9534f',
    MID = '#f7f7f7',
    POS = '#5cb85c',
    SELECTED = '#333333';
