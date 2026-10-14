import {find} from 'lodash';
import type {ChatSourcePart} from '../core';

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
 * Only `http` and `https` URLs open, as a source URL can come from model output.
 * @internal
 */
export function openSourceUrl({url}: ChatSourcePart) {
    if (isWebUrl(url)) window.open(url, '_blank', 'noopener,noreferrer');
}

/** True for an absolute `http` || `https` URL - never a `javascript:` || `data:` one. @internal */
export function isWebUrl(url: string): boolean {
    try {
        const {protocol} = new URL(url);
        return protocol === 'http:' || protocol === 'https:';
    } catch (ignored) {
        return false;
    }
}

/** True if any of the sources has a `marker`. @internal */
export function hasMarkers(sources: ChatSourcePart[]): boolean {
    return !!sources?.some(it => it.marker != null);
}
