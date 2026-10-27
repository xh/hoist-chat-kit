import {type ReactNode, useEffect, useRef} from 'react';
import {errorBoundary, ErrorBoundaryModel} from '@xh/hoist/cmp/error';
import {creates, hoistCmp, type HoistProps} from '@xh/hoist/core';

interface ChatUiElementBoundaryProps extends HoistProps<ErrorBoundaryModel> {
    /** Renders the fallback for an error thrown by the content. */
    renderError: (error: unknown) => ReactNode;

    /**
     * A value that changes when the content may render again, such as whether its props are
     * partial. A change clears a caught error and renders the content once more.
     */
    resetKey: unknown;
}

/**
 * Catches an error thrown while rendering one element, so that the rest of the answer still
 * renders. Hoist's exception handler logs the error, with no alert, and the fallback takes the
 * element's place. The content is not remounted on a reset, so a model it owns survives.
 * @internal
 */
export const chatUiElementBoundary = hoistCmp.factory<ChatUiElementBoundaryProps>({
    displayName: 'ChatUiElementBoundary',
    model: creates(ErrorBoundaryModel, {publishMode: 'none'}),

    render({model, renderError, resetKey, children}) {
        // Not on mount - an error caught as the content first mounts must stay shown.
        const resetKeyRef = useRef(resetKey);
        useEffect(() => {
            if (resetKeyRef.current === resetKey) return;
            resetKeyRef.current = resetKey;
            model.clear();
        }, [model, resetKey]);

        return model.error ? renderError(model.error) : errorBoundary({model, item: children});
    }
});
