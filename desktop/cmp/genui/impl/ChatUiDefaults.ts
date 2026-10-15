import type {ChatUiChartDefaults, ChatUiGridDefaults} from '../Types';

/**
 * The object behind `ChatUiGrid.defaults`, here so that the full table can read it without
 * importing the grid.
 * @internal
 */
export const CHAT_UI_GRID_DEFAULTS: ChatUiGridDefaults = {
    previewRows: 8,
    previewColumns: 6,
    pageSize: 1_000,
    exportConfirmAbove: 10_000
};

/**
 * The object behind `ChatUiChart.defaults`.
 * @internal
 */
export const CHAT_UI_CHART_DEFAULTS: ChatUiChartDefaults = {
    maxInlineSeries: 5,
    maxInlinePoints: 500
};
