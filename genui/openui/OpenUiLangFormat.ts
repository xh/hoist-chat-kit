import type {PlainObject} from '@xh/hoist/core';
import {createStreamingParser, generateSystemPrompt, type StreamParser} from '@openuidev/lang-core';
import {
    camelCase,
    compact,
    dropRightWhile,
    findKey,
    isArray,
    isEmpty,
    isPlainObject,
    isString,
    isUndefined
} from 'lodash';
import {getOwn} from '../../impl/LangUtils';
import {
    CHAT_UI_MAX_CONTEXT_ENTRIES,
    CHAT_UI_MAX_SEND_LENGTH,
    isChatUiActionSchema,
    type ChatUiAction
} from '../ChatUiAction';
import type {ChatUiCatalog} from '../ChatUiCatalog';
import {toChatUiDocument, type ChatUiDocument, type ChatUiElement} from '../ChatUiDocument';
import type {ChatUiFormatContext, ChatUiTextFormat} from '../ChatUiTextFormat';
import type {ChatUiTextSegment} from '../ChatUiTextSegment';
import {hashJson} from '../impl/hash';
import {findFences, type MarkdownFence} from '../impl/parseTags';
import {openUiToDocument} from './OpenUiDocument';
import {createLibraryCache} from './impl/libraryCache';
import {createOpenUiStateSpec} from './impl/openUiStateSpec';
import {warnOnce} from './impl/warnOnce';
import type {OpenUiLibrary, OpenUiLibraryOptions} from './OpenUiLibrary';

/** Options for {@link openUiLangFormat} and {@link openUiLangAdapter}. */
export interface OpenUiLangFormatOptions extends OpenUiLibraryOptions {
    /**
     * True to read programs in fenced code blocks tagged `openui-lang` or `openui`, with the text
     * around them as markdown. A text whose first line is `root = ...`, or a statement that calls
     * a component, such as `rev = Metrics(...)`, is one bare program. A bare program that ends
     * with no root statement stays markdown. While the reply streams, a closed fence is complete.
     * False to read the whole text as one program. Default true.
     */
    inline?: boolean;

    /**
     * OpenUI Lang programs to show the model in the prompt. Default one per component with an
     * `example`, written by {@link formatOpenUiProgram}, inside the root when it is not the root.
     */
    examples?: string[];

    /** The first paragraph of the prompt section. Default a line that introduces OpenUI Lang. */
    preamble?: string;

    /** Rules for the model, added after the kit's own rules. */
    additionalRules?: string[];

    /**
     * True to run OpenUI state: `$variables`, the expressions that read them, and the `@Set` and
     * `@Reset` actions. A prop that a component lists in its `stateProps` takes a `$variable` as
     * a two-way binding. The prompt then teaches all of this, with lang-core's own text. Default
     * false: the kit drops each prop that holds a `$variable`.
     */
    bindings?: boolean;

    /**
     * True to run OpenUI's built-in functions, such as `@Count`, `@Filter` and `@Each`, and to
     * list them in the prompt. Default the value of `bindings`.
     */
    builtinFunctions?: boolean;
}

/**
 * The OpenUI Lang format, named `openui`: UI written as an OpenUI Lang program, which
 * `@openuidev/lang-core` parses as it streams. Each statement assigns a component call to a
 * name, and the root statement holds the rest by reference:
 *
 * ```
 * root = Stack([rev, mar], "column", "medium")
 * rev = Metrics([{label: "Revenue", value: 1250000}])
 * mar = Metrics([{label: "Margin", value: 0.184}])
 * ```
 *
 * Each program becomes a `document` segment of catalog components, which renders element by
 * element as its statements complete. Each component takes its children first, then its props
 * in the order of its props schema, then its named slots - see {@link toOpenUiLibrary}.
 *
 * Add it to the catalog's `textFormats`, and name it in `modes` to explain it to the model.
 * The prompt section comes from lang-core, with no inline mode, and with the kit's rules, which
 * explain inline programs in their place. By default it has no state, queries or built-in
 * functions either. `bindings` and `builtinFunctions` turn those on: the format then runs each
 * program on lang-core's store and evaluator, and the document it returns has `state`.
 */
