import type {PlainObject} from '@xh/hoist/core';
import {isPlainObject} from 'lodash';

/**
 * The clauses ANDed at the top of a filter in JSON form, split into those that name a variable
 * anywhere and literal ones. An OR, or any other compound, stays one clause.
 */
export function splitClauses(filter: unknown): {bound: PlainObject[]; literal: PlainObject[]} {
    const clauses: PlainObject[] = !isPlainObject(filter)
            ? []
            : isAnd(filter as PlainObject)
              ? (filter as PlainObject).filters
              : [filter as PlainObject],
        bound = clauses.filter(namesVariable);
    return {bound, literal: clauses.filter(it => !bound.includes(it))};
}

/** A filter of the clauses given, ANDed, or undefined for none. */
export function joinClauses(bound: PlainObject[], literal: PlainObject[]): PlainObject {
    const clauses = [...bound, ...literal];
    if (!clauses.length) return undefined;
    return clauses.length === 1 ? clauses[0] : {op: 'AND', filters: clauses};
}

/** True if a value is, or holds, a `{"$var": name}` binding. */
export function namesVariable(value: unknown): boolean {
    if (Array.isArray(value)) return value.some(namesVariable);
    if (!isPlainObject(value)) return false;
    return '$var' in (value as PlainObject) || Object.values(value).some(namesVariable);
}

//------------------
// Implementation
//------------------
function isAnd(filter: PlainObject): boolean {
    return Array.isArray(filter.filters) && (filter.op ?? 'AND').toUpperCase() === 'AND';
}
