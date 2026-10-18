import type {PlainObject} from '@xh/hoist/core';
import {cloneDeep, isArray, isEmpty, isNil, isPlainObject, isString} from 'lodash';
import {findSchemaProblems, validateSchema} from './validateSchema';

/**
 * How the user answers an interrupt, from its `responseSchema`:
 *
 *  - `text` - no schema. A text box, which answers with the text, or with no payload when empty.
 *  - `choice` - one choice. Buttons, or a list past three options. `field` names the property
 *    the choice goes in, or is null for a schema that is the choice itself.
 *  - `confirm` - a schema that is a boolean. Yes and No.
 *  - `form` - a flat object of simple fields.
 *  - `unsupported` - anything else. The user can only decline.
 *
 * @internal
 */
export type InterruptAnswerSpec =
    | {kind: 'text'}
    | {kind: 'choice'; field: string; options: InterruptOption[]; schema: PlainObject}
    | {kind: 'confirm'; schema: PlainObject}
    | {kind: 'form'; fields: InterruptField[]; schema: PlainObject}
    | {kind: 'unsupported'; problems: string[]};

/** One option of a choice. @internal */
export interface InterruptOption {
    value: string;
    label: string;
    description?: string;
}

/** One field of an answer form. @internal */
export interface InterruptField {
    name: string;
    label: string;
    description?: string;
    type: 'text' | 'date' | 'number' | 'integer' | 'boolean' | 'choice' | 'choices';
    options?: InterruptOption[];
    isRequired: boolean;
    defaultValue?: unknown;
    min?: number;
    max?: number;
}

/** The most options a choice shows as buttons. More show as a list. @internal */
export const MAX_CHOICE_BUTTONS = 3;

/**
 * Classify an interrupt's `responseSchema` - see {@link InterruptAnswerSpec}. Reads the shapes
 * Pydantic writes first: a local `$ref`, and a nullable `anyOf` or `type` list.
 * @internal
 */
export function getInterruptAnswerSpec(responseSchema: PlainObject): InterruptAnswerSpec {
    if (isNil(responseSchema)) return {kind: 'text'};

    const schema = normalizeSchema(responseSchema),
        problems = findSchemaProblems(schema);
    if (!isEmpty(problems)) return {kind: 'unsupported', problems};

    if (schema.type === 'boolean') return {kind: 'confirm', schema};

    const options = getOptions(schema);
    if (options) return {kind: 'choice', field: null, options, schema};

    if (schema.type !== 'object' || !isPlainObject(schema.properties)) {
        return {kind: 'unsupported', problems: ['not a flat object of simple fields']};
    }

    const required: string[] = isArray(schema.required) ? schema.required : [],
        fields = Object.entries<PlainObject>(schema.properties).map(([name, it]) =>
            getField(name, it, required.includes(name))
        );
    if (isEmpty(fields) || fields.includes(null)) {
        return {kind: 'unsupported', problems: ['not a flat object of simple fields']};
    }

    const [only] = fields;
    if (
        fields.length === 1 &&
        only.type === 'choice' &&
        only.options.length <= MAX_CHOICE_BUTTONS
    ) {
        return {kind: 'choice', field: only.name, options: only.options, schema};
    }
    return {kind: 'form', fields, schema};
}

/**
 * Problems with an answer, checked against the normalized schema of its answer spec. Empty if
 * the answer is good.
 * @internal
 */
export function checkInterruptAnswer(spec: InterruptAnswerSpec, payload: unknown): string[] {
    return 'schema' in spec ? validateSchema(payload, spec.schema) : [];
}

/**
 * The payload that approves or denies a server tool call, following the interrupt's
 * `responseSchema`, as adapters disagree on the shape:
 *
 *  - no schema - `{approved}`, with the user's `reason` when given.
 *  - a boolean property named `approved` or `confirmed` - `{approved}` or `{confirmed}`.
 *  - a string enum property that holds `allow` and `deny` - that property, as `allow` or `deny`.
 *  - a schema that is a string enum of `allow` and `deny` - the bare string.
 *  - a schema that is a boolean - the bare boolean.
 *
 * A string `reason` or `message` property takes the user's reason. Returns undefined for a schema
 * of no such shape, which renders as a question rather than Allow and Deny.
 *
 * @internal
 */
export function getApprovalPayload(
    responseSchema: PlainObject,
    isApproved: boolean,
    reason: string = null
): unknown {
    if (isNil(responseSchema))
        return reason ? {approved: isApproved, reason} : {approved: isApproved};

    const schema = normalizeSchema(responseSchema),
        verdict = isApproved ? 'allow' : 'deny';
    if (schema.type === 'boolean') return isApproved;
    if (isAllowDeny(schema)) return verdict;
    if (!isPlainObject(schema.properties)) return undefined;

    const props = Object.entries<PlainObject>(schema.properties),
        flag = props.find(([name, it]) => FLAG_NAMES.includes(name) && it.type === 'boolean'),
        choice = props.find(([, it]) => isAllowDeny(it)),
        note = props.find(([name, it]) => NOTE_NAMES.includes(name) && it.type === 'string');
    if (!flag && !choice) return undefined;

    return {
        ...(flag ? {[flag[0]]: isApproved} : {[choice[0]]: verdict}),
        ...(reason && note ? {[note[0]]: reason} : {})
    };
}

