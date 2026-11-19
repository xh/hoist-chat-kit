import {AgGrid} from '@xh/hoist/cmp/ag-grid';
import {CubeGridModel, cubeGrid} from '@xh/hoist/cmp/cubegrid';
import {type ColumnSpec, type ColumnState, GridModel} from '@xh/hoist/cmp/grid';
import {hoistCmp, managed, type PlainObject, uses} from '@xh/hoist/core';
import type {FilterSpec, StoreRecord} from '@xh/hoist/data';
import {observableRef, when} from '@xh/hoist/mobx';
import {wait} from '@xh/hoist/promise';
import {castArray, isEmpty, isEqual, isString, omitBy, pick, sortBy, without} from 'lodash';
import {
    BlueprintWidgetModel,
    type BlueprintWidgetConfig,
    type CubeGridWidgetConfig
} from '../../../blueprint';
import {CUBE_GRID_STYLES} from '../../../blueprint/impl/builtInWidgets';
import {type FieldDisplay, fieldDisplay} from '../../../blueprint/impl/renderers';

/**
 * The `cubeGrid` widget: a Hoist `CubeGrid` over its source's Cube, grouped by `groupBy`, with
 * the columns of `columnState`. A sort or a change to the columns becomes an edit. Its selection
 * is the `selection` output, as a filter of the selected row's group path, and the `selected`
 * output, as the selected row's data.
 */
// GridModel takes these styles only as it is built. It changes the rest in place.
const BUILT_STYLES = ['groupRowHeight', 'showGroupRowCounts'],
    LIVE_STYLES = without(CUBE_GRID_STYLES, ...BUILT_STYLES);

// Hoist sets its row and header heights on AgGrid, untyped.
const AG_GRID = AgGrid as any,
    GRID_BORDERS = 2;

// CubeGridModel's own defaults, over GridModel's, for a style an edit clears.
const CUBE_GRID_DEFAULTS = {emptyText: 'No data', stripeRows: true, rowBorders: true};

export class CubeGridWidgetModel extends BlueprintWidgetModel<CubeGridWidgetConfig> {
    @managed @observableRef accessor cubeGridModel: CubeGridModel = null;

    // The grid's column state just after it applied the config's, to tell a user's change apart.
    private appliedColumnState: ColumnState[] = [];
    private isApplyingColumns = false;

    constructor(config: BlueprintWidgetConfig) {
        super(config);
        this.addReaction({
            track: () => this.source?.cube,
            run: () => this.buildGrid(),
            fireImmediately: true
        });
        this.addReaction(
            {
                track: () => [
                    castArray(this.resolvedConfig.groupBy ?? []),
                    this.blueprintModel.resolveFilter(this.element?.config.filter)
                ],
                run: ([dimensions, filter]) =>
                    this.cubeGridModel?.view.updateQuery({
                        ...toQuery(dimensions as string[]),
                        filter: filter as FilterSpec
                    }),
                equals: 'structural'
            },
            {
                track: () => [
                    this.resolvedConfig.columnState,
                    this.isFlat,
                    this.blueprintModel.blueprint?.formats,
                    this.columnLabels
                ],
                run: () => this.applyColumnStateAsync(),
                equals: 'structural'
            },
            {
                track: () => this.resolvedConfig.sortBy,
                run: sortBy => this.gridModel?.setSortBy(toGridSort(sortBy)),
                equals: 'structural'
            },
            {
                track: () => !!this.resolvedConfig.summaryRow,
                run: show => this.cubeGridModel?.setShowSummary(show)
            },
            {
                track: () => pick(this.resolvedConfig, LIVE_STYLES),
                run: () => this.applyLiveStyles(),
                equals: 'structural'
            },
            {
                // GridModel takes these only as it is built, and binds to the app's sizing mode
                // only when built without one.
                track: () => {
                    const cfg = this.resolvedConfig;
                    return [cfg.groupRowHeight, cfg.showGroupRowCounts, cfg.sizingMode == null];
                },
                run: () => this.rebuildGrid(),
                equals: 'structural'
            },
            {
                track: () => this.resolvedConfig.expandLevel,
                run: level => level != null && this.gridModel?.expandToLevel(level),
                fireImmediately: true
            },
            {
                track: () => this.gridModel?.sortBy.map(String),
                run: sorters => this.writeSortBy(sorters),
                equals: 'structural'
            },
            {
                track: () => this.gridModel?.columnState,
                run: state => this.writeColumnState(state),
                equals: 'structural'
            },
            {
                track: () => this.selectionOutputs,
                run: ({selection, selected}) => {
                    this.setOutput('selection', selection);
                    this.setOutput('selected', selected);
                },
                equals: 'structural',
                fireImmediately: true
            }
        );
    }

