import {find, isFinite} from 'lodash';
import {XH} from '@xh/hoist/core';
import type {ChatDocumentRequest, ChatSidePanelHost, ChatSourcePart, ChatSourceType} from '../core';

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
 * What kind of thing a source is: its `sourceType`, else `url` if it has a `url`, else `document`.
 * @internal
 */
export function getSourceType(source: ChatSourcePart): ChatSourceType {
    const {sourceType} = source;
    if (sourceType === 'url' || sourceType === 'document') return sourceType;
    return source.url ? 'url' : 'document';
}

/** The page of a source's passage - its `metadata.page` - or null. @internal */
export function getSourcePage(source: ChatSourcePart): number {
    const page = source.metadata?.page;
    return isFinite(page) ? page : null;
}

/** The file name of a document source - its `metadata.fileName` - or null. @internal */
export function getSourceFileName(source: ChatSourcePart): string {
    return source.metadata?.fileName ?? null;
}

/** The request that shows a document source in the side panel. @internal */
export function toDocumentRequest(
    source: ChatSourcePart,
    opts: {citation?: number; messageId?: string} = {}
): ChatDocumentRequest {
    return {
        type: 'document',
        source,
        page: getSourcePage(source),
        passage: getExcerpt(source),
        citation: opts.citation ?? null,
        messageId: opts.messageId ?? null
    };
}

/** How to open a source - see {@link openChatSource}. @internal */
export interface ChatSourceOpenOptions {
    /** The number that cites the source, for the side panel's Back. */
    citation?: number;

    /** The id of the message that cites the source. */
    messageId?: string;

    /** The element that opened the source, which Back and close focus. */
    opener?: HTMLElement;

    /** The side panel in reach, or null. */
    sidePanel?: ChatSidePanelHost;

    /** The app's handler, in place of the default. */
    onSourceClick?: (source: ChatSourcePart) => void;

    /** True to open the source's URL in a new tab, as on a Ctrl or Cmd click. */
    newTab?: boolean;
}

/**
 * Open a source, as a click on its citation or its row does.
 *
 * A Ctrl or Cmd click opens a web URL in a new tab. A document opens in the side panel when one is
 * in reach and can show it, else with the app's `onSourceClick`, else at its URL in a new tab -
 * with a toast if the panel had no room. A document that nothing can open shows a toast that
 * says why. A web page opens with `onSourceClick`, else in a new tab. Only `http` and `https`
 * URLs open.
 * @internal
 */
export function openChatSource(source: ChatSourcePart, opts: ChatSourceOpenOptions = {}) {
    const {citation, messageId, opener, sidePanel, onSourceClick, newTab} = opts;
    if (newTab && isWebUrl(source.url)) {
        openSourceUrl(source);
        return;
    }

    if (getSourceType(source) === 'document') {
        const request = toDocumentRequest(source, {citation, messageId});
        if (sidePanel?.canOpen(request)) {
            sidePanel.open(request, opener);
        } else if (onSourceClick) {
            onSourceClick(source);
        } else if (isWebUrl(source.url)) {
            openSourceUrl(source);
            if (sidePanel?.canRender(request)) {
                XH.toast({message: 'Opened in a new tab. The viewer needs more room than this.'});
            }
        } else {
            XH.toast({
                message: sidePanel?.canRender(request)
                    ? 'The viewer needs more room than this.'
                    : "This document can't be opened here.",
                intent: 'warning'
            });
        }
        return;
    }

    onSourceClick ? onSourceClick(source) : openSourceUrl(source);
}

/**
 * Trim an excerpt to at most `max` characters at word boundaries, around the cited passage if the
 * excerpt holds it, with an ellipsis where text was cut. Returns the text before, of and after the
 * passage - `passage` is null if the excerpt does not hold it.
 * @internal
 */
export function trimExcerpt(
    excerpt: string,
    passage: string = null,
    max = 300
): {before: string; passage: string; after: string} {
    const text = excerpt?.trim() ?? '',
        idx = passage ? text.indexOf(passage) : -1;
    if (idx < 0 || passage === text) {
        return {before: trimEnd(text, max), passage: null, after: ''};
    }

    // Center the passage in the window, as far as the text allows.
    const room = Math.max(0, max - passage.length),
        startAt = Math.max(0, Math.min(idx - Math.floor(room / 2), text.length - max)),
        start = startAt > 0 ? wordStart(text, startAt) : 0,
        endAt = Math.min(text.length, Math.max(start + max, idx + passage.length)),
        end = endAt < text.length ? wordEnd(text, endAt, idx + passage.length) : text.length;
    return {
        before: (start > 0 ? '…' : '') + text.slice(start, idx),
        passage,
        after: text.slice(idx + passage.length, end) + (end < text.length ? '…' : '')
    };
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

/**
 * The text and accessible label of a citation marker for many sources: "2–5" and "Sources 2 to 5"
 * for consecutive numbers, else "4 sources" and "Sources 1, 2, 4, 5".
 * @internal
 */
export function getCitationGroupLabels(numbers: number[]): {text: string; label: string} {
    const first = numbers[0],
        last = numbers[numbers.length - 1];
    return numbers.every((it, idx) => it === first + idx)
        ? {text: `${first}–${last}`, label: `Sources ${first} to ${last}`}
        : {text: `${numbers.length} sources`, label: `Sources ${numbers.join(', ')}`};
}

/** True if any of the sources has a `marker`. @internal */
export function hasMarkers(sources: ChatSourcePart[]): boolean {
    return !!sources?.some(it => it.marker != null);
}

//------------------
// Implementation
//------------------
function trimEnd(text: string, max: number): string {
    if (text.length <= max) return text;
    const cut = text.lastIndexOf(' ', max);
    return text.slice(0, cut > max / 2 ? cut : max).trimEnd() + '…';
}

// The start of the first word at or after `idx`.
function wordStart(text: string, idx: number): number {
    const space = text.indexOf(' ', idx);
    return space < 0 ? idx : space + 1;
}

// The end of the last word before `idx`, but never before `min`.
function wordEnd(text: string, idx: number, min: number): number {
    const space = text.lastIndexOf(' ', idx);
    return space >= min ? space : idx;
}