/**
 * True if an interrupt's schema asks to approve or deny - see {@link getApprovalPayload}.
 * @internal
 */
export function isApprovalSchema(responseSchema: PlainObject): boolean {
    return getApprovalPayload(responseSchema, true) !== undefined;
}

//------------------
// Implementation
//------------------
const FLAG_NAMES = ['approved', 'confirmed'],
    NOTE_NAMES = ['reason', 'message'],
    MAX_REF_DEPTH = 10;

/**
 * A copy of the schema with the shapes Pydantic writes read as plain ones: a local `$ref` into
 * `$defs` or `definitions` inlined, and `anyOf: [X, {type: 'null'}]` or `type: [X, 'null']` read
 * as an optional X. Anything else is left for the keyword check to refuse.
 */
function normalizeSchema(schema: PlainObject): PlainObject {
    const defs = {...schema.definitions, ...schema.$defs},
        {$defs: _defs, definitions: _definitions, ...rest} = schema;
    return normalizeNode(cloneDeep(rest), defs, 0);
}

function normalizeNode(node: any, defs: PlainObject, depth: number): any {
    if (isArray(node)) return node.map(it => normalizeNode(it, defs, depth));
    if (!isPlainObject(node)) return node;

    const ref = node.$ref;
    if (isString(ref) && depth < MAX_REF_DEPTH) {
        const name = /^#\/(?:\$defs|definitions)\/(.+)$/.exec(ref)?.[1];
        if (name && isPlainObject(defs[name])) {
            const {$ref: _ref, ...siblings} = node;
            return normalizeNode({...defs[name], ...siblings}, defs, depth + 1);
        }
    }

    const nonNull = isArray(node.anyOf) ? node.anyOf.filter(it => it?.type !== 'null') : null;
    if (nonNull?.length === 1 && node.anyOf.length === 2) {
        const {anyOf: _anyOf, ...siblings} = node;
        return normalizeNode({...nonNull[0], ...siblings}, defs, depth);
    }

    const types = isArray(node.type) ? node.type.filter(it => it !== 'null') : null;
    if (types?.length === 1) node = {...node, type: types[0]};

    return Object.fromEntries(
        Object.entries(node).map(([key, value]) => [key, normalizeNode(value, defs, depth)])
    );
}

/** The options of a one-choice schema - a string `enum`, or a `oneOf` of string `const`s. */
function getOptions(schema: PlainObject): InterruptOption[] {
    if (isArray(schema.enum) && !isEmpty(schema.enum) && schema.enum.every(isString)) {
        return schema.enum.map(value => ({value, label: value}));
    }
    if (isArray(schema.oneOf) && !isEmpty(schema.oneOf)) {
        const ret = schema.oneOf.map(it =>
            isString(it?.const)
                ? {
                      value: it.const,
                      label: isString(it.title) ? it.title : it.const,
                      ...(isString(it.description) ? {description: it.description} : {})
                  }
                : null
        );
        return ret.includes(null) ? null : ret;
    }
    return null;
}

function getField(name: string, schema: PlainObject, isRequired: boolean): InterruptField {
    if (!isPlainObject(schema)) return null;

    const base: InterruptField = {
        name,
        label: isString(schema.title) ? schema.title : name,
        ...(isString(schema.description) ? {description: schema.description} : {}),
        type: null,
        isRequired,
        ...(schema.default !== undefined ? {defaultValue: schema.default} : {})
    };

    const options = getOptions(schema);
    if (options) return {...base, type: 'choice', options};

    switch (schema.type) {
        case 'string':
            return {...base, type: schema.format === 'date' ? 'date' : 'text'};
        case 'number':
        case 'integer':
            return {
                ...base,
                type: schema.type,
                ...(isFinite(schema.minimum) ? {min: schema.minimum} : {}),
                ...(isFinite(schema.maximum) ? {max: schema.maximum} : {})
            };
        case 'boolean':
            return {...base, type: 'boolean'};
        case 'array': {
            const itemOptions = isPlainObject(schema.items) ? getOptions(schema.items) : null;
            return itemOptions ? {...base, type: 'choices', options: itemOptions} : null;
        }
        default:
            return null;
    }
}

function isAllowDeny(schema: PlainObject): boolean {
    const values = getOptions(schema ?? {})?.map(it => it.value);
    return !!values && values.includes('allow') && values.includes('deny');
}

function isFinite(value: unknown): value is number {
    return Number.isFinite(value);
}
