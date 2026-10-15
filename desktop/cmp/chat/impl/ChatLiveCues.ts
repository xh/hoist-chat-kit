import type {ReactNode} from 'react';
import {span} from '@xh/hoist/cmp/layout';
import {spinner} from '@xh/hoist/cmp/spinner';
import {hoistCmp, type HoistProps} from '@xh/hoist/core';
import {Icon} from '@xh/hoist/icon';
import {ChatKit} from '../../../../core';
import {classNames} from '../../../../impl/ClassNames';
import '../../../../styles/vars.scss';
import './ChatMotion.scss';

/**
 * The chat's inline spinner: Hoist's `Spinner`, sized to 1em of its line. Under reduced motion,
 * a static icon takes its place, unless `ChatKit.defaults.reducedMotionSpinner` is 'spin'. Both
 * render, and CSS shows one, so the swap follows the media query and the
 * `xh-chat--reduced-motion` class with no script. Use it for busy states inside chat components.
 */
export const chatSpinner = hoistCmp.factory<HoistProps>({
    displayName: 'ChatSpinner',
    model: false,
    observer: false,
    className: 'xh-chat-spinner',

    render({className}) {
        const spin = spinner({compact: true, className: 'xh-chat-spinner__spin'});
        if (ChatKit.defaults.reducedMotionSpinner === 'spin') {
            return span({className, 'aria-hidden': true, item: spin});
        }
        return span({
            className: classNames(className, 'xh-chat-spinner--static-twin'),
            'aria-hidden': true,
            items: [spin, staticBusyIcon()]
        });
    }
});

/**
 * The caret at the end of streaming text. Render it with a key that changes as text arrives - such
 * as the text's length - so that each arrival restarts its blink. It rests, dimmed, once no text
 * has come for two blinks.
 * @internal
 */
export function chatCaret(key: string | number): ReactNode {
    return span({key, className: 'xh-chat-caret', 'aria-hidden': true});
}

//------------------
// Implementation
//------------------
// The design calls for an hourglass, which Hoist's icon library does not register. The stopwatch
// is the closest busy glyph it has. Swap in `Icon.hourglass()` once Hoist adds it.
function staticBusyIcon() {
    return Icon.stopwatch({className: 'xh-chat-spinner__static'});
}
