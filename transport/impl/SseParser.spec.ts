import {describe, expect, it} from 'vitest';
import {ChatRunError} from '../../core';
import {type SseEvent, SseParser} from './SseParser';

/**
 * SseParser reads every SSE stream the kit consumes - AG-UI agent servers and relayed Anthropic
 * streams. Network chunks split the text anywhere, so a parser that assumes whole lines or whole
 * characters corrupts tokens or drops events only under real network conditions.
 */
describe('SseParser', () => {
    it('parses events with their names, data and ids', () => {
        const events = parse(
            'event: message_start\ndata: {"a":1}\nid: 7\n\n' + 'data: {"b":2}\n\n'
        );

        expect(events).toEqual([
            {event: 'message_start', data: '{"a":1}', id: '7'},
            {event: 'message', data: '{"b":2}', id: '7'}
        ]);
    });

    it('joins multi-line data with newlines', () => {
        expect(parse('data: line 1\ndata: line 2\ndata:\n\n')[0].data).toBe('line 1\nline 2\n');
    });

    it('removes only one leading space from a value', () => {
        expect(parse('data:  indented\ndata:none\n\n')[0].data).toBe(' indented\nnone');
    });

    it('skips comments, unknown fields, and blank lines with no data', () => {
        const events = parse(': keep-alive\n\nretry: 1000\nfoo: bar\n\ndata: x\n\n');
        expect(events).toEqual([{event: 'message', data: 'x', id: null}]);
    });

    it.each([
        ['LF', '\n'],
        ['CRLF', '\r\n'],
        ['CR', '\r']
    ])('accepts %s line endings', (_, eol) => {
        const events = parse(`event: a${eol}data: 1${eol}${eol}data: 2${eol}${eol}`);
        expect(events.map(it => [it.event, it.data])).toEqual([
            ['a', '1'],
            ['message', '2']
        ]);
    });

    it('handles chunk boundaries anywhere, including inside CRLF and multi-byte characters', () => {
        const text = 'event: delta\r\ndata: {"text":"héllo 👋"}\r\n\r\ndata: done\r\n\r\n',
            bytes = new TextEncoder().encode(text),
            expected = parse(text);

        // Split at every byte offset, so each boundary lands mid-line, mid-CRLF and mid-character.
        for (let idx = 1; idx < bytes.length; idx++) {
            const parser = new SseParser(),
                events = [...parser.feed(bytes.slice(0, idx)), ...parser.feed(bytes.slice(idx))];
            expect(events).toEqual(expected);
        }
        expect(expected[0].data).toBe('{"text":"héllo 👋"}');
    });

    it('does not treat a CR at the end of a chunk as an empty line', () => {
        const parser = new SseParser();
        expect(parser.feed('data: a\r')).toEqual([]);
        expect(parser.feed('\ndata: b\r\n\r\n')).toEqual([
            {event: 'message', data: 'a\nb', id: null}
        ]);
    });

    it('holds an incomplete event until its terminating blank line', () => {
        const parser = new SseParser();
        expect(parser.feed('data: partial')).toEqual([]);
        expect(parser.feed(' value\n')).toEqual([]);
        expect(parser.feed('\n')).toEqual([{event: 'message', data: 'partial value', id: null}]);
    });

    it('fails a line that grows past the size cap without ending', () => {
        const parser = new SseParser(10);
        expect(parser.feed('data: 12')).toEqual([]);
        expect(() => parser.feed('3456789')).toThrow(
            expect.objectContaining({name: 'ChatRunError', code: 'invalid-stream'})
        );
    });

    it('fails an event whose data lines grow past the size cap without a blank line', () => {
        const parser = new SseParser(10);
        expect(parser.feed('data: 1234\ndata: 5678\n')).toEqual([]);
        expect(() => parser.feed('data: 9\n')).toThrow(ChatRunError);
    });

    it('applies the size cap to each event, not the whole stream', () => {
        const parser = new SseParser(10);
        expect(parser.feed('data: 12345678\n\n'.repeat(3))).toHaveLength(3);
    });
});

//------------------
// Helpers
//------------------
function parse(text: string): SseEvent[] {
    return new SseParser().feed(text);
}
