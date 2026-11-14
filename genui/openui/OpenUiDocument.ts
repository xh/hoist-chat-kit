import type {PlainObject} from '@xh/hoist/core';
import {
    isElementNode,
    isReactiveAssign,
    split,
    tokenize,
    type ActionPlan,
    type ASTNode,
    type ElementNode,
    type ParseResult,
    type ValidationError
} from '@openuidev/lang-core';
import {
    compact,
    dropRight,
    flattenDeep,
    forEach,
    isArray,
    isEmpty,
    isPlainObject,
    isString,
    last,
    omit,
    uniq
} from 'lodash';
import {getOwn} from '../../impl/LangUtils';
import {logWarn} from '@xh/hoist/utils/js';
import {formatError, propPath} from '../../impl/SchemaUtils';
import {describeChatUiAction, type ChatUiAction} from '../ChatUiAction';
import type {ChatUiCatalog} from '../ChatUiCatalog';
import type {ChatUiDocument, ChatUiElement} from '../ChatUiDocument';
import {elementPath} from '../impl/documentStructure';
import type {OpenUiRuntime} from './impl/OpenUiRuntime';
import {warnOnce} from './impl/warnOnce';
import {openUiToAction, toOpenUiSteps} from './OpenUiActions';
import type {OpenUiLibrary} from './OpenUiLibrary';

/** Options for {@link openUiToDocument}. */
export interface OpenUiTranslationOptions {
    /** True once the program has streamed in full. */
    complete: boolean;

    /**
     * The program text the result was parsed from. While the program streams, only the elements
     * of the statement the text ends in are partial, and the rest render as complete. Default
     * none: each element takes lang-core's `partial` flag, which marks every element partial
     * until the program is complete.
     */
    text?: string;

    /**
     * The catalog the library was built from. Where a component's action prop requires a
     * `label`, as the built-in card's actions do, the translation fills one: the text of a
     * `send`, cut to 40 characters, the host of an `openUrl`, or the name of an `app` action.
     * Default none: actions get no label.
     */
    catalog?: ChatUiCatalog;

    /**
     * The state of the program, for a result whose props that state has evaluated. A prop that
     * holds a two-way binding then takes its current value, with a binding in the element's
     * `bindings`, and an action that changes state becomes a `state` action.
     * @internal
     */
    runtime?: OpenUiRuntime;

    /**
     * True to log no warning about an action. For the translation of a program that also runs
     * with state, where the state reads each action again, and in full.
     * @internal
     */
    quiet?: boolean;
}

/** What {@link openUiToDocument} returns. */
export interface OpenUiTranslation {
    /** The program as a document. Its root is null while the program has no root. */
    document: ChatUiDocument;

    /**
     * True while the program streams: lang-core saw a cut-off program, or the stream has not
     * ended.
     */
    isPartial: boolean;

    /**
     * Parser errors about elements the document holds, or about no element, in the kit's
     * `path: message` form. lang-core has already dropped what each one names.
     */
    errors: string[];

    /**
     * Parser errors about statements lang-core dropped, by element id, in the kit's
     * `path: message` form. Pass them to {@link ChatUiCatalog.renderDocument} as
     * `elementErrors`, to render the stand-in for each one as a fallback that lists them. An
     * element whose statement writes an argument by name has an entry too.
     */
    elementErrors: Record<string, string[]>;

    /**
     * Id of the statement at the end of the text that is still being written, or null if the
     * last statement is closed: by a newline, or by the bracket that ends its call. Null with no
     * `text`.
     */
    openStatement: string;

    /** Names the program refers to and does not define. lang-core dropped each reference. */
    unresolved: string[];

    /** Names of the statements that nothing under the root refers to, so they do not render. */
    orphaned: string[];
}

