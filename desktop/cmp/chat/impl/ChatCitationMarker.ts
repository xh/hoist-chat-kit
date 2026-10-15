import {compact} from 'lodash';
import type {FocusEvent, KeyboardEvent, MouseEvent, ReactNode} from 'react';
import {useLayoutEffect} from 'react';
import {span} from '@xh/hoist/cmp/layout';
import {hoistCmp, HoistModel, type HoistProps, useLocalModel} from '@xh/hoist/core';
import {button} from '@xh/hoist/desktop/cmp/button';
import {Icon} from '@xh/hoist/icon';
import {action, observable} from '@xh/hoist/mobx';
import {createObservableRef} from '@xh/hoist/utils/react';
import type {ChatCitedSource} from '../../../../cmp/markdown';
import type {ChatSourcePart} from '../../../../core';
import {classNames} from '../../../../impl/ClassNames';
import {htmlButton, htmlMark} from '../../../../impl/HtmlTags';
import {genChatId} from '../../../../impl/ids';
import {
    getExcerpt,
    getSourceFileName,
    getSourcePage,
    getSourceType,
    trimExcerpt
} from '../../../../impl/sources';
import '../../../../styles/vars.scss';
import './ChatCitationMarker.scss';
import {chatCopyButton} from './ChatCopyButton';
import {formatHost} from './ChatFormat';
import {type ChatSourceLinks, sourceIcon} from './ChatSourceLinks';

interface ChatCitationMarkerProps extends HoistProps {
    /** The number that cites the source. */
    number: number;

    /** The cited source. */
    source: ChatSourcePart;

    /** The passage the citation quotes, highlighted in the card's excerpt if the excerpt holds it. */
    passage?: string;

    /** How the message opens its sources. */
    links: ChatSourceLinks;
}

/**
 * A citation marker - a numbered pill in the text - with the source's card, which opens on hover
 * after 300 ms or at once on focus, and shows the source's title, meta and excerpt, with Open and
 * Copy Excerpt.
 *
 * A click on a document's marker opens it, in the side panel when one is in reach. A click on a
 * web page's marker pins its card - its Open Link opens a new tab - and a Ctrl or Cmd click opens
 * the page at once. Esc closes the card and keeps focus on the marker. The card renders next to
 * the marker in the DOM, so Tab moves into its buttons and then on to the next marker.
 * @internal
 */
export const chatCitationMarker = hoistCmp.factory<ChatCitationMarkerProps>({
    displayName: 'ChatCitationMarker',

    render({number, source, passage, links}) {
        const impl = useLocalModel(CardLocalModel),
            label = getAccessibleLabel(source, number),
            isDocument = getSourceType(source) === 'document',
            canPress = isDocument && links.opensInPanel(source),
            isActive = links.isActive(number);
        usePlacement(impl);

        return markerWrap(impl, links, number, [
            htmlButton({
                key: 'marker',
                ref: impl.markerRef,
                type: 'button',
                className: classNames('xh-chat-citation-marker', {
                    'xh-chat-citation-marker--open': impl.isOpen,
                    'xh-chat-citation-marker--active': isActive,
                    'xh-chat-citation-marker--highlight':
                        !impl.isOpen && links.hoveredNumber === number
                }),
                'aria-label': label,
                'aria-pressed': canPress ? isActive : undefined,
                'aria-describedby': impl.isOpen ? impl.cardId : undefined,
                onFocus: () => impl.openNow(),
                onClick: (e: MouseEvent<HTMLButtonElement>) => {
                    const newTab = e.ctrlKey || e.metaKey;
                    if (newTab || (isDocument && links.canOpen(source))) {
                        if (newTab) e.preventDefault();
                        impl.close();
                        links.open(source, {citation: number, opener: e.currentTarget, newTab});
                    } else {
                        impl.togglePin();
                    }
                },
                item: String(number)
            }),
            impl.isOpen ? sourceCard({key: 'card', impl, number, source, passage, links}) : null
        ]);
    }
});

