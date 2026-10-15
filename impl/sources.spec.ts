import {initTestAppAsync} from '@xh/hoist/test-support';
import {XH} from '@xh/hoist/core';
import {beforeAll, beforeEach, describe, expect, it, onTestFinished, vi} from 'vitest';
import {ChatSidePanelModel, type ChatSourcePart} from '../core';
import {getSourceType, openChatSource, trimExcerpt} from './sources';

/**
 * Where a click on a citation or source row takes the user. Apps rely on a document opening in the
 * side panel when one can show it, on their `onSourceClick` for the rest, on web pages opening in a
 * new tab, and on nothing but `http` and `https` ever opening.
 */
describe('sources', () => {
    beforeAll(() => initTestAppAsync());

    let open: ReturnType<typeof vi.fn>;
    beforeEach(() => {
        open = vi.fn();
        vi.stubGlobal('open', open);
        onTestFinished(() => {
            vi.unstubAllGlobals();
        });
    });

    const DOC: ChatSourcePart = {
            type: 'source',
            id: 'd1',
            sourceType: 'document',
            title: 'Reserves Policy',
            metadata: {page: 7, excerpt: 'Six months of reserves.'}
        },
        WEB: ChatSourcePart = {type: 'source', id: 'w1', url: 'https://news.example/a'};

    describe('getSourceType', () => {
        it('reads sourceType, else url for a source with a url, else document', () => {
            expect(getSourceType(DOC)).toBe('document');
            expect(getSourceType(WEB)).toBe('url');
            expect(getSourceType({type: 'source', id: 'x', title: 'No url'})).toBe('document');
            expect(getSourceType({...WEB, sourceType: 'document'})).toBe('document');
        });
    });

    describe('openChatSource', () => {
        it('opens a document in the side panel, with its page, passage and citation', () => {
            const sidePanel = panel(),
                opener = document.createElement('button');
            openChatSource(DOC, {sidePanel, citation: 2, messageId: 'a1', opener});

            expect(sidePanel.request).toEqual({
                type: 'document',
                source: DOC,
                page: 7,
                passage: 'Six months of reserves.',
                citation: 2,
                messageId: 'a1'
            });
            expect(sidePanel.opener).toBe(opener);
        });

        it("falls back to the app's onSourceClick when the panel has no viewer", () => {
            const onSourceClick = vi.fn(),
                sidePanel = panel({documentRenderer: null});
            openChatSource(DOC, {sidePanel, onSourceClick});

            expect(onSourceClick).toHaveBeenCalledWith(DOC);
            expect(sidePanel.request).toBeNull();
        });

        it('opens a document with a web URL in a new tab, with a toast, when there is no room', () => {
            const toast = vi.spyOn(XH, 'toast').mockImplementation(() => null),
                sidePanel = panel({hasRoom: () => false}),
                source = {...DOC, url: 'https://docs.example/reserves.pdf'};
            onTestFinished(() => toast.mockRestore());
            openChatSource(source, {sidePanel});

            expect(open).toHaveBeenCalledWith(source.url, '_blank', 'noopener,noreferrer');
            expect(toast).toHaveBeenCalledTimes(1);
            expect(sidePanel.request).toBeNull();
        });

        it('says so with a toast when nothing can open a document', () => {
            const toast = vi.spyOn(XH, 'toast').mockImplementation(() => null);
            onTestFinished(() => toast.mockRestore());

            openChatSource(DOC, {sidePanel: panel({documentRenderer: null})});
            openChatSource(DOC);
            expect(toast).toHaveBeenNthCalledWith(
                1,
                expect.objectContaining({message: "This document can't be opened here."})
            );
            expect(toast).toHaveBeenCalledTimes(2);

            openChatSource(DOC, {sidePanel: panel({hasRoom: () => false})});
            expect(toast).toHaveBeenLastCalledWith(
                expect.objectContaining({message: 'The viewer needs more room than this.'})
            );
            expect(open).not.toHaveBeenCalled();
        });

        it('leaves out the page, passage and citation a document request lacks', () => {
            const sidePanel = panel(),
                bare: ChatSourcePart = {type: 'source', id: 'd2', sourceType: 'document'};
            openChatSource(bare, {sidePanel});

            expect(sidePanel.request).toEqual({
                type: 'document',
                source: bare,
                page: null,
                passage: null,
                citation: null,
                messageId: null
            });
        });

        it('opens a web page in a new tab, or with onSourceClick in its place', () => {
            openChatSource(WEB, {sidePanel: panel()});
            expect(open).toHaveBeenCalledWith(WEB.url, '_blank', 'noopener,noreferrer');

            const onSourceClick = vi.fn();
            openChatSource(WEB, {onSourceClick});
            expect(onSourceClick).toHaveBeenCalledWith(WEB);
            expect(open).toHaveBeenCalledTimes(1);
        });

        it('opens a URL in a new tab on a Ctrl or Cmd click, past the panel and the app', () => {
            const sidePanel = panel(),
                onSourceClick = vi.fn(),
                source = {...DOC, url: 'https://docs.example/reserves.pdf'};
            openChatSource(source, {sidePanel, onSourceClick, newTab: true});

            expect(open).toHaveBeenCalledWith(source.url, '_blank', 'noopener,noreferrer');
            expect(sidePanel.request).toBeNull();
            expect(onSourceClick).not.toHaveBeenCalled();
        });

        it('never opens a URL that is not http or https', () => {
            openChatSource({type: 'source', id: 'x', url: 'javascript:alert(1)'});
            openChatSource({...DOC, url: 'data:text/html,hi'}, {newTab: true});
            expect(open).not.toHaveBeenCalled();
        });
    });

    describe('trimExcerpt', () => {
        it('keeps a short excerpt whole, with no passage when it is the whole excerpt', () => {
            expect(trimExcerpt('Six months.', 'Six months.')).toEqual({
                before: 'Six months.',
                passage: null,
                after: ''
            });
        });

        it('trims a long excerpt at a word boundary, with an ellipsis', () => {
            const {before} = trimExcerpt('word '.repeat(100).trim());
            expect(before.length).toBeLessThanOrEqual(301);
            expect(before.endsWith('word…')).toBe(true);
        });

        it('keeps the cited passage in view, with ellipses where text was cut', () => {
            const excerpt = `${'lead '.repeat(80)}the cited span ${'tail '.repeat(80)}`.trim(),
                {before, passage, after} = trimExcerpt(excerpt, 'the cited span');

            expect(passage).toBe('the cited span');
            expect(before.startsWith('…lead')).toBe(true);
            expect(after.endsWith('tail…')).toBe(true);
            expect((before + passage + after).length).toBeLessThanOrEqual(302);
        });
    });
});

function panel(config: Partial<ConstructorParameters<typeof ChatSidePanelModel>[0]> = {}) {
    const ret = new ChatSidePanelModel({documentRenderer: () => null, ...config});
    onTestFinished(() => ret.destroy());
    return ret;
}
