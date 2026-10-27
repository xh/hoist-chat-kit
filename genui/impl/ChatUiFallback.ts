import {type ReactNode, useEffect, useRef} from 'react';
import {errorBoundary, ErrorBoundaryModel} from '@xh/hoist/cmp/error';
import {details, div, li, pre, summary, ul} from '@xh/hoist/cmp/layout';
import {creates, hoistCmp, type HoistProps} from '@xh/hoist/core';
import type {ChatUiFallbackSpec, ChatUiPlaceholderSpec} from '../ChatUiComponentSpec';
import '../../styles/vars.scss';
import './ChatUiFallback.scss';

/**
 * The default fallback element: a caption, with what went wrong and the input the model wrote
 * behind a "View input" disclosure. A catalog's own `fallback` can render this for the cases it
 * does not handle itself.
 */
export function chatUiFallback({caption, errors, input}: ChatUiFallbackSpec): ReactNode {
    return div({
        className: 'xh-chat-ui-fallback',
        role: 'note',
        items: [
            div({className: 'xh-chat-ui-fallback__caption', item: caption}),
            details({
                className: 'xh-chat-ui-fallback__details',
                items: [
                    summary('View input'),
                    errors.length ? ul(errors.map((it, idx) => li({key: idx, item: it}))) : null,
                    input != null ? pre(formatInput(input)) : null
                ]
            })
        ]
    });
}

/** The default placeholder, for a component still streaming in - "Building chart…". */
export function chatUiPlaceholder({displayName}: ChatUiPlaceholderSpec): ReactNode {
    return div({
        className: 'xh-chat-ui-placeholder',
        role: 'status',
        item: displayName ? `Building ${displayName.toLowerCase()}…` : 'Building…'
    });
}

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

//------------------
// Implementation
//------------------
function formatInput(input: unknown): string {
    if (typeof input === 'string') return input;
    try {
        return JSON.stringify(input, null, 2);
    } catch (ignored) {
        return String(input);
    }
}