/**
 * Turn what lang-core parsed from an OpenUI Lang program into a {@link ChatUiDocument}, which the
 * catalog checks and renders as it does any other answer.
 *
 * - A node with a `statementId` becomes the element of that id. A statement named after a member
 *   of every object, such as `constructor` or `__proto__`, takes the id `<name>$`. An inline node
 *   becomes `<parentId>.<prop>[<index>]`, or `<parentId>.<prop>` for one element alone in a prop.
 *   Its component is the catalog name of its OpenUI name.
 * - Element nodes in `children` move to the element's `children`, and those in a slot prop to
 *   its `slots`, as ids.
 * - An action expression in a prop becomes a {@link ChatUiAction} - see {@link openUiToAction}.
 *   A prop is dropped if it holds null, an action the kit cannot run, or another expression
 *   that lang-core left unevaluated, such as a reference or a number cut off as it streams.
 *   With a catalog, an action that the prop's action schema refuses, by its type or the pattern
 *   of its url, is dropped with a warning, and the element keeps its other actions. An action
 *   list left with no actions is empty, or dropped where the schema sets `minItems`.
 * - lang-core drops a statement it cannot render, such as one with an unknown component. A
 *   stand-in element with no props takes its place at the end of the root's children, and the
 *   statement's parser errors go in `elementErrors` under its id, so it renders as a fallback.
 *   Other parser errors go in `errors`: lang-core has already dropped the prop or inline node
 *   at fault, and the catalog checks what remains. While the program streams, a missing
 *   required prop of the statement still streaming is not an error.
 * - With `text`, a statement is complete once a newline closes it, or the bracket that ends its
 *   call. So a program that arrives whole, with no newline at its end, is complete. In the
 *   statement still being
 *   written, the value at the end of the last argument may be cut short. The last item of a list
 *   there is left out, and so is a key of an object with no value yet. The element then renders
 *   what has arrived, and never as a fallback for a value that is only half-written.
 * - With `text`, an argument written by name, as in `Stack([a], direction: "row")`, gives its
 *   statement an entry in `elementErrors`. lang-core reads the name as a reference and shifts
 *   the arguments after it, so the element would otherwise render with the wrong props.
 * - One value in a prop whose schema takes a list becomes a list of one, such as a single
 *   action in a list of actions.
 * - With a `runtime`, the result holds evaluated props. A prop that is a two-way binding takes
 *   its current value, with a binding in the element's `bindings`. An action is the plan that
 *   lang-core made of it: one kit action, or a `state` action for steps that act on state.
 */
