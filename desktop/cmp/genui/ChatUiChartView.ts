import {isEmpty} from 'lodash';
import type {ReactNode} from 'react';
import {chart, ChartModel} from '@xh/hoist/cmp/chart';
import {errorMessage} from '@xh/hoist/cmp/error';
import {filler, frame, span} from '@xh/hoist/cmp/layout';
import {
    creates,
    hoistCmp,
    HoistModel,
    type HoistProps,
    managed,
    type PlainObject,
    TaskObserver,
    XH
} from '@xh/hoist/core';
import {picker, segmentedControl, select} from '@xh/hoist/desktop/cmp/input';
import {panel, type PanelProps} from '@xh/hoist/desktop/cmp/panel';
import {Icon} from '@xh/hoist/icon';
import {action, computed, observable, observableRef} from '@xh/hoist/mobx';
import type {ChatChartRequest} from '../../../core';
import {
    type ChatChartType,
    type ChatChartView,
    type ChatDataColumn,
    type ChatDataFrame,
    findDataViewProblems
} from '../../../genui';
import {chartMenuButton} from './impl/ChatUiChartMenu';
import {
    type ChatUiChartLayoutProps,
    toChartProps,
    toHighchartsConfig,
    toSeries
} from './impl/ChatUiChartData';
import './ChatUiChartView.scss';

/** Props for {@link ChatUiChartView}. */
export interface ChatUiChartViewProps extends HoistProps {
    /** The chart to show: the artifact, its registry and the card's view. */
    request: ChatChartRequest;

    /** Toolbar items before the switchers, such as Back. */
    tbarItems?: ReactNode[];

    /** Props for the view's Hoist `Panel`, such as its title, icon and header items. */
    panelProps?: Omit<PanelProps, 'tbar' | 'item' | 'items' | 'mask'>;
}

/**
 * The expanded tier of a chart card: a Hoist `Chart` of the whole artifact, with switchers for the
 * chart type and the axes. A switch updates the series in place, so a zoom survives a change of
 * type. The chat's side panel shows it for a chart request, and a dialog shows it where the chat
 * has no side panel.
 */
export const [ChatUiChartView, chatUiChartView] = hoistCmp.withFactory<ChatUiChartViewProps>({
    displayName: 'ChatUiChartView',
    // Its own model, kept out of context, so that it needs no model above it.
    model: creates(() => new ChatUiChartViewLocalModel(), {publishMode: 'none'}),
    className: 'xh-chat-ui-chart-view',

    render({model, className, tbarItems = [], panelProps}) {
        const impl = model as ChatUiChartViewLocalModel,
            {chartModel, loadError} = impl;

        return panel({
            className,
            ...panelProps,
            tbar: [
                ...tbarItems,
                segmentedControl({
                    className: 'xh-chat-ui-chart-view__type',
                    value: impl.type,
                    onChange: v => impl.setType(v),
                    options: impl.typeOptions.map(it => ({value: it, label: TYPE_LABELS[it]})),
                    domAttrs: {'aria-label': 'Chart type'}
                }),
                impl.type !== 'pie'
                    ? span({className: 'xh-chat-ui-chart-view__label', item: 'Y'})
                    : null,
                picker({
                    className: 'xh-chat-ui-chart-view__select',
                    width: 200,
                    enableMulti: impl.type !== 'pie',
                    multiSelectButtonStyle: 'values',
                    displayNoun: 'series',
                    value: impl.type === 'pie' ? impl.y[0] : impl.y,
                    options: impl.yOptions,
                    onChange: v => impl.setY(v),
                    domAttrs: {'aria-label': 'Values'}
                }),
                span({
                    className: 'xh-chat-ui-chart-view__label',
                    item: impl.type === 'pie' ? 'By' : 'X'
                }),
                select({
                    className: 'xh-chat-ui-chart-view__select',
                    width: 160,
                    value: impl.x,
                    options: impl.xOptions,
                    onChange: v => impl.setX(v),
                    domAttrs: {'aria-label': impl.type === 'pie' ? 'Slices' : 'X axis'}
                }),
                filler(),
                chartMenuButton({chartModel})
            ],
            mask: impl.frame ? null : impl.loadTask,
            item: loadError
                ? errorMessage({
                      error: loadError,
                      title: 'Chart unavailable',
                      message: "The chart's rows could not be loaded.",
                      actionFn: () => impl.loadRowsAsync(),
                      actionButtonProps: {text: 'Retry', icon: Icon.refresh()}
                  })
                : impl.problem
                  ? errorMessage({error: {}, title: 'Nothing to chart', message: impl.problem})
                  : frame({
                        className: 'xh-chat-ui-chart-view__body',
                        role: 'img',
                        'aria-label': impl.ariaLabel,
                        item: chart({model: chartModel})
                    })
        });
    }
});

//------------------
// Implementation
//------------------
const TYPE_LABELS: Record<ChatChartType, string> = {
    line: 'Line',
    column: 'Column',
    bar: 'Bar',
    area: 'Area',
    pie: 'Pie',
    scatter: 'Scatter'
};

const SWITCH_TYPES: ChatChartType[] = ['line', 'column', 'bar', 'area'];

// Most rows the expanded chart loads.
const MAX_ROWS = 10_000;

