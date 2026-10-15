import {fireEvent, render, screen, within} from '@testing-library/react';
import type {ReactElement} from 'react';
import {GridModel} from '@xh/hoist/cmp/grid';
import {div, fragment} from '@xh/hoist/cmp/layout';
import {hoistCmp, type HoistProps, uses} from '@xh/hoist/core';
import {initTestAppAsync} from '@xh/hoist/test-support';
import {afterEach, beforeAll, beforeEach, describe, expect, it, onTestFinished, vi} from 'vitest';
import {ChatModel, ChatSidePanelModel, type ChatTableRequest} from '../../../core';
import {type ChatArtifact, ChatArtifactRegistry, type ChatDataSource} from '../../../genui';
import {ScriptedChatTransport} from '../../../transport';
import {ChatUiGrid, chatUiGrid, type ChatUiGridColumn, chatUiGridSpec} from './ChatUiGrid';

/**
 * The result table's inline tier (D69, B1). Users rely on the preview never mounting a grid, on
 * its footer always saying what it leaves out, and on Expand opening the whole result - in the
 * side panel when the chat has one, else in a dialog. Apps rely on the defaults capping the
 * preview, and on failures offering only the actions that can work.
 */
describe('ChatUiGrid', () => {
    beforeAll(() => initTestAppAsync());

    // jsdom has no layout, and so no ResizeObserver.
    beforeEach(() => vi.stubGlobal('ResizeObserver', NoopResizeObserver));
    afterEach(() => Object.assign(ChatUiGrid.defaults, DEFAULTS));

    describe('preview', () => {
        it('shows at most 8 rows and 6 columns, and says what it leaves out', () => {
            const {container} = renderInChat(
                chatUiGrid({title: 'Positions', columns: COLUMNS, rows: rows(30)})
            );

            expect(container.querySelectorAll('tbody tr')).toHaveLength(8);
            expect(container.querySelectorAll('thead th')).toHaveLength(6);
            expect(footerText(container)).toBe('Showing 8 of 30 rows · 6 of 8 columns');
            // Never an ag-Grid inline.
            expect(container.querySelector('.ag-root')).toBeNull();
        });

        it('takes its limits from ChatUiGrid.defaults', () => {
            ChatUiGrid.defaults.previewRows = 3;
            ChatUiGrid.defaults.previewColumns = 2;
            const {container} = renderInChat(chatUiGrid({columns: COLUMNS, rows: rows(5)}));

            expect(container.querySelectorAll('tbody tr')).toHaveLength(3);
            expect(footerText(container)).toBe('Showing 3 of 5 rows · 2 of 8 columns');
        });

        it('offers no full tier for a result that fits the preview', () => {
            const {container} = renderInChat(
                chatUiGrid({title: 'Desks', columns: COLUMNS.slice(0, 3), rows: rows(3)})
            );

            expect(footerText(container)).toBe('3 rows');
            expect(screen.queryByRole('button', {name: 'Expand Desks'})).toBeNull();
            expect(screen.queryByRole('button', {name: 'View Full Table'})).toBeNull();
            expect(screen.getByRole('button', {name: 'Download Desks'})).toBeTruthy();
        });

        it('sorts by the sortBy before it takes the first rows', () => {
            const {container} = renderInChat(
                chatUiGrid({columns: COLUMNS, rows: rows(30), sortBy: 'qty|desc'})
            );
            const firstSymbol = container.querySelector('tbody tr td').textContent;
            expect(firstSymbol).toBe('S29');
        });

        it('formats cells as the full grid does: ledger negatives, right-aligned numbers', () => {
            const {container} = renderInChat(
                chatUiGrid({
                    columns: [{field: 'pnl', type: 'number', decimals: 0}],
                    rows: [{pnl: -1200}]
                })
            );
            const cell = container.querySelector('tbody td');
            expect(cell.textContent).toContain('(1,200)');
            expect(cell.className).toContain('xh-chat-ui-table__cell--right');
        });

        it('is a table whose caption is its counts', () => {
            renderInChat(chatUiGrid({title: 'Positions', columns: COLUMNS, rows: rows(30)}));
            const table = screen.getByRole('table', {
                name: 'Showing 8 of 30 rows · 6 of 8 columns'
            });
            expect(within(table).getAllByRole('columnheader')).toHaveLength(6);
            expect(screen.getByRole('region', {name: 'Positions'})).toBeTruthy();
        });

        it('says it is building until the title arrives, then shows skeleton rows', () => {
            const {container, rerender} = renderInChat(chatUiGrid({isPartial: true}));
            expect(screen.getByRole('status').textContent).toContain('Building table…');

            rerender(chatUiGrid({title: 'Positions', columns: COLUMNS, isPartial: true}));
            expect(container.querySelector('.xh-chat-ui-table-skeleton')).toBeTruthy();
            expect(footerText(container)).toBe('Loading rows…');
        });

        it('shows rows as they stream, holding back the one still being written', () => {
            const {container} = renderInChat(
                chatUiGrid({columns: COLUMNS, rows: rows(3), isPartial: true})
            );
            expect(container.querySelectorAll('tbody tr')).toHaveLength(2);
        });

        it('shows 3 columns and a shorter footer at compact density', () => {
            const {container} = renderInChat(
                div({
                    className: 'xh-chat--compact',
                    item: chatUiGrid({title: 'Positions', columns: COLUMNS, rows: rows(30)})
                })
            );

            expect(container.querySelectorAll('thead th')).toHaveLength(3);
            expect(footerText(container)).toBe('8 of 30 rows · 3 of 8 cols');
            expect(screen.getByRole('button', {name: 'Full Table'})).toBeTruthy();
        });
    });

    describe('full tier', () => {
        it('opens a table request in the side panel, and shows it as open', () => {
            const sidePanel = createSidePanel();
            renderInChat(chatUiGrid({title: 'Positions', columns: COLUMNS, rows: rows(30)}), {
                sidePanel
            });

            const viewFull = screen.getByRole('button', {name: 'View Full Table'});
            fireEvent.click(viewFull);

            const request = sidePanel.request as ChatTableRequest;
            expect(request).toMatchObject({type: 'table', title: 'Positions', view: {}});
            expect(request.registry.get(request.artifactId).totalRows).toBe(30);
            expect(sidePanel.opener).toBe(viewFull);
            expect(screen.getByText('Open in panel')).toBeTruthy();
        });

        it('opens the same request from the Expand button in its header', () => {
            const sidePanel = createSidePanel();
            renderInChat(chatUiGrid({title: 'Positions', columns: COLUMNS, rows: rows(30)}), {
                sidePanel
            });

            fireEvent.click(screen.getByRole('button', {name: 'Expand Positions'}));
            expect(sidePanel.request?.type).toBe('table');
        });

        it('opens the full grid in a dialog where the chat has no side panel', () => {
            renderInChat(chatUiGrid({title: 'Positions', columns: COLUMNS, rows: rows(30)}));

            fireEvent.click(screen.getByRole('button', {name: 'View Full Table'}));

            const dialog = document.querySelector('.xh-chat-ui-expand-dialog');
            expect(dialog).toBeTruthy();
            expect(dialog.querySelector('.xh-chat-ui-table-view')).toBeTruthy();
        });

        it('opens a dialog where the side panel has no room', () => {
            const sidePanel = createSidePanel(false);
            renderInChat(chatUiGrid({title: 'Positions', columns: COLUMNS, rows: rows(30)}), {
                sidePanel
            });

            fireEvent.click(screen.getByRole('button', {name: 'View Full Table'}));
            expect(sidePanel.request).toBeNull();
            expect(document.querySelector('.xh-chat-ui-expand-dialog')).toBeTruthy();
        });

        it('names the chat registry and the view for a table by reference', () => {
            const sidePanel = createSidePanel(),
                registry = createRegistry(artifact(40)),
                view = {sortBy: 'qty|desc', columns: ['symbol', 'qty']};
            renderInChat(
                chatUiGrid({
                    title: 'Positions',
                    dataHandle: registry.getHandle('pos', {pageSize: 1000}),
                    registry,
                    view
                }),
                {sidePanel}
            );

            fireEvent.click(screen.getByRole('button', {name: 'View Full Table'}));
            expect(sidePanel.request).toEqual({
                type: 'table',
                artifactId: 'pos',
                view,
                registry,
                title: 'Positions'
            });
        });
    });

    describe('by reference', () => {
        it('applies the view to the first page, and counts the whole result', async () => {
            const registry = createRegistry(artifact(1240), {source: pageSource(1240)});
            await registry.loadRangeAsync('pos', 0, 1000);
            const {container} = renderInChat(
                chatUiGrid({
                    dataHandle: registry.getHandle('pos', {pageSize: 1000}),
                    registry,
                    view: {columns: ['qty', 'symbol']}
                })
            );

            expect(footerText(container)).toBe('Showing 8 of 1,240 rows · 2 of 8 columns');
            expect(container.querySelector('thead th').textContent).toBe('Qty');
        });

        it('offers Retry for rows that failed to load, and keeps the counts it knows', async () => {
            const loadAsync = vi.fn().mockRejectedValue(new Error('503')),
                registry = createRegistry(artifact(1240), {source: {loadAsync}});
            await registry.loadRangeAsync('pos', 0, 1000).catch(() => null);
            const {container} = renderInChat(
                chatUiGrid({
                    title: 'Positions',
                    dataHandle: registry.getHandle('pos', {pageSize: 1000}),
                    registry
                })
            );

            expect(screen.getByText('Preview unavailable')).toBeTruthy();
            fireEvent.click(screen.getByRole('button', {name: 'Retry'}));
            expect(loadAsync).toHaveBeenCalledTimes(2);
            expect(container.querySelector('.xh-chat-ui-grid__reserved')).toBeTruthy();
        });

        it('offers no Retry for an artifact that is gone', () => {
            const registry = createRegistry();
            renderInChat(
                chatUiGrid({
                    title: 'Positions',
                    dataHandle: registry.getHandle('gone', {pageSize: 1000}),
                    registry
                })
            );

            expect(
                screen.getByText('The data for this table is no longer available.')
            ).toBeTruthy();
            expect(screen.queryByRole('button', {name: 'Retry'})).toBeNull();
        });

        it('says so when the view names a column the result does not have', () => {
            const registry = createRegistry(artifact(10, true));
            renderInChat(
                chatUiGrid({
                    dataHandle: registry.getHandle('pos', {pageSize: 1000}),
                    registry,
                    view: {columns: ['nope']}
                })
            );
            expect(
                screen.getByText('This table names a column that its result does not have.')
            ).toBeTruthy();
            expect(screen.queryByRole('button', {name: 'Retry'})).toBeNull();
        });
    });

    it('takes an artifact id and a view by reference, and loads a full page for the preview', () => {
        const spec = chatUiGridSpec({byReference: true});
        expect(spec.props.required).toEqual(['data']);
        expect(Object.keys(spec.props.properties)).toEqual(
            expect.arrayContaining(['data', 'columns', 'sortBy', 'filter', 'top', 'units'])
        );
        expect(spec.dataProps).toEqual([{name: 'data', pageSize: 1000}]);
    });

    it('exports every row on download, not just the preview', async () => {
        const exportAsync = vi.spyOn(GridModel.prototype, 'exportAsync').mockResolvedValue(),
            loadData = vi.spyOn(GridModel.prototype, 'loadData');
        onTestFinished(() => {
            exportAsync.mockRestore();
            loadData.mockRestore();
        });
        renderInChat(chatUiGrid({title: 'Positions', columns: COLUMNS, rows: rows(30)}));

        fireEvent.click(screen.getByRole('button', {name: 'Download Positions'}));
        await vi.waitFor(() => expect(exportAsync).toHaveBeenCalledOnce());
        expect(loadData.mock.calls[0][0]).toHaveLength(30);
    });
});

