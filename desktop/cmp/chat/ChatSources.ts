import {a, div, li, ol, span} from '@xh/hoist/cmp/layout';
import {hoistCmp, HoistModel, type HoistProps, useLocalModel} from '@xh/hoist/core';
import {button} from '@xh/hoist/desktop/cmp/button';
import {Icon} from '@xh/hoist/icon';
import {action, observable} from '@xh/hoist/mobx';
import {pluralize} from '@xh/hoist/utils/js';
import type {ChatSourcePart} from '../../../core';
import '../../../styles/vars.scss';
import './ChatSources.scss';
import {formatHost} from './impl/ChatFormat';

/** Props for {@link ChatSources}. */
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
    className: 'xh-chat-sources',

    render({className, sources, defaultExpanded = false}, ref) {
        const impl = useLocalModel(ChatSourcesLocalModel),
            isExpanded = impl.expanded ?? defaultExpanded;

        if (!sources?.length) return null;

        return div({
            ref,
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
