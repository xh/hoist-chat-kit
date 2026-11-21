import {fireEvent, render, screen} from '@testing-library/react';
import type {ReactElement} from 'react';
import {ChartModel} from '@xh/hoist/cmp/chart';
import {fragment} from '@xh/hoist/cmp/layout';
import {hoistCmp, type HoistProps, uses} from '@xh/hoist/core';
import {runInAction} from '@xh/hoist/mobx';
import {initTestAppAsync} from '@xh/hoist/test-support';
import {beforeAll, beforeEach, describe, expect, it, onTestFinished, vi} from 'vitest';
import {ChatModel} from '../../../core';
import {type ChatUiAction, ChatUiCatalog, type ChatUiRenderContext} from '../../../genui';
import {ScriptedChatTransport} from '../../../transport';
import {chatUiCard} from './ChatUiCard';
import {chatUiChart, type ChatUiChartProps} from './ChatUiChart';
import {chatUiStatCardsSpec, type ChatUiStatCardsSpecProps} from './ChatUiStatCards';
import {chatUiStackSpec} from './ChatUiStack';
import {chatUiTextSpec} from './ChatUiText';

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

    describe('chatUiStatCardsSpec', () => {
        const renderStatCards = (props: ChatUiStatCardsSpecProps, isPartial = false) =>
            render(
                chatUiStatCardsSpec().render(props, {
                    isPartial
                } as ChatUiRenderContext) as ReactElement
            );

        it('renders a Hoist StatCard for each figure, in a StatCardStrip', () => {
            const {container} = renderStatCards({
                cards: [
                    {label: 'Revenue', value: 12},
                    {label: 'Status', value: 'On track', intent: 'success'}
                ]
            });

            const strip = container.querySelector('.xh-stat-card-strip.xh-chat-ui-stat-cards'),
                cards = strip.querySelectorAll('.xh-stat-card');
            expect(cards).toHaveLength(2);
            expect(cards[0].querySelector('.xh-stat-card__title').textContent).toBe('Revenue');
            expect(cards[1].querySelector('.xh-stat-card__value-primary').textContent).toBe(
                'On track'
            );
            expect(cards[1].className).toContain('xh-stat-card--intent-success');
        });

        it('shows a large value in a compact form, with the full value in a tooltip', () => {
            renderStatCards({
                cards: [{label: 'Market cap', value: 48500000000, format: 'currency'}]
            });

            expect(screen.getByText('$48.5B').getAttribute('title')).toBe('$48,500,000,000.00');
        });

        it('shows only complete figures while the props stream', () => {
            renderStatCards(
                {
                    cards: [
                        {label: 'Revenue', value: 12},
                        {label: 'Margin', value: 0.3}
                    ]
                },
                true
            );

            expect(screen.getByText('Revenue')).toBeTruthy();
            expect(screen.queryByText('Margin')).toBeNull();
        });

        it('colors only the delta, with an arrow, and flips the colors with invert', () => {
            const {container} = renderStatCards({
                cards: [
                    {label: 'P&L', value: 4820000, delta: 1100000, deltaLabel: 'vs last week'},
                    {label: 'VaR', value: 6100000, delta: 400000, invert: true}
                ]
            });

            const [pnl, risk] = container.querySelectorAll(
                '.xh-stat-card__sub-value [role="img"] > span'
            );
            expect(pnl.className).toContain('xh-pos-val');
            expect(risk.className).toContain('xh-neg-val');
            expect(pnl.textContent).toBe('▴1.1M');
            expect(container.querySelector('.xh-stat-card__value-primary .xh-pos-val')).toBeNull();
            expect(container.querySelector('.xh-stat-card__detail').textContent).toBe(
                'vs last week'
            );
        });

        it('says which way each delta moved in words, for a screen reader', () => {
            const {container} = renderStatCards({
                cards: [
                    {label: 'Revenue', value: 1250000, delta: 0.012, deltaFormat: 'percent'},
                    {label: 'VaR', value: 6100000, delta: -400000, invert: true},
                    {label: 'Desks', value: 6, delta: 0}
                ]
            });

            const names = screen.getAllByRole('img').map(it => it.getAttribute('aria-label'));
            expect(names).toEqual(['up 1.2%', 'down 400K', 'unchanged']);
            // StatCard shows a cut-off delta's text in a tooltip, which holds no words.
            expect(container.querySelector('.xh-stat-card__sub-value').textContent).toBe('▴1.2%');
        });

        it('draws a trend as a Hoist Sparkline under the value, after the label of the delta', () => {
            const {container} = renderStatCards({
                cards: [
                    {
                        label: 'Revenue',
                        value: 1250000,
                        format: 'currency',
                        delta: 0.04,
                        deltaFormat: 'percent',
                        deltaLabel: 'vs Q2',
                        trend: [900000, 1100000, 1250000]
                    },
                    {label: 'Margin', value: 0.18, format: 'percent', trend: [0.2, 0.18]}
                ]
            });
            const [revenue, margin] = container.querySelectorAll('.xh-stat-card__detail');

            expect(revenue.textContent).toBe('vs Q2');
            expect(revenue.querySelector('.xh-sparkline').getAttribute('aria-label')).toBe(
                'Revenue trend: 3 values, from $900K to $1.25M'
            );
            expect(margin.querySelector('.xh-sparkline')).toBeTruthy();
            expect(margin.textContent).toBe('');
            // The trend has no color of its own. Only the delta has.
            expect(container.querySelector('.xh-sparkline--positive')).toBeNull();
            expect(container.querySelector('.xh-sparkline--negative')).toBeNull();
        });

        it('draws no trend for fewer than two numbers, and keeps the label of the delta', () => {
            const {container} = renderStatCards({
                cards: [
                    {label: 'Revenue', value: 12, deltaLabel: 'vs Q2', trend: [5]},
                    {label: 'Margin', value: 3, trend: ['up', null, 4] as any},
                    {label: 'Cost', value: 3, trend: 'rising' as any}
                ]
            });

            expect(container.querySelector('.xh-sparkline')).toBeNull();
            expect(container.querySelectorAll('.xh-stat-card__detail')).toHaveLength(1);
            expect(container.querySelector('.xh-stat-card__detail').textContent).toBe('vs Q2');
        });
    });

    describe('ChatUiStack', () => {
        const catalog = new ChatUiCatalog({components: [chatUiStackSpec(), chatUiTextSpec()]}),
            context = {chatModel: null as ChatModel, messageId: 'm1'},
            doc = (props: object) => ({
                root: 'top',
                elements: {
                    top: {component: 'stack', props, children: ['a', 'b']},
                    a: {component: 'text', props: {text: 'First'}},
                    b: {component: 'text', props: {text: 'Second'}}
                }
            }),
            renderDoc = (props: object) =>
                renderInChat(
                    fragment({
                        children: catalog.renderDocument(doc(props), {
                            ...context,
                            part: {type: 'data', id: 'd1', dataType: 'xh.chat.ui', data: null},
                            isPartial: false
                        })
                    })
                );

        it('renders its children in a column by default, and in a row on request', () => {
            const {container, unmount} = renderDoc({});
            const stack = container.querySelector('.xh-chat-ui-stack');
            expect(stack.className).toContain('xh-chat-ui-stack--medium');
            expect(stack.className).toContain('xh-vbox');
            expect(stack.textContent).toBe('FirstSecond');
            unmount();

            const row = renderDoc({direction: 'row', gap: 'large'}).container.querySelector(
                '.xh-chat-ui-stack'
            );
            expect(row.className).toContain('xh-hbox');
            expect(row.className).toContain('xh-chat-ui-stack--large');
        });

        it('shows its title in a frame', () => {
            const {container} = renderDoc({title: 'Summary'});
            expect(container.querySelector('.xh-chat-ui-frame__header').textContent).toBe(
                'Summary'
            );
            expect(container.querySelector('.xh-chat-ui-frame .xh-chat-ui-stack')).toBeTruthy();
        });

        it('is a container with a default slot, and lists it in the document prompt', () => {
            const spec = chatUiStackSpec();
            expect(spec.slots).toEqual(['default']);
            expect(spec.props.additionalProperties).toBe(false);
            expect(spec.props.properties.direction.enum).toEqual(['column', 'row']);
            expect(spec.props.properties.gap.enum).toEqual(['none', 'small', 'medium', 'large']);
            expect(catalog.toPrompt({modes: ['document']})).toContain('stack');
            expect(catalog.validate('stack', {gap: 'huge'})).not.toEqual([]);
        });

        it('shows only inside a document, as does the text component', () => {
            const all = new ChatUiCatalog({
                components: [chatUiStackSpec(), chatUiTextSpec()],
                modes: ['tools', 'tags', 'document']
            });

            expect(chatUiStackSpec().standalone).toBe(false);
            expect(chatUiTextSpec().standalone).toBe(false);
            expect(all.toToolSchemas().map(it => it.name)).toEqual(['show_ui']);
            expect(all.instructions).not.toContain('ui-stack');
            expect(all.parseText('<ui-text text="Hi"/>')[0]).toMatchObject({
                type: 'fallback',
                errors: ["'text' shows only inside a document"]
            });
        });

        it('describes itself by its title, and adds no line to copied text without one', () => {
            const spec = chatUiStackSpec();
            expect(spec.result({title: 'Summary'})).toBe('Summary');
            expect(spec.result({})).toBe('');
            expect(
                catalog.toCopyText([
                    {type: 'document', document: doc({}), isPartial: false, source: ''}
                ])
            ).toBe('First\nSecond');
        });
    });

    describe('ChatUiText', () => {
        const spec = chatUiTextSpec(),
            context = (isPartial: boolean) => ({isPartial}) as any;

        it('renders its text as markdown, streaming while partial', () => {
            const {container} = renderInChat(
                fragment({children: spec.render({text: 'Some **bold**'}, context(true))})
            );
            expect(container.querySelector('.xh-chat-ui-text strong').textContent).toBe('bold');
            expect(container.querySelector('.xh-chat-markdown--streaming')).toBeTruthy();
        });

        it('returns its text as the result, and refuses text over maxLength', () => {
            const short = chatUiTextSpec({maxLength: 10}),
                catalog = new ChatUiCatalog({components: [short]});
            expect(short.result({text: 'Hello'})).toBe('Hello');
            expect(catalog.validate('text', {text: 'Hello'})).toEqual([]);
            expect(catalog.validate('text', {text: 'Hello there, friend'})).not.toEqual([]);
            expect(chatUiTextSpec().props.properties.text.maxLength).toBe(2000);
        });
    });

    describe('ChatUiCard', () => {
        const send: ChatUiAction = {
                type: 'send',
                label: 'Show trades',
                text: 'Show my open trades with Acme Corp.'
            },
            open: ChatUiAction = {
                type: 'openUrl',
                label: 'Open report',
                url: 'https://example.com/report'
            };

        it('renders a Hoist Card, with the title and subtitle in its header', () => {
            const {container} = render(
                    chatUiCard({
                        title: 'Acme Corp',
                        subtitle: 'Counterparty - Tier 1',
                        fields: [],
                        chatModel: null,
                        runActionAsync: vi.fn()
                    })
                ),
                card = container.querySelector('fieldset.xh-card.xh-chat-ui-card');

            expect(card.querySelector('legend .xh-chat-ui-card__title').textContent).toBe(
                'Acme Corp'
            );
            expect(card.querySelector('legend .xh-chat-ui-card__subtitle').textContent).toBe(
                'Counterparty - Tier 1'
            );
            // A record card does not collapse, so its header is not a button.
            expect(screen.queryByRole('button')).toBeNull();
        });

        it('shows fields in a Hoist PropertyTable, each number in its format', () => {
            const {container} = render(
                chatUiCard({
                    title: 'Acme Corp',
                    fields: [
                        {label: 'Exposure', value: 4200000, format: 'currency', decimals: 0},
                        {label: 'Rating', value: 'A+'},
                        {label: 'Owner', value: ' '}
                    ],
                    chatModel: null,
                    runActionAsync: vi.fn()
                })
            );

            expect(container.querySelector('.xh-card__content .xh-property-table')).toBeTruthy();
            expect(texts(container, '.xh-property-table__label')).toEqual([
                'Exposure',
                'Rating',
                'Owner'
            ]);
            expect(texts(container, '.xh-property-table__value')).toEqual([
                '$4,200,000',
                'A+',
                '-'
            ]);
        });

        it('leaves out the last field while streaming, and holds its place until one arrives', () => {
            const props = {title: 'Acme', chatModel: null as ChatModel, runActionAsync: vi.fn()},
                {container, rerender} = render(
                    chatUiCard({...props, fields: [{label: 'Exp', value: 4}], isPartial: true})
                );
            expect(container.querySelector('.xh-property-table')).toBeNull();
            expect(container.querySelector('.xh-card__content .xh-chat-ui-skeleton')).toBeTruthy();

            rerender(
                chatUiCard({
                    ...props,
                    fields: [
                        {label: 'Exposure', value: 42},
                        {label: 'Rat', value: 'A'}
                    ],
                    isPartial: true
                })
            );
            expect(container.querySelector('.xh-chat-ui-skeleton')).toBeNull();
            expect(texts(container, '.xh-property-table__label')).toEqual(['Exposure']);
        });

        it('shows actions as chips in a row at the foot of the card, under its fields', () => {
            const chatModel = createChatModel(),
                {container} = render(
                    chatUiCard({
                        title: 'Acme Corp',
                        fields: [{label: 'Rating', value: 'A+'}],
                        actions: [send],
                        chatModel,
                        runActionAsync: vi.fn()
                    })
                ),
                chip = screen.getByRole('button', {name: 'Show trades'}),
                content = container.querySelector('.xh-chat-ui-card .xh-card__content');

            expect(chip.className).toContain('xh-chat-ui-card__action');
            expect(chip.parentElement.className).toBe('xh-chat-ui-card__actions');
            expect(content.lastElementChild).toBe(chip.parentElement);
            expect(content.firstElementChild.className).toContain('xh-property-table');
        });

        it('runs the clicked action, and describes it in the tooltip', () => {
            const chatModel = createChatModel(),
                runActionAsync = vi.fn().mockResolvedValue(null);
            render(
                chatUiCard({
                    title: 'Acme Corp',
                    fields: [],
                    actions: [send],
                    chatModel,
                    runActionAsync
                })
            );

            fireEvent.click(screen.getByRole('button', {name: 'Show trades'}));

            expect(runActionAsync).toHaveBeenCalledExactlyOnceWith(send);
        });

        it('disables actions that message the chat while it is busy, and all while streaming', () => {
            const chatModel = createChatModel(),
                runActionAsync = vi.fn(),
                props = {
                    title: 'Acme Corp',
                    fields: [],
                    actions: [send, open],
                    chatModel,
                    runActionAsync
                },
                {rerender} = render(chatUiCard({...props, isPartial: true}));
            expect(screen.queryByRole('button', {name: 'Show trades'})).toBeNull();

            runInAction(() => (chatModel.status = 'streaming'));
            rerender(chatUiCard(props));

            const sendButton = screen.getByRole('button', {
                    name: 'Show trades'
                }) as HTMLButtonElement,
                openButton = screen.getByRole('button', {name: 'Open report'}) as HTMLButtonElement;
            expect(sendButton.disabled).toBe(true);
            expect(openButton.disabled).toBe(false);
        });

        it('hides actions that message the chat where it shows without a ChatModel', () => {
            render(
                chatUiCard({
                    title: 'Acme Corp',
                    fields: [],
                    actions: [send, open],
                    chatModel: null,
                    runActionAsync: vi.fn()
                })
            );

            expect(screen.queryByRole('button', {name: 'Show trades'})).toBeNull();
            expect(screen.getByRole('button', {name: 'Open report'})).toBeTruthy();
        });

        it('disables actions that message the chat while sends are blocked, and says why', () => {
            const chatModel = createChatModel(),
                runActionAsync = vi.fn();
            chatModel.addSendBlocker(() => 'Choose a document first.');
            render(
                chatUiCard({
                    title: 'Acme Corp',
                    fields: [],
                    actions: [send, open],
                    chatModel,
                    runActionAsync
                })
            );

            const sendButton = screen.getByRole('button', {
                    name: 'Show trades'
                }) as HTMLButtonElement,
                openButton = screen.getByRole('button', {name: 'Open report'}) as HTMLButtonElement;
            expect(sendButton.disabled).toBe(true);
            expect(openButton.disabled).toBe(false);
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
    render: ({children}) => fragment({children})
});

function renderInChat(content: ReactElement) {
    const model = createChatModel(),
        inChat = (it: ReactElement) => chatHost({model, children: it}),
        result = render(inChat(content));
    return {...result, rerender: (it: ReactElement) => result.rerender(inChat(it))};
}

function createChatModel(): ChatModel {
    const model = new ChatModel({transport: new ScriptedChatTransport()});
    onTestFinished(() => model.destroy());
    return model;
}

function texts(container: HTMLElement, selector: string): string[] {
    return [...container.querySelectorAll(selector)].map(it => it.textContent);
}
