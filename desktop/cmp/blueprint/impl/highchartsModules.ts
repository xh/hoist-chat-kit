import {Highcharts} from '@xh/hoist/kit/highcharts';
import type {PlainObject} from '@xh/hoist/core';
import {isFunction} from 'lodash';
import type {WidgetSpec} from '../../../../blueprint';

/** The Highcharts modules a widget needs that the app has not loaded, by its config. */
export function missingModules(spec: WidgetSpec, config: PlainObject): string[] {
    const {modules} = spec ?? {},
        needed = isFunction(modules) ? modules(config ?? {}) : (modules ?? []);
    return needed.filter(it => !isLoaded(it));
}

// A module is loaded once Highcharts has a series type it brings.
function isLoaded(module: string): boolean {
    const type = SERIES_TYPE_OF[module] ?? module;
    return !!(Highcharts as PlainObject)?.seriesTypes?.[type];
}

const SERIES_TYPE_OF: Record<string, string> = {
    'highcharts-more': 'waterfall',
    'solid-gauge': 'solidgauge'
};
