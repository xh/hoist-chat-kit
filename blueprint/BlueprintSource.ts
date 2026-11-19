import {HoistBase, type LoadSpec, managed, type PlainObject, XH} from '@xh/hoist/core';
import type {CubeFieldSpec, FilterSpec} from '@xh/hoist/data';
import {Cube, type View, WeightedAverageAggregator} from '@xh/hoist/data';
import {action, computed, observable, observableRef, runInAction} from '@xh/hoist/mobx';
import {wait} from '@xh/hoist/promise';
import {
    castArray,
    isArray,
    isEqual,
    isPlainObject,
    isString,
    mapValues,
    pick,
    sortBy,
    uniq,
    uniqWith
} from 'lodash';
import type {Blueprint, BlueprintElement, SourceDecl} from './Blueprint';
import type {
    BlueprintArtifactProvider,
    BlueprintDataProvider,
    BlueprintDataRequest,
    BlueprintDataUpdate
} from './BlueprintDataProvider';
import type {BlueprintRegistry} from './BlueprintRegistry';
import type {DataCatalog, FieldDef} from './DataCatalog';
import {formatValue, resolveFormat} from './impl/formats';
import {getOwn} from './impl/pointer';
import {getWriters} from './validateBlueprint';

/** The parts of a blueprint's runtime a source reads. */
export interface BlueprintSourceContext {
    readonly blueprint: Blueprint;
    /** The blueprint as widgets show it, with active presets applied. */
    readonly effective: Blueprint;
    readonly catalog: DataCatalog;
    readonly registry: BlueprintRegistry;
    readonly dataProvider: BlueprintDataProvider;
    readonly artifacts: Record<string, string>;
    readonly artifactProvider: BlueprintArtifactProvider;
    resolve(value: unknown): any;
    resolveFilter(filter: unknown): FilterSpec;
}

/**
 * A blueprint source at runtime. Holds a Cube with every field of its dataset, which each widget
 * queries with its own view. Merges its widgets' demands into one request. Loads it, or subscribes
 * to it, again when its parameters or filter change, or a widget needs a field it has not loaded.
 */
export class BlueprintSource extends HoistBase {
    readonly name: string;
    /** The fields of the source: its dataset's fields, plus its field instances. */
    readonly fields: Record<string, FieldDef>;

    /** The parts of its declaration the source's Cube was built for - see {@link cubeKey}. */
    readonly builtFor: PlainObject;

    @managed readonly cube: Cube;

    /** True while a required parameter has no value, so the source does not load. */
    @observable accessor isWaiting: boolean = false;

    /** True until the first rows of the current request arrive. */
    @observable accessor isLoading: boolean = false;

    /** True for an artifact with more rows than its provider delivers, which shows none. */
    @observable accessor isTooLarge: boolean = false;

    /** True for an artifact whose rows are no longer available, such as after a reload. */
    @observable accessor isUnavailable: boolean = false;

    @observableRef accessor lastError: unknown = null;

    /** The Views of the source's widgets, each with the fields its widget shows. */
    @observableRef private accessor views: {view: View; fields: () => string[]}[] = [];

    /** The grouping sets whose server values failed to load, with the error. */
    @observableRef accessor aggregatesError: {sets: string[][]; error: unknown} = null;

    private readonly context: BlueprintSourceContext;
    private readonly initialDecl: SourceDecl;
    private unsubscribe: () => void = null;
    private loadCount = 0;
    private loadedRequest: BlueprintDataRequest = null;
    private loadedSets: string[][] = [];
    private pendingSets: string[][] = [];

    constructor(name: string, decl: SourceDecl, context: BlueprintSourceContext) {
        super();
        this.name = name;
        this.initialDecl = decl;
        this.builtFor = BlueprintSource.cubeKey(decl);
        this.context = context;
        this.fields = this.buildFields();
        // An inline source holds its rows from the start, and takes new ones in place.
        this.cube = new Cube({
            fields: Object.values(this.fields).map(toCubeField),
            data: decl.inline ? withRowIds(decl.inline.rows) : [],
            // An inline row's own id may repeat, so each takes one of its own.
            ...(decl.inline ? {idSpec: INLINE_ROW_ID} : {})
        });

        if (decl.inline) {
            this.addReaction({
                track: () => this.decl.inline?.rows,
                run: rows => this.applyUpdateAsync({replace: withRowIds(rows)}),
                equals: 'structural'
            });
        } else if (decl.artifact) {
            this.loadArtifactAsync(decl.artifact);
        } else if (decl.dataset) {
            // Start once the widgets built with the source have registered their Views, so the
            // first request carries their grouping sets.
            wait().then(() => {
                if (this.isDestroyed) return;
                this.addReaction({
                    track: () => this.request,
                    run: req => {
                        if (!this.covers(req)) this.start(req);
                    },
                    equals: 'structural',
                    fireImmediately: true
                });
            });
            this.addReaction({
                track: () => this.groupingSets,
                run: sets => this.loadMissingSets(sets),
                equals: 'structural'
            });
        }
    }

