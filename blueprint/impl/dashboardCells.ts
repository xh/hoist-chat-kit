import {clamp, sortBy} from 'lodash';
import type {ChildRef} from '../Blueprint';

/**
 * A dashboard's cells with one cell grown by some rows, and each cell it would then cover moved down
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

/** The columns of a dashboard that names none. */
export const DASHBOARD_COLUMNS = 12;

/** The row height in pixels of a dashboard that names none. */
export const DASHBOARD_ROW_HEIGHT = 50;

/** The gap in pixels between a dashboard's cells, and around them, where it names none. */
export const DASHBOARD_GAP = 10;

/**
 * A dashboard's cells for a new column count. Each cell's edges scale in proportion, so cells that
 * shared an edge still do. A cell narrower than `minWidth` gives for it, such as its widget's
 * `size.min.w`, takes the columns it lacks from the cells on one side of it that can spare them,
 * else widens into the grid, and any cell then overlapping another moves down below it, in reading
 * order.
 */
export function rescaleCells(
    children: ChildRef[],
    from: number,
    to: number,
    minWidth?: (id: string) => number
): ChildRef[] {
    if (from === to || !(from > 0) || !(to > 0)) return children;
    const edge = (n: number) => clamp(Math.round((n * to) / from), 0, to),
        ret = children.map(it => {
            if (!isCell(it)) return it;
            const left = Math.min(edge(it.x), to - 1);
            return {...it, x: left, w: Math.max(edge(it.x + it.w) - left, 1)} as Cell;
        }),
        cells = sortBy(ret.filter(isCell), ['y', 'x']),
        minOf = (cell: Cell) => clamp(minWidth?.(cell.id) ?? 1, 1, to);

    cells.forEach(cell => {
        const need = minOf(cell) - cell.w;
        if (need <= 0) return;
        const beside = (side: 'left' | 'right') =>
                cells.filter(
                    it =>
                        it !== cell &&
                        rowsMeet(it, cell) &&
                        (side === 'right' ? it.x === cell.x + cell.w : it.x + it.w === cell.x)
                ),
            canGive = (others: Cell[]) =>
                others.length > 0 && others.every(it => it.w - need >= minOf(it)),
            right = beside('right'),
            left = beside('left');
        if (canGive(right)) {
            right.forEach(it => {
                it.x += need;
                it.w -= need;
            });
        } else if (canGive(left)) {
            left.forEach(it => (it.w -= need));
            cell.x -= need;
        } else {
            cell.x = Math.max(Math.min(cell.x, to - cell.w - need), 0);
        }
        cell.w += need;
    });

    const placed: Cell[] = [];
    cells.forEach(cell => {
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

const rowsMeet = (a: Cell, b: Cell) => a.y < b.y + b.h && b.y < a.y + a.h;

const overlaps = (a: Cell, b: Cell) =>
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
