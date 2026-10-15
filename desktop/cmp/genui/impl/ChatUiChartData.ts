import {
    dropRight,
    groupBy,
    isArray,
    isFinite,
    isPlainObject,
    isString,
    keyBy,
    max,
    omit,
    sortBy,
    uniq
} from 'lodash';
import type {PlainObject} from '@xh/hoist/core';
import {genDisplayName} from '@xh/hoist/data';
import {LocalDate} from '@xh/hoist/utils/datetime';
import {
    applyDataView,
    type ChatArtifact,
    type ChatChartType,
    type ChatChartView,
    type ChatDataColumn,
    type ChatDataFrame
} from '../../../../genui';
import type {ChatUiChartSpecProps, ChatUiChartPoint} from '../ChatUiChart';
import {fmtChatUiNumber} from '../ChatUiFormat';
import type {ChatUiNumberFormat} from '../Types';

/**
 * The props of a chart, as the model writes them inline or as a view over an artifact makes them:
 * the inline props, with the extra types and options of a {@link ChatChartView}.
 */
export interface ChatUiChartLayoutProps extends Omit<ChatUiChartSpecProps, 'type' | 'series'> {
    type: ChatChartType;
    series?: ChatUiChartSpecProps['series'];
    stacking?: ChatChartView['stacking'];
    colorBySign?: boolean;
}

/**
 * Highcharts options for a chart's type and axes - everything but the series, which load
 * separately so that they can stream into the same chart.
 */
export function toHighchartsConfig(
    props: Pick<ChatUiChartLayoutProps, 'type' | 'xAxis' | 'yAxis' | 'stacking'>
): PlainObject {
    const {type = 'line', xAxis = {}, yAxis = {}, stacking} = props,
        {format, decimals} = yAxis,
        fmtValue = (v: number) => fmtChatUiNumber(v, format, decimals, {asHtml: true}),
        // Axis labels are short, so large values scale to K, M, B or T - tooltips show them in full.
        fmtAxisValue = (v: number) =>
            fmtChatUiNumber(v, format, decimals, {asHtml: true, compact: true});

    return {
        chart: {type, animation: false, backgroundColor: 'transparent'},
        legend: {enabled: true},
        xAxis: {
            type: xAxis.type ?? 'category',
            categories: xAxis.categories,
            title: {text: xAxis.title ?? null}
        },
        yAxis: {
            title: {text: yAxis.title ?? null},
            labels: {
                formatter: function (this: any) {
                    return fmtAxisValue(this.value);
                }
            }
        },
        tooltip: {
            shared: type !== 'pie',
            pointFormatter: function (this: any) {
                const value = fmtValue(this.y),
                    label = type === 'pie' ? this.name : this.series.name;
                return `<span style="color:${this.color}">●</span> ${label}: <b>${value}</b><br/>`;
            }
        },
        plotOptions: {
            // Markers only where points are far enough apart to read - not on a dense series.
            series: {animation: false, marker: {enabledThreshold: 6}, stacking},
            area: {fillOpacity: 0.25},
            pie: {
                innerSize: '50%',
                // No slice borders - Highcharts draws them white, which glares in the dark theme.
                borderWidth: 0,
                dataLabels: {enabled: true, format: '{point.name}: {point.percentage:.1f}%'}
            }
        }
    };
}

/**
 * Highcharts series for a chart. Dates on a datetime axis become timestamps, and values that are
 * not numbers become gaps. A pie's `[name, value]` pairs name its slices, and its plain values take
 * their names from the x-axis categories.
 *
 * @param props - the chart's props.
 * @param isPartial - true while the props stream. The last point is left out, as it may be cut
 *      short.
 */
export function toSeries(
    props: Partial<ChatUiChartLayoutProps>,
    isPartial: boolean
): PlainObject[] {
    const {type, xAxis, series, colorBySign} = props,
        isDatetime = xAxis?.type === 'datetime',
        isPie = type === 'pie',
        categories = xAxis?.categories ?? [];

    if (!isArray(series)) return [];
    const validSeries = series.filter(isPlainObject);
    return validSeries.map((it, idx) => {
        let data = isArray(it.data) ? it.data : [];
        if (isPartial && idx === validSeries.length - 1) data = dropRight(data);
        const ret: PlainObject = {
            name: it.name ?? '',
            showInLegend: isPie || validSeries.length > 1,
            data: data.map((point, pointIdx) =>
                isPie && !isArray(point)
                    ? {name: categories[pointIdx] ?? `Item ${pointIdx + 1}`, y: toValue(point)}
                    : toPoint(point, isDatetime)
            )
        };
        // The second series differs in dash as well as hue.
        if (idx === 1 && LINE_TYPES.includes(type ?? 'line')) ret.dashStyle = 'ShortDash';
        if (colorBySign && validSeries.length === 1) Object.assign(ret, getSignColors());
        return ret;
    });
}

/**
 * The props of a chart of a view over a frame: the view applied to the rows, then its x column as
 * the axis and its y columns as series - or the series of each value of `groupBy`. A date x column
 * makes a datetime axis.
 *
 * @throws if the view does not fit the frame's columns - see `findDataViewProblems()`.
 */
