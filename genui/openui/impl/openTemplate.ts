import {
    isElementNode,
    type ASTNode,
    type ElementNode,
    type ParseResult
} from '@openuidev/lang-core';
import {dropRight, findLast, isArray, isPlainObject, isString, last} from 'lodash';

/**
 * A program that still streams, with the end of its open statement trimmed where that end is the
 * template of an `@Each`, or a component call inside an expression.
 *
 * lang-core closes what a statement still being written leaves open. So a half-written object
 * has a key cut short with no value, and a `?` key for the pair to come. The translation trims
 * such a value at the end of an element - see `trimCutValue`. It cannot reach a template: an
 * `@Each` evaluates the template once per item, so every element it gives would hold the cut
 * value, and each would fail its checks until the statement is whole. So the cut goes from the
 * template itself, before it evaluates.
 *
 * Returns the result it was given where nothing changes, and a copy along the path that does.
 *
 * @param result - what lang-core parsed.
 * @param openStatement - id of the statement at the end of the text that is still being
 *      written, or null if there is none.
 * @internal
 */
export function trimOpenTemplate(result: ParseResult, openStatement: string): ParseResult {
    const {root} = result;
    if (!openStatement || !root) return result;
    const next = trimElement(root, openStatement, false);
    return next === root ? result : {...result, root: next};
}

//------------------
// Implementation
//------------------
const PENDING_KEY = '?',
    LITERALS = ['Str', 'Num', 'Bool', 'Arr', 'Obj'];

// An element with the end of the open statement under it trimmed. `isOpen` is true once the walk
// is inside the open statement, where the end of the statement is the end of the last prop.
function trimElement(node: ElementNode, openStatement: string, isOpen: boolean): ElementNode {
    const inOpen = isOpen || node.statementId === openStatement,
        keys = Object.keys(node.props),
        // Outside the open statement, look for it in every prop. Inside, only the last prop
        // holds its end.
        targets = inOpen ? keys.slice(-1) : keys;

    for (const key of targets) {
        const value = node.props[key],
            next = trimValue(value, openStatement, inOpen);
        if (next !== value) return {...node, props: {...node.props, [key]: next}};
    }
    return node;
}

// A prop value, or an item of one: a plain list, an element, or an expression.
function trimValue(value: unknown, openStatement: string, isOpen: boolean): unknown {
    if (isElementNode(value)) return trimElement(value, openStatement, isOpen);
    if (isArray(value)) {
        // Inside the open statement only the last item is still being written.
        if (isOpen) {
            const item = last(value),
                next = trimValue(item, openStatement, true);
            return next === item ? value : [...dropRight(value), next];
        }
        for (let idx = 0; idx < value.length; idx++) {
            const next = trimValue(value[idx], openStatement, false);
            if (next !== value[idx]) return value.map((it, at) => (at === idx ? next : it));
        }
        return value;
    }
    return isOpen && isAst(value) ? trimExpression(value) : value;
}

// An expression at the end of the open statement. Only a template is trimmed: what a component
// call inside the expression holds at its end.
function trimExpression(node: ASTNode): ASTNode {
    switch (node.k) {
        case 'Comp': {
            if (node.name === 'Each') {
                // Open until its template arrives, which is its last argument.
                if (node.args.length < 3) return node;
                const template = node.args[2],
                    next = trimExpression(template);
                return next === template ? node : {...node, args: [...node.args.slice(0, 2), next]};
            }
            if (!node.mappedProps) return node;

            // A component call: the end of its last argument is the end of the statement.
            const key = findLast(Object.keys(node.mappedProps), it => node.mappedProps[it] != null);
            if (key == null) return node;
            const value = node.mappedProps[key],
                next = trimArgument(value);
            if (next === value) return node;
            return {
                ...node,
                args: node.args.map(it => (it === value ? (next ?? NULL) : it)),
                mappedProps: {...node.mappedProps, [key]: next ?? NULL}
            };
        }
        case 'Arr': {
            const item = last(node.els),
                next = item ? trimExpression(item) : item;
            return next === item ? node : {...node, els: [...dropRight(node.els), next]};
        }
        case 'Ternary': {
            const next = trimExpression(node.else);
            return next === node.else ? node : {...node, else: next};
        }
        default:
            return node;
    }
}

// The last argument of a component call in a template, without the part that may be cut short.
// A list loses its last item, which may be half-written. An object loses the `?` key, and a
// last key whose value is not there yet. Null for a value to leave out.
function trimArgument(node: ASTNode): ASTNode {
    switch (node.k) {
        case 'Comp':
            return trimExpression(node);
        case 'Arr':
            return {...node, els: dropRight(node.els)};
        case 'Obj': {
            const entries = node.entries.filter(it => it[0] !== PENDING_KEY),
                entry = last(entries);
            if (!entry) return {...node, entries};

            const value = trimArgument(entry[1]),
                kept = value != null && LITERALS.includes(value.k);
            return {
                ...node,
                entries: kept ? [...dropRight(entries), [entry[0], value]] : dropRight(entries)
            };
        }
        case 'Str':
        case 'Num':
        case 'Bool':
            return node;
        default:
            // A name or an expression that may be half-written.
            return null;
    }
}

const NULL: ASTNode = {k: 'Null'};

function isAst(value: unknown): value is ASTNode {
    return isPlainObject(value) && isString((value as ASTNode).k);
}
