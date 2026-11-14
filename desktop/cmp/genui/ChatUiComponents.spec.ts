import {fireEvent, render, screen} from '@testing-library/react';
import type {ReactElement} from 'react';
import {ChartModel} from '@xh/hoist/cmp/chart';
import {fragment} from '@xh/hoist/cmp/layout';
import {hoistCmp, type HoistProps, uses} from '@xh/hoist/core';
import {runInAction} from '@xh/hoist/mobx';
import {initTestAppAsync} from '@xh/hoist/test-support';
import {beforeAll, beforeEach, describe, expect, it, onTestFinished, vi} from 'vitest';
import {ChatModel} from '../../../core';
import {type ChatUiAction, ChatUiCatalog} from '../../../genui';
import {ScriptedChatTransport} from '../../../transport';
import {chatUiCard} from './ChatUiCard';
import {chatUiChart, type ChatUiChartProps} from './ChatUiChart';
import {chatUiMetrics} from './ChatUiMetrics';
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
        it('colors only the delta, with an arrow, and flips the colors with invert', () => {
            const {container} = render(
                chatUiMetrics({
                    metrics: [
                        {label: 'P&L', value: 4820000, delta: 1100000, deltaLabel: 'vs last week'},
                        {label: 'VaR', value: 6100000, delta: 400000, invert: true}
                    ]
                })
            );

            const [pnl, risk] = container.querySelectorAll('.xh-chat-ui-metrics__change');
            expect(pnl.className).toContain('--pos');
            expect(risk.className).toContain('--neg');
            expect(pnl.querySelector('svg')).toBeTruthy();
        });

        it('reads each tile as its label, value and delta in words', () => {
            render(
                chatUiMetrics({
                    metrics: [{label: 'P&L', value: 4820000, delta: -1100000, deltaLabel: 'vs Q2'}]
                })
            );
            expect(screen.getByRole('listitem').getAttribute('aria-label')).toBe(
                'P&L, 4.82M, down 1.1M vs Q2'
            );
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
                        item: catalog.renderDocument(doc(props), {
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
                fragment({item: spec.render({text: 'Some **bold**'}, context(true))})
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

        it('shows actions as chips after the card, each with a tooltip of what it sends', () => {
            const chatModel = createChatModel(),
                {container} = render(
                    chatUiCard({
                        title: 'Acme Corp',
                        fields: [],
                        actions: [send],
                        chatModel,
                        runActionAsync: vi.fn()
                    })
                ),
                chip = screen.getByRole('button', {name: 'Show trades'});

            expect(chip.closest('.xh-chat-ui-frame')).toBeNull();
            expect(container.querySelector('.xh-chat-ui-frame__header').textContent).toBe(
                'Acme Corp'
            );
            expect(chip.className).toContain('xh-chat-ui-card__action');
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
