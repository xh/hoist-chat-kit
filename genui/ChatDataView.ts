import type {PlainObject} from '@xh/hoist/core';
import {isArray, isEmpty, isString, keyBy, pick, uniq} from 'lodash';
import {
    CHAT_DATA_ROW_ID,
    type ChatDataColumn,
    type ChatDataColumnType,
    type ChatDataFrame,
    type ChatDataUnits
} from './ChatData';
import {formatError} from './impl/validateSchema';

/** An operator of a {@link ChatDataFilter} - a closed set, so the kit never evaluates code. */
export type ChatDataFilterOp = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'notNull';

/**
 * One condition of a {@link ChatDataView}. `eq` and `neq` with a null value match empty and
 * non-empty values. `in` takes a list of values. `notNull` takes no value.
 */
export interface ChatDataFilter {
    /** Name of the column to test. */
    field: string;

    /** How to test it. */
    op: ChatDataFilterOp;

    /** The value to test against - converted to the column's type, so `"2024"` matches 2024. */
    value?: any;
}

/** A column of a {@link ChatDataView}, with a label or format in place of the frame's own. */
export interface ChatDataViewColumn {
    name: string;
    label?: string;
    format?: string;
}

/**
 * A view over tabular data, as the model writes it for a table or a chart: which rows, in what
 * order, which columns, and the unit for numbers. Apply one with {@link applyDataView}. Views
 * over one artifact are independent, so a chart can show a different slice than a table.
 */
export interface ChatDataView {
    /** The columns to show, in order. Default all, in the frame's order. */
    columns?: (string | ChatDataViewColumn)[];

    /** The column to sort by, ascending - or descending, as `field|desc`. Default unsorted. */
    sortBy?: string;

    /** Conditions a row must all meet. Default none. */
    filter?: ChatDataFilter[];

    /** Keep the first N rows, after sorting. Default all. */
    top?: number;

    /** Scale numbers to this unit. Default `none`. */
    units?: ChatDataUnits;
}

/** The type of a {@link ChatChartView}. */
export type ChatChartType = 'line' | 'column' | 'bar' | 'area' | 'pie' | 'scatter';

/** A {@link ChatDataView} drawn as a chart: its type, the x column and the y columns. */
export interface ChatChartView extends ChatDataView {
    type: ChatChartType;

    /** The column for the x-axis, or for the slices of a pie. */
    x: string;

    /** The numeric columns to plot, one series each - unless `groupBy` is set. */
    y: string[];

    /** A column whose values each make a series of the first `y` column. */
    groupBy?: string;

    /** Stack the series - by value, or as a percent of the total. */
    stacking?: 'normal' | 'percent';

    /** Color each point of a single series by its sign. */
    colorBySign?: boolean;
}

/**
 * JSON Schemas for the props of a {@link ChatDataView}, to merge into the `properties` of a
 * component that shows a table over an artifact.
 */
export const CHAT_DATA_VIEW_PROPERTIES: PlainObject = {
    columns: {
        type: 'array',
        maxItems: 50,
        description: 'The columns to show, in order. Default all.',
        items: {
            anyOf: [
                {type: 'string', maxLength: 100},
                {
                    type: 'object',
                    required: ['name'],
                    additionalProperties: false,
                    properties: {
                        name: {type: 'string', maxLength: 100},
                        label: {type: 'string', maxLength: 100},
                        format: {type: 'string', maxLength: 40}
                    }
                }
            ]
        }
    },
    sortBy: {
        type: 'string',
        maxLength: 110,
        pattern: '^[^|]+(\\|(asc|desc))?$',
        description: "A column to sort by - 'field' ascending, or 'field|desc'."
    },
    filter: {
        type: 'array',
        maxItems: 10,
        description: 'Conditions a row must all meet.',
        items: {
            type: 'object',
            required: ['field', 'op'],
            additionalProperties: false,
            properties: {
                field: {type: 'string', maxLength: 100},
                op: {enum: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'notNull']},
                value: {
                    type: ['string', 'number', 'boolean', 'null', 'array'],
                    maxItems: 100,
                    items: {type: ['string', 'number', 'boolean', 'null']},
                    description: "A list of values for 'in'. None for 'notNull'."
                }
            }
        }
    },
    top: {
        type: 'integer',
        minimum: 1,
        maximum: 10000,
        description: 'Keep the first N rows, after sorting.'
    },
    units: {
        enum: ['none', 'thousands', 'millions', 'billions'],
        description: 'Scale numbers to this unit.'
    }
};

