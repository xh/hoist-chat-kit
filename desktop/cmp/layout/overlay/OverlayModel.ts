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
}

/** Something drawn over a target, such as an outline, a tag, a toolbar or a drop preview. */
export interface OverlayMark {
    key: string;
    target: OverlayTarget;
    /** The mark's content. It sits in the target's box and may draw outside it. */
    render: (box: OverlayBox) => ReactNode;
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

    /** A target's box within the layer, or null if it is not found or not shown. */
    boxOf(target: OverlayTarget): OverlayBox {
        const {hostEl} = this;
        if (!hostEl) return null;
        const el = typeof target === 'string' ? hostEl.querySelector(target) : target;
        if (!el || !hostEl.contains(el)) return null;
        const r = el.getBoundingClientRect();
        if (!r.width && !r.height) return null;
        const host = hostEl.getBoundingClientRect();
        return {
            x: r.left - host.left,
            y: r.top - host.top,
            width: r.width,
            height: r.height,
            area: {width: host.width, height: host.height}
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
