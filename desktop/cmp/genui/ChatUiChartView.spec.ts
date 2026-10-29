import {fireEvent, render, screen} from '@testing-library/react';
import type {ReactElement} from 'react';
import {ChartModel} from '@xh/hoist/cmp/chart';
import {div, fragment} from '@xh/hoist/cmp/layout';
import {hoistCmp, type HoistProps, uses} from '@xh/hoist/core';
import {initTestAppAsync} from '@xh/hoist/test-support';
import {afterEach, beforeAll, beforeEach, describe, expect, it, onTestFinished, vi} from 'vitest';
import {type ChatChartRequest, ChatModel, ChatSidePanelModel} from '../../../core';
import {ChatArtifactRegistry} from '../../../genui';
import {ScriptedChatTransport} from '../../../transport';
import {ChatUiChart, chatUiChart, type ChatUiChartProps} from './ChatUiChart';
import {chatUiChartView} from './ChatUiChartView';

/**
 * The chart card and its expanded tier (P4). Users rely on Expand opening the whole chart - with
 * switchers for its type and axes that keep the zoom - on an inline chart that stays light, and on
 * a chart that cannot draw saying why and offering the table.
 */
describe('ChatUiChart tiers', () => {
    beforeAll(() => initTestAppAsync());

    beforeEach(() => vi.stubGlobal('ResizeObserver', NoopResizeObserver));
    afterEach(() => Object.assign(ChatUiChart.defaults, DEFAULTS));

    const props: ChatUiChartProps = {
        title: 'Daily P&L',
        type: 'line',
        xAxis: {categories: ['Mon', 'Tue', 'Wed']},
        yAxis: {format: 'number'},
        series: [
            {name: 'Daily', data: [1, -2, 3]},
            {name: 'Cumulative', data: [1, -1, 2]}
        ]
    };

    it('opens a chart request for its inline series in the side panel', () => {
        const sidePanel = new ChatSidePanelModel();
        onTestFinished(() => sidePanel.destroy());
        renderInHost(chatUiChart(props), {sidePanel});

        fireEvent.click(screen.getByRole('button', {name: 'Expand Daily P&L'}));

        const request = sidePanel.request as ChatChartRequest;
        expect(request).toMatchObject({
            type: 'chart',
            title: 'Daily P&L',
            view: {type: 'line', x: 'x', y: ['s0', 's1']}
        });
        expect(request.registry.get(request.artifactId).rows).toEqual([
            {x: 'Mon', s0: 1, s1: 1},
            {x: 'Tue', s0: -2, s1: -1},
            {x: 'Wed', s0: 3, s1: 2}
        ]);
    });

    it('opens the expanded chart in a dialog where the chat has no side panel', () => {
        renderInHost(chatUiChart(props));
        fireEvent.click(screen.getByRole('button', {name: 'Expand Daily P&L'}));
        expect(
            document.querySelector('.xh-chat-ui-expand-dialog .xh-chat-ui-chart-view')
        ).toBeTruthy();
    });

    it('draws at most the inline series, and says how many it leaves out', () => {
        ChatUiChart.defaults.maxInlineSeries = 1;
        const setSeries = vi.spyOn(ChartModel.prototype, 'setSeries');
        onTestFinished(() => setSeries.mockRestore());
        renderInHost(chatUiChart(props));

        expect(screen.getByText('First 1 of 2 series')).toBeTruthy();
        expect(setSeries.mock.lastCall[0]).toHaveLength(1);
    });

    it('samples a long series down to the inline points', () => {
        ChatUiChart.defaults.maxInlinePoints = 10;
        const setSeries = vi.spyOn(ChartModel.prototype, 'setSeries');
        onTestFinished(() => setSeries.mockRestore());
        renderInHost(
            chatUiChart({
                type: 'line',
                series: [{name: 'NAV', data: Array.from({length: 100}, (_, idx) => idx)}]
            })
        );
        expect(setSeries.mock.lastCall[0][0].data).toHaveLength(10);
    });

    it('takes its height from the chart height variable, unless given one', () => {
        const {container} = renderInHost(
                div({
                    items: [
                        chatUiChart({key: 'a', ...props}),
                        chatUiChart({key: 'b', ...props, height: 300})
                    ]
                })
            ),
            bodies = container.querySelectorAll<HTMLElement>('.xh-chat-ui-chart__body');
        // The variable is 220 px, and 160 px under `.xh-chat--compact`.
        expect(bodies[0].style.height).toBe('');
        expect(bodies[1].style.height).toBe('300px');
    });

    describe('by reference', () => {
        it('says there is nothing to chart without a numeric column, and offers the table', () => {
            const sidePanel = new ChatSidePanelModel(),
                registry = textRegistry();
            onTestFinished(() => sidePanel.destroy());
            renderInHost(
                chatUiChart({
                    title: 'Positions by Trader',
                    dataHandle: registry.getHandle('traders'),
                    registry,
                    view: {type: 'column', x: 'trader', y: ['desk']}
                }),
                {sidePanel}
            );

            expect(screen.getByText('No numeric column to chart')).toBeTruthy();
            expect(screen.getByText('The result has 2 columns: trader, desk.')).toBeTruthy();
            fireEvent.click(screen.getByRole('button', {name: 'Show as Table'}));
            expect(sidePanel.request).toMatchObject({type: 'table', artifactId: 'traders'});
        });
    });

    describe('expanded', () => {
        it('switches the type in place, so that a zoom survives', async () => {
            const setSeries = vi.spyOn(ChartModel.prototype, 'setSeries'),
                setConfig = vi.spyOn(ChartModel.prototype, 'setHighchartsConfig');
            onTestFinished(() => {
                setSeries.mockRestore();
                setConfig.mockRestore();
            });
            renderInHost(chatUiChartView({request: chartRequest()}));
            await vi.waitFor(() => expect(setSeries.mock.lastCall?.[0]).toHaveLength(2));
            const configCalls = setConfig.mock.calls.length;

            fireEvent.click(screen.getByRole('radio', {name: 'Column'}));

            expect(setSeries.mock.lastCall[0].map(it => it.type)).toEqual(['column', 'column']);
            expect(setConfig.mock.calls).toHaveLength(configCalls);
            expect(new Set(setSeries.mock.contexts).size).toBe(1);
        });

        it('switches a bar chart to an upright line chart', async () => {
            const setConfig = vi.spyOn(ChartModel.prototype, 'setHighchartsConfig');
            onTestFinished(() => setConfig.mockRestore());
            const request = chartRequest();
            renderInHost(
                chatUiChartView({request: {...request, view: {...request.view, type: 'bar'}}})
            );
            await vi.waitFor(() => expect(setConfig.mock.lastCall?.[0].chart.inverted).toBe(true));

            fireEvent.click(screen.getByRole('radio', {name: 'Line'}));
            expect(setConfig.mock.lastCall[0].chart.inverted).toBeFalsy();
        });

        it('inverts the axes for a bar chart', async () => {
            const setConfig = vi.spyOn(ChartModel.prototype, 'setHighchartsConfig');
            onTestFinished(() => setConfig.mockRestore());
            renderInHost(chatUiChartView({request: chartRequest()}));
            await vi.waitFor(() => expect(setConfig.mock.lastCall?.[0].chart).toBeTruthy());

            fireEvent.click(screen.getByRole('radio', {name: 'Bar'}));
            expect(setConfig.mock.lastCall[0].chart.inverted).toBe(true);
        });
    });
});