interface ChatCitationGroupMarkerProps extends HoistProps {
    /** The cited sources, with their numbers, in order. */
    cited: ChatCitedSource[];

    /** How the message opens its sources. */
    links: ChatSourceLinks;
}

/**
 * The one marker that stands for four or more sources, labeled "2–5". Its card lists them all,
 * each one a button that opens it. A click pins the card.
 * @internal
 */
export const chatCitationGroupMarker = hoistCmp.factory<ChatCitationGroupMarkerProps>({
    displayName: 'ChatCitationGroupMarker',

    render({cited, links}) {
        const impl = useLocalModel(CardLocalModel),
            first = cited[0].number,
            last = cited[cited.length - 1].number;
        usePlacement(impl);

        return markerWrap(impl, links, null, [
            htmlButton({
                key: 'marker',
                ref: impl.markerRef,
                type: 'button',
                className: classNames('xh-chat-citation-marker', 'xh-chat-citation-marker--group', {
                    'xh-chat-citation-marker--open': impl.isOpen,
                    'xh-chat-citation-marker--active': cited.some(it => links.isActive(it.number))
                }),
                'aria-label': `Sources ${first} to ${last}`,
                'aria-describedby': impl.isOpen ? impl.cardId : undefined,
                onFocus: () => impl.openNow(),
                onClick: () => impl.togglePin(),
                item: `${first}–${last}`
            }),
            impl.isOpen
                ? span({
                      key: 'card',
                      ...cardProps(impl, `Sources ${first} to ${last}`),
                      items: cited.map(({number, source}) =>
                          span({
                              key: number,
                              className: 'xh-chat-source-card__head',
                              items: [
                                  numberPill(number),
                                  span({
                                      className: 'xh-chat-source-card__icon',
                                      item: sourceIcon(source, links.allowImages)
                                  }),
                                  links.canOpen(source)
                                      ? htmlButton({
                                            type: 'button',
                                            className:
                                                'xh-chat-source-card__title xh-chat-source-card__link',
                                            onClick: () => {
                                                impl.close();
                                                links.open(source, {
                                                    citation: number,
                                                    opener: impl.markerRef.current
                                                });
                                            },
                                            item: getTitle(source)
                                        })
                                      : span({
                                            className: 'xh-chat-source-card__title',
                                            item: getTitle(source)
                                        })
                              ]
                          })
                      )
                  })
                : null
        ]);
    }
});

//------------------
// Implementation
//------------------
// Hover opens a card after this delay. Leaving the marker and the card closes it after another.
const OPEN_DELAY_MS = 300,
    CLOSE_DELAY_MS = 150,
    // A card flips above its marker when less than this remains below it.
    FLIP_BELOW_PX = 280,
    // A card stays this far inside the thread's edges.
    EDGE_PX = 8;

class CardLocalModel extends HoistModel {
    override xhImpl = true;

    @observable accessor isOpen = false;
    @observable accessor isPinned = false;

    /** Where the card shows: above or below the marker, and its shift left to stay in view. */
    @observable accessor isAbove = false;
    @observable accessor shift = 0;

    readonly cardId = `xh-chat-source-card-${genChatId()}`;
    readonly markerRef = createObservableRef<HTMLButtonElement>();
    readonly wrapRef = createObservableRef<HTMLSpanElement>();

    /** Open on hover, after the delay. */
    hoverIn() {
        clearTimeout(this.closeTimer);
        if (!this.isOpen) this.openTimer = setTimeout(() => this.openNow(), OPEN_DELAY_MS);
    }

    /** Close after the pointer leaves the marker and its card, unless pinned. */
    hoverOut() {
        clearTimeout(this.openTimer);
        if (this.isOpen && !this.isPinned) {
            this.closeTimer = setTimeout(() => this.close(), CLOSE_DELAY_MS);
        }
    }

