import type {PlainObject} from '@xh/hoist/core';
import {castArray, isEmpty} from 'lodash';
import type {ChatUiComponentSpec} from '../ChatUiComponentSpec';
import type {ChatUiTextSegment} from '../ChatUiTextSegment';
import {getOwn} from '../../impl/objects';
import {formatError} from '../../impl/validateSchema';

/** What {@link parseTags} needs from its catalog. */
export interface ParseTagsContext {
    prefix: string;
    isStreaming: boolean;
    getComponent: (name: string) => ChatUiComponentSpec;
    validate: (name: string, props: PlainObject) => string[];
}

/**
 * Split text into markdown and component tag segments. A tag is self-closing -
 * `<ui-NAME attr="value" attr='[json]'/>` - outside fenced and inline code, and not escaped with a
 * backslash. An open tag closed at once, as `<ui-NAME ...></ui-NAME>`, is accepted too.
 *
 * The markup is untrusted. The scan tracks quotes only to find where each tag ends. Attributes
 * are read by the browser's XML parser, from a copy with the special characters in quoted values
 * escaped - never by a regular expression over the raw markup.
 *
 * @internal
 */
export function parseTags(text: string, ctx: ParseTagsContext): ChatUiTextSegment[] {
    const {prefix, isStreaming} = ctx,
        opener = `<${prefix}`;
    // Text with no tag in it, as most is, needs no scan for code - unless it streams, and may
    // end in a tag opening still being written.
    if (
        !text?.includes(opener) &&
        !(isStreaming && text?.includes('<', text.length - opener.length))
    ) {
        return text ? [{type: 'markdown', text}] : [];
    }

    const codeRanges = findCodeRanges(text ?? '', isStreaming),
        segments: ChatUiTextSegment[] = [];

    let pos = 0,
        markdownStart = 0;
    const pushMarkdown = (end: number) => {
        if (end <= markdownStart) return;
        segments.push({type: 'markdown', text: text.slice(markdownStart, end)});
    };

    while (text) {
        const start = text.indexOf(opener, pos);
        if (start < 0) break;

        const codeRange = codeRanges.find(([from, to]) => start >= from && start < to);
        if (codeRange) {
            pos = codeRange[1];
            continue;
        }

        const nameStart = start + opener.length,
            nameEnd = scanName(text, nameStart),
            name = text.slice(nameStart, nameEnd),
            nextChar = text[nameEnd];
        if (
            !name ||
            (nextChar != null && !TAG_NAME_END_RE.test(nextChar)) ||
            text[start - 1] === '\\'
        ) {
            pos = start + 1;
            continue;
        }

        const scan = scanTag(text, nameEnd, name, prefix, isStreaming);
        pushMarkdown(start);

        if (scan.kind === 'partial' && text.length - start <= MAX_TAG_LENGTH) {
            segments.push({
                type: 'placeholder',
                component: ctx.getComponent(name) && nameEnd < text.length ? name : null,
                source: text.slice(start)
            });
            markdownStart = text.length;
            break;
        }

        const source = text.slice(start, scan.end);
        if (source.length > MAX_TAG_LENGTH) {
            const error = `expected at most ${MAX_TAG_LENGTH} characters in a tag`;
            segments.push(fallback(name, null, [error], source, ctx));
        } else if (scan.kind === 'broken') {
            segments.push(fallback(name, null, [scan.error], source, ctx));
        } else if (scan.kind === 'tag') {
            segments.push(parseTag(name, text.slice(start, scan.attrsEnd), source, ctx));
        }
        markdownStart = pos = scan.end;
    }

    // Hold back a tag opening still being written, such as `<` or `<ui`.
    let end = text?.length ?? 0;
    if (isStreaming && markdownStart < end) {
        const from = Math.max(markdownStart, end - opener.length),
            inCode = codeRanges.some(
                ([codeStart, codeEnd]) => end - 1 >= codeStart && end - 1 < codeEnd
            );
        for (let idx = from; idx < end && !inCode; idx++) {
            if (opener.startsWith(text.slice(idx))) {
                end = idx;
                break;
            }
        }
    }
    pushMarkdown(end);
    return segments;
}

