import type {PlainObject} from '@xh/hoist/core';
import type {ChatSourcePart} from './ChatPart';

/**
 * A request to show a document in the side panel - the source a citation or source row opened,
 * and where in it to look.
 */
export interface ChatDocumentRequest {
    type: 'document';

    /** The source to show. */
    source: ChatSourcePart;

    /** The page to open at, if known - from the source's `metadata.page`. */
    page?: number;

    /** The cited passage to find and highlight - the source's excerpt, if it has one. */
    passage?: string;

    /** The number of the citation that opened it, shown on Back as "Back to 2". */
    citation?: number;

    /** Id of the message whose citation opened it, so that its marker shows as active. */
    messageId?: string;
}

/**
 * A request to show a result table in the side panel.
 * TODO(D69): rendered by the generative UI package.
 */
export interface ChatTableRequest {
    type: 'table';

    /** Id of the result set, in the chat's artifact registry. */
    artifactId: string;

    /** How to show it, such as its columns and sort. */
    view?: PlainObject;
}

/**
 * A request to show a chart in the side panel.
 * TODO(D69): rendered by the generative UI package.
 */
export interface ChatChartRequest {
    type: 'chart';

    /** Id of the result set, in the chat's artifact registry. */
    artifactId: string;

    /** How to show it, such as its series and axes. */
    view?: PlainObject;
}

/** What the side panel can show - see {@link ChatSidePanelHost}. */
export type ChatSidePanelRequest = ChatDocumentRequest | ChatTableRequest | ChatChartRequest;

/**
 * What a component needs to open content in the chat's side panel: the one open request, a check
 * that a request can open now, and open and close. `ChatSidePanelModel` implements it, and
 * `ChatWorkspace` publishes one for the components in its conversation.
 *
 * A component finds the host in Hoist's model context - see {@link isChatSidePanelHost} - so an
 * app with its own layout can publish its own `ChatSidePanelModel`, or any `HoistModel` that
 * implements this interface, above the chat.
 */
export interface ChatSidePanelHost {
    /** Marks the host, for lookup in model context. */
    readonly isChatSidePanelHost: true;

    /** The request the panel shows, or null. (observable) */
    readonly request: ChatSidePanelRequest;

    /** True if the panel has room to show beside the chat now. (observable) */
    readonly hasRoom: boolean;

    /** True if the panel can render the request, given room - for a document, a viewer. */
    canRender(request: ChatSidePanelRequest): boolean;

    /** True if the panel can show the request now: it can render the request, and has room. */
    canOpen(request: ChatSidePanelRequest): boolean;

    /**
     * Show a request, in place of the one open. `opener` is the element that opened it, such as a
     * citation marker. Back and close return focus to it.
     */
    open(request: ChatSidePanelRequest, opener?: HTMLElement): void;

    /** Close the panel. */
    close(): void;
}

/**
 * True if a model is a {@link ChatSidePanelHost}. Pass it to Hoist's `useContextModel()` to find
 * the host above a component.
 */
export function isChatSidePanelHost(model: unknown): boolean {
    return (model as ChatSidePanelHost)?.isChatSidePanelHost === true;
}
