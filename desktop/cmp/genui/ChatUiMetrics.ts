import {dropRight, isFinite, isPlainObject} from 'lodash';
import type {ReactNode} from 'react';
import {div} from '@xh/hoist/cmp/layout';
import {hoistCmp, type HoistProps} from '@xh/hoist/core';
import type {ChatUiComponentSpec} from '../../../genui';
import {classNames} from '../../../impl/ClassNames';
import {
    CHAT_UI_DECIMALS_SCHEMA,
    fmtChatUiNumber,
    CHAT_UI_NUMBER_FORMAT_SCHEMA
} from './ChatUiFormat';
import {chatUiSkeleton} from './ChatUiFrame';
import type {ChatUiSpecOptions, ChatUiIntent, ChatUiNumberFormat} from './Types';
import '../../../styles/vars.scss';
import './ChatUiMetrics.scss';

/** One KPI tile of a {@link ChatUiMetrics}, as written by the model. */
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

    /** Change in the value, shown under it with an arrow, green when up and red when down. */
    delta?: number;

    /**
     * How the delta displays. Defaults to `format`, in which case the delta also takes the
     * value's `decimals`.
     */
    deltaFormat?: ChatUiNumberFormat;

    /** What the delta compares against, such as `vs last month`. */
    deltaLabel?: string;

    /** Color for the tile's accent - for example `danger` for a breached limit. Default `none`. */
    intent?: ChatUiIntent;
}

/** Props of a {@link ChatUiMetrics}, as written by the model. */
export interface ChatUiMetricsSpecProps {
    /** The tiles, in display order. */
    metrics: ChatUiMetric[];
}

/** Options for {@link chatUiMetricsSpec}. */
export interface ChatUiMetricsSpecOptions extends ChatUiSpecOptions {
    /** Most tiles the model may send. Default 8. */
    maxItems?: number;
}

/**
 * A metrics component for a {@link ChatUiCatalog}: a row of KPI tiles, each with a label, a
 * headline value and an optional change. Tiles wrap to fit the width of the chat.
 *
 * The model's tool is `show_metrics`, unless renamed with `name`.
 */
export function chatUiMetricsSpec(
    opts: ChatUiMetricsSpecOptions = {}
): ChatUiComponentSpec<ChatUiMetricsSpecProps> {
    const {name = 'metrics', description = DESCRIPTION, maxItems = 8} = opts;

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
                            intent: {
                                enum: ['none', 'primary', 'success', 'warning', 'danger'],
                                description:
                                    'Accent color, to flag a tile - e.g. "danger" for a breach. ' +
                                    'Default "none".'
                            }
                        }
                    }
                }
            }
        },
        render: ({metrics}, {isPartial}) => chatUiMetrics({metrics, isPartial}),
        example: {
            metrics: [
                {label: 'Revenue', value: 1250000, format: 'currency', decimals: 0},
                {label: 'Margin', value: 0.184, format: 'percent', delta: 0.012},
                {label: 'Open issues', value: 7, intent: 'warning'}
            ]
        }
    };
}

/** Props for {@link ChatUiMetrics}. */
export interface ChatUiMetricsProps extends HoistProps {
    /** The tiles, in display order. */
    metrics?: ChatUiMetric[];

    /** True while the props stream - only complete tiles show. */
    isPartial?: boolean;
}

/**
 * A responsive row of KPI tiles - the component that {@link chatUiMetricsSpec} renders. Tiles wrap
 * to fit the width, and a number is never cut short: a large value shows in a compact form, such
 * as `$48.5B`, with the full value in a tooltip.
 */
export const [ChatUiMetrics, chatUiMetrics] = hoistCmp.withFactory<ChatUiMetricsProps>({
    displayName: 'ChatUiMetrics',
    model: false,
    className: 'xh-chat-ui-metrics',

    render({className, metrics, isPartial}) {
        // While streaming, the last tile may be cut short - its value still being written.
        const tiles = (isPartial ? dropRight(metrics) : (metrics ?? [])).filter(isPlainObject);
        if (!tiles.length) return isPartial ? chatUiSkeleton(SKELETON_HEIGHT) : null;

        return div({
            className,
            items: tiles.map((it, idx) => metricTile(it, idx))
        });
    }
});

//------------------
// Implementation
//------------------
const DESCRIPTION =
    'A row of KPI tiles, each a label, a headline value and an optional change. Use it for a ' +
    'few headline figures - a summary ahead of the detail, or a dashboard at a glance.';

const SKELETON_HEIGHT = 76;

function metricTile(metric: ChatUiMetric, idx: number): ReactNode {
    const {label, value, format, decimals, delta, deltaLabel} = metric,
        deltaFormat = metric.deltaFormat ?? format,
        isNumeric = isFinite(value);

    return div({
        key: idx,
        className: classNames(
            'xh-chat-ui-metrics__tile',
            `xh-chat-ui-metrics__tile--${metric.intent ?? 'none'}`
        ),
        items: [
            div({className: 'xh-chat-ui-metrics__label', title: label, item: label}),
            div({
                className: classNames('xh-chat-ui-metrics__value', {
                    'xh-chat-ui-metrics__value--text': !isNumeric
                }),
                title: isNumeric
                    ? (fmtChatUiNumber(value as number, format, decimals, {asHtml: true}) as string)
                    : null,
                item: isNumeric
                    ? fmtChatUiNumber(value as number, format, decimals, {compact: true})
                    : value
            }),
            isFinite(delta)
                ? div({
                      className: 'xh-chat-ui-metrics__delta',
                      items: [
                          fmtChatUiNumber(
                              delta,
                              deltaFormat,
                              deltaFormat === format ? decimals : null,
                              {compact: true, colorSpec: true, withSignGlyph: true}
                          ),
                          deltaLabel
                              ? div({
                                    className: 'xh-chat-ui-metrics__delta-label',
                                    item: deltaLabel
                                })
                              : null
                      ]
                  })
                : null
        ]
    });
}