//------------------
// Implementation
//------------------
const MAX_TAG_LENGTH = 20000,
    TAG_NAME_CHAR_RE = /[A-Za-z0-9_-]/,
    TAG_NAME_END_RE = /[\s/>]/,
    ENTITY_RE = /^&(#\d{1,7}|#x[0-9a-fA-F]{1,6}|amp|lt|gt|quot|apos);/,
    JSON_LITERAL_RE = /^(-?\d+(\.\d+)?([eE][+-]?\d+)?|true|false|null)$/;

const ESCAPES: Record<string, string> = {
    '<': '&lt;',
    '>': '&gt;',
    '\n': '&#10;',
    '\r': '&#13;',
    '\t': '&#9;'
};

type TagScan =
    | {kind: 'tag'; end: number; attrsEnd: number}
    | {kind: 'broken'; end: number; error: string}
    | {kind: 'partial'; end: number};

function scanName(text: string, from: number): number {
    let pos = from;
    while (pos < text.length && TAG_NAME_CHAR_RE.test(text[pos])) pos++;
    return pos;
}

/**
 * Find the end of a tag whose name ends at `from`. Quoted values may hold any character but their
 * own quote. Outside quotes, `<` means the tag never closed.
 */
function scanTag(
    text: string,
    from: number,
    name: string,
    prefix: string,
    isStreaming: boolean
): TagScan {
    let quote: string = null;
    for (let pos = from; pos < text.length; pos++) {
        const char = text[pos];
        if (quote) {
            if (char === quote) quote = null;
        } else if (char === '"' || char === "'") {
            quote = char;
        } else if (char === '<') {
            return {kind: 'broken', end: pos, error: 'expected the tag to end with />'};
        } else if (char === '/' && text[pos + 1] === '>') {
            return {kind: 'tag', end: pos + 2, attrsEnd: pos};
        } else if (char === '>') {
            // An open tag is fine if its closing tag follows at once.
            const closer = `</${prefix}${name}>`,
                rest = text.slice(pos + 1),
                gap = rest.length - rest.trimStart().length,
                after = rest.slice(gap);
            if (after.startsWith(closer)) {
                return {kind: 'tag', end: pos + 1 + gap + closer.length, attrsEnd: pos};
            }
            if (isStreaming && closer.startsWith(after)) return {kind: 'partial', end: text.length};
            return {
                kind: 'broken',
                end: pos + 1,
                error: 'expected a self-closing tag, ending with />'
            };
        }
    }
    return isStreaming
        ? {kind: 'partial', end: text.length}
        : {kind: 'broken', end: text.length, error: 'expected the tag to end with />'};
}

/** Parse the attributes of a complete tag, and check them as the props of its component. */
function parseTag(
    name: string,
    openTag: string,
    source: string,
    ctx: ParseTagsContext
): ChatUiTextSegment {
    const spec = ctx.getComponent(name),
        attributes = readAttributes(openTag, ctx.prefix.length + name.length + 1);
    if (!attributes) {
        return fallback(
            name,
            null,
            ['could not read the attributes - quote each value, and give each name once'],
            source,
            ctx
        );
    }

    const props: PlainObject = {},
        errors: string[] = [],
        properties = spec?.props.properties ?? {};
    attributes.forEach(({name: attr, value}) => {
        // Assigned, this name would set the prototype of the props, and hide them from the checks.
        if (attr === '__proto__') {
            errors.push(formatError(attr, 'not a valid prop name'));
            return;
        }
        try {
            props[attr] = toPropValue(value, getOwn(properties, attr));
        } catch (e) {
            errors.push(formatError(attr, `invalid JSON - ${(e as Error).message}`));
        }
    });
    // An unknown component keeps its props, for a migration of the catalog to rename it.
    if (!spec) return fallback(name, props, [`unknown component '${name}'`], source, ctx);
    errors.push(...ctx.validate(name, props));

    return isEmpty(errors)
        ? {type: 'component', element: {component: name, props}, source}
        : fallback(name, props, errors, source, ctx);
}

/**
 * The attributes of an open tag, read with the browser's XML parser from an escaped copy of the
 * tag - or null if the parser rejects it.
 *
 * @param openTag - the tag up to, not including, its closing `/>` or `>`.
 * @param nameLength - length of `<` and the tag name, replaced in the copy by a fixed name.
 */
function readAttributes(openTag: string, nameLength: number): {name: string; value: string}[] {
    const xml = `<t${escapeQuotedValues(openTag.slice(nameLength))}/>`,
        doc = new DOMParser().parseFromString(xml, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) return null;

    const root = doc.documentElement;
    if (root?.nodeName !== 't') return null;
    return Array.from(root.attributes).map(it => ({name: it.name, value: it.value}));
}

/**
 * Escape the characters that XML does not allow raw in a quoted value - `&` not starting an
 * entity, and `<` - along with `>` and line breaks and tabs, which XML would turn into spaces.
 */
function escapeQuotedValues(markup: string): string {
    let quote: string = null,
        ret = '';
    for (let pos = 0; pos < markup.length; pos++) {
        const char = markup[pos];
        if (!quote) {
            if (char === '"' || char === "'") quote = char;
            ret += char;
        } else if (char === quote) {
            quote = null;
            ret += char;
        } else if (char === '&') {
            ret += ENTITY_RE.test(markup.slice(pos, pos + 12)) ? char : '&amp;';
        } else {
            ret += ESCAPES[char] ?? char;
        }
    }
    return ret;
}

/**
 * The value of an attribute as a prop. A prop whose schema takes only strings keeps the text as
 * written. Otherwise text that starts with `[` or `{` parses as JSON, and so does a number,
 * boolean or null for a prop that takes no strings. Anything else stays a string.
 *
 * @throws if JSON-looking text does not parse, for a prop that takes no strings.
 */
function toPropValue(value: string, schema: PlainObject): unknown {
    const types = castArray(schema?.type ?? []),
        takesString = types.includes('string') || isEmpty(types),
        trimmed = value.trim();

    if (types.length === 1 && types[0] === 'string') return value;
    if (isEmpty(types) && schema?.enum?.includes(value)) return value;
    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
        try {
            return JSON.parse(trimmed);
        } catch (e) {
            if (takesString) return value;
            throw e;
        }
    }
    if (!types.includes('string') && JSON_LITERAL_RE.test(trimmed)) return JSON.parse(trimmed);
    return value;
}

