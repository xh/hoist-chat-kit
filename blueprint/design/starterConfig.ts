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
 * An enum takes its first value, an action refreshes the data, and a text takes the key's name,
 * numbered in a list. Null if the widget needs a source and the blueprint has none.
 */
export function starterConfig(
    spec: WidgetSpec,
    ctx: {blueprint: Blueprint; catalog: DataCatalog}
): PlainObject {
    const fillCtx = fillContext(ctx),
        ret = fill(spec.config ?? {}, '', fillCtx) as PlainObject;
    return fillCtx.state.missingSource ? null : (ret ?? {});
}

/**
 * A value a part of a config can start with, such as a new item of a list, filled as
 * {@link starterConfig} fills a config. Its fields come from the source named, else the
 * blueprint's first dataset source.
 */
export function starterValue(
    schema: PlainObject,
    ctx: {blueprint: Blueprint; catalog: DataCatalog; source?: string}
): unknown {
    return fill(schema ?? {}, '', fillContext(ctx));
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
}): FillContext {
    const {blueprint, catalog} = ctx,
        sources = Object.entries(blueprint?.sources ?? {}).filter(
            ([, it]) => it?.dataset && catalog.getDataset(it.dataset)
        ),
        [source, decl] = sources.find(([name]) => name === ctx.source) ?? sources[0] ?? [],
        fields = decl
            ? Object.values(catalog.getDataset(decl.dataset).fields).filter(it => !it.params)
            : [];
    return {source, fields, state: {missingSource: false, used: new Set()}, suffix: ''};
}

function fill(schema: PlainObject, key: string, ctx: FillContext): unknown {
    if (schema['x-source']) {
        if (!ctx.source) ctx.state.missingSource = true;
        return ctx.source;
    }
    if (schema['x-action']) return {type: 'refresh'};
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
                    k => required.includes(k) || (props[k]['x-field'] && props[k].type !== 'object')
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
            return startCase(key) + ctx.suffix;
        case 'number':
        case 'integer':
            return schema.minimum ?? 0;
        case 'boolean':
            return false;
        default:
            return undefined;
    }
}

function fieldsFor(role: string, fields: FieldDef[], isList: boolean): FieldDef[] {
    const isMeasure = (f: FieldDef) => (f.type === 'number' || f.type === 'int') && !f.isDimension,
        // UNIQUE is blank wherever values differ, so it shows no total.
        totals = (f: FieldDef) => f.aggregator != null && f.aggregator !== 'UNIQUE',
        measures = sortBy(fields.filter(isMeasure), it => (totals(it) ? 0 : 1));
    if (role === 'dimension') return fields.filter(it => it.isDimension);
    if (role === 'measure') return measures;
    return isList ? uniq([...measures, ...fields]) : fields;
}

function startCase(key: string): string {
    const words = key.replace(/([a-z])([A-Z])/g, '$1 $2');
    return words.charAt(0).toUpperCase() + words.slice(1);
}
