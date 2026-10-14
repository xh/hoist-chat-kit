import type {Column, ColumnState, GridModel} from '@xh/hoist/cmp/grid';
import type {PlainObject} from '@xh/hoist/core';
import {
    appendFilter,
    FieldFilter,
    type FieldFilterSpec,
    type Filter,
    parseFilter
} from '@xh/hoist/data';
import {Icon} from '@xh/hoist/icon';
import {wait} from '@xh/hoist/promise';
import {pluralize, throwIf} from '@xh/hoist/utils/js';
import {
    compact,
    find,
    findIndex,
    findLast,
    isEmpty,
    isNil,
    isUndefined,
    keys,
    map,
    omitBy,
    pickBy,
    uniq
} from 'lodash';
import {type ChatContextProvider, chatToolResult, type ChatToolSpec} from '../core';
import type {ChatToolGroup} from './ChatToolGroup';
import {arraySchema, enumSchema, joinNames, objectSchema} from './impl/schema';

/**
 * What a {@link gridTools} group can do to its grid:
 *
 *  - `columns` - show, hide, resize, pin and reorder columns.
 *  - `sort` - sort rows by one or more columns.
 *  - `group` - group rows by one or more columns.
 *  - `filter` - filter rows, through the grid's `filterModel`. Needs a filter model.
 *  - `autosize` - size columns to fit their contents. Needs autosizing enabled.
 *  - `export` - export the grid to Excel or CSV. Needs `enableExport`.
 *  - `select` - select rows that match conditions, or clear the selection. Needs a selection mode.
 */
export type GridToolCapability =
    'columns' | 'sort' | 'group' | 'filter' | 'autosize' | 'export' | 'select';

/** Options for {@link gridTools}. */
export interface GridToolsConfig {
    /**
     * What the tools may do. Default every capability the grid supports - see
     * {@link GridToolCapability}. Throws if given one the grid does not support.
     */
    capabilities?: GridToolCapability[];

    /** What the grid shows, for the model - such as 'Open positions, one row per trade'. */
    description?: string;
}

/**
 * Tools that let the model arrange a grid through its `GridModel`: columns, sorting, grouping,
 * filters, autosizing, export and selection. Each tool acts only on the given grid, through its
 * public API, and returns an undo that restores the state it changed.
 *
 * The context provider describes the grid's structure on every step - its columns, sorting,
 * grouping, filters, and row and selection counts. It sends no row values. Tool schemas list the
 * grid's current column and field ids, read again on every step.
 *
 * Platform neutral. The grid need not be rendered, except to autosize and to scroll a selection
 * into view.
 *
 * @param gridModel - the grid to act on.
 */
export function gridTools(gridModel: GridModel, config: GridToolsConfig = {}): ChatToolGroup {
    const {description = null} = config,
        supported = getSupportedCapabilities(gridModel),
        capabilities = config.capabilities ?? keys(pickBy(supported)),
        unsupported = capabilities.filter(it => !supported[it]);
    throwIf(
        !isEmpty(unsupported),
        `gridTools cannot offer ${unsupported.join(', ')} - the grid does not support it. ` +
            'See GridToolCapability.'
    );

    const tools = new GridTools(gridModel);
    return {
        tools: capabilities.flatMap(it => tools.forCapability(it as GridToolCapability)),
        contextProvider: tools.createContextProvider(description, capabilities),
        prompt: createPrompt(description, capabilities as GridToolCapability[]),
        suggestions: tools.createSuggestions(capabilities as GridToolCapability[])
    };
}

//------------------
// Implementation
//------------------
type CapabilityMap = Record<GridToolCapability, boolean>;

function getSupportedCapabilities(gridModel: GridModel): CapabilityMap {
    return {
        columns: true,
        sort: true,
        group: !gridModel.treeMode,
        filter: !!gridModel.filterModel,
        autosize: gridModel.autosizeOptions.mode !== 'disabled',
        export: gridModel.enableExport,
        select: gridModel.selModel.mode !== 'disabled'
    };
}

