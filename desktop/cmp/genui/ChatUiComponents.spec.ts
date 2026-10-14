import {fireEvent, render, screen} from '@testing-library/react';
import type {ReactElement} from 'react';
import {ChartModel} from '@xh/hoist/cmp/chart';
import {GridModel} from '@xh/hoist/cmp/grid';
import {fragment} from '@xh/hoist/cmp/layout';
import {hoistCmp, type HoistProps, uses} from '@xh/hoist/core';
import {runInAction} from '@xh/hoist/mobx';
import {initTestAppAsync} from '@xh/hoist/test-support';
import {beforeAll, beforeEach, describe, expect, it, onTestFinished, vi} from 'vitest';
import {ChatModel} from '../../../core';
import {ScriptedChatTransport} from '../../../transport';
import {chatUiCard} from './ChatUiCard';
import {chatUiChart, type ChatUiChartProps} from './ChatUiChart';
import {chatUiGrid, type ChatUiGridProps} from './ChatUiGrid';
import {chatUiMetrics} from './ChatUiMetrics';

/**
 * The built-in generative UI components render props as the model writes them. Apps rely on each
 * one owning a single Hoist model for its life - filled as the props stream, never rebuilt per
 * update, and destroyed on unmount - on numbers that are never cut short, and on card actions
 * that send exactly what the user can see.
 */
