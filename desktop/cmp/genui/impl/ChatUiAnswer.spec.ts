import {act, fireEvent, render, screen} from '@testing-library/react';
import {wait} from '@xh/hoist/promise';
import {initTestAppAsync} from '@xh/hoist/test-support';
import {fragment} from '@xh/hoist/cmp/layout';
import {isArray} from 'lodash';
import type {ReactElement} from 'react';
import {beforeAll, describe, expect, it, onTestFinished, vi} from 'vitest';
import {BlueprintModel, DataCatalog, degradeAnswer} from '../../../../blueprint';
import {ChatUiCatalog} from '../../../../genui';
import {AnswerLoadGate} from '../../../../genui/impl/AnswerLoadGate';
import {toAnswerBlueprint} from '../../../../genui/impl/answerBlueprint';
import {ChartWidgetModel} from '../../blueprint/ChartWidget';
import {BlueprintViewModel} from '../../blueprint/impl/BlueprintViewModel';
import {chatUiChartSpec} from '../ChatUiChart';
import {answerLoadBar, toChatChartProps} from './ChatUiAnswer';
import {toHighchartsConfig, toSeries} from './ChatUiChartData';

/**
 * A chart in an answer lives in a source, and its card hands chat kit's chart the same series and
 * axes as the props the model wrote.
 */
describe('a chart in an answer', () => {
    beforeAll(async () => {
        await initTestAppAsync();
    });

    const catalog = new ChatUiCatalog({components: [chatUiChartSpec()]}),
        dataCatalog = new DataCatalog({datasets: {}});

    function cardProps(props: object, isPartial = false) {
        const partialIds = isPartial ? ['c'] : [],
            translated = toAnswerBlueprint(
                {root: 'c', elements: {c: {component: 'chart', props}}} as any,
                {
                    partialIds,
                    isValid: (name, p, partial) =>
                        !catalog.validate(name, p, {isPartial: partial}).length
                }
            ),
            blueprint = degradeAnswer(translated, {
                catalog: dataCatalog,
                registry: catalog.registry,
                isAnswer: true,
                isComplete: !isPartial,
                partialIds,
                trimInlineRows: false
            }),
            model = new BlueprintModel({
                blueprint,
                catalog: dataCatalog,
                registry: catalog.registry,
                dataProvider: null,
                isAnswer: true
            }),
            chart = new ChartWidgetModel({
                blueprintModel: model,
                id: 'c',
                renderElement: () => null
            });
        onTestFinished(() => {
            chart.destroy();
            model.destroy();
        });
        expect(blueprint.elements.c.component).toBe('chart');
        return toChatChartProps(chart, isPartial);
    }

    // The config as JSON, with each label formatter's output for a few values in its place.
    function configOf(props: any) {
        const config = toHighchartsConfig(props),
            format = config.yAxis.labels.formatter;
        return {
            json: JSON.parse(JSON.stringify(config)),
            labels: [0, 1234.5, -98765, 0.25].map(value => String(format.call({value})))
        };
    }

    it.each([
        [
            'a category chart, with series of different lengths',
            {
                title: 'Monthly revenue',
                type: 'column',
                xAxis: {categories: ['Mar', 'Jan', 'Feb']},
                yAxis: {title: 'USD', format: 'currency', decimals: 0},
                series: [
                    {name: 'Revenue', data: [231000, 182000, 205000]},
                    {name: 'Cost', data: [90000, 80000]}
                ]
            }
        ],
        [
            'a datetime chart, with series on different dates',
            {
                type: 'line',
                xAxis: {type: 'datetime', title: 'Day'},
                yAxis: {format: 'percent'},
                series: [
                    {
                        name: 'A',
                        data: [
                            ['2026-11-17', 0.1],
                            ['2026-11-18', 0.2],
                            ['2026-11-19', 0.15]
                        ]
                    },
                    {
                        name: 'B',
                        data: [['2026-11-18', 0.3]]
                    }
                ]
            }
        ],
        [
            'a pie of named slices',
            {
                type: 'pie',
                series: [
                    {
                        name: 'Share',
                        data: [
                            ['Equities', 60],
                            ['Bonds', 30],
                            ['Cash', 10]
                        ]
                    }
                ]
            }
        ]
    ])('hands chat kit the same series and axes for %s', (_, props: any) => {
        // Mid-stream, the last point of the last series may be cut short, as a date can be.
        const last = props.series.at(-1),
            cut = isArray(last.data[0]) ? [String(last.data[0][0]).slice(0, 6), 1] : 1,
            streamingProps = {
                ...props,
                series: [...props.series.slice(0, -1), {...last, data: [...last.data, cut]}]
            };
        expect(toSeries(cardProps(streamingProps, true), true)).toEqual(
            toSeries(streamingProps, true)
        );

        const card = cardProps(props);
        expect(toSeries(card, false)).toEqual(toSeries(props, false));
        expect(configOf(card)).toEqual(configOf(props));
        expect(card.title).toEqual(props.title);
    });

    it("formats the y axis by its field's kind, with the kind's base and its decimals", () => {
        const withKinds = new DataCatalog({
                datasets: {},
                kinds: {chance: {base: 'fraction', format: {precision: 0}}}
            }),
            model = new BlueprintModel({
                blueprint: {
                    sources: {
                        rain: {
                            inline: {
                                fields: [
                                    {name: 'hour', type: 'string', isDimension: true},
                                    {name: 'p', type: 'number', kind: 'chance'}
                                ],
                                rows: [{hour: '9am', p: 0.4}]
                            }
                        }
                    },
                    root: 'c',
                    elements: {
                        c: {
                            component: 'chart',
                            config: {source: 'rain', type: 'column', x: 'hour', y: ['p']}
                        }
                    }
                },
                catalog: withKinds,
                registry: catalog.registry,
                dataProvider: null,
                isAnswer: true
            }),
            chart = new ChartWidgetModel({
                blueprintModel: model,
                id: 'c',
                renderElement: () => null
            });
        onTestFinished(() => {
            chart.destroy();
            model.destroy();
        });
        expect(toChatChartProps(chart).yAxis).toMatchObject({format: 'percent', decimals: 0});
    });

    describe('the load bar', () => {
        const REQ = {dataset: 'positions', params: {}, fields: [], groupBy: []};

        function gateFor(isLatest: boolean, maxLoadsPerMinute = 60) {
            const loadAsync = vi.fn(async () => ({rows: []})),
                chatModel = {
                    messages: [
                        {id: 'a1', role: 'assistant'},
                        ...(isLatest ? [] : [{id: 'a2', role: 'assistant'}])
                    ]
                } as any,
                gate = new AnswerLoadGate({
                    provider: {loadAsync},
                    chatModel,
                    messageId: 'a1',
                    maxLoadsPerMinute
                });
            onTestFinished(() => gate.destroy());
            return {gate, loadAsync};
        }

        it('says that an earlier reply waits, and loads it when the user asks', async () => {
            const {gate, loadAsync} = gateFor(false);
            gate.loadAsync(REQ);
            await wait();
            render(answerLoadBar({gate}));
            expect(screen.getByText('Data from an earlier reply.')).toBeTruthy();

            fireEvent.click(screen.getByText('Load current data'));
            await vi.waitFor(() => expect(loadAsync).toHaveBeenCalledOnce());
        });

        it('says that the chat is past its loads for the minute, and retries once it is up', async () => {
            vi.useFakeTimers({now: 0, toFake: ['setTimeout', 'Date']});
            onTestFinished(() => {
                vi.useRealTimers();
            });
            const {gate, loadAsync} = gateFor(true, 1);
            gate.loadAsync(REQ);
            gate.loadAsync(REQ);
            render(answerLoadBar({gate}));
            const retry = screen.getByText('Retry').closest('button');
            expect(retry.disabled).toBe(true);

            act(() => vi.advanceTimersByTime(60_000));
            expect(retry.disabled).toBe(false);
            fireEvent.click(retry);
            expect(loadAsync).toHaveBeenCalledTimes(2);
        });
    });
});

