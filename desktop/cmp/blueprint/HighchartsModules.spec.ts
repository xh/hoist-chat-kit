import {render} from '@testing-library/react';
import {installHighcharts} from '@xh/hoist/kit/highcharts';
import {initTestAppAsync} from '@xh/hoist/test-support';
import {beforeAll, describe, expect, it, onTestFinished} from 'vitest';
import {type Blueprint, type BlueprintElement, BlueprintModel} from '../../../blueprint';
import {portfolioCatalog, scenarioRegistry} from '../../../test/blueprintFixtures';
import {blueprintView} from './BlueprintView';

/**
 * A widget names the Highcharts modules it needs. Where the app has not loaded one, it draws a
 * notice in its place, rather than a chart that fails.
 */
describe('Highcharts modules', () => {
    const seriesTypes: Record<string, object> = {};

    beforeAll(async () => {
        await initTestAppAsync();
        installHighcharts({version: '12.4.0', setOptions: () => {}, seriesTypes});
    });

    function show(el: BlueprintElement) {
        const blueprint: Blueprint = {
                schema: {blueprint: 1},
                variables: {
                    asOf: {type: 'localDate', setBy: 'prompt', default: {value: '2026-03-02'}}
                },
                sources: {positions: {dataset: 'positions', params: {asOf: {$var: 'asOf'}}}},
                root: 'el',
                elements: {el}
            },
            model = new BlueprintModel({
                blueprint,
                catalog: portfolioCatalog,
                registry: scenarioRegistry(),
                dataProvider: null,
                mode: 'run'
            });
        onTestFinished(() => model.destroy());
        return render(blueprintView({model})).container.textContent;
    }

    const heatmap = {
        component: 'heatmap',
        config: {source: 'positions', x: 'sector', y: 'strategy', value: 'pnlDay'}
    };

    it('draws a notice in place of a widget whose module the app has not loaded', () => {
        expect(show(heatmap)).toContain("needs Highcharts' heatmap module");
        seriesTypes.heatmap = {};
        onTestFinished(() => {
            delete seriesTypes.heatmap;
        });
        expect(show(heatmap)).not.toContain('needs Highcharts');
    });

    it('names every module a widget needs that the app lacks', () => {
        const treemap = {
            component: 'treemap',
            config: {source: 'positions', groupBy: ['sector'], value: 'mktVal'}
        };
        expect(show(treemap)).toContain("needs Highcharts' treemap and heatmap modules");
        seriesTypes.heatmap = {};
        onTestFinished(() => {
            delete seriesTypes.heatmap;
        });
        expect(show(treemap)).toContain("needs Highcharts' treemap module");
    });

    it("asks for a chart's module by its type", () => {
        const chart = (type: string) => ({
            component: 'chart',
            config: {source: 'positions', type, x: 'sector', y: ['pnlDay']}
        });
        expect(show(chart('waterfall'))).toContain("needs Highcharts' highcharts-more module");
        expect(show(chart('areaspline'))).not.toContain('needs Highcharts');
    });
});
