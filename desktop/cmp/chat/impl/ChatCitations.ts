import {compact, uniqBy} from 'lodash';
import {a, div, span} from '@xh/hoist/cmp/layout';
import {hoistCmp, type HoistProps} from '@xh/hoist/core';
import {tooltip} from '@xh/hoist/kit/blueprint';
import type {ChatCitation, ChatPart, ChatSourcePart} from '../../../../core';
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
 * Number the references of a message: its cited sources, in order of first citation across all of
 * its text, then its sources that are never cited, in the order reported.
 *
 * Numbers stay stable while the message streams. Text only grows, so a citation keeps the number
 * it first took, and no two references share one. Sources that arrive after the text match the
 * numbers their citations already hold.
 * @internal
 */
export function collectReferences(parts: ChatPart[]): ChatReference[] {
    const sources = parts.filter(it => it.type === 'source') as ChatSourcePart[],
        citations = parts.flatMap(it => (it.type === 'text' ? (it.citations ?? []) : [])),
        ret: ChatReference[] = [],
        add = (key: string, source: ChatSourcePart, citation: ChatCitation) => {
            if (!ret.some(it => it.key === key)) {
                ret.push({number: ret.length + 1, key, source, citation});
            }
        };

    citations.forEach(citation => {
        const source = findSource(citation, sources);
        add(getKey(citation, source), source, citation);
    });
    sources.forEach(source => add(sourceKey(source.id), source, null));
    return ret;
}

/**
 * The references of a message as a source list for {@link ChatSources}, in number order. A cited
 * source that the message does not list is built from its citation, so that every chip number has
 * an entry.
 * @internal
 */
export function toSourceList(references: ChatReference[]): ChatSourcePart[] {
    return references.map(
        ({key, source, citation}) =>
            source ?? {
                type: 'source',
                id: key,
                url: citation.url,
                title: citation.title,
                snippet: citation.citedText
            }
    );
}

/**
 * The citations of a passage with their reference numbers, each number once, in citation order.
 * @internal
 */
export function numberCitations(
    citations: ChatCitation[],
    references: ChatReference[]
): Array<{citation: ChatCitation; number: number}> {
    const sources = compact(references.map(it => it.source)),
        numbered = compact(
            citations.map(citation => {
                const key = getKey(citation, findSource(citation, sources)),
                    ref = references.find(it => it.key === key);
                return ref ? {citation, number: ref.number} : null;
            })
        );
    return uniqBy(numbered, 'number');
}

interface ChatCitationsProps extends HoistProps {
    /** Citations of the passage, in citation order. */
    citations: ChatCitation[];

    /** References of the message that holds the passage - see {@link collectReferences}. */
    references: ChatReference[];
}

/**
 * Numbered chips for the citations that support a passage of text, shown inline at the end of its
 * last paragraph. Hovering a chip shows the cited source and passage. Clicking opens the source.
 * @internal
 */
export const chatCitations = hoistCmp.factory<ChatCitationsProps>({
    displayName: 'ChatCitations',
    model: false,
    className: 'xh-chat-citations',

    render({className, citations, references}) {
        if (!citations?.length) return null;

        // A span, as the chips sit inside the paragraph they support.
        return span({
            className,
            items: numberCitations(citations, references).map(({citation, number}) =>
                citationChip(citation, number)
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

function citationChip({id, url, title, citedText}: ChatCitation, number: number) {
    const host = formatHost(url),
        chipProps = {className: 'xh-chat-citations__chip', item: String(number)};

    return tooltip({
        key: id ?? number,
        minimal: true,
        popoverClassName: 'xh-chat-citations__popover',
        item: url
            ? a({...chipProps, href: url, target: '_blank', rel: 'noopener noreferrer'})
            : span(chipProps),
        content: div({
            className: 'xh-chat-citations__tip',
            items: [
                title ? div({className: 'xh-chat-citations__tip-title', item: title}) : null,
                host ? div({className: 'xh-chat-citations__tip-host', item: host}) : null,
                citedText ? div({className: 'xh-chat-citations__tip-quote', item: citedText}) : null
            ]
        })
    });
}
