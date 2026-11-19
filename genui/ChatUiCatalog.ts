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
    compact,
    groupBy,
    isArray,
    isEmpty,
    isEqual,
    isFunction,
    isPlainObject,
    isString,
    keyBy,
    mapValues,
    omit,
    uniq,
    values,
    without
} from 'lodash';
import {type ReactNode, useEffect, useState} from 'react';
import {
    type Blueprint,
    type BlueprintDataProvider,
    BlueprintRegistry,
    DataCatalog,
    degradeAnswer,
    type PresentationSpec
} from '../blueprint';
import type {
    ChatDataRenderer,
    ChatMessage,
    ChatModel,
    ChatPartRenderContext,
    ChatToolSpec
} from '../core';
import {ChatArtifactRegistry, type ChatDataHandle} from './ChatArtifactRegistry';
import {
    CHAT_UI_ACTION_TYPES,
    CHAT_UI_MAX_CONTEXT_ENTRIES,
    type ChatUiAction,
    type ChatUiActionHandler,
    chatUiActionSchema,
    isChatUiMessagingAction
} from './ChatUiAction';
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
import {type ChatUiState, isChatUiBindings, isChatUiStateSpec} from './ChatUiState';
import type {ChatUiFormatContext, ChatUiTextFormat} from './ChatUiTextFormat';
import type {
    ChatUiComponentSegment,
    ChatUiParseTagsOptions,
    ChatUiParseTextOptions,
    ChatUiTextSegment
} from './ChatUiTextSegment';
import {
    createDocumentSchema,
    createDocumentToolDescription,
    createPrompt,
    formatTag,
    isStandalone
} from './impl/catalogPrompt';
import {chatUiFallback, chatUiPlaceholder} from './ChatUiFallback';
import {ChatUiRefusal} from './impl/ChatUiRefusal';
import {chatUiTagFormat} from './formats/ChatUiTagFormat';
import {
    answerBindingsOf,
    type ChatUiBoundProps,
    fromAnswerId,
    toAnswerBlueprint,
    toAnswerId
} from './impl/answerBlueprint';
import {answerDataFor} from './impl/answerData';
import {
    answerBlueprintSchema,
    answerToolDescription,
    checkAnswer,
    isDocumentShape
} from './impl/answerTool';
import {
    type ChatUiAnswerRenderProps,
    fromWidgetName,
    toActionSpecs,
    toStandInWidgetSpecs,
    toWidgetSpec
} from './impl/specWidgets';
import {chatUiElementBoundary} from './impl/ChatUiElementBoundary';
import {chatUiLiveDocument} from './impl/ChatUiLiveDocument';
import {
    elementPath,
    findDanglingRefs,
    findStructureProblems,
    repairDocument
} from './impl/documentStructure';
import {getOwn} from '../impl/LangUtils';
import {isAllowedUrl, parseWebUrl} from '../impl/UrlUtils';
import {hashJson} from './impl/hash';
import {
    findSchemaProblems,
    formatError,
    propPath,
    typeOf,
    validateSchema
} from '../impl/SchemaUtils';

/**
 * How the model delivers generative UI - see the genui README:
 *
 *  - `tools` - a tool call per component, `show_<name>`.
 *  - `document` - a call to the document tool, `show_ui`, with a nested {@link ChatUiDocument}.
 *  - the name of a configured {@link ChatUiTextFormat} - UI written into the answer's text, such
 *    as `tags` for the default tag format: a self-closing component tag in the markdown.
 */
export type ChatUiDeliveryMode = 'tools' | 'tags' | 'document' | (string & {});

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
     * `document`. A mode may also name one of the `textFormats`. Default `['tools']`.
     */
    modes?: ChatUiDeliveryMode[];

    /**
     * Grammars for UI in reply text, which `parseText()` runs in order. Name one in `modes` to
     * explain it to the model. Names must be unique. Default `[chatUiTagFormat()]`.
     */
    textFormats?: ChatUiTextFormat[];

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
     * URLs, such as `https://example.com` or `https://example.com/reports`, or a function of the
     * parsed URL. An entry matches by its parsed origin and path prefix, never by string prefix,
     * as a blueprint's allow list does. Only `http` and `https` URLs are ever allowed. Default
     * none.
     */
    urlAllowList?: string[] | ((url: URL) => boolean);

    /**
     * The app's data, for answers that read it: the datasets their sources may name, and the
     * provider that loads them. Each answer loads within its chat's bounds. Without it, an answer
     * holds only data it carries inline and the chat's artifacts.
     */
    answers?: ChatUiAnswersConfig;

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
 * const catalog = new ChatUiCatalog({components: [kpisSpec, positionsSpec]});
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
/** The app's data for answers - see {@link ChatUiCatalogConfig.answers}. */
export interface ChatUiAnswersConfig {
    /**
     * The app's own registry, whose widgets, variable types, resolvers, actions and renderers an
     * answer may use beside the catalog's components and chat actions.
     */
    registry?: BlueprintRegistry;
    /** The datasets an answer's sources may name. */
    dataCatalog?: DataCatalog;
    /** Loads those datasets. Each answer loads through it within its chat's bounds. */
    dataProvider?: BlueprintDataProvider;
}

/**
 * One answer of a reply, from {@link ChatUiCatalog.answersOf}: its blueprint, or for a program
 * with state, its text.
 * @internal
 */
export interface ChatUiAnswerOf {
    /** Where the answer came from: a `show_ui` call, a component call, or the reply's text. */
    kind: 'show_ui' | 'component' | 'text' | 'program';
    blueprint?: Blueprint;
    /** The text of a program with state. */
    source?: string;
}

export class ChatUiCatalog {
    //-----------------------
    // Immutable Properties
    //-----------------------
    /** Components the model can show. */
    readonly components: ChatUiComponentSpec[];

