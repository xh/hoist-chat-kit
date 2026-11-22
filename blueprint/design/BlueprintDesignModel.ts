import {HoistModel, type PlainObject} from '@xh/hoist/core';
import {action, computed, observable, observableRef} from '@xh/hoist/mobx';
import {throwIf} from '@xh/hoist/utils/js';
import {
    castArray,
    cloneDeep,
    isEmpty,
    isEqual,
    isPlainObject,
    mapValues,
    omit,
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
import {CANVAS_COLUMNS, rescaleCells} from '../impl/canvasCells';
import {childIds, locate, parentOf, slotLabel, slotLists} from '../impl/elements';
import type {SlotAccepts} from '../BlueprintRegistry';
import {decodePointer, getAt, getOwn, setAt} from '../impl/pointer';
import {variableTypeMatches} from '../validateBlueprint';
import {configEditLabel, labelOf} from '../impl/labels';
import {starterConfig} from './starterConfig';
import {wiringFor, wiringGraph, type WiringGraph, type WiringRef} from './wiring';

/** What a designer has selected: an element, a variable, a source or a preset group. */
export interface BlueprintSelection {
    kind: 'element' | 'variable' | 'source' | 'preset' | 'view';
    id: string;
    /** For a `view`, the canvas whose cell it is. */
    of?: string;
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

    /** The element under the pointer on the canvas, in the outline or the map: view state, never an edit. */
    @observableRef accessor hoveredId: string = null;

    constructor(config: {blueprintModel: BlueprintModel}) {
        super();
        const {blueprintModel} = config;
        throwIf(blueprintModel.isAnswer, 'A chat answer has no design mode.');
        this.blueprintModel = blueprintModel;
        this.addReaction({
            track: () => this.blueprintModel.blueprint,
            run: () => {
                const {selection} = this;
                if (!selection || this.exists(selection)) return;
                // An undone copy hands the selection back to its original.
                const original =
                    selection.kind === 'element' ? this.copiedFrom.get(selection.id) : null;
                this.select(
                    original && this.exists({kind: 'element', id: original})
                        ? {kind: 'element', id: original}
                        : null
                );
            }
        });
    }

    @action
    select(selection: BlueprintSelection) {
        this.selection = selection;
        this.slotTarget = null;
    }

    /**
     * Select a slot as the place to add, such as a canvas cell's header: the element that holds
     * it is selected, and {@link addTarget} is the slot until the selection changes.
     */
    @action
    selectSlot(place: AddPlace) {
        this.selection = {kind: 'element', id: place.of ?? place.parent};
        this.slotTarget = place;
    }

    /** The tab each tab container on the canvas shows, by container id: view state, never an edit. */
    @observableRef accessor activeTabs: Record<string, string> = {};

    /** The views each dash container's stacks hide behind others, by container id: view state. */
    @observableRef accessor hiddenViews: Record<string, string[]> = {};

    /**
     * Set what every tab and dash container on the canvas shows, replacing what was reported
     * before, so a container that is gone leaves no entry.
     */
    @action
    setCanvasTabs(activeTabs: Record<string, string>, hiddenViews: Record<string, string[]>) {
        if (!isEqual(this.activeTabs, activeTabs)) this.activeTabs = activeTabs;
        if (!isEqual(this.hiddenViews, hiddenViews)) this.hiddenViews = hiddenViews;
    }

    /** A field an Inspector should focus, from a widget that needs it set: view state. */
    @observableRef accessor fieldFocus: {id: string; key: string} = null;

    /** Note that the Inspector has focused the field asked for, so it never takes focus again. */
    @action
    clearFieldFocus() {
        this.fieldFocus = null;
    }

    /** Select an element, and ask the Inspector to focus one of its fields, such as `source`. */
    @action
    requestFieldFocus(id: string, key: string) {
        this.select({kind: 'element', id});
        this.fieldFocus = {id, key};
    }

    /** The host's Add, opened to search, as from the `/` key. Set by the host. */
    onRequestAdd: () => void = null;

    /** When Add was last asked for, for a palette to focus its search, even one opening for it. */
    @observable accessor addRequestedAt = 0;

    /** Ask for Add, to search the widgets: the host opens it, and its palette focuses its search. */
    @action
    requestAdd() {
        this.addRequestedAt = Date.now();
        this.onRequestAdd?.();
    }

    /** True while the pointer is over the host's palette, for the canvas to outline the add target. */
    @observable accessor showAddTarget = false;

    @action
    setShowAddTarget(show: boolean) {
        this.showAddTarget = show;
    }

    /**
     * Why a place will not take a widget, such as `posGrid's cell header takes inputs only.`, or null if it
     * will. Default the {@link addTarget}.
     */
    addRefusal(component: string, place: AddPlace = this.addTarget): string {
        const spec = this.widgetSpec(component);
        if (!spec) return `There is no widget '${component}'.`;
        if (!place) return null;
        const {slot = 'children', of} = place,
            parentSpec = this.elementSpec(place.parent),
            rule = of
                ? parentSpec?.children?.slots?.[slot]?.accepts
                : slot === 'children'
                  ? parentSpec?.children?.accepts
                  : parentSpec?.slots?.[slot]?.accepts;
        if (accepts(rule, spec)) return null;
        const takes = [
            ...(rule.categories ?? []).map(it => `${it}s`),
            ...(rule.widgets ?? []).map(it => this.widgetSpec(it)?.label ?? it)
        ];
        return `${of ?? place.parent}'s ${slotLabel(slot, !!of).toLowerCase()} takes ${takes.join(' and ')} only.`;
    }

    /** The slot selected with {@link selectSlot}, or null. */
    @observableRef accessor slotTarget: AddPlace = null;

    @action
    setHovered(id: string) {
        this.hoveredId = id;
    }

    /**
     * The elements that read the source, variable or preset group selected, such as for a wash. A
     * source's readers include those of each source that joins it.
     */
    @computed
    get readerIds(): string[] {
        const {selection} = this,
            bp = this.blueprintModel.blueprint ?? {},
            wiring = (it: BlueprintSelection) => wiringFor(bp, it, this.wiring),
            elementsOf = (refs: WiringRef[]) =>
                refs.filter(it => it.kind === 'element').map(it => it.id);
        switch (selection?.kind) {
            case 'source':
                return this.sourceReaders(selection.id);
            case 'variable':
                return elementsOf(wiring(selection).readBy);
            case 'preset': {
                const {presets, readBy} = wiring(selection);
                return uniq(elementsOf([...presets, ...readBy]));
            }
            default:
                return [];
        }
    }

    /** The elements that show a source's rows: its readers, and those of each source that joins it. */
    sourceReaders(name: string): string[] {
        const bp = this.blueprintModel.blueprint ?? {},
            readBy = (id: string) => wiringFor(bp, {kind: 'source', id}, this.wiring).readBy,
            sources = [name];
        for (let i = 0; i < sources.length; i++) {
            readBy(sources[i])
                .filter(it => it.kind === 'source' && !sources.includes(it.id))
                .forEach(it => sources.push(it.id));
        }
        return uniq(
            sources.flatMap(id =>
                readBy(id)
                    .filter(it => it.kind === 'element')
                    .map(it => it.id)
            )
        );
    }

    /** What reads and sets what in the blueprint. See `wiringGraph`. */
    @computed
    get wiring(): WiringGraph {
        return wiringGraph(this.blueprintModel.blueprint);
    }

    /** An element's ancestors, root first. */
    pathTo(id: string): string[] {
        const elements = this.blueprintModel.blueprint?.elements ?? {},
            ret: string[] = [];
        for (let it = parentOf(elements, id); it; it = parentOf(elements, it)) ret.unshift(it);
        return ret;
    }

    /** The elements the Architect's last edit added or changed, that are still there. */
    get lastArchitectTouched(): string[] {
        const edit = [...this.blueprintModel.history]
                .reverse()
                .find(it => it.author === 'architect'),
            elements = this.blueprintModel.blueprint?.elements ?? {},
            ids = (edit?.ops ?? []).flatMap(op => [
                'path' in op ? elementOfPath(op.path) : null,
                op.op === 'addElement' || op.op === 'moveElement' ? op.id : null
            ]);
        return uniq(ids.filter(it => it && getOwn(elements, it)));
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

    /** The ID of the element whose canvas view is selected, or null. */
    get selectedViewId(): string {
        return this.selection?.kind === 'view' ? this.selection.id : null;
    }

    /** The canvas view (cell) that holds an element, or null for one in no canvas. */
    viewOf(id: string): {id: string; of: string} {
        const elements = this.blueprintModel.blueprint?.elements ?? {},
            parent = parentOf(elements, id);
        return parent &&
            getOwn(elements, parent)?.component === 'dashCanvas' &&
            elements[parent].children?.some(it => it.id === id)
            ? {id, of: parent}
            : null;
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
            /** More ops for the same edit, given the new element's id, such as a layout naming it. */
            extraOps?: (id: string) => BlueprintOp[];
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
                },
                ...(opts.extraOps?.(id) ?? [])
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
            isContainer = (id: string) => !!this.elementSpec(id)?.children,
            {slotTarget} = this;
        if (slotTarget && selected === (slotTarget.of ?? slotTarget.parent)) return slotTarget;
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
        if (!this.elementSpec(id)) return refused(`There is no element '${id}'.`);
        const at = locate(this.blueprintModel.blueprint.elements, id),
            where =
                at?.parent === parentId && opts.index != null
                    ? opts.index < at.index
                        ? ' earlier'
                        : ' later'
                    : ` to ${parentId}`;
        return this.edit(`Move ${id}${where}`, [
            {op: 'moveElement', id, parent: parentId, ...opts}
        ]);
    }

    /**
     * Move an element by hand, as one edit: into a container, at its end, or before or after
     * another element, in that one's container. It keeps its placement within its own container,
     * and takes a free one in another, as {@link addWidget} would give it.
     */
    moveTo(id: string, targetId: string, where: 'into' | 'before' | 'after'): BlueprintEditResult {
        const plan = this.planMove(id, targetId, where);
        return 'issues' in plan ? plan : this.edit(plan.description, plan.ops);
    }

    /** The issues {@link moveTo} would meet, applying nothing: none if the move would apply. */
    canMoveTo(id: string, targetId: string, where: 'into' | 'before' | 'after'): BlueprintIssue[] {
        return this.dryRun(this.planMove(id, targetId, where));
    }

    // The errors an edit's plan would meet, applying nothing.
    private dryRun(plan: {ops: BlueprintOp[]} | BlueprintEditResult): BlueprintIssue[] {
        if ('issues' in plan) return plan.issues.filter(isError);
        const {result, issue} = applyOps(this.blueprintModel.blueprint ?? {}, plan.ops);
        return issue ? [issue] : this.blueprintModel.validate(result).filter(isError);
    }

    // The ops that move an element to the end of a slot, or why they cannot.
    private planPlace(
        id: string,
        {parent, slot = 'children', of}: AddPlace
    ): {description: string; ops: BlueprintOp[]} | BlueprintEditResult {
        const spec = this.elementSpec(id);
        if (!spec || !this.elementSpec(parent)) return refused(`'${id}' cannot move there.`);
        if (this.subtree(id).includes(parent)) {
            return refused(`${id} cannot move inside itself.`, `/elements/${id}`);
        }
        const child = slot === 'children' ? this.placeChild(parent, spec) : null;
        return {
            description: `Move ${spec.label} to ${of ? `${of} ` : ''}${slot}`,
            ops: [
                {
                    op: 'moveElement',
                    id,
                    parent,
                    ...(child ? {child} : {}),
                    ...(slot !== 'children' ? {slot} : {}),
                    ...(of ? {of} : {})
                }
            ]
        };
    }

    /**
     * Copy an element and everything inside it, with fresh ids, in one edit, and select the copy.
     * On a canvas the copy takes the first free place at the same size. Elsewhere it goes right
     * after the element, in the same slot.
     */
    duplicateElement(id: string): BlueprintEditResult & {id?: string} {
        const {elements} = this.blueprintModel.blueprint ?? {},
            at = locate(elements, id);
        if (!at || !this.elementSpec(id)) return refused(`'${id}' has no container to copy into.`);
        const ids: Record<string, string> = {},
            taken = new Set(Object.keys(elements));
        this.subtree(id).forEach(it => {
            ids[it] = this.newId(elements[it].component, taken);
            taken.add(ids[it]);
        });
        // A copy takes the values presets give the original as its own, and joins no group.
        const controlled = Object.values(this.blueprintModel.blueprint.presets ?? {}).flatMap(
                it => it.controls ?? []
            ),
            effective = this.blueprintModel.effective,
            copyOf = (from: string): BlueprintElement => {
                const ret = cloneDeep(elements[from]);
                slotLists(ret).forEach(({refs}) => refs.forEach(ref => (ref.id = ids[ref.id])));
                controlled
                    .filter(it => elementOfPath(it.path) === from)
                    .forEach(({path}) => {
                        const value = getAt(effective, path);
                        if (value !== undefined) {
                            setAt(ret, path.replace(`/elements/${from}`, ''), cloneDeep(value));
                        }
                    });
                return ret;
            },
            parent = elements[at.parent],
            ref = slotLists(parent)
                .find(it => it.slot === at.slot && it.of === at.of)
                ?.refs.find(it => it.id === id),
            // The cell's own slots, such as its header items, stay with the original.
            placement: PlainObject = omit(
                (ref ?? {id}) as PlainObject,
                'id',
                ...slotLists(parent)
                    .filter(it => it.of === id)
                    .map(it => it.slot)
            ),
            onCanvas = at.slot === 'children' && Number.isInteger(placement.x),
            child = onCanvas
                ? {
                      ...placement,
                      ...firstFreePlace(
                          parent.children ?? [],
                          parent.config?.columns ?? 12,
                          placement.w,
                          placement.h
                      )
                  }
                : at.slot === 'children'
                  ? placement
                  : null,
            copyId = ids[id],
            ops: BlueprintOp[] = [
                {
                    op: 'addElement',
                    id: copyId,
                    element: copyOf(id),
                    parent: at.parent,
                    ...(child ? {child} : {}),
                    ...(onCanvas ? {} : {index: at.index + 1}),
                    ...(at.slot !== 'children' ? {slot: at.slot} : {}),
                    ...(at.of ? {of: at.of} : {})
                },
                ...this.subtree(id)
                    .slice(1)
                    .map((it): BlueprintOp => ({
                        op: 'set',
                        path: `/elements/${ids[it]}`,
                        value: copyOf(it)
                    }))
            ],
            ret = this.edit(`Duplicate ${this.elementSpec(id).label}`, ops);
        if (!ret.issues.some(isError)) {
            this.copiedFrom.set(copyId, id);
            this.select({kind: 'element', id: copyId});
        }
        return {...ret, id: copyId};
    }

    /**
     * Move or resize a canvas cell by whole grid units. Calls on the same cell within a second, with
     * no other edit between, fold into one edit, so a run of arrow keys undoes in one step.
     */
    nudgeChild(
        id: string,
        {dx = 0, dy = 0, dw = 0, dh = 0}: {dx?: number; dy?: number; dw?: number; dh?: number}
    ): BlueprintEditResult {
        const {blueprintModel} = this,
            elements = blueprintModel.blueprint?.elements ?? {},
            parent = parentOf(elements, id),
            children = parent ? elements[parent].children : [],
            index = children.findIndex(it => it.id === id),
            cell = children[index] as PlainObject;
        if (!cell || !Number.isInteger(cell.x)) return refused(`'${id}' is not in a canvas cell.`);
        const columns = elements[parent].config?.columns ?? 12,
            w = Math.min(columns, Math.max(1, cell.w + dw)),
            h = Math.max(1, cell.h + dh),
            next: PlainObject = {
                ...cell,
                x: Math.min(columns - w, Math.max(0, cell.x + dx)),
                y: Math.max(0, cell.y + dy),
                w,
                h
            },
            {id: _cellId, ...child} = next,
            last = this.lastNudge,
            fold =
                last?.id === id &&
                Date.now() - last.at < NUDGE_FOLD_MS &&
                last.version === blueprintModel.version,
            edit = {
                base: blueprintModel.version,
                author: 'user',
                description: `${dw || dh ? 'Resize' : 'Move'} ${this.elementSpec(id)?.label ?? id}`,
                ops: [{op: 'moveElement', id, parent, child, index} as BlueprintOp]
            },
            ret = fold ? blueprintModel.foldEdit(edit) : blueprintModel.applyEdit(edit);
        if (!ret.issues.some(isError)) {
            this.lastNudge = {id, at: Date.now(), version: blueprintModel.version};
        }
        return ret;
    }

    /**
     * Move an element earlier or later in the slot list that holds it, by the number of places
     * given, such as -1 for one place earlier.
     */
    reorder(id: string, step: number): BlueprintEditResult {
        const at = locate(this.blueprintModel.blueprint?.elements, id);
        if (!at) return refused(`'${id}' is not in a container.`);
        const list = slotLists(this.blueprintModel.blueprint.elements[at.parent]).find(
                it => it.slot === at.slot && it.of === at.of
            ),
            index = at.index + step;
        if (index < 0 || index >= (list?.refs.length ?? 0)) return {issues: []};
        return this.edit(`Move ${id} ${step < 0 ? 'earlier' : 'later'}`, [
            {
                op: 'moveElement',
                id,
                parent: at.parent,
                index,
                ...(at.slot !== 'children' ? {slot: at.slot} : {}),
                ...(at.of ? {of: at.of} : {})
            }
        ]);
    }

    // The ops of a move, or why it cannot be made.
    private planMove(
        id: string,
        targetId: string,
        where: 'into' | 'before' | 'after'
    ): {description: string; ops: BlueprintOp[]} | BlueprintEditResult {
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
        return {
            description: `Move ${spec.label}`,
            ops: [
                {
                    op: 'moveElement',
                    id,
                    parent,
                    ...(child ? {child} : {}),
                    ...(index != null ? {index} : {}),
                    ...(slot !== 'children' ? {slot} : {}),
                    ...(of ? {of} : {})
                }
            ]
        };
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
        const takes = (rule: SlotAccepts) => accepts(rule, spec),
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

    /** The element before or after one in the slot list that holds it, or null at its end. */
    siblingOf(id: string, step: -1 | 1): string {
        const {elements} = this.blueprintModel.blueprint ?? {},
            at = locate(elements, id);
        if (!at) return null;
        const list = slotLists(elements[at.parent]).find(
            it => it.slot === at.slot && it.of === at.of
        );
        return list?.refs[at.index + step]?.id ?? null;
    }

    /**
     * The places a designer can add a widget from an element, with the widgets each takes: the
     * element's own children and slots, if it is a container, then its cell's slots, such as a
     * canvas cell's header.
     */
    addPlacesFor(id: string): {place: AddPlace; label: string; widgets: string[]}[] {
        const {elements} = this.blueprintModel.blueprint ?? {},
            spec = this.elementSpec(id),
            parent = parentOf(elements, id),
            parentSpec = parent ? this.elementSpec(parent) : null,
            widgets = Object.values(this.blueprintModel.registry.widgets).filter(
                it => !it.reserved
            ),
            placeOf = (place: AddPlace, label: string, rule: SlotAccepts) => ({
                place,
                label,
                widgets: widgets.filter(it => accepts(rule, it)).map(it => it.name)
            });
        if (!spec) return [];
        return [
            ...(spec.children
                ? [
                      placeOf(
                          {parent: id, slot: 'children'},
                          slotLabel('children'),
                          spec.children.accepts
                      )
                  ]
                : []),
            ...Object.entries(spec.slots ?? {}).map(([slot, it]) =>
                placeOf({parent: id, slot}, slotLabel(slot), it.accepts)
            ),
            ...Object.entries(parentSpec?.children?.slots ?? {}).map(([slot, it]) =>
                placeOf({parent, slot, of: id}, slotLabel(slot, true), it.accepts)
            )
        ].filter(it => it.widgets.length);
    }

    /**
     * Put an element in a new panel, in one edit, and select the panel. The panel takes the
     * element's place, with its cell's slots such as header items, and the element's title.
     */
    wrapInPanel(id: string): BlueprintEditResult & {id?: string} {
        const {elements} = this.blueprintModel.blueprint ?? {},
            at = locate(elements, id),
            spec = this.elementSpec(id);
        if (!at || !spec) return refused(`'${id}' has no container to wrap it in.`);
        const panelId = this.newId('panel'),
            title = elements[id].config?.title,
            parent = cloneDeep(elements[at.parent]);
        slotLists(parent)
            .find(it => it.slot === at.slot && it.of === at.of)
            .refs.find(it => it.id === id).id = panelId;
        const ret = this.edit(`Wrap ${spec.label} in a panel`, [
            {
                op: 'set',
                path: `/elements/${panelId}`,
                value: {component: 'panel', config: title != null ? {title} : {}, children: [{id}]}
            },
            ...(title != null
                ? [{op: 'remove', path: `/elements/${id}/config/title`} as BlueprintOp]
                : []),
            {op: 'set', path: `/elements/${at.parent}`, value: parent}
        ]);
        if (!ret.issues.some(isError)) this.select({kind: 'element', id: panelId});
        return {...ret, id: panelId};
    }

    /** Move an element to another slot of its container, at its end, as one edit. */
    moveToSlot(id: string, slot: string, of?: string): BlueprintEditResult {
        const parent = parentOf(this.blueprintModel.blueprint?.elements, id);
        if (!parent) return refused(`'${id}' is not in a container.`);
        return this.moveToPlace(id, {parent, slot, of});
    }

    /** Move an element to the end of a slot of any container, as one edit. */
    moveToPlace(id: string, place: AddPlace): BlueprintEditResult {
        const plan = this.planPlace(id, place);
        return 'issues' in plan ? plan : this.edit(plan.description, plan.ops);
    }

    /** The issues {@link moveToPlace} would meet, applying nothing: none if the move would apply. */
    canMoveToPlace(id: string, place: AddPlace): BlueprintIssue[] {
        return this.dryRun(this.planPlace(id, place));
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
        const id = freeName(this.blueprintModel.blueprint?.sources, dataset),
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
                ? freeName(omit(sources, name), dataset)
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

    /** The preset selectors that show a group, which removing the group takes with it. */
    presetSelectors(group: string): string[] {
        return this.selectorsOf([group]);
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
        return this.edit(configEditLabel(id, spec.config, path), [
            op,
            ...this.rescaleOps(id, path, value)
        ]);
    }

    //------------------
    // Implementation
    //------------------
    // A canvas's new column count rescales its cells in the same edit, so they stay on the grid.
    private rescaleOps(id: string, path: string, value: unknown): BlueprintOp[] {
        const el = getOwn(this.blueprintModel.blueprint?.elements, id);
        if (el?.component !== 'dashCanvas' || path !== '/columns' || !el.children) return [];
        const from = (el.config?.columns as number) ?? CANVAS_COLUMNS,
            to = (value as number) ?? CANVAS_COLUMNS,
            children = rescaleCells(el.children, from, to);
        return children === el.children
            ? []
            : [{op: 'set', path: `/elements/${id}/children`, value: children}];
    }

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

    // Each copy duplicateElement made, to its original.
    private readonly copiedFrom = new Map<string, string>();

    // The last nudge, which a nudge of the same cell soon after folds into.
    private lastNudge: {id: string; at: number; version: number} = null;

    private edit(description: string, ops: BlueprintOp[]): BlueprintEditResult {
        const {blueprintModel} = this;
        return blueprintModel.applyEdit({
            base: blueprintModel.version,
            author: 'user',
            description,
            ops
        });
    }

    private exists({kind, id, of}: BlueprintSelection): boolean {
        if (kind === 'view') return this.viewOf(id)?.of === of;
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

    // A free id for a new element of a widget, named for the last part of an app widget's name.
    private newId(
        component: string,
        taken = new Set(Object.keys(this.blueprintModel.blueprint?.elements ?? {}))
    ): string {
        const prefix = component.split('.').at(-1);
        let n = 1;
        while (taken.has(`${prefix}${n}`)) n++;
        return `${prefix}${n}`;
    }

    // An element and every element inside it, depth first.
    private subtree(id: string): string[] {
        const el = getOwn(this.blueprintModel.blueprint?.elements, id);
        if (!el) return [];
        return [id, ...childIds(el).flatMap(it => this.subtree(it))];
    }

    // True if anything outside the removed elements reads the variable.
    // The elements, sources, other variables and preset groups that bind a variable.
    // What reads a variable, as a refusal names it.
    private readersOf(name: string): string[] {
        return wiringFor(this.blueprintModel.blueprint, {kind: 'variable', id: name}, this.wiring)
            .readBy.filter(it => !(it.kind === 'variable' && it.id === name))
            .map(it => (it.kind === 'preset' ? `presets ${it.id}` : it.id));
    }

    // True if anything but the elements going reads a variable.
    private isRead(name: string, gone: Set<string>): boolean {
        return wiringFor(
            this.blueprintModel.blueprint,
            {kind: 'variable', id: name},
            this.wiring
        ).readBy.some(
            it =>
                !(it.kind === 'element' && gone.has(it.id)) &&
                !(it.kind === 'variable' && it.id === name)
        );
    }
}

const isError = (it: {severity: string}) => it.severity === 'error';

// True if a slot's rule takes a widget. No rule takes every widget.
function accepts(rule: SlotAccepts, spec: WidgetSpec): boolean {
    return (
        !rule ||
        (!rule.categories && !rule.widgets) ||
        !!rule.categories?.includes(spec.category) ||
        !!rule.widgets?.includes(spec.name)
    );
}

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

// A name itself if it is free, else with the first free number after it.
function freeName(taken: PlainObject, name: string): string {
    return Object.hasOwn(taken ?? {}, name) ? freeKey(taken, name) : name;
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

// How soon a nudge of the same cell must follow to fold into the last.
const NUDGE_FOLD_MS = 1000;
