import {LocalDate} from '@xh/hoist/utils/datetime';
import {describe, expect, it} from 'vitest';
import type {ChatUiChartSpecProps} from '../ChatUiChart';
import type {ChatDataFrame} from '../../../../genui';
import {
    limitChartProps,
    toChartArtifact,
    toChartProps,
    toHighchartsConfig,
    toSeries,
    toTimestamp,
    validateChartProps
} from './ChatUiChartData';

describe('toHighchartsConfig', () => {
    it('maps the chart type and axes to Highcharts options', () => {
        const config = toHighchartsConfig({
            type: 'column',
            xAxis: {categories: ['Q1', 'Q2'], title: 'Quarter'},
            yAxis: {title: 'Revenue', format: 'currency', decimals: 0}
        });
        expect(config.chart.type).toBe('column');
        expect(config.xAxis).toEqual({
            type: 'category',
            categories: ['Q1', 'Q2'],
            title: {text: 'Quarter'}
        });
        expect(config.yAxis.title).toEqual({text: 'Revenue'});
        // Axis labels compact large values, while tooltips show them in full.
        expect(config.yAxis.labels.formatter.call({value: 1250000})).toBe('$1.25M');
        expect(config.yAxis.labels.formatter.call({value: 25000})).toBe('$25,000');
    });

    it('shares the tooltip across series, except for a pie', () => {
        expect(toHighchartsConfig({type: 'line'}).tooltip.shared).toBe(true);
        expect(toHighchartsConfig({type: 'pie'}).tooltip.shared).toBe(false);
    });
});

describe('toSeries', () => {
    it('converts dates on a datetime axis to timestamps', () => {
        const props: ChatUiChartSpecProps = {
            type: 'line',
            xAxis: {type: 'datetime'},
            series: [
                {
                    name: 'NAV',
                    data: [
                        ['2026-10-01', 101.5],
                        ['2026-10-02', 102]
                    ]
                }
            ]
        };
        expect(toSeries(props, false)).toEqual([
            {
                name: 'NAV',
                showInLegend: false,
                data: [
                    [LocalDate.get('2026-10-01').timestamp, 101.5],
                    [LocalDate.get('2026-10-02').timestamp, 102]
                ]
            }
        ]);
    });

    it('names the values of a pie after the categories', () => {
        const props: ChatUiChartSpecProps = {
            type: 'pie',
            xAxis: {categories: ['Equity', 'Credit']},
            series: [{name: 'Allocation', data: [0.6, 0.4]}]
        };
        expect(toSeries(props, false)[0].data).toEqual([
            {name: 'Equity', y: 0.6},
            {name: 'Credit', y: 0.4}
        ]);
    });

    it('names the slices of a pie from [name, value] pairs, as its instructions ask', () => {
        const props: ChatUiChartSpecProps = {
            type: 'pie',
            series: [
                {
                    name: 'Weight',
                    data: [
                        ['Tech', 0.42],
                        ['Energy', 0.18]
                    ]
                }
            ]
        };
        expect(toSeries(props, false)[0].data).toEqual([
            ['Tech', 0.42],
            ['Energy', 0.18]
        ]);
        expect(validateChartProps(props)).toEqual([]);
    });

    it('shows a legend entry per series only when there is more than one', () => {
        const series = [
            {name: 'A', data: [1]},
            {name: 'B', data: [2]}
        ];
        expect(toSeries({type: 'line', series}, false).map(it => it.showInLegend)).toEqual([
            true,
            true
        ]);
    });

    it('leaves out the last point of the last series while the props stream', () => {
        const props = {
            type: 'line' as const,
            series: [
                {name: 'A', data: [1, 2, 3]},
                {name: 'B', data: [4, 5]}
            ]
        };
        expect(toSeries(props, true).map(it => it.data)).toEqual([[1, 2, 3], [4]]);
    });

    it('turns values that are not numbers into gaps', () => {
        const props = {type: 'line' as const, series: [{name: 'A', data: [1, 'x' as any, 3]}]};
        expect(toSeries(props, false)[0].data).toEqual([1, null, 3]);
    });
});

describe('validateChartProps', () => {
    it('requires exactly one series for a pie', () => {
        const series: ChatUiChartSpecProps['series'] = [
            {name: 'A', data: [['X', 1]]},
            {name: 'B', data: [['Y', 2]]}
        ];
        expect(validateChartProps({type: 'pie', series})).toEqual([
            'series: a pie chart takes exactly one series, got 2'
        ]);
    });

    it('requires a name for each pie slice, from a pair or from the categories', () => {
        const series = [{name: 'Weight', data: [0.6, 0.4]}];
        expect(validateChartProps({type: 'pie', series})).toEqual([
            'series[0].data[0]: a pie slice needs a name - send [name, value] pairs'
        ]);
        expect(
            validateChartProps({type: 'pie', xAxis: {categories: ['Equity', 'Credit']}, series})
        ).toEqual([]);
    });

    it('requires date and value pairs on a datetime axis', () => {
        const props: ChatUiChartSpecProps = {
            type: 'line',
            xAxis: {type: 'datetime'},
            series: [{name: 'A', data: [['2026-10-01', 1], 2]}]
        };
        expect(validateChartProps(props)).toEqual([
            'series[0].data[1]: a datetime x-axis needs [date, value] pairs, with dates as ' +
                '"YYYY-MM-DD" strings or epoch milliseconds'
        ]);
    });

    it('rejects more values than categories', () => {
        const props: ChatUiChartSpecProps = {
            type: 'column',
            xAxis: {categories: ['Q1']},
            series: [{name: 'A', data: [1, 2]}]
        };
        expect(validateChartProps(props)).toEqual(['series[0].data: 2 values for 1 categories']);
    });
});