    /**
     * Register a widget's View, so the source fetches server values for its grouping sets while
     * the widget shows a `"server"` field.
     *
     * @param view - the View the widget shows the source through.
     * @param fields - the fields the widget shows, read again as they change.
     * @returns a function that removes the View.
     */
    @action
    addView(view: View, fields: () => string[]): () => void {
        const entry = {view, fields};
        this.views = [...this.views, entry];
        return () => runInAction(() => (this.views = this.views.filter(it => it !== entry)));
    }

    /** The grouping sets that Views showing a `"server"` field read server values for, sorted. */
    @computed
    get groupingSets(): string[][] {
        const isServer = (name: string) => this.fields[name]?.aggregator === 'server',
            sets = this.views
                .filter(it => it.fields().some(isServer))
                .flatMap(it => it.view.suppliedGroupingSets ?? []);
        return sortBy(uniqWith(sets, isEqual), it => `${it.length}:${it.join()}`);
    }

    /** The source as the blueprint now declares it. */
    get decl(): SourceDecl {
        return this.context.blueprint?.sources?.[this.name] ?? this.initialDecl;
    }

    /**
     * The parts of a declaration that fix the source's Cube: a source whose key changes needs a
     * new one. Its parameters and filter only change what it loads.
     */
    static cubeKey(decl: SourceDecl): PlainObject {
        const ret: PlainObject = pick(decl, 'dataset', 'fields', 'artifact');
        if (decl.inline) ret.inline = {fields: decl.inline.fields};
        return ret;
    }

    /**
     * The label of a field of the source. A field instance takes its own `label`, or else its
     * field's label followed by its parameters' current values, each formatted by its kind.
     */
    fieldLabel(name: string): string {
        const field = this.fields[name],
            inst = this.decl.fields?.[name];
        if (!field) return name;
        if (!inst) return field.label ?? name;
        if (inst.label) return inst.label;

        const {catalog, blueprint} = this.context,
            base = catalog.getDataset(this.decl.dataset)?.fields[inst.field],
            values = Object.entries(inst.params ?? {}).map(([pn, pv]) => {
                const def = base?.params?.[pn],
                    value = this.context.resolve(pv);
                if (value == null) return '-';
                if (!def) return String(value);
                const param: FieldDef = {name: pn, type: def.type, kind: def.kind},
                    opts = {precision: 'auto', ...resolveFormat(param, [], {catalog, blueprint})};
                return String(formatValue(value, param, opts, catalog, true));
            });
        return `${base?.label ?? inst.field} (${values.join(', ')})`;
    }

    /** Load the source again, as on a refresh. */
    async reloadAsync(loadSpec?: LoadSpec) {
        if (this.decl.dataset) this.start(this.request, loadSpec);
    }

    /**
     * The request for the source's dataset, with every widget's demand merged, or null while a
     * required parameter has no value.
     */
    @computed
    get request(): BlueprintDataRequest {
        const {decl, context} = this,
            ds = context.catalog.getDataset(decl.dataset);
        if (!ds) return null;

        const params = mapValues(decl.params ?? {}, it => context.resolve(it));
        if (Object.entries(ds.params).some(([k, p]) => p.required && params[k] == null)) {
            return null;
        }

        const fields = this.requestedFields.map(it => {
            const inst = decl.fields?.[it];
            if (!inst) return it;
            return {
                name: it,
                field: inst.field,
                params: context.resolve(inst.params ?? {})
            };
        });

        return {
            dataset: decl.dataset,
            params,
            fields,
            groupBy: this.groupingSets,
            ...(decl.filter ? {filter: context.resolveFilter(decl.filter)} : {})
        };
    }

    /** The names of every field the source's widgets need, with weight fields, sorted. */
    @computed
    private get requestedFields(): string[] {
        const names = uniq([
                ...this.getDemands().flatMap(it => it.fields),
                ...this.getBindingFields()
            ]).filter(it => this.fields[it]),
            weights = names.map(it => weightFieldOf(this.fields[it])).filter(Boolean);
        return uniq([...names, ...weights]).sort();
    }

    override destroy() {
        this.stop();
        super.destroy();
    }

