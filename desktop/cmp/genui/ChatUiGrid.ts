import {isPlainObject, isString, pick} from 'lodash';
import type {ReactNode} from 'react';
import {errorMessage} from '@xh/hoist/cmp/error';
import {div, span} from '@xh/hoist/cmp/layout';
import {hoistCmp, type HoistProps, type PlainObject, useLocalModel, uses, XH} from '@xh/hoist/core';
import {button} from '@xh/hoist/desktop/cmp/button';
import {Icon} from '@xh/hoist/icon';
import {action, computed, observable} from '@xh/hoist/mobx';
import {useComposedRefs, useOnResize} from '@xh/hoist/utils/react';
import {
    CHAT_DATA_VIEW_PROPERTIES,
    ChatArtifactRegistry,
    type ChatDataFrame,
    type ChatDataHandle,
    type ChatDataView,
    type ChatUiComponentSpec
} from '../../../genui';
import {classNames} from '../../../impl/ClassNames';
import {CHAT_UI_DECIMALS_SCHEMA, CHAT_UI_NUMBER_FORMAT_SCHEMA} from './ChatUiFormat';
import {chatUiExpandButton, chatUiFrame} from './ChatUiFrame';
import {CHAT_UI_GRID_DEFAULTS} from './impl/ChatUiDefaults';
import {ChatUiExpandModel, expandDialog} from './impl/ChatUiExpand';
import {toInlineFrame, toInlineView, validateGridProps} from './impl/ChatUiGridData';
import {previewSkeleton, previewTable} from './impl/ChatUiPreviewTable';
import {
    type ChatUiTablePreview,
    describePreview,
    fmtCount,
    fmtRows,
    toTablePreview
} from './impl/ChatUiTableData';
import {exportResultAsync} from './impl/ChatUiTableExport';
import type {ChatUiGridDefaults, ChatUiNumberFormat, ChatUiSpecOptions} from './Types';
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

/**
 * Props of a {@link ChatUiGrid} by reference, as written by the model: the id of an artifact that
 * a tool produced, and a view over it. The model never writes the rows.
 */
export interface ChatUiGridRefSpecProps extends ChatDataView {
    /** Title shown above the table. */
    title?: string;

    /** Id of the artifact to show. */
    data: string;
}

/** Options for {@link chatUiGridSpec}. */
export interface ChatUiGridSpecOptions extends ChatUiSpecOptions {
    /** Most rows the model may write inline. Default 100. */
    maxRows?: number;

    /** Most columns the model may declare inline. Default 12. */
    maxColumns?: number;

    /**
     * True for a table by reference: the model names an artifact a tool produced, with a view
     * over it - its columns, sort, filter and units - and the chat loads the rows from the chat's
     * artifact registry. The props are then {@link ChatUiGridRefSpecProps}. Default false - the
     * model writes the columns and rows.
     */
    byReference?: boolean;
}

/**
 * A result table for a {@link ChatUiCatalog}, in two tiers (D69). Inline, it shows a light
 * preview: a plain table of the first rows and columns, with a footer that says what it leaves
 * out. Expand, or View Full Table, opens one Hoist grid over the whole result in the chat's side
 * panel - or in a dialog where the chat has none. A result that fits the preview has no full tier.
 *
 * By default the model declares typed columns and writes the rows, which fill in as it streams.
 * With `byReference`, the model names an artifact instead, and the full grid pages through it from
 * the chat's `ChatDataSource`.
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
    opts?: ChatUiGridSpecOptions & {byReference?: false}
): ChatUiComponentSpec<ChatUiGridSpecProps>;
export function chatUiGridSpec(
    opts: ChatUiGridSpecOptions & {byReference: true}
): ChatUiComponentSpec<ChatUiGridRefSpecProps>;
export function chatUiGridSpec(opts: ChatUiGridSpecOptions = {}): ChatUiComponentSpec<any> {
    return opts.byReference ? createRefSpec(opts) : createInlineSpec(opts);
}

/** Props for {@link ChatUiGrid}. */
export interface ChatUiGridProps extends HoistProps, Partial<ChatUiGridSpecProps> {
    /** True while the props stream - the preview shows the rows that are complete so far. */
    isPartial?: boolean;

    /**
     * The data of a table by reference, from the catalog's `context.data`. Takes the place of
     * `columns` and `rows`.
     */
    dataHandle?: ChatDataHandle;

    /** The registry that holds the artifact of `dataHandle`, for the full grid. */
    registry?: ChatArtifactRegistry;

