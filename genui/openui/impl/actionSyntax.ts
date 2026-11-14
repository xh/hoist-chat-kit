import {isElementNode, type ASTNode, type ElementNode} from '@openuidev/lang-core';
import {isArray, isPlainObject} from 'lodash';

/** What {@link prepareActions} needs to know of the library. */
export interface ActionSyntaxOptions {
    /** True for a prop of a component that takes an action, or a list of actions. */
    isActionProp: (typeName: string, key: string) => boolean;

    /** True for the OpenUI name of a component of the library. */
    isComponent: (name: string) => boolean;
}

/**
 * The target of the step that stands for a `@ToAssistant`, an `@OpenUrl` or a refused action,
 * once {@link prepareActions} has rewritten it. A program cannot write one of these: the target
 * of its own `@Set` is a `$variable`.
 * @internal
 */
export const SEND_TARGET = '@ToAssistant',
    OPEN_URL_TARGET = '@OpenUrl',
    REFUSED_TARGET = '@Refused',
    GENUINE_TARGET = '@Genuine';

/**
 * The value of the step that {@link prepareActions} puts first in each action it prepares. A
 * plan is genuine only if its first step holds this very object. Data can copy the shape of a
 * plan, but not this object, as each value that data gives is a new one.
 * @internal
 */
export const GENUINE_MARK: ASTNode = Object.freeze({k: 'Null'}) as ASTNode;

/** A name that a program can give a `$variable`, with its `$`. @internal */
export const STATE_NAME_RE = /^\$[A-Za-z_]\w*$/;

/**
 * Prepare the action arguments of a parsed program for evaluation. Returns the tree it was
 * given where nothing changes, and a copy along each path that does.
 *
 * It does two things to each argument of a prop that takes an action:
 *
 * - **Takes an action only from action syntax**: `Action([...])`, `@Set`, `@Reset`, `@Run`,
 *   `@ToAssistant` and `@OpenUrl`, alone or as the branches of a condition. Anything else is
 *   data: an object the program wrote, a `$variable`, or the result of a query. lang-core would
 *   run data shaped like a list of steps. Here it becomes a refused action, which a button shows
 *   as disabled.
 * - **Marks each action it prepared**, with a first step that holds {@link GENUINE_MARK}. The
 *   kit runs a plan only with that mark, so a plan that data built is refused even where it
 *   reaches an action prop.
 * - **Makes every step lazy.** lang-core evaluates the arguments of a `@ToAssistant` when the
 *   props evaluate, and those of a `@Set` not at all. So a message after a `@Set` in the same
 *   action would read the old value. Each `@ToAssistant` and `@OpenUrl` becomes a `@Set` on a
 *   reserved target, whose value lang-core keeps as an expression. The runtime then evaluates
 *   the steps in order, each with the values that the steps before it set.
 *
 * A lazy step keeps its expression inside the tree, so an `@Each` still puts its loop variable
 * into it, and the size measure still counts it.
 * @internal
 */