function fallback(
    name: string,
    props: PlainObject,
    errors: string[],
    source: string,
    ctx: ParseTagsContext
): ChatUiTextSegment {
    return {
        type: 'fallback',
        component: ctx.getComponent(name) ? name : null,
        name,
        props,
        errors,
        source
    };
}

/**
 * Ranges of the text inside fenced code blocks and inline code spans, as `[start, end)`. An
 * unclosed fence runs to the end of the text. A backtick run with no closing run of the same
 * length is plain text - unless the text still streams and the run is in its last paragraph,
 * where the closing run may yet arrive. Indented code blocks are not detected.
 */
function findCodeRanges(text: string, isStreaming: boolean): [number, number][] {
    const fenced: [number, number][] = [];
    let offset = 0,
        fence: {char: string; length: number; start: number} = null;

    for (const line of text.split('\n')) {
        const match = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
        if (!fence) {
            if (match && !(match[1][0] === '`' && match[2].includes('`'))) {
                fence = {char: match[1][0], length: match[1].length, start: offset};
            }
        } else if (
            match &&
            match[1][0] === fence.char &&
            match[1].length >= fence.length &&
            !match[2].trim()
        ) {
            fenced.push([fence.start, offset + line.length]);
            fence = null;
        }
        offset += line.length + 1;
    }
    if (fence) fenced.push([fence.start, text.length]);

    const ret = [...fenced],
        inFence = (pos: number) => fenced.some(([from, to]) => pos >= from && pos < to),
        runs = [...text.matchAll(/`+/g)].filter(it => !inFence(it.index));

    for (let idx = 0; idx < runs.length; idx++) {
        const open = runs[idx],
            closeIdx = runs.findIndex((it, i) => i > idx && it[0].length === open[0].length);
        if (closeIdx < 0) {
            // A code span never crosses a blank line, so only the last paragraph can still close.
            if (isStreaming && !text.includes('\n\n', open.index)) {
                ret.push([open.index, text.length]);
                break;
            }
            continue;
        }
        const close = runs[closeIdx];
        ret.push([open.index, close.index + close[0].length]);
        idx = closeIdx;
    }
    return ret.sort((a, b) => a[0] - b[0]);
}
