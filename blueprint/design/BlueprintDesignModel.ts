import {HoistModel, type PlainObject} from '@xh/hoist/core';
import {action, observableRef} from '@xh/hoist/mobx';
import {throwIf} from '@xh/hoist/utils/js';
import {
    castArray,
    cloneDeep,
    isEmpty,
    isEqual,
    isPlainObject,
    mapValues,
    pickBy,
    startCase,
    uniq
} from 'lodash';
import type {
    BlueprintElement,
    BlueprintIssue,
    BlueprintOp,
    ChildRef,
    PresetGroup
} from '../Blueprint';
import {applyOps} from '../applyOps';
import type {BlueprintEditResult, BlueprintModel} from '../BlueprintModel';
import type {WidgetSpec} from '../BlueprintRegistry';
import {childIds, locate, parentOf, slotLists} from '../impl/elements';
import type {SlotAccepts} from '../BlueprintRegistry';
import {readsInTemplates} from '../impl/template';
import {decodePointer, getAt, getOwn, setAt} from '../impl/pointer';
import {variableTypeMatches} from '../validateBlueprint';
import {labelOf} from './editorSpec';
import {starterConfig} from './starterConfig';

/** What a designer has selected: an element, a variable, a source or a preset group. */
export interface BlueprintSelection {
    kind: 'element' | 'variable' | 'source' | 'preset';
    id: string;
}

/** What removing an element takes with it, for the user to confirm. */
/** Where a widget goes: a container, its slot, and the element it follows there, if any. */
export interface AddPlace {
    parent: string;
    /** Default `children`. */
    slot?: string;
    /** The child of the parent whose reference holds the slot, such as a canvas cell. */
    of?: string;
    after?: string;
}

export interface BlueprintRemoval {
    /** The element and every element inside it, the element first. */
    elements: string[];
    /** Variables removed, as nothing else writes or reads them. */
    removedVariables: string[];
    /** Variables that lose a writer, and keep their default, or their other writers. */
    unboundVariables: string[];
    /** Paths that preset groups stop controlling, with their values in each preset. */
    presetPaths: string[];
}

/**
 * Design mode for people: what is selected, and the changes a designer makes to a blueprint's
 * elements, each as one edit through `applyEdit`, by the user, with a description. Undo, history,
 * validation, access and presets apply as for any edit. A chat answer has no design mode.
 */
export class BlueprintDesignModel extends HoistModel {
    readonly blueprintModel: BlueprintModel;

    /** The selection, or null. It clears when what it names is gone. */
    @observableRef accessor selection: BlueprintSelection = null;

    constructor(config: {blueprintModel: BlueprintModel}) {
        super();
        const {blueprintModel} = config;
        throwIf(blueprintModel.isAnswer, 'A chat answer has no design mode.');
        this.blueprintModel = blueprintModel;
        this.addReaction({
            track: () => this.blueprintModel.blueprint,
            run: () => {
                if (this.selection && !this.exists(this.selection)) this.select(null);
            }
        });
    }

    @action
    select(selection: BlueprintSelection) {
        this.selection = selection;
    }

    /**
     * Select what an issue names, by its path: an element, a variable, a source or a preset group.
     * An issue that names none of them, or one since gone, leaves the selection as it was.
     */
    revealIssue(issue: BlueprintIssue) {
        const [, root, id] = String(issue?.path ?? '').split('/'),
            kind = REVEALED_KINDS[root],
            selection = kind && id ? {kind, id} : null;
        if (selection && this.exists(selection)) this.select(selection);
    }

    /** The ID of the selected element, or null. */
    get selectedElementId(): string {
        return this.selection?.kind === 'element' ? this.selection.id : null;
    }

    /**
     * Add a widget of the registry, with a config it can start with - see `starterConfig()`. It
     * goes into `parentId`, else the selected container, else right after the selected element in
     * its container, else the root. On a canvas, it takes the first free place at its default size,
     * and in tabs, a tab titled by its label. The first element of an empty blueprint becomes its
     * root.
     *
     * @returns the edit's result, with the new element's ID.
     */
    addWidget(
        component: string,
        parentId?: string,
        opts: {
            /** Values the config starts with, over its starter's. */
            config?: PlainObject;
            /** An element to add the widget right after, in its container. */
            after?: string;
            /** Its child reference in the container, in place of the place it would find. */
            child?: PlainObject;
            /** The container's other children, placed again in the same edit, as a drop leaves them. */
            siblings?: PlainObject[];
            /** The slot of `parentId` to add into. Default `children`. */
            slot?: string;
            /** The child of `parentId` whose reference holds the slot, such as a canvas cell. */
            of?: string;
        } = {}
    ): BlueprintEditResult & {id?: string} {
        const {blueprint} = this.blueprintModel,
            spec = this.widgetSpec(component);
        if (!spec) return refused(`There is no widget '${component}'.`);
        const {catalog} = this.blueprintModel,
            config = starterConfig(spec, {blueprint, catalog}, opts.config);
        if (!config) return refused(`Add a source for the ${spec.label} to read first.`);
        if (typeof config === 'string') return refused(config);
        const id = this.newId(component),
            element: BlueprintElement = {component, config},
            place: AddPlace = parentId
                ? {parent: parentId, slot: opts.slot, of: opts.of}
                : opts.after
                  ? this.placeAfter(opts.after)
                  : this.addTarget;
        if (!place) {
            if (blueprint?.root) return refused('Select a container to add the widget to.');
            return {...this.edit(`Add ${spec.label}`, [{op: 'addElement', id, element}]), id};
        }
        const {parent, slot = 'children', of, after} = place,
            child = opts.child ?? (slot === 'children' ? this.placeChild(parent, spec) : null),
            index = after ? this.indexAfter(place, after) : null;
        return {
            ...this.edit(`Add ${spec.label}`, [
                ...(opts.siblings ? [this.replaceSiblingsOp(parent, opts.siblings)] : []),
                {
                    op: 'addElement',
                    id,
                    element,
                    parent,
                    ...(child ? {child} : {}),
                    ...(index != null ? {index} : {}),
                    ...(slot !== 'children' ? {slot} : {}),
                    ...(of ? {of} : {})
                }
            ]),
            id
        };
    }

