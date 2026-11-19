import {initTestAppAsync} from '@xh/hoist/test-support';
import {beforeAll, describe, expect, it, onTestFinished} from 'vitest';
import {BlueprintModel, DataCatalog, degradeAnswer} from '../../../../blueprint';
import {ChatUiCatalog} from '../../../../genui';
import {toAnswerBlueprint} from '../../../../genui/impl/answerBlueprint';
import {ChartWidgetModel} from '../../blueprint/ChartWidget';
import {chatUiChartSpec} from '../ChatUiChart';
import {toChatChartProps} from './ChatUiAnswer';
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

    function cardProps(props: object) {
        const translated = toAnswerBlueprint(
                {root: 'c', elements: {c: {component: 'chart', props}}} as any,
                {isValid: (name, p, isPartial) => !catalog.validate(name, p, {isPartial}).length}
            ),
            blueprint = degradeAnswer(translated, {
                catalog: dataCatalog,
                registry: catalog.registry,
                isAnswer: true,
                isComplete: true
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
        return toChatChartProps(chart);
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
                    {name: 'B', data: [['2026-11-18', 0.3]]}
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
        const card = cardProps(props);
        expect(toSeries(card, false)).toEqual(toSeries(props, false));
        expect(configOf(card)).toEqual(configOf(props));
        expect(card.title).toEqual(props.title);
    });
});
