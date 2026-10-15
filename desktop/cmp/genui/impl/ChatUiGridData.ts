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
import type {PlainObject} from '@xh/hoist/core';
import {genDisplayName} from '@xh/hoist/data';
import {LocalDate} from '@xh/hoist/utils/datetime';
import {CHAT_DATA_ROW_ID, type ChatDataFrame, type ChatDataView} from '../../../../genui';
import type {ChatUiGridColumn, ChatUiGridColumnType, ChatUiGridSpecProps} from '../ChatUiGrid';

/** Header for a column - its `headerName`, or its field, humanized. */
export function getHeaderName(column: ChatUiGridColumn): string {
    return column.headerName ?? genDisplayName(column.field);
}

/**
 * A frame of the rows the model wrote inline, for the table's two tiers: each value converted to
 * its column's type, and a value that does not fit as null. Dates stay `YYYY-MM-DD` strings.
 *
 * @param columns - the grid's columns.
 * @param rows - rows as written by the model.
 * @param isPartial - true while the rows stream. The last row is left out, as it may be cut short.
 */
export function toInlineFrame(
    columns: ChatUiGridColumn[],
    rows: PlainObject[],
    isPartial: boolean
): ChatDataFrame {
    const validRows = isArray(rows)
            ? (isPartial ? dropRight(rows) : rows).filter(isPlainObject)
            : [],
        frameRows = validRows.map((row, rowIdx) =>
            // Built with fromEntries, so that a field such as `__proto__` stays a plain key.
            Object.fromEntries([
                ...columns.map(it => [it.field, toCellValue(row[it.field], it.type)]),
                [CHAT_DATA_ROW_ID, rowIdx]
            ])
        );

    return {
        columns: columns.map(it => ({
            name: it.field,
            type: it.type ?? 'string',
            label: getHeaderName(it),
            format: it.format,
            decimals: it.decimals
        })),
        rows: frameRows,
        totalRows: frameRows.length
    };
}

/**
 * The view of an inline grid: its `sortBy`, if the field names a column. A `sortBy` that does
 * not - still streaming, or wrong - is left out, so that the rows still show.
 */
export function toInlineView(sortBy: string, columns: ChatUiGridColumn[]): ChatDataView {
    return isSortField(sortBy, columns) ? {sortBy} : {};
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

    if (sortBy && !isSortField(sortBy, columns)) {
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

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const TYPE_HINTS: Record<ChatUiGridColumnType, string> = {
    string: 'expected a string',
    number: 'expected a number',
    date: 'expected a date string, YYYY-MM-DD',
    boolean: 'expected true or false'
};

function isSortField(sortBy: string, columns: ChatUiGridColumn[]): boolean {
    if (!isString(sortBy)) return false;
    const field = sortBy.split('|')[0];
    return columns.some(it => it.field === field);
}

function toCellValue(value: unknown, type: ChatUiGridColumnType = 'string'): unknown {
    if (value == null) return null;
    switch (type) {
        case 'number':
            return isFinite(value) ? value : null;
        case 'boolean':
            return isBoolean(value) ? value : null;
        case 'date':
            return parseLocalDate(value) ? value : null;
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
