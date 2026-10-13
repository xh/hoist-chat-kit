import {isPlainObject} from 'lodash';
import {describe, expect, it} from 'vitest';
import {parsePartialJson} from './parsePartialJson';

/**
 * Best-effort parsing of tool call arguments while they stream. Tool cards show these arguments
 * live, so each prefix of a document must give the most complete value it can - and never throw.
 */
describe('parsePartialJson', () => {
    it.each([
        ['complete JSON', '{"city": "Paris", "days": 3}', {city: 'Paris', days: 3}],
        ['an open object', '{', {}],
        ['an unterminated string value', '{"city": "New Yo', {city: 'New Yo'}],
        ['a partial first key', '{"ci', {}],
        ['a key with no value yet', '{"city": "Paris", "da', {city: 'Paris'}],
        ['a key awaiting its colon', '{"city": "Paris", "days"', {city: 'Paris'}],
        ['a key awaiting its value', '{"city": "Paris", "days": ', {city: 'Paris'}],
        ['a trailing comma', '{"city": "Paris",', {city: 'Paris'}],
        ['a number at the end', '{"days": 12', {days: 12}],
        ['an incomplete number', '{"temp": 1.', {}],
        ['an incomplete literal', '{"metric": tru', {}],
        ['nested containers', '{"a": {"b": [1, 2, {"c": "x', {a: {b: [1, 2, {c: 'x'}]}}],
        ['an array of strings', '["a", "b', ['a', 'b']],
        ['an escaped quote', '{"q": "say \\"hi', {q: 'say "hi'}],
        ['a partial escape sequence', '{"q": "line\\', {q: 'line'}],
        ['a partial unicode escape', '{"q": "caf\\u00', {q: 'caf'}]
    ])('recovers %s', (_, text, expected) => {
        expect(parsePartialJson(text)).toEqual(expected);
    });

    it('gives an object for every prefix of an object document', () => {
        const input = {city: 'Paris', units: ['C', 'F'], days: 3, metric: true},
            doc = JSON.stringify(input),
            values = Array.from({length: doc.length}, (_, idx) =>
                parsePartialJson(doc.slice(0, idx + 1))
            );

        expect(values.every(isPlainObject)).toBe(true);
        expect(values.at(-1)).toEqual(input);
    });

    it('returns null when no value can be recovered', () => {
        expect(parsePartialJson('')).toBeNull();
        expect(parsePartialJson('  ')).toBeNull();
        expect(parsePartialJson(null)).toBeNull();
        expect(parsePartialJson('nul')).toBeNull();
    });
});
