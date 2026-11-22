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

/**
 * Props that let the selected element be dragged by its body to another container, in Edit with
 * write access: spread on its wrapper. The browser starts the drag once the pointer moves a few
 * pixels. None for another element, or the root, which has nowhere to go.
 */
export function selectionDragProps(designModel: BlueprintDesignModel, id: string): object {
    const {selectedElementId, interaction, blueprintModel} = designModel;
    if (
        id !== selectedElementId ||
        interaction !== 'edit' ||
        blueprintModel.access !== 'write' ||
        blueprintModel.blueprint?.root === id
    ) {
        return {};
    }
    return {
        draggable: true,
        onDragStart: (e: DragEvent) => {
            e.stopPropagation();
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', id);
            elementDrag.start({element: id, designModel});
        },
        onDragEnd: () => elementDrag.end()
    };
}
