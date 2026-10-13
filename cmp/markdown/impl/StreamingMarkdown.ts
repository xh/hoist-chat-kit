import {findLastIndex, last} from 'lodash';

/**
 * Split markdown into top-level blocks, so that a streaming renderer can render each finished
 * block once and re-render only the last one as text arrives.
 *
 * Splits at blank lines, but never inside a code fence, and never where the next block continues
 * the previous one - an indented line, or the next item of a list. Splitting there would change
 * how the text parses, while merging never does.
 *
 * @internal
 */
export function splitMarkdownBlocks(text: string): string[] {
    if (!text) return [];

    const chunks: string[] = [];
    let lines: string[] = [],
        fence: Fence = null;

    const flush = () => {
        if (lines.length) chunks.push(lines.join('\n'));
        lines = [];
    };

    for (const line of text.split('\n')) {
        if (fence) {
            lines.push(line);
            if (closesFence(line, fence)) fence = null;
        } else if (!line.trim()) {
            flush();
        } else {
            lines.push(line);
            fence = parseFenceOpen(line);
        }
    }
    flush();

    return chunks.reduce<string[]>((blocks, chunk) => {
        const prev = last(blocks);
        if (prev != null && continuesBlock(prev, chunk)) {
            blocks[blocks.length - 1] = `${prev}\n\n${chunk}`;
        } else {
            blocks.push(chunk);
        }
        return blocks;
    }, []);
}

/**
 * Close any markdown syntax left open at the end of a streaming block, so that it renders as it
 * will once complete rather than flashing raw markers.
 *
 * Closes an open code fence, inline code, bold, italic, strikethrough and a link with a partial
 * URL. Removes an opening marker with nothing after it yet, and a partial image. Leaves the text
 * inside code untouched.
 *
 * @internal
 */
export function closeMarkdownSyntax(text: string): string {
    if (!text) return text;

    const lines = text.split('\n');
    let fence: Fence = null,
        proseStart = 0,
        offset = 0;

    for (const line of lines) {
        const lineEnd = offset + line.length + 1;
        if (fence) {
            if (closesFence(line, fence)) {
                fence = null;
                proseStart = lineEnd;
            }
        } else {
            fence = parseFenceOpen(line);
        }
        offset = lineEnd;
    }

    if (fence) return text + (text.endsWith('\n') ? '' : '\n') + fence.marker;

    const prose = text.slice(proseStart);
    return text.slice(0, proseStart) + closeInlineSyntax(prose);
}

//------------------
// Implementation
//------------------
interface Fence {
    marker: string;
}

interface Opener {
    token: string;
    index: number;
}

const FENCE_OPEN = /^\s*(`{3,}|~{3,})([^`]*)$/,
    FENCE_CLOSE = /^\s*(`{3,}|~{3,})\s*$/,
    LIST_ITEM = /^\s{0,3}([-*+]|\d{1,9}[.)])\s/,
    WHITESPACE = /\s/;

function parseFenceOpen(line: string): Fence {
    const match = FENCE_OPEN.exec(line);
    return match ? {marker: match[1]} : null;
}

function closesFence(line: string, fence: Fence): boolean {
    const match = FENCE_CLOSE.exec(line);
    if (!match) return false;
    const marker = match[1];
    return marker[0] === fence.marker[0] && marker.length >= fence.marker.length;
}

function continuesBlock(prev: string, next: string): boolean {
    if (/^[ \t]/.test(next)) return true;
    return LIST_ITEM.test(prev) && LIST_ITEM.test(next);
}

function runLength(text: string, start: number, char: string): number {
    let end = start;
    while (text[end] === char) end++;
    return end - start;
}

function emphasisTokens(char: string, run: number): string[] {
    if (char === '~') return run >= 2 ? ['~~'] : [];
    if (run === 1) return ['*'];
    return run === 2 ? ['**'] : ['**', '*'];
}

function closeInlineSyntax(text: string): string {
    const openers: Opener[] = [];
    let code: Opener = null,
        i = 0;

    scan: while (i < text.length) {
        const char = text[i];

        if (char === '`') {
            const run = runLength(text, i, '`');
            if (!code) {
                code = {token: '`'.repeat(run), index: i};
                openers.push(code);
            } else if (run === code.token.length) {
                openers.splice(openers.indexOf(code), 1);
                code = null;
            }
            i += run;
            continue;
        }

        if (code) {
            i++;
            continue;
        }

        switch (char) {
            case '\\':
                i += 2;
                continue;

            case '*':
            case '~': {
                // A marker at the very end may yet open something, so treat it as an opener -
                // with nothing after it, it is then removed rather than shown raw.
                const run = runLength(text, i, char),
                    prev = text[i - 1],
                    next = text[i + run],
                    canOpen = next == null || !WHITESPACE.test(next),
                    canClose = prev != null && !WHITESPACE.test(prev);

                for (const token of emphasisTokens(char, run)) {
                    const openIdx = findLastIndex(openers, {token});
                    if (canClose && openIdx >= 0) {
                        openers.splice(openIdx, 1);
                    } else if (canOpen) {
                        openers.push({token, index: i});
                    }
                }
                i += run;
                continue;
            }

            case '[': {
                const isImage = text[i - 1] === '!';
                openers.push({token: isImage ? '![' : '[', index: isImage ? i - 1 : i});
                i++;
                continue;
            }

            case ']': {
                const openIdx = findLastIndex(openers, it => it.token.endsWith('['));
                if (openIdx < 0 || text[i + 1] !== '(') {
                    if (openIdx >= 0) openers.splice(openIdx, 1);
                    i++;
                    continue;
                }

                // A link or image target: skip past it, or note it as open if it has no end yet.
                const [opener] = openers.splice(openIdx, 1),
                    targetEnd = text.indexOf(')', i + 2);
                if (targetEnd < 0) {
                    openers.push({token: `${opener.token}](`, index: opener.index});
                    break scan;
                }
                i = targetEnd + 1;
                continue;
            }

            default:
                i++;
        }
    }

    let ret = text;
    for (const {token, index} of openers.reverse()) {
        if (token === '[') continue;
        if (token.startsWith('![')) {
            ret = ret.slice(0, index);
        } else if (token === '[](') {
            ret += ')';
        } else if (!ret.slice(index + token.length).trim()) {
            ret = ret.slice(0, index);
        } else {
            ret = (token === code?.token ? ret : ret.trimEnd()) + token;
        }
    }
    return ret;
}
