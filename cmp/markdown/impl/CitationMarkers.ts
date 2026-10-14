import {find} from 'lodash';
import type {ChatSourcePart} from '../../../core';

/**
 * Tag of the element that a citation marker becomes in the parsed markdown. Its `data-markers`
 * attribute lists the cited numbers, separated by spaces.
 * @internal
 */
export const CITATION_TAG = 'xh-chat-citation';

/**
 * The source that `[number]` cites: the source with that `marker`, or - when no source has a
 * marker - the source at that position, counting from 1. Null if none.
 * @internal
 */
export function findCitedSource(sources: ChatSourcePart[], number: number): ChatSourcePart {
    if (!sources?.length) return null;
    return hasMarkers(sources)
        ? (find(sources, {marker: number}) ?? null)
        : (sources[number - 1] ?? null);
}

/**
 * The number that cites a source in the text - its `marker`, or its position, counting from 1,
 * when no source has a marker. Null for a source without a marker among sources that have them.
 * @internal
 */
export function getCitationNumber(sources: ChatSourcePart[], source: ChatSourcePart): number {
    if (hasMarkers(sources)) return source.marker ?? null;
    const idx = sources.indexOf(source);
    return idx >= 0 ? idx + 1 : null;
}

/**
 * The excerpt of a source to show with a citation: its `metadata.excerpt`, else its `snippet`.
 * @internal
 */
export function getExcerpt(source: ChatSourcePart): string {
    return source.metadata?.excerpt ?? source.snippet ?? null;
}

/**
 * Open a source's `url` in a new tab - the default action for a click on a citation or source.
 * @internal
 */
export function openSourceUrl({url}: ChatSourcePart) {
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
}

/** True if any of the sources has a `marker`. @internal */
export function hasMarkers(sources: ChatSourcePart[]): boolean {
    return !!sources?.some(it => it.marker != null);
}

/** Options for {@link remarkCitations}. @internal */
export interface RemarkCitationsOptions {
    /** Sources the text may cite. */
    sources: ChatSourcePart[];
}

/**
 * A remark plugin that turns citation markers in text - `[1]`, `[1, 2]` and `[1][2]` - into
 * citation elements, rendered by the component registered for {@link CITATION_TAG}.
 *
 * A marker converts only if every number in it cites a source - see {@link findCitedSource}. Any
 * other bracketed text stays as written. Markers inside code, links and link references stay as
 * written too, and footnote syntax (`[^1]`) never matches. A marker still streaming in, such as a
 * trailing `[1`, has no closing bracket yet and so stays plain text until it closes.
 *
 * Runs on the markdown tree (mdast), so markdown syntax has already been parsed when it runs.
 * @internal
 */
export function remarkCitations({sources}: RemarkCitationsOptions) {
    return (tree: MdastNode) => {
        if (sources?.length) replaceMarkers(tree, sources);
    };
}

/** A node of a markdown tree (mdast), typed only as far as the plugin reads it. @internal */
export interface MdastNode {
    type: string;
    value?: string;
    children?: MdastNode[];
    data?: Record<string, unknown>;
    [key: string]: unknown;
}

//------------------
// Implementation
//------------------
// One bracketed list of numbers, such as `[1]` or `[1, 2]`. Adjacent markers - `[1][2]` - match
// one at a time.
const MARKER = /\[(\d{1,4}(?:\s*,\s*\d{1,4})*)\]/g;

// Nodes whose text is never a citation: links show their text as written, and code has no text
// children to visit.
const SKIPPED_TYPES = new Set(['link', 'linkReference', 'code', 'inlineCode', 'html']);

function replaceMarkers(parent: MdastNode, sources: ChatSourcePart[]) {
    if (!parent.children || SKIPPED_TYPES.has(parent.type)) return;

    parent.children = parent.children.flatMap(child => {
        if (child.type === 'text') return splitText(child, sources);
        replaceMarkers(child, sources);
        return [child];
    });
}

function splitText(node: MdastNode, sources: ChatSourcePart[]): MdastNode[] {
    const text = node.value ?? '',
        ret: MdastNode[] = [];
    let start = 0;

    for (const match of text.matchAll(MARKER)) {
        const numbers = match[1].split(',').map(it => parseInt(it, 10));
        if (!numbers.every(it => findCitedSource(sources, it))) continue;

        if (match.index > start) ret.push({type: 'text', value: text.slice(start, match.index)});
        ret.push(createCitation(match[0], numbers));
        start = match.index + match[0].length;
    }

    if (!start) return [node];
    if (start < text.length) ret.push({type: 'text', value: text.slice(start)});
    return ret;
}

// A node of a type of its own, so that other plugins leave it alone. Its `data` tells the
// markdown-to-HTML step which element to make of it. The text as written is the element's content,
// for plugins that read the text of the HTML tree.
function createCitation(text: string, numbers: number[]): MdastNode {
    return {
        type: 'xhChatCitation',
        numbers,
        data: {
            hName: CITATION_TAG,
            hProperties: {dataMarkers: numbers.join(' ')},
            hChildren: [{type: 'text', value: text}]
        }
    };
}
