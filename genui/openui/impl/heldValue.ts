import {isArray, isString} from 'lodash';

/**
 * A value that a `$variable` or a query holds, safe for lang-core to read. lang-core runs an
 * object that has the shape of one of its own: it evaluates the props of an element, and the
 * expression of a node or of a two-way binding. Data must never run as code, so each such object
 * inside the value reads as null. Any other value comes back as it is.
 *
 * The answer for each object is kept, so that a value is checked once however often a program
 * reads it.
 * @internal
 */
export function toSafeValue(value: unknown): unknown {
    return clean(value, 0);
}

//------------------
// Implementation
//------------------
const cleaned = new WeakMap<object, unknown>(),
    ELEMENT_KEYS = ['type', 'typeName', 'props', 'partial'],
    MAX_DEPTH = 200;

function clean(value: unknown, depth: number): unknown {
    if (value == null || typeof value !== 'object') return value;
    if (cleaned.has(value)) return cleaned.get(value);
    if (depth > MAX_DEPTH || posesAsCode(value)) return null;

    let ret: unknown = value;
    if (isArray(value)) {
        const items = value.map(it => clean(it, depth + 1));
        if (items.some((it, idx) => it !== value[idx])) ret = items;
    } else {
        const entries = Object.entries(value).map(([key, it]) => [key, clean(it, depth + 1)]);
        if (entries.some(([key, it]) => it !== (value as Record<string, unknown>)[key as string])) {
            ret = Object.fromEntries(entries);
        }
    }
    cleaned.set(value, ret);
    // The clean copy is itself clean.
    if (ret !== value) cleaned.set(ret as object, ret);
    return ret;
}

// True for an object that lang-core would take for an expression node, an element or a two-way
// binding.
function posesAsCode(value: object): boolean {
    if (isArray(value)) return false;
    return (
        isString((value as {k?: unknown}).k) ||
        '__reactive' in value ||
        ELEMENT_KEYS.every(it => it in value)
    );
}
