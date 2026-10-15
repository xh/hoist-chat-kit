import {describe, expect, it} from 'vitest';
import type {ChatUiGridColumn} from '../ChatUiGrid';
import {toInlineFrame, toInlineView, validateGridProps} from './ChatUiGridData';

const COLUMNS: ChatUiGridColumn[] = [
    {field: 'id', headerName: 'Trade'},
    {field: 'trade_date', type: 'date'},
    {field: 'pnl', type: 'number', format: 'currency', decimals: 0},
    {field: 'settled', type: 'boolean'}
];

describe('toInlineFrame', () => {
    const rows = [
        {id: 'T1', trade_date: '2026-10-01', pnl: 1200, settled: true},
        {id: 'T2', trade_date: 'yesterday', pnl: '12', settled: 'yes'},
        {id: 'T3', trade_date: '2026-02-31', pnl: 99}
    ];

    it('converts values to their column types, with values that do not fit as null', () => {
        expect(toInlineFrame(COLUMNS, rows, false).rows).toEqual([
            {id: 'T1', trade_date: '2026-10-01', pnl: 1200, settled: true, xhChatRowId: 0},
            {id: 'T2', trade_date: null, pnl: null, settled: null, xhChatRowId: 1},
            {id: 'T3', trade_date: null, pnl: 99, settled: null, xhChatRowId: 2}
        ]);
    });

    it('describes each column with its header, type and format', () => {
        expect(toInlineFrame(COLUMNS, rows, false).columns).toEqual([
            {name: 'id', type: 'string', label: 'Trade', format: undefined, decimals: undefined},
            {
                name: 'trade_date',
                type: 'date',
                label: 'Trade Date',
                format: undefined,
                decimals: undefined
            },
            {name: 'pnl', type: 'number', label: 'Pnl', format: 'currency', decimals: 0},
            {
                name: 'settled',
                type: 'boolean',
                label: 'Settled',
                format: undefined,
                decimals: undefined
            }
        ]);
    });

    it('leaves out the last row while the rows stream, as it may be cut short', () => {
        const frame = toInlineFrame(COLUMNS, rows, true);
        expect(frame.rows.map(it => it.id)).toEqual(['T1', 'T2']);
        expect(frame.totalRows).toBe(2);
    });

    it('returns no rows for missing rows', () => {
        expect(toInlineFrame(COLUMNS, undefined, true).rows).toEqual([]);
    });
});

describe('toInlineView', () => {
    it('sorts by a field that names a column', () => {
        expect(toInlineView('pnl|desc', COLUMNS)).toEqual({sortBy: 'pnl|desc'});
    });

    it('leaves out a sort by a field that names no column', () => {
        expect(toInlineView('qty|desc', COLUMNS)).toEqual({});
        expect(toInlineView(undefined, COLUMNS)).toEqual({});
    });
});

describe('validateGridProps', () => {
    it('accepts rows whose values fit their columns', () => {
        const rows = [{id: 'T1', trade_date: '2026-10-01', pnl: 1200, settled: null}];
        expect(validateGridProps({columns: COLUMNS, rows, sortBy: 'pnl|desc'})).toEqual([]);
    });

    it('reports duplicate fields, an unknown sort field and values of the wrong type', () => {
        const columns = [...COLUMNS, {field: 'pnl'}],
            rows = [{trade_date: '10/01/2026', pnl: '1,200'}];
        expect(validateGridProps({columns, rows, sortBy: 'qty'})).toEqual([
            'columns: duplicate field pnl',
            "sortBy: 'qty' is not a column field",
            'rows[0].trade_date: expected a date string, YYYY-MM-DD',
            'rows[0].pnl: expected a number'
        ]);
    });

    it('caps the errors reported for the rows', () => {
        const rows = Array.from({length: 8}, () => ({pnl: 'n/a'})),
            errors = validateGridProps({columns: COLUMNS, rows});
        expect(errors).toHaveLength(6);
        expect(errors[5]).toBe('...and 3 more values of the wrong type');
    });
});
