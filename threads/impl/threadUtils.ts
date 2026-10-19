import {truncate} from 'lodash';

/** Title for a thread with none of its own yet. @internal */
export const UNTITLED_THREAD = 'New conversation';

/**
 * A provisional title for a thread, from the start of its first message, on one line.
 * @internal
 */
export function titleFromText(text: string): string {
    const line = text?.replace(/\s+/g, ' ').trim();
    return line ? truncate(line, {length: 80, separator: ' '}) : UNTITLED_THREAD;
}

/**
 * True for an error that reports a missing thread - an HTTP 404, as Hoist's `FetchService`
 * reports it.
 * @internal
 */
export function isNotFound(e: any): boolean {
    return e?.httpStatus === 404;
}
