import {isString} from 'lodash';
import type {ReactElement, ReactNode} from 'react';
import {div, span} from '@xh/hoist/cmp/layout';
import {hoistCmp, type HoistProps} from '@xh/hoist/core';
import {button} from '@xh/hoist/desktop/cmp/button';
import {Icon} from '@xh/hoist/icon';
import {chatSpinner} from '../../impl/ChatLiveCues';
import '../../../styles/vars.scss';
import '../../impl/ChatMotion.scss';
import './ChatUiFrame.scss';

/** Props for {@link ChatUiFrame}. */
export interface ChatUiFrameProps extends HoistProps {
    /**
     * Title shown in the header strip. A string title over 80 characters is cut short, with the
     * whole title in a tooltip. A string title also names the frame for screen readers.
     */
    title?: ReactNode;

    /** Icon before the title. */
    icon?: ReactElement;

    /** Muted text after the title, such as a row count or the units. */
    meta?: ReactNode;

    /** Buttons at the right end of the header strip, such as Expand. */
    headerItems?: ReactNode[];

    /** A strip under the body, such as a table's counts and its download. */
    footer?: ReactNode;

    /**
     * What a card still being built says, such as `Building table…`. Shows with a spinner, in place
     * of the title, icon and meta.
     */
    status?: ReactNode;
}

/**
 * The bordered surface of a generative UI card: a 28 px header strip with a title, muted meta text
 * and buttons, the body, and an optional footer. The built-in grid, chart and card draw in one -
 * use it in your own catalog components for the same look. A frame with a string title is a
 * `region` named by it.
 */
export const [ChatUiFrame, chatUiFrame] = hoistCmp.withFactory<ChatUiFrameProps>({
    displayName: 'ChatUiFrame',
    model: false,
    className: 'xh-chat-ui-frame',

    render({className, title, icon, meta, headerItems, footer, status, children}) {
        const hasHeader = title != null || meta != null || status != null || !!headerItems?.length,
            titleText = isString(title) ? title : null;

        return div({
            className,
            role: titleText ? 'region' : null,
            'aria-label': titleText,
            items: [
                hasHeader
                    ? div({
                          className: 'xh-chat-ui-frame__header',
                          items: [
                              ...(status != null
                                  ? [
                                        span({
                                            key: 'status',
                                            className: 'xh-chat-ui-frame__status',
                                            role: 'status',
                                            items: [chatSpinner(), status]
                                        })
                                    ]
                                  : [
                                        icon
                                            ? span({
                                                  key: 'icon',
                                                  className: 'xh-chat-ui-frame__icon',
                                                  item: icon
                                              })
                                            : null,
                                        title != null
                                            ? div({
                                                  key: 'title',
                                                  className: 'xh-chat-ui-frame__title',
                                                  title:
                                                      titleText?.length > MAX_TITLE
                                                          ? titleText
                                                          : null,
                                                  item: capTitle(title)
                                              })
                                            : null,
                                        meta != null
                                            ? div({
                                                  key: 'meta',
                                                  className: 'xh-chat-ui-frame__meta',
                                                  item: meta
                                              })
                                            : null
                                    ]),
                              div({key: 'fill', className: 'xh-chat-ui-frame__fill'}),
                              ...(headerItems ?? [])
                          ]
                      })
                    : null,
                div({className: 'xh-chat-ui-frame__body', item: children}),
                footer != null ? div({className: 'xh-chat-ui-frame__footer', item: footer}) : null
            ]
        });
    }
});

/**
 * A placeholder, for a component to show while it waits for enough props to render. A placeholder
 * still shown after a second shimmers three times, then holds still.
 *
 * @param height - height of the placeholder, in pixels.
 */
export function chatUiSkeleton(height: number): ReactNode {
    return div({className: 'xh-chat-ui-skeleton xh-chat-skeleton--shimmer', style: {height}});
}

/**
 * The one Expand button of a card that opens in the side panel: icon-only, with the pop-out icon,
 * the tooltip "Expand" and the accessible name "Expand" plus the card's title.
 * @internal
 */
export function chatUiExpandButton(spec: {
    title: string;
    isActive: boolean;
    onClick: (opener: HTMLElement) => void;
}): ReactNode {
    const {title, isActive, onClick} = spec;
    return button({
        key: 'expand',
        className: 'xh-chat-ui-frame__button',
        icon: Icon.openExternal(),
        tooltip: 'Expand',
        'aria-label': title ? `Expand ${title}` : 'Expand',
        active: isActive,
        onClick: e => onClick(e.currentTarget as HTMLElement)
    });
}

//------------------
// Implementation
//------------------
const MAX_TITLE = 80;

function capTitle(title: ReactNode): ReactNode {
    return isString(title) && title.length > MAX_TITLE
        ? `${title.slice(0, MAX_TITLE - 1)}…`
        : title;
}
