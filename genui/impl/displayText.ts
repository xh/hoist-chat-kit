import {isString} from 'lodash';

/**
 * Text for a tooltip, with every character the user could not see written as an escape, such as
 * `\u202e`. A model writes the text of an action, and a tooltip must show all of it. A control
 * character, a format character such as a right-to-left override or a zero-width space, a blank
 * letter, and any space but the plain one can hide or reorder what follows. Each shows as its
 * code instead.
 * @internal
 */
export function escapeInvisible(text: string): string {
    return text.replace(INVISIBLE_RE, toEscape);
}

/**
 * A value for a tooltip, as JSON: a string in quotes, with its quotes and line breaks as
 * escapes, and with every character the user could not see as an escape too - see
 * {@link escapeInvisible}. So text cannot pose as the words around it.
 * @internal
 */
export function quoteForDisplay(value: unknown): string {
    return escapeInvisible(JSON.stringify(value) ?? 'null');
}

/**
 * True for text with a long run of spaces, tabs or line breaks, which can push the text after it
 * out of a tooltip. Any string inside a list or an object counts.
 * @internal
 */
export function hasWhitespaceRun(value: unknown): boolean {
    if (isString(value)) return WHITESPACE_RUN_RE.test(value);
    if (value == null || typeof value !== 'object') return false;
    return Object.entries(value).some(([key, it]) => hasWhitespaceRun(key) || hasWhitespaceRun(it));
}

//------------------
// Implementation
//------------------
// Control characters, format characters, separators other than the plain space, and the letters
// that draw as a blank: the Hangul fillers and the Braille blank.
const INVISIBLE_RE =
        /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000\u115F\u1160\u2800\u3164\uFFA0]/gu,
    WHITESPACE_RUN_RE = /\s{5,}/u;

function toEscape(char: string): string {
    const code = char.codePointAt(0);
    return code > 0xffff ? `\\u{${code.toString(16)}}` : `\\u${code.toString(16).padStart(4, '0')}`;
}
