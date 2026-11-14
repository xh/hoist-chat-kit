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

    /** Items in the value, if it is a list. Zero for a value that cannot be a list. */
    length: number;

    /**
     * The shape of what the value holds: any item of a list, or any field of an object. Each
     * number is the largest among them. Undefined for a value that holds nothing.
     */
    inside?: ValueShape;

    /** For an object: the names of the fields that it is sure to have. */
    keys?: Set<string>;
}

/** The shape of a value that is not a list and holds nothing. @internal */
export function scalarShape(size: number = 1): ValueShape {
    return {size, length: 0};
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
        else ret.keys = new Set(Object.keys(it));
        for (const [key, child] of Object.entries(it)) {
            const shape = walk(child, depth + 1);
            ret.size += shape.size;
            ret.inside = widest(ret.inside, shape);
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
 * - Each read of a loop variable at the size of the largest item of its list. lang-core copies
 *   the item into the template once per item, for each place that names the variable. It then
 *   reads a field of an item that is an object straight from the copy.
 * - `@Sort` and `@Filter` once per item, times the size of their field path, of an item, and of
 *   the value that a filter compares with. They read each of these again for each item.
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
        open = new Set<string>(),
        // How often the template being measured names each loop variable.
        uses = new Map<string, number>();

    const total = <T extends ValueShape>(shape: T): T => {
        budget.check(shape.size);
        return shape;
    };

    // The shape of a container of parts: a list, an object, an element or a call.
    const group = (parts: unknown[], at: Position, list: boolean): ValueShape => {
        const ret = scalarShape();
        if (list) ret.length = parts.length;
        for (const part of parts) {
            const shape = measure(part, deeper(at));
            ret.size += shape.size;
            ret.inside = widest(ret.inside, shape);
        }
        return total(ret);
    };

    // A read of a loop variable. The item is an object where it cannot be a list, and a field
    // read on it then costs only the field.
    const readItem = (name: string, at: Position): Measured => {
        if (at.isDynamic) return {...anyItem(at)};
        uses.set(name, (uses.get(name) ?? 0) + 1);
        const item = at.scope.get(name);
        return {...item, isItem: item.length === 0};
    };

    const measure = (value: unknown, at: Position): Measured => {
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
            case 'RuntimeRef': {
                // A loop variable hides a query of the same name.
                const {n} = value;
                if (at.isDynamic) return total(widest(held(n, 'query'), anyItem(at)));
                return total(at.scope.has(n) ? readItem(n, at) : held(n, 'query'));
            }
            case 'Ref': {
                const {n} = value;
                if (at.isDynamic || at.scope.has(n)) return total(readItem(n, at));
                // After the parse, a name that is no loop variable reads the query of that
                // name, if there is one.
                if (!statement) return total(held(n, 'query'));
                const target = open.has(n) ? undefined : statement(n);
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
                return {
                    ...group(
                        value.entries.map(it => it[1]),
                        at,
                        false
                    ),
                    keys: new Set(value.entries.map(it => it[0]))
                };
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
                const obj = sub(value.obj),
                    field = obj.inside ?? scalarShape();
                // The field of an item that is an object, read from lang-core's copy. A field
                // that the item may lack is not: lang-core then evaluates the whole copy.
                if (obj.isItem && obj.keys?.has(value.field)) {
                    return total({...field, size: 1 + field.size, isItem: field.length === 0});
                }
                // On a list, a field read gives the field of each item.
                const fields: ValueShape = {
                    size: 1 + obj.length * (field.inside?.size ?? 1),
                    length: obj.length,
                    inside: field.inside
                };
                return total({
                    ...(obj.length > 0 ? widest(field, fields) : field),
                    size: 1 + obj.size + obj.length
                });
            }
            case 'Index': {
                const obj = sub(value.obj),
                    index = sub(value.index);
                return total({
                    ...(obj.inside ?? scalarShape()),
                    size: 1 + obj.size + index.size
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
            sub = (it: unknown) => measure(it, deeper(at)),
            sizeOf = (shapes: ValueShape[]) => shapes.reduce((sum, it) => sum + it.size, 0);
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
                const list = sub(listNode),
                    item = list.inside ?? scalarShape(),
                    outer = at.scope.get(name),
                    outerUses = uses.get(name);
                uses.set(name, 0);
                const result = measure(template, {
                    // An outer loop puts its item in place of the name through the whole
                    // template, so a name used twice may stand for either item.
                    scope: new Map(at.scope).set(name, widest(outer, item)),
                    // An outer loop also puts its item in place of a variable name that is
                    // not in quotes. The names in the template then depend on the data, so
                    // each name may stand for any item.
                    isDynamic: at.isDynamic || (varNode.k === 'Ref' && at.scope.has(varNode.n)),
                    eachDepth: at.eachDepth + 1,
                    depth: at.depth + 1
                });
                // lang-core copies the item once for each place in the template that names
                // the variable, at each item.
                const inner = uses.get(name),
                    copies = inner * item.size;
                // An outer loop of the same name copies its item into these places too.
                uses.set(name, (outerUses ?? 0) + (outer ? inner : 0));
                return total({
                    size: 1 + list.size + list.length * (1 + result.size + copies),
                    length: list.length,
                    inside: result
                });
            }
            case 'Sort':
            case 'Filter': {
                // Each compare splits the field path again, and turns the item into text. A
                // filter also turns the value it compares with into text, once per item.
                const [list, field, ...rest] = args.map(sub),
                    item = list?.inside?.size ?? 1,
                    perItem =
                        node.name === 'Sort'
                            ? SORT_COMPARES * ((field?.size ?? 1) + item)
                            : (field?.size ?? 1) + item + sizeOf(rest);
                if (!list) return scalarShape();
                return total({
                    ...list,
                    size: 1 + list.size + (field?.size ?? 0) + sizeOf(rest) + list.length * perItem
                });
            }
            case 'First':
            case 'Last': {
                const list = args[0] ? sub(args[0]) : scalarShape();
                return total({...(list.inside ?? scalarShape()), size: 1 + list.size});
            }
            case 'Round':
            case 'Abs':
            case 'Floor':
            case 'Ceil': {
                // These run on each number of a list, and of the lists inside it.
                const [number, ...rest] = args.map(sub);
                if (!number) return scalarShape();
                return total({...number, size: 1 + number.size + sizeOf(rest)});
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

    const {isItem: _isItem, ...ret} = measure(root, {
        scope: new Map(),
        isDynamic: false,
        eachDepth: 0,
        depth: 0
    });
    return ret;
}

//------------------
// Implementation
//------------------
// A measured expression. `isItem` is true for a loop variable whose item is an object, and for
// a field of one that is an object too.
type Measured = ValueShape & {isItem?: boolean};

// Where the walk is: the loop variables in scope with the shape of an item, and how deep.
interface Position {
    scope: Map<string, ValueShape>;
    // True where the name of a loop variable depends on the data - see `Each`.
    isDynamic: boolean;
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

// The widest shape that any loop variable in scope may hold.
function anyItem(at: Position): ValueShape {
    return [...at.scope.values()].reduce(widest, scalarShape());
}

function stringSize(text: string): number {
    return 1 + Math.floor(text.length / STRING_UNIT);
}

// The shape of a value that is one of two: the largest of each number, at each level.
function widest(a: ValueShape, b: ValueShape): ValueShape {
    if (!a || !b) return a ?? b;
    const inside = widest(a.inside, b.inside),
        // The fields that both are sure to have. A value that is no object has no say.
        keys =
            a.keys && b.keys
                ? new Set([...a.keys].filter(it => b.keys.has(it)))
                : (a.keys ?? b.keys);
    return {
        size: Math.max(a.size, b.size),
        length: Math.max(a.length, b.length),
        ...(inside ? {inside} : {}),
        ...(keys ? {keys} : {})
    };
}

function isAst(value: unknown): value is ASTNode {
    return isPlainObject(value) && isString((value as ASTNode).k);
}
