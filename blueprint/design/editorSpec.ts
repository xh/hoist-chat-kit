import type {PlainObject} from '@xh/hoist/core';
import {isPlainObject, sortBy} from 'lodash';
import {labelOf} from '../impl/labels';

export {labelOf};

/**
 * One editor for one value of a widget's config, from its schema: what to edit it with, and what
 * the schema says of it. A platform draws each kind with its own inputs.
 */
export type EditorNode = EditorBase &
    (
        | {kind: 'text'; multiline: boolean; maxLength?: number}
        | {kind: 'date'}
        | {kind: 'number'; integer: boolean; min?: number; max?: number}
        | {
              kind: 'boolean';
              /** From `x-labels`: each value and its label, the positive state first. */
              labels: {value: boolean; label: string}[];
          }
        | {kind: 'choice'; options: unknown[]; thumbnails?: Record<string, string>}
        | {kind: 'group'; children: EditorNode[]}
        | {kind: 'stringList'; options?: unknown[]}
        | {kind: 'list'; item: EditorNode}
        | {kind: 'map'; value: EditorNode; keyRole?: FieldRole}
        | {
              kind: 'fieldList';
              role: FieldRole;
              settings: EditorNode[];
              /**
               * From `x-settings`: the sibling map that holds more settings for each item, and the
               * editors of an entry, the ones it shows first leading.
               */
              settingsIn?: {key: string; settings: EditorNode[]; shown: number};
          }
        | {kind: 'oneOf'; options: EditorNode[]}
        | {kind: 'source'}
        | {kind: 'variable'}
        | {kind: 'blueprint'}
        | {kind: 'preset'}
        | {kind: 'field'; role: FieldRole; multiple: boolean}
        | {kind: 'filter'}
        | {kind: 'format'}
        | {kind: 'renderer'}
        | {kind: 'action'}
        | {kind: 'pair'; item: EditorNode}
        | {
              kind: 'sort';
              /** How many keys it takes: 1 for a lone sorter, else its list's `maxItems`. */
              maxKeys: number;
          }
        | {kind: 'icon'}
        | {kind: 'json'}
    );

/** The fields an `x-field` value takes: dimensions, measures (numbers), or any. */
export type FieldRole = 'any' | 'dimension' | 'measure';

/** What every {@link EditorNode} holds. */
export interface EditorBase {
    /** The key of the value in its object, or null for an item of a list or map. */
    key: string;
    label: string;
    description?: string;
    required: boolean;
    /** True if the value may be a variable binding, `{"$var": name}`, in place of a literal. */
    bindable: boolean;
    /** The value the widget takes while the property is unset, from the schema's `default`. */
    default?: unknown;
    /** The schema the node comes from, for a value an editor starts with. */
    schema: PlainObject;
}

/**
 * The editors for a widget's config, one per property of its schema, in the schema's order. The
 * registry's annotations pick a kind: `x-source`, `x-field`, `x-filter`, `x-format`, `x-renderer`,
 * `x-action`, `x-sort`, `x-variable` and `x-blueprint`. A list of fields whose items may also be objects with settings, such as a grid's
 * columns, is a `fieldList`, with an `x-settings` map's entry editors where it names one, and an
 * object keyed freely by field a `map` with a `keyRole`. Any
 * shape the kit has no editor for is `json`, so every value can be edited.
 */
export function toEditorSpec(schema: PlainObject): EditorNode[] {
    const props: PlainObject = schema?.properties ?? {},
        required: string[] = schema?.required ?? [],
        ret = Object.entries(props).map(([key, it]) => toNode(it, key, required.includes(key)));
    return ret.map(node => {
        const {in: key, show = []} = node.schema['x-settings'] ?? {},
            map = key ? ret.find(it => it.key === key) : null,
            entry = map?.kind === 'map' && map.value.kind === 'group' ? map.value.children : null;
        if (node.kind !== 'fieldList' || !entry) return node;
        const shown = sortBy(
            entry.filter(it => show.includes(it.key)),
            it => show.indexOf(it.key)
        );
        return {
            ...node,
            settingsIn: {
                key,
                settings: [...shown, ...entry.filter(it => !show.includes(it.key))],
                shown: shown.length
            }
        };
    });
}

