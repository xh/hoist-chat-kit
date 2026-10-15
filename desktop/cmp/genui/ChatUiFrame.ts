import type {ReactNode} from 'react';
import {div} from '@xh/hoist/cmp/layout';
import {hoistCmp, type HoistProps} from '@xh/hoist/core';
import '../../../styles/vars.scss';
import '../chat/impl/ChatMotion.scss';
import './ChatUiFrame.scss';

/** Props for {@link ChatUiFrame}. */
export interface ChatUiFrameProps extends HoistProps {
    /** Title shown above the content. */
    title?: ReactNode;

    /** Muted text shown at the right of the header, such as a row count. */
    meta?: ReactNode;
}

/**
 * The bordered surface around a generative UI component, with an optional header of a title and
 * muted meta text. The built-in grid, chart and card draw in one - use it in your own catalog
 * components for the same look.
 */
export const [ChatUiFrame, chatUiFrame] = hoistCmp.withFactory<ChatUiFrameProps>({
    displayName: 'ChatUiFrame',
    model: false,
    className: 'xh-chat-ui-frame',

    render({className, title, meta, children}) {
        const hasHeader = title != null || meta != null;
        return div({
            className,
            items: [
                hasHeader
                    ? div({
                          className: 'xh-chat-ui-frame__header',
                          items: [
                              div({className: 'xh-chat-ui-frame__title', item: title}),
                              meta != null
                                  ? div({className: 'xh-chat-ui-frame__meta', item: meta})
                                  : null
                          ]
                      })
                    : null,
                div({className: 'xh-chat-ui-frame__body', item: children})
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
