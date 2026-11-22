import {action, observable} from '@xh/hoist/mobx';
import type {BlueprintDesignModel, DropSource} from '../../../../../blueprint';
import {paletteDrag} from '../../impl/paletteDrag';

/** An element of the blueprint being dragged, and the designer that drops it. */
export interface ElementDragItem {
    element: string;
    designModel: BlueprintDesignModel;
}

const current = observable.box<ElementDragItem>(null, {deep: false});

/**
 * An element being dragged, from a Structure row or by its body on the canvas, which drop targets
 * observe, as they do a palette drag.
 */
export const elementDrag = {
    get current(): ElementDragItem {
        return current.get();
    },
    start: action((item: ElementDragItem) => current.set(item)),
    end: action(() => current.set(null))
};

/** What the drag in progress carries: an element, or a palette widget. Null without a drag. */
export function currentDropSource(): DropSource {
    const element = elementDrag.current?.element,
        widget = paletteDrag.current?.component;
    return element ? {element} : widget ? {widget} : null;
}
