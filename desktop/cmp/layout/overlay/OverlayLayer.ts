import {div} from '@xh/hoist/cmp/layout';
import {hoistCmp, type HoistProps} from '@xh/hoist/core';
import {useOnResize} from '@xh/hoist/utils/react';
import {Fragment, type ReactNode, createElement, useCallback, useEffect} from 'react';
import {createPortal} from 'react-dom';
import './OverlayLayer.scss';
import type {OverlayModel} from './OverlayModel';

export interface OverlayHostProps extends HoistProps {
    model: OverlayModel;
    /** The area the layer covers, such as a scrolling view. */
    children?: ReactNode;
}

/**
 * An area with an overlay layer above it. The layer draws the model's marks over their targets, in
 * a portal on the page, so a mark can sit outside the area, such as a toolbar above its top element.
 * Marks move as anything scrolls or the area resizes. A target out of the area's view draws none.
 * @internal
 */
export const overlayHost = hoistCmp.factory<OverlayHostProps>({
    displayName: 'OverlayHost',
    className: 'xh-layout-overlay-host',
    model: false,
    render({model, className, children}) {
        const resizeRef = useOnResize(() => model.layoutChanged()),
            setRef = useCallback(
                (el: HTMLDivElement) => {
                    resizeRef(el);
                    model.setHostEl(el);
                },
                [model, resizeRef]
            );
        useFollowWindow(model);
        return div({
            ref: setRef,
            className,
            children: [
                createElement(Fragment, {key: 'area'}, children),
                createPortal(overlayLayer({model}), document.body, 'overlay')
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
        const host = model.hostEl?.getBoundingClientRect();
        if (!host) return null;
        return div({
            className,
            style: {left: host.left, top: host.top, width: host.width, height: host.height},
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

// Scroll events do not bubble, so a capturing listener on the window hears a scroll anywhere.
function useFollowWindow(model: OverlayModel) {
    useEffect(() => {
        let frame: number = null;
        const follow = () => {
            if (frame != null) return;
            frame = window.requestAnimationFrame(() => {
                frame = null;
                model.layoutChanged();
            });
        };
        window.addEventListener('scroll', follow, true);
        window.addEventListener('resize', follow);
        return () => {
            window.removeEventListener('scroll', follow, true);
            window.removeEventListener('resize', follow);
            if (frame != null) window.cancelAnimationFrame(frame);
        };
    }, [model]);
}
