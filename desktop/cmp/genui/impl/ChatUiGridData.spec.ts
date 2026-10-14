import {LocalDate} from '@xh/hoist/utils/datetime';
import {describe, expect, it} from 'vitest';
import type {ChatUiGridColumn} from '../ChatUiGrid';
import {
    toColumnSpecs,
    toFieldSpecs,
    toGridData,
    toGridSorter,
    validateGridProps
} from './ChatUiGridData';

const COLUMNS: ChatUiGridColumn[] = [
    {field: 'id', headerName: 'Trade'},
    {field: 'trade_date', type: 'date'},
    {field: 'pnl', type: 'number', format: 'currency', decimals: 0},
    {field: 'settled', type: 'boolean'}
];

describe('toFieldSpecs', () => {
    it('keys fields by column position, typed to suit each column', () => {
        expect(toFieldSpecs(COLUMNS)).toEqual([
            {name: 'col0', type: 'string', displayName: 'Trade'},
            {name: 'col1', type: 'localDate', displayName: 'Trade Date'},
            {name: 'col2', type: 'number', displayName: 'Pnl'},
            {name: 'col3', type: 'bool', displayName: 'Settled'}
        ]);
    });
});

describe('toColumnSpecs', () => {
    it('maps each column type to a Hoist column with a matching renderer', () => {
        const [trade, date, pnl, settled] = toColumnSpecs(COLUMNS);
        expect(trade).toMatchObject({field: 'col0', headerName: 'Trade'});
        expect(date).toMatchObject({field: 'col1', align: 'right'});
        expect(pnl).toMatchObject({field: 'col2', align: 'right'});
        expect(settled).toMatchObject({field: 'col3', align: 'center'});
    });

    it('leaves every column free to autosize, with bounds that keep numbers readable', () => {
        const [trade, date, pnl, settled] = toColumnSpecs(COLUMNS);
        [trade, date, pnl, settled].forEach(it => expect(it.flex).toBeFalsy());
        expect(trade.maxWidth).toBeGreaterThan(0);
        expect(pnl.minWidth).toBeGreaterThan(0);
    });

    it('renders numbers in the column format', () => {
        const pnl = toColumnSpecs(COLUMNS)[2],
            renderer = pnl.renderer as (v: number) => unknown;
        expect(renderer(-42000)).toBeTruthy();
        expect(renderer(null)).toBe('');
    });
});

describe('toGridData', () => {
    const rows = [
        {id: 'T1', trade_date: '2026-10-01', pnl: 1200, settled: true},
        {id: 'T2', trade_date: 'yesterday', pnl: '12', settled: 'yes'},
        {id: 'T3', trade_date: '2026-10-0', pnl: 99}
    ];

    it('converts values to their column types, with values that do not fit as null', () => {
        expect(toGridData(rows, COLUMNS, false)).toEqual([
            {id: 0, col0: 'T1', col1: LocalDate.get('2026-10-01'), col2: 1200, col3: true},
            {id: 1, col0: 'T2', col1: null, col2: null, col3: null},
            {id: 2, col0: 'T3', col1: null, col2: 99, col3: null}
        ]);
    });

    it('leaves out the last row while the rows stream, as it may be cut short', () => {
        expect(toGridData(rows, COLUMNS, true).map(it => it.col0)).toEqual(['T1', 'T2']);
    });

    it('returns no rows for missing rows', () => {
        expect(toGridData(undefined, COLUMNS, true)).toEqual([]);
    });
});

describe('toGridSorter', () => {
    it('maps a field and direction to the column key', () => {
        expect(toGridSorter('pnl|desc', COLUMNS)).toEqual({colId: 'col2', sort: 'desc'});
        expect(toGridSorter('id', COLUMNS)).toEqual({colId: 'col0', sort: 'asc'});
    });

    it('returns null for a field that names no column', () => {
        expect(toGridSorter('qty|desc', COLUMNS)).toBeNull();
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
