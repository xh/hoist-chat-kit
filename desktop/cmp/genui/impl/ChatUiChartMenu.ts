import type {ChartModel} from '@xh/hoist/cmp/chart';
import {hoistCmp, type HoistProps, type MenuItemLike} from '@xh/hoist/core';
import {menuButton} from '@xh/hoist/desktop/cmp/menu';
import {Icon} from '@xh/hoist/icon';

interface ChartMenuButtonProps extends HoistProps {
    /** The chart to copy and download. */
    chartModel: ChartModel;

    /** Opens the chart in the side panel, for the Expand item of a card's menu. */
    onExpand?: () => void;
}

/**
 * The options menu of a chart (P4): Copy Image, Download PNG and Download CSV - the accessible
 * fallback for the chart's data - then Expand, on a card. Each item acts on the chart once it has
 * drawn, through Highcharts' exporting module, as Hoist's own chart menu does.
 * @internal
 */
export const chartMenuButton = hoistCmp.factory<ChartMenuButtonProps>({
    displayName: 'ChatUiChartMenuButton',
    model: false,

    render({chartModel, onExpand}) {
        const menuItems: MenuItemLike[] = [
            {
                text: 'Copy Image',
                icon: Icon.copy(),
                prepareFn: it => (it.disabled = !chartModel?.highchart?.copyToClipboardAsync),
                actionFn: () => chartModel.highchart.copyToClipboardAsync()
            },
            {
                text: 'Download PNG',
                icon: Icon.fileImage(),
                prepareFn: it => (it.disabled = !chartModel?.highchart?.exportChartLocal),
                actionFn: () => chartModel.highchart.exportChartLocal()
            },
            {
                text: 'Download CSV',
                icon: Icon.fileCsv(),
                prepareFn: it => (it.disabled = !chartModel?.highchart?.downloadCSV),
                actionFn: () => chartModel.highchart.downloadCSV()
            }
        ];
        if (onExpand) {
            menuItems.push('-', {text: 'Expand', icon: Icon.openExternal(), actionFn: onExpand});
        }

        return menuButton({
            className: 'xh-chat-ui-frame__button',
            icon: Icon.ellipsisHorizontal(),
            tooltip: 'Options',
            'aria-label': 'Chart options',
            menuItems,
            menuPosition: 'bottom-right'
        });
    }
});
