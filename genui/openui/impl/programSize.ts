import {isElementNode, type ASTNode} from '@openuidev/lang-core';
import {isArray, isPlainObject, isString} from 'lodash';

/**
 * Most values that one evaluation of a program may visit, and that its state and query results
 * may hold. A string counts one more for each 64 characters. An evaluation of this size takes a
 * few milliseconds.
 * @internal
 */
export const MAX_VALUES = 100_000;

/** Most levels of `@Each` inside `@Each`. @internal */
export const MAX_EACH_DEPTH = 3;

/** Why a program is too large, for the user. @internal */
export const TOO_LARGE =
    'This program is too large to evaluate: its values and expressions expand past ' +
    `${MAX_VALUES} values.`;

/** Thrown for a program, or a value, past a size limit. @internal */
export class SizeLimitError extends Error {}

/**
 * What the measure knows of a value before it exists. Each number is an upper bound.
 * @internal
 */
export interface ValueShape {
    /** Values that a walk of the value visits. Never less than the cost to compute it. */
    size: number;

    /** Items in the value, if it is a list. */
    length: number;

    /** Items in the longest list inside the value, at any depth below its top. */
    innerLength: number;

    /** Size of the largest item of any list in the value. */
    itemSize: number;
}

/** The shape of a value that is not a list and holds none. @internal */
export function scalarShape(size: number = 1): ValueShape {
    return {size, length: 0, innerLength: 0, itemSize: 0};
}

/**
 * A running total of values, shared by the parts of one check. It throws once the total passes
 * its limit, so that a check stops as soon as its answer is known.
 * @internal
 */
export class SizeBudget {
    private left: number;
    private visits: number;
    private readonly message: string;

    constructor(limit: number = MAX_VALUES, message: string = TOO_LARGE) {
        this.left = limit;
        this.visits = limit;
        this.message = message;
    }

    /** Count values toward the total. */
    spend(size: number) {
        this.left -= size;
        if (!(this.left >= 0)) throw new SizeLimitError(this.message);
    }

    /** Throw if a size alone is past what is left, without counting it. */
    check(size: number) {
        if (!(size <= this.left)) throw new SizeLimitError(this.message);
    }

    /** Count one step of a walk, so that the walk itself is bounded. */
    visit() {
        if (--this.visits < 0) throw new SizeLimitError(this.message);
    }
}

/**
 * Measure a value that a `$variable` or a query holds, as the tree that a copy of it walks. A
 * list that holds the same list twice counts it twice. The walk stops as soon as the budget is
 * spent. A value already measured in the same pass is not walked again, but counts again.
 *
 * @param value - plain JSON.
 * @param budget - the running total that the value counts toward.
 * @param seen - the shapes measured so far in this pass, by object.
 * @throws SizeLimitError once the budget is spent.
 * @internal
 */
export function measureValue(
    value: unknown,
    budget: SizeBudget,
    seen: Map<object, ValueShape> = new Map()
): ValueShape {
    const walk = (it: unknown, depth: number): ValueShape => {
        if (isString(it)) {
            const size = stringSize(it);
            budget.spend(size);
            return scalarShape(size);
        }
        if (it == null || typeof it !== 'object') {
            budget.spend(1);
            return scalarShape();
        }
        const known = seen.get(it);
        if (known) {
            budget.spend(known.size);
            return known;
        }
        if (depth > MAX_DEPTH) throw new SizeLimitError(TOO_DEEP);

        budget.spend(1);
        const ret = scalarShape(),
            list = isArray(it);
        if (list) ret.length = it.length;
        for (const [key, child] of Object.entries(it)) {
            const shape = walk(child, depth + 1);
            ret.size += shape.size;
            ret.innerLength = Math.max(ret.innerLength, shape.length, shape.innerLength);
            ret.itemSize = Math.max(ret.itemSize, shape.itemSize, list ? shape.size : 0);
            if (!list && key.length >= STRING_UNIT) {
                const keySize = stringSize(key) - 1;
                budget.spend(keySize);
                ret.size += keySize;
            }
        }
        seen.set(it, ret);
        return ret;
    };
    return walk(value, 0);
}

/** What {@link measureExpression} needs to know of the program around an expression. */
export interface MeasureOptions {
    /** Bounds the walk, and the size of each part of the expression. */
    budget: SizeBudget;

    /** The shape of what a `$variable`, or the query of a name, holds now. */
    held: (name: string, kind: 'state' | 'query') => ValueShape;

    /**
     * Before the parse only: what a name stands for. The expression of a value statement, which
     * is measured in its place. `'query'` for a `Query()` or a `Mutation()`. Undefined for a
     * name that the program does not define.
     */
    statement?: (name: string) => unknown;
}

