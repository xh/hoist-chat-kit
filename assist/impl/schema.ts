import type {PlainObject} from '@xh/hoist/core';
import {isEmpty} from 'lodash';

/**
 * JSON Schema for a tool's input object. Properties not listed are not allowed.
 * @internal
 */
export function objectSchema(properties: PlainObject = {}, required: string[] = []): PlainObject {
    return {type: 'object', properties, required, additionalProperties: false};
}

/**
 * JSON Schema for one of the given strings - or any string if there are none, as an empty
 * `enum` is not valid.
 * @internal
 */
export function enumSchema(values: string[], description?: string): PlainObject {
    const ret: PlainObject = isEmpty(values) ? {type: 'string'} : {type: 'string', enum: values};
    if (description) ret.description = description;
    return ret;
}

/**
 * JSON Schema for a list of the given items.
 * @internal
 */
export function arraySchema(
    items: PlainObject,
    description: string,
    minItems?: number
): PlainObject {
    const ret: PlainObject = {type: 'array', items, description};
    if (minItems != null) ret.minItems = minItems;
    return ret;
}

/**
 * A list of names for a tool call card, such as "Id, Seller and Region". Null while a streaming
 * call has none yet.
 * @internal
 */
export function joinNames(names: string[]): string {
    if (isEmpty(names)) return null;
    return names.length === 1
        ? names[0]
        : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
