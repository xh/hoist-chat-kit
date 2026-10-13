/**
 * Size a text area to fit its content, up to `maxRows` lines, beyond which it scrolls.
 * Expects the element to have an explicit CSS `line-height` and `box-sizing: border-box`.
 * @internal
 */
export function fitTextAreaToContent(el: HTMLElement, maxRows: number) {
    if (!el) return;

    const style = window.getComputedStyle(el),
        px = (value: string) => parseFloat(value) || 0,
        borders = px(style.borderTopWidth) + px(style.borderBottomWidth),
        maxHeight =
            px(style.lineHeight) * maxRows +
            px(style.paddingTop) +
            px(style.paddingBottom) +
            borders;

    // Collapse first, so that scrollHeight measures the content rather than the current size.
    el.style.height = 'auto';
    const contentHeight = el.scrollHeight + borders;
    el.style.height = `${Math.min(contentHeight, maxHeight)}px`;
    el.style.overflowY = contentHeight > maxHeight ? 'auto' : 'hidden';
}

/**
 * True if a keyboard event is part of an IME composition - for example, the Enter that confirms
 * a Japanese or Chinese candidate - and so must not trigger a send.
 * @internal
 */
export function isImeComposing(e: KeyboardEvent): boolean {
    return e.isComposing || (e as any).nativeEvent?.isComposing || e.keyCode === 229;
}