export function openUiLangFormat(opts: OpenUiLangFormatOptions): ChatUiTextFormat {
    const {inline = true, examples = null, preamble = null, additionalRules = []} = opts,
        features = getOpenUiFeatures(opts),
        getLibrary = createLibraryCache({...opts, bindings: features.bindings}),
        parsers = new Map<string, {library: OpenUiLibrary; parser: StreamParser}>();

    // A streaming parser per program of a part, so that each chunk parses only what it adds. Kept
    // until the reply ends, as a program may complete before the rest of the reply.
    const getParser = (
        ctx: ChatUiFormatContext,
        programIndex: number,
        library: OpenUiLibrary
    ): StreamParser => {
        const {messageId, partId, index, isStreaming} = ctx,
            create = () => createStreamingParser(library.schema, library.root);
        if (messageId == null && partId == null) return create();

        const key = `${messageId}|${partId}|${index}|${programIndex}`,
            entry = parsers.get(key),
            cached = entry?.library === library ? entry.parser : null;
        if (!isStreaming) {
            parsers.delete(key);
            return cached ?? create();
        }
        if (cached) return cached;
        if (parsers.size >= MAX_PARSERS) parsers.clear();
        const parser = create();
        parsers.set(key, {library, parser});
        return parser;
    };

    // Parse one program. `isStreaming` is true while the program itself may still grow. A bare
    // program, with no fence, that ends with no root is prose after all, and stays markdown.
    const parseProgram = (
        program: string,
        ctx: ChatUiFormatContext,
        programIndex: number,
        isStreaming: boolean,
        isBare: boolean = false
    ): ChatUiTextSegment => {
        const {catalog, messageId, partId, index} = ctx,
            library = getLibrary(catalog),
            result = getParser(ctx, programIndex, library).set(program, !isStreaming),
            {document, errors, elementErrors, ...translation} = openUiToDocument(result, library, {
                complete: !isStreaming,
                text: program,
                catalog
            }),
            logKey = [messageId ?? program, partId, index, programIndex].join('|');

        // A root that an expression picks, such as a ternary, has no element until it evaluates.
        const hasRoot =
            document.root != null || (features.hasState && result.rootExpression != null);
        if (!hasRoot) {
            if (isStreaming) return {type: 'placeholder', component: null, source: program};
            if (isBare) {
                warnOnce(
                    `noRoot|${logKey}`,
                    'OpenUI program with no root rendered as text',
                    SOURCE
                );
                return markdown(program);
            }
            return {
                type: 'fallback',
                component: null,
                name: 'openui',
                props: {},
                errors: isEmpty(errors)
                    ? [`expected a program with a root statement, root = ${library.root}(...)`]
                    : errors,
                source: program
            };
        }

        // Errors about props and inline calls that lang-core dropped from a complete program.
        if (!isStreaming && !isEmpty(errors)) {
            warnOnce(`errors|${logKey}`, ['OpenUI program rendered without:', ...errors], SOURCE);
        }

        // A program cut off when the reply ended is complete: nothing more will arrive.
        const isPartial = isStreaming && translation.isPartial,
            state = features.hasState
                ? createOpenUiStateSpec(result, library, {
                      catalog,
                      text: program,
                      isComplete: !isPartial,
                      isTextComplete: !isStreaming,
                      logKey
                  })
                : null;
        return {
            type: 'document',
            document: {...document, isPartial, ...(state ? {state} : {})},
            isPartial,
            source: program,
            ...(isEmpty(elementErrors) ? {} : {elementErrors})
        };
    };

    const toPrompt = (catalog: ChatUiCatalog) => {
        const library = getLibrary(catalog),
            {root, components, schema} = library;
        return generateSystemPrompt({
            library: {root, components, schema},
            promptOptions: {
                // lang-core's inline mode text describes a persistent dashboard, patched with
                // changed statements. The kit writes its own inline rules instead.
                inlineMode: false,
                bindings: features.bindings,
                toolCalls: false,
                builtinFunctions: features.builtinFunctions,
                preamble: preamble ?? (inline ? INLINE_PREAMBLE : PROGRAM_PREAMBLE),
                examples: examples ?? createExamples(catalog, library, opts, features),
                additionalRules: [
                    ...createKitRules(catalog, library, inline, features),
                    ...additionalRules
                ]
            }
        });
    };

    return {
        name: 'openui',
        version: hashJson({
            inline,
            examples,
            preamble,
            additionalRules,
            root: opts.root,
            slotAccepts: opts.slotAccepts ?? null,
            // Left out when off, so that a format with no state keeps its version.
            ...(features.hasState ? {features} : {})
        }),

        parse(text, ctx) {
            if (!text) return [];
            const {isStreaming} = ctx,
                start = text.trimStart(),
                firstLine = start.split('\n', 1)[0];
            if (!inline) return [parseProgram(text, ctx, 0, isStreaming)];

            const library = getLibrary(ctx.catalog);
            if (startsProgram(firstLine, library)) {
                return [parseProgram(text, ctx, 0, isStreaming, true)];
            }
            // Hold back a first line that may yet start a program.
            if (isStreaming && !start.includes('\n') && mayStartProgram(start, library)) {
                return [{type: 'placeholder', component: null, source: text}];
            }

            const fences = findFences(text).filter(it => isProgramFence(text, it, isStreaming)),
                ret: ChatUiTextSegment[] = [];
            let pos = 0;
            fences.forEach((fence, programIndex) => {
                const program = text.slice(fence.bodyStart, fence.bodyEnd);
                if (fence.start > pos) ret.push(markdown(text.slice(pos, fence.start)));
                ret.push(parseProgram(program, ctx, programIndex, isStreaming && !fence.closed));
                pos = fence.end;
            });
            if (pos < text.length) ret.push(markdown(text.slice(pos)));
            return ret;
        },

        toPrompt: ({catalog}) => toPrompt(catalog),

        toExport: ({catalog}) => {
            const {root, schema, components} = getLibrary(catalog);
            return {root, schema, components, prompt: toPrompt(catalog)};
        }
    };
}

