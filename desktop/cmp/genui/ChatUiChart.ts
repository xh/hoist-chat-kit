import {capitalize} from 'lodash';
import {chart, ChartModel} from '@xh/hoist/cmp/chart';
import {div} from '@xh/hoist/cmp/layout';
import {
    hoistCmp,
    HoistModel,
    type HoistProps,
    managed,
    useLocalModel,
    uses,
    XH
} from '@xh/hoist/core';
import {action, computed, observableRef} from '@xh/hoist/mobx';
import type {ChatUiComponentSpec} from '../../../genui';
import {toHighchartsConfig, toSeries, validateChartProps} from './impl/ChatUiChartData';
import {CHAT_UI_DECIMALS_SCHEMA, CHAT_UI_NUMBER_FORMAT_SCHEMA} from './ChatUiFormat';
import {chatUiFrame, chatUiSkeleton} from './ChatUiFrame';
import type {ChatUiSpecOptions, ChatUiNumberFormat} from './Types';
import './ChatUiChart.scss';

/** Type of a {@link ChatUiChart}. */
export type ChatUiChartType = 'line' | 'column' | 'bar' | 'area' | 'pie';

/** A point in a {@link ChatUiChartSeries}: a value, or an `[x, value]` pair - `[name, value]` for a pie. */
export type ChatUiChartPoint = number | [number | string, number];

/** A series of a {@link ChatUiChart}, as written by the model. */
export interface ChatUiChartSeries {
    /** Name of the series, for the legend and tooltips. */
    name: string;

    /**
     * The series' values. Plain values line up with the x-axis categories. On a datetime axis,
     * each point is a `[date, value]` pair, with the date as a `YYYY-MM-DD` string or as epoch
     * milliseconds. A pie's slices are `[name, value]` pairs - or plain values, named by the
     * x-axis categories.
     */
    data: ChatUiChartPoint[];
}

/** Props of a {@link ChatUiChart}, as written by the model. */
export interface ChatUiChartSpecProps {
    /** Title shown above the chart. */
    title?: string;

    /** Type of chart. A `bar` chart is horizontal, a `column` chart vertical. */
    type: ChatUiChartType;

    /** The x-axis. A pie uses only its `categories`, to name slices sent as plain values. */
    xAxis?: {
        /** `category` for named points, or `datetime` for a time series. Default `category`. */
        type?: 'category' | 'datetime';

        /** Names of the points, in order, for a category axis. */
        categories?: string[];

        /** Axis title. */
        title?: string;
    };

    /** The y-axis. */
    yAxis?: {
        /** Axis title. */
        title?: string;

        /** How values display, on the axis and in tooltips. Default `number`. */
        format?: ChatUiNumberFormat;

        /** Decimal places for values. Default suits the value and the format. */
        decimals?: number;
    };

    /** The data series. A pie chart takes exactly one. */
    series: ChatUiChartSeries[];
}

/** Options for {@link chatUiChartSpec}. */
export interface ChatUiChartSpecOptions extends ChatUiSpecOptions {
    /** Most series the model may send. Default 8. */
    maxSeries?: number;

    /** Most points per series the model may send. Default 500. */
    maxPoints?: number;

    /** Height of the chart, in pixels. Default 280. */
    height?: number;
}

/**
 * A chart component for a {@link ChatUiCatalog}: the model picks a chart type and sends its
 * series, and the chat shows them in a Hoist chart. Series fill in as the model writes them. The
 * chart follows the app's light or dark theme.
 *
 * Requires Highcharts, installed by the app as for any Hoist chart - see `installHighcharts`.
 *
 * The model's tool is `show_chart`, unless renamed with `name`.
 */
export function chatUiChartSpec(
    opts: ChatUiChartSpecOptions = {}
): ChatUiComponentSpec<ChatUiChartSpecProps> {
    const {name = 'chart', description = DESCRIPTION, maxSeries = 8, maxPoints = 500} = opts,
        height = opts.height ?? DEFAULT_HEIGHT;

    return {
        name,
        description,
        props: {
            type: 'object',
            required: ['type', 'series'],
            additionalProperties: false,
            properties: {
                title: {type: 'string', maxLength: 120, description: 'Short title for the chart.'},
                type: {
                    enum: ['line', 'column', 'bar', 'area', 'pie'],
                    description:
                        '"line" or "area" for trends over time, "column" to compare categories, ' +
                        '"bar" for horizontal bars with long category names, "pie" for the parts ' +
                        'of a whole - one series of [name, value] pairs, one per slice.'
                },
                xAxis: {
                    type: 'object',
                    additionalProperties: false,
                    description:
                        'The x-axis. Leave out for a pie, and name its slices in [name, value] pairs.',
                    properties: {
                        type: {
                            enum: ['category', 'datetime'],
                            description:
                                '"category" for named points, "datetime" for a time series. ' +
                                'Default "category".'
                        },
                        categories: {
                            type: 'array',
                            maxItems: maxPoints,
                            items: {type: 'string', maxLength: 60},
                            description:
                                'Names of the points, in order, for a category axis or a pie.'
                        },
                        title: {type: 'string', maxLength: 60}
                    }
                },
                yAxis: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        title: {type: 'string', maxLength: 60},
                        format: CHAT_UI_NUMBER_FORMAT_SCHEMA,
                        decimals: CHAT_UI_DECIMALS_SCHEMA
                    }
                },
                series: {
                    type: 'array',
                    minItems: 1,
                    maxItems: maxSeries,
                    items: {
                        type: 'object',
                        required: ['name', 'data'],
                        additionalProperties: false,
                        properties: {
                            name: {type: 'string', maxLength: 60},
                            data: {
                                type: 'array',
                                maxItems: maxPoints,
                                description:
                                    'Values in category order, or [x, value] pairs. On a ' +
                                    'datetime axis, use [date, value] pairs with "YYYY-MM-DD" ' +
                                    'dates. For a pie, use [name, value] pairs.',
                                items: {
                                    anyOf: [
                                        {type: 'number'},
                                        {
                                            type: 'array',
                                            minItems: 2,
                                            maxItems: 2,
                                            items: {type: ['number', 'string']}
                                        }
                                    ]
                                }
                            }
                        }
                    }
                }
            }
        },
        validate: validateChartProps,
        render: (props, {isPartial}) => chatUiChart({...props, isPartial, height}),
        example: {
            title: 'Monthly revenue',
            type: 'column',
            xAxis: {categories: ['Jan', 'Feb', 'Mar']},
            yAxis: {title: 'USD', format: 'currency', decimals: 0},
            series: [{name: 'Revenue', data: [182000, 205000, 231000]}]
        }
    };
}