    /**
     * The variables an input element can show and set: those of a type its widget takes, that no
     * resolver, widget output or other element sets.
     */
    inputVariableOptions(elementId: string): string[] {
        const {blueprint, registry} = this.blueprintModel,
            types = castArray(this.elementSpec(elementId)?.value?.type ?? []);
        return Object.entries(blueprint?.variables ?? {})
            .filter(([, v]) => {
                const writers = castArray(v.setBy ?? []) as PlainObject[];
                return (
                    v.setBy !== 'resolver' &&
                    writers.every(
                        w => !isPlainObject(w) || (w.element === elementId && !w.output)
                    ) &&
                    types.some(t => variableTypeMatches(registry, v.type, t))
                );
            })
            .map(([name]) => name);
    }

    /**
     * Make an input element show and set a variable, in one edit: an existing one, or a new one of
     * the widget's first value type. The variable it set before keeps its value, set by no one.
     * Null unsets it.
     */
    setInputVariable(elementId: string, name: string): BlueprintEditResult {
        const variables = this.blueprintModel.blueprint?.variables ?? {},
            writer = {element: elementId},
            previous = Object.entries(variables)
                .filter(([vn, v]) => vn !== name && isEqual(v.setBy, writer))
                .map(([vn]): BlueprintOp => ({op: 'remove', path: `/variables/${vn}/setBy`}));
        let set: BlueprintOp[] = [];
        if (name && getOwn(variables, name)) {
            set = [{op: 'set', path: `/variables/${name}/setBy`, value: writer}];
        } else if (name) {
            const type = castArray(this.elementSpec(elementId)?.value?.type ?? [])[0];
            if (!type) return refused(`${elementId} sets no variable.`);
            set = [
                {
                    op: 'set',
                    path: `/variables/${name}`,
                    value: {type, label: startCase(name), setBy: writer}
                }
            ];
        }
        return this.edit(`${elementId}: sets ${name ?? 'no variable'}`, [...previous, ...set]);
    }

    /**
     * Where {@link addWidget} would put a widget now: the container, and the element it would
     * follow there, if any. Null for a new root.
     */
    get addTarget(): AddPlace {
        const {blueprint} = this.blueprintModel,
            selected = this.selectedElementId,
            isContainer = (id: string) => !!this.elementSpec(id)?.children;
        if (selected && isContainer(selected)) return {parent: selected, after: null};
        if (selected && locate(blueprint?.elements, selected)) return this.placeAfter(selected);
        return blueprint?.root && isContainer(blueprint.root)
            ? {parent: blueprint.root, after: null}
            : null;
    }

    /**
     * What removing an element takes with it: the elements inside it, and the variables and preset
     * paths that name them. {@link removeElement} removes them all in one edit.
     */
    describeRemoval(id: string): BlueprintRemoval {
        return this.describeRemovalOf([id]);
    }

    // What removing elements together takes with them, as describeRemoval() describes one.
    private describeRemovalOf(ids: string[]): BlueprintRemoval {
        const blueprint = this.blueprintModel.blueprint ?? {},
            elements = uniq(ids.flatMap(id => this.subtree(id))),
            gone = new Set(elements),
            removedVariables: string[] = [],
            unboundVariables: string[] = [];
        Object.entries(blueprint.variables ?? {}).forEach(([name, decl]) => {
            const writers = castArray(decl.setBy ?? []).filter(isPlainObject) as PlainObject[];
            if (!writers.some(w => gone.has(w.element))) return;
            const kept = writers.filter(w => !gone.has(w.element));
            if (!kept.length && !this.isRead(name, gone)) {
                removedVariables.push(name);
            } else {
                unboundVariables.push(name);
            }
        });
        const isReleased = (path: string) =>
                gone.has(elementOfPath(path)) || removedVariables.includes(variableOfPath(path)),
            presetPaths = Object.values(blueprint.presets ?? {})
                .flatMap(it => it.controls ?? [])
                .map(it => it.path)
                .filter(isReleased),
            // A group left controlling nothing goes, and its selectors with it.
            emptied = Object.entries(blueprint.presets ?? {})
                .filter(([, it]) => (it.controls ?? []).every(c => isReleased(c.path)))
                .map(([name]) => name),
            selectors = this.selectorsOf(emptied).filter(it => !gone.has(it));
        return {
            elements: [...elements, ...selectors],
            removedVariables,
            unboundVariables,
            presetPaths
        };
    }

    /**
     * Remove an element and everything inside it, in one edit, with what names them: a variable
     * loses the removed writers, and goes too if nothing else writes or reads it, and preset
     * groups stop controlling their paths. See {@link describeRemoval}.
     */
    removeElement(id: string): BlueprintEditResult {
        const spec = this.elementSpec(id);
        if (!spec) return refused(`There is no element '${id}'.`);
        return this.edit(`Remove ${spec.label}`, this.removalOps([id]));
    }

