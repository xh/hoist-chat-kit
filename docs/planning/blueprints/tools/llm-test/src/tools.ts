import type Anthropic from '@anthropic-ai/sdk';
import {queryDataset} from './data.ts';
import {applyOps, Issue, validate} from './library.ts';
import {Blueprint, catalogs, clone, datasets, registry} from './load.ts';

const str = {type: 'string'} as const;

export const TOOLS: Anthropic.Tool[] = [
    {
        name: 'read_blueprint',
        description: 'Read the blueprint being edited, or only the subtrees at the given JSON Pointer paths. Returns its version, which edit_blueprint takes as base.',
        input_schema: {type: 'object', properties: {paths: {type: 'array', items: str}}}
    },
    {
        name: 'describe_catalog',
        description: 'Describe the Data Catalog. With no dataset, lists every dataset with its parameters and field categories. With a dataset, lists its fields, optionally narrowed by category or a search term matched against names, labels and guidance.',
        input_schema: {type: 'object', properties: {dataset: str, category: str, search: str}}
    },
    {
        name: 'describe_registry',
        description: 'Describe what the app provides in code. kind is widget, variableType, resolver, action or renderer. With names, returns each full spec, including a widget\'s config schema, outputs, value, preset paths, sizes and example. Without names, lists every entry in one line.',
        input_schema: {
            type: 'object',
            required: ['kind'],
            properties: {kind: {enum: ['widget', 'variableType', 'resolver', 'action', 'renderer']}, names: {type: 'array', items: str}}
        }
    },
    {
        name: 'edit_blueprint',
        description: 'Apply one atomic edit to the blueprint: a list of operations, applied in order, then checked as a whole. If any check fails with an error, nothing applies and the issues come back. Operations: {op:"set",path,value}, {op:"remove",path}, {op:"addElement",id,element,parent?,child?,index?} (only the first element, added to an empty blueprint, may omit parent: it becomes the root. Every later element needs a parent and a child placement), {op:"removeElement",id}, {op:"moveElement",id,parent,child?,index?}, {op:"renameId",kind:"element"|"variable"|"source",from,to}. Paths are JSON Pointers from the root, such as /elements/grid/config/groupBy. A path never indexes into an array: replace the whole array.',
        input_schema: {
            type: 'object',
            required: ['base', 'description', 'ops'],
            properties: {
                base: {type: 'integer', description: 'The version the edit was written against.'},
                description: {type: 'string', description: 'One line saying what the edit does, for history.'},
                ops: {type: 'array', items: {type: 'object'}}
            }
        }
    },
    {
        name: 'validate_blueprint',
        description: 'Check the blueprint, or check the given ops as a dry run without applying them. Returns issues.',
        input_schema: {type: 'object', properties: {ops: {type: 'array', items: {type: 'object'}}}}
    },
    {
        name: 'query_dataset',
        description: 'Query a dataset to look at its data, for example to answer a question. Returns an artifact: an id, columns, the first rows and the total row count. A chat answer can show the artifact with {"artifact": id} as a source.',
        input_schema: {
            type: 'object',
            required: ['dataset', 'params'],
            properties: {
                dataset: str,
                params: {type: 'object'},
                fields: {type: 'array', items: str},
                groupBy: {type: 'array', items: str},
                filter: {type: 'object', description: 'A Hoist filter.'},
                sortBy: {type: 'string', description: 'field or field|desc'},
                top: {type: 'integer'}
            }
        }
    },
    {
        name: 'find_usages',
        description: 'Find every path in the blueprint that uses a field, a named format, a variable or a source. Give exactly one.',
        input_schema: {type: 'object', properties: {field: str, format: str, variable: str, source: str}}
    },
    {
        name: 'show_ui',
        description: 'Show UI in a chat answer: one segment, which is a complete blueprint. Use it to answer a question with UI. It never changes the host blueprint. Widgets that interact go in one segment.',
        input_schema: {type: 'object', required: ['blueprint'], properties: {blueprint: {type: 'object'}}}
    }
];

export interface Stats {
    toolCalls: Record<string, number>;
    edits: number;
    editsRejected: number;
    issueCodes: Record<string, number>;
    segments: number;
    segmentsRejected: number;
}

const json = (o: unknown) => JSON.stringify(o);

/** The state one scenario run works on, and the handlers for every tool. */
export class Session {
    blueprint: Blueprint;
    version = 0;
    readonly segments: Blueprint[] = [];
    readonly artifacts: Record<string, string> = {};
    readonly stats: Stats = {toolCalls: {}, edits: 0, editsRejected: 0, issueCodes: {}, segments: 0, segmentsRejected: 0};

    constructor(host: Blueprint | null) {
        this.blueprint = host ? clone(host) : {elements: {}};
    }

    private count(issues: Issue[]) {
        for (const i of issues) this.stats.issueCodes[i.code] = (this.stats.issueCodes[i.code] ?? 0) + 1;
    }

    private check(bp: Blueprint, isAnswer = false) {
        return validate(bp, {artifacts: this.artifacts, isAnswer});
    }

