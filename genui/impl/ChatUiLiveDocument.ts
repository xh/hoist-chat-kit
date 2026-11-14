import {hoistCmp, type HoistProps} from '@xh/hoist/core';
import {type ReactNode, useEffect, useRef, useState} from 'react';
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
 *
 * React can run the unmount effect and then mount the same component again, as under StrictMode
 * and Fast Refresh. The state is then destroyed while the component still holds it. So the
 * effect clears what it destroys, and a mount that finds no state renders again to create one.
 * @internal
 */
export const chatUiLiveDocument = hoistCmp.factory<ChatUiLiveDocumentProps>({
    displayName: 'ChatUiLiveDocument',
    model: false,

    render({doc, context, renderDocument, renderError}) {
        const held = useRef<HeldState>(null),
            [, setMounts] = useState(0);
        held.current ??= createState(doc, context);
        useEffect(() => {
            if (!held.current) setMounts(it => it + 1);
            return () => {
                held.current?.state?.destroy?.();
                held.current = null;
            };
        }, []);

        const {state, error} = held.current;
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
interface HeldState {
    state: ChatUiState;
    error: unknown;
}

function createState(doc: ChatUiDocument, context: ChatUiDocumentContext): HeldState {
    try {
        return {state: doc.state.create(context), error: null};
    } catch (error) {
        return {state: null, error};
    }
}
