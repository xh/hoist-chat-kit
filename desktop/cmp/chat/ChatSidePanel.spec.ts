import {act, fireEvent, render, screen} from '@testing-library/react';
import {useEffect} from 'react';
import {div} from '@xh/hoist/cmp/layout';
import {hoistCmp, type HoistProps} from '@xh/hoist/core';
import {initTestAppAsync} from '@xh/hoist/test-support';
import {beforeAll, beforeEach, describe, expect, it, onTestFinished, vi} from 'vitest';
import {
    chatAnnouncer,
    type ChatDocumentRenderer,
    type ChatDocumentStatus,
    ChatSidePanelModel,
    type ChatTableRequest
} from '../../../core';
import {ChatArtifactRegistry} from '../../../genui';
import {chatSidePanel} from './ChatSidePanel';

/**
 * The side panel's frame around the app's document viewer (P3). Users rely on Close working in
 * every state, returning focus to the citation, on status that sits in a strip and never covers the document, and on a
 * failure offering only the actions that can work. Apps rely on the kit drawing no document.
 */
describe('ChatSidePanel', () => {
    beforeAll(() => initTestAppAsync());
    beforeEach(() => chatAnnouncer.clear());

    it('renders nothing with no request open, or no viewer', () => {
        const {container} = render(chatSidePanel({model: panel()}));
        expect(container.querySelector('.xh-chat-side-panel')).toBeNull();
    });

    it("frames the app's viewer with the title and Close, and no Back", () => {
        const renderer = vi.fn(() => div({className: 'app-viewer', item: 'PDF'})),
            model = panel(renderer);
        model.open(request(), opener());
        render(chatSidePanel({model}));

        expect(screen.getByText('Reserves Policy')).toBeTruthy();
        expect(document.querySelector('.app-viewer')).toBeTruthy();
        expect(renderer).toHaveBeenCalledWith(model.request, model);
        expect(screen.queryByRole('button', {name: /^Back/})).toBeNull();
        expect(screen.getByRole('button', {name: 'Close'})).toBeTruthy();
    });

    it('shows the page only once the viewer reports one', () => {
        const model = panel();
        model.open(request());
        const {container} = render(chatSidePanel({model}));
        const pageLabel = () => container.querySelector('.xh-chat-side-panel__page');

        expect(pageLabel()).toBeNull();

        setStatus(model, {state: 'located'});
        expect(pageLabel()).toBeNull();

        setStatus(model, {state: 'located', page: 3});
        expect(pageLabel().textContent).toBe('Page 3');

        setStatus(model, {state: 'located', page: 3, pageCount: 12});
        expect(pageLabel().textContent).toBe('Page 3 of 12');
    });

    it('closes on Close or Esc, returning focus to the citation', () => {
        const model = panel(),
            citation = opener();
        model.open(request(), citation);
        render(chatSidePanel({model}));

        fireEvent.keyDown(screen.getByRole('button', {name: 'Close'}), {key: 'Escape'});
        expect(model.request).toBeNull();
        expect(document.activeElement).toBe(citation);
    });

    it('masks the body only while opening', () => {
        const model = panel();
        model.open(request());
        const {container} = render(chatSidePanel({model}));

        setStatus(model, {state: 'opening'});
        expect(container.textContent).toContain('Opening document…');

        setStatus(model, {state: 'locating', page: 1, pageCount: 22});
        expect(container.textContent).not.toContain('Opening document…');
        expect(strip(container).textContent).toBe('Locating passage…');
        expect(screen.getByText('Page 1 of 22')).toBeTruthy();
    });

    it('shows the strip for a likely page and a passage not located, with Copy Excerpt', () => {
        const model = panel();
        model.open(request());
        const {container} = render(chatSidePanel({model}));

        setStatus(model, {state: 'likelyPage', page: 7, pageCount: 22});
        expect(strip(container).textContent).toContain('Opened the most likely page.');
        expect(screen.getByRole('button', {name: 'Copy Excerpt'})).toBeTruthy();

        setStatus(model, {state: 'notLocated', page: 1, pageCount: 22});
        expect(strip(container).classList).toContain('xh-chat-side-panel__strip--warning');
        expect(strip(container).textContent).toContain("Couldn't locate the passage.");

        const announce = vi.spyOn(chatAnnouncer, 'announce');
        onTestFinished(() => announce.mockRestore());
        setStatus(model, {state: 'located', page: 7, pageCount: 22});
        expect(strip(container)).toBeNull();
        expect(announce).toHaveBeenCalledExactlyOnceWith('Passage on page 7', 'polite');
    });

    it('shows the document plainly, with nothing announced, for a viewer that reports no status once it shows', () => {
        const model = panel();
        model.open(request());
        const {container} = render(chatSidePanel({model}));
        setStatus(model, {state: 'opening'});

        const announce = vi.spyOn(chatAnnouncer, 'announce');
        onTestFinished(() => announce.mockRestore());
        setStatus(model, null);

        expect(container.textContent).not.toContain('Opening document…');
        expect(strip(container)).toBeNull();
        expect(announce).not.toHaveBeenCalled();
    });

    it('speaks through the announcer, with no live region of its own', () => {
        const model = panel();
        model.open(request());
        const {container} = render(chatSidePanel({model}));

        setStatus(model, {state: 'error', error: {httpStatus: 404}});

        expect(chatAnnouncer.assertive?.text).toBe(
            "Couldn't open Reserves Policy. This document no longer exists."
        );
        expect(container.querySelector('[role="status"], [role="alert"], [aria-live]')).toBeNull();
    });

    it('offers Retry for a server error, and no Retry for a 403, saying why', () => {
        const retry = vi.fn(),
            model = panel();
        model.open(request());
        render(chatSidePanel({model}));

        setStatus(model, {state: 'error', error: {httpStatus: 503, retry}});
        expect(screen.getByText("Couldn't open Reserves Policy")).toBeTruthy();
        fireEvent.click(screen.getByRole('button', {name: 'Retry'}));
        expect(retry).toHaveBeenCalled();

        setStatus(model, {state: 'error', error: {httpStatus: 403, retry}});
        expect(screen.getByText("You don't have access to this document.")).toBeTruthy();
        expect(screen.queryByRole('button', {name: 'Retry'})).toBeNull();
        // Close works in every state.
        expect(screen.getByRole('button', {name: 'Close'})).toBeTruthy();
    });

    it('offers Download in place of Retry for a file that arrived but cannot show', () => {
        const download = vi.fn(),
            model = panel();
        model.open(request());
        render(chatSidePanel({model}));

        setStatus(model, {state: 'error', error: {download, retry: vi.fn()}});
        expect(screen.queryByRole('button', {name: 'Retry'})).toBeNull();
        fireEvent.click(screen.getByRole('button', {name: 'Download'}));
        expect(download).toHaveBeenCalled();
    });

    it('keeps one viewer for one document, and replaces it for another', () => {
        const mounts: string[] = [],
            model = panel(({source}) => testViewer({id: source.id, mounts}));
        model.open(request());
        render(chatSidePanel({model}));

        act(() => model.open({...request(), citation: 3, passage: 'Another passage'}));
        act(() => model.open({...request(), source: {type: 'source', id: 'd9', title: 'Other'}}));
        expect(mounts).toEqual(['d2', 'd9']);
    });
    describe('tables and charts', () => {
        beforeEach(() => vi.stubGlobal('ResizeObserver', NoopResizeObserver));

        it('renders a table request as the full grid, with Close returning to the card', async () => {
            const model = panel(null),
                card = opener();
            model.open(tableRequest(), card);
            const {container} = render(chatSidePanel({model}));

            expect(screen.getByRole('complementary', {name: 'Positions'})).toBeTruthy();
            expect(container.querySelector('.xh-chat-ui-table-view')).toBeTruthy();
            await screen.findByText('2 rows');

            fireEvent.keyDown(screen.getByRole('button', {name: 'Close'}), {key: 'Escape'});
            expect(model.request).toBeNull();
            expect(document.activeElement).toBe(card);
        });

        it('renders a chart request as the expanded chart, with its switchers', () => {
            const model = panel(null);
            model.open({
                ...tableRequest(),
                type: 'chart',
                view: {type: 'line', x: 'symbol', y: ['qty']}
            });
            const {container} = render(chatSidePanel({model}));

            expect(container.querySelector('.xh-chat-ui-chart-view')).toBeTruthy();
            expect(screen.getByRole('radio', {name: 'Column'})).toBeTruthy();
        });

        it('renders nothing for a table request without a registry', () => {
            const model = panel(null);
            model.open({type: 'table', artifactId: 'pos'});
            const {container} = render(chatSidePanel({model}));
            expect(container.querySelector('.xh-chat-side-panel')).toBeNull();
        });
    });
});

