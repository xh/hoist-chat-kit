import {fragment} from '@xh/hoist/cmp/layout';
import {
    hoistCmp,
    type HoistProps,
    type MessageSpec,
    type PlainObject,
    uses,
    XH
} from '@xh/hoist/core';
import {genDisplayName} from '@xh/hoist/data';
import {untracked} from '@xh/hoist/mobx';
import {logError, logWarn, throwIf} from '@xh/hoist/utils/js';
import {
    castArray,
    isArray,
    isEmpty,
    isFunction,
    isPlainObject,
    isString,
    keyBy,
    mapValues,
    omit,
    uniq,
    values
} from 'lodash';
import {type ReactNode, useEffect} from 'react';
import type {ChatDataRenderer, ChatModel, ChatPartRenderContext, ChatToolSpec} from '../core';
import {ChatArtifactRegistry, type ChatDataHandle} from './ChatArtifactRegistry';
import {type ChatUiAction, type ChatUiActionHandler, chatUiActionSchema} from './ChatUiAction';
import type {ChatUiAdapter} from './ChatUiAdapter';
import type {
    ChatUiComponentSpec,
    ChatUiDataPropSpec,
    ChatUiDocumentContext,
    ChatUiFallbackSpec,
    ChatUiPlaceholderSpec,
    ChatUiRenderContext
} from './ChatUiComponentSpec';
import {
    CHAT_UI_DOCUMENT_DATA_TYPE,
    type ChatUiDocument,
    type ChatUiElement,
    type ChatUiLimits,
    type ChatUiNode,
    toChatUiDocument
} from './ChatUiDocument';
import type {ChatUiParseTagsOptions, ChatUiTextSegment} from './ChatUiTextSegment';
import {
    createDocumentSchema,
    createDocumentToolDescription,
    createPrompt,
    formatTag
} from './impl/catalogPrompt';
import {chatUiElementBoundary, defaultFallback, defaultPlaceholder} from './impl/ChatUiFallback';
import {
    elementPath,
    findDanglingRefs,
    findStructureProblems,
    repairDocument
} from './impl/documentStructure';
import {hashJson} from './impl/hash';
import {parseTags} from './impl/parseTags';
import {
    findSchemaProblems,
    formatError,
    propPath,
    typeOf,
    validateSchema
} from './impl/validateSchema';

/**
 * How the model delivers generative UI - see the genui README:
 *
 *  - `tools` - a tool call per component, `show_<name>`.
 *  - `tags` - a self-closing component tag in the answer's markdown.
 *  - `document` - a call to the document tool, `show_ui`, with a nested {@link ChatUiDocument}.
 */
export type ChatUiDeliveryMode = 'tools' | 'tags' | 'document';

/** Options for {@link ChatUiCatalog.toPrompt} and {@link ChatUiCatalog.toToolSchemas}. */
export interface ChatUiPromptOptions {
    /** The delivery modes to explain, or to export tools for. Default the catalog's `modes`. */
    modes?: ChatUiDeliveryMode[];

    /** App rules, added to the end of the prompt's list of rules. */
    rules?: string[];
}

/** A tool of a catalog, as plain JSON for a server to register - see `toToolSchemas()`. */
export interface ChatUiToolSchema {
    name: string;
    description: string;
    parameters: PlainObject;
}

/** Configuration for a {@link ChatUiCatalog}. */
export interface ChatUiCatalogConfig {
    /** Components the model can show. Names and tool names must be unique. */
    components: ChatUiComponentSpec<any>[];

    /**
     * How the model delivers UI in the chats that use the catalog. Sets the default modes of
     * `instructions`, `toPrompt()` and `toToolSchemas()`, and the tools a client-mode
     * {@link ChatModel} sends: the component tools for `tools`, and the document tool for
     * `document`. Default `['tools']`.
     */
    modes?: ChatUiDeliveryMode[];

    /**
     * Guidance for the model, added to the end of the generated prompt - for example which
     * component suits which question.
     */
    instructions?: string;

    /**
     * Prefix of component tags in markdown, before the component name - `<ui-grid .../>` by
     * default. Letters, digits, `_` and `-`, starting with a letter. Default `ui-`.
     */
    tagPrefix?: string;

    /** Name of the document tool. Default `show_ui`. */
    documentToolName?: string;

    /** Caps on the size of an answer - see {@link ChatUiLimits}. */
    limits?: ChatUiLimits;

    /**
     * The artifact registry of a chat, for components that take data by reference. Called as
     * each component renders. Default the chat's own registry - see {@link ChatModel.artifacts}.
     */
    artifacts?: (chatModel: ChatModel) => ChatArtifactRegistry;

    /** Handlers for `app` actions, by action name. An action with no handler is refused. */
    actionHandlers?: Record<string, ChatUiActionHandler>;

    /**
     * The URLs that `openUrl` actions, and the link props of components, may open - a list of
     * origins, such as `https://example.com`, or a function of the parsed URL. Only `http` and
     * `https` URLs are ever allowed. Default none.
     */
    urlAllowList?: string[] | ((url: URL) => boolean);

