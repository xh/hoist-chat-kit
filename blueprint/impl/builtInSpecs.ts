import {badge} from '@xh/hoist/cmp/badge';
import type {PlainObject} from '@xh/hoist/core';
import {div, span} from '@xh/hoist/cmp/layout';
import {LocalDate} from '@xh/hoist/utils/datetime';
import type {RendererSpec, ResolverSpec} from '../BlueprintRegistry';

//------------------
// Resolvers
//------------------
// Dates travel as `YYYY-MM-DD`, as in the blueprint and the data request.
const date = (v: unknown): LocalDate => (v == null ? null : LocalDate.get(v as string)),
    iso = (d: LocalDate): string => d?.isoString ?? null;

export const BUILT_IN_RESOLVERS: ResolverSpec[] = [
    {
        name: 'today',
        returns: 'localDate',
        args: {},
        resolve: () => iso(LocalDate.currentAppDay())
    },
    {
        name: 'previousBusinessDay',
        returns: 'localDate',
        args: {from: 'localDate, optional. Default today.'},
        resolve: ({from}) => iso((date(from) ?? LocalDate.currentAppDay()).previousWeekday())
    },
    {
        name: 'dateOffset',
        returns: 'localDate',
        args: {
            from: 'localDate',
            days: 'int, optional',
            months: 'int, optional',
            years: 'int, optional'
        },
        resolve: ({from, days, months, years}) =>
            iso(
                date(from)
                    ?.add(years ?? 0, 'years')
                    .add(months ?? 0, 'months')
                    .add(days ?? 0, 'days')
            )
    },
    {
        name: 'monthStart',
        returns: 'localDate',
        args: {from: 'localDate'},
        resolve: ({from}) => iso(date(from)?.startOfMonth())
    },
    {
        name: 'quarterStart',
        returns: 'localDate',
        args: {from: 'localDate', offset: 'int, optional. -1 for the quarter before.'},
        resolve: ({from, offset}) =>
            iso(
                date(from)
                    ?.startOfQuarter()
                    .add(3 * (offset ?? 0), 'months')
            )
    },
    {
        name: 'yearStart',
        returns: 'localDate',
        args: {from: 'localDate'},
        resolve: ({from}) => iso(date(from)?.startOfYear())
    }
];

//------------------
// Renderers
//------------------
export const BUILT_IN_RENDERERS: RendererSpec[] = [
    {
        name: 'bar',
        appliesTo: {types: ['number', 'int']},
        config: {max: 'number, the value that fills the bar'},
        render: (value, {config, formatValue}) => {
            if (value == null) return null;
            const max = (config.max as number) || 1,
                pct = Math.min(100, (Math.abs(value as number) / Math.abs(max)) * 100);
            return div({
                className: 'xh-blueprint-bar',
                children: [
                    div({className: 'xh-blueprint-bar__fill', style: {width: `${pct}%`}}),
                    span({className: 'xh-blueprint-bar__text', children: formatValue(value)})
                ]
            });
        }
    },
    {
        name: 'badge',
        appliesTo: {types: ['string']},
        config: {intents: 'object mapping a value to none, primary, success, warning or danger'},
        render: (value, {config, isAggregate, formatValue}) => {
            if (value == null || isAggregate) return formatValue(value);
            const intent = (config.intents as PlainObject)?.[value as string];
            return badge({
                children: formatValue(value),
                intent: intent && intent !== 'none' ? intent : null
            });
        }
    },
    {
        name: 'delta',
        appliesTo: {types: ['number', 'int']},
        config: {},
        render: (value, {formatValue}) => {
            if (value == null) return null;
            const v = value as number,
                [arrow, cls] = v > 0 ? ['▲', 'xh-pos-val'] : v < 0 ? ['▼', 'xh-neg-val'] : ['', ''];
            return span({className: cls, children: [arrow && `${arrow} `, formatValue(v)]});
        }
    }
];
