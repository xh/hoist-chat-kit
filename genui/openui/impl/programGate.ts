import {
    autoClose,
    createParser,
    parseExpression,
    split,
    tokenize,
    type ASTNode,
    type ParseResult
} from '@openuidev/lang-core';
import {logWarn} from '@xh/hoist/utils/js';
import {isFinite, isString, uniq} from 'lodash';
import {getOwn} from '../../../impl/LangUtils';
import type {OpenUiLibrary} from '../OpenUiLibrary';
import {
    MAX_VALUES,
    measureExpression,
    scalarShape,
    SizeBudget,
    SizeLimitError,
    TOO_LARGE,
    type ValueShape
} from './programSize';

/** Most characters in one program. @internal */
export const MAX_PROGRAM_LENGTH = 50_000;

/** Most statements in one program. @internal */
export const MAX_STATEMENTS = 500;

/** Most levels of brackets inside brackets in one statement. @internal */
export const MAX_NESTING = 64;

/**
 * Most components that a program may write, as a multiple of the catalog's `maxElements`, with
 * each shared statement counted at each use. The catalog refuses a document past
 * `maxElements`. This bound is looser, and holds before the parse.
 * @internal
 */
export const MAX_ELEMENTS_FACTOR = 4;

/** Options for {@link parseOpenUiProgram}. */
export interface ProgramGateOptions {
    /** True if the program runs with state. With false, lang-core evaluates nothing. */
    bindings: boolean;

    /** The catalog's cap on the elements of one document. */
    maxElements: number;
}

/** What {@link parseOpenUiProgram} returns. */
export interface GatedProgram {
    /** What lang-core parsed. An empty result for a program that the gate refused. */
    result: ParseResult;

    /** Why the gate refused the whole program, for the user. Null for a program it passed. */
    refusal: string;

    /** The statements that the gate replaced with null, each with the reason. */
    errors: string[];
}

/**
 * Parse an OpenUI Lang program with lang-core, behind the kit's gate. This is the one way that
 * the kit hands a program to lang-core's parser.
 *
 * lang-core does work at parse time that a short program can make very large. It puts each
 * statement in place of each reference to it, so `a = Stack([b, b])`, `b = Stack([c, c])`
 * doubles with each line. It also evaluates the default of each `$variable`. So nothing reaches
 * its parser before the gate has measured it:
 *
 * 1. **Blunt limits.** A program longer than {@link MAX_PROGRAM_LENGTH}, with more than
 *    {@link MAX_STATEMENTS} statements, or with brackets nested past {@link MAX_NESTING}, is
 *    refused before anything else runs.
 * 2. **One reading.** The gate reads the statements with lang-core's own tokenizer, and writes
 *    them out again in a plain form: one statement per line, each string with its marks as
 *    escapes, and no comment or fence. lang-core's parser reads that text exactly as its
 *    tokenizer does, so it sees the statements that the gate measured, and no others.
 * 3. **No value that poses as code.** lang-core runs an object that has the shape of one of its
 *    own nodes. A statement that writes such an object is replaced with null.
 * 4. **Size.** The gate counts what each statement expands to, with each shared statement at
 *    each use, and what the default of each `$variable` costs to evaluate - see
 *    {@link measureExpression}. A program past {@link MAX_VALUES} is refused.
 * 5. **No state without the switch.** With `bindings` off, each `$variable` declaration is
 *    replaced with null, so lang-core evaluates nothing at all.
 *
 * The result of each text is kept, so that a program is checked and parsed once while the text
 * around it streams.
 * @internal
 */
export function parseOpenUiProgram(
    text: string,
    library: OpenUiLibrary,
    opts: ProgramGateOptions
): GatedProgram {
    let cache = caches.get(library);
    if (!cache) {
        cache = {parser: createParser(library.schema, library.root), programs: new Map()};
        caches.set(library, cache);
    }
    const {programs, parser} = cache,
        key = `${opts.bindings}|${opts.maxElements}|${text}`,
        cached = programs.get(key);
    if (cached) return cached;

    let ret: GatedProgram;
    try {
        const {canonical, errors} = checkProgram(text, library, opts);
        ret = {result: parser.parse(canonical), refusal: null, errors};
    } catch (e) {
        // A walk that overflows the stack is one more program too large to read.
        const refusal = e instanceof SizeLimitError ? e.message : TOO_COMPLEX;
        if (!(e instanceof SizeLimitError) && !(e instanceof RangeError)) {
            logWarn(['Could not check an OpenUI program', e], 'OpenUiGate');
        }
        ret = {result: emptyResult(), refusal, errors: []};
    }

    if (programs.size >= MAX_CACHED) programs.delete(programs.keys().next().value);
    programs.set(key, ret);
    return ret;
}

