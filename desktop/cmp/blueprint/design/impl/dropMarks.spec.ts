import {render} from '@testing-library/react';
import type {ReactElement} from 'react';
import {describe, expect, it} from 'vitest';
import type {DropPlace} from './dropTargets';
import {dropMarks} from './dropMarks';

/** A drag's marks: the target outlined and the insertion line, or the refusal at the pointer. */
describe('dropMarks', () => {
    const place = (over: Partial<DropPlace>): DropPlace => ({
        target: {container: 'page', index: 1},
        refusal: null,
        containerEl: document.createElement('div'),
        ownDrop: false,
        line: {axis: 'row', at: 100, from: 0, to: 80},
        pointer: {x: 90, y: 40},
        ...over
    });
    const draw = (it: DropPlace) => {
        const [mark] = dropMarks(it);
        return render(mark.render(null) as ReactElement).container;
    };

    it('outlines the target, and draws a line where the drop would insert', () => {
        const el = draw(place({}));
        expect(el.querySelector('.xh-blueprint-drop__outline--refused')).toBeNull();
        const line = el.querySelector<HTMLElement>('.xh-blueprint-drop__line--row');
        expect(line.style.left).toBe('99px');
        expect(line.style.height).toBe('80px');
    });

    it('shows a refusal at the pointer, with no line', () => {
        const el = draw(place({refusal: 'A toolbar holds inputs and buttons only.'}));
        expect(el.querySelector('.xh-blueprint-drop__outline--refused')).toBeTruthy();
        expect(el.querySelector('.xh-blueprint-drop__line')).toBeNull();
        const chip = el.querySelector<HTMLElement>('.xh-blueprint-drop__refusal');
        expect(chip.textContent).toBe("Can't drop here: A toolbar holds inputs and buttons only.");
        expect([chip.style.left, chip.style.top]).toEqual(['102px', '52px']);
    });

    it('draws nothing without a drag', () => {
        expect(dropMarks(null)).toEqual([]);
    });
});