    @action
    openNow() {
        clearTimeout(this.openTimer);
        clearTimeout(this.closeTimer);
        if (openCard && openCard !== this) openCard.close();
        openCard = this;
        this.isOpen = true;
    }

    @action
    close() {
        clearTimeout(this.openTimer);
        clearTimeout(this.closeTimer);
        if (openCard === this) openCard = null;
        this.isOpen = false;
        this.isPinned = false;
        this.removeOutsideListener();
    }

    @action
    togglePin() {
        if (this.isPinned) {
            this.close();
            return;
        }
        this.openNow();
        this.isPinned = true;
        this.addOutsideListener();
    }

    @action
    setPlacement(isAbove: boolean, shift: number) {
        this.isAbove = isAbove;
        this.shift = shift;
    }

    onKeyDown = (e: KeyboardEvent) => {
        if (e.key !== 'Escape' || !this.isOpen) return;
        // Handled here, so that Esc does not also stop the reply or close the side panel.
        e.preventDefault();
        e.stopPropagation();
        this.close();
        this.markerRef.current?.focus();
    };

    onBlur = (e: FocusEvent) => {
        const next = e.relatedTarget as Node;
        if (!this.isPinned && !this.wrapRef.current?.contains(next)) this.close();
    };

    override destroy() {
        this.close();
        super.destroy();
    }

    private openTimer: ReturnType<typeof setTimeout>;
    private closeTimer: ReturnType<typeof setTimeout>;
    private outsideListener: (e: Event) => void = null;

    private addOutsideListener() {
        if (this.outsideListener) return;
        this.outsideListener = e => {
            if (!this.wrapRef.current?.contains(e.target as Node)) this.close();
        };
        document.addEventListener('mousedown', this.outsideListener, true);
    }

    private removeOutsideListener() {
        if (!this.outsideListener) return;
        document.removeEventListener('mousedown', this.outsideListener, true);
        this.outsideListener = null;
    }
}

// The one card open, across all messages.
let openCard: CardLocalModel = null;

// The marker and its card share one wrapper, so that the pointer can move from one to the other -
// across the gap between them - without closing the card.
function markerWrap(
    impl: CardLocalModel,
    links: ChatSourceLinks,
    number: number,
    items: ReactNode[]
): ReactNode {
    return span({
        ref: impl.wrapRef,
        className: 'xh-chat-citation-marker-wrap',
        onMouseEnter: () => {
            impl.hoverIn();
            if (number != null) links.setHoveredNumber(number);
        },
        onMouseLeave: () => {
            impl.hoverOut();
            if (number != null && links.hoveredNumber === number) links.setHoveredNumber(null);
        },
        onKeyDown: impl.onKeyDown,
        onBlur: impl.onBlur,
        items
    });
}

// Place an open card below its marker, or above it near the bottom of the thread, and keep it
// inside the thread's edges.
function usePlacement(impl: CardLocalModel) {
    const {isOpen} = impl;
    useLayoutEffect(() => {
        const wrap = impl.wrapRef.current;
        if (!isOpen || !wrap) return;

        const rect = wrap.getBoundingClientRect(),
            bounds = getScrollParent(wrap)?.getBoundingClientRect(),
            width = wrap.querySelector('.xh-chat-source-card')?.getBoundingClientRect().width ?? 0;
        if (!bounds || !bounds.height) {
            impl.setPlacement(false, 0);
            return;
        }

        const isAbove =
                bounds.bottom - rect.bottom < FLIP_BELOW_PX &&
                rect.top - bounds.top > FLIP_BELOW_PX,
            overflow = rect.left + width - (bounds.right - EDGE_PX),
            shift = overflow > 0 ? Math.min(overflow, rect.left - bounds.left - EDGE_PX) : 0;
        impl.setPlacement(isAbove, Math.max(0, shift));
    }, [impl, isOpen]);
}