//------------------
// Implementation
//------------------
const MAX_CACHED = 32,
    TOO_LONG =
        `This program is too long to read: it may hold at most ${MAX_PROGRAM_LENGTH} ` +
        `characters and ${MAX_STATEMENTS} statements.`,
    TOO_COMPLEX = 'This program is too complex to read.',
    REFERS_TO_ITSELF =
        'This program holds statements that refer to each other in a circle, so it cannot be read.',
    LOOP_VARIABLE =
        'This program names the variable of an @Each in a way that cannot be read. Write the ' +
        'name in quotes, as a plain name that no statement has.',
    POSES_AS_CODE =
        'holds an object with the shape of a component or an expression, so it reads as null',
    NAME_RE = /^\$?[A-Za-z_]\w*$/;

const caches = new WeakMap<
    OpenUiLibrary,
    {parser: ReturnType<typeof createParser>; programs: Map<string, GatedProgram>}
>();

type Token = ReturnType<typeof tokenize>[number] & {v?: unknown};

// A statement as lang-core reads it from the plain text.
interface Statement {
    id: string;
    kind: 'state' | 'query' | 'value';
    expr: ASTNode;
}

// Check a program, and return the plain text to hand to lang-core.
function checkProgram(
    text: string,
    library: OpenUiLibrary,
    opts: ProgramGateOptions
): {canonical: string; errors: string[]} {
    if (text.length > MAX_PROGRAM_LENGTH) throw new SizeLimitError(TOO_LONG);
    const table = getTokenTable();
    if (!table) throw new SizeLimitError(TOO_COMPLEX);

    // First reading: the statements of the text as written. A statement that must change is
    // written out as null.
    const errors: string[] = [],
        lines = readStatements(text, table).map(({id, tokens}) => {
            const isState = id.startsWith('$');
            if (isState && !opts.bindings) return `${id} = null`;
            if (findUnsafeObject(parseExpression(tokens))) {
                errors.push(`${id}: ${POSES_AS_CODE}`);
                return `${id} = null`;
            }
            return `${id} = ${tokens.map(it => printToken(it, table)).join(' ')}`;
        });

    // Second reading: the plain text, exactly as lang-core will read it. Every check from here
    // on is of this reading. lang-core closes what is left open, so the gate does too.
    const canonical = lines.join('\n'),
        closed = autoClose(canonical).text,
        statements = new Map<string, Statement>();
    readStatements(closed, table).forEach(({id, tokens, isState}) => {
        const expr = parseExpression(tokens),
            isCall = expr.k === 'Comp' && (expr.name === 'Query' || expr.name === 'Mutation');
        // lang-core runs these too, so the plain text must be free of them.
        if (findUnsafeObject(expr)) throw new SizeLimitError(TOO_COMPLEX);
        if (isState && !opts.bindings && expr.k !== 'Null') throw new SizeLimitError(TOO_COMPLEX);
        statements.set(id, {id, kind: isCall ? 'query' : isState ? 'state' : 'value', expr});
    });

    checkLoops(statements);
    checkExpansion(statements, library, opts);
    if (opts.bindings) checkDefaults(statements);
    return {canonical, errors};
}

// The statements of a text, by lang-core's tokenizer. A name that is not one is left out, as
// lang-core's own reading of the plain text could not give it.
function readStatements(text: string, table: TokenTable) {
    const statements = split(tokenize(text)).filter(it => NAME_RE.test(it.id));
    if (statements.length > MAX_STATEMENTS) throw new SizeLimitError(TOO_LONG);

    return statements.map(({id, tokens, idTokenType}) => {
        let depth = 0;
        for (const {t} of tokens) {
            if (table.open.has(t)) depth++;
            if (table.close.has(t)) depth--;
            if (depth > MAX_NESTING) throw new SizeLimitError(TOO_COMPLEX);
        }
        return {id, tokens: tokens as Token[], isState: idTokenType === table.stateVar};
    });
}

