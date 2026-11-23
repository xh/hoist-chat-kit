import type {ChatContextProvider} from '../../core';
import {type BlueprintDesignModel, UI_CONTEXT_DESCRIPTION} from '../../blueprint';

/**
 * Sends the Architect, at every step, what the designer has in front of them, so "this", "the
 * selected widget" and "here" have a meaning: the mode, the selection with its widget and cell,
 * and the active tabs and presets. Give the prompt `withUiContext` with it.
 */
export function uiContextProvider(designModel: BlueprintDesignModel): ChatContextProvider {
    return {
        name: 'ui_context',
        description: UI_CONTEXT_DESCRIPTION,
        getContext: () => designModel.uiContext
    };
}
