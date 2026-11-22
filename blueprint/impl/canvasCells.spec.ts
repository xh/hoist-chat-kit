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

    it('widens a cell to its minimum, moving what it covers down, where no neighbour can spare it', () => {
        const ret = rescaleCells(
            [
                {id: 'grid', x: 0, y: 0, w: 4, h: 2},
                {id: 'chart', x: 4, y: 0, w: 4, h: 2}
            ],
            12,
            6,
            id => (id === 'grid' ? 3 : 2)
        );
        expect(ret.map(({id, x, y, w}) => [id, x, y, w])).toEqual([
            ['grid', 0, 0, 3],
            ['chart', 2, 2, 2]
        ]);
    });

    it('scales shared edges, so neighbours stay side by side', () => {
        expect(
            rescaleCells(
                [
                    {id: 'chart', x: 0, y: 0, w: 7, h: 6},
                    {id: 'grid', x: 7, y: 0, w: 5, h: 6}
                ],
                12,
                6
            ).map(({id, x, w}) => [id, x, w])
        ).toEqual([
            ['chart', 0, 4],
            ['grid', 4, 2]
        ]);
    });

    it('takes the columns a cell lacks from a neighbour that can spare them, on the same row', () => {
        const ret = rescaleCells(
            [
                {id: 'chart', x: 0, y: 0, w: 7, h: 6},
                {id: 'grid', x: 7, y: 0, w: 5, h: 6}
            ],
            12,
            6,
            () => 3
        );
        expect(ret.map(({id, x, y, w}) => [id, x, y, w])).toEqual([
            ['chart', 0, 0, 3],
            ['grid', 3, 0, 3]
        ]);
    });

    it('leaves the cells as they are for the same count', () => {
        const cells = [{id: 'a', x: 0, y: 0, w: 6, h: 2}];
        expect(rescaleCells(cells, 12, 12)).toBe(cells);
    });
});