describe('generative UI components', () => {
    beforeAll(() => initTestAppAsync());

    // jsdom has no layout, and so no ResizeObserver.
    beforeEach(() => {
        vi.stubGlobal('ResizeObserver', NoopResizeObserver);
    });

    describe('ChatUiGrid', () => {
        const columns: ChatUiGridProps['columns'] = [
            {field: 'symbol'},
            {field: 'pnl', type: 'number', format: 'currency'}
        ];

        it('creates its grid once the rows begin, and fills the same model as they stream', () => {
            const loadData = vi.spyOn(GridModel.prototype, 'loadData'),
                {container, rerender} = renderInChat(chatUiGrid({columns, isPartial: true}));
            onTestFinished(() => loadData.mockRestore());

            // Columns alone may still be streaming - a placeholder shows.
            expect(container.querySelector('.xh-chat-ui-skeleton')).toBeTruthy();
            expect(loadData).not.toHaveBeenCalled();

            const rows = [
                {symbol: 'AAPL', pnl: 1},
                {symbol: 'MSFT', pnl: 2},
                {symbol: 'NVDA', pnl: 3}
            ];
            rerender(chatUiGrid({columns, rows: rows.slice(0, 2), isPartial: true}));
            rerender(chatUiGrid({columns, rows, isPartial: true}));
            rerender(chatUiGrid({columns, rows, isPartial: false}));

            const models = new Set(loadData.mock.contexts);
            expect(models.size).toBe(1);
            // The last row loads only once complete, as it may be cut short while streaming.
            expect(loadData.mock.calls.map(([data]) => data.length)).toEqual([1, 2, 3]);
        });

        it('applies a sortBy that arrives after the rows', () => {
            const rows = [{symbol: 'AAPL', pnl: 1}],
                {rerender} = renderInChat(chatUiGrid({columns, rows, isPartial: true})),
                setSortBy = vi.spyOn(GridModel.prototype, 'setSortBy');
            onTestFinished(() => setSortBy.mockRestore());

            rerender(chatUiGrid({columns, rows, sortBy: 'pnl|desc', isPartial: false}));

            expect(setSortBy).toHaveBeenCalledWith({colId: 'col1', sort: 'desc'});
        });

        it('destroys its grid model when it unmounts', () => {
            const destroy = vi.spyOn(GridModel.prototype, 'destroy'),
                {unmount} = renderInChat(chatUiGrid({columns, rows: [{symbol: 'AAPL', pnl: 1}]}));
            onTestFinished(() => destroy.mockRestore());

            unmount();
            expect(destroy).toHaveBeenCalledOnce();
        });
    });

    describe('ChatUiChart', () => {
        const props: ChatUiChartProps = {type: 'line', xAxis: {categories: ['Q1', 'Q2', 'Q3']}};

        it('creates its chart once the series begin, and updates the same model', () => {
            const setSeries = vi.spyOn(ChartModel.prototype, 'setSeries'),
                {rerender, unmount} = renderInChat(chatUiChart({...props, isPartial: true}));
            onTestFinished(() => setSeries.mockRestore());
            expect(setSeries).not.toHaveBeenCalled();

            rerender(chatUiChart({...props, series: [{name: 'A', data: [1, 2]}], isPartial: true}));
            rerender(
                chatUiChart({...props, series: [{name: 'A', data: [1, 2, 3]}], isPartial: false})
            );

            expect(new Set(setSeries.mock.contexts).size).toBe(1);
            expect(setSeries.mock.calls.map(([series]) => series[0].data)).toEqual([
                [1],
                [1, 2, 3]
            ]);

            const destroy = vi.spyOn(ChartModel.prototype, 'destroy');
            onTestFinished(() => destroy.mockRestore());
            unmount();
            expect(destroy).toHaveBeenCalledOnce();
        });
    });

    describe('ChatUiMetrics', () => {
        it('shows a large value in a compact form, with the full value in a tooltip', () => {
            render(
                chatUiMetrics({
                    metrics: [{label: 'Market cap', value: 48500000000, format: 'currency'}]
                })
            );

            const value = screen.getByText('$48.5B');
            expect(value.closest('.xh-chat-ui-metrics__value').getAttribute('title')).toBe(
                '$48,500,000,000.00'
            );
        });

        it('shows only complete tiles while the props stream', () => {
            render(
                chatUiMetrics({
                    metrics: [
                        {label: 'Revenue', value: 12},
                        {label: 'Margin', value: 0.3}
                    ],
                    isPartial: true
                })
            );

            expect(screen.getByText('Revenue')).toBeTruthy();
            expect(screen.queryByText('Margin')).toBeNull();
        });
    });

    describe('ChatUiCard', () => {
        const actions = [{text: 'Show trades', prompt: 'Show my open trades with Acme Corp.'}];

        it('sends an action prompt as the user message, exactly as written', () => {
            const chatModel = createChatModel(),
                send = vi.spyOn(chatModel, 'sendAsync').mockResolvedValue();
            render(chatUiCard({title: 'Acme Corp', fields: [], actions, chatModel}));

            fireEvent.click(screen.getByRole('button', {name: 'Show trades'}));

            expect(send).toHaveBeenCalledExactlyOnceWith('Show my open trades with Acme Corp.');
        });

        it('disables its actions while the chat is busy, and while the props stream', () => {
            const chatModel = createChatModel(),
                {rerender} = render(
                    chatUiCard({
                        title: 'Acme Corp',
                        fields: [],
                        actions,
                        chatModel,
                        isPartial: true
                    })
                );
            expect(screen.queryByRole('button', {name: 'Show trades'})).toBeNull();

            runInAction(() => (chatModel.status = 'streaming'));
            rerender(chatUiCard({title: 'Acme Corp', fields: [], actions, chatModel}));

            const button = screen.getByRole('button', {name: 'Show trades'}) as HTMLButtonElement;
            expect(button.disabled).toBe(true);
        });
    });
});

//------------------
// Helpers
//------------------
class NoopResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
}

// Components render within a chat, whose model gives them the model context Hoist needs.
const chatHost = hoistCmp.factory<HoistProps<ChatModel>>({
    displayName: 'ChatHost',
    model: uses(ChatModel),
    render: ({children}) => fragment({items: children})
});

function renderInChat(content: ReactElement) {
    const model = createChatModel(),
        inChat = (it: ReactElement) => chatHost({model, item: it}),
        result = render(inChat(content));
    return {...result, rerender: (it: ReactElement) => result.rerender(inChat(it))};
}

function createChatModel(): ChatModel {
    const model = new ChatModel({transport: new ScriptedChatTransport()});
    onTestFinished(() => model.destroy());
    return model;
}
