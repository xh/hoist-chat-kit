import type {PlainObject} from '@xh/hoist/core';
import {castArray, isArray, isEmpty, isPlainObject, isString, pickBy, uniq} from 'lodash';
import type {Blueprint, BlueprintEdit, BlueprintIssue, BlueprintOp} from '../Blueprint';
import type {BlueprintDataProvider} from '../BlueprintDataProvider';
import type {BlueprintAccess, BlueprintMode} from '../Blueprint';
import type {BlueprintRegistry} from '../BlueprintRegistry';
import type {DataCatalog, DatasetDef, FieldDef} from '../DataCatalog';
import type {BlueprintRepository, BlueprintSummary} from '../repository/BlueprintRepository';
import {isLinkSettableType} from '../impl/linkParams';
import {applyOps} from '../applyOps';
import {withDefaultBindingsImplied} from '../impl/bindable';
import {checkEditAllowed} from '../impl/access';
import {filterFields} from '../impl/bindings';
import {checkFilter} from '../impl/configSchema';
import {fieldUsages} from '../usages';
import {isIncomplete, isSettableFromOutside} from '../validateBlueprint';
import {getAt, getOwn} from '../impl/pointer';
import {queryRows} from '../impl/queryRows';
import {summaryOf} from './architectPrompt';
import {normalizeToolInput} from './toolSchemas';

/**
 * What the Architect's tools work on: a blueprint, the edits that change it, and the catalogs and
 * registry it is checked against. A `BlueprintModel` is one. A target without `setVariable` or a
 * data provider offers no tools that need them.
 */
/** The collections of a registry that the Architect reads. */
type RegistryCollection = 'widgets' | 'variableTypes' | 'resolvers' | 'actions' | 'renderers';

export interface ArchitectTarget {
    readonly blueprint: Blueprint;
    readonly version: number;
    readonly catalogs: DataCatalog[];
    readonly registry: Pick<BlueprintRegistry, RegistryCollection>;
    /** The dataset behind each artifact that `query_dataset` returned, keyed by artifact ID. */
    readonly artifacts: Record<string, string>;
    /** The user's mode and access, which the edit tools enforce. */
    readonly mode: BlueprintMode;
    readonly access: BlueprintAccess;
    readonly dataProvider?: BlueprintDataProvider;
    /** Each variable's current value. */
    readonly variables?: {name: string; value: unknown}[];
    applyEdit(edit: BlueprintEdit): {version?: number; issues: BlueprintIssue[]};
    /** Check a blueprint. `strict` counts incomplete config as an error, as for the Architect. */
    validate(bp: Blueprint, opts?: {strict?: boolean}): BlueprintIssue[];
    /** Switch the user's mode. Design mode takes effect only with write access. */
    setMode?(mode: BlueprintMode): void;
    /** Set a variable that a prompt, an action or the Architect may set, and return its value. */
    setVariable?(name: string, value: unknown): unknown;
    /** The repository `openBlueprint` opens from, which `list_blueprints` lists. */
    readonly drillInRepository?: BlueprintRepository;
    /**
     * A field's value as its catalog format shows it, such as `982.2m`, for the model to quote.
     * Null for a value with no such text. Without it, results carry raw values only.
     */
    formatFieldValue?(dataset: string, field: string, value: unknown): string;
}

/**
 * A query's result, as the chat keeps it with the reply: its columns, its size, and the dataset
 * and request that give its rows. The rows stay out, so the thread stays small, and an answer
 * that reads the artifact runs the request again - see `runDatasetQueryAsync()`.
 */
export interface ArchitectArtifact {
    id: string;
    columns: {name: string; label?: string; type: string}[];
    totalRows: number;
    metadata: {dataset: string; request: PlainObject};
}

/** One of the Architect's tools: its spec for the model, and how it runs against a target. */
export interface ArchitectToolSpec {
    name: string;
    description: string;
    parameters: PlainObject;
    /** True if a target can run the tool. Default true. */
    isAvailable?: (target: ArchitectTarget) => boolean;
    /** Run the tool. Throws for a call the model should fix, with a message that says how. */
    run: (input: PlainObject, target: ArchitectTarget, ctx?: ArchitectToolContext) => unknown;
}

