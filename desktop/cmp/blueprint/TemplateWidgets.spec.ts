import {render, screen, waitFor} from '@testing-library/react';
import {autorun} from '@xh/hoist/mobx';
import {initTestAppAsync} from '@xh/hoist/test-support';
import {beforeAll, describe, expect, it, onTestFinished} from 'vitest';
import {portfolioCatalog, scenarioRegistry} from '../../../test/blueprintFixtures';
import {
    type Blueprint,
    type BlueprintDataRequest,
    type BlueprintDataUpdate,
    type BlueprintElement,
    BlueprintModel
} from '../../../blueprint';
import {blueprintView} from './BlueprintView';
import {MarkdownWidgetModel} from './MarkdownWidget';

/**
 * `markdown` and `callout` render text whose references read variables and the root aggregates of
 * any source. A value shows as `…` until its source has loaded, and goes in as text after the
 * markdown is parsed, so data cannot change the markdown around it or become a link.
 */
describe('template widgets', () => {
    beforeAll(async () => {
        await initTestAppAsync();
    });

    const ROWS: Record<string, object[]> = {
        positions: [
            {id: 'a', mktVal: 1_500_000},
            {id: 'b', mktVal: 2_000_000}
        ],
        orders: [
            {id: 'x', quantity: 7},
            {id: 'y', quantity: 7}
        ]
    };

    /** A provider that pushes a dataset's rows only when the test says. */
    function provider() {
        const pushes: Record<string, (u: BlueprintDataUpdate) => void> = {};
        return {
            loadAsync: async () => ({rows: []}),
            subscribe(req: BlueprintDataRequest, push: (u: BlueprintDataUpdate) => void) {
                pushes[req.dataset] = push;
                return () => {};
            },
            send: async (dataset: string) => {
                await waitFor(() => expect(pushes[dataset]).toBeTruthy());
                pushes[dataset]({replace: ROWS[dataset]});
            }
        };
    }

    function show(el: BlueprintElement, dataProvider = provider()) {
        const blueprint: Blueprint = {
                schema: {blueprint: 1},
                variables: {
                    asOf: {type: 'localDate', setBy: 'prompt', default: {value: '2026-03-02'}},
                    fund: {type: 'string', setBy: 'prompt', default: {value: 'Oak *Mount*'}},
                    note: {
                        type: 'string',
                        setBy: 'prompt',
                        default: {value: '[Log in](https://evil.example)'}
                    },
                    picked: {type: 'string', setBy: 'prompt'}
                },
                sources: {
                    positions: {dataset: 'positions', params: {asOf: {$var: 'asOf'}}},
                    orders: {dataset: 'orders', params: {asOf: {$var: 'asOf'}}}
                },
                root: 'note',
                elements: {note: el}
            },
            model = new BlueprintModel({
                blueprint,
                catalog: portfolioCatalog,
                registry: scenarioRegistry(),
                dataProvider,
                mode: 'run'
            });
        onTestFinished(() => model.destroy());
        return {model, dataProvider, ...render(blueprintView({model}))};
    }

    const textOf = (container: HTMLElement) =>
        container.querySelector('.xh-chat-markdown')?.textContent;

    it('fills variables and each source total, with … until that source loads', async () => {
        const {container, dataProvider} = show({
            component: 'markdown',
            config: {
                source: 'positions',
                text: 'Fund {fund}: {mktVal} across {orders.quantity} shares.'
            }
        });
        expect(textOf(container)).toBe('Fund Oak *Mount*: … across … shares.');
        expect(container.querySelector('em')).toBeNull();

        await dataProvider.send('positions');
        await waitFor(() => expect(textOf(container)).not.toContain(': …'));
        expect(textOf(container)).toBe('Fund Oak *Mount*: 3.5m across … shares.');

        await dataProvider.send('orders');
        await waitFor(() => expect(textOf(container)).not.toContain('…'));
        expect(textOf(container)).toMatch(/across 7 shares\.$/);
    });

    it('shows … again while its source loads for a new request', async () => {
        const {model, container, dataProvider} = show({
            component: 'markdown',
            config: {source: 'positions', text: 'Total {mktVal}'}
        });
        await dataProvider.send('positions');
        await waitFor(() => expect(textOf(container)).toBe('Total 3.5m'));
        model.setVariable('asOf', '2026-03-03');
        await waitFor(() => expect(textOf(container)).toBe('Total …'));
        await dataProvider.send('positions');
        await waitFor(() => expect(textOf(container)).toBe('Total 3.5m'));
    });

    it('renders markdown around the values, and each value as text, never as markdown', () => {
        const {container} = show({
            component: 'markdown',
            config: {text: '**Note:** {note} [XH](https://xh.io)'}
        });
        expect(container.querySelector('strong').textContent).toBe('Note:');
        expect(
            [...container.querySelectorAll('a')].map(it => [
                it.textContent,
                it.getAttribute('href')
            ])
        ).toEqual([['XH', 'https://xh.io']]);
        expect(textOf(container)).toBe('Note: [Log in](https://evil.example) XH');
    });

    it('keeps its markdown props while its text and values hold, so the markdown parses again only then', () => {
        const {model} = show({component: 'markdown', config: {text: 'Fund: {fund}'}}),
            note = new MarkdownWidgetModel({
                blueprintModel: model,
                id: 'note',
                renderElement: () => null
            });
        onTestFinished(() => note.destroy());
        let props = null;
        const dispose = autorun(() => (props = note.markdownProps('Fund: {fund}')));
        onTestFinished(dispose);
        const first = props;
        expect(note.markdownProps('Fund: {fund}').markdownPlugins).toBe(first.markdownPlugins);
        model.setVariable('fund', 'Elm');
        expect(props.markdownPlugins).not.toBe(first.markdownPlugins);
        // A text still streaming in may not be there yet.
        expect(note.markdownProps(undefined).content).toBe('');
    });

    it('renders nothing for a template whose every reference is empty', () => {
        const {container} = show({
            component: 'markdown',
            config: {text: '**{picked}** in {picked}'}
        });
        expect(textOf(container) ?? '').toBe('');
        expect(container.querySelector('strong')).toBeNull();
    });

    it('keeps the text of a template with any reference filled', () => {
        const {container} = show({
            component: 'markdown',
            config: {text: '{fund}: {picked}'}
        });
        expect(textOf(container)).toBe('Oak *Mount*: ');
    });

    it('draws a callout with its intent and title over its text', async () => {
        const {container} = show({
            component: 'callout',
            config: {intent: 'warning', title: 'Check {fund}', text: 'Positions as of {asOf}.'}
        });
        const callout = container.querySelector('.xh-callout');
        expect(callout.className).toContain('warning');
        expect(screen.getByText('Check Oak *Mount*')).toBeTruthy();
        expect(textOf(container)).toMatch(/^Positions as of .*2026.*\.$/);
    });
});
