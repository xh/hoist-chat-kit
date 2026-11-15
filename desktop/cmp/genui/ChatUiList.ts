import {itemList, type ItemListEntry} from '@xh/hoist/cmp/itemlist';
import {dropRight, isEmpty, isPlainObject, isString} from 'lodash';
import type {ChatUiComponentSpec} from '../../../genui';
import {takeItems, withMoreNote} from './impl/ChatUiMore';
import {CHAT_UI_INTENTS, toHoistIntent} from './impl/ChatUiIntents';
import type {ChatUiIntent, ChatUiSpecOptions} from './Types';

/** One entry of a list component, as written by the model. */
export interface ChatUiListItem {
    /** Main text of the entry. */
    title: string;

    /** Longer text under the title, such as what an alert is about. */
    description?: string;

    /** Short text at the far end of the title's line, such as a figure or a date. */
    detail?: string;

    /** Flags the entry with a color - for example `danger` for a failure. Default `none`. */
    intent?: ChatUiIntent;
}

/** Props of a list component, as written by the model. */
export interface ChatUiListSpecProps {
    /** The entries, in display order. */
    items: ChatUiListItem[];

    /** True to number the entries, for a ranking or a sequence. Default false. */
    ordered?: boolean;
}

/** Options for {@link chatUiListSpec}. */
export interface ChatUiListSpecOptions extends ChatUiSpecOptions {
    /** Most entries to show. The rest show as a count. Default 12. */
    maxItems?: number;
}

/**
 * A list component for a {@link ChatUiCatalog}: a short list of entries, each a title with an
 * optional description and detail, such as alerts, recent activity or search results. It renders
 * Hoist's `ItemList`, with a rule between entries. The model writes no icon, and an entry takes
 * no click. While the props stream, only complete entries show.
 *
 * It has no tool or tag of its own. The model nests it in a document.
 */
export function chatUiListSpec(
    opts: ChatUiListSpecOptions = {}
): ChatUiComponentSpec<ChatUiListSpecProps> {
    const {name = 'list', description = DESCRIPTION, maxItems = 12} = opts;

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
                    description: `At most ${maxItems}.`,
                    items: {
                        type: 'object',
                        required: ['title'],
                        additionalProperties: false,
                        properties: {
                            title: {type: 'string', minLength: 1, maxLength: 120},
                            description: {
                                type: 'string',
                                maxLength: 300,
                                description: 'Longer text under the title.'
                            },
                            detail: {
                                type: 'string',
                                maxLength: 40,
                                description: 'Short text at the end of the line, such as a date.'
                            },
                            intent: {
                                enum: CHAT_UI_INTENTS,
                                description: 'Flags the entry with a color. Default "none".'
                            }
                        }
                    }
                },
                ordered: {type: 'boolean', description: 'True to number the entries.'}
            }
        },
        standalone: false,
        render: ({items, ordered}, {isPartial}) => {
            // While streaming, the last entry may be cut short - its title still being written.
            const complete = (isPartial ? dropRight(items) : (items ?? [])).flatMap(toEntry),
                {shown, hidden} = takeItems(complete, maxItems);
            if (isEmpty(shown)) return null;
            return withMoreNote(
                itemList({
                    className: 'xh-chat-ui-list',
                    entries: shown,
                    ordered: ordered === true,
                    dividers: true
                }),
                hidden
            );
        },
        result: ({items}) => items.map(it => it.title).join(', '),
        example: {
            items: [
                {title: 'Limit breach on Rates', detail: '09:42', intent: 'danger'},
                {title: 'Margin call settled', description: 'Paid in full by Acme Corp.'}
            ]
        }
    };
}

//------------------
// Implementation
//------------------
const DESCRIPTION =
    'A short list of entries, each a title with an optional description and detail. Use it ' +
    'for alerts, events or results. Use a grid for records with several columns.';

// An entry of Hoist's `ItemList`, or none for a value that is not an entry. Hoist renders each
// string as text.
function toEntry(item: unknown): ItemListEntry[] {
    if (!isPlainObject(item)) return [];
    const {title, description, detail, intent} = item as ChatUiListItem;
    if (!isString(title) || isEmpty(title.trim())) return [];
    return [
        {
            title,
            description: isString(description) && description.trim() ? description : null,
            detail: isString(detail) && detail.trim() ? detail : null,
            intent: toHoistIntent(intent)
        }
    ];
}
