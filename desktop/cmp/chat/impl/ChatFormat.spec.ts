import {describe, expect, it} from 'vitest';
import {
    formatElapsed,
    formatFileSize,
    formatHost,
    formatStallDuration,
    formatTickingElapsed,
    humanizeToolName
} from './ChatFormat';

describe('formatElapsed', () => {
    it('shows tenths of a second under ten seconds', () => {
        expect(formatElapsed(0)).toBe('0.0s');
        expect(formatElapsed(840)).toBe('0.8s');
        expect(formatElapsed(4249)).toBe('4.2s');
    });

    it('shows whole seconds under a minute, then minutes and seconds', () => {
        expect(formatElapsed(12_400)).toBe('12s');
        expect(formatElapsed(65_000)).toBe('1m 5s');
        expect(formatElapsed(120_000)).toBe('2m');
    });

    it('returns null for a missing or negative duration', () => {
        expect(formatElapsed(null)).toBeNull();
        expect(formatElapsed(-1)).toBeNull();
    });
});

describe('formatTickingElapsed', () => {
    it('appears at 1 s and counts whole seconds, then minutes and padded seconds', () => {
        expect(formatTickingElapsed(999)).toBeNull();
        expect(formatTickingElapsed(1000)).toBe('1s');
        expect(formatTickingElapsed(59_999)).toBe('59s');
        expect(formatTickingElapsed(62_000)).toBe('1m 02s');
        expect(formatTickingElapsed(300_000)).toBe('5m 00s');
    });
});

describe('formatStallDuration', () => {
    it('counts whole seconds to 59, then whole minutes', () => {
        expect(formatStallDuration(30_000)).toBe('30s');
        expect(formatStallDuration(59_999)).toBe('59s');
        expect(formatStallDuration(60_000)).toBe('1m');
        expect(formatStallDuration(149_000)).toBe('2m');
    });
});

describe('formatFileSize', () => {
    it('picks a unit to suit the size', () => {
        expect(formatFileSize(512)).toBe('512 B');
        expect(formatFileSize(1536)).toBe('1.5 KB');
        expect(formatFileSize(12 * 1024)).toBe('12 KB');
        expect(formatFileSize(3.4 * 1024 * 1024)).toBe('3.4 MB');
    });

    it('returns null for a missing size', () => {
        expect(formatFileSize(null)).toBeNull();
    });
});

describe('humanizeToolName', () => {
    it('turns snake, kebab and camel case into a sentence-case title', () => {
        expect(humanizeToolName('get_weather')).toBe('Get weather');
        expect(humanizeToolName('get-weather-forecast')).toBe('Get weather forecast');
        expect(humanizeToolName('getWeather')).toBe('Get weather');
    });

    it('keeps acronyms', () => {
        expect(humanizeToolName('fetchURLContent')).toBe('Fetch URL content');
        expect(humanizeToolName('run_SQL')).toBe('Run SQL');
    });
});

describe('formatHost', () => {
    it('returns the host without a www prefix', () => {
        expect(formatHost('https://www.xh.io/docs?q=1')).toBe('xh.io');
        expect(formatHost('https://docs.xh.io')).toBe('docs.xh.io');
    });

    it('returns the input when it is not a URL', () => {
        expect(formatHost('not a url')).toBe('not a url');
        expect(formatHost(null)).toBeNull();
    });
});
