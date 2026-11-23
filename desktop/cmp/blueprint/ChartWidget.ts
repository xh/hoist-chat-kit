import {chart, ChartModel} from '@xh/hoist/cmp/chart';
import {hoistCmp, managed, type PlainObject, uses} from '@xh/hoist/core';
import type {Cube, FilterSpec, View} from '@xh/hoist/data';
import {observableRef} from '@xh/hoist/mobx';
import {LocalDate} from '@xh/hoist/utils/datetime';
import {mergeDeep} from '@xh/hoist/utils/js';
import {
    castArray,
    compact,
    escape,
    isArray,
    isEqual,
    isFinite,
    isString,
    orderBy,
    uniq
} from 'lodash';
import {
    BlueprintWidgetModel,
    type BlueprintWidgetConfig,
    type ChartWidgetConfig
} from '../../../blueprint';
import {checkHighchartsConfig} from '../../../blueprint/impl/builtInWidgets';
import {formatValue, resolveFormat} from '../../../blueprint/impl/formats';
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

    /**
     * Publish a point of a chart whose x is a dimension as the `selection` output: a filter of its
     * x value, and its series' `groupBy` value. Selecting it again clears it.
     */
    selectPoint(seriesIndex: number, index: number) {
        const {x, groupBy} = this.resolvedConfig,
            keys = this.pointKeys;
        if (!keys || index >= keys.x.length) return;
        const clauses = compact([
                {field: x, op: '=', value: keys.x[index]},
                groupBy && keys.series
                    ? {field: groupBy, op: '=', value: keys.series[seriesIndex]}
                    : null
            ]),
            filter = clauses.length > 1 ? {op: 'AND', filters: clauses} : clauses[0];
        this.selection = isEqual(filter, this.selection) ? null : filter;
        this.setOutput('selection', this.selection);
    }

    //------------------
    // Implementation
    //------------------
    private selection: PlainObject = null;

    // The x value of each category, and the groupBy value of each series, of a grouped chart.
    private pointKeys: {x: unknown[]; series: unknown[]} = null;

    private readonly onPointClick = (e: any) =>
        this.selectPoint(e.point.series.index, e.point.index);

    private updateChart() {
        const props = this.view && this.source ? this.buildProps() : null,
            {chartModel} = this;
        if (!props) {
            chartModel.setSeries([]);
            return;
        }
        const config = mergeDeep(
            {},
            this.withSecondAxis(
                this.withPrimaryUnit(this.withFractionAxis(toHighchartsConfig(props), props))
            ),
            {plotOptions: {series: {point: {events: {click: this.onPointClick}}}}},
            this.checkedHighchartsConfig
        );
        if (!isEqual(config, chartModel.highchartsConfig)) chartModel.setHighchartsConfig(config);
        // The series of y2 follow those of y, on the second axis.
        const firstY2 = this.primary.length;
        const primaryTooltip = this.unitOf(this.primary[0])
                ? seriesTooltip(this.formatOf(this.primary[0]))
                : null,
            y2Tooltip = this.hasY2 ? seriesTooltip(this.formatOf(this.y2[0])) : null;
        chartModel.setSeries(
            toSeries(props, false).map((it, idx) =>
                this.hasY2 && idx >= firstY2
                    ? {...it, yAxis: 1, tooltip: y2Tooltip}
                    : primaryTooltip
                      ? {...it, tooltip: primaryTooltip}
                      : it
            )
        );
    }

    // Checked again once resolved, in case a value reaches it past the validator.
    private get checkedHighchartsConfig(): PlainObject {
        const config = this.resolvedConfig.highchartsConfig;
        if (!config) return {};
        const issues = checkHighchartsConfig(config);
        if (!issues.length) return config;
        this.logWarn('Dropped highchartsConfig', issues[0].message);
        return {};
    }

    private get y2(): string[] {
        return castArray(this.resolvedConfig.y2 ?? []).filter(it => this.source?.fields[it]);
    }

    private get primary(): string[] {
        return castArray(this.resolvedConfig.y ?? []).filter(it => this.source?.fields[it]);
    }

    // Values of a field, formatted as a number or a percent, with its unit. A field whose format
    // names a scale, such as millions, keeps it, where an axis would otherwise compact.
    private formatOf(field: string): (value: number, opts?: {compact?: boolean}) => string {
        const scaled = this.scaledFormatOf(field);
        if (scaled) return scaled;
        const format = this.isFraction(field) ? 'percent' : 'number',
            unit = this.unitOf(field);
        return (value, opts = {}) => {
            const text = String(fmtChatUiNumber(value, format, null, {asHtml: true, ...opts}));
            return value == null || !unit ? text : `${text}${unit}`;
        };
    }

    // A field's values as its own format writes them, where that format names a scale, else null.
    private scaledFormatOf(field: string): (value: number) => string {
        const def = this.source?.fields[field];
        if (!def) return null;
        const {catalog, blueprint} = this.blueprintModel,
            opts = resolveFormat(def, this.source.displayOf(field).formats, {catalog, blueprint});
        if (opts.scale == null) return null;
        return value => (value == null ? '' : String(formatValue(value, def, opts, catalog, true)));
    }

    // A field's label from its format, such as a unit its source's params choose, escaped.
    private unitOf(field: string): string {
        const def = this.source?.fields[field];
        if (!def) return '';
        const {catalog, blueprint} = this.blueprintModel,
            {label} = resolveFormat(def, this.source.displayOf(field).formats, {
                catalog,
                blueprint
            });
        return isString(label) ? escape(label) : '';
    }

    // The primary axis's labels with its first field's unit, where it has one.
    private withPrimaryUnit(config: PlainObject): PlainObject {
        const [first] = this.primary;
        if (!this.unitOf(first) && !this.scaledFormatOf(first)) return config;
        const fmt = this.formatOf(first);
        return {
            ...config,
            yAxis: {
                ...config.yAxis,
                labels: {
                    formatter: function (this: any) {
                        return fmt(this.value, {compact: true});
                    }
                }
            }
        };
    }

    private get hasY2(): boolean {
        return !this.resolvedConfig.groupBy && this.y2.length > 0;
    }

    /** A second axis on the right for the measures of y2, with labels formatted as their own. */
    private withSecondAxis(config: PlainObject): PlainObject {
        if (!this.hasY2) return config;
        const [first] = this.y2,
            {y2Title} = this.resolvedConfig,
            fmtY2 = this.formatOf(first),
            title = y2Title ?? (this.y2.length === 1 ? this.source.fieldLabel(first) : null);
        // Its own labels, as the primary's would format and clamp y2 as a fraction of y.
        return {
            ...config,
            yAxis: [
                config.yAxis,
                {
                    opposite: true,
                    // Highcharts reads a title as markup.
                    title: {text: title ? escape(title) : null},
                    labels: {
                        formatter: function (this: any) {
                            return fmtY2(this.value, {compact: true});
                        }
                    }
                }
            ]
        };
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
            ys: string[] = [
                ...castArray(cfg.y ?? []),
                ...(cfg.groupBy ? [] : castArray(cfg.y2 ?? []))
            ].filter(it => fields[it]),
            label = (f: string) => (fields[f] ? this.source.fieldLabel(f) : f),
            primary = castArray(cfg.y ?? []).filter(it => fields[it]),
            xTitle = cfg.xTitle ?? label(cfg.x),
            yAxis = {
                title: cfg.yTitle ?? (primary.length === 1 ? label(primary[0]) : null),
                format: (this.isFraction(ys[0]) ? 'percent' : 'number') as any
            },
            base = {type: (cfg.type ?? 'column') as any, stacking: cfg.stacking, yAxis};

        this.pointKeys = null;
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
        this.pointKeys = {x: rows.map(it => it.cubeLabelValue), series: null};

        if (cfg.groupBy && ys.length) {
            const [y] = ys,
                children = rows.flatMap(r => r.children ?? []),
                values = uniq(children.map(c => String(c.cubeLabel)));
            this.pointKeys.series = values.map(
                v => children.find(c => String(c.cubeLabel) === v)?.cubeLabelValue
            );
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

// A series' tooltip line, with its values formatted as its field's.
function seriesTooltip(fmt: (value: number) => string): PlainObject {
    return {
        // The series name reaches Highcharts escaped - see `toSeries()`.
        pointFormatter: function (this: any) {
            const name = this.series?.name ? `${this.series.name}: ` : '';
            return `<span style="color:${this.color}">●</span> ${name}<b>${fmt(this.y)}</b><br/>`;
        }
    };
}
