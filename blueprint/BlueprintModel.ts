import {HoistModel, type LoadSpec, type PlainObject} from '@xh/hoist/core';
import type {FilterSpec} from '@xh/hoist/data';
import {action, computed, observable, observableRef} from '@xh/hoist/mobx';
import {throwIf} from '@xh/hoist/utils/js';
import {cloneDeep, isEmpty, isEqual, omitBy, pickBy} from 'lodash';
import type {Blueprint, BlueprintEdit, BlueprintIssue, ResolverCall} from './Blueprint';
import type {BlueprintArtifactProvider, BlueprintDataProvider} from './BlueprintDataProvider';
import type {BlueprintRegistry} from './BlueprintRegistry';
import {BlueprintSource} from './BlueprintSource';
import {BlueprintVariable} from './BlueprintVariable';
import type {DataCatalog} from './DataCatalog';
import {applyOps} from './applyOps';
import {parseWebUrl} from '../impl/UrlUtils';
import {type ActionRunContext, describeAction, runActionsAsync} from './impl/actions';
import {resolveBindings, resolveFilter} from './impl/bindings';
import {getOwn, getAt as valueAt, setAt} from './impl/pointer';
import {validateBlueprint} from './validateBlueprint';
import type {BlueprintAccess, BlueprintMode} from './architect/blueprintContextProvider';
import {checkEditAllowed} from './impl/access';
import {checkVariableValue} from './impl/variableValues';

export interface BlueprintModelConfig {
    /** The blueprint to open. Default none. Throws if it has errors. */
    blueprint?: Blueprint;
    catalog: DataCatalog;
    registry: BlueprintRegistry;
    dataProvider: BlueprintDataProvider;
    /** The dataset behind each artifact a chat answer can name, keyed by artifact ID. */
    artifacts?: Record<string, string>;
    /** The rows of those artifacts. Required for a blueprint with an artifact source. */
    artifactProvider?: BlueprintArtifactProvider;
    /** What the host passes to its widgets, such as the chat that shows an answer. */
    hostContext?: unknown;
    /**
     * The presentation a widget draws in when its config names none, if the registry has it for
     * that widget, such as the card a chat answer draws in. Default none: each widget's own.
     */
    defaultPresentation?: string;
    /** True for a chat answer, which may hold literal parameters, artifacts and inline sources. */
    isAnswer?: boolean;
    /** The user's mode. Default run. Design mode takes effect only with write access. */
    mode?: BlueprintMode;
    /** The user's access to the blueprint. Default read. */
    access?: BlueprintAccess;
    /**
     * URLs the `openUrl` action may open, each an http or https origin with an optional path, such
     * as `https://reports.example.com/daily`. Default none, so no URL opens.
     */
    urlAllowList?: string[];
}

/** The result of an edit: the new version, or the issues that refused it. */
export interface BlueprintEditResult {
    version?: number;
    issues: BlueprintIssue[];
}

/**
 * A blueprint at runtime. Holds the document, applies edits to it, resolves its variables and
 * runs its sources. The document is the source of truth: every change to it goes through
 * {@link setBlueprint} or {@link applyEdit}, which refuse a result with errors.
 */
export class BlueprintModel extends HoistModel {
    /** The datasets the blueprint reads. An update may bring new ones, as artifacts arrive. */
    catalog: DataCatalog;
    readonly registry: BlueprintRegistry;
    readonly dataProvider: BlueprintDataProvider;
    artifacts: Record<string, string>;
    readonly artifactProvider: BlueprintArtifactProvider;
    readonly hostContext: unknown;
    readonly defaultPresentation: string;
    readonly isAnswer: boolean;
    readonly urlAllowList: string[];

    /** The current blueprint. Always valid: it has no errors. */
    @observableRef accessor blueprint: Blueprint = null;

    /** Goes up with each change to the blueprint. */
    @observable accessor version: number = 0;

    /** Each edit applied since the blueprint was last replaced whole, oldest first. */
    @observableRef accessor history: (BlueprintEdit & {version: number})[] = [];

    /**
     * The user's mode: design only with write access, else run. In run mode, a change a user makes
     * in a widget, such as a sort, stays transient, as personalizations do not exist yet, and every
     * edit is refused. In design mode, a widget's change is an edit.
     */
    get mode(): BlueprintMode {
        return this.access === 'write' ? this.requestedMode : 'run';
    }

    /**
     * Switch mode. Design mode takes effect only with write access, and drops the run-mode
     * changes, so the designer sees the definition.
     */
    @action
    setMode(mode: BlueprintMode) {
        this.requestedMode = mode;
        if (this.mode === 'design') this.transientValues = {};
    }

    @action
    setAccess(access: BlueprintAccess) {
        this.access = access;
        if (this.mode === 'design') this.transientValues = {};
    }

