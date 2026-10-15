import {fireEvent, render, screen} from '@testing-library/react';
import {fragment, span} from '@xh/hoist/cmp/layout';
import {creates, hoistCmp, HoistModel} from '@xh/hoist/core';
import {initTestAppAsync} from '@xh/hoist/test-support';
import {beforeAll, describe, expect, it, onTestFinished, vi} from 'vitest';
import type {ChatSourcePart} from '../../core';
import {chatMarkdown, type ChatMarkdownPlugins, type ChatMarkdownProps} from './ChatMarkdown';

/**
 * How `ChatMarkdown` renders citation markers and app plugins on real parsed markdown. Apps rely on
 * markers becoming buttons only where they cite a source, on markers in code and links staying as
 * written, and on streaming staying cheap with citations and plugins in use.
 */
describe('ChatMarkdown', () => {
    beforeAll(() => initTestAppAsync());

    const SOURCES: ChatSourcePart[] = [
        {type: 'source', id: 's1', title: 'Rate outlook', url: 'https://a.example'},
        {
            type: 'source',
            id: 's2',
            title: 'Guideline 4.2',
            metadata: {excerpt: 'Loans above the limit need a second review.'}
        }
    ];

    describe('citations', () => {
        it('renders markers as buttons named for their sources', () => {
            renderMarkdown({content: 'Rates rose [1, 2].', citations: {sources: SOURCES}});

            const markers = screen.getAllByRole('button');
            expect(markers.map(it => it.textContent)).toEqual(['1', '2']);
            expect(markers[0].getAttribute('aria-label')).toBe('Source 1: Rate outlook');
            expect(markers[1].getAttribute('title')).toBe(
                'Guideline 4.2\n\nLoans above the limit need a second review.'
            );
        });

        it('calls onClick with the cited source', () => {
            const onClick = vi.fn();
            renderMarkdown({content: 'See [2].', citations: {sources: SOURCES, onClick}});

            fireEvent.click(screen.getByRole('button', {name: /Guideline/}));
            expect(onClick).toHaveBeenCalledWith(SOURCES[1]);
        });

        it('opens the source URL in a new tab by default', () => {
            const open = vi.fn();
            vi.stubGlobal('open', open);
            onTestFinished(() => {
                vi.unstubAllGlobals();
            });
            renderMarkdown({content: 'See [1].', citations: {sources: SOURCES}});

            fireEvent.click(screen.getByRole('button', {name: /Rate outlook/}));
            expect(open).toHaveBeenCalledWith('https://a.example', '_blank', 'noopener,noreferrer');
        });

        it('wraps each marker with renderMarker, which replaces the native tooltip', () => {
            renderMarkdown({
                content: 'See [1].',
                citations: {
                    sources: SOURCES,
                    renderMarker: (marker, source) =>
                        span({className: `tip-${source.id}`, item: marker})
                }
            });

            const marker = screen.getByRole('button', {name: /Rate outlook/});
            expect(marker.closest('.tip-s1')).toBeTruthy();
            expect(marker.getAttribute('title')).toBeNull();
        });

        it('passes renderMarker the number that cites the source', () => {
            const renderMarker = vi.fn((marker, source, number) => marker);
            renderMarkdown({content: 'See [2].', citations: {sources: SOURCES, renderMarker}});
            expect(renderMarker).toHaveBeenCalledWith(expect.anything(), SOURCES[1], 2);
        });

        it('keeps a marker on the line of the word before it', () => {
            const {container} = renderMarkdown({
                content: 'Rates rose [1].',
                citations: {sources: SOURCES}
            });
            const run = container.querySelector('.xh-chat-markdown__citation-run');
            expect(run.textContent).toBe('rose 1.');
        });

        it('collapses a marker of four or more sources to one button for all of them', () => {
            const sources: ChatSourcePart[] = [1, 2, 3, 4, 5].map(n => ({
                    type: 'source',
                    id: `s${n}`,
                    title: `Doc ${n}`,
                    marker: n
                })),
                renderGroup = vi.fn((marker, cited) => marker);
            renderMarkdown({content: 'All agree [2–5].', citations: {sources, renderGroup}});

            const marker = screen.getByRole('button', {name: 'Sources 2 to 5'});
            expect(marker.textContent).toBe('2–5');
            expect(renderGroup.mock.calls[0][1].map(it => it.number)).toEqual([2, 3, 4, 5]);
        });

        it('lists every source of a group in its tooltip, and opens the first on click', () => {
            const sources: ChatSourcePart[] = [1, 2, 3, 4].map(n => ({
                    type: 'source',
                    id: `s${n}`,
                    title: `Doc ${n}`
                })),
                onClick = vi.fn();
            renderMarkdown({content: 'All agree [1–4].', citations: {sources, onClick}});

            const marker = screen.getByRole('button', {name: 'Sources 1 to 4'});
            expect(marker.getAttribute('title')).toBe('1. Doc 1\n2. Doc 2\n3. Doc 3\n4. Doc 4');
            fireEvent.click(marker);
            expect(onClick).toHaveBeenCalledExactlyOnceWith(sources[0]);
        });

        it('leaves markers in code, links and footnotes as written', () => {
            const {container} = renderMarkdown({
                content: [
                    'Inline `arr[1]` and a [1](https://link.example) link.',
                    '',
                    '```',
                    'list[2]',
                    '```',
                    '',
                    'A note[^1].',
                    '',
                    '[^1]: The note.'
                ].join('\n'),
                citations: {sources: SOURCES}
            });

            expect(screen.queryAllByRole('button')).toHaveLength(0);
            expect(container.querySelector('code').textContent).toBe('arr[1]');
            expect(container.querySelector('a[href="https://link.example"]').textContent).toBe('1');
            expect(container.querySelector('pre').textContent).toContain('list[2]');
        });

        it('leaves a marker that cites no source as written', () => {
            const {container} = renderMarkdown({
                content: 'Known [1] and unknown [3].',
                citations: {sources: SOURCES}
            });

            expect(screen.getAllByRole('button')).toHaveLength(1);
            expect(container.textContent).toContain('unknown [3].');
        });

        it('renders a partial marker as text while it streams, then as a button once closed', () => {
            const sources = {sources: SOURCES},
                {container, rerender} = renderMarkdown({
                    content: 'Rates rose [1',
                    isStreaming: true,
                    citations: sources
                });
            expect(screen.queryAllByRole('button')).toHaveLength(0);
            expect(container.textContent).toBe('Rates rose [1');

            rerender({content: 'Rates rose [1]', isStreaming: true, citations: sources});
            expect(screen.getAllByRole('button')).toHaveLength(1);
        });

        it('turns markers in finished blocks into buttons when sources arrive after the text', () => {
            const content = 'First claim [1].\n\nSecond claim',
                {rerender} = renderMarkdown({content, isStreaming: true, citations: {sources: []}});
            expect(screen.queryAllByRole('button')).toHaveLength(0);

            rerender({content, isStreaming: true, citations: {sources: SOURCES}});
            expect(screen.getAllByRole('button')).toHaveLength(1);
        });
    });

    describe('markdownPlugins', () => {
        it('runs app remark plugins after the kit, and app rehype plugins on the HTML tree', () => {
            const seen: string[] = [],
                plugins: ChatMarkdownPlugins = {
                    remark: [() => (tree: any) => void seen.push(...childTypes(tree.children[0]))],
                    rehype: [[rehypeAddClass, {className: 'from-app'}]]
                };
            const {container} = renderMarkdown({
                content: 'Twice cited [1]',
                citations: {sources: SOURCES},
                markdownPlugins: plugins
            });

            expect(seen).toEqual(['text', 'xhChatCitationRun']);
            expect(container.querySelector('p.from-app')).toBeTruthy();
        });

        it('applies rehype plugins to the block that holds the trailing content', () => {
            const {container} = renderMarkdown({
                content: 'One\n\nTwo',
                trailingContent: span({className: 'trailer', item: 'chips'}),
                markdownPlugins: {rehype: [[rehypeAddClass, {className: 'from-app'}]]}
            });

            expect(container.querySelectorAll('p.from-app')).toHaveLength(2);
            expect(container.querySelector('p.from-app .trailer')).toBeTruthy();
        });

        it('re-parses only the last block as text streams, with citations and plugins in use', () => {
            const parse = vi.fn(),
                plugins: ChatMarkdownPlugins = {remark: [() => parse]},
                props = (content: string): ChatMarkdownProps => ({
                    content,
                    isStreaming: true,
                    markdownPlugins: plugins,
                    // A new array of the same sources on each flush, as a message view passes.
                    citations: {sources: [...SOURCES]}
                }),
                {rerender} = renderMarkdown(props('First [1].\n\nSecond'));
            expect(parse).toHaveBeenCalledTimes(2);

            rerender(props('First [1].\n\nSecond, longer'));
            rerender(props('First [1].\n\nSecond, longer still'));
            expect(parse).toHaveBeenCalledTimes(4);
        });
    });
});

//------------------
// Helpers
//------------------
// Hoist's markdown looks for a model in context, as an app always has one.
class HostModel extends HoistModel {}

const host = hoistCmp.factory({
    model: creates(HostModel),
    render: ({children}) => fragment(children)
});

function renderMarkdown(props: ChatMarkdownProps) {
    const ret = render(host(chatMarkdown(props)));
    return {
        container: ret.container,
        rerender: (newProps: ChatMarkdownProps) => ret.rerender(host(chatMarkdown(newProps)))
    };
}

function childTypes(node: any): string[] {
    return node.children.map(it => it.type);
}

// Adds a class to every paragraph of the HTML tree (hast).
function rehypeAddClass({className}: {className: string}) {
    const visit = (node: any) => {
        if (node.tagName === 'p') node.properties.className = [className];
        node.children?.forEach(visit);
    };
    return visit;
}
