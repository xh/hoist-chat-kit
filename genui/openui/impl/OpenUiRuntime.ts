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
    type QueryNode,
    type Store
} from '@openuidev/lang-core';
import {HoistBase, type PlainObject} from '@xh/hoist/core';
import {action, observable} from '@xh/hoist/mobx';
import {logError, throwIf} from '@xh/hoist/utils/js';
import {clamp, compact, findLastIndex, isEmpty, isFinite, lowerFirst, mapValues} from 'lodash';
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
import {hasWhitespaceRun, quoteForDisplay} from '../../impl/displayText';
import {toOpenUrlAction, toSendAction, type OpenUiStep} from '../OpenUiActions';
import {isOpenUiActionProp, type OpenUiLibrary} from '../OpenUiLibrary';
import {prepareActions} from './actionSyntax';
import {getCallBudget, MAX_QUERY_PROGRAMS, type OpenUiCallBudget} from './callBudget';
import {toSafeValue} from './heldValue';
import {OpenUiToolGate, toJson, type OpenUiToolCall} from './OpenUiToolGate';
import {
    measureExpression,
    measureValue,
    scalarShape,
    SizeBudget,
    SizeLimitError,
    widest,
    type ValueShape
} from './programSize';
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

    /** The least seconds between two automatic refreshes of a query. Default 10, at least 1. */
    minRefreshSeconds?: number;

    /** Most `Query()` statements in one program. Default 8. */
    maxCalls?: number;

    /** Most calls that all the programs of the chat may start in a minute. Default 60. */
    maxCallsPerMinute?: number;

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
    | {type: 'action'; action: ChatUiAction};

/**
 * The state of one OpenUI Lang program: its `$variables`, and the results of its queries. It runs
 * on lang-core's own store, evaluator and query manager, and makes their changes observable to
 * MobX, so that a Hoist component which reads them renders again.
 *
 * lang-core's store and query manager notify plain listeners. Each notice bumps an observable
 * version, and each read of the state or of a result reads that version first. An observer that
 * evaluates a program therefore depends on the version, and runs again when it changes.
 *
 * A program cannot change data. It has no `Mutation()`: a reference to one reads as idle, and a
 * `@Run` of one gives an action that cannot run.
 * @internal
 */
export class OpenUiRuntime extends HoistBase implements ChatUiState {
    readonly store: Store = createStore();