    /**
     * When the user last acted in the blueprint: set a variable, switched a preset, changed a
     * widget in run mode, selected, or ran an action. Null until they do. An update never sets it.
     */
    @observable accessor userActedAt: number = null;

    /** Note that the user acted, as each of their changes does. */
    @action
    noteUserAction() {
        this.userActedAt = Date.now();
    }

    /** The current blueprint's warnings. */
    @observableRef accessor issues: BlueprintIssue[] = [];

    /** Each variable, in declaration order. */
    @observableRef accessor variables: BlueprintVariable[] = [];

    /** Each source, by name. */
    @observableRef accessor sources: Record<string, BlueprintSource> = {};

    /** The user's access to the blueprint. Read by default, so nothing grants editing unasked. */
    @observable accessor access: BlueprintAccess = 'read';

    @observable private accessor requestedMode: BlueprintMode = 'run';

    /** The preset the user chose in each group, by group name. Transient. */
    @observableRef accessor activePresets: Record<string, string> = {};

    // Values a widget set in run mode on paths that presets control, by path. Transient.
    @observableRef private accessor transientValues: Record<string, unknown> = {};

    constructor({
        blueprint = null,
        catalog,
        registry,
        dataProvider,
        artifacts = {},
        artifactProvider = null,
        hostContext = null,
        defaultPresentation = null,
        isAnswer = false,
        urlAllowList = [],
        mode = 'run',
        access = 'read'
    }: BlueprintModelConfig) {
        super();
        this.catalog = catalog;
        this.registry = registry;
        this.dataProvider = dataProvider;
        this.artifacts = artifacts;
        this.artifactProvider = artifactProvider;
        this.hostContext = hostContext;
        this.defaultPresentation = defaultPresentation;
        this.isAnswer = isAnswer;
        const badUrl = urlAllowList.find(it => !parseWebUrl(it));
        throwIf(badUrl, `urlAllowList entries must be http or https URLs: '${badUrl}'`);
        this.urlAllowList = urlAllowList;
        this.requestedMode = mode;
        this.access = access;
        if (blueprint) {
            const issues = this.setBlueprint(blueprint);
            throwIf(hasErrors(issues), `Invalid blueprint: ${issues[0]?.message}`);
        }
    }

    /**
     * Check a blueprint against the catalog and registry, without applying it.
     * @param opts - `partialIds`, the elements of a streaming answer still arriving.
     */
    validate(bp: Blueprint, opts: {partialIds?: string[]} = {}): BlueprintIssue[] {
        const {catalog, registry, artifacts, isAnswer} = this;
        // An answer renders degraded, so it may hold the reserved widgets degradeAnswer() places.
        return validateBlueprint(bp, {
            catalog,
            registry,
            artifacts,
            isAnswer,
            allowReserved: isAnswer,
            partialIds: opts.partialIds
        });
    }

    /**
     * Replace the blueprint whole, dropping run-mode changes made to the one before. With errors,
     * nothing changes and the current blueprint stays. A blueprint equal to the current one
     * changes nothing.
     *
     * @returns every issue found, errors and warnings.
     */
    @action
    setBlueprint(bp: Blueprint): BlueprintIssue[] {
        if (isEqual(bp, this.blueprint)) return this.issues;
        const issues = this.validate(bp);
        if (!hasErrors(issues)) {
            this.transientValues = {};
            this.commit(bp, issues);
            this.history = [];
        }
        return issues;
    }

    /**
     * Replace the blueprint in place, as a streaming answer or a program's new state does: keep
     * the history, and the run-mode changes to elements that are still there. With errors,
     * nothing changes. A blueprint equal to the current one changes nothing.
     *
     * @param opts - `partialIds`, the elements of a streaming answer still arriving. `catalog` and
     *      `artifacts`, the datasets and artifacts the blueprint now reads, as an answer meets
     *      artifacts that arrive in its chat.
     * @returns every issue found, errors and warnings.
     */
    @action
    updateBlueprint(
        bp: Blueprint,
        opts: {
            partialIds?: string[];
            catalog?: DataCatalog;
            artifacts?: Record<string, string>;
        } = {}
    ): BlueprintIssue[] {
        const {catalog, artifacts} = opts,
            isNewData =
                (catalog && catalog !== this.catalog) ||
                (artifacts && !isEqual(artifacts, this.artifacts));
        if (catalog) this.catalog = catalog;
        if (artifacts) this.artifacts = artifacts;
        if (!isNewData && isEqual(bp, this.blueprint)) return this.issues;
        const issues = this.validate(bp, opts);
        if (!hasErrors(issues)) {
            this.transientValues = pickBy(this.transientValues, (_, path) =>
                Object.hasOwn(bp.elements ?? {}, path.split('/')[2])
            );
            this.commit(bp, issues);
        }
        return issues;
    }

