import {isEmpty, isString} from 'lodash';
import {ChatRunError} from '../../core';

/**
 * One event from a `text/event-stream` body.
 * @internal
 */
export interface SseEvent {
    /** The `event` field - 'message' if the frame did not name one. */
    event: string;

    /** The `data` field, with the lines of a multi-line value joined by newlines. */
    data: string;

    /** The last `id` field seen in the stream, or null. */
    id: string;
}

/**
 * Incremental parser for Server-Sent Events, per the WHATWG `text/event-stream` format.
 *
 * Feed it chunks of the response body as they arrive - a chunk may end anywhere, mid-line or
 * mid-character. Comments, `retry` and unknown fields are skipped. An event left incomplete when
 * the stream ends is discarded, as the format requires. A line or event longer than
 * `maxEventChars` throws a `ChatRunError` coded `invalid-stream`, so a server that never ends one
 * cannot fill the browser's memory.
 *
 * @see https://html.spec.whatwg.org/multipage/server-sent-events.html#parsing-an-event-stream
 * @internal
 */
export class SseParser {
    private decoder = new TextDecoder();
    private pending = '';
    private endedWithCr = false;
    private dataLines: string[] = [];
    private eventName: string = null;
    private lastId: string = null;
    private dataChars = 0;

    constructor(private readonly maxEventChars = MAX_EVENT_CHARS) {}

    /** Parse the next chunk of the stream, returning the events it completes. */
    feed(chunk: Uint8Array | string): SseEvent[] {
        let text = isString(chunk) ? chunk : this.decoder.decode(chunk, {stream: true});
        if (!text) return [];

        // A CR that ended the previous chunk may be the first half of a CRLF.
        if (this.endedWithCr && text.startsWith('\n')) text = text.slice(1);
        this.endedWithCr = text.endsWith('\r');

        const lines = (this.pending + text).split(LINE_BREAK),
            ret: SseEvent[] = [];
        this.pending = lines.pop();
        this.checkSize(this.pending.length);

        lines.forEach(line => {
            const event = this.processLine(line);
            if (event) ret.push(event);
        });
        return ret;
    }

    //------------------
    // Implementation
    //------------------
    private processLine(line: string): SseEvent {
        if (line === '') return this.dispatch();
        if (line.startsWith(':')) return null;

        const colonIdx = line.indexOf(':'),
            field = colonIdx === -1 ? line : line.slice(0, colonIdx);
        let value = colonIdx === -1 ? '' : line.slice(colonIdx + 1);
        if (value.startsWith(' ')) value = value.slice(1);

        switch (field) {
            case 'data':
                this.dataLines.push(value);
                this.dataChars += value.length + 1;
                this.checkSize(this.dataChars);
                break;
            case 'event':
                this.eventName = value;
                break;
            case 'id':
                if (!value.includes('\0')) this.lastId = value;
                break;
        }
        return null;
    }

    private dispatch(): SseEvent {
        const {dataLines, eventName, lastId} = this;
        this.dataLines = [];
        this.dataChars = 0;
        this.eventName = null;
        if (isEmpty(dataLines)) return null;
        return {event: eventName || 'message', data: dataLines.join('\n'), id: lastId};
    }

    private checkSize(chars: number) {
        if (chars > this.maxEventChars) {
            throw new ChatRunError(
                `The stream sent an event longer than ${this.maxEventChars} characters.`,
                'invalid-stream'
            );
        }
    }
}

/** Matches the cap in `@ag-ui/client`'s own SSE parser. */
const MAX_EVENT_CHARS = 10 * 1024 * 1024;

const LINE_BREAK = /\r\n|\r|\n/;
