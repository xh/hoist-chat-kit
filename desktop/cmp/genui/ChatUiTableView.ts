import {omit} from 'lodash';
import type {ReactNode} from 'react';
import {errorMessage} from '@xh/hoist/cmp/error';
import {grid, GridModel, type GridSorterSpec} from '@xh/hoist/cmp/grid';
import {filler, span} from '@xh/hoist/cmp/layout';
import {
    creates,
    hoistCmp,
    HoistModel,
    type HoistProps,
    managed,
    type PlainObject,
    TaskObserver,
    XH
} from '@xh/hoist/core';
import {button, colChooserButton, exportButton} from '@xh/hoist/desktop/cmp/button';
import {gridFindField} from '@xh/hoist/desktop/cmp/grid';
import {panel, type PanelProps} from '@xh/hoist/desktop/cmp/panel';
import {Icon} from '@xh/hoist/icon';
import {action, computed, observable, observableRef} from '@xh/hoist/mobx';
import type {ChatTableRequest} from '../../../core';
import {applyDataView, CHAT_DATA_ROW_ID, type ChatDataColumn} from '../../../genui';
import {CHAT_UI_GRID_DEFAULTS} from './impl/ChatUiDefaults';
import {
    type ChatUiTableColumn,
    fmtCount,
    fmtRows,
    getViewColumns,
    toGridColumnSpecs,
    toGridFieldSpecs,
    toTableColumns,
    toTableRecords
} from './impl/ChatUiTableData';
import {confirmExportAsync, loadRowsAsync} from './impl/ChatUiTableExport';
import './ChatUiTableView.scss';

/** Props for {@link ChatUiTableView}. */
export interface ChatUiTableViewProps extends HoistProps {
    /** The table to show: the artifact, its registry and the card's view. */
    request: ChatTableRequest;

    /** Toolbar items before the find field, such as Back. */
    tbarItems?: ReactNode[];

    /** Props for the view's Hoist `Panel`, such as its title, icon and header items. */
    panelProps?: Omit<PanelProps, 'tbar' | 'bbar' | 'item' | 'items' | 'mask'>;
}

/**
 * The full tier of a result table: one Hoist `Grid` over the whole artifact, which loads a page of
 * `ChatUiGrid.defaults.pageSize` rows at a time from the chat's `ChatDataSource` - or shows the
 * rows a model wrote inline. The chat's side panel shows it for a table request, and a dialog
 * shows it where the chat has no side panel.
 *
 * It keeps the card's view: its filter, units, sort and column order. Columns the card left out
 * start hidden, in the column chooser. Sort and Find cover the rows loaded so far, and the status
 * bar says so. Load Next loads the next page - the grid never loads more on scroll. Export loads
 * every row first, and asks above `ChatUiGrid.defaults.exportConfirmAbove` rows. Each waits for
 * the other to finish.
 */
export const [ChatUiTableView, chatUiTableView] = hoistCmp.withFactory<ChatUiTableViewProps>({
    displayName: 'ChatUiTableView',
    // Its own model, kept out of context, so that it needs no model above it.
    model: creates(() => new ChatUiTableViewLocalModel(), {publishMode: 'none'}),
    className: 'xh-chat-ui-table-view',

    render({model, className, tbarItems = [], panelProps}) {
        const impl = model as ChatUiTableViewLocalModel,
            {gridModel, loadError} = impl;

        return panel({
            className,
            ...panelProps,
            tbar: [
                ...tbarItems,
                gridModel ? gridFindField({gridModel, width: 180}) : null,
                filler(),
                gridModel
                    ? colChooserButton({
                          gridModel,
                          text: `Columns ${impl.visibleColumnCount} of ${impl.columns.length}`
                      })
                    : null,
                exportButton({
                    text: 'Export',
                    // A page that loads meanwhile would not join the export's rows.
                    disabled: !gridModel || impl.isExporting || impl.loadTask.isPending,
                    onClick: () => impl.exportAsync()
                })
            ],
            bbar: [
                span({className: 'xh-chat-ui-table-view__count', item: impl.countText}),
                impl.hasMoreRows
                    ? button({
                          text: `Load Next ${fmtCount(impl.nextPageSize)}`,
                          disabled: impl.loadTask.isPending || impl.isExporting,
                          onClick: () => impl.loadNextAsync()
                      })
                    : null,
                filler(),
                span({className: 'xh-chat-ui-table-view__note', item: impl.noteText})
            ],
            mask: impl.isLoaded ? null : impl.loadTask,
            item:
                loadError && !impl.isLoaded
                    ? errorMessage({
                          error: loadError,
                          title: 'Rows unavailable',
                          message: "The table's rows could not be loaded.",
                          actionFn: () => impl.loadNextAsync(),
                          actionButtonProps: {text: 'Retry', icon: Icon.refresh()}
                      })
                    : gridModel
                      ? grid({model: gridModel})
                      : errorMessage({
                            error: {},
                            title: 'Table unavailable',
                            message: 'The data for this table is no longer available.'
                        })
        });
    }
});

