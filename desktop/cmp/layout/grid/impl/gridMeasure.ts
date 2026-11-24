import {
    bottom,
    cloneLayout,
    correctBounds,
    type GridLayoutProps
} from '@xh/hoist/kit/react-grid-layout';
import {useCallback, useState} from 'react';

/**
 * Track a canvas's content width: measured on attach, before first paint and even in a hidden
 * browser tab, where ResizeObserver callbacks are deferred, then on every resize. A zero width,
 * as while hidden, is skipped.
 */
export function useContentWidth(): [number, (node: HTMLElement) => () => void] {
    const [width, setWidth] = useState<number>(null),
        ref = useCallback((node: HTMLElement) => {
            if (!node) return;
            const measure = () => {
                const {paddingLeft, paddingRight} = window.getComputedStyle(node),
                    newWidth =
                        node.clientWidth - parseFloat(paddingLeft) - parseFloat(paddingRight);
                if (newWidth > 0) setWidth(newWidth);
            };
            measure();
            const observer = new ResizeObserver(measure);
            observer.observe(node);
            return () => observer.disconnect();
        }, []);
    return [width, ref];
}

/**
 * The height react-grid-layout renders for the props given. It mirrors RGL's own calculation,
 * with the bounds correction and compaction it applies to the layout on first render.
 */
export function expectedGridHeight({layout, compactor, gridConfig}: GridLayoutProps): number {
    const {cols, rowHeight, margin, containerPadding} = gridConfig,
        // Clone first, as `correctBounds()` mutates the layout it is given.
        rows = bottom(compactor.compact(correctBounds(cloneLayout(layout), {cols}), cols)),
        // An explicit null `containerPadding` skips the default, so RGL uses the margin.
        padY = (containerPadding ?? margin)[1];
    return Math.max(0, rows * rowHeight + (rows - 1) * margin[1] + 2 * padY);
}
