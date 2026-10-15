import {isArray, isFinite, isPlainObject, isString, keyBy, omit} from 'lodash';
import type {ReactNode} from 'react';
import type {ColumnSpec} from '@xh/hoist/cmp/grid';
import type {PlainObject} from '@xh/hoist/core';
import {type FieldSpec, type FieldType, genDisplayName} from '@xh/hoist/data';
import {fmtDate, fmtNumber} from '@xh/hoist/format';
import {Icon} from '@xh/hoist/icon';
import {
    applyDataView,
    CHAT_DATA_ROW_ID,
    type ChatDataColumn,
    type ChatDataColumnType,
    type ChatDataFrame,
    type ChatDataUnits,
    type ChatDataView,
    findDataViewProblems
} from '../../../../genui';
import {fmtChatUiNumber} from '../ChatUiFormat';
import type {ChatUiNumberFormat} from '../Types';

/**
 * A column of a result table, as both tiers show it: the inline preview and the full grid. Each
 * column is keyed by its position, so that any name in the data - `id`, one with a dot, a
 * duplicate - is safe as a Hoist field.
 * @internal
 */
export interface ChatUiTableColumn {
    /** Key of the column's values in a table record - `col0`, `col1`... */
    key: string;

    /** Name of the column in the data. */
    name: string;

    /** Header, with the unit of scaled numbers, such as `Gross (M)`. */
    label: string;

    type: ChatDataColumnType;

    /** How numbers display - one of the kit's formats. */
    format: ChatUiNumberFormat;

    /** Decimal places for numbers, or null for the format's default. */
    decimals: number;
}

/** What the inline preview of a result shows, and what it leaves for the full grid. @internal */
export interface ChatUiTablePreview {
    /** The columns shown, in order. */
    columns: ChatUiTableColumn[];

    /** The rows shown, as table records. */
    records: PlainObject[];

    /** Rows in the result, or null if not known - a filter over rows not yet loaded. */
    totalRows: number;

    /** Columns in the result. */
    totalColumns: number;

    /** True if the preview leaves rows or columns out, so that the full grid has more to show. */
    hasMore: boolean;
}

/** Columns for a frame's columns, in order, keyed by position. @internal */
export function toTableColumns(columns: ChatDataColumn[]): ChatUiTableColumn[] {
    return columns.map((column, idx) => {
        const label = column.label ?? genDisplayName(column.name),
            unit = column.units ? UNIT_LABELS[column.units] : null;
        return {
            key: `col${idx}`,
            name: column.name,
            label: unit ? `${label} (${unit})` : label,
            type: column.type ?? 'string',
            format: NUMBER_FORMATS.includes(column.format as ChatUiNumberFormat)
                ? (column.format as ChatUiNumberFormat)
                : 'number',
            decimals: isFinite(column.decimals) ? column.decimals : null
        };
    });
}

/**
 * The columns of a view, in its order, with its labels and formats - all of the frame's columns
 * if the view names none. The view must fit the columns - see `findDataViewProblems()`.
 * @internal
 */
export function getViewColumns(columns: ChatDataColumn[], view: ChatDataView): ChatDataColumn[] {
    if (!view?.columns) return columns;
    const byName = keyBy(columns, 'name');
    return view.columns.map(it => {
        if (isString(it)) return byName[it];
        const ret = {...byName[it.name]};
        if (it.label != null) ret.label = it.label;
        if (it.format != null) ret.format = it.format;
        return ret;
    });
}

/**
 * Table records for rows of a frame: each column's value under its key, and the row's id.
 * @internal
 */
export function toTableRecords(rows: PlainObject[], columns: ChatUiTableColumn[]): PlainObject[] {
    return rows.map((row, idx) => {
        const ret: PlainObject = {[CHAT_DATA_ROW_ID]: row[CHAT_DATA_ROW_ID] ?? idx};
        columns.forEach(it => (ret[it.key] = row[it.name] ?? null));
        return ret;
    });
}

