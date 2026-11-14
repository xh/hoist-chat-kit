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
    type Store
} from '@openuidev/lang-core';
import {HoistBase, type PlainObject} from '@xh/hoist/core';
import {action, observable} from '@xh/hoist/mobx';
import {logError, throwIf} from '@xh/hoist/utils/js';
import {
    clamp,
    compact,
    findLastIndex,
    isArray,
    isEmpty,
    isFinite,
    isPlainObject,
    isString,
    lowerFirst,
    mapValues
} from 'lodash';
import type {ChatModel, ChatPartRenderContext} from '../../../core';
import {getOwn} from '../../../impl/LangUtils';
import {
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
import {OpenUiToolGate, type OpenUiToolCall} from './OpenUiToolGate';
import {measureProgram} from './programSize';
import {warnOnce} from './warnOnce';

/** Configuration for an {@link OpenUiRuntime}. */
export interface OpenUiRuntimeConfig {
    /** The catalog that renders the program, which checks and runs the actions it sends. */
    catalog: ChatUiCatalog;

    /** The catalog as an OpenUI library. */
    library: OpenUiLibrary;

    /** The chat, message and part that hold the program. */
    context?: ChatUiDocumentContext;

    /**
     * Names of the chat tools that a `Query()` may run. Default none: a query keeps its
     * defaults.
     */
    queryTools?: string[];

    /**
     * Names of the chat tools that a `Mutation()` may run, on a click. Default none: a mutation
     * fails, and the steps after it do not run.
     */
    mutationTools?: string[];

    /** The least seconds between two automatic refreshes of a query. Default 10. */
    minRefreshSeconds?: number;

    /** Most `Query()` and `Mutation()` statements in one program. Default 8. */
    maxCalls?: number;

    /** Called with each tool call of the program that passed its checks, as it starts. */
    onToolCall?: (call: OpenUiToolCall) => void;
}

/** A program that the runtime evaluated - see {@link OpenUiRuntime.evaluateProgram}. */
export interface OpenUiEvaluation {
    /** The root element with its props evaluated, or null for a program with no root yet. */
    root: ElementNode;

    /** What failed as the props evaluated, in the kit's `path: message` form. */
    errors: string[];
}

/**
 * A step of a `state` action, with every value it uses fixed when its button rendered. A click
 * runs these values, so it does what the button's tooltip said.
 * @internal
 */
export type OpenUiPlanStep =
    | {type: 'set'; target: string; value: unknown}
    | {type: 'reset'; targets: string[]}
    | {type: 'refresh'; statementId: string}
    | {type: 'mutation'; statementId: string; tool: string; args: PlainObject}
    | {type: 'action'; action: ChatUiAction};

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
    private readonly chatModel: ChatModel;
    private readonly messageId: string;
    private readonly minRefreshSeconds: number;
    private readonly maxCalls: number;

    // One manager per kind of call, as each runs its tools under its own rules. A manager with
    // no gate runs nothing.
    private readonly queryManager: QueryManager;
    private readonly mutationManager: QueryManager;
    private readonly mutationGate: OpenUiToolGate;
    private readonly abortController = new AbortController();

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

    // True once the user changed a value or clicked a button of the program, and once its
    // queries first ran.
    private hasUserActed: boolean = false;
    private hasSynced: boolean = false;

    // The steps of each state action of the program as last resolved, by action id.
    private readonly plans = new Map<string, {steps: OpenUiPlanStep[]; summary: string}>();

    // The one mutation the user approved and that may run now - see `runMutationAsync()`.
    private approvedMutation: {tool: string; args: PlainObject; run: () => Promise<unknown>} = null;

    constructor(config: OpenUiRuntimeConfig) {
        super();
        const {
                catalog,
                library,
                context,
                queryTools = [],
                mutationTools = [],
                minRefreshSeconds = 10,
                maxCalls = 8,
                onToolCall
            } = config,
            chatModel = context?.chatModel ?? null,
            messageId = context?.messageId ?? null,
            {signal} = this.abortController;
        this.catalog = catalog;
        this.library = library;
        this.chatModel = chatModel;
        this.messageId = messageId;
        this.minRefreshSeconds = minRefreshSeconds;
        this.maxCalls = maxCalls;
        this.evalLibrary = createEvalLibrary(catalog, library);

        // With no chat or no tools allowed, a kind of call has no gate, and runs nothing.
        const createGate = (kind: OpenUiToolCall['kind'], tools: string[]) =>
            chatModel && !isEmpty(tools)
                ? new OpenUiToolGate({chatModel, tools, kind, messageId, signal, onToolCall})
                : null;
        const queryGate = createGate('query', queryTools);
        this.mutationGate = createGate('mutation', mutationTools);
        this.queryManager = createQueryManager(
            queryGate
                ? {callTool: async (name, args) => (await queryGate.prepareAsync(name, args))()}
                : null
        );
        // A mutation runs only the call that the user's click prepared, never one that the
        // manager names.
        this.mutationManager = createQueryManager({
            callTool: async (name, args) => {
                const approved = this.approvedMutation;
                throwIf(
                    !approved || approved.tool !== name || approved.args !== args,
                    `Mutation cannot run '${name}'. It is not the call the user started.`
                );
                return approved.run();
            }
        });

        this.store.subscribe(() => {
            if (this.isInitializing) return;
            this.hasUserActed = true;
            this.noteStateChange();
            this.syncQueriesSoon();
        });
        this.queryManager.subscribe(() => this.noteQueryChange());
        this.mutationManager.subscribe(() => this.noteQueryChange());

        // A program refreshes on a timer only while its reply is the latest of the chat.
        if (chatModel) {
            this.addReaction({
                track: () => this.isLatestReply,
                run: () => this.syncQueriesSoon()
            });
        }
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
     *
     * @throws if the program would take too long to evaluate - see {@link measureProgram}.
     */
    evaluateProgram(): OpenUiEvaluation {
        this.plans.clear();
        this.checkSize();

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

        // A query or mutation that failed keeps its defaults, so say so with the rest.
        const callErrors = [this.queryManager, this.mutationManager].flatMap(
            it => it.getSnapshot().__openui_errors
        );
        return {
            root,
            errors: compact([
                ...[...errors, ...callErrors].map(it => it.message),
                this.isOverCallLimit ? this.callLimitMessage : null
            ])
        };
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
     * The kit action for the steps of an action expression, with the plan that a click runs. One
     * step that is a kit action is that action, with no plan. Anything else is a `state` action,
     * which names the plan by `id` and says what it does.
     *
     * Every value of the plan is fixed here: the value of each `@Set`, and the tool and the
     * arguments of each mutation. The summary states each one in full, and a click runs the same
     * ones. So a step cannot change what a later step does after the user saw the summary.
     *
     * Null for steps the user could not review: too many, a summary too long to show in full,
     * more than one message, or a mutation whose tool is not a name.
     *
     * Call {@link registerAction} for a `state` action once it has passed its checks.
     */
    createAction(id: string, steps: OpenUiStep[]): {action: ChatUiAction; plan: OpenUiPlanStep[]} {
        if (isEmpty(steps) || steps.length > MAX_STEPS) return null;
        if (steps.length === 1 && steps[0].type === 'action') {
            return {action: steps[0].action, plan: null};
        }

        // A step that data wrote, in place of the parser, can hold an expression that throws.
        let plan: OpenUiPlanStep[];
        try {
            plan = steps.map(it => this.toPlanStep(it));
        } catch {
            return null;
        }
        const sends = plan.filter(it => it?.type === 'action' && it.action.type === 'send');
        // A second message would go nowhere, as the chat is busy with the first.
        if (plan.some(it => it == null) || sends.length > 1) return null;

        const summary = plan
            .map((step, idx) => {
                const text = describePlanStep(step);
                return idx === 0 ? text : lowerFirst(text);
            })
            .join(', then ');
        return summary.length <= CHAT_UI_MAX_SUMMARY_LENGTH
            ? {action: {type: 'state', id, summary}, plan}
            : null;
    }

    /** Hold the plan of a `state` action, for the click that runs it. */
    registerAction(stateAction: ChatUiStateAction, plan: OpenUiPlanStep[]) {
        this.plans.set(stateAction.id, {steps: plan, summary: stateAction.summary});
    }

    /**
     * Run a `state` action: the steps of its plan, in order, with the values its summary showed.
     * An action that the runtime does not hold, or whose summary differs from the one the user
     * saw, is refused.
     *
     * Everything the plan needs is checked before its first step runs: the chat is free for a
     * message or a mutation, each URL is allowed, and each mutation may run, with the user's
     * approval where its tool needs one. So a plan that cannot finish changes nothing. A tool
     * that fails as it runs still stops the steps after it.
     */
    async runActionAsync(
        stateAction: ChatUiStateAction,
        context: ChatPartRenderContext
    ): Promise<unknown> {
        const plan = this.plans.get(stateAction.id);
        if (!plan || plan.summary !== stateAction.summary) {
            throw new Error('This action is out of date - the program has changed.');
        }

        const mutations = await this.prepareAsync(plan.steps);
        this.hasUserActed = true;
        for (const step of plan.steps) {
            switch (step.type) {
                case 'set':
                    this.store.set(step.target, step.value);
                    break;
                case 'reset': {
                    const defaults = this.program?.stateDeclarations ?? {};
                    step.targets.forEach(target =>
                        this.store.set(target, getOwn(defaults, target) ?? null, {pristine: true})
                    );
                    break;
                }
                case 'refresh':
                    // A program that was waiting for the user runs its queries from here on.
                    if (this.hasSynced) {
                        this.queryManager.invalidate([step.statementId]);
                    } else {
                        this.syncQueriesSoon();
                    }
                    break;
                case 'mutation':
                    if (!(await this.runMutationAsync(step, mutations.get(step)))) return null;
                    break;
                case 'action':
                    await this.catalog.runActionAsync(step.action, context);
                    break;
            }
        }
        return null;
    }

    override destroy() {
        this.abortController.abort();
        this.queryManager.dispose();
        this.mutationManager.dispose();
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

    // True unless the chat holds a later reply than the one with the program. Observable.
    // A message the chat does not hold, as in a transcript, counts as the latest.
    private get isLatestReply(): boolean {
        const messages = this.chatModel?.messages ?? [],
            idx = findLastIndex(messages, it => it.id === this.messageId);
        return idx < 0 || !messages.slice(idx + 1).some(it => it.role === 'assistant');
    }

    private get callCount(): number {
        const {program} = this;
        return (program?.queryStatements?.length ?? 0) + (program?.mutationStatements?.length ?? 0);
    }

    private get isOverCallLimit(): boolean {
        return this.callCount > this.maxCalls;
    }

    private get callLimitMessage(): string {
        return (
            `The program holds ${this.callCount} Query and Mutation statements, and may hold ` +
            `at most ${this.maxCalls}. None of them runs.`
        );
    }

    // Refuse a program whose evaluation would hang the page. The measure counts each shared
    // expression at each use, and the template of an `@Each` once per item.
    private checkSize() {
        const {program} = this;
        if (!program) return;

        const calls = [...(program.queryStatements ?? []), ...(program.mutationStatements ?? [])],
            measure = (parts: unknown[]) => measureProgram(parts, list => this.getListLength(list)),
            size = measure([
                program.root,
                program.rootExpression,
                ...calls.flatMap(it => Object.values(it))
            ]);
        throwIf(
            size.eachDepth > MAX_EACH_DEPTH,
            `This program nests @Each ${size.eachDepth} deep, and may nest it at most ` +
                `${MAX_EACH_DEPTH} deep.`
        );
        throwIf(
            !(size.values <= MAX_VALUES),
            'This program is too large to evaluate: its expressions expand to more than ' +
                `${MAX_VALUES} values.`
        );
    }

    // The number of items in the list of an `@Each`. A list written out is counted. A small
    // expression is evaluated, as it is cheap. Any other is taken as a list of some length.
    private getListLength(list: ASTNode): number {
        if (list?.k === 'Arr') return list.els.length;
        const {values} = measureProgram([list], () => ASSUMED_LIST_LENGTH);
        if (values > MAX_LIST_EXPRESSION) return ASSUMED_LIST_LENGTH;
        try {
            const value = this.evaluateNode(list);
            return isArray(value) ? value.length : ASSUMED_LIST_LENGTH;
        } catch {
            return ASSUMED_LIST_LENGTH;
        }
    }

    // The result of a mutation, or of a query, or the query's defaults before it first runs, as
    // while the program streams.
    private getResult(name: string): unknown {
        const {queryManager, mutationManager, program} = this,
            ret = mutationManager.getMutationResult(name) ?? queryManager.getResult(name);
        if (ret != null) return ret;

        if (program?.mutationStatements?.some(it => it.statementId === name)) return IDLE;
        const statement = program?.queryStatements?.find(it => it.statementId === name);
        return statement?.defaultsAST ? this.evaluateNode(statement.defaultsAST) : null;
    }

    // A step with each value it uses evaluated now, or null for a step that cannot run.
    private toPlanStep(step: OpenUiStep): OpenUiPlanStep {
        switch (step.type) {
            case 'set':
                return {
                    type: 'set',
                    target: step.target,
                    value: toJson(this.evaluateNode(step.valueAST))
                };
            case 'reset':
                return step;
            case 'run': {
                const {statementId} = step;
                if (step.refType === 'query') return {type: 'refresh', statementId};
                const {tool, args} = this.getMutation(statementId);
                return tool ? {type: 'mutation', statementId, tool, args} : null;
            }
            case 'action':
                return step;
        }
    }

    // The tool and the arguments of a mutation, as the state now gives them. The tool is null
    // unless it is a name.
    private getMutation(statementId: string): {tool: string; args: PlainObject} {
        const statement = this.program?.mutationStatements?.find(
                it => it.statementId === statementId
            ),
            tool = statement?.toolAST ? this.evaluateNode(statement.toolAST) : null,
            args = statement?.argsAST ? toJson(this.evaluateNode(statement.argsAST)) : null;
        return {
            tool: isString(tool) && tool ? tool : null,
            args: isPlainObject(args) ? (args as PlainObject) : {}
        };
    }

    // Check all that a plan needs before any step runs, so that a plan which cannot finish
    // changes nothing. Returns the call that each mutation step may make.
    private async prepareAsync(
        steps: OpenUiPlanStep[]
    ): Promise<Map<OpenUiPlanStep, () => Promise<unknown>>> {
        const {chatModel, catalog, mutationGate} = this,
            ret = new Map<OpenUiPlanStep, () => Promise<unknown>>();

        for (const step of steps) {
            if (step.type === 'action' && step.action.type === 'send') {
                throwIf(!chatModel, "No chat to send to - a 'send' action needs a ChatModel.");
                throwIf(
                    chatModel.isBusy || !!chatModel.sendBlockedReason,
                    chatModel.sendBlockedReason ?? 'Wait for the reply to finish.'
                );
            }
            if (step.type === 'action' && step.action.type === 'openUrl') {
                const {url} = step.action;
                throwIf(!catalog.isUrlAllowed(url), `URL not allowed: ${url}`);
            }
        }

        // Approvals last, so that the user is asked only for a plan that can run.
        for (const step of steps) {
            if (step.type !== 'mutation') continue;
            throwIf(this.isOverCallLimit, this.callLimitMessage);
            throwIf(!mutationGate, `Mutation cannot run '${step.tool}'. No tools are allowed.`);
            ret.set(step, await mutationGate.prepareAsync(step.tool, step.args));
        }
        return ret;
    }

    // Run the tool of a mutation, with the tool and the arguments its button showed. False if
    // the call fails.
    private async runMutationAsync(
        step: Extract<OpenUiPlanStep, {type: 'mutation'}>,
        run: () => Promise<unknown>
    ): Promise<boolean> {
        const {mutationManager} = this,
            {statementId, tool, args} = step;

        // The manager calls the tool it holds for the statement, so give it the one shown.
        mutationManager.registerMutations(this.getMutationNodes({[statementId]: tool}));
        this.approvedMutation = {tool, args, run};
        try {
            return await mutationManager.fireMutation(statementId, args);
        } finally {
            this.approvedMutation = null;
        }
    }

    private getMutationNodes(tools: Record<string, string> = {}) {
        return (this.program?.mutationStatements ?? []).map(({statementId}) => ({
            statementId,
            toolName: getOwn(tools, statementId) ?? this.getMutation(statementId).tool ?? ''
        }));
    }

    // Queries run outside of a render, as each run notifies the observers of the results.
    private syncQueriesSoon() {
        if (this.isSyncPending) return;
        this.isSyncPending = true;
        queueMicrotask(() => {
            this.isSyncPending = false;
            if (this.isDestroyed) return;
            try {
                this.syncQueries();
            } catch (e) {
                logError(['Could not run the queries of an OpenUI program', e], this);
            }
        });
    }

    // A query runs once its program is complete, and again when a `$variable` it reads changes.
    // A program in an older reply waits for the user: it runs its queries once they change a
    // value or click a button in it. Only the latest reply refreshes on a timer.
    private syncQueries() {
        const {program, isComplete, queryManager, mutationManager, isLatestReply} = this;
        if (!program || !isComplete) return;
        if (!isLatestReply && !this.hasUserActed && !this.hasSynced) return;

        if (this.isOverCallLimit) {
            warnOnce(this.callLimitMessage, this.callLimitMessage, 'OpenUiRuntime');
            queryManager.evaluateStatements([], this.evaluationContext);
            mutationManager.registerMutations([]);
            return;
        }

        this.hasSynced = true;
        mutationManager.registerMutations(this.getMutationNodes());
        const statements = program.queryStatements.map(statement => {
            if (!statement.refreshAST) return statement;
            // A model sets the interval, so hold it between a floor and a ceiling.
            const seconds = isLatestReply ? this.getRefreshSeconds(statement.refreshAST) : 0;
            return {...statement, refreshAST: {k: 'Num', v: seconds} as ASTNode};
        });
        queryManager.evaluateStatements(statements, this.evaluationContext);
    }

    // The seconds between two refreshes of a query, or 0 for none. An interval that is not a
    // positive number is none. One past the ceiling would overflow a timer, which then fires at
    // once and without end.
    private getRefreshSeconds(node: ASTNode): number {
        const seconds = this.evaluateNode(node);
        return isFinite(seconds) && (seconds as number) > 0
            ? clamp(seconds as number, this.minRefreshSeconds, MAX_REFRESH_SECONDS)
            : 0;
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
const MAX_STEPS = 8,
    MAX_REFRESH_SECONDS = 24 * 60 * 60,
    // Most values one evaluation may visit. An evaluation of this size takes a few milliseconds.
    MAX_VALUES = 100_000,
    MAX_EACH_DEPTH = 3,
    // The items taken for a list whose length is not known until it evaluates, such as a field
    // of the loop variable of an outer `@Each`.
    ASSUMED_LIST_LENGTH = 100,
    // The largest list expression that is evaluated to count its items.
    MAX_LIST_EXPRESSION = 1000;

// What a mutation reads as before its first run.
const IDLE = {status: 'idle'};

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

// What a step of a plan does, in full. No value is cut short, as a click runs the value.
function describePlanStep(step: OpenUiPlanStep): string {
    switch (step.type) {
        case 'set':
            return `Sets ${step.target} to ${JSON.stringify(step.value)}`;
        case 'reset':
            return `Resets ${step.targets.join(', ')}`;
        case 'refresh':
            return `Refreshes ${step.statementId}`;
        case 'mutation':
            return isEmpty(step.args)
                ? `Runs the tool ${step.tool}`
                : `Runs the tool ${step.tool} with ${JSON.stringify(step.args)}`;
        case 'action':
            return describeChatUiAction(step.action);
    }
}

// A value as plain JSON, so that the value a summary shows is the value a click uses. A value
// that JSON cannot hold, such as a function, is null.
function toJson(value: unknown): unknown {
    try {
        return JSON.parse(JSON.stringify(value) ?? 'null');
    } catch {
        return null;
    }
}