    /**
     * Upgrades for documents written against older versions of the catalog, keyed by the
     * `catalogVersion` they upgrade from. Each returns the upgraded document, with its new
     * `catalogVersion`. Chains of upgrades run in turn.
     */
    migrations?: Record<string, (doc: ChatUiDocument) => ChatUiDocument>;

    /** Render an element that cannot render. Default a caption, with a "View input" disclosure. */
    fallback?: (spec: ChatUiFallbackSpec) => ReactNode;

    /** Render an element still streaming in. Default a line such as "Building chart…". */
    placeholder?: (spec: ChatUiPlaceholderSpec) => ReactNode;
}

/**
 * A set of components that the model can show inline in the chat - generative UI built from the
 * app's own Hoist components. The app declares each component with a props schema and a render
 * function. The model picks a component and writes its props, and the chat renders it as the props
 * stream in.
 *
 * Every answer is a {@link ChatUiDocument}, delivered in one of four ways - see the genui README.
 * Pass the catalog to the {@link ChatModel}, which adds its tools, and its `instructions` to the
 * model with the system prompt:
 *
 * ```ts
 * const catalog = new ChatUiCatalog({components: [metricsSpec, positionsSpec]});
 *
 * const chatModel = new ChatModel({
 *     transport: new HoistChatTransport({
 *         url: 'chat',
 *         codec: new AnthropicCodec({system: `${appPrompt}\n\n${catalog.instructions}`})
 *     }),
 *     tools: appTools,
 *     catalog
 * });
 * ```
 *
 * A call's props are checked against the component's schema before it runs. Invalid props fail
 * the call with an error result that lists each problem, so the model can correct itself. Nothing
 * the model writes runs as code: it can only name a catalog component and pass it valid props.
 *
 * Each render costs a model call. A catalog tool is a client tool, so a step that shows a
 * component ends there, and the chat sends the result back in a new step for the model to
 * continue. That adds latency, takes one of the chat's `maxSteps`, and resends the props - up to
 * the component's limits - with the history on every later step. Keep row and point limits low,
 * and raise `maxSteps` for a chat that shows several components per reply.
 */
export class ChatUiCatalog {
    //-----------------------
    // Immutable Properties
    //-----------------------
    /** Components the model can show. */
    readonly components: ChatUiComponentSpec[];

    /**
     * One client tool per component, which a client-mode chat with the catalog sends for the
     * `tools` mode. Each tool checks the props it is called with and confirms the render to the
     * model, and displays its calls as the rendered component.
     */
    readonly tools: ChatToolSpec[];

    /**
     * The document tool, `show_ui`, whose input is a {@link ChatUiDocument} over the catalog's
     * components - for nested answers. A client tool, as those in `tools`, which a client-mode
     * chat with the catalog sends for the `document` mode.
     */
    readonly documentTool: ChatToolSpec;

    /**
     * The catalog's tools, the document tool last, as display-only specs for a chat whose server
     * runs the tool loop and registers the tools itself. A server-mode chat with the catalog adds
     * them. Each displays its calls as `tools` do, with no `execute`, and is not sent to the
     * model.
     */
    readonly displayTools: ChatToolSpec[];

    /**
     * Text for the system prompt that explains the catalog to the model, for its `modes`: when
     * to show UI, the rules to follow, and how to show each component. Ends with the
     * `instructions` given in the config, if any. The same as `toPrompt()` with no options.
     */
    readonly instructions: string;

    /** How the model delivers UI in the chats that use the catalog. */
    readonly modes: ChatUiDeliveryMode[];

    /**
     * A stable hash of the catalog's content - the names, descriptions, schemas, examples and
     * limits of its components, and its instructions. A server that loads an export of the catalog
     * compares it with the version the browser sends, to detect drift.
     */
    readonly version: string;

    /** Prefix of component tags in markdown. */
    readonly tagPrefix: string;

    /** Name of the document tool. */
    readonly documentToolName: string;

    /** Caps on the size of an answer. */
    readonly limits: Required<ChatUiLimits>;

    constructor(config: ChatUiCatalogConfig) {
        const {
            components,
            modes = DEFAULT_MODES,
            instructions = null,
            tagPrefix = 'ui-',
            documentToolName = 'show_ui',
            limits,
            artifacts = null,
            actionHandlers = {},
            urlAllowList = null,
            migrations = {},
            fallback = defaultFallback,
            placeholder = defaultPlaceholder
        } = config;

        throwIf(isEmpty(components), 'ChatUiCatalog requires at least one component.');
        components.forEach(it => checkComponent(it));
        throwIf(
            uniq(components.map(it => it.name)).length !== components.length ||
                uniq([...components.map(getToolName), documentToolName]).length !==
                    components.length + 1,
            'ChatUiCatalog component names and tool names must be unique.'
        );
        throwIf(
            isEmpty(modes) || !modes.every(it => DELIVERY_MODES.includes(it)),
            `ChatUiCatalog modes must be one or more of ${DELIVERY_MODES.join(', ')}.`
        );
        throwIf(
            !TAG_PREFIX_RE.test(tagPrefix),
            `ChatUiCatalog tagPrefix '${tagPrefix}' must start with a letter, and hold only ` +
                'letters, digits, _ and -.'
        );

        this.components = components;
        this.modes = uniq(modes);
        this.componentsByName = keyBy(components, 'name');
        this.configInstructions = instructions;
        this.tagPrefix = tagPrefix;
        this.documentToolName = documentToolName;
        this.limits = {...DEFAULT_LIMITS, ...limits};
        this.getArtifacts = artifacts;
        this.actionHandlers = actionHandlers;
        this.urlAllowList = urlAllowList;
        this.migrations = migrations;
        this.fallbackRenderer = fallback;
        this.placeholderRenderer = placeholder;

        this.tools = components.map(it => this.createComponentTool(it));
        this.documentTool = this.createDocumentTool();
        this.displayTools = [...this.tools, this.documentTool].map(toDisplayTool);
        this.instructions = this.toPrompt();
        this.version = hashJson({
            components: components.map(it => ({
                name: it.name,
                toolName: getToolName(it),
                description: it.description,
                props: it.props,
                example: it.example,
                slots: it.slots,
                dataProps: it.dataProps
            })),
            modes: this.modes,
            instructions,
            tagPrefix,
            documentToolName,
            limits: this.limits
        });
    }