const CAPABILITY_PHRASES: Record<GridToolCapability, string> = {
    columns: 'show, hide, resize, pin and reorder its columns',
    sort: 'sort its rows',
    group: 'group its rows by columns',
    filter: 'filter its rows',
    autosize: 'size columns to fit their contents',
    export: 'export it to Excel or CSV',
    select: 'select rows that match conditions'
};

function createPrompt(description: string, capabilities: GridToolCapability[]): string {
    const grid = description ? `a grid - ${description}` : 'a grid',
        phrases = joinNames(capabilities.map(it => CAPABILITY_PHRASES[it]));
    return [
        `You help the user arrange ${grid}. Your tools can ${phrases}.`,
        "Each message comes with the grid's current state. Read it rather than asking the user.",
        'Tools take column ids. Use column names when you write to the user.',
        'Make the changes the user asks for without asking first - the user can undo them.'
    ].join('\n');
}

/** Value schema for a filter condition - one value, or a list for a multi-value operator. */
const FILTER_VALUE_SCHEMA = {
    anyOf: [
        {type: 'string'},
        {type: 'number'},
        {type: 'boolean'},
        {type: 'array', items: {anyOf: [{type: 'string'}, {type: 'number'}]}}
    ],
    description:
        "Value to compare with. A list matches any of its values, with '=' and '!='. " +
        'Dates as YYYY-MM-DD.'
};

const FILTER_OPS_DESCRIPTION =
    "Operator. 'like' matches text anywhere, 'begins' and 'ends' at either end, and " +
    "'includes' and 'excludes' test a list of tags.";

/** Builds the tools of one grid. */
class GridTools {
    constructor(private readonly gridModel: GridModel) {}

    forCapability(capability: GridToolCapability): ChatToolSpec[] {
        switch (capability) {
            case 'columns':
                return [this.updateColumnsTool(), this.moveColumnsTool()];
            case 'sort':
                return [this.sortTool()];
            case 'group':
                return [this.groupTool()];
            case 'filter':
                return [this.filterTool(), this.clearFiltersTool()];
            case 'autosize':
                return [this.autosizeTool()];
            case 'export':
                return [this.exportTool()];
            case 'select':
                return [this.selectTool(), this.clearSelectionTool()];
        }
    }

    createContextProvider(description: string, capabilities: string[]): ChatContextProvider {
        const {gridModel} = this,
            {store, filterModel, selModel} = gridModel;
        return {
            name: 'grid',
            description:
                (description ? `The grid - ${description}. ` : 'The grid. ') +
                'Its columns in display order, sorts as column|direction, grouping, filters, ' +
                'and row counts.',
            getContext: () =>
                omitBy(
                    {
                        columns: gridModel.columnState.map(it => this.describeColumn(it)),
                        sortBy: gridModel.sortBy.map(it => it.toString()),
                        groupBy: gridModel.groupBy,
                        filter: filterModel?.filter?.toJSON() ?? null,
                        filterFields: capabilities.includes('filter')
                            ? filterModel.fieldSpecs.map(({field, fieldType, ops}) => ({
                                  field,
                                  type: fieldType,
                                  ops
                              }))
                            : null,
                        rows: {shown: store.count, total: store.allCount},
                        selectedRows: selModel.mode !== 'disabled' ? selModel.count : null
                    },
                    isNil
                )
        };
    }

    createSuggestions(capabilities: GridToolCapability[]): string[] {
        const {gridModel} = this,
            visible = gridModel.getVisibleLeafColumns(),
            hasHidden = visible.length < gridModel.getLeafColumns().length,
            numberCol = visible.find(it => this.isNumeric(it) && it.sortable),
            groupCol = visible.slice(1).find(it => this.getFieldType(it) === 'string'),
            lastCol = findLast(visible, it => it.hideable),
            candidates: Record<GridToolCapability, string> = {
                sort: numberCol ? `Sort by ${numberCol.displayName}, largest first` : null,
                group: groupCol ? `Group by ${groupCol.displayName}` : null,
                columns: hasHidden
                    ? 'Show the hidden columns'
                    : lastCol
                      ? `Hide the ${lastCol.displayName} column`
                      : null,
                autosize: 'Fit the columns to their contents',
                filter: null,
                export: 'Export this to Excel',
                select: null
            };
        return compact(capabilities.map(it => candidates[it])).slice(0, 3);
    }