/**
 * A document as an OpenUI Lang program, as the model would write it: one statement per element,
 * the root first as `root`, then each element after the one that holds it. Children are
 * referenced by name, props are in the order of the component's signature, strings are JSON
 * quoted, and optional props missing at the end are left out. A `send` action becomes
 * `@ToAssistant(...)` and an `openUrl` action `@OpenUrl(...)`. Other actions, which OpenUI Lang
 * cannot write, are skipped. For prompt examples, tests and scripted demos.
 *
 * @param catalog - the catalog the library was built from.
 * @param library - the catalog as an OpenUI library, from {@link toOpenUiLibrary}.
 * @param doc - the document to write.
 */
export function formatOpenUiProgram(
    catalog: ChatUiCatalog,
    library: OpenUiLibrary,
    doc: ChatUiDocument
): string {
    const elements = doc?.elements ?? {},
        names = new Map<string, string>([[doc?.root, 'root']]),
        usedNames = new Set(['root']),
        lines: string[] = [],
        visited = new Set<string>();

    // Each id as a statement name: the id itself where it is a free identifier, else a new one.
    const nameOf = (id: string) => {
        let ret = names.get(id);
        if (ret == null) {
            ret = IDENTIFIER_RE.test(id) && !usedNames.has(id) ? id : null;
            const base = camelCase(getOwn(elements, id)?.component) || 'element';
            for (let idx = 1; ret == null; idx++) {
                if (!usedNames.has(`${base}${idx}`)) ret = `${base}${idx}`;
            }
            names.set(id, ret);
            usedNames.add(ret);
        }
        return ret;
    };

    const visit = (id: string) => {
        const element = getOwn(elements, id);
        if (!isPlainObject(element) || visited.has(id)) return;
        visited.add(id);

        const {call, refs} = formatCall(catalog, library, element, nameOf);
        lines.push(`${nameOf(id)} = ${call}`);
        refs.forEach(visit);
    };
    visit(doc?.root);
    Object.keys(elements).forEach(visit);
    return lines.join('\n');
}

/**
 * The parts of OpenUI Lang that a format or an adapter runs beyond components, from its options.
 * @internal
 */
export interface OpenUiFeatures {
    /** True to run `$variables`, `@Set` and `@Reset`. */
    bindings: boolean;

    /** True to list the built-in functions in the prompt. */
    builtinFunctions: boolean;

    /** True if programs run with state, on lang-core's store and evaluator. */
    hasState: boolean;
}

/** @internal */
export function getOpenUiFeatures(opts: OpenUiLangFormatOptions): OpenUiFeatures {
    const bindings = !!opts.bindings,
        builtinFunctions = opts.builtinFunctions ?? bindings;
    return {bindings, builtinFunctions, hasState: bindings || builtinFunctions};
}

