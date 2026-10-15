import {capitalize, isEmpty, pick} from 'lodash';
import type {ReactElement, ReactNode} from 'react';
import {chart, ChartModel} from '@xh/hoist/cmp/chart';
import {errorMessage} from '@xh/hoist/cmp/error';
import {div} from '@xh/hoist/cmp/layout';
import {hoistCmp, type HoistProps, managed, useLocalModel, uses, XH} from '@xh/hoist/core';
import {button} from '@xh/hoist/desktop/cmp/button';
import {Icon} from '@xh/hoist/icon';
import {action, computed, observableRef} from '@xh/hoist/mobx';
import {
    CHAT_CHART_VIEW_PROPERTIES,
    ChatArtifactRegistry,
    type ChatChartType,
    type ChatChartView,
    type ChatDataColumn,
    type ChatDataHandle,
    type ChatUiComponentSpec,
    findDataViewProblems
} from '../../../genui';
import {CHAT_UI_CHART_DEFAULTS} from './impl/ChatUiDefaults';
import {chartMenuButton} from './impl/ChatUiChartMenu';
import {
    type ChatUiChartLayoutProps,
    limitChartProps,
    toChartArtifact,
    toChartProps,
    toHighchartsConfig,
    toSeries,
    validateChartProps
} from './impl/ChatUiChartData';
import {ChatUiExpandModel, type ChatUiExpandRequest, expandDialog} from './impl/ChatUiExpand';
import {CHAT_UI_DECIMALS_SCHEMA, CHAT_UI_NUMBER_FORMAT_SCHEMA} from './ChatUiFormat';
import {chatUiExpandButton, chatUiFrame, chatUiSkeleton} from './ChatUiFrame';
import type {ChatUiChartDefaults, ChatUiNumberFormat, ChatUiSpecOptions} from './Types';
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

/**
 * Props of a {@link ChatUiChart} by reference, as written by the model: the id of an artifact that
 * a tool produced, and a chart view over it. The model never writes the points.
 */
export interface ChatUiChartRefSpecProps extends ChatChartView {
    /** Title shown above the chart. */
    title?: string;

    /** Id of the artifact to chart. */
    data: string;
}

/** Options for {@link chatUiChartSpec}. */
export interface ChatUiChartSpecOptions extends ChatUiSpecOptions {
    /** Most series the model may send inline. Default 8. */
    maxSeries?: number;

    /** Most points per series the model may send inline. Default 500. */
    maxPoints?: number;

    /**
     * Most rows of an artifact the chart loads, by reference. A larger artifact shows a notice,
     * with the table to open instead. Default 5,000.
     */
    maxRows?: number;

    /**
     * Height of the chart body, in pixels. Default the `--xh-chat-chart-height` CSS variable: 220
     * px, and 160 px at compact density.
     */
    height?: number;

    /**
     * True for a chart by reference: the model names an artifact a tool produced, with a chart
     * view over it - the type, the x column and the y columns - and the chat loads the rows from
     * the chat's artifact registry. The props are then {@link ChatUiChartRefSpecProps}. Default
     * false - the model writes the series.
     */
    byReference?: boolean;
}

/**
 * A chart component for a {@link ChatUiCatalog}: the model picks a chart type and sends its
 * series, and the chat shows them in a Hoist chart card. Series fill in as the model writes them.
 * The chart follows the app's light or dark theme. Expand opens the chart in the chat's side panel,
 * or a dialog, with switchers for its type and axes.
 *
 * With `byReference`, the model names an artifact and a chart view over it instead, and the chat
 * charts the artifact's rows.
 *
 * Requires Highcharts, installed by the app as for any Hoist chart - see `installHighcharts`.
 *
 * The model's tool is `show_chart`, unless renamed with `name`.
 */
export function chatUiChartSpec(
    opts?: ChatUiChartSpecOptions & {byReference?: false}
): ChatUiComponentSpec<ChatUiChartSpecProps>;
export function chatUiChartSpec(
    opts: ChatUiChartSpecOptions & {byReference: true}
): ChatUiComponentSpec<ChatUiChartRefSpecProps>;
export function chatUiChartSpec(opts: ChatUiChartSpecOptions = {}): ChatUiComponentSpec<any> {
    return opts.byReference ? createRefSpec(opts) : createInlineSpec(opts);
}