    /** The view over the artifact of `dataHandle`: its columns, sort, filter and units. */
    view?: ChatDataView;
}

/**
 * The result table that {@link chatUiGridSpec} renders: a card with the preview of the result,
 * and its full Hoist grid on Expand. Takes rows inline, as `columns` and `rows`, or an artifact by
 * reference, as `dataHandle`, `registry` and `view`.
 *
 * The preview shows at most `ChatUiGrid.defaults.previewRows` rows and `previewColumns` columns,
 * fewer where they do not fit, and formats each cell as the full grid does. Its download exports
 * every row of the result, not just the preview.
 */
export const [ChatUiGrid, chatUiGrid] = hoistCmp.withFactory<ChatUiGridProps, ChatUiGridDefaults>({
    displayName: 'ChatUiGrid',
    // Takes any model in context, as `useLocalModel()` needs a component with a model spec.
    model: uses('*', {optional: true}),
    className: 'xh-chat-ui-grid',
    defaults: CHAT_UI_GRID_DEFAULTS,

    render({className, title}) {
        const impl = useLocalModel(ChatUiGridLocalModel),
            ref = useComposedRefs(
                useOnResize(rect => impl.setWidth(rect.width), {debounce: 50}),
                impl.nodeRef
            );

        return div({
            ref,
            className: classNames(className, {'xh-chat-ui-grid--compact': impl.isCompact}),
            items: [cardFrame(impl, title), expandDialog(impl)]
        });
    }
});

//------------------
// Implementation
//------------------
// TODO(design-open B1): the inline tier is the preview table, and the Grid opens only in the side
// panel or a dialog - P4's default, open with Anselm.

const DESCRIPTION =
    'A data table - records with typed columns. Use it for lists of records, such as ' +
    'positions, trades or orders, and for any table of more than a few rows. The chat shows the ' +
    'first rows inline, and the user can open the whole table. Declare each column with its type ' +
    'and number format, then send the rows as objects keyed by column field.';

const REF_DESCRIPTION =
    'A data table of a result set that a tool produced - an artifact. Name the artifact by its ' +
    'id in `data`, and never copy its rows. Choose and order the columns, sort, filter and scale ' +
    'numbers with the view props. The chat shows the first rows inline, and the user can open ' +
    'the whole result.';

// Width each preview column needs, and the width below which the card is compact.
const COLUMN_WIDTH = 110,
    COMPACT_WIDTH = 420,
    COMPACT_COLUMNS = 3;

const VIEW_PROPS = ['columns', 'sortBy', 'filter', 'top', 'units'];

