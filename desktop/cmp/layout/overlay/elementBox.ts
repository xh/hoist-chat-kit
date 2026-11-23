/**
 * An element's box on the page. One with `display: contents` has none of its own, so its box is
 * the union of its children's. Empty, at 0,0, for an element that draws nothing.
 * @internal
 */
export function elementBox(el: Element): DOMRect {
    if (!isContents(el)) return el.getBoundingClientRect();
    const rects = [...el.children].map(elementBox).filter(it => it.width || it.height);
    if (!rects.length) return rect(0, 0, 0, 0);
    return rect(
        Math.min(...rects.map(it => it.left)),
        Math.min(...rects.map(it => it.top)),
        Math.max(...rects.map(it => it.right)),
        Math.max(...rects.map(it => it.bottom))
    );
}

/**
 * The element that draws an element's box: itself, or for one with `display: contents`, its first
 * child that draws one, such as to scroll into view. Null for none.
 * @internal
 */
export function boxElement(el: Element): Element {
    if (!el || !isContents(el)) return el ?? null;
    for (const child of el.children) {
        const ret = boxElement(child);
        if (ret) return ret;
    }
    return null;
}

//------------------
// Implementation
//------------------
function isContents(el: Element): boolean {
    return window.getComputedStyle(el).display === 'contents';
}

function rect(left: number, top: number, right: number, bottom: number): DOMRect {
    const width = right - left,
        height = bottom - top;
    return {
        left,
        top,
        right,
        bottom,
        width,
        height,
        x: left,
        y: top,
        toJSON: () => ({left, top, right, bottom, width, height})
    } as DOMRect;
}
