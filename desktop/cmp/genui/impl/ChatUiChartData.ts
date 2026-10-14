import {dropRight, isArray, isFinite, isPlainObject, isString} from 'lodash';
import type {PlainObject} from '@xh/hoist/core';
import {LocalDate} from '@xh/hoist/utils/datetime';
import type {ChatUiChartSpecProps, ChatUiChartPoint} from '../ChatUiChart';
import {fmtChatUiNumber} from '../ChatUiFormat';

/**
 * Highcharts options for a chart's type and axes - everything but the series, which load
 * separately so that they can stream into the same chart.
 */
export function toHighchartsConfig(
    props: Pick<ChatUiChartSpecProps, 'type' | 'xAxis' | 'yAxis'>
): PlainObject {
    const {type = 'line', xAxis = {}, yAxis = {}} = props,
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
            series: {animation: false, marker: {enabledThreshold: 6}},
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
export function toSeries(props: Partial<ChatUiChartSpecProps>, isPartial: boolean): PlainObject[] {
    const {type, xAxis, series} = props,
        isDatetime = xAxis?.type === 'datetime',
        isPie = type === 'pie',
        categories = xAxis?.categories ?? [];

    if (!isArray(series)) return [];
    const validSeries = series.filter(isPlainObject);
    return validSeries.map((it, idx) => {
        let data = isArray(it.data) ? it.data : [];
        if (isPartial && idx === validSeries.length - 1) data = dropRight(data);
        return {
            name: it.name ?? '',
            showInLegend: isPie || validSeries.length > 1,
            data: data.map((point, pointIdx) =>
                isPie && !isArray(point)
                    ? {name: categories[pointIdx] ?? `Item ${pointIdx + 1}`, y: toValue(point)}
                    : toPoint(point, isDatetime)
            )
        };
    });
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
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function toValue(value: unknown): number {
    return isFinite(value) ? (value as number) : null;
}

function toPoint(point: ChatUiChartPoint, isDatetime: boolean): number | [unknown, number] {
    if (!isArray(point)) return toValue(point);
    const [x, y] = point;
    return [isDatetime ? toTimestamp(x) : x, toValue(y)];
}
