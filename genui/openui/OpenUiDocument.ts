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
    flattenDeep,
    forEach,
    isArray,
    isEmpty,
    isPlainObject,
    isString,
    last
} from 'lodash';
import {getOwn} from '../../impl/LangUtils';
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
     * `elementErrors`, to render the stand-in for each one as a fallback that lists them.
     */
    elementErrors: Record<string, string[]>;
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
 */
export function openUiToDocument(
    result: ParseResult,
    library: OpenUiLibrary,
    opts: OpenUiTranslationOptions
): OpenUiTranslation {
    const {root, meta} = result,
        isPartial = meta.incomplete || !opts.complete,
        hasText = opts.text != null,
        streamingStatement = hasText && isPartial ? findLastStatement(opts.text) : null,
        isStreaming = (statementId: string) =>
            isPartial && (!hasText || statementId === streamingStatement);

    const elements: Record<string, ChatUiElement> = {},
        {runtime} = opts,
        toComponent = (typeName: string) => library.toCatalogName(typeName) ?? typeName;

    const addElement = (node: ElementNode, syntheticId: string, parentStatement: string) => {
        const {statementId, typeName} = node,
            ownId = toElementId(statementId),
            id = ownId != null && !Object.hasOwn(elements, ownId) ? ownId : syntheticId,
            statement = statementId ?? parentStatement,
            isPartialElement = hasText ? isStreaming(statement) : node.partial,
            element: ChatUiElement = {component: toComponent(typeName), props: {}};
        elements[id] = element;

        forEach(node.props, (value, key) => {
            const children = getChildNodes(library, typeName, key, value);
            if (children) {
                const ids = children.map(([child, idx]) =>
                    addElement(
                        child,
                        isArray(value) ? `${id}.${key}[${idx}]` : `${id}.${key}`,
                        statement
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
                const prop = toPropValue(value, library, {
                    propSchema: getOwn(
                        opts.catalog?.getComponent(element.component)?.props?.properties,
                        key
                    ),
                    path: `${id}.${key}`,
                    // Warn of a refusal once its statement completes, not for a value still
                    // being written.
                    warn: !isPartialElement,
                    runtime,
                    isActionProp: isActionProp(library, typeName, key)
                });
                if (prop != null) element.props[key] = prop;
            }
        });
        element.isPartial = isPartialElement;
        return id;
    };
    const rootId = root ? addElement(root, toElementId(root.statementId) ?? 'root', null) : null,
        rootTakesChildren = root ? isChildListProp(library, root.typeName, 'children') : false;

    const errors: string[] = [],
        elementErrors: Record<string, string[]> = Object.create(null);
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

    return {document: {root: rootId, elements}, isPartial, errors, elementErrors};
}

//------------------
// Implementation
//------------------
const REF_PREFIX = '#/$defs/',
    ACTION_REF = `${REF_PREFIX}ActionExpression`,
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

// The id of the last statement in a program's text - the one still streaming, while it streams.
function findLastStatement(text: string): string {
    return last(split(tokenize(text)))?.id ?? null;
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
    const toAction = (node: ASTNode) => accept(openUiToAction(node, library));

    // The schema must allow a state action, and each kit action among its steps.
    const toPlanAction = (plan: ActionPlan, id: string) => {
        const steps = toOpenUiSteps(plan, library),
            action = runtime.createAction(id, steps);
        if (action?.type !== 'state') return accept(action);

        const stepActions = steps.flatMap(it => (it.type === 'action' ? [it.action] : [])),
            ret = accept(action, [action, ...stepActions]);
        if (ret) runtime.registerAction(action, steps);
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
