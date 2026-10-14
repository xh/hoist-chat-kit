import {AgGrid} from '@xh/hoist/cmp/ag-grid';
import {grid, GridModel} from '@xh/hoist/cmp/grid';
import {
    hoistCmp,
    HoistModel,
    type HoistProps,
    managed,
    type PlainObject,
    useLocalModel,
    uses,
    XH
} from '@xh/hoist/core';
import {action, computed, observableRef} from '@xh/hoist/mobx';
import {pluralize} from '@xh/hoist/utils/js';
import type {ChatUiComponentSpec} from '../../../genui';
import {CHAT_UI_DECIMALS_SCHEMA, CHAT_UI_NUMBER_FORMAT_SCHEMA} from './ChatUiFormat';
import {chatUiFrame, chatUiSkeleton} from './ChatUiFrame';
import {
    toColumnSpecs,
    toFieldSpecs,
    toGridData,
    toGridSorter,
    validateGridProps
} from './impl/ChatUiGridData';
import type {ChatUiSpecOptions, ChatUiNumberFormat} from './Types';
import './ChatUiGrid.scss';

/** Type of the values in a {@link ChatUiGridColumn}. */
export type ChatUiGridColumnType = 'string' | 'number' | 'date' | 'boolean';

/** A column of a {@link ChatUiGrid}, as written by the model. */
export interface ChatUiGridColumn {
    /** Key of the column's value in each row. */
    field: string;

    /** Column header. Defaults to the field, humanized. */
    headerName?: string;

    /** Type of the values. Dates are `YYYY-MM-DD` strings. Default `string`. */
    type?: ChatUiGridColumnType;

    /** How numbers display, for a `number` column. Default `number`. */
    format?: ChatUiNumberFormat;

    /** Decimal places, for a `number` column. Default suits the value and the format. */
    decimals?: number;
}

/** Props of a {@link ChatUiGrid}, as written by the model. */
export interface ChatUiGridSpecProps {
    /** Title shown above the grid. */
    title?: string;

    /** The grid's columns, in display order. */
    columns: ChatUiGridColumn[];

    /** Initial sort - a column field, with `|desc` for descending, such as `pnl|desc`. */
    sortBy?: string;

    /** One object per row, keyed by column field. */
    rows: PlainObject[];
}

/** Options for {@link chatUiGridSpec}. */
export interface ChatUiGridSpecOptions extends ChatUiSpecOptions {
    /** Most rows the model may send. Default 100. */
    maxRows?: number;

    /** Most columns the model may declare. Default 12. */
    maxColumns?: number;

    /**
     * Tallest the grid grows, in pixels, before it scrolls. A grid with fewer rows is just tall
     * enough to show them all. Default 360.
     */
    maxHeight?: number;
}

/**
 * A grid component for a {@link ChatUiCatalog}: the model declares typed columns and sends rows,
 * and the chat shows them in a Hoist grid. Rows fill in as the model writes them.
 *
 * ```ts
 * const catalog = new ChatUiCatalog({
 *     components: [chatUiGridSpec({maxRows: 50}), chatUiChartSpec()]
 * });
 * ```
 *
 * The model's tool is `show_grid`, unless renamed with `name`.
 */
export function chatUiGridSpec(
    opts: ChatUiGridSpecOptions = {}
): ChatUiComponentSpec<ChatUiGridSpecProps> {
    const {
        name = 'grid',
        description = DESCRIPTION,
        maxRows = 100,
        maxColumns = 12,
        maxHeight = DEFAULT_MAX_HEIGHT
    } = opts;

    return {
        name,
        description,
        props: {
            type: 'object',
            required: ['columns', 'rows'],
            additionalProperties: false,
            properties: {
                title: {type: 'string', maxLength: 120, description: 'Short title for the grid.'},
                columns: {
                    type: 'array',
                    minItems: 1,
                    maxItems: maxColumns,
                    description: 'Columns, in display order.',
                    items: {
                        type: 'object',
                        required: ['field'],
                        additionalProperties: false,
                        properties: {
                            field: {
                                type: 'string',
                                minLength: 1,
                                maxLength: 64,
                                description: 'Key of the value in each row.'
                            },
                            headerName: {
                                type: 'string',
                                maxLength: 60,
                                description: 'Column header. Default the field, humanized.'
                            },
                            type: {
                                enum: ['string', 'number', 'date', 'boolean'],
                                description:
                                    'Type of the values. Dates are "YYYY-MM-DD" strings. ' +
                                    'Default "string".'
                            },
                            format: {
                                ...CHAT_UI_NUMBER_FORMAT_SCHEMA,
                                description: `For number columns. ${CHAT_UI_NUMBER_FORMAT_SCHEMA.description}`
                            },
                            decimals: CHAT_UI_DECIMALS_SCHEMA
                        }
                    }
                },
                sortBy: {
                    type: 'string',
                    pattern: '^[^|]+(\\|(asc|desc))?$',
                    description:
                        'Initial sort: a column field, with "|desc" for descending - e.g. ' +
                        '"pnl|desc". Give it before the rows.'
                },
                rows: {
                    type: 'array',
                    maxItems: maxRows,
                    description: `Rows, at most ${maxRows}. Each is an object keyed by column field.`,
                    items: {type: 'object'}
                }
            }
        },
        validate: validateGridProps,
        render: (props, {isPartial}) => chatUiGrid({...props, isPartial, maxHeight}),
        example: {
            title: 'Top positions',
            columns: [
                {field: 'symbol', headerName: 'Symbol'},
                {field: 'pnl', headerName: 'P&L', type: 'number', format: 'currency', decimals: 0},
                {field: 'weight', type: 'number', format: 'percent'}
            ],
            sortBy: 'pnl|desc',
            rows: [
                {symbol: 'AAPL', pnl: 125000, weight: 0.082},
                {symbol: 'MSFT', pnl: -42000, weight: 0.064}
            ]
        }
    };
}

