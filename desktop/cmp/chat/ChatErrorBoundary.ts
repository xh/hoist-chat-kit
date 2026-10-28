import {type ReactNode, useEffect, useRef} from 'react';
import {errorBoundary, ErrorBoundaryModel} from '@xh/hoist/cmp/error';
import {details, div, pre, span, summary} from '@xh/hoist/cmp/layout';
import {creates, hoistCmp, type HoistProps} from '@xh/hoist/core';
import {Icon} from '@xh/hoist/icon';
import '../../../styles/vars.scss';
import './ChatErrorBoundary.scss';

/** Props for {@link ChatErrorBoundary}. */
export interface ChatErrorBoundaryProps extends HoistProps<ErrorBoundaryModel> {
    /** What could not be displayed, named in the fallback. Default 'part'. */
    subject?: 'message' | 'part';

    /**
     * A value that changes when the content may render again, such as a part's state. A change
     * clears a caught error and renders the content once more.
     */
    resetKey?: any;
}

/**
 * Catches an error thrown while rendering one message or part, so that the rest of the
 * conversation still renders. Hoist's exception handler logs the error, with no alert, and a
 * compact note takes the content's place, with the error message in a disclosure. The kit wraps
 * each message and part in one. An app can wrap a kit component it hosts outside the message
 * list the same way. A `className` applies to the note.
 */
export const [ChatErrorBoundary, chatErrorBoundary] = hoistCmp.withFactory<ChatErrorBoundaryProps>({
    displayName: 'ChatErrorBoundary',
    className: 'xh-chat-error-boundary',
    model: creates(ErrorBoundaryModel, {publishMode: 'none'}),

    render({model, className, subject = 'part', resetKey, children}) {
        // Not on mount - an error caught as the content first mounts must stay shown.
        const resetKeyRef = useRef(resetKey);
        useEffect(() => {
            if (resetKeyRef.current === resetKey) return;
            resetKeyRef.current = resetKey;
            model.clear();
        }, [model, resetKey]);

        return model.error
            ? fallback(model.error, subject, className)
            : errorBoundary({model, item: children});
    }
});

//------------------
// Implementation
//------------------
function fallback(error: unknown, subject: string, className: string): ReactNode {
    return div({
        className,
        role: 'note',
        items: [
            div({
                className: 'xh-chat-error-boundary__title',
                items: [Icon.warningCircle(), span(`This ${subject} could not be displayed.`)]
            }),
            details({
                className: 'xh-chat-error-boundary__details',
                items: [summary('Details'), pre((error as Error)?.message || String(error))]
            })
        ]
    });
}
