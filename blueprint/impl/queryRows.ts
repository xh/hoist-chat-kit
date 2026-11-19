import type {PlainObject} from '@xh/hoist/core';
import {groupBy, isPlainObject, isString, mean, orderBy, sum, uniq} from 'lodash';
import type {FieldDef} from '../DataCatalog';

/** How to shape leaf rows for a query: grouping, sort and a row limit. */
export interface RowQuery {
    fields: string[];
    groupBy?: string[];
    sortBy?: string;
    top?: number;
}

/**
 * Leaf rows grouped by `groupBy`, each measure rolled up by its catalog aggregator, then sorted and
 * cut to `top`. A measure only the server can roll up, or a number with no aggregator, rolls up to
 * null, as it shows on a group row.
 *
 * @returns the shaped rows, and the row count before `top`.
 */
export function queryRows(
    rows: PlainObject[],
    fields: Record<string, FieldDef>,
    query: RowQuery
): {rows: PlainObject[]; totalRows: number} {
    const dims = query.groupBy ?? [];
    let ret: PlainObject[];
    if (dims.length) {
        const groups = groupBy(rows, row => JSON.stringify(dims.map(d => row[d] ?? null)));
        ret = Object.values(groups).map(group =>
            Object.fromEntries([
                ...dims.map(d => [d, group[0][d]]),
                ...query.fields
                    .filter(f => !dims.includes(f))
                    .map(f => [f, rollUp(group, fields[f], f)])
            ])
        );
    } else {
        ret = rows.map(row => Object.fromEntries(query.fields.map(f => [f, row[f] ?? null])));
    }
    if (query.sortBy) {
        const [f, dir] = query.sortBy.split('|');
        ret = orderBy(ret, f, dir === 'desc' ? 'desc' : 'asc');
    }
    return {rows: query.top ? ret.slice(0, query.top) : ret, totalRows: ret.length};
}

//------------------
// Implementation
//------------------
function rollUp(group: PlainObject[], field: FieldDef, name: string): unknown {
    const values = group.map(it => it[name]).filter(it => it != null),
        agg = field?.aggregator;
    if (!values.length || agg === 'server') return null;
    if (isPlainObject(agg) && (agg as PlainObject).type === 'weightedAverage') {
        const {weightField, absolute} = agg as PlainObject,
            weights = group.map(it =>
                absolute ? Math.abs(it[weightField] ?? 0) : (it[weightField] ?? 0)
            ),
            total = sum(weights);
        return total ? sum(group.map((it, idx) => (it[name] ?? 0) * weights[idx])) / total : null;
    }
    const nums = values as number[];
    switch (isString(agg) ? agg : null) {
        case 'SUM':
            return sum(nums);
        case 'AVG':
            return mean(nums);
        case 'MIN':
            return Math.min(...nums);
        case 'MAX':
            return Math.max(...nums);
        case 'UNIQUE':
            return uniq(values).length === 1 ? values[0] : null;
        default:
            // As a Cube does: a number with no aggregator does not roll up, other values show
            // where they are unique.
            if (field?.type === 'number' || field?.type === 'int') return null;
            return uniq(values).length === 1 ? values[0] : null;
    }
}
