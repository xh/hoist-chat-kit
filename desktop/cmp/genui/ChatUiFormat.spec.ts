import {describe, expect, it} from 'vitest';
import type {ChatUiNumberFormat} from './Types';
import {fmtChatUiNumber, getNumberFormatOptions} from './ChatUiFormat';

const fmt = (value: number, format?: ChatUiNumberFormat, decimals?: number) =>
    fmtChatUiNumber(value, format, decimals, {asHtml: true});

describe('fmtChatUiNumber', () => {
    it('formats numbers with separators and precision to suit the value', () => {
        expect(fmt(1234567)).toBe('1,234,567');
        expect(fmt(1234.5678, 'number', 2)).toBe('1,234.57');
    });

    it('shows a fraction as a percentage, with one decimal by default', () => {
        expect(fmt(0.125, 'percent')).toBe('12.5%');
        expect(fmt(0.125, 'percent', 0)).toBe('13%');
    });

    it('prefixes currency, with two decimals by default', () => {
        expect(fmt(1250000, 'currency')).toBe('$1,250,000.00');
        expect(fmt(1250000, 'currency', 0)).toBe('$1,250,000');
    });

    it('shows a number as is for the none format', () => {
        expect(fmt(2026, 'none')).toBe('2026');
        expect(fmt(10250.5, 'none')).toBe('10250.5');
    });

    it('formats null as an empty string', () => {
        expect(fmt(null, 'currency')).toBe('');
    });

    describe('compact', () => {
        const compact = (value: number, format?: ChatUiNumberFormat, decimals?: number) =>
            fmtChatUiNumber(value, format, decimals, {compact: true, asHtml: true});

        it('scales a large value to K, M, B or T, to three significant digits', () => {
            expect(compact(48500000000, 'currency')).toBe('$48.5B');
            expect(compact(123456789012, 'currency')).toBe('$123B');
            expect(compact(1250000)).toBe('1.25M');
            expect(compact(-2400000000000)).toBe('-2.4T');
            expect(compact(250000, 'currency', 0)).toBe('$250K');
        });

        it('takes the next unit for a value that would round up to 1000', () => {
            expect(compact(999800)).toBe('1M');
        });

        it('leaves smaller values, percentages and plain numbers in full', () => {
            expect(compact(99500, 'currency', 0)).toBe('$99,500');
            expect(compact(1250000, 'percent')).toBe('125,000,000.0%');
            expect(compact(20261013, 'none')).toBe('20261013');
        });
    });
});

describe('getNumberFormatOptions', () => {
    it('lets decimals override the default precision of each format', () => {
        expect(getNumberFormatOptions('number').precision).toBe('auto');
        expect(getNumberFormatOptions('percent', 3).precision).toBe(3);
        expect(getNumberFormatOptions('currency', 0).precision).toBe(0);
    });
});
