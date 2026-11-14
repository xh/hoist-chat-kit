import {
    createQueryManager,
    createStore,
    evaluate,
    evaluateRoot,
    markReactive,
    resolveStateField,
    type ASTNode,
    type ElementNode,
    type EvalContext,
    type EvaluationContext,
    type Library,
    type OpenUIError,
    type ParseResult,
    type QueryManager,
    type Store,
    type ToolProvider
} from '@openuidev/lang-core';
import {HoistBase} from '@xh/hoist/core';
import {action, observable} from '@xh/hoist/mobx';
import {isEmpty, lowerFirst, mapValues, truncate} from 'lodash';
import type {ChatPartRenderContext} from '../../../core';
import {getOwn} from '../../../impl/LangUtils';
import {
    CHAT_UI_MAX_CONTEXT_VALUE_LENGTH,
    CHAT_UI_MAX_SUMMARY_LENGTH,
    describeChatUiAction,
    type ChatUiAction,
    type ChatUiStateAction
} from '../../ChatUiAction';
import type {ChatUiCatalog} from '../../ChatUiCatalog';
import type {ChatUiDocumentContext} from '../../ChatUiComponentSpec';
import type {ChatUiBinding, ChatUiState} from '../../ChatUiState';
import type {OpenUiStep} from '../OpenUiActions';
import type {OpenUiLibrary} from '../OpenUiLibrary';
import {warnOnce} from './warnOnce';

/** Configuration for an {@link OpenUiRuntime}. */
export interface OpenUiRuntimeConfig {
    /** The catalog that renders the program, which checks and runs the actions it sends. */
    catalog: ChatUiCatalog;

    /** The catalog as an OpenUI library. */
    library: OpenUiLibrary;

    /** The chat, message and part that hold the program. */
    context?: ChatUiDocumentContext;

    /** Runs the tools of `Query()` and `Mutation()`. Null to run none: a query keeps its defaults. */
    toolProvider?: ToolProvider;

    /** The least seconds between two automatic refreshes of a query. */
    minRefreshSeconds?: number;
}

/** A program that the runtime evaluated - see {@link OpenUiRuntime.evaluateProgram}. */
export interface OpenUiEvaluation {
    /** The root element with its props evaluated, or null for a program with no root yet. */
    root: ElementNode;

    /** What failed as the props evaluated, in the kit's `path: message` form. */
    errors: string[];
}

/**
 * The state of one OpenUI Lang program: its `$variables`, and the results of its queries. It runs
 * on lang-core's own store, evaluator and query manager, and makes their changes observable to
 * MobX, so that a Hoist component which reads them renders again.
 *
 * lang-core's store and query manager notify plain listeners. Each notice bumps an observable
 * version, and each read of the state or of a result reads that version first. An observer that
 * evaluates a program therefore depends on the version, and runs again when it changes.
 * @internal
 */
export class OpenUiRuntime extends HoistBase implements ChatUiState {
    readonly store: Store = createStore();

    /** Reads the store and the query results, as lang-core's evaluator asks for them. */
    readonly evaluationContext: EvaluationContext = {
        getState: name => {
            this.track(this.stateVersion);
            return this.store.get(name);
        },
        resolveRef: name => {
            this.track(this.queryVersion);
            return this.getResult(name);
        }
    };

    private readonly catalog: ChatUiCatalog;
    private readonly library: OpenUiLibrary;
    private readonly queryManager: QueryManager;
    private readonly minRefreshSeconds: number;

    // What lang-core's evaluator reads of a library: which props are two-way bindings.
    private readonly evalLibrary: Library;

    @observable private accessor stateVersion: number = 0;
    @observable private accessor queryVersion: number = 0;

    // The program as last parsed, its text, and whether it has streamed in full.
    private program: ParseResult = null;
    private programText: string = null;
    private isComplete: boolean = false;

    // True while the store takes the defaults of a new parse. The render that reads them is the
    // one that set them, so no observer needs a notice.
    private isInitializing: boolean = false;
    private isSyncPending: boolean = false;

    // The steps of each state action of the program as last resolved, by action id.
    private readonly plans = new Map<string, {steps: OpenUiStep[]; summary: string}>();

