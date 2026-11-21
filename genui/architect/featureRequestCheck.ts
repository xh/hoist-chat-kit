/**
 * The checks on a feature request the Architect writes, with no imports, so that the Node harness
 * that tests the Architect applies the same rules. See `requestFeatureTool()`.
 * @internal
 */

/** What a capability the user asked for is: the kind of registry entry, or data, or other. */
export const FEATURE_REQUEST_CATEGORIES = [
    'widget',
    'renderer',
    'variableType',
    'resolver',
    'action',
    'format',
    'data',
    'other'
] as const;

export const MAX_SUMMARY_LENGTH = 120,
    MAX_USER_WORDS_LENGTH = 1000,
    MAX_WORKAROUND_LENGTH = 500,
    MAX_FRAGMENT_LENGTH = 5000;

const FIELDS = ['summary', 'category', 'userWords', 'workaround', 'fragment'];

// Keys that would carry data or reach a stored artifact, which a request never sends.
const DATA_KEYS = ['inline', 'artifact', 'rows'];

/**
 * Why a request cannot be sent, or null if it can: its shape and limits, a fragment free of data,
 * and `userWords` that appear word for word, apart from whitespace, in one of `userMessages`.
 * Without `userMessages`, the quote is not checked.
 */
export function checkFeatureRequest(input: any, userMessages?: string[]): string | null {
    if (!input || typeof input !== 'object' || Array.isArray(input))
        return 'Send a request object.';
    const extra = Object.keys(input).find(it => !FIELDS.includes(it));
    if (extra) return `'${extra}' is not a field of a request. Send only ${FIELDS.join(', ')}.`;

    const {summary, category, userWords, workaround, fragment} = input;
    if (!isText(summary, MAX_SUMMARY_LENGTH)) {
        return `summary is one line of at most ${MAX_SUMMARY_LENGTH} characters.`;
    }
    if (!(FEATURE_REQUEST_CATEGORIES as readonly string[]).includes(category)) {
        return `category is one of ${FEATURE_REQUEST_CATEGORIES.join(', ')}.`;
    }
    if (!isText(userWords, MAX_USER_WORDS_LENGTH)) {
        return `userWords is the user's own words, at most ${MAX_USER_WORDS_LENGTH} characters.`;
    }
    if (workaround != null && !isText(workaround, MAX_WORKAROUND_LENGTH)) {
        return `workaround is at most ${MAX_WORKAROUND_LENGTH} characters, or null.`;
    }
    if (fragment != null) {
        if (typeof fragment !== 'object' || Array.isArray(fragment)) {
            return 'fragment is one element or config object.';
        }
        if (JSON.stringify(fragment).length > MAX_FRAGMENT_LENGTH) {
            return `fragment is at most ${MAX_FRAGMENT_LENGTH} characters of JSON.`;
        }
        const dataKey = findKey(fragment, DATA_KEYS);
        if (dataKey) return `fragment holds '${dataKey}', and a request never sends data.`;
    }
    if (userMessages && !userMessages.some(it => squash(it).includes(squash(userWords)))) {
        return "userWords must copy the user's words word for word from one of their messages.";
    }
    return null;
}

function isText(value: unknown, max: number): boolean {
    return typeof value === 'string' && value.trim().length > 0 && value.length <= max;
}

function squash(text: string): string {
    return text.replace(/\s+/g, ' ').trim();
}

function findKey(value: unknown, keys: string[]): string | null {
    if (!value || typeof value !== 'object') return null;
    for (const [key, it] of Object.entries(value)) {
        if (keys.includes(key)) return key;
        const found = findKey(it, keys);
        if (found) return found;
    }
    return null;
}
