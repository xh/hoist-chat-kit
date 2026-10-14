import type {ReactElement} from 'react';
import {a, div, li, ol, span} from '@xh/hoist/cmp/layout';
import {hoistCmp, HoistModel, type HoistProps, useLocalModel} from '@xh/hoist/core';
import {button} from '@xh/hoist/desktop/cmp/button';
import {Icon} from '@xh/hoist/icon';
import {action, observable} from '@xh/hoist/mobx';
import {pluralize} from '@xh/hoist/utils/js';
import type {ChatSourcePart} from '../../../core';
import {htmlButton} from '../../../impl/HtmlTags';
import '../../../styles/vars.scss';
import './ChatSources.scss';
import {createSourceClick} from './impl/ChatCitations';
import {formatHost} from './impl/ChatFormat';

/** Props for {@link ChatSources}. */
export interface ChatSourcesProps extends HoistProps {
    /** Sources the model consulted, in the order it reported them. */
    sources: ChatSourcePart[];

    /** True to show the list open initially. Default false. */
    defaultExpanded?: boolean;

    /**
     * Called when the user clicks a source's title. Default opens the source's `url` in a new
     * tab. With a handler, a source with no `url` is clickable too - for example to open a
     * document in the app's own viewer.
     */
    onSourceClick?: (source: ChatSourcePart) => void;
}

/**
 * The sources behind a reply - web pages or documents the model consulted - as a numbered list
 * behind a compact "3 sources" toggle. Each source shows its `marker`, else its position, so the
 * numbers match the citations shown with the text.
 */
export const [ChatSources, chatSources] = hoistCmp.withFactory<ChatSourcesProps>({
    displayName: 'ChatSources',
    className: 'xh-chat-sources',

    render({className, sources, defaultExpanded = false, onSourceClick}, ref) {
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
                          items: sources.map((source, idx) =>
                              sourceItem(source, source.marker ?? idx + 1, onSourceClick)
                          )
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

function sourceItem(
    source: ChatSourcePart,
    number: number,
    onSourceClick: (source: ChatSourcePart) => void
) {
    const {id, url, title, snippet} = source,
        host = formatHost(url),
        onClick = createSourceClick(source, onSourceClick);

    let titleEl: ReactElement;
    if (url) {
        titleEl = a({
            className: 'xh-chat-sources__title',
            href: url,
            target: '_blank',
            rel: 'noopener noreferrer',
            onClick,
            item: title || host
        });
    } else if (onClick) {
        titleEl = htmlButton({
            className: 'xh-chat-sources__title',
            type: 'button',
            onClick,
            item: title || 'Untitled'
        });
    } else {
        titleEl = span({className: 'xh-chat-sources__title', item: title || 'Untitled'});
    }

    return li({
        key: id,
        className: 'xh-chat-sources__item',
        items: [
            span({className: 'xh-chat-sources__number', item: number}),
            div({
                className: 'xh-chat-sources__text',
                items: [
                    titleEl,
                    host && title ? span({className: 'xh-chat-sources__host', item: host}) : null,
                    snippet ? div({className: 'xh-chat-sources__snippet', item: snippet}) : null
                ]
            })
        ]
    });
}