// What each statement expands to once lang-core puts each statement in place of each reference
// to it: its values, and the components among them. Counted on the graph of references, so a
// chain that doubles with each line is counted in one pass.
function checkExpansion(
    statements: Map<string, Statement>,
    library: OpenUiLibrary,
    opts: ProgramGateOptions
) {
    const counts = new Map<string, Expansion>(),
        open = new Set<string>();

    const countStatement = (id: string): Expansion => {
        const known = counts.get(id);
        if (known) return known;
        // lang-core reads a statement that refers to itself as null there, and then expands
        // each statement on the way again at each use. No count on the graph bounds that.
        if (open.has(id)) throw new SizeLimitError(REFERS_TO_ITSELF);

        open.add(id);
        const ret = {values: 0, elements: 0};
        walk(statements.get(id).expr, node => {
            ret.values++;
            if (node.k === 'Str') ret.values += Math.floor(node.v.length / 64);
            if (node.k === 'Comp' && getOwn(library.components, node.name)) ret.elements++;
            if (node.k === 'Ref' && statements.get(node.n)?.kind === 'value') {
                const target = countStatement(node.n);
                ret.values += target.values;
                ret.elements += target.elements;
            }
        });
        open.delete(id);
        counts.set(id, ret);
        return ret;
    };

    // lang-core expands the root, and the arguments of each `$variable` and query. The root is
    // one of the value statements, so the largest of them bounds it.
    const total = {values: 0, elements: 0},
        largest = {values: 0, elements: 0};
    statements.forEach(({id, kind}) => {
        const {values, elements} = countStatement(id),
            into = kind === 'value' ? largest : total;
        if (kind === 'value') {
            into.values = Math.max(into.values, values);
            into.elements = Math.max(into.elements, elements);
        } else {
            into.values += values;
            into.elements += elements;
        }
    });
    if (!(total.values + largest.values <= MAX_VALUES)) throw new SizeLimitError(TOO_LARGE);

    const maxElements = opts.maxElements * MAX_ELEMENTS_FACTOR;
    if (!(total.elements + largest.elements <= maxElements)) {
        throw new SizeLimitError(
            `This program writes more than ${maxElements} components, once each shared ` +
                'statement is counted at each use.'
        );
    }
}

// lang-core evaluates the default of each `$variable` as it parses, in order, with the defaults
// above it, and with each query as null. Measure each one first, with the same.
function checkDefaults(statements: Map<string, Statement>) {
    const declared = new Map<string, ValueShape>(),
        budget = new SizeBudget();

    statements.forEach(({id, kind, expr}) => {
        if (kind !== 'state') return;
        const shape = measureExpression(expr, {
            budget,
            held: (name, heldKind) =>
                (heldKind === 'state' ? declared.get(name) : null) ?? scalarShape(),
            statement: name => {
                const target = statements.get(name);
                if (!target || target.kind === 'state') return undefined;
                return target.kind === 'query' ? 'query' : target.expr;
            }
        });
        budget.spend(shape.size);
        declared.set(id, shape);
    });
}

// The variable of each `@Each` must be a plain name in quotes that no statement has. lang-core
// puts the item of a loop in place of a name without quotes, and reads a name that a statement
// shares as that statement in some places and as the item in others. Either way the names in a
// template would depend on the data, and no measure could trust them.
function checkLoops(statements: Map<string, Statement>) {
    statements.forEach(({expr}) =>
        walk(expr, node => {
            if (node.k !== 'Comp' || node.name !== 'Each' || node.args.length < 2) return;
            const name = node.args[1];
            if (name.k !== 'Str' || !LOOP_NAME_RE.test(name.v) || statements.has(name.v)) {
                throw new SizeLimitError(LOOP_VARIABLE);
            }
        })
    );
}

const LOOP_NAME_RE = /^[A-Za-z_]\w{0,63}$/;

interface Expansion {
    values: number;
    elements: number;
}

// Visit each node of an expression. The brackets of a statement are bounded, but a chain of
// operators is not, so the walk is bounded too.
function walk(node: ASTNode, visit: (node: ASTNode) => void, depth: number = 0) {
    if (!node || !isString(node.k)) return;
    if (depth > MAX_WALK_DEPTH) throw new SizeLimitError(TOO_COMPLEX);
    visit(node);
    const next = (it: ASTNode) => walk(it, visit, depth + 1);
    switch (node.k) {
        case 'Comp':
            node.args.forEach(next);
            break;
        case 'Arr':
            node.els.forEach(next);
            break;
        case 'Obj':
            node.entries.forEach(it => next(it[1]));
            break;
        case 'BinOp':
            next(node.left);
            next(node.right);
            break;
        case 'UnaryOp':
            next(node.operand);
            break;
        case 'Ternary':
            next(node.cond);
            next(node.then);
            next(node.else);
            break;
        case 'Member':
            next(node.obj);
            break;
        case 'Index':
            next(node.obj);
            next(node.index);
            break;
        case 'Assign':
            next(node.value);
            break;
    }
}

