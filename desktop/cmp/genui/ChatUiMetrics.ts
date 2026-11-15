import {dropRight, first, isArray, isEmpty, isFinite, isPlainObject, last} from 'lodash';
import type {ReactNode} from 'react';
import {span} from '@xh/hoist/cmp/layout';
import {sparkline} from '@xh/hoist/cmp/sparkline';
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
import './ChatUiMetrics.scss';

/** One figure of a metrics component, as written by the model. Each shows as a Hoist `StatCard`. */
export interface ChatUiMetric {
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

    /** True for a metric where up is bad, such as a risk measure: a rise shows in red. */
    invert?: boolean;

    /** Color for the card's outline - for example `danger` for a breached limit. Default `none`. */
    intent?: ChatUiIntent;

    /**
     * Past values of this same metric, oldest first, from tool data. They show under the value as a
     * small line, a Hoist `Sparkline`, after the `deltaLabel`. A trend needs at least two numbers.
     * The prompt tells the model to leave it out when no tool gives that history.
     */
    trend?: number[];
}

/** Props of a metrics component, as written by the model. */
export interface ChatUiMetricsSpecProps {
    /** The figures, in display order. */
    metrics: ChatUiMetric[];
}

/** Options for {@link chatUiMetricsSpec}. */
export interface ChatUiMetricsSpecOptions extends ChatUiSpecOptions {
    /** Most figures the model may send. Default 4 - more metrics read better as a table. */
    maxItems?: number;

    /** Most values in the trend of a figure. Default 60. */
    maxTrendPoints?: number;
}

/**
 * A metrics component for a {@link ChatUiCatalog}: a row of key figures, each with a label, a
 * headline value and an optional change. It renders Hoist's `StatCardStrip`, with a `StatCard`
 * per figure. The spec formats each number, and the strip wraps cards to fit the width of the
 * chat. A figure with a `trend` draws it as a Hoist `Sparkline` under the value. While the props
 * stream, only complete figures show.
 *
 * Only the delta has color, always with an arrow, so that color is never the only signal. Style
 * the cards through Hoist's `--xh-stat-card-*` CSS variables, under `.xh-chat-ui-metrics`.
 *
 * The model's tool is `show_metrics`, unless renamed with `name`.
 */
export function chatUiMetricsSpec(
    opts: ChatUiMetricsSpecOptions = {}
): ChatUiComponentSpec<ChatUiMetricsSpecProps> {
    const {name = 'metrics', description = DESCRIPTION, maxItems = 4, maxTrendPoints = 60} = opts;

    return {
        name,
        description,
        props: {
            type: 'object',
            required: ['metrics'],
            additionalProperties: false,
            properties: {
                metrics: {
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
                                    'Outline color, to flag a tile - e.g. "danger" for a ' +
                                    'breach. Default "none".'
                            },
                            trend: {
                                type: 'array',
                                maxItems: maxTrendPoints,
                                items: {type: 'number'},
                                description:
                                    'Past values of this same figure, oldest first, from tool ' +
                                    'data. Leave it out when no tool gives that history.'
                            }
                        }
                    }
                }
            }
        },
        render: ({metrics}, {isPartial}) => {
            // While streaming, the last figure may be cut short - its value still being written.
            const complete = (isPartial ? dropRight(metrics) : (metrics ?? [])).filter(
                isPlainObject
            );
            if (isEmpty(complete)) return isPartial ? chatUiSkeleton(SKELETON_HEIGHT) : null;
            return statCardStrip({
                className: 'xh-chat-ui-metrics',
                items: complete.map(toStatCard)
            });
        },
        example: {
            metrics: [
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
const DESCRIPTION =
    'A row of KPI tiles, each a label, a headline value and an optional change. Use it for a ' +
    'few headline figures - a summary ahead of the detail, or a dashboard at a glance.';

const SKELETON_HEIGHT = 76;

// A line needs two points.
const MIN_TREND_POINTS = 2;

// For a metric where up is bad: a rise takes Hoist's negative color.
const INVERTED_COLOR_SPEC: ColorSpec = {
    pos: 'xh-neg-val',
    neg: 'xh-pos-val',
    neutral: 'xh-neutral-val'
};

function toStatCard(metric: ChatUiMetric, idx: number): ReactNode {
    const {label, value, format, decimals, delta, invert, intent} = metric,
        deltaFormat = metric.deltaFormat ?? format,
        deltaDecimals = deltaFormat === format ? decimals : null;

    return statCard({
        key: idx,
        title: label,
        value: isFinite(value) ? fmtValue(value as number, format, decimals) : String(value),
        subValue: isFinite(delta)
            ? fmtChatUiNumber(delta, deltaFormat, deltaDecimals, {
                  compact: true,
                  withSignGlyph: true,
                  colorSpec: invert ? INVERTED_COLOR_SPEC : true
              })
            : null,
        detail: toDetail(metric),
        intent: intent && intent !== 'none' ? intent : null
    });
}

// The line under the value: the label of the delta, then the trend in the rest of the line. The
// trend has no color of its own, as only the delta has.
function toDetail({label, deltaLabel, trend, format, decimals}: ChatUiMetric): ReactNode {
    const values = isArray(trend) ? trend.filter(isFinite) : [];
    if (values.length < MIN_TREND_POINTS) return deltaLabel;

    const fmt = (it: number) => fmtChatUiNumber(it, format, decimals, {compact: true});
    return span({
        className: 'xh-chat-ui-metrics__trend',
        items: [
            span({omit: !deltaLabel, item: deltaLabel}),
            sparkline({
                values,
                flex: 1,
                minWidth: 0,
                showLast: true,
                domAttrs: {
                    'aria-label': `${label} trend: ${values.length} values, from ${fmt(first(values))} to ${fmt(last(values))}`
                }
            })
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
