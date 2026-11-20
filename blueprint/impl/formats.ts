import type {PlainObject} from '@xh/hoist/core';
import {
    fmtBillions,
    fmtCompact,
    fmtDate,
    fmtDateTime,
    fmtMillions,
    fmtNumber,
    fmtPercent,
    fmtThousands,
    fmtTime,
    fmtCompactDate,
    type NumberFormatOptions
} from '@xh/hoist/format';
import {LocalDate} from '@xh/hoist/utils/datetime';
import {isPlainObject, isString, omit} from 'lodash';
import type {ReactNode} from 'react';
import type {Blueprint} from '../Blueprint';
import type {DataCatalog, FieldDef} from '../DataCatalog';

/** A format, as a blueprint or catalog writes it: a name, an object, or a name with changes. */
export type FormatLike = string | PlainObject;

/**
 * The options of a field's format, merged option by option from the kind's built-in default, the
 * kind's named format, the field's own format, and then each override given, such as a widget's.
 * A name resolves in the blueprint's `formats` first, then the catalog's.
 */
export function resolveFormat(
    field: FieldDef,
    overrides: FormatLike[],
    ctx: {catalog: DataCatalog; blueprint: Blueprint}
): PlainObject {
    const {catalog, blueprint} = ctx,
        kind = catalog.kinds[field.kind],
        base = kind?.base ?? field.kind,
        expand = (f: FormatLike): PlainObject => {
            if (f == null) return {};
            if (isString(f)) return blueprint?.formats?.[f] ?? catalog.formats[f] ?? {};
            return isString(f.name) ? {...expand(f.name), ...omit(f, 'name')} : f;
        },
        fieldFormat = field.format !== kind?.format ? field.format : null;

    return [
        builtInDefault(base),
        expand(kind?.format),
        expand(fieldFormat),
        ...overrides.map(expand)
    ]
        .filter(isPlainObject)
        .reduce((ret, it) => ({...ret, ...it}), {});
}

/** One layer of how a field shows: a source's override, or a widget's own entry for it. */
export interface FieldDisplayLayer {
    label?: string;
    description?: string;
    align?: 'left' | 'center' | 'right';
    width?: number;
    format?: FormatLike;
    renderer?: string | PlainObject;
}

/** How a field shows, its layers resolved. See {@link resolveFieldDisplay}. */
export interface ResolvedFieldDisplay {
    label: string;
    description: string;
    align: 'left' | 'center' | 'right';
    width: number;
    /** Formats over the field's own, most specific last, for {@link resolveFormat}. */
    formats: FormatLike[];
    renderer: string | PlainObject;
}

/**
 * How a field shows, from the catalog's field, then each layer given, such as a source's override
 * and then a widget's own entry. A later layer's label, description, alignment, width and
 * renderer replace an earlier one's. Its format merges over theirs, option by option.
 */
export function resolveFieldDisplay(
    field: FieldDef,
    ...layers: FieldDisplayLayer[]
): ResolvedFieldDisplay {
    const all = [field ?? {}, ...layers.filter(Boolean)] as FieldDisplayLayer[],
        last = <K extends keyof FieldDisplayLayer>(key: K) =>
            all.reduce((ret, it) => it[key] ?? ret, null as FieldDisplayLayer[K]);
    return {
        label: last('label'),
        description: last('description'),
        align: last('align'),
        width: last('width'),
        formats: layers.map(it => it?.format).filter(it => it != null),
        renderer: last('renderer')
    };
}

/**
 * Format a value of a field with resolved format options, as Hoist's formatters do. With
 * `asText`, return plain text, as for a label.
 */
export function formatValue(
    value: unknown,
    field: FieldDef,
    opts: PlainObject,
    catalog: DataCatalog,
    asText = false
): ReactNode {
    const {type} = field,
        base = catalog.kinds[field.kind]?.base ?? field.kind;

    if (type === 'number' || type === 'int') {
        const v = value as number,
            {scale, ...rest} = opts,
            numOpts = {
                ...(omit(rest, 'date', 'pattern') as NumberFormatOptions),
                // As text, with none of the markup Hoist adds for colors, units and alignment.
                ...(asText
                    ? {
                          asHtml: true,
                          colorSpec: false,
                          labelCls: null,
                          forceLedgerAlign: false,
                          tooltip: false
                      }
                    : {})
            };
        if (base === 'fraction') return fmtPercent(v, numOpts);
        if (base === 'bps') return fmtNumber(v == null ? v : v * 10000, {label: 'bp', ...numOpts});
        switch (scale) {
            // A scale sets its label, unless the format names its own.
            case 'thousands':
                return fmtThousands(v, {label: true, ...numOpts});
            case 'millions':
                return fmtMillions(v, {label: true, ...numOpts});
            case 'billions':
                return fmtBillions(v, {label: true, ...numOpts});
            case 'auto': {
                // Compact past 100K, such as 48.5B, with the full value in a tooltip.
                const compact = fmtCompact(v, {...numOpts, asHtml: true}),
                    full = fmtNumber(v, {...numOpts, asHtml: true});
                return fmtCompact(v, {
                    ...numOpts,
                    tooltip: asText || compact === full ? null : () => full as string
                });
            }
            default:
                return fmtNumber(v, numOpts);
        }
    }
    if (type === 'localDate' || type === 'date') {
        if (type === 'localDate' && isString(value) && !ISO_DATE.test(value)) return value;
        const v = type === 'localDate' && isString(value) ? LocalDate.get(value) : value,
            dateOpts = {
                ...(opts.pattern ? {fmt: opts.pattern} : {}),
                ...(asText ? {asHtml: true} : {})
            };
        switch (opts.date) {
            case 'dateTime':
                return fmtDateTime(v as any, dateOpts);
            case 'time':
                return fmtTime(v as any, dateOpts);
            case 'compact':
                return fmtCompactDate(v as any, asText ? ({asHtml: true} as any) : undefined);
            default:
                return fmtDate(v as any, dateOpts);
        }
    }
    return value == null ? (opts.nullDisplay ?? null) : String(value);
}

//------------------
// Implementation
//------------------
// A local date as text, which a value that does not match only shows, not parses.
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function builtInDefault(base: string): PlainObject {
    if (base === 'shares') return {precision: 0};
    if (base?.startsWith('currency:')) return {precision: 2};
    return {};
}