    /**
     * The widgets that changing a source's dataset would break, as they name fields the new
     * dataset lacks. {@link changeSourceDataset} can remove them in the same edit.
     */
    describeDatasetChange(name: string, dataset: string): {breaks: string[]} {
        const bound = this.boundParams(dataset);
        if ('refusal' in bound) return {breaks: []};
        const {result} = applyOps(
            this.blueprintModel.blueprint,
            this.datasetOps(name, dataset, bound.params)
        );
        if (!result) return {breaks: []};
        const breaks = this.blueprintModel
            .validate(result)
            .filter(isError)
            .map(it => elementOfPath(it.path))
            .filter(Boolean);
        return {breaks: uniq(breaks)};
    }

    // The operations that remove elements and their subtrees together, with what names them.
    private removalOps(ids: string[]): BlueprintOp[] {
        const blueprint = this.blueprintModel.blueprint ?? {},
            removal = this.describeRemovalOf(ids),
            gone = new Set(removal.elements),
            ops: BlueprintOp[] = [...removal.elements]
                .reverse()
                .map(it => ({op: 'removeElement', id: it}));

        removal.removedVariables.forEach(name =>
            ops.push({op: 'remove', path: `/variables/${name}`})
        );
        removal.unboundVariables.forEach(name => {
            const setBy = blueprint.variables[name].setBy,
                kept = castArray(setBy).filter(w => !gone.has((w as PlainObject)?.element));
            ops.push(
                kept.length
                    ? {
                          op: 'set',
                          path: `/variables/${name}/setBy`,
                          value: kept.length === 1 && !Array.isArray(setBy) ? kept[0] : kept
                      }
                    : {op: 'remove', path: `/variables/${name}/setBy`}
            );
        });
        const released = new Set(removal.presetPaths);
        ops.push(...this.releaseOps(path => released.has(path)));
        return ops;
    }

    /** Move an element to another container, or to another place in its own, as one edit. */
    moveElement(id: string, parentId: string, opts: {child?: PlainObject; index?: number} = {}) {
        const spec = this.elementSpec(id);
        if (!spec) return refused(`There is no element '${id}'.`);
        return this.edit(`Move ${spec.label}`, [
            {op: 'moveElement', id, parent: parentId, ...opts}
        ]);
    }

    /**
     * Move an element by hand, as one edit: into a container, at its end, or before or after
     * another element, in that one's container. It keeps its placement within its own container,
     * and takes a free one in another, as {@link addWidget} would give it.
     */
    moveTo(id: string, targetId: string, where: 'into' | 'before' | 'after'): BlueprintEditResult {
        const {elements} = this.blueprintModel.blueprint ?? {},
            spec = this.elementSpec(id);
        if (!spec || !getOwn(elements, targetId))
            return refused(`There is no element '${targetId}'.`);
        if (this.subtree(id).includes(targetId)) {
            return refused(`${id} cannot move inside itself.`, `/elements/${id}`);
        }
        const target: AddPlace = where === 'into' ? {parent: targetId} : this.placeAfter(targetId);
        if (!target || !this.elementSpec(target.parent)?.children) {
            return refused(
                `${where === 'into' ? targetId : 'Its container'} holds no elements.`,
                `/elements/${id}`
            );
        }
        const {parent, slot = 'children', of} = target,
            list = slotLists(elements[parent]).find(it => it.slot === slot && it.of === of),
            siblings = (list?.refs ?? []).filter(it => it.id !== id),
            at = siblings.findIndex(it => it.id === targetId),
            index = where === 'into' ? null : where === 'before' ? at : at + 1,
            from = locate(elements, id),
            sameSlot = from?.parent === parent && from.slot === slot && from.of === of,
            child = sameSlot || slot !== 'children' ? null : this.placeChild(parent, spec);
        return this.edit(`Move ${spec.label}`, [
            {
                op: 'moveElement',
                id,
                parent,
                ...(child ? {child} : {}),
                ...(index != null ? {index} : {}),
                ...(slot !== 'children' ? {slot} : {}),
                ...(of ? {of} : {})
            }
        ]);
    }

    /**
     * The slots of an element's container that take it: `children`, the container's other slots,
     * and its child references' slots, such as each canvas cell's header.
     */
    slotsFor(id: string): {slot: string; of?: string}[] {
        const {elements} = this.blueprintModel.blueprint ?? {},
            parent = parentOf(elements, id),
            spec = this.elementSpec(id),
            parentSpec = parent ? this.elementSpec(parent) : null;
        if (!spec || !parentSpec?.children) return [];
        const takes = (rule: SlotAccepts) =>
                !rule ||
                (!rule.categories && !rule.widgets) ||
                !!rule.categories?.includes(spec.category) ||
                !!rule.widgets?.includes(spec.name),
            ret: {slot: string; of?: string}[] = [];
        if (takes(parentSpec.children.accepts)) ret.push({slot: 'children'});
        Object.entries(parentSpec.slots ?? {}).forEach(([slot, it]) => {
            if (takes(it.accepts)) ret.push({slot});
        });
        Object.entries(parentSpec.children.slots ?? {}).forEach(([slot, it]) => {
            if (!takes(it.accepts)) return;
            (elements[parent].children ?? [])
                .filter(ref => ref.id !== id)
                .forEach(ref => ret.push({slot, of: ref.id}));
        });
        return ret;
    }

    /** Move an element to another slot of its container, at its end, as one edit. */
    moveToSlot(id: string, slot: string, of?: string): BlueprintEditResult {
        const {elements} = this.blueprintModel.blueprint ?? {},
            parent = parentOf(elements, id),
            spec = this.elementSpec(id);
        if (!parent || !spec) return refused(`'${id}' is not in a container.`);
        const child = slot === 'children' ? this.placeChild(parent, spec) : null;
        return this.edit(`Move ${spec.label} to ${of ? `${of} ` : ''}${slot}`, [
            {
                op: 'moveElement',
                id,
                parent,
                ...(child ? {child} : {}),
                ...(slot !== 'children' ? {slot} : {}),
                ...(of ? {of} : {})
            }
        ]);
    }