    /**
     * One client tool per `standalone` component, which a client-mode chat with the catalog sends
     * for the `tools` mode. Each tool checks the props it is called with and confirms the render
     * to the model, and displays its calls as the rendered component.
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

    /** Grammars for UI in reply text, in the order `parseText()` runs them. */
    readonly textFormats: ChatUiTextFormat[];

    /**
     * A stable hash of the catalog's content - the names, descriptions, schemas, examples and
     * limits of its components, its instructions, and its text formats unless they are the
     * default. A server that loads an export of the catalog compares it with the version the
     * browser sends, to detect drift.
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
            textFormats = [chatUiTagFormat()],
            instructions = null,
            tagPrefix = 'ui-',
            documentToolName = 'show_ui',
            limits,
            artifacts = null,
            actionHandlers = {},
            urlAllowList = null,
            answers = null,
            migrations = {},
            fallback = chatUiFallback,
            placeholder = chatUiPlaceholder
        } = config;

        throwIf(isEmpty(components), 'ChatUiCatalog requires at least one component.');
        components.forEach(it => checkComponent(it));
        throwIf(
            uniq(components.map(it => it.name)).length !== components.length ||
                uniq([...components.map(getToolName), documentToolName]).length !==
                    components.length + 1,
            'ChatUiCatalog component names and tool names must be unique.'
        );
        const formatNames = textFormats.map(it => it.name),
            acceptedModes = [...BUILT_IN_MODES, ...formatNames];
        throwIf(
            uniq(acceptedModes).length !== acceptedModes.length || formatNames.some(isEmpty),
            'ChatUiCatalog text format names must be unique, and not ' +
                `${BUILT_IN_MODES.join(' or ')}.`
        );
        throwIf(isEmpty(modes), modesError(acceptedModes));
        this.acceptedModes = acceptedModes;
        this.checkModes(modes);
        throwIf(
            !TAG_PREFIX_RE.test(tagPrefix),
            `ChatUiCatalog tagPrefix '${tagPrefix}' must start with a letter, and hold only ` +
                'letters, digits, _ and -.'
        );

        this.components = components;
        this.modes = uniq(modes);
        this.textFormats = textFormats;
        this.componentsByName = keyBy(components, 'name');
        this.configInstructions = instructions;
        this.tagPrefix = tagPrefix;
        this.documentToolName = documentToolName;
        this.limits = {...DEFAULT_LIMITS, ...limits};
        this.getArtifacts = artifacts;
        this.actionHandlers = actionHandlers;
        this.urlAllowList = isArray(urlAllowList) ? urlAllowList.map(checkUrl) : urlAllowList;
        this.answers = answers;
        this.migrations = migrations;
        this.fallbackRenderer = fallback;
        this.placeholderRenderer = placeholder;

        this.tools = components.filter(isStandalone).map(it => this.createComponentTool(it));
        this.documentTool = this.createDocumentTool();
        this.displayTools = [...this.tools, this.documentTool].map(toDisplayTool);
        this.instructions = this.toPrompt();

        // The default format adds nothing, so that such a catalog keeps the version it had before
        // text formats could be configured.
        const formats = textFormats.map(({name, version}) =>
            version != null ? {name, version} : name
        );
        this.version = hashJson({
            components: components.map(it => ({
                name: it.name,
                toolName: getToolName(it),
                description: it.description,
                props: it.props,
                example: it.example,
                slots: it.slots,
                dataProps: it.dataProps,
                stateProps: it.stateProps,
                standalone: it.standalone
            })),
            modes: this.modes,
            ...(isEqual(formats, DEFAULT_FORMAT_NAMES) ? {} : {formats}),
            instructions,
            tagPrefix,
            documentToolName,
            limits: this.limits
        });
    }

    /**
     * The catalog as a blueprint registry, for chat answers: the blueprint built-ins, plus each
     * component as a widget and each chat action type as an action. A component whose name a
     * built-in has, such as `chart`, is the widget `chatUiChart`.
     */
    get registry(): BlueprintRegistry {
        if (!this._registry) {
            const app = this.answers?.registry,
                ret = new BlueprintRegistry({
                    widgets: [
                        ...Object.values(app?.widgets ?? {}),
                        ...this.components.map(it => toWidgetSpec(it, this)),
                        ...toStandInWidgetSpecs(this)
                    ],
                    variableTypes: Object.values(app?.variableTypes ?? {}),
                    resolvers: Object.values(app?.resolvers ?? {}),
                    actions: [...Object.values(app?.actions ?? {}), ...toActionSpecs(this)],
                    renderers: Object.values(app?.renderers ?? {})
                });
            ChatUiCatalog.answerPresentations.forEach(({widget, presentation}) =>
                ret.addPresentation(widget, presentation)
            );
            this._registry = ret;
        }
        return this._registry;
    }

    /**
     * True to render documents as answer blueprints. Read once from `localStorage`, at the key
     * `xh.chat.answerBlueprints`, while the blueprint path is built beside the old one.
     * @internal
     */
    static answerBlueprints: boolean = readAnswerBlueprintsToggle();

    /** The platform's renderer for an answer blueprint, set when its package loads. @internal */
    static answerRenderer: (props: ChatUiAnswerRenderProps) => ReactNode = null;

    /**
     * The presentations a chat adds to blueprint widgets, such as the card a grid takes in a reply,
     * set when the platform's package loads. @internal
     */
    static answerPresentations: {widget: string; presentation: PresentationSpec}[] = [];

    /**
     * Render one component for an element of an answer blueprint, as {@link renderDocument}
     * renders an element of a document, inside an error boundary.
     * @internal
     */
    renderAnswerComponent(
        spec: ChatUiComponentSpec,
        node: ChatUiNode,
        context: ChatUiDocumentContext,
        rendered: {children: ReactNode[]; slots: Record<string, ReactNode[]>}
    ): ReactNode {
        return chatUiElementBoundary({
            key: `${node.id}|${spec.name}`,
            resetKey: context.isPartial,
            renderError: e =>
                this.renderFallback(
                    {
                        component: spec.name,
                        caption: this.getCaption(spec.name),
                        errors: [(e as Error)?.message ?? String(e)],
                        input: node
                    },
                    context,
                    node.id
                ),
            children: chatUiComponent({
                spec,
                node,
                context,
                catalog: this,
                registry: this.getRegistry(context.chatModel),
                childNodes: rendered.children,
                slots: rendered.slots
            })
        });
    }

