import type {PlainObject} from '@xh/hoist/core';
import {throwIf} from '@xh/hoist/utils/js';
import {generateSystemPrompt, type ToolSpec} from '@openuidev/lang-core';
import {
    camelCase,
    compact,
    dropRightWhile,
    findKey,
    isArray,
    isEmpty,
    isPlainObject,
    isString,
    isUndefined,
    omit,
    uniqBy
} from 'lodash';
import {getOwn} from '../../impl/LangUtils';
import {
    CHAT_UI_MAX_CONTEXT_ENTRIES,
    CHAT_UI_MAX_SEND_LENGTH,
    isChatUiActionSchema,
    type ChatUiAction
} from '../ChatUiAction';
import type {ChatUiCatalog} from '../ChatUiCatalog';
import type {ChatUiDocument, ChatUiElement} from '../ChatUiDocument';
import type {ChatUiFormatContext, ChatUiTextFormat} from '../ChatUiTextFormat';
import type {ChatUiDocumentSegment, ChatUiTextSegment} from '../ChatUiTextSegment';
import {hashJson} from '../impl/hash';
import {findFences, type MarkdownFence} from '../impl/parseTags';
import {openUiToDocument} from './OpenUiDocument';
import {createLibraryCache} from './impl/libraryCache';
import {createOpenUiStateSpec} from './impl/openUiStateSpec';
import {parseOpenUiProgram} from './impl/programGate';
import {createPromptExamples} from './impl/promptExamples';
import {rewritePromptSections, type PromptSectionOptions} from './impl/promptSections';
import type {OpenUiRuntimeConfig} from './impl/OpenUiRuntime';
import type {OpenUiToolCall} from './impl/OpenUiToolGate';

export type {OpenUiToolCall};
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
     * OpenUI Lang programs to show the model in the prompt, in place of the ones the kit writes.
     * Default at most two complete programs, written from the `example` of each component they
     * use: a brief of components that show data, and, with state on, a view with an input bound
     * to a `$variable`, which feeds a `Query()` and a table where the catalog and a listed tool
     * allow. In inline mode each one is inside an `openui-lang` fence.
     */
    examples?: string[];

    /** The first paragraph of the prompt section. Default a line that introduces OpenUI Lang. */
    preamble?: string;

    /** Rules for the model, added after the kit's own rules. */
    additionalRules?: string[];

    /**
     * True to run OpenUI state: `$variables`, the expressions that read them, and the `@Set` and
     * `@Reset` actions. A prop that a component lists in its `stateProps` takes a `$variable` as
     * a two-way binding. The prompt then teaches all of this, with lang-core's own text. This is
     * the one switch for the evaluator: with it on, a program also runs the built-in functions.
     * Default false, or true when a tool is listed. With it off, the kit evaluates nothing, and
     * drops each prop that holds an expression. The format throws for false with a tool listed.
     */
    bindings?: boolean;

    /**
     * True to list OpenUI's built-in functions, such as `@Count`, `@Filter` and `@Each`, in the
     * prompt. The functions run on the same evaluator as `$variables`, so they run whenever
     * `bindings` is on, whatever this option says. Set it to false to leave them out of the
     * prompt. It needs `bindings`: the format throws for true with `bindings` off. Default the
     * value of `bindings`.
     */
    builtinFunctions?: boolean;

    /**
     * The chat tools that a program may call with `Query()`, by name, or as a spec that also
     * describes the tool in the prompt. A query runs with no click, when its program completes
     * and when a `$variable` in its arguments changes. So it runs only a client tool listed
     * here, with arguments that pass the tool's schema, and never a tool that needs approval for
     * them. Listing a tool turns `bindings` on by default. Default none: a `Query()` keeps its
     * defaults, and runs nothing.
     *
     * A listed tool receives arguments that the model chose, with no action by the user. List
     * only a tool that reads, and that sends its arguments to no third party.
     */
    queryTools?: (string | OpenUiToolSpec)[];

    /**
     * The least seconds between two automatic refreshes of a `Query()`, whatever interval the
     * program asks for. At least 1, whatever is set here. An interval of more than a day is held
     * to a day. Default 10.
     */
    minRefreshSeconds?: number;

    /**
     * Most `Query()` statements in one program. A program with more runs none of them. Default
     * 8. Only the first three programs of a reply that hold queries run them.
     */
    maxCalls?: number;

    /**
     * Most tool calls that all the programs of one chat may start in a minute. A call past it
     * does not run, and its query keeps the result it has. Default 60.
     */
    maxCallsPerMinute?: number;

    /**
     * Called with each tool call of a program that passed its checks, as it starts - to log or
     * audit what programs run. A call is not part of the history, so this is its one trace.
     */
    onToolCall?: (call: OpenUiToolCall) => void;
}

