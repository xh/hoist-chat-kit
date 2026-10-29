import {type MouseEvent, type ReactNode, useEffect, useId} from 'react';
import {div, li, ol, span} from '@xh/hoist/cmp/layout';
import {creates, hoistCmp, HoistModel, type HoistProps, managed} from '@xh/hoist/core';
import {button} from '@xh/hoist/desktop/cmp/button';
import {Icon} from '@xh/hoist/icon';
import {action, observable, observableRef} from '@xh/hoist/mobx';
import {pluralize} from '@xh/hoist/utils/js';
import type {ChatSidePanelHost, ChatSourcePart} from '../../../core';
import {classNames} from '../../../impl/ClassNames';
import {htmlButton} from '../../../impl/HtmlTags';
import {getExcerpt, getSourceType} from '../../../impl/sources';
import '../../../styles/vars.scss';
import './ChatSources.scss';
import {excerptText, getSourceMeta} from './impl/ChatCitationMarker';
import {formatHost} from './impl/ChatFormat';
import {ChatSourceLinks, findSidePanel, sourceIcon} from './impl/ChatSourceLinks';

/** Props for {@link ChatSources}. */
export interface ChatSourcesProps extends HoistProps {
    /**
     * Sources cited by the reply, in the order of their numbers. Each shows its `marker`, else its
     * position, so the numbers match the citations in the text. They never renumber.
     */
    sources: ChatSourcePart[];

    /** Heading above the rows. Default 'Sources'. */
    title?: string;

    /**
     * True to start with the list closed at its heading, until the user opens it. Default
     * `ChatSources.defaults.startCollapsed`.
     */
    startCollapsed?: boolean;

    /**
     * Rows to show before "Show N More", or null to show every row. Default
     * `ChatSources.defaults.visibleRows`.
     */
    visibleRows?: number;

    /**
     * True for one dense line per row: number, icon, title and meta. False for a roomier list in
     * a frame, with an icon tile and the meta line under the title. Default
     * `ChatSources.defaults.compact`.
     */
    compact?: boolean;

    /**
     * True to show each row's number. False for a reply whose text cites no sources, where the
     * numbers would point at nothing. Default `ChatSources.defaults.showNumbers`.
     */
    showNumbers?: boolean;

    /**
     * True to mark each row that opens a new tab with an external-link icon, before its host.
     * Default `ChatSources.defaults.showExternalIcon`.
     */
    showExternalIcon?: boolean;

    /**
     * Called when the user clicks a source. By default a document opens in the side panel when one
     * is in reach - in a `ChatWorkspace` with a `documentRenderer` - and a web page opens in a new
     * tab. A handler replaces the new tab, and opens a document that the side panel cannot show.
     */
    onSourceClick?: (source: ChatSourcePart) => void;

    /**
     * How the message opens its sources, shared with its citation markers.
     * @internal
     */
    links?: ChatSourceLinks;
}

/** App-wide settings for {@link ChatSources} - see `ChatSources.defaults`. */
export interface ChatSourcesDefaults {
    /**
     * True to start each list closed at its heading. Read as each list renders, so it covers the
     * lists in every reply. Default false.
     */
    startCollapsed: boolean;

    /**
     * Rows a sources list shows before "Show N More", or null to show every row. Read as each
     * list renders, so it covers the lists in every reply. Default 3.
     */
    visibleRows: number;

    /**
     * True for the dense one-line rows, false for the roomier list. Read as each list renders, so
     * it covers the lists in every reply. Default true.
     */
    compact: boolean;

    /** True to show each row's number. Read as each list renders. Default true. */
    showNumbers: boolean;

    /**
     * True to mark each row that opens a new tab with an external-link icon. Read as each list
     * renders. Default true.
     */
    showExternalIcon: boolean;
}

/**
 * The sources behind a reply, under its text and above its action bar. A compact list follows a
 * hairline. A roomy one sits in a frame of its own.
 *
 * The heading opens and closes the list, as a tool call's row does. The list starts open - see
 * `startCollapsed`, and `ChatSources.defaults` to set it app-wide. Closed, the heading still gives
 * the count.
 *
 * Rows follow the citation numbers. Each row shows its number, an icon, its title and a meta line.
 * A document shows its file-type icon, file name and page, and opens in the side panel when one is
 * in reach. A web page shows a globe and its host, and opens in a new tab. Three rows show, and
 * the rest sit behind "Show N More" - see `visibleRows`, and `ChatSources.defaults` to set it
 * app-wide.
 *
 * Rows are compact by default: one line each, with the meta line beside the title. Set `compact`
 * false, or `ChatSources.defaults.compact`, for a roomier list in a frame, with an icon tile and
 * the meta line under the title. Set `showNumbers` false for a reply whose text cites no sources.
 * A row that opens a new tab shows an external-link icon before its host - see `showExternalIcon`.
 *
 * The title opens the source. A row with an excerpt expands to show it, on a click on its chevron
 * or anywhere else on the row outside the title. For the keyboard, the title and the chevron are
 * the row's tab stops.
 *
 * Hovering a row highlights its markers in the text, and hovering a marker highlights its row.
 */
