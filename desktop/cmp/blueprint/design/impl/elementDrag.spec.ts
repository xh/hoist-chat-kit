import {describe, expect, it, onTestFinished} from 'vitest';
import {BlueprintDesignModel, BlueprintModel} from '../../../../../blueprint';
import {portfolioCatalog, scenarioRegistry} from '../../../../../test/blueprintFixtures';
import {currentDropSource, elementDrag, selectionDragProps} from './elementDrag';

/** The selected element drags by its body in Edit, as a Structure row does, carrying its id. */
describe('selectionDragProps', () => {
    function open() {
        const model = new BlueprintModel({
                blueprint: {
                    schema: {blueprint: 1},
                    root: 'page',
                    elements: {
                        page: {component: 'box', children: [{id: 'a'}]},
                        a: {component: 'markdown', config: {text: 'A'}}
                    }
                },
                catalog: portfolioCatalog,
                registry: scenarioRegistry(),
                dataProvider: null,
                mode: 'design',
                access: 'write'
            }),
            design = new BlueprintDesignModel({blueprintModel: model});
        onTestFinished(() => {
            elementDrag.end();
            design.destroy();
            model.destroy();
        });
        return design;
    }

    it('drags only the selected element, in Edit, never the root', () => {
        const design = open();
        expect(selectionDragProps(design, 'a')).toEqual({});
        design.select({kind: 'element', id: 'a'});
        expect(selectionDragProps(design, 'a')).toMatchObject({draggable: true});
        design.setInteraction('interact');
        expect(selectionDragProps(design, 'a')).toEqual({});
        design.setInteraction('edit');
        design.select({kind: 'element', id: 'page'});
        expect(selectionDragProps(design, 'page')).toEqual({});
    });

    it('starts an element drag that drop targets see, and ends it', () => {
        const design = open();
        design.select({kind: 'element', id: 'a'});
        const props = selectionDragProps(design, 'a') as any,
            data: Record<string, string> = {};
        props.onDragStart({
            stopPropagation: () => null,
            dataTransfer: {setData: (k: string, v: string) => (data[k] = v)}
        });
        expect(currentDropSource()).toEqual({element: 'a'});
        expect(data['text/plain']).toBe('a');
        props.onDragEnd();
        expect(currentDropSource()).toBeNull();
    });
});
