import {compact, isPlainObject, keys, pickBy} from 'lodash';

type ClassValue = string | Record<string, unknown> | null | undefined | false;

/**
 * Join CSS class names, as the `classnames` package that Hoist uses does: strings as given, and
 * the keys of an object whose values are truthy. Falsy values are skipped. The kit does not take
 * `classnames` as a dependency for this one function.
 * @internal
 */
export function classNames(...values: ClassValue[]): string {
    return compact(
        values.flatMap(it => (isPlainObject(it) ? keys(pickBy(it as object)) : it))
    ).join(' ');
}