const MAX_WALK_DEPTH = 1000;

// True for an expression that writes an object which lang-core would take for one of its own:
// an expression node, by its `k`, an element, by its four keys, or a two-way binding, by its
// `__reactive`. lang-core evaluates such an object, so data would run as code.
function findUnsafeObject(expr: ASTNode): boolean {
    let ret = false;
    walk(expr, node => {
        if (node.k !== 'Obj') return;
        // A key written twice counts each time, whichever value lang-core keeps.
        const keys = new Set(node.entries.map(it => it[0])),
            posesAsNode = node.entries.some(
                ([key, value]) => key === 'k' && !['Num', 'Bool', 'Null'].includes(value?.k)
            );
        if (keys.has('__reactive') || posesAsNode || ELEMENT_KEYS.every(it => keys.has(it))) {
            ret = true;
        }
    });
    return ret;
}

const ELEMENT_KEYS = ['type', 'typeName', 'props', 'partial'];

// lang-core's tokens, as the text that gives each one back. It declares the types as a const
// enum, which has no values to import, so they are read from its tokenizer.
interface TokenTable {
    symbols: Map<number, string>;
    string: number;
    number: number;
    words: Set<number>;
    stateVar: number;
    call: number;
    open: Set<number>;
    close: Set<number>;
}

const SYMBOLS = [
    ...['(', ')', '[', ']', '{', '}', ',', ':', '=', '==', '!=', '>', '<', '>=', '<='],
    ...['&&', '||', '!', '.', '?', '+', '-', '*', '/', '%', 'true', 'false', 'null']
];

let tokenTable: TokenTable;

// Null if the tokenizer does not give one distinct type for each symbol, as after a change to
// it. The gate then refuses every program.
function getTokenTable(): TokenTable {
    if (tokenTable !== undefined) return tokenTable;

    const typeOf = (text: string) => {
            const tokens = tokenize(text);
            return tokens.length === 2 ? (tokens[0].t as number) : null;
        },
        symbols = SYMBOLS.map(typeOf),
        values = ['"a"', '1', 'a', 'A', '$a', '@A'].map(typeOf),
        all = [...symbols, ...values];
    if (all.includes(null) || uniq(all).length !== all.length) {
        logWarn('Could not read the token types of lang-core.', 'OpenUiGate');
        return (tokenTable = null);
    }

    const [string, number, word, typeWord, stateVar, call] = values,
        at = (text: string) => symbols[SYMBOLS.indexOf(text)];
    return (tokenTable = {
        symbols: new Map(symbols.map((type, idx) => [type, SYMBOLS[idx]])),
        string,
        number,
        words: new Set([word, typeWord]),
        stateVar,
        call,
        open: new Set([at('('), at('['), at('{')]),
        close: new Set([at(')'), at(']'), at('}')])
    });
}

// A token as plain text that the tokenizer reads back as the same token. A string keeps only
// letters, digits and spaces as they are, so the text holds no quote, bracket, comment mark or
// fence that a reader of the text could take for syntax.
function printToken(token: Token, table: TokenTable): string {
    const {t, v} = token,
        symbol = table.symbols.get(t);
    if (symbol != null) return symbol;
    if (t === table.string) {
        return `"${String(v).replace(/[^A-Za-z0-9 ]/g, toEscape)}"`;
    }
    if (t === table.number) return isFinite(v) ? String(v) : 'null';
    if (t === table.call) return `@${v}`;
    if (table.words.has(t) || t === table.stateVar) return String(v);
    throw new SizeLimitError(TOO_COMPLEX);
}

function toEscape(char: string): string {
    return `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`;
}

function emptyResult(): ParseResult {
    return {
        root: null,
        meta: {incomplete: false, unresolved: [], orphaned: [], statementCount: 0, errors: []},
        stateDeclarations: {},
        queryStatements: [],
        mutationStatements: []
    };
}