/** Props for {@link ChatUiChart}. */
export interface ChatUiChartProps extends HoistProps, Partial<ChatUiChartSpecProps> {
    /** True while the props stream - the chart shows the points that are complete so far. */
    isPartial?: boolean;

    /** Height of the chart, in pixels. Default 280. */
    height?: number;
}

/**
 * A Hoist chart of the series given by the model - the component that {@link chatUiChartSpec}
 * renders. Its {@link ChartModel} is created once the chart's type and axes are complete and
 * destroyed with the component. Series load into the same model as they stream.
 */
export const [ChatUiChart, chatUiChart] = hoistCmp.withFactory<ChatUiChartProps>({
    displayName: 'ChatUiChart',
    // Takes any model in context, as `useLocalModel()` needs a component with a model spec.
    model: uses('*', {optional: true}),
    className: 'xh-chat-ui-chart',

    render({className, title, type, height = DEFAULT_HEIGHT}) {
        const {chartModel} = useLocalModel(ChatUiChartLocalModel);

        return chatUiFrame({
            className,
            title,
            item: chartModel
                ? div({
                      // Names the chart for screen readers, which otherwise hear only "Created
                      // with Highcharts".
                      role: 'figure',
                      'aria-label': title ?? (type ? `${capitalize(type)} chart` : 'Chart'),
                      item: chart({model: chartModel, height})
                  })
                : chatUiSkeleton(height)
        });
    }
});

//------------------
// Implementation
//------------------
const DESCRIPTION =
    'A chart - line, area, column, bar or pie. Use it for a series over time, a comparison ' +
    'across categories, or the parts of a whole. Prefer a grid when exact values matter more ' +
    'than the shape of the data. A pie takes one series of [name, value] pairs, for example ' +
    '{"type": "pie", "series": [{"name": "Weight", "data": [["Tech", 0.42], ["Energy", 0.18]]}]}.';

const DEFAULT_HEIGHT = 280;

type ChartLayout = Pick<ChatUiChartSpecProps, 'type' | 'xAxis' | 'yAxis'>;

class ChatUiChartLocalModel extends HoistModel {
    override xhImpl = true;

    /** The chart's model - null until its type and axes are complete. */
    @managed @observableRef accessor chartModel: ChartModel = null;

    private get props(): ChatUiChartProps {
        return this.componentProps as ChatUiChartProps;
    }

    /**
     * The chart's type and axes, once complete. The model writes the series after the axes, so
     * the axes are complete once the series begin.
     */
    @computed
    get layout(): ChartLayout {
        const {isPartial, type, xAxis, yAxis, series} = this.props;
        return isPartial && series == null ? null : {type, xAxis, yAxis};
    }

    @computed
    get series() {
        return toSeries(this.props, !!this.props.isPartial);
    }

    override onLinked() {
        this.addReaction(
            {
                // Compare the layout, not the Highcharts options, whose formatters are new
                // functions on every change of the props.
                track: () => this.layout,
                run: layout => this.updateChartModel(layout),
                equals: 'structural',
                fireImmediately: true
            },
            {
                track: () => [this.chartModel, this.series] as const,
                run: ([chartModel, series]) => chartModel?.setSeries(series),
                fireImmediately: true
            }
        );
    }

    @action
    private updateChartModel(layout: ChartLayout) {
        const highchartsConfig = layout ? toHighchartsConfig(layout) : null;
        if (!highchartsConfig) {
            XH.safeDestroy(this.chartModel);
            this.chartModel = null;
        } else if (this.chartModel) {
            this.chartModel.setHighchartsConfig(highchartsConfig);
        } else {
            this.chartModel = new ChartModel({xhImpl: true, highchartsConfig});
        }
    }
}
