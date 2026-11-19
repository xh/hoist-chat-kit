import type Anthropic from '@anthropic-ai/sdk';
import {fakeDataProvider} from './data.ts';
import {
    type ArchitectTarget,
    ArchitectToolError,
    answerBlueprintSchema,
    answerToolDescription,
    applyOps,
    availableArchitectTools,
    hostSourceFor,
    Issue,
    libraryCatalogs,
    libraryRegistry,
    READ_ANSWER_SPEC,
    REQUEST_DESIGN_MODE_SPEC,
    validate
} from './library.ts';
import {Blueprint, clone} from './load.ts';

// The kit's own show_ui, over the harness's registry, which lacks chat kit's bridged widgets.
const SHOW_UI: Anthropic.Tool = {
    name: 'show_ui',
    description: answerToolDescription(libraryRegistry as any),
    input_schema: answerBlueprintSchema(libraryRegistry as any) as Anthropic.Tool.InputSchema
};

export interface Stats {
    toolCalls: Record<string, number>;
    edits: number;
    editsRejected: number;
    issueCodes: Record<string, number>;
    segments: number;
    segmentsRejected: number;
}

const json = (o: unknown) => JSON.stringify(o);

/** The state one scenario run works on: a target for the library's Architect tools, plus show_ui. */
export class Session implements ArchitectTarget {
    blueprint: Blueprint;
    version = 0;
    readonly catalogs = libraryCatalogs;
    readonly registry = libraryRegistry as ArchitectTarget['registry'];
    readonly dataProvider = fakeDataProvider as ArchitectTarget['dataProvider'];
    readonly segments: Blueprint[] = [];
    readonly artifacts: Record<string, string> = {};
    // Each query's artifact, with its request, as the chat keeps it.
    readonly queried: Record<string, any> = {};
    // The tools the model called, in order.
    readonly calls: string[] = [];
    mode: 'run' | 'design';
    readonly access = 'write' as const;
    readonly stats: Stats = {toolCalls: {}, edits: 0, editsRejected: 0, issueCodes: {}, segments: 0, segmentsRejected: 0};

    constructor(host: Blueprint | null, mode: 'run' | 'design' = 'design') {
        this.blueprint = host ? clone(host) : {elements: {}};
        this.mode = mode;
    }

    setMode(mode: 'run' | 'design') {
        this.mode = mode;
    }

    /** The host's variables at their defaults, with `today` as the harness's date. */
    get variables() {
        return Object.entries<any>(this.blueprint.variables ?? {}).map(([name, v]) => ({
            name,
            value: v.default?.value ?? (v.default?.resolver === 'today' ? HARNESS_TODAY : null)
        }));
    }

    validate(bp: Blueprint, isAnswer = false): Issue[] {
        return validate(bp, {artifacts: this.artifacts, isAnswer});
    }

    applyEdit(edit: {base?: number; ops: any[]}): {version?: number; issues: Issue[]} {
        if (edit.base !== this.version) {
            const message = `base is ${edit.base}, but the blueprint is at version ${this.version}`;
            return {issues: [{code: 'edit.staleBase', severity: 'error', path: '', message}]};
        }
        const {result, issue} = applyOps(this.blueprint, edit.ops),
            issues = issue ? [issue] : this.validate(result!);
        if (issues.some(i => i.severity === 'error')) return {issues};
        this.blueprint = result!;
        this.version++;
        return {version: this.version, issues};
    }

    private count(issues: Issue[]) {
        for (const i of issues) this.stats.issueCodes[i.code] = (this.stats.issueCodes[i.code] ?? 0) + 1;
    }

    async run(name: string, input: any): Promise<{content: string; isError?: boolean}> {
        this.stats.toolCalls[name] = (this.stats.toolCalls[name] ?? 0) + 1;
        this.calls.push(name);
        if (name === 'show_ui') return this.showUi(input);
        if (name === READ_ANSWER_SPEC.name) return this.readAnswer(input);
        // The harness's user approves every request.
        if (name === REQUEST_DESIGN_MODE_SPEC.name) {
            this.setMode('design');
            return {content: json({mode: this.mode})};
        }

        const tool = availableArchitectTools(this).find(it => it.name === name);
        if (!tool) return {content: `unknown tool '${name}'`, isError: true};
        if (name === 'edit_blueprint') this.stats.edits++;
        try {
            const result: any = await tool.run(input, this, {
                addArtifact: artifact => (this.queried[artifact.id] = artifact)
            });
            if (name === 'edit_blueprint') this.count(result.warnings);
            return {content: typeof result === 'string' ? result : json(result)};
        } catch (e) {
            if (!(e instanceof ArchitectToolError)) return {content: (e as Error).message, isError: true};
            if (name === 'edit_blueprint') {
                this.stats.editsRejected++;
                this.count(e.result.issues);
            }
            return {content: json(e.result), isError: true};
        }
    }

    // As the kit's read_answer, over this run's segments, which are all from one reply.
    private readAnswer(input: any): {content: string; isError?: boolean} {
        const widgets = (bp: Blueprint) => [...new Set(Object.values<any>(bp.elements ?? {}).map(e => e.component))];
        if (!input?.answer) {
            return {content: json(this.segments.map((bp, n) => ({answer: `r1:${n}`, kind: 'show_ui', widgets: widgets(bp)})))};
        }
        const bp = this.segments[Number(String(input.answer).split(':')[1])];
        if (!bp) return {content: `no answer '${input.answer}' in this chat`, isError: true};
        const artifacts = Object.values<any>(bp.sources ?? {})
            .map(s => this.queried[s?.artifact])
            .filter(Boolean)
            .map(({id, columns, totalRows, metadata}) => ({
                id, columns, totalRows, request: metadata.request, host: hostSourceFor(metadata.request, this)
            }));
        return {content: json({answer: input.answer, kind: 'show_ui', blueprint: bp, artifacts})};
    }

    private showUi(input: any): {content: string; isError?: boolean} {
        this.stats.segments++;
        const issues = this.validate(input ?? {}, true);
        this.count(issues);
        if (issues.some(i => i.severity === 'error')) {
            this.stats.segmentsRejected++;
            return {content: json({shown: false, issues}), isError: true};
        }
        this.segments.push(clone(input));
        return {content: json({shown: true, warnings: issues})};
    }
}

/** The library's Architect tools the harness can run, plus show_ui, for the model. */
export const TOOLS: Anthropic.Tool[] = [
    ...availableArchitectTools(new Session(null)).map(({name, description, parameters}) => ({
        name,
        description,
        input_schema: parameters as Anthropic.Tool.InputSchema
    })),
    ...[READ_ANSWER_SPEC, REQUEST_DESIGN_MODE_SPEC].map(({name, description, parameters}) => ({
        name,
        description,
        input_schema: parameters as Anthropic.Tool.InputSchema
    })),
    SHOW_UI
];

/** The date the harness resolves `today` to, which the scenarios' contexts give the model. */
export const HARNESS_TODAY = '2026-11-19';