    /**
     * Return to no blueprint, at version 0, with no history. Closes every source and drops every
     * variable, preset choice and transient change. {@link setBlueprint} opens another from here.
     */
    @action
    clear() {
        Object.values(this.sources).forEach(it => it.destroy());
        this.variables.forEach(it => it.destroy());
        this.blueprint = null;
        this.version = 0;
        this.history = [];
        this.issues = [];
        this.variables = [];
        this.sources = {};
        this.activePresets = {};
        this.transientValues = {};
    }

    /**
     * Apply an edit as one unit, in design mode only. With errors, nothing applies. An edit that changes nothing leaves
     * the version and history alone. An edit written against an older
     * version is refused for now: the slice does not yet merge edits that do not overlap.
     */
    @action
    applyEdit(edit: BlueprintEdit): BlueprintEditResult {
        if (edit.base != null && edit.base !== this.version) {
            return {
                issues: [
                    {
                        code: 'edit.staleBase',
                        severity: 'error',
                        path: '',
                        message: `the edit is based on version ${edit.base}, but the blueprint is at ${this.version}. Read it again.`
                    }
                ]
            };
        }
        const refused = checkEditAllowed(edit.ops, this.mode, this.access);
        if (refused) return {issues: [refused]};
        const {result, issue} = applyOps(this.blueprint ?? {}, edit.ops);
        if (issue) return {issues: [issue]};
        if (isEqual(result, this.blueprint)) return {version: this.version, issues: this.issues};
        const issues = this.validate(result);
        if (hasErrors(issues)) return {issues};
        this.commit(result, issues);
        this.history = [...this.history, {...edit, version: this.version}];
        return {version: this.version, issues};
    }

    /** The catalogs the blueprint reads, as the Architect's tools take them. */
    get catalogs(): DataCatalog[] {
        return [this.catalog];
    }

    /**
     * The blueprint as widgets show it: the definition, with each path that a preset group
     * controls set from the group's active preset, then any transient change made in run mode.
     */
    @computed
    get effective(): Blueprint {
        const {blueprint, transientValues} = this,
            groups = Object.entries(blueprint?.presets ?? {});
        if (!blueprint || (!groups.length && isEmpty(transientValues))) return blueprint;

        const ret = cloneDeep(blueprint);
        groups.forEach(([name, group]) => {
            const item = getOwn(group.items, this.getActivePreset(name));
            group.controls?.forEach(({path}) => {
                const value = valueAt(item?.set, path);
                if (value !== undefined) setAt(ret, path, value);
            });
        });
        Object.entries(transientValues).forEach(([path, value]) => setAt(ret, path, value));
        return ret;
    }

    /** The active preset of a group: the user's choice, or the group's default. */
    getActivePreset(group: string): string {
        const def = getOwn(this.blueprint?.presets, group);
        if (!def) return null;
        return (
            getOwn(this.activePresets, group) ??
            def.default ??
            Object.keys(def.items ?? {})[0] ??
            null
        );
    }

    /** Switch a group to one of its presets. Clears transient changes to the paths it controls. */
    @action
    setPreset(group: string, item: string) {
        this.noteUserAction();
        const def = getOwn(this.blueprint?.presets, group);
        throwIf(!getOwn(def?.items, item), `No preset '${item}' in group '${group}'.`);
        this.activePresets = {...this.activePresets, [group]: item};
        const paths = def.controls.map(it => it.path);
        this.transientValues = omitBy(this.transientValues, (_, path) => paths.includes(path));
    }

    /** The group and active preset that control a path, or null if no preset group does. */
    getPresetControl(path: string): {group: string; item: string} {
        const entry = Object.entries(this.blueprint?.presets ?? {}).find(([, it]) =>
            it.controls?.some(c => c.path === path)
        );
        return entry ? {group: entry[0], item: this.getActivePreset(entry[0])} : null;
    }

    /** Hold a run-mode change a user made in a widget, without editing the blueprint. */
    @action
    setTransientValue(path: string, value: unknown) {
        this.noteUserAction();
        this.transientValues = {...this.transientValues, [path]: value};
    }

    getVariable(name: string): BlueprintVariable {
        return this.variables.find(it => it.name === name) ?? null;
    }

    getSource(name: string): BlueprintSource {
        return getOwn(this.sources, name);
    }

    /**
     * Set a variable that a prompt, an action or the Architect may set. Throws for a value that
     * does not match the variable's type or options.
     * @returns its value once set.
     */
    setVariable(name: string, value: unknown): unknown {
        const v = this.getVariable(name);
        throwIf(!v, `Unknown variable '${name}'.`);
        const problem = checkVariableValue(name, v.decl, value, this.registry);
        throwIf(problem, problem);
        this.noteUserAction();
        v.set(value);
        return v.value;
    }