    /** The spec for a component, by name, or null. */
    getComponent(name: string): ChatUiComponentSpec {
        return (isString(name) && this.componentsByName[name]) || null;
    }

    //------------------------
    // Validation
    //------------------------
    /**
     * Check props for a component against its `props` schema and the inline row cap and, if they
     * pass, its `validate` function. The schema check covers a subset of JSON Schema, listed in
     * the genui README. The constructor refuses a schema that uses a keyword outside it which
     * affects validity.
     *
     * @param name - name of the component.
     * @param props - the props to check.
     * @param opts - set `isPartial` for props that are still streaming. Checks that complete props
     *      could still pass are skipped - required properties, minimum sizes, string patterns - as
     *      is `validate`.
     * @returns a message for each problem, prefixed with the path of the prop at fault - for
     *      example `rows[3].value: expected number, got string`. Empty if the props are valid.
     */
    validate(name: string, props: PlainObject, opts: {isPartial?: boolean} = {}): string[] {
        const component = this.getComponent(name);
        if (!component) return [`Unknown component '${name}'.`];
        return this.validateProps(component, props, !!opts.isPartial, '');
    }

    /**
     * Check a document: its structure - a root, no dangling ids, no cycles, one parent per
     * element, and the element and depth caps - then each element's component, child lists and
     * props. Run {@link repairDocument} first, to fix what can be fixed without loss.
     *
     * @param doc - the document to check.
     * @param opts - set `isPartial` for a document still streaming. A missing root, ids that name
     *      no element yet, and incomplete elements are then not problems.
     * @returns a message for each problem, prefixed with its path - for example
     *      `elements.chart.props.type: expected one of "line", "bar"`. Empty if the document is
     *      valid.
     */
    validateDocument(doc: ChatUiDocument, opts: {isPartial?: boolean} = {}): string[] {
        const isPartial = !!opts.isPartial,
            problems = findStructureProblems(doc, {isPartial, ...this.limits});
        if (!isEmpty(problems) || !isPlainObject(doc?.elements)) return problems;

        return [
            ...(isPartial ? [] : findDanglingRefs(doc)),
            ...Object.entries(doc.elements).flatMap(([id, it]) =>
                this.findElementProblems(id, it, isPartial)
            )
        ];
    }

    /**
     * Fix what can be fixed in a document without losing anything the model meant: drop unknown
     * keys, take `elements` as a list with ids, take an element's `type` as its `component`,
     * move props written beside `props` into it, and wrap a single child id in a list. Problems it
     * cannot fix are left for {@link validateDocument} to report.
     *
     * @returns a new document - the input is left as it was.
     */
    repairDocument(doc: ChatUiDocument): ChatUiDocument {
        return repairDocument(doc, name => this.getComponent(name));
    }

    /**
     * Upgrade a document written against an older version of the catalog, with the catalog's
     * `migrations`. A document of the current version, or of a version with no migration, is
     * returned as it is.
     */
    migrateDocument(doc: ChatUiDocument): ChatUiDocument {
        let ret = doc;
        for (let step = 0; step < MAX_MIGRATIONS; step++) {
            const from = isPlainObject(ret) ? ret.catalogVersion : null,
                migrate = from && from !== this.version ? this.migrations[from] : null;
            if (!migrate) break;
            ret = migrate(ret);
            if (ret?.catalogVersion === from) break;
        }
        return ret;
    }

