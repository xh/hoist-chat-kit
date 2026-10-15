import {debounce} from 'lodash';
import {type RefCallback, useCallback} from 'react';
import type {ChatWorkspaceModel} from '../ChatWorkspaceModel';

/**
 * A callback ref that keeps a workspace model's `width` in step with the workspace's element. It
 * measures the element as it mounts, before the browser paints, so that the first frame has the
 * right layout. A `ResizeObserver` then reports each change at once, and the last of a burst
 * again once it settles for 100 ms - so a resize never waits on a timer, which the browser
 * throttles in a hidden tab. A new model gets its own observer. It also reads the rail's width
 * from `--xh-chat-sidebar-rail-width`.
 *
 * @internal
 */
export function useWorkspaceWidth(model: ChatWorkspaceModel): RefCallback<HTMLElement> {
    return useCallback(
        (node: HTMLElement) => {
            if (!node) return undefined;

            // A hidden element measures 0 wide. It keeps its last width until it shows again.
            const report = (width: number) => {
                if (width > 0) model.setWidth(width);
            };
            report(node.getBoundingClientRect().width);
            // The layout reserves the rail's width, which an app may theme.
            model.setRailWidth(readPx(node, '--xh-chat-sidebar-rail-width'));

            const onResize = debounce(
                    (entries: ResizeObserverEntry[]) =>
                        report(entries[entries.length - 1].contentRect.width),
                    RESIZE_DEBOUNCE_MS,
                    {leading: true, trailing: true}
                ),
                observer = new ResizeObserver(onResize);
            observer.observe(node);

            return () => {
                observer.disconnect();
                onResize.cancel();
            };
        },
        [model]
    );
}

const RESIZE_DEBOUNCE_MS = 100;

// A CSS variable's value in pixels, or null if it is not a pixel length.
function readPx(node: HTMLElement, name: string): number {
    const value = window.getComputedStyle(node).getPropertyValue(name).trim(),
        match = /^(\d+(?:\.\d+)?)px$/.exec(value);
    return match ? Number(match[1]) : null;
}