/** What a tool may use beyond its target, such as the chat that runs it. */
export interface ArchitectToolContext {
    /** Keep a query's result as an artifact of the reply, with the rows the model saw. */
    addArtifact?(artifact: ArchitectArtifact, rows: PlainObject[]): void;
    /**
     * The registry of chat answers, where the Architect writes them: the app's entries, plus the
     * chat's components and actions.
     */
    answerRegistry?: Pick<BlueprintRegistry, RegistryCollection>;
}

/** The Architect's tools a target can run. */
export function availableArchitectTools(target: ArchitectTarget): ArchitectToolSpec[] {
    return ARCHITECT_TOOLS.filter(it => it.isAvailable?.(target) ?? true);
}

/**
 * Every Architect tool, as the spec's table lists them. Each normalizes its input before it runs -
 * see {@link normalizeToolInput}.
 */
export const ARCHITECT_TOOLS: ArchitectToolSpec[] = (
    [
        {
            name: 'read_blueprint',
            description:
                'Read the blueprint being edited, or only the subtrees at the given JSON Pointer paths. Returns its version, which edit_blueprint takes as base.',
            parameters: {
                type: 'object',
                properties: {paths: {type: 'array', items: {type: 'string'}}}
            },
            run: (input, {blueprint, version}) => {
                if (!input?.paths?.length) return {version, blueprint};
                const parts = Object.fromEntries(
                    input.paths.map((p: string) => [p, getAt(blueprint, p) ?? null])
                );
                return {version, parts};
            }
        },
        {
            name: 'describe_catalog',
            description:
                'Describe the Data Catalog. With no dataset, lists every dataset with its parameters and field categories. With a dataset, lists its fields, optionally narrowed by category or a search term matched against names, labels and guidance.',
            parameters: {
                type: 'object',
                properties: {
                    dataset: {type: 'string'},
                    category: {type: 'string'},
                    search: {type: 'string'}
                }
            },
            run: (input, {catalogs}) => {
                if (!input?.dataset) {
                    return catalogs.flatMap(cat =>
                        modelDatasets(cat).map(d => ({
                            dataset: d.name,
                            catalog: cat.json.label,
                            label: d.label,
                            guidance: d.guidance ?? d.description,
                            params: d.params,
                            ...(d.key ? {key: d.key} : {}),
                            modelAccess: cat.modelAccessOf(d.name),
                            fieldCount: modelFields(cat, d).length,
                            categories: uniq(
                                modelFields(cat, d).map(f => JSON.stringify(f.category ?? null))
                            )
                                .map(c => JSON.parse(c))
                                .filter(Boolean)
                        }))
                    );
                }
                const {cat, ds: d} = findModelDataset(catalogs, input.dataset);
                if (!d) throw new Error(`unknown dataset '${input.dataset}'`);
                const access = cat.modelAccessOf(d.name),
                    q = String(input.search ?? '').toLowerCase(),
                    fields = modelFields(cat, d).filter(f => {
                        const c = castArray(f.category ?? []).join(' > ');
                        if (
                            input.category &&
                            !c.toLowerCase().includes(String(input.category).toLowerCase())
                        ) {
                            return false;
                        }
                        return (
                            !q ||
                            [f.name, f.label, f.guidance, f.description]
                                .join(' ')
                                .toLowerCase()
                                .includes(q)
                        );
                    });
                return {
                    dataset: d.name,
                    params: d.params,
                    ...(d.key ? {key: d.key} : {}),
                    modelAccess: access,
                    kinds: cat.kinds,
                    formats: cat.formats,
                    fields: fields.map(f => ({
                        name: f.name,
                        label: f.label,
                        type: f.type,
                        kind: f.kind,
                        isDimension: f.isDimension,
                        parentDimension: f.parentDimension,
                        aggregator: f.aggregator,
                        params: f.params,
                        category: f.category,
                        guidance: f.guidance ?? f.description,
                        deprecated: f.deprecated,
                        replacedBy: f.replacedBy,
                        renderer: f.renderer,
                        ...(cat.modelAccessOf(d.name, f.name) !== access
                            ? {modelAccess: cat.modelAccessOf(d.name, f.name)}
                            : {})
                    }))
                };
            }
        },
        {
            name: 'describe_registry',
            description:
                "Describe what the app provides in code. kind is widget, variableType, resolver, action or renderer. With names, or a widget category, returns each full spec, including a widget's guidance, config schema, outputs, value, preset paths, sizes and example. With neither, lists every entry in one line. Where chat answers have entries of their own, each entry says where it is allowed: dashboards, answers or both.",
            parameters: {
                type: 'object',
                required: ['kind'],
                properties: {
                    kind: {enum: ['widget', 'variableType', 'resolver', 'action', 'renderer']},
                    names: {type: 'array', items: {type: 'string'}},
                    category: {enum: ['container', 'layout', 'content', 'data', 'input', 'action']}
                }
            },
            run: (input, {registry}, ctx) => {
                const coll = REGISTRY_KINDS[input?.kind];
                if (!coll)
                    throw new Error(
                        'kind must be widget, variableType, resolver, action or renderer'
                    );
                const visible = (it: PlainObject) => !it.reserved,
                    ofHost: Record<string, PlainObject> = pickBy(registry[coll], visible),
                    ofAnswers: Record<string, PlainObject> = ctx?.answerRegistry
                        ? pickBy(ctx.answerRegistry[coll], visible)
                        : null,
                    // The host's entry where both have one, as edits to the blueprint check against it.
                    entries = {...ofAnswers, ...ofHost},
                    where = (name: string) =>
                        ofAnswers
                            ? {
                                  allowedIn: [
                                      ...(getOwn(ofHost, name) ? ['dashboards'] : []),
                                      ...(getOwn(ofAnswers, name) ? ['answers'] : [])
                                  ]
                              }
                            : {};
                const names: string[] = input.category
                    ? Object.keys(pickBy(entries, it => it.category === input.category))
                    : input.names;
                if (!names?.length) {
                    return Object.entries(entries).map(([name, e]) => ({
                        name,
                        label: e.label,
                        category: e.category,
                        ...(e.fits ? {fits: e.fits} : {}),
                        // A widget's guidance is long, so its list line gives its summary.
                        ...(e.config ? {summary: summaryOf(e)} : {guidance: e.guidance}),
                        returns: e.returns,
                        ...where(name)
                    }));
                }
                // Functions, such as a widget's model or a resolver's code, drop out as JSON.
                return Object.fromEntries(
                    names.map((n: string) => {
                        const entry = getOwn(entries, n);
                        if (!entry) return [n, `unknown ${input.kind} '${n}'`];
                        // The prompt states which properties bind by default, so only the exceptions
                        // show.
                        const config = entry.config
                            ? withDefaultBindingsImplied(entry.config)
                            : null;
                        return [n, {...entry, ...(config ? {config} : {}), ...where(n)}];
                    })
                );
            }
        },
        {
            name: 'edit_blueprint',
            description:
                'Apply one atomic edit to the blueprint: a list of operations, applied in order, then checked as a whole. If any check fails with an error, nothing applies and the issues come back. Operations: {op:"set",path,value}, {op:"remove",path}, {op:"addElement",id,element,parent?,child?,index?,slot?,of?} (only the first element, added to an empty blueprint, may omit parent: it becomes the root. Every later element needs a parent and a child placement), {op:"removeElement",id}, {op:"moveElement",id,parent,child?,index?,slot?,of?} (slot names a slot list of the parent, default children, and of names the child whose reference holds it, as for the headerItems of a dashboard cell), {op:"renameId",kind:"element"|"variable"|"source",from,to}. Paths are JSON Pointers from the root, such as /elements/grid/config/groupBy. A path never indexes into an array: replace the whole array.',
            parameters: {
                type: 'object',
                required: ['base', 'description', 'ops'],
                properties: {
                    base: {
                        type: 'integer',
                        description: 'The version the edit was written against.'
                    },
                    description: {
                        type: 'string',
                        description: 'One line saying what the edit does, for history.'
                    },
                    ops: {type: 'array', items: {type: 'object'}}
                }
            },
            run: (input, target) => {
                const refused = checkEditAllowed(input?.ops, target.mode, target.access, true);
                if (refused) {
                    throw new ArchitectToolError({
                        applied: false,
                        version: target.version,
                        issues: [refused]
                    });
                }
                const {version, issues} = target.applyEdit({
                    base: input?.base,
                    description: input?.description,
                    author: 'architect',
                    ops: input?.ops
                });
                if (issues.some(it => it.severity === 'error')) {
                    throw new ArchitectToolError({applied: false, version: target.version, issues});
                }
                return {applied: true, version, warnings: issues};
            }
        },
        {
            name: 'validate_blueprint',
            description:
                'Check the blueprint, or check the given ops as a dry run without applying them. Returns issues.',
            parameters: {
                type: 'object',
                properties: {ops: {type: 'array', items: {type: 'object'}}}
            },
            run: (input, target) => {
                if (!input?.ops) return {issues: target.validate(target.blueprint)};
                const {result, issue} = applyOps(target.blueprint, input.ops as BlueprintOp[]);
                if (issue) return {issues: [issue]};
                // A widget the ops leave unfinished fails, as edit_blueprint refuses it.
                const before = new Set(
                    target
                        .validate(target.blueprint)
                        .filter(isIncomplete)
                        .map(it => it.path)
                );
                return {
                    issues: target
                        .validate(result, {strict: true})
                        .map(it =>
                            isIncomplete(it) && before.has(it.path)
                                ? {...it, severity: 'warning'}
                                : it
                        )
                };
            }
        },
        {
            name: 'set_variable',
            description:
                "Set a variable's current value, to change what the blueprint shows now without changing its definition. Only a variable that a prompt, an action or a widget value sets. Returns the resolved value.",
            parameters: {
                type: 'object',
                required: ['variable', 'value'],
                properties: {variable: {type: 'string'}, value: {}}
            },
            isAvailable: target => !!target.setVariable,
            run: (input, target) => ({
                variable: input.variable,
                value: target.setVariable(input.variable, input.value)
            })
        },
        {
            name: 'query_dataset',
            description:
                'Query a dataset to look at its data, for example to answer a question. Returns an artifact: an id, columns, the first rows, the total row count, and, as text, each row\'s numbers and dates formatted as the app shows them. Compute from rows, and quote numbers and dates from text. A chat answer can show the artifact with {"artifact": id} as a source.',
            parameters: {
                type: 'object',
                required: ['dataset', 'params'],
                properties: {
                    dataset: {type: 'string'},
                    params: {type: 'object'},
                    fields: {type: 'array', items: {type: 'string'}},
                    groupBy: {type: 'array', items: {type: 'string'}},
                    filter: {type: 'object', description: 'A Hoist filter.'},
                    sortBy: {type: 'string', description: 'field or field|desc'},
                    top: {type: 'integer'}
                }
            },
            isAvailable: target => !!target.dataProvider,
            run: async (input, target, ctx) => {
                const {dataset, requested, rows, totalRows} = await runDatasetQueryAsync(
                        input,
                        target
                    ),
                    id = `art_${(++artifactSeq).toString(16).padStart(3, '0')}`,
                    shown = rows.slice(0, 50),
                    // Each number and date as the app shows it, where that differs from the raw value.
                    text = target.formatFieldValue
                        ? formattedRows(
                              shown.map(row =>
                                  Object.fromEntries(
                                      requested
                                          .filter(n =>
                                              FORMATTED_TYPES.includes(dataset.fields[n].type)
                                          )
                                          .map(n => [
                                              n,
                                              target.formatFieldValue(dataset.name, n, row[n])
                                          ])
                                          .filter(([n, it]) => it != null && it !== String(row[n]))
                                  )
                              )
                          )
                        : null;
                target.artifacts[id] = dataset.name;
                ctx?.addArtifact?.(
                    {
                        id,
                        columns: requested.map(n => {
                            const {name, label, type} = dataset.fields[n];
                            return {
                                name,
                                ...(label ? {label} : {}),
                                type: COLUMN_TYPES[type] ?? 'string'
                            };
                        }),
                        // The artifact is the result as cut by `top`, every row of it.
                        totalRows: rows.length,
                        metadata: {dataset: dataset.name, request: input}
                    },
                    rows
                );
                return {
                    id,
                    dataset: dataset.name,
                    params: input.params ?? {},
                    columns: requested.map(n => {
                        const {name, label, type, kind} = dataset.fields[n];
                        return {name, label, type, kind};
                    }),
                    rows: shown,
                    ...(text ? {text} : {}),
                    totalRows
                };
            }
        },
        {
            name: 'list_blueprints',
            description:
                "List the user's published blueprints of this one's type, for an openBlueprint target: each one's id, name, description, and the variables a link may set, by name and type, which the action's variables can pass.",
            parameters: {type: 'object', properties: {}},
            isAvailable: target => !!target.drillInRepository,
            run: async (_, {drillInRepository: repository, registry}) => {
                const published = (await repository.listAsync())
                        .filter(it => it.publishedVersion != null)
                        .slice(0, MAX_LISTED_BLUEPRINTS),
                    variables = await Promise.all(
                        published.map(it => publishVariablesAsync(repository, it, registry))
                    );
                return {
                    blueprints: published.map((it, idx) => ({
                        id: it.id,
                        name: it.name,
                        ...(it.description ? {description: it.description} : {}),
                        variables: variables[idx]
                    }))
                };
            }
        },
        {
            name: 'find_usages',
            description:
                'Find every path in the blueprint that uses a field, a named format, a variable or a source. Give exactly one. A field counts where a widget, a source or a variable names it, and where a widget with no source of its own, such as a grouping chooser, offers it to the widgets that read its variable. A field instance counts on its own name and on its base field.',
            parameters: {
                type: 'object',
                properties: {
                    field: {type: 'string'},
                    format: {type: 'string'},
                    variable: {type: 'string'},
                    source: {type: 'string'}
                }
            },
            run: (input, {blueprint, catalogs}) => {
                const [kind, name] = Object.entries(input ?? {}).find(([, v]) => v) ?? [];
                if (!kind) throw new Error('give one of field, format, variable or source');
                if (kind === 'field') {
                    const uses = catalogs.flatMap(cat =>
                        Object.entries(fieldUsages(blueprint, cat)).flatMap(([ds, fields]) =>
                            Object.entries(fields).flatMap(([field, list]) =>
                                list
                                    .filter(it => field === name || it.instance === name)
                                    .map(it => ({dataset: ds, path: it.path}))
                            )
                        )
                    );
                    return {
                        usages: uniq(uses.map(it => it.path)),
                        datasets: uniq(uses.map(it => it.dataset))
                    };
                }
                const hits: string[] = [],
                    walk = (o: any, path: string) => {
                        if (isArray(o)) return o.forEach((v, i) => walk(v, `${path}/${i}`));
                        if (o && typeof o === 'object') {
                            if (kind === 'variable' && o.$var === name) hits.push(path);
                            for (const [k, v] of Object.entries(o)) {
                                const isSource = kind === 'source' && k === 'source' && v === name,
                                    isFormat =
                                        kind === 'format' &&
                                        k === 'format' &&
                                        (v === name || (v as PlainObject)?.name === name);
                                if (isSource || isFormat) hits.push(`${path}/${k}`);
                                walk(v, `${path}/${k}`);
                            }
                        }
                    };
                walk(blueprint, '');
                return {usages: uniq(hits)};
            }
        }
    ] as ArchitectToolSpec[]
).map(it => ({
    ...it,
    run: (input, target, ctx) => it.run(normalizeToolInput(it.parameters, input), target, ctx)
}));