/**
 * A value formatted for a cell, in the preview and the full grid alike: numbers in their column's
 * format with ledger negatives, dates as `YYYY-MM-DD`, timestamps as `YYYY-MM-DD HH:mm`, true as a
 * check, and nothing for an empty value.
 * @internal
 */
export function formatTableCell(value: unknown, column: ChatUiTableColumn): ReactNode {
    if (value == null || value === '') return null;
    switch (column.type) {
        case 'number':
        case 'integer': {
            const num = toNumber(value);
            if (num == null) return null;
            return fmtChatUiNumber(num, column.format, getDecimals(column), {ledger: true});
        }
        case 'date':
        case 'datetime':
            return formatDateValue(value, column.type);
        case 'boolean':
            return value === true ? Icon.check() : null;
        default:
            return toText(value);
    }
}

/** A cell value as plain text, for a tooltip or an export. @internal */
export function formatTableText(value: unknown, column: ChatUiTableColumn): string {
    if (value == null || value === '') return '';
    switch (column.type) {
        case 'number':
        case 'integer': {
            const num = toNumber(value);
            if (num == null) return '';
            return fmtChatUiNumber(num, column.format, getDecimals(column), {
                ledger: true,
                forceLedgerAlign: false,
                asHtml: true
            }) as string;
        }
        case 'date':
        case 'datetime':
            return (formatDateValue(value, column.type) as string) ?? '';
        case 'boolean':
            return value === true ? 'true' : '';
        default:
            return toText(value);
    }
}

/** How a column's cells align: numbers right, booleans centered, the rest left. @internal */
export function getAlign(column: ChatUiTableColumn): 'left' | 'right' | 'center' {
    switch (column.type) {
        case 'number':
        case 'integer':
            return 'right';
        case 'boolean':
            return 'center';
        default:
            return 'left';
    }
}

/** Store fields for the full grid. @internal */
export function toGridFieldSpecs(columns: ChatUiTableColumn[]): FieldSpec[] {
    return columns.map(it => ({
        name: it.key,
        type: FIELD_TYPES[it.type] ?? 'auto',
        displayName: it.label
    }));
}

/**
 * Hoist column specs for the full grid, formatted as the preview formats its cells. Columns not
 * in `visibleKeys` start hidden, for the user to add from the column chooser.
 * @internal
 */
export function toGridColumnSpecs(
    columns: ChatUiTableColumn[],
    visibleKeys: string[] = null
): ColumnSpec[] {
    return columns.map(column => {
        const isNumber = column.type === 'number' || column.type === 'integer',
            isDate = column.type === 'date' || column.type === 'datetime';
        return {
            field: column.key,
            headerName: column.label,
            align: getAlign(column),
            headerAlign: getAlign(column),
            hidden: visibleKeys ? !visibleKeys.includes(column.key) : false,
            minWidth: isNumber ? NUMBER_MIN_WIDTH : TEXT_MIN_WIDTH,
            maxWidth: isNumber || isDate ? null : TEXT_MAX_WIDTH,
            renderer: v => formatTableCell(v, column),
            // Dates may arrive as epoch millis - export them as they show.
            exportValue: isDate ? v => formatTableText(v, column) : null,
            tooltip: column.type === 'string' ? v => toText(v) : null
        };
    });
}

/**
 * The inline preview of a result: the view applied to the rows at hand, then its first rows and
 * columns.
 *
 * @param frame - the rows at hand - all of the result's, or its first page.
 * @param view - the card's view. Its columns choose and order the columns shown.
 * @param opts - whether `frame` holds every row of the result, and the most rows and columns to
 *      show.
 * @throws if the view does not fit the frame's columns.
 * @internal
 */