    //------------------
    // Implementation
    //------------------
    /**
     * Each widget's demand. A widget's filter stays unresolved, so that a filter bound to a
     * selection changes no request: {@link getBindingFields} covers the fields it can name.
     */
    private getDemands() {
        const {context} = this;
        return this.getWidgets()
            .map(el =>
                context.registry.widgets[el.component]?.demand?.({
                    ...context.resolve(el.config),
                    filter: el.config.filter
                })
            )
            .filter(Boolean);
    }

    /**
     * Fields that bindings on this source's widgets can read: a `selected` field argument, and the
     * group dimensions of each grid whose selection sets a filter a widget here binds.
     */
    private getBindingFields(): string[] {
        const {context} = this,
            {effective: blueprint} = context,
            elements = blueprint?.elements ?? {},
            variables = blueprint?.variables ?? {},
            ret: string[] = [];

        Object.values(variables).forEach(v =>
            getWriters(v).forEach(w => {
                if (w.field && elements[w.element]?.config?.source === this.name) ret.push(w.field);
            })
        );
        this.getWidgets().forEach(el =>
            boundVariables(el.config.filter).forEach(name =>
                getWriters(variables[name]).forEach(w => {
                    if (w.output !== 'selection') return;
                    const groupBy = context.resolve(elements[w.element]?.config?.groupBy);
                    ret.push(...castArray(groupBy ?? []));
                })
            )
        );
        return ret;
    }

    private getWidgets(): BlueprintElement[] {
        return Object.values(this.context.effective?.elements ?? {}).filter(
            el => el.config?.source === this.name
        );
    }

    /**
     * True if what is loaded already serves a request: the same dataset, parameters and filter,
     * and every field it asks for. Grouping is not part of it, as the provider returns leaf rows.
     */
    private covers(req: BlueprintDataRequest): boolean {
        const loaded = this.loadedRequest;
        if (!req || !loaded) return false;
        const key = (r: BlueprintDataRequest) => pick(r, 'dataset', 'params', 'filter');
        return (
            isEqual(key(req), key(loaded)) &&
            req.fields.every(f => loaded.fields.some(it => isEqual(it, f)))
        );
    }

    @action
    private start(req: BlueprintDataRequest, loadSpec?: LoadSpec) {
        this.stop();
        const loadId = ++this.loadCount,
            isCurrent = () => loadId === this.loadCount && !this.isDestroyed;

        this.loadedRequest = req;
        this.loadedSets = req?.groupBy ?? [];
        this.pendingSets = [];
        this.aggregatesError = null;
        this.isWaiting = !req;
        this.lastError = null;
        if (!req) {
            this.isLoading = false;
            this.cube.clearAsync().catch(e => this.fail(e));
            return;
        }

        this.isLoading = true;
        const {dataProvider} = this.context;
        if (dataProvider.subscribe) {
            this.unsubscribe = dataProvider.subscribe(req, u => {
                if (isCurrent()) this.applyUpdateAsync(u);
            });
        } else {
            dataProvider
                .loadAsync(req, loadSpec)
                .then(
                    ({rows, aggregates}) =>
                        isCurrent() && this.applyUpdateAsync({replace: rows, aggregates})
                )
                .catch(e => isCurrent() && this.fail(e));
        }
    }

    /** Fetch server values for sets the loaded request lacks, or load it again with them. */
    private loadMissingSets(sets: string[][]) {
        const req = this.loadedRequest,
            missing = sets.filter(set => !this.loadedSets.some(it => isEqual(it, set)));
        // A source about to load again takes every set with that load.
        if (!req || !missing.length || !this.covers(this.request)) return;

        const {dataProvider} = this.context;
        if (!dataProvider.loadAggregatesAsync) {
            this.start(this.request);
            return;
        }
        const loadId = this.loadCount,
            isCurrent = () => loadId === this.loadCount && !this.isDestroyed;
        this.loadedSets = [...this.loadedSets, ...missing];
        this.pendingSets = [...this.pendingSets, ...missing];
        const settle = () =>
            (this.pendingSets = this.pendingSets.filter(it => !missing.includes(it)));
        dataProvider
            .loadAggregatesAsync({...req, groupBy: missing})
            .then(({aggregates}) => {
                settle();
                if (!isCurrent()) return;
                runInAction(() => (this.aggregatesError = null));
                return this.cube.updateAggregatesAsync(aggregates);
            })
            .catch(e => {
                settle();
                if (!isCurrent()) return;
                // Only these sets' server values are missing, so the source itself has not failed.
                // Mark them unloaded, to fetch again on the next change of sets or refresh.
                this.loadedSets = this.loadedSets.filter(set => !missing.includes(set));
                runInAction(() => (this.aggregatesError = {sets: missing, error: e}));
                this.logWarn(`Source '${this.name}' failed to load server values`, missing, e);
                XH.warningToast(
                    `Some server values could not load, and show blank: ${e?.message ?? e}`
                );
            });
    }

