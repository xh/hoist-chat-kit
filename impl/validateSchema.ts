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
     * string may be cut short. A number may still gain digits, which only moves it away from zero,
     * so a positive number skips `minimum` and a negative number skips `maximum`. A value may match
     * more than one `oneOf` branch. Default false.
     */
    isPartial?: boolean;

    /**
     * Path of the value within a larger document, prefixed to each problem - for example
     * `elements.chart.props`. Default none.
     */
    path?: string;
}

/**
 * Check a value against a JSON Schema, for the subset of keywords the kit supports: `type`
 * (including a list of types), `required`, `properties`, `additionalProperties` (false or a
 * schema), `enum`, `const`, `items`, `minItems`, `maxItems`, `minLength`, `maxLength`, `minimum`,
 * `maximum`, `pattern`, `anyOf` and `oneOf`. Other keywords are ignored - check a schema with
 * {@link findSchemaProblems} first, to refuse one that relies on them.
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
    checkValue(value, schema, opts.path ?? '', !!opts.isPartial, errors);
    return errors;
}

/**
 * Find what {@link validateSchema} cannot check in a schema: keywords that affect whether a value
 * is valid but that the checker does not implement, and patterns that do not compile as Unicode
 * regular expressions. Walks every subschema. Compiles and caches each pattern as it goes, so that
 * validation reuses it.
 *
 * Keywords that only annotate, such as `title`, `description`, `default` or `format`, are fine.
 *
 * @returns readable problems, each naming the keyword and the path of the subschema at fault -
 *      for example `$ref at properties.rows.items`. Empty if the checker covers the schema.
 * @internal
 */
export function findSchemaProblems(schema: PlainObject, path: string = ''): string[] {
    if (!isPlainObject(schema)) return [];

    const at = path ? ` at ${path}` : '',
        child = (key: string) => (path ? `${path}.${key}` : key),
        ret = UNSUPPORTED_KEYWORDS.filter(it => Object.hasOwn(schema, it)).map(it => `${it}${at}`),
        {properties, additionalProperties, items, pattern} = schema;

    if (isArray(items)) ret.push(`array-form items${at}`);
    if (pattern != null && !getPattern(pattern)) {
        ret.push(`pattern /${pattern}/${at} is not a valid regular expression with the 'u' flag`);
    }

    if (isPlainObject(properties)) {
        Object.entries(properties).forEach(([key, it]) =>
            ret.push(...findSchemaProblems(it, child(`properties.${key}`)))
        );
    }
    ret.push(
        ...findSchemaProblems(additionalProperties, child('additionalProperties')),
        ...findSchemaProblems(isArray(items) ? null : items, child('items'))
    );
    ['anyOf', 'oneOf'].forEach(key =>
        castArray(schema[key] ?? []).forEach((it, idx) =>
            ret.push(...findSchemaProblems(it, child(`${key}[${idx}]`)))
        )
    );
    return ret;
}

/**
 * Path to a property - `rows[3].value`, or `rows[3]["first name"]` for a non-identifier key.
 * @internal
 */
export function propPath(path: string, key: string): string {
    if (!IDENTIFIER_RE.test(key)) return `${path}[${JSON.stringify(key)}]`;
    return path ? `${path}.${key}` : key;
}

/**
 * A problem with the value at `path`, in the kit's `path: message` form.
 * @internal
 */
export function formatError(path: string, msg: string): string {
    return path ? `${path}: ${msg}` : msg;
}

/**
 * The JSON type of a value, for messages - `null`, `array`, or its `typeof`.
 * @internal
 */
export function typeOf(value: unknown): string {
    if (value === null) return 'null';
    if (isArray(value)) return 'array';
    return typeof value;
}

//------------------
// Implementation
//------------------
// Keywords that affect validity, which the checker does not implement. A schema that uses one
// would pass values it should reject, so the catalog refuses it.
const UNSUPPORTED_KEYWORDS = [
    '$ref',
    '$dynamicRef',
    '$defs',
    'definitions',
    'allOf',
    'not',
    'if',
    'then',
    'else',
    'exclusiveMinimum',
    'exclusiveMaximum',
    'multipleOf',
    'uniqueItems',
    'contains',
    'minContains',
    'maxContains',
    'prefixItems',
    'additionalItems',
    'unevaluatedItems',
    'unevaluatedProperties',
    'minProperties',
    'maxProperties',
    'patternProperties',
    'propertyNames',
    'dependentRequired',
    'dependentSchemas',
    'dependencies'
];

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
        if (!isPartial && pattern != null) {
            const regex = getPattern(pattern);
            if (!regex) {
                fail(`schema pattern /${pattern}/ is not a valid regular expression`);
            } else if (!regex.test(value)) {
                fail(`expected to match /${pattern}/`);
            }
        }
    } else if (isNumber(value)) {
        const {minimum, maximum} = schema;
        if (minimum != null && value < minimum && !(isPartial && value >= 0)) {
            fail(`expected at least ${minimum}, got ${value}`);
        }
        if (maximum != null && value > maximum && !(isPartial && value <= 0)) {
            fail(`expected at most ${maximum}, got ${value}`);
        }
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
        if (Object.hasOwn(properties, key)) {
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

/**
 * True if `value` equals `allowed` - or, for a partial string or number, could still become it,
 * as `1` may become `10`.
 */
function matchesValue(value: unknown, allowed: unknown, isPartial: boolean): boolean {
    if (isPartial && isString(value) && isString(allowed)) return allowed.startsWith(value);
    if (isPartial && isNumber(value) && isNumber(allowed)) {
        return String(allowed).startsWith(String(value));
    }
    return isEqual(value, allowed);
}

const IDENTIFIER_RE = /^[A-Za-z_$][\w$]*$/;

// Compiled schema patterns, so that each compiles once - when the catalog checks its schemas. Null
// for a pattern that does not compile.
const PATTERNS = new Map<string, RegExp>();

function getPattern(pattern: string): RegExp {
    if (!PATTERNS.has(pattern)) {
        let regex: RegExp = null;
        try {
            regex = new RegExp(pattern, 'u');
        } catch (ignored) {}
        PATTERNS.set(pattern, regex);
    }
    return PATTERNS.get(pattern);
}