export function openUiToDocument(
    result: ParseResult,
    library: OpenUiLibrary,
    opts: OpenUiTranslationOptions
): OpenUiTranslation {
    const {root, meta} = result,
        isPartial = meta.incomplete || !opts.complete,
        hasText = opts.text != null,
        program = hasText ? scanProgram(opts.text) : null,
        streamingStatement = isPartial ? (program?.openStatement ?? null) : null,
        isStreaming = (statementId: string) =>
            isPartial && (!hasText || statementId === streamingStatement);

    const elements: Record<string, ChatUiElement> = {},
        {runtime} = opts,
        toComponent = (typeName: string) => library.toCatalogName(typeName) ?? typeName;

    // `isTrailing` is true for the element at the end of the statement still being written. The
    // value at the end of its last argument may be cut short.
    const addElement = (
        node: ElementNode,
        syntheticId: string,
        parentStatement: string,
        isTrailing: boolean
    ) => {
        const {statementId, typeName} = node,
            ownId = toElementId(statementId),
            id = ownId != null && !Object.hasOwn(elements, ownId) ? ownId : syntheticId,
            statement = statementId ?? parentStatement,
            isPartialElement = hasText ? isStreaming(statement) : node.partial,
            isCut = statementId != null ? hasText && isStreaming(statementId) : isTrailing,
            lastKey = last(Object.keys(node.props)),
            element: ChatUiElement = {component: toComponent(typeName), props: {}};
        elements[id] = element;

        forEach(node.props, (value, key) => {
            const children = getChildNodes(library, typeName, key, value),
                isLast = isCut && key === lastKey;
            if (children) {
                const ids = children.map(([child, idx], position) =>
                    addElement(
                        child,
                        isArray(value) ? `${id}.${key}[${idx}]` : `${id}.${key}`,
                        statement,
                        isLast && position === children.length - 1
                    )
                );
                if (key === 'children') {
                    element.children = ids;
                } else {
                    element.slots = {...element.slots, [key]: ids};
                }
            } else if (runtime && isReactiveAssign(value)) {
                const bound = runtime.toBinding(key, value);
                if (bound.value != null) element.props[key] = bound.value;
                element.bindings = {...element.bindings, [key]: bound.binding};
            } else {
                const isAction = isActionProp(library, typeName, key),
                    prop = toPropValue(isLast && !isAction ? trimCutValue(value) : value, library, {
                        propSchema: getOwn(
                            opts.catalog?.getComponent(element.component)?.props?.properties,
                            key
                        ),
                        path: `${id}.${key}`,
                        // Warn of a refusal once its statement completes, not for a value still
                        // being written.
                        warn: !isPartialElement && !opts.quiet,
                        runtime,
                        isActionProp: isAction
                    });
                if (prop != null) element.props[key] = prop;
            }
        });
        element.isPartial = isPartialElement;
        return id;
    };
    const rootId = root
            ? addElement(root, toElementId(root.statementId) ?? 'root', null, false)
            : null,
        rootTakesChildren = root ? isChildListProp(library, root.typeName, 'children') : false;

    const errors: string[] = [],
        elementErrors: Record<string, string[]> = Object.create(null);

    // An argument written by name shifts the arguments after it into the wrong props. lang-core
    // reports nothing, so the element would render wrong. It renders as a fallback instead.
    program?.namedArguments.forEach((names, statementId) => {
        const id = toElementId(statementId);
        if (!Object.hasOwn(elements, id)) return;
        elementErrors[id] = names.map(name =>
            formatError(
                elementPath(id),
                `argument '${name}' is written by name - OpenUI Lang takes arguments by ` +
                    'position, so write only the value'
            )
        );
    });

    meta.errors.forEach(error => {
        const {statementId, component, code, severity, message} = error,
            id = toElementId(statementId);
        if (code === 'missing-required' && isStreaming(statementId)) return;

        const isDropped =
            rootTakesChildren &&
            id != null &&
            severity !== 'warning' &&
            (Object.hasOwn(elementErrors, id) || !Object.hasOwn(elements, id));
        if (!isDropped) {
            errors.push(formatError(id != null ? elementPath(id) : '', message));
            return;
        }
        if (!Object.hasOwn(elements, id)) {
            elements[id] = {component: toComponent(component), props: {}, isPartial: false};
            const rootElement = elements[rootId];
            rootElement.children = [...(rootElement.children ?? []), id];
        }
        (elementErrors[id] ??= []).push(formatError(toErrorPath(id, error), message));
    });

    return {
        document: {root: rootId, elements},
        isPartial,
        errors,
        elementErrors,
        openStatement: program?.openStatement ?? null,
        unresolved: uniq(meta.unresolved ?? []),
        orphaned: uniq(meta.orphaned ?? [])
    };
}

//------------------
// Implementation
//------------------
const REF_PREFIX = '#/$defs/',
    ACTION_REF = `${REF_PREFIX}ActionExpression`,
    // The key lang-core gives the pair still to come in an object cut short.
    PENDING_KEY = '?',
    MAX_SCANS = 50,
    MAX_LABEL_LENGTH = 40,
    AST_KINDS: ASTNode['k'][] = [
        'Comp',
        'Str',
        'Num',
        'Bool',
        'Null',
        'Arr',
        'Obj',
        'Ref',
        'Ph',
        'StateRef',
        'RuntimeRef',
        'BinOp',
        'UnaryOp',
        'Ternary',
        'Member',
        'Index',
        'Assign'
    ];

// Statement ids that name a member of every object. Each takes a `$` as its element id, so that
// no lookup of it finds the member.
const OBJECT_MEMBER_IDS = [
    '__proto__',
    'constructor',
    'prototype',
    'toString',
    'valueOf',
    'hasOwnProperty'
];

// The element id of a statement.
function toElementId(statementId: string): string {
    return OBJECT_MEMBER_IDS.includes(statementId) ? `${statementId}$` : statementId;
}

interface TokenTypes {
    lParen: number;
    rParen: number;
    lBrack: number;
    rBrack: number;
    lBrace: number;
    rBrace: number;
    colon: number;
    question: number;
}

let tokenTypes: TokenTypes;

const scans = new Map<string, ProgramScan>();

