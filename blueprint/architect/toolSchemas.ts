import type {PlainObject} from '@xh/hoist/core';
import {castArray, isArray, isEmpty, isPlainObject, isString, mapValues, uniq} from 'lodash';

/**
 * A tool's input as its schema means it, before the tool checks it: each optional property with no
 * value - null, an empty string, an empty list or an empty object - dropped, at any depth the
 * schema declares. A model that must send every property, as under OpenAI's strict mode, sends
 * `column: []` for one it means to leave out.
 *
 * @param opts.strict - true for input written against {@link strictToolSchema}, whose open values
 *      arrive as JSON text. Each is parsed back, or left as text if it does not parse.
 */
export function normalizeToolInput(
    schema: PlainObject,
    input: unknown,
    opts: {strict?: boolean} = {}
): any {
    const strict = !!opts.strict;
    if (strict && isOpen(schema) && isString(input)) return parseJson(input);
    if (isArray(input) && isPlainObject(schema?.items)) {
        return input.map(it => normalizeToolInput(schema.items, it, opts));
    }
    if (!isPlainObject(input) || !isPlainObject(schema?.properties)) return input;

    const required: string[] = schema.required ?? [],
        ret: PlainObject = {};
    Object.entries(input as PlainObject).forEach(([key, value]) => {
        const prop = schema.properties[key],
            v = prop ? normalizeToolInput(prop, value, opts) : value;
        if (!required.includes(key) && isEmptyValue(v)) return;
        ret[key] = v;
    });
    return ret;
}

/**
 * A tool's input schema in the form OpenAI's strict mode takes: every object closed, with every
 * property required, and each optional one nullable. An open value, which strict mode cannot
 * express - an object with no declared properties, a map, or a value of any type - becomes JSON
 * text. Run the input back through {@link normalizeToolInput} with `strict`.
 */
export function strictToolSchema(schema: PlainObject): PlainObject {
    return toStrict(schema, false);
}

//------------------
// Implementation
//------------------
function toStrict(schema: PlainObject, optional: boolean): PlainObject {
    if (isOpen(schema)) {
        return {
            type: optional ? ['string', 'null'] : 'string',
            description: [schema?.description, 'As JSON.'].filter(Boolean).join(' ')
        };
    }
    const ret: PlainObject = {...schema};
    if (isPlainObject(schema.properties)) {
        const required: string[] = schema.required ?? [];
        ret.properties = mapValues(schema.properties, (prop, key) =>
            toStrict(prop, !required.includes(key))
        );
        ret.required = Object.keys(schema.properties);
        ret.additionalProperties = false;
    }
    if (isPlainObject(schema.items)) ret.items = toStrict(schema.items, false);
    if (!optional) return ret;
    if (ret.type != null) ret.type = uniq([...castArray(ret.type), 'null']);
    if (isArray(ret.enum)) ret.enum = uniq([...ret.enum, null]);
    return ret;
}

// A value strict mode cannot describe: any type, or an object whose keys it does not declare.
function isOpen(schema: PlainObject): boolean {
    if (!isPlainObject(schema)) return true;
    const typed = schema.type != null || schema.enum || schema.anyOf || schema.oneOf;
    if (!typed) return true;
    return castArray(schema.type).includes('object') && !isPlainObject(schema.properties);
}

function parseJson(text: string): unknown {
    try {
        return JSON.parse(text);
    } catch {
        return text;
    }
}

const isEmptyValue = (v: unknown) =>
    v == null || v === '' || ((isArray(v) || isPlainObject(v)) && isEmpty(v));
