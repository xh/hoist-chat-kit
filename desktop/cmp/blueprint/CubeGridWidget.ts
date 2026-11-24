import {AgGrid} from '@xh/hoist/cmp/ag-grid';
import {CubeGridModel, cubeGrid} from '@xh/hoist/cmp/cubegrid';
import {
    type ColumnSpec,
    type ColumnState,
    type GridContextMenuItemLike,
    GridModel
} from '@xh/hoist/cmp/grid';
import {hoistCmp, managed, type PlainObject, uses} from '@xh/hoist/core';
import type {GridOptions} from '@xh/hoist/kit/ag-grid';
import {Icon} from '@xh/hoist/icon';
import {
    type FilterSpec,
    type FilterTestFn,
    parseFilter,
    type RecordActionSpec,
    type StoreRecord,
    type StoreRecordId
} from '@xh/hoist/data';
import {action, computed, observable, observableRef, when} from '@xh/hoist/mobx';
import {useEffect, useRef} from 'react';
import {wait} from '@xh/hoist/promise';
import {
    castArray,
    isArray,
    isEmpty,
    isEqual,
    isFinite,
    isString,
    mapValues,
    omit,
    omitBy,
    pick,
    sortBy,
    uniq
} from 'lodash';
import {
    BlueprintWidgetModel,
    type BlueprintWidgetConfig,
    type CubeGridWidgetConfig
} from '../../../blueprint';
import {sortKeysOf} from '../../../blueprint/design/configValues';
import {CUBE_GRID_STYLES} from '../../../blueprint/builtInWidgets';
import type {FieldDisplayLayer} from '../../../blueprint/formats';
import {styleToCss} from '../../../blueprint/impl/gridStyles';
import {getOwn} from '../../../blueprint/impl/pointer';
import {type FieldDisplay, fieldDisplay} from '../../../blueprint/impl/renderers';

/**
 * The `cubeGrid` widget: a Hoist `CubeGrid` over its source's Cube, grouped by `groupBy`, with
 * the columns of `columnState`. A sort or a change to the columns becomes an edit. Its selection
 * is the `selection` output, as a filter of the selected row's group path, and the `selected`
 * output, as the selected row's data.
 */
const LIVE_STYLES = [...CUBE_GRID_STYLES];

// Hoist sets its row and header heights on AgGrid, untyped.
const AG_GRID = AgGrid as any,
    GRID_BORDERS = 2;

// The keys of a column's config that pass to its Hoist column as they are.
const COLUMN_KEYS = [
    'headerTooltip',
    'headerAlign',
    'align',
    'tooltip',
    'highlightOnChange',
    'minWidth',
    'maxWidth',
    'flex',
    'chooserName',
    'chooserGroup',
    'chooserDescription',
    'exportName'
];

/** A column's config as a layer of its field's display, over the source's. */
function toDisplayLayer(column: PlainObject): FieldDisplayLayer {
    return {
        label: column.headerName,
        description: column.headerTooltip,
        align: column.align,
        format: column.format,
        renderer: column.renderer
    };
}

// CubeGridModel's own defaults, over GridModel's, for a style an edit clears.

export class CubeGridWidgetModel extends BlueprintWidgetModel<CubeGridWidgetConfig> {
    @managed @observableRef accessor cubeGridModel: CubeGridModel = null;

    /** The height of the grid's horizontal scrollbar while it shows, as its component measures it. */
    @observable accessor horizontalScrollHeight = 0;

