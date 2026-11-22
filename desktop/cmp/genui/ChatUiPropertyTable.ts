import {propertyTable} from '@xh/hoist/cmp/propertytable';
import {dropRight, isEmpty, isInteger} from 'lodash';
import type {ChatUiComponentSpec} from '../../../genui';
import {CHAT_UI_DECIMALS_SCHEMA, CHAT_UI_NUMBER_FORMAT_SCHEMA} from './ChatUiFormat';
import {CHAT_UI_INTENTS} from './impl/ChatUiIntents';
import {takeItems, withMoreNote} from './impl/ChatUiMore';
import {toPropertyTableEntry} from './impl/ChatUiPropertyEntries';
import type {ChatUiIntent, ChatUiNumberFormat, ChatUiSpecOptions} from './Types';
import './ChatUiPropertyTable.scss';

/** One labeled value of a property table component, as written by the model. */
export interface ChatUiPropertyTableEntry {
    /** What the value is, such as `Rating`. */
    label: string;

    /**
     * The value - a number, formatted with `format`, text shown as is, or a boolean, shown as
     * `Yes` or `No`.
     */
    value?: number | string | boolean;

    /** How a numeric value displays. Default `number`. */
    format?: ChatUiNumberFormat;

    /** Decimal places for a numeric value. Default suits the value and the format. */
    decimals?: number;

    /** Color of the value, to flag a status - for example `danger`. Default `none`. */
    intent?: ChatUiIntent;
}

/** Props of a property table component, as written by the model. */
export interface ChatUiPropertyTableSpecProps {
    /** The labeled values, in display order. */
    entries: ChatUiPropertyTableEntry[];

    /** Most columns. Default as many as fit the width. A narrow chat shows fewer. */
    columns?: number;
}

/** Options for {@link chatUiPropertyTableSpec}. */
export interface ChatUiPropertyTableSpecOptions extends ChatUiSpecOptions {
    /** Most labeled values to show. The rest show as a count. Default 24. */
    maxItems?: number;
}

/**
 * A property table component for a {@link ChatUiCatalog}: a list of labeled values, such as the
 * fields of a record. It renders Hoist's `PropertyTable`, and formats each number. A value that is
 * missing or blank shows as `-`. While the props stream, only complete values show.
 *
 * It has no frame, title or actions. Use the card spec for a record with those.
 *
 * It has no tool or tag of its own. The model nests it in a document.
 */
export function chatUiPropertyTableSpec(
    opts: ChatUiPropertyTableSpecOptions = {}
): ChatUiComponentSpec<ChatUiPropertyTableSpecProps> {
    const {name = 'propertyTable', description = DESCRIPTION, maxItems = 24} = opts;

    return {
        name,
        kitComponent: 'propertyTable',
        description,
        props: {
            type: 'object',
            required: ['entries'],
            additionalProperties: false,
            properties: {
                entries: {
                    type: 'array',
                    minItems: 1,
                    description: `At most ${maxItems}.`,
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
        render: ({entries, columns}, {isPartial}) => {
            // While streaming, the last value may be cut short.
            const complete = (isPartial ? dropRight(entries) : (entries ?? [])).flatMap(
                    toPropertyTableEntry
                ),
                {shown, hidden} = takeItems(complete, maxItems);
            if (isEmpty(shown)) return null;
            return withMoreNote(
                propertyTable({
                    className: 'xh-chat-ui-property-table',
                    entries: shown,
                    // Hoist takes the count as the most, and shows fewer in a narrow chat.
                    columns:
                        isInteger(columns) && columns >= 1 ? Math.min(columns, MAX_COLUMNS) : null
                }),
                hidden
            );
        },
        result: ({entries}) => entries.map(it => it.label).join(', '),
        example: {
            entries: [
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

const DESCRIPTION =
    'A list of labeled values, such as the fields of a record. Use it for facts about one ' +
    'thing. Use stat cards for headline figures, and a grid for many records.';