    constructor(config: OpenUiRuntimeConfig) {
        super();
        const {catalog, library, toolProvider = null, minRefreshSeconds = 10} = config;
        this.catalog = catalog;
        this.library = library;
        this.minRefreshSeconds = minRefreshSeconds;
        this.evalLibrary = createEvalLibrary(catalog, library);
        this.queryManager = createQueryManager(toolProvider);

        this.store.subscribe(() => {
            if (this.isInitializing) return;
            this.noteStateChange();
            this.syncQueriesSoon();
        });
        this.queryManager.subscribe(() => this.noteQueryChange());
    }

    /**
     * Take the program of a new parse: declare its `$variables`, and run its queries once it is
     * complete. A value that the user or an action set is kept. Safe to call on each render, as
     * it changes no observable.
     *
     * @param result - what lang-core parsed.
     * @param text - the program text, to tell a new parse from a repeat of the last.
     * @param isComplete - true once the program has streamed in full.
     */
    setProgram(result: ParseResult, text: string, isComplete: boolean) {
        this.program = result;
        this.isInitializing = true;
        try {
            this.store.initialize(result.stateDeclarations ?? {}, {});
        } finally {
            this.isInitializing = false;
        }

        if (text !== this.programText || isComplete !== this.isComplete) {
            this.programText = text;
            this.isComplete = isComplete;
            this.syncQueriesSoon();
        }
    }

    /**
     * Evaluate the props of the program against the current state. Call inside an observer: it
     * then runs again when a `$variable` or a query result that the program reads changes. The
     * actions of the last evaluation no longer run: register those of this one.
     */
    evaluateProgram(): OpenUiEvaluation {
        this.plans.clear();
        const errors: OpenUIError[] = [],
            evalCtx: EvalContext = {
                ctx: this.evaluationContext,
                library: this.evalLibrary,
                store: this.store,
                errors
            };

        let root: ElementNode = null;
        try {
            root = evaluateRoot(this.program, evalCtx);
        } catch (e) {
            errors.push({
                source: 'runtime',
                code: 'runtime-error',
                message: `Prop evaluation failed: ${(e as Error)?.message ?? e}`
            });
        }
        return {root, errors: errors.map(it => it.message)};
    }

    /**
     * The current value of a prop that lang-core marked as a two-way binding, with the binding
     * that writes it back.
     */
    toBinding(name: string, value: unknown): {value: unknown; binding: ChatUiBinding} {
        const field = resolveStateField(
            name,
            value,
            this.store,
            this.evaluationContext,
            () => null,
            () => null
        );
        this.track(this.stateVersion);
        return {value: field.value, binding: {set: next => field.setValue(next)}};
    }

    /**
     * The kit action for the steps of an action expression. One step that is a kit action is
     * that action. Anything else is a `state` action, which names the steps by `id` and says what
     * they do. Null for steps that are too many, or too long to show in full.
     *
     * Call {@link registerAction} for a `state` action once it has passed its checks.
     */
    createAction(id: string, steps: OpenUiStep[]): ChatUiAction {
        if (isEmpty(steps) || steps.length > MAX_STEPS) return null;
        if (steps.length === 1 && steps[0].type === 'action') return steps[0].action;

        const summary = steps
            .map((step, idx) => {
                const text = this.describeStep(step);
                return idx === 0 ? text : lowerFirst(text);
            })
            .join(', then ');
        return summary.length <= CHAT_UI_MAX_SUMMARY_LENGTH ? {type: 'state', id, summary} : null;
    }

    /** Hold the steps of a `state` action, for the click that runs it. */
    registerAction(stateAction: ChatUiStateAction, steps: OpenUiStep[]) {
        this.plans.set(stateAction.id, {steps, summary: stateAction.summary});
    }

    /**
     * Run a `state` action: its steps, in order. A step that fails stops the rest. An action that
     * the runtime does not hold, or whose summary differs from the one the user saw, is refused.
     */
    async runActionAsync(
        stateAction: ChatUiStateAction,
        context: ChatPartRenderContext
    ): Promise<unknown> {
        const plan = this.plans.get(stateAction.id);
        if (!plan || plan.summary !== stateAction.summary) {
            throw new Error('This action is out of date - the program has changed.');
        }

        for (const step of plan.steps) {
            switch (step.type) {
                case 'set':
                    this.store.set(step.target, this.evaluateNode(step.valueAST));
                    break;
                case 'reset': {
                    const defaults = this.program?.stateDeclarations ?? {};
                    step.targets.forEach(target =>
                        this.store.set(target, getOwn(defaults, target) ?? null, {pristine: true})
                    );
                    break;
                }
                case 'run':
                    if (step.refType === 'query') this.queryManager.invalidate([step.statementId]);
                    break;
                case 'action':
                    await this.catalog.runActionAsync(step.action, context);
                    break;
            }
        }
        return null;
    }

