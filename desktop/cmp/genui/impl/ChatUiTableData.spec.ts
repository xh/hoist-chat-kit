import {render} from '@testing-library/react';
import {fragment} from '@xh/hoist/cmp/layout';
import {initTestAppAsync} from '@xh/hoist/test-support';
import {beforeAll, describe, expect, it} from 'vitest';
import type {ChatDataFrame} from '../../../../genui';
import {
    describePreview,
    formatTableCell,
    formatTableText,
    toGridColumnSpecs,
    toTableColumns,
    toTablePreview
} from './ChatUiTableData';

/**
 * The column formatting and preview rules that both tiers of a result table share (P4). Users rely
 * on a value reading the same in the preview and the full grid, and on the footer never hiding
 * what the preview leaves out.
 */
describe('ChatUiTableData', () => {
    beforeAll(() => initTestAppAsync());

    const [qty, price, pct, date, ts, open, name] = toTableColumns([
        {name: 'qty', type: 'integer'},
        {name: 'price', type: 'number', decimals: 2},
        {name: 'weight', type: 'number', format: 'percent'},
        {name: 'date', type: 'date'},
        {name: 'at', type: 'datetime'},
        {name: 'open', type: 'boolean'},
        {name: 'name', type: 'string', label: 'Instrument'}
    ]);

    describe('formatTableCell', () => {
        it('formats numbers by column, with ledger negatives', () => {
            expect(formatTableText(180000000, qty)).toBe('180,000,000');
            expect(formatTableText(-0.41, price)).toBe('(0.41)');
            expect(formatTableText(0.341, pct)).toBe('34.1%');
        });

        it('shows dates as YYYY-MM-DD, and timestamps with the time', () => {
            expect(formatTableText('2026-09-18', date)).toBe('2026-09-18');
            expect(formatTableText(new Date(2026, 9, 9, 15, 0).getTime(), ts)).toBe(
                '2026-10-09 15:00'
            );
        });

        it('shows true as a check icon and false as nothing', () => {
            const {container} = render(fragment(formatTableCell(true, open)));
            expect(container.querySelector('svg')).toBeTruthy();
            expect(formatTableCell(false, open)).toBeNull();
        });

        it('shows an empty value as an empty cell, never "null" or "NaN"', () => {
            [null, undefined, ''].forEach(v => expect(formatTableText(v, qty)).toBe(''));
            expect(formatTableText('n/a', qty)).toBe('');
            expect(formatTableText(null, name)).toBe('');
        });

        it('renders the full grid with the same formatter', () => {
            const [spec] = toGridColumnSpecs([price]),
                {container} = render(fragment((spec.renderer as any)(-0.41)));
            expect(container.textContent).toContain('(0.41)');
            expect(spec.align).toBe('right');
        });
    });

    describe('toTablePreview', () => {
        const frame: ChatDataFrame = {
            columns: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map(it => ({
                name: it,
                type: 'string'
            })),
            rows: Array.from({length: 30}, (_, idx) => ({a: `r${idx}`, b: 'x'})),
            totalRows: 1240
        };

        it('keeps the first rows and columns, and counts the whole result', () => {
            const preview = toTablePreview(
                frame,
                {},
                {isComplete: false, maxRows: 8, maxColumns: 6}
            );
            expect(preview.records).toHaveLength(8);
            expect(preview.columns.map(it => it.name)).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
            expect(describePreview(preview, false)).toBe(
                'Showing 8 of 1,240 rows · 6 of 8 columns'
            );
            expect(describePreview(preview, true)).toBe('8 of 1,240 rows · 6 of 8 cols');
        });

        it("keeps the view's column order, and never drops its first column", () => {
            const preview = toTablePreview(
                frame,
                {columns: ['h', 'a', 'b']},
                {isComplete: false, maxRows: 8, maxColumns: 1}
            );
            expect(preview.columns.map(it => it.name)).toEqual(['h']);
        });

        it('does not claim a total it cannot know - a filter over rows not yet loaded', () => {
            const preview = toTablePreview(
                frame,
                {filter: [{field: 'b', op: 'eq', value: 'x'}]},
                {isComplete: false, maxRows: 8, maxColumns: 6}
            );
            expect(preview.totalRows).toBeNull();
            expect(preview.hasMore).toBe(true);
        });

        it('throws for a view that names a column the frame does not have', () => {
            expect(() =>
                toTablePreview(
                    frame,
                    {columns: ['zz']},
                    {isComplete: true, maxRows: 8, maxColumns: 6}
                )
            ).toThrow('Invalid data view');
        });
    });
});