// What the text of a program shows that lang-core's result does not.
interface ProgramScan {
    // Id of the statement at the end of the text that no newline has closed: the one still being
    // written, while the program streams. Null if the last statement is closed.
    openStatement: string;

    // The names of the arguments written by name, as in `Stack([a], direction: "row")`, by the
    // id of the statement that holds them.
    namedArguments: Map<string, string[]>;
}

// A program is scanned once per text. Each change of state translates the same text again.
function scanProgram(text: string): ProgramScan {
    const cached = scans.get(text);
    if (cached) return cached;

    const statements = split(tokenize(text)),
        lastStatement = last(statements),
        namedArguments = new Map<string, string[]>();

    statements.forEach(({id, tokens}) => {
        const names = findNamedArguments(tokens);
        if (!isEmpty(names)) namedArguments.set(id, names);
    });
    const isOpen =
            lastStatement != null &&
            !(lastStatement.end < text.length) &&
            !endsItsCall(lastStatement.tokens),
        ret = {openStatement: isOpen ? lastStatement.id : null, namedArguments};

    if (scans.size >= MAX_SCANS) scans.delete(scans.keys().next().value);
    scans.set(text, ret);
    return ret;
}

// True for a statement whose last token is the closing parenthesis of a call, with every bracket
// before it closed. Nothing more can follow in such a statement, so it is complete with no
// newline after it, as at the end of a program that arrives whole.
function endsItsCall(tokens: ReturnType<typeof tokenize>): boolean {
    const types = getTokenTypes();
    if (!types || last(tokens)?.t !== types.rParen) return false;

    let depth = 0;
    for (const {t} of tokens) {
        if (t === types.lParen || t === types.lBrack || t === types.lBrace) depth++;
        if (t === types.rParen || t === types.rBrack || t === types.rBrace) depth--;
        if (depth < 0) return false;
    }
    return depth === 0;
}

// lang-core's token types for the brackets, the colon and the question mark. It declares them as
// a const enum, which has no values to import, so they are read from its tokenizer. Null if the
// tokenizer does not give eight distinct types, as after a change to it.
function getTokenTypes(): TokenTypes {
    if (tokenTypes === undefined) {
        const types = tokenize('( ) [ ] { } : ?')
            .slice(0, 8)
            .map(it => it.t as number);
        if (uniq(types).length === 8) {
            const [lParen, rParen, lBrack, rBrack, lBrace, rBrace, colon, question] = types;
            tokenTypes = {lParen, rParen, lBrack, rBrack, lBrace, rBrace, colon, question};
        } else {
            tokenTypes = null;
            logWarn('Could not read the token types of lang-core.', 'OpenUiDocument');
        }
    }
    return tokenTypes;
}

// The names of the arguments that a statement writes by name: each colon directly inside the
// parentheses of a call. A colon inside an object, or after the `?` of a ternary, is not one.
function findNamedArguments(tokens: ReturnType<typeof tokenize>): string[] {
    const TOKEN = getTokenTypes(),
        open: number[] = [],
        ternaries: number[] = [0],
        ret: string[] = [];
    if (!TOKEN) return ret;

    tokens.forEach((token, idx) => {
        switch (token.t as number) {
            case TOKEN.lParen:
            case TOKEN.lBrack:
            case TOKEN.lBrace:
                open.push(token.t);
                ternaries.push(0);
                break;
            case TOKEN.rParen:
            case TOKEN.rBrack:
            case TOKEN.rBrace:
                open.pop();
                if (ternaries.length > 1) ternaries.pop();
                break;
            case TOKEN.question:
                ternaries[ternaries.length - 1]++;
                break;
            case TOKEN.colon:
                if (last(ternaries) > 0) {
                    ternaries[ternaries.length - 1]--;
                } else if (last(open) === TOKEN.lParen) {
                    const name = tokens[idx - 1]?.v;
                    ret.push(isString(name) ? name : '?');
                }
                break;
        }
    });
    return ret;
}

