import type {PlainObject} from '@xh/hoist/core';
import {castArray, isEmpty, isPlainObject, isString, omit} from 'lodash';

/** A format or renderer as its name, or null, and the options it sets beside or without one. */
export function splitNamed(value: unknown): {name: string; options: PlainObject} {
    if (isString(value)) return {name: value, options: {}};
    if (!isPlainObject(value)) return {name: null, options: {}};
    const o = value as PlainObject;
    return isString(o.name) ? {name: o.name, options: omit(o, 'name')} : {name: null, options: o};
}

/** A format or renderer in its simplest form: a name, options, a name with options, or none. */
export function joinNamed(name: string, options: PlainObject): unknown {
    if (isEmpty(options)) return name ?? undefined;
    return name ? {name, ...options} : options;
}

/** The steps of an action prop: one action, or a list. */
export function stepsOf(value: unknown): PlainObject[] {
    if (Array.isArray(value)) return value;
    return isPlainObject(value) ? [value as PlainObject] : [];
}

/** An action prop of the steps given: one as itself, more as a list, or none. */
export function joinSteps(steps: PlainObject[]): unknown {
    if (!steps.length) return undefined;
    return steps.length === 1 ? steps[0] : steps;
}

/** One key of a Hoist sort: its field, its direction, and whether it sorts by absolute value. */
export interface SortKey {
    field: string;
    desc: boolean;
    abs: boolean;
}

/** The keys of a sort prop: a sorter such as `pnl|desc|abs`, or a list of them. */
export function sortKeysOf(value: unknown): SortKey[] {
    return castArray(value ?? [])
        .filter((it): it is string => isString(it) && !!it)
        .map(it => {
            const [field, ...flags] = it.split('|');
            return {field, desc: flags.includes('desc'), abs: flags.includes('abs')};
        });
}

/** A sort prop of the keys given: one as its sorter, more as a list, or none. */
export function joinSortKeys(keys: SortKey[]): unknown {
    const ret = keys.map(({field, desc, abs}) =>
        [field, desc ? 'desc' : null, abs ? 'abs' : null].filter(Boolean).join('|')
    );
    return !ret.length ? undefined : ret.length === 1 ? ret[0] : ret;
}
