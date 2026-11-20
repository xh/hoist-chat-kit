import {isArray} from 'lodash';
import type {BlueprintIssue} from '../Blueprint';
import type {BlueprintAccess, BlueprintMode} from '../Blueprint';

/**
 * The issue for the first op of an edit the user may not make, or null if they may make them
 * all. Only a user in design mode, which needs write access, may change the definition. Run mode
 * accepts only personalizable paths, which come later, so it refuses every op for now. With
 * `forArchitect`, the message says what the Architect does next, else what a person does.
 */
export function checkEditAllowed(
    ops: unknown,
    mode: BlueprintMode,
    access: BlueprintAccess,
    forArchitect = false
): BlueprintIssue {
    if (mode === 'design' && access === 'write') return null;
    const [op] = isArray(ops) ? ops : [],
        path = op?.path ?? (op?.id ? `/elements/${op.id}` : ''),
        message =
            access !== 'write'
                ? `You have read access only, so '${path}' cannot change. ${
                      forArchitect
                          ? 'Offer the user a copy of the blueprint to edit.'
                          : 'Make a copy of the blueprint to change it.'
                  }`
                : `'${path}' cannot change in run mode. ${
                      forArchitect
                          ? 'Ask for design mode with request_design_mode.'
                          : 'Switch to design mode to change it.'
                  }`;
    return {code: 'edit.notAllowed', severity: 'error', path, message, op: 0};
}