//------------------
// Implementation
//------------------
class ChatUiTableViewLocalModel extends HoistModel {
    override xhImpl = true;

    /** The grid - null if the registry has no such artifact. */
    @managed @observableRef accessor gridModel: GridModel = null;

    @managed readonly loadTask = TaskObserver.trackLast();

    /** The rows loaded so far, as the registry returns them. */
    @observableRef accessor loadedRows: PlainObject[] = [];

    @observable accessor isLoaded = false;
    @observable accessor isExporting = false;
    @observableRef accessor loadError: unknown = null;

    /** Every column of the result, with the view's units and labels, in the view's order. */
    columns: ChatUiTableColumn[] = [];

    get request(): ChatTableRequest {
        return (this.componentProps as ChatUiTableViewProps).request;
    }

    get pageSize(): number {
        return CHAT_UI_GRID_DEFAULTS.pageSize;
    }

    get totalRows(): number {
        const {registry, artifactId} = this.request;
        return registry?.get(artifactId)?.totalRows ?? 0;
    }

    get hasMoreRows(): boolean {
        return this.isLoaded && this.loadedRows.length < this.totalRows;
    }

    get nextPageSize(): number {
        return Math.min(this.pageSize, this.totalRows - this.loadedRows.length);
    }

    get visibleColumnCount(): number {
        return this.gridModel?.getVisibleLeafColumns().length ?? 0;
    }

    /** The loaded rows through the view's filter, units and limit - its sort is the grid's. */
    @computed
    get records(): PlainObject[] {
        const {registry, artifactId, view} = this.request,
            artifact = registry?.get(artifactId),
            rows = this.loadedRows;
        if (!artifact) return [];
        const applied = applyDataView(
            {columns: artifact.columns, rows, totalRows: rows.length},
            omit(view ?? {}, 'columns')
        );
        return toTableRecords(applied.rows, this.columns);
    }

    /** Rows loaded of the result, and how many the view's filter and limit keep, if fewer. */
    get countText(): string {
        if (!this.isLoaded) return 'Loading rows…';
        const {totalRows} = this,
            loaded = this.loadedRows.length,
            shown = this.records.length,
            rows =
                loaded < totalRows
                    ? `Loaded ${fmtCount(loaded)} of ${fmtRows(totalRows)}`
                    : fmtRows(totalRows),
            kept = shown < loaded ? ` · ${fmtCount(shown)} shown` : '';
        return `${rows}${kept}`;
    }

    /** The sort, and what Sort and Find cover - only the rows loaded so far. */
    @computed
    get noteText(): string {
        const {gridModel, hasMoreRows} = this,
            sorter = gridModel?.sortBy[0],
            column = sorter ? gridModel.getColumn(sorter.colId) : null,
            sortText = column
                ? `Sorted by ${column.headerName}, ${sorter.sort === 'desc' ? 'descending' : 'ascending'}`
                : null,
            scopeText = hasMoreRows
                ? column
                    ? 'Sort and Find cover loaded rows'
                    : 'Find searches loaded rows'
                : null;
        return [sortText, scopeText].filter(Boolean).join(' · ');
    }

