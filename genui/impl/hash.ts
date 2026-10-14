import {isArray, isPlainObject} from 'lodash';
import type {PlainObject} from '@xh/hoist/core';

/**
 * A stable content hash of a JSON value: {@link fnv1a} of its canonical JSON. Equal values hash
 * alike whatever the order of their keys. Not for security - it detects change, such as drift
 * between a catalog and the export a server loaded.
 * @internal
 */
export function hashJson(value: unknown): string {
    return fnv1a(canonicalJson(value));
}

/**
 * 32-bit FNV-1a over the UTF-8 bytes of a string, as eight hex digits.
 * @internal
 */
export function fnv1a(text: string): string {
    let hash = FNV_OFFSET_BASIS;
    for (const byte of new TextEncoder().encode(text)) {
        hash = Math.imul(hash ^ byte, FNV_PRIME) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
}

/**
 * JSON with the keys of every object sorted, so that equal values serialize alike. Leaves out what
 * `JSON.stringify` leaves out, such as functions and undefined values.
 * @internal
 */
export function canonicalJson(value: unknown): string {
    return JSON.stringify(sortKeys(value));
}

//------------------
// Implementation
//------------------
const FNV_OFFSET_BASIS = 0x811c9dc5,
    FNV_PRIME = 0x01000193;

function sortKeys(value: unknown): unknown {
    if (isArray(value)) return value.map(sortKeys);
    if (!isPlainObject(value)) return value;
    const obj = value as PlainObject;
    return Object.fromEntries(
        Object.keys(obj)
            .sort()
            .map(key => [key, sortKeys(obj[key])])
    );
}
