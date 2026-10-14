import type {PlainObject} from '@xh/hoist/core';
import {max} from 'lodash';

/** The type of the values in a {@link ChatDataColumn}. Dates and datetimes are epoch millis. */
export type ChatDataColumnType = 'string' | 'number' | 'integer' | 'date' | 'datetime' | 'boolean';

/** The display unit a {@link ChatDataView} scales numbers to. */
export type ChatDataUnits = 'none' | 'thousands' | 'millions' | 'billions';

/** One column of a {@link ChatDataFrame}. */
export interface ChatDataColumn {
    /** Name of the column - the field of its values in each row. */
    name: string;

    /** Type of the values. */
    type: ChatDataColumnType;

    /** Header for display. Defaults to the name, humanized, as a component sees fit. */
    label?: string;

    /**
     * How the values display, for the component that renders them - such as `currency`, `percent`
     * or `none` for numbers. The kit's own components take the formats of `fmtChatUiNumber`.
     */
    format?: string;

    /**
     * The unit the values were scaled to by {@link applyDataView}, so that a component can label
     * them - for example `millions`. Absent for unscaled values.
     */
    units?: ChatDataUnits;
}

/**
 * Tabular data by rows: the columns, a page of rows, and the size of the whole result. A frame
 * from a {@link ChatArtifactRegistry} gives each row a synthetic id in {@link CHAT_DATA_ROW_ID}.
 */
export interface ChatDataFrame {
    /** The columns, in display order. */
    columns: ChatDataColumn[];

    /** A page of rows, each keyed by column name. */
    rows: PlainObject[];

    /** Number of rows in the whole result, of which `rows` may be a page. */
    totalRows: number;
}

/**
 * Tabular data by columns - a list of values per column name - as many data servers return it.
 * Convert one with {@link fromColumnar}.
 */
export interface ChatColumnarFrame {
    /** The columns, in display order. */
    columns: ChatDataColumn[];

    /** The values of each column, by column name. Each list holds one value per row. */
    data: Record<string, unknown[]>;

    /** Number of rows in the whole result. Default the number of rows in `data`. */
    totalRows?: number;
}

/**
 * The field that holds each row's synthetic id, in frames from a {@link ChatArtifactRegistry}. The
 * id is the row's index in the whole result, so it is unique even when the data has an `id`
 * column of its own with duplicates. Use it as the `idSpec` of a Hoist `Store`. The name is
 * reserved - a column of the same name is overwritten.
 */
export const CHAT_DATA_ROW_ID = 'xhChatRowId';

/**
 * Convert a column-oriented frame to rows. A column with fewer values than the longest gets null
 * for the missing ones.
 */
export function fromColumnar(frame: ChatColumnarFrame): ChatDataFrame {
    const {columns, data, totalRows} = frame,
        lists = columns.map(it => data[it.name] ?? []),
        rowCount = max(lists.map(it => it.length)) ?? 0,
        rows = Array.from({length: rowCount}, (_, idx) =>
            Object.fromEntries(columns.map((col, colIdx) => [col.name, lists[colIdx][idx] ?? null]))
        );
    return {columns, rows, totalRows: totalRows ?? rowCount};
}
