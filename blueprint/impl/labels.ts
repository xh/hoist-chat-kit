import type {PlainObject} from '@xh/hoist/core';
import {getOwn} from './pointer';

/**
 * How an edit of a config property names itself for undo, as its editor labels it, such as
 * "posGrid: sort by".
 * @internal
 */
export function configEditLabel(id: string, config: PlainObject, path: string): string {
    const key = path.split('/')[1],
        prop = getOwn<PlainObject>(config?.properties, key);
    return `${id}: ${(prop?.title ?? labelOf(key)).toLowerCase()}`;
}

/**
 * A property's label from its key, as `sortBy` reads "Sort by".
 * @internal
 */
export function labelOf(key: string): string {
    const words = key.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
    return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Names as a list in words: `a`, `a and b`, `a, b and c`. */
export function listOf(names: string[]): string {
    return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0];
}
