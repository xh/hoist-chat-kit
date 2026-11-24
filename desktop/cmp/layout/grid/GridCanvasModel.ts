import {HoistModel} from '@xh/hoist/core';
import {
    cloneLayout,
    type Compactor,
    getCompactor,
    type Layout,
    type LayoutItem,
    moveElement
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

/**
 * How a canvas packs its cells: floating up, or left, as react-grid-layout compacts, or not at all,
 * where each cell stays where it is put.
 */
export type GridCompact = 'vertical' | 'horizontal' | false;

/** How cells are placed: as {@link GridCanvasProps} sets them, with the same defaults. */
export interface GridPlacement {
    compact?: GridCompact;
    preventCollision?: boolean;
    columns?: number;
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
    itemRenderer: (id: string) => ReactNode;
    /** A cell's header, which is also its drag handle. Null for a cell with none. */
    headerRenderer?: (id: string) => ReactNode;
    /**
     * A grip for a cell with no header, drawn on its frame's top edge, which is then its drag
     * handle. Null for a cell with none.
     */
    gripRenderer?: (id: string) => ReactNode;
    /** Attributes for a cell's frame, such as data attributes for hit tests. */
    frameProps?: (id: string) => Record<string, unknown>;
    /** Called once per finished move or resize, with every item it changed. */
    onChange?: (cells: GridCell[], change: GridCanvasChange) => void;
    /** For an external drag over the canvas: the size of the cell it would make, or false to refuse. */
    onDropOver?: (e: DragEvent) => {w: number; h: number} | false;
    /** An external drag dropped at a place, with the other cells where the drop left them. */
    onDrop?: (place: Omit<GridCell, 'id'>, cells: GridCell[], e: DragEvent) => void;
    /**
     * How the canvas packs its cells. Default 'vertical'. With false, a moved cell stays where it
     * is put, and the cells it lands on move down as far as they must.
     */
    compact?: GridCompact;
    /** True to refuse a move or resize onto another cell, which then snaps back. Default false. */
    preventCollision?: boolean;
    /** The most rows the canvas holds. Default unlimited. */
    maxRows?: number;
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
 * The cells with one placed as a move or resize leaves it: it keeps the place given, but no lower
 * than the first free row below the others, and each cell it lands on moves down as far as it
 * must, in reading order. A pointer gesture places cells so.
 */
export function placeCell(
    cells: GridCell[],
    placed: GridCell,
    {compact = 'vertical', preventCollision = false, columns = 12}: GridPlacement = {}
): GridCell[] {
    if (
        preventCollision &&
        hitOf(
            cells.filter(it => it.id !== placed.id),
            placed
        )
    )
        return null;
    if (!compact) {
        const ret = cells.map(it =>
            it.id === placed.id ? {...it, ...pick(placed, 'x', 'y', 'w', 'h')} : {...it}
        );
        pushApart(ret, it => it.id, placed.id);
        return ret;
    }
    const layout = toLayout(cells),
        item = layout.find(it => it.i === placed.id);
    item.w = placed.w;
    item.h = placed.h;
    const moved = moveElement(
        layout,
        item,
        placed.x,
        placed.y,
        true,
        false,
        compact,
        columns,
        false
    );
    return fromLayout(cells, getCompactor(compact).compact(moved, columns));
}

/** The cells as a canvas of this compaction shows them: floated up or left, or as they are. */
export function compactCells(
    cells: GridCell[],
    {compact = 'vertical', columns = 12}: GridPlacement = {}
): GridCell[] {
    return compact
        ? fromLayout(cells, getCompactor(compact).compact(toLayout(cells), columns))
        : cells;
}

/**
 * A grid canvas's gesture state. It turns react-grid-layout's gestures into one change each, and
 * hands react-grid-layout the host's cells again after each one, since react-grid-layout keeps
 * its own copy and would otherwise hold a gesture the host did not apply.
 * @internal
 */
export class GridCanvasModel extends HoistModel {
    /** The canvas's props, from its component, with their defaults. Observable. */
    get props(): CanvasModelProps {
        const {cells, onChange, compact, preventCollision, onDropOver} = this
            .componentProps as GridCanvasProps;
        return {
            cells: cells ?? [],
            onChange,
            compact: compact ?? 'vertical',
            preventCollision: preventCollision ?? false,
            onDropOver
        };
    }

    /** Bumped after each gesture, to hand react-grid-layout the host's cells again. */
    @observable accessor epoch = 0;

    /** The layout for react-grid-layout: the host's cells, marked with the epoch. */
    get layout(): LayoutItem[] {
        const {epoch} = this;
        return this.props.cells.map(
            ({id, x, y, w, h, minW, minH}) => ({i: id, x, y, w, h, minW, minH, epoch}) as LayoutItem
        );
    }

    /** The grid's layout element, where react-grid-layout takes drags from outside. */
    layoutEl: HTMLElement = null;

    /** Where a drag from outside would drop, as the host says, noting whether it shows a preview. */
    dropOver(e: DragEvent): {w: number; h: number} | false {
        if (this.clearingDrop) return false;
        const ret = this.props.onDropOver ? this.props.onDropOver(e) : undefined;
        this.dropShown = ret !== false;
        return ret;
    }

    /** Note that a drop landed, which react-grid-layout clears itself. */
    dropped() {
        this.dropShown = false;
    }

    /**
     * Clear the preview of a drag that has left the canvas or ended, as soon as it does. Returns
     * its remover.
     */
    followDrags(): () => void {
        const outside = (e: Event) => {
                if (!this.layoutEl?.contains(e.target as Node)) this.clearDrop();
            },
            ended = () => this.clearDrop();
        // Capturing, as react-grid-layout stops the drags it handles from bubbling.
        window.addEventListener('dragover', outside, true);
        window.addEventListener('drop', outside, true);
        window.addEventListener('dragend', ended, true);
        return () => {
            window.removeEventListener('dragover', outside, true);
            window.removeEventListener('drop', outside, true);
            window.removeEventListener('dragend', ended, true);
        };
    }

    /** react-grid-layout's compactor, for the canvas's compaction, placing as {@link placeCell}. */
    get compactor(): Compactor {
        const {compact = 'vertical', preventCollision = false} = this.props,
            key = `${compact}|${preventCollision}`;
        if (key !== this.compactorKey) {
            this.compactorKey = key;
            this.compactorFor = compact
                ? getCompactor(compact, false, preventCollision)
                : preventCollision
                  ? getCompactor(null, false, true)
                  : this.pushCompactor;
        }
        return this.compactorFor;
    }

    // No compaction, and nothing overlaps. The cell a gesture moves keeps its place, and every
    // other cell starts from the host's place for it, so one pushed aside goes back once it passes.
    private readonly pushCompactor: Compactor = {
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
    private dropShown = false;
    private clearingDrop = false;

    // react-grid-layout clears its preview only when a count of dragenters and dragleaves returns
    // to 0, which a cell redrawn under the pointer can upset. A dragover it is refused clears it.
    private clearDrop() {
        if (!this.dropShown || !this.layoutEl) return;
        this.clearingDrop = true;
        try {
            this.layoutEl.dispatchEvent(new Event('dragover', {bubbles: true, cancelable: true}));
        } finally {
            this.clearingDrop = false;
            this.dropShown = false;
        }
    }
    private cancelled = false;
    private listening = false;
    private activeId: string = null;
    private compactorKey: string = null;
    private compactorFor: Compactor = null;

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

// Move each item down below any placed item it overlaps: the pinned one first, no lower than the
// others' bottom, then the rest in reading order.
function pushApart<T extends Box>(items: T[], idOf: (it: T) => string, pinned: string) {
    const placed: T[] = [],
        pin = items.find(it => idOf(it) === pinned),
        bottom = Math.max(0, ...items.filter(it => it !== pin).map(it => it.y + it.h));
    if (pin) pin.y = Math.min(pin.y, bottom);
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

type CanvasModelProps = Pick<
    GridCanvasProps,
    'cells' | 'onChange' | 'compact' | 'preventCollision' | 'onDropOver'
>;

function toLayout(cells: GridCell[]): LayoutItem[] {
    return cells.map(({id, x, y, w, h}) => ({i: id, x, y, w, h}));
}

// The cells at the places a layout gives them, in their own order.
function fromLayout(cells: GridCell[], layout: Layout): GridCell[] {
    const byId = new Map(layout.map(it => [it.i, it]));
    return cells.map(it => ({...it, ...pick(byId.get(it.id), 'x', 'y', 'w', 'h')}));
}
