import {isFinite} from 'lodash';
import type {KeyboardEvent, ReactNode} from 'react';
import {errorMessage} from '@xh/hoist/cmp/error';
import {div, span} from '@xh/hoist/cmp/layout';
import {mask} from '@xh/hoist/cmp/mask';
import {hoistCmp, HoistModel, type HoistProps, useLocalModel, uses} from '@xh/hoist/core';
import {button} from '@xh/hoist/desktop/cmp/button';
import {panel, type PanelProps} from '@xh/hoist/desktop/cmp/panel';
import {toolbarSep} from '@xh/hoist/desktop/cmp/toolbar';
import {Icon} from '@xh/hoist/icon';
import {action, observable} from '@xh/hoist/mobx';
import {
    type ChatDocumentError,
    type ChatDocumentRequest,
    type ChatDocumentStatus,
    ChatSidePanelModel
} from '../../../core';
import {getSourceFileName, isWebUrl, openSourceUrl} from '../../../impl/sources';
import {chatUiChartView} from '../genui/ChatUiChartView';
import {chatUiTableView} from '../genui/ChatUiTableView';
import '../../../styles/vars.scss';
import './ChatSidePanel.scss';
import {chatCopyButton} from './impl/ChatCopyButton';
import {formatHost} from './impl/ChatFormat';
import {chatSpinner} from './impl/ChatLiveCues';

/** Props for {@link ChatSidePanel}. */
export interface ChatSidePanelProps extends HoistProps<ChatSidePanelModel> {
    /**
     * Props for the frame's Hoist `Panel`, such as a `PanelModel` that sizes it beside the chat.
     * The frame sets the title, icon, header items, toolbar and content.
     */
    panelProps?: Omit<PanelProps, 'title' | 'icon' | 'headerItems' | 'tbar' | 'item' | 'items'>;
}

/**
 * The frame of the side panel's open request: a Hoist `Panel` with the request's title, Close, a
 * toolbar with Back, and the content. Renders nothing with no request open, or one it cannot
 * render.
 *
 * A table renders as the full Hoist grid of a result card, which pages through the artifact - see
 * `ChatUiTableView`. A chart renders as the expanded chart, with switchers for its type and axes -
 * see `ChatUiChartView`.
 *
 * For a document, the content is the app's `documentRenderer`, and the frame shows the viewer's
 * progress, as the viewer reports it with `setDocumentStatus()`: a mask while the document opens,
 * a status strip under the toolbar while it locates the passage or could not, the page if the
 * viewer reports one, and a failure with only the actions that can work. The kit draws no
 * document itself.
 *
 * Back returns focus to the citation that opened the request, and leaves the panel open. Close -
 * or Esc with focus in the panel - closes it and returns focus to the citation. Alt+Left is Back.
 */
export const [ChatSidePanel, chatSidePanel] = hoistCmp.withFactory<ChatSidePanelProps>({
    displayName: 'ChatSidePanel',
    model: uses(ChatSidePanelModel),
    className: 'xh-chat-side-panel',

    render({model, className, panelProps}, ref) {
        const {request} = model;
        if (!request || !model.canRender(request)) return null;

        let label: string, item: ReactNode;
        switch (request.type) {
            case 'document':
                label = getTitle(request) ?? 'Document';
                item = documentFrame({model, request, panelProps});
                break;
            case 'table':
                label = request.title || 'Table';
                item = chatUiTableView({
                    // A new request starts a new grid.
                    key: getRequestKey(request),
                    request,
                    tbarItems: [backButton(model)],
                    panelProps: {
                        ...panelProps,
                        title: label,
                        icon: Icon.grid(),
                        headerItems: [closeButton(model)]
                    }
                });
                break;
            case 'chart':
                label = request.title || 'Chart';
                item = chatUiChartView({
                    key: getRequestKey(request),
                    request,
                    tbarItems: [backButton(model)],
                    panelProps: {
                        ...panelProps,
                        title: label,
                        icon: Icon.chartLine(),
                        headerItems: [closeButton(model)]
                    }
                });
                break;
        }

        return div({
            ref,
            className,
            role: 'complementary',
            'aria-label': label,
            onKeyDown: (e: KeyboardEvent) => onFrameKeyDown(e, model),
            item
        });
    }
});

