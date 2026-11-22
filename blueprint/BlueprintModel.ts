import {HoistModel, type LoadSpec, type PlainObject, XH} from '@xh/hoist/core';
import type {FilterSpec} from '@xh/hoist/data';
import {action, computed, observable, observableRef} from '@xh/hoist/mobx';
import {throwIf} from '@xh/hoist/utils/js';
import {cloneDeep, dropRight, isEmpty, isEqual, last, omitBy, pickBy, takeRight} from 'lodash';
import type {
    Blueprint,
    BlueprintEdit,
    BlueprintIssue,
    BlueprintOp,
    ResolverCall
} from './Blueprint';
import type {BlueprintArtifactProvider, BlueprintDataProvider} from './BlueprintDataProvider';
import type {BlueprintRegistry} from './BlueprintRegistry';
import {BlueprintSource} from './BlueprintSource';
import {BlueprintVariable} from './BlueprintVariable';
import type {DataCatalog} from './DataCatalog';
import {applyOps} from './applyOps';
import type {BlueprintLinkState} from './BlueprintLink';
import type {BlueprintRepository} from './repository/BlueprintRepository';
import {diffOps} from './diffOps';
import {parseWebUrl} from '../impl/UrlUtils';
import {
    actionBlockedReason,
    type ActionRunContext,
    describeAction,
    runActionsAsync
} from './impl/actions';
import {upgradeSlots} from './impl/elements';
import {resolveBindings, resolveFilter} from './impl/bindings';
import {fillTemplate} from './impl/template';
import {formatValue, resolveFormat} from './impl/formats';
import {variableText} from './impl/variableText';
import {getOwn, getAt as valueAt, setAt} from './impl/pointer';
import {validateBlueprint} from './validateBlueprint';
import type {BlueprintAccess, BlueprintMode} from './Blueprint';
import {checkEditAllowed} from './impl/access';
import {boundPeriodCalendar, checkVariableValue} from './impl/variableValues';

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
    /** True for a blueprint opened by another's `openBlueprint`, which cannot open one in turn. */
    isDrillIn?: boolean;
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

/** A blueprint an `openBlueprint` action asked to open, with its values as link params. */
export interface BlueprintDrillIn {
    id: string;
    as: 'dialog' | 'popover';
    /** The title to show, or null for the target's name. */
    title: string;
    /** The target's id and values, as a link to it carries them. */
    params: Record<string, string | string[]>;
    /** The control a popover anchors to. Absent, and it opens as a dialog. */
    anchor?: string;
    /** The variables whose values had no link form, so the target did not get them. */
    dropped?: string[];
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
    readonly isDrillIn: boolean;
    readonly urlAllowList: string[];

    /**
     * Where `openBlueprint` opens its targets: the repository of the document open, which a
     * `BlueprintDocumentModel` sets. Null, and the action cannot run.
     */
    drillInRepository: BlueprintRepository = null;

    /**
     * Select what an issue names, for a refusal's Show action: set by a view with a designer.
     * Null, and a refusal shows no Show action.
     */
    revealIssue: (issue: BlueprintIssue) => void = null;

    /** The blueprint an `openBlueprint` action asked to open, which the view draws, or null. */
    @observableRef accessor drillIn: BlueprintDrillIn = null;

    /** The current blueprint. Always valid: it has no errors. */
    @observableRef accessor blueprint: Blueprint = null;

    /** Goes up with each change to the blueprint. */
    @observable accessor version: number = 0;

    /** Each edit applied since the blueprint was last replaced whole, oldest first. */
    @observableRef accessor history: (BlueprintEdit & {version: number})[] = [];

    // The edits that undo and redo act on, latest last, each with the blueprint around it.
    @observableRef private accessor undoStack: UndoEntry[] = [];
    @observableRef private accessor redoStack: UndoEntry[] = [];

