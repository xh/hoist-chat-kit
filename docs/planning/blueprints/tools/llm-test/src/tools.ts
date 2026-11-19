import type Anthropic from '@anthropic-ai/sdk';
import {fakeDataProvider} from './data.ts';
import {
    type ArchitectTarget,
    ArchitectToolError,
    applyOps,
    availableArchitectTools,
    Issue,
    libraryCatalogs,
    libraryRegistry,
    validate
} from './library.ts';
import {Blueprint, clone} from './load.ts';

const SHOW_UI: Anthropic.Tool = {
    name: 'show_ui',
    description: 'Show UI in a chat answer: one segment, which is a complete blueprint. Use it to answer a question with UI. It never changes the host blueprint. Widgets that interact go in one segment.',
    input_schema: {type: 'object', required: ['blueprint'], properties: {blueprint: {type: 'object'}}}
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
    // The scenarios design blueprints, so the Architect may edit them.
    readonly mode = 'design' as const;
    readonly access = 'write' as const;
    readonly stats: Stats = {toolCalls: {}, edits: 0, editsRejected: 0, issueCodes: {}, segments: 0, segmentsRejected: 0};

    constructor(host: Blueprint | null) {
        this.blueprint = host ? clone(host) : {elements: {}};
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
        if (name === 'show_ui') return this.showUi(input);

        const tool = availableArchitectTools(this).find(it => it.name === name);
        if (!tool) return {content: `unknown tool '${name}'`, isError: true};
        if (name === 'edit_blueprint') this.stats.edits++;
        try {
            const result: any = await tool.run(input, this);
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

    private showUi(input: any): {content: string; isError?: boolean} {
        this.stats.segments++;
        const issues = this.validate(input?.blueprint ?? {}, true);
        this.count(issues);
        if (issues.some(i => i.severity === 'error')) {
            this.stats.segmentsRejected++;
            return {content: json({shown: false, issues}), isError: true};
        }
        this.segments.push(clone(input.blueprint));
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
    SHOW_UI
];