/**
 * JSON Schemas for the props of a {@link ChatChartView}, to merge into the `properties` of a
 * component that charts an artifact. Mark `type`, `x` and `y` required.
 */
export const CHAT_CHART_VIEW_PROPERTIES: PlainObject = {
    ...CHAT_DATA_VIEW_PROPERTIES,
    type: {enum: ['line', 'column', 'bar', 'area', 'pie', 'scatter']},
    x: {type: 'string', maxLength: 100, description: 'The column for the x-axis.'},
    y: {
        type: 'array',
        minItems: 1,
        maxItems: 10,
        items: {type: 'string', maxLength: 100},
        description: 'The numeric columns to plot, one series each.'
    },
    groupBy: {
        type: 'string',
        maxLength: 100,
        description: 'A column whose values each make a series of the first y column.'
    },
    stacking: {enum: ['normal', 'percent']},
    colorBySign: {type: 'boolean', description: 'Color a single series by the sign of each point.'}
};

/**
 * Check that a view fits the columns of the data it applies to: that each column it names exists,
 * that each filter has the value its operator needs, and that a chart plots numeric columns.
 *
 * @returns problems in the kit's `path: message` form. Empty if the view applies.
 */
export function findDataViewProblems(
    view: ChatDataView | ChatChartView,
    columns: ChatDataColumn[]
): string[] {
    const byName = keyBy(columns, 'name'),
        ret: string[] = [],
        checkColumn = (name: string, path: string) => {
            if (!Object.hasOwn(byName, name))
                ret.push(formatError(path, `unknown column '${name}'`));
        };

    view.columns?.forEach((it, idx) => checkColumn(getViewColumnName(it), `columns[${idx}]`));
    if (view.sortBy != null) checkColumn(parseSortBy(view.sortBy).field, 'sortBy');
    view.filter?.forEach(({field, op, value}, idx) => {
        const path = `filter[${idx}]`;
        checkColumn(field, `${path}.field`);
        if (op === 'in' && !isArray(value)) {
            ret.push(formatError(`${path}.value`, "expected a list of values for 'in'"));
        } else if (RANGE_OPS.includes(op) && value == null) {
            ret.push(formatError(`${path}.value`, `required for '${op}'`));
        }
    });

    if (isChartView(view)) {
        checkColumn(view.x, 'x');
        view.y.forEach((name, idx) => {
            const path = `y[${idx}]`;
            checkColumn(name, path);
            if (byName[name] && !isNumericType(byName[name].type)) {
                ret.push(formatError(path, `column '${name}' is not numeric`));
            }
        });
        if (view.groupBy != null) checkColumn(view.groupBy, 'groupBy');
    }
    return ret;
}

/**
 * Apply a view to a frame: filter, then sort, then keep the top rows, then scale numbers to the
 * unit, then select the columns. A pure function - the frame is left as it was.
 *
 * Numbers scale in the columns a view plots - the `y` columns of a chart, or the `number` columns
 * of a table but those formatted as `percent` or `none`. A scaled column notes its `units`.
 *
 * A view sees only the rows of the frame it is given. Apply it to a complete frame - one whose
 * rows are all of the artifact's, as {@link ChatDataHandle.isComplete} reports - or the filter,
 * the sort and `top` work on a part of the data, and `totalRows` counts only that part.
 *
 * @returns a new frame. Its `totalRows` counts the rows that pass the filter, before `top`.
 * @throws if the view does not fit the frame - see {@link findDataViewProblems}.
 */
