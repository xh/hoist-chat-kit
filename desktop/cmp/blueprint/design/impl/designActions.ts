import {XH} from '@xh/hoist/core';
import type {
    BlueprintDesignModel,
    BlueprintIssue,
    BlueprintRemoval
} from '../../../../../blueprint';
import {listOf} from './ConfigEditors';

/**
 * Remove an element with everything inside it, in one edit, then select the next sibling, else the
 * previous, else the parent. A lone element goes at once, with a toast to undo it. A removal that
 * takes more with it asks first, naming what goes.
 *
 * @returns the issues that refused the removal, if any.
 */
export async function removeElementAsync(
    designModel: BlueprintDesignModel,
    id: string
): Promise<BlueprintIssue[]> {
    const removal = designModel.describeRemoval(id),
        {elements, removedVariables, unboundVariables, presetPaths} = removal,
        cascades =
            elements.length > 1 ||
            [removedVariables, unboundVariables, presetPaths].some(it => it.length);
    if (cascades) {
        const ok = await XH.confirm({
            title: 'Remove',
            message: removalMessage(id, removal),
            confirmProps: {text: 'Remove', intent: 'danger'}
        });
        if (!ok) return [];
    }
    const next =
            designModel.siblingOf(id, 1) ??
            designModel.siblingOf(id, -1) ??
            designModel.pathTo(id).at(-1) ??
            null,
        errors = designModel.removeElement(id).issues.filter(it => it.severity === 'error');
    if (errors.length) return errors;
    designModel.select(next ? {kind: 'element', id: next} : null);
    if (!cascades) {
        const {blueprintModel} = designModel,
            {version} = blueprintModel;
        XH.toast({
            message: `Removed ${id}.`,
            actionButtonProps: {
                text: 'Undo',
                onClick: () => {
                    if (blueprintModel.version === version) {
                        blueprintModel.undo();
                    } else {
                        XH.warningToast(
                            `Other changes came after. Undo ${id}'s removal from History.`
                        );
                    }
                }
            },
            timeout: 8000
        });
    }
    return [];
}

/** Copy an element and its subtree, as one edit, and select the copy, or show why it cannot. */
export function duplicateElement(designModel: BlueprintDesignModel, id: string) {
    const error = designModel.duplicateElement(id).issues.find(it => it.severity === 'error');
    if (error) designModel.blueprintModel.showRefusal(error);
}

/** What removing an element takes with it, for the user to confirm. */
export function removalMessage(id: string, removal: BlueprintRemoval): string {
    const inside = removal.elements.length - 1,
        sentences = [
            inside
                ? `Remove ${id}, and the ${inside} element${inside > 1 ? 's' : ''} in it?`
                : `Remove ${id}?`
        ];
    const {removedVariables: gone, unboundVariables: unbound, presetPaths} = removal;
    if (gone.length)
        sentences.push(
            `Variable${gone.length > 1 ? 's' : ''} ${listOf(gone)} ${gone.length > 1 ? 'go' : 'goes'} too.`
        );
    if (unbound.length) {
        sentences.push(
            `${listOf(unbound)} ${unbound.length > 1 ? 'lose a writer' : 'loses a writer'}, and keep${unbound.length > 1 ? '' : 's'} its other writers or its default.`
        );
    }
    if (presetPaths.length) {
        sentences.push(
            `Presets stop setting ${presetPaths.length} path${presetPaths.length > 1 ? 's' : ''} in it.`
        );
    }
    return sentences.join(' ');
}