    //------------------
    // Columns
    //------------------
    private updateColumnsTool(): ChatToolSpec {
        const {gridModel} = this;
        return {
            name: 'update_columns',
            description:
                'Show, hide, resize or pin columns. Give one change per column, with only the ' +
                'settings to change.',
            get parameters() {
                return objectSchema(
                    {
                        changes: arraySchema(
                            objectSchema(
                                {
                                    column: enumSchema(gridModel.getLeafColumnIds(), 'Column id.'),
                                    visible: {
                                        type: 'boolean',
                                        description: 'True to show the column, false to hide it.'
                                    },
                                    width: {
                                        type: 'integer',
                                        minimum: 20,
                                        description: 'Width in pixels.'
                                    },
                                    pinned: enumSchema(
                                        ['left', 'right', 'none'],
                                        'Side to pin the column to, so it stays in view as the ' +
                                            "grid scrolls, or 'none' to unpin it."
                                    )
                                },
                                ['column']
                            ),
                            'Changes to make, one per column.',
                            1
                        )
                    },
                    ['changes']
                );
            },
            displayName: 'Update columns',
            icon: Icon.table(),
            summary: ({input}) => this.columnNames(compact(map(input?.changes, 'column'))),
            execute: ({changes}) => {
                const undo = this.columnStateUndo(),
                    updates = changes.map(({column, visible, width, pinned}) => {
                        const col = this.requireColumn(column);
                        throwIf(
                            visible === false && !col.hideable,
                            `Column '${column}' cannot be hidden.`
                        );
                        return omitBy(
                            {
                                colId: column,
                                hidden: isNil(visible) ? undefined : !visible,
                                width,
                                manuallySized: isNil(width) ? undefined : true,
                                pinned: isNil(pinned)
                                    ? undefined
                                    : pinned === 'none'
                                      ? null
                                      : pinned
                            },
                            isUndefined
                        ) as Partial<ColumnState>;
                    });
                gridModel.updateColumnState(updates);
                return chatToolResult(
                    `Updated ${pluralize('column', updates.length, true)}: ` +
                        `${this.columnNames(map(changes, 'column'))}.`,
                    {undo}
                );
            }
        };
    }

    private moveColumnsTool(): ChatToolSpec {
        const {gridModel} = this;
        return {
            name: 'move_columns',
            description:
                'Move columns, in the order given, to sit before another column - or after the ' +
                'last column if none is given.',
            get parameters() {
                const colIds = gridModel.getLeafColumnIds();
                return objectSchema(
                    {
                        columns: arraySchema(
                            enumSchema(colIds),
                            'Ids of the columns to move, in their new order.',
                            1
                        ),
                        before: enumSchema(colIds, 'Id of the column to move them before.')
                    },
                    ['columns']
                );
            },
            displayName: 'Move columns',
            icon: Icon.arrowsLeftRight(),
            summary: ({input}) => this.columnNames(compact(input?.columns)),
            execute: ({columns, before}) => {
                columns.forEach(it =>
                    throwIf(!this.requireColumn(it).movable, `Column '${it}' cannot be moved.`)
                );
                if (before) {
                    this.requireColumn(before);
                    throwIf(columns.includes(before), `Column '${before}' is one of those moved.`);
                }

                const undo = this.columnStateUndo(),
                    {columnState} = gridModel,
                    moving = columns.map(colId => find(columnState, {colId})),
                    rest = columnState.filter(it => !columns.includes(it.colId)),
                    idx = before ? findIndex(rest, {colId: before}) : rest.length;
                gridModel.setColumnState([...rest.slice(0, idx), ...moving, ...rest.slice(idx)]);
                return chatToolResult(
                    `Moved ${this.columnNames(columns)} ` +
                        (before ? `before ${this.columnNames([before])}.` : 'to the end.'),
                    {undo}
                );
            }
        };
    }

