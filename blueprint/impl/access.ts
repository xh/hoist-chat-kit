import {isArray} from 'lodash';
import type {BlueprintIssue} from '../Blueprint';
import type {BlueprintAccess, BlueprintMode} from '../Blueprint';

/**
 * The issue for the first op of an edit the user may not make, or null if they may make them
 * all. Only a user in design mode, which needs write access, may change the definition. Run mode
 * accepts only personalizable paths, which come later, so it refuses every op for now.
 */
export function checkEditAllowed(
    ops: unknown,
    mode: BlueprintMode,
    access: BlueprintAccess
): BlueprintIssue {
    if (mode === 'design' && access === 'write') return null;
    const [op] = isArray(ops) ? ops : [],
        path = op?.path ?? (op?.id ? `/elements/${op.id}` : ''),
        message =
            access !== 'write'
                ? `You have read access only, so '${path}' cannot change. Offer the user a copy of the blueprint to edit.`
                : `'${path}' cannot change in run mode. Offer to switch to design mode.`;
    return {code: 'edit.notAllowed', severity: 'error', path, message, op: 0};
}
