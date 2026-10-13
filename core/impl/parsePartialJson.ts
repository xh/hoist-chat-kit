/**
 * Parse a JSON document that may be incomplete, such as tool call arguments still streaming in.
 *
 * Complete JSON parses as usual. Incomplete JSON is cut back to its last complete value and closed,
 * so `{"city": "New Yo` gives `{city: 'New Yo'}` and `{"a": 1, "b` gives `{a: 1}`. An unterminated
 * string value is kept, which lets a UI show text arguments as they arrive. Partial keys, numbers
 * and literals are dropped until they complete.
 *
 * @returns the parsed value, or null if no value can be recovered.
 * @internal
 */
export function parsePartialJson(text: string): any {
    if (!text?.trim()) return null;

    try {
        return JSON.parse(text);
    } catch (ignored) {}

    const repaired = repairJson(text);
    if (repaired == null) return null;

    try {
        return JSON.parse(repaired);
    } catch (ignored) {
        return null;
    }
}

//------------------
// Implementation
//------------------
interface Frame {
    closer: '}' | ']';

    /** For objects - true when the next string is a key. */
    expectKey: boolean;
}

/**
 * Close an incomplete document in one pass. Tracks the last point at which the text ends a
 * complete value (or opens a container), and the closers needed at that point.
 */
function repairJson(text: string): string {
    const stack: Frame[] = [],
        len = text.length;
    let safeEnd = 0,
        safeClosers = '',
        i = 0;

    const closers = () =>
            stack
                .map(it => it.closer)
                .reverse()
                .join(''),
        markSafe = (end: number) => {
            safeEnd = end;
            safeClosers = closers();
        },
        top = () => stack[stack.length - 1];

    while (i < len) {
        const ch = text[i];

        if (ch === '{' || ch === '[') {
            stack.push({closer: ch === '{' ? '}' : ']', expectKey: ch === '{'});
            markSafe(++i);
        } else if (ch === '}' || ch === ']') {
            stack.pop();
            markSafe(++i);
        } else if (ch === ',') {
            if (top()?.closer === '}') top().expectKey = true;
            i++;
        } else if (ch === ':') {
            if (top()?.closer === '}') top().expectKey = false;
            i++;
        } else if (ch === '"') {
            const isKey = top()?.closer === '}' && top().expectKey,
                {end, cutAt} = scanString(text, i);

            if (end === -1) {
                // Unterminated - keep a partial value string, but never a partial key.
                if (isKey) break;
                return text.slice(0, cutAt) + '"' + closers();
            }
            i = end;
            if (!isKey) markSafe(i);
        } else if (/\s/.test(ch)) {
            i++;
        } else {
            // Number or literal - runs to the next delimiter.
            let end = i;
            while (end < len && !/[\s,:}\]]/.test(text[end])) end++;
            if (end < len || isJsonScalar(text.slice(i, end))) markSafe(end);
            i = end;
        }
    }

    return safeEnd ? text.slice(0, safeEnd) + safeClosers : null;
}

/**
 * Scan a string starting at the opening quote at `start`.
 * @returns `end` - index after the closing quote, or -1 if unterminated; and `cutAt` - for an
 *      unterminated string, the index to cut at so that no partial escape sequence remains.
 */
function scanString(text: string, start: number): {end: number; cutAt: number} {
    const len = text.length;
    let i = start + 1;
    while (i < len) {
        const ch = text[i];
        if (ch === '"') return {end: i + 1, cutAt: null};
        if (ch === '\\') {
            const escapeLen = text[i + 1] === 'u' ? 6 : 2;
            if (i + escapeLen > len) return {end: -1, cutAt: i};
            i += escapeLen;
        } else {
            i++;
        }
    }
    return {end: -1, cutAt: len};
}

function isJsonScalar(token: string): boolean {
    try {
        JSON.parse(token);
        return true;
    } catch (ignored) {
        return false;
    }
}