// A value at the end of a statement still being written, without the part that may be cut
// short. lang-core closes what is open, so a half-written object has a key cut short with no
// value, and a `?` key for the pair to come. The last item of a list goes, as it may hold either.
// In an object, the `?` key goes, and so does a last key with no value yet.
function trimCutValue(value: unknown): unknown {
    if (isArray(value)) return dropRight(value);
    if (!isPlainObject(value) || isExpression(value) || isElementNode(value)) return value;

    const ret = omit(value as PlainObject, PENDING_KEY),
        key = last(Object.keys(ret));
    if (key == null) return ret;

    const trimmed = trimCutValue(ret[key]);
    if (trimmed == null || isExpression(trimmed)) {
        delete ret[key];
    } else {
        ret[key] = trimmed;
    }
    return ret;
}

// The element nodes of a prop that holds a child list, each with its index, or null for a prop
// that holds none. A prop is a child list if the schema types it as an array of components, or
// if it holds element nodes.
function getChildNodes(
    library: OpenUiLibrary,
    typeName: string,
    key: string,
    value: unknown
): [ElementNode, number][] {
    if (isElementNode(value)) return [[value, 0]];
    if (!isArray(value)) return null;

    // A list of children that an expression built, such as an `@Each`, nests in its place.
    const isChildList = isChildListProp(library, typeName, key),
        items: unknown[] = isChildList ? flattenDeep(value) : value;
    if (!isChildList && !items.some(isElementNode)) return null;
    return items
        .map((it, idx): [unknown, number] => [it, idx])
        .filter((it): it is [ElementNode, number] => isElementNode(it[0]));
}

function isChildListProp(library: OpenUiLibrary, typeName: string, key: string): boolean {
    const def = getOwn(library.schema.$defs, typeName),
        prop = getOwn(def?.properties as PlainObject, key),
        items = prop?.items;
    if (prop?.type !== 'array' || !isPlainObject(items)) return false;
    const refs: PlainObject[] = items.anyOf ?? [items];
    return refs.every(it => {
        const ref = it?.$ref;
        return (
            ref?.startsWith?.(REF_PREFIX) &&
            !!getOwn(library.components, ref.slice(REF_PREFIX.length))
        );
    });
}

// True for a prop that the library types as an action, or a list of actions.
function isActionProp(library: OpenUiLibrary, typeName: string, key: string): boolean {
    const def = getOwn(library.schema.$defs, typeName),
        prop = getOwn(def?.properties as PlainObject, key);
    return [prop?.$ref, prop?.items?.$ref].includes(ACTION_REF);
}

// A prop's value, with each action expression as a kit action, and each other expression, such
// as a reference, as null. Null drops the prop. An action that the prop's schema refuses is
// dropped, with a warning. An action list left with no actions is empty, or null where the
// schema requires items. With a runtime, the value is already evaluated: an action is the plan
// that lang-core made of it, and an expression is one that could not evaluate.
function toPropValue(
    value: unknown,
    library: OpenUiLibrary,
    opts: {
        propSchema: PlainObject;
        path: string;
        warn: boolean;
        runtime: OpenUiRuntime;
        isActionProp: boolean;
    }
): unknown {
    const {propSchema, path, warn, runtime} = opts,
        actionSchema: PlainObject = propSchema?.type === 'array' ? propSchema.items : propSchema,
        withLabel = requiresLabel(actionSchema);

    // One value where the schema takes a list is a list of one. A text format gets no retry, so
    // a single action in a list of actions must not fail the element.
    const isSingle =
        propSchema?.type === 'array' &&
        value != null &&
        !isArray(value) &&
        (opts.isActionProp || !isExpression(value));
    if (isSingle) value = [value];

    // An action that passes the prop's schema, with a label where the schema requires one.
    const accept = (action: ChatUiAction, parts: ChatUiAction[] = [action]) => {
        if (!action) return null;

        const refusal = compact(parts.map(it => getRefusal(it, actionSchema)))[0];
        if (refusal) {
            const message =
                `OpenUI action dropped from ${path}, as its ${refusal}: ` +
                `${describeChatUiAction(action)}.`;
            if (warn) warnOnce(message, message, 'OpenUiDocument');
            return null;
        }
        return withLabel && action.label == null ? {...action, label: toLabel(action)} : action;
    };
    const toAction = (node: ASTNode) => accept(openUiToAction(node, library, {warn}));

    // The schema must allow a state action, and each kit action among its steps.
    const toPlanAction = (plan: ActionPlan, id: string) => {
        const steps = toOpenUiSteps(plan, library),
            created = runtime.createAction(id, steps);
        if (!created) {
            const message =
                `OpenUI action dropped from ${id}, as its ${steps.length} steps hold none the ` +
                'kit can run, or cannot be shown to the user in full.';
            if (warn && !isEmpty(plan.steps)) warnOnce(message, message, 'OpenUiDocument');
            return null;
        }

        const {action} = created;
        if (action.type !== 'state') return accept(action);

        const stepActions = steps.flatMap(it => (it.type === 'action' ? [it.action] : [])),
            ret = accept(action, [action, ...stepActions]);
        if (ret) runtime.registerAction(action, created.plan);
        return ret;
    };

    if (runtime) {
        if (opts.isActionProp && isActionPlan(value)) return toPlanAction(value, path);
        if (opts.isActionProp && isArray(value)) {
            const ret = value
                .map((it, idx) => (isActionPlan(it) ? toPlanAction(it, `${path}[${idx}]`) : it))
                .filter(it => it != null && !isExpression(it));
            return isEmpty(ret) && propSchema?.minItems > 0 ? null : ret;
        }
        return isExpression(value) ? null : value;
    }

    if (isExpression(value)) return toAction(value);
    if (isArray(value) && value.some(isExpression)) {
        const ret = value
            .map(it => (isExpression(it) ? toAction(it) : it))
            .filter(it => it != null);
        return isEmpty(ret) && propSchema?.minItems > 0 ? null : ret;
    }
    return value;
}

