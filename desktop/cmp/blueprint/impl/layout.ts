import {box, placeholder} from '@xh/hoist/cmp/layout';
import type {ReactNode} from 'react';
import type {BlueprintWidgetModel, ChildRef} from '../../../../blueprint';

/** The gap between a canvas's cells, and around them, in pixels. */
export const CANVAS_GAP = 8;

/** The container's `emptyText` while it has no children, or null. */
export function emptyContent(
    model: BlueprintWidgetModel,
    children: ChildRef[] = model.children
): ReactNode {
    const text = model.resolvedConfig.emptyText;
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
    const {effective, registry} = model.blueprintModel,
        elements = effective?.elements ?? {},
        along = direction === 'row' ? 'width' : 'height';
    return children.map(ref => {
        const el = elements[ref.id],
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
