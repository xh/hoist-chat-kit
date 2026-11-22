import type {BlueprintModel} from '../../../../../blueprint';

/** What a drag carries: an element of the blueprint, or a widget of the registry to add. */
export type DropSource = {element: string} | {widget: string};

/** Where a drop lands: a container, and its place among the container's children as they are now. */
export interface DropPlaceTarget {
    container: string;
    /** The index to insert at, counting the dragged element where it is already a child. */
    index?: number;
}

/** Where a drag over a blueprint would drop, and how to show it. */
export interface DropPlace {
    target: DropPlaceTarget;
    /** Why the container refuses it, or null. */
    refusal: string;
    /** The container's element on the page. */
    containerEl: HTMLElement;
    /** True for a canvas or a dash container, which places drops itself. */
    ownDrop: boolean;
    /**
     * The insertion line, in pixels from the container's top-left: across its main axis at `at`,
     * from `from` to `to` along the other.
     */
    line?: {axis: 'row' | 'column'; at: number; from: number; to: number};
    /** The pointer, in pixels from the container's top-left. */
    pointer: {x: number; y: number};
}

/**
 * Where a drag at a point would drop: the deepest container under the point, never the dragged
 * element or one inside it, and the place among its children along its main axis. Where that
 * container refuses, its refusal, never an ancestor's place.
 */
export function dropPlaceAt(
    host: HTMLElement,
    blueprintModel: BlueprintModel,
    source: DropSource,
    x: number,
    y: number,
    canDropAt: (source: DropSource, target: DropPlaceTarget) => string
): DropPlace {
    const hit = document.elementFromPoint(x, y);
    if (!hit || !host.contains(hit)) return null;
    const dragged = 'element' in source ? elementEl(host, source.element) : null;
    let el = wrapperOf(dragged?.contains(hit) ? dragged.parentElement : hit);
    while (el && !layoutOf(blueprintModel, el.dataset.blueprintElement)) {
        el = wrapperOf(el.parentElement);
    }
    if (!el) return null;

    const container = el.dataset.blueprintElement,
        layout = layoutOf(blueprintModel, container),
        box = el.getBoundingClientRect(),
        pointer = {x: x - box.left, y: y - box.top},
        refuse = (target: DropPlaceTarget) => canDropAt(source, target);
    if (layout === 'own') {
        const target = {container};
        return {target, refusal: refuse(target), containerEl: el, ownDrop: true, pointer};
    }

    if (layout === 'tabs') return tabsPlace(el, hit, blueprintModel, x, y, pointer, box, refuse);
    const rects = childEls(el, blueprintModel, container).map(it => it.getBoundingClientRect()),
        index = layout === 'grid' ? gridIndex(rects, x, y) : lineIndex(rects, layout, x, y),
        target = {container, index};
    return {
        target,
        refusal: refuse(target),
        containerEl: el,
        ownDrop: false,
        line: rects.length ? lineAt(rects, index, layout, box) : null,
        pointer
    };
}

//------------------
// Implementation
//------------------
const ELEMENT = '[data-blueprint-element]';

type Layout = 'row' | 'column' | 'grid' | 'tabs' | 'own';

// How a container lays out its children, or null for an element that holds none.
function layoutOf(blueprintModel: BlueprintModel, id: string): Layout {
    const el = blueprintModel.effective?.elements?.[id];
    if (!blueprintModel.registry.widgets[el?.component]?.children) return null;
    switch (el.component) {
        case 'dashCanvas':
        case 'dashContainer':
            return 'own';
        case 'box':
            return el.config?.direction === 'row' ? 'row' : 'column';
        case 'toolbar':
            return 'row';
        case 'tileFrame':
            return 'grid';
        case 'tabContainer':
            return 'tabs';
        default:
            return 'column';
    }
}

function wrapperOf(node: Element): HTMLElement {
    return node?.closest<HTMLElement>(ELEMENT) ?? null;
}

function elementEl(host: HTMLElement, id: string): HTMLElement {
    return host.querySelector<HTMLElement>(`[data-blueprint-element="${CSS.escape(id)}"]`);
}

// The wrappers of a container's children, in their order, that sit directly in it.
function childEls(el: HTMLElement, blueprintModel: BlueprintModel, id: string): HTMLElement[] {
    const refs = blueprintModel.effective?.elements?.[id]?.children ?? [];
    return refs
        .map(it => elementEl(el, it.id))
        .filter(it => it && wrapperOf(it.parentElement) === el);
}

// Over its tab buttons, between them on their axis. Over the body, a tab after the last.
function tabsPlace(
    el: HTMLElement,
    hit: Element,
    blueprintModel: BlueprintModel,
    x: number,
    y: number,
    pointer: DropPlace['pointer'],
    box: DOMRect,
    refuse: (target: DropPlaceTarget) => string
): DropPlace {
    const container = el.dataset.blueprintElement,
        strip = hit.closest('[role=tablist]'),
        count = blueprintModel.effective?.elements?.[container]?.children?.length ?? 0,
        base = {containerEl: el, ownDrop: false, pointer};
    if (!strip || wrapperOf(strip) !== el) {
        const target = {container, index: count};
        return {...base, target, refusal: refuse(target)};
    }
    const rects = [...strip.querySelectorAll('[role=tab]')].map(it => it.getBoundingClientRect()),
        position = blueprintModel.effective.elements[container].config?.switcherPosition,
        axis = position === 'left' || position === 'right' ? 'column' : 'row',
        index = lineIndex(rects, axis, x, y),
        target = {container, index};
    return {
        ...base,
        target,
        refusal: refuse(target),
        line: rects.length ? lineAt(rects, index, axis, box) : null
    };
}

// The first child whose middle lies past the point along the axis, else the end.
function lineIndex(rects: DOMRect[], axis: 'row' | 'column', x: number, y: number): number {
    const ret = rects.findIndex(r =>
        axis === 'row' ? x < r.left + r.width / 2 : y < r.top + r.height / 2
    );
    return ret < 0 ? rects.length : ret;
}

// The first tile the point comes before in reading order: in a row above it, or earlier in its row.
function gridIndex(rects: DOMRect[], x: number, y: number): number {
    const ret = rects.findIndex(r => y < r.top || (y <= r.bottom && x < r.left + r.width / 2));
    return ret < 0 ? rects.length : ret;
}

// The line between the children at the index, across their extent. A grid's runs down a tile's edge.
function lineAt(
    rects: DOMRect[],
    index: number,
    layout: 'row' | 'column' | 'grid',
    box: DOMRect
): DropPlace['line'] {
    const prev = rects[index - 1],
        next = rects[index];
    if (layout === 'grid') {
        const at = next ? next.left : prev.right,
            tile = next ?? prev;
        return {
            axis: 'row',
            at: at - box.left,
            from: tile.top - box.top,
            to: tile.bottom - box.top
        };
    }
    const row = layout === 'row',
        start = (r: DOMRect) => (row ? r.left : r.top),
        end = (r: DOMRect) => (row ? r.right : r.bottom),
        at = prev && next ? (end(prev) + start(next)) / 2 : next ? start(next) : end(prev),
        across = rects.map(r => (row ? [r.top, r.bottom] : [r.left, r.right])),
        origin = row ? box.left : box.top,
        crossOrigin = row ? box.top : box.left;
    return {
        axis: layout,
        at: at - origin,
        from: Math.min(...across.map(it => it[0])) - crossOrigin,
        to: Math.max(...across.map(it => it[1])) - crossOrigin
    };
}