    override destroy() {
        this.queryManager.dispose();
        this.store.dispose();
        this.plans.clear();
        super.destroy();
    }

    //------------------
    // Implementation
    //------------------
    @action
    private noteStateChange() {
        this.stateVersion++;
    }

    @action
    private noteQueryChange() {
        this.queryVersion++;
    }

    // Reads an observable version, so that the observer running now depends on it.
    private track(version: number): number {
        return version;
    }

    private evaluateNode(node: ASTNode): unknown {
        return evaluate(node, this.evaluationContext);
    }

    // The result of a query, or its defaults before it first runs, as while the program streams.
    private getResult(name: string): unknown {
        const {queryManager, program} = this,
            ret = queryManager.getMutationResult(name) ?? queryManager.getResult(name);
        if (ret != null) return ret;

        const statement = program?.queryStatements?.find(it => it.statementId === name);
        return statement?.defaultsAST ? this.evaluateNode(statement.defaultsAST) : null;
    }

    // Queries run outside of a render, as each run notifies the observers of the results.
    private syncQueriesSoon() {
        if (this.isSyncPending) return;
        this.isSyncPending = true;
        queueMicrotask(() => {
            this.isSyncPending = false;
            if (!this.isDestroyed) this.syncQueries();
        });
    }

    // A query runs once its program is complete, and again when a `$variable` it reads changes.
    private syncQueries() {
        const {program, isComplete, queryManager, minRefreshSeconds} = this;
        if (!program || !isComplete) return;

        const statements = (program.queryStatements ?? []).map(statement => {
            if (!statement.refreshAST) return statement;
            // A model sets the interval, so hold it to a floor.
            const seconds = Number(this.evaluateNode(statement.refreshAST)),
                v = seconds > 0 ? Math.max(seconds, minRefreshSeconds) : 0;
            return {...statement, refreshAST: {k: 'Num', v} as ASTNode};
        });
        queryManager.evaluateStatements(statements, this.evaluationContext);
    }

    private describeStep(step: OpenUiStep): string {
        switch (step.type) {
            case 'set':
                return `Sets ${step.target} to ${formatValue(this.evaluateNode(step.valueAST))}`;
            case 'reset':
                return `Resets ${step.targets.join(', ')}`;
            case 'run':
                return `Refreshes ${step.statementId}`;
            case 'action':
                return describeChatUiAction(step.action);
        }
    }
}

/** Log what failed as a program evaluated, once per program and message. */
export function warnOfEvaluationErrors(key: string, errors: string[]) {
    if (isEmpty(errors)) return;
    warnOnce(
        `evaluate|${key}|${errors.join('|')}`,
        ['OpenUI program evaluated with errors:', ...errors],
        'OpenUiRuntime'
    );
}

//------------------
// Implementation
//------------------
const MAX_STEPS = 8;

// Marks a prop as a two-way binding, in the form lang-core's evaluator looks for.
const REACTIVE_PROP = {};
markReactive(REACTIVE_PROP);

// The part of a lang-core library that its evaluator reads: for each component, the props that
// take a two-way binding. These are the `stateProps` of the catalog component.
function createEvalLibrary(catalog: ChatUiCatalog, library: OpenUiLibrary): Library {
    const components = mapValues(library.components, (_, openUiName) => {
        const stateProps = catalog.getComponent(library.toCatalogName(openUiName))?.stateProps;
        return {
            props: {shape: Object.fromEntries((stateProps ?? []).map(it => [it, REACTIVE_PROP]))}
        };
    });
    return {components} as unknown as Library;
}

function formatValue(value: unknown): string {
    return truncate(JSON.stringify(value) ?? 'null', {length: CHAT_UI_MAX_CONTEXT_VALUE_LENGTH});
}