    private autosizeTool(): ChatToolSpec {
        const {gridModel} = this;
        return {
            name: 'autosize_columns',
            description: 'Size visible columns to fit their contents.',
            get parameters() {
                return objectSchema({
                    columns: arraySchema(
                        enumSchema(gridModel.getLeafColumnIds()),
                        'Ids of the columns to size. Leave out to size all of them.'
                    )
                });
            },
            displayName: 'Fit columns',
            icon: Icon.arrowsLeftRight(),
            summary: ({input}) => this.columnNames(compact(input?.columns)) ?? 'All columns',
            execute: async ({columns}) => {
                columns?.forEach(it => this.requireColumn(it));
                const undo = this.columnStateUndo();
                await gridModel.autosizeAsync(isEmpty(columns) ? {} : {columns});
                return chatToolResult(
                    isEmpty(columns)
                        ? 'Sized the columns to fit.'
                        : `Sized ${this.columnNames(columns)} to fit.`,
                    {undo}
                );
            }
        };
    }

    //------------------
    // Sorting and grouping
    //------------------
    private sortTool(): ChatToolSpec {
        const {gridModel} = this;
        return {
            name: 'sort_grid',
            description:
                'Sort the rows by one or more columns, replacing the current sort. An empty ' +
                'list clears sorting.',
            get parameters() {
                const colIds = map(
                    gridModel.getLeafColumns().filter(it => it.sortable),
                    'colId'
                );
                return objectSchema(
                    {
                        sorts: arraySchema(
                            objectSchema(
                                {
                                    column: enumSchema(colIds, 'Column id.'),
                                    direction: enumSchema(['asc', 'desc']),
                                    absolute: {
                                        type: 'boolean',
                                        description: 'True to sort numbers by absolute value.'
                                    }
                                },
                                ['column', 'direction']
                            ),
                            'Sorts to apply, most significant first.'
                        )
                    },
                    ['sorts']
                );
            },
            displayName: 'Sort',
            icon: Icon.sortAsc(),
            summary: ({input}) => this.columnNames(compact(map(input?.sorts, 'column'))),
            execute: ({sorts}) => {
                sorts.forEach(({column}) =>
                    throwIf(
                        !this.requireColumn(column).sortable,
                        `Column '${column}' cannot be sorted.`
                    )
                );
                const prior = gridModel.sortBy.map(it => it.toString());
                gridModel.setSortBy(
                    sorts.map(({column, direction, absolute}) => ({
                        colId: column,
                        sort: direction,
                        abs: !!absolute
                    }))
                );
                const sortNames = sorts.map(
                    it => `${this.columnName(it.column)} (${it.direction})`
                );
                return chatToolResult(
                    isEmpty(sorts) ? 'Cleared sorting.' : `Sorted by ${sortNames.join(', then ')}.`,
                    {undo: () => gridModel.setSortBy(prior)}
                );
            }
        };
    }

    private groupTool(): ChatToolSpec {
        const {gridModel} = this;
        return {
            name: 'group_grid',
            description:
                'Group the rows by one or more columns, outermost first, replacing the current ' +
                'grouping. An empty list removes grouping.',
            get parameters() {
                return objectSchema(
                    {
                        columns: arraySchema(
                            enumSchema(gridModel.getLeafColumnIds()),
                            'Ids of the columns to group by.'
                        )
                    },
                    ['columns']
                );
            },
            displayName: 'Group',
            icon: Icon.treeList(),
            summary: ({input}) => this.columnNames(compact(input?.columns)),
            execute: ({columns}) => {
                columns.forEach(it => this.requireColumn(it));
                const prior = gridModel.groupBy;
                gridModel.setGroupBy(columns);
                return chatToolResult(
                    isEmpty(columns)
                        ? 'Removed grouping.'
                        : `Grouped by ${this.columnNames(columns)}.`,
                    {undo: () => gridModel.setGroupBy(prior)}
                );
            }
        };
    }