    /** Set the title an element has in its container, such as a tab's, as one edit. */
    setChildTitle(id: string, title: string): BlueprintEditResult {
        return this.setChildPlacement(id, {title}, `Retitle ${this.elementSpec(id)?.label ?? id}`);
    }

    /**
     * Change where an element sits in its container, such as its size on a canvas or its flex in
     * a box, as one edit. A key given as `undefined` is removed.
     */
    setChildPlacement(
        id: string,
        changes: PlainObject,
        description = `${id}: placement`
    ): BlueprintEditResult {
        const parent = parentOf(this.blueprintModel.blueprint?.elements, id);
        if (!parent) return refused(`'${id}' is not in a container.`);
        const children = this.blueprintModel.blueprint.elements[parent].children,
            index = children.findIndex(it => it.id === id),
            {id: _id, ...placement} = children[index],
            child = pickBy({...placement, ...changes}, it => it !== undefined);
        return this.edit(description, [{op: 'moveElement', id, parent, child, index}]);
    }

    /** Add a variable the user sets, a string by default, with a name of its own, and select it. */
    addVariable(type: string = 'string'): BlueprintEditResult & {id?: string} {
        const id = freeKey(this.blueprintModel.blueprint?.variables, 'variable'),
            ret = this.edit(`Add variable ${id}`, [
                {op: 'set', path: `/variables/${id}`, value: {type, setBy: 'prompt'}}
            ]);
        if (!ret.issues.some(isError)) this.select({kind: 'variable', id});
        return {...ret, id};
    }

    /** Set one key of a variable's declaration, or remove it with `undefined`, as one edit. */
    setVariableDecl(name: string, key: string, value: unknown): BlueprintEditResult {
        return this.updateVariableDecl(name, {[key]: value});
    }

    /**
     * Set keys of a variable's declaration together, removing each given as `undefined`, as one
     * edit, such as `setBy` with the `compute` it needs.
     */
    updateVariableDecl(name: string, changes: PlainObject): BlueprintEditResult {
        return this.updateEntry('variables', 'Variable', name, changes);
    }

    /** Remove a variable, as one edit. Refused while anything reads it, naming what does. */
    removeVariable(name: string): BlueprintEditResult {
        const readers = this.readersOf(name);
        if (readers.length) {
            const list =
                readers.length > 1
                    ? `${readers.slice(0, -1).join(', ')} and ${readers.at(-1)}`
                    : readers[0];
            return refused(
                `${list} ${readers.length > 1 ? 'use' : 'uses'} ${name}. Change ${readers.length > 1 ? 'them' : 'it'} first.`
            );
        }
        return this.removeEntry('variables', 'variable', name, [
            ...this.releaseOps(path => variableOfPath(path) === name)
        ]);
    }

    /**
     * Add a source over a dataset, named for it, with each required parameter bound to the first
     * variable of its type, and select it. Refused if a required parameter has no such variable.
     */
    addSource(
        dataset: string,
        opts: {
            /** True to add a prompt for each required parameter no variable can take. */
            addVariables?: boolean;
        } = {}
    ): BlueprintEditResult & {id?: string} {
        const bound = this.boundParams(dataset, opts.addVariables);
        if ('refusal' in bound) return bound.refusal;
        const id = freeKey(this.blueprintModel.blueprint?.sources, dataset),
            value = {dataset, ...bound.params},
            ret = this.edit(`Add source ${id}`, [
                ...bound.variableOps,
                {op: 'set', path: `/sources/${id}`, value}
            ]);
        if (!ret.issues.some(isError)) this.select({kind: 'source', id});
        return {...ret, id};
    }

    /**
     * Point a source at another dataset, in one edit, with its required parameters bound again as
     * {@link addSource} binds them. Its filter and fields, which name the old dataset's fields, go.
     */
    changeSourceDataset(
        name: string,
        dataset: string,
        opts: {
            /** True to remove, in the same edit, the widgets the change would break. */
            removeBreaking?: boolean;
        } = {}
    ): BlueprintEditResult {
        const bound = this.boundParams(dataset);
        if ('refusal' in bound) return bound.refusal;
        if (!getOwn(this.blueprintModel.blueprint?.sources, name)) {
            return refused(`There is no source '${name}'.`);
        }
        const sources = this.blueprintModel.blueprint.sources,
            breaks = opts.removeBreaking ? this.describeDatasetChange(name, dataset).breaks : [],
            removals = breaks.length ? this.removalOps(breaks) : [],
            // A name addSource gave for the old dataset follows the new one.
            renamed = isGeneratedName(name, sources[name].dataset)
                ? freeKey(sources, dataset)
                : null,
            ret = this.edit(`Source ${name}: dataset`, [
                ...removals,
                ...this.datasetOps(name, dataset, bound.params),
                ...(renamed
                    ? [{op: 'renameId', kind: 'source', from: name, to: renamed} as BlueprintOp]
                    : [])
            ]);
        if (renamed && !ret.issues.some(isError)) this.select({kind: 'source', id: renamed});
        return ret;
    }

    /** Set one key of a source's declaration, or remove it with `undefined`, as one edit. */
    setSourceDecl(name: string, key: string, value: unknown): BlueprintEditResult {
        return this.updateSourceDecl(name, {[key]: value});
    }

