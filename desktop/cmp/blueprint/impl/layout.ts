import {box, placeholder} from '@xh/hoist/cmp/layout';
import {hoistCmp, type HoistProps} from '@xh/hoist/core';
import {button} from '@xh/hoist/desktop/cmp/button';
import {Icon} from '@xh/hoist/icon';
import type {ReactNode} from 'react';
import type {BlueprintWidgetModel, ChildRef} from '../../../../blueprint';

/**
 * The container's `emptyText` while it has no children, or null. Design mode shows its own empty
 * state in place of it.
 */
export function emptyContent(
    model: BlueprintWidgetModel,
    children: ChildRef[] = model.children
): ReactNode {
    const text = model.resolvedConfig.emptyText;
    if (model.blueprintModel.mode === 'design') return null;
    return !children.length && text ? placeholder(String(text)) : null;
}

/**
 * Each child of a box, panel or other stacking container, in a box sized by its reference: its
 * `flex`, else none for a fixed size along `direction`, else an equal share. An input, a button
 * row, a toolbar and a separator keep their own size, as does a collapsed panel, and text keeps its
 * own height in a column. A spacer's `size` is its length along `direction`.
 */
export function layoutChildren(
    model: BlueprintWidgetModel,
    direction: 'row' | 'column',
    children: ChildRef[] = model.children
): ReactNode[] {
    const {registry} = model.blueprintModel,
        along = direction === 'row' ? 'width' : 'height';
    return children.map(ref => {
        const el = model.blueprintModel.effectiveElement(ref.id),
            size = {
                width: ref.width as number,
                height: ref.height as number,
                ...(el?.component === 'spacer' && el.config?.size ? {[along]: el.config.size} : {})
            },
            category = registry.widgets[el?.component]?.category,
            isFixed =
                size[along] != null ||
                OWN_SIZE.includes(el?.component) ||
                (direction === 'column' && TEXT.includes(el?.component)) ||
                category === 'input' ||
                category === 'action' ||
                (el?.component === 'panel' && !!el.config?.collapsed);
        return box({
            key: ref.id,
            className: 'xh-blueprint-box__item',
            flexDirection: direction,
            flex: (ref.flex as number) ?? (isFixed ? 'none' : 1),
            ...size,
            children: model.renderElement(ref.id)
        });
    });
}

// Widgets that take their own size along a box, whatever their category.
const OWN_SIZE = ['separator', 'toolbar'];

// Text that takes its own height in a column, unless its reference gives it a flex share to scroll.
const TEXT = ['markdown', 'callout'];

/** A reader's way back from a layout they rearranged: shown over its container's corner. */
export const resetLayoutButton = hoistCmp.factory<HoistProps & {onClick: () => void}>({
    displayName: 'BlueprintResetLayoutButton',
    model: false,
    render({onClick}) {
        return box({
            className: 'xh-blueprint-reset-layout',
            style: {position: 'absolute', top: 4, right: 4, zIndex: 5},
            children: button({
                icon: Icon.reset(),
                text: 'Reset layout',
                outlined: true,
                onClick
            })
        });
    }
});