function createInlineSpec(opts: ChatUiGridSpecOptions): ChatUiComponentSpec<ChatUiGridSpecProps> {
    const {name = 'grid', description = DESCRIPTION, maxRows = 100, maxColumns = 12} = opts;

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
        render: (props, {isPartial}) => chatUiGrid({...props, isPartial}),
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

function createRefSpec(opts: ChatUiGridSpecOptions): ChatUiComponentSpec<ChatUiGridRefSpecProps> {
    const {name = 'grid', description = REF_DESCRIPTION} = opts;

    return {
        name,
        description,
        props: {
            type: 'object',
            required: ['data'],
            additionalProperties: false,
            properties: {
                title: {type: 'string', maxLength: 120, description: 'Short title for the table.'},
                data: {
                    type: 'string',
                    minLength: 1,
                    maxLength: 200,
                    description: 'Id of the artifact to show - a result set a tool produced.'
                },
                ...CHAT_DATA_VIEW_PROPERTIES
            }
        },
        // The first page holds the rows the preview sorts and filters, and the full grid's first.
        // Read as the catalog renders, so that defaults set after the catalog apply.
        get dataProps() {
            return [{name: 'data', pageSize: CHAT_UI_GRID_DEFAULTS.pageSize}];
        },
        render: (props, {isPartial, data, artifacts}) =>
            chatUiGrid({
                title: props.title,
                dataHandle: data.data ?? null,
                registry: artifacts,
                view: pick(props, VIEW_PROPS) as ChatDataView,
                isPartial
            }),
        example: {
            title: 'Largest positions',
            data: 'positions-1',
            columns: ['symbol', 'desk', 'gross', 'pnl'],
            sortBy: 'gross|desc',
            units: 'millions'
        }
    };
}

/** Where the card's rows are, for the preview and the full tier. */
interface GridSource {
    /**
     * `building` until the columns and the first rows or reference arrive; else the state of the
     * data - see `ChatDataHandleState`.
     */
    state: 'building' | ChatDataHandle['state'];
    frame: ChatDataFrame;
    view: ChatDataView;
    isComplete: boolean;
    error: unknown;
}

class ChatUiGridLocalModel extends ChatUiExpandModel {
    @observable accessor width: number = null;
    @observable accessor isCompactHost = false;

    /** Ref for the card's element - stable, so that a render does not re-attach it. */
    readonly nodeRef = (node: HTMLElement) => this.setNode(node);

    private node: HTMLElement = null;
    private inlineRegistry: ChatArtifactRegistry = null;
    private inlineRegistryFrame: ChatDataFrame = null;

    get props(): ChatUiGridProps {
        return this.componentProps as ChatUiGridProps;
    }

    get defaults(): ChatUiGridDefaults {
        return ChatUiGrid.defaults;
    }

    /** True at compact density - in a `.xh-chat--compact` chat, or a narrow card. */
    get isCompact(): boolean {
        const {width} = this;
        return this.isCompactHost || (width > 0 && width < COMPACT_WIDTH);
    }

    /** Columns the preview has room for - all it may show until measured. */
    get maxColumns(): number {
        const {width, isCompact} = this,
            {previewColumns} = this.defaults,
            fit = width > 0 ? Math.max(1, Math.floor(width / COLUMN_WIDTH)) : previewColumns,
            ret = Math.min(previewColumns, fit);
        return isCompact ? Math.min(ret, COMPACT_COLUMNS) : ret;
    }

    @computed
    get source(): GridSource {
        const {dataHandle, view, columns, rows, sortBy, isPartial} = this.props;
        if (dataHandle) {
            const {state, frame, isComplete, error} = dataHandle;
            return {state, frame, view: view ?? {}, isComplete, error};
        }

        // The model writes the rows after the columns, so the columns are complete once the
        // rows begin.
        const validColumns = (columns ?? []).filter(it => isPlainObject(it) && isString(it.field));
        if (!validColumns.length || (isPartial && rows == null)) {
            const state = isPartial ? 'building' : 'missing';
            return {state, frame: null, view: null, isComplete: false, error: null};
        }
        return {
            state: 'ready',
            frame: toInlineFrame(validColumns, rows, !!isPartial),
            view: toInlineView(sortBy, validColumns),
            isComplete: true,
            error: null
        };
    }

    /** The preview, or the error that a view which does not fit its data threw. */
    @computed
    get preview(): {preview: ChatUiTablePreview; error: Error} {
        const {frame, view, isComplete, state} = this.source;
        if (state !== 'ready' || !frame) return {preview: null, error: null};
        try {
            const preview = toTablePreview(frame, view, {
                isComplete,
                maxRows: this.defaults.previewRows,
                maxColumns: this.maxColumns
            });
            return {preview, error: null};
        } catch (e) {
            return {preview: null, error: e as Error};
        }
    }

    /** True while the model still writes the rows inline - the result is not yet whole. */
    get isStreaming(): boolean {
        return !this.props.dataHandle && !!this.props.isPartial;
    }

    @action
    setWidth(width: number) {
        this.width = width;
        this.isCompactHost = !!this.node?.closest('.xh-chat--compact');
    }

    @action
    setNode(node: HTMLElement) {
        this.node = node;
        if (node) this.isCompactHost = !!node.closest('.xh-chat--compact');
    }

    /** Open the full grid. */
    openFullTable(opener: HTMLElement) {
        const request = this.createRequest();
        if (request) this.expand(request, opener);
    }

    /** Export every row of the result, as the card's view shows them. */
    async downloadAsync() {
        const request = this.createRequest();
        if (!request) return;
        const {pageSize, exportConfirmAbove} = this.defaults;
        try {
            await exportResultAsync({...request, pageSize, exportConfirmAbove});
        } catch (e) {
            XH.handleException(e, {title: 'Download failed'});
        }
    }

    /** Load the first page again, after it failed. */
    retry() {
        this.props.dataHandle?.loadRangeAsync(0, this.defaults.pageSize).catch(() => null);
    }

    private createRequest() {
        const {dataHandle, registry, title} = this.props,
            {view, frame} = this.source;
        if (dataHandle) {
            return registry
                ? {type: 'table' as const, artifactId: dataHandle.artifactId, view, registry, title}
                : null;
        }
        if (!frame) return null;
        return {
            type: 'table' as const,
            artifactId: INLINE_ID,
            view,
            registry: this.getInlineRegistry(frame),
            title
        };
    }

    // A registry of the rows written inline, made again only if they change.
    private getInlineRegistry(frame: ChatDataFrame): ChatArtifactRegistry {
        if (this.inlineRegistryFrame !== frame) {
            this.inlineRegistryFrame = frame;
            this.inlineRegistry = this.setInlineRegistry(
                new ChatArtifactRegistry({
                    artifacts: [
                        {
                            id: INLINE_ID,
                            columns: frame.columns,
                            rows: frame.rows,
                            totalRows: frame.rows.length
                        }
                    ]
                })
            );
        }
        return this.inlineRegistry;
    }
}

const INLINE_ID = 'xh-inline-grid';

function cardFrame(impl: ChatUiGridLocalModel, title: string): ReactNode {
    const {state, frame, error} = impl.source,
        {preview, error: viewError} = impl.preview,
        icon = Icon.grid(),
        // A column name still streaming in does not fit the result yet - keep building.
        isBuilding = state === 'building' || (!!viewError && !!impl.props.isPartial);

    if (isBuilding && !title) {
        return chatUiFrame({status: 'Building table…', item: reservedBody(null)});
    }
    if (isBuilding || state === 'waiting' || state === 'loading') {
        return chatUiFrame({
            title,
            icon,
            item: previewSkeleton(impl.defaults.previewRows),
            footer: span({className: 'xh-chat-ui-grid__busy', item: 'Loading rows…'})
        });
    }
    if (!preview) {
        return chatUiFrame({
            title,
            icon,
            item: reservedBody(unavailable(impl, state, viewError ?? error)),
            footer: frame
                ? span(`${fmtRows(frame.totalRows)} · ${fmtCount(frame.columns.length)} columns`)
                : null
        });
    }

    const counts = describePreview(preview, impl.isCompact),
        canExpand = preview.hasMore && !impl.isStreaming,
        isOpen = impl.isOpenInPanel;

    return chatUiFrame({
        title,
        icon,
        headerItems: canExpand
            ? [
                  chatUiExpandButton({
                      title,
                      isActive: isOpen,
                      onClick: opener => impl.openFullTable(opener)
                  })
              ]
            : [],
        item: preview.records.length
            ? previewTable(preview, counts)
            : div({className: 'xh-chat-ui-center xh-chat-ui-grid__empty', item: 'No rows.'}),
        footer: [
            span({key: 'counts', className: 'xh-chat-ui-grid__counts', item: counts}),
            isOpen
                ? span({
                      key: 'open',
                      className: 'xh-chat-ui-grid__open',
                      items: [Icon.arrowRight(), 'Open in panel']
                  })
                : null,
            div({key: 'fill', className: 'xh-chat-ui-frame__fill'}),
            canExpand
                ? button({
                      key: 'full',
                      icon: Icon.openExternal(),
                      text: impl.isCompact ? 'Full Table' : 'View Full Table',
                      active: isOpen,
                      onClick: e => impl.openFullTable(e.currentTarget as HTMLElement)
                  })
                : null,
            button({
                key: 'download',
                className: 'xh-chat-ui-frame__button',
                icon: Icon.download(),
                tooltip: 'Download every row',
                'aria-label': title ? `Download ${title}` : 'Download',
                disabled: impl.isStreaming,
                onClick: () => impl.downloadAsync()
            })
        ]
    });
}

// A body at the height the loading preview took, so that nothing below moves when it fails.
function reservedBody(content: ReactNode): ReactNode {
    return div({className: 'xh-chat-ui-grid__reserved', item: content});
}

// Why the preview is not available, with only the actions that can work: Retry for a load that
// failed, nothing for data that is gone or a view that does not fit it.
function unavailable(
    impl: ChatUiGridLocalModel,
    state: GridSource['state'],
    error: unknown
): ReactNode {
    const canRetry = state === 'failed';
    return div({
        className: 'xh-chat-ui-center',
        role: 'alert',
        item: errorMessage({
            error: error ?? {},
            title: 'Preview unavailable',
            message: getUnavailableText(state, error),
            actionFn: canRetry ? () => impl.retry() : null,
            actionButtonProps: canRetry ? {text: 'Retry', icon: Icon.refresh()} : null
        })
    });
}

function getUnavailableText(state: GridSource['state'], error: unknown): string {
    switch (state) {
        case 'missing':
            return 'The data for this table is no longer available.';
        case 'tooLarge':
            return 'This result has too many rows to show here.';
        case 'failed':
            return "The table's rows could not be loaded.";
        default:
            return error instanceof Error && error.message.startsWith('Invalid data view')
                ? 'This table names a column that its result does not have.'
                : 'This table could not be shown.';
    }
}
