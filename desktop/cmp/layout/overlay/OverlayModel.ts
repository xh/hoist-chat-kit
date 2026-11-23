import {HoistModel} from '@xh/hoist/core';
import {action, observable, observableRef} from '@xh/hoist/mobx';
import type {ReactNode} from 'react';

/** Where a mark draws: an element, or a selector matched within the overlay's area. */
export type OverlayTarget = Element | string;

/** A target's box within the overlay layer, with the layer's size. */
export interface OverlayBox {
    x: number;
    y: number;
    width: number;
    height: number;
    area: {width: number; height: number};
    /** Pixels between the target's top and the top of the window, for a mark drawn above it. */
    roomAbove: number;
    /**
     * Where the target can show within the layer: the area, cut by each scrolling container between
     * it and the target. Null when nothing bounds it.
     */
    clip: {x: number; y: number; width: number; height: number};
}

/** Something drawn over a target, such as an outline, a tag, a toolbar or a drop preview. */
export interface OverlayMark {
    key: string;
    target: OverlayTarget;
    /** The mark's content. It sits in the target's box and may draw outside it, within its clip. */
    render: (box: OverlayBox) => ReactNode;
    /**
     * False to draw past the box's clip, such as a label at the pointer. Default true, so a target
     * partly scrolled out of view shows only its visible part.
     */
    clip?: boolean;
    /** True for a mark that takes pointer events, such as a toolbar. Default false. */
    interactive?: boolean;
    /** Its stacking layer, from {@link OVERLAY_LAYERS}. Default `design`. */
    layer?: number;
}

/** Stacking layers, lowest first: drop previews draw above hover and selection. */
export const OVERLAY_LAYERS = {design: 1, dock: 2} as const;

/**
 * The marks an overlay layer draws, from sources callers add. A source is a function, so the marks
 * it returns follow the observables it reads. Marks move as the layout changes: the host reports
 * scrolling and resizing, and a container calls {@link layoutChanged} after it moves anything.
 * @internal
 */
export class OverlayModel extends HoistModel {
    /** Bumped on each layout change, for the layer to measure its targets again. */
    @observable accessor layoutVersion = 0;

    @observableRef accessor sources: Record<string, () => OverlayMark[]> = {};

    /** The element that holds the area and the layer, which marks are placed relative to. */
    hostEl: HTMLElement = null;

    /** Add a source of marks under an id, replacing any with that id. Returns its remover. */
    @action
    addMarks(id: string, source: () => OverlayMark[]): () => void {
        this.sources = {...this.sources, [id]: source};
        return () => this.removeMarks(id, source);
    }

    /** Tell the layer that targets may have moved, such as after a drag or a tab switch. */
    @action
    layoutChanged() {
        this.layoutVersion++;
    }

    @action
    setHostEl(el: HTMLElement) {
        if (this.hostEl === el) return;
        this.hostEl = el;
        this.layoutVersion++;
    }

    /** Every mark, lowest layer first. */
    get marks(): OverlayMark[] {
        return Object.values(this.sources)
            .flatMap(it => it() ?? [])
            .map(it => ({layer: OVERLAY_LAYERS.design, ...it}))
            .sort((a, b) => a.layer - b.layer);
    }

    /** A target's box within the layer, or null if it is not found or scrolled out of view. */
    boxOf(target: OverlayTarget): OverlayBox {
        const {hostEl} = this;
        if (!hostEl) return null;
        const el = typeof target === 'string' ? hostEl.querySelector(target) : target;
        if (!el || !hostEl.contains(el)) return null;
        const r = el.getBoundingClientRect();
        if (!r.width && !r.height) return null;
        const host = hostEl.getBoundingClientRect(),
            view = viewOf(el, hostEl, host);
        if (view && !overlaps(r, view)) return null;
        return {
            x: r.left - host.left,
            y: r.top - host.top,
            width: r.width,
            height: r.height,
            area: {width: host.width, height: host.height},
            roomAbove: r.top,
            clip: view
                ? {
                      x: view.left - host.left,
                      y: view.top - host.top,
                      width: view.right - view.left,
                      height: view.bottom - view.top
                  }
                : null
        };
    }

    //------------------
    // Implementation
    //------------------
    @action
    private removeMarks(id: string, source: () => OverlayMark[]) {
        if (this.sources[id] !== source) return;
        const {[id]: _gone, ...rest} = this.sources;
        this.sources = rest;
    }
}

interface Bounds {
    left: number;
    top: number;
    right: number;
    bottom: number;
}

// Where a target can show: the host, cut by the client area of each clipping ancestor up to it.
function viewOf(el: Element, hostEl: HTMLElement, host: DOMRect): Bounds {
    // An unmeasured host bounds nothing.
    let ret: Bounds = host.width && host.height ? host : null;
    for (let it = el.parentElement; it && it !== hostEl; it = it.parentElement) {
        const {overflowX, overflowY} = window.getComputedStyle(it);
        if (overflowX === 'visible' && overflowY === 'visible') continue;
        // An element with no client box, such as an inline one, clips nothing.
        if (!it.clientWidth && !it.clientHeight) continue;
        const r = it.getBoundingClientRect(),
            left = r.left + it.clientLeft,
            top = r.top + it.clientTop,
            client = {left, top, right: left + it.clientWidth, bottom: top + it.clientHeight};
        ret = ret
            ? {
                  left: Math.max(ret.left, client.left),
                  top: Math.max(ret.top, client.top),
                  right: Math.min(ret.right, client.right),
                  bottom: Math.min(ret.bottom, client.bottom)
              }
            : client;
    }
    return ret;
}

function overlaps(r: Bounds, view: Bounds): boolean {
    return r.left < view.right && r.right > view.left && r.top < view.bottom && r.bottom > view.top;
}