//------------------
// Implementation
//------------------
function toNode(schema: PlainObject, key: string, required: boolean): EditorNode {
    const base: EditorBase = {
        key,
        label: key
            ? (schema.title ?? labelOf(key)) + (schema['x-unit'] ? ` (${schema['x-unit']})` : '')
            : null,
        ...(schema.description ? {description: schema.description} : {}),
        required,
        bindable: !!schema['x-binding'] && !schema['x-variable'],
        ...(schema.default !== undefined ? {default: schema.default} : {}),
        schema
    };
    if (schema['x-icon']) return {...base, kind: 'icon'};
    if (schema['x-variable']) return {...base, kind: 'variable'};
    if (schema['x-blueprint']) return {...base, kind: 'blueprint'};
    if (schema['x-preset']) return {...base, kind: 'preset'};
    if (schema['x-source']) return {...base, kind: 'source'};
    if (schema['x-filter']) return {...base, kind: 'filter'};
    if (schema['x-format']) return {...base, kind: 'format'};
    if (schema['x-renderer']) return {...base, kind: 'renderer'};
    if (schema['x-action']) return {...base, kind: 'action'};
    if (schema['x-sort']) {
        const list = [schema, ...(schema.anyOf ?? schema.oneOf ?? [])].find(
            it => it.type === 'array'
        );
        return {...base, kind: 'sort', maxKeys: list ? (list.maxItems ?? 10) : 1};
    }
    const role = schema['x-field'];
    if (role && (schema.type === 'string' || isStringArray(schema))) {
        return {...base, kind: 'field', role, multiple: schema.type === 'array'};
    }
    // Two numbers, such as a gap across and down.
    if (
        schema.type === 'array' &&
        schema.minItems === 2 &&
        schema.maxItems === 2 &&
        ['integer', 'number'].includes(schema.items?.type)
    ) {
        return {...base, kind: 'pair', item: toNode(schema.items, null, false)};
    }
    const withSettings = role && schema.type === 'array' ? fieldSettingsOf(schema.items) : null;
    if (withSettings) {
        const settings = toEditorSpec(withSettings).filter(it => it.key !== 'field');
        return {...base, kind: 'fieldList', role, settings};
    }
    if (schema.enum) {
        return {
            ...base,
            kind: 'choice',
            options: schema.enum,
            ...(schema['x-thumbnails'] ? {thumbnails: schema['x-thumbnails']} : {})
        };
    }
    if (schema.const !== undefined) return {...base, kind: 'choice', options: [schema.const]};
    const variants = schema.anyOf ?? schema.oneOf;
    if (variants) {
        const options = variants.map((it: PlainObject) => toNode(it, null, false));
        return options.every(isSimple)
            ? {...base, kind: 'oneOf', options}
            : {...base, kind: 'json'};
    }
    switch (schema.type) {
        case 'string':
            if (schema.format === 'date') return {...base, kind: 'date'};
            return {
                ...base,
                kind: 'text',
                multiline: (schema.maxLength ?? 0) > 200,
                ...(schema.maxLength ? {maxLength: schema.maxLength} : {})
            };
        case 'number':
        case 'integer':
            return {
                ...base,
                kind: 'number',
                integer: schema.type === 'integer',
                ...(schema.minimum != null ? {min: schema.minimum} : {}),
                ...(schema.maximum != null ? {max: schema.maximum} : {})
            };
        case 'boolean':
            return {...base, kind: 'boolean', labels: booleanLabels(schema['x-labels'])};
        case 'object': {
            if (isPlainObject(schema.additionalProperties) && !schema.properties) {
                return {
                    ...base,
                    kind: 'map',
                    value: toNode(schema.additionalProperties, null, false),
                    ...(role ? {keyRole: role} : {})
                };
            }
            return schema.properties
                ? {...base, kind: 'group', children: toEditorSpec(schema)}
                : {...base, kind: 'json'};
        }
        case 'array': {
            const items: PlainObject = schema.items ?? {};
            if (isStringArray(schema)) {
                return {...base, kind: 'stringList', ...(items.enum ? {options: items.enum} : {})};
            }
            const item = toNode(items, null, false);
            return item.kind === 'json' ? {...base, kind: 'json'} : {...base, kind: 'list', item};
        }
        default:
            return {...base, kind: 'json'};
    }
}

// The object variant of a list item that is a field name, or an object with a field and settings.
function fieldSettingsOf(items: PlainObject): PlainObject {
    const variants: PlainObject[] = items?.anyOf ?? items?.oneOf ?? [];
    if (!variants.some(it => it.type === 'string')) return null;
    return variants.find(it => it.type === 'object' && it.properties?.field) ?? null;
}

function isStringArray(schema: PlainObject): boolean {
    return schema.type === 'array' && schema.items?.type === 'string';
}

// A variant a kind switch can offer: one input, not a structure.
function isSimple(node: EditorNode): boolean {
    return ['text', 'number', 'boolean', 'choice', 'stringList'].includes(node.kind);
}

// A boolean's segments in the order its labels give, else On then Off.
function booleanLabels(labels: PlainObject): {value: boolean; label: string}[] {
    const entries = Object.entries(labels ?? {}).filter(([k]) => k === 'true' || k === 'false');
    return entries.length === 2
        ? entries.map(([k, label]) => ({value: k === 'true', label}))
        : [
              {value: true, label: 'On'},
              {value: false, label: 'Off'}
          ];
}
