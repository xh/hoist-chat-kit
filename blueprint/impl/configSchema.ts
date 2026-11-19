import type {PlainObject} from '@xh/hoist/core';
import {isArray, isPlainObject, isString} from 'lodash';
import type {SchemaPath, SchemaProblem} from '../../impl/SchemaUtils';
import {findSchemaErrors} from '../../impl/SchemaUtils';

/** Hoist's filter operators. */
export const FILTER_OPS = [
    '=',
    '!=',
    '>',
    '>=',
    '<',
    '<=',
    'like',
    'not like',
    'begins',
    'not begins',
    'ends',
    'not ends',
    'includes',
    'excludes'
];

/**
 * Check a widget config, or a container's child reference, against its schema, reading the
 * registry's annotations as it walks. Returns each problem with its path as a JSON Pointer
 * relative to the value.
 */
export function checkConfig(
    value: unknown,
    schema: PlainObject,
    opts: {isPartial?: boolean} = {}
): {path: string; message: string}[] {
    return findSchemaErrors(value, schema, {checkNode, isPartial: opts.isPartial}).map(it => ({
        path: toPointer(it.path),
        message: it.message
    }));
}

/** Check a value as a Hoist filter in JSON form, where any member may be a binding. */
export function checkFilter(value: unknown, path: SchemaPath = []): SchemaProblem[] {
    const fail = (message: string, at = path) => [{path: at, message}];
    if (!isPlainObject(value)) return fail('expected a filter object');

    const v = value as PlainObject;
    if ('$var' in v) return checkBinding(v, path);
    if ('filters' in v) {
        const extra = Object.keys(v).find(k => k !== 'filters' && k !== 'op');
        if (extra) return fail('unknown property', [...path, extra]);
        if (v.op != null && !['AND', 'OR', 'and', 'or'].includes(v.op)) {
            return fail('expected "AND" or "OR"', [...path, 'op']);
        }
        if (!isArray(v.filters)) return fail('expected array', [...path, 'filters']);
        return v.filters.flatMap((it, idx) => checkFilter(it, [...path, 'filters', idx]));
    }
    const extra = Object.keys(v).find(k => !['field', 'op', 'value'].includes(k));
    if (extra) return fail('unknown property', [...path, extra]);
    if (!isString(v.field)) return fail('expected a field name', [...path, 'field']);
    if (!FILTER_OPS.includes(v.op)) {
        return fail(`expected one of ${FILTER_OPS.join(', ')}`, [...path, 'op']);
    }
    return [];
}

export function toPointer(path: SchemaPath): string {
    return path.map(it => `/${it}`).join('');
}

//------------------
// Implementation
//------------------
function checkNode(value: unknown, schema: PlainObject, path: SchemaPath): SchemaProblem[] {
    const fail = (message: string) => [{path, message}];
    if (schema['x-filter']) return checkFilter(value, path);
    if (schema['x-binding'] && isPlainObject(value) && '$var' in (value as PlainObject)) {
        return checkBinding(value as PlainObject, path);
    }
    if (schema['x-format']) {
        return isString(value) || isPlainObject(value) ? [] : fail('expected a format');
    }
    if (schema['x-renderer']) {
        return isString(value) || (isPlainObject(value) && isString((value as PlainObject).name))
            ? []
            : fail('expected a renderer name, or an object with a name');
    }
    if (schema['x-action']) {
        const steps = isArray(value) ? value : [value],
            isAction = (it: unknown) => isPlainObject(it) && isString((it as PlainObject).type);
        if (!steps.length || steps.length > 8)
            return fail('expected one action, or a list of 1 to 8');
        return steps.every(isAction)
            ? []
            : fail('expected an action with a type, or a list of them');
    }
    return null;
}

function checkBinding(v: PlainObject, path: SchemaPath): SchemaProblem[] {
    if (!isString(v.$var)) return [{path: [...path, '$var'], message: 'expected string'}];
    const extra = Object.keys(v).find(k => k !== '$var');
    return extra ? [{path: [...path, extra], message: 'unknown property'}] : [];
}
