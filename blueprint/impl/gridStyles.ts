import type {PlainObject} from '@xh/hoist/core';
import {isString} from 'lodash';

// Plain data and pure functions only, so a validator under plain Node can load these.

/** The intents a grid style takes for a color, a background or a border. */
export const STYLE_INTENTS = ['primary', 'success', 'warning', 'danger'];

/** The most rules a column, or a grid's rows, may hold. */
export const MAX_STYLE_RULES = 10;

const HEX = /^#[0-9a-fA-F]{6}$/;

/** True for a value a style's `color` takes, or its `background` where `muted` is false. */
export function isStyleColor(value: unknown, muted = true): boolean {
    return (
        isString(value) &&
        (STYLE_INTENTS.includes(value) || (muted && value === 'muted') || HEX.test(value))
    );
}

/**
 * A grid style as CSS, from a closed set of keys and values. A value outside it adds nothing, so
 * no style can reach free CSS. Intents and `muted` follow the theme, and a border is an inset
 * shadow, which leaves the column's width alone.
 */
export function styleToCss(style: PlainObject): PlainObject {
    const ret: PlainObject = {},
        {color, background, fontWeight, fontStyle, textDecoration, align, border} = style ?? {};
    if (isStyleColor(color)) {
        ret.color = STYLE_INTENTS.includes(color)
            ? `var(--xh-intent-${color}-text-color)`
            : color === 'muted'
              ? 'var(--xh-text-color-muted)'
              : color;
    }
    if (isStyleColor(background, false)) {
        ret.backgroundColor = STYLE_INTENTS.includes(background)
            ? `var(--xh-intent-${background}-trans1)`
            : background;
    }
    if (['bold', 'normal'].includes(fontWeight)) ret.fontWeight = fontWeight;
    if (['italic', 'normal'].includes(fontStyle)) ret.fontStyle = fontStyle;
    if (['underline', 'line-through', 'none'].includes(textDecoration)) {
        ret.textDecoration = textDecoration;
    }
    if (isString(align) && Object.hasOwn(JUSTIFY, align)) {
        ret.textAlign = align;
        ret.justifyContent = JUSTIFY[align];
    }
    if (STYLE_INTENTS.includes(border)) ret.boxShadow = `inset 3px 0 0 var(--xh-intent-${border})`;
    return ret;
}

const JUSTIFY: Record<string, string> = {left: 'flex-start', center: 'center', right: 'flex-end'};
