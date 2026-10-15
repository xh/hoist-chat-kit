import {act, fireEvent, render, screen} from '@testing-library/react';
import type {ReactElement} from 'react';
import {GridModel} from '@xh/hoist/cmp/grid';
import {fragment} from '@xh/hoist/cmp/layout';
import {hoistCmp, type HoistProps, uses, XH} from '@xh/hoist/core';
import {initTestAppAsync} from '@xh/hoist/test-support';
import {afterEach, beforeAll, beforeEach, describe, expect, it, onTestFinished, vi} from 'vitest';
import {ChatSidePanelModel, type ChatTableRequest} from '../../../core';
import {ChatArtifactRegistry, type ChatDataLoadSpec, type ChatDataView} from '../../../genui';
import {ChatUiGrid} from './ChatUiGrid';
import {chatUiTableView} from './ChatUiTableView';

/**
 * The result table's full tier (D69): one Hoist grid over the whole artifact. Users rely on it
 * paging from the data source a page at a time, only when they ask, on the card's view carrying
 * over, and on a large export asking first.
 */
describe('ChatUiTableView', () => {
    beforeAll(() => initTestAppAsync());

    beforeEach(() => vi.stubGlobal('ResizeObserver', NoopResizeObserver));
    afterEach(() => Object.assign(ChatUiGrid.defaults, DEFAULTS));

    it('loads the first page from the data source, and the next on Load Next', async () => {
        ChatUiGrid.defaults.pageSize = 1000;
        const {loadAsync, request} = setup(2500);
        renderInHost(chatUiTableView({request}));

        await screen.findByText('Loaded 1,000 of 2,500 rows');
        expect(loadAsync).toHaveBeenCalledOnce();
        expect(loadAsync.mock.calls[0][0]).toMatchObject({offset: 0, limit: 1000});

        fireEvent.click(screen.getByRole('button', {name: 'Load Next 1,000'}));
        await screen.findByText('Loaded 2,000 of 2,500 rows');
        expect(loadAsync.mock.calls[1][0]).toMatchObject({offset: 1000, limit: 1000});

        fireEvent.click(screen.getByRole('button', {name: 'Load Next 500'}));
        await screen.findByText('2,500 rows');
        expect(screen.queryByRole('button', {name: /Load Next/})).toBeNull();
    });

    it("keeps the card's columns visible, starts the rest hidden, and sorts as the card did", async () => {
        const loadData = vi.spyOn(GridModel.prototype, 'loadData');
        onTestFinished(() => loadData.mockRestore());
        const {request} = setup(10, {columns: ['qty', 'symbol'], sortBy: 'qty|desc'});
        renderInHost(chatUiTableView({request}));

        await screen.findByText('10 rows');
        expect(screen.getByRole('button', {name: 'Columns 2 of 3'})).toBeTruthy();
        expect(screen.getByText('Sorted by Qty, descending')).toBeTruthy();
    });

    it('says that its sort covers only the rows loaded', async () => {
        const {request} = setup(2500, {sortBy: 'qty|desc'});
        renderInHost(chatUiTableView({request}));
        await screen.findByText('Loaded 1,000 of 2,500 rows');
        expect(screen.getByText(/Sort and Find cover loaded rows/)).toBeTruthy();
    });

    it("counts the rows the card's filter keeps", async () => {
        const filter = [{field: 'qty', op: 'lt' as const, value: 4}],
            partial = setup(2500, {filter}),
            whole = setup(10, {filter});
        renderInHost(chatUiTableView({request: partial.request}));
        await screen.findByText('Loaded 1,000 of 2,500 rows · 4 shown');

        renderInHost(chatUiTableView({request: whole.request}));
        await screen.findByText('10 rows · 4 shown');
    });

    it('waits for Load Next to finish before it exports, and for an export before Load Next', async () => {
        let release: () => void;
        const {loadAsync, request} = setup(2500);
        renderInHost(chatUiTableView({request}));
        await screen.findByText('Loaded 1,000 of 2,500 rows');

        loadAsync.mockImplementationOnce(async ({offset, limit}) => {
            await new Promise<void>(resolve => (release = resolve));
            return {columns: [], rows: makeRows(offset, limit), totalRows: 2500};
        });
        fireEvent.click(screen.getByRole('button', {name: 'Load Next 1,000'}));
        await vi.waitFor(() => expect(exportButton().disabled).toBe(true));

        await act(async () => release());
        await screen.findByText('Loaded 2,000 of 2,500 rows');
        expect(exportButton().disabled).toBe(false);
    });

    it('says that find searches only the rows loaded', async () => {
        const {request} = setup(2500);
        renderInHost(chatUiTableView({request}));
        await screen.findByText('Loaded 1,000 of 2,500 rows');
        expect(screen.getByText('Find searches loaded rows')).toBeTruthy();
    });

    describe('export', () => {
        it('loads every row and exports, with no question at or under the threshold', async () => {
            ChatUiGrid.defaults.exportConfirmAbove = 2500;
            const confirm = vi.spyOn(XH, 'confirm'),
                exportAsync = vi.spyOn(GridModel.prototype, 'exportAsync').mockResolvedValue();
            onTestFinished(() => {
                confirm.mockRestore();
                exportAsync.mockRestore();
            });
            const {loadAsync, request} = setup(2500);
            renderInHost(chatUiTableView({request}));
            await screen.findByText('Loaded 1,000 of 2,500 rows');

            fireEvent.click(screen.getByRole('button', {name: 'Export'}));
            await vi.waitFor(() => expect(exportAsync).toHaveBeenCalledOnce());
            expect(confirm).not.toHaveBeenCalled();
            expect(loadAsync).toHaveBeenCalledTimes(3);
            expect(screen.getByText('2,500 rows')).toBeTruthy();
        });

        it('asks first above the threshold, and does nothing if the user declines', async () => {
            ChatUiGrid.defaults.exportConfirmAbove = 2000;
            const confirm = vi.spyOn(XH, 'confirm').mockResolvedValue(false),
                exportAsync = vi.spyOn(GridModel.prototype, 'exportAsync').mockResolvedValue();
            onTestFinished(() => {
                confirm.mockRestore();
                exportAsync.mockRestore();
            });
            const {loadAsync, request} = setup(2500);
            renderInHost(chatUiTableView({request}));
            await screen.findByText('Loaded 1,000 of 2,500 rows');

            await act(async () => {
                fireEvent.click(screen.getByRole('button', {name: 'Export'}));
            });
            await vi.waitFor(() => expect(confirm).toHaveBeenCalledOnce());
            expect(exportAsync).not.toHaveBeenCalled();
            expect(loadAsync).toHaveBeenCalledOnce();
        });
    });

    it('says the table is unavailable when its registry no longer has the artifact', () => {
        const registry = new ChatArtifactRegistry();
        onTestFinished(() => registry.destroy());
        renderInHost(chatUiTableView({request: {type: 'table', artifactId: 'gone', registry}}));
        expect(screen.getByText('The data for this table is no longer available.')).toBeTruthy();
    });
});

