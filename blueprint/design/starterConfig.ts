import type {PlainObject} from '@xh/hoist/core';
import {sortBy, uniq} from 'lodash';
import type {Blueprint} from '../Blueprint';
import type {WidgetSpec} from '../BlueprintRegistry';
import type {DataCatalog, FieldDef} from '../DataCatalog';

/**
 * A config a new widget can start with: each required key, and each field an array's items name,
 * filled from the blueprint. A source is the blueprint's first dataset source. A field is the
 * first of the source's fields with the role the schema asks for that the config does not use yet,
 * with measures that total first, and measures first for a list of any fields, such as columns.
 * An enum takes its first value, an action refreshes the data, a number its default, and a text
 * its first example, else the key's name, numbered in a list. The widget's `starter` then adjusts
 * it. Null if the widget needs a source and the blueprint has none, or the reason a starter gives
 * that the widget cannot start yet.
 */
export function starterConfig(
    spec: WidgetSpec,
    ctx: {blueprint: Blueprint; catalog: DataCatalog},
    /** Values the config starts with in place of what the schema fills. */
    overrides: PlainObject = {}
): PlainObject | string {
    const fillCtx = fillContext(ctx),
        ret = {...(fill(spec.config ?? {}, '', fillCtx) as PlainObject), ...overrides};
    if (fillCtx.state.missingSource) return null;
    return spec.starter ? spec.starter(ret, ctx) : ret;
}

/**
 * A value a part of a config can start with, such as a new item of a list, filled as
 * {@link starterConfig} fills a config. Its fields come from the source named, else the
 * blueprint's first dataset source, and are none of those named in `used`.
 */
export function starterValue(
    schema: PlainObject,
    ctx: {blueprint: Blueprint; catalog: DataCatalog; source?: string; used?: string[]}
): unknown {
    return fill(schema ?? {}, '', fillContext(ctx));
}

/** True if a field can fill an `x-field` role: a dimension, a measure (a number), or any. */
export function fieldHasRole(field: FieldDef, role: string): boolean {
    if (role === 'dimension') return !!field.isDimension;
    if (role === 'measure')
        return (field.type === 'number' || field.type === 'int') && !field.isDimension;
    return true;
}

//------------------
// Implementation
//------------------
interface FillContext {
    source: string;
    fields: FieldDef[];
    state: {missingSource: boolean; used: Set<string>};
    // Numbers the texts of a list's items, so each item differs.
    suffix: string;
}

function fillContext(ctx: {
    blueprint: Blueprint;
    catalog: DataCatalog;
    source?: string;
    used?: string[];
}): FillContext {
    const {blueprint, catalog} = ctx,
        sources = Object.entries(blueprint?.sources ?? {}).filter(
            ([, it]) => it?.dataset && catalog.getDataset(it.dataset)
        ),
        [source, decl] = sources.find(([name]) => name === ctx.source) ?? sources[0] ?? [],
        fields = decl
            ? Object.values(catalog.getDataset(decl.dataset).fields).filter(it => !it.params)
            : [];
    return {
        source,
        fields,
        state: {missingSource: false, used: new Set(ctx.used)},
        suffix: ''
    };
}

function fill(schema: PlainObject, key: string, ctx: FillContext): unknown {
    if (schema['x-source']) {
        if (!ctx.source) ctx.state.missingSource = true;
        return ctx.source;
    }
    if (schema['x-action']) return {type: 'refresh'};
    // A filter, such as a style rule's test, starts as one clause: a measure below 0, as for a loss.
    if (schema['x-filter'] && schema.type === 'object') {
        const [measure] = fieldsFor('measure', ctx.fields, false),
            field = measure ?? ctx.fields[0];
        if (!field) return undefined;
        return measure
            ? {field: field.name, op: '<', value: 0}
            : {field: field.name, op: '!=', value: ''};
    }
    const role = schema['x-field'];
    // A map keyed by field, such as a grid's columns, starts empty.
    if (role && schema.type !== 'object') {
        const isList = schema.type === 'array',
            picked = fieldsFor(role, ctx.fields, isList)
                .filter(it => !ctx.state.used.has(it.name))
                .slice(0, isList ? Math.max(schema.minItems ?? 1, 1) : 1)
                .map(it => it.name);
        picked.forEach(it => ctx.state.used.add(it));
        if (isList) return picked.length ? picked : undefined;
        return picked[0];
    }
    if (schema.enum) return schema.enum[0];
    if (schema.const !== undefined) return schema.const;
    if (schema.anyOf || schema.oneOf) return fill((schema.anyOf ?? schema.oneOf)[0], key, ctx);
    switch (schema.type) {
        case 'object': {
            const props: PlainObject = schema.properties ?? {},
                required: string[] = schema.required ?? [],
                // An item's field is filled even when optional, as a card or a series needs one.
                keys = Object.keys(props).filter(
                    k =>
                        required.includes(k) ||
                        (props[k]['x-field'] &&
                            props[k].type !== 'object' &&
                            props[k]['x-starter'] !== false)
                );
            return Object.fromEntries(
                keys.map(k => [k, fill(props[k], k, ctx)]).filter(([, v]) => v !== undefined)
            );
        }
        case 'array':
            return Array.from({length: schema.minItems ?? 0}, (_, i) =>
                fill(schema.items ?? {}, key, {...ctx, suffix: ` ${i + 1}`})
            );
        case 'string':
            return schema.examples?.[0] ?? startCase(key) + ctx.suffix;
        case 'number':
        case 'integer':
            return schema.default ?? schema.minimum ?? 0;
        case 'boolean':
            return false;
        default:
            return undefined;
    }
}

function fieldsFor(role: string, fields: FieldDef[], isList: boolean): FieldDef[] {
    // UNIQUE is blank wherever values differ, so it shows no total.
    const totals = (f: FieldDef) => f.aggregator != null && f.aggregator !== 'UNIQUE',
        measures = sortBy(
            fields.filter(it => fieldHasRole(it, 'measure')),
            it => (totals(it) ? 0 : 1)
        );
    if (role === 'measure') return measures;
    if (role === 'any' && isList) return uniq([...measures, ...fields]);
    return fields.filter(it => fieldHasRole(it, role));
}

function startCase(key: string): string {
    const words = key.replace(/([a-z])([A-Z])/g, '$1 $2');
    return words.charAt(0).toUpperCase() + words.slice(1);
}