type ChartLayout = Pick<ChatUiChartLayoutProps, 'type' | 'xAxis' | 'yAxis' | 'stacking'> & {
    hasLegend: boolean;
};

function toLayoutConfig(layout: ChartLayout): PlainObject {
    if (!layout) return {};
    const config = toHighchartsConfig(layout);
    return {
        ...config,
        chart: {...config.chart, inverted: layout.type === 'bar', zooming: {type: 'x'}},
        legend: {enabled: layout.hasLegend}
    };
}

class ChatUiChartViewLocalModel extends HoistModel {
    override xhImpl = true;

    @managed readonly chartModel = new ChartModel({xhImpl: true, highchartsConfig: {}});

    @managed readonly loadTask = TaskObserver.trackLast();

    @observable accessor type: ChatChartType = 'line';
    @observableRef accessor x: string = null;
    @observableRef accessor y: string[] = [];

    @observableRef accessor frame: ChatDataFrame = null;
    @observableRef accessor loadError: unknown = null;

    get request(): ChatChartRequest {
        return (this.componentProps as ChatUiChartViewProps).request;
    }

    get columns(): ChatDataColumn[] {
        const {registry, artifactId} = this.request;
        return registry?.get(artifactId)?.columns ?? [];
    }

    /** The switchable types, with the card's own if it is not one of them. */
    get typeOptions(): ChatChartType[] {
        const own = this.request.view.type;
        return SWITCH_TYPES.includes(own) ? SWITCH_TYPES : [...SWITCH_TYPES, own];
    }

    get xOptions() {
        return this.columns.map(it => ({value: it.name, label: it.label ?? it.name}));
    }

    get yOptions() {
        return this.columns
            .filter(it => it.type === 'number' || it.type === 'integer')
            .map(it => ({value: it.name, label: it.label ?? it.name}));
    }

    /** The view with the user's switches. */
    @computed
    get view(): ChatChartView {
        const {type, x, y} = this;
        return {...this.request.view, type, x, y};
    }

    /** Why the view cannot chart - such as no values chosen - or null. */
    @computed
    get problem(): string {
        if (!this.frame) return null;
        if (isEmpty(this.y)) return 'Choose a column of values to chart.';
        const problems = findDataViewProblems(this.view, this.frame.columns);
        return problems.length ? problems.join('; ') : null;
    }

    get ariaLabel(): string {
        const title = this.request.title ?? 'Chart';
        return `${title}: ${TYPE_LABELS[this.type].toLowerCase()} chart of ${this.y.length} series`;
    }

    @action
    setType(type: ChatChartType) {
        // A pie charts one column.
        if (type === 'pie' && this.y.length > 1) this.y = this.y.slice(0, 1);
        this.type = type;
    }

    @action
    setX(x: string) {
        this.x = x;
    }

    @action
    setY(y: string | string[]) {
        this.y = y == null ? [] : Array.isArray(y) ? y : [y];
    }

    override onLinked() {
        const {type, x, y} = this.request.view;
        this.setType(type);
        this.setX(x);
        this.setY(y);

        this.addReaction(
            {
                // Axes change the chart's options. A new type alone does not, so that the series
                // update in place and a zoom survives.
                track: () => this.layout,
                run: layout => this.chartModel.setHighchartsConfig(toLayoutConfig(layout)),
                equals: 'structural',
                fireImmediately: true
            },
            {
                track: () => this.series,
                run: series => this.chartModel.setSeries(series),
                fireImmediately: true
            }
        );
    }

    override afterLinked() {
        this.loadRowsAsync();
    }

    async loadRowsAsync() {
        const {registry, artifactId} = this.request,
            artifact = registry?.get(artifactId);
        if (!artifact) {
            this.setLoaded(null, new Error('The data for this chart is no longer available.'));
            return;
        }
        try {
            this.setLoaded(null, null);
            const frame = await registry
                .loadRangeAsync(artifactId, 0, Math.min(artifact.totalRows, MAX_ROWS))
                .linkTo(this.loadTask);
            this.setLoaded(frame, null);
        } catch (e) {
            this.setLoaded(null, e);
            XH.handleException(e, {showAlert: false});
        }
    }

    //------------------
    // Implementation
    //------------------
    @computed
    private get props() {
        return this.frame && !this.problem ? toChartProps(this.frame, this.view) : null;
    }

    // The chart's type and axes, as plain data to compare - not the Highcharts options, whose
    // formatters are new functions on every change. Only a pie, or a bar's inverted axes, changes
    // the chart's own type. Other types change on the series.
    @computed
    private get layout(): ChartLayout {
        const {props, type} = this,
            own = this.request.view.type;
        if (!props) return null;
        return {
            type: type === 'pie' || type === 'bar' || own === 'pie' ? type : own,
            xAxis: props.xAxis,
            yAxis: props.yAxis,
            stacking: props.stacking,
            hasLegend: (props.series?.length ?? 0) > 1
        };
    }

    @computed
    private get series() {
        const {props, type} = this;
        if (!props) return [];
        return toSeries(props, false).map(it => ({...it, type}));
    }

    @action
    private setLoaded(frame: ChatDataFrame, error: unknown) {
        this.frame = frame;
        this.loadError = error;
    }
}