    //------------------------
    // Rendering
    //------------------------
    /**
     * Render a document, with each element inside an error boundary. The document is migrated and
     * repaired first. A document with no `catalogVersion` takes that of the message that holds it,
     * as {@link ChatModel} records it on each reply that shows catalog UI. While it is partial, an element that has not arrived renders as a
     * placeholder. An element with an unknown component or invalid props renders as a fallback -
     * a caption, with the problems and the input behind a disclosure - and logs a warning once.
     * So does a document whose structure is broken.
     *
     * @param doc - the document to render.
     * @param context - the part that holds the document, and whether it is still streaming.
     */
    renderDocument(doc: ChatUiDocument, context: ChatUiDocumentContext): ReactNode {
        const {isPartial} = context;

        let repaired: ChatUiDocument;
        try {
            repaired = this.repairDocument(this.migrateDocument(withMessageVersion(doc, context)));
        } catch (e) {
            logError(['Could not migrate a document', e], 'ChatUiCatalog');
            return this.renderFallback(
                {component: null, caption: CAPTION, errors: [String(e)], input: doc},
                context
            );
        }

        if (repaired == null && isPartial) return this.renderPlaceholder(null);

        const problems = findStructureProblems(repaired, {isPartial, ...this.limits});
        if (!isEmpty(problems)) {
            return this.renderFallback(
                {component: null, caption: CAPTION, errors: problems, input: doc},
                context
            );
        }
        if (repaired.root == null || repaired.elements == null) return this.renderPlaceholder(null);
        return this.renderElement(repaired, repaired.root, context);
    }

    /**
     * Split a text part into markdown and component tags - `<ui-NAME prop="text" prop='JSON'/>`.
     * Tags in fenced or inline code, or escaped with a backslash, stay markdown. Each tag's
     * attributes are read with the browser's XML parser and checked as the component's props:
     * text that starts with `[` or `{` parses as JSON, as does a number or boolean for a prop that
     * takes no text. Render each segment that is not markdown with {@link renderSegment}.
     *
     * @param text - the text, in markdown.
     * @param opts - set `isStreaming` while the text streams, to hold back a tag still being
     *      written as a placeholder segment.
     */
    parseTags(text: string, opts: ChatUiParseTagsOptions = {}): ChatUiTextSegment[] {
        return parseTags(text, {
            prefix: this.tagPrefix,
            isStreaming: !!opts.isStreaming,
            getComponent: name => this.getComponent(name),
            validate: (name, props) => this.validate(name, props)
        });
    }

    /**
     * Render a segment from {@link parseTags}: a component tag as its component, a tag still
     * streaming as a placeholder, and a broken tag as a fallback. A markdown segment renders
     * nothing - render it as markdown.
     *
     * @param segment - the segment to render.
     * @param context - the text part that holds the tag, and its chat.
     */
    renderSegment(
        segment: ChatUiTextSegment,
        context: Omit<ChatUiDocumentContext, 'isPartial'>
    ): ReactNode {
        switch (segment.type) {
            case 'component': {
                const {component, props} = segment.element;
                return this.renderDocument(toChatUiDocument(component, props), {
                    ...context,
                    isPartial: false
                });
            }
            case 'placeholder':
                return this.renderPlaceholder(segment.component);
            case 'fallback':
                return this.renderFallback(
                    {
                        component: segment.component,
                        caption: this.getCaption(segment.component),
                        errors: segment.errors,
                        input: segment.source
                    },
                    context
                );
            default:
                return null;
        }
    }

    /**
     * A component tag, as the model would write it - text values in double quotes, and other
     * values as JSON in single quotes. For examples, tests and scripted demos.
     */
    formatTag(name: string, props: PlainObject): string {
        return formatTag(this.tagPrefix, name, props);
    }

    /**
     * Data renderers that draw generative UI from data parts, for
     * {@link ChatModelConfig.dataRenderers}: one for documents sent as-is, with the `dataType`
     * `xh.chat.ui`, and one per adapter, which translates a protocol's payload into a document.
     */
    createDataRenderers(adapters: ChatUiAdapter[] = []): Record<string, ChatDataRenderer> {
        return {
            [CHAT_UI_DOCUMENT_DATA_TYPE]: (part, context) =>
                this.renderDocument(part.data, {...context, part, isPartial: false}),
            ...mapValues(
                keyBy(adapters, 'dataType'),
                (adapter): ChatDataRenderer =>
                    (part, context) => {
                        let doc: ChatUiDocument;
                        try {
                            doc = adapter.translate(part.data, this);
                        } catch (e) {
                            logError(
                                [`Could not translate '${adapter.dataType}' data`, e],
                                'ChatUiCatalog'
                            );
                            return null;
                        }
                        return this.renderDocument(doc, {...context, part, isPartial: false});
                    }
            )
        };
    }

