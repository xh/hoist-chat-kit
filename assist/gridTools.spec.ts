import {GridModel} from '@xh/hoist/cmp/grid';
import type {PlainObject} from '@xh/hoist/core';
import {initTestAppAsync} from '@xh/hoist/test-support';
import {map} from 'lodash';
import {beforeAll, describe, expect, it, onTestFinished, vi} from 'vitest';
import {ChatModel, ChatToolResult, type ChatToolSpec} from '../core';
import {ScriptedChatTransport, textEvents, toolCallEvents} from '../transport';
import type {ChatToolGroup} from './ChatToolGroup';
import {gridTools} from './gridTools';

/**
 * gridTools turns a GridModel into tools a model can call. Each tool must change only its own
 * grid, through the public API, refuse what the grid does not allow with an error the model can
 * act on, and hand back an undo that restores exactly what it changed.
 */
describe('gridTools', () => {
    beforeAll(async () => {
        await initTestAppAsync();
    });

    describe('group', () => {
        it('offers every capability the grid supports, with a prompt and three suggestions', () => {
            const group = gridTools(createGrid(), {description: 'Open trades'});

            expect(map(group.tools, 'name')).toEqual([
                'update_columns',
                'move_columns',
                'sort_grid',
                'group_grid',
                'filter_grid',
                'clear_filters',
                'autosize_columns',
                'export_grid',
                'select_rows',
                'clear_selection'
            ]);
            expect(group.prompt).toContain('a grid - Open trades');
            expect(group.suggestions).toEqual([
                'Show the hidden columns',
                'Sort by Price, largest first',
                'Group by Region'
            ]);
        });

        it('leaves out what the grid does not support, and refuses to offer it', () => {
            const gridModel = createGrid({
                filterModel: null,
                enableExport: false,
                selModel: 'disabled'
            });

            expect(map(gridTools(gridModel).tools, 'name')).not.toContain('filter_grid');
            expect(map(gridTools(gridModel).tools, 'name')).not.toContain('export_grid');
            expect(() => gridTools(gridModel, {capabilities: ['sort', 'filter']})).toThrow(
                'gridTools cannot offer filter'
            );
        });

        it('offers only the capabilities asked for', () => {
            const group = gridTools(createGrid(), {capabilities: ['sort', 'group']});
            expect(map(group.tools, 'name')).toEqual(['sort_grid', 'group_grid']);
        });

        it("reads each schema from the grid's current columns", () => {
            const gridModel = createGrid(),
                tool = getTool(gridTools(gridModel), 'group_grid');
            expect(tool.parameters.properties.columns.items.enum).toEqual(COL_IDS);

            gridModel.setColumns([{field: 'name'}, {field: 'desk'}]);
            expect(tool.parameters.properties.columns.items.enum).toEqual(['name', 'desk']);
        });

        it('describes the grid structure, and no row values, for the model', async () => {
            const gridModel = createGrid(),
                {contextProvider} = gridTools(gridModel),
                context = (await contextProvider.getContext(null)) as PlainObject;

            expect(context.columns).toEqual([
                {id: 'id', name: 'ID', hidden: true, hideable: false},
                {id: 'name', name: 'Name', type: 'string', width: expect.any(Number)},
                {id: 'region', name: 'Region', type: 'string', width: expect.any(Number)},
                {id: 'price', name: 'Price', type: 'number', width: expect.any(Number)},
                {id: 'qty', name: 'Qty', type: 'int', width: expect.any(Number), sortable: false}
            ]);
            expect(context).toMatchObject({
                sortBy: ['name|asc'],
                groupBy: [],
                rows: {shown: 4, total: 4},
                selectedRows: 0
            });
            expect(context.filterFields[0]).toMatchObject({
                field: 'name',
                type: 'string',
                ops: expect.arrayContaining(['like'])
            });
            expect(JSON.stringify(context)).not.toContain('Tokyo');
        });
    });

    describe('columns', () => {
        it('shows, hides, resizes and pins columns, and undoes it', async () => {
            const gridModel = createGrid(),
                result = await run(gridModel, 'update_columns', {
                    changes: [
                        {column: 'region', visible: false},
                        {column: 'price', width: 140, pinned: 'left'}
                    ]
                });

            expect(result.output).toBe('Updated 2 columns: Region and Price.');
            expect(gridModel.isColumnVisible('region')).toBe(false);
            expect(gridModel.getStateForColumn('price')).toMatchObject({
                width: 140,
                pinned: 'left',
                manuallySized: true
            });

            await result.undo();
            expect(gridModel.isColumnVisible('region')).toBe(true);
            expect(gridModel.getColumnPinned('price')).toBeFalsy();
        });

        it('refuses to hide a column that cannot be hidden, or one the grid does not have', async () => {
            const gridModel = createGrid();
            await expect(
                run(gridModel, 'update_columns', {changes: [{column: 'id', visible: false}]})
            ).rejects.toThrow("Column 'id' cannot be hidden.");
            await expect(
                run(gridModel, 'update_columns', {changes: [{column: 'desk', visible: true}]})
            ).rejects.toThrow("The grid has no column 'desk'. Its columns are id, name");
        });

        it('moves columns before another, or to the end, and undoes it', async () => {
            const gridModel = createGrid(),
                colOrder = () => map(gridModel.columnState, 'colId');

            const result = await run(gridModel, 'move_columns', {
                columns: ['qty', 'price'],
                before: 'name'
            });
            expect(colOrder()).toEqual(['id', 'qty', 'price', 'name', 'region']);

            await run(gridModel, 'move_columns', {columns: ['id']});
            expect(colOrder()).toEqual(['qty', 'price', 'name', 'region', 'id']);

            await result.undo();
            expect(colOrder()).toEqual(COL_IDS);
        });

        it('autosizes the given columns, and undoes their widths', async () => {
            const gridModel = createGrid(),
                autosize = vi
                    .spyOn(gridModel, 'autosizeAsync')
                    .mockImplementation(async () =>
                        gridModel.updateColumnState([{colId: 'name', width: 300}])
                    ),
                result = await run(gridModel, 'autosize_columns', {columns: ['name']});

            expect(autosize).toHaveBeenCalledWith({columns: ['name']});
            expect(gridModel.getStateForColumn('name').width).toBe(300);

            await result.undo();
            expect(gridModel.getStateForColumn('name').width).not.toBe(300);
        });
    });

    describe('sort and group', () => {
        it('sorts by several columns, clears sorting, and undoes it', async () => {
            const gridModel = createGrid(),
                result = await run(gridModel, 'sort_grid', {
                    sorts: [
                        {column: 'region', direction: 'asc'},
                        {column: 'price', direction: 'desc', absolute: true}
                    ]
                });

            expect(result.output).toBe('Sorted by Region (asc), then Price (desc).');
            expect(gridModel.sortBy.map(it => it.toString())).toEqual([
                'region|asc',
                'price|desc|abs'
            ]);

            await run(gridModel, 'sort_grid', {sorts: []});
            expect(gridModel.sortBy).toEqual([]);

            await result.undo();
            expect(gridModel.sortBy.map(it => it.toString())).toEqual(['name|asc']);
        });

        it('refuses to sort a column that cannot be sorted', async () => {
            await expect(
                run(createGrid(), 'sort_grid', {sorts: [{column: 'qty', direction: 'asc'}]})
            ).rejects.toThrow("Column 'qty' cannot be sorted.");
        });

        it('groups by columns, and undoes it', async () => {
            const gridModel = createGrid(),
                result = await run(gridModel, 'group_grid', {columns: ['region']});

            expect(result.output).toBe('Grouped by Region.');
            expect(gridModel.groupBy).toEqual(['region']);

            await result.undo();
            expect(gridModel.groupBy).toEqual([]);
        });
    });

    describe('filter', () => {
        it('replaces the filters on the given fields, keeps the others, and reports rows', async () => {
            const gridModel = createGrid();
            await run(gridModel, 'filter_grid', {
                filters: [{field: 'region', op: '=', value: ['EMEA', 'APAC']}]
            });

            const result = await run(gridModel, 'filter_grid', {
                filters: [
                    {field: 'price', op: '>', value: 50},
                    {field: 'price', op: '<', value: 500}
                ]
            });
            expect(result.output).toBe('Filtered - showing 2 of 4 rows.');
            expect(gridModel.store.records.map(it => it.data.name)).toEqual(['Tokyo', 'Paris']);

            const regionOnly = await run(gridModel, 'filter_grid', {
                filters: [{field: 'region', op: '=', value: 'EMEA'}]
            });
            expect(regionOnly.output).toBe('Filtered - showing 1 of 4 rows.');

            await regionOnly.undo();
            await vi.waitFor(() => expect(gridModel.store.count).toBe(2));
        });

        it('refuses an operator that the field does not take', async () => {
            await expect(
                run(createGrid(), 'filter_grid', {
                    filters: [{field: 'price', op: 'like', value: '5'}]
                })
            ).rejects.toThrow("Field 'price' takes the operators");
        });

        it('clears the filters on some fields or all, and undoes it', async () => {
            const gridModel = createGrid();
            await run(gridModel, 'filter_grid', {
                filters: [
                    {field: 'region', op: '!=', value: 'AMER'},
                    {field: 'price', op: '>', value: 200}
                ]
            });
            expect(gridModel.store.count).toBe(1);

            await run(gridModel, 'clear_filters', {fields: ['price']});
            expect(gridModel.store.count).toBe(2);

            const result = await run(gridModel, 'clear_filters', {});
            expect(result.output).toBe('Cleared filters - showing 4 of 4 rows.');

            await result.undo();
            await vi.waitFor(() => expect(gridModel.store.count).toBe(2));
        });
    });

    describe('helper members', () => {
        it('names the grid, and says it sees structure, not row data', () => {
            const group = gridTools(createGrid(), {title: 'Positions grid'});

            expect(group.title).toBe('Positions grid');
            expect(group.kind).toBe('grid');
            expect(group.boundary()).toMatchObject({
                text: 'Sees column names and filters, not row data',
                notShared: ['Row values']
            });
        });

        it('reports a hand edit since a snapshot, but not a selection', () => {
            const gridModel = createGrid(),
                group = gridTools(gridModel),
                snapshot = group.snapshot();

            gridModel.selModel.select(gridModel.store.records[0]);
            expect(group.isChangedSince(snapshot)).toBe(false);

            gridModel.setGroupBy(['region']);
            expect(group.isChangedSince(snapshot)).toBe(true);
        });

        it('names the columns a call changed, and the groups', async () => {
            const gridModel = createGrid(),
                shown = await run(gridModel, 'update_columns', {
                    changes: [
                        {column: 'qty', visible: false},
                        {column: 'price', pinned: 'left'}
                    ]
                }),
                grouped = await run(gridModel, 'group_grid', {columns: ['region']});

            expect(shown.targets).toEqual([
                {type: 'column', id: 'qty'},
                {type: 'column', id: 'price'}
            ]);
            expect(grouped.targets).toEqual([{type: 'groups'}]);
        });
    });

    describe('export and select', () => {
        it('exports to Excel or CSV through the grid', async () => {
            const gridModel = createGrid(),
                exportAsync = vi.spyOn(gridModel, 'exportAsync').mockResolvedValue(),
                output = await getTool(gridTools(gridModel), 'export_grid').execute(
                    {format: 'csv', filename: 'trades'},
                    null
                );

            expect(exportAsync).toHaveBeenCalledWith({type: 'csv', filename: 'trades'});
            expect(output).toBe('Exported the grid to CSV.');
        });

        it('selects the rows that meet every condition, and undoes it', async () => {
            const gridModel = createGrid(),
                result = await run(gridModel, 'select_rows', {
                    filters: [
                        {field: 'region', op: '!=', value: 'AMER'},
                        {field: 'qty', op: '>=', value: 10}
                    ]
                });

            expect(result.output).toBe('Selected 2 rows.');
            expect(gridModel.selectedIds).toEqual([2, 3]);

            await run(gridModel, 'select_rows', {filters: []});
            expect(gridModel.selectedIds).toHaveLength(4);

            await result.undo();
            expect(gridModel.selectedIds).toEqual([]);
        });

        it('clears the selection, and undoes it', async () => {
            const gridModel = createGrid();
            gridModel.selModel.select([1, 2]);

            const result = await run(gridModel, 'clear_selection', {});
            expect(gridModel.hasSelection).toBe(false);

            await result.undo();
            expect(gridModel.selectedIds).toEqual([1, 2]);
        });
    });

    it("undoes a reply's grid changes through the chat", async () => {
        const gridModel = createGrid(),
            group = gridTools(gridModel),
            model = new ChatModel({
                transport: new ScriptedChatTransport({
                    responses: [
                        [
                            ...toolCallEvents('group_grid', {columns: ['region']}),
                            ...toolCallEvents('update_columns', {
                                changes: [{column: 'qty', visible: false}]
                            })
                        ],
                        textEvents('Grouped by region and hid Qty.')
                    ],
                    delayMs: 0
                }),
                tools: group.tools,
                contextProviders: [group.contextProvider]
            });
        onTestFinished(() => model.destroy());

        await model.sendAsync('Group by region and hide qty');
        expect(gridModel.groupBy).toEqual(['region']);
        expect(gridModel.isColumnVisible('qty')).toBe(false);

        await model.undoTurnAsync(model.lastMessage.id);
        expect(gridModel.groupBy).toEqual([]);
        expect(gridModel.isColumnVisible('qty')).toBe(true);
    });
});