    //------------------
    // Filters
    //------------------
    private filterTool(): ChatToolSpec {
        const {gridModel} = this;
        return {
            name: 'filter_grid',
            description:
                'Filter the rows. Conditions replace any existing filter on their fields, and ' +
                'rows must meet all of them. Filters on other fields stay.',
            get parameters() {
                return objectSchema(
                    {
                        filters: arraySchema(
                            objectSchema(
                                {
                                    field: enumSchema(
                                        map(gridModel.filterModel.fieldSpecs, 'field'),
                                        'Field to filter on.'
                                    ),
                                    op: enumSchema(FieldFilter.OPERATORS, FILTER_OPS_DESCRIPTION),
                                    value: FILTER_VALUE_SCHEMA
                                },
                                ['field', 'op', 'value']
                            ),
                            'Conditions to apply.',
                            1
                        )
                    },
                    ['filters']
                );
            },
            displayName: 'Filter',
            icon: Icon.filter(),
            summary: ({input}) => this.fieldNames(compact(map(input?.filters, 'field'))),
            execute: async ({filters}) => {
                const {filterModel} = gridModel,
                    prior = filterModel.filter,
                    specs: FieldFilterSpec[] = filters.map(({field, op, value}) => {
                        const fieldSpec = filterModel.getFieldSpec(field);
                        throwIf(!fieldSpec, `The grid cannot filter on '${field}'.`);
                        throwIf(
                            !fieldSpec.ops.includes(op),
                            `Field '${field}' takes the operators ${fieldSpec.ops.join(', ')}.`
                        );
                        return {field, op, value, valueType: fieldSpec.fieldType};
                    });

                let filter: Filter = prior;
                uniq(map(filters, 'field')).forEach(
                    it => (filter = filter?.removeFieldFilters(it))
                );
                await this.applyFilterAsync(appendFilter(filter, ...specs));
                return chatToolResult(this.rowCountText('Filtered'), {
                    undo: () => filterModel.setFilter(prior)
                });
            }
        };
    }

    private clearFiltersTool(): ChatToolSpec {
        const {gridModel} = this;
        return {
            name: 'clear_filters',
            description: 'Remove the filters on some fields, or on all of them.',
            get parameters() {
                return objectSchema({
                    fields: arraySchema(
                        enumSchema(map(gridModel.filterModel.fieldSpecs, 'field')),
                        'Fields whose filters to remove. Leave out to remove every filter.'
                    )
                });
            },
            displayName: 'Clear filters',
            icon: Icon.filterSlash(),
            summary: ({input}) => this.fieldNames(compact(input?.fields)) ?? 'All filters',
            execute: async ({fields}) => {
                const {filterModel} = gridModel,
                    prior = filterModel.filter;
                let filter: Filter = null;
                if (!isEmpty(fields)) {
                    filter = prior;
                    fields.forEach(it => (filter = filter?.removeFieldFilters(it)));
                }
                await this.applyFilterAsync(filter);
                return chatToolResult(this.rowCountText('Cleared filters'), {
                    undo: () => filterModel.setFilter(prior)
                });
            }
        };
    }

    /** Set the grid's filter, and wait for the filter model to apply it, a tick later. */
    private async applyFilterAsync(filter: Filter) {
        this.gridModel.filterModel.setFilter(filter);
        await wait();
    }

    //------------------
    // Export and selection
    //------------------
    private exportTool(): ChatToolSpec {
        const {gridModel} = this;
        return {
            name: 'export_grid',
            description: 'Export the grid, as shown, to a file the user downloads.',
            parameters: objectSchema(
                {
                    format: enumSchema(['excel', 'csv'], 'File format.'),
                    filename: {type: 'string', description: 'File name, with no extension.'}
                },
                ['format']
            ),
            displayName: 'Export',
            icon: Icon.download(),
            summary: ({input}) => (input?.format === 'csv' ? 'CSV' : 'Excel'),
            execute: async ({format, filename}) => {
                await gridModel.exportAsync({
                    type: format === 'csv' ? 'csv' : 'excelTable',
                    ...(filename ? {filename} : {})
                });
                return `Exported the grid to ${format === 'csv' ? 'CSV' : 'Excel'}.`;
            }
        };
    }