    //------------------------
    // Actions
    //------------------------
    /**
     * Run an action that the model wrote into a component's props. The action is untrusted, so it
     * is checked first, and refused with an error if it fails:
     *
     *  - `send` - sends the text as the user's message, with any `context` on its
     *    `metadata.context`. Does nothing while the chat is busy.
     *  - `openUrl` - opens the URL in a new tab, if `urlAllowList` allows it.
     *  - `navigate` - routes the app with `XH.navigate()`.
     *  - `callTool` - runs a client tool of the chat, once its input passes the tool's schema. A
     *    tool that needs approval asks the user first. Resolves to the tool's result.
     *  - `app` - runs the handler in `actionHandlers` for its name. Resolves to its result.
     *
     * An action with `confirm` asks the user first, with `XH.confirm()`, and does nothing if they
     * cancel.
     *
     * @param action - the action to run.
     * @param context - the chat and message of the component that runs it.
     */
    async runActionAsync(action: ChatUiAction, context: ChatPartRenderContext): Promise<unknown> {
        const errors = validateSchema(action, ACTION_SCHEMA);
        throwIf(!isEmpty(errors), `Invalid action: ${errors.join('; ')}`);

        const {chatModel} = context;
        switch (action.type) {
            case 'send': {
                const {text, context: messageContext} = action;
                throwIf(
                    messageContext != null &&
                        JSON.stringify(messageContext).length > MAX_CONTEXT_LENGTH,
                    `Invalid action: context is longer than ${MAX_CONTEXT_LENGTH} characters.`
                );
                if (!(await this.confirmAsync(action.confirm))) return null;
                return chatModel.sendAsync(
                    messageContext != null ? {text, metadata: {context: messageContext}} : text
                );
            }
            case 'openUrl':
                throwIf(!this.isUrlAllowed(action.url), `URL not allowed: ${action.url}`);
                if (!(await this.confirmAsync(action.confirm))) return null;
                XH.openWindow(action.url, '_blank');
                return null;
            case 'navigate':
                if (!(await this.confirmAsync(action.confirm))) return null;
                XH.navigate(action.route, action.params ?? {});
                return null;
            case 'callTool': {
                const tool = chatModel.getToolSpec(action.name),
                    input = action.input ?? {};
                throwIf(!tool?.execute, `No client tool named '${action.name}'.`);
                const inputErrors = tool.parameters ? validateSchema(input, tool.parameters) : [];
                throwIf(
                    !isEmpty(inputErrors),
                    `Invalid input for tool '${action.name}': ${inputErrors.join('; ')}`
                );
                if (!(await this.confirmAsync(getToolConfirm(tool, input, action)))) return null;
                return tool.execute(input, {
                    chatModel,
                    toolCallId: XH.genId(),
                    signal: new AbortController().signal
                });
            }
            case 'app': {
                const handler = this.actionHandlers[action.name];
                throwIf(!handler, `No handler for app action '${action.name}'.`);
                if (!(await this.confirmAsync(action.confirm))) return null;
                return handler(action.params ?? {}, context);
            }
        }
    }

    /**
     * True if `urlAllowList` allows a URL - for `openUrl` actions, and for components that show
     * links or load URLs the model wrote. Only absolute `http` and `https` URLs can pass.
     */
    isUrlAllowed(url: string): boolean {
        let parsed: URL;
        try {
            parsed = new URL(url);
        } catch (ignored) {
            return false;
        }
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;

        const {urlAllowList} = this;
        if (isFunction(urlAllowList)) return !!urlAllowList(parsed);
        return !!urlAllowList?.includes(parsed.origin);
    }

    //------------------------
    // Server export
    //------------------------
    /**
     * The catalog's tools as plain JSON - name, description and input schema - for a server that
     * runs the tool loop to register as display tools.
     *
     * @param opts - `modes` selects the tools: `tools` for one per component, `document` for the
     *      document tool. Default the catalog's `modes`.
     */
    toToolSchemas(opts: Pick<ChatUiPromptOptions, 'modes'> = {}): ChatUiToolSchema[] {
        const {modes = this.modes} = opts;
        return [
            ...(modes.includes('tools') ? this.tools : []),
            ...(modes.includes('document') ? [this.documentTool] : [])
        ].map(({name, description, parameters}) => ({name, description, parameters}));
    }

    /**
     * System prompt text that explains the catalog to the model: the rules, then how to deliver
     * UI in each mode given, then the config's `instructions`. The `tags` mode lists each
     * component with its description and props, and the tag grammar the parser reads, so the
     * prompt and the parser come from one source.
     *
     * @param opts - the delivery `modes` to explain, default the catalog's `modes`, and app
     *      `rules` to add.
     */
    toPrompt(opts: ChatUiPromptOptions = {}): string {
        const {modes = this.modes, rules = []} = opts;
        return createPrompt(this.promptSource, modes, rules);
    }

    //------------------
    // Implementation
    //------------------
    private readonly componentsByName: Record<string, ChatUiComponentSpec>;
    private readonly configInstructions: string;
    private readonly getArtifacts: (chatModel: ChatModel) => ChatArtifactRegistry;
    private readonly actionHandlers: Record<string, ChatUiActionHandler>;
    private readonly urlAllowList: string[] | ((url: URL) => boolean);
    private readonly migrations: Record<string, (doc: ChatUiDocument) => ChatUiDocument>;
    private readonly fallbackRenderer: (spec: ChatUiFallbackSpec) => ReactNode;
    private readonly placeholderRenderer: (spec: ChatUiPlaceholderSpec) => ReactNode;

    // Fallbacks already logged, so that each logs once, however often it renders.
    private readonly loggedFallbacks = new Set<string>();

    private get promptSource() {
        return {
            components: this.components,
            instructions: this.configInstructions,
            tagPrefix: this.tagPrefix,
            documentToolName: this.documentToolName,
            limits: this.limits,
            getToolName
        };
    }