/**
 * A flat grid in an answer draws as chat kit's grid card. A grid that names no columns shows the
 * columns its source's rows hold, rather than claiming its data is gone.
 */
describe('a grid in an answer', () => {
    beforeAll(async () => {
        await initTestAppAsync();
    });

    it("shows its source's columns when it names none", async () => {
        const catalog = new ChatUiCatalog({components: [chatUiChartSpec()]}),
            model = new BlueprintModel({
                blueprint: {
                    sources: {
                        movers: {
                            inline: {
                                fields: [
                                    {name: 'symbol', type: 'string', isDimension: true},
                                    {name: 'pnlDay', type: 'number'}
                                ],
                                rows: [
                                    {symbol: 'NVDA', pnlDay: -120},
                                    {symbol: 'AAPL', pnlDay: -45}
                                ]
                            }
                        }
                    },
                    root: 'grid',
                    elements: {grid: {component: 'cubeGrid', config: {source: 'movers'}}}
                },
                catalog: new DataCatalog({datasets: {}}),
                registry: catalog.registry,
                dataProvider: null,
                isAnswer: true,
                defaultPresentation: 'card'
            }),
            viewModel = new BlueprintViewModel(model);
        onTestFinished(() => {
            viewModel.destroy();
            model.destroy();
        });
        const {container} = render(fragment(viewModel.renderElement('grid')) as ReactElement);
        await vi.waitFor(() => expect(container.textContent).toContain('NVDA'));
        expect(container.textContent).not.toContain('no longer available');
    });
});
