import {logWarn} from '@xh/hoist/utils/js';

/**
 * Log a warning once per key. A program parses again with each chunk and render, so a warning
 * about it would otherwise repeat. Holds at most 200 keys, and clears them all when full.
 * @internal
 */
export function warnOnce(key: string, message: unknown, source: string) {
    if (warned.has(key)) return;
    if (warned.size >= MAX_KEYS) warned.clear();
    warned.add(key);
    logWarn(message, source);
}

const warned = new Set<string>(),
    MAX_KEYS = 200;
