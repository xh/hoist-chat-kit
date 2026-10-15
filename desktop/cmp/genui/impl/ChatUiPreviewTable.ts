import type {ReactNode} from 'react';
import {div, span, table, tbody, td, th, thead, tr} from '@xh/hoist/cmp/layout';
import {CHAT_DATA_ROW_ID} from '../../../../genui';
import {htmlCaption} from '../../../../impl/HtmlTags';
import {
    type ChatUiTablePreview,
    formatTableCell,
    formatTableText,
    getAlign
} from './ChatUiTableData';

/**
 * The inline tier of a result table (P4, B1): a plain HTML table on Hoist's compact grid tokens -
 * no ag-Grid, so a long thread stays light. A real `table` with column headers, whose caption is
 * the footer's counts. No sorting or resizing: that is the full grid's job.
 * @internal
 */
// TODO(design-open B1): the preview, not a Grid, is the inline tier - P4's default.
export function previewTable(preview: ChatUiTablePreview, caption: string): ReactNode {
    const {columns, records} = preview;
    return table({
        className: 'xh-chat-ui-table',
        items: [
            htmlCaption({key: 'caption', className: 'xh-chat-ui-sr-only', item: caption}),
            thead({
                key: 'head',
                item: tr({
                    items: columns.map(it =>
                        th({
                            key: it.key,
                            scope: 'col',
                            className: `xh-chat-ui-table__cell--${getAlign(it)}`,
                            title: it.label,
                            item: it.label
                        })
                    )
                })
            }),
            tbody({
                key: 'body',
                items: records.map(record =>
                    tr({
                        key: record[CHAT_DATA_ROW_ID],
                        items: columns.map(it =>
                            td({
                                key: it.key,
                                className: `xh-chat-ui-table__cell--${getAlign(it)}`,
                                // A long text cell is cut short, with its whole value on hover.
                                title:
                                    it.type === 'string'
                                        ? formatTableText(record[it.key], it) || null
                                        : null,
                                item: formatTableCell(record[it.key], it)
                            })
                        )
                    })
                )
            })
        ]
    });
}

/**
 * Skeleton rows at the preview's full height, in the header strip's tone: one header row and
 * `rowCount` rows. Each bar shimmers a few times if still shown after a second, then holds.
 * @internal
 */
export function previewSkeleton(rowCount: number): ReactNode {
    return div({
        className: 'xh-chat-ui-table-skeleton',
        'aria-hidden': true,
        items: Array.from({length: rowCount + 1}, (_, idx) =>
            div({
                key: idx,
                className: 'xh-chat-ui-table-skeleton__row',
                items: SKELETON_WIDTHS.map((width, barIdx) =>
                    span({
                        key: barIdx,
                        className: 'xh-chat-ui-table-skeleton__bar xh-chat-skeleton--shimmer',
                        style: {width: `${width}%`}
                    })
                )
            })
        )
    });
}

//------------------
// Implementation
//------------------
const SKELETON_WIDTHS = [22, 12, 14, 10];