    private validateProps(
        component: ChatUiComponentSpec,
        props: PlainObject,
        isPartial: boolean,
        path: string
    ): string[] {
        const errors = validateSchema(props, component.props, {isPartial, path}),
            {maxInlineRows} = this.limits;

        if (isPlainObject(props)) {
            Object.entries(props).forEach(([key, value]) => {
                const schemaMax = component.props.properties?.[key]?.maxItems;
                if (
                    isArray(value) &&
                    value.length > maxInlineRows &&
                    !(schemaMax <= maxInlineRows)
                ) {
                    errors.push(
                        formatError(
                            propPath(path, key),
                            `expected at most ${maxInlineRows} items inline, got ` +
                                `${value.length} - pass large data by reference`
                        )
                    );
                }
            });
        }
        if (isEmpty(errors) && !isPartial && component.validate) {
            errors.push(...component.validate(props).map(it => (path ? `${path}.${it}` : it)));
        }
        return errors;
    }

    /** Problems with one element of a document: its component, child lists and props. */
    private findElementProblems(id: string, element: ChatUiElement, isPartial: boolean): string[] {
        const path = elementPath(id);
        if (!isPlainObject(element)) {
            return [formatError(path, `expected object, got ${typeOf(element)}`)];
        }

        const {component: name, props = {}, children, slots} = element,
            component = this.getComponent(name);
        if (name == null) return isPartial ? [] : [formatError(`${path}.component`, 'required')];
        if (!isString(name)) {
            return [formatError(`${path}.component`, `expected string, got ${typeOf(name)}`)];
        }
        if (!component) {
            const couldStillMatch =
                isPartial && this.components.some(it => it.name.startsWith(name));
            return couldStillMatch
                ? []
                : [formatError(`${path}.component`, `unknown component '${name}'`)];
        }

        const ret: string[] = [],
            takes = component.slots ?? [];
        const checkIdList = (list: unknown, listPath: string) => {
            if (!isArray(list)) {
                ret.push(formatError(listPath, `expected array, got ${typeOf(list)}`));
            } else {
                list.forEach((it, idx) => {
                    if (!isString(it)) {
                        ret.push(
                            formatError(`${listPath}[${idx}]`, `expected string, got ${typeOf(it)}`)
                        );
                    }
                });
            }
        };

        if (children != null) {
            if (!takes.includes('default') && !isEmpty(children)) {
                ret.push(formatError(`${path}.children`, `component '${name}' takes no children`));
            } else {
                checkIdList(children, `${path}.children`);
            }
        }
        if (slots != null) {
            if (!isPlainObject(slots)) {
                ret.push(formatError(`${path}.slots`, `expected object, got ${typeOf(slots)}`));
            } else {
                Object.entries(slots).forEach(([slot, list]) => {
                    const slotPath = propPath(`${path}.slots`, slot);
                    if (slot === 'default' || !takes.includes(slot)) {
                        ret.push(
                            formatError(slotPath, `component '${name}' has no slot '${slot}'`)
                        );
                    } else {
                        checkIdList(list, slotPath);
                    }
                });
            }
        }
        return [...ret, ...this.validateProps(component, props, isPartial, `${path}.props`)];
    }

    private renderElement(
        doc: ChatUiDocument,
        id: string,
        context: ChatUiDocumentContext
    ): ReactNode {
        const {isPartial} = context,
            element = doc.elements[id];

        if (element == null) {
            return isPartial
                ? this.renderPlaceholder(null, id)
                : this.renderFallback(
                      {
                          component: null,
                          caption: CAPTION,
                          errors: [formatError(elementPath(id), 'missing')],
                          input: null
                      },
                      context,
                      id
                  );
        }

        const component = this.getComponent(element.component),
            errors = this.findElementProblems(id, element, isPartial);
        if (!isEmpty(errors)) {
            return this.renderFallback(
                {
                    component: component?.name ?? null,
                    caption: this.getCaption(component?.name),
                    errors,
                    input: element
                },
                context,
                id
            );
        }
        if (!component) return this.renderPlaceholder(null, id);

        const renderIds = (ids: string[]) =>
                (ids ?? []).map(childId => this.renderElement(doc, childId, context)),
            node: ChatUiNode = {...element, id, props: element.props ?? {}};

        // An element that threw while partial gets another try once complete.
        return chatUiElementBoundary({
            key: id,
            resetKey: isPartial,
            renderError: e =>
                this.renderFallback(
                    {
                        component: component.name,
                        caption: this.getCaption(component.name),
                        errors: [(e as Error)?.message ?? String(e)],
                        input: element
                    },
                    context,
                    id
                ),
            item: chatUiComponent({
                spec: component,
                node,
                context,
                catalog: this,
                registry: this.getRegistry(context.chatModel),
                children: renderIds(element.children),
                slots: mapValues(element.slots ?? {}, renderIds)
            })
        });
    }

    private renderPlaceholder(name: string, key?: string): ReactNode {
        return fragment({
            key,
            item: this.placeholderRenderer({
                component: name,
                displayName: name ? genDisplayName(name) : null
            })
        });
    }

