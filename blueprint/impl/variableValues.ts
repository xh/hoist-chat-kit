import {isArray, isBoolean, isEqual, isFinite, isInteger, isPlainObject, isString} from 'lodash';
import type {VariableDecl} from '../Blueprint';
import type {BlueprintRegistry} from '../BlueprintRegistry';
import {findSchemaErrors} from '../../impl/SchemaUtils';
import {checkFilter} from './configSchema';

/**
 * Why a value cannot be a variable's, or null if it can. Null always can, as no value. Checks the
 * variable's type, each item of a list type, and its `options.values`. An app type checks as the
 * field type it matches, and against its `schema`.
 */
export function checkVariableValue(
    name: string,
    decl: VariableDecl,
    value: unknown,
    registry: Pick<BlueprintRegistry, 'variableTypes'> &
        Partial<Pick<BlueprintRegistry, 'dateRangePresets'>>
): string {
    if (value == null) return null;
    const type = String(decl.type ?? ''),
        isList = type.endsWith('[]'),
        itemType = isList ? type.slice(0, -2) : type,
        items = isList ? value : [value];
    if (isList && !isArray(value)) return `'${name}' takes a list of ${itemType}`;

    const spec = registry.variableTypes[itemType],
        base = spec?.matches ?? itemType;
    for (const item of items as unknown[]) {
        if (!matchesType(item, base))
            return `'${name}' takes a ${type}, not ${JSON.stringify(item)}`;
        const [problem] = spec?.schema ? findSchemaErrors(item, spec.schema) : [];
        if (problem) {
            const at = problem.path.length ? ` at ${problem.path.join('.')}` : '';
            return `'${name}' takes a ${type}: ${problem.message}${at}`;
        }
        const token = base === 'dateRange' ? presetToken(item) : null;
        if (token && registry.dateRangePresets && !registry.dateRangePresets[token]) {
            return `'${name}' names no date range preset '${token}'`;
        }
        const options = (decl.options as any)?.values;
        if (isArray(options) && !options.some(it => isEqual(it, item))) {
            return `'${name}' takes one of ${options.join(', ')}, not ${JSON.stringify(item)}`;
        }
    }
    return null;
}

/**
 * The `calendar` that a `period` variable bound to one of a resolver call's args declares, or null.
 * A call that names no calendar counts in it.
 */
export function boundPeriodCalendar(
    args: Record<string, unknown>,
    variables: Record<string, VariableDecl>
): string {
    for (const arg of Object.values(args ?? {})) {
        const name = isPlainObject(arg) ? (arg as {$var?: string}).$var : null,
            decl = name && Object.hasOwn(variables ?? {}, name) ? variables[name] : null;
        if (decl?.type === 'period' && decl.calendar) return decl.calendar;
    }
    return null;
}

//------------------
// Implementation
//------------------
/** True if a value fits a Hoist field type, or a type it cannot check, such as an app's. */
export function matchesType(value: unknown, type: string): boolean {
    switch (type) {
        case 'string':
            return isString(value);
        case 'number':
            return isFinite(value);
        case 'int':
            return isInteger(value);
        case 'bool':
            return isBoolean(value);
        case 'localDate':
            return isString(value) && /^\d{4}-\d{2}-\d{2}$/.test(value);
        case 'date':
            return isFinite(value);
        case 'filter':
            return checkFilter(value).length === 0;
        case 'number[]':
            return isArray(value) && value.every(it => it == null || isFinite(it));
        case 'dateRange':
            return (
                isString(value) ||
                (isPlainObject(value) && DATE_RANGE_KINDS.includes((value as {kind?: string}).kind))
            );
        case 'period':
            return isString(value) && PERIOD.test(value);
        default:
            // An app type that matches no field type, such as a portfolio, takes any JSON value.
            return true;
    }
}

// A date range is Hoist's `DateRangeSelection`, which `parseDateRangeSelection()` reads in full.
const DATE_RANGE_KINDS = ['preset', 'relative', 'month', 'quarter', 'year', 'custom'];

// As Hoist's `parsePeriod()` reads one, with a count from 1 to 999.
const PERIOD = /^\+?[1-9]\d{0,2}[DWMQY]$/;

/** The preset a date range names, as a token or a preset selection, or null. */
function presetToken(value: unknown): string {
    if (isString(value)) return value;
    const v = value as {kind?: string; token?: string};
    return v?.kind === 'preset' ? v.token : null;
}

/**
 * An inline field with its type, from its values where it gives none: `number` if every value is
 * a number, `bool` if every one is a boolean, else `string`.
 */
export function withInlineType<F extends {name: string; type?: string}>(
    field: F,
    rows: Record<string, unknown>[]
): F {
    if (field.type) return field;
    const values = (rows ?? []).map(it => it?.[field.name]).filter(it => it != null),
        type = !values.length
            ? 'string'
            : values.every(it => isFinite(it))
              ? 'number'
              : values.every(isBoolean)
                ? 'bool'
                : 'string';
    return {...field, type};
}
