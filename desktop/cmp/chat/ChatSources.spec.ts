import {act, fireEvent, render, screen} from '@testing-library/react';
import {fragment} from '@xh/hoist/cmp/layout';
import {hoistCmp, HoistModel, type HoistProps, managed, uses} from '@xh/hoist/core';
import {initTestAppAsync} from '@xh/hoist/test-support';
import {afterEach, beforeAll, beforeEach, describe, expect, it, onTestFinished, vi} from 'vitest';
import {
    type ChatMessageSpec,
    ChatModel,
    type ChatPart,
    ChatSidePanelModel,
    type ChatSourcePart
} from '../../../core';
import {ScriptedChatTransport} from '../../../transport';
import {chatMessageList, type ChatMessageListProps} from './ChatMessageList';
import {ChatSources, chatSources} from './ChatSources';

/**
 * The sources under a reply and the citation markers in its text (P3). Users rely on numbers that
 * match the markers and never renumber, on one row style for documents and web pages, on a card
 * that opens on hover or focus and closes with Esc, and on a document opening beside the chat.
 * Apps rely on a source list that loads no image.
 */
describe('sources and citations', () => {
    it("shows a source's own meta line, and the list's own title", () => {
        const appModel = new PlainAppModel();
        onTestFinished(() => appModel.destroy());
        render(
            appContext({
                model: appModel,
                item: chatSources({
                    title: 'References',
                    sources: [
                        {
                            ...doc(1),
                            metadata: {meta: ['Section 4', 'June 2026'], fileName: 'x.pdf'}
                        },
                        {...doc(2), metadata: {meta: 'Policy'}}
                    ]
                })
            })
        );

        expect(screen.getByRole('region', {name: 'References'})).toBeTruthy();
        expect(screen.getByText('References')).toBeTruthy();
        expect(screen.getByText('Section 4 · June 2026')).toBeTruthy();
        expect(screen.getByText('Policy')).toBeTruthy();
        expect(screen.queryByText(/x\.pdf/)).toBeNull();
    });

    beforeAll(() => initTestAppAsync());

    let open: ReturnType<typeof vi.fn>;
    beforeEach(() => {
        vi.stubGlobal('ResizeObserver', NoopResizeObserver);
        Element.prototype.scrollTo ??= () => {};
        Element.prototype.scrollIntoView ??= () => {};
        open = vi.fn();
        vi.stubGlobal('open', open);
    });
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    const DOC1: ChatSourcePart = {
            type: 'source',
            id: 'd1',
            sourceType: 'document',
            title: '§5.3 Cash-Out Refinance',
            marker: 1,
            metadata: {
                fileName: 'Credit Guidelines v4.pdf',
                page: 41,
                excerpt: 'Two- to four-unit primary residences are limited to a maximum LTV of 75.'
            }
        },
        DOC2: ChatSourcePart = {
            type: 'source',
            id: 'd2',
            sourceType: 'document',
            title: '§2.1 Reserve Requirements',
            marker: 2,
            metadata: {fileName: 'Reserves Policy.pdf'}
        },
        WEB3: ChatSourcePart = {
            type: 'source',
            id: 'w3',
            sourceType: 'url',
            url: 'https://www.news.example/loans',
            title: 'Office loan maturities stack up',
            marker: 3
        };

    describe('the sources list', () => {
        it('lists cited sources in marker order, never renumbered, and leaves out the rest', () => {
            const {container} = renderReply('See [4] and [2].', [
                {...DOC1, marker: 4},
                {...DOC2, marker: 2},
                {...WEB3, marker: null}
            ]);

            expect(numbers(container)).toEqual(['2', '4']);
            expect(container.textContent).not.toContain(WEB3.title);
        });

        it('gives documents and web pages one row style, showing only the metadata given', () => {
            const {container} = renderReply('Caps [1] [2] [3].', [DOC1, DOC2, WEB3]),
                [doc1, doc2, web] = Array.from(
                    container.querySelectorAll('.xh-chat-sources__item')
                );

            expect(doc1.querySelector('.xh-chat-sources__meta').textContent).toBe(
                'Credit Guidelines v4.pdf · p. 41'
            );
            expect(doc2.querySelector('.xh-chat-sources__meta').textContent).toBe(
                'Reserves Policy.pdf'
            );
            expect(web.querySelector('.xh-chat-sources__meta').textContent).toBe('news.example');
            expect(web.querySelector('.xh-chat-sources__icon .fa-globe')).toBeTruthy();
        });

        it('opens a web row in a new tab, and loads no image for it', () => {
            const {container} = renderReply('See [3].', [
                {...WEB3, metadata: {favicon: 'https://icons.example/n.png'}}
            ]);

            fireEvent.click(screen.getByRole('button', {name: WEB3.title}));
            expect(open).toHaveBeenCalledExactlyOnceWith(WEB3.url, '_blank', 'noopener,noreferrer');
            expect(container.querySelector('.xh-chat-sources img')).toBeNull();
        });

        it('shows three rows, then the rest behind Show N More', () => {
            const sources = [1, 2, 3, 4, 5].map(n => doc(n)),
                {container} = renderReply('All [1] [2] [3] [4] [5].', sources);
            expect(numbers(container)).toEqual(['1', '2', '3']);

            fireEvent.click(screen.getByRole('button', {name: 'Show 2 More'}));
            expect(numbers(container)).toEqual(['1', '2', '3', '4', '5']);

            fireEvent.click(screen.getByRole('button', {name: 'Show Fewer'}));
            expect(numbers(container)).toEqual(['1', '2', '3']);
        });

        it('shows as many rows as ChatSources.defaults says, or every row for null', () => {
            const {defaults} = ChatSources,
                visibleRows = defaults.visibleRows;
            onTestFinished(() => {
                defaults.visibleRows = visibleRows;
            });
            const sources = [1, 2, 3, 4, 5].map(n => doc(n));

            defaults.visibleRows = 4;
            const {container, unmount} = renderReply('All [1] [2] [3] [4] [5].', sources);
            expect(numbers(container)).toEqual(['1', '2', '3', '4']);
            expect(screen.getByRole('button', {name: 'Show 1 More'})).toBeTruthy();
            unmount();

            defaults.visibleRows = null;
            const all = renderReply('All [1] [2] [3] [4] [5].', sources);
            expect(numbers(all.container)).toEqual(['1', '2', '3', '4', '5']);
            expect(screen.queryByRole('button', {name: /^Show/})).toBeNull();
        });

        it('expands a row to show its excerpt', () => {
            const {container} = renderReply('Caps [1].', [DOC1]);
            fireEvent.click(screen.getByRole('button', {name: 'Show excerpt'}));

            expect(container.querySelector('.xh-chat-sources__excerpt').textContent).toBe(
                DOC1.metadata.excerpt
            );
        });

        it("toggles a row's excerpt on a click anywhere on the row outside its title", () => {
            const {container} = renderReply('Caps [1].', [DOC1]),
                row = container.querySelector('.xh-chat-sources__row'),
                excerpt = () => container.querySelector('.xh-chat-sources__excerpt');

            fireEvent.click(row.querySelector('.xh-chat-sources__meta'));
            expect(excerpt()).toBeTruthy();
            expect(
                screen.getByRole('button', {name: 'Hide excerpt'}).getAttribute('aria-expanded')
            ).toBe('true');

            fireEvent.click(row);
            expect(excerpt()).toBeNull();
        });

        it('opens the source on a click on the title, without toggling the excerpt', () => {
            const {container, sidePanel} = renderReply('Caps [1].', [DOC1]);

            fireEvent.click(screen.getByRole('button', {name: DOC1.title}));
            expect(sidePanel.request).toMatchObject({citation: 1});
            expect(container.querySelector('.xh-chat-sources__excerpt')).toBeNull();
        });

        it('highlights the markers of a hovered row, and the row of a hovered marker', () => {
            const {container} = renderReply('Caps [1] and [2].', [DOC1, DOC2]),
                [row1, row2] = Array.from(container.querySelectorAll('.xh-chat-sources__row'));

            fireEvent.mouseEnter(row1);
            expect(marker(1).classList).toContain('xh-chat-citation-marker--highlight');
            fireEvent.mouseLeave(row1);
            expect(marker(1).classList).not.toContain('xh-chat-citation-marker--highlight');

            fireEvent.mouseEnter(marker(2).parentElement);
            expect(row2.classList).toContain('xh-chat-sources__row--highlight');
        });

        it('opens a document row in the side panel, marking the row and its marker active', () => {
            const {container, sidePanel} = renderReply('Caps [1].', [DOC1]);

            fireEvent.click(screen.getByRole('button', {name: DOC1.title}));
            expect(sidePanel.request).toMatchObject({citation: 1, messageId: 'a1', page: 41});
            expect(container.querySelector('.xh-chat-sources__row--active')).toBeTruthy();
            expect(container.querySelector('.xh-chat-sources__meta').textContent).toContain(
                'shown in viewer'
            );
            expect(
                screen.getByRole('button', {name: DOC1.title}).getAttribute('aria-current')
            ).toBe('true');
            expect(marker(1).getAttribute('aria-pressed')).toBe('true');
        });
    });

    describe('citation markers', () => {
        it('names each marker for its source and page', () => {
            renderReply('Caps [1] and [3].', [DOC1, WEB3]);
            expect(marker(1).getAttribute('aria-label')).toBe(
                'Source 1: §5.3 Cash-Out Refinance, page 41'
            );
            expect(marker(3).getAttribute('aria-label')).toBe(
                'Source 3: Office loan maturities stack up'
            );
        });

        it('opens its card on focus at once, with title, meta and excerpt', () => {
            renderReply('Caps [1].', [DOC1]);
            act(() => marker(1).focus());

            const card = screen.getByRole('group', {name: 'Source 1'});
            expect(marker(1).getAttribute('aria-describedby')).toBe(card.id);
            expect(card.textContent).toContain(DOC1.title);
            expect(card.textContent).toContain('Credit Guidelines v4.pdf · p. 41');
            expect(card.textContent).toContain(DOC1.metadata.excerpt);
            expect(screen.getByRole('button', {name: 'Open Passage'})).toBeTruthy();
            expect(screen.getByRole('button', {name: 'Copy Excerpt'})).toBeTruthy();
        });

        it('opens its card on hover after 300 ms, and closes it 150 ms after the pointer leaves', () => {
            vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout']});
            renderReply('Caps [1].', [DOC1]);
            const wrap = marker(1).parentElement;

            fireEvent.mouseEnter(wrap);
            act(() => vi.advanceTimersByTime(250));
            expect(screen.queryByRole('group', {name: 'Source 1'})).toBeNull();
            act(() => vi.advanceTimersByTime(60));
            expect(screen.getByRole('group', {name: 'Source 1'})).toBeTruthy();

            fireEvent.mouseLeave(wrap);
            act(() => vi.advanceTimersByTime(100));
            expect(screen.getByRole('group', {name: 'Source 1'})).toBeTruthy();
            act(() => vi.advanceTimersByTime(60));
            expect(screen.queryByRole('group', {name: 'Source 1'})).toBeNull();
        });

        it('closes its card on Esc, keeping focus on the marker', () => {
            renderReply('Caps [1].', [DOC1]);
            act(() => marker(1).focus());

            fireEvent.keyDown(marker(1), {key: 'Escape'});
            expect(screen.queryByRole('group', {name: 'Source 1'})).toBeNull();
            expect(document.activeElement).toBe(marker(1));
        });

        it('shows one card at a time', () => {
            renderReply('Caps [1] and [2].', [DOC1, DOC2]);
            act(() => marker(1).focus());
            act(() => marker(2).focus());

            expect(screen.queryByRole('group', {name: 'Source 1'})).toBeNull();
            expect(screen.getByRole('group', {name: 'Source 2'})).toBeTruthy();
        });

        it("opens a web page's marker in a new tab, as its row does", () => {
            renderReply('See [3].', [WEB3]);

            fireEvent.click(marker(3));
            expect(open).toHaveBeenCalledExactlyOnceWith(WEB3.url, '_blank', 'noopener,noreferrer');
            expect(screen.queryByRole('group', {name: 'Source 3'})).toBeNull();
        });

        it("opens a document's marker in the side panel, and shows it active", () => {
            const {sidePanel} = renderReply('Caps [1].', [DOC1]);

            fireEvent.click(marker(1));
            expect(sidePanel.request).toMatchObject({type: 'document', citation: 1, source: DOC1});
            expect(sidePanel.opener).toBe(marker(1));
            expect(marker(1).classList).toContain('xh-chat-citation-marker--active');
            expect(marker(1).getAttribute('aria-pressed')).toBe('true');
        });

        it('offers no Open Passage for a document that nothing can open', () => {
            renderReply('Caps [1].', [DOC1], {}, {withPanel: false});
            act(() => marker(1).focus());

            expect(screen.queryByRole('button', {name: 'Open Passage'})).toBeNull();
            expect(screen.getByRole('button', {name: 'Copy Excerpt'})).toBeTruthy();
        });

        it("falls back to the app's onSourceClick for a document with no side panel", () => {
            const onSourceClick = vi.fn();
            renderReply('Caps [1].', [DOC1], {onSourceClick}, {withPanel: false});

            fireEvent.click(marker(1));
            expect(onSourceClick).toHaveBeenCalledWith(DOC1, expect.anything());
        });

        it('collapses four or more sources into one marker whose card lists them all', () => {
            const sources = [1, 2, 3, 4, 5].map(n => doc(n));
            renderReply('All agree [2, 3, 4, 5].', sources);
            const group = screen.getByRole('button', {name: 'Sources 2 to 5'});
            expect(group.textContent).toBe('2–5');

            fireEvent.click(group);
            const card = screen.getByRole('group', {name: 'Sources 2 to 5'});
            expect(card.textContent).toContain('Doc 2');
            expect(card.textContent).toContain('Doc 5');
        });

        it('labels a group with its count when the numbers are not consecutive', () => {
            const sources = [1, 2, 3, 4, 5].map(n => doc(n));
            renderReply('All agree [1, 2, 4, 5].', sources);

            const group = screen.getByRole('button', {name: 'Sources 1, 2, 4, 5'});
            expect(group.textContent).toBe('4 sources');
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

class TestAppModel extends HoistModel {
    @managed sidePanel = new ChatSidePanelModel({documentRenderer: () => null});
}

class PlainAppModel extends HoistModel {}

const appContext = hoistCmp.factory<HoistProps<HoistModel>>({
    displayName: 'TestAppContext',
    model: uses(HoistModel),
    render: ({children}) => fragment(children)
});

function renderReply(
    content: string,
    sources: ChatSourcePart[],
    props: Partial<ChatMessageListProps> = {},
    {withPanel = true}: {withPanel?: boolean} = {}
) {
    const appModel = withPanel ? new TestAppModel() : new PlainAppModel(),
        parts: ChatPart[] = [{type: 'text', id: 't1', text: content, state: 'done'}, ...sources],
        messages: ChatMessageSpec[] = [
            {id: 'u1', role: 'user', parts: [{type: 'text', id: 'u1-t', text: 'Q', state: 'done'}]},
            {id: 'a1', role: 'assistant', parts}
        ],
        chatModel = new ChatModel({
            transport: new ScriptedChatTransport(),
            initialMessages: messages
        });
    onTestFinished(() => {
        chatModel.destroy();
        appModel.destroy();
    });

    const ret = render(
        appContext({
            model: appModel,
            item: chatMessageList({model: chatModel, citationMarkers: true, ...props})
        })
    );
    return {...ret, chatModel, sidePanel: (appModel as TestAppModel).sidePanel ?? null};
}

function doc(n: number): ChatSourcePart {
    return {type: 'source', id: `d${n}`, sourceType: 'document', title: `Doc ${n}`, marker: n};
}

function marker(number: number): HTMLElement {
    return screen.getByRole('button', {name: new RegExp(`^Source ${number}:`)});
}

function numbers(container: HTMLElement): string[] {
    return Array.from(container.querySelectorAll('.xh-chat-sources__number')).map(
        it => it.textContent
    );
}