    override onLinked() {
        this.createGridModel();
        if (!this.gridModel) return;
        this.addReaction({
            track: () => this.records,
            run: records => this.gridModel.loadData(records)
        });
    }

    override afterLinked() {
        if (this.gridModel) this.loadNextAsync();
    }

    /** Load the next page of rows. */
    async loadNextAsync() {
        const {registry, artifactId} = this.request,
            offset = this.loadedRows.length;
        try {
            this.setLoadError(null);
            const frame = await registry
                .loadRangeAsync(artifactId, offset, this.pageSize)
                .linkTo(this.loadTask);
            this.appendRows(frame.rows, offset);
        } catch (e) {
            this.setLoadError(e);
            if (this.isLoaded) XH.handleException(e, {showAlert: false});
        }
    }

    /** Export the grid's rows - all of them, loading the rest first, and asking for many. */
    async exportAsync() {
        const {gridModel, totalRows} = this,
            {registry, artifactId, title} = this.request,
            {exportConfirmAbove} = CHAT_UI_GRID_DEFAULTS;
        if (!(await confirmExportAsync(totalRows, exportConfirmAbove))) return;

        this.setExporting(true);
        try {
            const offset = this.loadedRows.length;
            if (offset < totalRows) {
                const rows = await loadRowsAsync(registry, artifactId, offset, this.pageSize);
                this.appendRows(rows, offset);
            }
            await gridModel.exportAsync({filename: title || 'Chat data', type: 'excelTable'});
        } catch (e) {
            XH.handleException(e, {title: 'Export failed'});
        } finally {
            this.setExporting(false);
        }
    }

    //------------------
    // Implementation
    //------------------
    @action
    private createGridModel() {
        const {registry, artifactId, view, title} = this.request,
            artifact = registry?.get(artifactId);
        if (!artifact) return;

        // The view's units and labels, from the view applied to no rows.
        const applied = applyDataView(
                {columns: artifact.columns, rows: [], totalRows: 0},
                omit(view ?? {}, 'columns')
            ),
            visible = getViewColumns(applied.columns, view),
            hidden = applied.columns.filter(it => !visible.some(col => col.name === it.name)),
            columns = toTableColumns([...visible, ...hidden] as ChatDataColumn[]),
            visibleKeys = columns.slice(0, visible.length).map(it => it.key);

        this.columns = columns;
        this.gridModel = new GridModel({
            xhImpl: true,
            store: {idSpec: CHAT_DATA_ROW_ID, fields: toGridFieldSpecs(columns)},
            columns: toGridColumnSpecs(columns, visibleKeys),
            sortBy: this.getSorter(),
            sizingMode: 'compact',
            stripeRows: true,
            showHover: true,
            colChooserModel: true,
            enableExport: true,
            exportOptions: {filename: title || 'Chat data'},
            emptyText: 'No rows.',
            autosizeOptions: {mode: 'managed', showMask: false, bufferPx: 10},
            contextMenu: ['copyCell', '-', 'colChooser', 'autosizeColumns']
        });
    }

    // The view's sort, as the grid's sort - so that the user can change it.
    private getSorter(): GridSorterSpec {
        const sortBy = this.request.view?.sortBy;
        if (!sortBy) return null;
        const [name, dir] = sortBy.split('|'),
            column = this.columns.find(it => it.name === name);
        return column ? {colId: column.key, sort: dir === 'desc' ? 'desc' : 'asc'} : null;
    }

    @action
    private appendRows(rows: PlainObject[], offset: number) {
        // A page that loaded after another, such as during an export, is not added twice.
        if (offset !== this.loadedRows.length) return;
        this.loadedRows = [...this.loadedRows, ...rows];
        this.isLoaded = true;
    }

    @action
    private setLoadError(e: unknown) {
        this.loadError = e;
    }

    @action
    private setExporting(isExporting: boolean) {
        this.isExporting = isExporting;
    }
}