    private renderFallback(
        spec: ChatUiFallbackSpec,
        context: Omit<ChatUiDocumentContext, 'isPartial'>,
        key?: string
    ): ReactNode {
        const logKey = [context.messageId, context.part?.id, key, ...spec.errors].join('|');
        if (!this.loggedFallbacks.has(logKey)) {
            this.loggedFallbacks.add(logKey);
            logWarn([spec.caption, spec.errors.join('; ')], 'ChatUiCatalog');
        }
        return fragment({key, item: this.fallbackRenderer(spec)});
    }

    private getRegistry(chatModel: ChatModel): ChatArtifactRegistry {
        const {getArtifacts} = this;
        return (getArtifacts ? getArtifacts(chatModel) : chatModel?.artifacts) ?? NO_ARTIFACTS;
    }

    private getCaption(name: string): string {
        return name
            ? `This ${genDisplayName(name).toLowerCase()} could not be displayed.`
            : CAPTION;
    }

    /** True for a complete document that a migration of the catalog would change. */
    private needsMigration(doc: ChatUiDocument, context: ChatUiDocumentContext): boolean {
        if (context.isPartial || isEmpty(this.migrations)) return false;
        const versioned = withMessageVersion(doc, context);
        return this.migrateDocument(versioned) !== versioned;
    }

    private async confirmAsync(spec: MessageSpec): Promise<boolean> {
        return spec ? XH.confirm(spec) : true;
    }

    private createComponentTool(component: ChatUiComponentSpec): ChatToolSpec {
        const {name, description, result} = component;
        return {
            name: getToolName(component),
            displayName: genDisplayName(name),
            description: `${description.trim()}\n\n${TOOL_NOTE}`,
            parameters: component.props,
            display: 'inline',
            execute: input => {
                const errors = this.validate(name, input);
                if (!isEmpty(errors)) throw invalidInputError('props', errors);
                return result ? result(input) : `Rendered ${name} for the user.`;
            },
            renderer: (part, context) => {
                const input = part.input ?? {},
                    isPartial = part.state === 'input-streaming',
                    doc = toChatUiDocument(name, input),
                    renderContext = {...context, part, isPartial};

                // A call from an older catalog renders through its migrations, with a fallback
                // if it still fails.
                if (this.needsMigration(doc, renderContext)) {
                    return this.renderDocument(doc, renderContext);
                }

                // Render only props that are valid, or could still become valid as they stream.
                // The call's status shows why invalid props did not render.
                if (!isEmpty(this.validate(name, input, {isPartial}))) return null;
                return this.renderDocument(doc, renderContext);
            }
        };
    }

    private createDocumentTool(): ChatToolSpec {
        return {
            name: this.documentToolName,
            displayName: 'UI',
            description: `${createDocumentToolDescription(this.promptSource)}\n\n${TOOL_NOTE}`,
            parameters: createDocumentSchema(this.promptSource),
            display: 'inline',
            execute: input => {
                const doc = this.repairDocument(input as ChatUiDocument),
                    errors = this.validateDocument(doc);
                if (!isEmpty(errors)) throw invalidInputError('document', errors);
                const names = uniq(values(doc.elements).map(it => it.component));
                return `Rendered ${pluralizeElements(doc)} for the user: ${names.join(', ')}.`;
            },
            renderer: (part, context) => {
                const isPartial = part.state === 'input-streaming',
                    doc = part.input as ChatUiDocument,
                    renderContext = {...context, part, isPartial};

                // As for a component tool, a complete document that fails renders nothing.
                if (
                    !isPartial &&
                    !this.needsMigration(doc, renderContext) &&
                    !isEmpty(this.validateDocument(this.repairDocument(doc)))
                ) {
                    return null;
                }
                return this.renderDocument(doc, renderContext);
            }
        };
    }
}

//------------------
// Implementation
//------------------
interface ChatUiComponentProps extends HoistProps {
    spec: ChatUiComponentSpec;
    node: ChatUiNode;
    context: ChatUiDocumentContext;
    catalog: ChatUiCatalog;
    registry: ChatArtifactRegistry;
    children: ReactNode[];
    slots: Record<string, ReactNode[]>;
}

// Renders a catalog component as a component of its own, so that hooks in its `render` belong to
// it, and props that fail validation unmount it rather than skip its hooks. Takes any model in
// context, as `useLocalModel()` needs a component with a model spec. Not memoized, as its host -
// the part's own component - renders only when the part changes. Observes the artifact registry,
// so that a component re-renders as its data arrives.
const chatUiComponent = hoistCmp.factory<ChatUiComponentProps>({
    displayName: 'ChatUiComponent',
    model: uses('*', {optional: true}),
    memo: false,

    render({spec, node, context, catalog, registry, children, slots}) {
        const {props} = node,
            dataProps = getDataProps(spec).filter(it => isString(props[it.name]) && props[it.name]),
            handles: Record<string, ChatDataHandle> = {};

        dataProps.forEach(({name, pageSize = DEFAULT_PAGE_SIZE, maxRows}) => {
            const id = props[name],
                isStreaming = !registry.get(id) && isMessageStreaming(context);
            handles[name] = registry.getHandle(id, {pageSize, maxRows, isStreaming});
        });

        // Load the first page of each reference whose artifact has arrived. Loads are shared
        // and cached by the registry, so this is cheap on every render. A failed load is
        // recorded on the handle.
        useEffect(() => {
            dataProps.forEach(({name, pageSize = DEFAULT_PAGE_SIZE}) => {
                const handle = handles[name];
                if (handle.state !== 'loading') return;
                handle.loadRangeAsync(0, pageSize).catch(() => null);
            });
        });

        const renderContext: ChatUiRenderContext = {
            ...context,
            catalog,
            element: node,
            children,
            slots,
            data: handles,
            runActionAsync: action => catalog.runActionAsync(action, context)
        };
        return spec.render(props, renderContext);
    }
});

