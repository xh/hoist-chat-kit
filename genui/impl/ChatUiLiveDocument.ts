import {hoistCmp, type HoistProps} from '@xh/hoist/core';
import {useOnUnmount} from '@xh/hoist/utils/react';
import {type ReactNode, useState} from 'react';
import type {ChatUiDocumentContext} from '../ChatUiComponentSpec';
import type {ChatUiDocument} from '../ChatUiDocument';
import type {ChatUiState} from '../ChatUiState';

interface ChatUiLiveDocumentProps extends HoistProps {
    /** A document with a state spec. */
    doc: ChatUiDocument;

    context: ChatUiDocumentContext;

    /** Renders the document that the state spec resolved, with the state in its context. */
    renderDocument: (doc: ChatUiDocument, context: ChatUiDocumentContext) => ReactNode;

    /** Renders in place of a document whose state could not be created or resolved. */
    renderError: (error: unknown) => ReactNode;
}

/**
 * Renders a document that has state. Creates the state on its first render, keeps it while new
 * parses of the document arrive, and destroys it on unmount. An observer, so the document renders
 * again when an observable that its `resolve()` reads changes.
 * @internal
 */
export const chatUiLiveDocument = hoistCmp.factory<ChatUiLiveDocumentProps>({
    displayName: 'ChatUiLiveDocument',
    model: false,

    render({doc, context, renderDocument, renderError}) {
        const [{state, error}] = useState(() => createState(doc, context));
        useOnUnmount(() => state?.destroy?.());
        if (error) return renderError(error);

        let resolved: ChatUiDocument;
        try {
            resolved = doc.state.resolve(state, context);
        } catch (e) {
            return renderError(e);
        }
        return renderDocument(resolved, {...context, state});
    }
});

//------------------
// Implementation
//------------------
function createState(
    doc: ChatUiDocument,
    context: ChatUiDocumentContext
): {state: ChatUiState; error: unknown} {
    try {
        return {state: doc.state.create(context), error: null};
    } catch (error) {
        return {state: null, error};
    }
}
