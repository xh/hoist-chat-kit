import {div} from '@xh/hoist/cmp/layout';
import {hoistCmp, type HoistProps} from '@xh/hoist/core';
import {useOnResize, useOnVisibleChange} from '@xh/hoist/utils/react';
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
 * a portal on the page. Each mark is clipped to where its target can show: the area, cut by every
 * scrolling container that holds the target. Marks move as anything scrolls or the area resizes.
 * A target scrolled out of view draws none.
 * @internal
 */
export const overlayHost = hoistCmp.factory<OverlayHostProps>({
    displayName: 'OverlayHost',
    className: 'xh-layout-overlay-host',
    model: false,
    render({model, className, children}) {
        const resizeRef = useOnResize(() => model.layoutChanged()),
            // A resize to nothing, or back to the size it had, is no resize to Hoist, so hiding
            // and showing the host, as a tab does, redraws through this.
            visibleRef = useOnVisibleChange(() => model.layoutChanged()),
            setRef = useCallback(
                (el: HTMLDivElement) => {
                    resizeRef(el);
                    visibleRef(el);
                    model.setHostEl(el);
                },
                [model, resizeRef, visibleRef]
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
        const host = model.hostShown ? model.hostEl.getBoundingClientRect() : null;
        if (!host) return null;
        return div({
            className,
            style: {left: host.left, top: host.top, width: host.width, height: host.height},
            children: model.marks.map(mark => {
                const box = model.boxOf(mark.target);
                if (!box) return null;
                const clip = mark.clip !== false ? box.clip : null,
                    at = clip ?? {x: 0, y: 0},
                    ret = div({
                        key: mark.key,
                        className: 'xh-layout-overlay__mark',
                        style: {
                            left: box.x - at.x,
                            top: box.y - at.y,
                            width: box.width,
                            height: box.height,
                            zIndex: clip ? null : mark.layer,
                            pointerEvents: mark.interactive ? 'auto' : 'none'
                        },
                        ...({'data-overlay-mark': mark.key} as object),
                        children: mark.render(box)
                    });
                if (!clip) return ret;
                return div({
                    key: mark.key,
                    className: 'xh-layout-overlay__clip',
                    style: {
                        left: clip.x,
                        top: clip.y,
                        width: clip.width,
                        height: clip.height,
                        zIndex: mark.layer
                    },
                    children: ret
                });
            })
        });
    }
});

// Scroll events do not bubble, so a capturing listener on the window hears a scroll anywhere.
// Browsers send at most one scroll per frame per scroller, so each one measures.
function useFollowWindow(model: OverlayModel) {
    useEffect(() => {
        const follow = () => model.layoutChanged();
        window.addEventListener('scroll', follow, true);
        window.addEventListener('resize', follow);
        // A layout may animate into place, such as a grid's cells after a move.
        window.addEventListener('transitionend', follow, true);
        return () => {
            window.removeEventListener('scroll', follow, true);
            window.removeEventListener('resize', follow);
            window.removeEventListener('transitionend', follow, true);
        };
    }, [model]);
}