    /**
     * The user's mode: design only with write access, else run. In run mode, a change a user makes
     * in a widget, such as a sort, stays transient, as personalizations do not exist yet, and every
     * edit is refused. In design mode, a widget's change is an edit.
     */
    /**
     * The presentation an element draws in: the one its config names, else the model's
     * `defaultPresentation` if its widget has it and draws all of the config, else `panel`. A
     * config that sets a key the default presentation `ignores` draws as `panel`. Null for no
     * such element.
     */
    presentationOf(id: string): string {
        const el = getOwn(this.blueprint?.elements, id);
        if (!el) return null;
        const config: PlainObject = el.config ?? {};
        if (config.presentation) return config.presentation;
        const drawn = getOwn(this.registry.widgets, el.component)?.presentations?.find(
            it => it.name === this.defaultPresentation
        );
        if (!drawn) return 'panel';
        return drawn.ignores?.some(it => isSetAt(config, it.split('.'))) ? 'panel' : drawn.name;
    }

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
        isDrillIn = false,
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
        this.isDrillIn = isDrillIn;
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
    setBlueprint(blueprint: Blueprint): BlueprintIssue[] {
        const bp = upgradeSlots(blueprint);
        if (isEqual(bp, this.blueprint)) return this.issues;
        const issues = this.validate(bp);
        if (!hasErrors(issues)) {
            this.transientValues = {};
            this.commit(bp, issues);
            this.history = [];
            this.undoStack = [];
            this.redoStack = [];
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
        this.undoStack = [];
        this.redoStack = [];
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
        return this.commitEdit(edit, entry => {
            this.undoStack = takeRight([...this.undoStack, entry], MAX_UNDO);
            this.redoStack = [];
        });
    }

    /**
     * Apply an edit that continues the latest one, in a continuous gesture such as nudging a cell:
     * the two become one history entry and one undo step. With any change since the latest edit,
     * such as an undo, it applies as an edit of its own, as it does when either edit renames an id.
     */
    @action
    foldEdit(edit: BlueprintEdit): BlueprintEditResult {
        const prev = last(this.undoStack);
        if (
            !prev ||
            prev.version !== this.version ||
            [...edit.ops, ...prev.ops].some(it => it.op === 'renameId') ||
            last(this.history)?.version !== this.version
        ) {
            return this.applyEdit(edit);
        }
        return this.commitEdit(edit, entry => {
            const merged = {...entry, before: prev.before, ops: diffOps(prev.before, entry.after)};
            this.undoStack = [...dropRight(this.undoStack), merged];
            this.redoStack = [];
            // The edit just committed replaces the one it continues.
            this.history = [...this.history.slice(0, -2), {...last(this.history), ops: merged.ops}];
        });
    }

    /** True if an edit can be undone now: there is one, and the user may edit. See {@link undo}. */
    get canUndo(): boolean {
        return this.mode === 'design' && this.undoStack.length > 0;
    }

    /** True if an undone edit can be applied again now. See {@link redo}. */
    get canRedo(): boolean {
        return this.mode === 'design' && this.redoStack.length > 0;
    }

    /** The description of the edit {@link undo} would revert, or null. */
    get undoDescription(): string {
        return last(this.undoStack)?.description ?? null;
    }

    /** The description of the edit {@link redo} would apply again, or null. */
    get redoDescription(): string {
        return last(this.redoStack)?.description ?? null;
    }

    /**
     * Revert the latest edit not yet undone, as a new edit, `Undo: <description>`: it takes a new
     * version and a history entry, and mode, access and validation apply as for any edit. The last
     * 50 edits can be undone, in turn.
     */
    @action
    undo(): BlueprintEditResult {
        const entry = last(this.undoStack);
        if (!entry) return nothingTo('undo');
        return this.commitEdit(
            {
                author: 'user',
                description: `Undo: ${entry.description}`,
                undoes: entry.version,
                ops: diffOps(this.blueprint ?? {}, entry.before ?? {})
            },
            () => {
                this.undoStack = dropRight(this.undoStack);
                this.redoStack = [...this.redoStack, entry];
            }
        );
    }

    /**
     * Apply the latest undone edit again, as a new edit, `Redo: <description>`. A new edit that
     * is neither an undo nor a redo leaves nothing to redo.
     */
    @action
    redo(): BlueprintEditResult {
        const entry = last(this.redoStack);
        if (!entry) return nothingTo('redo');
        return this.commitEdit(
            {
                author: 'user',
                description: `Redo: ${entry.description}`,
                redoes: entry.version,
                ops: entry.ops
            },
            done => {
                this.redoStack = dropRight(this.redoStack);
                this.undoStack = takeRight(
                    [
                        ...this.undoStack,
                        {...entry, version: done.version, before: done.before, after: done.after}
                    ],
                    MAX_UNDO
                );
            }
        );
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
        this.choosePreset(group, item);
    }

    /**
     * Apply a link's presets, then its values, as transient state: not a user action, and never
     * saved. Call it as the blueprint opens, before its sources start, so each loads once.
     * See {@link parseBlueprintLink}.
     *
     * @returns the link's problems, with any value that no longer fits once its presets apply.
     */
    @action
    applyLinkState(state: BlueprintLinkState): string[] {
        const problems = [...state.problems];
        Object.entries(state.presets).forEach(([group, item]) => this.choosePreset(group, item));
        Object.entries(state.values).forEach(([name, value]) => {
            const v = this.getVariable(name),
                problem = v?.isSettable
                    ? checkVariableValue(name, v.decl, value, this.registry)
                    : `A link cannot set '${name}'.`;
            if (problem) {
                problems.push(problem);
            } else {
                v.set(value);
            }
        });
        return problems;
    }

    /** The group and active preset that control a path, or null if no preset group does. */
    getPresetControl(path: string): {group: string; item: string} {
        const entry = Object.entries(this.blueprint?.presets ?? {}).find(([, it]) =>
            it.controls?.some(c => c.path === path)
        );
        return entry ? {group: entry[0], item: this.getActivePreset(entry[0])} : null;
    }

    /**
     * Where an edit to a path goes: in design mode, a path that presets control goes to the
     * active preset's value for it. Any other path, or any path in run mode, is itself.
     */
    writePathFor(path: string): string {
        const control = this.getPresetControl(path);
        if (!control || this.mode === 'run') return path;
        return `/presets/${control.group}/items/${control.item}/set${path}`;
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

    /** Why an action, or a step of a list, cannot run now, or null if it can. */
    actionBlockedReason(action: PlainObject | PlainObject[], ctx: ActionRunContext = {}): string {
        return actionBlockedReason(this, action, ctx);
    }

    /** An action's description, with its values as it would run now - for its tooltip. */
    describeAction(action: PlainObject, ctx: ActionRunContext = {}): string {
        return describeAction(this, action, ctx);
    }

    /** Show why an edit was refused, with a Show action that selects what it names, where it can. */
    showRefusal(issue: BlueprintIssue) {
        const {revealIssue} = this;
        XH.dangerToast({
            message: issue.message,
            ...(revealIssue && issue.path
                ? {
                      actionButtonProps: {text: 'Show', onClick: () => revealIssue(issue)},
                      timeout: 8000
                  }
                : {})
        });
    }

    /** A dataset field's value as its catalog format shows it, as plain text, or null. */
    formatFieldValue(dataset: string, field: string, value: unknown): string {
        const catalog = this.catalogs.find(it => it.getDataset(dataset)),
            def = catalog?.getDataset(dataset)?.fields[field];
        if (!def || value == null) return null;
        const opts = resolveFormat(def, [], {catalog, blueprint: this.blueprint}),
            ret = formatValue(value, def, opts, catalog, true);
        return typeof ret === 'string' ? ret.replace(/<[^>]*>/g, '') : null;
    }

    /** Ask the view to open a blueprint as a drill-in, as `openBlueprint` does. */
    @action
    openDrillIn(drillIn: BlueprintDrillIn) {
        this.drillIn = drillIn;
    }

    /** Close the drill-in open, if any. */
    @action
    closeDrillIn() {
        this.drillIn = null;
    }

    /** A copy of a value with each binding replaced by its variable's current value. */
    resolve(value: unknown): any {
        return resolveBindings(value, name => this.getVariable(name)?.value);
    }

    /**
     * A title with its binding resolved, and each `{variable}` it reads filled as plain text, such
     * as "P&L for {fund}". A reference to anything but a variable fills as empty.
     */
    resolveTitle(value: unknown): string {
        // A bound value shows as it is, never read as a template.
        if (typeof value !== 'string') return this.resolve(value) ?? null;
        return this.fillVariables(value);
    }

    /** A filter with its bindings resolved, dropping clauses bound to null. Null for none. */
    resolveFilter(filter: unknown): FilterSpec {
        return resolveFilter(filter, name => this.getVariable(name)?.value);
    }

    /** A title with each `{variable}` it reads filled as plain text, cut to 200 characters. */
    fillVariables(text: string): string {
        if (!text.includes('{')) return text;
        const ret = fillTemplate(text, ({source, name}) => {
            const variable = source ? null : this.getVariable(name);
            return variable ? variableText(variable.value, variable.decl.type) : '';
        });
        return ret.length > MAX_TITLE ? `${ret.slice(0, MAX_TITLE - 1)}…` : ret;
    }

    /** The distinct values of a field over a source's loaded rows, sorted. Empty until it loads. */
    sourceValues(source: string, field: string): unknown[] {
        return this.getSource(source)?.fieldValues(field) ?? [];
    }

    /** Compute a resolver call, with its arguments resolved. Null if the resolver fails. */
    runResolver(call: ResolverCall): unknown {
        const spec = this.registry.resolvers[call?.resolver];
        if (!spec) return null;
        try {
            const args = this.resolve(call.args ?? {}),
                calendar = boundPeriodCalendar(call.args, this.blueprint?.variables);
            if (calendar && args.calendar == null) args.calendar = calendar;
            return spec.resolve(args, {registry: this.registry}) ?? null;
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
    private choosePreset(group: string, item: string) {
        const def = getOwn(this.blueprint?.presets, group);
        throwIf(!getOwn(def?.items, item), `No preset '${item}' in group '${group}'.`);
        this.activePresets = {...this.activePresets, [group]: item};
        const paths = def.controls.map(it => it.path);
        this.transientValues = omitBy(this.transientValues, (_, path) => paths.includes(path));
        if (paths.some(it => it.startsWith('/variables/'))) this.syncVariables();
    }

    // Apply an edit, and on success, hand `onDone` what an undo of it needs.
    private commitEdit(
        edit: BlueprintEdit,
        onDone: (entry: UndoEntry) => void
    ): BlueprintEditResult {
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
        const before = this.blueprint;
        this.commit(result, issues);
        this.history = [...this.history, {...edit, version: this.version}];
        onDone({
            author: edit.author,
            description: edit.description ?? 'Edit',
            ops: edit.ops,
            version: this.version,
            before,
            after: result
        });
        return {version: this.version, issues};
    }

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

    /**
     * Keep each variable whose declaration did not change, with its value. A declaration is as
     * the active presets make it, as a preset can set a variable's default.
     */
    private syncVariables() {
        const decls = this.effective?.variables ?? {},
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

// A config value that asks for something: not absent, and not an empty list.
function isSet(value: unknown): boolean {
    return value != null && !(Array.isArray(value) && value.length === 0);
}

// True if a config sets the value at a path of keys, where `*` matches any key.
function isSetAt(value: unknown, path: string[]): boolean {
    if (!path.length) return isSet(value);
    if (value == null || typeof value !== 'object') return false;
    const [key, ...rest] = path,
        values = key === '*' ? Object.values(value) : [getOwn(value as PlainObject, key)];
    return values.some(it => isSetAt(it, rest));
}

// An edit as undo and redo keep it, with the blueprint from before and after it.
interface UndoEntry {
    author: string;
    description: string;
    ops: BlueprintOp[];
    /** The version the edit made, which an undo or redo of it names. */
    version: number;
    before: Blueprint;
    after: Blueprint;
}

// Undo keeps the blueprint around each of the last edits, so memory stays flat.
const MAX_UNDO = 50;

function nothingTo(action: 'undo' | 'redo'): BlueprintEditResult {
    return {
        issues: [
            {
                code: action === 'undo' ? 'edit.nothingToUndo' : 'edit.nothingToRedo',
                severity: 'error',
                path: '',
                message: `There is no edit to ${action}.`
            }
        ]
    };
}

// The longest a filled title gets, as a variable's value may be long.
const MAX_TITLE = 200;
