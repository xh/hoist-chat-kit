import {render} from '@testing-library/react';
import type {ReactElement} from 'react';
import {describe, expect, it} from 'vitest';
import type {DropPlace} from './dropTargets';
import {chipPlace, dropMarks} from './dropMarks';

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
    // The target at (40, 30) in an 800 x 600 blueprint area.
    const box = {
        x: 40,
        y: 30,
        width: 400,
        height: 300,
        area: {width: 800, height: 600},
        roomAbove: 30,
        clip: null
    };
    const draw = (it: DropPlace, index = 0) => {
        const mark = dropMarks(it)[index];
        return render(mark.render(box) as ReactElement).container;
    };

    it('outlines the target, and draws a line where the drop would insert', () => {
        const el = draw(place({}));
        expect(el.querySelector('.xh-blueprint-drop__outline--refused')).toBeNull();
        const line = el.querySelector<HTMLElement>('.xh-blueprint-drop__line--row');
        expect(line.style.left).toBe('99px');
        expect(line.style.height).toBe('80px');
    });

    it('shows a refusal at the pointer, unclipped, with no line', () => {
        const refused = place({refusal: 'A toolbar holds inputs and buttons only.'}),
            el = draw(refused);
        expect(el.querySelector('.xh-blueprint-drop__outline--refused')).toBeTruthy();
        expect(el.querySelector('.xh-blueprint-drop__line')).toBeNull();
        expect(dropMarks(refused)[1].clip).toBe(false);
        const chip = draw(refused, 1).querySelector<HTMLElement>('.xh-blueprint-drop__refusal');
        expect(chip.textContent).toBe("Can't drop here: A toolbar holds inputs and buttons only.");
        expect([chip.style.left, chip.style.top]).toEqual(['102px', '52px']);
    });

    describe('the refusal, placed as a tooltip is within the blueprint area', () => {
        const area = {width: 800, height: 600},
            size = {width: 200, height: 20},
            place = (x: number, y: number, s = size) => chipPlace({x, y}, s, area);

        it('sits below and right of the pointer where it fits', () => {
            expect(place(100, 100)).toEqual({left: 112, top: 112});
        });

        it('flips to the left of the pointer near the right edge', () => {
            expect(place(700, 100)).toEqual({left: 488, top: 112});
        });

        it('flips above the pointer near the bottom edge', () => {
            expect(place(100, 590)).toEqual({left: 112, top: 558});
        });

        it('flips both ways in the bottom right corner', () => {
            expect(place(790, 590)).toEqual({left: 578, top: 558});
        });

        it('stays below and right near the left and top edges, where it already fits', () => {
            expect(place(2, 2)).toEqual({left: 14, top: 14});
        });

        it('shifts along the edge when neither side of the pointer has room', () => {
            // 300 wide: 162 + 200 passes the right edge, and 150 - 12 - 200 the left.
            expect(chipPlace({x: 150, y: 100}, size, {width: 300, height: 600})).toEqual({
                left: 0,
                top: 112
            });
            // 30 high: 27 + 20 passes the bottom, and 15 - 12 - 20 the top.
            expect(chipPlace({x: 100, y: 15}, size, {width: 800, height: 30})).toEqual({
                left: 112,
                top: 0
            });
        });

        it('starts at the top left of an area smaller than it', () => {
            expect(chipPlace({x: 50, y: 10}, size, {width: 100, height: 15})).toEqual({
                left: 0,
                top: 0
            });
        });
    });

    it('draws nothing without a drag', () => {
        expect(dropMarks(null)).toEqual([]);
    });
});
