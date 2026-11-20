import type {PlainObject} from '@xh/hoist/core';
import type {Blueprint} from '../Blueprint';
import type {WidgetSpec} from '../BlueprintRegistry';
import type {DataCatalog, FieldDef} from '../DataCatalog';

/**
 * A config a new widget can start with: each required key, and each field an array's items name,
 * filled from the blueprint. A source is the blueprint's first dataset source, a field is the
 * first of the source's fields with the role the schema asks for, an enum takes its first value,
 * an action refreshes the data, and a text takes the key's name. Null if the widget needs a source
 * and the blueprint has none.
 */
export function starterConfig(
    spec: WidgetSpec,
    ctx: {blueprint: Blueprint; catalog: DataCatalog}
): PlainObject {
    const {blueprint, catalog} = ctx,
        [source, decl] =
            Object.entries(blueprint?.sources ?? {}).find(
                ([, it]) => it?.dataset && catalog.getDataset(it.dataset)
            ) ?? [],
        fields = decl
            ? Object.values(catalog.getDataset(decl.dataset).fields).filter(it => !it.params)
            : [],
        state = {missingSource: false},
        ret = fill(spec.config ?? {}, '', {source, fields, state}) as PlainObject;
    return state.missingSource ? null : (ret ?? {});
}

//------------------
// Implementation
//------------------
interface FillContext {
    source: string;
    fields: FieldDef[];
    state: {missingSource: boolean};
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
        const matches = fieldsFor(role, ctx.fields);
        if (schema.type === 'array')
            return matches.slice(0, Math.max(schema.minItems ?? 1, 1)).map(it => it.name);
        return matches[0]?.name;
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
                fill(schema.items ?? {}, `${key} ${i + 1}`, ctx)
            );
        case 'string':
            return startCase(key);
        case 'number':
        case 'integer':
            return schema.minimum ?? 0;
        case 'boolean':
            return false;
        default:
            return undefined;
    }
}

function fieldsFor(role: string, fields: FieldDef[]): FieldDef[] {
    const isNumber = (f: FieldDef) => f.type === 'number' || f.type === 'int';
    if (role === 'dimension') return fields.filter(it => it.isDimension);
    if (role === 'measure') return fields.filter(it => isNumber(it) && !it.isDimension);
    return fields;
}

function startCase(key: string): string {
    const words = key.replace(/([a-z])([A-Z])/g, '$1 $2');
    return words.charAt(0).toUpperCase() + words.slice(1);
}
