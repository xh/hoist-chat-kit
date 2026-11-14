import {isElementNode, type ASTNode} from '@openuidev/lang-core';
import {isArray, isPlainObject, sum} from 'lodash';

/** How large a program is to evaluate - see {@link measureProgram}. */
export interface ProgramSize {
    /** The values that an evaluation visits, with each shared expression counted at each use. */
    values: number;

    /** The deepest nesting of one `@Each` inside the template of another. */
    eachDepth: number;
}

/**
 * Measure what it costs to evaluate the parts of a program, without evaluating them.
 *
 * lang-core inlines each reference as it parses, so a statement used twice is one node with two
 * parents. Its evaluator walks that graph as a tree. A chain such as `a = b + b`, `b = c + c`
 * therefore doubles the work with each line, and thirty lines hang the tab. This walk visits each
 * node once and counts it at each use, so it is fast where the evaluation is not.
 *
 * An `@Each` evaluates its template once per item, so the template counts once per item too.
 *
 * @param parts - element nodes, expressions or plain values to measure together.
 * @param listLength - the number of items of the list an `@Each` walks, by its expression.
 * @internal
 */
export function measureProgram(
    parts: unknown[],
    listLength: (list: ASTNode) => number
): ProgramSize {
    const sizes = new Map<object, ProgramSize>();

    const measure = (value: unknown): ProgramSize => {
        if (value == null || typeof value !== 'object') return LEAF;
        const known = sizes.get(value);
        if (known) return known;

        // Guards a cycle, which lang-core does not build but data could hold.
        sizes.set(value, LEAF);
        const ret = measureNode(value);
        sizes.set(value, ret);
        return ret;
    };

    const measureAll = (values: unknown[]): ProgramSize => {
        const parts = values.map(measure);
        return {
            values: 1 + sum(parts.map(it => it.values)),
            eachDepth: Math.max(0, ...parts.map(it => it.eachDepth))
        };
    };

    const measureNode = (value: object): ProgramSize => {
        if (isArray(value)) return measureAll(value);
        if (isElementNode(value)) return measureAll(Object.values(value.props));
        if (!isAstNode(value))
            return isPlainObject(value) ? measureAll(Object.values(value)) : LEAF;

        switch (value.k) {
            case 'Comp': {
                if (value.name !== 'Each' || value.args.length < 3) return measureAll(value.args);
                const [list, , template] = value.args,
                    listSize = measure(list),
                    templateSize = measure(template);
                return {
                    values: 1 + listSize.values + listLength(list) * templateSize.values,
                    eachDepth: Math.max(listSize.eachDepth, templateSize.eachDepth + 1)
                };
            }
            case 'Arr':
                return measureAll(value.els);
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

//------------------
// Implementation
//------------------
const LEAF: ProgramSize = {values: 1, eachDepth: 0};

function isAstNode(value: object): value is ASTNode {
    return typeof (value as ASTNode).k === 'string';
}
