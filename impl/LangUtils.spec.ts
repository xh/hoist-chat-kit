import {describe, expect, it, onTestFinished, vi} from 'vitest';
import {genChatId, getOwn} from './LangUtils';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * Ids go to a backend and into stored history, so apps rely on them being version 4 UUIDs that are
 * unique across sessions, over HTTPS or plain HTTP alike.
 */
describe('genChatId', () => {
    it('returns a version 4 UUID', () => {
        expect(genChatId()).toMatch(UUID_V4);
    });

    it('returns a new id on each call', () => {
        const ids = new Set(Array.from({length: 1000}, () => genChatId()));
        expect(ids.size).toBe(1000);
    });

    it('builds a version 4 UUID when the browser has no randomUUID, as over plain HTTP', () => {
        const {getRandomValues} = crypto;
        vi.stubGlobal('crypto', {getRandomValues: getRandomValues.bind(crypto)});
        onTestFinished(() => {
            vi.unstubAllGlobals();
        });

        const ids = Array.from({length: 1000}, () => genChatId());
        ids.forEach(it => expect(it).toMatch(UUID_V4));
        expect(new Set(ids).size).toBe(1000);
    });
});

/** Apps rely on a name from a model or a backend never resolving to a built-in of `Object`. */
describe('getOwn', () => {
    const map: Record<string, string> = {weather: 'Weather', 'a.b': 'Dotted'};

    it('returns the value of an own property', () => {
        expect(getOwn(map, 'weather')).toBe('Weather');
        expect(getOwn(map, 'a.b')).toBe('Dotted');
    });

    it('returns null for a name that only Object.prototype has', () => {
        expect(getOwn(map, 'constructor')).toBeNull();
        expect(getOwn(map, 'toString')).toBeNull();
        expect(getOwn(map, '__proto__')).toBeNull();
    });

    it('returns null for a missing name, a non-string key or no object', () => {
        expect(getOwn(map, 'missing')).toBeNull();
        expect(getOwn(map, null)).toBeNull();
        expect(getOwn(null, 'weather')).toBeNull();
    });
});
