import {div} from '@xh/hoist/cmp/layout';
import {hoistCmp, type HoistProps} from '@xh/hoist/core';
import {useOnResize} from '@xh/hoist/utils/react';
import {Fragment, type ReactNode, createElement, useCallback, useEffect, useRef} from 'react';
import './OverlayLayer.scss';
import type {OverlayModel} from './OverlayModel';

export interface OverlayHostProps extends HoistProps {
    model: OverlayModel;
    /** The area the layer covers, such as a scrolling view. */
    children?: ReactNode;
}

/**
 * An area with an overlay layer above it. The layer draws the model's marks over their targets,
 * clipped to the area, and moves them as anything inside the area scrolls or the area resizes.
 * @internal
 */
export const overlayHost = hoistCmp.factory<OverlayHostProps>({
    displayName: 'OverlayHost',
    className: 'xh-layout-overlay-host',
    model: false,
    render({model, className, children}) {
        const ref = useRef<HTMLDivElement>(null),
            resizeRef = useOnResize(() => model.layoutChanged()),
            setRef = useCallback(
                (el: HTMLDivElement) => {
                    ref.current = el;
                    resizeRef(el);
                    model.setHostEl(el);
                },
                [model, resizeRef]
            );
        useScrollFollow(ref, model);
        return div({
            ref: setRef,
            className,
            children: [
                createElement(Fragment, {key: 'area'}, children),
                overlayLayer({key: 'overlay', model})
            ]
        });
    }
});

const overlayLayer = hoistCmp.factory<HoistProps & {model: OverlayModel}>({
    displayName: 'OverlayLayer',
    className: 'xh-layout-overlay',
    model: false,
    render({model, className}) {
        // Read to measure again on each layout change.
        model.layoutVersion;
        return div({
            className,
            children: model.marks.map(mark => {
                const box = model.boxOf(mark.target);
                if (!box) return null;
                return div({
                    key: mark.key,
                    className: 'xh-layout-overlay__mark',
                    style: {
                        left: box.x,
                        top: box.y,
                        width: box.width,
                        height: box.height,
                        zIndex: mark.layer,
                        pointerEvents: mark.interactive ? 'auto' : 'none'
                    },
                    ...({'data-overlay-mark': mark.key} as object),
                    children: mark.render(box)
                });
            })
        });
    }
});

// Scroll events do not bubble, so a capturing listener hears any scroll inside the area.
function useScrollFollow(ref: {current: HTMLElement}, model: OverlayModel) {
    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        let frame: number = null;
        const onScroll = () => {
            if (frame != null) return;
            frame = window.requestAnimationFrame(() => {
                frame = null;
                model.layoutChanged();
            });
        };
        el.addEventListener('scroll', onScroll, true);
        return () => {
            el.removeEventListener('scroll', onScroll, true);
            if (frame != null) window.cancelAnimationFrame(frame);
        };
    }, [ref, model]);
}
