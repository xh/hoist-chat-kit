import {type PlainObject, XH} from '@xh/hoist/core';
import {Icon} from '@xh/hoist/icon';
import type {
    AddPlace,
    BlueprintDesignModel,
    BlueprintIssue,
    BlueprintRemoval,
    BlueprintSelection
} from '../../../../../blueprint';
import {slotLabel} from '../../../../../blueprint/impl/elements';
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
    if (!cascades) undoToast(designModel, id);
    return [];
}

/**
 * Remove a preset group, as one edit. A group with selectors, which go with it, asks first. One
 * without goes at once, with a toast to undo it.
 *
 * @returns the issues that refused the removal, if any.
 */
export async function removePresetGroupAsync(
    designModel: BlueprintDesignModel,
    group: string
): Promise<BlueprintIssue[]> {
    const selectors = designModel.presetSelectors(group);
    if (selectors.length) {
        const ok = await XH.confirm({
            title: 'Remove',
            message: `Remove ${group}, and its selector${selectors.length > 1 ? 's' : ''} ${listOf(selectors)}?`,
            confirmProps: {text: 'Remove', intent: 'danger'}
        });
        if (!ok) return [];
    }
    const errors = designModel
        .removePresetGroup(group)
        .issues.filter(it => it.severity === 'error');
    if (errors.length) return errors;
    if (!selectors.length) undoToast(designModel, group);
    return [];
}

/**
 * Remove a source, as one edit. A source other sources join asks first, naming them, as their
 * joins on it go too. One no source joins goes at once, with a toast to undo it.
 *
 * @returns the issues that refused the removal, if any.
 */
export async function removeSourceAsync(
    designModel: BlueprintDesignModel,
    name: string
): Promise<BlueprintIssue[]> {
    const joiners = Object.entries(designModel.blueprintModel.blueprint?.sources ?? {})
        .filter(([, it]) => (it.joins ?? []).some(j => j.source === name))
        .map(([it]) => it);
    if (joiners.length) {
        const ok = await XH.confirm({
            title: 'Remove',
            message: `Remove ${name}? ${listOf(joiners)} ${joiners.length > 1 ? 'join' : 'joins'} it, and ${joiners.length > 1 ? 'their joins go' : 'that join goes'} too.`,
            confirmProps: {text: 'Remove', intent: 'danger'}
        });
        if (!ok) return [];
    }
    const errors = designModel.removeSource(name).issues.filter(it => it.severity === 'error');
    if (!errors.length && !joiners.length) undoToast(designModel, name);
    return errors;
}

/**
 * Remove a variable at once, as one edit, with a toast to undo it. Refused while anything reads it.
 *
 * @returns the issues that refused the removal, if any.
 */
export function removeVariable(designModel: BlueprintDesignModel, name: string): BlueprintIssue[] {
    const errors = designModel.removeVariable(name).issues.filter(it => it.severity === 'error');
    if (!errors.length) undoToast(designModel, name);
    return errors;
}

// A toast that undoes a removal, while no other edit has come after it.
function undoToast(designModel: BlueprintDesignModel, id: string) {
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
                    XH.warningToast(`Other changes came after. Undo ${id}'s removal from History.`);
                }
            }
        },
        timeout: 8000
    });
}

/**
 * Remove what is selected, or the part given, as its kind does: an element as {@link removeElementAsync}, a
 * preset group as {@link removePresetGroupAsync}, and a source or a variable at once, refused
 * while anything reads it.
 *
 * @returns the issues that refused the removal, if any.
 */
export async function removeSelectionAsync(
    designModel: BlueprintDesignModel,
    selection: BlueprintSelection = designModel.selection
): Promise<BlueprintIssue[]> {
    switch (selection?.kind) {
        case 'element':
        case 'view':
            return removeElementAsync(designModel, selection.id);
        case 'preset':
            return removePresetGroupAsync(designModel, selection.id);
        case 'source':
            return removeSourceAsync(designModel, selection.id);
        case 'variable':
            return removeVariable(designModel, selection.id);
        default:
            return [];
    }
}