/**
 * A chat tool that an OpenUI Lang program may call, as the prompt describes it. A
 * {@link ChatToolSpec} serves as one, so an app can list the tools it gives the chat.
 */
export interface OpenUiToolSpec {
    /** Name of the tool, as the chat's `tools` list it. */
    name: string;

    /** What the tool does, for the model. */
    description?: string;

    /** JSON Schema of the tool's input, so the model knows its arguments. */
    parameters?: PlainObject;

    /** JSON Schema of the tool's result, so the model can write the defaults of a query. */
    returns?: PlainObject;
}

/**
 * What lang-core's parser found in a program beyond the document it gave. lang-core drops what
 * it cannot use and renders the rest, so these say why a program shows less than it wrote.
 */
export interface OpenUiDiagnostics {
    /**
     * Problems with props and inline calls that lang-core dropped, in the kit's `path: message`
     * form. Problems with whole statements are in the segment's `elementErrors`.
     */
    errors: string[];

    /** Names the program refers to and does not define. Each reference is dropped. */
    unresolved: string[];

    /** Names of the statements that nothing under the root refers to, so they do not render. */
    orphaned: string[];

    /**
     * Ids of the elements with a prop that the state computes: an expression, or a `$variable`.
     * The segment's `document.elements` holds no final value for such a prop, so a check of one
     * of these elements against its schema says nothing of what renders. Empty for a program
     * with no state.
     */
    computed: string[];
}

/** The document segment of an OpenUI Lang program, with what its parser found. */
export interface OpenUiDocumentSegment extends ChatUiDocumentSegment {
    /** What the parser found in the program - for an inspector, a log or an eval. */
    openui: OpenUiDiagnostics;
}

