import {afterEach, describe, expect, it} from 'vitest';
import type {BlueprintDesignModel} from '../../../../../blueprint';
import {paletteDrag} from '../../impl/paletteDrag';
import {currentDropSource, elementDrag} from './elementDrag';

/** A drag in progress, as drop targets see it: an element from a Structure row, or a palette widget. */
describe('elementDrag', () => {
    afterEach(() => {
        elementDrag.end();
        paletteDrag.end();
    });

    it('carries the element being dragged, or else the palette widget, until it ends', () => {
        expect(currentDropSource()).toBeNull();
        paletteDrag.start({component: 'markdown', size: {w: 4, h: 2}, add: () => null});
        expect(currentDropSource()).toEqual({widget: 'markdown'});
        elementDrag.start({element: 'a', designModel: {} as BlueprintDesignModel});
        expect(currentDropSource()).toEqual({element: 'a'});
        elementDrag.end();
        paletteDrag.end();
        expect(currentDropSource()).toBeNull();
    });
});
