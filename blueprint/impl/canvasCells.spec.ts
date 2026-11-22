import {describe, expect, it} from 'vitest';
import {rescaleCells} from './canvasCells';

/** A canvas's cells follow a new column count, staying on its grid and apart. */
describe('rescaleCells', () => {
    it('scales x and w in proportion, keeping y and h', () => {
        expect(
            rescaleCells(
                [
                    {id: 'a', x: 0, y: 0, w: 6, h: 2},
                    {id: 'b', x: 6, y: 0, w: 6, h: 2}
                ],
                12,
                6
            )
        ).toEqual([
            {id: 'a', x: 0, y: 0, w: 3, h: 2},
            {id: 'b', x: 3, y: 0, w: 3, h: 2}
        ]);
    });

    it('keeps each cell at least one column wide and inside the grid', () => {
        expect(rescaleCells([{id: 'a', x: 11, y: 0, w: 1, h: 1}], 12, 4)).toEqual([
            {id: 'a', x: 3, y: 0, w: 1, h: 1}
        ]);
    });

    it('moves a cell that rounding makes overlap another down below it, in reading order', () => {
        const ret = rescaleCells(
            [
                {id: 'a', x: 0, y: 0, w: 1, h: 2},
                {id: 'b', x: 1, y: 0, w: 1, h: 2},
                {id: 'c', x: 0, y: 2, w: 2, h: 1}
            ],
            3,
            1
        );
        expect(ret.map(({id, x, y}) => [id, x, y])).toEqual([
            ['a', 0, 0],
            ['b', 0, 2],
            ['c', 0, 4]
        ]);
    });

    it('leaves the cells as they are for the same count', () => {
        const cells = [{id: 'a', x: 0, y: 0, w: 6, h: 2}];
        expect(rescaleCells(cells, 12, 12)).toBe(cells);
    });
});
