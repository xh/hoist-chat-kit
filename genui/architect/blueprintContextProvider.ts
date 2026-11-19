import type {ChatContextProvider} from '../../core';
import type {BlueprintModel} from '../../blueprint';

/**
 * Sends the Architect, at every step, what it needs to edit a blueprint safely: the version its
 * edits take as base, the user's mode and access, as the model holds them, and each variable's
 * current value.
 */
export function blueprintContextProvider(model: BlueprintModel): ChatContextProvider {
    return {
        name: 'blueprint',
        description:
            "The blueprint being edited: its version, which edit_blueprint takes as base, the user's mode and access, and each variable's current value.",
        getContext: () => ({
            version: model.version,
            mode: model.mode,
            access: model.access,
            variables: Object.fromEntries(model.variables.map(it => [it.name, it.value ?? null]))
        })
    };
}
