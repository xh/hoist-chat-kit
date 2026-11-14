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
 * The key of a context entry for a tooltip. A plain name shows as it is. Any other key shows as
 * a JSON string, so that it cannot pose as a key and a value.
 * @internal
 */
export function keyForDisplay(key: string): string {
    return PLAIN_KEY_RE.test(key) ? key : quoteForDisplay(key);
}

/**
 * True for text with a run of spaces, tabs or line breaks, which can push the text after it out
 * of a tooltip. Any string inside a list or an object counts, and each key of an object.
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
// Control characters, format characters, every character that draws as nothing, separators
// other than the plain space, and the Braille blank.
const INVISIBLE_RE =
        /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000\u2800]/gu,
    // Three spaces or tabs in a row, or five of any whitespace. A line break shows as an
    // escape, so a few in a row still read.
    WHITESPACE_RUN_RE = /[ \t]{3,}|\s{5,}/u,
    PLAIN_KEY_RE = /^[A-Za-z_][\w.-]*$/;

function toEscape(char: string): string {
    const code = char.codePointAt(0);
    return code > 0xffff ? `\\u{${code.toString(16)}}` : `\\u${code.toString(16).padStart(4, '0')}`;
}