const DEFAULT_LIMITS: Required<ChatUiLimits> = {
        maxElements: 50,
        maxDepth: 8,
        maxInlineRows: 500
    },
    DEFAULT_MODES: ChatUiDeliveryMode[] = ['tools'],
    DELIVERY_MODES: ChatUiDeliveryMode[] = ['tools', 'tags', 'document'],
    DEFAULT_PAGE_SIZE = 100,
    MAX_MIGRATIONS = 20,
    MAX_CONTEXT_LENGTH = 2000,
    TAG_PREFIX_RE = /^[A-Za-z][A-Za-z0-9_-]*$/,
    CAPTION = 'This content could not be displayed.',
    TOOL_NOTE = 'Calling this tool shows the component to the user, inline in the chat.',
    ACTION_SCHEMA = chatUiActionSchema();

// Resolves reference props for a catalog with no `artifacts` config - every one is waiting or
// missing.
const NO_ARTIFACTS = new ChatArtifactRegistry();

function getToolName(component: ChatUiComponentSpec): string {
    return component.toolName ?? `show_${component.name}`;
}

function getDataProps(component: ChatUiComponentSpec): ChatUiDataPropSpec[] {
    return (component.dataProps ?? []).map(it => (isString(it) ? {name: it} : it));
}

/** Throw if a component spec is incomplete, or relies on what the catalog cannot check. */
function checkComponent(component: ChatUiComponentSpec) {
    const {name, props, render, slots, dataProps} = component;
    throwIf(
        !name || !props || !render,
        `ChatUiCatalog component '${name}' requires a name, props and render.`
    );

    const problems = findSchemaProblems(props);
    throwIf(
        !isEmpty(problems),
        `ChatUiCatalog component '${name}' has a props schema the catalog cannot ` +
            `check: ${problems.join('; ')}. The catalog checks a subset of JSON Schema, ` +
            'and a keyword it skips would let invalid props through. Rewrite the schema ' +
            'with the supported keywords, and move other rules to `validate`.'
    );
    throwIf(
        slots != null && (!isArray(slots) || !slots.every(isString)),
        `ChatUiCatalog component '${name}' must list its slots as names.`
    );
    getDataProps({...component, dataProps}).forEach(it => {
        const type = castArray(props.properties?.[it.name]?.type ?? []);
        throwIf(
            type.length !== 1 || type[0] !== 'string',
            `ChatUiCatalog component '${name}' declares data prop '${it.name}', which its ` +
                'props schema must type as a string - the id of an artifact.'
        );
    });
}

function toDisplayTool(tool: ChatToolSpec): ChatToolSpec {
    return {...omit(tool, 'execute'), sendToModel: false};
}

function invalidInputError(subject: string, errors: string[]): Error {
    const problems = errors.map(it => `- ${it}`).join('\n');
    return new Error(`Invalid ${subject} - nothing was shown. Fix and retry:\n${problems}`);
}

function pluralizeElements(doc: ChatUiDocument): string {
    const count = Object.keys(doc.elements).length;
    return count === 1 ? 'a UI of 1 component' : `a UI of ${count} components`;
}

/**
 * A document with the `catalogVersion` of the message that holds it, if it has none of its own.
 * Read untracked: a reply records the version as its turn ends, and a live reply was written
 * against the current catalog, so a renderer need not re-render when the record lands.
 */
function withMessageVersion(doc: ChatUiDocument, context: ChatPartRenderContext): ChatUiDocument {
    if (!isPlainObject(doc) || doc.catalogVersion != null) return doc;
    const catalogVersion = untracked(
        () => context.chatModel?.getMessage(context.messageId)?.metadata?.catalogVersion
    );
    return catalogVersion != null ? {...doc, catalogVersion} : doc;
}

function isMessageStreaming(context: ChatPartRenderContext): boolean {
    return !!context.chatModel?.getMessage(context.messageId)?.isStreaming;
}

/** The confirmation a `callTool` action needs - the tool's approval, or the action's own. */
function getToolConfirm(tool: ChatToolSpec, input: PlainObject, action: ChatUiAction): MessageSpec {
    const {needsApproval, approvalPrompt, displayName, name} = tool,
        needs = isFunction(needsApproval) ? needsApproval(input) : !!needsApproval;
    if (!needs) return action.confirm ?? null;

    const message = isFunction(approvalPrompt) ? approvalPrompt(input) : approvalPrompt;
    return {
        title: action.confirm?.title ?? displayName ?? genDisplayName(name),
        message: message ?? action.confirm?.message ?? 'Allow this tool to run?'
    };
}