/** A tool failure whose result the model should see in full, such as an edit's issues. */
export class ArchitectToolError extends Error {
    readonly result: PlainObject;

    constructor(result: PlainObject) {
        super(JSON.stringify(result));
        this.result = result;
    }
}

/**
 * Run a query as `query_dataset` takes it: a dataset, its params, and the fields, grouping, filter,
 * sort and top to apply. An answer runs the request of a query's artifact again with it, so the
 * rows match what the query returned, as of now. Throws for a request the catalogs cannot serve.
 *
 * @returns the dataset, the fields the rows hold, the rows as cut by `top`, and the size of the
 *      whole result before `top`.
 */
export async function runDatasetQueryAsync(
    input: PlainObject,
    target: Pick<ArchitectTarget, 'catalogs' | 'dataProvider'>
): Promise<{dataset: DatasetDef; requested: string[]; rows: PlainObject[]; totalRows: number}> {
    const {cat, ds} = findModelDataset(target.catalogs, input?.dataset);
    if (!ds) {
        const names = target.catalogs.flatMap(it => modelDatasets(it).map(d => d.name));
        throw new Error(`unknown dataset '${input?.dataset}'. Datasets: ${names.join(', ')}`);
    }
    const readable = modelFields(cat, ds)
        .filter(f => cat.modelAccessOf(ds.name, f.name) === 'rows')
        .map(f => f.name);
    if (!readable.length) {
        throw new Error(
            `you may not read the rows of '${ds.name}'. Build a view over it, and the user sees its data.`
        );
    }
    const params = input.params ?? {},
        missing = Object.entries(ds.params).find(([n, p]) => p.required && params[n] == null);
    if (missing) throw new Error(`${ds.name} requires parameter '${missing[0]}'`);

    const fields: string[] = input.fields?.length ? input.fields : readable.slice(0, 12),
        groupBy: string[] = input.groupBy ?? [],
        unknown = [...fields, ...groupBy].filter(
            f => !ds.fields[f] || cat.modelAccessOf(ds.name, f) === 'none'
        );
    if (unknown.length) throw new Error(`unknown fields: ${unknown.join(', ')}`);
    const [badFilter] = input.filter == null ? [] : checkFilter(input.filter);
    if (badFilter) throw new Error(`filter: ${badFilter.message}`);
    const closed = uniq([
        ...fields,
        ...groupBy,
        ...filterFields(input.filter),
        ...(isString(input.sortBy) ? [input.sortBy.split('|')[0]] : [])
    ]).filter(f => !readable.includes(f));
    if (closed.length) {
        throw new Error(
            `you may not read field ${closed.join(', ')} of '${ds.name}', to show, group, filter or sort by. Fields you may read: ${readable.join(', ')}`
        );
    }

    const requested = uniq([...groupBy, ...fields]),
        {rows} = await target.dataProvider.loadAsync({
            dataset: ds.name,
            params,
            fields: requested,
            groupBy: [],
            ...(isPlainObject(input.filter) ? {filter: input.filter} : {})
        }),
        shaped = queryRows(rows, ds.fields, {
            fields: requested,
            groupBy,
            sortBy: input.sortBy,
            top: input.top
        });
    return {dataset: ds, requested, rows: shaped.rows, totalRows: shaped.totalRows};
}