/**
 * Measure what the evaluation of an expression costs, without evaluating any of it. lang-core
 * evaluates a program as a tree, with each shared expression at each use, and the template of an
 * `@Each` once per item. So a short program can take exponential time. The measure counts:
 *
 * - Each value and operator once, and each string by its length.
 * - Each read of a `$variable` or a query at the size of the value it holds.
 * - The template of an `@Each` once per item of its list. The length of the list is a bound that
 *   follows from where the list comes from: a list written out, a held value, or a list inside
 *   one. No list is evaluated to count it, as one that reads a loop variable has no value yet.
 * - Each read of a loop variable at the size of the largest item of its list, as lang-core
 *   copies the item into the template.
 * - `@Sort` and `@Filter` once per item, times the size of their field path, which they split
 *   again for each item.
 * - A field read on a list once per item, as it reads the field of each.
 *
 * It accepts what lang-core's parser returns, where plain values, elements and expressions mix,
 * and the expressions of raw statements, where a name stands for another statement.
 *
 * @returns the shape of the value that the expression gives. Its `size` is the cost. The caller
 *      counts it toward the budget.
 * @throws SizeLimitError for an expression past the budget, or with `@Each` nested too deep.
 * @internal
 */
export function measureExpression(root: unknown, opts: MeasureOptions): ValueShape {
    const {budget, held, statement} = opts,
        open = new Set<string>();

    const total = (shape: ValueShape): ValueShape => {
        budget.check(shape.size);
        return shape;
    };

    // The shape of a container of parts: a list, an object, an element or a call.
    const group = (parts: unknown[], at: Position, list: boolean) => {
        const ret = scalarShape();
        if (list) ret.length = parts.length;
        for (const part of parts) {
            const shape = measure(part, deeper(at));
            ret.size += shape.size;
            ret.innerLength = Math.max(ret.innerLength, shape.length, shape.innerLength);
            ret.itemSize = Math.max(ret.itemSize, shape.itemSize, list ? shape.size : 0);
        }
        return total(ret);
    };

    const measure = (value: unknown, at: Position): ValueShape => {
        budget.visit();
        if (isString(value)) return scalarShape(stringSize(value));
        if (value == null || typeof value !== 'object') return scalarShape();
        if (at.depth > MAX_DEPTH) throw new SizeLimitError(TOO_DEEP);

        if (isArray(value)) return group(value, at, true);
        if (isElementNode(value)) return group(Object.values(value.props), at, false);
        if (!isAst(value)) return group(Object.values(value), at, false);

        const sub = (it: unknown) => measure(it, deeper(at));
        switch (value.k) {
            case 'Str':
                return scalarShape(stringSize(value.v));
            case 'StateRef':
                return total(held(value.n, 'state'));
            case 'RuntimeRef':
                return total(at.scope.get(value.n) ?? held(value.n, 'query'));
            case 'Ref': {
                const {n} = value,
                    item = at.scope.get(n);
                if (item) return total(item);
                const target = open.has(n) ? undefined : statement?.(n);
                if (target === undefined) return scalarShape();
                if (target === 'query') return total(held(n, 'query'));
                // A name that refers to itself is null in lang-core.
                open.add(n);
                try {
                    return sub(target);
                } finally {
                    open.delete(n);
                }
            }
            case 'Arr':
                return group(value.els, at, true);
            case 'Obj':
                return group(
                    value.entries.map(it => it[1]),
                    at,
                    false
                );
            case 'Comp':
                return measureCall(value, at);
            case 'BinOp': {
                const left = sub(value.left),
                    right = sub(value.right),
                    size = 1 + left.size + right.size;
                // `a || b` and `a && b` give one of their sides, which may be a list.
                return total(
                    value.op === '&&' || value.op === '||'
                        ? {...widest(left, right), size}
                        : scalarShape(size)
                );
            }
            case 'UnaryOp':
                return total(scalarShape(1 + sub(value.operand).size));
            case 'Ternary': {
                const cond = sub(value.cond),
                    then = sub(value.then),
                    other = sub(value.else);
                return total({
                    ...widest(then, other),
                    size: 1 + cond.size + then.size + other.size
                });
            }
            case 'Member': {
                // On a list, a field read gives the field of each item.
                const obj = sub(value.obj);
                return total({
                    size: 1 + obj.size + obj.length,
                    length: Math.max(obj.length, obj.innerLength),
                    innerLength: obj.innerLength,
                    itemSize: obj.itemSize
                });
            }
            case 'Index': {
                const obj = sub(value.obj),
                    index = sub(value.index);
                return total({
                    size: 1 + obj.size + index.size,
                    length: obj.innerLength,
                    innerLength: obj.innerLength,
                    itemSize: obj.itemSize
                });
            }
            case 'Assign':
                return total(scalarShape(1 + sub(value.value).size));
            default:
                return scalarShape();
        }
    };

    const measureCall = (node: Extract<ASTNode, {k: 'Comp'}>, at: Position): ValueShape => {
        const args: ASTNode[] = node.args ?? [],
            sub = (it: unknown) => measure(it, deeper(at));
        switch (node.name) {
            case 'Each': {
                const [listNode, varNode, template] = args,
                    name =
                        varNode?.k === 'Ref' ? varNode.n : varNode?.k === 'Str' ? varNode.v : null;
                if (args.length < 3 || !name) return group(args, at, false);
                if (at.eachDepth + 1 > MAX_EACH_DEPTH) {
                    throw new SizeLimitError(
                        `This program nests @Each ${at.eachDepth + 1} deep, and may nest it at ` +
                            `most ${MAX_EACH_DEPTH} deep.`
                    );
                }
                // lang-core copies the item into the template at each read of the variable.
                const list = sub(listNode),
                    item: ValueShape = {
                        size: Math.max(1, list.itemSize),
                        length: list.innerLength,
                        innerLength: list.innerLength,
                        itemSize: list.itemSize
                    },
                    result = measure(template, {
                        scope: new Map(at.scope).set(name, item),
                        eachDepth: at.eachDepth + 1,
                        depth: at.depth + 1
                    });
                return total({
                    size: 1 + list.size + list.length * (1 + result.size),
                    length: list.length,
                    innerLength: Math.max(result.length, result.innerLength),
                    itemSize: Math.max(result.size, result.itemSize)
                });
            }
            case 'Sort':
            case 'Filter': {
                // Each compare splits the field path again.
                const [list, field, ...rest] = args.map(sub),
                    perItem = (node.name === 'Sort' ? SORT_COMPARES : 1) * (field?.size ?? 1),
                    others = rest.reduce((sum, it) => sum + it.size, 0);
                if (!list) return scalarShape();
                return total({
                    ...list,
                    size: 1 + list.size + (field?.size ?? 0) + others + list.length * perItem
                });
            }
            case 'First':
            case 'Last': {
                const list = args[0] ? sub(args[0]) : scalarShape();
                return total({
                    size: 1 + list.size,
                    length: list.innerLength,
                    innerLength: list.innerLength,
                    itemSize: list.itemSize
                });
            }
            case 'Round':
            case 'Abs':
            case 'Floor':
            case 'Ceil': {
                // These run on each number of a list, and of the lists inside it.
                const [number, ...rest] = args.map(sub);
                if (!number) return scalarShape();
                return total({
                    ...number,
                    size: 1 + number.size + rest.reduce((sum, it) => sum + it.size, 0)
                });
            }
            default: {
                // A component, an action step, or a function that gives one value. A component
                // call that lang-core has read holds its arguments twice: by position and by
                // name.
                const parts = node.mappedProps ? Object.values(node.mappedProps) : args,
                    ret = group(parts, at, false);
                return total({...ret, size: ret.size + 1});
            }
        }
    };

    return measure(root, {scope: new Map(), eachDepth: 0, depth: 0});
}

//------------------
// Implementation
//------------------
// Where the walk is: the loop variables in scope with the shape of an item, and how deep.
interface Position {
    scope: Map<string, ValueShape>;
    eachDepth: number;
    depth: number;
}

// Characters of a string that count as one value.
const STRING_UNIT = 64,
    // Compares that a sort makes per item, as a bound.
    SORT_COMPARES = 16,
    // Most levels of nesting that a value or an expression may have. Past it, a walk could
    // overflow the stack.
    MAX_DEPTH = 200,
    TOO_DEEP = 'This program nests its values too deep to evaluate.';

function deeper(at: Position): Position {
    return {...at, depth: at.depth + 1};
}

function stringSize(text: string): number {
    return 1 + Math.floor(text.length / STRING_UNIT);
}

// The shape of a value that is one of two.
function widest(a: ValueShape, b: ValueShape): ValueShape {
    return {
        size: Math.max(a.size, b.size),
        length: Math.max(a.length, b.length),
        innerLength: Math.max(a.innerLength, b.innerLength),
        itemSize: Math.max(a.itemSize, b.itemSize)
    };
}

function isAst(value: unknown): value is ASTNode {
    return isPlainObject(value) && isString((value as ASTNode).k);
}