/** Copy an element and its subtree, as one edit, and select the copy, or show why it cannot. */
export function duplicateElement(designModel: BlueprintDesignModel, id: string) {
    const error = designModel.duplicateElement(id).issues.find(it => it.severity === 'error');
    if (error) designModel.blueprintModel.showRefusal(error);
}

/** Show the first error of a refused edit, if any, as a toast. */
export function refuse(designModel: BlueprintDesignModel, issues: BlueprintIssue[]) {
    const error = issues.find(it => it.severity === 'error');
    if (error) designModel.blueprintModel.showRefusal(error);
}

/** Add a widget at a place, as one edit, and select it, or show why it cannot. */
export function addWidgetAt(designModel: BlueprintDesignModel, widget: string, place: AddPlace) {
    const {parent, slot, of} = place,
        {id, issues} = designModel.addWidget(widget, parent, {
            ...(slot && slot !== 'children' ? {slot} : {}),
            ...(of ? {of} : {})
        });
    refuse(designModel, issues);
    if (id && !issues.some(it => it.severity === 'error')) {
        designModel.select({kind: 'element', id});
    }
}

/**
 * The menu items for a part of the blueprint: rename, then for an element duplicate, move to a
 * slot and add a child, then delete. Empty for a user who may not edit.
 */
export function selectionMenu(
    designModel: BlueprintDesignModel,
    {kind, id}: BlueprintSelection
): (PlainObject | string)[] {
    const {blueprintModel} = designModel;
    if (blueprintModel.mode !== 'design' || blueprintModel.access !== 'write') return [];
    const rename = {
            text: 'Rename…',
            disabled: kind === 'preset' || kind === 'view',
            actionFn: async () => {
                const to = await XH.prompt<string>({
                    title: 'Rename',
                    message: `New id for ${id}`,
                    input: {initialValue: id}
                });
                if (to && to !== id && kind !== 'preset' && kind !== 'view') {
                    refuse(designModel, designModel.renameId(kind, id, to).issues);
                }
            }
        },
        remove = {text: 'Delete', icon: Icon.delete(), intent: 'danger'};
    if (kind !== 'element') {
        return [
            rename,
            '-',
            {
                ...remove,
                actionFn: () =>
                    removeSelectionAsync(designModel, {kind, id}).then(it =>
                        refuse(designModel, it)
                    )
            }
        ];
    }
    const labelOf = (it: string) => blueprintModel.registry.widgets[it]?.label ?? it,
        parent = designModel.pathTo(id).at(-1);
    return [
        rename,
        {text: 'Duplicate', icon: Icon.copy(), actionFn: () => duplicateElement(designModel, id)},
        {
            text: 'Move to',
            disabled: !parent,
            items: designModel.slotsFor(id).map(({slot, of}) => ({
                text: of ? `${of} · ${slotLabel(slot, true)}` : slotLabel(slot),
                actionFn: () => refuse(designModel, designModel.moveToSlot(id, slot, of).issues)
            }))
        },
        {
            text: 'Add child',
            items: designModel.addPlacesFor(id).flatMap(({place, label, widgets}) => [
                {text: label, disabled: true},
                ...widgets.map(it => ({
                    text: labelOf(it),
                    actionFn: () => addWidgetAt(designModel, it, place)
                }))
            ])
        },
        '-',
        {
            ...remove,
            actionFn: () => removeElementAsync(designModel, id).then(it => refuse(designModel, it))
        }
    ];
}

/** Issues counted as a screen reader reads a dot: `2 errors, 1 warning`. */
export function issueSummary(issues: BlueprintIssue[]): string {
    const count = (severity: string, noun: string) => {
        const n = issues.filter(it => it.severity === severity).length;
        return n ? `${n} ${noun}${n === 1 ? '' : 's'}` : null;
    };
    return [count('error', 'error'), count('warning', 'warning'), count('info', 'note')]
        .filter(Boolean)
        .join(', ');
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