    private selectTool(): ChatToolSpec {
        const {gridModel} = this;
        return {
            name: 'select_rows',
            description:
                'Select the rows shown that meet all the given conditions, replacing the ' +
                'selection. An empty list selects every row shown.',
            get parameters() {
                return objectSchema(
                    {
                        filters: arraySchema(
                            objectSchema(
                                {
                                    field: enumSchema(
                                        map(gridModel.store.fields, 'name'),
                                        'Field to test.'
                                    ),
                                    op: enumSchema(FieldFilter.OPERATORS, FILTER_OPS_DESCRIPTION),
                                    value: FILTER_VALUE_SCHEMA
                                },
                                ['field', 'op', 'value']
                            ),
                            'Conditions that selected rows meet.'
                        )
                    },
                    ['filters']
                );
            },
            displayName: 'Select rows',
            icon: Icon.checkSquare(),
            summary: ({input}) => this.fieldNames(compact(map(input?.filters, 'field'))),
            execute: async ({filters}) => {
                const {store, selModel} = gridModel,
                    prior = selModel.selectedIds,
                    specs = filters.map(({field, op, value}) => {
                        const storeField = store.getField(field);
                        throwIf(!storeField, `The grid has no field '${field}'.`);
                        return {field, op, value, valueType: storeField.type};
                    }),
                    test = isEmpty(specs)
                        ? () => true
                        : parseFilter({op: 'AND', filters: specs}).getTestFn(store);

                selModel.select(store.records.filter(test));
                if (gridModel.isReady) await gridModel.ensureSelectionVisibleAsync();
                return chatToolResult(
                    selModel.isEmpty
                        ? 'No rows match.'
                        : `Selected ${pluralize('row', selModel.count, true)}.`,
                    {undo: () => selModel.select(prior)}
                );
            }
        };
    }

    private clearSelectionTool(): ChatToolSpec {
        const {gridModel} = this;
        return {
            name: 'clear_selection',
            description: 'Deselect all rows.',
            parameters: objectSchema(),
            displayName: 'Clear selection',
            icon: Icon.square(),
            execute: () => {
                const prior = gridModel.selectedIds;
                gridModel.clearSelection();
                return chatToolResult('Cleared the selection.', {
                    undo: () => gridModel.selModel.select(prior)
                });
            }
        };
    }

    //------------------
    // Helpers
    //------------------
    /** An undo that restores the current column state - order, visibility, widths and pins. */
    private columnStateUndo(): () => void {
        const {gridModel} = this,
            prior = gridModel.columnState;
        return () => gridModel.setColumnState(prior);
    }

    private requireColumn(colId: string): Column {
        const col = this.gridModel.getColumn(colId);
        if (!col) {
            const ids = this.gridModel.getLeafColumnIds();
            throw new Error(
                `The grid has no column '${colId}'. Its columns are ${ids.join(', ')}.`
            );
        }
        return col;
    }

    private columnName(colId: string): string {
        return this.gridModel.getColumn(colId)?.displayName ?? colId;
    }

    private columnNames(colIds: string[]): string {
        return joinNames(colIds.map(it => this.columnName(it)));
    }

    private fieldNames(fields: string[]): string {
        const {store} = this.gridModel;
        return joinNames(uniq(fields).map(it => store.getField(it)?.displayName ?? it));
    }

    private rowCountText(verb: string): string {
        const {count, allCount} = this.gridModel.store;
        return `${verb} - showing ${count} of ${pluralize('row', allCount, true)}.`;
    }

    private describeColumn({colId, hidden, width, pinned}: ColumnState): PlainObject {
        const col = this.gridModel.getColumn(colId);
        return omitBy(
            {
                id: colId,
                name: col?.displayName,
                type: col ? this.getFieldType(col) : null,
                hidden: hidden || null,
                width: hidden ? null : width,
                pinned: pinned || null,
                hideable: col?.hideable === false ? false : null,
                sortable: col?.sortable === false ? false : null
            },
            isNil
        );
    }

    private getFieldType(col: Column): string {
        return this.gridModel.store.getField(col.field)?.type ?? null;
    }

    private isNumeric(col: Column): boolean {
        return ['number', 'int'].includes(this.getFieldType(col));
    }
}
