import type {PlainObject} from '@xh/hoist/core';
import type {ReactNode} from 'react';
import type {ChatDataPart, ChatPartRenderContext, ChatToolCallPart} from '../core';

/**
 * Declares a component that the model can show in the chat, as part of a {@link ChatUiCatalog}.
 * The catalog turns each spec into a tool: the model calls the tool with the component's props,
 * the catalog checks them against `props`, and the chat renders the component with `render`.
 *
 * ```ts
 * const kpis: ChatUiComponentSpec<{metrics: ChatUiMetric[]}> = {
 *     name: 'kpis',
 *     description: 'A row of KPI tiles, for a few headline numbers.',
 *     props: {
 *         type: 'object',
 *         required: ['metrics'],
 *         properties: {
 *             metrics: {
 *                 type: 'array',
 *                 maxItems: 6,
 *                 items: {
 *                     type: 'object',
 *                     required: ['label', 'value'],
 *                     properties: {label: {type: 'string'}, value: {type: 'number'}}
 *                 }
 *             }
 *         }
 *     },
 *     render: ({metrics}, {isPartial}) => chatUiMetrics({metrics, isPartial}),
 *     example: {metrics: [{label: 'Revenue', value: 1250000}]}
 * };
 * ```
 */
export interface ChatUiComponentSpec<P = PlainObject> {
    /**
     * Name of the component, unique within its catalog. The model shows it by calling the tool
     * `show_<name>`, unless `toolName` is set.
     */
    name: string;

    /** Name of the component's tool, in place of `show_<name>`. */
    toolName?: string;

    /** What the component shows and when to use it - sent to the model. */
    description: string;

    /**
     * JSON Schema for the props - sent to the model as the tool's input schema, and checked before
     * the component renders. Keep it tight: enums, required fields, and bounded arrays and strings.
     * The catalog checks a subset of JSON Schema, and refuses a schema that relies on other
     * keywords - see {@link ChatUiCatalog.validate}.
     */
    props: PlainObject;

    /** Checks the schema cannot express. Return a message for each problem, or an empty list. */
    validate?: (props: P) => string[];

    /**
     * Render the component. While the model is still writing the props, `context.isPartial` is
     * true and any prop may be missing or incomplete - render what is there, or a placeholder.
     * Once the props are complete, they have passed `props` and `validate`.
     *
     * The catalog renders the result as a component of its own, so `render` may call React hooks,
     * such as `useLocalModel()` for a `GridModel` or `ChartModel` that the component owns.
     */
    render: (props: P, context: ChatUiRenderContext) => ReactNode;

    /**
     * The result sent to the model once the component shows, so that it knows what the user sees
     * - for example `Showed 12 positions, largest first.`. Default a line that names the
     * component.
     */
    result?: (props: P) => string;

    /** Example props, shown to the model in the catalog's instructions. Keep it small. */
    example?: P;
}

/**
 * Passed to {@link ChatUiComponentSpec.render}: the render context of the part that holds the
 * component - `chatModel` and `messageId` - plus the part itself and the state of its props.
 */
export interface ChatUiRenderContext extends ChatPartRenderContext {
    /**
     * The part that holds the component: the tool call that showed it, or - for a component
     * translated by a {@link ChatUiAdapter} - the data part that carried the protocol payload.
     */
    part: ChatToolCallPart | ChatDataPart;

    /** True while the props are still streaming. */
    isPartial: boolean;

    /**
     * The rendered child components of a {@link ChatUiNode}, for a container component translated
     * by an adapter. Empty for a component shown by a tool call.
     */
    children: ReactNode[];
}

/**
 * One component to render, with its props and any child components - the output of a
 * {@link ChatUiAdapter}. Render a node, and its children, with {@link ChatUiCatalog.renderNode}.
 */
export interface ChatUiNode {
    /** Name of a component in the catalog. */
    component: string;

    /** Props for the component, checked against its schema before it renders. */
    props: PlainObject;

    /** Child components, rendered first and passed to the parent as `context.children`. */
    children?: ChatUiNode[];
}
