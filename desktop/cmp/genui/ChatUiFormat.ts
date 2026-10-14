import {find} from 'lodash';
import type {ReactNode} from 'react';
import {fmtNumber, fmtPercent, type NumberFormatOptions, type Precision} from '@xh/hoist/format';
import type {ChatUiNumberFormat} from './Types';

/**
 * JSON Schema for a {@link ChatUiNumberFormat}, for the props schema of a catalog component. Use
 * it in your own components, so that the model formats numbers the same way in all of them.
 */
export const CHAT_UI_NUMBER_FORMAT_SCHEMA = {
    enum: ['number', 'percent', 'currency', 'none'],
    description:
        'How to display the number. "percent" expects a fraction - 0.125 shows as 12.5%. ' +
        '"none" shows the number as is, for years and ids. Default "number".'
};

/** JSON Schema for the decimal places of a number, for the props schema of a catalog component. */
export const CHAT_UI_DECIMALS_SCHEMA = {
    type: 'integer',
    minimum: 0,
    maximum: 6,
    description: 'Decimal places to show. Default suits the value and the format.'
};

/** Options for {@link fmtChatUiNumber}, on top of Hoist's number format options. */
export interface ChatUiNumberFormatOptions extends NumberFormatOptions {
    /**
     * True to show a large `number` or `currency` value in a compact form, scaled to thousands,
     * millions, billions or trillions with a `K`, `M`, `B` or `T` suffix - `$48.5B` rather than
     * `$48,500,000,000`. Applies from 100,000 up, and to three significant digits, in place of
     * `decimals`. Default false.
     */
    compact?: boolean;
}

/**
 * Hoist number format options for a {@link ChatUiNumberFormat} - for example to format a column
 * of an app grid to match the chat's components.
 *
 * @param format - the format, default `number`.
 * @param decimals - decimal places to show, or null for the format's default.
 */
export function getNumberFormatOptions(
    format: ChatUiNumberFormat = 'number',
    decimals: number = null
): NumberFormatOptions {
    const precision = (fixed: Precision) => (decimals ?? fixed) as Precision;
    switch (format) {
        case 'percent':
            return {precision: precision(1)};
        case 'currency':
            return {prefix: '$', precision: precision(2)};
        case 'none':
            return {precision: precision(null), withCommas: false};
        default:
            return {precision: precision('auto')};
    }
}

/**
 * Format a number with a {@link ChatUiNumberFormat}, using Hoist's number formatters.
 *
 * @param value - the number to format. Null and non-numbers format as an empty string.
 * @param format - the format, default `number`.
 * @param decimals - decimal places to show, or null for the format's default.
 * @param opts - extra format options, such as `compact`, `colorSpec` or `asHtml`.
 */
export function fmtChatUiNumber(
    value: number,
    format: ChatUiNumberFormat = 'number',
    decimals: number = null,
    opts: ChatUiNumberFormatOptions = {}
): ReactNode {
    const {compact, ...hoistOpts} = opts,
        unit = compact ? getCompactUnit(value, format) : null;

    if (unit) {
        const scaled = value / unit.size,
            absScaled = Math.abs(scaled);
        return fmtNumber(scaled, {
            ...getNumberFormatOptions(format),
            precision: absScaled < 10 ? 2 : absScaled < 100 ? 1 : 0,
            zeroPad: false,
            label: unit.label,
            labelCls: null,
            ...hoistOpts
        });
    }

    const options = {...getNumberFormatOptions(format, decimals), ...hoistOpts};
    return format === 'percent' ? fmtPercent(value, options) : fmtNumber(value, options);
}

//------------------
// Implementation
//------------------
const COMPACT_MIN = 100_000;

const COMPACT_UNITS = [
    {size: 1e12, label: 'T'},
    {size: 1e9, label: 'B'},
    {size: 1e6, label: 'M'},
    {size: 1e3, label: 'K'}
];

function getCompactUnit(value: number, format: ChatUiNumberFormat) {
    if (!Number.isFinite(value) || (format !== 'number' && format !== 'currency')) return null;
    const absValue = Math.abs(value);
    // A value that would round up to 1000 of one unit takes the next - `1M`, not `1,000K`.
    return absValue < COMPACT_MIN ? null : find(COMPACT_UNITS, it => absValue >= it.size * 0.9995);
}