//------------------
// Helpers
//------------------
const DEFAULTS = {...ChatUiGrid.defaults};

function setup(totalRows: number, view: ChatDataView = {}) {
    const loadAsync = vi.fn(async ({offset, limit}: ChatDataLoadSpec) => ({
            columns: [],
            rows: makeRows(offset, limit),
            totalRows
        })),
        registry = new ChatArtifactRegistry({
            dataSource: {loadAsync},
            artifacts: [
                {
                    id: 'pos',
                    columns: [
                        {name: 'symbol', type: 'string'},
                        {name: 'qty', type: 'integer'},
                        {name: 'desk', type: 'string'}
                    ],
                    totalRows
                }
            ]
        }),
        request: ChatTableRequest = {type: 'table', artifactId: 'pos', view, registry};
    onTestFinished(() => registry.destroy());
    return {loadAsync, registry, request};
}

function makeRows(offset: number, limit: number) {
    return Array.from({length: limit}, (_, idx) => ({
        symbol: `S${offset + idx}`,
        qty: offset + idx,
        desk: 'Rates'
    }));
}

function exportButton(): HTMLButtonElement {
    return screen.getByRole('button', {name: 'Export'}) as HTMLButtonElement;
}

class NoopResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
}

// The view renders where a chat does: below a model in context, here the side panel's.
const host = hoistCmp.factory<HoistProps<ChatSidePanelModel>>({
    displayName: 'Host',
    model: uses(ChatSidePanelModel),
    render: ({children}) => fragment({items: children})
});

function renderInHost(content: ReactElement) {
    const model = new ChatSidePanelModel();
    onTestFinished(() => model.destroy());
    return render(host({model, item: content}));
}
