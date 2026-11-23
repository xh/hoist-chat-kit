import type {ChartModel} from '@xh/hoist/cmp/chart';
import type {PlainObject} from '@xh/hoist/core';

const keys = new WeakMap<ChartModel, string>();

/**
 * Set a chart's Highcharts config only when it changes. Hoist rebuilds a chart for each new config,
 * and Highcharts leaks a resize observer with every build. The config's functions are new on each
 * call, so the comparison leaves them out: `deps` holds what they read, such as a field's format.
 */
export function setChartConfig(chartModel: ChartModel, config: PlainObject, deps: unknown = null) {
    const key = JSON.stringify([config, deps], (_, v) => (typeof v === 'function' ? undefined : v));
    if (keys.get(chartModel) === key) return;
    keys.set(chartModel, key);
    chartModel.setHighchartsConfig(config);
}
