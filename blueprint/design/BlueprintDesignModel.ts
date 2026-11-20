import {HoistModel, type PlainObject} from '@xh/hoist/core';
import {action, observableRef} from '@xh/hoist/mobx';
import {throwIf} from '@xh/hoist/utils/js';
import {castArray, isPlainObject} from 'lodash';
import type {BlueprintElement, BlueprintOp, ChildRef} from '../Blueprint';
import type {BlueprintEditResult, BlueprintModel} from '../BlueprintModel';
import type {WidgetSpec} from '../BlueprintRegistry';
import {getAt, getOwn} from '../impl/pointer';
import {variableTypeMatches} from '../validateBlueprint';
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
     * goes into `parentId`, else the selected container, else the root. On a canvas, it takes the first free place at its default size, and in tabs, a tab
     * titled by its label. The first element of an empty blueprint becomes its root.
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
        const child = this.placeChild(parent, spec);
        return {
            ...this.edit(`Add ${spec.label}`, [
                {op: 'addElement', id, element, parent, ...(child ? {child} : {})}
            ]),
            id
        };
    }

    /**
     * What removing an element takes with it: the elements inside it, and the variables and preset
     * paths that name them. {@link removeElement} removes them all in one edit.
     */
    describeRemoval(id: string): BlueprintRemoval {
        const blueprint = this.blueprintModel.blueprint ?? {},
            elements = this.subtree(id),
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
            .filter(path => gone.has(elementOfPath(path)));
        return {elements, removedVariables, unboundVariables, presetPaths};
    }

    /**
     * Remove an element and everything inside it, in one edit, with what names them: a variable
     * loses the removed writers, and goes too if nothing else writes or reads it, and preset
     * groups stop controlling their paths. See {@link describeRemoval}.
     */
    removeElement(id: string): BlueprintEditResult {
        const blueprint = this.blueprintModel.blueprint ?? {},
            spec = this.elementSpec(id);
        if (!spec) return refused(`There is no element '${id}'.`);
        const removal = this.describeRemoval(id),
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
        Object.entries(blueprint.presets ?? {}).forEach(([group, def]) => {
            const controls = def.controls ?? [],
                kept = controls.filter(it => !gone.has(elementOfPath(it.path)));
            if (kept.length === controls.length) return;
            if (!kept.length) {
                ops.push({op: 'remove', path: `/presets/${group}`});
                return;
            }
            ops.push({op: 'set', path: `/presets/${group}/controls`, value: kept});
            Object.entries(def.items ?? {}).forEach(([item, it]) => {
                controls
                    .filter(c => !kept.includes(c))
                    .forEach(c => {
                        if (getAt(it.set, c.path) !== undefined) {
                            ops.push({
                                op: 'remove',
                                path: `/presets/${group}/items/${item}/set${c.path}`
                            });
                        }
                    });
            });
        });
        return this.edit(`Remove ${spec.label}`, ops);
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
        return this.edit(`Retitle ${id}`, [
            {op: 'moveElement', id, parent, child: {...placement, title}, index}
        ]);
    }

    /** Add a variable the user sets, a string by default, with a name of its own, and select it. */
    addVariable(type: string = 'string'): BlueprintEditResult & {id?: string} {
        const taken = this.blueprintModel.blueprint?.variables ?? {};
        let n = 1;
        while (Object.hasOwn(taken, `variable${n}`)) n++;
        const id = `variable${n}`,
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

    /** Remove a variable, as one edit. Refused while anything reads it. */
    removeVariable(name: string): BlueprintEditResult {
        return this.removeEntry('variables', 'variable', name);
    }

    /**
     * Add a source over a dataset, named for it, with each required parameter bound to the first
     * variable of its type, and select it. Refused if a required parameter has no such variable.
     */
    addSource(dataset: string): BlueprintEditResult & {id?: string} {
        const bound = this.boundParams(dataset);
        if ('refusal' in bound) return bound.refusal;
        const taken = this.blueprintModel.blueprint?.sources ?? {};
        let n = 1;
        while (Object.hasOwn(taken, `${dataset}${n}`)) n++;
        const id = `${dataset}${n}`,
            value = {dataset, ...bound.params},
            ret = this.edit(`Add source ${id}`, [{op: 'set', path: `/sources/${id}`, value}]);
        if (!ret.issues.some(isError)) this.select({kind: 'source', id});
        return {...ret, id};
    }

    /**
     * Point a source at another dataset, in one edit, with its required parameters bound again as
     * {@link addSource} binds them. Its filter and fields, which name the old dataset's fields, go.
     */
    changeSourceDataset(name: string, dataset: string): BlueprintEditResult {
        const bound = this.boundParams(dataset);
        if ('refusal' in bound) return bound.refusal;
        return this.updateSourceDecl(name, {
            dataset,
            params: bound.params.params,
            filter: undefined,
            fields: undefined
        });
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
        coll: 'variables' | 'sources',
        noun: string,
        name: string,
        changes: PlainObject
    ): BlueprintEditResult {
        const decl = getOwn<PlainObject>(this.blueprintModel.blueprint?.[coll], name);
        if (!decl) return refused(`There is no ${noun.toLowerCase()} '${name}'.`);
        const ops: BlueprintOp[] = Object.entries(changes)
            .filter(([key, value]) => value !== undefined || Object.hasOwn(decl, key))
            .map(([key, value]) => {
                const path = `/${coll}/${name}/${key}`;
                return value === undefined ? {op: 'remove', path} : {op: 'set', path, value};
            });
        return this.edit(`${noun} ${name}: ${Object.keys(changes).join(', ')}`, ops);
    }

    private removeEntry(
        coll: 'variables' | 'sources',
        noun: string,
        name: string
    ): BlueprintEditResult {
        if (!getOwn<PlainObject>(this.blueprintModel.blueprint?.[coll], name)) {
            return refused(`There is no ${noun} '${name}'.`);
        }
        return this.edit(`Remove ${noun} ${name}`, [{op: 'remove', path: `/${coll}/${name}`}]);
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
        return JSON.stringify(others).includes(`{"$var":${JSON.stringify(name)}}`);
    }
}

const isError = (it: {severity: string}) => it.severity === 'error';

function refused(message: string): BlueprintEditResult & {id?: string} {
    return {issues: [{code: 'edit.refused', severity: 'error', path: '', message}]};
}

function parentOf(elements: Record<string, BlueprintElement>, id: string): string {
    return (
        Object.entries(elements ?? {}).find(([, el]) => el.children?.some(c => c.id === id))?.[0] ??
        null
    );
}

// The element a path under /elements names, or null.
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