export function applyDataView(
    frame: ChatDataFrame,
    view: ChatDataView | ChatChartView
): ChatDataFrame {
    const problems = findDataViewProblems(view, frame.columns);
    if (!isEmpty(problems)) throw new Error(`Invalid data view: ${problems.join('; ')}`);

    const byName = keyBy(frame.columns, 'name');

    let rows = frame.rows.filter(row =>
        (view.filter ?? []).every(it => matchesFilter(row[it.field], it, byName[it.field].type))
    );
    const totalRows = rows.length;

    if (view.sortBy != null) {
        const {field, isDesc} = parseSortBy(view.sortBy),
            {type} = byName[field];
        rows = [...rows].sort((a, b) => compareValues(a[field], b[field], type, isDesc));
    }
    if (view.top != null) rows = rows.slice(0, view.top);

    let columns = frame.columns;
    const divisor = UNIT_DIVISORS[view.units ?? 'none'];
    if (divisor !== 1) {
        const scaled = columns.filter(it => isScaled(it, view)).map(it => it.name);
        rows = rows.map(row => ({
            ...row,
            ...Object.fromEntries(
                scaled.map(name => [name, row[name] == null ? null : row[name] / divisor])
            )
        }));
        columns = columns.map(it =>
            scaled.includes(it.name) ? {...it, type: 'number', units: view.units} : it
        );
    }

    if (view.columns) {
        const selected = view.columns.map(it => {
                const column = columns.find(col => col.name === getViewColumnName(it));
                return isString(it) ? column : {...column, ...pick(it, ['label', 'format'])};
            }),
            required = isChartView(view) ? uniq([view.x, ...view.y, view.groupBy]) : [];
        required.forEach(name => {
            if (name != null && !selected.some(it => it.name === name)) {
                selected.push(columns.find(col => col.name === name));
            }
        });
        const fields = [...selected.map(it => it.name), CHAT_DATA_ROW_ID];
        columns = selected;
        rows = rows.map(row => pick(row, fields));
    }

    return {columns, rows, totalRows};
}

//------------------
// Implementation
//------------------
const RANGE_OPS: ChatDataFilterOp[] = ['gt', 'gte', 'lt', 'lte'],
    UNIT_DIVISORS: Record<ChatDataUnits, number> = {
        none: 1,
        thousands: 1e3,
        millions: 1e6,
        billions: 1e9
    },
    UNSCALED_FORMATS = ['percent', 'none'];

function isChartView(view: ChatDataView): view is ChatChartView {
    return isArray((view as ChatChartView).y);
}

function getViewColumnName(column: string | ChatDataViewColumn): string {
    return isString(column) ? column : column?.name;
}

function parseSortBy(sortBy: string): {field: string; isDesc: boolean} {
    const [field, dir] = sortBy.split('|');
    return {field, isDesc: dir === 'desc'};
}

function isNumericType(type: ChatDataColumnType): boolean {
    return type === 'number' || type === 'integer';
}

function isScaled(column: ChatDataColumn, view: ChatDataView): boolean {
    if (isChartView(view)) return view.y.includes(column.name);
    // Integer columns hold years, counts and ids more often than amounts, so they keep their values.
    return column.type === 'number' && !UNSCALED_FORMATS.includes(column.format);
}

/** A value converted to its column's type, for comparison - or null if empty. */
function normalize(value: unknown, type: ChatDataColumnType): any {
    if (value == null || value === '') return null;
    switch (type) {
        case 'number':
        case 'integer': {
            const num = isString(value) ? Number(value) : value;
            return Number.isNaN(num) ? value : num;
        }
        case 'date':
        case 'datetime': {
            if (!isString(value)) return value;
            const ms = Date.parse(value);
            return Number.isNaN(ms) ? value : ms;
        }
        case 'boolean':
            return value === 'true' ? true : value === 'false' ? false : value;
        default:
            return value;
    }
}

function matchesFilter(value: unknown, filter: ChatDataFilter, type: ChatDataColumnType): boolean {
    const actual = normalize(value, type),
        expected = filter.op === 'in' ? null : normalize(filter.value, type);

    switch (filter.op) {
        case 'eq':
            return actual === expected;
        case 'neq':
            return actual !== expected;
        case 'in':
            return (filter.value as unknown[]).some(it => actual === normalize(it, type));
        case 'notNull':
            return actual != null;
        default: {
            if (actual == null || expected == null || typeof actual !== typeof expected) {
                return false;
            }
            const cmp = actual < expected ? -1 : actual > expected ? 1 : 0;
            return {gt: cmp > 0, gte: cmp >= 0, lt: cmp < 0, lte: cmp <= 0}[filter.op];
        }
    }
}

/** Compare two values for sorting. Empty values sort last in either direction. */
function compareValues(a: unknown, b: unknown, type: ChatDataColumnType, isDesc: boolean): number {
    const left = normalize(a, type),
        right = normalize(b, type);
    if (left == null || right == null) return left == null ? (right == null ? 0 : 1) : -1;

    const cmp =
        isString(left) && isString(right)
            ? left.localeCompare(right)
            : left < right
              ? -1
              : left > right
                ? 1
                : 0;
    return isDesc ? -cmp : cmp;
}