/** Props for {@link ChatUiGrid}. */
export interface ChatUiGridProps extends HoistProps, Partial<ChatUiGridSpecProps> {
    /** True while the props stream - the grid shows the rows that are complete so far. */
    isPartial?: boolean;

    /** Tallest the grid grows, in pixels, before it scrolls. Default 360. */
    maxHeight?: number;
}

/**
 * A compact Hoist grid of the columns and rows given by the model - the component that
 * {@link chatUiGridSpec} renders. Its {@link GridModel} is created when the columns are complete
 * and destroyed with the component. Rows load into the same model as they stream.
 *
 * Columns size to their content and headers as rows load, until the user resizes one. Text
 * columns stop at a maximum width and number columns keep a minimum, so that a narrow chat
 * scrolls the grid sideways rather than hide its numbers.
 */
export const [ChatUiGrid, chatUiGrid] = hoistCmp.withFactory<ChatUiGridProps>({
    displayName: 'ChatUiGrid',
    // Takes any model in context, as `useLocalModel()` needs a component with a model spec.
    model: uses('*', {optional: true}),
    className: 'xh-chat-ui-grid',

    render({className, title, isPartial}) {
        const impl = useLocalModel(ChatUiGridLocalModel),
            {gridModel, rowCount} = impl,
            // A placeholder until the first row is complete, rather than an empty grid.
            isReady = gridModel && (rowCount > 0 || !isPartial);

        return chatUiFrame({
            className,
            title,
            meta: isReady ? pluralize('row', rowCount, true) : null,
            item: isReady
                ? grid({model: gridModel, height: impl.height})
                : chatUiSkeleton(SKELETON_HEIGHT)
        });
    }
});

//------------------
// Implementation
//------------------
const DESCRIPTION =
    'A data grid - a table of records with typed, sortable columns. Use it for lists of ' +
    'records, such as positions, trades or orders, and for any table of more than a few rows. ' +
    'Declare each column with its type and number format, then send the rows as objects keyed ' +
    'by column field.';

const DEFAULT_MAX_HEIGHT = 360,
    SKELETON_HEIGHT = 120;

class ChatUiGridLocalModel extends HoistModel {
    override xhImpl = true;

    /** The grid's model - null until the columns are complete. */
    @managed @observableRef accessor gridModel: GridModel = null;

    private get props(): ChatUiGridProps {
        return this.componentProps as ChatUiGridProps;
    }

    /**
     * The columns, once complete. The model writes the rows after the columns, so the columns
     * are complete once the rows begin.
     */
    @computed
    get columns() {
        const {columns, rows, isPartial} = this.props;
        return isPartial && rows == null ? null : (columns ?? null);
    }

    /** Store data for the rows written so far. */
    @computed
    get data(): PlainObject[] {
        const {columns} = this;
        return columns ? toGridData(this.props.rows, columns, !!this.props.isPartial) : [];
    }

    get rowCount(): number {
        return this.data.length;
    }

    /** Height to show every row, up to `maxHeight`. */
    @computed
    get height(): number {
        const {gridModel, rowCount} = this,
            {maxHeight = DEFAULT_MAX_HEIGHT} = this.props;
        if (!gridModel) return null;

        // Hoist's own row and header heights for the grid's sizing mode - see AgGrid.
        const {sizingMode} = gridModel,
            agGrid = AgGrid as any,
            rowHeight = agGrid.getRowHeightForSizingMode(sizingMode),
            headerHeight = agGrid.getHeaderHeightForSizingMode(sizingMode);
        return Math.min(headerHeight + Math.max(rowCount, 1) * rowHeight + 2, maxHeight);
    }

    override onLinked() {
        this.addReaction(
            {
                track: () => this.columns,
                run: columns => this.createGridModel(columns),
                equals: 'structural',
                fireImmediately: true
            },
            {
                track: () => [this.gridModel, this.data] as const,
                run: ([gridModel, data]) => gridModel?.loadData(data),
                fireImmediately: true
            },
            {
                // The model may write `sortBy` after the rows.
                track: () => this.props.sortBy,
                run: () => this.gridModel?.setSortBy(this.getSorter())
            }
        );
    }

    @action
    private createGridModel(columns: ChatUiGridProps['columns']) {
        XH.safeDestroy(this.gridModel);
        this.gridModel = columns
            ? new GridModel({
                  xhImpl: true,
                  store: {fields: toFieldSpecs(columns)},
                  columns: toColumnSpecs(columns),
                  sortBy: this.getSorter(),
                  sizingMode: 'compact',
                  stripeRows: true,
                  showHover: true,
                  emptyText: 'No rows.',
                  // Fit the columns to their content as rows load, then share out any spare width.
                  autosizeOptions: {
                      mode: 'managed',
                      showMask: false,
                      bufferPx: 10,
                      fillMode: 'all'
                  },
                  enableExport: true,
                  exportOptions: {filename: this.props.title ?? 'Chat data'},
                  contextMenu: ['copyCell', '-', 'autosizeColumns', '-', 'export', 'exportCsv']
              })
            : null;
    }

    private getSorter() {
        const {sortBy} = this.props,
            {columns} = this;
        return columns ? toGridSorter(sortBy, columns) : null;
    }
}
