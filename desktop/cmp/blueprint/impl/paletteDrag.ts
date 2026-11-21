import type {PlainObject} from '@xh/hoist/core';
import {action, observable} from '@xh/hoist/mobx';

/** A widget being dragged from the palette, and what adds it once dropped on a canvas. */
export interface PaletteDragItem {
    component: string;
    /** Its default size on a canvas, in grid units. */
    size: {w: number; h: number};
    /** Add the widget to a canvas, at a place, with its other children where the drop left them. */
    drop(canvasId: string, child: PlainObject, siblings: PlainObject[]): void;
}

const current = observable.box<PaletteDragItem>(null, {deep: false});

/** The palette drag in progress, which canvases observe, to take a drop only during one. */
export const paletteDrag = {
    get current(): PaletteDragItem {
        return current.get();
    },
    start: action((item: PaletteDragItem) => current.set(item)),
    end: action(() => current.set(null))
};
