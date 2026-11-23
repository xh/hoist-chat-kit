import {describe, expect, it, onTestFinished} from 'vitest';
import {boxElement, elementBox} from './elementBox';

describe('elementBox', () => {
    const boxed = (left: number, top: number, width: number, height: number) => {
        const el = document.createElement('div');
        el.getBoundingClientRect = () =>
            ({
                left,
                top,
                width,
                height,
                right: left + width,
                bottom: top + height
            }) as DOMRect;
        return el;
    };
    const contents = (...children: Element[]) => {
        const el = document.createElement('div');
        el.style.display = 'contents';
        el.append(...children);
        // Styles compute only for an element in the document.
        document.body.append(el);
        onTestFinished(() => el.remove());
        return el;
    };

    it("measures an element with display: contents as the union of its children's boxes, through nested ones", () => {
        const wrapper = contents(boxed(10, 20, 30, 40), contents(boxed(50, 5, 10, 10)));
        expect(elementBox(wrapper)).toMatchObject({
            left: 10,
            top: 5,
            right: 60,
            bottom: 60,
            width: 50,
            height: 55
        });
        expect(elementBox(contents())).toMatchObject({width: 0, height: 0});
    });

    it('measures any other element by its own box', () => {
        expect(elementBox(boxed(1, 2, 3, 4))).toMatchObject({left: 1, top: 2, width: 3});
    });

    it('finds the element that draws the box, for scrolling into view', () => {
        const inner = boxed(0, 0, 10, 10);
        expect(boxElement(contents(contents(), contents(inner)))).toBe(inner);
        expect(boxElement(inner)).toBe(inner);
        expect(boxElement(contents())).toBeNull();
    });
});