function createInlineSpec(opts: ChatUiChartSpecOptions): ChatUiComponentSpec<ChatUiChartSpecProps> {
    const {
        name = 'chart',
        description = DESCRIPTION,
        maxSeries = 8,
        maxPoints = 500,
        height = null
    } = opts;

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

function createRefSpec(opts: ChatUiChartSpecOptions): ChatUiComponentSpec<ChatUiChartRefSpecProps> {
    const {name = 'chart', description = REF_DESCRIPTION, maxRows = 5_000, height = null} = opts;

    return {
        name,
        description,
        props: {
            type: 'object',
            required: ['data', 'type', 'x', 'y'],
            additionalProperties: false,
            properties: {
                title: {type: 'string', maxLength: 120, description: 'Short title for the chart.'},
                data: {
                    type: 'string',
                    minLength: 1,
                    maxLength: 200,
                    description: 'Id of the artifact to chart - a result set a tool produced.'
                },
                ...CHAT_CHART_VIEW_PROPERTIES
            }
        },
        dataProps: [{name: 'data', pageSize: maxRows, maxRows}],
        render: (props, {isPartial, data, artifacts}) =>
            chatUiChart({
                title: props.title,
                dataHandle: data.data ?? null,
                registry: artifacts,
                view:
                    props.type && props.x && props.y
                        ? (pick(props, VIEW_PROPS) as ChatChartView)
                        : null,
                isPartial,
                height
            }),
        example: {
            title: 'Daily P&L',
            data: 'pnl-1',
            type: 'line',
            x: 'date',
            y: ['pnl'],
            units: 'millions'
        }
    };
}

/** Props for {@link ChatUiChart}. */
export interface ChatUiChartProps extends HoistProps, Partial<ChatUiChartSpecProps> {
    /** True while the props stream - the chart shows the points that are complete so far. */
    isPartial?: boolean;

    /**
     * Height of the chart body, in pixels. Default the `--xh-chat-chart-height` CSS variable: 220
     * px, and 160 px at compact density.
     */
    height?: number;

    /** The data of a chart by reference, from the catalog's `context.data`. Takes the place of `series`. */
    dataHandle?: ChatDataHandle;

    /** The registry that holds the artifact of `dataHandle`, for the expanded chart. */
    registry?: ChatArtifactRegistry;

    /** The chart view over the artifact of `dataHandle`: its type, x column and y columns. */
    view?: ChatChartView;
}

/**
 * A chart card - the component that {@link chatUiChartSpec} renders: the title in the header
 * strip, a Hoist chart at a fixed height, Expand, and an options menu to copy the image or
 * download it, or the data as CSV. Its {@link ChartModel} is created once the chart's type and axes
 * are complete and destroyed with the component. Series load into the same model as they stream.
 *
 * An inline chart draws at most `ChatUiChart.defaults.maxInlineSeries` series, and samples each
 * one down to `maxInlinePoints` points. The expanded chart draws everything.
 */
export const [ChatUiChart, chatUiChart] = hoistCmp.withFactory<
    ChatUiChartProps,
    ChatUiChartDefaults
>({
    displayName: 'ChatUiChart',
    // Takes any model in context, as `useLocalModel()` needs a component with a model spec.
    model: uses('*', {optional: true}),
    className: 'xh-chat-ui-chart',
    defaults: CHAT_UI_CHART_DEFAULTS,

    render({className, title, type, height}) {
        const impl = useLocalModel(ChatUiChartLocalModel);
        return div({className, items: [cardFrame(impl, title, type, height), expandDialog(impl)]});
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

const REF_DESCRIPTION =
    'A chart of a result set that a tool produced - an artifact. Name the artifact by its id in ' +
    '`data`, and never copy its values. Pick the type, the x column and the numeric y columns - ' +
    'one series each, or one per value of `groupBy`. Filter, sort and scale with the view props.';

const VIEW_PROPS = [
    'type',
    'x',
    'y',
    'groupBy',
    'stacking',
    'colorBySign',
    'sortBy',
    'filter',
    'top',
    'units'
];

const TYPE_ICONS: Partial<Record<ChatChartType, () => ReactElement>> = {
    column: () => Icon.chartBar(),
    bar: () => Icon.chartBar(),
    area: () => Icon.chartArea(),
    pie: () => Icon.chartPie()
};

type ChartLayout = Pick<ChatUiChartLayoutProps, 'type' | 'xAxis' | 'yAxis' | 'stacking'>;

/** What the card can draw: props, or why not. */
interface ChartSource {
    /** `building` until the type and axes arrive, else the state of the data. */
    state: 'building' | ChatDataHandle['state'] | 'empty' | 'invalid';
    props: ChatUiChartLayoutProps;
    error: unknown;
}

class ChatUiChartLocalModel extends ChatUiExpandModel {
    /** The chart's model - null until its type and axes are complete. */
    @managed @observableRef accessor chartModel: ChartModel = null;

    private inlineRequest: {props: ChatUiChartSpecProps; request: ChatUiExpandRequest} = null;

    get props(): ChatUiChartProps {
        return this.componentProps as ChatUiChartProps;
    }

    get defaults(): ChatUiChartDefaults {
        return ChatUiChart.defaults;
    }

    @computed
    get source(): ChartSource {
        const {dataHandle, view, isPartial, type, xAxis, yAxis, series} = this.props;
        if (!dataHandle) {
            // The model writes the series after the axes, so the axes are complete once the series
            // begin.
            if (isPartial && series == null) return {state: 'building', props: null, error: null};
            return {state: 'ready', props: {type, xAxis, yAxis, series}, error: null};
        }

        if (!view) return {state: 'building', props: null, error: null};
        const {state, frame, error} = dataHandle;
        if (state !== 'ready') return {state, props: null, error};

        const problems = findDataViewProblems(view, frame.columns);
        if (problems.length) {
            const isEmptyChart = problems.every(it => it.includes('is not numeric'));
            return {state: isEmptyChart ? 'empty' : 'invalid', props: null, error: problems};
        }
        return {state: 'ready', props: toChartProps(frame, view), error: null};
    }

    /** The props the inline chart draws, and how many series it leaves out. */
    @computed
    get limited(): {props: ChatUiChartLayoutProps; hiddenSeries: number} {
        const {props} = this.source;
        if (!props) return {props: null, hiddenSeries: 0};
        const {maxInlineSeries, maxInlinePoints} = this.defaults;
        return limitChartProps(props, maxInlineSeries, maxInlinePoints);
    }

    /** The chart's type and axes, once complete. */
    @computed
    get layout(): ChartLayout {
        const {props} = this.limited;
        if (!props) return null;
        const {type, xAxis, yAxis, stacking} = props;
        return {type, xAxis, yAxis, stacking};
    }

    @computed
    get series() {
        const {props} = this.limited;
        return props ? toSeries(props, !this.props.dataHandle && !!this.props.isPartial) : [];
    }

    /** True while the model still writes the series inline. */
    get isStreaming(): boolean {
        return !this.props.dataHandle && !!this.props.isPartial;
    }

    override onLinked() {
        super.onLinked();
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

    /** Open the chart in the side panel, or a dialog. */
    openExpanded(opener: HTMLElement) {
        const request = this.createRequest();
        if (request) this.expand(request, opener);
    }

    /** Open the chart's data as a table - for a result with nothing to chart. */
    openTable(opener: HTMLElement) {
        const {dataHandle, registry, view, title} = this.props;
        if (!dataHandle || !registry) return;
        this.expand(
            {
                type: 'table',
                artifactId: dataHandle.artifactId,
                view: pick(view, ['sortBy', 'filter', 'top', 'units']),
                registry,
                title
            },
            opener
        );
    }

    /** Load the first page again, after it failed. */
    retry() {
        this.props.dataHandle
            ?.loadRangeAsync(0, this.props.dataHandle.artifact?.totalRows ?? 0)
            .catch(() => null);
    }

    private createRequest(): ChatUiExpandRequest {
        const {dataHandle, registry, view, title} = this.props;
        if (dataHandle) {
            return registry && view
                ? {type: 'chart', artifactId: dataHandle.artifactId, view, registry, title}
                : null;
        }

        // The inline series, as an artifact of their own - made again only if they change.
        const props = this.props as ChatUiChartSpecProps;
        if (this.inlineRequest?.props.series !== props.series) {
            const {artifact, view: inlineView} = toChartArtifact(props);
            this.inlineRequest = {
                props,
                request: {
                    type: 'chart',
                    artifactId: artifact.id,
                    view: inlineView,
                    registry: new ChatArtifactRegistry({artifacts: [artifact]}),
                    title
                }
            };
        }
        return this.inlineRequest.request;
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

function cardFrame(
    impl: ChatUiChartLocalModel,
    title: string,
    type: ChatChartType,
    height: number
): ReactNode {
    const {state, error} = impl.source,
        chartType = impl.props.view?.type ?? type,
        icon = TYPE_ICONS[chartType]?.() ?? Icon.chartLine(),
        body = (item: ReactNode) =>
            div({className: 'xh-chat-ui-chart__body', style: height ? {height} : null, item});

    if (state === 'building' && !title) {
        const typeName = chartType ? `${chartType} chart` : 'chart';
        return chatUiFrame({status: `Building ${typeName}…`, item: body(null)});
    }

    if (state === 'building' || state === 'waiting' || state === 'loading') {
        return chatUiFrame({
            title,
            icon,
            item: body(chatUiSkeleton(null)),
            footer: impl.props.dataHandle
                ? div({className: 'xh-chat-ui-chart__busy', item: 'Loading rows…'})
                : null
        });
    }

    if (state === 'empty' || state === 'tooLarge') {
        return chatUiFrame({title, icon, item: body(nothingToChart(impl, state))});
    }

    if (state !== 'ready') {
        const canRetry = state === 'failed';
        return chatUiFrame({
            title,
            icon,
            item: body(
                div({
                    className: 'xh-chat-ui-center',
                    role: 'alert',
                    item: errorMessage({
                        error: error ?? {},
                        title: 'Chart unavailable',
                        message: getUnavailableText(state, error),
                        actionFn: canRetry ? () => impl.retry() : null,
                        actionButtonProps: canRetry ? {text: 'Retry', icon: Icon.refresh()} : null
                    })
                })
            )
        });
    }

    const {chartModel} = impl,
        {hiddenSeries, props} = impl.limited,
        shownSeries = props.series?.length ?? 0,
        isOpen = impl.isOpenInPanel,
        canExpand = !impl.isStreaming,
        onExpand = (opener: HTMLElement) => impl.openExpanded(opener);

    return chatUiFrame({
        title,
        icon,
        meta: hiddenSeries
            ? `First ${shownSeries} of ${shownSeries + hiddenSeries} series`
            : (props.yAxis?.title ?? null),
        headerItems: canExpand
            ? [
                  isOpen
                      ? div({
                            key: 'open',
                            className: 'xh-chat-ui-chart__open',
                            item: 'Open in panel'
                        })
                      : null,
                  chatUiExpandButton({title, isActive: isOpen, onClick: onExpand}),
                  chartMenuButton({
                      key: 'menu',
                      chartModel,
                      onExpand: () => impl.openExpanded(null)
                  })
              ]
            : [],
        item: body(
            chartModel
                ? div({
                      className: 'xh-chat-ui-chart__plot',
                      // Names the chart for screen readers, which otherwise hear only "Created
                      // with Highcharts". Download CSV in the options menu has the data.
                      role: 'img',
                      'aria-label': getAriaLabel(title, chartType, shownSeries),
                      item: chart({model: chartModel})
                  })
                : chatUiSkeleton(null)
        )
    });
}

// Nothing to chart: say why, and offer the table instead.
function nothingToChart(impl: ChatUiChartLocalModel, state: string): ReactNode {
    const columns: ChatDataColumn[] = impl.props.dataHandle?.artifact?.columns ?? [],
        names = columns.map(it => it.label ?? it.name).join(', '),
        isTooLarge = state === 'tooLarge';

    return div({
        className: 'xh-chat-ui-center',
        role: 'note',
        items: [
            Icon.chartBar({className: 'xh-chat-ui-chart__empty-icon'}),
            div({
                className: 'xh-chat-ui-center__title',
                item: isTooLarge ? 'Too many rows to chart here' : 'No numeric column to chart'
            }),
            !isTooLarge && !isEmpty(columns)
                ? div(`The result has ${columns.length} columns: ${names}.`)
                : null,
            impl.props.registry
                ? button({
                      icon: Icon.grid(),
                      text: 'Show as Table',
                      outlined: true,
                      onClick: e => impl.openTable(e.currentTarget as HTMLElement)
                  })
                : null
        ]
    });
}

function getUnavailableText(state: string, error: unknown): string {
    switch (state) {
        case 'missing':
            return 'The data for this chart is no longer available.';
        case 'failed':
            return "The chart's rows could not be loaded.";
        default:
            return Array.isArray(error) ? error.join('; ') : 'This chart could not be shown.';
    }
}

function getAriaLabel(title: string, type: ChatChartType, seriesCount: number): string {
    const kind = type ? `${capitalize(type)} chart` : 'Chart',
        series = seriesCount === 1 ? '1 series' : `${seriesCount} series`;
    return title ? `${title}: ${kind.toLowerCase()} of ${series}` : `${kind} of ${series}`;
}
