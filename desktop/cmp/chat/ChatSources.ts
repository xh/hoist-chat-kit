import type {MouseEvent, ReactNode} from 'react';
import {a, div, li, ol, span} from '@xh/hoist/cmp/layout';
import {hoistCmp, HoistModel, type HoistProps, managed, useLocalModel} from '@xh/hoist/core';
import {button} from '@xh/hoist/desktop/cmp/button';
import {Icon} from '@xh/hoist/icon';
import {action, observable, observableRef} from '@xh/hoist/mobx';
import {pluralize} from '@xh/hoist/utils/js';
import type {ChatImagePolicy} from '../../../cmp/markdown';
import type {ChatSidePanelHost, ChatSourcePart} from '../../../core';
import {classNames} from '../../../impl/ClassNames';
import {htmlButton} from '../../../impl/HtmlTags';
import {getExcerpt, getSourceType, isWebUrl} from '../../../impl/sources';
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

    /**
     * Sources that were searched but never cited. The list counts them on one line, without
     * numbers, so that every number matches a marker.
     */
    uncitedSources?: ChatSourcePart[];

    /** True to show every row at the start. Default false: three show, the rest behind a toggle. */
    defaultExpanded?: boolean;

    /**
     * Called when the user clicks a source. By default a document opens in the side panel when one
     * is in reach - in a `ChatWorkspace` with a `documentRenderer` - and a web page opens in a new
     * tab. A handler replaces the new tab, and opens a document that the side panel cannot show.
     */
    onSourceClick?: (source: ChatSourcePart) => void;

    /** Which favicon URLs may load - see `ChatMarkdownProps.allowImages`. Default false. */
    allowImages?: ChatImagePolicy;

    /**
     * How the message opens its sources, shared with its citation markers.
     * @internal
     */
    links?: ChatSourceLinks;
}

/**
 * The sources behind a reply, under its text and above its action bar, after a hairline.
 *
 * Rows follow the citation numbers. A document row shows its file-type icon, title, file name and
 * page, and opens the document - in the side panel when one is in reach. A web page row shows its
 * favicon or a letter tile, its title as a link that opens a new tab, and its host. Three rows
 * show, and the rest sit behind "Show N More". A row with an excerpt expands to show it. Sources
 * searched but never cited are counted on one line, not numbered.
 *
 * Hovering a row highlights its markers in the text, and hovering a marker highlights its row.
 */
export const [ChatSources, chatSources] = hoistCmp.withFactory<ChatSourcesProps>({
    displayName: 'ChatSources',
    className: 'xh-chat-sources',

    render(props, ref) {
        const {className, sources, uncitedSources, defaultExpanded = false} = props,
            impl = useLocalModel(ChatSourcesLocalModel),
            links = props.links ?? impl.links;
        if (!props.links) {
            impl.links.configure({
                sidePanel: impl.sidePanel,
                onSourceClick: props.onSourceClick ?? null,
                allowImages: props.allowImages ?? false
            });
        }

        const uncited = uncitedSources?.length ?? 0;
        if (!sources?.length && !uncited) return null;

        // TODO(design-open B5) - documents and web pages share one numbered sequence.
        const isExpanded = impl.expanded ?? defaultExpanded,
            shown = isExpanded ? sources : sources.slice(0, VISIBLE_ROWS),
            hidden = sources.length - VISIBLE_ROWS;

        return div({
            ref,
            className,
            role: 'region',
            'aria-label': 'Sources',
            items: [
                sources.length ? listHead(sources) : null,
                sources.length
                    ? ol({
                          className: 'xh-chat-sources__list',
                          items: shown.map((source, idx) =>
                              sourceRow({
                                  key: source.id,
                                  source,
                                  number: source.marker ?? idx + 1,
                                  links,
                                  impl
                              })
                          )
                      })
                    : null,
                hidden > 0
                    ? button({
                          className: 'xh-chat-sources__more',
                          icon: isExpanded ? Icon.chevronUp() : Icon.chevronDown(),
                          text: isExpanded ? 'Show Fewer' : `Show ${hidden} More`,
                          'aria-expanded': isExpanded,
                          onClick: () => impl.setExpanded(!isExpanded)
                      })
                    : null,
                uncited
                    ? div({
                          className: 'xh-chat-sources__also',
                          item: `Also searched ${pluralize(
                              uncitedNoun(uncitedSources),
                              uncited,
                              true
                          )} with no matching passage`
                      })
                    : null
            ]
        });
    }
});

//------------------
// Implementation
//------------------
const VISIBLE_ROWS = 3;

class ChatSourcesLocalModel extends HoistModel {
    override xhImpl = true;

    /** The side panel in reach, for a list shown on its own, or null. */
    sidePanel: ChatSidePanelHost = null;