//------------------
// Implementation
//------------------
const SOURCE = 'OpenUiLangFormat',
    FENCE_TAG = 'openui-lang',
    FENCE_TAGS = [FENCE_TAG, 'openui'],
    ROOT_STATEMENT_RE = /^root\s*=(?!=)/,
    CALL_STATEMENT_RE = /^[A-Za-z_]\w*\s*=\s*([A-Z]\w*)\(/,
    ROOT_PREFIX_RE = /^r(o(o(t\s*)?)?)?$/,
    STATEMENT_PREFIX_RE = /^[A-Za-z_]\w*\s*=\s*([A-Z]\w*)?$/,
    IDENTIFIER_RE = /^[A-Za-z_]\w*$/,
    KEY_RE = /^[A-Za-z_$][\w$]*$/,
    BINDING_MARK = '__xhBinding__',
    MAX_PARSERS = 100;

// True for a first line that starts a bare program: `root = ...`, or a statement that calls a
// component of the library. Prose such as `Total = revenue - cost` is neither.
function startsProgram(line: string, library: OpenUiLibrary): boolean {
    if (ROOT_STATEMENT_RE.test(line)) return true;
    const name = CALL_STATEMENT_RE.exec(line)?.[1];
    return name != null && !!getOwn(library.components, name);
}

// True for a first line, still streaming, that may yet start a bare program.
function mayStartProgram(line: string, library: OpenUiLibrary): boolean {
    if (ROOT_PREFIX_RE.test(line)) return true;
    const match = STATEMENT_PREFIX_RE.exec(line);
    if (!match) return false;
    const prefix = match[1] ?? '';
    return Object.keys(library.components).some(it => it.startsWith(prefix));
}

const INLINE_PREAMBLE =
        'You can show UI in your answer by writing a program in OpenUI Lang, a small language ' +
        'for UI. Each program renders in place of its code block, as it streams.',
    PROGRAM_PREAMBLE =
        'Write your whole answer as one program in OpenUI Lang, a small language for UI. Write ' +
        'only the program, with no markdown around it.';

const INLINE_RULES = [
    'Write prose where it helps. Put each program in a fenced code block tagged ' +
        `${FENCE_TAG}, with your words outside it.`,
    'Write every program in full, starting with root. Never write only changed statements.',
    'When a question is best answered with UI, show it; when it is best answered with words, ' +
        'write them.'
];

function markdown(text: string): ChatUiTextSegment {
    return {type: 'markdown', text};
}

// True for a fence tagged as a program. While the text streams, an opener still being written,
// such as `openui-l`, counts too, so that it does not show as an empty code block.
function isProgramFence(text: string, fence: MarkdownFence, isStreaming: boolean): boolean {
    const tag = fence.info.split(/\s/, 1)[0].toLowerCase();
    if (FENCE_TAGS.includes(tag)) return true;
    const isOpenerStreaming = isStreaming && !text.includes('\n', fence.start);
    return isOpenerStreaming && !!tag && FENCE_TAG.startsWith(tag);
}

// The rules the kit adds to lang-core's: how to mix programs with prose, its own caps, and the
// features it does not run.
function createKitRules(
    catalog: ChatUiCatalog,
    library: OpenUiLibrary,
    inline: boolean,
    features: OpenUiFeatures
): string[] {
    const {maxElements, maxDepth, maxInlineRows} = catalog.limits,
        usesActions = !!getOwn(library.schema.$defs as PlainObject, 'ActionExpression');
    return compact([
        ...(inline ? INLINE_RULES : []),
        features.bindings
            ? 'Do not use Query, Mutation or @Run.'
            : 'Do not use $variables, Query, Mutation, @Set, @Reset or @Run.',
        features.bindings
            ? 'Bind a $variable only to an argument marked $binding. Any other argument reads ' +
              'it, alone or in an expression.'
            : null,
        usesActions
            ? `Keep the message of a @ToAssistant to at most ${CHAT_UI_MAX_SEND_LENGTH} ` +
              `characters, and its context to a flat object of at most ` +
              `${CHAT_UI_MAX_CONTEXT_ENTRIES} short values.`
            : null,
        `A program holds at most ${maxElements} components, nested at most ${maxDepth} deep, ` +
            `with at most ${maxInlineRows} items in any list.`
    ]);
}

// A program per component with an example: the root alone, or any other component inside it.
function createExamples(
    catalog: ChatUiCatalog,
    library: OpenUiLibrary,
    opts: OpenUiLangFormatOptions,
    features: OpenUiFeatures
): string[] {
    const {root} = opts,
        rootExample = catalog.getComponent(root)?.example ?? {},
        accepted = getOwn(getOwn(opts.slotAccepts, root), 'default');

    const inRoot = (name: string, props: PlainObject) => {
        const id = camelCase(name);
        return formatOpenUiProgram(catalog, library, {
            root: 'root',
            elements: {
                root: {component: root, props: rootExample, children: [id]},
                [id]: {component: name, props}
            }
        });
    };
    const isAccepted = (name: string) => !accepted || accepted.includes(name),
        examples = catalog.components.map(({name, example}) => {
            if (!example || (name !== root && !isAccepted(name))) return null;
            return name === root
                ? formatOpenUiProgram(catalog, library, toChatUiDocument(name, example))
                : inRoot(name, example);
        });

    // One more, to show a $variable bound to the first component that takes one.
    const bound = features.bindings
        ? catalog.components.find(
              it => it.example && !isEmpty(it.stateProps) && it.name !== root && isAccepted(it.name)
          )
        : null;
    if (bound) {
        const prop = bound.stateProps[0],
            example: PlainObject = bound.example,
            hasName = isString(example.name) && IDENTIFIER_RE.test(example.name),
            variable = '$' + (hasName ? example.name : prop),
            lines = inRoot(bound.name, {...example, [prop]: BINDING_MARK})
                .replace(JSON.stringify(BINDING_MARK), variable)
                .split('\n'),
            declaration =
                example[prop] != null ? `${variable} = ${formatValue(example[prop])}` : null;
        examples.push(compact([lines[0], declaration, ...lines.slice(1)]).join('\n'));
    }
    return compact(examples);
}

// An element as an OpenUI call, with the ids of the elements it references, in order.
function formatCall(
    catalog: ChatUiCatalog,
    library: OpenUiLibrary,
    element: ChatUiElement,
    nameOf: (id: string) => string
): {call: string; refs: string[]} {
    const {component, props = {}, children, slots} = element,
        spec = catalog.getComponent(component),
        specSlots = spec?.slots ?? [],
        openUiName =
            findKey(library.components, (_, key) => library.toCatalogName(key) === component) ??
            component,
        def = getOwn(library.schema.$defs as PlainObject, openUiName),
        refs: string[] = [];

    const keys = Object.keys(def?.properties ?? {}),
        isSlot = (key: string) =>
            key === 'children' ? specSlots.includes('default') : specSlots.includes(key);
    const formatRefs = (ids: string[]) => {
        if (isEmpty(ids)) return undefined;
        refs.push(...ids);
        return `[${ids.map(nameOf).join(', ')}]`;
    };
    const args = keys.map(key => {
        if (!isSlot(key)) {
            return formatProp(getOwn(props, key) ?? undefined, getOwn(spec?.props.properties, key));
        }
        return formatRefs(key === 'children' ? children : getOwn(slots, key));
    });
    // An empty child list before a later argument is written `[]`, any other missing one `null`.
    const written = dropRightWhile(args, isUndefined).map(
        (it, idx) => it ?? (isSlot(keys[idx]) ? '[]' : 'null')
    );
    return {call: `${openUiName}(${written.join(', ')})`, refs};
}

function formatProp(value: unknown, schema: PlainObject): string {
    if (value === undefined) return undefined;
    if (isChatUiActionSchema(schema)) return formatAction(value as ChatUiAction);
    if (schema?.type === 'array' && isChatUiActionSchema(schema.items) && isArray(value)) {
        return `[${compact(value.map(formatAction)).join(', ')}]`;
    }
    return formatValue(value);
}

// An action as an OpenUI action expression, or undefined for one OpenUI Lang cannot write.
function formatAction(action: ChatUiAction): string {
    switch (action?.type) {
        case 'send': {
            const text = JSON.stringify(action.text ?? '');
            return isEmpty(action.context)
                ? `@ToAssistant(${text})`
                : `@ToAssistant(${text}, ${formatValue(action.context)})`;
        }
        case 'openUrl':
            return `@OpenUrl(${JSON.stringify(action.url ?? '')})`;
        default:
            return undefined;
    }
}

function formatValue(value: unknown): string {
    if (isArray(value)) return `[${value.map(formatValue).join(', ')}]`;
    if (isPlainObject(value)) {
        const entries = Object.entries(value).filter(([, it]) => it !== undefined);
        return `{${entries
            .map(
                ([key, it]) => `${KEY_RE.test(key) ? key : JSON.stringify(key)}: ${formatValue(it)}`
            )
            .join(', ')}}`;
    }
    return JSON.stringify(value) ?? 'null';
}
