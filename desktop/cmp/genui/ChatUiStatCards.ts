import {dropRight, isEmpty, isFinite, isPlainObject} from 'lodash';
import type {ReactNode} from 'react';
import {span} from '@xh/hoist/cmp/layout';
import {statCard, statCardStrip} from '@xh/hoist/cmp/statcard';
import type {ColorSpec} from '@xh/hoist/format';
import type {ChatUiComponentSpec} from '../../../genui';
import {
    CHAT_UI_DECIMALS_SCHEMA,
    fmtChatUiNumber,
    CHAT_UI_NUMBER_FORMAT_SCHEMA
} from './ChatUiFormat';
import {chatUiSkeleton} from './ChatUiFrame';
import type {ChatUiSpecOptions, ChatUiIntent, ChatUiNumberFormat} from './Types';
import '../../../styles/vars.scss';
import './ChatUiStatCards.scss';

/** One figure of a stat cards component, as written by the model. Each shows as a Hoist `StatCard`. */
export interface ChatUiStatCard {
    /** What the value measures, such as `Revenue`. */
    label: string;

    /**
     * The headline value - a number, formatted with `format`, or text shown as is. A large number
     * shows in a compact form, such as `$48.5B`, with the full value in a tooltip.
     */
    value: number | string;

    /** How a numeric value displays. Default `number`. */
    format?: ChatUiNumberFormat;

    /** Decimal places for a numeric value. Default suits the value and the format. */
    decimals?: number;

    /**
     * Change in the value, shown after it with an arrow, in Hoist's positive color when up and
     * its negative color when down - or the reverse with `invert`.
     */
    delta?: number;

    /**
     * How the delta displays. Defaults to `format`, in which case the delta also takes the
     * value's `decimals`.
     */
    deltaFormat?: ChatUiNumberFormat;

    /** What the delta compares against, such as `vs last month`. Shows under the value. */
    deltaLabel?: string;

    /** True for a figure where up is bad, such as a risk measure: a rise shows in red. */
    invert?: boolean;

    /** Color for the card's outline - for example `danger` for a breached limit. Default `none`. */
    intent?: ChatUiIntent;
}

/** Props of a stat cards component, as written by the model. */
export interface ChatUiStatCardsSpecProps {
    /** The figures, in display order. */
    cards: ChatUiStatCard[];
}

/** Options for {@link chatUiStatCardsSpec}. */
export interface ChatUiStatCardsSpecOptions extends ChatUiSpecOptions {
    /** Most figures the model may send. Default 4 - more figures read better as a table. */
    maxItems?: number;
}

/**
 * A stat cards component for a {@link ChatUiCatalog}: a row of key figures, each with a label, a
 * headline value and an optional change. It renders Hoist's `StatCardStrip`, with a `StatCard`
 * per figure. The spec formats each number, and the strip wraps cards to fit the width of the
 * chat. While the props stream, only complete figures show.
 *
 * Only the delta has color, always with an arrow, so that color is never the only signal. Style
 * the cards through Hoist's `--xh-stat-card-*` CSS variables, under `.xh-chat-ui-stat-cards`.
 *
 * The model's tool is `show_stat_cards`. With a `name`, it is `show_<name>`.
 */