// Why an action schema refuses an action, or null if it does not: an action type it does not
// allow, or the url of an openUrl that does not match its pattern. Null for a schema that names
// no action types.
function getRefusal(action: ChatUiAction, schema: PlainObject): string {
    if (!isPlainObject(schema)) return null;
    const branches: PlainObject[] = schema.anyOf ?? [schema],
        types = compact(branches.map(it => it?.properties?.type?.const));
    if (isEmpty(types)) return null;

    const branch = branches.find(it => it?.properties?.type?.const === action.type);
    if (!branch) return `type is not one of ${types.join(', ')}`;
    if (action.type === 'openUrl') {
        const pattern = branch.properties.url?.pattern;
        if (isString(pattern) && !new RegExp(pattern).test(action.url)) {
            return `url does not match ${pattern}`;
        }
    }
    return null;
}

// True for an action schema that requires a label, in any of its branches.
function requiresLabel(schema: PlainObject): boolean {
    if (!isPlainObject(schema)) return false;
    const branches: PlainObject[] = schema.anyOf ?? [schema];
    return branches.some(it => isArray(it?.required) && it.required.includes('label'));
}

function toLabel(action: ChatUiAction): string {
    switch (action.type) {
        case 'send':
            return action.text.slice(0, MAX_LABEL_LENGTH);
        case 'openUrl':
            try {
                return new URL(action.url).host || action.url.slice(0, MAX_LABEL_LENGTH);
            } catch {
                return action.url.slice(0, MAX_LABEL_LENGTH);
            }
        case 'app':
            return action.name.slice(0, MAX_LABEL_LENGTH);
        case 'state':
            return action.summary.slice(0, MAX_LABEL_LENGTH);
        default:
            return null;
    }
}

// True for an action as lang-core's evaluator leaves it: a list of steps.
function isActionPlan(value: unknown): value is ActionPlan {
    return isPlainObject(value) && isArray((value as PlainObject).steps);
}

// True for an AST node that lang-core left unevaluated, such as an action or a reference.
function isExpression(value: unknown): value is ASTNode {
    return isPlainObject(value) && AST_KINDS.includes((value as PlainObject).k);
}

// The path of an error in the kit's form, such as `elements.chart.props.value`.
function toErrorPath(id: string, error: ValidationError): string {
    const segments = error.path ? error.path.split('/').slice(1) : [];
    return segments.reduce(
        (path, it) =>
            /^\d+$/.test(it)
                ? `${path}[${it}]`
                : propPath(path, it.replace(/~1/g, '/').replace(/~0/g, '~')),
        segments.length ? `${elementPath(id)}.props` : elementPath(id)
    );
}