function getScrollParent(el: HTMLElement): HTMLElement {
    for (let node = el.parentElement; node; node = node.parentElement) {
        const {overflowY} = window.getComputedStyle(node);
        if (overflowY === 'auto' || overflowY === 'scroll') return node;
    }
    return document.documentElement;
}

function cardProps(impl: CardLocalModel, label: string) {
    return {
        id: impl.cardId,
        className: classNames('xh-chat-source-card', {
            'xh-chat-source-card--above': impl.isAbove
        }),
        role: 'group',
        'aria-label': label,
        style: impl.shift ? {marginLeft: -impl.shift} : undefined
    };
}

interface SourceCardProps extends HoistProps {
    impl: CardLocalModel;
    number: number;
    source: ChatSourcePart;
    passage: string;
    links: ChatSourceLinks;
}

// The card's text comes from the message alone: nothing is fetched on hover.
const sourceCard = hoistCmp.factory<SourceCardProps>({
    displayName: 'ChatSourceCard',
    model: false,

    render({impl, number, source, passage, links}) {
        const isDocument = getSourceType(source) === 'document',
            meta = getSourceMeta(source),
            excerpt = getExcerpt(source),
            canOpen = links.canOpen(source);

        return span({
            ...cardProps(impl, `Source ${number}`),
            items: [
                span({
                    className: 'xh-chat-source-card__head',
                    items: [
                        numberPill(number),
                        span({
                            className: 'xh-chat-source-card__icon',
                            item: sourceIcon(source, links.allowImages)
                        }),
                        span({className: 'xh-chat-source-card__title', item: getTitle(source)})
                    ]
                }),
                meta.length
                    ? span({className: 'xh-chat-source-card__meta', item: meta.join(' · ')})
                    : null,
                excerpt ? excerptText(excerpt, passage, 'xh-chat-source-card__excerpt') : null,
                canOpen || excerpt
                    ? span({
                          className: 'xh-chat-source-card__foot',
                          items: [
                              canOpen
                                  ? button({
                                        icon: isDocument ? Icon.search() : Icon.openExternal(),
                                        text: isDocument ? 'Open Passage' : 'Open Link',
                                        onClick: () => {
                                            const opener = impl.markerRef.current;
                                            impl.close();
                                            links.open(source, {citation: number, opener});
                                        }
                                    })
                                  : null,
                              excerpt
                                  ? chatCopyButton({
                                        showText: true,
                                        label: 'Copy Excerpt',
                                        getCopyText: () => excerpt
                                    })
                                  : null
                          ]
                      })
                    : null
            ]
        });
    }
});

/**
 * An excerpt, trimmed to 300 characters at word boundaries, with the cited passage highlighted.
 * @internal
 */
export function excerptText(excerpt: string, passage: string, className: string): ReactNode {
    const {before, passage: cited, after} = trimExcerpt(excerpt, passage);
    return span({
        className,
        items: [
            before,
            cited ? htmlMark({key: 'passage', className: 'xh-chat-passage', item: cited}) : null,
            after
        ]
    });
}

/** The meta line of a source: its file name and page, or its host - only what it has. @internal */
export function getSourceMeta(source: ChatSourcePart): string[] {
    if (getSourceType(source) === 'url') return compact([formatHost(source.url)]);
    const page = getSourcePage(source);
    return compact([getSourceFileName(source), page != null ? `p. ${page}` : null]);
}

function numberPill(number: number): ReactNode {
    return span({className: 'xh-chat-source-card__number', 'aria-hidden': true, item: number});
}

function getTitle(source: ChatSourcePart): string {
    return source.title || formatHost(source.url) || getSourceFileName(source) || 'Untitled';
}

// "Source 1: Credit Guidelines v4, page 41".
function getAccessibleLabel(source: ChatSourcePart, number: number): string {
    const page = getSourcePage(source),
        title = getTitle(source);
    return `Source ${number}: ${page != null ? `${title}, page ${page}` : title}`;
}
