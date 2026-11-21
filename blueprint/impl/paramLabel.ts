import type {PlainObject} from '@xh/hoist/core';
import {isPlainObject, isString} from 'lodash';

// Plain data and pure functions only, so a validator under plain Node can load these.

/**
 * A format's label chosen by a dataset param, as `{"param": "units", "values": {"metric": " m/s"}}`,
 * or null for a plain label. The source applies it from its resolved params.
 */
export function paramLabel(label: unknown): {param: string; values: Record<string, unknown>} {
    return isPlainObject(label) && isString((label as PlainObject).param)
        ? (label as {param: string; values: Record<string, unknown>})
        : null;
}
