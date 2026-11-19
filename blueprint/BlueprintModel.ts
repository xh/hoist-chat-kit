import {HoistModel, type LoadSpec} from '@xh/hoist/core';
import type {FilterSpec} from '@xh/hoist/data';
import {action, observable, observableRef} from '@xh/hoist/mobx';
import {throwIf} from '@xh/hoist/utils/js';
import {isEqual} from 'lodash';
import type {Blueprint, BlueprintEdit, BlueprintIssue, ResolverCall} from './Blueprint';
import type {BlueprintDataProvider} from './BlueprintDataProvider';
import type {BlueprintRegistry} from './BlueprintRegistry';
import {BlueprintSource} from './BlueprintSource';
import {BlueprintVariable} from './BlueprintVariable';
import type {DataCatalog} from './DataCatalog';
import {applyOps} from './applyOps';
import {resolveBindings, resolveFilter} from './impl/bindings';
import {validateBlueprint} from './validateBlueprint';

export interface BlueprintModelConfig {
    /** The blueprint to open. Default none. Throws if it has errors. */
    blueprint?: Blueprint;
    catalog: DataCatalog;
    registry: BlueprintRegistry;
    dataProvider: BlueprintDataProvider;
    /** The dataset behind each artifact a chat answer can name, keyed by artifact ID. */
    artifacts?: Record<string, string>;
    /** True for a chat answer, which may hold literal parameters, artifacts and inline sources. */
    isAnswer?: boolean;
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
    readonly catalog: DataCatalog;
    readonly registry: BlueprintRegistry;
    readonly dataProvider: BlueprintDataProvider;
    readonly artifacts: Record<string, string>;
    readonly isAnswer: boolean;

    /** The current blueprint. Always valid: it has no errors. */
    @observableRef accessor blueprint: Blueprint = null;

    /** Goes up with each change to the blueprint. */
    @observable accessor version: number = 0;

    /** Each edit applied since the blueprint was last replaced whole, oldest first. */
    @observableRef accessor history: (BlueprintEdit & {version: number})[] = [];

    /** The current blueprint's warnings. */
    @observableRef accessor issues: BlueprintIssue[] = [];

    /** Each variable, in declaration order. */
    @observableRef accessor variables: BlueprintVariable[] = [];

    /** Each source, by name. */
    @observableRef accessor sources: Record<string, BlueprintSource> = {};

    constructor({
        blueprint = null,
        catalog,
        registry,
        dataProvider,
        artifacts = {},
        isAnswer = false
    }: BlueprintModelConfig) {
        super();
        this.catalog = catalog;
        this.registry = registry;
        this.dataProvider = dataProvider;
        this.artifacts = artifacts;
        this.isAnswer = isAnswer;
        if (blueprint) {
            const issues = this.setBlueprint(blueprint);
            throwIf(hasErrors(issues), `Invalid blueprint: ${issues[0]?.message}`);
        }
    }

    /** Check a blueprint against the catalog and registry, without applying it. */
    validate(bp: Blueprint): BlueprintIssue[] {
        const {catalog, registry, artifacts, isAnswer} = this;
        return validateBlueprint(bp, {catalog, registry, artifacts, isAnswer});
    }

    /**
     * Replace the blueprint whole. With errors, nothing changes and the current blueprint stays. A
     * blueprint equal to the current one changes nothing.
     *
     * @returns every issue found, errors and warnings.
     */
    @action
    setBlueprint(bp: Blueprint): BlueprintIssue[] {
        if (isEqual(bp, this.blueprint)) return this.issues;
        const issues = this.validate(bp);
        if (!hasErrors(issues)) {
            this.commit(bp, issues);
            this.history = [];
        }
        return issues;
    }

    /**
     * Apply an edit as one unit. With errors, nothing applies. An edit that changes nothing leaves
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
        const {result, issue} = applyOps(this.blueprint ?? {}, edit.ops);
        if (issue) return {issues: [issue]};
        if (isEqual(result, this.blueprint)) return {version: this.version, issues: this.issues};
        const issues = this.validate(result);
        if (hasErrors(issues)) return {issues};
        this.commit(result, issues);
        this.history = [...this.history, {...edit, version: this.version}];
        return {version: this.version, issues};
    }

    getVariable(name: string): BlueprintVariable {
        return this.variables.find(it => it.name === name) ?? null;
    }

    getSource(name: string): BlueprintSource {
        return this.sources[name] ?? null;
    }

    /** Set a variable that a prompt, an action or the Architect may set. */
    setVariable(name: string, value: unknown) {
        const v = this.getVariable(name);
        throwIf(!v, `Unknown variable '${name}'.`);
        v.set(value);
    }

    /** Restore a variable's default. */
    resetVariable(name: string) {
        this.getVariable(name)?.reset();
    }

    /**
     * Publish a widget output, such as a grid's selection. Sets each variable whose `setBy` names
     * the output. An output with a `field` argument takes the value of that field from `value`.
     */
    @action
    setOutput(element: string, output: string, value: unknown) {
        this.variables.forEach(v =>
            v.writers.forEach((w, idx) => {
                if (w.kind !== 'output' || w.element !== element || w.output !== output) return;
                v.setOutputValue(idx, w.field ? ((value as any)?.[w.field] ?? null) : value);
            })
        );
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
     * widgets' state. A change to its parameters or filter reloads it in place.
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