//------------------
// Helpers
//------------------
const DEFAULTS = {...ChatUiGrid.defaults};

const COLUMNS: ChatUiGridColumn[] = [
    {field: 'symbol'},
    {field: 'desk'},
    {field: 'qty', type: 'number', decimals: 0},
    {field: 'price', type: 'number'},
    {field: 'date', type: 'date'},
    {field: 'open', type: 'boolean'},
    {field: 'book'},
    {field: 'trader'}
];

function rows(count: number) {
    return Array.from({length: count}, (_, idx) => ({
        symbol: `S${idx}`,
        desk: 'Rates',
        qty: idx * 100,
        price: 101.25,
        date: '2026-10-01',
        open: idx % 2 === 0,
        book: 'Macro',
        trader: 'J. Ortega'
    }));
}

function artifact(totalRows: number, inline = false): ChatArtifact {
    return {
        id: 'pos',
        columns: COLUMNS.map(it => ({name: it.field, type: it.type ?? 'string'})),
        rows: inline ? rows(totalRows) : undefined,
        totalRows
    };
}

function pageSource(totalRows: number): ChatDataSource {
    return {
        loadAsync: async ({offset, limit}) => {
            const all = rows(totalRows);
            return {columns: [], rows: all.slice(offset, offset + limit), totalRows};
        }
    };
}

