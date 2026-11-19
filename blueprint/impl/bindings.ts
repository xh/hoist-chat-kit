import type {PlainObject} from '@xh/hoist/core';
import type {FilterSpec} from '@xh/hoist/data';
import {isArray, isEmpty, isPlainObject, mapValues} from 'lodash';
import {isVarBinding} from '../Blueprint';

export type VariableGetter = (name: string) => unknown;

/** A copy of a value with each `{"$var": name}` replaced by the variable's value. */
export function resolveBindings(value: unknown, get: VariableGetter): any {
    if (isVarBinding(value)) return get(value.$var) ?? null;
    if (isArray(value)) return value.map(it => resolveBindings(it, get));
    if (isPlainObject(value)) {
        return mapValues(value as PlainObject, it => resolveBindings(it, get));
    }
    return value;
}

/**
 * A filter with its bindings resolved. A clause bound to a null value drops, and a compound left
 * empty means no filter. A literal null value keeps Hoist's meaning, and matches empty values.
 *
 * @returns the filter, or null for none.
 */
export function resolveFilter(filter: unknown, get: VariableGetter): FilterSpec {
    if (filter == null) return null;
    if (isVarBinding(filter)) return (get(filter.$var) as FilterSpec) ?? null;

    const f = filter as PlainObject;
    if (isArray(f.filters)) {
        const filters = f.filters.map(it => resolveFilter(it, get)).filter(it => it != null);
        return isEmpty(filters) ? null : {op: f.op ?? 'AND', filters};
    }
    if (isVarBinding(f.value)) {
        const value = get(f.value.$var);
        return value == null ? null : ({...f, value} as FilterSpec);
    }
    return f as FilterSpec;
}

/** Filters joined with AND, skipping nulls. Null if none remain. */
export function andFilters(filters: FilterSpec[]): FilterSpec {
    const present = filters.filter(it => it != null);
    if (present.length < 2) return present[0] ?? null;
    return {op: 'AND', filters: present};
}