export const [ChatSources, chatSources] = hoistCmp.withFactory<
    ChatSourcesProps,
    ChatSourcesDefaults
>({
    displayName: 'ChatSources',
    className: 'xh-chat-sources',
    // Its own model, kept out of context, so that it needs no model above it.
    model: creates(() => new ChatSourcesLocalModel(), {publishMode: 'none'}),
    defaults: {
        startCollapsed: false,
        visibleRows: 3,
        compact: true,
        showNumbers: true,
        showExternalIcon: true
    },

    render(props, ref) {
        const {
                className,
                sources,
                title = 'Sources',
                startCollapsed = ChatSources.defaults.startCollapsed,
                visibleRows = ChatSources.defaults.visibleRows,
                compact = ChatSources.defaults.compact,
                showNumbers = ChatSources.defaults.showNumbers,
                showExternalIcon = ChatSources.defaults.showExternalIcon
            } = props,
            impl = props.model as ChatSourcesLocalModel,
            links = props.links ?? impl.links,
            listId = useId();
        if (!props.links) {
            impl.links.configure({
                sidePanel: impl.sidePanel,
                onSourceClick: props.onSourceClick ?? null
            });
        }
        if (!sources?.length) return null;

        // TODO(design-open B5) - documents and web pages share one numbered sequence.
        const isCollapsed = impl.collapsed ?? startCollapsed,
            {showAll} = impl,
            limit = visibleRows ?? sources.length,
            shown = showAll ? sources : sources.slice(0, limit),
            hidden = sources.length - limit;

        return div({
            ref,
            className: classNames(
                className,
                compact ? 'xh-chat-sources--compact' : 'xh-chat-sources--roomy',
                {
                    'xh-chat-sources--collapsed': isCollapsed,
                    'xh-chat-sources--no-numbers': !showNumbers
                }
            ),
            role: 'region',
            'aria-label': title,
            items: [
                listHead(sources, title, isCollapsed, listId, impl),
                isCollapsed
                    ? null
                    : ol({
                          id: listId,
                          className: 'xh-chat-sources__list',
                          items: shown.map((source, idx) =>
                              sourceRow({
                                  key: source.id,
                                  source,
                                  number: source.marker ?? idx + 1,
                                  showNumber: showNumbers,
                                  showExternalIcon,
                                  compact,
                                  links,
                                  impl
                              })
                          )
                      }),
                !isCollapsed && hidden > 0
                    ? button({
                          // No icon - the heading's chevron is the list's only one.
                          className: 'xh-chat-sources__more',
                          text: showAll ? 'Show Fewer' : `Show ${hidden} More`,
                          'aria-expanded': showAll,
                          onClick: () => impl.setShowAll(!showAll)
                      })
                    : null
            ]
        });
    }
});

//------------------
// Implementation
//------------------
class ChatSourcesLocalModel extends HoistModel {
    override xhImpl = true;

    /** The side panel in reach, for a list shown on its own, or null. */
    sidePanel: ChatSidePanelHost = null;

    override onLinked() {
        this.sidePanel = findSidePanel(this);
    }

    /** Links of a list shown on its own - a message view passes its own. */
    @managed readonly links = new ChatSourceLinks();

    /** True once the user closes the list, false once they open it, or null for `startCollapsed`. */
    @observable accessor collapsed: boolean = null;

    /** True to show every row, past `visibleRows`. */
    @observable accessor showAll = false;

    /** Ids of the rows whose excerpt shows. */
    @observableRef accessor openExcerpts: string[] = [];

    @action
    setCollapsed(collapsed: boolean) {
        this.collapsed = collapsed;
    }

    @action
    setShowAll(showAll: boolean) {
        this.showAll = showAll;
    }

    @action
    toggleExcerpt(id: string) {
        const {openExcerpts} = this;
        this.openExcerpts = openExcerpts.includes(id)
            ? openExcerpts.filter(it => it !== id)
            : [...openExcerpts, id];
    }
}

// The heading is the list's toggle, with its chevron at the end, as on a tool call's row.
function listHead(
    sources: ChatSourcePart[],
    title: string,
    isCollapsed: boolean,
    listId: string,
    impl: ChatSourcesLocalModel
): ReactNode {
    const isWeb = sources.every(it => getSourceType(it) === 'url'),
        count = isWeb ? pluralize('web page', sources.length, true) : String(sources.length);
    return button({
        className: 'xh-chat-sources__head',
        text: span({
            className: 'xh-chat-sources__head-line',
            items: [
                span({className: 'xh-chat-sources__heading', item: title}),
                span({className: 'xh-chat-sources__count', item: `· ${count}`}),
                span({
                    className: 'xh-chat-sources__chevron',
                    item: isCollapsed ? Icon.groupRowCollapsed() : Icon.groupRowExpanded()
                })
            ]
        }),
        'aria-label': `${title}, ${count}`,
        'aria-expanded': !isCollapsed,
        'aria-controls': isCollapsed ? undefined : listId,
        onClick: () => impl.setCollapsed(!isCollapsed)
    });
}