//------------------
// Helpers
//------------------
const COL_IDS = ['id', 'name', 'region', 'price', 'qty'];

function createGrid(config: PlainObject = {}): GridModel {
    const gridModel = new GridModel({
        columns: [
            {field: {name: 'id', type: 'int'}, hidden: true, hideable: false},
            {field: {name: 'name', type: 'string'}},
            {field: {name: 'region', type: 'string'}},
            {field: {name: 'price', type: 'number'}},
            {field: {name: 'qty', type: 'int'}, sortable: false}
        ],
        sortBy: 'name',
        filterModel: true,
        enableExport: true,
        selModel: 'multiple',
        ...config
    });
    gridModel.loadData([
        {id: 1, name: 'Boston', region: 'AMER', price: 40, qty: 5},
        {id: 2, name: 'Tokyo', region: 'APAC', price: 120, qty: 10},
        {id: 3, name: 'Paris', region: 'EMEA', price: 300, qty: 20},
        {id: 4, name: 'Lima', region: 'AMER', price: 900, qty: 1}
    ]);
    onTestFinished(() => gridModel.destroy());
    return gridModel;
}

function getTool(group: ChatToolGroup, name: string): ChatToolSpec {
    return group.tools.find(it => it.name === name);
}

/** Run a tool of a new group on the grid, as the chat would, and return its result. */
async function run(
    gridModel: GridModel,
    name: string,
    input: PlainObject
): Promise<ChatToolResult> {
    const ret = await getTool(gridTools(gridModel), name).execute(input, null);
    expect(ret).toBeInstanceOf(ChatToolResult);
    return ret;
}
