import type {PropertyTableEntry} from '@xh/hoist/cmp/propertytable';
import {isBoolean, isEmpty, isFinite, isPlainObject, isString} from 'lodash';
import {fmtChatUiNumber} from '../ChatUiFormat';
import type {ChatUiIntent, ChatUiNumberFormat} from '../Types';
import {toHoistIntent} from './ChatUiIntents';

/**
 * An entry of Hoist's `PropertyTable` for a labeled value the model wrote, or none for an item
 * that is not one. A number takes its `format` and `decimals`. Hoist renders each string as text,
 * a null value as `-`, and a boolean as nothing, so a boolean passes as `Yes` or `No`, as Hoist
 * advises, and blank text as null. Use it with `flatMap()`.
 * @internal
 */
export function toPropertyTableEntry(item: unknown): PropertyTableEntry[] {
    if (!isPlainObject(item)) return [];
    const {label, value, format, decimals, intent} = item as ChatUiLabeledValue;
    if (!isString(label) || isEmpty(label)) return [];
    return [
        {
            label,
            value: isFinite(value)
                ? fmtChatUiNumber(value as number, format, decimals)
                : isBoolean(value)
                  ? value
                      ? 'Yes'
                      : 'No'
                  : isString(value) && value.trim()
                    ? value
                    : null,
            intent: toHoistIntent(intent)
        }
    ];
}

//------------------
// Implementation
//------------------
interface ChatUiLabeledValue {
    label?: unknown;
    value?: unknown;
    format?: ChatUiNumberFormat;
    decimals?: number;
    intent?: ChatUiIntent;
}
