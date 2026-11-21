import {fireEvent, render, screen} from '@testing-library/react';
import {div, fragment} from '@xh/hoist/cmp/layout';
import type {ReactElement} from 'react';
import {hoistCmp, uses, XH} from '@xh/hoist/core';
import {wait} from '@xh/hoist/promise';
import {initTestAppAsync} from '@xh/hoist/test-support';
import {beforeAll, describe, expect, it, onTestFinished, vi} from 'vitest';
import {
    loadBlueprint,
    portfolioCatalog,
    scenarioRegistry,
    weatherCatalog
} from '../../../test/blueprintFixtures';
import type {Blueprint, BlueprintDataProvider, BlueprintDataUpdate} from '../../../blueprint';
import {BlueprintModel} from '../../../blueprint';
import {elementFromContent} from '@xh/hoist/utils/react';
import {blueprintView} from './BlueprintView';
import {buttonGroupWidget, ButtonGroupWidgetModel} from './ButtonGroupWidget';
import {buttonGroupInputWidget, ButtonGroupInputWidgetModel} from './ButtonGroupInputWidget';
import {BlueprintViewModel} from './impl/BlueprintViewModel';
import {CubeGridWidgetModel} from './CubeGridWidget';
import {DashCanvasWidgetModel, DROP_VIEW_ID} from './DashCanvasWidget';
import {paletteDrag} from './impl/paletteDrag';
import {GroupingChooserWidgetModel} from './GroupingChooserWidget';
import {tabContainerWidget, TabContainerWidgetModel} from './TabContainerWidget';
import {tabContainer} from '@xh/hoist/cmp/tab';

/**
 * The desktop widgets derive their Hoist models from the document, and turn what a user does in
 * them into edits or outputs. Opening a blueprint must never itself emit an edit.
 */