export function toChartProps(frame: ChatDataFrame, view: ChatChartView): ChatUiChartLayoutProps {
    const applied = applyDataView(frame, omit(view, 'columns')),
        byName = keyBy(applied.columns, 'name'),
        xCol = byName[view.x],
        yCols = view.y.map(it => byName[it]),
        {type, groupBy: groupField, stacking, colorBySign} = view,
        rows = applied.rows,
        isPie = type === 'pie',
        isDatetime = !isPie && (xCol.type === 'date' || xCol.type === 'datetime'),
        isPairs = isDatetime || type === 'scatter',
        first = yCols[0],
        yAxis = {
            title: yCols.length === 1 && !groupField ? getLabel(first) : null,
            format: toNumberFormat(first.format),
            decimals: isFinite(first.decimals) ? first.decimals : null
        },
        xAxis = {type: isDatetime ? 'datetime' : 'category', title: getLabel(xCol)} as const;

    if (isPie) {
        return {
            type,
            yAxis,
            series: [
                {
                    name: getLabel(first),
                    data: rows.map(row => [toText(row[xCol.name]), toNumber(row[first.name])])
                }
            ]
        };
    }

    const pairs = (seriesRows: PlainObject[], yName: string): ChatUiChartPoint[] =>
        seriesRows.map(row => [row[xCol.name], toNumber(row[yName])] as ChatUiChartPoint);

    if (groupField) {
        const groups = groupBy(rows, row => toText(row[groupField]));
        if (isPairs) {
            return {
                type,
                xAxis,
                yAxis,
                stacking,
                series: Object.entries(groups).map(([name, groupRows]) => ({
                    name,
                    data: pairs(groupRows, first.name)
                }))
            };
        }
        const categories = uniq(rows.map(row => toText(row[xCol.name])));
        return {
            type,
            xAxis: {...xAxis, categories},
            yAxis,
            stacking,
            series: Object.entries(groups).map(([name, groupRows]) => {
                const byX = keyBy(groupRows, row => toText(row[xCol.name]));
                return {name, data: categories.map(it => toNumber(byX[it]?.[first.name]))};
            })
        };
    }

    return {
        type,
        xAxis: isPairs ? xAxis : {...xAxis, categories: rows.map(row => toText(row[xCol.name]))},
        yAxis,
        stacking,
        colorBySign,
        series: yCols.map(col => ({
            name: getLabel(col),
            data: isPairs ? pairs(rows, col.name) : rows.map(row => toNumber(row[col.name]))
        }))
    };
}

/**
 * An artifact of a chart's inline series, and the view that charts it again - so that the chart
 * can open in the side panel, with its type and axes free to change. Its columns are `x`, and `s0`,
 * `s1`... for the series.
 */
export function toChartArtifact(props: ChatUiChartSpecProps): {
    artifact: ChatArtifact;
    view: ChatChartView;
} {
    const {type, xAxis = {}, yAxis = {}} = props,
        series = (props.series ?? []).filter(isPlainObject),
        categories = xAxis.categories ?? [],
        isPie = type === 'pie',
        isDatetime = !isPie && xAxis.type === 'datetime',
        columns: ChatDataColumn[] = [
            {
                name: 'x',
                type: isDatetime ? 'datetime' : 'string',
                label: xAxis.title ?? (isPie ? 'Name' : isDatetime ? 'Date' : 'Category')
            },
            ...series.map((it, idx) => ({
                name: `s${idx}`,
                type: 'number' as const,
                label: it.name || `Series ${idx + 1}`,
                format: yAxis.format,
                decimals: yAxis.decimals
            }))
        ],
        rowsByX = new Map<string | number, PlainObject>();

    series.forEach((it, seriesIdx) => {
        (isArray(it.data) ? it.data : []).forEach((point, pointIdx) => {
            const [rawX, value] = isArray(point)
                    ? point
                    : [
                          categories[pointIdx] ?? (isPie ? `Item ${pointIdx + 1}` : pointIdx + 1),
                          point
                      ],
                x = isDatetime ? toTimestamp(rawX) : toText(rawX);
            if (x == null) return;
            if (!rowsByX.has(x)) rowsByX.set(x, {x});
            rowsByX.get(x)[`s${seriesIdx}`] = toNumber(value);
        });
    });

    const rows = isDatetime ? sortBy([...rowsByX.values()], 'x') : [...rowsByX.values()];
    return {
        artifact: {id: INLINE_CHART_ID, columns, rows, totalRows: rows.length},
        view: {type, x: 'x', y: series.map((_, idx) => `s${idx}`)}
    };
}

/**
 * A chart's props cut to what an inline chart draws: the first `maxSeries` series, and each
 * series sampled down to `maxPoints` points. Values on a category axis keep their categories.
 *
 * @returns the props, and the number of series left out.
 */
