import {chart, ChartModel} from '@xh/hoist/cmp/chart';
import {hoistCmp, managed, type PlainObject, uses} from '@xh/hoist/core';
import type {Cube, View} from '@xh/hoist/data';
import {observableRef} from '@xh/hoist/mobx';
import {escape, sortBy} from 'lodash';
import {
    BlueprintWidgetModel,
    type BlueprintWidgetConfig,
    type GaugeWidgetConfig
} from '../../../blueprint';
import {formatValue, resolveFormat} from '../../../blueprint/impl/formats';

/**
 * The `gauge` widget: a Highcharts solid gauge of one measure's total over its source, on an arc
 * from `min` to `max`, colored by its `stops`.
 */
export class GaugeWidgetModel extends BlueprintWidgetModel<GaugeWidgetConfig> {
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
                track: () => [this.view?.result, this.resolvedConfig],
                run: () => this.updateChart(),
                fireImmediately: true
            }
        );
    }

    //------------------
    // Implementation
    //------------------
    private get query(): PlainObject {
        return {
            dimensions: [],
            filter: this.blueprintModel.resolveFilter(this.element?.config.filter),
            includeRoot: true
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
            {value, min = 0, max = 100, stops, format} = this.resolvedConfig,
            def = source?.fields[value];
        if (!view || !def) {
            chartModel.setSeries([]);
            return;
        }
        const total = (view.result.rows[0] as PlainObject)?.[value] ?? null,
            {catalog, blueprint} = this.blueprintModel,
            opts = resolveFormat(def, source.displayOf(value, {format}).formats, {
                catalog,
                blueprint
            });
        chartModel.setHighchartsConfig({
            chart: {type: 'solidgauge'},
            // Its container draws its title, as a canvas cell's header does.
            title: {text: null},
            pane: {
                startAngle: -90,
                endAngle: 90,
                center: ['50%', '85%'],
                size: '140%',
                background: {innerRadius: '60%', outerRadius: '100%', shape: 'arc'}
            },
            yAxis: {
                min,
                max,
                stops: stops?.length ? sortBy(stops, 'at').map(it => [it.at, it.color]) : null,
                tickPositions: [min, max],
                labels: {
                    y: 16,
                    formatter: function (this: any) {
                        return escape(
                            String(formatValue(this.value, def, opts, catalog, true) ?? '')
                        );
                    }
                },
                title: {text: null}
            },
            tooltip: {enabled: false},
            credits: {enabled: false}
        });
        chartModel.setSeries([
            {
                type: 'solidgauge',
                name: escape(source.fieldLabel(value)),
                data: [total],
                dataLabels: {
                    borderWidth: 0,
                    y: -24,
                    formatter: function (this: any) {
                        return escape(String(formatValue(this.y, def, opts, catalog, true) ?? ''));
                    }
                }
            } as any
        ]);
    }
}

export const [GaugeWidget, gaugeWidget] = hoistCmp.withFactory({
    displayName: 'GaugeWidget',
    className: 'xh-blueprint-gauge',
    model: uses(GaugeWidgetModel),
    render({model, className}) {
        return chart({model: model.chartModel, className});
    }
});