//------------------
// Implementation
//------------------
// After this long opening, the mask says it is still opening.
const STILL_OPENING_MS = 10_000;

class DocumentFrameLocalModel extends HoistModel {
    override xhImpl = true;

    @observable accessor isSlow = false;

    override onLinked() {
        const panelModel = this.componentProps.model as ChatSidePanelModel;
        this.addReaction({
            track: () => [panelModel.request, panelModel.documentStatus?.state],
            run: ([, state]) => {
                clearTimeout(this.timer);
                this.setSlow(false);
                if (state === 'opening') {
                    this.timer = setTimeout(() => this.setSlow(true), STILL_OPENING_MS);
                }
            },
            fireImmediately: true
        });
    }

    @action
    setSlow(isSlow: boolean) {
        this.isSlow = isSlow;
    }

    override destroy() {
        clearTimeout(this.timer);
        super.destroy();
    }

    private timer: ReturnType<typeof setTimeout>;
}

interface DocumentFrameProps extends HoistProps {
    model: ChatSidePanelModel;
    request: ChatDocumentRequest;
    panelProps: ChatSidePanelProps['panelProps'];
}

const documentFrame = hoistCmp.factory<DocumentFrameProps>({
    displayName: 'ChatDocumentFrame',

    render({model, request, panelProps}) {
        const impl = useLocalModel(DocumentFrameLocalModel),
            {source, citation, passage} = request,
            status = model.documentStatus,
            state = status?.state,
            title = getTitle(request),
            isError = state === 'error';

        return panel({
            ...panelProps,
            title,
            icon: getSourceFileName(source)
                ? Icon.fileIcon({filename: getSourceFileName(source)})
                : Icon.file(),
            headerItems: [
                !isError && isWebUrl(source.url)
                    ? button({
                          key: 'newTab',
                          icon: Icon.openExternal(),
                          tooltip: 'Open in New Tab',
                          'aria-label': 'Open in New Tab',
                          onClick: () => openSourceUrl(source)
                      })
                    : null,
                closeButton(model)
            ],
            tbar: [backButton(model, citation), ...pageItems(status)],
            mask:
                state === 'opening'
                    ? mask({
                          isDisplayed: true,
                          spinner: false,
                          message: span({
                              className: 'xh-chat-side-panel__opening',
                              items: [
                                  chatSpinner(),
                                  impl.isSlow && status.size != null
                                      ? `Still opening (${formatSize(status.size)})…`
                                      : impl.isSlow
                                        ? 'Still opening…'
                                        : 'Opening document…'
                              ]
                          })
                      })
                    : null,
            items: [
                statusStrip(status, passage),
                div({
                    className: 'xh-chat-side-panel__body',
                    items: [
                        // One viewer per document, so a new passage of it does not reload it.
                        div({
                            key: source.id,
                            className: 'xh-chat-side-panel__content',
                            'aria-hidden': isError || undefined,
                            item: model.documentRenderer(request, model)
                        }),
                        isError ? errorView(status.error, title) : null
                    ]
                }),
                span({
                    className: 'xh-chat-side-panel__live',
                    role: 'status',
                    item: getAnnouncement(status, title)
                })
            ]
        });
    }
});

// A key for each request opened, so that a new one mounts a new view.
const requestKeys = new WeakMap<object, number>();
let lastRequestKey = 0;
function getRequestKey(request: object): number {
    if (!requestKeys.has(request)) requestKeys.set(request, ++lastRequestKey);
    return requestKeys.get(request);
}

function backButton(model: ChatSidePanelModel, citation: number = null): ReactNode {
    return button({
        key: 'back',
        icon: Icon.arrowLeft(),
        text: citation != null ? `Back to ${citation}` : 'Back',
        disabled: !model.canGoBack,
        onClick: () => model.back()
    });
}

function closeButton(model: ChatSidePanelModel): ReactNode {
    return button({
        key: 'close',
        icon: Icon.close(),
        tooltip: 'Close',
        'aria-label': 'Close',
        onClick: () => model.close()
    });
}