//------------------
// Implementation
//------------------
// The datasets and fields of a catalog the model may know of: all but those it hides.
const modelDatasets = (cat: DataCatalog): DatasetDef[] =>
    Object.values(cat.datasets).filter(d => cat.modelAccessOf(d.name) !== 'none');

const modelFields = (cat: DataCatalog, ds: DatasetDef): FieldDef[] =>
    Object.values(ds.fields).filter(f => cat.modelAccessOf(ds.name, f.name) !== 'none');

function findModelDataset(
    catalogs: DataCatalog[],
    name: string
): {cat: DataCatalog; ds: DatasetDef} {
    const cat = catalogs.find(it => it.getDataset(name) && it.modelAccessOf(name) !== 'none');
    return {cat, ds: cat?.getDataset(name) ?? null};
}

const REGISTRY_KINDS: Record<string, keyof ArchitectTarget['registry']> = {
    widget: 'widgets',
    variableType: 'variableTypes',
    resolver: 'resolvers',
    action: 'actions',
    renderer: 'renderers'
};

let artifactSeq = 0;

// The field types whose values the app formats, which a result gives as text to quote.
const FORMATTED_TYPES = ['number', 'int', 'date', 'localDate'];

const formattedRows = (rows: PlainObject[]) => (rows.some(it => !isEmpty(it)) ? rows : null);

