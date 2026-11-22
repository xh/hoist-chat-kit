import {clamp, sortBy} from 'lodash';
import type {ChildRef} from '../Blueprint';

/**
 * A canvas's cells with one cell grown by some rows, and each cell it would then cover moved down
 * below it, in turn.
 */
export function growCell(children: ChildRef[], id: string, rows: number): ChildRef[] {
    const ret = children.map(it => ({...it}) as Cell),
        grown = ret.find(it => it.id === id);
    if (!grown) return children;
    grown.h += rows;
    const queue = [grown];
    while (queue.length) {
        const cell = queue.shift();
        ret.forEach(it => {
            if (it !== cell && overlaps(it, cell)) {
                it.y = cell.y + cell.h;
                queue.push(it);
            }
        });
    }
    return ret;
}

/** The columns of a canvas that names none. */
export const CANVAS_COLUMNS = 12;

/**
 * A canvas's cells for a new column count: each cell's x and w scaled in proportion, kept inside
 * the grid and no narrower than `minWidth` gives for it, such as its widget's `size.min.w`, and any
 * cell the scaling makes overlap another moved down below it, in reading order.
 */
export function rescaleCells(
    children: ChildRef[],
    from: number,
    to: number,
    minWidth?: (id: string) => number
): ChildRef[] {
    if (from === to || !(from > 0) || !(to > 0)) return children;
    const ret = children.map(it => {
            if (!isCell(it)) return it;
            const w = clamp(
                    Math.max(Math.round((it.w * to) / from), minWidth?.(it.id) ?? 1),
                    1,
                    to
                ),
                x = clamp(Math.round((it.x * to) / from), 0, to - w);
            return {...it, x, w} as Cell;
        }),
        placed: Cell[] = [];
    sortBy(ret.filter(isCell), ['y', 'x']).forEach(cell => {
        for (let hit = placed.find(it => overlaps(it, cell)); hit;) {
            cell.y = hit.y + hit.h;
            hit = placed.find(it => overlaps(it, cell));
        }
        placed.push(cell);
    });
    return ret;
}

//------------------
// Implementation
//------------------
interface Cell extends ChildRef {
    x: number;
    y: number;
    w: number;
    h: number;
}

const isCell = (it: ChildRef): it is Cell => [it.x, it.y, it.w, it.h].every(Number.isInteger);

const overlaps = (a: Cell, b: Cell) =>
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