    /**
     * The header, the rows on display and any summary row, at the heights of the grid's sizing
     * mode. Null until ag-Grid shows the source's rows, as only it knows which rows show.
     */
    override get contentHeight(): number {
        const {gridModel} = this;
        if (!gridModel?.isReady || !gridModel.isDataSynced) return null;
        // Rows show and hide as nodes expand and collapse.
        void gridModel.expandState;
        const {sizingMode, hideHeaders} = gridModel,
            rows =
                gridModel.agApi.getDisplayedRowCount() + (this.resolvedConfig.summaryRow ? 1 : 0),
            header = hideHeaders ? 0 : AG_GRID.getHeaderHeightForSizingMode(sizingMode);
        return header + rows * AG_GRID.getRowHeightForSizingMode(sizingMode) + GRID_BORDERS;
    }

    //------------------
    // Implementation
    //------------------
    private buildGrid() {
        const {cube} = this.source ?? {};
        this.registerView(null);
        this.cubeGridModel?.destroy();
        this.cubeGridModel = null;
        if (!cube) return;

        const cfg = this.resolvedConfig;
        this.cubeGridModel = new CubeGridModel({
            cube,
            query: {
                ...toQuery(castArray(cfg.groupBy ?? [])),
                filter: this.blueprintModel.resolveFilter(this.element.config.filter),
                includeRoot: true
            },
            columns: this.buildColumns(),
            labelColumn: this.buildLabelColumn(),
            gridConfig: {
                ...omitBy(pick(cfg, CUBE_GRID_STYLES), it => it == null),
                showSummary: !!cfg.summaryRow,
                sortBy: toGridSort(cfg.sortBy),
                autosizeOptions: {mode: 'managed'},
                // Hoist restores the state it had at construction. The blueprint's config is the
                // default, so apply it again, which then writes back as no edit.
                restoreDefaultsFn: () => this.restoreConfigAsync()
            }
        });
        this.registerView(this.cubeGridModel.view);
        this.applyColumnStateAsync();
    }

    /** Build the grid again, keeping the user's selection and expanded rows. */
    private async rebuildGrid() {
        const prev = this.gridModel;
        if (!prev) return;
        const {selectedIds, expandState} = prev;
        this.buildGrid();
        const {gridModel} = this;
        await when(() => gridModel.store.count > 0, {timeout: 5_000}).catch(() => null);
        if (gridModel !== this.gridModel) return;
        if (selectedIds.length) await gridModel.selectAsync(selectedIds, {ensureVisible: false});
        // Rows expand only once ag-Grid has drawn the new grid.
        if ((await gridModel.whenReadyAsync()) && gridModel === this.gridModel) {
            gridModel.setExpandState(expandState);
        }
    }

    /** Set each style GridModel can change in place, or its default where the config sets none. */
    private applyLiveStyles() {
        const {gridModel} = this;
        if (!gridModel) return;
        const cfg = this.resolvedConfig,
            defaults = GridModel.defaults;
        gridModel.treeStyle = cfg.treeStyle ?? defaults.treeStyle;
        gridModel.emptyText = cfg.emptyText ?? CUBE_GRID_DEFAULTS.emptyText;
        gridModel.setStripeRows(cfg.stripeRows ?? CUBE_GRID_DEFAULTS.stripeRows);
        gridModel.setRowBorders(cfg.rowBorders ?? CUBE_GRID_DEFAULTS.rowBorders);
        gridModel.setCellBorders(cfg.cellBorders ?? defaults.cellBorders);
        gridModel.setShowHover(cfg.showHover ?? defaults.showHover);
        gridModel.setHideHeaders(cfg.hideHeaders ?? false);
        if (cfg.sizingMode != null) gridModel.setSizingMode(cfg.sizingMode);
    }

    /** True for a grid with no grouping, whose tree column would only show row IDs. */
    private get isFlat(): boolean {
        return castArray(this.resolvedConfig.groupBy ?? []).length === 0;
    }

