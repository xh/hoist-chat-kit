import type {PlainObject} from '@xh/hoist/core';
import {isArray, isPlainObject, mapValues, uniq} from 'lodash';

/**
 * The variable types a bound property takes, from its schema, or null where its schema says
 * nothing a variable type matches, as for an object.
 */
export function bindingTypesOf(schema: PlainObject): string[] {
    if (!isPlainObject(schema)) return null;
    if (schema['x-filter']) return ['filter'];
    // A value of one of several shapes, such as a sort that is one key or a list, takes any of theirs.
    const alternatives = schema.anyOf ?? schema.oneOf;
    if (isArray(alternatives)) {
        const types = uniq(alternatives.flatMap((it: PlainObject) => bindingTypesOf(it) ?? []));
        return types.length ? types : null;
    }
    if (schema.enum) {
        // A choice of mixed kinds, such as a place or false for none, takes a variable of each.
        const types = uniq(schema.enum.map(enumType)).filter(Boolean) as string[];
        return types.length ? types : null;
    }
    switch (schema.type) {
        case 'boolean':
            return ['bool'];
        case 'integer':
            return ['int', 'number'];
        case 'number':
            return ['number', 'int'];
        case 'string':
            if (schema.format === 'date') return ['localDate'];
            if (schema.format === 'date-time') return ['date'];
            return ['string', 'localDate'];
        case 'array': {
            const items = bindingTypesOf(schema.items);
            return items?.includes('string') ? ['string[]'] : null;
        }
        default:
            return null;
    }
}

// The variable type an enum's option takes, or null for one no variable type holds.
function enumType(it: unknown): string {
    if (typeof it === 'boolean') return 'bool';
    if (typeof it === 'string') return 'string';
    if (typeof it === 'number') return Number.isInteger(it) ? 'int' : 'number';
    return null;
}

/**
 * True for a config property that takes a binding unless it says `x-binding: false`: a value whose
 * type a variable type matches, and no reference to something of the blueprint, such as a source,
 * a field or a preset group, nor template text, which reads variables itself.
 */
export function isBindableByDefault(schema: PlainObject): boolean {
    return (
        isPlainObject(schema) &&
        !REFERENCES.some(it => schema[it]) &&
        bindingTypesOf(schema) != null
    );
}

/**
 * A widget's config schema with each top-level property's `x-binding` made explicit: as written,
 * else true where {@link isBindableByDefault}.
 */
export function withEffectiveBindings(config: PlainObject): PlainObject {
    if (!isPlainObject(config?.properties)) return config;
    return {
        ...config,
        properties: mapValues(config.properties, (prop: PlainObject) =>
            prop?.['x-binding'] === undefined && isBindableByDefault(prop)
                ? {...prop, 'x-binding': true}
                : prop
        )
    };
}

/**
 * A config schema as the Architect reads it: a property marked `x-binding: true` that would bind
 * by default loses the mark, as the prompt states the default once. What only people read goes:
 * `x-thumbnails`, `x-labels`, `x-unset`, `x-row` and `x-caption` everywhere, list items' `x-groups`,
 * `x-common`, `x-summary` and `x-page`, and the `x-group` of a list item's property.
 */
export function withDefaultBindingsImplied(config: PlainObject): PlainObject {
    if (!isPlainObject(config?.properties)) return config;
    return {
        ...config,
        properties: mapValues(config.properties, (prop: PlainObject) => {
            const rest = forArchitect(prop ?? {}) as PlainObject,
                kept = prop?.['x-group'] ? {...rest, 'x-group': prop['x-group']} : rest;
            if (kept['x-binding'] !== true || !isBindableByDefault(kept)) return kept;
            const {'x-binding': _binding, ...unmarked} = kept;
            return unmarked;
        })
    };
}

// A schema without the annotations only people read, at any depth.
function forArchitect(schema: unknown): unknown {
    if (Array.isArray(schema)) return schema.map(forArchitect);
    if (!isPlainObject(schema)) return schema;
    return Object.fromEntries(
        Object.entries(schema as PlainObject)
            .filter(([key]) => !FOR_PEOPLE.includes(key))
            .map(([key, value]) => [key, forArchitect(value)])
    );
}

const FOR_PEOPLE = [
    'x-thumbnails',
    'x-labels',
    'x-unset',
    'x-group',
    'x-groups',
    'x-common',
    'x-summary',
    'x-page',
    'x-row',
    'x-caption'
];

const REFERENCES = [
    'x-source',
    'x-field',
    'x-filter',
    'x-format',
    'x-renderer',
    'x-action',
    'x-sort',
    'x-variable',
    'x-blueprint',
    'x-preset',
    'x-icon',
    'x-template'
];