// A viewer that records each mount.
interface TestViewerProps extends HoistProps {
    id: string;
    mounts: string[];
}

const testViewer = hoistCmp.factory<TestViewerProps>({
    displayName: 'TestViewer',
    model: false,
    render({id, mounts}) {
        useEffect(() => {
            mounts.push(id);
        }, [id, mounts]);
        return div(id);
    }
});

function panel(documentRenderer: ChatDocumentRenderer = () => div('Viewer')) {
    const ret = new ChatSidePanelModel({documentRenderer});
    onTestFinished(() => ret.destroy());
    return ret;
}

function request() {
    return {
        type: 'document' as const,
        source: {type: 'source' as const, id: 'd2', title: 'Reserves Policy'},
        citation: 2,
        passage: 'Six months of reserves.'
    };
}

function opener(): HTMLButtonElement {
    const ret = document.createElement('button');
    document.body.appendChild(ret);
    onTestFinished(() => ret.remove());
    return ret;
}

function setStatus(model: ChatSidePanelModel, status: ChatDocumentStatus) {
    act(() => model.setDocumentStatus(status));
}

function strip(container: HTMLElement): HTMLElement {
    return container.querySelector('.xh-chat-side-panel__strip');
}

function tableRequest(): ChatTableRequest {
    const registry = new ChatArtifactRegistry({
        artifacts: [
            {
                id: 'pos',
                columns: [
                    {name: 'symbol', type: 'string'},
                    {name: 'qty', type: 'number'}
                ],
                rows: [
                    {symbol: 'AAPL', qty: 1},
                    {symbol: 'MSFT', qty: 2}
                ],
                totalRows: 2
            }
        ]
    });
    onTestFinished(() => registry.destroy());
    return {type: 'table', artifactId: 'pos', registry, title: 'Positions'};
}

// jsdom has no layout, and so no ResizeObserver.
class NoopResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
}
