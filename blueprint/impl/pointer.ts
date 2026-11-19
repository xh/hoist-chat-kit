import type {PlainObject} from '@xh/hoist/core';
import {cloneDeep} from 'lodash';

/** Names that reach an object's prototype, refused in every path and every ID. */
export const FORBIDDEN_KEYS = ['__proto__', 'prototype', 'constructor'];

export function isForbiddenKey(key: string): boolean {
    return FORBIDDEN_KEYS.includes(key);
}

/**
 * A copy of an object's own entries, with no prototype. A lookup by any name, such as `toString`,
 * finds only those entries.
 */
export function toLookup<T>(o: Record<string, T>): Record<string, T> {
    return Object.assign(Object.create(null), o ?? {});
}

/** An object's own property, or null. Never a member it inherits. */
export function getOwn<T>(o: Record<string, T>, key: unknown): T {
    return o != null && typeof key === 'string' && Object.hasOwn(o, key) ? o[key] : null;
}

/** A JSON Pointer that cannot be followed: malformed, or through a forbidden name. */
export class PointerError extends Error {
    readonly code: string;

    constructor(message: string, code: string) {
        super(message);
        this.code = code;
    }
}

/** The segments of a JSON Pointer. Throws for a malformed path, or one with a forbidden name. */
export function parsePointer(path: string): string[] {
    if (typeof path !== 'string' || !path.startsWith('/')) {
        throw new PointerError(`path '${path}' must start with '/'`, 'edit.badOp');
    }
    const ret = path.slice(1).split('/'),
        forbidden = ret.find(isForbiddenKey);
    if (forbidden) {
        throw new PointerError(`'${forbidden}' is forbidden in a path`, 'path.forbidden');
    }
    return ret;
}

/** The value at a JSON Pointer, following own properties only, or undefined. */
export function getAt(o: unknown, path: string): unknown {
    let ret: any = o;
    for (const seg of parsePointer(path)) {
        if (ret == null || typeof ret !== 'object' || !Object.hasOwn(ret, seg)) return undefined;
        ret = ret[seg];
    }
    return ret;
}

/** Set a copy of a value at a JSON Pointer, creating own objects on the way. */
export function setAt(o: PlainObject, path: string, value: unknown) {
    const segs = parsePointer(path),
        last = segs.pop();
    let target = o;
    for (const seg of segs) {
        if (!Object.hasOwn(target, seg) || target[seg] == null || typeof target[seg] !== 'object') {
            target[seg] = {};
        }
        target = target[seg];
    }
    target[last] = cloneDeep(value);
}
