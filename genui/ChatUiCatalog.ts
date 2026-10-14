import {fragment} from '@xh/hoist/cmp/layout';
import {hoistCmp, type HoistProps, type PlainObject, uses} from '@xh/hoist/core';
import {genDisplayName} from '@xh/hoist/data';
import {logError, logWarn, throwIf} from '@xh/hoist/utils/js';
import {compact, isEmpty, keyBy, mapValues, uniq} from 'lodash';
import type {ReactNode} from 'react';
import type {ChatDataRenderer, ChatToolSpec} from '../core';
import type {ChatUiAdapter} from './ChatUiAdapter';
import type {ChatUiComponentSpec, ChatUiNode, ChatUiRenderContext} from './ChatUiComponentSpec';
import {validateSchema} from './impl/validateSchema';

/** Configuration for a {@link ChatUiCatalog}. */
export interface ChatUiCatalogConfig {
    /** Components the model can show. Names and tool names must be unique. */
    components: ChatUiComponentSpec<any>[];

    /**
     * Guidance for the model, added to the end of the generated `instructions` - for example which
     * component suits which question.
     */
    instructions?: string;
}

/**
 * A set of components that the model can show inline in the chat - generative UI built from the
 * app's own Hoist components. The app declares each component with a props schema and a render
 * function. The model picks a component and writes its props, and the chat renders it as the props
 * stream in.
 *
 * Each component becomes a client tool, named `show_<name>`. Pass the catalog's `tools` to the
 * {@link ChatModel}, and its `instructions` to the model with the system prompt:
 *
 * ```ts
 * const catalog = new ChatUiCatalog({components: [metricsSpec, positionsSpec]});
 *
 * const chatModel = new ChatModel({
 *     transport: new HoistChatTransport({
 *         url: 'chat',
 *         codec: new AnthropicCodec({system: `${appPrompt}\n\n${catalog.instructions}`})
 *     }),
 *     tools: [...appTools, ...catalog.tools]
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
     * One client tool per component, for {@link ChatModelConfig.tools}. Each tool checks the props
     * it is called with and confirms the render to the model, and displays its calls as the
     * rendered component.
     */
    readonly tools: ChatToolSpec[];

    /**
     * Text for the system prompt that explains the catalog to the model: when to show UI, the
     * rules to follow, and each component with its description and example. Ends with the
     * `instructions` given in the config, if any.
     */
    readonly instructions: string;

    constructor(config: ChatUiCatalogConfig) {
        const {components, instructions} = config;
        throwIf(isEmpty(components), 'ChatUiCatalog requires at least one component.');
        components.forEach(it =>
            throwIf(
                !it.name || !it.props || !it.render,
                `ChatUiCatalog component '${it.name}' requires a name, props and render.`
            )
        );
        throwIf(
            uniq(components.map(it => it.name)).length !== components.length ||
                uniq(components.map(getToolName)).length !== components.length,
            'ChatUiCatalog component names and tool names must be unique.'
        );

        this.components = components;
        this.tools = components.map(it => this.createTool(it));
        this.instructions = createInstructions(components, instructions);
    }

    /** The spec for a component, by name, or null. */
    getComponent(name: string): ChatUiComponentSpec {
        return this.components.find(it => it.name === name) ?? null;
    }

    /**
     * Check props for a component against its `props` schema, then its `validate` function. The
     * schema check covers a subset of JSON Schema: `type`, `required`, `properties`,
     * `additionalProperties`, `enum`, `const`, `items`, `minItems`, `maxItems`, `minLength`,
     * `maxLength`, `minimum`, `maximum`, `pattern`, `anyOf` and `oneOf`. Other keywords are ignored.
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

        const errors = validateSchema(props, component.props, opts);
        if (isEmpty(errors) && !opts.isPartial && component.validate) {
            errors.push(...component.validate(props));
        }
        return errors;
    }

    /**
     * Render a node translated by a {@link ChatUiAdapter}, with its children. A node that names no
     * catalog component, or has invalid props, renders nothing, with a warning in the console.
     *
     * @param node - the component to render.
     * @param context - passed to the component's `render`, with the rendered children added.
     */
    renderNode(node: ChatUiNode, context: Omit<ChatUiRenderContext, 'children'>): ReactNode {
        const {component: name, props = {}, children = []} = node,
            errors = this.validate(name, props, {isPartial: context.isPartial});

        if (!isEmpty(errors)) {
            logWarn([`Component '${name}' not rendered`, errors.join('; ')], 'ChatUiCatalog');
            return null;
        }

        return chatUiComponent({
            spec: this.getComponent(name),
            props,
            context: {...context, children: this.renderNodes(children, context)}
        });
    }

    /**
     * Data renderers that draw protocol payloads with catalog components, one per adapter, for
     * {@link ChatModelConfig.dataRenderers}. Each renderer translates a data part's payload with
     * its adapter, then renders the resulting nodes in order.
     */
    createDataRenderers(adapters: ChatUiAdapter[]): Record<string, ChatDataRenderer> {
        return mapValues(
            keyBy(adapters, 'dataType'),
            (adapter): ChatDataRenderer =>
                (part, context) => {
                    let nodes: ChatUiNode[];
                    try {
                        nodes = adapter.translate(part.data, this);
                    } catch (e) {
                        logError(
                            [`Could not translate '${adapter.dataType}' data`, e],
                            'ChatUiCatalog'
                        );
                        return null;
                    }
                    return this.renderNodes(nodes, {...context, part, isPartial: false});
                }
        );
    }

    //------------------
    // Implementation
    //------------------
    private renderNodes(
        nodes: ChatUiNode[],
        context: Omit<ChatUiRenderContext, 'children'>
    ): ReactNode[] {
        return nodes.map((node, idx) => fragment({key: idx, item: this.renderNode(node, context)}));
    }

    private createTool(component: ChatUiComponentSpec): ChatToolSpec {
        const {name, description, props} = component;
        return {
            name: getToolName(component),
            displayName: genDisplayName(name),
            description: `${description.trim()}\n\n${TOOL_NOTE}`,
            parameters: props,
            display: 'inline',
            execute: input => {
                const errors = this.validate(name, input);
                if (!isEmpty(errors)) {
                    const problems = errors.map(it => `- ${it}`).join('\n');
                    throw new Error(
                        `Invalid props - nothing was shown. Fix and retry:\n${problems}`
                    );
                }
                return `Rendered ${name} for the user.`;
            },
            renderer: (part, context) => {
                const input = part.input ?? {},
                    isPartial = part.state === 'input-streaming';

                // Render only props that are valid, or could still become valid as they stream.
                if (!isEmpty(this.validate(name, input, {isPartial}))) return null;
                return chatUiComponent({
                    spec: component,
                    props: input,
                    context: {...context, part, isPartial, children: []}
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
    props: PlainObject;
    context: ChatUiRenderContext;
}

// Renders a catalog component as a component of its own, so that hooks in its `render` belong to
// it, and props that fail validation unmount it rather than skip its hooks. Takes any model in
// context, as `useLocalModel()` needs a component with a model spec. Not memoized,
// as its host - the part's own component - renders only when the part changes.
const chatUiComponent = hoistCmp.factory<ChatUiComponentProps>({
    displayName: 'ChatUiComponent',
    model: uses('*', {optional: true}),
    memo: false,

    render({spec, props, context}) {
        return spec.render(props, context);
    }
});

const TOOL_NOTE = 'Calling this tool shows the component to the user, inline in the chat.';

function getToolName(component: ChatUiComponentSpec): string {
    return component.toolName ?? `show_${component.name}`;
}

function createInstructions(components: ChatUiComponentSpec[], appInstructions: string): string {
    const sections = [
        [
            '## Showing UI',
            '',
            'You can show UI components to the user, inline in the chat, by calling the tools ' +
                "below. Each call renders one component from the props you pass, which must match the tool's input schema.",
            '',
            'Rules:',
            '- Show one component per call. To show several, make several calls.',
            '- Write the props in the order the schema lists them - for example the columns ' +
                'before the rows - so that the component can render as you write.',
            '- Keep the data within the limits of the schema, such as the most rows or items. ' +
                'Pick the most relevant data, or summarize it, rather than exceed a limit.',
            '- Prefer a component for tabular and numeric results, such as a list of records, ' +
                'a set of figures, or a series over time.',
            '- Use text for explanation, context and conclusions. Do not repeat in text the data ' +
                'a component shows.',
            '- If a call fails, correct the props named in the error and call the tool again.',
            '',
            'Components:'
        ].join('\n'),
        ...components.map(it =>
            compact([
                `### ${getToolName(it)}`,
                it.description.trim(),
                it.example ? `Example props: ${JSON.stringify(it.example)}` : null
            ]).join('\n')
        ),
        appInstructions?.trim()
    ];
    return compact(sections).join('\n\n');
}
