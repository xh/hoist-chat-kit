import type React from 'react';
import {useRef} from 'react';

/**
 * Event props for a scroll container that pans as it is dragged: by the right or middle button
 * anywhere, and by the left over its background, as `isBackground` says. A press that moves less
 * than a few pixels stays a click. The container takes `--panning` on its class while it pans.
 */
export function usePan(
    className: string,
    isBackground: (target: Element, container: Element) => boolean
): object {
    const drag = useRef<Drag>(null),
        swallow = useRef<'click' | 'contextmenu'>(null),
        panning = `${className}--panning`,
        end = (e: React.PointerEvent<HTMLElement>) => {
            const d = drag.current;
            if (!d || e.pointerId !== d.id) return;
            drag.current = null;
            e.currentTarget.classList.remove(panning);
            e.currentTarget.releasePointerCapture?.(e.pointerId);
            if (d.moved) swallow.current = d.button === 2 ? 'contextmenu' : 'click';
        },
        // The next event of its kind after a pan, which would act as if the pointer had not moved.
        swallowIf = (type: 'click' | 'contextmenu', e: React.MouseEvent) => {
            if (swallow.current !== type) return;
            swallow.current = null;
            e.preventDefault();
            e.stopPropagation();
        };
    return {
        onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
            const {button, currentTarget: el} = e;
            if (button > 2 || (button === 0 && !isBackground(e.target as Element, el))) return;
            // The middle button would start the browser's autoscroll.
            if (button === 1) e.preventDefault();
            swallow.current = null;
            drag.current = {
                id: e.pointerId,
                button,
                x: e.clientX,
                y: e.clientY,
                left: el.scrollLeft,
                top: el.scrollTop,
                moved: false
            };
            el.setPointerCapture?.(e.pointerId);
        },
        onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
            const d = drag.current;
            if (!d || e.pointerId !== d.id) return;
            const el = e.currentTarget,
                dx = e.clientX - d.x,
                dy = e.clientY - d.y;
            if (!d.moved) {
                if (Math.hypot(dx, dy) < THRESHOLD) return;
                d.moved = true;
                el.classList.add(panning);
                // A left press may have started selecting text, which the class now stops.
                window.getSelection()?.removeAllRanges();
            }
            el.scrollLeft = d.left - dx;
            el.scrollTop = d.top - dy;
        },
        onPointerUp: end,
        onPointerCancel: end,
        onClickCapture: (e: React.MouseEvent) => swallowIf('click', e),
        onContextMenu: (e: React.MouseEvent) => {
            // Linux and macOS send the menu as the right button goes down, before any move: hold
            // it, so a drag can follow.
            if (drag.current?.button === 2) {
                e.preventDefault();
                return;
            }
            swallowIf('contextmenu', e);
        }
    };
}

//------------------
// Implementation
//------------------
const THRESHOLD = 4;

interface Drag {
    id: number;
    button: number;
    x: number;
    y: number;
    left: number;
    top: number;
    moved: boolean;
}
