import {render} from '@testing-library/react';
import {TreeMapModel, type TreeMapTooltipFn} from '@xh/hoist/cmp/treemap';
import {Store} from '@xh/hoist/data';
import {initTestAppAsync} from '@xh/hoist/test-support';
import {beforeAll, describe, expect, it, onTestFinished, vi} from 'vitest';
import {ChatUiCatalog} from '../../../genui';
import {chatUiTreeMap, chatUiTreeMapSpec} from './ChatUiTreeMap';

/**
 * The treemap spec shows model-written boxes in Hoist's TreeMap. Apps rely on one TreeMapModel
 * and Store for the life of the component, loaded as the boxes stream in, on labels that
 * Highcharts cannot read as markup, and on a tooltip in the formats the model chose.
 */
describe('chatUiTreeMapSpec', () => {
    beforeAll(() => initTestAppAsync());

    // The app installs Highcharts. With none, Hoist's TreeMap logs an error and draws no boxes.
    const spyOnModels = () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => null),
            loadData = vi.spyOn(Store.prototype, 'loadData'),
            destroy = vi.spyOn(TreeMapModel.prototype, 'destroy');
        onTestFinished(() => [error, loadData, destroy].forEach(it => it.mockRestore()));
        return {loadData, destroy};
    };

    it('loads complete boxes into one Store as they stream, and destroys its models on unmount', async () => {
        const {loadData, destroy} = spyOnModels(),
            {container, rerender, unmount} = render(
                chatUiTreeMap({
                    title: 'Exposure',
                    nodes: [{label: 'Rates'} as any],
                    isPartial: true
                })
            );
        // The only box is still streaming, so there is nothing to draw yet.
        expect(container.querySelector('.xh-chat-ui-skeleton')).toBeTruthy();
        expect(container.querySelector('.xh-chat-ui-frame__header').textContent).toBe('Exposure');

        rerender(
            chatUiTreeMap({
                title: 'Exposure',
                nodes: [
                    {label: 'Rates', value: 42, heat: 0.01},
                    {label: 'Cred', value: 2}
                ],
                isPartial: true
            })
        );
        rerender(
            chatUiTreeMap({
                title: 'Exposure',
                nodes: [
                    {label: 'Rates', value: 42, heat: 0.01},
                    {label: 'Credit', value: 26}
                ]
            })
        );

        await vi.waitFor(() => expect(container.querySelector('.xh-chat-ui-skeleton')).toBeNull());
        expect(container.textContent).not.toContain('No values');
        expect(new Set(loadData.mock.contexts).size).toBe(1);
        expect(loadData.mock.calls.map(([rows]) => rows)).toEqual([
            [],
            [{id: 0, name: 'Rates', value: 42, heat: 0.01, color: 0.01}],
            [
                {id: 0, name: 'Rates', value: 42, heat: 0.01, color: 0.01},
                {id: 1, name: 'Credit', value: 26, heat: null, color: null}
            ]
        ]);

        expect(destroy).not.toHaveBeenCalled();
        unmount();
        expect(destroy).toHaveBeenCalledOnce();
    });

    it('escapes labels, which Highcharts reads as HTML', () => {
        const {loadData} = spyOnModels();
        render(chatUiTreeMap({nodes: [{label: '<img src="https://example.com/x">', value: 1}]}));

        expect(loadData.mock.calls.at(-1)[0][0].name).toBe(
            '&lt;img src=&quot;https://example.com/x&quot;&gt;'
        );
    });

    it('shows the value and the heat in the tooltip, in their formats and under the heat label', async () => {
        const {loadData} = spyOnModels(),
            processData = vi.spyOn(TreeMapModel.prototype, 'processAndSetData');
        onTestFinished(() => processData.mockRestore());
        render(
            chatUiTreeMap({
                format: 'currency',
                decimals: 0,
                heatLabel: 'Day <change>',
                heatFormat: 'percent',
                nodes: [
                    {label: 'Rates', value: 4200000, heat: 0.012},
                    {label: 'FX', value: 1100000}
                ]
            })
        );
        // The TreeMapModel reads its store after a short delay.
        await vi.waitFor(() => expect(processData).toHaveBeenCalled());

        const store = loadData.mock.contexts[0] as Store,
            treeMapModel = processData.mock.contexts[0] as TreeMapModel,
            tooltips = store.records.map(it => (treeMapModel.tooltip as TreeMapTooltipFn)(it));

        expect(tooltips[0]).toContain("<div class='xh-treemap-tooltip__label'>Rates</div>");
        expect(tooltips[0]).toContain('$4,200,000');
        expect(tooltips[0]).toContain('Day &lt;change&gt;:');
        expect(tooltips[0]).toContain('1.2%');
        // A box with no heat names none.
        expect(tooltips[1]).toContain('$1,100,000');
        expect(tooltips[1]).not.toContain('Day');
    });

    it('mounts the TreeMap with its data on the first render, with no empty box', () => {
        spyOnModels();
        const {container} = render(chatUiTreeMap({nodes: [{label: 'Rates', value: 42}]}));

        // Hoist's TreeMapModel reads the first records of its store at once.
        expect(container.textContent).toContain(NO_HIGHCHARTS);
        expect(container.querySelector('.xh-chat-ui-skeleton')).toBeNull();
        expect(container.querySelector('.xh-placeholder')).toBeNull();
    });

    it('says there is nothing to show when no complete box has a size', () => {
        spyOnModels();
        const nodes = [
                {label: 'Rates', value: 0},
                {label: 'Credit', value: 0}
            ],
            {container, rerender} = render(chatUiTreeMap({nodes, isPartial: true}));
        // More boxes may follow while the props stream.
        expect(container.querySelector('.xh-chat-ui-skeleton')).toBeTruthy();
        expect(container.querySelector('[role="note"]')).toBeNull();

        rerender(chatUiTreeMap({nodes}));
        expect(container.querySelector('.xh-chat-ui-skeleton')).toBeNull();
        expect(container.querySelector('.xh-treemap')).toBeNull();
        expect(container.querySelector('[role="note"]').textContent).toBe('No values to show.');
    });

    it('leaves every box neutral when all heats are zero, and still shows the heat', async () => {
        const {loadData} = spyOnModels(),
            processData = vi.spyOn(TreeMapModel.prototype, 'processAndSetData');
        onTestFinished(() => processData.mockRestore());
        render(
            chatUiTreeMap({
                nodes: [
                    {label: 'Rates', value: 42, heat: 0},
                    {label: 'Credit', value: 26, heat: 0}
                ],
                heatLabel: 'Day change',
                heatFormat: 'percent'
            })
        );
        await vi.waitFor(() => expect(processData).toHaveBeenCalled());

        // Hoist's TreeMap divides by the largest heat, so a zero scale gives no color at all.
        const treeMapModel = processData.mock.contexts[0] as TreeMapModel,
            store = loadData.mock.contexts[0] as Store;
        expect(loadData.mock.calls.at(-1)[0]).toEqual([
            {id: 0, name: 'Rates', value: 42, heat: 0, color: null},
            {id: 1, name: 'Credit', value: 26, heat: 0, color: null}
        ]);
        expect(treeMapModel.data.map(it => it.colorValue)).toEqual([0.5, 0.5]);
        expect((treeMapModel.tooltip as TreeMapTooltipFn)(store.records[0])).toContain(
            'Day change:'
        );
    });

    it('colors a zero heat as the least positive when another box has a heat', async () => {
        spyOnModels();
        const processData = vi.spyOn(TreeMapModel.prototype, 'processAndSetData');
        onTestFinished(() => processData.mockRestore());
        render(
            chatUiTreeMap({
                nodes: [
                    {label: 'Rates', value: 42, heat: 0},
                    {label: 'Credit', value: 26, heat: -0.02}
                ]
            })
        );
        await vi.waitFor(() => expect(processData).toHaveBeenCalled());

        const treeMapModel = processData.mock.contexts[0] as TreeMapModel;
        expect(treeMapModel.data.map(it => it.colorValue)).toEqual([0.6, 0]);
    });

    it('has a tool of its own, and bounds its boxes', () => {
        const spec = chatUiTreeMapSpec({maxNodes: 2}),
            catalog = new ChatUiCatalog({components: [spec]}),
            node = {label: 'Rates', value: 1};

        expect(catalog.toToolSchemas().map(it => it.name)).toEqual(['show_treemap']);
        expect(catalog.validate('treemap', {nodes: [node, node]})).toEqual([]);
        expect(catalog.validate('treemap', {nodes: [node, node, node]})).not.toEqual([]);
        expect(catalog.validate('treemap', {nodes: [{label: 'Rates', value: '1'}]})).not.toEqual(
            []
        );
        expect(catalog.validate('treemap', {nodes: [node], heatFormat: 'bps'})).not.toEqual([]);
        expect(catalog.validate('treemap', {title: 'No boxes'})).not.toEqual([]);
    });
});

//------------------
// Helpers
//------------------
// What Hoist's TreeMap renders in a test, where no app installed Highcharts. It marks the mount.
const NO_HIGHCHARTS = 'Highcharts not available';
