import type {PlainObject} from '@xh/hoist/core';
import {isEqual, isPlainObject} from 'lodash';
import type {Blueprint, BlueprintOp} from './Blueprint';

/**
 * The smallest list of operations that turns one blueprint into another, for `applyOps()` or an
 * edit: a `set` or `remove` for each object key that differs, at the deepest object that holds it,
 * and a `set` of the whole value where it is an array or changes type, as a path never indexes
 * into an array. An element comes and goes with a `set` or `remove` under `/elements`, and its
 * child reference with its container's `children`. Empty for equal blueprints.
 */
export function diffOps(
    from: Blueprint,
    to: Blueprint
): Extract<BlueprintOp, {op: 'set' | 'remove'}>[] {
    const ret: PathOp[] = [];
    diffObjects((from ?? {}) as PlainObject, (to ?? {}) as PlainObject, '', ret);
    return ret;
}

//------------------
// Implementation
//------------------
type PathOp = Extract<BlueprintOp, {op: 'set' | 'remove'}>;

function diffObjects(from: PlainObject, to: PlainObject, path: string, ret: PathOp[]) {
    Object.keys(from)
        .filter(it => !Object.hasOwn(to, it))
        .forEach(it => ret.push({op: 'remove', path: `${path}/${escape(it)}`}));
    Object.keys(to).forEach(key => {
        const at = `${path}/${escape(key)}`,
            a = Object.hasOwn(from, key) ? from[key] : undefined,
            b = to[key];
        if (isEqual(a, b)) return;
        if (isPlainObject(a) && isPlainObject(b)) {
            diffObjects(a, b, at, ret);
        } else {
            ret.push({op: 'set', path: at, value: b});
        }
    });
}

// A key as a JSON Pointer segment.
function escape(key: string): string {
    return key.replace(/~/g, '~0').replace(/\//g, '~1');
}