    /** Set keys of a source's declaration together, removing each given as `undefined`. */
    updateSourceDecl(name: string, changes: PlainObject): BlueprintEditResult {
        return this.updateEntry('sources', 'Source', name, changes);
    }

    /** Remove a source, and the joins that name it, as one edit. Refused while a widget reads it. */
    removeSource(name: string): BlueprintEditResult {
        const unjoins = Object.entries(this.blueprintModel.blueprint?.sources ?? {})
            .filter(([, it]) => (it.joins ?? []).some(j => j.source === name))
            .map(([sn, it]): BlueprintOp => {
                const kept = it.joins.filter(j => j.source !== name);
                return kept.length
                    ? {op: 'set', path: `/sources/${sn}/joins`, value: kept}
                    : {op: 'remove', path: `/sources/${sn}/joins`};
            });
        return this.removeEntry('sources', 'source', name, unjoins);
    }

    /**
     * Make a group of presets that controls a preset path of an element's config, with one preset
     * of its current value, which leaves the config. Then select the group.
     */
    addPresetGroup(path: string): BlueprintEditResult & {id?: string} {
        const {blueprint} = this.blueprintModel,
            value = getAt(blueprint, path);
        if (value === undefined)
            return refused('Set a value first: the first preset starts from it.');
        if (this.blueprintModel.getPresetControl(path)) {
            return refused('A preset group already controls it.');
        }
        const id = freeKey(blueprint?.presets, 'group'),
            key = decodePointer(path).at(-1),
            group: PresetGroup = {
                label: labelOf(key),
                controls: [{path}],
                default: 'preset1',
                items: {preset1: {label: 'Preset 1', set: withAt({}, path, value)}}
            },
            ret = this.edit(`Add presets for ${key}`, [
                {op: 'remove', path},
                {op: 'set', path: `/presets/${id}`, value: group}
            ]);
        if (!ret.issues.some(isError)) this.select({kind: 'preset', id});
        return {...ret, id};
    }

    /** Set or remove one key of a preset group, such as its label or default, as one edit. */
    setPresetGroupDecl(group: string, key: string, value: unknown): BlueprintEditResult {
        return this.updateEntry('presets', 'Presets', group, {[key]: value});
    }

    /** Add a path a group controls: every preset takes its current value, which leaves the config. */
    addPresetControl(group: string, path: string): BlueprintEditResult {
        const g = getOwn(this.blueprintModel.blueprint?.presets, group);
        if (!g) return refused(`There is no preset group '${group}'.`);
        if (this.blueprintModel.getPresetControl(path)) {
            return refused('A preset group already controls it.');
        }
        const value = getAt(this.blueprintModel.blueprint, path);
        if (value === undefined) return refused('Set a value first: each preset starts from it.');
        return this.edit(`Presets ${group}: control ${decodePointer(path).at(-1)}`, [
            {op: 'remove', path},
            {op: 'set', path: `/presets/${group}/controls`, value: [...g.controls, {path}]},
            {
                op: 'set',
                path: `/presets/${group}/items`,
                value: mapValues(g.items, it => ({...it, set: withAt(it.set, path, value)}))
            }
        ]);
    }

    /**
     * Stop a group controlling a path, which returns to the config at the active preset's value.
     * A group's last path takes the group with it.
     */
    removePresetControl(group: string, path: string): BlueprintEditResult {
        const g = getOwn(this.blueprintModel.blueprint?.presets, group);
        if (!g?.controls.some(it => it.path === path)) {
            return refused(`Preset group '${group}' does not control ${path}.`);
        }
        if (g.controls.length === 1) return this.removePresetGroup(group);
        const active = g.items[this.blueprintModel.getActivePreset(group)],
            value = getAt(active?.set, path);
        return this.edit(`Presets ${group}: release ${decodePointer(path).at(-1)}`, [
            {
                op: 'set',
                path: `/presets/${group}/controls`,
                value: g.controls.filter(it => it.path !== path)
            },
            {
                op: 'set',
                path: `/presets/${group}/items`,
                value: mapValues(g.items, it => ({...it, set: withoutAt(it.set, path)}))
            },
            ...(value !== undefined ? [{op: 'set', path, value} as BlueprintOp] : [])
        ]);
    }

    /** Remove a group, its paths returning to the config at the active preset's values. */
    removePresetGroup(group: string): BlueprintEditResult {
        const g = getOwn(this.blueprintModel.blueprint?.presets, group);
        if (!g) return refused(`There is no preset group '${group}'.`);
        const active = g.items?.[this.blueprintModel.getActivePreset(group)];
        return this.edit(`Remove presets ${group}`, [
            ...this.selectorsOf([group]).map((id): BlueprintOp => ({op: 'removeElement', id})),
            ...g.controls
                .map(({path}) => ({path, value: getAt(active?.set, path)}))
                .filter(it => it.value !== undefined)
                .map(({path, value}): BlueprintOp => ({op: 'set', path, value})),
            {op: 'remove', path: `/presets/${group}`}
        ]);
    }

    /** Add a copy of a preset, as one edit. */
    duplicatePreset(group: string, item: string): BlueprintEditResult & {id?: string} {
        const g = getOwn(this.blueprintModel.blueprint?.presets, group),
            source = getOwn(g?.items, item);
        if (!source) return refused(`There is no preset '${item}' in '${group}'.`);
        const id = freeKey(g.items, 'preset');
        return {
            ...this.edit(`Presets ${group}: copy ${item}`, [
                {
                    op: 'set',
                    path: `/presets/${group}/items/${id}`,
                    value: {...source, label: `${source.label ?? item} copy`}
                }
            ]),
            id
        };
    }