interface SourceRowProps extends HoistProps {
    source: ChatSourcePart;
    number: number;
    showNumber: boolean;
    showExternalIcon: boolean;
    compact: boolean;
    links: ChatSourceLinks;
    impl: ChatSourcesLocalModel;
}

const sourceRow = hoistCmp.factory<SourceRowProps>({
    displayName: 'ChatSourceRow',
    model: false,

    render({source, number, showNumber, showExternalIcon, compact, links, impl}) {
        // A row that closes under the pointer gets no mouseleave, so let go of its highlight here.
        useEffect(
            () => () => {
                if (links.hoveredNumber === number) links.setHoveredNumber(null);
            },
            [links, number]
        );

        const excerpt = getExcerpt(source),
            isExcerptOpen = !!excerpt && impl.openExcerpts.includes(source.id),
            isActive = links.isActive(number),
            opensInNewTab = links.opensInNewTab(source),
            // Before the host: beside the title when compact, so that a long title truncates
            // first, and leading the meta line when roomy, clear of a title that wraps.
            externalIcon =
                showExternalIcon && opensInNewTab
                    ? span({
                          className: 'xh-chat-sources__external',
                          'aria-hidden': true,
                          item: Icon.openExternal()
                      })
                    : null,
            // States that the side panel shows the source - not an action.
            meta = [...getSourceMeta(source), isActive ? 'shown in viewer' : null]
                .filter(it => it)
                .join(' · ');

        return li({
            className: 'xh-chat-sources__item',
            items: [
                div({
                    className: classNames('xh-chat-sources__row', {
                        'xh-chat-sources__row--expandable': !!excerpt,
                        'xh-chat-sources__row--highlight': links.hoveredNumber === number,
                        'xh-chat-sources__row--active': isActive
                    }),
                    // A larger target for the pointer. The chevron is the toggle for the keyboard
                    // and for screen readers, so the row itself is no control.
                    onClick: excerpt
                        ? (e: MouseEvent<HTMLElement>) => {
                              if (isRowToggleClick(e)) impl.toggleExcerpt(source.id);
                          }
                        : undefined,
                    onMouseEnter: () => links.setHoveredNumber(number),
                    onMouseLeave: () => {
                        if (links.hoveredNumber === number) links.setHoveredNumber(null);
                    },
                    items: [
                        showNumber
                            ? span({
                                  className: 'xh-chat-sources__number',
                                  'aria-label': `Source ${number}`,
                                  item: number
                              })
                            : null,
                        span({className: 'xh-chat-sources__icon', item: sourceIcon(source)}),
                        div({
                            className: 'xh-chat-sources__text',
                            items: [
                                sourceTitle(source, number, links, isActive, opensInNewTab),
                                compact ? externalIcon : null,
                                meta || (!compact && externalIcon)
                                    ? span({
                                          className: 'xh-chat-sources__meta',
                                          title: meta || null,
                                          items: [compact ? null : externalIcon, meta]
                                      })
                                    : null
                            ]
                        }),
                        excerpt
                            ? button({
                                  className: 'xh-chat-sources__expander',
                                  icon: isExcerptOpen
                                      ? Icon.groupRowExpanded()
                                      : Icon.groupRowCollapsed(),
                                  tooltip: isExcerptOpen ? 'Hide excerpt' : 'Show excerpt',
                                  'aria-label': isExcerptOpen ? 'Hide excerpt' : 'Show excerpt',
                                  'aria-expanded': isExcerptOpen,
                                  onClick: () => impl.toggleExcerpt(source.id)
                              })
                            : null
                    ]
                }),
                isExcerptOpen
                    ? div({
                          className: 'xh-chat-sources__excerpt',
                          item: excerptText(excerpt, null, 'xh-chat-sources__excerpt-text')
                      })
                    : null
            ]
        });
    }
});

/**
 * True for a click on the row that should toggle its excerpt: not on a button in the row, and not
 * the end of a drag that selected text.
 */
function isRowToggleClick(e: MouseEvent<HTMLElement>): boolean {
    if ((e.target as Element).closest('button, a')) return false;
    return !window.getSelection()?.toString();
}

// A title is a button that opens the source, if anything can.
function sourceTitle(
    source: ChatSourcePart,
    number: number,
    links: ChatSourceLinks,
    isActive: boolean,
    opensInNewTab: boolean
): ReactNode {
    const title = source.title || formatHost(source.url) || 'Untitled',
        className = 'xh-chat-sources__title';

    if (links.canOpen(source)) {
        return htmlButton({
            className,
            type: 'button',
            'aria-current': isActive || undefined,
            'aria-label': opensInNewTab ? `${title} (opens in a new tab)` : undefined,
            title,
            onClick: (e: MouseEvent<HTMLButtonElement>) =>
                links.open(source, {
                    citation: number,
                    opener: e.currentTarget,
                    newTab: e.ctrlKey || e.metaKey
                }),
            item: title
        });
    }

    return span({className, title, item: title});
}
