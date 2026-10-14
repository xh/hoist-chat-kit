import {isString} from 'lodash';

/**
 * The value of an object's own property, or null - never one inherited from `Object.prototype`,
 * such as `constructor`. For lookups by a name that a model or a backend wrote.
 * @internal
 */
export function getOwn<T>(obj: Record<string, T>, key: string): T {
    return obj != null && isString(key) && Object.hasOwn(obj, key) ? obj[key] : null;
}
