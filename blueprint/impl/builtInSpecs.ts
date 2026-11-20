import {badge} from '@xh/hoist/cmp/badge';
import type {PlainObject} from '@xh/hoist/core';
import {div, span} from '@xh/hoist/cmp/layout';
import {LocalDate} from '@xh/hoist/utils/datetime';
import type {RendererSpec, ResolverSpec} from '../BlueprintRegistry';
import {BUILT_IN_RENDERER_INFO, BUILT_IN_RESOLVER_INFO} from './builtInWidgets';

//------------------
// Resolvers
//------------------
// Dates travel as `YYYY-MM-DD`, as in the blueprint and the data request.
const date = (v: unknown): LocalDate => (v == null ? null : LocalDate.get(v as string)),
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
    yearStart: ({from}) => iso(date(from)?.startOfYear())
};

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
