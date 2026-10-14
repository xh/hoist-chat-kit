import {
    countBy,
    dropRight,
    isArray,
    isBoolean,
    isFinite,
    isPlainObject,
    isString,
    keys
} from 'lodash';
import {
    boolCheck,
    type ColumnSpec,
    type GridSorterSpec,
    localDate,
    number
} from '@xh/hoist/cmp/grid';
import type {PlainObject} from '@xh/hoist/core';
import {type FieldSpec, type FieldType, genDisplayName} from '@xh/hoist/data';
import {LocalDate} from '@xh/hoist/utils/datetime';
import type {ChatUiGridColumn, ChatUiGridColumnType, ChatUiGridSpecProps} from '../ChatUiGrid';
import {fmtChatUiNumber} from '../ChatUiFormat';

/**
 * Key that holds the values of the column at `idx`, in the grid's store. Columns are keyed by
 * position, not by the model's field names, so that any name the model writes - `id`, one with a
 * dot, a duplicate - is safe as a Hoist field.
 */
export function getColumnKey(idx: number): string {
    return `col${idx}`;
}

/** Header for a column - its `headerName`, or its field, humanized. */
export function getHeaderName(column: ChatUiGridColumn): string {
    return column.headerName ?? genDisplayName(column.field);
}

/** Store fields for the grid's columns, typed to parse the values of each. */
export function toFieldSpecs(columns: ChatUiGridColumn[]): FieldSpec[] {
    return columns.map((column, idx) => ({
        name: getColumnKey(idx),
        type: FIELD_TYPES[column.type ?? 'string'],
        displayName: getHeaderName(column)
    }));
}

/**
 * Hoist column specs for the grid's columns, with a renderer to suit each type and format. No
 * column flexes, so that the grid can autosize each one to its content. Text columns stop at a
 * maximum width, and number columns keep a minimum, so that numbers stay readable when space is
 * short and the grid scrolls sideways instead.
 */
export function toColumnSpecs(columns: ChatUiGridColumn[]): ColumnSpec[] {
    return columns.map((column, idx) => {
        const base: ColumnSpec = {field: getColumnKey(idx), headerName: getHeaderName(column)};
        switch (column.type) {
            case 'number': {
                const {format, decimals} = column;
                return {
                    ...number,
                    ...base,
                    minWidth: NUMBER_MIN_WIDTH,
                    renderer: v => fmtChatUiNumber(v, format, decimals)
                };
            }
            case 'date':
                return {...localDate, ...base};
            case 'boolean':
                return {...boolCheck, ...base};
            default:
                return {...base, minWidth: TEXT_MIN_WIDTH, maxWidth: TEXT_MAX_WIDTH};
        }
    });
}

/**
 * Store data for the grid: one record per row, with each column's value under its key and
 * converted to its type. A value that does not fit its column's type becomes null.
 *
 * @param rows - rows as written by the model.
 * @param columns - the grid's columns.
 * @param isPartial - true while the rows stream. The last row is left out, as it may be cut short.
 */
export function toGridData(
    rows: PlainObject[],
    columns: ChatUiGridColumn[],
    isPartial: boolean
): PlainObject[] {
    if (!isArray(rows)) return [];
    return (isPartial ? dropRight(rows) : rows).filter(isPlainObject).map((row, rowIdx) => {
        const ret: PlainObject = {id: rowIdx};
        columns.forEach((column, idx) => {
            ret[getColumnKey(idx)] = toCellValue(row[column.field], column.type);
        });
        return ret;
    });
}

/**
 * The grid's sort, from a `sortBy` such as `pnl|desc`. Null if the field names no column.
 */
export function toGridSorter(sortBy: string, columns: ChatUiGridColumn[]): GridSorterSpec {
    if (!sortBy) return null;
    const [field, sort = 'asc'] = sortBy.split('|'),
        idx = columns.findIndex(it => it.field === field);
    return idx < 0 ? null : {colId: getColumnKey(idx), sort: sort as GridSorterSpec['sort']};
}

/**
 * Checks on complete grid props that the schema cannot express: unique fields, a `sortBy` that
 * names a column, and values that fit their column's type.
 *
 * @returns a message for each problem - at most a few for the rows, so that the model gets a
 *      short, readable list.
 */
export function validateGridProps(props: ChatUiGridSpecProps): string[] {
    const {columns = [], rows = [], sortBy} = props,
        errors: string[] = [];

    const counts = countBy(columns, 'field'),
        dupes = keys(counts).filter(it => counts[it] > 1);
    if (dupes.length) errors.push(`columns: duplicate field ${dupes.join(', ')}`);

    if (sortBy && !toGridSorter(sortBy, columns)) {
        errors.push(`sortBy: '${sortBy.split('|')[0]}' is not a column field`);
    }

    const rowErrors: string[] = [];
    rows.forEach((row, rowIdx) => {
        columns.forEach(({field, type = 'string'}) => {
            const value = row[field];
            if (value != null && toCellValue(value, type) == null) {
                rowErrors.push(`rows[${rowIdx}].${field}: ${TYPE_HINTS[type]}`);
            }
        });
    });
    errors.push(...rowErrors.slice(0, MAX_ROW_ERRORS));
    if (rowErrors.length > MAX_ROW_ERRORS) {
        errors.push(`...and ${rowErrors.length - MAX_ROW_ERRORS} more values of the wrong type`);
    }
    return errors;
}

//------------------
// Implementation
//------------------
const MAX_ROW_ERRORS = 5;

const NUMBER_MIN_WIDTH = 70,
    TEXT_MIN_WIDTH = 60,
    TEXT_MAX_WIDTH = 320;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const FIELD_TYPES: Record<ChatUiGridColumnType, FieldType> = {
    string: 'string',
    number: 'number',
    date: 'localDate',
    boolean: 'bool'
};

const TYPE_HINTS: Record<ChatUiGridColumnType, string> = {
    string: 'expected a string',
    number: 'expected a number',
    date: 'expected a date string, YYYY-MM-DD',
    boolean: 'expected true or false'
};

function toCellValue(value: unknown, type: ChatUiGridColumnType = 'string'): unknown {
    if (value == null) return null;
    switch (type) {
        case 'number':
            return isFinite(value) ? value : null;
        case 'boolean':
            return isBoolean(value) ? value : null;
        case 'date':
            return parseLocalDate(value);
        default:
            if (isString(value)) return value;
            return isPlainObject(value) || isArray(value) ? JSON.stringify(value) : String(value);
    }
}

function parseLocalDate(value: unknown): LocalDate {
    if (!isString(value) || !DATE_RE.test(value)) return null;
    try {
        return LocalDate.get(value);
    } catch {
        // A string of the right shape that is not a real date, such as 2026-02-31.
        return null;
    }
}