    /** Set the name users see for a preset, or remove it with `undefined`, as one edit. */
    setPresetLabel(group: string, item: string, label: string): BlueprintEditResult {
        if (!getOwn(getOwn(this.blueprintModel.blueprint?.presets, group)?.items, item)) {
            return refused(`There is no preset '${item}' in '${group}'.`);
        }
        const path = `/presets/${group}/items/${item}/label`;
        return this.edit(`Presets ${group}: label ${item}`, [
            label ? {op: 'set', path, value: label} : {op: 'remove', path}
        ]);
    }

    /** Remove a preset, as one edit. A group keeps at least one, and a default. */
    removePreset(group: string, item: string): BlueprintEditResult {
        const g = getOwn(this.blueprintModel.blueprint?.presets, group);
        if (!getOwn(g?.items, item)) return refused(`There is no preset '${item}' in '${group}'.`);
        const others = Object.keys(g.items).filter(it => it !== item);
        if (!others.length) return refused('A group keeps one preset. Remove the group instead.');
        return this.edit(`Presets ${group}: remove ${item}`, [
            {op: 'remove', path: `/presets/${group}/items/${item}`},
            ...(g.default === item
                ? [{op: 'set', path: `/presets/${group}/default`, value: others[0]} as BlueprintOp]
                : [])
        ]);
    }

    /** Rename an element, variable or source, and every reference to it, as one edit. */
    renameId(kind: 'element' | 'variable' | 'source', from: string, to: string) {
        const wasSelected = this.selection?.kind === kind && this.selection.id === from,
            ret = this.edit(`Rename ${kind} ${from} to ${to}`, [{op: 'renameId', kind, from, to}]);
        if (wasSelected && !ret.issues.some(isError)) this.select({kind, id: to});
        return ret;
    }

    /**
     * Set a path of an element's config, or remove it with `undefined`. A path that presets
     * control changes the active preset, as a widget's own change does in design mode.
     */
    setConfig(id: string, path: string, value: unknown): BlueprintEditResult {
        const spec = this.elementSpec(id);
        if (!spec) return refused(`There is no element '${id}'.`);
        const target = this.blueprintModel.writePathFor(`/elements/${id}/config${path}`),
            op: BlueprintOp =
                value === undefined
                    ? {op: 'remove', path: target}
                    : {op: 'set', path: target, value};
        return this.edit(`${spec.label}: ${path.slice(1)}`, [op]);
    }

    //------------------
    // Implementation
    //------------------
    // The operations that point a source at a dataset, dropping what names the old one's fields.
    private datasetOps(
        name: string,
        dataset: string,
        params: {params?: PlainObject}
    ): BlueprintOp[] {
        const decl = getOwn(this.blueprintModel.blueprint?.sources, name) ?? {},
            path = (key: string) => `/sources/${name}/${key}`;
        return [
            {op: 'set', path: path('dataset'), value: dataset},
            params.params ? {op: 'set', path: path('params'), value: params.params} : null,
            ...['filter', 'fields', ...(params.params ? [] : ['params'])]
                .filter(key => Object.hasOwn(decl, key))
                .map(key => ({op: 'remove', path: path(key)}))
        ].filter(Boolean) as BlueprintOp[];
    }

    // The operations that stop preset groups controlling the paths given, dropping their values,
    // and a group left with none.
    // The presetSelector elements that show any of these groups.
    private selectorsOf(groups: string[]): string[] {
        return Object.entries(this.blueprintModel.blueprint?.elements ?? {})
            .filter(
                ([, el]) => el.component === 'presetSelector' && groups.includes(el.config?.group)
            )
            .map(([id]) => id);
    }

    private releaseOps(isReleased: (path: string) => boolean): BlueprintOp[] {
        const ops: BlueprintOp[] = [];
        Object.entries(this.blueprintModel.blueprint?.presets ?? {}).forEach(([group, def]) => {
            const controls = def.controls ?? [],
                kept = controls.filter(it => !isReleased(it.path));
            if (kept.length === controls.length) return;
            if (!kept.length) {
                ops.push({op: 'remove', path: `/presets/${group}`});
                return;
            }
            ops.push({op: 'set', path: `/presets/${group}/controls`, value: kept});
            Object.entries(def.items ?? {}).forEach(([item, it]) => {
                controls
                    .filter(c => !kept.includes(c) && getAt(it.set, c.path) !== undefined)
                    .forEach(c =>
                        ops.push({
                            op: 'remove',
                            path: `/presets/${group}/items/${item}/set${c.path}`
                        })
                    );
            });
        });
        return ops;
    }

    // Each required parameter of a dataset bound to the first variable of its type.
    private boundParams(
        dataset: string,
        addVariables = false
    ):
        | {params: {params?: PlainObject}; variableOps: BlueprintOp[]}
        | {refusal: BlueprintEditResult} {
        const {blueprint, catalogs, registry} = this.blueprintModel,
            ds = catalogs.map(it => it.getDataset(dataset)).find(Boolean);
        if (!ds) return {refusal: refused(`There is no dataset '${dataset}'.`)};
        const variables = {...blueprint?.variables},
            params: PlainObject = {},
            variableOps: BlueprintOp[] = [];
        for (const [pn, pd] of Object.entries(ds.params ?? {})) {
            if (!pd.required) continue;
            let bound = Object.keys(variables).find(it =>
                variableTypeMatches(registry, variables[it].type, pd.type)
            );
            if (!bound && addVariables) {
                bound = Object.hasOwn(variables, pn) ? freeKey(variables, pn) : pn;
                variables[bound] = {
                    type: pd.type,
                    label: startCase(pn),
                    setBy: 'prompt',
                    // A date that moves keeps the blueprint fresh, as the Architect's guidance has it.
                    ...(pd.type === 'localDate' && registry.resolvers.today
                        ? {default: {resolver: 'today'}}
                        : {})
                };
                variableOps.push({op: 'set', path: `/variables/${bound}`, value: variables[bound]});
            }
            if (!bound) return {refusal: refused(`Add a ${pd.type} variable for ${pn} first.`)};
            params[pn] = {$var: bound};
        }
        return {params: Object.keys(params).length ? {params} : {}, variableOps};
    }

