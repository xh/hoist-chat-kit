import {action, observable} from '@xh/hoist/mobx';
import type {DropSource} from './dropTargets';
import {paletteDrag} from '../../impl/paletteDrag';

const current = observable.box<string>(null);

/**
 * An element of the blueprint being dragged, from a Structure row or by its body on the canvas,
 * which drop targets observe, as they do a palette drag.
 */
export const elementDrag = {
    /** The id of the element being dragged, or null. */
    get current(): string {
        return current.get();
    },
    start: action(({element}: {element: string}) => current.set(element)),
    end: action(() => current.set(null))
};

/** What the drag in progress carries: an element, or a palette widget. Null without a drag. */
export function currentDropSource(): DropSource {
    const element = elementDrag.current,
        widget = paletteDrag.current?.component;
    return element ? {element} : widget ? {widget} : null;
}
