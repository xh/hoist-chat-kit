import type {PlainObject} from '@xh/hoist/core';
import {isPlainObject, mapValues, uniq} from 'lodash';

/**
 * The variable types a bound property takes, from its schema, or null where its schema says
 * nothing a variable type matches, as for an object.
 */
export function bindingTypesOf(schema: PlainObject): string[] {
    if (schema.enum) {
        return uniq(
            schema.enum.map((it: unknown) => (typeof it === 'boolean' ? 'bool' : 'string'))
        );
    }
    switch (schema.type) {
        case 'boolean':
            return ['bool'];
        case 'integer':
            return ['int', 'number'];
        case 'number':
            return ['number', 'int'];
        case 'string':
            return ['string', 'localDate'];
        case 'array':
            return schema.items?.type === 'string' ? ['string[]'] : null;
        default:
            return null;
    }
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
 * by default loses the mark, as the prompt states the default once.
 */
export function withDefaultBindingsImplied(config: PlainObject): PlainObject {
    if (!isPlainObject(config?.properties)) return config;
    return {
        ...config,
        properties: mapValues(config.properties, (prop: PlainObject) => {
            if (prop?.['x-binding'] !== true || !isBindableByDefault(prop)) return prop;
            const {'x-binding': _, ...rest} = prop;
            return rest;
        })
    };
}

const REFERENCES = [
    'x-source',
    'x-field',
    'x-filter',
    'x-format',
    'x-renderer',
    'x-action',
    'x-variable',
    'x-blueprint',
    'x-preset',
    'x-icon',
    'x-template'
];
