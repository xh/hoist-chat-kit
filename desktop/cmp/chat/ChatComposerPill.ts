import type {ReactElement, ReactNode} from 'react';
import {useState} from 'react';
import {span} from '@xh/hoist/cmp/layout';
import {hoistCmp, type HoistProps, type MenuItemLike} from '@xh/hoist/core';
import {button} from '@xh/hoist/desktop/cmp/button';
import {menu} from '@xh/hoist/desktop/cmp/menu';
import {Icon} from '@xh/hoist/icon';
import {popover} from '@xh/hoist/kit/blueprint';
import {classNames} from '../../../impl/ClassNames';
import '../../../styles/vars.scss';
import './ChatComposerPill.scss';

/**
 * The status dot of a {@link ChatComposerPill}. Always paired with words, in the pill's
 * `statusText` - the dot alone never carries the status.
 */
export type ChatComposerPillStatus = 'online' | 'degraded' | 'offline' | 'danger';

/** Props for {@link ChatComposerPill}. */
export interface ChatComposerPillProps extends HoistProps {
    /** The pill's words - for example the agent's name, or 'Tools'. */
    text: ReactNode;

    /** Icon before the words. In a compact composer, the pill shows only its icon and count. */
    icon?: ReactElement;

    /** A count after the words - for example of the tools turned on. Null for none. */
    count?: number;

    /** A status dot before the icon, for example an agent's state. Null for none. */
    status?: ChatComposerPillStatus;

    /** The words for the status dot, read in the pill's accessible name and its tooltip. */
    statusText?: string;

    /** Items of a menu the pill opens. Use this or `content`. */
    menuItems?: MenuItemLike[];

    /**
     * Content of a popover the pill opens, such as a list of checkboxes. Use this or `menuItems`.
     * A function is called each time the popover opens, with a function that closes it.
     */
    content?: ReactNode | ((close: () => void) => ReactNode);

    /**
     * True when the app, not the user, decides the pill's value - for example a router that picks
     * the agent. The pill shows a dotted border and a lock, opens nothing, and stays focusable so
     * that its tooltip, which should say who decides, is reachable.
     */
    readonly?: boolean;

    /** Tooltip. For a compact pill, the words show only here and in the accessible name. */
    tooltip?: string;

    /** Accessible name. Default the words, the count and the status words. */
    'aria-label'?: string;
}

/**
 * A small chip for the composer's left slot, which opens a menu or a popover upward: an optional
 * status dot, an icon, the words, a count and a chevron. Use it for an agent, tool or skill
 * picker, or build on it, as {@link ChatScopeChip} does for a document scope.
 *
 * Changes made through a pill apply to the next turn - bind them to `ChatModel.runOptions` - and
 * never restart a reply in progress. Leave out a pill the app does not configure, rather than show
 * it empty or disabled.
 */
export const [ChatComposerPill, chatComposerPill] = hoistCmp.withFactory<ChatComposerPillProps>({
    displayName: 'ChatComposerPill',
    model: false,
    className: 'xh-chat-composer-pill',

    render(props) {
        const {
                className,
                text,
                icon,
                count,
                status,
                statusText,
                menuItems,
                content,
                readonly,
                tooltip,
                'aria-label': ariaLabel
            } = props,
            [isOpen, setIsOpen] = useState(false),
            canOpen = !readonly && (menuItems != null || content != null),
            name = ariaLabel ?? defaultName(text, count, statusText);

        const pill = button({
            className: classNames(className, {
                'xh-chat-composer-pill--open': isOpen,
                'xh-chat-composer-pill--readonly': readonly
            }),
            icon: leadIcon(status, readonly ? Icon.lock() : icon),
            text: span({
                className: 'xh-chat-composer-pill__body',
                items: [
                    span({className: 'xh-chat-composer-pill__text', item: text}),
                    count != null
                        ? span({className: 'xh-chat-composer-pill__count', item: count})
                        : null
                ]
            }),
            rightIcon: canOpen
                ? isOpen
                    ? Icon.chevronUp({className: 'xh-chat-composer-pill__chevron'})
                    : Icon.chevronDown({className: 'xh-chat-composer-pill__chevron'})
                : null,
            minimal: true,
            tooltip: tooltip ?? statusText,
            'aria-label': name,
            'aria-haspopup': canOpen ? (menuItems ? 'menu' : 'dialog') : undefined,
            'aria-expanded': canOpen ? isOpen : undefined,
            'aria-disabled': readonly || undefined
        });
        if (!canOpen) return pill;

        const close = () => setIsOpen(false);
        return popover({
            isOpen,
            onInteraction: open => setIsOpen(open),
            position: 'top-left',
            minimal: true,
            popoverClassName: 'xh-chat-composer-pill__popover',
            item: pill,
            content: (menuItems
                ? menu({menuItems})
                : typeof content === 'function'
                  ? content(close)
                  : content) as ReactElement
        });
    }
});

//------------------
// Implementation
//------------------
function leadIcon(status: ChatComposerPillStatus, icon: ReactElement): ReactElement {
    if (!status) return icon;
    return span({
        className: 'xh-chat-composer-pill__lead',
        items: [
            span({
                className: `xh-chat-composer-pill__dot xh-chat-composer-pill__dot--${status}`,
                'aria-hidden': true
            }),
            icon
        ]
    });
}

function defaultName(text: ReactNode, count: number, statusText: string): string {
    const words = typeof text === 'string' ? text : '';
    return [words, count != null ? `${count}` : null, statusText].filter(Boolean).join(', ');
}
