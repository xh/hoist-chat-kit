import {keyValueList, type KeyValueEntry} from '@xh/hoist/cmp/keyvaluelist';
import {dropRight, isBoolean, isEmpty, isFinite, isInteger, isPlainObject, isString} from 'lodash';
import type {ChatUiComponentSpec} from '../../../genui';
import {
    CHAT_UI_DECIMALS_SCHEMA,
    CHAT_UI_NUMBER_FORMAT_SCHEMA,
    fmtChatUiNumber
} from './ChatUiFormat';
import {CHAT_UI_INTENTS, toHoistIntent} from './impl/ChatUiIntents';
import type {ChatUiIntent, ChatUiNumberFormat, ChatUiSpecOptions} from './Types';

/** One labeled value of a key values component, as written by the model. */
export interface ChatUiKeyValue {
    /** What the value is, such as `Rating`. */
    label: string;

    /**
     * The value - a number, formatted with `format`, text shown as is, or a boolean, shown as
     * `true` or `false`.
     */
    value?: number | string | boolean;

    /** How a numeric value displays. Default `number`. */
    format?: ChatUiNumberFormat;

    /** Decimal places for a numeric value. Default suits the value and the format. */
    decimals?: number;

    /** Color of the value, to flag a status - for example `danger`. Default `none`. */
    intent?: ChatUiIntent;
}

/** Props of a key values component, as written by the model. */
export interface ChatUiKeyValuesSpecProps {
    /** The labeled values, in display order. */
    items: ChatUiKeyValue[];

    /**
     * Most columns. Default as many as fit the width. A column is at least 200px wide, so a
     * narrow chat shows fewer.
     */
    columns?: number;
}

/** Options for {@link chatUiKeyValuesSpec}. */
export interface ChatUiKeyValuesSpecOptions extends ChatUiSpecOptions {
    /** Most labeled values the model may send. Default 24. */
    maxItems?: number;
}

/**
 * A key values component for a {@link ChatUiCatalog}: a list of labeled values, such as the
 * fields of a record. It renders Hoist's `KeyValueList`, and formats each number. A value that is
 * missing or blank shows as `-`. While the props stream, only complete values show.
 *
 * It has no frame, title or actions. Use the card spec for a record with those.
 *
 * It has no tool or tag of its own. The model nests it in a document.
 */
export function chatUiKeyValuesSpec(
    opts: ChatUiKeyValuesSpecOptions = {}
): ChatUiComponentSpec<ChatUiKeyValuesSpecProps> {
    const {name = 'keyValues', description = DESCRIPTION, maxItems = 24} = opts;

    return {
        name,
        description,
        props: {
            type: 'object',
            required: ['items'],
            additionalProperties: false,
            properties: {
                items: {
                    type: 'array',
                    minItems: 1,
                    maxItems,
                    items: {
                        type: 'object',
                        required: ['label'],
                        additionalProperties: false,
                        properties: {
                            label: {type: 'string', minLength: 1, maxLength: 40},
                            value: {
                                type: ['number', 'string', 'boolean'],
                                maxLength: 200,
                                description: 'A number, a boolean, or text shown as is.'
                            },
                            format: CHAT_UI_NUMBER_FORMAT_SCHEMA,
                            decimals: CHAT_UI_DECIMALS_SCHEMA,
                            intent: {
                                enum: CHAT_UI_INTENTS,
                                description: 'Color of the value, to flag a status.'
                            }
                        }
                    }
                },
                columns: {
                    type: 'integer',
                    minimum: 1,
                    maximum: MAX_COLUMNS,
                    description: 'Most columns. Default as many as fit.'
                }
            }
        },
        standalone: false,
        render: ({items, columns}, {isPartial}) => {
            // While streaming, the last value may be cut short.
            const entries = (isPartial ? dropRight(items) : (items ?? [])).flatMap(toEntry);
            if (isEmpty(entries)) return null;
            const hasColumns = isInteger(columns) && columns >= 1;
            return keyValueList({
                className: 'xh-chat-ui-key-values',
                entries,
                // The model's count is the most columns. A narrow chat shows fewer.
                columns: hasColumns ? Math.min(columns, MAX_COLUMNS) : null,
                minColumnWidth: hasColumns ? MIN_COLUMN_WIDTH : null
            });
        },
        result: ({items}) => items.map(it => it.label).join(', '),
        example: {
            items: [
                {label: 'Counterparty', value: 'Acme Corp'},
                {label: 'Exposure', value: 4200000, format: 'currency', decimals: 0},
                {label: 'Status', value: 'Under review', intent: 'warning'}
            ]
        }
    };
}

//------------------
// Implementation
//------------------
const MAX_COLUMNS = 4;

// Narrowest column, in pixels, when the model sets a count. Hoist's default of 300 would show one
// column at the width of a typical chat.
const MIN_COLUMN_WIDTH = 200;

const DESCRIPTION =
    'A list of labeled values, such as the fields of a record. Use it for facts about one ' +
    'thing. Use metrics for headline figures, and a grid for many records.';

// An entry of Hoist's `KeyValueList`, or none for a value that is not a labeled value. Hoist
// renders each string as text.
function toEntry(item: unknown): KeyValueEntry[] {
    if (!isPlainObject(item)) return [];
    const {label, value, format, decimals, intent} = item as ChatUiKeyValue;
    if (!isString(label) || isEmpty(label)) return [];
    return [
        {
            label,
            value: isFinite(value)
                ? fmtChatUiNumber(value as number, format, decimals)
                : isString(value) || isBoolean(value)
                  ? value
                  : null,
            intent: toHoistIntent(intent)
        }
    ];
}
