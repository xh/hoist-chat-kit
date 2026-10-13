import type {PlainObject} from '@xh/hoist/core';
import {pluralize} from '@xh/hoist/utils/js';
import {
    castArray,
    isArray,
    isEmpty,
    isEqual,
    isNumber,
    isPlainObject,
    isString,
    minBy
} from 'lodash';

/** Options for {@link validateSchema}. */
export interface ValidateSchemaOptions {
    /**
     * True if the value is still streaming, as a partial parse of incomplete JSON. Checks that a
     * growing value could still pass are skipped: `required`, `minItems` and `minLength`. Strings
     * pass `enum` and `const` if they start an allowed value, and skip `pattern`, since the last
     * string may be cut short. A value may match more than one `oneOf` branch. Default false.
     */
    isPartial?: boolean;
}

/**
 * Check a value against a JSON Schema, for the subset of keywords the kit supports: `type`
 * (including a list of types), `required`, `properties`, `additionalProperties` (false or a
 * schema), `enum`, `const`, `items`, `minItems`, `maxItems`, `minLength`, `maxLength`, `minimum`,
 * `maximum`, `pattern`, `anyOf` and `oneOf`. Other keywords are ignored.
 *
 * @returns readable problems, each prefixed with the path of the value at fault - for example
 *      `rows[3].value: expected number, got string`. Empty if the value is valid.
 * @internal
 */
export function validateSchema(
    value: unknown,
    schema: PlainObject,
    opts: ValidateSchemaOptions = {}
): string[] {
    const errors: string[] = [];
    checkValue(value, schema, '', !!opts.isPartial, errors);
    return errors;
}

//------------------
// Implementation
//------------------
type JsonType = 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null';

function checkValue(
    value: unknown,
    schema: PlainObject,
    path: string,
    isPartial: boolean,
    errors: string[]
) {
    if (!isPlainObject(schema)) return;
    const fail = (msg: string) => errors.push(formatError(path, msg));

    // A value of the wrong type fails here alone - its other checks would only add noise.
    if (!fitsType(value, schema)) {
        fail(`expected ${castArray(schema.type).join(' or ')}, got ${typeOf(value)}`);
        return;
    }

    if (schema.enum && !schema.enum.some(it => matchesValue(value, it, isPartial))) {
        fail(`expected one of ${schema.enum.map(it => JSON.stringify(it)).join(', ')}`);
    }
    if ('const' in schema && !matchesValue(value, schema.const, isPartial)) {
        fail(`expected ${JSON.stringify(schema.const)}`);
    }

    if (isPlainObject(value)) {
        checkObject(value as PlainObject, schema, path, isPartial, errors);
    } else if (isArray(value)) {
        checkArray(value, schema, path, isPartial, errors);
    } else if (isString(value)) {
        const {minLength, maxLength, pattern} = schema;
        if (!isPartial && minLength != null && value.length < minLength) {
            fail(`expected at least ${pluralize('character', minLength, true)}`);
        }
        if (maxLength != null && value.length > maxLength) {
            fail(
                `expected at most ${pluralize('character', maxLength, true)}, got ${value.length}`
            );
        }
        if (!isPartial && pattern != null && !new RegExp(pattern, 'u').test(value)) {
            fail(`expected to match /${pattern}/`);
        }
    } else if (isNumber(value)) {
        const {minimum, maximum} = schema;
        if (minimum != null && value < minimum) fail(`expected at least ${minimum}, got ${value}`);
        if (maximum != null && value > maximum) fail(`expected at most ${maximum}, got ${value}`);
    }

    if (schema.anyOf) checkAnyOf(value, schema.anyOf, path, isPartial, errors);
    if (schema.oneOf) checkOneOf(value, schema.oneOf, path, isPartial, errors);
}

function checkObject(
    value: PlainObject,
    schema: PlainObject,
    path: string,
    isPartial: boolean,
    errors: string[]
) {
    const {properties = {}, required = [], additionalProperties} = schema;

    if (!isPartial) {
        required.forEach(key => {
            if (value[key] === undefined) errors.push(formatError(propPath(path, key), 'required'));
        });
    }

    Object.entries(value).forEach(([key, propValue]) => {
        if (propValue === undefined) return;
        const keyPath = propPath(path, key);
        if (key in properties) {
            checkValue(propValue, properties[key], keyPath, isPartial, errors);
        } else if (additionalProperties === false) {
            errors.push(formatError(keyPath, 'unknown property'));
        } else if (isPlainObject(additionalProperties)) {
            checkValue(propValue, additionalProperties, keyPath, isPartial, errors);
        }
    });
}

