import type {ChatContextProvider} from '../../core';
import {type BlueprintModel, variablesForModel} from '../../blueprint';

/**
 * Sends the Architect, at every step, what it needs to edit a blueprint safely: the version its
 * edits take as base, the user's mode and access, as the model holds them, and each variable's
 * current value. A value from data the catalog closes to the model goes as a marker - see
 * {@link variablesForModel}.
 */
export function blueprintContextProvider(model: BlueprintModel): ChatContextProvider {
    return {
        name: 'blueprint',
        description:
            "The blueprint being edited: its version, which edit_blueprint takes as base, the user's mode and access, and each variable's current value. {withheld: true, type} marks a value from data you may not read: something is set, and you cannot see what.",
        getContext: () => ({
            version: model.version,
            mode: model.mode,
            access: model.access,
            variables: variablesForModel(model)
        })
    };
}