    /** True if a widget cannot start until the blueprint has a source it can read. */
    needsSource(component: string): boolean {
        const spec = this.widgetSpec(component),
            {blueprint, catalog} = this.blueprintModel;
        return !!spec && starterConfig(spec, {blueprint, catalog}) === null;
    }

    private updateEntry(
        coll: 'variables' | 'sources' | 'presets',
        noun: string,
        name: string,
        changes: PlainObject
    ): BlueprintEditResult {
        const decl = getOwn<PlainObject>(this.blueprintModel.blueprint?.[coll], name);
        if (!decl) return refused(`There is no ${noun.toLowerCase()} '${name}'.`);
        const ops: BlueprintOp[] = Object.entries(changes)
            .filter(([key, value]) => value !== undefined || Object.hasOwn(decl, key))
            .map(([key, value]) => {
                // A key presets control, such as a variable's default, changes the active preset.
                const path = this.blueprintModel.writePathFor(`/${coll}/${name}/${key}`);
                return value === undefined ? {op: 'remove', path} : {op: 'set', path, value};
            });
        return this.edit(`${noun} ${name}: ${Object.keys(changes).join(', ')}`, ops);
    }

    private removeEntry(
        coll: 'variables' | 'sources',
        noun: string,
        name: string,
        alsoOps: BlueprintOp[] = []
    ): BlueprintEditResult {
        if (!getOwn<PlainObject>(this.blueprintModel.blueprint?.[coll], name)) {
            return refused(`There is no ${noun} '${name}'.`);
        }
        return this.edit(`Remove ${noun} ${name}`, [
            ...alsoOps,
            {op: 'remove', path: `/${coll}/${name}`}
        ]);
    }

    private edit(description: string, ops: BlueprintOp[]): BlueprintEditResult {
        const {blueprintModel} = this;
        return blueprintModel.applyEdit({
            base: blueprintModel.version,
            author: 'user',
            description,
            ops
        });
    }

    private exists({kind, id}: BlueprintSelection): boolean {
        const bp = this.blueprintModel.blueprint,
            coll = {
                element: 'elements',
                variable: 'variables',
                source: 'sources',
                preset: 'presets'
            }[kind];
        return !!getOwn(bp?.[coll], id);
    }

    private widgetSpec(component: string): WidgetSpec {
        return getOwn(this.blueprintModel.registry.widgets, component);
    }

    private elementSpec(id: string): WidgetSpec {
        const el = getOwn(this.blueprintModel.blueprint?.elements, id);
        return el ? this.widgetSpec(el.component) : null;
    }

    // The place right after an element, in the slot list that holds it.
    private placeAfter(id: string): AddPlace {
        const at = locate(this.blueprintModel.blueprint?.elements, id);
        if (!at) return null;
        return {
            parent: at.parent,
            ...(at.slot !== 'children' ? {slot: at.slot} : {}),
            ...(at.of ? {of: at.of} : {}),
            after: id
        };
    }

    // An op that places a container's children again, keeping each reference's other keys.
    private replaceSiblingsOp(parentId: string, siblings: PlainObject[]): BlueprintOp {
        const children = getOwn(this.blueprintModel.blueprint?.elements, parentId)?.children ?? [];
        return {
            op: 'set',
            path: `/elements/${parentId}/children`,
            value: children.map(ref => ({...ref, ...siblings.find(it => it.id === ref.id)}))
        };
    }

    // The index right after an element in a place's slot list, or null.
    private indexAfter({parent, slot = 'children', of}: AddPlace, id: string): number {
        const el = getOwn(this.blueprintModel.blueprint?.elements, parent),
            list = slotLists(el).find(it => it.slot === slot && it.of === of),
            idx = list?.refs.findIndex(it => it.id === id) ?? -1;
        return idx >= 0 ? idx + 1 : null;
    }

    /**
     * Add a presetSelector for a group, right after the element its first path controls, or as
     * {@link addWidget} places one when that is a variable's default.
     */
    addPresetSelector(group: string): BlueprintEditResult & {id?: string} {
        const g = getOwn(this.blueprintModel.blueprint?.presets, group);
        if (!g) return refused(`There is no preset group '${group}'.`);
        const {elements} = this.blueprintModel.blueprint,
            controlled = g.controls?.map(it => elementOfPath(it.path)).find(Boolean),
            at = controlled ? locate(elements, controlled) : null,
            parentWidget = at ? elements[at.parent]?.component : null,
            config = {group};
        if (at?.slot === 'children' && parentWidget === 'dashCanvas') {
            return this.addWidget('presetSelector', at.parent, {
                config,
                slot: 'headerItems',
                of: controlled
            });
        }
        if (at?.slot === 'children' && parentWidget === 'panel') {
            return this.addWidget('presetSelector', at.parent, {config, slot: 'headerItems'});
        }
        return this.addWidget('presetSelector', null, {config, ...(at ? {after: controlled} : {})});
    }

