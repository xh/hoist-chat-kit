import type {ReactNode} from 'react';
import {img, span} from '@xh/hoist/cmp/layout';
import {HoistModel} from '@xh/hoist/core';
import {Icon} from '@xh/hoist/icon';
import {action, observable, untracked} from '@xh/hoist/mobx';
import {type ChatImagePolicy, isChatImageAllowed} from '../../../../cmp/markdown';
import {type ChatSidePanelHost, type ChatSourcePart, isChatSidePanelHost} from '../../../../core';
import {
    getSourceFileName,
    getSourceType,
    isWebUrl,
    openChatSource,
    toDocumentRequest
} from '../../../../impl/sources';
import {formatHost} from './ChatFormat';

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

    /** The chat's image policy, for favicons. */
    allowImages: ChatImagePolicy = false;

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

type LinkInputs = 'messageId' | 'sidePanel' | 'onSourceClick' | 'allowImages';

/**
 * The icon of a source. A document shows its file-type icon. A web page shows its favicon, from
 * `metadata.favicon`: a `data:` image always shows, and an image URL only if the image policy
 * permits it, as loading it sends a request. Otherwise a letter tile shows, else a globe.
 * @internal
 */
export function sourceIcon(source: ChatSourcePart, allowImages: ChatImagePolicy): ReactNode {
    if (getSourceType(source) === 'document') {
        const fileName = getSourceFileName(source);
        return fileName ? Icon.fileIcon({filename: fileName}) : Icon.file();
    }

    const favicon = source.metadata?.favicon;
    if (isFaviconAllowed(favicon, allowImages)) {
        return img({className: 'xh-chat-favicon', src: favicon, alt: ''});
    }

    const letter = (formatHost(source.url) ?? source.title ?? '').trim().charAt(0).toUpperCase();
    return letter
        ? span({
              className: 'xh-chat-favicon xh-chat-favicon--letter',
              'aria-hidden': true,
              item: letter
          })
        : Icon.globe();
}

/** True if a favicon may load - see {@link sourceIcon}. @internal */
export function isFaviconAllowed(favicon: unknown, allowImages: ChatImagePolicy): boolean {
    if (typeof favicon !== 'string' || !favicon) return false;
    if (favicon.startsWith('data:')) return favicon.startsWith('data:image/');
    return isWebUrl(favicon) && isChatImageAllowed(allowImages, favicon);
}

/**
 * The side panel host above a linked model, or null. Looked up once and untracked, so that a view
 * never re-renders for the empty model slots the lookup passes on its way up.
 * @internal
 */
export function findSidePanel(model: HoistModel): ChatSidePanelHost {
    return untracked(() => model.lookupModel(isChatSidePanelHost)) as unknown as ChatSidePanelHost;
}