function checkArray(
    value: unknown[],
    schema: PlainObject,
    path: string,
    isPartial: boolean,
    errors: string[]
) {
    const {items, minItems, maxItems} = schema,
        fail = (msg: string) => errors.push(formatError(path, msg));

    if (!isPartial && minItems != null && value.length < minItems) {
        fail(`expected at least ${pluralize('item', minItems, true)}, got ${value.length}`);
    }
    if (maxItems != null && value.length > maxItems) {
        fail(`expected at most ${pluralize('item', maxItems, true)}, got ${value.length}`);
    }
    if (isPlainObject(items)) {
        value.forEach((it, idx) => checkValue(it, items, `${path}[${idx}]`, isPartial, errors));
    }
}

/** Passes if any branch passes. Otherwise reports the problems of the closest branch. */
function checkAnyOf(
    value: unknown,
    branches: PlainObject[],
    path: string,
    isPartial: boolean,
    errors: string[]
) {
    const results = branches.map(it => validateBranch(value, it, path, isPartial));
    if (results.some(isEmpty)) return;
    errors.push(...closestErrors(value, branches, results));
}

/** As `anyOf`, but fails if more than one branch passes - unless the value is partial. */
function checkOneOf(
    value: unknown,
    branches: PlainObject[],
    path: string,
    isPartial: boolean,
    errors: string[]
) {
    const results = branches.map(it => validateBranch(value, it, path, isPartial)),
        matchCount = results.filter(isEmpty).length;

    if (matchCount === 0) {
        errors.push(...closestErrors(value, branches, results));
    } else if (matchCount > 1 && !isPartial) {
        errors.push(formatError(path, 'matches more than one allowed schema'));
    }
}

function validateBranch(
    value: unknown,
    schema: PlainObject,
    path: string,
    isPartial: boolean
): string[] {
    const errors: string[] = [];
    checkValue(value, schema, path, isPartial, errors);
    return errors;
}

/**
 * Problems of the branch closest to the value - the one with the fewest, among branches that fit
 * its type. A type mismatch says the least about what the model meant to write.
 */
function closestErrors(value: unknown, branches: PlainObject[], results: string[][]): string[] {
    const fitting = results.filter((_, idx) => fitsType(value, branches[idx]));
    return minBy(isEmpty(fitting) ? results : fitting, 'length') ?? [];
}

function fitsType(value: unknown, schema: PlainObject): boolean {
    return schema.type == null || castArray(schema.type).some(it => isType(value, it));
}

function isType(value: unknown, type: JsonType): boolean {
    switch (type) {
        case 'object':
            return isPlainObject(value);
        case 'array':
            return isArray(value);
        case 'string':
            return isString(value);
        case 'number':
            return isNumber(value) && Number.isFinite(value);
        case 'integer':
            return Number.isInteger(value);
        case 'boolean':
            return typeof value === 'boolean';
        case 'null':
            return value === null;
        default:
            return true;
    }
}

function typeOf(value: unknown): string {
    if (value === null) return 'null';
    if (isArray(value)) return 'array';
    return typeof value;
}

/** True if `value` equals `allowed` - or, for a partial string, could still become it. */
function matchesValue(value: unknown, allowed: unknown, isPartial: boolean): boolean {
    if (isPartial && isString(value) && isString(allowed)) return allowed.startsWith(value);
    return isEqual(value, allowed);
}

/** Path to a property - `rows[3].value`, or `rows[3]["first name"]` for a non-identifier key. */
function propPath(path: string, key: string): string {
    if (!IDENTIFIER_RE.test(key)) return `${path}[${JSON.stringify(key)}]`;
    return path ? `${path}.${key}` : key;
}

function formatError(path: string, msg: string): string {
    return path ? `${path}: ${msg}` : msg;
}

const IDENTIFIER_RE = /^[A-Za-z_$][\w$]*$/;
