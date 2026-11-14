import {isElementNode, type ASTNode} from '@openuidev/lang-core';
import {isArray, isPlainObject, isString, sum} from 'lodash';

/** How large a program is to evaluate - see {@link measureProgram}. */
export interface ProgramSize {
    /**
     * The values that an evaluation visits, with each shared expression counted at each use. A
     * string counts for more the longer it is.
     */
    values: number;

    /** The deepest nesting of one `@Each` inside the template of another. */
    eachDepth: number;

    /** The longest list that the program writes out. */
    longestList: number;
}

/** What {@link measureProgram} asks of the state of the program. */
export interface MeasureOptions {
    /** The number of items of the list an `@Each` walks, by its expression. */
    listLength: (list: ASTNode) => number;

    /** The size of the value that a `$variable` or a query holds, for each read of it. */
    refSize: (ref: Extract<ASTNode, {k: 'StateRef' | 'RuntimeRef'}>) => number;
}

/**
 * Measure what it costs to evaluate the parts of a program, without evaluating them.
 *
 * lang-core inlines each reference as it parses, so a statement used twice is one node with two
 * parents. Its evaluator walks that graph as a tree. A chain such as `a = b + b`, `b = c + c`
 * therefore doubles the work with each line, and thirty lines hang the tab. This walk visits each
 * node once and counts it at each use, so it is fast where the evaluation is not.
 *
 * An `@Each` evaluates its template once per item, so the template counts once per item too. A
 * read of a `$variable` or of a query counts for the size of the value it holds, as an
 * expression can copy that value at each read.
 *
 * @param parts - element nodes, expressions or plain values to measure together.
 * @throws if the parts nest deeper than any real program does.
 * @internal
 */
export function measureProgram(parts: unknown[], opts: MeasureOptions): ProgramSize {
    const sizes = new Map<object, ProgramSize>();
    let depth = 0;

    const measure = (value: unknown): ProgramSize => {
        if (isString(value)) return {...LEAF, values: stringSize(value)};
        if (value == null || typeof value !== 'object') return LEAF;
        const known = sizes.get(value);
        if (known) return known;

        // Guards a cycle, which lang-core does not build but data could hold.
        sizes.set(value, LEAF);
        if (++depth > MAX_DEPTH) throw new Error(TOO_DEEP);
        const ret = measureNode(value);
        depth--;
        sizes.set(value, ret);
        return ret;
    };

    const measureAll = (values: unknown[], listLength: number = 0): ProgramSize => {
        const measured = values.map(measure);
        return {
            values: 1 + sum(measured.map(it => it.values)),
            eachDepth: Math.max(0, ...measured.map(it => it.eachDepth)),
            longestList: Math.max(listLength, ...measured.map(it => it.longestList))
        };
    };

    const measureNode = (value: object): ProgramSize => {
        if (isArray(value)) return measureAll(value, value.length);
        if (isElementNode(value)) {
            // The evaluator skips an element with no expression in it.
            return value.hasDynamicProps === false ? LEAF : measureAll(Object.values(value.props));
        }
        if (!isAstNode(value))
            return isPlainObject(value) ? measureAll(Object.values(value)) : LEAF;

        switch (value.k) {
            case 'Comp': {
                if (value.name !== 'Each' || value.args.length < 3) return measureAll(value.args);
                const [list, , template] = value.args,
                    listSize = measure(list),
                    templateSize = measure(template);
                return {
                    values: 1 + listSize.values + opts.listLength(list) * templateSize.values,
                    eachDepth: Math.max(listSize.eachDepth, templateSize.eachDepth + 1),
                    longestList: Math.max(listSize.longestList, templateSize.longestList)
                };
            }
            case 'Str':
                return {...LEAF, values: stringSize(value.v)};
            case 'StateRef':
            case 'RuntimeRef':
                return {...LEAF, values: Math.max(1, opts.refSize(value))};
            case 'Arr':
                return measureAll(value.els, value.els.length);
            case 'Obj':
                return measureAll(value.entries.map(it => it[1]));
            case 'BinOp':
                return measureAll([value.left, value.right]);
            case 'UnaryOp':
                return measureAll([value.operand]);
            case 'Ternary':
                return measureAll([value.cond, value.then, value.else]);
            case 'Member':
                return measureAll([value.obj]);
            case 'Index':
                return measureAll([value.obj, value.index]);
            case 'Assign':
                return measureAll([value.value]);
            default:
                return LEAF;
        }
    };

    return measureAll(parts);
}

/**
 * Measure a value that the state or a query holds, as the tree that a copy of it walks. A list
 * that holds one item twice counts it twice, as JSON does. Stops once the size passes `limit`,
 * so that a value built to be huge costs little to refuse.
 *
 * @returns the size, which is more than `limit` for a value over it, and the longest list found.
 * @internal
 */
export function measureValue(value: unknown, limit: number): {size: number; longestList: number} {
    let size = 0,
        longestList = 0;

    const walk = (it: unknown, depth: number) => {
        if (size > limit) return;
        if (depth > MAX_DEPTH) {
            size = Infinity;
            return;
        }
        if (isString(it)) {
            size += stringSize(it);
        } else if (isArray(it)) {
            size++;
            longestList = Math.max(longestList, it.length);
            for (const item of it) {
                walk(item, depth + 1);
                if (size > limit) return;
            }
        } else if (it != null && typeof it === 'object') {
            size++;
            for (const item of Object.values(it)) {
                walk(item, depth + 1);
                if (size > limit) return;
            }
        } else {
            size++;
        }
    };
    walk(value, 0);
    return {size, longestList};
}

//------------------
// Implementation
//------------------
const LEAF: ProgramSize = {values: 1, eachDepth: 0, longestList: 0},
    MAX_DEPTH = 500,
    TOO_DEEP = `This program nests its values more than ${MAX_DEPTH} deep.`,
    // The characters of a string that count as one value.
    STRING_UNIT = 64;

// A string counts for its length, so that text which doubles with each line is caught.
function stringSize(text: string): number {
    return 1 + Math.floor(text.length / STRING_UNIT);
}

function isAstNode(value: object): value is ASTNode {
    return typeof (value as ASTNode).k === 'string';
}