describe('blueprint desktop widgets', () => {
    beforeAll(async () => {
        await initTestAppAsync();
    });

    const ROWS = [
        {id: 'a', sector: 'Energy', symbol: 'XOM', mktVal: 100, pnlDay: 1},
        {id: 'b', sector: 'Energy', symbol: 'SHEL', mktVal: 50, pnlDay: -2},
        {id: 'c', sector: 'Technology', symbol: 'NVDA', mktVal: 300, pnlDay: 5}
    ];

    /** A provider that sends ROWS for every subscription, as a snapshot. */
    const provider: BlueprintDataProvider = {
        loadAsync: async () => ({rows: ROWS}),
        subscribe(_, push: (u: BlueprintDataUpdate) => void) {
            queueMicrotask(() => push({replace: ROWS}));
            return () => {};
        }
    };

    /** Open a blueprint in design mode, where a user's change in a widget is an edit. */
    function open(blueprint: Blueprint, registry = scenarioRegistry()) {
        const ret = new BlueprintModel({
            blueprint,
            catalog: portfolioCatalog,
            registry,
            dataProvider: provider
        });
        ret.setAccess('write');
        ret.setMode('design');
        onTestFinished(() => ret.destroy());
        return ret;
    }

    /** Wait until a grid has applied its config's column state. */
    const columnsApplied = (grid: CubeGridWidgetModel) =>
        vi.waitFor(() => {
            const g = grid as any;
            expect(g.isApplyingColumns).toBe(false);
            expect(g.appliedColumnState.length).toBeGreaterThan(0);
        });

    function widget<T>(Cls: new (c: any) => T, blueprintModel: BlueprintModel, id: string): T {
        const ret = new Cls({blueprintModel, id, renderElement: () => null});
        onTestFinished(() => (ret as any).destroy());
        return ret;
    }

    describe('cubeGrid', () => {
        it('groups its source by groupBy, with a column per columnState entry', async () => {
            const model = open(loadBlueprint('p1-one-grid.json')),
                grid = widget(CubeGridWidgetModel, model, 'posGrid'),
                gridModel = grid.cubeGridModel.innerGridModel;

            await vi.waitFor(() => expect(gridModel.store.count).toBeGreaterThan(0));
            expect(grid.cubeGridModel.view.query.dimensions.map(it => it.name)).toEqual([
                'sector',
                'symbol'
            ]);
            expect(gridModel.getColumn('mktVal')).toBeTruthy();
            expect(gridModel.getColumn('pnlDay')).toBeTruthy();
            expect(model.version).toBe(1);
        });

        it('follows an edit to groupBy without a new grid model', async () => {
            const model = open(loadBlueprint('p1-one-grid.json')),
                grid = widget(CubeGridWidgetModel, model, 'posGrid'),
                {cubeGridModel} = grid;

            model.applyEdit({
                ops: [{op: 'set', path: '/elements/posGrid/config/groupBy', value: ['symbol']}]
            });
            expect(grid.cubeGridModel).toBe(cubeGridModel);
            expect(cubeGridModel.view.query.dimensions.map(it => it.name)).toEqual(['symbol']);
        });

        it("publishes the selected row's group path as its selection output", async () => {
            const model = open(loadBlueprint('p2-linked-dashboard.json')),
                grid = widget(CubeGridWidgetModel, model, 'posGrid'),
                gridModel = grid.cubeGridModel.innerGridModel;
            await vi.waitFor(() => expect(gridModel.store.count).toBeGreaterThan(0));

            const trader = gridModel.store.allRecords.find(
                it => it.data.cubeDimension === 'trader'
            );
            await gridModel.selectAsync(trader);
            expect(model.getVariable('selection').value).toEqual({
                op: 'AND',
                filters: [
                    {field: 'strategy', op: '=', value: trader.parent.data.cubeLabelValue},
                    {field: 'trader', op: '=', value: trader.data.cubeLabelValue}
                ]
            });
        });

        describe('conditional styles', () => {
            const styled = () => {
                const bp = loadBlueprint('p1-one-grid.json');
                bp.variables.lossLimit = {type: 'number', setBy: 'prompt', default: {value: 0}};
                Object.assign(bp.elements.posGrid.config, {
                    columns: {
                        pnlDay: {
                            styles: [
                                {
                                    when: {field: 'pnlDay', op: '<', value: {$var: 'lossLimit'}},
                                    style: {color: 'danger', fontWeight: 'bold'}
                                },
                                {
                                    when: {field: 'pnlDay', op: '<', value: -1},
                                    style: {color: '#aa0000'}
                                }
                            ]
                        }
                    },
                    rowStyles: [
                        {
                            when: {field: 'sector', op: '=', value: 'Energy'},
                            style: {background: 'warning', border: 'warning'},
                            rows: 'groups'
                        }
                    ]
                });
                return bp;
            };

            async function openStyled() {
                const model = open(styled()),
                    grid = widget(CubeGridWidgetModel, model, 'posGrid'),
                    gridModel = grid.cubeGridModel.innerGridModel;
                await vi.waitFor(() => expect(gridModel.store.count).toBeGreaterThan(0));
                await columnsApplied(grid);
                const record = (label: string) =>
                        gridModel.store.allRecords.find(it => it.data.cubeLabelValue === label),
                    cell = (label: string) => {
                        const r = record(label);
                        return (gridModel.getColumn('pnlDay').cellStyle as any)(r.data.pnlDay, {
                            record: r
                        });
                    },
                    row = (label: string) => (gridModel.rowStyle as any)(record(label));
                return {model, cell, row};
            }

            it('styles a cell by its rules in order, a later match winning property by property', async () => {
                const {cell} = await openStyled();
                expect(cell('SHEL')).toEqual({color: '#aa0000', fontWeight: 'bold'});
                expect(cell('XOM')).toEqual({});
                // A group row tests its aggregates: Energy totals -1.
                expect(cell('Energy')).toEqual({
                    color: 'var(--xh-intent-danger-text-color)',
                    fontWeight: 'bold'
                });
            });

            it('moves a style with a bound threshold, with no reload', async () => {
                const {model, cell} = await openStyled();
                model.setVariable('lossLimit', -5);
                await vi.waitFor(() => expect(cell('Energy')).toEqual({}));
                expect(cell('SHEL')).toEqual({color: '#aa0000'});
            });

            it('styles rows by its row rules, on the rows they name', async () => {
                const {row} = await openStyled();
                expect(row('Energy')).toEqual({
                    backgroundColor: 'var(--xh-intent-warning-trans1)',
                    boxShadow: 'inset 3px 0 0 var(--xh-intent-warning)'
                });
                expect(row('XOM')).toEqual({});
                expect(row('Technology')).toEqual({});
            });
        });

        describe('columns', () => {
            const withColumns = (columns: object, sourceFields?: object) => {
                const bp = loadBlueprint('p2-linked-dashboard.json');
                bp.elements.posGrid.config.columns = columns;
                if (sourceFields) bp.sources.positions.fields = sourceFields as any;
                return bp;
            };

            it("sets each column's Hoist config, over its source's and its catalog's", () => {
                const gridModel = widget(
                    CubeGridWidgetModel,
                    open(
                        withColumns(
                            {
                                mktVal: {
                                    headerName: 'MV',
                                    headerAlign: 'center',
                                    tooltip: true,
                                    highlightOnChange: true,
                                    minWidth: 60,
                                    maxWidth: 200,
                                    flex: 2,
                                    chooserName: 'Market value',
                                    chooserGroup: 'Key',
                                    chooserDescription: 'The close.',
                                    exportName: 'Market Value'
                                },
                                pnlDay: {align: 'left'},
                                group: {headerName: 'Book'}
                            },
                            {mktVal: {label: 'Value', align: 'center'}, pnlDay: {label: 'Today'}}
                        )
                    ),
                    'posGrid'
                ).cubeGridModel.innerGridModel;
                expect(gridModel.getColumn('mktVal')).toMatchObject({
                    headerName: 'MV',
                    headerAlign: 'center',
                    align: 'center',
                    tooltip: true,
                    highlightOnChange: true,
                    minWidth: 60,
                    maxWidth: 200,
                    flex: 2,
                    chooserName: 'Market value',
                    chooserGroup: 'Key',
                    chooserDescription: 'The close.',
                    exportName: 'Market Value'
                });
                expect(gridModel.getColumn('pnlDay')).toMatchObject({
                    headerName: 'Today',
                    align: 'left'
                });
                expect(gridModel.getColumn('pnlDay').chooserGroup).toBe('P&L');
                expect(gridModel.columns.find(it => (it as any).isTreeColumn)?.['headerName']).toBe(
                    'Book'
                );
            });

            it("writes a user's resize to columnState alone, leaving columns as they are", async () => {
                const columns = {mktVal: {headerName: 'MV', format: {precision: 0}}},
                    model = open(withColumns(columns)),
                    grid = widget(CubeGridWidgetModel, model, 'posGrid');
                await columnsApplied(grid);
                const gridModel = grid.cubeGridModel.innerGridModel;
                await vi.waitFor(() => expect(gridModel.store.count).toBeGreaterThan(0));
                await wait(100);
                gridModel.noteColumnManuallySized('mktVal', 150);
                await vi.waitFor(() =>
                    expect(model.blueprint.elements.posGrid.config.columnState).toEqual(
                        expect.arrayContaining([{field: 'mktVal', width: 150}])
                    )
                );
                expect(model.blueprint.elements.posGrid.config.columns).toEqual(columns);
            });

            it('follows an edit to columns or to its source, on the same grid', async () => {
                const model = open(withColumns({})),
                    grid = widget(CubeGridWidgetModel, model, 'posGrid');
                await columnsApplied(grid);
                const gridModel = grid.cubeGridModel.innerGridModel;
                model.applyEdit({
                    ops: [
                        {
                            op: 'set',
                            path: '/sources/positions/fields',
                            value: {pnlDay: {label: 'Today'}}
                        }
                    ]
                });
                await vi.waitFor(() =>
                    expect(gridModel.getColumn('pnlDay').headerName).toBe('Today')
                );
                model.applyEdit({
                    ops: [
                        {
                            op: 'set',
                            path: '/elements/posGrid/config/columns',
                            value: {pnlDay: {headerName: 'P&L'}}
                        }
                    ]
                });
                await vi.waitFor(() =>
                    expect(gridModel.getColumn('pnlDay').headerName).toBe('P&L')
                );
                expect(grid.cubeGridModel.innerGridModel).toBe(gridModel);
            });
        });

        describe('content height', () => {
            const ready = (grid: CubeGridWidgetModel, rows: number) => {
                const gridModel = grid.cubeGridModel.innerGridModel;
                vi.spyOn(gridModel, 'isReady', 'get').mockReturnValue(true);
                vi.spyOn(gridModel, 'isDataSynced', 'get').mockReturnValue(true);
                vi.spyOn(gridModel, 'agApi', 'get').mockReturnValue({
                    getDisplayedRowCount: () => rows
                } as any);
                onTestFinished(() => {
                    vi.restoreAllMocks();
                });
                return gridModel;
            };

            it('is unknown until ag-Grid is ready', () => {
                const grid = widget(
                    CubeGridWidgetModel,
                    open(loadBlueprint('p2-linked-dashboard.json')),
                    'posGrid'
                );
                expect(grid.contentHeight).toBeNull();
            });

            it("is the header and the displayed rows, at its sizing mode's heights, with any summary row", () => {
                const model = open(loadBlueprint('p2-linked-dashboard.json')),
                    grid = widget(CubeGridWidgetModel, model, 'posGrid');
                model.applyEdit({
                    ops: [
                        {op: 'set', path: '/elements/posGrid/config/sizingMode', value: 'compact'}
                    ]
                });
                ready(grid, 5);
                // Compact: a 22px header, and five 24px rows, inside a 1px border.
                expect(grid.contentHeight).toBe(22 + 5 * 24 + 2);

                model.applyEdit({
                    ops: [
                        {op: 'set', path: '/elements/posGrid/config/summaryRow', value: true},
                        {op: 'set', path: '/elements/posGrid/config/hideHeaders', value: true}
                    ]
                });
                expect(grid.contentHeight).toBe(6 * 24 + 2);

                // A horizontal scrollbar, as the component measures it, adds its height.
                grid.setHorizontalScrollHeight(9);
                expect(grid.contentHeight).toBe(6 * 24 + 9 + 2);
            });
        });

        describe('style options', () => {
            const styled = (config: object) => {
                const bp = loadBlueprint('p2-linked-dashboard.json');
                Object.assign(bp.elements.posGrid.config, config);
                return bp;
            };
            // A null value clears the key, as the Architect's remove op does.
            const setStyle = (model: BlueprintModel, key: string, value: unknown) => {
                const path = `/elements/posGrid/config/${key}`,
                    {issues} = model.applyEdit({
                        ops: [value == null ? {op: 'remove', path} : {op: 'set', path, value}]
                    });
                expect(issues).toEqual([]);
            };

            it("keeps Hoist's cube grid defaults when the config sets no style", () => {
                const gridModel = widget(
                    CubeGridWidgetModel,
                    open(loadBlueprint('p2-linked-dashboard.json')),
                    'posGrid'
                ).cubeGridModel.innerGridModel;
                expect(gridModel).toMatchObject({
                    treeStyle: 'highlights',
                    stripeRows: true,
                    rowBorders: true,
                    cellBorders: false,
                    showHover: false,
                    showGroupRowCounts: true,
                    hideHeaders: false,
                    emptyText: 'No data'
                });
                expect(gridModel.sizingMode).toBe(XH.sizingMode);
            });

            it('passes each style in its config to the grid', () => {
                const gridModel = widget(
                    CubeGridWidgetModel,
                    open(
                        styled({
                            treeStyle: 'colorsAndBorders',
                            stripeRows: true,
                            rowBorders: true,
                            cellBorders: true,
                            showHover: true,
                            sizingMode: 'compact',
                            showGroupRowCounts: false,
                            hideHeaders: true,
                            emptyText: 'No positions',
                            groupRowHeight: 40
                        })
                    ),
                    'posGrid'
                ).cubeGridModel.innerGridModel;
                expect(gridModel).toMatchObject({
                    treeStyle: 'colorsAndBorders',
                    stripeRows: true,
                    rowBorders: true,
                    cellBorders: true,
                    showHover: true,
                    sizingMode: 'compact',
                    showGroupRowCounts: false,
                    hideHeaders: true,
                    emptyText: 'No positions',
                    groupRowHeight: 40
                });
            });

            it('applies an edit to a style in place, on the same grid, and its default once cleared', () => {
                const model = open(styled({sizingMode: 'compact'})),
                    grid = widget(CubeGridWidgetModel, model, 'posGrid'),
                    gridModel = grid.cubeGridModel.innerGridModel;
                const edits: [string, unknown][] = [
                    ['treeStyle', 'borders'],
                    ['stripeRows', true],
                    ['rowBorders', true],
                    ['cellBorders', true],
                    ['showHover', true],
                    ['sizingMode', 'tiny'],
                    ['hideHeaders', true],
                    ['emptyText', 'Nothing here']
                ];
                edits.forEach(([key, value]) => {
                    setStyle(model, key, value);
                    expect(grid.cubeGridModel.innerGridModel).toBe(gridModel);
                    expect(gridModel[key]).toEqual(value);
                });
                setStyle(model, 'stripeRows', null);
                setStyle(model, 'emptyText', null);
                expect(gridModel).toMatchObject({stripeRows: true, emptyText: 'No data'});
                expect(grid.cubeGridModel.innerGridModel).toBe(gridModel);
            });

            it('rebuilds the grid for a style it cannot change in place, keeping the selection', async () => {
                const model = open(loadBlueprint('p2-linked-dashboard.json')),
                    grid = widget(CubeGridWidgetModel, model, 'posGrid'),
                    before = grid.cubeGridModel.innerGridModel;
                await vi.waitFor(() => expect(before.store.count).toBeGreaterThan(0));
                const trader = before.store.allRecords.find(
                    it => it.data.cubeDimension === 'trader'
                );
                await before.selectAsync(trader);

                setStyle(model, 'groupRowHeight', 44);
                const after = grid.cubeGridModel.innerGridModel;
                expect(after).not.toBe(before);
                expect(after.groupRowHeight).toBe(44);
                await vi.waitFor(() => expect(after.selectedIds).toEqual([trader.id]));

                setStyle(model, 'showGroupRowCounts', false);
                expect(grid.cubeGridModel.innerGridModel.showGroupRowCounts).toBe(false);
                setStyle(model, 'sizingMode', 'large');
                expect(grid.cubeGridModel.innerGridModel.sizingMode).toBe('large');
                setStyle(model, 'sizingMode', null);
                expect(grid.cubeGridModel.innerGridModel.sizingMode).toBe(XH.sizingMode);
            });
        });

        it("turns a user's sort into an edit of sortBy", async () => {
            const model = open(loadBlueprint('p1-one-grid.json')),
                grid = widget(CubeGridWidgetModel, model, 'posGrid');

            grid.cubeGridModel.innerGridModel.setSortBy('pnlDay|desc');
            await vi.waitFor(() =>
                expect(model.blueprint.elements.posGrid.config.sortBy).toBe('pnlDay|desc')
            );
        });
    });

    it("keeps a user's sort transient in run mode, with no edit", async () => {
        const model = open(loadBlueprint('p1-one-grid.json')),
            gridModel = widget(CubeGridWidgetModel, model, 'posGrid').cubeGridModel.innerGridModel;
        model.setMode('run');

        gridModel.setSortBy('pnlDay|desc');
        await vi.waitFor(() =>
            expect(model.effective.elements.posGrid.config.sortBy).toBe('pnlDay|desc')
        );
        expect(model.version).toBe(1);
        expect(model.blueprint.elements.posGrid.config.sortBy).toBeUndefined();
    });

    it('snaps a refused sort back to the blueprint, and tells the user why', async () => {
        const toast = vi.spyOn(XH, 'dangerToast').mockReturnValue(null),
            model = open(loadBlueprint('p1-one-grid.json')),
            gridModel = widget(CubeGridWidgetModel, model, 'posGrid').cubeGridModel.innerGridModel;
        onTestFinished(() => toast.mockRestore());
        vi.spyOn(model, 'applyEdit').mockReturnValue({
            issues: [{code: 'x.refused', severity: 'error', path: '', message: 'Refused.'}]
        });

        gridModel.setSortBy('pnlDay|desc');
        await vi.waitFor(() => expect(toast).toHaveBeenCalledWith('Refused.'));
        expect(gridModel.sortBy).toEqual([]);
    });

    it('makes no edit when the grid autosizes its columns', async () => {
        const model = open(loadBlueprint('p1-one-grid.json')),
            grid = widget(CubeGridWidgetModel, model, 'posGrid'),
            gridModel = grid.cubeGridModel.innerGridModel;
        await columnsApplied(grid);

        gridModel.updateColumnState([
            {colId: 'cubeLabel', width: 180, manuallySized: false},
            {colId: 'mktVal', width: 120, manuallySized: false}
        ]);
        await wait(50);
        expect(model.version).toBe(1);
    });

    it('makes no edit for the tree column while it is pinned left, visible and not sized by hand', async () => {
        const model = open(loadBlueprint('p1-one-grid.json')),
            grid = widget(CubeGridWidgetModel, model, 'posGrid');
        await columnsApplied(grid);

        // As a real render reports it, with an autosized width and the tree column last.
        (grid as any).writeColumnState([
            {colId: 'mktVal', hidden: false, manuallySized: false, pinned: null},
            {colId: 'pnlDay', hidden: false, manuallySized: false, pinned: null},
            {colId: 'cubeLabel', hidden: false, width: 180, manuallySized: false, pinned: 'left'}
        ]);
        expect(model.history).toEqual([]);
    });

    it('makes no edit for a flat grid whose hidden tree column reports no pin', async () => {
        const model = open(loadBlueprint('p2-linked-dashboard.json')),
            grid = widget(CubeGridWidgetModel, model, 'ordersGrid');
        await columnsApplied(grid);

        // As a real render reports it.
        (grid as any).writeColumnState([
            ...['time', 'symbol', 'dir', 'quantity', 'price', 'mktVal', 'trader'].map(colId => ({
                colId,
                hidden: false,
                manuallySized: false,
                pinned: null
            })),
            {colId: 'cubeLabel', hidden: true, manuallySized: false, pinned: null}
        ]);
        expect(model.history).toEqual([]);
    });

    it('hides the tree column of a flat grid, without an edit, and shows it once grouped', async () => {
        const model = open(loadBlueprint('p2-linked-dashboard.json')),
            grid = widget(CubeGridWidgetModel, model, 'ordersGrid'),
            gridModel = grid.cubeGridModel.innerGridModel,
            isLabelHidden = () => gridModel.columnState.find(it => it.colId === 'cubeLabel').hidden;
        await columnsApplied(grid);
        expect(isLabelHidden()).toBe(true);
        expect(model.history).toEqual([]);

        model.applyEdit({
            ops: [{op: 'set', path: '/elements/ordersGrid/config/groupBy', value: ['trader']}]
        });
        await vi.waitFor(() => expect(isLabelHidden()).toBe(false));
        await columnsApplied(grid);
        expect(model.history).toHaveLength(1);
    });

    it("restores the grid to the blueprint's config, with no edit, after other edits", async () => {
        const model = open(loadBlueprint('p1-one-grid.json')),
            grid = widget(CubeGridWidgetModel, model, 'posGrid'),
            gridModel = grid.cubeGridModel.innerGridModel;
        await columnsApplied(grid);
        model.applyEdit({
            ops: [{op: 'set', path: '/elements/posGrid/config/columnState', value: ['pnlDay']}]
        });
        await columnsApplied(grid);
        const version = model.version;

        const confirm = vi.spyOn(XH, 'confirm').mockResolvedValue(true);
        onTestFinished(() => confirm.mockRestore());
        // Autosize waits for a rendered ag-Grid, which jsdom never has.
        vi.spyOn(gridModel, 'autosizeAsync').mockResolvedValue(undefined);
        expect(await gridModel.restoreDefaultsAsync()).toBe(true);
        await columnsApplied(grid);
        await wait(50);
        expect(model.version).toBe(version);
        expect(model.blueprint.elements.posGrid.config.columnState).toEqual(['pnlDay']);
        expect(gridModel.columnState.filter(it => !it.hidden).map(it => it.colId)).toContain(
            'pnlDay'
        );
    });

    it("redraws its cells when an edit changes a named format the blueprint's columns use", async () => {
        const model = open(loadBlueprint('p1-one-grid.json')),
            grid = widget(CubeGridWidgetModel, model, 'posGrid'),
            gridModel = grid.cubeGridModel.innerGridModel,
            cell = () => {
                const col = gridModel.getColumn('mktVal');
                return render(col.renderer(2500000, {column: col, gridModel} as any) as any)
                    .container.textContent;
            };
        await columnsApplied(grid);
        expect(cell()).toMatch(/^2\.5m/);

        model.applyEdit({ops: [{op: 'set', path: '/formats/mv', value: {precision: 0}}]});
        await columnsApplied(grid);
        expect(cell()).toMatch(/^2,500,000/);
    });

    it('makes no edit for a pinned column listed anywhere, or a hidden one that lost its pin', async () => {
        const bp = loadBlueprint('p1-one-grid.json');
        bp.elements.posGrid.config.columnState = [
            'mktVal',
            {field: 'pnlDay', pinned: 'left'},
            {field: 'pnlMtd', hidden: true, pinned: 'right', width: 90}
        ];
        const model = open(bp),
            grid = widget(CubeGridWidgetModel, model, 'posGrid');
        await columnsApplied(grid);

        // As ag-Grid reports it: master order across pin regions, and a hidden column bare.
        (grid as any).writeColumnState([
            {colId: 'cubeLabel', hidden: false, manuallySized: false, pinned: 'left'},
            {colId: 'pnlDay', hidden: false, manuallySized: false, pinned: 'left'},
            {colId: 'mktVal', hidden: false, manuallySized: false, pinned: null},
            {colId: 'pnlMtd', hidden: true}
        ]);
        expect(model.history).toEqual([]);
    });

    it('writes a fractional width from the grid as whole pixels', async () => {
        const model = open(loadBlueprint('p1-one-grid.json')),
            grid = widget(CubeGridWidgetModel, model, 'posGrid'),
            gridModel = grid.cubeGridModel.innerGridModel;
        await columnsApplied(grid);
        await vi.waitFor(() => expect(gridModel.store.count).toBeGreaterThan(0));
        await wait(100);
        const {version} = model;
        gridModel.noteColumnManuallySized('mktVal', 156.67);
        await vi.waitFor(() => expect(model.version).toBe(version + 1));
        expect(model.blueprint.elements.posGrid.config.columnState).toEqual([
            {field: 'mktVal', width: 157},
            'pnlDay'
        ]);
    });

    it("turns a user's resize into an edit of columnState, leaving the tree column out", async () => {
        const model = open(loadBlueprint('p1-one-grid.json')),
            grid = widget(CubeGridWidgetModel, model, 'posGrid'),
            gridModel = grid.cubeGridModel.innerGridModel;
        await columnsApplied(grid);

        // A user resizes once the data has loaded and the grid has autosized.
        await vi.waitFor(() => expect(gridModel.store.count).toBeGreaterThan(0));
        await wait(100);
        gridModel.noteColumnManuallySized('mktVal', 150);
        await vi.waitFor(() =>
            expect(model.blueprint.elements.posGrid.config.columnState).toEqual([
                {field: 'mktVal', width: 150},
                'pnlDay'
            ])
        );
    });

    describe('groupingChooser', () => {
        it('shows the value of the variable it sets, and sets it as the user chooses', () => {
            const model = open(loadBlueprint('p3-morning-report.json')),
                chooser = widget(GroupingChooserWidgetModel, model, 'groupChooser'),
                {chooserModel} = chooser;

            expect(chooserModel.value).toEqual(['strategy', 'trader', 'symbol']);
            expect(chooserModel.dimensions.sector.displayName).toBe('Sector');

            chooserModel.setValue(['sector']);
            expect(model.getVariable('grouping').value).toEqual(['sector']);

            model.resetVariable('grouping');
            expect(chooserModel.value).toEqual(['strategy', 'trader', 'symbol']);
        });
    });

    describe('buttonGroup', () => {
        it('shows a button per action, described in its tooltip, that runs it', async () => {
            const model = open(loadBlueprint('p3-morning-report.json'));
            render(buttonGroupWidget({model: widget(ButtonGroupWidgetModel, model, 'pnlButtons')}));

            const winners = await screen.findByText('Winners');
            expect(winners.closest('button').title).toBe('Set pnlFilter to pnlDay > 0');
            fireEvent.click(winners);
            await vi.waitFor(() =>
                expect(model.getVariable('pnlFilter').value).toEqual({
                    field: 'pnlDay',
                    op: '>',
                    value: 0
                })
            );
        });

        it('disables a button whose action cannot run now, with the reason as its tooltip', async () => {
            const registry = scenarioRegistry();
            let busy = true;
            registry.addBuiltIns({
                actions: [
                    {
                        name: 'ask',
                        params: {type: 'object', properties: {}},
                        check: () => (busy ? 'The chat is busy.' : null),
                        run: () => {}
                    }
                ]
            });
            const bp = loadBlueprint('p3-morning-report.json');
            bp.elements.pnlButtons.config.buttons = [{label: 'Ask', action: {type: 'ask'}}];
            const model = open(bp, registry),
                button = widget(ButtonGroupWidgetModel, model, 'pnlButtons');
            expect(button.blockedReason({type: 'ask'})).toBe('The chat is busy.');
            const el = render(buttonGroupWidget({model: button})).container.querySelector('button');
            expect(el.disabled).toBe(true);
            expect(el.title).toBe('The chat is busy.');
            busy = false;
            expect(button.blockedReason({type: 'ask'})).toBeNull();
        });
    });

    describe('buttonGroupInput', () => {
        it('shows the value of the variable it sets as the pressed option, and sets it', async () => {
            const model = new BlueprintModel({
                blueprint: loadBlueprint('w2-two-cities.json'),
                catalog: weatherCatalog,
                registry: scenarioRegistry(),
                dataProvider: provider
            });
            onTestFinished(() => model.destroy());
            render(
                buttonGroupInputWidget({
                    model: widget(ButtonGroupInputWidgetModel, model, 'unitsToggle')
                })
            );

            const fahrenheit = await screen.findByText('°F'),
                celsius = await screen.findByText('°C');
            expect(fahrenheit.closest('button').className).toMatch(/-active\b/);

            fireEvent.click(celsius);
            await vi.waitFor(() => expect(model.getVariable('units').value).toBe('metric'));
            await vi.waitFor(async () =>
                expect((await screen.findByText('°C')).closest('button').className).toMatch(
                    /-active\b/
                )
            );
        });
    });

    describe('tabContainer', () => {
        const p3 = () => loadBlueprint('p3-morning-report.json');

        it('shows a tab per child, titled by its reference, rendering the child', () => {
            const model = open(p3()),
                rendered: string[] = [],
                tabs = new TabContainerWidgetModel({
                    blueprintModel: model,
                    id: 'tabs',
                    renderElement: id => {
                        rendered.push(id);
                        return div(id);
                    }
                });
            onTestFinished(() => tabs.destroy());
            const {tabContainerModel} = tabs;

            expect(tabContainerModel.tabs.map(it => [it.id, it.title])).toEqual([
                ['overview', 'Overview'],
                ['positions', 'Positions'],
                ['orders', 'Orders']
            ]);
            render(tabContainer({model: tabContainerModel}));
            expect(rendered).toContain('overview');
        });

        it('scrolls its tabs, with a menu for those that do not fit, as in a narrow chat', () => {
            const model = open(p3()),
                tabs = new TabContainerWidgetModel({
                    blueprintModel: model,
                    id: 'tabs',
                    renderElement: id => div(id)
                });
            onTestFinished(() => tabs.destroy());
            const {container} = render(tabContainerWidget({model: tabs}));
            expect(container.querySelector('.xh-tab-switcher--overflow-enabled')).toBeTruthy();
        });

        it('follows edits to its children, keeping the active tab', () => {
            const model = open(p3()),
                tabs = widget(TabContainerWidgetModel, model, 'tabs'),
                {tabContainerModel} = tabs;
            tabContainerModel.activateTab('orders');

            model.applyEdit({
                ops: [
                    {
                        op: 'set',
                        path: '/elements/tabs/children',
                        value: [
                            {id: 'orders', title: 'Blotter'},
                            {id: 'overview', title: 'Overview'},
                            {id: 'positions', title: 'Positions'}
                        ]
                    }
                ]
            });
            expect(tabContainerModel.tabs.map(it => it.title)).toEqual([
                'Blotter',
                'Overview',
                'Positions'
            ]);
            expect(tabContainerModel.activeTabId).toBe('orders');
            expect(model.version).toBe(2);
        });
    });

    describe('dashCanvas', () => {
        it('places each child as its reference says, and opens without an edit', async () => {
            const model = open(loadBlueprint('p2-linked-dashboard.json')),
                canvas = widget(DashCanvasWidgetModel, model, 'dashboard'),
                layout = canvas.canvasModel.state.map(it => ({id: it.viewSpecId, ...it.layout}));

            expect(layout).toEqual(
                expect.arrayContaining(
                    model.blueprint.elements.dashboard.children.map(it => ({...it}))
                )
            );
            expect(model.version).toBe(1);
        });

        it("draws a cell's header items in its header, and keeps them through a move", () => {
            const bp = loadBlueprint('p2-linked-dashboard.json');
            bp.variables.region = {
                type: 'string',
                options: {values: ['EU']},
                setBy: {element: 'regionPick'}
            };
            bp.elements.regionPick = {component: 'select', config: {}};
            (bp.elements.dashboard.children.find(it => it.id === 'posGrid') as any).headerItems = [
                {id: 'regionPick'}
            ];
            const model = open(bp),
                canvas = widget(DashCanvasWidgetModel, model, 'dashboard'),
                view = () => canvas.canvasModel.viewModels.find(it => it.viewSpec.id === 'posGrid');
            expect(view().viewSpec.hidePanelHeader).toBe(false);
            expect(view().headerItems).toHaveLength(1);

            canvas.canvasModel.loadState(
                canvas.canvasModel.state.map(it =>
                    it.viewSpecId === 'posGrid' ? {...it, layout: {...it.layout, y: 20}} : it
                )
            );
            const cell = model.blueprint.elements.dashboard.children.find(
                it => it.id === 'posGrid'
            );
            expect(cell).toMatchObject({y: 20, headerItems: [{id: 'regionPick'}]});
        });

        it('takes a widget dragged from the palette only in design mode, sized as it starts', () => {
            const model = open(loadBlueprint('p2-linked-dashboard.json')),
                canvas = widget(DashCanvasWidgetModel, model, 'dashboard'),
                drops: unknown[] = [];
            expect(canvas.onDragOver()).toBe(false);

            paletteDrag.start({
                component: 'chart',
                size: {w: 4, h: 6},
                drop: (...args) => drops.push(args)
            });
            onTestFinished(() => paletteDrag.end());
            expect(canvas.onDragOver()).toEqual({w: 4, h: 6});

            // As the canvas's drop does: a view of the drop's spec where it fell.
            const view = (canvas.canvasModel as any).addViewInternal(DROP_VIEW_ID, {
                layout: {x: 0, y: 14, w: 4, h: 6}
            });
            canvas.onDropDone(view);
            expect(canvas.canvasModel.viewModels.map(it => it.viewSpec.id)).not.toContain(
                DROP_VIEW_ID
            );
            const [[canvasId, child, siblings]] = drops as any[];
            expect([canvasId, child]).toEqual(['dashboard', {x: 0, y: 14, w: 4, h: 6}]);
            expect(siblings.map(it => it.id).sort()).toEqual([
                'headline',
                'ordersGrid',
                'posGrid',
                'sectorChart'
            ]);
            expect(model.version).toBe(1);
            expect(canvas.canvasModel.viewSpecs.map(it => it.id)).not.toContain(DROP_VIEW_ID);

            model.setMode('run');
            expect(canvas.onDragOver()).toBe(false);
        });

        it('turns a move into one edit of its children, in reading order', () => {
            const model = open(loadBlueprint('p2-linked-dashboard.json')),
                canvas = widget(DashCanvasWidgetModel, model, 'dashboard'),
                state = canvas.canvasModel.state.map(it =>
                    it.viewSpecId === 'headline' ? {...it, layout: {...it.layout, y: 14}} : it
                );
            canvas.canvasModel.loadState(state);

            expect(model.version).toBe(2);
            expect(model.blueprint.elements.dashboard.children.map(it => it.id)).toEqual([
                'posGrid',
                'sectorChart',
                'ordersGrid',
                'headline'
            ]);
        });

        it('snaps back to the document when the edit for a move is refused', () => {
            const model = open(loadBlueprint('p2-linked-dashboard.json')),
                canvas = widget(DashCanvasWidgetModel, model, 'dashboard'),
                state = canvas.canvasModel.state.map(it =>
                    it.viewSpecId === 'headline' ? {...it, layout: {...it.layout, y: 3}} : it
                );
            const toast = vi.spyOn(XH, 'dangerToast').mockReturnValue(null);
            onTestFinished(() => toast.mockRestore());
            canvas.canvasModel.loadState(state);

            expect(toast).toHaveBeenCalledWith(expect.stringMatching(/overlaps/));
            expect(model.version).toBe(1);
            const headline = canvas.canvasModel.state.find(it => it.viewSpecId === 'headline');
            expect(headline.layout.y).toBe(0);
        });

        it('shows a header only for a child with a title, and follows edits to titles', () => {
            const model = open(loadBlueprint('p2-linked-dashboard.json')),
                canvas = widget(DashCanvasWidgetModel, model, 'dashboard'),
                view = (id: string) =>
                    canvas.canvasModel.viewModels.find(it => it.viewSpec.id === id);

            expect(view('sectorChart').viewSpec.hidePanelHeader).toBe(false);
            expect(view('sectorChart').title).toBe('Day P&L by Sector');
            expect(view('posGrid').viewSpec.hidePanelHeader).toBe(true);

            model.applyEdit({
                ops: [
                    {op: 'set', path: '/elements/sectorChart/config/title', value: 'P&L'},
                    {op: 'set', path: '/elements/posGrid/config/title', value: 'Positions'}
                ]
            });
            expect(view('sectorChart').title).toBe('P&L');
            expect(view('posGrid').viewSpec.hidePanelHeader).toBe(false);
            expect(view('posGrid').title).toBe('Positions');
            expect(model.version).toBe(2);
        });

        it('follows an edit that adds a child', () => {
            const model = open(loadBlueprint('p2-linked-dashboard.json')),
                canvas = widget(DashCanvasWidgetModel, model, 'dashboard');
            model.applyEdit({
                ops: [
                    {
                        op: 'addElement',
                        id: 'extra',
                        element: {component: 'cubeGrid', config: {source: 'orders'}},
                        parent: 'dashboard',
                        child: {x: 0, y: 14, w: 6, h: 4}
                    }
                ]
            });
            expect(canvas.canvasModel.state.map(it => it.viewSpecId)).toContain('extra');
        });
    });

    it('renders the toolbar prompts over the root element', async () => {
        const model = open(loadBlueprint('p1-one-grid.json'));
        render(blueprintView({model}));
        expect(await screen.findByText('As of')).toBeTruthy();
    });

    it('draws a titled answer panel in a Hoist panel when its host gives no frame', () => {
        const registry = scenarioRegistry();
        registry.addBuiltIns({
            presentations: [
                {
                    widget: 'cubeGrid',
                    presentation: {
                        name: 'card',
                        label: 'Card',
                        guidance: 'A flat preview.',
                        component: (() => null) as any,
                        ignores: ['groupBy']
                    }
                }
            ]
        });
        const bp = loadBlueprint('p1-one-grid.json');
        bp.elements.posGrid.config.title = 'Positions';
        const model = new BlueprintModel({
                blueprint: bp,
                catalog: portfolioCatalog,
                registry,
                dataProvider: provider,
                isAnswer: true,
                defaultPresentation: 'card'
            }),
            viewModel = new BlueprintViewModel(model);
        onTestFinished(() => {
            viewModel.destroy();
            model.destroy();
        });
        const {container} = render(fragment(viewModel.renderElement('posGrid')) as ReactElement),
            panel = container.querySelector<HTMLElement>('.xh-blueprint-view__answer-panel');
        expect(panel.querySelector('.xh-panel-header')?.textContent).toContain('Positions');
        expect(panel.style.height).toBe('calc(300px + var(--xh-title-compact-height))');
    });

    it('renders a dashCanvas child as DashCanvasView renders view content', async () => {
        const viewModel = new BlueprintViewModel(open(loadBlueprint('p2-linked-dashboard.json'))),
            canvas = viewModel.getWidgetModel('dashboard') as DashCanvasWidgetModel,
            spec = canvas.canvasModel.viewSpecs.find(it => it.id === 'headline');
        onTestFinished(() => viewModel.destroy());

        // DashCanvasView passes its own model to the content as `viewModel`.
        const {container} = render(
            elementFromContent(spec.content, {flex: 1, viewModel: canvas.canvasModel})
        );
        expect(container.querySelector('.xh-blueprint-tile-frame')).toBeTruthy();
    });

    it('says a result is too large to show, in place of the widget over it', async () => {
        const model = new BlueprintModel({
            blueprint: loadBlueprint('p4-answer.json'),
            catalog: portfolioCatalog,
            registry: scenarioRegistry(),
            dataProvider: provider,
            artifacts: {art_7f2: 'positions'},
            artifactProvider: {loadArtifactAsync: async () => ({rows: [], totalRows: 6000})},
            isAnswer: true
        });
        onTestFinished(() => model.destroy());
        render(blueprintView({model}));
        expect(await screen.findByText('This result has too many rows to show here.')).toBeTruthy();
    });

    it('says the data of an answer is no longer available, in place of the widget over it', async () => {
        const model = new BlueprintModel({
            blueprint: loadBlueprint('p4-answer.json'),
            catalog: portfolioCatalog,
            registry: scenarioRegistry(),
            dataProvider: provider,
            artifacts: {art_7f2: 'positions'},
            artifactProvider: {loadArtifactAsync: async () => null},
            isAnswer: true
        });
        onTestFinished(() => model.destroy());
        render(blueprintView({model}));
        expect(
            await screen.findByText('The data for this answer is no longer available.')
        ).toBeTruthy();
    });

    it('renders an element with the presentation its config picks, over the same model', async () => {
        const registry = scenarioRegistry();
        registry.addBuiltIns({
            presentations: [
                {
                    widget: 'cubeGrid',
                    presentation: {
                        name: 'card',
                        label: 'Card',
                        guidance: 'A card.',
                        component: hoistCmp.factory({
                            model: uses(CubeGridWidgetModel),
                            render: ({model}) => div(`Card of ${model.id}`)
                        })
                    }
                }
            ]
        });
        const bp = loadBlueprint('p1-one-grid.json');
        bp.elements.posGrid.config.presentation = 'card';
        render(blueprintView({model: open(bp, registry)}));
        expect(await screen.findByText('Card of posGrid')).toBeTruthy();
    });

    it('replaces a blueprint with charts with another, without a widget outliving its source', async () => {
        const model = open(loadBlueprint('p3-morning-report.json'));
        render(blueprintView({model}));
        expect(await screen.findByText('As of')).toBeTruthy();
        model.setBlueprint(loadBlueprint('p1-one-grid.json'));
        await wait();
        expect(model.blueprint.root).toBe('posGrid');
    });

    it('leaves preset groups out of its toolbar, for a presetSelector to show', async () => {
        const model = open(loadBlueprint('p3-morning-report.json'));
        render(blueprintView({model}));
        expect(await screen.findByText('As of')).toBeTruthy();
        expect(screen.queryByText('Columns')).toBeNull();
    });

    it("renders an app variable type's own prompt input", async () => {
        const registry = scenarioRegistry(),
            bp = loadBlueprint('p1-one-grid.json');
        registry.addVariableTypes({
            name: 'toolbox.fund',
            matches: 'string',
            input: ({value}) => div(`Fund input: ${value}`)
        });
        bp.variables.fund = {
            type: 'toolbox.fund',
            label: 'Fund',
            setBy: 'prompt',
            default: {value: 'Oak Mount'}
        };
        bp.sources.positions.params.fund = {$var: 'fund'};

        render(blueprintView({model: open(bp, registry)}));
        expect(await screen.findByText('Fund input: Oak Mount')).toBeTruthy();
    });
});