    /** Reads the store and the query results, as lang-core's evaluator asks for them. */
    readonly evaluationContext: EvaluationContext = {
        getState: name => {
            this.track(this.stateVersion);
            return toSafeValue(this.store.get(name));
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

    // Runs the queries. With no chat or no tools allowed, it has no gate, and runs nothing.
    private readonly queryManager: QueryManager;
    private readonly budget: OpenUiCallBudget;
    private readonly abortController = new AbortController();

    // What lang-core's evaluator reads of a library: which props are two-way bindings.
    private readonly evalLibrary: Library;

    @observable private accessor stateVersion: number = 0;
    @observable private accessor queryVersion: number = 0;

    // The program as last parsed, with its actions prepared, its text, and whether it has
    // streamed in full.
    private program: ParseResult = null;
    private parsed: ParseResult = null;
    private programText: string = null;
    private isComplete: boolean = false;

    // True while the store takes the defaults of a new parse. The render that reads them is the
    // one that set them, so no observer needs a notice.
    private isInitializing: boolean = false;
    private isSyncPending: boolean = false;

    // True if the sync that is pending was asked for by the user, the program or the chat, and
    // not only by a query result.
    private isSyncExternal: boolean = false;

    // Each query as the query manager last got it, and when a query result last changed its
    // arguments, by statement id - see `holdChains`.
    private readonly applied = new Map<string, {key: string; node: QueryNode}>();
    private readonly chained = new Map<string, number[]>();

    // True once the user changed a value or clicked a button of the program, and once its
    // queries first ran.
    private hasUserActed: boolean = false;
    private hasSynced: boolean = false;

    // One pass of the gate - see `beginPass`.
    private pass: GatePass = null;

    // The steps of each state action of the program as last resolved, by action id.
    private readonly plans = new Map<string, {steps: OpenUiPlanStep[]; summary: string}>();

    constructor(config: OpenUiRuntimeConfig) {
        super();
        const {
                catalog,
                library,
                context,
                queryTools = [],
                minRefreshSeconds = 10,
                maxCalls = 8,
                maxCallsPerMinute = 60,
                onToolCall
            } = config,
            chatModel = context?.chatModel ?? null,
            messageId = context?.messageId ?? null,
            {signal} = this.abortController;
        this.catalog = catalog;
        this.library = library;
        this.chatModel = chatModel;
        this.messageId = messageId;
        // A program sets the interval, so no setting of the app lets it run without a pause.
        this.minRefreshSeconds = Math.max(minRefreshSeconds, MIN_REFRESH_SECONDS);
        this.maxCalls = maxCalls;
        this.evalLibrary = createEvalLibrary(catalog, library);
        this.budget = chatModel ? getCallBudget(chatModel) : null;

        const gate =
            chatModel && !isEmpty(queryTools)
                ? new OpenUiToolGate({
                      chatModel,
                      tools: queryTools,
                      messageId,
                      signal,
                      budget: this.budget,
                      maxCallsPerMinute,
                      onToolCall
                  })
                : null;
        this.queryManager = createQueryManager(
            gate ? {callTool: (name, args) => gate.callAsync(name, args)} : null
        );

        this.store.subscribe(() => {
            if (this.isInitializing) return;
            this.hasUserActed = true;
            this.noteStateChange();
            this.syncQueriesSoon();
        });
        // A query whose arguments read the result of another runs again when that one changes.
        this.queryManager.subscribe(() => {
            this.noteQueryChange();
            if (this.program?.queryStatements?.some(it => !isEmpty(it.waitFor))) {
                this.syncQueriesSoon(false);
            }
        });

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
        if (result !== this.parsed) {
            this.parsed = result;
            this.program = this.prepareProgram(result);
        }
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
     * @throws if the program would take too long to evaluate - see {@link measureExpression}.
     */
    evaluateProgram(): OpenUiEvaluation {
        this.plans.clear();
        this.beginPass();
        this.admit([this.program?.root, this.program?.rootExpression]);

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

        // A query that failed keeps its defaults, so say so with the rest.
        const callErrors = this.queryManager.getSnapshot().__openui_errors;
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
        return {
            value: field.value,
            binding: {
                // lang-core evaluates the expression of the binding as it writes.
                // It reads the new value as `$value`.
                set: next => {
                    const pass = this.beginPass();
                    // Any other read of `$value` gets what the state holds, so count the larger.
                    pass.shapes.set(
                        'state|$value',
                        widest(
                            measureValue(toSafeValue(next), pass.held, pass.seen),
                            this.getHeldShape('$value', 'state')
                        )
                    );
                    this.admit([this.program?.root, this.program?.rootExpression]);
                    field.setValue(next);
                }
            }
        };
    }

    /**
     * The kit action for the steps of an action expression, with the plan that a click runs. One
     * step that sends a message or opens a URL is that action, with no plan. Anything else is a
     * `state` action, which names the plan by `id` and says what it does.
     *
     * The steps evaluate here, in order, and each sees the values that the steps before it set.
     * So `Action([@Set($id, row.id), @ToAssistant("Open " + $id)])` sends the id of its own row.
     * Every value is then fixed. The summary states each one in full, and a click runs the same
     * ones.
     *
     * An action that the user could not review, or that the kit cannot run, comes back with a
     * `disabledReason`, for a button to show in place of a click that does something else: too
     * many steps, a summary too long to show in full, more than one message, text with a long
     * run of whitespace, a step that data wrote, or a `@Run` of a mutation.
     *
     * Call {@link registerAction} for a `state` action with a plan, once it passed its checks.
     */
    createAction(id: string, steps: OpenUiStep[]): {action: ChatUiAction; plan: OpenUiPlanStep[]} {
        if (isEmpty(steps)) return null;
        const refuse = (reason: string) => ({
            action: {type: 'state', id, summary: reason, disabledReason: reason} as ChatUiAction,
            plan: null as OpenUiPlanStep[]
        });
        if (steps.length > MAX_STEPS) return refuse(TOO_LONG);

        let plan: OpenUiPlanStep[];
        try {
            plan = this.toPlan(steps);
        } catch (e) {
            return refuse(e instanceof ActionRefusal ? e.message : NOT_VALID);
        }
        const sends = plan.filter(it => it.type === 'action' && it.action.type === 'send');
        // A second message would go nowhere, as the chat is busy with the first.
        if (sends.length > 1) return refuse(TWO_MESSAGES);
        if (plan.length === 1 && plan[0].type === 'action') {
            return {action: plan[0].action, plan: null};
        }

        const summary = plan
            .map((step, idx) => {
                const text = describePlanStep(step);
                return idx === 0 ? text : lowerFirst(text);
            })
            .join(', then ');
        return summary.length <= CHAT_UI_MAX_SUMMARY_LENGTH
            ? {action: {type: 'state', id, summary}, plan}
            : refuse(TOO_LONG);
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
     * message, and each URL is allowed. So a plan that cannot finish changes nothing.
     */
    async runActionAsync(
        stateAction: ChatUiStateAction,
        context: ChatPartRenderContext
    ): Promise<unknown> {
        const plan = this.plans.get(stateAction.id);
        if (!plan || plan.summary !== stateAction.summary) {
            throw new Error('This action is out of date - the program has changed.');
        }

        this.checkPlan(plan.steps);
        this.hasUserActed = true;
        for (const step of plan.steps) {
            switch (step.type) {
                case 'set':
                    this.store.set(step.target, step.value);
                    break;
                case 'reset':
                    step.targets.forEach(target =>
                        this.store.set(target, this.getDefault(target), {pristine: true})
                    );
                    break;
                case 'refresh':
                    // A program that was waiting for the user runs its queries from here on.
                    if (this.hasSynced) {
                        this.queryManager.invalidate([step.statementId]);
                    } else {
                        this.syncQueriesSoon();
                    }
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
        this.budget?.release(this.messageId, this);
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

    private evaluateNode(node: ASTNode, ctx: EvaluationContext = this.evaluationContext) {
        return evaluate(node, ctx);
    }

    // The program with each action argument taken only from action syntax, and made lazy.
    private prepareProgram(result: ParseResult): ParseResult {
        const {library} = this,
            opts = {
                isActionProp: (typeName: string, key: string) =>
                    isOpenUiActionProp(library, typeName, key),
                isComponent: (name: string) => !!getOwn(library.components, name)
            };
        return {
            ...result,
            root: result.root ? prepareActions(result.root, opts) : result.root,
            ...(result.rootExpression
                ? {rootExpression: prepareActions(result.rootExpression, opts)}
                : {})
        };
    }

    // True if the chat holds the reply with the program, and no later one. A message that the
    // chat does not hold, as in a transcript, is not the latest. Observable.
    private get isLatestReply(): boolean {
        const messages = this.chatModel?.messages ?? [],
            idx = findLastIndex(messages, it => it.id === this.messageId);
        return idx >= 0 && !messages.slice(idx + 1).some(it => it.role === 'assistant');
    }

    private get callCount(): number {
        return this.program?.queryStatements?.length ?? 0;
    }

    private get isOverCallLimit(): boolean {
        return this.callCount > this.maxCalls;
    }

    private get callLimitMessage(): string {
        return (
            `The program holds ${this.callCount} Query statements, and may hold at most ` +
            `${this.maxCalls}. None of them runs.`
        );
    }

    private getDefault(name: string): unknown {
        return getOwn(this.program?.stateDeclarations, name) ?? null;
    }

    // Start a pass of the gate. Each time the runtime is about to hand lang-core something to
    // evaluate, it starts a pass, measures what will evaluate, and goes on only if the measure
    // is under the cap. A pass keeps what it measured of the state and the query results, so
    // that each value is walked once.
    private beginPass(): GatePass {
        this.pass = {
            held: new SizeBudget(),
            defaults: new SizeBudget(),
            seen: new Map(),
            shapes: new Map(),
            values: new Map()
        };
        return this.pass;
    }

    // Measure expressions that are about to evaluate, against one total. Throws for a total
    // past the cap, before any of them evaluates.
    private admit(parts: unknown[]) {
        const budget = new SizeBudget(),
            held = (name: string, kind: 'state' | 'query') => this.getHeldShape(name, kind);
        parts.forEach(part => {
            if (part == null) return;
            budget.spend(measureExpression(part, {budget, held}).size);
        });
    }

    // The shape of what a `$variable` or a query holds in this pass. All that the program reads
    // counts toward one total, with a value that two names hold counted for each.
    private getHeldShape(name: string, kind: 'state' | 'query'): ValueShape {
        const pass = this.pass ?? this.beginPass(),
            key = `${kind}|${name}`,
            known = pass.shapes.get(key);
        if (known) return known;

        // Set first, so that the defaults of a query that read the query itself do not loop.
        pass.shapes.set(key, scalarShape());
        const value = kind === 'state' ? toSafeValue(this.store.get(name)) : this.getResult(name),
            ret = measureValue(value, pass.held, pass.seen);
        pass.shapes.set(key, ret);
        return ret;
    }

    // The result of a query, or its defaults before it first runs, as while the program
    // streams. The defaults are measured before they evaluate, once per pass. A `Mutation()`
    // never runs, so it reads as idle.
    private getResult(name: string): unknown {
        const {queryManager, program} = this,
            pass = this.pass ?? this.beginPass(),
            ret = queryManager.getResult(name);
        if (ret != null) return toSafeValue(ret);
        if (pass.values.has(name)) return pass.values.get(name);
        if (program?.mutationStatements?.some(it => it.statementId === name)) return IDLE;

        const statement = program?.queryStatements?.find(it => it.statementId === name);
        // Set first, so that defaults which read their own query do not loop.
        pass.values.set(name, null);
        if (!statement?.defaultsAST) return null;

        const held = (ref: string, kind: 'state' | 'query') => this.getHeldShape(ref, kind),
            shape = measureExpression(statement.defaultsAST, {budget: pass.defaults, held});
        pass.defaults.spend(shape.size);
        const value = toSafeValue(this.evaluateNode(statement.defaultsAST));
        pass.values.set(name, value);
        return value;
    }

    // The plan of an action: each step with every value it uses evaluated now, in order. A step
    // sees the values that the steps before it set, read ahead of the state. That includes a
    // null, which the `extraScope` of lang-core's evaluator would pass over.
    private toPlan(steps: OpenUiStep[]): OpenUiPlanStep[] {
        const scope = new Map<string, unknown>(),
            {evaluationContext} = this,
            ctx: EvaluationContext = {
                ...evaluationContext,
                getState: name =>
                    scope.has(name) ? scope.get(name) : evaluationContext.getState(name)
            },
            queries = this.program?.queryStatements ?? [];

        return steps.map((step): OpenUiPlanStep => {
            switch (step.type) {
                case 'set': {
                    const value = toJson(this.evaluateNode(step.valueAST, ctx));
                    if (hasWhitespaceRun(value)) throw new ActionRefusal(HIDDEN_TEXT);
                    scope.set(step.target, value);
                    return {type: 'set', target: step.target, value};
                }
                case 'reset':
                    step.targets.forEach(it => scope.set(it, this.getDefault(it)));
                    return step;
                case 'send': {
                    const value = this.evaluateNode(step.valueAST, ctx) as PlainObject,
                        send = toSendAction(value?.message, value?.context);
                    if (!send) throw new ActionRefusal(HIDDEN_TEXT);
                    return {type: 'action', action: send};
                }
                case 'openUrl': {
                    const url = this.evaluateNode(step.valueAST, ctx),
                        open = toOpenUrlAction(url);
                    if (!open) {
                        throw new ActionRefusal(hasWhitespaceRun(url) ? HIDDEN_TEXT : NOT_VALID);
                    }
                    return {type: 'action', action: open};
                }
                case 'run': {
                    const {statementId} = step;
                    if (step.refType === 'mutation') throw new ActionRefusal(CHANGES_DATA);
                    if (!queries.some(it => it.statementId === statementId)) {
                        throw new ActionRefusal(NOT_VALID);
                    }
                    return {type: 'refresh', statementId};
                }
                default:
                    throw new ActionRefusal(NOT_VALID);
            }
        });
    }

    // Check all that a plan needs before any step runs, so that a plan which cannot finish
    // changes nothing.
    private checkPlan(steps: OpenUiPlanStep[]) {
        const {chatModel, catalog} = this;
        for (const step of steps) {
            if (step.type !== 'action') continue;
            if (step.action.type === 'send') {
                throwIf(!chatModel, "No chat to send to - a 'send' action needs a ChatModel.");
                throwIf(
                    chatModel.isBusy || !!chatModel.sendBlockedReason,
                    chatModel.sendBlockedReason ?? 'Wait for the reply to finish.'
                );
            }
            if (step.action.type === 'openUrl') {
                const {url} = step.action;
                throwIf(!catalog.isUrlAllowed(url), `URL not allowed: ${url}`);
            }
        }
    }

    // Queries run outside of a render, as each run notifies the observers of the results.
    // `isExternal` is false for a sync that a query result asks for.
    private syncQueriesSoon(isExternal: boolean = true) {
        this.isSyncExternal ||= isExternal;
        if (this.isSyncPending) return;
        this.isSyncPending = true;
        queueMicrotask(() => {
            const wasExternal = this.isSyncExternal;
            this.isSyncPending = false;
            this.isSyncExternal = false;
            if (this.isDestroyed) return;
            try {
                this.syncQueries(wasExternal);
            } catch (e) {
                logError(['Could not run the queries of an OpenUI program', e], this);
            }
        });
    }

    // A query runs once its program is complete, and again when a `$variable` it reads changes.
    // A program that is not in the latest reply waits for the user: it runs its queries once
    // they change a value or click a button in it. Only the latest reply refreshes on a timer.
    //
    // The runtime evaluates the tool, the arguments and the interval of each query itself, once
    // the gate has measured them. lang-core's query manager gets the values, and evaluates
    // nothing.
    private syncQueries(isExternal: boolean = true) {
        const {program, isComplete, queryManager, isLatestReply, budget, messageId} = this;
        if (!program || !isComplete || isEmpty(program.queryStatements)) return;
        if (!isLatestReply && !this.hasUserActed && !this.hasSynced) return;

        // A program takes its place among those of the reply that may run queries, whether or
        // not its own queries then run.
        const isAdmitted = budget?.admit(messageId, this) ?? true;
        let nodes: QueryNode[];
        const refusal = !isAdmitted
            ? `Only the first ${MAX_QUERY_PROGRAMS} programs of a reply run their queries.`
            : this.isOverCallLimit
              ? this.callLimitMessage
              : null;
        if (refusal) {
            warnOnce(`${messageId}|${refusal}`, refusal, 'OpenUiRuntime');
            queryManager.evaluateQueries([]);
            return;
        }

        // Arguments past the cap do not evaluate. The queries stay as they last ran: to clear
        // them would drop the result that made the arguments large, and so run them again.
        try {
            nodes = this.toQueryNodes();
        } catch (e) {
            if (!(e instanceof SizeLimitError)) throw e;
            warnOnce(`${messageId}|${e.message}`, e.message, 'OpenUiRuntime');
            return;
        }

        this.hasSynced = true;
        queryManager.evaluateQueries(this.holdChains(nodes, isExternal));
    }

    // Bound what the results of queries can start with no action by the user. A result may
    // change the arguments of a query, which then runs again, and its result may change more.
    // Each query takes such a change a few times in a window. Past that it keeps the arguments
    // it last ran with, until the user, the program or a later window lets it go on. So a
    // program that feeds results back into arguments cannot call a tool in a loop.
    private holdChains(nodes: QueryNode[], isExternal: boolean): QueryNode[] {
        const {applied, chained, messageId} = this,
            now = Date.now(),
            windowMs = this.minRefreshSeconds * 1000;
        if (isExternal) chained.clear();

        return nodes.map(node => {
            const {statementId} = node,
                key = JSON.stringify([node.toolName, node.args, node.deps, node.refreshInterval]),
                last = applied.get(statementId);
            if (last && last.key !== key && !isExternal) {
                const times = (chained.get(statementId) ?? []).filter(it => now - it < windowMs);
                if (times.length >= MAX_CHAINED_RUNS) {
                    const message =
                        `Query '${statementId}' keeps its arguments: the results of queries ` +
                        `changed them ${MAX_CHAINED_RUNS} times with no action by the user.`;
                    warnOnce(`${messageId}|${message}`, message, 'OpenUiRuntime');
                    return last.node;
                }
                chained.set(statementId, [...times, now]);
            }
            applied.set(statementId, {key, node});
            return node;
        });
    }

    // Each query with its tool, its arguments and its interval evaluated.
    private toQueryNodes(): QueryNode[] {
        const {queryStatements} = this.program,
            {isLatestReply, evaluationContext} = this;
        this.beginPass();
        this.admit(queryStatements.flatMap(it => [it.toolAST, it.argsAST, it.refreshAST]));

        return queryStatements.map(statement => {
            const {statementId, toolAST, argsAST, refreshAST, deps, complete, waitFor} = statement,
                held = Object.fromEntries(
                    (deps ?? []).map(it => [it, evaluationContext.getState(it)])
                );
            return {
                statementId,
                toolName: toolAST ? (this.evaluateNode(toolAST) as string) : '',
                args: argsAST ? this.evaluateNode(argsAST) : null,
                // The runtime evaluates the defaults as a program reads them - see `getResult`.
                defaults: null,
                // A model sets the interval, so hold it between a floor and a ceiling.
                refreshInterval:
                    refreshAST && isLatestReply ? this.getRefreshSeconds(refreshAST) : 0,
                deps: isEmpty(held) ? undefined : held,
                complete,
                waitFor
            };
        });
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
    // Times that the results of queries may change the arguments of one query, in one window
    // of the least refresh interval, with no action by the user.
    MAX_CHAINED_RUNS = 3,
    MIN_REFRESH_SECONDS = 1,
    MAX_REFRESH_SECONDS = 24 * 60 * 60;

// Why an action cannot run, for the user.
const NOT_VALID = 'This action is not valid, so it cannot run.',
    TOO_LONG = 'This action is too long to show in full, so it cannot run.',
    TWO_MESSAGES = 'This action sends more than one message, so it cannot run.',
    HIDDEN_TEXT = 'This action holds text that cannot be shown in full, so it cannot run.',
    CHANGES_DATA = 'This action would change data, which a program cannot do.';

// What one pass of the gate has measured and evaluated.
interface GatePass {
    // The total of what the state and the query results hold, of all that the pass has read.
    held: SizeBudget;

    // The total of what the defaults of the queries cost to evaluate.
    defaults: SizeBudget;

    // The shape of each object measured, so that a value which two names hold is walked once.
    seen: Map<object, ValueShape>;

    // The shape of what each `$variable` and each query holds, by kind and name.
    shapes: Map<string, ValueShape>;

    // The defaults of each query that has no result yet, by statement id, so that many reads
    // of one query evaluate its defaults once.
    values: Map<string, unknown>;
}

// Thrown for a step that the kit refuses, with the reason for the user.
class ActionRefusal extends Error {}

// What a mutation reads as. A program cannot run one.
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

// What a step of a plan does, in full. No value is cut short, as a click runs the value. Each
// value shows as JSON, with any character the user could not see as its code.
function describePlanStep(step: OpenUiPlanStep): string {
    switch (step.type) {
        case 'set':
            return `Sets ${step.target} to ${quoteForDisplay(step.value)}`;
        case 'reset':
            return `Resets ${step.targets.join(', ')}`;
        case 'refresh':
            return `Refreshes ${step.statementId}`;
        case 'action':
            return describeChatUiAction(step.action);
    }
}