export function toTablePreview(
    frame: ChatDataFrame,
    view: ChatDataView,
    opts: {isComplete: boolean; maxRows: number; maxColumns: number}
): ChatUiTablePreview {
    const problems = findDataViewProblems(view ?? {}, frame.columns);
    if (problems.length) throw new Error(`Invalid data view: ${problems.join('; ')}`);

    const {isComplete, maxRows, maxColumns} = opts,
        applied = applyDataView(frame, omit(view ?? {}, 'columns')),
        viewColumns = getViewColumns(applied.columns, view),
        columns = toTableColumns(viewColumns.slice(0, Math.max(1, maxColumns))),
        records = toTableRecords(applied.rows.slice(0, maxRows), columns),
        top = view?.top ?? Infinity;

    let totalRows: number = null;
    if (isComplete) {
        totalRows = Math.min(applied.totalRows, top);
    } else if (!view?.filter?.length) {
        totalRows = Math.min(frame.totalRows, top);
    }

    return {
        columns,
        records,
        totalRows,
        totalColumns: frame.columns.length,
        hasMore:
            totalRows == null || totalRows > records.length || frame.columns.length > columns.length
    };
}

/**
 * What the preview's footer says it shows: "Showing 8 of 1,240 rows · 6 of 14 columns", or
 * "3 rows" for a result that fits. Shorter at compact density.
 * @internal
 */
export function describePreview(preview: ChatUiTablePreview, compact: boolean): string {
    const {records, totalRows, columns, totalColumns} = preview,
        shown = records.length,
        rowsHidden = totalRows == null || totalRows > shown,
        colsHidden = totalColumns > columns.length,
        colWord = compact ? 'cols' : 'columns',
        cols = colsHidden ? ` · ${columns.length} of ${fmtCount(totalColumns)} ${colWord}` : '';

    if (!rowsHidden) return `${fmtRows(totalRows)}${cols}`;
    if (totalRows == null) return `${compact ? 'First' : 'Showing the first'} ${shown}${cols}`;
    const rows = `${shown} of ${fmtRows(totalRows)}`;
    return compact ? `${rows}${cols}` : `Showing ${rows}${cols}`;
}

/** A count of rows, as "1 row" or "1,240 rows". @internal */
export function fmtRows(count: number): string {
    return `${fmtCount(count)} ${count === 1 ? 'row' : 'rows'}`;
}

/** A count with thousands separators. @internal */
export function fmtCount(count: number): string {
    return fmtNumber(count, {precision: 0, asHtml: true}) as string;
}

//------------------
// Implementation
//------------------
const NUMBER_FORMATS: ChatUiNumberFormat[] = ['number', 'percent', 'currency', 'none'];

const UNIT_LABELS: Record<ChatDataUnits, string> = {
    none: null,
    thousands: 'K',
    millions: 'M',
    billions: 'B'
};

const FIELD_TYPES: Partial<Record<ChatDataColumnType, FieldType>> = {
    number: 'number',
    integer: 'number',
    boolean: 'bool'
};

const NUMBER_MIN_WIDTH = 70,
    TEXT_MIN_WIDTH = 60,
    TEXT_MAX_WIDTH = 320;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/,
    DATE_FMT = 'YYYY-MM-DD',
    DATETIME_FMT = 'YYYY-MM-DD HH:mm';

function getDecimals(column: ChatUiTableColumn): number {
    if (column.decimals != null) return column.decimals;
    return column.type === 'integer' && column.format !== 'percent' ? 0 : null;
}

function toNumber(value: unknown): number {
    const ret = isString(value) && value.trim() !== '' ? Number(value) : value;
    return isFinite(ret) ? (ret as number) : null;
}

function toText(value: unknown): string {
    if (isString(value)) return value;
    return isPlainObject(value) || isArray(value) ? JSON.stringify(value) : String(value);
}

// Dates arrive as epoch millis, or as strings: a `YYYY-MM-DD` date shows as written.
function formatDateValue(value: unknown, type: 'date' | 'datetime'): ReactNode {
    if (type === 'date' && isString(value) && DATE_RE.test(value)) return value;
    const ms = isFinite(value) ? (value as number) : isString(value) ? Date.parse(value) : NaN;
    if (!Number.isFinite(ms)) return toText(value);
    return fmtDate(ms, {fmt: type === 'date' ? DATE_FMT : DATETIME_FMT, asHtml: true});
}