    /** Restore a variable's default. */
    resetVariable(name: string) {
        this.noteUserAction();
        this.getVariable(name)?.reset();
    }

    /**
     * Publish a widget output, such as a grid's selection. Sets each variable whose `setBy` names
     * the output. An output with a `field` argument takes the value of that field from `value`.
     */
    @action
    setOutput(element: string, output: string, value: unknown) {
        let changed = false;
        this.variables.forEach(v =>
            v.writers.forEach((w, idx) => {
                if (w.kind !== 'output' || w.element !== element || w.output !== output) return;
                const next = w.field ? ((value as any)?.[w.field] ?? null) : value;
                changed = v.setOutputValue(idx, next) || changed;
            })
        );
        // A widget may publish as it loads, so only a change counts as the user acting.
        if (changed) this.noteUserAction();
    }

    /**
     * Run an action, or a list of up to 8 as steps, as a button or a row action does. Every step
     * is checked first, and a step that fails stops the rest. The user sees why.
     *
     * @returns true if every step ran.
     */
    runActionsAsync(
        actions: PlainObject | PlainObject[],
        ctx: ActionRunContext = {}
    ): Promise<boolean> {
        this.noteUserAction();
        return runActionsAsync(this, actions, ctx);
    }

    /** An action's description, with its values as it would run now - for its tooltip. */
    describeAction(action: PlainObject, ctx: ActionRunContext = {}): string {
        return describeAction(this, action, ctx);
    }

    /** A copy of a value with each binding replaced by its variable's current value. */
    resolve(value: unknown): any {
        return resolveBindings(value, name => this.getVariable(name)?.value);
    }

    /** A filter with its bindings resolved, dropping clauses bound to null. Null for none. */
    resolveFilter(filter: unknown): FilterSpec {
        return resolveFilter(filter, name => this.getVariable(name)?.value);
    }

    /** Compute a resolver call, with its arguments resolved. Null if the resolver fails. */
    runResolver(call: ResolverCall): unknown {
        const spec = this.registry.resolvers[call?.resolver];
        if (!spec) return null;
        try {
            return spec.resolve(this.resolve(call.args ?? {})) ?? null;
        } catch (e) {
            this.logError(`Resolver '${call.resolver}' failed`, e);
            return null;
        }
    }

    /** Load every dataset source again, as on a refresh. */
    override async doLoadAsync(loadSpec: LoadSpec) {
        await Promise.all(Object.values(this.sources).map(it => it.reloadAsync(loadSpec)));
    }

    override destroy() {
        Object.values(this.sources).forEach(it => it.destroy());
        this.variables.forEach(it => it.destroy());
        super.destroy();
    }

    //------------------
    // Implementation
    //------------------
    private commit(bp: Blueprint, issues: BlueprintIssue[]) {
        if (!isEqual(bp.presets, this.blueprint?.presets)) {
            this.activePresets = pickBy(
                this.activePresets,
                (item, group) => !!getOwn(getOwn(bp.presets, group)?.items, item)
            );
            this.transientValues = {};
        }
        this.blueprint = bp;
        this.issues = issues;
        this.version++;
        this.syncVariables();
        this.syncSources();
    }

    /** Keep each variable whose declaration did not change, with its value. */
    private syncVariables() {
        const decls = this.blueprint.variables ?? {},
            prev = this.variables;
        this.variables = Object.entries(decls).map(([name, decl]) => {
            const existing = prev.find(it => it.name === name);
            return existing && isEqual(existing.decl, decl)
                ? existing
                : new BlueprintVariable(name, decl, this);
        });
        prev.filter(it => !this.variables.includes(it)).forEach(it => it.destroy());
    }

    /**
     * Keep each source whose Cube still fits its declaration, with its subscription and its
     * widgets' state. A change to its parameters, its filter or its inline rows reloads it in place.
     */
    private syncSources() {
        const decls = this.blueprint.sources ?? {},
            prev = this.sources,
            next: Record<string, BlueprintSource> = {};
        Object.entries(decls).forEach(([name, decl]) => {
            const existing = prev[name];
            next[name] =
                existing && isEqual(existing.builtFor, BlueprintSource.cubeKey(decl))
                    ? existing
                    : new BlueprintSource(name, decl, this);
        });
        Object.values(prev)
            .filter(it => !Object.values(next).includes(it))
            .forEach(it => it.destroy());
        this.sources = next;
    }
}

function hasErrors(issues: BlueprintIssue[]): boolean {
    return issues.some(it => it.severity === 'error');
}
