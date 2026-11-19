import {chart, ChartModel} from '@xh/hoist/cmp/chart';
import {hoistCmp, managed, type PlainObject, uses} from '@xh/hoist/core';
import type {FilterSpec, View} from '@xh/hoist/data';
import {observableRef} from '@xh/hoist/mobx';
import {castArray, compact, isEqual, orderBy, uniq} from 'lodash';
import {
    BlueprintWidgetModel,
    type BlueprintWidgetConfig,
    type ChartWidgetConfig
} from '../../../blueprint';
import {
    type ChatUiChartLayoutProps,
    toHighchartsConfig,
    toSeries
} from '../genui/impl/ChatUiChartData';

/**
 * The `chart` widget: a Hoist chart over its source. If `x` is a dimension, the chart groups its
 * source by `x` through the Cube, with a series per `y`, or a series per value of `groupBy` for the
 * first `y`. If `x` is not a dimension, such as a date, it plots the rows as they are. Its `filter`
 * applies in the browser, so a filter bound to a selection updates it with no reload.
 */
export class ChartWidgetModel extends BlueprintWidgetModel<ChartWidgetConfig> {
    @managed readonly chartModel = new ChartModel();
    @managed @observableRef accessor view: View = null;

    constructor(config: BlueprintWidgetConfig) {
        super(config);
        this.addReaction(
            {
                track: () => this.source?.cube,
                run: cube => {
                    this.registerView(null);
                    this.view?.destroy();
                    this.view = cube ? cube.createView({query: this.query, connect: true}) : null;
                    this.registerView(this.view);
                },
                fireImmediately: true
            },
            {
                track: () => this.query,
                run: query => this.view?.updateQuery(query),
                equals: 'structural'
            },
            {
                track: () => [this.view?.result, this.resolvedConfig, this.labels],
                run: () => this.updateChart(),
                fireImmediately: true
            }
        );
    }

    //------------------
    // Implementation
    //------------------
    /** The labels of the fields the chart shows, which can follow variables. */
    private get labels(): string[] {
        const {x, y} = this.resolvedConfig;
        return [x, ...castArray(y ?? [])].map(it => this.source?.fieldLabel(it));
    }

    private get isGrouped(): boolean {
        return !!this.source?.fields[this.resolvedConfig.x]?.isDimension;
    }

    private get query(): PlainObject {
        const {x, groupBy} = this.resolvedConfig,
            filter: FilterSpec = this.blueprintModel.resolveFilter(this.element?.config.filter);
        return this.isGrouped
            ? {dimensions: compact([x, groupBy]), filter, includeRoot: false}
            : {dimensions: [], filter, includeRoot: true, includeLeaves: true};
    }

    private updateChart() {
        const props = this.view ? this.buildProps() : null,
            {chartModel} = this;
        if (!props) {
            chartModel.setSeries([]);
            return;
        }
        const config = toHighchartsConfig(props);
        if (!isEqual(config, chartModel.highchartsConfig)) chartModel.setHighchartsConfig(config);
        chartModel.setSeries(toSeries(props, false));
    }

    private buildProps(): ChatUiChartLayoutProps {
        const cfg = this.resolvedConfig,
            {fields} = this.source,
            ys: string[] = castArray(cfg.y ?? []).filter(it => fields[it]),
            label = (f: string) => (fields[f] ? this.source.fieldLabel(f) : f),
            yAxis = {
                title: ys.length === 1 ? label(ys[0]) : null,
                format: (fields[ys[0]]?.kind === 'fraction' ? 'percent' : 'number') as any
            },
            base = {type: cfg.type ?? 'column', stacking: cfg.stacking, yAxis};

        if (!this.isGrouped) {
            const leaves = orderBy(this.view.result.rows[0]?.children ?? [], cfg.x);
            return {
                ...base,
                xAxis: {type: 'datetime', title: label(cfg.x)},
                series: ys.map(y => ({name: label(y), data: leaves.map(r => [r[cfg.x], r[y]])}))
            };
        }

        let rows = this.view.result.rows;
        if (cfg.sortBy) {
            const [f, dir] = String(cfg.sortBy).split('|');
            rows = orderBy(
                rows,
                f === cfg.x ? 'cubeLabelValue' : f,
                dir === 'desc' ? 'desc' : 'asc'
            );
        }
        if (cfg.top) rows = rows.slice(0, cfg.top);
        const categories = rows.map(it => String(it.cubeLabel));

        if (cfg.groupBy && ys.length) {
            const [y] = ys,
                values = uniq(rows.flatMap(r => (r.children ?? []).map(c => String(c.cubeLabel))));
            return {
                ...base,
                xAxis: {categories, title: label(cfg.x)},
                series: values.map(v => ({
                    name: v,
                    data: rows.map(
                        r => r.children?.find(c => String(c.cubeLabel) === v)?.[y] ?? null
                    )
                }))
            };
        }
        return {
            ...base,
            xAxis: {categories, title: label(cfg.x)},
            series: ys.map(y => ({name: label(y), data: rows.map(r => r[y] ?? null)}))
        };
    }
}

export const [ChartWidget, chartWidget] = hoistCmp.withFactory({
    displayName: 'ChartWidget',
    className: 'xh-blueprint-chart',
    model: uses(ChartWidgetModel),
    render({model, className}) {
        return chart({model: model.chartModel, className});
    }
});