    /**
     * Render the placeholder or the fallback that stands in for an element of an answer blueprint,
     * with the catalog's own renderers.
     * @internal
     */
    renderStandIn(
        standIn: {component: string; config?: PlainObject},
        context: ChatUiDocumentContext,
        id: string
    ): ReactNode {
        if (standIn.component === 'placeholder') {
            const name = this.toComponentName(standIn.config?.component);
            return this.renderPlaceholder(this.getComponent(name) ? name : null, id);
        }
        const docId = fromAnswerId(id),
            parsed = parseJson(standIn.config?.input),
            isElement = isPlainObject(parsed) && !('elements' in parsed),
            input = isElement
                ? fromAnswerElement(parsed, name => this.toComponentName(name))
                : parsed,
            name = isElement ? (this.getComponent(input.component)?.name ?? null) : null,
            // The catalog's own words for an element's problems, as a document's fallback has.
            ownErrors = isElement
                ? [
                      ...this.findElementProblems(docId, input as ChatUiElement, false),
                      ...(getOwn(context.elementErrors, docId) ?? [])
                  ]
                : parsed == null && id
                  ? [formatError(elementPath(docId), 'missing')]
                  : [];
        return this.renderFallback(
            {
                component: name,
                caption: name ? this.getCaption(name) : CAPTION,
                errors: ownErrors.length
                    ? ownErrors
                    : (standIn.config?.errors ?? []).map(toDocumentError),
                input
            },
            context,
            id
        );
    }

