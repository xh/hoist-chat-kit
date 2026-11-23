import type {PlainObject} from '@xh/hoist/core';
import {action, observable} from '@xh/hoist/mobx';
import type {BlueprintOp} from '../../../../blueprint';

/** Where a dropped widget goes in its container, as `BlueprintDesignModel.addWidget` takes it. */
export interface PaletteAddOpts {
    /** Its child reference, such as a dashboard cell's place. */
    child?: PlainObject;
    /** The container's other children, as the drop left them. */
    siblings?: PlainObject[];
    /** More ops for the same edit, given the new element's id, such as a layout naming it. */
    extraOps?: (id: string) => BlueprintOp[];
}

/** A widget being dragged from the palette, and what adds it once dropped on a container. */
export interface PaletteDragItem {
    component: string;
    /** Its default size on a dashboard, in grid units. */
    size: {w: number; h: number};
    /** Add the widget to a container, as one edit. */
    add(parentId: string, opts: PaletteAddOpts): void;
}

const current = observable.box<PaletteDragItem>(null, {deep: false});

/** The palette drag in progress, which dashboards observe, to take a drop only during one. */
export const paletteDrag = {
    get current(): PaletteDragItem {
        return current.get();
    },
    start: action((item: PaletteDragItem) => current.set(item)),
    end: action(() => current.set(null))
};