/** True for a segment that {@link openUiLangFormat} parsed from a program. */
export function isOpenUiDocumentSegment(
    segment: ChatUiTextSegment
): segment is OpenUiDocumentSegment {
    return segment?.type === 'document' && isPlainObject((segment as OpenUiDocumentSegment).openui);
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
 * functions either. `bindings`, `builtinFunctions` and `queryTools` turn those on: the format
 * then runs each program on lang-core's store, evaluator and query manager, and the document it
 * returns has `state`. A query calls only the chat tools that the app lists. A program cannot
 * change data: the format runs no `Mutation()`, and throws for a `mutationTools` option.
 *
 * Each document segment the format returns is an {@link OpenUiDocumentSegment}, which carries
 * what the parser found in the program.
 */
export function openUiLangFormat(opts: OpenUiLangFormatOptions): ChatUiTextFormat {
    const {inline = true, examples = null, preamble = null, additionalRules = []} = opts,
        features = getOpenUiFeatures(opts),
        getLibrary = createLibraryCache({
            ...opts,
            bindings: features.bindings,
            toolCalls: features.toolCalls
        });

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
            gated = parseOpenUiProgram(program, library, {
                bindings: features.bindings,
                maxElements: catalog.limits.maxElements
            });
        // A program that the gate refused was not parsed, and shows why.
        if (gated.refusal) {
            return {
                type: 'fallback',
                component: null,
                name: 'openui',
                props: {},
                errors: [gated.refusal],
                caption: gated.refusal,
                source: program
            };
        }

        const {result} = gated,
            {document, elementErrors, ...translation} = openUiToDocument(result, library, {
                complete: !isStreaming,
                text: program,
                catalog,
                // With state, the runtime reads each action again, and warns of what it drops.
                quiet: features.hasState
            }),
            errors = [...gated.errors, ...translation.errors],
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

        // What lang-core dropped from a complete program: props and inline calls with errors, and
        // references to names the program does not define.
        const {unresolved, orphaned} = translation,
            dropped = [...errors, ...unresolved.map(it => `reference to undefined '${it}'`)];
        if (!isStreaming && !isEmpty(dropped)) {
            warnOnce(`errors|${logKey}`, ['OpenUI program rendered without:', ...dropped], SOURCE);
        }

        // A program cut off when the reply ended is complete: nothing more will arrive.
        const isPartial = isStreaming && translation.isPartial,
            state = features.hasState
                ? createOpenUiStateSpec(result, library, {
                      catalog,
                      text: program,
                      isComplete: !isPartial,
                      isTextComplete: !isStreaming,
                      logKey,
                      runtime: features.runtime
                  })
                : null;
        const segment: OpenUiDocumentSegment = {
            type: 'document',
            document: {...document, isPartial, ...(state ? {state} : {})},
            isPartial,
            source: program,
            ...(isEmpty(elementErrors) ? {} : {elementErrors}),
            openui: {errors, unresolved, orphaned, computed: translation.computed}
        };
        return segment;
    };

    const toPrompt = (catalog: ChatUiCatalog) => {
        const library = getLibrary(catalog),
            {root, components, schema} = library,
            sectionOpts: PromptSectionOptions = {
                catalog,
                library,
                root: opts.root,
                bindings: features.bindings,
                builtinFunctions: features.builtinFunctions,
                toolCalls: features.toolCalls,
                formatProgram: doc => formatOpenUiProgram(catalog, library, doc)
            },
            prompt = generateSystemPrompt({
                library: {root, components, schema},
                promptOptions: {
                    // lang-core's inline mode text describes a persistent dashboard, patched
                    // with changed statements. The kit writes its own inline rules instead.
                    inlineMode: false,
                    bindings: features.bindings,
                    toolCalls: features.toolCalls,
                    tools: features.toolCalls ? features.tools : undefined,
                    builtinFunctions: features.builtinFunctions,
                    preamble: preamble ?? (inline ? INLINE_PREAMBLE : PROGRAM_PREAMBLE),
                    examples: examples ?? createExamples(sectionOpts, opts, features, inline)
                }
            });
        // lang-core writes the grammar. The kit writes each part that names components.
        const sections = rewritePromptSections(prompt, sectionOpts);
        if (!isEmpty(sections.missing)) {
            warnOnce(
                `prompt|${sections.missing.join('|')}`,
                [
                    'OpenUI prompt keeps text of lang-core that the kit expected to replace:',
                    ...sections.missing
                ],
                SOURCE
            );
        }
        return addRules(sections.prompt, [
            ...createKitRules(catalog, library, inline, features),
            ...additionalRules
        ]);
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
            // Left out when off, so that a format with no state keeps its version. A callback
            // is no part of the version.
            ...(features.hasState
                ? {features: {...features, runtime: omit(features.runtime, 'onToolCall')}}
                : {})
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

    /** True if a program may call a tool, with `Query()`. */
    toolCalls: boolean;

    /** The tools a program may call, as lang-core's prompt lists them. */
    tools: (string | ToolSpec)[];

    /** True if programs run with state, on lang-core's store and evaluator. */
    hasState: boolean;

    /** What the runtime of each program takes from the options. */
    runtime: Pick<
        OpenUiRuntimeConfig,
        'queryTools' | 'minRefreshSeconds' | 'maxCalls' | 'maxCallsPerMinute' | 'onToolCall'
    >;
}

/** @internal */
export function getOpenUiFeatures(opts: OpenUiLangFormatOptions): OpenUiFeatures {
    const {queryTools = [], minRefreshSeconds, maxCalls, maxCallsPerMinute, onToolCall} = opts,
        specs = uniqBy(queryTools, toolName),
        toolCalls = !isEmpty(specs),
        bindings = opts.bindings ?? toolCalls,
        builtinFunctions = opts.builtinFunctions ?? bindings;

    // One evaluator runs variables, functions and the arguments of a call. So `bindings` is the
    // one switch for it, and nothing else can turn a part of it on.
    throwIf(
        !bindings && (builtinFunctions || toolCalls),
        'OpenUI Lang builtinFunctions and queryTools need bindings: they run on the evaluator ' +
            'that bindings turns on.'
    );
    // An app that passes the option must not think that its programs can write.
    throwIf(
        (opts as PlainObject).mutationTools != null,
        'OpenUI Lang has no mutationTools option: a program cannot change data. Have it send ' +
            'a message with @ToAssistant, so that the assistant acts.'
    );
    return {
        bindings,
        builtinFunctions,
        toolCalls,
        tools: specs.map(toPromptTool),
        hasState: bindings,
        runtime: {
            queryTools: queryTools.map(toolName),
            ...(minRefreshSeconds != null ? {minRefreshSeconds} : {}),
            ...(maxCalls != null ? {maxCalls} : {}),
            ...(maxCallsPerMinute != null ? {maxCallsPerMinute} : {}),
            ...(onToolCall ? {onToolCall} : {})
        }
    };
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
    // Where lang-core's own list of rules ends, and its last section starts.
    AFTER_RULES = '\n\n## Final Verification';

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

function toolName(tool: string | OpenUiToolSpec): string {
    return isString(tool) ? tool : tool.name;
}

// A tool as lang-core's prompt takes it: a name, or a spec with the schemas it has.
function toPromptTool(tool: string | OpenUiToolSpec): string | ToolSpec {
    if (isString(tool)) return tool;
    const {name, description, parameters, returns} = tool;
    return {name, description, inputSchema: parameters, outputSchema: returns} as ToolSpec;
}

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

// Add rules to lang-core's prompt, at the end of its own list of rules. lang-core puts the rules
// it is given after its last section, the checks to run before finishing, where they read as
// more checks.
function addRules(prompt: string, rules: string[]): string {
    if (isEmpty(rules)) return prompt;
    const lines = rules.map(it => `- ${it}`).join('\n'),
        at = prompt.indexOf(AFTER_RULES);
    return at < 0 ? `${prompt}\n\n${lines}` : `${prompt.slice(0, at)}\n${lines}${prompt.slice(at)}`;
}

// The rules the kit adds to lang-core's: how to mix programs with prose, its own caps, the
// features it does not run, and what lang-core's text names that the catalog lacks. They say
// once that a program cannot change data, with what to do instead where a component sends a
// message.
function createKitRules(
    catalog: ChatUiCatalog,
    library: OpenUiLibrary,
    inline: boolean,
    features: OpenUiFeatures
): string[] {
    const {maxElements, maxDepth, maxInlineRows} = catalog.limits,
        usesActions = !!getOwn(library.schema.$defs as PlainObject, 'ActionExpression'),
        canSend = library.actionSteps.includes('ToAssistant');
    const {queryTools} = features.runtime;
    return compact([
        ...(inline ? INLINE_RULES : []),
        createFeatureRule(features),
        features.bindings
            ? 'Bind a $variable only to an argument marked $binding. Any other argument reads ' +
              'it, alone or in an expression.'
            : null,
        !isEmpty(queryTools) ? `Query can call only: ${queryTools.join(', ')}.` : null,
        'A program cannot change data.' +
            (canSend
                ? ' To change something, send a message with @ToAssistant that asks the ' +
                  'assistant to do it.'
                : ''),
        'Use only the components under Component Signatures, with their arguments in the ' +
            'order shown.',
        usesActions
            ? `Keep the message of a @ToAssistant to at most ${CHAT_UI_MAX_SEND_LENGTH} ` +
              `characters, and its context to a flat object of at most ` +
              `${CHAT_UI_MAX_CONTEXT_ENTRIES} short values.`
            : null,
        ...createCatalogRules(catalog),
        `A program holds at most ${maxElements} components, nested at most ${maxDepth} deep, ` +
            `with at most ${maxInlineRows} items in any list.`
    ]);
}

// A rule for a catalog that gives the user nothing to enter.
function createCatalogRules(catalog: ChatUiCatalog): string[] {
    const hasInputs = catalog.components.some(it => !isEmpty(it.stateProps));
    return hasInputs ? [] : ['This library has no inputs and no forms. Ask for input in words.'];
}

// The rule that names the parts of OpenUI Lang the format does not run. Null if it runs them all.
function createFeatureRule(features: OpenUiFeatures): string {
    const {queryTools} = features.runtime,
        off = compact([
            features.bindings ? null : '$variables',
            isEmpty(queryTools) ? 'Query' : null,
            ...(features.bindings ? [] : ['@Set', '@Reset']),
            features.toolCalls ? null : '@Run'
        ]);
    if (isEmpty(off)) return null;
    return `Do not use ${[off.slice(0, -1).join(', '), off.at(-1)].filter(Boolean).join(' or ')}.`;
}

// The example programs of the prompt, written from the catalog. In inline mode each one is in
// a fence, as the model is to write it.
function createExamples(
    sectionOpts: PromptSectionOptions,
    opts: OpenUiLangFormatOptions,
    features: OpenUiFeatures,
    inline: boolean
): string[] {
    const programs = createPromptExamples({
        ...sectionOpts,
        tools: features.tools,
        slotAccepts: opts.slotAccepts
    });
    return inline ? programs.map(it => `\`\`\`${FENCE_TAG}\n${it}\n\`\`\``) : programs;
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
