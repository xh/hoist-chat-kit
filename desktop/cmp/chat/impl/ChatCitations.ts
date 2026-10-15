import {compact, find, maxBy, sortBy, uniqBy} from 'lodash';
import type {MouseEvent, ReactElement} from 'react';
import {span} from '@xh/hoist/cmp/layout';
import {hoistCmp, type HoistProps} from '@xh/hoist/core';
import type {ChatCitedSource, ChatMarkdownCitations} from '../../../../cmp/markdown';
import type {ChatCitation, ChatPart, ChatSourcePart} from '../../../../core';
import {getCitationNumber, hasMarkers} from '../../../../impl/sources';
import '../../../../styles/vars.scss';
import {chatCitationGroupMarker, chatCitationMarker} from './ChatCitationMarker';
import './ChatCitations.scss';
import type {ChatSourceLinks} from './ChatSourceLinks';

/**
 * A numbered reference of a message - a source it lists, a passage it cites, or both. The chips
 * of the message's citations and the entries of its source list share these numbers.
 * @internal
 */
export interface ChatReference {
    /** One-based number, shown on the citation chips and in the source list. */
    number: number;

    /** Key that citations of this reference resolve to. */
    key: string;

    /** The source part the reference lists, or null for a citation of an unlisted source. */
    source: ChatSourcePart;

    /** The first citation of the reference, or null for a source that is never cited. */
    citation: ChatCitation;
}

/**
 * Number the references of a message.
 *
 * Sources that the text cites by number - `[1]` - take that number: their `marker`, or with
 * `citationMarkers` on and no markers, their position. Then come the cited sources, in order of
 * first citation across all of the text, then any source whose marker another source already
 * holds, each taking the next free number. A message that cites nothing - no markers, no
 * citations - numbers all of its sources in the order reported. A source that a citing message
 * never cites takes no number - see {@link collectUncitedSources}.
 *
 * Numbers stay stable while the message streams, and never renumber (R19). Text only grows, so a
 * citation keeps the number it first took, and no two references share one. Sources that arrive
 * after the text match the numbers their citations already hold. One case can renumber: with
 * `citationMarkers` on and no source `marker`, sources take their positions first, so a citation
 * numbered before its source arrives may move to the source's number.
 * @internal
 */
export function collectReferences(parts: ChatPart[], citationMarkers = false): ChatReference[] {
    const sources = parts.filter(it => it.type === 'source') as ChatSourcePart[],
        citations = parts.flatMap(it => (it.type === 'text' ? (it.citations ?? []) : [])),
        ret: ChatReference[] = [],
        add = (key: string, source: ChatSourcePart, citation: ChatCitation, number?: number) => {
            if (!ret.some(it => it.key === key)) {
                ret.push({number: number ?? nextNumber(ret), key, source, citation});
            }
        };

    if (citationMarkers || hasMarkers(sources)) {
        sources.forEach(source => {
            const number = getCitationNumber(sources, source);
            if (number != null && !ret.some(it => it.number === number)) {
                add(sourceKey(source.id), source, null, number);
            }
        });
    }
    citations.forEach(citation => {
        const source = findSource(citation, sources),
            key = getKey(citation, source),
            ref = find(ret, {key});
        if (ref) {
            ref.citation ??= citation;
        } else {
            add(key, source, citation);
        }
    });
    // A source that shares its marker with another still takes a number, the next free one.
    sources.forEach(source => {
        if (source.marker != null || !isCiting(sources, citations, citationMarkers)) {
            add(sourceKey(source.id), source, null);
        }
    });
    return sortBy(ret, 'number');
}

/**
 * The sources of a message that its text never cites - searched, but with no matching passage.
 * The sources list counts them without numbers, so that every number matches a marker. Empty for
 * a message that cites nothing, as then every source takes a number.
 * @internal
 */
export function collectUncitedSources(
    parts: ChatPart[],
    references: ChatReference[]
): ChatSourcePart[] {
    const sources = parts.filter(it => it.type === 'source') as ChatSourcePart[];
    return sources.filter(source => !references.some(it => it.source?.id === source.id));
}

/**
 * The references of a message as a source list for {@link ChatSources}, in number order. A cited
 * source that the message does not list is built from its citation, so that every chip number has
 * an entry. `ChatSources` shows each source's `marker`, else its position, so an entry whose
 * number differs from both carries its number as its `marker`.
 * @internal
 */
