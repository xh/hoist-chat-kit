import {HoistModel, managed} from '@xh/hoist/core';
import {action, observable, observableRef} from '@xh/hoist/mobx';
import {cloneDeep, isEqual} from 'lodash';
import type {ReactNode} from 'react';
import {layoutGesture} from '../gesture';
import {OverlayModel} from '../overlay';
import {
    type DockItem,
    type DockTarget,
    type DockZone,
    dockMoveRefusal,
    moveView,
    stacksOf
} from './dockTree';

// A stand-in id for an external drag's view, to test where it could go.
const NEW_VIEW = '\u0000new';

/** A finished change to a dock layout. */
export interface DockChange {
    kind: 'move' | 'resize';
    /** The view moved, for a move. */
    id?: string;
}

export interface DockLayoutProps {
    /** The tree of splits, stacks and views, as the host holds it. The layout keeps no copy. */
    layout: DockItem[];
    /** A view's content. */
    renderView: (id: string) => ReactNode;
    /** A view's tab label. */
    viewTitle: (id: string) => ReactNode;
    /** Called once per finished move or resize, with the new tree. */
    onChange?: (layout: DockItem[], change: DockChange) => void;
    /** True to let views move and splits resize. Default false. */
    editable?: boolean;
    /** Why a move may not happen, or null if it may: checked once per zone per drag. */
    canMove?: (id: string, target: DockTarget) => string;
    /** Views to show, each in its own stack, such as to reveal a selection. */
    active?: string[];
    /** Called with the views no tab shows, whenever they change. */
    onHiddenChange?: (ids: string[]) => void;
    /** The overlay to draw drop previews in. Default one of its own, over the layout. */
    overlay?: OverlayModel;
    /**
     * The key of an external drag the layout may take, such as a widget from a palette, or null
     * for none. A drop of one calls `onDropExternal`.
     */
    externalDrag?: () => string;
    /**
     * For an external drag, false to leave the drag at a point to something inside a view, such
     * as a container there, which then gets it. Default true.
     */
    acceptsDragAt?: (e: DragEvent) => boolean;
    /** Add a new view for an external drag's key at a target, as one change. */
    onDropExternal?: (key: string, target: DockTarget) => void;
    /** Why an external drag may not drop at a target, or null if it may. */
    canDropExternal?: (key: string, target: DockTarget) => string;
}

/** The drop a drag would make now, and why it may not, if it may not. */
export interface DockDrop {
    target: DockTarget;
    refusal: string;
    /** For a tab drop, the insertion bar's offset from the stack's left edge, in pixels. */
    barX?: number;
}

/**
 * A dock layout's view state: which tab each stack shows, and the drag in progress. Layout lives
 * with the host, so a move or resize is reported once as a new tree.
 * @internal
 */
export class DockLayoutModel extends HoistModel {
    // Set on each render, so not observable: the parent re-renders the layout when it changes.
    props: DockLayoutProps = null;

    /** Views chosen to show, at most one per stack. Others show their stack's first view. */
    @observableRef accessor chosen: string[] = [];

    /** Views drawn at least once, kept mounted while hidden so they keep their state. */
    @observableRef accessor mounted: string[] = [];

    /** The view being dragged, or null. */
    @observable accessor dragging: string = null;

    @observableRef accessor drop: DockDrop = null;

    /** The overlay this layout draws previews in, if the host gives none. */
    @managed readonly ownOverlay = new OverlayModel();

    /** Each stack's element, by its first view, and the layout's own, for previews. */
    stackEls = new Map<string, HTMLElement>();
    rootEl: HTMLElement = null;

    get overlay(): OverlayModel {
        return this.props?.overlay ?? this.ownOverlay;
    }

    /** The view a stack shows. */
    activeOf(stack: DockItem): string {
        const ids = (stack.content ?? []).map(it => it.id);
        return ids.find(id => this.chosen.includes(id)) ?? ids[0];
    }

    /** Every view no tab shows. */
    get hidden(): string[] {
        return this.stacks.flatMap(views => {
            const active = views.find(id => this.chosen.includes(id)) ?? views[0];
            return views.filter(id => id !== active);
        });
    }

    get stacks(): string[][] {
        return stacksOf(this.props?.layout);
    }

    /** Show a view in its stack, in the given layout or the current one. */
    @action
    activate(id: string, layout: DockItem[] = this.props?.layout) {
        const stack = stacksOf(layout).find(it => it.includes(id));
        if (!stack) return;
        // The view shown until now stays mounted, hidden, so it keeps its state.
        const shown = stack.find(it => this.chosen.includes(it)) ?? stack[0],
            added = [shown, id].filter(it => !this.mounted.includes(it));
        this.chosen = [...this.chosen.filter(it => !stack.includes(it)), id];
        if (added.length) this.mounted = [...this.mounted, ...added];
    }

