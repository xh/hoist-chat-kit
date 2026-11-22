import {HoistModel} from '@xh/hoist/core';
import {
    cloneLayout,
    type Compactor,
    type Layout,
    type LayoutItem
} from '@xh/hoist/kit/react-grid-layout';
import {action, observable} from '@xh/hoist/mobx';
import {pick, sortBy} from 'lodash';
import type {ReactNode} from 'react';
import {layoutGesture} from '../gesture';

/** A cell of a grid canvas: its id and its place, in grid units. */
export interface GridCell {
    id: string;
    x: number;
    y: number;
    w: number;
    h: number;
    /** The smallest size a resize may give it. */
    minW?: number;
    minH?: number;
}

/** What a finished gesture changed. */
export interface GridCanvasChange {
    kind: 'move' | 'resize';
    /** The item the user moved or resized. */
    id: string;
}

export interface GridCanvasProps {
    /** The cells, as the host holds them. The canvas keeps no copy. */
    cells: GridCell[];
    /** Each cell's content. */
    renderItem: (id: string) => ReactNode;
    /** A cell's header, which is also its drag handle. Null for a cell with none. */
    renderHeader?: (id: string) => ReactNode;
    /**
     * A grip for a cell with no header, drawn on its frame's top edge, which is then its drag
     * handle. Null for a cell with none.
     */
    renderGrip?: (id: string) => ReactNode;
    /** Attributes for a cell's frame, such as data attributes for hit tests. */
    frameProps?: (id: string) => Record<string, unknown>;
    /** Called once per finished move or resize, with every item it changed. */
    onChange?: (cells: GridCell[], change: GridCanvasChange) => void;
    /** For an external drag over the canvas: the size of the cell it would make, or false to refuse. */
    onDropOver?: (e: DragEvent) => {w: number; h: number} | false;
    /** An external drag dropped at a place, with the other cells where the drop left them. */
    onDrop?: (place: Omit<GridCell, 'id'>, cells: GridCell[], e: DragEvent) => void;
    /** True to let cells move and resize. Default false. */
    editable?: boolean;
    /** True to draw the grid's cells behind the cells. Default false. */
    showGrid?: boolean;
    columns?: number;
    rowHeight?: number;
    margin?: [number, number];
    containerPadding?: [number, number];
}

/**
 * The cells with one placed as a move or resize leaves it: it keeps the place given, and each cell
 * it lands on moves down as far as it must, in reading order. A pointer gesture places cells so.
 */
export function placeCell(cells: GridCell[], placed: GridCell): GridCell[] {
    const ret = cells.map(it =>
        it.id === placed.id ? {...it, ...pick(placed, 'x', 'y', 'w', 'h')} : {...it}
    );
    pushApart(ret, it => it.id, placed.id);
    return ret;
}

/**
 * A grid canvas's gesture state. It turns react-grid-layout's gestures into one change each, and
 * hands react-grid-layout the host's cells again after each one, since react-grid-layout keeps
 * its own copy and would otherwise hold a gesture the host did not apply.
 * @internal
 */
export class GridCanvasModel extends HoistModel {
    // Set on each render, so not observable: the parent re-renders the canvas when it changes.
    props: Pick<GridCanvasProps, 'cells' | 'onChange'> = {cells: []};

    /** Bumped after each gesture, to hand react-grid-layout the host's cells again. */
    @observable accessor epoch = 0;

    /** The layout for react-grid-layout: the host's cells, marked with the epoch. */
    get layout(): LayoutItem[] {
        const {epoch} = this;
        return this.props.cells.map(
            ({id, x, y, w, h, minW, minH}) => ({i: id, x, y, w, h, minW, minH, epoch}) as LayoutItem
        );
    }

    setProps(props: Pick<GridCanvasProps, 'cells' | 'onChange'>) {
        this.props = props;
    }

    /**
     * Places cells for react-grid-layout as {@link placeCell} does: no compaction, and nothing
     * overlaps. The cell a gesture moves keeps its place, and every other cell starts from the
     * host's place for it, so a cell pushed aside goes back once the moved one passes on.
     */
    readonly compactor: Compactor = {
        type: null,
        allowOverlap: true,
        compact: (layout: Layout) => this.compact(layout)
    };

    /** Start a move or resize of a cell, which Esc then cancels. */
    startGesture(id: string = null) {
        this.activeId = id;
        layoutGesture.start();
        this.cancelled = false;
        this.listening = true;
        window.addEventListener('keydown', this.onKey, true);
    }

    /** End a move or resize, reporting what it changed unless it was cancelled. */
    endGesture(kind: GridCanvasChange['kind'], id: string, layout: readonly LayoutItem[]) {
        this.activeId = null;
        layoutGesture.end();
        this.stopListening();
        const {cells, onChange} = this.props,
            byId = new Map(cells.map(it => [it.id, it])),
            changed = this.cancelled
                ? []
                : layout
                      .filter(it => byId.has(it.i))
                      .map(({i, x, y, w, h}) => ({id: i, x, y, w, h}))
                      .filter(it => {
                          const was = byId.get(it.id);
                          return (
                              was.x !== it.x || was.y !== it.y || was.w !== it.w || was.h !== it.h
                          );
                      });
        this.cancelled = false;
        if (changed.length) onChange?.(changed, {kind, id});
        this.bumpEpoch();
    }

    override destroy() {
        if (this.listening) layoutGesture.end();
        this.stopListening();
        super.destroy();
    }

    //------------------
    // Implementation
    //------------------
    private cancelled = false;
    private listening = false;
    private activeId: string = null;

    private compact(layout: Layout): Layout {
        const ret = cloneLayout(layout) as LayoutItem[],
            hostCells = new Map(this.props.cells.map(it => [it.id, it])),
            pinned = this.activeId ?? ret.find(it => it.i === DROPPING)?.i;
        ret.forEach(it => {
            const host = hostCells.get(it.i);
            if (it.i !== pinned && host) Object.assign(it, pick(host, 'x', 'y', 'w', 'h'));
        });
        pushApart(ret, it => it.i, pinned);
        return ret;
    }

    // Esc ends react-draggable's drag through a mouseup, which then ends the gesture unreported.
    private onKey = (e: KeyboardEvent) => {
        if (e.key !== 'Escape') return;
        e.stopPropagation();
        e.preventDefault();
        this.cancelled = true;
        document.dispatchEvent(new MouseEvent('mouseup', {bubbles: true}));
    };

    private stopListening() {
        if (!this.listening) return;
        this.listening = false;
        window.removeEventListener('keydown', this.onKey, true);
    }

    @action
    private bumpEpoch() {
        this.epoch++;
    }
}

// The item react-grid-layout adds for an external drag over the canvas.
const DROPPING = '__dropping-elem__';

type Box = {x: number; y: number; w: number; h: number};

// Move each item down below any placed item it overlaps: the pinned one first, then in reading order.
function pushApart<T extends Box>(items: T[], idOf: (it: T) => string, pinned: string) {
    const placed: T[] = [];
    sortBy(items, it => (idOf(it) === pinned ? 0 : 1), 'y', 'x').forEach(it => {
        for (let hit = hitOf(placed, it); hit; hit = hitOf(placed, it)) it.y = hit.y + hit.h;
        placed.push(it);
    });
}

function hitOf<T extends Box>(placed: T[], b: Box): T {
    return placed.find(
        a => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
    );
}