    override onLinked() {
        this.sidePanel = findSidePanel(this);
    }

    /** Links of a list shown on its own - a message view passes its own. */
    @managed readonly links = new ChatSourceLinks();

    /** True to show every row, or null for the `defaultExpanded` prop. */
    @observable accessor expanded: boolean = null;

    /** Ids of the rows whose excerpt shows. */
    @observableRef accessor openExcerpts: string[] = [];

    @action
    setExpanded(expanded: boolean) {
        this.expanded = expanded;
    }

    @action
    toggleExcerpt(id: string) {
        const {openExcerpts} = this;
        this.openExcerpts = openExcerpts.includes(id)
            ? openExcerpts.filter(it => it !== id)
            : [...openExcerpts, id];
    }
}

function listHead(sources: ChatSourcePart[]): ReactNode {
    const isWeb = sources.every(it => getSourceType(it) === 'url');
    return div({
        className: 'xh-chat-sources__head',
        items: [
            span({className: 'xh-chat-sources__heading', item: 'Sources'}),
            span({
                className: 'xh-chat-sources__count',
                item: `· ${isWeb ? pluralize('web page', sources.length, true) : sources.length}`
            })
        ]
    });
}

// Documents, unless every uncited source is a web page.
function uncitedNoun(sources: ChatSourcePart[]): string {
    return sources.every(it => getSourceType(it) === 'url') ? 'web page' : 'document';
}

interface SourceRowProps extends HoistProps {
    source: ChatSourcePart;
    number: number;
    links: ChatSourceLinks;
    impl: ChatSourcesLocalModel;
}

const sourceRow = hoistCmp.factory<SourceRowProps>({
    displayName: 'ChatSourceRow',
    model: false,

    render({source, number, links, impl}) {
        const isDocument = getSourceType(source) === 'document',
            excerpt = getExcerpt(source),
            isExcerptOpen = !!excerpt && impl.openExcerpts.includes(source.id),
            isActive = links.isActive(number),
            meta = isDocument ? getSourceMeta(source) : [],
            host = isDocument ? null : formatHost(source.url);

        return li({
            className: classNames(
                'xh-chat-sources__item',
                `xh-chat-sources__item--${isDocument ? 'document' : 'url'}`
            ),
            items: [
                div({
                    className: classNames('xh-chat-sources__row', {
                        'xh-chat-sources__row--highlight': links.hoveredNumber === number,
                        'xh-chat-sources__row--active': isActive
                    }),
                    onMouseEnter: () => links.setHoveredNumber(number),
                    onMouseLeave: () => {
                        if (links.hoveredNumber === number) links.setHoveredNumber(null);
                    },
                    items: [
                        span({
                            className: 'xh-chat-sources__number',
                            'aria-label': `Source ${number}`,
                            item: number
                        }),
                        span({
                            className: 'xh-chat-sources__icon',
                            item: sourceIcon(source, links.allowImages)
                        }),
                        sourceTitle(source, number, links),
                        meta.length || isActive
                            ? span({
                                  className: 'xh-chat-sources__meta',
                                  item: [...meta, isActive ? 'open in viewer' : null]
                                      .filter(it => it)
                                      .join(' · ')
                              })
                            : span({className: 'xh-chat-sources__meta'}),
                        host
                            ? span({
                                  className: 'xh-chat-sources__ext',
                                  'aria-hidden': true,
                                  items: [host, Icon.openExternal()]
                              })
                            : null,
                        excerpt
                            ? button({
                                  className: 'xh-chat-sources__expander',
                                  icon: isExcerptOpen ? Icon.chevronUp() : Icon.chevronDown(),
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

// A web page's title is a real link. A document's title is a button that opens it, if anything
// can.
function sourceTitle(source: ChatSourcePart, number: number, links: ChatSourceLinks): ReactNode {
    const {url} = source,
        title = source.title || formatHost(url) || 'Untitled',
        className = 'xh-chat-sources__title';

    if (getSourceType(source) === 'url' && isWebUrl(url)) {
        return a({
            className,
            href: url,
            target: '_blank',
            rel: 'noopener noreferrer',
            onClick: (e: MouseEvent) => {
                if (links.onSourceClick && !e.ctrlKey && !e.metaKey) {
                    e.preventDefault();
                    links.onSourceClick(source);
                }
            },
            item: title
        });
    }

    if (links.canOpen(source)) {
        return htmlButton({
            className,
            type: 'button',
            onClick: (e: MouseEvent<HTMLButtonElement>) =>
                links.open(source, {
                    citation: number,
                    opener: e.currentTarget,
                    newTab: e.ctrlKey || e.metaKey
                }),
            item: title
        });
    }

    return span({className, item: title});
}