    /** The spec for a component, by name, or null. */
    getComponent(name: string): ChatUiComponentSpec {
        return getOwn(this.componentsByName, name);
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
                migrate = from && from !== this.version ? getOwn(this.migrations, from) : null;
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
     * as {@link ChatModel} records it on each reply that shows catalog UI. While it is partial, an
     * element that has not arrived renders as a placeholder. An element with an unknown component
     * or invalid props renders as a fallback - a caption, with the problems and the input behind
     * a disclosure - and logs a warning once.
     * So does a document whose structure is broken.
     *
     * A document with a `state` renders through its {@link ChatUiStateSpec}. The catalog creates
     * the state on the first render, keeps it while the document shows, and renders what the
     * spec's `resolve()` returns, again whenever an observable it reads changes.
     *
     * @param doc - the document to render.
     * @param context - the part that holds the document, and whether it is still streaming.
     */
    renderDocument(doc: ChatUiDocument, context: ChatUiDocumentContext): ReactNode {
        if (!isPlainObject(doc) || !isChatUiStateSpec(doc.state)) {
            return this.renderResolved(doc, context);
        }
        return chatUiLiveDocument({
            doc,
            context,
            renderDocument: (resolved, resolvedContext) =>
                this.renderResolved(resolved, resolvedContext),
            // State that fails while the reply streams may yet resolve.
            renderError: e => {
                if (context.isPartial) return this.renderPlaceholder(null);
                logError(['Could not resolve the state of a document', e], 'ChatUiCatalog');
                return this.renderFallback(
                    {
                        component: null,
                        caption: e instanceof ChatUiRefusal ? e.message : CAPTION,
                        errors: [(e as Error)?.message ?? String(e)],
                        input: omit(doc, 'state')
                    },
                    context
                );
            }
        });
    }

    /** Render a document with no state of its own, or one that its state resolved. */
    private renderResolved(doc: ChatUiDocument, context: ChatUiDocumentContext): ReactNode {
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
        if (ChatUiCatalog.answerBlueprints && ChatUiCatalog.answerRenderer) {
            return this.renderAnswer(repaired, context);
        }
        return this.renderElement(repaired, repaired.root, context);
    }

    /**
     * Split a text part into markdown and UI with the catalog's `textFormats`. The first format
     * parses the whole text, and each later one the markdown segments the earlier ones left. A
     * format that throws leaves its input as markdown, and logs a warning once per message.
     * Render each segment that is not markdown with {@link renderSegment}.
     *
     * @param text - the text, in markdown.
     * @param opts - set `isStreaming` while the text streams, to hold back UI still being
     *      written. Pass the ids of the message and part for formats that keep state per part.
     */
    parseText(text: string, opts: ChatUiParseTextOptions = {}): ChatUiTextSegment[] {
        const ctx: Omit<ChatUiFormatContext, 'index'> = {
            catalog: this,
            isStreaming: !!opts.isStreaming,
            messageId: opts.messageId ?? null,
            partId: opts.partId ?? null
        };
        return this.textFormats.reduce<ChatUiTextSegment[]>(
            (ret, format) => {
                let index = 0;
                return ret.flatMap(it =>
                    it.type === 'markdown'
                        ? this.runFormat(format, it.text, {...ctx, index: index++})
                        : it
                );
            },
            text ? [{type: 'markdown', text}] : []
        );
    }

    /**
     * Split a text part into markdown and component tags - `<ui-NAME prop="text" prop='JSON'/>` -
     * with the tag format, whatever the catalog's `textFormats`. Tags in fenced or inline code, or
     * escaped with a backslash, stay markdown. Each tag's attributes are read with the browser's
     * XML parser and checked as the component's props: text that starts with `[` or `{` parses as
     * JSON, as does a number or boolean for a prop that takes no text. Render each segment that is
     * not markdown with {@link renderSegment}.
     *
     * @param text - the text, in markdown.
     * @param opts - set `isStreaming` while the text streams, to hold back a tag still being
     *      written as a placeholder segment.
     */
    parseTags(text: string, opts: ChatUiParseTagsOptions = {}): ChatUiTextSegment[] {
        return this.runFormat(TAG_FORMAT, text, {
            catalog: this,
            isStreaming: !!opts.isStreaming,
            messageId: null,
            partId: null,
            index: 0
        });
    }

    /**
     * Render a segment from {@link parseText}: a component tag as its component, a document as its
     * elements, UI still streaming as a placeholder, and broken UI as a fallback. A markdown
     * segment renders nothing - render it as markdown.
     *
     * @param segment - the segment to render.
     * @param context - the text part that holds the UI, and its chat.
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
            case 'document':
                return this.renderDocument(segment.document, {
                    ...context,
                    isPartial: segment.isPartial,
                    elementErrors: segment.elementErrors ?? context.elementErrors
                });
            case 'placeholder':
                return this.renderPlaceholder(segment.component);
            case 'fallback': {
                // A tag stored before the catalog changed renders through its migrations.
                const doc = toChatUiDocument(segment.name, segment.props ?? {}),
                    docContext = {...context, isPartial: false};
                if (segment.props && this.needsMigration(doc, docContext)) {
                    return this.renderDocument(doc, docContext);
                }
                return this.renderFallback(
                    {
                        component: segment.component,
                        caption: segment.caption ?? this.getCaption(segment.component),
                        errors: segment.errors,
                        input: segment.source
                    },
                    context
                );
            }
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
     * Plain text for segments from {@link parseText}, to copy or to read aloud in place of the UI
     * source. Each component, and each element of a document, becomes a line: its spec's
     * `result()`, or `Showed <name>.`. A blank result adds no line. UI still streaming or broken
     * adds nothing. Each markdown piece, and the lines of each component or document, are trimmed
     * and joined with blank lines. Text with no UI comes back unchanged.
     */
    toCopyText(segments: ChatUiTextSegment[]): string {
        if (segments.every(it => it.type === 'markdown')) {
            return segments.map(it => it.text).join('');
        }

        const pieces = segments.map(it => {
            switch (it.type) {
                case 'markdown':
                    return it.text;
                case 'component':
                    return this.describeDocument(
                        toChatUiDocument(it.element.component, it.element.props)
                    );
                case 'document':
                    return this.describeDocument(it.document);
                default:
                    return null;
            }
        });
        return compact(pieces.map(it => it?.trim())).join('\n\n');
    }

    /**
     * Data renderers that draw generative UI from data parts, for
     * {@link ChatModelConfig.dataRenderers}: one for documents sent as-is, with the `dataType`
     * `xh.chat.ui`, and one per adapter, which translates a protocol's payload into a document.
     * Each renders its document as partial only while the document's `isPartial` is true.
     */
    createDataRenderers(adapters: ChatUiAdapter[] = []): Record<string, ChatDataRenderer> {
        return {
            [CHAT_UI_DOCUMENT_DATA_TYPE]: (part, context) =>
                this.renderDocument(part.data, {
                    ...context,
                    part,
                    isPartial: part.data?.isPartial === true
                }),
            ...mapValues(
                keyBy(adapters, 'dataType'),
                (adapter): ChatDataRenderer =>
                    (part, context) => {
                        const isPartial = isMessageStreaming(context);
                        let doc: ChatUiDocument;
                        try {
                            doc = adapter.translate(part.data, {catalog: this, isPartial});
                        } catch (e) {
                            // A payload that still streams may fail until it is complete.
                            if (isPartial) return this.renderPlaceholder(null);
                            logError(
                                [`Could not translate '${adapter.dataType}' data`, e],
                                'ChatUiCatalog'
                            );
                            return this.renderFallback(
                                {
                                    component: null,
                                    caption: e instanceof ChatUiRefusal ? e.message : CAPTION,
                                    errors: [(e as Error)?.message ?? String(e)],
                                    input: part.data
                                },
                                {...context, part}
                            );
                        }
                        return this.renderDocument(doc, {
                            ...context,
                            part,
                            isPartial: doc?.isPartial === true
                        });
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
     *    tool that needs approval asks the user first. Resolves to the tool's result. Refused
     *    while the chat is busy, and for a tool whose schema uses keywords the catalog cannot
     *    check. The call is not part of the history.
     *  - `app` - runs the handler in `actionHandlers` for its name. Resolves to its result.
     *  - `state` - runs against the state of the document that holds it, from the context. Refused
     *    for a document with no state, or a state that runs no actions.
     *
     * `send` and `callTool` need the context's `chatModel`, and are refused without one - where
     * the message list shows a host that is not a `ChatModel`.
     *
     * An action with `confirm` asks the user first, with `XH.confirm()`, and does nothing if they
     * cancel.
     *
     * @param action - the action to run.
     * @param context - the chat and message of the component that runs it, and the `state` of
     *      its document, if it has one.
     */
    async runActionAsync(
        action: ChatUiAction,
        context: ChatPartRenderContext & {state?: ChatUiState}
    ): Promise<unknown> {
        const errors = validateSchema(action, ACTION_SCHEMA);
        throwIf(!isEmpty(errors), `Invalid action: ${errors.join('; ')}`);

        const {chatModel} = context;
        throwIf(
            !chatModel && isChatUiMessagingAction(action),
            `No chat to send to - a '${action.type}' action needs a ChatModel.`
        );
        switch (action.type) {
            case 'send': {
                const {text, context: messageContext} = action;
                throwIf(
                    messageContext != null &&
                        Object.keys(messageContext).length > CHAT_UI_MAX_CONTEXT_ENTRIES,
                    `Invalid action: context has more than ${CHAT_UI_MAX_CONTEXT_ENTRIES} entries.`
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
                throwIf(chatModel.isBusy, 'Wait for the reply to finish.');
                // The check must cover the whole schema, or invalid input would reach the tool.
                const schemaProblems = tool.parameters ? findSchemaProblems(tool.parameters) : [];
                throwIf(
                    !isEmpty(schemaProblems),
                    `Tool '${action.name}' cannot run from an action: its schema uses keywords ` +
                        `the catalog cannot check - ${schemaProblems.join('; ')}.`
                );
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
                const handler = getOwn(this.actionHandlers, action.name);
                throwIf(!handler, `No handler for app action '${action.name}'.`);
                if (!(await this.confirmAsync(action.confirm))) return null;
                return handler(action.params ?? {}, context);
            }
            case 'state': {
                const {state} = context;
                throwIf(!!action.disabledReason, action.disabledReason);
                throwIf(
                    !state?.runActionAsync,
                    'No state to act on - a state action needs a document with state.'
                );
                if (!(await this.confirmAsync(action.confirm))) return null;
                return state.runActionAsync(action, context);
            }
        }
    }

    /**
     * True if `urlAllowList` allows a URL - for `openUrl` actions, and for components that show
     * links or load URLs the model wrote. Only absolute `http` and `https` URLs can pass.
     */
    isUrlAllowed(url: string): boolean {
        const parsed = parseWebUrl(url),
            {urlAllowList} = this;
        if (!parsed) return false;
        if (isFunction(urlAllowList)) return !!urlAllowList(parsed);
        return isAllowedUrl(url, urlAllowList);
    }

    //------------------------
    // Server export
    //------------------------
    /**
     * The catalog's tools as plain JSON - name, description and input schema - for a server that
     * runs the tool loop to register as display tools.
     *
     * @param opts - `modes` selects the tools: `tools` for one per `standalone` component,
     *      `document` for the document tool. Default the catalog's `modes`.
     * @throws for a mode that is not `tools`, `document` or the name of a text format.
     */
    toToolSchemas(opts: Pick<ChatUiPromptOptions, 'modes'> = {}): ChatUiToolSchema[] {
        const {modes = this.modes} = opts;
        this.checkModes(modes);
        return [
            ...(modes.includes('tools') ? this.tools : []),
            ...(modes.includes('document') ? [this.documentTool] : [])
        ].map(({name, description, parameters}) => ({name, description, parameters}));
    }

    /**
     * System prompt text that explains the catalog to the model: the rules, then how to deliver
     * UI in each mode given, then the config's `instructions`. A mode that names a text format
     * adds the format's own section - for `tags`, each `standalone` component with its description
     * and props, and the tag grammar the parser reads, so the prompt and the parser come from one
     * source.
     *
     * @param opts - the delivery `modes` to explain, default the catalog's `modes`, and app
     *      `rules` to add.
     * @throws for a mode that is not `tools`, `document` or the name of a text format.
     */
    toPrompt(opts: ChatUiPromptOptions = {}): string {
        const {modes = this.modes, rules = []} = opts;
        this.checkModes(modes);

        const formatSections = this.textFormats
            .filter(it => modes.includes(it.name))
            .map(it => it.toPrompt({catalog: this}, {modes, rules}));
        return createPrompt(this.promptSource, modes, rules, formatSections);
    }

    /**
     * The catalog as plain JSON, for a server that runs the tool loop: its `version`, its `tools`
     * from `toToolSchemas()`, its `prompt` from `toPrompt()`, and the export of each text format
     * that has one, by name, in `formats`.
     *
     * @param opts - the delivery `modes` for the tools and the prompt. Default the catalog's
     *      `modes`.
     * @throws for a mode that is not `tools`, `document` or the name of a text format.
     */
    toExport(opts: Pick<ChatUiPromptOptions, 'modes'> = {}): PlainObject {
        return {
            version: this.version,
            tools: this.toToolSchemas(opts),
            prompt: this.toPrompt(opts),
            formats: Object.fromEntries(
                this.textFormats
                    .filter(it => it.toExport)
                    .map(it => [it.name, it.toExport({catalog: this})])
            )
        };
    }

    //------------------
    // Implementation
    //------------------
    private readonly componentsByName: Record<string, ChatUiComponentSpec>;
    private readonly acceptedModes: ChatUiDeliveryMode[];
    private readonly configInstructions: string;
    private readonly getArtifacts: (chatModel: ChatModel) => ChatArtifactRegistry;
    private readonly actionHandlers: Record<string, ChatUiActionHandler>;
    private readonly urlAllowList: string[] | ((url: URL) => boolean);
    private readonly answers: ChatUiAnswersConfig;
    private readonly migrations: Record<string, (doc: ChatUiDocument) => ChatUiDocument>;
    private readonly fallbackRenderer: (spec: ChatUiFallbackSpec) => ReactNode;
    private readonly placeholderRenderer: (spec: ChatUiPlaceholderSpec) => ReactNode;

    // Fallbacks and format errors already logged, so that each logs once, however often it
    // renders. Bounded, as a catalog lives as long as the app.
    private readonly loggedFallbacks = new Set<string>();
    private _registry: BlueprintRegistry = null;

    // Component segments by format and source, most recent last - see `cacheSegment()`.
    private readonly segmentCache = new Map<string, ChatUiComponentSegment>();

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

    private checkModes(modes: ChatUiDeliveryMode[]) {
        const {acceptedModes} = this;
        throwIf(!modes.every(it => acceptedModes.includes(it)), modesError(acceptedModes));
    }

    private validateProps(
        component: ChatUiComponentSpec,
        props: PlainObject,
        isPartial: boolean,
        path: string,
        bound: string[] = []
    ): string[] {
        // The user writes the value of a bound prop, so the schema does not apply to it.
        const hasBound = !isEmpty(bound) && isPlainObject(props),
            schema = hasBound ? withoutProps(component.props, bound) : component.props,
            errors = validateSchema(hasBound ? omit(props, bound) : props, schema, {
                isPartial,
                path
            }),
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
        const bound = isChatUiBindings(element.bindings)
            ? Object.keys(element.bindings).filter(it => component.stateProps?.includes(it))
            : [];
        return [...ret, ...this.validateProps(component, props, isPartial, `${path}.props`, bound)];
    }

    private renderElement(
        doc: ChatUiDocument,
        id: string,
        context: ChatUiDocumentContext
    ): ReactNode {
        const {isPartial} = context,
            element = getOwn(doc.elements, id);

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

        // An element may say it is complete inside a partial document, never the reverse.
        const elementPartial = isPartial ? (element.isPartial ?? true) : false,
            component = this.getComponent(element.component),
            errors = [
                ...this.findElementProblems(id, element, elementPartial),
                ...(getOwn(context.elementErrors, id) ?? [])
            ];
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

        // An element that threw while partial gets another try once complete. Keyed by component
        // too, as a name that streams may grow into another, whose hooks would not match.
        return chatUiElementBoundary({
            key: `${id}|${component.name}`,
            resetKey: elementPartial,
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
            children: chatUiComponent({
                spec: component,
                node,
                context: {...context, isPartial: elementPartial},
                catalog: this,
                registry: this.getRegistry(context.chatModel),
                childNodes: renderIds(element.children),
                slots: mapValues(element.slots ?? {}, renderIds)
            })
        });
    }

    /** Render a document as an answer blueprint, through the platform's answer renderer. */
    /**
     * The answers in a reply, in order, as blueprints: each `show_ui` call, component call and UI
     * of its text. A program with state, such as OpenUI Lang's, gives its text, as its blueprint
     * exists only while it runs. An adapter's data part gives nothing, as the model may not have
     * seen its data. For the Architect's `read_answer`.
     * @internal
     */
    answersOf(message: ChatMessage): ChatUiAnswerOf[] {
        const toolComponents = new Map(this.components.map(it => [getToolName(it), it.name])),
            fromDoc = (doc: ChatUiDocument, kind: ChatUiAnswerOf['kind']): ChatUiAnswerOf => ({
                kind,
                blueprint: toAnswerBlueprint(this.repairDocument(doc), {
                    partialIds: [],
                    isValid: (name, props) => isEmpty(this.validate(name, props))
                })
            });
        return (message?.parts ?? []).flatMap((part): ChatUiAnswerOf[] => {
            if (part.type === 'toolCall') {
                const input = part.input ?? {};
                if (part.toolName === this.documentToolName) {
                    return [
                        isDocumentShape(input)
                            ? fromDoc(input as ChatUiDocument, 'show_ui')
                            : {kind: 'show_ui', blueprint: input as Blueprint}
                    ];
                }
                const component = toolComponents.get(part.toolName);
                return component ? [fromDoc(toChatUiDocument(component, input), 'component')] : [];
            }
            if (part.type !== 'text') return [];
            return this.parseText(part.text, {messageId: message.id, partId: part.id}).flatMap(
                (it): ChatUiAnswerOf[] => {
                    if (it.type === 'component') {
                        const {component, props} = it.element;
                        return [fromDoc(toChatUiDocument(component, props), 'text')];
                    }
                    if (it.type !== 'document') return [];
                    return isChatUiStateSpec(it.document?.state)
                        ? [{kind: 'program', source: it.source}]
                        : [fromDoc(it.document, 'text')];
                }
            );
        });
    }

    private renderAnswer(doc: ChatUiDocument, context: ChatUiDocumentContext): ReactNode {
        // An element may say it is complete inside a partial document, never the reverse.
        const idsWhere = (test: (el: ChatUiElement) => boolean) =>
                context.isPartial
                    ? Object.entries(doc.elements)
                          .filter(([, it]) => test(it))
                          .map(([id]) => toAnswerId(id))
                    : [],
            partialIds = idsWhere(it => it?.isPartial !== false),
            writingIds = idsWhere(it => it?.isPartial === true),
            translated = toAnswerBlueprint(doc, {
                partialIds,
                isValid: (name, props, isPartial) =>
                    isEmpty(this.validate(name, props, {isPartial}))
            });
        // The translation drops each streaming element's last item, as its spec does.
        return this.renderAnswerBlueprint(translated, context, {
            partialIds,
            writingIds,
            bindings: answerBindingsOf(doc),
            trimInlineRows: false
        });
    }

    /** Render an answer blueprint, degraded to what it can show, with the app's and chat's data. */
    private renderAnswerBlueprint(
        input: Blueprint,
        context: ChatUiDocumentContext,
        opts: {
            partialIds: string[];
            writingIds: string[];
            bindings?: Record<string, ChatUiBoundProps>;
            trimInlineRows: boolean;
        }
    ): ReactNode {
        const {partialIds, writingIds, bindings = {}, trimInlineRows} = opts,
            registry = this.getRegistry(context.chatModel),
            {dataCatalog, artifacts} = answerDataFor(input, {
                dataCatalog: this.answerDataCatalog,
                registry
            }),
            blueprint = degradeAnswer(input, {
                catalog: dataCatalog,
                registry: this.registry,
                artifacts,
                isAnswer: true,
                isComplete: !context.isPartial,
                partialIds,
                elementErrors: context.elementErrors,
                trimInlineRows
            });
        return ChatUiCatalog.answerRenderer({
            blueprint,
            catalog: this,
            dataCatalog,
            artifacts,
            artifactRegistry: registry,
            dataProvider: this.answers?.dataProvider ?? null,
            context,
            partialIds,
            writingIds,
            bindings
        });
    }

    /** Whether a complete answer from the model shows, and its issues, with its chat's data. */
    private checkAnswerInput(input: unknown, chatModel: ChatModel) {
        const {dataCatalog, artifacts} = answerDataFor(input as Blueprint, {
            dataCatalog: this.answerDataCatalog,
            registry: this.getRegistry(chatModel)
        });
        return checkAnswer(input, {catalog: dataCatalog, registry: this.registry, artifacts});
    }

    private get answerDataCatalog(): DataCatalog {
        return this.answers?.dataCatalog ?? ANSWER_DATA_CATALOG;
    }

    /** The catalog name of a component, from its widget name in an answer. */
    private toComponentName(widgetName: unknown): string {
        return isString(widgetName) ? fromWidgetName(widgetName) : null;
    }

    private renderPlaceholder(name: string, key?: string): ReactNode {
        return fragment({
            key,
            children: this.placeholderRenderer({
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
        this.warnOnce([context.messageId, context.part?.id, key, ...spec.errors].join('|'), [
            spec.caption,
            spec.errors.join('; ')
        ]);
        return fragment({key, children: this.fallbackRenderer(spec)});
    }

    private warnOnce(logKey: string, message: unknown[]) {
        const {loggedFallbacks} = this;
        if (loggedFallbacks.has(logKey)) return;
        if (loggedFallbacks.size >= MAX_LOGGED_FALLBACKS) loggedFallbacks.clear();
        loggedFallbacks.add(logKey);
        logWarn(message, 'ChatUiCatalog');
    }

    /**
     * Parse text with one format. A format that throws leaves the text as markdown, so that a
     * parser that fails on a half-written chunk cannot break the message as it streams.
     */
    private runFormat(
        format: ChatUiTextFormat,
        text: string,
        ctx: ChatUiFormatContext
    ): ChatUiTextSegment[] {
        let segments: ChatUiTextSegment[];
        try {
            segments = format.parse(text, ctx);
        } catch (e) {
            this.warnOnce(`format|${format.name}|${ctx.messageId}`, [
                `Text format '${format.name}' could not parse a reply`,
                e
            ]);
            return text ? [{type: 'markdown', text}] : [];
        }
        return segments.map(it =>
            it.type === 'component' ? this.cacheSegment(format.name, it) : it
        );
    }

    // A component's source parses the same way each time, so a component keeps the same props
    // object as the text after it streams in, and need not reload its data on each change. Keyed
    // by format too, as two formats may read the same source differently.
    private cacheSegment(
        formatName: string,
        segment: ChatUiComponentSegment
    ): ChatUiComponentSegment {
        if (!segment.source) return segment;

        const {segmentCache} = this,
            key = `${formatName}|${segment.source}`,
            cached = segmentCache.get(key);
        if (cached) return cached;
        if (segmentCache.size >= MAX_CACHED_SEGMENTS) {
            segmentCache.delete(segmentCache.keys().next().value);
        }
        segmentCache.set(key, segment);
        return segment;
    }

    /**
     * A line per element of a document, root first and then depth first through each named slot
     * and its children, for `toCopyText()`: the spec's `result()` for valid props, else
     * `Showed <name>.`. Elements of unknown components, and results that are blank, add nothing.
     */
    private describeDocument(doc: ChatUiDocument): string {
        const repaired = this.repairDocument(doc),
            elements = repaired?.elements ?? {},
            visited = new Set<string>(),
            ret: string[] = [];

        const visit = (id: string) => {
            const element = getOwn(elements, id);
            if (!isPlainObject(element) || visited.has(id)) return;
            visited.add(id);

            const component = this.getComponent(element.component),
                props = element.props ?? {};
            if (component) {
                const {name, result} = component,
                    isValid = result && isEmpty(this.validate(name, props)),
                    line = isValid ? result(props) : `Showed ${name}.`;
                if (line?.trim()) ret.push(line);
            }
            // Named slots first, as a header draws above the children.
            [...values(element.slots ?? {}), element.children].forEach(ids =>
                castArray(ids ?? []).forEach(visit)
            );
        };
        visit(repaired?.root);
        return ret.join('\n');
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

                // Render only props that are valid, or could still become valid as they stream. A
                // failed call's status shows why its props did not render. A call with a result -
                // a display tool's acknowledgment, or a call stored before the catalog changed -
                // renders a fallback.
                if (!isEmpty(this.validate(name, input, {isPartial}))) {
                    return part.state === 'output-available'
                        ? this.renderDocument(doc, renderContext)
                        : null;
                }
                return this.renderDocument(doc, renderContext);
            }
        };
    }

    private createDocumentTool(): ChatToolSpec {
        return ChatUiCatalog.answerBlueprints && ChatUiCatalog.answerRenderer
            ? this.createAnswerTool()
            : this.createDocumentToolForDocuments();
    }

    private createDocumentToolForDocuments(): ChatToolSpec {
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

                // As for a component tool, a complete document that fails renders nothing, unless
                // its call has a result.
                if (
                    !isPartial &&
                    part.state !== 'output-available' &&
                    !this.needsMigration(doc, renderContext) &&
                    !isEmpty(this.validateDocument(this.repairDocument(doc)))
                ) {
                    return null;
                }
                return this.renderDocument(doc, renderContext);
            }
        };
    }

    /**
     * The document tool for answer blueprints. Input written as a catalog document, as a stored
     * reply holds it, takes the document's path. An answer with errors shows nothing, and the
     * model gets its issues back - see `checkAnswer()`.
     */
    private createAnswerTool(): ChatToolSpec {
        const documentTool = this.createDocumentToolForDocuments();
        return {
            name: this.documentToolName,
            displayName: 'UI',
            description: `${answerToolDescription(this.registry)}\n\n${TOOL_NOTE}`,
            parameters: answerBlueprintSchema(this.registry),
            display: 'inline',
            execute: (input, ctx) => {
                if (isDocumentShape(input)) return documentTool.execute(input, ctx);
                const {isShown, issues} = this.checkAnswerInput(input, ctx.chatModel);
                if (!isShown) {
                    throw invalidInputError(
                        'answer',
                        issues
                            .filter(it => it.severity === 'error')
                            .map(it => (it.path ? `${it.path}: ${it.message}` : it.message))
                    );
                }
                const count = Object.keys((input as Blueprint).elements).length;
                return `Rendered an answer of ${count} element${count === 1 ? '' : 's'} for the user.`;
            },
            renderer: (part, context) => {
                if (isDocumentShape(part.input)) return documentTool.renderer(part, context);
                const isPartial = part.state === 'input-streaming',
                    input = part.input as Blueprint,
                    renderContext = {...context, part, isPartial};
                // A complete answer that fails renders nothing, unless its call has a result.
                if (
                    !isPartial &&
                    part.state !== 'output-available' &&
                    !this.checkAnswerInput(input, context.chatModel).isShown
                ) {
                    return null;
                }
                const ids = isPlainObject(input?.elements) ? Object.keys(input.elements) : [];
                return this.renderAnswerBlueprint(input, renderContext, {
                    partialIds: isPartial ? ids : [],
                    writingIds: [],
                    trimInlineRows: true
                });
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
    // Not `children`, which Hoist hands to React as child elements, not as an array.
    childNodes: ReactNode[];
    slots: Record<string, ReactNode[]>;
}

// Renders a catalog component as a component of its own, so that hooks in its `render` belong to
// it, and props that fail validation unmount it rather than skip its hooks. Takes any model in
// context, as `useLocalModel()` needs a component with a model spec. Observes the artifact
// registry, so that a component re-renders as its data arrives. Memoized, as every observer is -
// its host, the part's own component, renders only when the part changes in any case.
const chatUiComponent = hoistCmp.factory<ChatUiComponentProps>({
    displayName: 'ChatUiComponent',
    model: uses('*', {optional: true}),

    render({spec, node, context, catalog, registry, childNodes, slots}) {
        // What the user set for state props that the document does not bind. A binding takes
        // the prop over, as the document then holds its value.
        const [localProps, setLocalProps] = useState<PlainObject>(null),
            bindings = isChatUiBindings(node.bindings) ? node.bindings : {},
            props = localProps
                ? {...node.props, ...omit(localProps, Object.keys(bindings))}
                : node.props,
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
            children: childNodes,
            slots,
            data: handles,
            artifacts: registry,
            runActionAsync: action => catalog.runActionAsync(action, context),
            setProp: (name, value) => {
                throwIf(
                    !spec.stateProps?.includes(name),
                    `'${name}' is not a state prop of component '${spec.name}'.`
                );
                const binding = getOwn(bindings, name);
                if (binding) {
                    binding.set(value);
                } else {
                    setLocalProps(current => ({...current, [name]: value}));
                }
            }
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
    DEFAULT_FORMAT_NAMES = ['tags'],
    BUILT_IN_MODES: ChatUiDeliveryMode[] = ['tools', 'document'],
    TAG_FORMAT = chatUiTagFormat(),
    DEFAULT_PAGE_SIZE = 100,
    MAX_MIGRATIONS = 20,
    MAX_CACHED_SEGMENTS = 200,
    MAX_LOGGED_FALLBACKS = 1000,
    TAG_PREFIX_RE = /^[A-Za-z][A-Za-z0-9_-]*$/,
    CAPTION = 'This content could not be displayed.',
    TOOL_NOTE = 'Calling this tool shows the component to the user, inline in the chat.',
    ACTION_SCHEMA = chatUiActionSchema({types: CHAT_UI_ACTION_TYPES});

function parseJson(text: string): PlainObject {
    try {
        return JSON.parse(text ?? 'null');
    } catch {
        return null;
    }
}

// An answer element as the document element it came from, as a fallback shows its input.
function fromAnswerElement(el: PlainObject, toName: (widget: string) => string): PlainObject {
    if (!isPlainObject(el)) return null;
    const refs: PlainObject[] = isArray(el.children) ? el.children : [],
        children = refs.filter(it => !it?.slot).map(it => it?.id),
        slots = mapValues(
            groupBy(
                refs.filter(it => it?.slot),
                it => it.slot
            ),
            it => it.map(ref => ref.id)
        );
    return {
        component: toName(el.component),
        props: el.config ?? {},
        ...(children.length ? {children} : {}),
        ...(isEmpty(slots) ? {} : {slots})
    };
}

// A blueprint issue as the catalog writes a problem, such as `elements.b.props.text: ...`.
function toDocumentError(error: string): string {
    const match = /^\/elements\/([^/]+)\/config(\/[^:]*)?: (.*)$/s.exec(error);
    if (!match) return error;
    const [, id, path = '', message] = match;
    return `elements.${id}.props${path.replaceAll('/', '.')}: ${message}`;
}

// The datasets of an answer: none yet, until the app's catalog and its artifacts reach answers.
const ANSWER_DATA_CATALOG = new DataCatalog({datasets: {}});

function readAnswerBlueprintsToggle(): boolean {
    try {
        return globalThis.localStorage?.getItem('xh.chat.answerBlueprints') === 'true';
    } catch {
        return false;
    }
}

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
    const {name, props, render, slots, dataProps, stateProps} = component;
    throwIf(
        !name || !props || !render,
        `ChatUiCatalog component '${name}' requires a name, props and render.`
    );

    throwIf(
        props.type !== 'object',
        `ChatUiCatalog component '${name}' must have a props schema of type 'object'.`
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
    throwIf(
        stateProps != null &&
            (!isArray(stateProps) || !stateProps.every(it => Object.hasOwn(props.properties, it))),
        `ChatUiCatalog component '${name}' must list its stateProps as names of props that its ` +
            'schema declares.'
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

/** A props schema without some of its props, neither declared nor required. */
function withoutProps(schema: PlainObject, names: string[]): PlainObject {
    return {
        ...schema,
        properties: omit(schema.properties, names),
        ...(isArray(schema.required) ? {required: without(schema.required, ...names)} : {})
    };
}

/** The origin of an allow list entry, so that `https://example.com/` matches as written. */
function checkUrl(entry: string): string {
    try {
        new URL(entry);
        return entry;
    } catch (e) {
        throw new Error(`ChatUiCatalog urlAllowList entry '${entry}' is not a URL.`, {cause: e});
    }
}

function modesError(acceptedModes: ChatUiDeliveryMode[]): string {
    return `ChatUiCatalog modes must be one or more of ${acceptedModes.join(', ')}.`;
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

// Observes only which message streams, so that an observer re-renders as a turn starts or ends,
// not on each change to the reply.
function isMessageStreaming(context: ChatPartRenderContext): boolean {
    const {chatModel, messageId} = context;
    return chatModel != null && chatModel.streamingMessageId === messageId;
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