//------------------
// Helpers
//------------------
const DEFAULTS = {...ChatUiChart.defaults};

function chartRequest(): ChatChartRequest {
    const registry = new ChatArtifactRegistry({
        artifacts: [
            {
                id: 'pnl',
                columns: [
                    {name: 'day', type: 'string'},
                    {name: 'daily', type: 'number'},
                    {name: 'cum', type: 'number'}
                ],
                rows: [
                    {day: 'Mon', daily: 1, cum: 1},
                    {day: 'Tue', daily: -2, cum: -1}
                ],
                totalRows: 2
            }
        ]
    });
    onTestFinished(() => registry.destroy());
    return {
        type: 'chart',
        artifactId: 'pnl',
        view: {type: 'line', x: 'day', y: ['daily', 'cum']},
        registry,
        title: 'P&L'
    };
}

function textRegistry(): ChatArtifactRegistry {
    const ret = new ChatArtifactRegistry({
        artifacts: [
            {
                id: 'traders',
                columns: [
                    {name: 'trader', type: 'string'},
                    {name: 'desk', type: 'string'}
                ],
                rows: [{trader: 'J. Ortega', desk: 'Rates'}],
                totalRows: 1
            }
        ]
    });
    onTestFinished(() => ret.destroy());
    return ret;
}

class NoopResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
}

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

function renderInHost(content: ReactElement, opts: {sidePanel?: ChatSidePanelModel} = {}) {
    const model = new ChatModel({transport: new ScriptedChatTransport()});
    onTestFinished(() => model.destroy());
    const inChat = chatHost({model, item: content});
    return render(opts.sidePanel ? sidePanelHost({model: opts.sidePanel, item: inChat}) : inChat);
}
