import {useEffect, useLayoutEffect, useState} from 'react';
import './ChatMotion.scss';

/**
 * True if motion is reduced for an element: inside an `.xh-chat--reduced-motion` element, or
 * under `prefers-reduced-motion: reduce` unless inside an `.xh-chat--motion` element. The script
 * twin of the CSS rules in `ChatMotion.scss`, for motion that runs in script.
 * @internal
 */
export function isChatMotionReduced(el: Element): boolean {
    if (el?.closest('.xh-chat--reduced-motion')) return true;
    if (el?.closest('.xh-chat--motion')) return false;
    return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Eases a wrapper's height to follow the text area inside it, which keeps resizing at once. The
 * wrapper clips the text area and holds it to its bottom, so the line being typed never moves.
 * Returns a callback ref for the wrapper, which follows it as it mounts and remounts.
 *
 * The transition itself is in CSS, on `.xh-chat-composer__field--animated`. The class goes on a
 * frame after the wrapper takes the text area's fitted height, so that no height the text area
 * held before it was fitted ever animates. While the text area is hidden, as in a hidden tab, the
 * wrapper drops its height, rather than ease up from nothing when it shows again.
 * @internal
 */
export function useSmoothFieldHeight<T extends HTMLElement>(): (el: T) => void {
    const [wrapper, setWrapper] = useState<T>(null);

    useLayoutEffect(() => {
        const textarea = wrapper?.querySelector('textarea');
        if (!textarea || typeof ResizeObserver === 'undefined') return;

        const animatedClass = 'xh-chat-composer__field--animated',
            sync = () => {
                const height = textarea.offsetHeight;
                wrapper.style.height = height ? `${height}px` : '';
            },
            observer = new ResizeObserver(sync);
        sync();
        observer.observe(textarea);
        const frame = window.requestAnimationFrame(() => {
            sync();
            // Flush the height before the transition is on, or the change would animate.
            wrapper.getBoundingClientRect();
            wrapper.classList.add(animatedClass);
        });
        return () => {
            window.cancelAnimationFrame(frame);
            observer.disconnect();
            wrapper.classList.remove(animatedClass);
        };
    }, [wrapper]);

    return setWrapper;
}

const BREATHE: Keyframe[] = [
    {opacity: 1, transform: 'scale(1)', easing: 'ease-in-out'},
    {opacity: 0.5, transform: 'scale(0.9)', easing: 'ease-in-out'},
    {opacity: 1, transform: 'scale(1)'}
];

/** One breath, and the wait before the first, so that a quick reply never blinks. */
const BREATHE_MS = 2400,
    BREATHE_DELAY_MS = 150,
    REST_MS = 200,
    REST_EASING = 'cubic-bezier(0.2, 0, 0, 1)';

/**
 * Breathes an element while `isActive` - opacity and scale, in a slow loop - and eases it back to
 * rest from wherever the loop was when `isActive` ends, so that it never snaps. Still under reduced
 * motion. Returns a callback ref, so that an element that mounts while `isActive` breathes too.
 * Runs on the Web Animations API, which the stop needs to read the loop's live values.
 * @internal
 */
export function useBreathing<T extends HTMLElement>(isActive: boolean): (el: T) => void {
    const [el, setEl] = useState<T>(null);

    useEffect(() => {
        if (!isActive || !el?.animate || isChatMotionReduced(el)) return;

        const loop = el.animate(BREATHE, {
            duration: BREATHE_MS,
            delay: BREATHE_DELAY_MS,
            iterations: Infinity
        });
        return () => {
            const {opacity, transform} = window.getComputedStyle(el);
            loop.cancel();
            // An element that stays eases to rest. One that went has nothing to ease.
            if (!el.isConnected) return;
            el.animate(
                [
                    {opacity, transform},
                    {opacity: '1', transform: 'none'}
                ],
                {
                    duration: REST_MS,
                    easing: REST_EASING
                }
            );
        };
    }, [el, isActive]);

    return setEl;
}
