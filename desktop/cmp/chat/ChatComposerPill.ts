import type {ReactElement, ReactNode} from 'react';
import {useContext, useEffect, useRef, useState} from 'react';
import {span} from '@xh/hoist/cmp/layout';
import {hoistCmp, type HoistProps, type MenuItemLike} from '@xh/hoist/core';
import {button} from '@xh/hoist/desktop/cmp/button';
import {menu} from '@xh/hoist/desktop/cmp/menu';
import {Icon} from '@xh/hoist/icon';
import {popover} from '@xh/hoist/kit/blueprint';
import {classNames} from '../../../impl/ClassNames';
import '../../../styles/vars.scss';
import './ChatComposerPill.scss';
import {ComposerCenteredContext, getPillPopoverPosition} from './impl/ComposerPlacement';

/** Props for {@link ChatComposerPill}. */
export interface ChatComposerPillProps extends HoistProps {
    /** The pill's words - for example the agent's name, or 'Tools'. */
    text: ReactNode;

    /** Icon before the words. In a compact composer, the pill shows only its icon and count. */
    icon?: ReactElement;

    /** A count after the words - for example of the tools turned on. Null for none. */
    count?: number;

    /** Items of a menu the pill opens. Use this or `content`. */
    menuItems?: MenuItemLike[];

    /**
     * Content of a popover the pill opens, such as a list of checkboxes. Use this or `menuItems`.
     * A function is called each time the popover opens, with a function that closes it.
     */
    content?: ReactNode | ((close: () => void) => ReactNode);

    /** Tooltip. For a compact pill, the words show only here and in the accessible name. */
    tooltip?: string;

    /**
     * True to show the pill's setting as on - for example a tool the user turned on - with the
     * `xh-chat-composer-pill--active` class. Default false.
     */
    active?: boolean;

    /**
     * Called when the pill's menu or popover opens or closes, with whether it is now open - for
     * example to load fresh choices as it opens. `content` as a function runs on each render, so
     * load data here, not there. Not called when the pill unmounts.
     */
    onOpenChange?: (isOpen: boolean) => void;

    /** Class names for the pill's popover, added to the kit's own - for example a type scale. */
    popoverClassName?: string;

    /**
     * Which edge of the pill the popover lines up with: `start` for a pill at the start of its
     * row, `end` for one at the end. The kit still chooses whether it opens up or down. Default
     * `start`.
     */
    popoverAlign?: 'start' | 'end';

    /**
     * True to disable the pill. It keeps its tab stop and tooltip, so set the tooltip to say why,
     * and opens nothing. Default false.
     */
    disabled?: boolean;

    /** Accessible name. Default the words and the count. */
    'aria-label'?: string;
}

/**
 * A small chip for the composer's left slot or its `bottomItems`, which opens a menu or a popover:
 * an icon, the words, a count and a chevron. Use it for an agent, tool or skill picker, or build on
 * it, as {@link ChatScopeChip} does for a document scope.
 *
 * The menu opens upward, over the thread. While `ChatPanel` shows the composer centered, it opens
 * downward instead, so that it does not cover the composer. Either way, a menu with no room on its
 * side opens on the other. It lines up with the pill's start edge - see `popoverAlign` for a pill
 * at the end of its row.
 *
 * Changes made through a pill apply to the next turn - bind them to `ChatModel.runOptions` - and
 * never restart a reply in progress. Leave out a pill the app does not configure, rather than show
 * it empty or disabled. Disable a pill only for a setting that cannot change now, with a tooltip
 * that says why.
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
                menuItems,
                content,
                tooltip,
                active = false,
                disabled = false,
                onOpenChange,
                popoverClassName,
                popoverAlign = 'start',
                'aria-label': ariaLabel
            } = props,
            [isOpen, setIsOpen] = useState(false),
            hasPopup = menuItems != null || content != null,
            canOpen = hasPopup && !disabled,
            // A pill disabled while open shows closed, and stays closed once enabled.
            isShownOpen = isOpen && canOpen,
            name = ariaLabel ?? defaultName(text, count),
            isCentered = useContext(ComposerCenteredContext),
            wasShownOpen = useRef(false);

        const pill = button({
            className: classNames(className, {
                'xh-chat-composer-pill--open': isShownOpen,
                'xh-chat-composer-pill--active': active,
                'xh-chat-composer-pill--disabled': disabled
            }),
            icon,
            text: span({
                className: 'xh-chat-composer-pill__body',
                items: [
                    span({className: 'xh-chat-composer-pill__text', item: text}),
                    count != null
                        ? span({className: 'xh-chat-composer-pill__count', item: count})
                        : null
                ]
            }),
            rightIcon: hasPopup
                ? isShownOpen
                    ? Icon.chevronUp({className: 'xh-chat-composer-pill__chevron'})
                    : Icon.chevronDown({className: 'xh-chat-composer-pill__chevron'})
                : null,
            minimal: true,
            tooltip,
            'aria-label': name,
            // A disabled button would drop out of the tab order, and with it the tooltip that
            // says why. The pill stays focusable and opens nothing.
            'aria-disabled': disabled || undefined,
            'aria-haspopup': hasPopup ? (menuItems ? 'menu' : 'dialog') : undefined,
            'aria-expanded': hasPopup ? isShownOpen : undefined
        });
        // A pill that can no longer open - disabled, or with nothing to show - closes, and stays
        // closed once it can open again.
        useEffect(() => {
            if (!canOpen && isOpen) setIsOpen(false);
        }, [canOpen, isOpen]);

        // Reported from what shows, once per change, however many calls asked for it.
        useEffect(() => {
            if (isShownOpen === wasShownOpen.current) return;
            wasShownOpen.current = isShownOpen;
            onOpenChange?.(isShownOpen);
        });
        if (!canOpen) return pill;

        const close = () => setIsOpen(false);
        return popover({
            isOpen,
            onInteraction: open => setIsOpen(open),
            position: getPillPopoverPosition(isCentered, popoverAlign),
            minimal: true,
            popoverClassName: classNames('xh-chat-composer-pill__popover', popoverClassName),
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
function defaultName(text: ReactNode, count: number): string {
    const words = typeof text === 'string' ? text : '';
    return [words, count != null ? `${count}` : null].filter(Boolean).join(', ');
}