// A field type as a chat data column's type.
const COLUMN_TYPES: Record<string, string> = {
    string: 'string',
    number: 'number',
    int: 'integer',
    localDate: 'date',
    date: 'datetime',
    bool: 'boolean'
};

// The most blueprints list_blueprints reads, each a request for its latest publish.
const MAX_LISTED_BLUEPRINTS = 50;

// The variables a link may set of each publish, by repository, read once per publish.
const PUBLISH_VARIABLES = new WeakMap<object, Map<string, LinkVariable[]>>();

interface LinkVariable {
    name: string;
    type: string;
}

async function publishVariablesAsync(
    repository: BlueprintRepository,
    summary: BlueprintSummary,
    registry: ArchitectTarget['registry']
): Promise<LinkVariable[]> {
    if (!PUBLISH_VARIABLES.has(repository)) PUBLISH_VARIABLES.set(repository, new Map());
    const cache = PUBLISH_VARIABLES.get(repository),
        key = `${summary.id}|${summary.publishedVersion}`;
    if (!cache.has(key)) {
        const record = await repository.openAsync(summary.id, {as: 'publish'});
        cache.set(key, linkVariables(record?.blueprint, registry));
    }
    return cache.get(key);
}

// The variables of a blueprint a link may set, by name and type: settable from outside, of a type
// with a link form.
function linkVariables(
    blueprint: Blueprint,
    registry: ArchitectTarget['registry']
): LinkVariable[] {
    return Object.entries(blueprint?.variables ?? {})
        .filter(
            ([, decl]) => isSettableFromOutside(decl) && isLinkSettableType(decl.type, registry)
        )
        .map(([name, decl]) => ({name, type: decl.type}));
}
