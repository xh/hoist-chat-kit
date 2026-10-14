import {compact, find, maxBy, sortBy, uniqBy} from 'lodash';
import type {Key, MouseEvent, ReactElement, ReactNode} from 'react';
import {a, div, span} from '@xh/hoist/cmp/layout';
import {hoistCmp, type HoistProps} from '@xh/hoist/core';
import {tooltip} from '@xh/hoist/kit/blueprint';
import {
    getCitationNumber,
    getExcerpt,
    hasMarkers
} from '../../../../cmp/markdown/impl/CitationMarkers';
import type {ChatCitation, ChatPart, ChatSourcePart} from '../../../../core';
import {htmlButton} from '../../../../impl/HtmlTags';
import '../../../../styles/vars.scss';
import './ChatCitations.scss';
import {formatHost} from './ChatFormat';

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
 * first citation across all of the text, then the sources that are never cited, in the order
 * reported. Each takes the next free number.
 *
 * Numbers stay stable while the message streams. Text only grows, so a citation keeps the number
 * it first took, and no two references share one. Sources that arrive after the text match the
 * numbers their citations already hold.
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
    sources.forEach(source => add(sourceKey(source.id), source, null));
    return sortBy(ret, 'number');
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
 * A click handler for a link or button that opens a source: it calls the app's `onSourceClick`
 * in place of following the link. Null without a handler, so that a link opens as usual.
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
 * Wraps a citation marker in a tooltip that shows its source's title, host and excerpt - the
 * desktop `renderMarker` for {@link ChatMarkdownCitations}.
 * @internal
 */
export function renderCitationMarker(marker: ReactElement, source: ChatSourcePart): ReactNode {
    return citationTooltip(marker, {
        title: source.title,
        url: source.url,
        quote: getExcerpt(source)
    });
}

interface ChatCitationsProps extends HoistProps {
    /** Citations of the passage, in citation order. */
    citations: ChatCitation[];

    /** References of the message that holds the passage - see {@link collectReferences}. */
    references: ChatReference[];

    /**
     * Called when the user clicks a chip, with the cited source. Default opens the source's `url`
     * in a new tab.
     */
    onSourceClick?: (source: ChatSourcePart) => void;
}

/**
 * Numbered chips for the citations that support a passage of text, shown inline at the end of its
 * last paragraph. Hovering a chip shows the cited source and passage. Clicking opens the source,
 * or calls `onSourceClick`.
 * @internal
 */
export const chatCitations = hoistCmp.factory<ChatCitationsProps>({
    displayName: 'ChatCitations',
    model: false,
    className: 'xh-chat-citations',

    render({className, citations, references, onSourceClick}) {
        if (!citations?.length) return null;

        // A span, as the chips sit inside the paragraph they support.
        return span({
            className,
            items: numberCitations(citations, references).map(({citation, number, reference}) =>
                citationChip(citation, number, toSource(reference), onSourceClick)
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

function nextNumber(references: ChatReference[]): number {
    return (maxBy(references, 'number')?.number ?? 0) + 1;
}

// A link to the source, or a button for an app's own handler - else a plain chip.
function citationChip(
    {id, url, title, citedText}: ChatCitation,
    number: number,
    source: ChatSourcePart,
    onSourceClick: (source: ChatSourcePart) => void
) {
    const chipProps = {className: 'xh-chat-citations__chip', item: String(number)},
        onClick = createSourceClick(source, onSourceClick);

    let chip: ReactElement;
    if (url) {
        chip = a({...chipProps, href: url, target: '_blank', rel: 'noopener noreferrer', onClick});
    } else if (onClick) {
        chip = htmlButton({...chipProps, type: 'button', onClick});
    } else {
        chip = span(chipProps);
    }

    return citationTooltip(chip, {title, url, quote: citedText}, id ?? number);
}

function citationTooltip(
    target: ReactElement,
    {title, url, quote}: {title: string; url: string; quote: string},
    key?: Key
) {
    const host = formatHost(url);
    return tooltip({
        key,
        minimal: true,
        popoverClassName: 'xh-chat-citations__popover',
        item: target,
        content: div({
            className: 'xh-chat-citations__tip',
            items: [
                title ? div({className: 'xh-chat-citations__tip-title', item: title}) : null,
                host ? div({className: 'xh-chat-citations__tip-host', item: host}) : null,
                quote ? div({className: 'xh-chat-citations__tip-quote', item: quote}) : null
            ]
        })
    });
}