function createRegistry(
    entry: ChatArtifact = null,
    opts: {source?: ChatDataSource} = {}
): ChatArtifactRegistry {
    const ret = new ChatArtifactRegistry({
        dataSource: opts.source,
        artifacts: entry ? [entry] : []
    });
    onTestFinished(() => ret.destroy());
    return ret;
}

function createSidePanel(hasRoom = true): ChatSidePanelModel {
    const ret = new ChatSidePanelModel({hasRoom: () => hasRoom});
    onTestFinished(() => ret.destroy());
    return ret;
}

function footerText(container: HTMLElement): string {
    return container.querySelector('.xh-chat-ui-frame__footer span').textContent;
}

class NoopResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
}

// Components render within a chat - and a workspace's side panel, if given - whose models give
// them the model context Hoist needs.
const chatHost = hoistCmp.factory<HoistProps<ChatModel>>({
    displayName: 'ChatHost',
    model: uses(ChatModel),
    render: ({children}) => fragment({items: children})
});

const sidePanelHost = hoistCmp.factory<HoistProps<ChatSidePanelModel>>({
    displayName: 'SidePanelHost',
    model: uses(ChatSidePanelModel),
    render: ({children}) => fragment({items: children})
});

function renderInChat(content: ReactElement, opts: {sidePanel?: ChatSidePanelModel} = {}) {
    const model = new ChatModel({transport: new ScriptedChatTransport()});
    onTestFinished(() => model.destroy());

    const wrap = (it: ReactElement) => {
            const inChat = chatHost({model, item: it});
            return opts.sidePanel ? sidePanelHost({model: opts.sidePanel, item: inChat}) : inChat;
        },
        result = render(wrap(content));
    return {...result, rerender: (it: ReactElement) => result.rerender(wrap(it))};
}