    // The grid's column state just after it applied the config's, to tell a user's change apart.
    private appliedColumnState: ColumnState[] = [];
    private isApplyingColumns = false;
    // The grid and inputs the columns were last built for.
    private builtColumns: {model: CubeGridModel; inputs: unknown[]} = null;

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
                track: () => [this.resolvedConfig.columnState, this.columnInputs],
                run: () => this.applyColumnStateAsync(),
                equals: 'structural'
            },
            {
                // A bound threshold moves a style: ag-Grid calls style functions again on a redraw.
                track: () => [
                    this.resolvedConfig.rowStyles,
                    mapValues(this.resolvedConfig.columns ?? {}, it => it?.styles)
                ],
                run: () => this.gridModel?.agApi?.redrawRows(),
                equals: 'structural'
            },
            {
                track: () => this.resolvedConfig.sortBy,
                run: sortBy => this.gridModel?.setSortBy(toGridSort(sortBy)),
                equals: 'structural'
            },
            {
                track: () => this.resolvedConfig.showSummary ?? false,
                run: show => this.cubeGridModel?.setShowSummary(show)
            },
            {
                track: () => pick(this.resolvedConfig, LIVE_STYLES),
                run: () => this.applyLiveStyles(),
                equals: 'structural'
            },
            {
                // GridModel binds to the app's sizing mode only when built without one.
                track: () => this.resolvedConfig.sizingMode == null,
                run: () => this.rebuildGrid()
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
                gridModel.agApi.getDisplayedRowCount() + (this.resolvedConfig.showSummary ? 1 : 0),
            header = hideHeaders ? 0 : AG_GRID.getHeaderHeightForSizingMode(sizingMode);
        return (
            header +
            rows * AG_GRID.getRowHeightForSizingMode(sizingMode) +
            this.horizontalScrollHeight +
            GRID_BORDERS
        );
    }

    @action
    setHorizontalScrollHeight(height: number) {
        this.horizontalScrollHeight = height;
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
                showSummary: cfg.showSummary ?? false,
                sortBy: toGridSort(cfg.sortBy),
                autosizeOptions: {mode: 'managed'},
                rowStyle: (record: StoreRecord) => applyRules(this.rowRules, record),
                // Read as each opens, so an edit to the row actions needs no new grid.
                contextMenu: (): GridContextMenuItemLike[] => {
                    const actions = this.rowActionItems;
                    return [
                        ...actions,
                        ...(actions.length ? (['-'] as const) : []),
                        ...GridModel.defaults.contextMenu
                    ];
                },
                onRowDoubleClicked: ({data}) => {
                    if (this.rowActions.length) this.runRowActionAsync(0, data);
                },
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
        // A rebuild during another keeps what the first one has yet to restore.
        const state = (this.restoring ??= {
            selectedIds: prev.selectedIds,
            expandState: prev.expandState
        });
        this.buildGrid();
        const {gridModel} = this;
        await when(() => gridModel.store.count > 0, {timeout: 5_000}).catch(() => null);
        if (gridModel !== this.gridModel) return;
        if (state.selectedIds.length) {
            await gridModel.selectAsync(state.selectedIds, {ensureVisible: false});
        }
        // Rows expand only once ag-Grid has drawn the new grid.
        if ((await gridModel.whenReadyAsync()) && gridModel === this.gridModel) {
            gridModel.setExpandState(state.expandState);
            this.restoring = null;
        }
    }

    private restoring: {selectedIds: StoreRecordId[]; expandState: PlainObject} = null;

    /** Set each style GridModel can change in place, or its default where the config sets none. */
    private applyLiveStyles() {
        const {gridModel} = this;
        if (!gridModel) return;
        const cfg = this.resolvedConfig,
            style = <K extends keyof typeof cfg>(key: K) => cfg[key] ?? this.configDefault(key);
        gridModel.treeStyle = style('treeStyle');
        gridModel.emptyText = style('emptyText');
        gridModel.setStripeRows(style('stripeRows'));
        gridModel.setRowBorders(style('rowBorders'));
        gridModel.setCellBorders(style('cellBorders'));
        gridModel.setShowHover(style('showHover'));
        gridModel.setHideHeaders(style('hideHeaders'));
        gridModel.showGroupRowCounts = style('showGroupRowCounts');
        gridModel.groupRowHeight = cfg.groupRowHeight ?? null;
        if (cfg.sizingMode != null) gridModel.setSizingMode(cfg.sizingMode);
    }

    /** True for a grid with no grouping, whose tree column would only show row IDs. */
    private get isFlat(): boolean {
        return castArray(this.resolvedConfig.groupBy ?? []).length === 0;
    }

    private get gridModel() {
        return this.cubeGridModel?.innerGridModel;
    }

    // The largest absolute value of a field among the grid's rows that are not group rows, kept
    // until its data change.
    private columnMax(field: string): number {
        const store = this.gridModel?.store;
        if (!store) return null;
        if (this.maxes.at !== store.lastUpdated) this.maxes = {at: store.lastUpdated, of: {}};
        this.maxes.of[field] ??= store.allRecords.reduce(
            (max, it) =>
                isGroupRow(it) ? max : Math.max(max, Math.abs(Number(it.data[field]) || 0)),
            0
        );
        return this.maxes.of[field] || null;
    }

    private maxes: {at: number; of: Record<string, number>} = {at: null, of: {}};

    // The lowest and highest values of a field among the rows that are not group rows, across
    // every point of a series, kept until its data change.
    private columnRange(field: string): {min: number; max: number} {
        const store = this.gridModel?.store;
        if (!store) return null;
        if (this.ranges.at !== store.lastUpdated) this.ranges = {at: store.lastUpdated, of: {}};
        if (!(field in this.ranges.of)) {
            const values = store.allRecords
                .filter(it => !isGroupRow(it))
                .flatMap(it => castArray(it.data[field] ?? []))
                .filter(isFinite) as number[];
            this.ranges.of[field] = values.length
                ? {
                      min: values.reduce((a, b) => Math.min(a, b)),
                      max: values.reduce((a, b) => Math.max(a, b))
                  }
                : null;
        }
        return this.ranges.of[field];
    }

    private ranges: {at: number; of: Record<string, {min: number; max: number}>} = {
        at: null,
        of: {}
    };

    /** Run one of the grid's row actions on a row, which it reads with its group path. */
    runRowActionAsync(index: number, record: StoreRecord): Promise<boolean> {
        const action = this.rowActions[index]?.action;
        if (!action || !record) return Promise.resolve(false);
        return this.blueprintModel.runActionsAsync(action, {row: rowData(record)});
    }

    private get rowActions(): PlainObject[] {
        return castArray(this.element?.config?.rowActions ?? []);
    }

    private get rowActionItems(): RecordActionSpec[] {
        return this.rowActions.map((it, idx) => ({
            text: it.label,
            icon: it.icon ? Icon.icon({faName: it.icon}) : null,
            actionFn: ({record}) => this.runRowActionAsync(idx, record),
            displayFn: ({record}) => {
                const blocked = this.blueprintModel.actionBlockedReason(it.action, {
                    row: rowData(record)
                });
                return {disabled: !!blocked, tooltip: blocked};
            }
        }));
    }

    @computed
    private get rowRules(): StyleRule[] {
        return this.compileRules(this.element?.config?.rowStyles);
    }

    @computed
    private get cellRules(): Record<string, StyleRule[]> {
        return mapValues(this.element?.config?.columns ?? {}, (it: PlainObject) =>
            this.compileRules(it?.styles)
        );
    }

    // Each rule's filter resolved and parsed once, and its style as CSS. A filter that resolves to
    // none, as when every bound value is null, matches nothing.
    private compileRules(rules: unknown): StyleRule[] {
        if (!isArray(rules)) return [];
        return rules.map((rule: PlainObject) => {
            const spec = this.blueprintModel.resolveFilter(rule?.when);
            return {
                test: spec ? parseFilter(spec).getTestFn() : null,
                css: styleToCss(rule?.style),
                rows: rule?.rows ?? 'all'
            };
        });
    }

    private buildColumns(): ColumnSpec[] {
        const {blueprintModel, source} = this,
            {catalog, blueprint, registry} = blueprintModel;
        return columnEntries(this.resolvedConfig.columnState)
            .filter(it => it.field !== TREE_COLUMN && source.fields[it.field])
            .map(({field}) => {
                const def = source.fields[field],
                    column = this.columnConfig(field),
                    shown = source.displayOf(field, toDisplayLayer(column)),
                    label = column.headerName ?? source.fieldLabel(field),
                    display = fieldDisplay(def, shown, {
                        catalog,
                        blueprint,
                        registry,
                        columnMax: () => this.columnMax(field),
                        columnRange: () => this.columnRange(field)
                    }),
                    isNum = def.type === 'number' || def.type === 'int',
                    // A series has no value to sort by or export.
                    isSeries = def.type === 'number[]',
                    isAggregate = (record: StoreRecord) => isGroupRow(record),
                    hasStyles = !isEmpty(
                        getOwn<PlainObject>(this.element?.config?.columns, field)?.styles
                    );
                return {
                    field: {
                        name: field,
                        type: (isSeries ? 'auto' : def.type) as any,
                        displayName: label
                    },
                    ...(isSeries ? {sortable: false, excludeFromExport: true} : {}),
                    displayName: label,
                    headerName: label,
                    ...(shown.description ? {headerTooltip: shown.description} : {}),
                    ...(shown.width ? {width: shown.width} : {}),
                    ...(def.category ? {chooserGroup: castArray(def.category).join(' › ')} : {}),
                    absSort: isNum,
                    align: shown.align ?? (isNum ? 'right' : null),
                    ...pick(column, COLUMN_KEYS),
                    ...(hasStyles
                        ? {cellStyle: (v, {record}) => applyRules(this.cellRules[field], record)}
                        : {}),
                    renderer: (v, {record}) => display.render(v, record?.data, isAggregate(record)),
                    exportValue: (v, {record}) =>
                        display.exportValue(v, record?.data, isAggregate(record))
                };
            });
    }

    /** The config of a field's column, or of the tree column, from `columns`. */
    private columnConfig(field: string): PlainObject {
        return getOwn(this.resolvedConfig.columns, field) ?? {};
    }

    // What the columns are built from: which fields show, not their order, size or pin.
    private get columnInputs(): unknown[] {
        return [
            sortBy(uniq(columnEntries(this.resolvedConfig.columnState).map(it => it.field))),
            // A column's rules apply as it draws, so only gaining or losing them rebuilds.
            mapValues(this.resolvedConfig.columns ?? {}, it => ({
                ...omit(it, 'styles'),
                hasStyles: !isEmpty(it?.styles)
            })),
            this.isFlat,
            this.blueprintModel.blueprint?.formats,
            this.source?.decl.fields,
            this.columnLabels
        ];
    }

    /** The label of each column's field, which can follow variables. */
    private get columnLabels(): Record<string, string> {
        return Object.fromEntries(
            columnEntries(this.resolvedConfig.columnState).map(it => [
                it.field,
                this.source?.fieldLabel(it.field)
            ])
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
                        def
                            ? fieldDisplay(def, source.displayOf(dim), {
                                  catalog,
                                  blueprint,
                                  registry
                              })
                            : null
                    );
                }
                return displays.get(dim);
            };
        // Each group row draws with its own dimension's display, so the column takes no format.
        const column = this.columnConfig(TREE_COLUMN);
        return {
            ...(column.headerName ? {headerName: column.headerName} : {}),
            ...pick(column, COLUMN_KEYS),
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

    /**
     * Doc to model: rebuild the columns where what they are built from changed, then apply their
     * state once the grid has them. A move, resize, pin or hide only applies the state.
     */
    private async applyColumnStateAsync() {
        const {cubeGridModel, columnInputs} = this;
        if (!cubeGridModel) return;
        this.isApplyingColumns = true;
        try {
            if (
                cubeGridModel !== this.builtColumns?.model ||
                !isEqual(columnInputs, this.builtColumns.inputs)
            ) {
                cubeGridModel.columns = this.buildColumns();
                cubeGridModel.labelColumn = this.buildLabelColumn();
                this.builtColumns = {model: cubeGridModel, inputs: columnInputs};
                await wait();
                if (cubeGridModel !== this.cubeGridModel) return;
            }
            const state: ColumnState[] = columnEntries(this.resolvedConfig.columnState)
                .filter(it => it.field === TREE_COLUMN || this.source.fields[it.field])
                .map(it => ({
                    colId: gridColId(it.field),
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
            current = this.element?.config.sortBy ?? null,
            // The grid writes `field|asc` where a config may leave asc implied.
            same = (a: unknown, b: unknown) => isEqual(sortKeysOf(a), sortKeysOf(b));
        if (same(value, current)) return;
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
                        // ag-Grid reports fractional widths, and columnState holds whole pixels.
                        if (it.manuallySized && it.width != null) {
                            entry.width = Math.round(it.width);
                        }
                        if (it.pinned) entry.pinned = it.pinned;
                    }
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
        const {cubeGridModel} = model,
            isReady = !!cubeGridModel?.innerGridModel.isReady,
            ref = useRef<HTMLElement>(null);
        // ag-Grid shows its horizontal scrollbar only while the columns overflow.
        useEffect(() => {
            const bar = ref.current?.querySelector<HTMLElement>('.ag-body-horizontal-scroll');
            if (!isReady || !bar || typeof ResizeObserver === 'undefined') return;
            const measure = () => model.setHorizontalScrollHeight(bar.offsetHeight),
                observer = new ResizeObserver(measure);
            observer.observe(bar);
            measure();
            return () => observer.disconnect();
        }, [model, cubeGridModel, isReady]);
        return cubeGridModel
            ? cubeGrid({model: cubeGridModel, className, ref, agOptions: COLUMN_ANIMATION})
            : null;
    }
});

//------------------
// Implementation
//------------------
/**
 * Columns move without animation, as a change applied from the config, an undo or a preset would
 * otherwise slide every column into place. A user's own drag in the grid animates.
 * @internal
 */
export const COLUMN_ANIMATION: GridOptions = {
    suppressColumnMoveAnimation: true,
    onDragStarted: e => e.api.setGridOption('suppressColumnMoveAnimation', false),
    onDragStopped: e => e.api.setGridOption('suppressColumnMoveAnimation', true)
};

const TREE_COLUMN = 'group',
    LABEL_COL = 'cubeLabel';

/** The id of the grid column that shows a field, or the tree column for `group`. */
export function gridColId(field: string): string {
    return field === TREE_COLUMN ? LABEL_COL : field;
}

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

// A row's fields, with the value of each group on its path, so a group row reads its dimensions.
function rowData(record: StoreRecord): PlainObject {
    const ret: PlainObject = {...record?.data};
    for (let it = record; it; it = it.parent) {
        const {cubeDimension, cubeLabelValue} = it.data ?? {};
        if (cubeDimension && !(cubeDimension in ret)) ret[cubeDimension] = cubeLabelValue;
    }
    return ret;
}

interface StyleRule {
    test: FilterTestFn;
    css: PlainObject;
    rows: 'all' | 'leaves' | 'groups';
}

// The CSS of every rule a row matches, in order, a later match winning property by property. A
// leaf tests its own values, and a group row its totals.
function applyRules(rules: StyleRule[], record: StoreRecord): PlainObject {
    if (!record || !rules?.length) return {};
    const isGroup = isGroupRow(record);
    return rules.reduce((ret, {test, css, rows}) => {
        if (!test || (rows === 'leaves' && isGroup) || (rows === 'groups' && !isGroup)) return ret;
        return test(record.data) ? {...ret, ...css} : ret;
    }, {});
}

// A row that sums the rows shown under it, or the summary row. A row of the deepest level shown is
// not, though a Cube may have aggregated it, as a grid without leaf rows shows.
function isGroupRow(record: StoreRecord): boolean {
    return !!record && (record.isSummary || record.allChildren.length > 0);
}
