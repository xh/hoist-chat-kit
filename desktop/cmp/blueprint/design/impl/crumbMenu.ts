import {span} from '@xh/hoist/cmp/layout';
import {hoistCmp, type HoistProps} from '@xh/hoist/core';
import {Icon} from '@xh/hoist/icon';
import {Classes, menu, menuDivider, menuItem, popover} from '@xh/hoist/kit/blueprint';
import type React from 'react';
import {type ReactElement, type ReactNode, useState} from 'react';

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
    /** Css class name for the menu. */
    menuClassName?: string;
    title?: string;
}

/**
 * A breadcrumb separator that opens a menu of the children of the step before it. A child with
 * children of its own opens them in a submenu. The chevron takes focus, and Enter, Space or Down
 * opens the menu at its first row; Up and Down move between rows, and Enter picks one.
 * @internal
 */
export const crumbMenu = hoistCmp.factory<CrumbMenuProps>({
    displayName: 'CrumbMenu',
    model: false,
    render({id, childrenOf, onSelect, onHover, emptyItems, menuClassName, title, className}) {
        const [isOpen, setOpen] = useState(false),
            close = () => setOpen(false),
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
                ? menu({className: menuClassName, onKeyDown, children: rows(id)})
                : null,
            children: span({
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

function rowsOf(menuEl: Element): HTMLElement[] {
    return [...menuEl.querySelectorAll<HTMLElement>(`:scope > li ${ROW}`)];
}

function firstRow(el: HTMLElement): HTMLElement {
    const menuEl = el.querySelector(`.${Classes.MENU}`);
    return menuEl ? rowsOf(menuEl)[0] : null;
}

function onKeyDown(e: React.KeyboardEvent<HTMLElement>) {
    const rows = rowsOf(e.currentTarget),
        at = rows.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const step = e.key === 'ArrowDown' ? 1 : -1;
        rows[(at + step + rows.length) % rows.length]?.focus();
    } else if (e.key === 'Enter' && at >= 0) {
        e.preventDefault();
        rows[at].click();
    }
}
