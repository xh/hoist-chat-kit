import {badge} from '@xh/hoist/cmp/badge';
import type {PlainObject} from '@xh/hoist/core';
import {div, span} from '@xh/hoist/cmp/layout';
import {
    dateRangeContext,
    type LocalDateRange,
    parseDateRangeSelection,
    parsePeriod,
    resolveDateRange,
    shiftByPeriod
} from '@xh/hoist/cmp/daterange';
import {sparkline, type SparklineColorBy, type SparklineType} from '@xh/hoist/cmp/sparkline';
import {LocalDate} from '@xh/hoist/utils/datetime';
import type {BlueprintRegistry, RendererSpec, ResolverSpec} from '../BlueprintRegistry';
import {BUILT_IN_RENDERER_INFO, BUILT_IN_RESOLVER_INFO} from './builtInWidgets';

//------------------
// Resolvers
//------------------
// Dates travel as `YYYY-MM-DD`, as in the blueprint and the data request.
const date = (v: unknown): LocalDate =>
        typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? LocalDate.get(v) : null,
    iso = (d: LocalDate): string => d?.isoString ?? null;

const RESOLVE: Record<string, ResolverSpec['resolve']> = {
    today: () => iso(LocalDate.currentAppDay()),
    previousBusinessDay: ({from}) =>
        iso((date(from) ?? LocalDate.currentAppDay()).previousWeekday()),
    dateOffset: ({from, days, months, years}) =>
        iso(
            date(from)
                ?.add(years ?? 0, 'years')
                .add(months ?? 0, 'months')
                .add(days ?? 0, 'days')
        ),
    monthStart: ({from}) => iso(date(from)?.startOfMonth()),
    quarterStart: ({from, offset}) =>
        iso(
            date(from)
                ?.startOfQuarter()
                .add(3 * (offset ?? 0), 'months')
        ),
    yearStart: ({from}) => iso(date(from)?.startOfYear()),
    rangeStart: (args, {registry}) => iso(rangeOf(args, registry)?.start),
    rangeEnd: (args, {registry}) => iso(rangeOf(args, registry)?.end),
    periodStart: args => shift(args, false),
    periodEnd: args => shift(args, true)
};

function rangeOf({range, asOf}: PlainObject, registry: BlueprintRegistry): LocalDateRange {
    const presets = registry.dateRangePresets,
        selection = parseDateRangeSelection(range, presets);
    if (!selection) return null;
    const anchorDate = date(asOf) ?? LocalDate.currentAppDay();
    return resolveDateRange(selection, dateRangeContext({anchorDate, presets})).current;
}

// A period shifts back from a period start, and forward to a period end, whatever its sign.
function shift({asOf, period, calendar}: PlainObject, forward: boolean): string {
    const from = date(asOf),
        parsed = parsePeriod(period);
    if (!from || !parsed) return null;
    return iso(shiftByPeriod(from, {...parsed, forward}, {calendar: calendar ?? 'business'}));
}

export const BUILT_IN_RESOLVERS: ResolverSpec[] = BUILT_IN_RESOLVER_INFO.map(it => ({
    ...it,
    resolve: RESOLVE[it.name]
}));

//------------------
// Renderers
//------------------
const RENDER: Record<string, RendererSpec['render']> = {
    bar: (value, {config, formatValue, isAggregate, columnMax}) => {
        if (value == null) return null;
        // A group's total outweighs its rows, so a bar sized beside them would not compare.
        if (isAggregate && !config.max) return formatValue(value);
        const max = (config.max as number) || columnMax?.() || 1,
            pct = Math.min(100, (Math.abs(value as number) / Math.abs(max)) * 100);
        return div({
            className: 'xh-blueprint-bar',
            children: [
                div({className: 'xh-blueprint-bar__fill', style: {width: `${pct}%`}}),
                span({className: 'xh-blueprint-bar__text', children: formatValue(value)})
            ]
        });
    },
    badge: (value, {config, isAggregate, formatValue}) => {
        if (value == null || isAggregate) return formatValue(value);
        const intent = (config.intents as PlainObject)?.[value as string];
        return badge({
            children: formatValue(value),
            intent: intent && intent !== 'none' ? intent : null
        });
    },
    sparkline: (value, {config, isAggregate, columnRange}) => {
        if (!Array.isArray(value)) return null;
        return sparkline({
            data: value as number[],
            type: (config.type as SparklineType) ?? 'line',
            colorBy: (config.colorBy as SparklineColorBy) ?? 'intent',
            width: '100%',
            // A group's total does not compare with its rows, so it takes its own scale.
            ...(isAggregate ? {} : (columnRange?.() ?? {}))
        });
    },
    delta: (value, {formatValue}) => {
        if (value == null) return null;
        const v = value as number,
            [arrow, cls] = v > 0 ? ['▲', 'xh-pos-val'] : v < 0 ? ['▼', 'xh-neg-val'] : ['', ''];
        return span({className: cls, children: [arrow && `${arrow} `, formatValue(v)]});
    }
};

export const BUILT_IN_RENDERERS: RendererSpec[] = BUILT_IN_RENDERER_INFO.map(it => ({
    ...it,
    render: RENDER[it.name]
}));
