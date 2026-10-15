import {type KeyboardEvent, type ReactElement, useEffect, useState} from 'react';
import {div, li, span, ul} from '@xh/hoist/cmp/layout';
import {hoistCmp, type HoistProps} from '@xh/hoist/core';
import {Icon} from '@xh/hoist/icon';
import {popover} from '@xh/hoist/kit/blueprint';
import {logError} from '@xh/hoist/utils/js';
import {isEmpty} from 'lodash';
import type {ChatDataBoundary} from '../../../assist';
import '../../../styles/vars.scss';
import './ChatAssistant.scss';

/** Props for {@link ChatDataBoundaryLine}. */
export interface ChatDataBoundaryLineProps extends HoistProps {
    /** What the helper's model can see, in the app's words. Null shows a warning line. */
    boundary: ChatDataBoundary;
}

/**
 * The data boundary line of a helper: one line, directly above its composer, that says what the
 * model can see of the component, in the app's words. A click or Enter lists what is shared and
 * what is not. It never dismisses, and never takes a warning color - sharing data is no warning.
 * An admin limit adds a lock.
 *
 * With no declaration, the line warns that the helper has not said what it sees, and logs an
 * error for the developer.
 */
export const [ChatDataBoundaryLine, chatDataBoundaryLine] =
    hoistCmp.withFactory<ChatDataBoundaryLineProps>({
        displayName: 'ChatDataBoundaryLine',
        model: false,
        className: 'xh-chat-boundary',

        render({className, boundary}, ref) {
            const [isOpen, setOpen] = useState(false),
                isMissing = !boundary;
            useEffect(() => {
                if (isMissing) {
                    logError(
                        'A helper has no data boundary - give its tool group a boundary(), so ' +
                            'the user knows what the model can see.',
                        'ChatDataBoundaryLine'
                    );
                }
            }, [isMissing]);

            if (isMissing) {
                return div({
                    ref,
                    className: `${className} xh-chat-boundary--missing`,
                    items: [
                        Icon.warning(),
                        span({
                            className: 'xh-chat-boundary__text',
                            item: 'This helper does not say what it can see.'
                        })
                    ]
                });
            }

            const {text, shared, notShared, isLimitedByAdmin} = boundary,
                hasList = !isEmpty(shared) || !isEmpty(notShared),
                line = div({
                    ref,
                    className,
                    role: hasList ? 'button' : undefined,
                    tabIndex: hasList ? 0 : undefined,
                    'aria-expanded': hasList ? isOpen : undefined,
                    'aria-label': isLimitedByAdmin
                        ? `${text}, limited by your administrator`
                        : undefined,
                    onClick: hasList ? () => setOpen(!isOpen) : undefined,
                    onKeyDown: hasList
                        ? (e: KeyboardEvent) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault();
                                  setOpen(!isOpen);
                              }
                          }
                        : undefined,
                    items: [
                        isEmpty(shared) && !isEmpty(notShared) ? Icon.eyeSlash() : Icon.eye(),
                        span({className: 'xh-chat-boundary__text', item: text}),
                        isLimitedByAdmin
                            ? span({
                                  className: 'xh-chat-boundary__admin',
                                  items: [Icon.lock(), 'Limited by your admin']
                              })
                            : null,
                        hasList ? (isOpen ? Icon.chevronDown() : Icon.chevronUp()) : null
                    ]
                });
            if (!hasList) return line;

            return popover({
                isOpen: isOpen,
                onInteraction: (open: boolean) => setOpen(open),
                position: 'top-left',
                minimal: true,
                // The helper's own Esc handling would close the helper too, so the list closes
                // here and stops the key.
                canEscapeKeyClose: false,
                className: 'xh-chat-boundary__target',
                item: line,
                content: div({
                    className: 'xh-chat-boundary__list',
                    onKeyDown: (e: KeyboardEvent) => {
                        if (e.key === 'Escape') {
                            e.preventDefault();
                            setOpen(false);
                        }
                    },
                    items: [
                        boundaryList('Shared', shared, () => Icon.check()),
                        boundaryList('Not shared', notShared, () => Icon.x()),
                        isLimitedByAdmin
                            ? div({
                                  className: 'xh-chat-boundary__list-note',
                                  item: 'Set by your administrator.'
                              })
                            : null
                    ]
                })
            });
        }
    });

//------------------
// Implementation
//------------------
function boundaryList(title: string, items: string[], icon: () => ReactElement) {
    if (isEmpty(items)) return null;
    return div({
        className: 'xh-chat-boundary__list-group',
        items: [
            div({className: 'xh-chat-boundary__list-title', item: title}),
            ul({items: items.map(it => li({key: it, items: [icon(), span(it)]}))})
        ]
    });
}
