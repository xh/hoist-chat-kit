import type {ReactNode} from 'react';
import {HoistModel} from '@xh/hoist/core';
import {action, observableRef} from '@xh/hoist/mobx';
import type {
    ChatDocumentRequest,
    ChatSidePanelHost,
    ChatSidePanelRequest
} from './ChatSidePanelHost';

/**
 * Renders a document request in the side panel - the app's document viewer. Receives the request
 * and the panel, whose {@link ChatSidePanelModel.setDocumentStatus} reports the viewer's progress
 * to the panel's status strip. Called again for each request: keep one viewer for one document,
 * and jump to the new passage without reloading it.
 */
export type ChatDocumentRenderer = (
    request: ChatDocumentRequest,
    panel: ChatSidePanelModel
) => ReactNode;

/**
 * Where a document viewer is with a request - shown in the side panel's status strip.
 *
 *  - `opening` - loading the document. The panel masks the body, as there is nothing to read.
 *  - `locating` - the document shows, and the viewer is finding the passage.
 *  - `located` - the passage shows, highlighted. No strip.
 *  - `likelyPage` - the passage was not found exactly, and the viewer shows its best page.
 *  - `notLocated` - the passage was not found, and the document shows from the start.
 *  - `error` - the document could not open. The panel shows why, in place of the body.
 */
export type ChatDocumentState =
    'opening' | 'locating' | 'located' | 'likelyPage' | 'notLocated' | 'error';

/** A document viewer's progress with a request - see {@link ChatSidePanelModel.setDocumentStatus}. */
export interface ChatDocumentStatus {
    state: ChatDocumentState;

    /** The page that shows, counting from 1. */
    page?: number;

    /** The number of pages in the document. */
    pageCount?: number;

    /** Size of the document in bytes, shown if it is still opening after 10 seconds. */
    size?: number;

    /** Why the document could not open, for the `error` state. */
    error?: ChatDocumentError;
}

/**
 * A document that could not open. The panel offers only the actions that can work: Retry for a
 * server error or a network failure, never for a 4xx status, and Download only if given.
 */
export interface ChatDocumentError {
    /**
     * The HTTP status of the failed request, if any. A 403 or 404 says why and offers no Retry.
     */
    httpStatus?: number;

    /** What went wrong, in place of the message for the status. */
    message?: string;

    /** Try to open the document again. Shown unless `httpStatus` is a 4xx. */
    retry?: () => void;

    /** Download the file - give it only if the file arrived but cannot be shown. */
    download?: () => void;
}

/** Configuration for a {@link ChatSidePanelModel}. */
export interface ChatSidePanelConfig {
    /**
     * The app's document viewer. Without one, a document request cannot open in the panel, and a
     * document opens as the chat's `onSourceClick` says, or in a new tab if it has a URL.
     */
    documentRenderer?: ChatDocumentRenderer;

    /**
     * True if the panel has room beside the chat. Read as an observable. Default always true.
     * `ChatWorkspace` passes false below 788 px: the chat's 380, a splitter and the panel's 400.
     */
    hasRoom?: () => boolean;
}

/**
 * The side panel's request seam (D68): one open request at a time - a document, a table or a
 * chart - shown beside the chat. Opening a request replaces the last. Back and close return
 * focus to the element that opened it.
 *
 * The kit draws the panel's frame and status, and leaves the content to the app: a document
 * renders with the app's `documentRenderer`. The kit has no document viewer of its own.
 *
 * `ChatWorkspace` creates one as `ChatWorkspaceModel.sidePanel`. Components in the chat find it in
 * model context through the {@link ChatSidePanelHost} interface.
 */
export class ChatSidePanelModel extends HoistModel implements ChatSidePanelHost {
    declare config: ChatSidePanelConfig;

    readonly isChatSidePanelHost = true;

    /** The app's document viewer, or null. */
    readonly documentRenderer: ChatDocumentRenderer;

    //-----------------------
    // Observable State
    //-----------------------
    /** The request the panel shows, or null. */
    @observableRef accessor request: ChatSidePanelRequest = null;

    /**
     * The viewer's progress with the open document request, or null when it reports none - the
     * panel then shows no status. Reset by each request.
     */
    @observableRef accessor documentStatus: ChatDocumentStatus = null;

    /** The element that opened the request, given focus by Back and close. */
    @observableRef accessor opener: HTMLElement = null;

    /** True if the panel has room beside the chat. */
    get hasRoom(): boolean {
        return this.hasRoomFn?.() ?? true;
    }

    /** True if Back can return to the element that opened the request - still on the page. */
    get canGoBack(): boolean {
        return !!this.opener?.isConnected;
    }

    constructor(config: ChatSidePanelConfig = {}) {
        super();
        this.documentRenderer = config.documentRenderer ?? null;
        this.hasRoomFn = config.hasRoom ?? null;
    }

    canOpen(request: ChatSidePanelRequest): boolean {
        return this.hasRoom && this.canRender(request);
    }

    /** True if the panel can render the request, given room. */
    canRender(request: ChatSidePanelRequest): boolean {
        switch (request?.type) {
            case 'document':
                return !!this.documentRenderer;
            default:
                // TODO(D69): tables and charts render in the side panel once the generative UI
                // package supplies their renderers.
                return false;
        }
    }

    @action
    open(request: ChatSidePanelRequest, opener: HTMLElement = null) {
        this.request = request;
        this.documentStatus = null;
        this.opener = opener;
    }

    /** Close the panel, and return focus to the element that opened it. */
    @action
    close() {
        const {opener} = this;
        this.request = null;
        this.documentStatus = null;
        this.opener = null;
        focusElement(opener);
    }

    /**
     * Return to the element that opened the request - scrolled into view and focused - and leave
     * the panel open.
     */
    back() {
        const {opener} = this;
        if (!opener?.isConnected) return;
        opener.scrollIntoView?.({block: 'nearest'});
        focusElement(opener);
    }

    /** Record the viewer's progress with the open document, for the panel's status strip. */
    @action
    setDocumentStatus(status: ChatDocumentStatus) {
        this.documentStatus = status;
    }

    //------------------
    // Implementation
    //------------------
    private readonly hasRoomFn: () => boolean;
}

function focusElement(el: HTMLElement) {
    if (el?.isConnected) el.focus({preventScroll: false});
}