    private get gridModel() {
        return this.cubeGridModel?.innerGridModel;
    }

    private buildColumns(): ColumnSpec[] {
        const {blueprintModel, source} = this,
            {catalog, blueprint, registry} = blueprintModel;
        return columnEntries(this.resolvedConfig.columnState)
            .filter(it => it.field !== TREE_COLUMN && source.fields[it.field])
            .map(({field, format, renderer}) => {
                const def = source.fields[field],
                    label = source.fieldLabel(field),
                    display = fieldDisplay(def, {format, renderer}, {catalog, blueprint, registry}),
                    isNum = def.type === 'number' || def.type === 'int',
                    isAggregate = (record: StoreRecord) => record?.data.cubeRowType !== 'leaf';
                return {
                    field: {name: field, type: def.type as any, displayName: label},
                    displayName: label,
                    headerName: label,
                    absSort: isNum,
                    align: isNum ? 'right' : null,
                    renderer: (v, {record}) => display.render(v, record?.data, isAggregate(record)),
                    exportValue: (v, {record}) =>
                        display.exportValue(v, record?.data, isAggregate(record))
                };
            });
    }

    /** The label of each column's field, which can follow variables. */
    private get columnLabels(): string[] {
        return columnEntries(this.resolvedConfig.columnState).map(it =>
            this.source?.fieldLabel(it.field)
        );
    }

    /**
     * The tree column: each group row draws its value with the format and renderer of the
     * dimension it groups by. Other rows show their label as Hoist does.
     */
    private buildLabelColumn(): Partial<ColumnSpec> {
        const {blueprintModel, source} = this,
            {catalog, blueprint, registry} = blueprintModel,
            displays = new Map<string, FieldDisplay>(),
            displayOf = (dim: string) => {
                if (!displays.has(dim)) {
                    const def = source.fields[dim];
                    displays.set(
                        dim,
                        def ? fieldDisplay(def, {}, {catalog, blueprint, registry}) : null
                    );
                }
                return displays.get(dim);
            };
        return {
            renderer: (v, {record}) => {
                const {cubeRowType, cubeDimension, cubeLabelValue} = record?.data ?? {},
                    display = cubeRowType === 'aggregate' ? displayOf(cubeDimension) : null;
                if (display && cubeLabelValue != null) {
                    // A group's label is one value of its dimension, not a roll-up.
                    return display.render(cubeLabelValue, record.data, false);
                }
                return isEmpty(v) || v === 'null' ? '(empty)' : v;
            }
        };
    }

    /** Doc to model: rebuild the columns, then apply their state once the grid has them. */
    private async applyColumnStateAsync() {
        const {cubeGridModel} = this;
        if (!cubeGridModel) return;
        this.isApplyingColumns = true;
        try {
            cubeGridModel.columns = this.buildColumns();
            cubeGridModel.labelColumn = this.buildLabelColumn();
            await wait();
            if (cubeGridModel !== this.cubeGridModel) return;
            const state: ColumnState[] = columnEntries(this.resolvedConfig.columnState)
                .filter(it => it.field === TREE_COLUMN || this.source.fields[it.field])
                .map(it => ({
                    colId: it.field === TREE_COLUMN ? LABEL_COL : it.field,
                    hidden: !!it.hidden,
                    width: it.width ?? null,
                    manuallySized: it.width != null,
                    pinned: it.pinned ?? null
                }));
            if (this.isFlat && !state.some(it => it.colId === LABEL_COL)) {
                state.push({colId: LABEL_COL, hidden: true, width: null, pinned: 'left'});
            }
            this.gridModel.setColumnState(state);
            this.appliedColumnState = this.gridModel.columnState;
        } finally {
            this.isApplyingColumns = false;
        }
    }

    private async restoreConfigAsync() {
        await this.applyColumnStateAsync();
        this.gridModel?.setSortBy(toGridSort(this.resolvedConfig.sortBy));
    }

    /** Model to doc: a user's sort becomes an edit, when it differs from the config. */
    private writeSortBy(sorters: string[]) {
        if (!sorters || this.gridModel?.isRestoringDefaults) return;
        const next = sorters.map(it => it.replace(/^cubeLabel\b/, TREE_COLUMN)),
            value = next.length === 1 ? next[0] : next.length ? next : null,
            current = this.element?.config.sortBy ?? null;
        if (isEqual(castArray(value ?? []), castArray(current ?? []))) return;
        if (!this.setConfig('/sortBy', value)) this.gridModel.setSortBy(toGridSort(current));
    }

