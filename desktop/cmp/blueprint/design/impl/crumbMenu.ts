import {span} from '@xh/hoist/cmp/layout';
import {hoistCmp, type HoistProps} from '@xh/hoist/core';
import {Icon} from '@xh/hoist/icon';
import {Classes, menu, menuDivider, menuItem, popover} from '@xh/hoist/kit/blueprint';
import type React from 'react';
import {type ReactElement, type ReactNode, useRef, useState} from 'react';

/** A step's child, as its row in a crumb menu shows it. */
export interface CrumbChild {
    id: string;
    icon?: ReactElement;
    text: ReactNode;
    /** Right-aligned, such as the kind of thing the child is. */
    label?: string;
    /** True to offer the child's own children in a submenu, even where it has none yet. */
    hasChildren?: boolean;
}

/** Children listed together, under a heading where a step has several groups. */
export interface CrumbGroup {
    heading?: ReactNode;
    children: CrumbChild[];
}

export interface CrumbMenuProps extends HoistProps {
    /** The step whose children the menu lists. */
    id: string;
    /** A step's children, in groups. Empty groups are left out. */
    childrenOf: (id: string) => CrumbGroup[];
    onSelect: (id: string) => void;
    /** Called with a child's id while the pointer is over its row, and with null as it leaves. */
    onHover?: (id: string) => void;
    /** Rows for a step with no children, after a disabled "No children", such as a way to add one. */
    emptyItems?: (id: string, close: () => void) => ReactElement[];
    /** Css class name for the menu and its submenus' popovers. */
    menuClassName?: string;
    /** Where each submenu opens beside its row. Default `right-start`. */
    submenuPlacement?: 'left-start' | 'right-start';
    title?: string;
}

/**
 * A breadcrumb separator that opens a menu of the children of the step before it. A child with
 * children of its own opens them in a submenu. The chevron takes focus, and Enter, Space or Down
 * opens the menu at its first row; Up and Down move between rows, Enter picks one, and Esc closes
 * it, each giving focus back to the chevron.
 * @internal
 */
export const crumbMenu = hoistCmp.factory<CrumbMenuProps>({
    displayName: 'CrumbMenu',
    model: false,
    render({
        id,
        childrenOf,
        onSelect,
        onHover,
        emptyItems,
        menuClassName,
        submenuPlacement = 'right-start',
        title,
        className
    }) {
        const [isOpen, setOpen] = useState(false),
            chevronRef = useRef<HTMLElement>(null),
            close = () => setOpen(false),
            // Closed from the keyboard, focus goes back to the chevron, while it is still shown.
            closeToChevron = () => {
                close();
                chevronRef.current?.focus();
            },
            rows = (of: string): ReactElement[] => {
                const groups = childrenOf(of).filter(it => it.children.length);
                if (!groups.length) {
                    return [
                        menuItem({key: '_none', text: 'No children', disabled: true}),
                        ...(emptyItems?.(of, close) ?? [])
                    ];
                }
                return groups.flatMap((group, idx) => [
                    ...(group.heading
                        ? [menuDivider({key: `_heading${idx}`, title: group.heading})]
                        : []),
                    ...group.children.map(child =>
                        menuItem({
                            key: child.id,
                            icon: child.icon,
                            text: child.text,
                            label: child.label,
                            onClick: () => {
                                close();
                                onHover?.(null);
                                onSelect(child.id);
                            },
                            onMouseEnter: () => onHover?.(child.id),
                            onMouseLeave: () => onHover?.(null),
                            children: child.hasChildren ? rows(child.id) : undefined,
                            // Portaled, as the menu's scrolling would clip a submenu nested in
                            // it. Focus opens none, so the arrows stay in the menu.
                            popoverProps: {
                                usePortal: true,
                                openOnTargetFocus: false,
                                placement: submenuPlacement,
                                popoverClassName: menuClassName
                            },
                            ...({'data-crumb-child': child.id} as object)
                        })
                    )
                ]);
            };
        return popover({
            isOpen,
            minimal: true,
            position: 'bottom-left',
            onInteraction: setOpen,
            onOpened: (el: HTMLElement) => firstRow(el)?.focus(),
            onClosed: () => onHover?.(null),
            content: isOpen
                ? menu({
                      className: menuClassName,
                      onKeyDown: (e: React.KeyboardEvent<HTMLElement>) =>
                          onMenuKey(e, closeToChevron),
                      children: rows(id)
                  })
                : null,
            children: span({
                ref: chevronRef,
                className,
                role: 'button',
                tabIndex: 0,
                title,
                'aria-haspopup': 'menu',
                'aria-expanded': isOpen,
                onKeyDown: (e: React.KeyboardEvent) => {
                    if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'ArrowDown') return;
                    e.preventDefault();
                    e.stopPropagation();
                    setOpen(true);
                },
                children: Icon.chevronRight()
            } as object)
        });
    }
});

//------------------
// Implementation
//------------------
const ROW = `.${Classes.MENU_ITEM}:not(.${Classes.DISABLED})`;

// A menu's own rows, never those of a submenu inside it.
function rowsOf(menuEl: Element): HTMLElement[] {
    return [...menuEl.querySelectorAll<HTMLElement>(ROW)].filter(
        it => it.closest(`.${Classes.MENU}`) === menuEl
    );
}

function firstRow(el: HTMLElement): HTMLElement {
    const menuEl = el.querySelector(`.${Classes.MENU}`);
    return menuEl ? rowsOf(menuEl)[0] : null;
}

function onMenuKey(e: React.KeyboardEvent<HTMLElement>, closeToChevron: () => void) {
    const rows = rowsOf(e.currentTarget),
        at = rows.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const step = e.key === 'ArrowDown' ? 1 : -1;
        rows[(at + step + rows.length) % rows.length]?.focus();
    } else if (e.key === 'Enter' && at >= 0) {
        e.preventDefault();
        rows[at].click();
        closeToChevron();
    } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closeToChevron();
    }
}
