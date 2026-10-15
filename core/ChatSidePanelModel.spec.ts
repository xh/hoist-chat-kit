import {initTestAppAsync} from '@xh/hoist/test-support';
import {beforeAll, describe, expect, it, onTestFinished} from 'vitest';
import type {ChatDocumentRequest} from './ChatSidePanelHost';
import {isChatSidePanelHost} from './ChatSidePanelHost';
import {ChatSidePanelModel} from './ChatSidePanelModel';

/**
 * The side panel's request seam (D68). Apps rely on one request open at a time, on a new request
 * replacing the last, on Back and close returning focus to the element that opened it, and on a
 * request opening only where the panel can show it.
 */
describe('ChatSidePanelModel', () => {
    beforeAll(() => initTestAppAsync());

    it('holds one request at a time - opening one replaces the last and resets its status', () => {
        const model = panel();
        model.open(doc('d1', 1));
        model.setDocumentStatus({state: 'located', page: 3});

        model.open(doc('d2', 2));
        expect(model.request).toMatchObject({citation: 2, source: {id: 'd2'}});
        expect(model.documentStatus).toBeNull();
    });

    it('returns focus to the opener on close, and clears the request', () => {
        const model = panel(),
            opener = button();
        model.open(doc('d1', 1), opener);
        document.body.focus();

        model.close();
        expect(model.request).toBeNull();
        expect(document.activeElement).toBe(opener);
    });

    it('returns focus to the opener on Back, keeping the request open', () => {
        const model = panel(),
            opener = button();
        model.open(doc('d1', 1), opener);
        expect(model.canGoBack).toBe(true);

        model.back();
        expect(document.activeElement).toBe(opener);
        expect(model.request).not.toBeNull();
    });

    it('cannot go Back once the opener has left the page', () => {
        const model = panel(),
            opener = button();
        model.open(doc('d1', 1), opener);

        opener.remove();
        expect(model.canGoBack).toBe(false);
        expect(() => model.back()).not.toThrow();
    });

    it('opens a document only with a viewer, and only with room', () => {
        let hasRoom = true;
        const withViewer = panel({hasRoom: () => hasRoom}),
            noViewer = panel({documentRenderer: null});

        expect(withViewer.canOpen(doc('d1'))).toBe(true);
        expect(noViewer.canOpen(doc('d1'))).toBe(false);

        hasRoom = false;
        expect(withViewer.canOpen(doc('d1'))).toBe(false);
        expect(withViewer.canRender(doc('d1'))).toBe(true);
    });

    it('cannot yet render tables or charts', () => {
        const model = panel();
        expect(model.canOpen({type: 'table', artifactId: 'r1'})).toBe(false);
        expect(model.canOpen({type: 'chart', artifactId: 'r1'})).toBe(false);
    });

    it('is found in model context as a side panel host', () => {
        expect(isChatSidePanelHost(panel())).toBe(true);
        expect(isChatSidePanelHost({})).toBe(false);
        expect(isChatSidePanelHost(null)).toBe(false);
    });
});

function panel(config: ConstructorParameters<typeof ChatSidePanelModel>[0] = {}) {
    const ret = new ChatSidePanelModel({documentRenderer: () => null, ...config});
    onTestFinished(() => ret.destroy());
    return ret;
}

function doc(id: string, citation?: number): ChatDocumentRequest {
    return {type: 'document', source: {type: 'source', id, title: id}, citation};
}

function button(): HTMLButtonElement {
    const ret = document.createElement('button');
    document.body.appendChild(ret);
    onTestFinished(() => ret.remove());
    return ret;
}
