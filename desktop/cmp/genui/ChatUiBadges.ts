import {dropRight, isEmpty, isPlainObject} from 'lodash';
import {badge} from '@xh/hoist/cmp/badge';
import {hbox} from '@xh/hoist/cmp/layout';
import type {ChatUiComponentSpec} from '../../../genui';
import type {ChatUiIntent, ChatUiSpecOptions} from './Types';
import './ChatUiBadges.scss';

/** One badge of a badges component, as written by the model. It shows as a Hoist `Badge`. */
export interface ChatUiBadge {
    /** The text of the badge - a status, a category or a count, such as `Tier 1`. */
    label: string;

    /** Color of the badge - for example `danger` for a breach. Default `none`, a neutral badge. */
    intent?: ChatUiIntent;
}

/** Props of a badges component, as written by the model. */
export interface ChatUiBadgesSpecProps {
    /** The badges, in display order. */
    badges: ChatUiBadge[];
}

/** Options for {@link chatUiBadgesSpec}. */
export interface ChatUiBadgesSpecOptions extends ChatUiSpecOptions {
    /** Most badges the model may send. Default 12. */
    maxItems?: number;
}

/**
 * A badges component for a {@link ChatUiCatalog}: a row of short labels, such as the statuses
 * and categories of a record. It renders a Hoist `Badge` per label, and wraps the row to fit the
 * width of the chat. While the props stream, only complete badges show.
 *
 * It has no tool or tag of its own. The model nests it in a document.
 */
export function chatUiBadgesSpec(
    opts: ChatUiBadgesSpecOptions = {}
): ChatUiComponentSpec<ChatUiBadgesSpecProps> {
    const {name = 'badges', description = DESCRIPTION, maxItems = 12} = opts;

    return {
        name,
        description,
        props: {
            type: 'object',
            required: ['badges'],
            additionalProperties: false,
            properties: {
                badges: {
                    type: 'array',
                    minItems: 1,
                    maxItems,
                    items: {
                        type: 'object',
                        required: ['label'],
                        additionalProperties: false,
                        properties: {
                            label: {type: 'string', minLength: 1, maxLength: 40},
                            intent: {
                                enum: ['none', 'primary', 'success', 'warning', 'danger'],
                                description:
                                    'Color of the badge - e.g. "danger" for a breach. Default ' +
                                    '"none".'
                            }
                        }
                    }
                }
            }
        },
        standalone: false,
        render: ({badges}, {isPartial}) => {
            // While streaming, the last badge may be cut short - its label still being written.
            const complete = (isPartial ? dropRight(badges) : (badges ?? [])).filter(
                it => isPlainObject(it) && !isEmpty(it.label)
            );
            if (isEmpty(complete)) return null;
            return hbox({
                className: 'xh-chat-ui-badges',
                children: complete.map(({label, intent}, idx) =>
                    badge({
                        key: idx,
                        intent: intent && intent !== 'none' ? intent : null,
                        children: label
                    })
                )
            });
        },
        result: ({badges}) => badges.map(it => it.label).join(', '),
        example: {
            badges: [{label: 'Tier 1', intent: 'success'}, {label: 'USD'}, {label: 'Watchlist'}]
        }
    };
}

//------------------
// Implementation
//------------------
const DESCRIPTION =
    'A row of short labels, such as the statuses, categories or tags of a record. Use it next ' +
    'to a title or over a table, for a few words each. Use stat cards for figures.';
