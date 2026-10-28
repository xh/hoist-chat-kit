import type {ReactNode} from 'react';
import {HoistModel} from '@xh/hoist/core';
import {Icon} from '@xh/hoist/icon';
import {action, observable, untracked} from '@xh/hoist/mobx';
import {type ChatSidePanelHost, type ChatSourcePart, isChatSidePanelHost} from '../../../../core';
import {
    getSourceFileName,
    getSourceType,
    isWebUrl,
    openChatSource,
    toDocumentRequest
} from '../../../../impl/sources';

/**
 * How the citations and sources list of one message open their sources, and what they share: the
 * number the pointer is over, so that a marker and its row highlight together, and the side panel
 * that shows documents.
 * @internal
 */
export class ChatSourceLinks extends HoistModel {
    override xhImpl = true;

    /** The citation number the pointer is over - in the text or the sources list - or null. */
    @observable accessor hoveredNumber: number = null;

    /** Id of the message. */
    messageId: string = null;

    /** The side panel in reach, or null. */
    sidePanel: ChatSidePanelHost = null;

    /** The app's handler for a source click, or null for the default. */
    onSourceClick: (source: ChatSourcePart) => void = null;

    /** Set the links' inputs - called as the component that owns them renders. */
    configure(opts: Partial<Pick<ChatSourceLinks, LinkInputs>>) {
        Object.assign(this, opts);
    }

    @action
    setHoveredNumber(number: number) {
        this.hoveredNumber = number;
    }

    /** Open a source, as a click on its marker or row does. */
    open(
        source: ChatSourcePart,
        opts: {citation?: number; opener?: HTMLElement; newTab?: boolean} = {}
    ) {
        openChatSource(source, {
            ...opts,
            messageId: this.messageId,
            sidePanel: this.sidePanel,
            onSourceClick: this.onSourceClick
        });
    }

    /** True if a click can open the source somewhere - so that the kit offers only what works. */
    canOpen(source: ChatSourcePart): boolean {
        if (this.onSourceClick || isWebUrl(source.url)) return true;
        return getSourceType(source) === 'document' && this.opensInPanel(source);
    }

    /** True if the source is a document that opens in the side panel now. */
    opensInPanel(source: ChatSourcePart): boolean {
        return (
            getSourceType(source) === 'document' &&
            !!this.sidePanel?.canOpen(toDocumentRequest(source))
        );
    }

    /**
     * True if a click on the source opens its URL in a new tab: a web page, or a document the
     * side panel cannot show, with no `onSourceClick` to take either.
     */
    opensInNewTab(source: ChatSourcePart): boolean {
        return !this.onSourceClick && isWebUrl(source.url) && !this.opensInPanel(source);
    }

    /** True if the side panel shows the passage that this message cites with `number`. */
    isActive(number: number): boolean {
        const request = this.sidePanel?.request;
        return (
            request?.type === 'document' &&
            request.messageId === this.messageId &&
            request.citation === number
        );
    }
}

type LinkInputs = 'messageId' | 'sidePanel' | 'onSourceClick';

/**
 * The icon of a source: a document's file-type icon, or a globe for a web page. The kit loads no
 * image for a source, so a source list sends no request of its own.
 * @internal
 */
export function sourceIcon(source: ChatSourcePart): ReactNode {
    if (getSourceType(source) === 'url') return Icon.globe();
    const fileName = getSourceFileName(source);
    return fileName ? Icon.fileIcon({filename: fileName}) : Icon.file();
}

/**
 * The side panel host above a linked model, or null. Looked up once and untracked, so that a view
 * never re-renders for the empty model slots the lookup passes on its way up.
 * @internal
 */
export function findSidePanel(model: HoistModel): ChatSidePanelHost {
    return untracked(() => model.lookupModel(isChatSidePanelHost)) as unknown as ChatSidePanelHost;
}