export function chatUiStatCardsSpec(
    opts: ChatUiStatCardsSpecOptions = {}
): ChatUiComponentSpec<ChatUiStatCardsSpecProps> {
    const {name = NAME, description = DESCRIPTION, maxItems = 4} = opts;

    return {
        name,
        toolName: name === NAME ? 'show_stat_cards' : null,
        description,
        props: {
            type: 'object',
            required: ['cards'],
            additionalProperties: false,
            properties: {
                cards: {
                    type: 'array',
                    minItems: 1,
                    maxItems,
                    items: {
                        type: 'object',
                        required: ['label', 'value'],
                        additionalProperties: false,
                        properties: {
                            label: {type: 'string', maxLength: 40},
                            value: {
                                type: ['number', 'string'],
                                description:
                                    'A number, or short text shown as is. Send the full number - ' +
                                    'a large value is shown in a compact form, such as $48.5B.'
                            },
                            format: CHAT_UI_NUMBER_FORMAT_SCHEMA,
                            decimals: CHAT_UI_DECIMALS_SCHEMA,
                            delta: {
                                type: 'number',
                                description: 'Change in the value, shown with an up or down arrow.'
                            },
                            deltaFormat: {
                                ...CHAT_UI_NUMBER_FORMAT_SCHEMA,
                                description:
                                    'How to display the delta. Default the format of the value. ' +
                                    '"percent" expects a fraction - 0.012 shows as 1.2%.'
                            },
                            deltaLabel: {
                                type: 'string',
                                maxLength: 40,
                                description: 'What the delta compares against - e.g. "vs Q2".'
                            },
                            invert: {
                                type: 'boolean',
                                description:
                                    'True where up is bad, such as a risk measure, so a rise ' +
                                    'shows in red.'
                            },
                            intent: {
                                enum: ['none', 'primary', 'success', 'warning', 'danger'],
                                description:
                                    'Outline color, to flag a card - e.g. "danger" for a ' +
                                    'breach. Default "none".'
                            }
                        }
                    }
                }
            }
        },
        render: ({cards}, {isPartial}) => {
            // While streaming, the last figure may be cut short - its value still being written.
            const complete = (isPartial ? dropRight(cards) : (cards ?? [])).filter(isPlainObject);
            if (isEmpty(complete)) return isPartial ? chatUiSkeleton(SKELETON_HEIGHT) : null;
            return statCardStrip({
                className: 'xh-chat-ui-stat-cards',
                children: complete.map(toStatCard)
            });
        },
        example: {
            cards: [
                {label: 'Revenue', value: 1250000, format: 'currency', decimals: 0},
                {label: 'Margin', value: 0.184, format: 'percent', delta: 0.012},
                {label: 'Open issues', value: 7, intent: 'warning'}
            ]
        }
    };
}

//------------------
// Implementation
//------------------
const NAME = 'statCards',
    DESCRIPTION =
        'A row of stat cards: key figures, each a label, a headline value and an optional ' +
        'change. Use it for a few headline figures - a summary ahead of the detail, or a ' +
        'dashboard at a glance.';

const SKELETON_HEIGHT = 76;

// For a figure where up is bad: a rise takes Hoist's negative color.
const INVERTED_COLOR_SPEC: ColorSpec = {
    pos: 'xh-neg-val',
    neg: 'xh-pos-val',
    neutral: 'xh-neutral-val'
};

function toStatCard(card: ChatUiStatCard, idx: number): ReactNode {
    const {label, value, format, decimals, delta, deltaLabel, invert, intent} = card,
        deltaFormat = card.deltaFormat ?? format,
        deltaDecimals = deltaFormat === format ? decimals : null;

    return statCard({
        key: idx,
        title: label,
        value: isFinite(value) ? fmtValue(value as number, format, decimals) : String(value),
        subValue: isFinite(delta) ? fmtDelta(delta, deltaFormat, deltaDecimals, invert) : null,
        detail: deltaLabel,
        intent: intent && intent !== 'none' ? intent : null
    });
}

/**
 * The delta in color, with an arrow glyph. A screen reader hears it in words instead, such as
 * "up 1.2%", as the glyph alone does not say which way the value moved.
 */
function fmtDelta(
    delta: number,
    format: ChatUiNumberFormat,
    decimals: number,
    invert: boolean
): ReactNode {
    const shown = fmtChatUiNumber(delta, format, decimals, {
            compact: true,
            withSignGlyph: true,
            colorSpec: invert ? INVERTED_COLOR_SPEC : true
        }),
        size = fmtChatUiNumber(Math.abs(delta), format, decimals, {compact: true, asHtml: true}),
        words = delta > 0 ? `up ${size}` : delta < 0 ? `down ${size}` : 'unchanged';

    return span({
        children: [
            span({key: 'shown', 'aria-hidden': true, children: shown}),
            span({key: 'words', className: 'xh-chat-ui-sr-only', children: words})
        ]
    });
}

/** A value in its compact form, with the full value in a tooltip where the two differ. */
function fmtValue(value: number, format: ChatUiNumberFormat, decimals: number): ReactNode {
    const full = fmtChatUiNumber(value, format, decimals, {asHtml: true}) as string,
        compact = fmtChatUiNumber(value, format, decimals, {compact: true, asHtml: true}) as string;
    return fmtChatUiNumber(value, format, decimals, {
        compact: true,
        tooltip: compact === full ? null : () => full
    });
}
