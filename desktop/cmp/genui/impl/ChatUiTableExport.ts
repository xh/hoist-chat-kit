import {omit} from 'lodash';
import {GridModel} from '@xh/hoist/cmp/grid';
import {type PlainObject, XH} from '@xh/hoist/core';
import {
    applyDataView,
    CHAT_DATA_ROW_ID,
    type ChatArtifactRegistry,
    type ChatDataView
} from '../../../../genui';
import {
    fmtRows,
    getViewColumns,
    toGridColumnSpecs,
    toGridFieldSpecs,
    toTableColumns,
    toTableRecords
} from './ChatUiTableData';

/**
 * True if an export of `rowCount` rows asks the user first - above the `exportConfirmAbove` of
 * `ChatUiGrid.defaults`.
 * @internal
 */
export function needsExportConfirm(rowCount: number, threshold: number): boolean {
    return threshold != null && rowCount > threshold;
}

/**
 * Ask the user to confirm a large export, if it is over the threshold.
 * @returns true to go ahead.
 * @internal
 */
export async function confirmExportAsync(rowCount: number, threshold: number): Promise<boolean> {
    if (!needsExportConfirm(rowCount, threshold)) return true;
    // TODO(H1): P4 runs an export over the threshold on the server, with a toast when done. No
    // backend capability exports an artifact yet, so the browser loads every row.
    return XH.confirm({
        title: 'Export all rows?',
        message: `This export loads all ${fmtRows(rowCount)} into the browser first, which may take a while.`,
        confirmProps: {text: 'Export', intent: 'primary', outlined: true, autoFocus: true},
        cancelProps: {text: 'Cancel'}
    });
}

/**
 * Load an artifact's rows from `offset` to the end, a page at a time.
 * @internal
 */
export async function loadRowsAsync(
    registry: ChatArtifactRegistry,
    artifactId: string,
    offset: number,
    pageSize: number
): Promise<PlainObject[]> {
    const totalRows = registry.get(artifactId)?.totalRows ?? 0,
        ret: PlainObject[] = [];
    for (let start = offset; start < totalRows; start += pageSize) {
        const frame = await registry.loadRangeAsync(artifactId, start, pageSize);
        ret.push(...frame.rows);
        if (!frame.rows.length) break;
    }
    return ret;
}

/**
 * Export every row of a result, as its view shows them, with Hoist's grid export - without a grid
 * on the page. Asks first above the threshold.
 * @internal
 */
export async function exportResultAsync(spec: {
    registry: ChatArtifactRegistry;
    artifactId: string;
    view: ChatDataView;
    title: string;
    pageSize: number;
    exportConfirmAbove: number;
}): Promise<void> {
    const {registry, artifactId, view, title, pageSize, exportConfirmAbove} = spec,
        artifact = registry.get(artifactId);
    if (!artifact) return;
    if (!(await confirmExportAsync(artifact.totalRows, exportConfirmAbove))) return;

    const rows = await loadRowsAsync(registry, artifactId, 0, pageSize),
        applied = applyDataView(
            {columns: artifact.columns, rows, totalRows: rows.length},
            omit(view ?? {}, 'columns')
        ),
        columns = toTableColumns(getViewColumns(applied.columns, view)),
        gridModel = new GridModel({
            xhImpl: true,
            store: {idSpec: CHAT_DATA_ROW_ID, fields: toGridFieldSpecs(columns)},
            columns: toGridColumnSpecs(columns),
            enableExport: true
        });

    try {
        gridModel.loadData(toTableRecords(applied.rows, columns));
        await gridModel.exportAsync({filename: title || 'Chat data', type: 'excelTable'});
    } finally {
        XH.safeDestroy(gridModel);
    }
}
