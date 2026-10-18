import type {ChatSourcePart} from '../../../core';
import {findCitedSource} from '../../../impl/sources';

/**
 * Tag of the element that a citation marker becomes in the parsed markdown. Its `data-markers`
 * attribute lists the cited numbers, separated by spaces.
 * @internal
 */
export const CITATION_TAG = 'xh-chat-citation';

/** Options for {@link remarkCitations}. @internal */
export interface RemarkCitationsOptions {
    /** Sources the text may cite. */
    sources: ChatSourcePart[];
}

/** Class of the span that keeps a marker on the line of the word before it. @internal */
export const CITATION_RUN_CLASS = 'xh-chat-markdown__citation-run';

/**
 * A remark plugin that turns citation markers in text - `[1]`, `[1, 2]` and `[1][2]` - into
 * citation elements, rendered by the component registered for {@link CITATION_TAG}.
 *
 * A marker converts only if every number in it cites a source - see {@link findCitedSource}. Any
 * other bracketed text stays as written, a range such as `[2-5]` included. Markers inside code, links and link references stay as
 * written too, and footnote syntax (`[^1]`) never matches. A marker still streaming in, such as a
 * trailing `[1`, has no closing bracket yet and so stays plain text until it closes.
 *
 * Each run of markers sits in a span with the word before it and any punctuation after it, which
 * the kit's styles keep on one line, so that a marker never starts a line.
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
    let start = 0,
        run: MdastNode = null;

    for (const match of text.matchAll(MARKER)) {
        const numbers = match[1].split(',').map(it => parseInt(it, 10));
        if (!numbers.every(it => findCitedSource(sources, it))) continue;

        const citation = createCitation(match[0], numbers);
        if (run && match.index === start) {
            // Adjacent to the last marker - the same run.
            run.children.push(citation);
        } else {
            let before = text.slice(start, match.index);
            if (run) before = takePunctuation(run, before);

            const word = /\S+\s*$/.exec(before)?.[0] ?? '',
                head = before.slice(0, before.length - word.length);
            if (head) ret.push(textNode(head));
            run = createRun(word ? [textNode(word), citation] : [citation]);
            ret.push(run);
        }
        start = match.index + match[0].length;
    }

    if (!run) return [node];
    const rest = takePunctuation(run, text.slice(start));
    if (rest) ret.push(textNode(rest));
    return ret;
}

// Move the punctuation that starts `text` into the run, so that it stays on the marker's line.
// Returns the rest of the text.
function takePunctuation(run: MdastNode, text: string): string {
    const punctuation = /^[.,;:!?)\]”’"']+/.exec(text)?.[0];
    if (!punctuation) return text;
    run.children.push(textNode(punctuation));
    return text.slice(punctuation.length);
}

function textNode(value: string): MdastNode {
    return {type: 'text', value};
}

// A span that the markdown-to-HTML step makes from the node's `data`.
function createRun(children: MdastNode[]): MdastNode {
    return {
        type: 'xhChatCitationRun',
        children,
        data: {hName: 'span', hProperties: {className: [CITATION_RUN_CLASS]}}
    };
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
