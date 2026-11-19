import {chart, ChartModel} from '@xh/hoist/cmp/chart';
import {hoistCmp, managed, type PlainObject, uses} from '@xh/hoist/core';
import type {Cube, FilterSpec, View} from '@xh/hoist/data';
import {observableRef} from '@xh/hoist/mobx';
import {LocalDate} from '@xh/hoist/utils/datetime';
import {castArray, compact, isArray, isEqual, isFinite, orderBy, uniq} from 'lodash';
import {
    BlueprintWidgetModel,
    type BlueprintWidgetConfig,
    type ChartWidgetConfig
} from '../../../blueprint';
import {fmtChatUiNumber} from '../genui/ChatUiFormat';
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
        // Built now, not by fireImmediately, which MobX defers inside a batch such as a render.
        this.setCube(this.source?.cube);
        this.addReaction(
            {
                track: () => this.source?.cube,
                run: cube => this.setCube(cube)
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
    private setCube(cube: Cube) {
        this.registerView(null);
        this.view?.destroy();
        this.view = cube ? cube.createView({query: this.query, connect: true}) : null;
        this.registerView(this.view);
    }

    /** The labels of the fields the chart shows, which can follow variables. */
    private get labels(): string[] {
        const {x, y} = this.resolvedConfig;
        return [x, ...castArray(y ?? [])].map(it => this.source?.fieldLabel(it));
    }

    /** True if a field's kind is a fraction, directly or through a catalog kind. */
    private isFraction(name: string): boolean {
        const kind = this.source?.fields[name]?.kind;
        return (this.blueprintModel.catalog.kinds[kind]?.base ?? kind) === 'fraction';
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
        const props = this.view && this.source ? this.buildProps() : null,
            {chartModel} = this;
        if (!props) {
            chartModel.setSeries([]);
            return;
        }
        const config = this.withFractionAxis(toHighchartsConfig(props), props);
        if (!isEqual(config, chartModel.highchartsConfig)) chartModel.setHighchartsConfig(config);
        chartModel.setSeries(toSeries(props, false));
    }

    /** A percent axis over values that all lie in 0 to 1 runs 0% to 100%, in whole percents. */
    private withFractionAxis(config: PlainObject, props: ChatUiChartLayoutProps): PlainObject {
        if (props.yAxis.format !== 'percent' || props.stacking) return config;
        const values = props.series
            .flatMap(it => it.data.map(p => (isArray(p) ? p[1] : p)))
            .filter(isFinite);
        if (!values.length || values.some(v => v < 0 || v > 1)) return config;
        return {
            ...config,
            yAxis: {
                ...config.yAxis,
                min: 0,
                max: 1,
                labels: {
                    formatter: function (this: any) {
                        return fmtChatUiNumber(this.value, 'percent', 0, {asHtml: true});
                    }
                }
            }
        };
    }

    /**
     * The chart as chat kit's chart layout takes it: its type, axes and series, from the source
     * as the Cube groups it. Null until the source has a view.
     */
    getLayoutProps(): ChatUiChartLayoutProps {
        return this.view && this.source ? this.buildProps() : null;
    }

    private buildProps(): ChatUiChartLayoutProps {
        const cfg = this.resolvedConfig,
            {fields} = this.source,
            ys: string[] = castArray(cfg.y ?? []).filter(it => fields[it]),
            label = (f: string) => (fields[f] ? this.source.fieldLabel(f) : f),
            xTitle = cfg.xTitle ?? label(cfg.x),
            yAxis = {
                title: cfg.yTitle ?? (ys.length === 1 ? label(ys[0]) : null),
                format: (this.isFraction(ys[0]) ? 'percent' : 'number') as any
            },
            base = {type: cfg.type ?? 'column', stacking: cfg.stacking, yAxis};

        if (!this.isGrouped) {
            const leaves = orderBy(this.view.result.rows[0]?.children ?? [], cfg.x);
            return {
                ...base,
                xAxis: {type: 'datetime', title: xTitle},
                series: ys.map(y => ({
                    name: label(y),
                    data: leaves.map(r => [toTimestamp(r[cfg.x]), r[y]])
                }))
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
                xAxis: {categories, title: xTitle},
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
            xAxis: {categories, title: xTitle},
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

/** A point's time as epoch milliseconds. The Cube holds a `date` as a Date, a `localDate` as a LocalDate. */
function toTimestamp(value: unknown): number | string {
    if (value instanceof Date) return value.getTime();
    if (LocalDate.isLocalDate(value)) return (value as LocalDate).timestamp;
    return value as number | string;
}