export function toSourceList(references: ChatReference[]): ChatSourcePart[] {
    return references.map((ref, idx) => {
        const source = toSource(ref);
        return (source.marker ?? idx + 1) === ref.number ? source : {...source, marker: ref.number};
    });
}

/**
 * The citations of a passage with their references, each reference once, in citation order.
 * @internal
 */
export function numberCitations(
    citations: ChatCitation[],
    references: ChatReference[]
): Array<{citation: ChatCitation; number: number; reference: ChatReference}> {
    const sources = compact(references.map(it => it.source)),
        numbered = compact(
            citations.map(citation => {
                const key = getKey(citation, findSource(citation, sources)),
                    reference = find(references, {key});
                return reference ? {citation, number: reference.number, reference} : null;
            })
        );
    return uniqBy(numbered, 'number');
}

/**
 * A click handler for a link that opens a source: it calls the app's `onSourceClick` in place of
 * following the link. Null without a handler, so that a link opens as usual.
 * @internal
 */
export function createSourceClick(
    source: ChatSourcePart,
    onSourceClick: (source: ChatSourcePart) => void
): (e: MouseEvent) => void {
    if (!onSourceClick) return null;
    return e => {
        e.preventDefault();
        onSourceClick(source);
    };
}

/**
 * The desktop renderers of citation markers in the text, for {@link ChatMarkdownCitations}: each
 * marker with its source's card.
 * @internal
 */
export function createMarkerRenderers(
    links: ChatSourceLinks
): Pick<ChatMarkdownCitations, 'renderMarker' | 'renderGroup'> {
    return {
        renderMarker: (marker: ReactElement, source: ChatSourcePart, number: number) =>
            chatCitationMarker({number, source, links}),
        renderGroup: (marker: ReactElement, cited: ChatCitedSource[]) =>
            chatCitationGroupMarker({cited, links})
    };
}

interface ChatCitationsProps extends HoistProps {
    /** Citations of the passage, in citation order. */
    citations: ChatCitation[];

    /** References of the message that holds the passage - see {@link collectReferences}. */
    references: ChatReference[];

    /** How the message opens its sources. */
    links: ChatSourceLinks;
}

/**
 * Numbered markers for the citations that support a passage of text, shown inline at the end of
 * its last paragraph. Each opens its source's card, as a marker in the text does.
 * @internal
 */
export const chatCitations = hoistCmp.factory<ChatCitationsProps>({
    displayName: 'ChatCitations',
    model: false,
    className: 'xh-chat-citations',

    render({className, citations, references, links}) {
        if (!citations?.length) return null;

        // A span, as the markers sit inside the paragraph they support.
        return span({
            className,
            items: numberCitations(citations, references).map(({citation, number, reference}) =>
                chatCitationMarker({
                    key: citation.id ?? number,
                    number,
                    source: toSource(reference),
                    passage: citation.citedText,
                    links
                })
            )
        });
    }
});

//------------------
// Implementation
//------------------
function findSource({sourceId, url}: ChatCitation, sources: ChatSourcePart[]): ChatSourcePart {
    return (
        sources.find(
            source => (sourceId != null && source.id === sourceId) || (url && source.url === url)
        ) ?? null
    );
}

// The key a citation resolves to - its listed source, else the source it names, else its own
// content, so that repeated citations of one passage share a number.
function getKey(citation: ChatCitation, source: ChatSourcePart): string {
    const {sourceId, url, title, citedText} = citation;
    if (source) return sourceKey(source.id);
    if (sourceId != null) return sourceKey(sourceId);
    if (url) return `url:${url}`;
    return `text:${title ?? ''}|${citedText ?? ''}`;
}

function sourceKey(id: string): string {
    return `source:${id}`;
}

// A cited source that the message does not list is built from its citation.
function toSource({key, source, citation}: ChatReference): ChatSourcePart {
    return (
        source ?? {
            type: 'source',
            id: key,
            url: citation.url,
            title: citation.title,
            snippet: citation.citedText
        }
    );
}

// True if the message cites its sources - by number, or with citations on its text.
function isCiting(
    sources: ChatSourcePart[],
    citations: ChatCitation[],
    citationMarkers: boolean
): boolean {
    return citationMarkers || hasMarkers(sources) || citations.length > 0;
}

function nextNumber(references: ChatReference[]): number {
    return (maxBy(references, 'number')?.number ?? 0) + 1;
}
