import {isString} from 'lodash';

/**
 * Generate a version 4 UUID for a thread, run, message or part. Ids travel to a backend and into
 * stored history, so they must be unique across sessions, which Hoist's run-local `XH.genId()` is
 * not. Browsers offer `crypto.randomUUID()` only over HTTPS and on localhost. Over plain HTTP, the
 * same format comes from `crypto.getRandomValues()`, which works in any context.
 *
 * TODO: call `genUuid()` from `@xh/hoist/utils/js` once hoist-react ships it.
 * @internal
 */
export function genChatId(): string {
    return crypto.randomUUID?.() ?? genUuidFromRandomValues();
}

/**
 * The value of an object's own property, or null - never one inherited from `Object.prototype`,
 * such as `constructor`. For lookups by a name that a model or a backend wrote.
 *
 * TODO: call `getOwn()` from `@xh/hoist/utils/js` once hoist-react ships it.
 * @internal
 */
export function getOwn<T>(obj: Record<string, T>, key: string): T {
    return obj != null && isString(key) && Object.hasOwn(obj, key) ? obj[key] : null;
}

//------------------
// Implementation
//------------------
function genUuidFromRandomValues(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40; // Version 4.
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // The RFC 9562 variant.
    const hex = Array.from(bytes, it => it.toString(16).padStart(2, '0')).join('');
    return [
        hex.slice(0, 8),
        hex.slice(8, 12),
        hex.slice(12, 16),
        hex.slice(16, 20),
        hex.slice(20)
    ].join('-');
}
