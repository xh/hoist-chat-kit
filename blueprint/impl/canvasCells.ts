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

//------------------
// Implementation
//------------------
interface Cell extends ChildRef {
    x: number;
    y: number;
    w: number;
    h: number;
}

const overlaps = (a: Cell, b: Cell) =>
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