    /** Move a view one place earlier or later in its tab strip, as one change. */
    reorder(id: string, step: -1 | 1) {
        const {layout, onChange, editable} = this.props,
            stack = this.stacks.find(it => it.includes(id)),
            idx = stack?.indexOf(id);
        if (!editable || !stack || idx + step < 0 || idx + step >= stack.length) return;
        const next = moveView(layout, id, {view: id, zone: 'tab', index: idx + step});
        if (!next) return;
        // The stack may draw again, so its tab takes focus back once it has.
        this.pendingFocus = id;
        onChange?.(next, {kind: 'move', id});
    }

    /** A tab to focus once the layout next draws, after a keyboard move. */
    pendingFocus: string = null;

    /** Set a split's sizes, from a finished resize, as one change. */
    resize(path: number[], sizes: number[]) {
        const {layout, onChange, editable} = this.props;
        if (!editable) return;
        const next = withSizes(layout, path, sizes);
        if (!isEqual(next, layout)) onChange?.(next, {kind: 'resize'});
    }

    //------------------
    // Drag
    //------------------
    @action
    startDrag(id: string) {
        layoutGesture.start();
        this.dragging = id;
        this.drop = null;
        this.verdicts.clear();
    }

    @action
    endDrag() {
        if (this.dragging) layoutGesture.end();
        this.dragging = null;
        this.drop = null;
        this.verdicts.clear();
        this.overlay.layoutChanged();
    }

    /** The key of the external drag in progress that this layout may take, or null. */
    get external(): string {
        return this.dragging ? null : (this.props?.externalDrag?.() ?? null);
    }

    /** Note where the drag would drop now. Returns true if it may drop there. */
    @action
    dragOver(target: DockTarget, barX?: number): boolean {
        const {dragging, external} = this,
            {layout, canMove, canDropExternal} = this.props;
        if (!dragging && !external) return false;
        const key = `${dragging ?? external}|${JSON.stringify(target)}`;
        if (!this.verdicts.has(key)) {
            const placed = dockMoveRefusal(layout, dragging ?? NEW_VIEW, target, !dragging);
            this.verdicts.set(
                key,
                placed ??
                    (dragging
                        ? canMove?.(dragging, target)
                        : canDropExternal?.(external, target)) ??
                    null
            );
        }
        const drop = {target, refusal: this.verdicts.get(key), barX};
        if (!isEqual(drop, this.drop)) this.drop = drop;
        return !drop.refusal;
    }

    /**
     * Clear a drag's preview as soon as it moves over, drops on or ends anywhere outside the layout.
     * Returns its remover.
     */
    followDrags(): () => void {
        const outside = (e: Event) => {
                if (this.drop && !this.rootEl?.contains(e.target as Node)) this.clearDrop();
            },
            types = ['dragover', 'drop', 'dragend'];
        // Capturing, as a canvas stops the drags it handles from bubbling.
        types.forEach(it => window.addEventListener(it, outside, true));
        return () => types.forEach(it => window.removeEventListener(it, outside, true));
    }

    /** Make the drop the drag is over, as one change. */
    dropHere() {
        const {dragging, external, drop} = this;
        if (drop && !drop.refusal) {
            if (dragging) {
                const next = moveView(this.props.layout, dragging, drop.target);
                if (next) {
                    this.activate(dragging, next);
                    this.props.onChange?.(next, {kind: 'move', id: dragging});
                }
            } else if (external) {
                this.props.onDropExternal?.(external, drop.target);
            }
        }
        this.endDrag();
    }

    //------------------
    // Implementation
    //------------------
    @action
    private clearDrop() {
        this.drop = null;
    }

    private verdicts = new Map<string, string>();
}

/** The zone of a stack's body a point falls in: an edge in the outer quarter, else the center. */
export function zoneAt(rect: DOMRect, x: number, y: number): DockZone {
    const fx = (x - rect.left) / rect.width,
        fy = (y - rect.top) / rect.height,
        edges: [DockZone, number][] = [
            ['left', fx],
            ['right', 1 - fx],
            ['top', fy],
            ['bottom', 1 - fy]
        ],
        [zone, dist] = edges.reduce((a, b) => (b[1] < a[1] ? b : a));
    return dist < 0.25 ? zone : 'center';
}

/** The index a tab drop takes, between the tabs a point falls between. */
export function tabIndexAt(tabs: Pick<DOMRect, 'left' | 'width'>[], x: number): number {
    const idx = tabs.findIndex(it => x < it.left + it.width / 2);
    return idx < 0 ? tabs.length : idx;
}

/** A layout with the children of the split at a path sized as given, in percent. */
export function withSizes(layout: DockItem[], path: number[], sizes: number[]): DockItem[] {
    const ret = cloneDeep(layout),
        split = path.reduce<DockItem>((it, idx) => (it ? it.content[idx] : null), {
            type: 'row',
            content: ret
        } as DockItem);
    if (!split?.content) return layout;
    const key = split.type === 'column' ? 'height' : 'width';
    split.content.forEach((it, idx) => (it[key] = Math.round(sizes[idx] * 100) / 100));
    return ret;
}
