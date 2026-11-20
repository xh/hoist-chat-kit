import {HoistModel, type PlainObject} from '@xh/hoist/core';
import {action, observableRef} from '@xh/hoist/mobx';
import {throwIf} from '@xh/hoist/utils/js';
import {castArray, cloneDeep, isEmpty, isPlainObject, mapValues, uniq} from 'lodash';
import type {BlueprintElement, BlueprintOp, ChildRef, PresetGroup} from '../Blueprint';
import {applyOps} from '../applyOps';
import type {BlueprintEditResult, BlueprintModel} from '../BlueprintModel';
import type {WidgetSpec} from '../BlueprintRegistry';
import {parentOf} from '../impl/elements';
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
    addWidget(component: string, parentId?: string): BlueprintEditResult & {id?: string} {
        const {blueprint} = this.blueprintModel,
            spec = this.widgetSpec(component);
        if (!spec) return refused(`There is no widget '${component}'.`);
        const {catalog} = this.blueprintModel,
            config = starterConfig(spec, {blueprint, catalog});
        if (!config) return refused(`Add a source for the ${spec.label} to read first.`);
        const id = this.newId(component),
            element: BlueprintElement = {component, config},
            parent = parentId ?? this.defaultParent();
        if (!parent) {
            if (blueprint?.root) return refused('Select a container to add the widget to.');
            return {...this.edit(`Add ${spec.label}`, [{op: 'addElement', id, element}]), id};
        }
        const child = this.placeChild(parent, spec),
            index = parentId ? null : this.indexAfterSelected(parent);
        return {
            ...this.edit(`Add ${spec.label}`, [
                {
                    op: 'addElement',
                    id,
                    element,
                    parent,
                    ...(child ? {child} : {}),
                    ...(index != null ? {index} : {})
                }
            ]),
            id
        };
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
        const presetPaths = Object.values(blueprint.presets ?? {})
            .flatMap(it => it.controls ?? [])
            .map(it => it.path)
            .filter(
                path =>
                    gone.has(elementOfPath(path)) || removedVariables.includes(variableOfPath(path))
            );
        return {elements, removedVariables, unboundVariables, presetPaths};
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

    /** Set the title an element has in its container, such as a tab's, as one edit. */
    setChildTitle(id: string, title: string): BlueprintEditResult {
        const parent = parentOf(this.blueprintModel.blueprint?.elements, id);
        if (!parent) return refused(`'${id}' is not in a container.`);
        const children = this.blueprintModel.blueprint.elements[parent].children,
            index = children.findIndex(it => it.id === id),
            {id: _id, ...placement} = children[index];
        return this.edit(`Retitle ${this.elementSpec(id)?.label ?? id}`, [
            {op: 'moveElement', id, parent, child: {...placement, title}, index}
        ]);
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
    addSource(dataset: string): BlueprintEditResult & {id?: string} {
        const bound = this.boundParams(dataset);
        if ('refusal' in bound) return bound.refusal;
        const id = freeKey(this.blueprintModel.blueprint?.sources, dataset),
            value = {dataset, ...bound.params},
            ret = this.edit(`Add source ${id}`, [{op: 'set', path: `/sources/${id}`, value}]);
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
        const breaks = opts.removeBreaking ? this.describeDatasetChange(name, dataset).breaks : [],
            removals = breaks.length ? this.removalOps(breaks) : [];
        return this.edit(`Source ${name}: dataset`, [
            ...removals,
            ...this.datasetOps(name, dataset, bound.params)
        ]);
    }

    /** Set one key of a source's declaration, or remove it with `undefined`, as one edit. */
    setSourceDecl(name: string, key: string, value: unknown): BlueprintEditResult {
        return this.updateSourceDecl(name, {[key]: value});
    }

    /** Set keys of a source's declaration together, removing each given as `undefined`. */
    updateSourceDecl(name: string, changes: PlainObject): BlueprintEditResult {
        return this.updateEntry('sources', 'Source', name, changes);
    }

    /** Remove a source, as one edit. Refused while a widget reads it. */
    removeSource(name: string): BlueprintEditResult {
        return this.removeEntry('sources', 'source', name);
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
        dataset: string
    ): {params: {params?: PlainObject}} | {refusal: BlueprintEditResult} {
        const {blueprint, catalogs, registry} = this.blueprintModel,
            ds = catalogs.map(it => it.getDataset(dataset)).find(Boolean);
        if (!ds) return {refusal: refused(`There is no dataset '${dataset}'.`)};
        const variables = blueprint?.variables ?? {},
            params: PlainObject = {};
        for (const [pn, pd] of Object.entries(ds.params ?? {})) {
            if (!pd.required) continue;
            const bound = Object.keys(variables).find(it =>
                variableTypeMatches(registry, variables[it].type, pd.type)
            );
            if (!bound) return {refusal: refused(`Add a ${pd.type} variable for ${pn} first.`)};
            params[pn] = {$var: bound};
        }
        return {params: Object.keys(params).length ? {params} : {}};
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

    // The selected element if it can hold children, else its container, else the root.
    private defaultParent(): string {
        const {blueprint} = this.blueprintModel,
            isContainer = (id: string) => !!this.elementSpec(id)?.children,
            selected = this.selectedElementId;
        if (selected && isContainer(selected)) return selected;
        const parent = selected ? parentOf(blueprint?.elements, selected) : null;
        if (parent) return parent;
        return blueprint?.root && isContainer(blueprint.root) ? blueprint.root : null;
    }

    // The place right after the selected element among its parent's children, or null.
    private indexAfterSelected(parentId: string): number {
        const children = getOwn(this.blueprintModel.blueprint?.elements, parentId)?.children ?? [],
            idx = children.findIndex(it => it.id === this.selectedElementId);
        return idx >= 0 ? idx + 1 : null;
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
        return [id, ...(el.children ?? []).flatMap(it => this.subtree(it.id))];
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

function refused(message: string): BlueprintEditResult & {id?: string} {
    return {issues: [{code: 'edit.refused', severity: 'error', path: '', message}]};
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
