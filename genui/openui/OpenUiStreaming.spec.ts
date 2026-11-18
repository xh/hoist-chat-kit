import {render} from '@testing-library/react';
import {fragment} from '@xh/hoist/cmp/layout';
import {creates, hoistCmp, HoistModel} from '@xh/hoist/core';
import {initTestAppAsync} from '@xh/hoist/test-support';
import {beforeAll, beforeEach, describe, expect, it, vi} from 'vitest';
import {
    chatUiCardSpec,
    chatUiChartSpec,
    chatUiStatCardsSpec,
    chatUiStackSpec,
    chatUiTextSpec
} from '../../desktop/cmp/genui';
import {ChatUiCatalog} from '../ChatUiCatalog';
import type {ChatUiDocumentContext, ChatUiFallbackSpec} from '../ChatUiComponentSpec';
import {openUiLangFormat, type OpenUiLangFormatOptions} from './OpenUiLangFormat';

/**
 * A program renders as it streams, one chunk at a time. Each chunk can cut a statement anywhere:
 * inside a key, a number or a string. Apps rely on the format to show the part that has arrived
 * and never a fallback for a program that is valid once complete, as a text format gets no retry.
 */
describe('OpenUI Lang streaming', () => {
    beforeAll(() => initTestAppAsync());

    // jsdom has no layout, and so no ResizeObserver.
    beforeEach(() => {
        vi.stubGlobal('ResizeObserver', NoopResizeObserver);
    });

    const PROGRAM =
        'root = Stack([lead, kpis, acme, trend], "column")\n' +
        'lead = Text("Q3 at a glance.")\n' +
        'kpis = StatCards([{label: "P&L", value: -12656923, format: "currency"}, ' +
        '{label: "Margin", value: 0.184, format: "percent", delta: -0.012}])\n' +
        'acme = Card("Acme Corp", "Tier 1", [{label: "Exposure", value: 4200000, ' +
        'format: "currency", decimals: 0}, {label: "Rating", value: "A+"}], ' +
        '[@ToAssistant("Show my open trades with Acme Corp.")])\n' +
        'trend = Chart("Monthly revenue", "column", {categories: ["Jan", "Feb", "Mar"]}, ' +
        '{title: "USD", format: "currency"}, [{name: "Revenue", data: [182000, -205000, 231000]}])';

    it.each<[string, Partial<OpenUiLangFormatOptions>]>([
        ['with no state', {}],
        ['with state', {bindings: true}]
    ])('shows no fallback at any point of a valid program, %s', (_, opts) => {
        const fallback = vi.fn((_spec: ChatUiFallbackSpec) => 'FALLBACK'),
            catalog = createCatalog(opts, fallback),
            failures: string[] = [],
            view = (text: string, isStreaming: boolean) =>
                appContext({
                    children: catalog
                        .parseText(text, {isStreaming, messageId: 'm1', partId: 'p1'})
                        .map((segment, idx) => {
                            if (segment.type === 'fallback') failures.push(text);
                            return fragment({
                                key: idx,
                                children: catalog.renderSegment(segment, CONTEXT)
                            });
                        })
                }),
            {rerender, container} = render(view('', true));

        for (let end = 1; end <= PROGRAM.length; end++) {
            const text = PROGRAM.slice(0, end);
            rerender(view(text, end < PROGRAM.length));
            if (fallback.mock.calls.length || container.textContent.includes('FALLBACK')) {
                failures.push(`${text.slice(-60)} -> ${fallback.mock.lastCall?.[0]?.errors}`);
                fallback.mockClear();
            }
        }

        expect(failures).toEqual([]);
        // The whole program shows once it is complete.
        expect(container.querySelectorAll('.xh-stat-card')).toHaveLength(2);
        expect(container.textContent).toContain('Exposure');
        expect(container.textContent).toContain('Rating');
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

class AppStandInModel extends HoistModel {}

// A Hoist app renders inside the context of its models, which the components look up.
const appContext = hoistCmp.factory({
    displayName: 'TestAppContext',
    model: creates(AppStandInModel),
    render: ({children}) => fragment(children)
});

const CONTEXT: Omit<ChatUiDocumentContext, 'isPartial'> = {
    chatModel: null,
    messageId: 'm1',
    part: {type: 'text', id: 'p1', text: '', state: 'done'}
};

function createCatalog(
    opts: Partial<OpenUiLangFormatOptions>,
    fallback: (spec: ChatUiFallbackSpec) => string
): ChatUiCatalog {
    return new ChatUiCatalog({
        components: [
            chatUiStackSpec(),
            chatUiTextSpec(),
            chatUiStatCardsSpec(),
            chatUiCardSpec(),
            chatUiChartSpec()
        ],
        textFormats: [openUiLangFormat({root: 'stack', ...opts})],
        modes: ['openui'],
        fallback
    });
}