    run(name: string, input: any): {content: string; isError?: boolean} {
        this.stats.toolCalls[name] = (this.stats.toolCalls[name] ?? 0) + 1;
        switch (name) {
            case 'read_blueprint': {
                if (!input?.paths?.length) return {content: json({version: this.version, blueprint: this.blueprint})};
                const parts = Object.fromEntries(input.paths.map((p: string) => {
                    let o: any = this.blueprint;
                    for (const s of String(p).split('/').slice(1)) o = o?.[s];
                    return [p, o ?? null];
                }));
                return {content: json({version: this.version, parts})};
            }
            case 'describe_catalog': {
                if (!input?.dataset) {
                    return {
                        content: json(Object.values(datasets).map(d => ({
                            dataset: d.name, catalog: d.catalog, label: d.label, guidance: d.guidance ?? d.description, params: d.params,
                            fieldCount: Object.keys(d.fields).length,
                            categories: [...new Set(Object.values(d.fields).map(f => JSON.stringify(f.category ?? null)))].map(c => JSON.parse(c)).filter(Boolean)
                        })))
                    };
                }
                const d = datasets[input.dataset];
                if (!d) return {content: `unknown dataset '${input.dataset}'`, isError: true};
                const cat = catalogs[d.catalog],
                    q = String(input.search ?? '').toLowerCase();
                const fields = Object.values(d.fields).filter(f => {
                    const c = [f.category].flat().join(' > ');
                    if (input.category && !c.toLowerCase().includes(String(input.category).toLowerCase())) return false;
                    return !q || [f.name, f.label, f.guidance, f.description].join(' ').toLowerCase().includes(q);
                });
                return {
                    content: json({
                        dataset: d.name, params: d.params, kinds: cat.kinds, formats: cat.formats,
                        fields: fields.map(({name, label, type, kind, isDimension, parentDimension, aggregator, params, category, guidance, description, deprecated, replacedBy, renderer}) =>
                            ({name, label, type, kind, isDimension, parentDimension, aggregator, params, category, guidance: guidance ?? description, deprecated, replacedBy, renderer}))
                    })
                };
            }
            case 'describe_registry': {
                const coll = {widget: 'widgets', variableType: 'variableTypes', resolver: 'resolvers', action: 'actions', renderer: 'renderers'}[input?.kind as string];
                if (!coll) return {content: 'kind must be widget, variableType, resolver, action or renderer', isError: true};
                const entries = registry[coll];
                if (!input.names?.length) {
                    return {content: json(Object.entries<any>(entries).map(([n, e]) => ({name: n, label: e.label, category: e.category, guidance: e.guidance, returns: e.returns})))};
                }
                return {content: json(Object.fromEntries(input.names.map((n: string) => [n, entries[n] ?? `unknown ${input.kind} '${n}'`])))};
            }
            case 'edit_blueprint': {
                this.stats.edits++;
                if (input?.base !== this.version) {
                    this.stats.editsRejected++;
                    return {content: json({applied: false, version: this.version, issues: [{code: 'edit.staleBase', path: '', message: `base is ${input?.base}, but the blueprint is at version ${this.version}`}]}), isError: true};
                }
                const {result, issue} = applyOps(this.blueprint, input.ops),
                    issues = issue ? [issue] : this.check(result!);
                this.count(issues);
                if (issues.some(i => i.severity === 'error')) {
                    this.stats.editsRejected++;
                    return {content: json({applied: false, version: this.version, issues}), isError: true};
                }
                this.blueprint = result!;
                this.version++;
                return {content: json({applied: true, version: this.version, warnings: issues})};
            }
            case 'validate_blueprint': {
                if (!input?.ops) return {content: json({issues: this.check(this.blueprint)})};
                const {result, issue} = applyOps(this.blueprint, input.ops);
                return {content: json({issues: issue ? [issue] : this.check(result!)})};
            }
            case 'query_dataset': {
                const {artifact, error} = queryDataset(input);
                if (error) return {content: error, isError: true};
                this.artifacts[artifact.id] = artifact.dataset;
                return {content: json(artifact)};
            }
            case 'find_usages': {
                const [kind, name] = Object.entries(input ?? {}).find(([, v]) => v) ?? [];
                if (!kind) return {content: 'give one of field, format, variable or source', isError: true};
                const hits: string[] = [];
                const walk = (o: any, path: string) => {
                    if (Array.isArray(o)) return o.forEach((v, i) => walk(v, `${path}/${i}`));
                    if (o && typeof o === 'object') {
                        if (kind === 'variable' && o.$var === name) hits.push(path);
                        for (const [k, v] of Object.entries(o)) {
                            if ((kind === 'source' && k === 'source' && v === name) || (kind === 'format' && k === 'format' && (v === name || (v as any)?.name === name))) hits.push(`${path}/${k}`);
                            if (kind === 'field' && ['field', 'x', 'sortBy'].includes(k) && String(v).split('|')[0] === name) hits.push(`${path}/${k}`);
                            walk(v, `${path}/${k}`);
                        }
                    } else if (kind === 'field' && o === name) hits.push(path);
                };
                walk(this.blueprint, '');
                return {content: json({usages: [...new Set(hits)]})};
            }
            case 'show_ui': {
                this.stats.segments++;
                const issues = this.check(input?.blueprint ?? {}, true);
                this.count(issues);
                if (issues.some(i => i.severity === 'error')) {
                    this.stats.segmentsRejected++;
                    return {content: json({shown: false, issues}), isError: true};
                }
                this.segments.push(clone(input.blueprint));
                return {content: json({shown: true, warnings: issues})};
            }
            default:
                return {content: `unknown tool '${name}'`, isError: true};
        }
    }
}
