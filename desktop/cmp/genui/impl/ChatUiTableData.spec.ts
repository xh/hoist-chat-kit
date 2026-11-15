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

        it('draws a number against the maximum of its column, as a bar beside the number', () => {
            const [usage, share] = toTableColumns([
                    {name: 'used', type: 'number', label: 'Used', max: 200},
                    {name: 'share', type: 'number', format: 'percent', max: 1}
                ]),
                {container} = render(
                    fragment(formatTableCell(50, usage), formatTableCell(0.341, share))
                ),
                [usageCell, shareCell] = container.querySelectorAll('.xh-chat-ui-table-bar'),
                fill = (cell: Element) =>
                    cell.querySelector<HTMLElement>('.xh-progress-bar__fill').style.width;

            // The number shows in its format. The bar shows no figure of its own.
            expect(usageCell.textContent).toContain('50');
            expect(shareCell.textContent).toContain('34.1%');
            expect(container.querySelector('.xh-progress-bar__value-label')).toBeNull();
            expect(fill(usageCell)).toBe('25%');
            expect(fill(shareCell)).toBe('34.1%');
            expect(usageCell.querySelector('[role="progressbar"]').getAttribute('aria-label')).toBe(
                'Used'
            );
        });

        it('fills or empties the bar of a number outside the range, and still shows the number', () => {
            const [usage] = toTableColumns([{name: 'used', type: 'number', max: 200}]),
                {container} = render(
                    fragment(formatTableCell(500, usage), formatTableCell(-20, usage))
                ),
                fills = [...container.querySelectorAll<HTMLElement>('.xh-progress-bar__fill')];

            expect(fills.map(it => it.style.width)).toEqual(['100%', '0%']);
            expect(container.textContent).toContain('500');
            expect(container.textContent).toContain('(20)');
        });

        it('sorts, searches and exports a bar column as its plain number', () => {
            const [usage] = toTableColumns([{name: 'used', type: 'number', max: 200}]),
                [spec] = toGridColumnSpecs([usage]);

            expect(formatTableText(50, usage)).toBe('50');
            expect(spec.exportValue).toBeNull();
            expect(spec.align).toBe('right');
        });

        it('draws no bar for a maximum that is not above zero, or on a column it does not suit', () => {
            const columns = toTableColumns([
                {name: 'a', type: 'number', max: 0},
                {name: 'b', type: 'number', max: -5},
                {name: 'c', type: 'number', max: 'high' as any},
                {name: 'd', type: 'string', max: 10},
                // A view scaled these numbers, and left the maximum as it was.
                {name: 'e', type: 'number', max: 5000000, units: 'millions'}
            ]);

            expect(columns.map(it => it.max)).toEqual([null, null, null, null, null]);
            const {container} = render(fragment(formatTableCell(4, columns[0])));
            expect(container.textContent).toContain('4');
            expect(container.querySelector('.xh-progress-bar')).toBeNull();
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

        it('says that a sort over the first page covers only that page', () => {
            const preview = toTablePreview(
                frame,
                {sortBy: 'a|desc'},
                {isComplete: false, maxRows: 8, maxColumns: 6}
            );
            expect(preview.sortedWithin).toBe(30);
            expect(describePreview(preview, false)).toBe(
                'Showing 8 of 1,240 rows · 6 of 8 columns · sorted within the first 30'
            );
            expect(describePreview(preview, true)).toBe(
                '8 of 1,240 rows · 6 of 8 cols · sorted in first 30'
            );
        });

        it('keeps the full tier for the top rows of a sort over the first page', () => {
            const preview = toTablePreview(
                frame,
                {sortBy: 'a|desc', top: 1},
                {isComplete: false, maxRows: 8, maxColumns: 8}
            );
            expect(preview.records).toHaveLength(1);
            expect(preview.hasMore).toBe(true);
            expect(describePreview(preview, false)).toBe('1 row · sorted within the first 30');
        });

        it('makes no note of a sort over the whole result', () => {
            const preview = toTablePreview(
                {...frame, totalRows: 30},
                {sortBy: 'a|desc', top: 1},
                {isComplete: true, maxRows: 8, maxColumns: 8}
            );
            expect(preview.sortedWithin).toBeNull();
            expect(preview.hasMore).toBe(false);
            expect(describePreview(preview, false)).toBe('1 row');
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
