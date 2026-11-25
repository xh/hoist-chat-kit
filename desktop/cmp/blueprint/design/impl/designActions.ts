import {span} from '@xh/hoist/cmp/layout';
import {type MenuItemLike, type PlainObject, XH} from '@xh/hoist/core';
import {Icon} from '@xh/hoist/icon';
import type {
    AddPlace,
    BlueprintDesignModel,
    BlueprintIssue,
    BlueprintSelection,
    DesignAction
} from '../../../../../blueprint';
import {getOwn} from '../../../../../blueprint/impl/pointer';
import type {ReactElement} from 'react';
import {isString} from 'lodash';
import {partIcon} from './icons';
import {listOf} from './ConfigEditors';
import {removalMessage} from '../../../../../blueprint/design/removalMessage';

export {removalMessage};

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
    const remove = designModel.designActions({kind: 'element', id}).find(it => it.id === 'delete');
    if (!remove) return [];
    const refusal = await runDesignActionAsync(designModel, id, remove, {silent: true});
    return refusal ? [{code: 'edit.refused', severity: 'error', path: '', message: refusal}] : [];
}

/**
 * Run a design action on an element: ask first where it says to, then make its edit. A refusal
 * shows as a toast, unless `silent`, and a removal that asked nothing offers to undo it. Add a
 * widget opens Add for the element.
 *
 * @returns why it was refused, or null.
 */
export async function runDesignActionAsync(
    designModel: BlueprintDesignModel,
    id: string,
    action: DesignAction,
    opts: {silent?: boolean} = {}
): Promise<string> {
    if (action.disabledReason) return action.disabledReason;
    if (action.host === 'addWidget') {
        designModel.select({kind: 'element', id});
        designModel.selectSlot(action.place ?? {parent: id});
        designModel.requestAdd();
        return null;
    }
    if (action.confirm) {
        const ok = await XH.confirm({
            title: action.label,
            message: action.confirm,
            confirmProps: {text: action.label, intent: action.intent ?? 'primary'}
        });
        if (!ok) return null;
    }
    const refusal = action.run?.() ?? null;
    if (refusal && !opts.silent) {
        designModel.blueprintModel.showRefusal({
            code: 'edit.refused',
            severity: 'error',
            path: '',
            message: refusal
        });
    }
    if (!refusal && action.id === 'delete' && !action.confirm) undoToast(designModel, id);
    return refusal;
}

/** A design action's icon, by its Hoist icon name. */
export function actionIcon(name: string, props: {className?: string} = {}): ReactElement {
    const factory = name ? (getOwn(Icon, name) as (p: object) => ReactElement) : null;
    return typeof factory === 'function' ? factory(props) : null;
}

/**
 * What a design menu acts on: its name in a verb, such as `grid 'Positions'`, and its header, such
 * as `Positions · Grid`. A view is its container's place, such as `pane 'Positions'`. A name is the
 * element's title where it has one, else its id.
 */
export interface MenuTarget {
    noun: string;
    header: string;
    icon: ReactElement;
    /** The element to outline while the header is hovered. */
    element?: string;
}

export function menuTarget(designModel: BlueprintDesignModel, sel: BlueprintSelection): MenuTarget {
    const {blueprint, registry} = designModel.blueprintModel,
        elements = blueprint?.elements ?? {},
        elementName = (id: string) => {
            const title = getOwn(elements, id)?.config?.title;
            return isString(title) && title ? title : id;
        },
        typeOf = (id: string) =>
            registry.widgets[getOwn(elements, id)?.component]?.label ??
            getOwn(elements, id)?.component;
    if (sel.kind === 'element' || sel.kind === 'view') {
        const name = elementName(sel.id),
            type = typeOf(sel.id);
        if (sel.kind === 'view') {
            const place = getOwn(elements, sel.of)?.component === 'panes' ? 'Pane' : 'Cell';
            return {
                noun: `${place.toLowerCase()} '${name}'`,
                header: `${place} · holds ${name} (${type})`,
                icon: Icon.window(),
                element: sel.id
            };
        }
        return {
            noun: `${type.toLowerCase()} '${name}'`,
            header: `${name} · ${type}`,
            icon: partIcon('element', registry.widgets[getOwn(elements, sel.id)?.component]),
            element: sel.id
        };
    }
    const type = {source: 'Source', variable: 'Variable', preset: 'Preset group'}[sel.kind];
    return {
        noun: `${type.toLowerCase()} '${sel.id}'`,
        header: `${sel.id} · ${type}`,
        icon: partIcon(sel.kind as 'source' | 'variable' | 'preset', null)
    };
}