export function prepareActions<T extends ElementNode | ASTNode>(
    root: T,
    opts: ActionSyntaxOptions
): T {
    const done = new Map<object, unknown>();

    // Any value of the tree, with the action arguments inside it prepared.
    const prepare = (value: unknown): unknown => {
        if (value == null || typeof value !== 'object') return value;
        if (done.has(value)) return done.get(value);
        // Guards a cycle, which lang-core does not build.
        done.set(value, value);
        const ret = prepareObject(value);
        done.set(value, ret);
        return ret;
    };

    const prepareObject = (value: object): unknown => {
        if (isArray(value)) return mapSame(value, prepare);
        if (isElementNode(value)) {
            const props = mapValuesSame(value.props, (it, key) =>
                opts.isActionProp(value.typeName, key) ? prepareArgument(it) : prepare(it)
            );
            // A prop that changed holds an expression, so the element must evaluate.
            return props === value.props ? value : {...value, props, hasDynamicProps: true};
        }
        if (!isAst(value)) return isPlainObject(value) ? mapValuesSame(value, prepare) : value;

        switch (value.k) {
            case 'Comp': {
                const {name} = value,
                    args = mapSame(value.args, prepare) as ASTNode[],
                    mappedProps = value.mappedProps
                        ? (mapValuesSame(value.mappedProps, (it, key) =>
                              opts.isComponent(name) && opts.isActionProp(name, key)
                                  ? prepareMapped(it as ASTNode)
                                  : prepare(it)
                          ) as Record<string, ASTNode>)
                        : value.mappedProps;
                return args === value.args && mappedProps === value.mappedProps
                    ? value
                    : {...value, args, ...(mappedProps ? {mappedProps} : {})};
            }
            case 'Arr':
                return withSame(value, 'els', mapSame(value.els, prepare));
            case 'Obj':
                return withSame(
                    value,
                    'entries',
                    mapSame(value.entries, entry => {
                        const next = prepare(entry[1]);
                        return next === entry[1] ? entry : [entry[0], next];
                    })
                );
            case 'BinOp':
                return withSame(
                    withSame(value, 'left', prepare(value.left)),
                    'right',
                    prepare(value.right)
                );
            case 'UnaryOp':
                return withSame(value, 'operand', prepare(value.operand));
            case 'Ternary':
                return withSame(
                    withSame(
                        withSame(value, 'cond', prepare(value.cond)),
                        'then',
                        prepare(value.then)
                    ),
                    'else',
                    prepare(value.else)
                );
            case 'Member':
                return withSame(value, 'obj', prepare(value.obj));
            case 'Index':
                return withSame(
                    withSame(value, 'obj', prepare(value.obj)),
                    'index',
                    prepare(value.index)
                );
            case 'Assign':
                return withSame(value, 'value', prepare(value.value));
            default:
                return value;
        }
    };

    // The value of an action prop of an element: an action, a list of them, or nothing.
    const prepareArgument = (value: unknown): unknown => {
        if (value == null) return value;
        if (isArray(value)) return value.map(it => mark(isAst(it) ? prepareAction(it) : REFUSED));
        return mark(isAst(value) ? prepareAction(value) : REFUSED);
    };

    // The value of an action prop of a component call inside an expression. A list written out
    // is a list of actions.
    const prepareMapped = (node: ASTNode): ASTNode =>
        node?.k === 'Arr'
            ? {...node, els: node.els.map(it => mark(prepareAction(it)))}
            : mark(prepareAction(node));

    // An action expression: one step, an `Action([...])`, or a condition that picks between
    // them. Any other expression is data, and is refused.
    const prepareAction = (node: ASTNode): ASTNode => {
        if (!isAst(node)) return node == null ? node : REFUSED;
        switch (node.k) {
            case 'Null':
            case 'Ph':
                return node;
            case 'Arr':
                return {...node, els: node.els.map(prepareAction)};
            case 'Ternary':
                return {
                    ...node,
                    cond: prepare(node.cond) as ASTNode,
                    then: prepareAction(node.then),
                    else: prepareAction(node.else)
                };
            case 'BinOp':
                if (node.op === '&&') {
                    return {
                        ...node,
                        left: prepare(node.left) as ASTNode,
                        right: prepareAction(node.right)
                    };
                }
                if (node.op === '||') {
                    return {
                        ...node,
                        left: prepareAction(node.left),
                        right: prepareAction(node.right)
                    };
                }
                return REFUSED;
            case 'Comp':
                return prepareStep(node);
            default:
                return REFUSED;
        }
    };

    const prepareStep = (node: Extract<ASTNode, {k: 'Comp'}>): ASTNode => {
        const {args = [], mappedProps = {}} = node,
            arg = (key: string, idx: number) =>
                (prepare(mappedProps[key] ?? args[idx]) ?? NULL) as ASTNode;
        switch (node.name) {
            case 'Action': {
                const [list] = args;
                if (list?.k !== 'Arr') return REFUSED;
                return {...node, args: [{k: 'Arr', els: list.els.map(prepareAction)}]};
            }
            case 'ToAssistant':
                return toSet(SEND_TARGET, {
                    k: 'Obj',
                    entries: [
                        ['message', arg('message', 0)],
                        ['context', arg('context', 1)]
                    ]
                });
            case 'OpenUrl':
                return toSet(OPEN_URL_TARGET, arg('url', 0));
            case 'Set': {
                const [target, value] = args;
                return target?.k === 'StateRef' && STATE_NAME_RE.test(target.n) && value
                    ? {...node, args: [target, prepare(value) as ASTNode]}
                    : REFUSED;
            }
            case 'Reset':
                return args.length &&
                    args.every(it => it?.k === 'StateRef' && STATE_NAME_RE.test(it.n))
                    ? node
                    : REFUSED;
            case 'Run':
                return args[0]?.k === 'RuntimeRef' ? node : REFUSED;
            default:
                return REFUSED;
        }
    };

    return prepare(root) as T;
}

//------------------
// Implementation
//------------------
const NULL: ASTNode = {k: 'Null'};

// Stands for an action argument that is not action syntax. It evaluates to a step that the
// runtime refuses, so the component can say that its action cannot run.
const REFUSED = toSet(REFUSED_TARGET, NULL);

// A prepared action behind the step that marks it as genuine. Nothing stays nothing.
function mark(node: ASTNode): ASTNode {
    if (node == null || node.k === 'Null' || node.k === 'Ph') return node;
    return {
        k: 'Comp',
        name: 'Action',
        args: [{k: 'Arr', els: [toSet(GENUINE_TARGET, GENUINE_MARK), node]}]
    };
}

// A `@Set` step, which lang-core keeps with its value as an expression.
function toSet(target: string, value: ASTNode): ASTNode {
    return {k: 'Comp', name: 'Set', args: [{k: 'StateRef', n: target}, value]};
}

function isAst(value: unknown): value is ASTNode {
    return isPlainObject(value) && typeof (value as ASTNode).k === 'string';
}

// A list with each item mapped, or the same list if no item changed.
function mapSame<V>(list: V[], fn: (item: V) => unknown): V[] {
    let ret: unknown[] = null;
    list.forEach((item, idx) => {
        const next = fn(item);
        if (next !== item && !ret) ret = list.slice(0, idx);
        if (ret) ret.push(next);
    });
    return (ret ?? list) as V[];
}

// An object with each value mapped, or the same object if no value changed.
function mapValuesSame<T extends object>(obj: T, fn: (value: unknown, key: string) => unknown): T {
    let ret: Record<string, unknown> = null;
    Object.entries(obj).forEach(([key, value]) => {
        const next = fn(value, key);
        if (next === value) return;
        ret ??= {...obj} as Record<string, unknown>;
        ret[key] = next;
    });
    return (ret ?? obj) as T;
}

// A node with one field replaced, or the same node if the field did not change.
function withSame<T extends object, K extends keyof T>(node: T, key: K, value: unknown): T {
    return node[key] === value ? node : {...node, [key]: value};
}