export function limitChartProps(
    props: ChatUiChartLayoutProps,
    maxSeries: number,
    maxPoints: number
): {props: ChatUiChartLayoutProps; hiddenSeries: number} {
    const series = (props.series ?? []).filter(isPlainObject),
        shown = series.slice(0, Math.max(1, maxSeries)),
        categories = props.xAxis?.categories,
        valueCount = max([categories?.length ?? 0, ...shown.map(it => it.data?.length ?? 0)]) ?? 0,
        valueIdxs = valueCount > maxPoints ? sampleIndexes(valueCount, maxPoints) : null;

    const sampled = shown.map(it => {
        const data = isArray(it.data) ? it.data : [];
        if (data.length <= maxPoints && !valueIdxs) return it;
        // Values in category order keep their places; pairs carry their own x.
        const isPairs = data.length && data.every(isArray),
            idxs = isPairs ? sampleIndexes(data.length, maxPoints) : valueIdxs;
        return {...it, data: idxs.filter(idx => idx < data.length).map(idx => data[idx])};
    });

    return {
        props: {
            ...props,
            xAxis:
                valueIdxs && categories
                    ? {...props.xAxis, categories: valueIdxs.map(idx => categories[idx])}
                    : props.xAxis,
            series: sampled
        },
        hiddenSeries: series.length - shown.length
    };
}

/**
 * Checks on complete chart props that the schema cannot express: one series of named slices for a
 * pie, date and value pairs on a datetime axis, and no more values than categories.
 */
export function validateChartProps(props: ChatUiChartSpecProps): string[] {
    const {type, xAxis, series = []} = props,
        isDatetime = xAxis?.type === 'datetime',
        categories = xAxis?.categories,
        errors: string[] = [];

    if (type === 'pie' && series.length !== 1) {
        errors.push(`series: a pie chart takes exactly one series, got ${series.length}`);
    }

    series.forEach(({data = []}, idx) => {
        if (type === 'pie') {
            const badIdx = data.findIndex(
                (it, pointIdx) => !isArray(it) && categories?.[pointIdx] == null
            );
            if (badIdx >= 0) {
                errors.push(
                    `series[${idx}].data[${badIdx}]: a pie slice needs a name - send ` +
                        '[name, value] pairs'
                );
            }
        } else if (isDatetime) {
            const badIdx = data.findIndex(it => !isArray(it) || toTimestamp(it[0]) == null);
            if (badIdx >= 0) {
                errors.push(
                    `series[${idx}].data[${badIdx}]: a datetime x-axis needs [date, value] ` +
                        'pairs, with dates as "YYYY-MM-DD" strings or epoch milliseconds'
                );
            }
        } else if (categories && data.length > categories.length) {
            errors.push(
                `series[${idx}].data: ${data.length} values for ${categories.length} categories`
            );
        }
    });
    return errors;
}

/**
 * A timestamp for an x value on a datetime axis: epoch milliseconds as is, a `YYYY-MM-DD` date at
 * local midnight, or any other date string Date can parse. Null if it is not a date.
 */
export function toTimestamp(value: unknown): number {
    if (isFinite(value)) return value as number;
    if (!isString(value)) return null;
    if (DATE_RE.test(value)) {
        try {
            return LocalDate.get(value).timestamp;
        } catch {
            return null;
        }
    }
    const ret = Date.parse(value);
    return isNaN(ret) ? null : ret;
}

//------------------
// Implementation
//------------------
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/,
    LINE_TYPES: ChatChartType[] = ['line', 'area'],
    NUMBER_FORMATS: ChatUiNumberFormat[] = ['number', 'percent', 'currency', 'none'],
    INLINE_CHART_ID = 'xh-inline-chart';

function getLabel(column: ChatDataColumn): string {
    return column.label ?? genDisplayName(column.name);
}

function toNumberFormat(format: string): ChatUiNumberFormat {
    return NUMBER_FORMATS.includes(format as ChatUiNumberFormat)
        ? (format as ChatUiNumberFormat)
        : 'number';
}

function toNumber(value: unknown): number {
    const ret = isString(value) && value.trim() !== '' ? Number(value) : value;
    return isFinite(ret) ? (ret as number) : null;
}

function toText(value: unknown): string {
    return value == null ? '' : String(value);
}

// Indexes of `count` values sampled evenly down to `max`, keeping the first and the last.
function sampleIndexes(count: number, max: number): number[] {
    if (count <= max) return Array.from({length: count}, (_, idx) => idx);
    const step = (count - 1) / (max - 1);
    return uniq(Array.from({length: max}, (_, idx) => Math.round(idx * step)));
}

// Hoist's value colors for a series colored by sign. Highcharts draws to SVG attributes, which do
// not resolve CSS variables, so read them as computed.
function getSignColors(): PlainObject {
    const style = window.getComputedStyle(document.body),
        color = style.getPropertyValue('--xh-pos-val-color').trim(),
        negativeColor = style.getPropertyValue('--xh-neg-val-color').trim();
    return color && negativeColor ? {color, negativeColor} : {};
}

function toValue(value: unknown): number {
    return isFinite(value) ? (value as number) : null;
}

function toPoint(point: ChatUiChartPoint, isDatetime: boolean): number | [unknown, number] {
    if (!isArray(point)) return toValue(point);
    const [x, y] = point;
    return [isDatetime ? toTimestamp(x) : x, toValue(y)];
}