function getTitle({source}: ChatDocumentRequest): string {
    return source.title || getSourceFileName(source) || formatHost(source.url) || null;
}

function onFrameKeyDown(e: KeyboardEvent, model: ChatSidePanelModel) {
    if (e.defaultPrevented) return;
    if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        model.close();
    } else if (e.key === 'ArrowLeft' && e.altKey) {
        e.preventDefault();
        model.back();
    }
}

// Under the toolbar, never over the page, so the document stays readable while the viewer is
// unsure. None while opening, once located, or with no status.
function statusStrip(status: ChatDocumentStatus, passage: string): ReactNode {
    const copy = passage
        ? chatCopyButton({showText: true, label: 'Copy Excerpt', getCopyText: () => passage})
        : null;

    switch (status?.state) {
        case 'locating':
            return strip('busy', [chatSpinner(), STRIP_TEXT.locating]);
        case 'likelyPage':
            return strip('info', [Icon.info(), STRIP_TEXT.likelyPage, copy]);
        case 'notLocated':
            return strip('warning', [Icon.warning(), STRIP_TEXT.notLocated, copy]);
        default:
            return null;
    }
}

function strip(kind: string, items: ReactNode[]): ReactNode {
    return div({
        className: `xh-chat-side-panel__strip xh-chat-side-panel__strip--${kind}`,
        items: items.map((item, idx) =>
            typeof item === 'string'
                ? span({key: idx, className: 'xh-chat-side-panel__strip-text', item})
                : item
        )
    });
}

const STRIP_TEXT = {
    locating: 'Locating passage…',
    likelyPage: 'Opened the most likely page.',
    notLocated: "Couldn't locate the passage. Showing from the start."
};

// A failure says why, and offers only what can work: Download for a file that arrived but cannot
// show, else Retry - but never Retry for a 4xx, which a retry cannot fix.
function errorView(error: ChatDocumentError, title: string): ReactNode {
    const {httpStatus, retry, download} = error ?? {},
        isClientError = httpStatus >= 400 && httpStatus < 500,
        canRetry = !!retry && !isClientError;

    return div({
        className: 'xh-chat-side-panel__error',
        role: 'alert',
        item: errorMessage({
            error: error ?? {},
            title: title ? `Couldn't open ${title}` : "Couldn't open the document",
            message: error?.message ?? getErrorText(httpStatus),
            actionFn: download ? () => download() : canRetry ? () => retry() : null,
            actionButtonProps: download
                ? {text: 'Download', icon: Icon.download()}
                : canRetry
                  ? {text: 'Retry', icon: Icon.refresh()}
                  : null
        })
    });
}

function getErrorText(httpStatus: number): string {
    if (httpStatus === 403) return "You don't have access to this document.";
    if (httpStatus === 404) return 'This document no longer exists.';
    if (httpStatus >= 500) return `The documents service returned ${httpStatus}.`;
    return 'The document could not be opened.';
}

// What a screen reader hears as the state changes. Nothing while locating, which is quick. A
// failure announces through its alert.
function getAnnouncement(status: ChatDocumentStatus, title: string): string {
    switch (status?.state) {
        case 'opening':
            return title ? `Opening ${title}` : 'Opening document';
        case 'located':
            return isFinite(status.page) ? `Passage on page ${status.page}` : 'Passage located';
        case 'likelyPage':
            return STRIP_TEXT.likelyPage;
        case 'notLocated':
            return STRIP_TEXT.notLocated;
        default:
            return '';
    }
}

// The page, only once the viewer reports one - a document without pages shows none.
function pageItems(status: ChatDocumentStatus): ReactNode[] {
    const {page, pageCount} = status ?? {};
    if (!isFinite(page)) return [];

    return [
        toolbarSep({key: 'pageSep'}),
        span({
            key: 'page',
            className: 'xh-chat-side-panel__page',
            item: isFinite(pageCount) ? `Page ${page} of ${pageCount}` : `Page ${page}`
        })
    ];
}

function formatSize(bytes: number): string {
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