    // A child reference for a container: a free place on a canvas, or a title in tabs.
    private placeChild(parentId: string, spec: WidgetSpec): PlainObject {
        const parent = getOwn(this.blueprintModel.blueprint?.elements, parentId),
            required: string[] = this.elementSpec(parentId)?.children?.schema?.required ?? [];
        if (required.includes('title')) return {title: spec.label};
        if (!required.includes('x')) return null;
        const columns = parent.config?.columns ?? 12,
            {w = 4, h = 2} = spec.size?.default ?? {},
            width = Math.min(w, columns);
        return {...firstFreePlace(parent.children ?? [], columns, width, h), w: width, h};
    }

    private newId(component: string): string {
        const elements = this.blueprintModel.blueprint?.elements ?? {};
        let n = 1;
        while (Object.hasOwn(elements, `${component}${n}`)) n++;
        return `${component}${n}`;
    }

    // An element and every element inside it, depth first.
    private subtree(id: string): string[] {
        const el = getOwn(this.blueprintModel.blueprint?.elements, id);
        if (!el) return [];
        return [id, ...childIds(el).flatMap(it => this.subtree(it))];
    }

    // True if anything outside the removed elements reads the variable.
    // The elements, sources, other variables and preset groups that bind a variable.
    private readersOf(name: string): string[] {
        const bp = this.blueprintModel.blueprint ?? {},
            binding = `{"$var":${JSON.stringify(name)}}`,
            binds = (o: unknown) =>
                JSON.stringify(o ?? null).includes(binding) ||
                readsInTemplates(o, 'variable', name);
        const entries: [string, unknown][] = [
            ...Object.entries(bp.elements ?? {}),
            ...Object.entries(bp.sources ?? {}),
            ...Object.entries(bp.variables ?? {}).filter(([n]) => n !== name),
            ...Object.entries(bp.presets ?? {}).map(([group, it]): [string, unknown] => [
                `presets ${group}`,
                it.items
            ])
        ];
        return entries.filter(([, it]) => binds(it)).map(([id]) => id);
    }

    private isRead(name: string, gone: Set<string>): boolean {
        const bp = this.blueprintModel.blueprint ?? {},
            others = {
                ...bp,
                variables: Object.fromEntries(
                    Object.entries(bp.variables ?? {}).filter(([n]) => n !== name)
                ),
                elements: Object.fromEntries(
                    Object.entries(bp.elements ?? {}).filter(([id]) => !gone.has(id))
                )
            };
        return (
            JSON.stringify(others).includes(`{"$var":${JSON.stringify(name)}}`) ||
            readsInTemplates(others.elements, 'variable', name)
        );
    }
}

const isError = (it: {severity: string}) => it.severity === 'error';

// A refusal the design model makes itself, at the path of what it names, if any.
function refused(message: string, path = ''): BlueprintEditResult & {id?: string} {
    return {issues: [{code: 'edit.refused', severity: 'error', path, message}]};
}

// The element a path under /elements names, or null.
function variableOfPath(path: string): string {
    const [, coll, name] = path.split('/');
    return coll === 'variables' ? name : null;
}

function elementOfPath(path: string): string {
    const [, coll, id] = path.split('/');
    return coll === 'elements' ? id : null;
}

// The first place, row by row, where a w by h box fits among a canvas's children.
function firstFreePlace(
    children: ChildRef[],
    columns: number,
    w: number,
    h: number
): {x: number; y: number} {
    const boxes = children.filter(it =>
            [it.x, it.y, it.w, it.h].every(Number.isFinite)
        ) as (ChildRef & {
            x: number;
            y: number;
            w: number;
            h: number;
        })[],
        bottom = boxes.reduce((max, it) => Math.max(max, it.y + it.h), 0),
        overlaps = (x: number, y: number) =>
            boxes.some(b => x < b.x + b.w && b.x < x + w && y < b.y + b.h && b.y < y + h);
    for (let y = 0; y <= bottom; y++) {
        for (let x = 0; x + w <= columns; x++) {
            if (!overlaps(x, y)) return {x, y};
        }
    }
    return {x: 0, y: bottom};
}

// The first key of the form prefix1, prefix2... that an object does not hold.
// True for a name freeKey gives a dataset's source, such as positions1.
function isGeneratedName(name: string, dataset: string): boolean {
    return name.startsWith(dataset) && /^\d+$/.test(name.slice(dataset.length));
}

function freeKey(taken: PlainObject, prefix: string): string {
    let n = 1;
    while (Object.hasOwn(taken ?? {}, `${prefix}${n}`)) n++;
    return `${prefix}${n}`;
}

// A copy of an object with a value at a path, as a preset's set holds it.
function withAt(o: PlainObject, path: string, value: unknown): PlainObject {
    const ret = cloneDeep(o ?? {});
    setAt(ret, path, value);
    return ret;
}

// A copy of an object without the value at a path, and without the objects it leaves empty.
function withoutAt(o: PlainObject, path: string): PlainObject {
    const ret = cloneDeep(o ?? {}),
        segs = decodePointer(path),
        prune = (obj: PlainObject, i: number) => {
            const seg = segs[i];
            if (!isPlainObject(obj?.[seg])) return;
            if (i === segs.length - 2) {
                delete obj[seg][segs.at(-1)];
            } else {
                prune(obj[seg], i + 1);
            }
            if (isEmpty(obj[seg])) delete obj[seg];
        };
    if (segs.length === 1) delete ret[segs[0]];
    else prune(ret, 0);
    return ret;
}

// The selection kind each top-level key of a blueprint holds.
const REVEALED_KINDS: Record<string, BlueprintSelection['kind']> = {
    elements: 'element',
    variables: 'variable',
    sources: 'source',
    presets: 'preset'
};