    /** Model to doc: a user's resize, move, pin or hide becomes an edit, when it differs. */
    private writeColumnState(state: ColumnState[]) {
        const applied = this.appliedColumnState;
        if (!state || !this.element || this.isApplyingColumns) return;
        if (this.gridModel.isRestoringDefaults) return;
        if (isEqual(state, applied)) return;

        // The tree column keeps no entry while it is as the grid puts it: not sized by hand, hidden
        // in a flat grid, and pinned left and shown in a grouped one. Pinned left, it shows first
        // wherever the state lists it, and a hidden column may report no pin.
        const label = state.find(it => it.colId === LABEL_COL),
            isLabelDefault =
                label &&
                !label.manuallySized &&
                (this.isFlat ? label.hidden : label.pinned === 'left' && !label.hidden),
            current = columnEntries(this.element.config.columnState),
            byField = Object.fromEntries(current.map(it => [it.field, it])),
            next = state
                .filter(it => it.colId !== LABEL_COL || !isLabelDefault || byField[TREE_COLUMN])
                .map(it => {
                    const field = it.colId === LABEL_COL ? TREE_COLUMN : it.colId,
                        prev = byField[field] ?? {},
                        entry: PlainObject = {field};
                    if (it.hidden) {
                        // A hidden column reports neither its pin nor its width, so it keeps the
                        // blueprint's.
                        Object.assign(
                            entry,
                            pick(prev, 'width'),
                            {hidden: true},
                            pick(prev, 'pinned')
                        );
                    } else {
                        if (it.manuallySized && it.width != null) entry.width = it.width;
                        if (it.pinned) entry.pinned = it.pinned;
                    }
                    if (prev.format) entry.format = prev.format;
                    if (prev.renderer) entry.renderer = prev.renderer;
                    return entry;
                });
        if (isEqual(byPinRegion(next), byPinRegion(current))) return;
        const value = byPinRegion(next).map(it => (Object.keys(it).length === 1 ? it.field : it));
        if (!this.setConfig('/columnState', value)) this.applyColumnStateAsync();
    }

    /** The selected row's group path, as a filter, and its data. */
    private get selectionOutputs(): {selection: PlainObject; selected: PlainObject} {
        const rec = this.cubeGridModel?.selectedRecord,
            clauses = [];
        for (let r = rec; r; r = r.parent) {
            const {cubeDimension, cubeLabelValue, cubeRowType} = r.data;
            if (cubeRowType !== 'aggregate' || cubeDimension === 'Total') continue;
            clauses.unshift({field: cubeDimension, op: '=', value: cubeLabelValue});
        }
        return {
            selection: clauses.length > 1 ? {op: 'AND', filters: clauses} : (clauses[0] ?? null),
            selected: rec?.data ?? null
        };
    }
}

export const [CubeGridWidget, cubeGridWidget] = hoistCmp.withFactory({
    displayName: 'CubeGridWidget',
    className: 'xh-blueprint-cube-grid',
    model: uses(CubeGridWidgetModel),
    render({model, className}) {
        const {cubeGridModel} = model;
        return cubeGridModel ? cubeGrid({model: cubeGridModel, className}) : null;
    }
});

//------------------
// Implementation
//------------------
const TREE_COLUMN = 'group',
    LABEL_COL = 'cubeLabel';

function columnEntries(columnState: unknown): PlainObject[] {
    return castArray(columnState ?? []).map(it => (isString(it) ? {field: it} : it));
}

/**
 * Column entries in display order: pinned left, then unpinned, then pinned right. Order across
 * those regions means nothing in Hoist's column state, only order within each.
 */
function byPinRegion(entries: PlainObject[]): PlainObject[] {
    const region = (it: PlainObject) => (it.pinned === 'left' ? 0 : it.pinned === 'right' ? 2 : 1);
    return sortBy(entries, region);
}

/** A grid with no grouping shows its rows as they are. */
function toQuery(dimensions: string[]) {
    return {dimensions, includeLeaves: dimensions.length === 0};
}

function toGridSort(sortBy: unknown): string[] {
    return castArray(sortBy ?? []).map(it => String(it).replace(/^group\b/, LABEL_COL));
}
