import {box, placeholder} from '@xh/hoist/cmp/layout';
import type {ReactNode} from 'react';
import type {BlueprintWidgetModel, ChildRef} from '../../../../blueprint';

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
 * `flex`, else none for a fixed size along `direction`, else an equal share. A separator keeps its
 * own size, as does a collapsed panel, and a spacer's `size` is its length along `direction`.
 */
export function layoutChildren(
    model: BlueprintWidgetModel,
    direction: 'row' | 'column',
    children: ChildRef[] = model.children
): ReactNode[] {
    const elements = model.blueprintModel.effective?.elements ?? {},
        along = direction === 'row' ? 'width' : 'height';
    return children.map(ref => {
        const el = elements[ref.id],
            size = {
                width: ref.width as number,
                height: ref.height as number,
                ...(el?.component === 'spacer' && el.config?.size ? {[along]: el.config.size} : {})
            },
            isFixed =
                size[along] != null ||
                el?.component === 'separator' ||
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