// A design action's label naming its target, so each verb reads alone, as `Delete grid 'X'`.
function namedLabel(action: DesignAction, noun: string): string {
    switch (action.id) {
        case 'addWidget':
            return `Add a widget to ${noun}…`;
        case 'addAfter':
            return `Add a widget after ${noun}`;
        case 'wrap':
            return `Wrap ${noun} in`;
        case 'changeType':
            return `Change ${noun} to`;
        case 'header':
            return `${action.label.split(' ')[0]} ${noun} header`;
        case 'duplicate':
        case 'unwrap':
        case 'delete':
            return `${action.label} ${noun}`;
        default:
            return action.label;
    }
}

// The menu's first row: what it acts on, which outlines it on the canvas while hovered.
function targetHeader(designModel: BlueprintDesignModel, target: MenuTarget): MenuItemLike {
    return {
        text: span({
            className: 'xh-blueprint-menu-target__text',
            children: [
                target.header,
                span({
                    key: 'hit',
                    className: 'xh-blueprint-menu-target__hit',
                    onMouseEnter: () => target.element && designModel.setHovered(target.element),
                    onMouseLeave: () => target.element && designModel.setHovered(null)
                })
            ]
        }),
        icon: target.icon,
        className: 'xh-blueprint-menu-target',
        keepMenuOpen: true
    };
}

/**
 * Design actions as menu items, a disabled one naming why in its tooltip. With a target, each
 * names it, as `Delete grid 'Positions'`.
 */
export function actionMenuItems(
    designModel: BlueprintDesignModel,
    id: string,
    actions: DesignAction[],
    target?: MenuTarget
): MenuItemLike[] {
    return actions.map(action => ({
        text: span({
            title: action.disabledReason,
            children: [
                target ? namedLabel(action, target.noun) : action.label,
                action.shortcut
                    ? span({className: 'xh-blueprint-menu-shortcut', children: action.shortcut})
                    : null
            ]
        }),
        icon: actionIcon(action.icon),
        intent: action.intent,
        disabled: !!action.disabledReason,
        ...(action.items
            ? {items: actionMenuItems(designModel, id, action.items)}
            : {actionFn: () => runDesignActionAsync(designModel, id, action)})
    }));
}

/**
 * The design menu for an element or a view: each action naming its target, a disabled one naming
 * why, then a way to select what holds it, so a right-click on a nested element can climb. With
 * `header`, it opens with a row naming the target, as a right-click on the canvas shows it.
 */
export function designMenu(
    designModel: BlueprintDesignModel,
    sel: BlueprintSelection,
    omit?: string,
    opts: {header?: boolean} = {}
): MenuItemLike[] {
    if (sel?.kind !== 'element' && sel?.kind !== 'view') return [];
    const view = sel.kind === 'element' ? designModel.viewOf(sel.id) : null,
        parent = sel.kind === 'view' ? sel.of : designModel.pathTo(sel.id).at(-1),
        target = menuTarget(designModel, sel),
        actions = actionMenuItems(
            designModel,
            sel.id,
            designModel.designActions(sel).filter(it => it.id !== omit),
            target
        );
    if (!actions.length && !view && !parent) return [];
    return [
        ...(opts.header ? [targetHeader(designModel, target), '-'] : []),
        ...actions,
        ...(view || parent
            ? [
                  ...(actions.length ? ['-'] : []),
                  {
                      text: `Select ${
                          view
                              ? menuTarget(designModel, {kind: 'view', ...view}).noun
                              : menuTarget(designModel, {kind: 'element', id: parent}).noun
                      }`,
                      icon: Icon.arrowUp(),
                      actionFn: () =>
                          designModel.select(
                              view ? {kind: 'view', ...view} : {kind: 'element', id: parent}
                          )
                  }
              ]
            : [])
    ] as MenuItemLike[];
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
 * The menu items for a part of the blueprint: rename, then for an element its design menu, else
 * delete. Empty for a user who may not edit.
 */
export function selectionMenu(
    designModel: BlueprintDesignModel,
    sel: BlueprintSelection,
    omit?: string,
    opts: {header?: boolean} = {}
): (PlainObject | string)[] {
    const {kind, id} = sel,
        of = sel.kind === 'view' ? sel.of : null;
    const {blueprintModel} = designModel;
    if (blueprintModel.mode !== 'design' || blueprintModel.access !== 'write') return [];
    const target = menuTarget(designModel, sel),
        rename = {
            text: `Rename ${target.noun}…`,
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
        remove = {text: `Delete ${target.noun}`, icon: Icon.delete(), intent: 'danger'};
    if (kind === 'view') return designMenu(designModel, {kind, id, of}, omit, opts);
    if (kind !== 'element') {
        return [
            ...(opts.header ? [targetHeader(designModel, target), '-'] : []),
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
    const menu = designMenu(designModel, {kind, id}, omit);
    return [...(opts.header ? [targetHeader(designModel, target), '-'] : []), rename, '-', ...menu];
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
