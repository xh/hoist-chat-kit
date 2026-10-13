import {uniqBy} from 'lodash';
import {a, div, li, ol, span} from '@xh/hoist/cmp/layout';
import {hoistCmp, HoistModel, type HoistProps, useLocalModel} from '@xh/hoist/core';
import {button} from '@xh/hoist/desktop/cmp/button';
import {Icon} from '@xh/hoist/icon';
import {tooltip} from '@xh/hoist/kit/blueprint';
import {action, observable} from '@xh/hoist/mobx';
import {pluralize} from '@xh/hoist/utils/js';
import type {ChatCitation, ChatSourcePart} from '../../../core';
import '../../../styles/vars.scss';
import './ChatSources.scss';
import {formatHost} from './impl/ChatFormat';

export interface ChatSourcesProps extends HoistProps {
    /** Sources the model consulted, in the order it reported them. */
    sources: ChatSourcePart[];

    /** True to show the list open initially. Default false. */
    defaultExpanded?: boolean;
}

/**
 * The sources behind a reply - web pages or documents the model consulted - as a numbered list
 * behind a compact "3 sources" toggle. Numbers match the citation chips shown with the text.
 */
export const [ChatSources, chatSources] = hoistCmp.withFactory<ChatSourcesProps>({
    displayName: 'ChatSources',
    model: false,
    className: 'xh-chat-sources',

    render({className, sources, defaultExpanded = false}) {
        const impl = useLocalModel(ChatSourcesLocalModel),
            isExpanded = impl.expanded ?? defaultExpanded;

        if (!sources?.length) return null;

        return div({
            className,
            items: [
                button({
                    className: 'xh-chat-sources__toggle',
                    icon: Icon.globe(),
                    text: pluralize('source', sources.length, true),
                    rightIcon: isExpanded ? Icon.chevronUp() : Icon.chevronDown(),
                    'aria-expanded': isExpanded,
                    onClick: () => impl.setExpanded(!isExpanded)
                }),
                isExpanded
                    ? ol({
                          className: 'xh-chat-sources__list',
                          items: sources.map((source, idx) => sourceItem(source, idx + 1))
                      })
                    : null
            ]
        });
    }
});

export interface ChatCitationsProps extends HoistProps {
    /** Citations to show, in citation order. */
    citations: ChatCitation[];

    /**
     * Sources of the message holding the citations. A citation that refers to one of these is
     * numbered to match the source list.
     */
    sources?: ChatSourcePart[];
}

/**
 * Numbered chips for the citations that support a passage of text. Hovering a chip shows the
 * cited source and passage. Clicking opens the source.
 */
export const [ChatCitations, chatCitations] = hoistCmp.withFactory<ChatCitationsProps>({
    displayName: 'ChatCitations',
    model: false,
    className: 'xh-chat-citations',

    render({className, citations, sources}) {
        if (!citations?.length) return null;

        const numbered = uniqBy(
            citations.map((citation, idx) => ({
                citation,
                number: getCitationNumber(citation, sources) ?? idx + 1
            })),
            'number'
        );

        return div({
            className,
            items: numbered.map(({citation, number}) => citationChip(citation, number))
        });
    }
});

//------------------
// Implementation
//------------------
class ChatSourcesLocalModel extends HoistModel {
    override xhImpl = true;

    @observable accessor expanded: boolean = null;

    @action
    setExpanded(expanded: boolean) {
        this.expanded = expanded;
    }
}

function sourceItem({id, url, title, snippet}: ChatSourcePart, number: number) {
    const host = formatHost(url);
    return li({
        key: id,
        className: 'xh-chat-sources__item',
        items: [
            span({className: 'xh-chat-sources__number', item: number}),
            div({
                className: 'xh-chat-sources__text',
                items: [
                    url
                        ? a({
                              className: 'xh-chat-sources__title',
                              href: url,
                              target: '_blank',
                              rel: 'noopener noreferrer',
                              item: title || host
                          })
                        : span({className: 'xh-chat-sources__title', item: title || 'Untitled'}),
                    host && title ? span({className: 'xh-chat-sources__host', item: host}) : null,
                    snippet ? div({className: 'xh-chat-sources__snippet', item: snippet}) : null
                ]
            })
        ]
    });
}

function citationChip({id, url, title, citedText}: ChatCitation, number: number) {
    const host = formatHost(url),
        chipProps = {className: 'xh-chat-citations__chip', item: String(number)};

    return tooltip({
        key: id ?? number,
        minimal: true,
        popoverClassName: 'xh-chat-citations__popover',
        item: url
            ? a({...chipProps, href: url, target: '_blank', rel: 'noopener noreferrer'})
            : span(chipProps),
        content: div({
            className: 'xh-chat-citations__tip',
            items: [
                title ? div({className: 'xh-chat-citations__tip-title', item: title}) : null,
                host ? div({className: 'xh-chat-citations__tip-host', item: host}) : null,
                citedText ? div({className: 'xh-chat-citations__tip-quote', item: citedText}) : null
            ]
        })
    });
}

function getCitationNumber({sourceId, url}: ChatCitation, sources: ChatSourcePart[]): number {
    const idx =
        sources?.findIndex(
            source => (sourceId != null && source.id === sourceId) || (url && source.url === url)
        ) ?? -1;
    return idx >= 0 ? idx + 1 : null;
}