describe('toTimestamp', () => {
    it('reads epoch millis, ISO dates at local midnight, and date-times', () => {
        expect(toTimestamp(1760000000000)).toBe(1760000000000);
        expect(toTimestamp('2026-10-01')).toBe(new Date(2026, 9, 1).getTime());
        expect(toTimestamp('2026-10-01T12:00:00Z')).toBe(Date.UTC(2026, 9, 1, 12));
    });

    it('returns null for a value that is not a date', () => {
        expect(toTimestamp('next week')).toBeNull();
        expect(toTimestamp('2026-02-31')).toBeNull();
        expect(toTimestamp(null)).toBeNull();
    });
});

describe('toSeries dash', () => {
    it('dashes the second series of a line chart, so that it differs by more than hue', () => {
        const series = toSeries(
            {
                type: 'line',
                series: [
                    {name: 'A', data: [1]},
                    {name: 'B', data: [2]}
                ]
            },
            false
        );
        expect(series[0].dashStyle).toBeUndefined();
        expect(series[1].dashStyle).toBe('ShortDash');
    });
});

describe('toChartProps', () => {
    const frame: ChatDataFrame = {
        columns: [
            {name: 'date', type: 'date'},
            {name: 'desk', type: 'string'},
            {name: 'pnl', type: 'number', label: 'P&L', format: 'currency'},
            {name: 'gross', type: 'number'}
        ],
        rows: [
            {date: '2026-10-01', desk: 'Rates', pnl: 1, gross: 10},
            {date: '2026-10-01', desk: 'FX', pnl: -2, gross: 20},
            {date: '2026-10-02', desk: 'Rates', pnl: 3, gross: 30}
        ],
        totalRows: 3
    };

    it('charts a date x column on a datetime axis, one series per y column', () => {
        const props = toChartProps(frame, {type: 'line', x: 'date', y: ['pnl', 'gross']});
        expect(props.xAxis.type).toBe('datetime');
        expect(props.yAxis.format).toBe('currency');
        expect(props.series.map(it => it.name)).toEqual(['P&L', 'Gross']);
        expect(props.series[0].data[0]).toEqual(['2026-10-01', 1]);
    });

    it('charts a text x column as categories, and one series per value of groupBy', () => {
        const props = toChartProps(frame, {type: 'column', x: 'desk', y: ['pnl'], groupBy: 'date'});
        expect(props.xAxis.categories).toEqual(['Rates', 'FX']);
        expect(props.series).toEqual([
            {name: '2026-10-01', data: [1, -2]},
            {name: '2026-10-02', data: [3, null]}
        ]);
    });

    it('applies the view first - its filter, sort and limit', () => {
        const props = toChartProps(frame, {
            type: 'bar',
            x: 'desk',
            y: ['gross'],
            filter: [{field: 'desk', op: 'eq', value: 'Rates'}],
            sortBy: 'gross|desc',
            top: 1
        });
        expect(props.xAxis.categories).toEqual(['Rates']);
        expect(props.series[0].data).toEqual([30]);
    });

    it('charts a pie as named slices', () => {
        const props = toChartProps(frame, {type: 'pie', x: 'desk', y: ['gross'], top: 2});
        expect(props.series[0].data).toEqual([
            ['Rates', 10],
            ['FX', 20]
        ]);
    });
});

describe('toChartArtifact', () => {
    it('turns inline series into rows by x, and a view that charts them again', () => {
        const {artifact, view} = toChartArtifact({
            type: 'column',
            xAxis: {categories: ['Q1', 'Q2']},
            yAxis: {format: 'percent'},
            series: [
                {name: 'Fund', data: [0.1, 0.2]},
                {name: 'Index', data: [0.05]}
            ]
        });
        expect(artifact.rows).toEqual([
            {x: 'Q1', s0: 0.1, s1: 0.05},
            {x: 'Q2', s0: 0.2}
        ]);
        expect(artifact.columns[1]).toMatchObject({name: 's0', label: 'Fund', format: 'percent'});
        expect(view).toEqual({type: 'column', x: 'x', y: ['s0', 's1']});
    });

    it('orders a datetime series by time', () => {
        const {artifact} = toChartArtifact({
            type: 'line',
            xAxis: {type: 'datetime'},
            series: [
                {
                    name: 'NAV',
                    data: [
                        ['2026-10-02', 2],
                        ['2026-10-01', 1]
                    ]
                }
            ]
        });
        expect(artifact.columns[0].type).toBe('datetime');
        expect(artifact.rows.map(it => it.s0)).toEqual([1, 2]);
    });
});

describe('limitChartProps', () => {
    it('keeps the first series, and says how many it leaves out', () => {
        const {props, hiddenSeries} = limitChartProps(
            {
                type: 'line',
                series: Array.from({length: 7}, (_, idx) => ({name: `S${idx}`, data: [idx]}))
            },
            5,
            500
        );
        expect(props.series).toHaveLength(5);
        expect(hiddenSeries).toBe(2);
    });

    it('samples values and their categories together, keeping the first and last', () => {
        const categories = Array.from({length: 100}, (_, idx) => `C${idx}`),
            {props} = limitChartProps(
                {
                    type: 'column',
                    xAxis: {categories},
                    series: [{name: 'A', data: Array.from({length: 100}, (_, idx) => idx)}]
                },
                5,
                10
            );
        expect(props.series[0].data).toHaveLength(10);
        expect(props.xAxis.categories).toHaveLength(10);
        expect(props.series[0].data[9]).toBe(99);
        expect(props.xAxis.categories[9]).toBe('C99');
    });
});