    private stop() {
        this.unsubscribe?.();
        this.unsubscribe = null;
    }

    private async applyUpdateAsync({
        replace,
        add,
        update,
        remove,
        aggregates
    }: BlueprintDataUpdate) {
        try {
            if (replace) {
                await this.cube.loadDataAsync(replace, {}, aggregates ?? null);
                runInAction(() => (this.isLoading = false));
                // A snapshot replaces every supplied value, but carries only the sets subscribed
                // with, so fetch any others again, unless a fetch for them is still on its way.
                this.loadedSets = [...(this.loadedRequest?.groupBy ?? []), ...this.pendingSets];
                this.loadMissingSets(this.groupingSets);
            } else if (add || update || remove) {
                await this.cube.updateDataAsync({add, update, remove}, {}, aggregates ?? null);
            } else if (aggregates) {
                await this.cube.updateAggregatesAsync(aggregates);
            }
        } catch (e) {
            this.fail(e);
        }
    }

    @action
    private async loadArtifactAsync(id: string) {
        const {artifactProvider} = this.context;
        if (!artifactProvider) {
            this.fail(new Error(`No artifact provider to load artifact '${id}'`));
            return;
        }
        runInAction(() => (this.isLoading = true));
        try {
            const result = await artifactProvider.loadArtifactAsync(id);
            if (this.isDestroyed) return;
            if (!result) {
                runInAction(() => {
                    this.isUnavailable = true;
                    this.isLoading = false;
                });
                return;
            }
            const {rows, totalRows} = result;
            // Part of a result would give wrong totals, so a result too large to deliver shows none.
            if (totalRows > rows.length) {
                runInAction(() => {
                    this.isTooLarge = true;
                    this.isLoading = false;
                });
                return;
            }
            await this.applyUpdateAsync({replace: rows.map((it, idx) => ({id: idx, ...it}))});
        } catch (e) {
            if (!this.isDestroyed) this.fail(e);
        }
    }

    private fail(e: unknown) {
        this.isLoading = false;
        this.lastError = e;
        this.logError(`Source '${this.name}' failed to load`, e);
    }

    private buildFields(): Record<string, FieldDef> {
        const {initialDecl: decl, context} = this;
        if (decl.inline) {
            return Object.fromEntries(decl.inline.fields.map(it => [it.name, it as FieldDef]));
        }
        const ds = context.catalog.getDataset(
            decl.artifact ? getOwn(context.artifacts, decl.artifact) : decl.dataset
        );
        if (!ds) return {};
        const ret = {...ds.fields};
        Object.entries(decl.fields ?? {}).forEach(([name, inst]) => {
            const base = ds.fields[inst.field];
            if (base) ret[name] = {...base, name};
        });
        return ret;
    }
}

const INLINE_ROW_ID = 'xhInlineRowId';

function withRowIds(rows: PlainObject[]): PlainObject[] {
    return (rows ?? []).map((it, idx) => ({...it, [INLINE_ROW_ID]: idx}));
}

function weightFieldOf(f: FieldDef): string {
    return isPlainObject(f.aggregator) ? (f.aggregator as PlainObject).weightField : null;
}

/**
 * A catalog field as a Cube field. A number with no aggregator does not roll up, so group rows show
 * it blank, and any other type shows its value where it is unique. A `"server"` measure shows the
 * values the server supplies for each group.
 */
function toCubeField(f: FieldDef): CubeFieldSpec {
    const {name, label, type, isDimension, parentDimension, isLeafDimension} = f;
    return {
        name,
        displayName: label,
        type: type as any,
        isDimension: !!isDimension,
        parentDimension,
        isLeafDimension,
        aggregator: toAggregator(f)
    };
}

function toAggregator(f: FieldDef): CubeFieldSpec['aggregator'] {
    const {aggregator: agg, type, isDimension} = f;
    if (agg === 'server') return 'SUPPLIED';
    if (isString(agg)) return agg as CubeFieldSpec['aggregator'];
    if (isPlainObject(agg)) {
        const {type: aggType, weightField, absolute} = agg as PlainObject;
        return aggType === 'weightedAverage'
            ? new WeightedAverageAggregator(weightField, {absolute})
            : null;
    }
    if (isDimension) return null;
    return type === 'number' || type === 'int' ? null : 'UNIQUE';
}

/** The names of the variables a filter binds, at any depth. */
function boundVariables(filter: unknown): string[] {
    if (isArray(filter)) return filter.flatMap(boundVariables);
    if (!isPlainObject(filter)) return [];
    const f = filter as PlainObject;
    if (isString(f.$var)) return [f.$var];
    return [...boundVariables(f.filters), ...boundVariables(f.value)];
}
