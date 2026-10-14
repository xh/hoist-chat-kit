import type {PlainObject} from '@xh/hoist/core';
import type {ReactNode} from 'react';
import type {ChatDataPart, ChatPartRenderContext, ChatTextPart, ChatToolCallPart} from '../core';
import type {ChatDataHandle} from './ChatArtifactRegistry';
import type {ChatUiAction} from './ChatUiAction';
import type {ChatUiCatalog} from './ChatUiCatalog';
import type {ChatUiNode} from './ChatUiDocument';

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

    /**
     * The child lists the component takes, for a container in a nested answer: `default` for its
     * `children`, and other names for named slots, such as `header` or `actions`. The rendered
     * lists reach `render` as `context.children` and `context.slots`. Default none - a component
     * with no children.
     */
    slots?: string[];

    /**
     * Props that name data by reference - an artifact a tool produced - rather than hold it. Type
     * each as a string in `props`. The catalog resolves each one to a {@link ChatDataHandle} in
     * `context.data`, and loads its first page of rows. Give a name, or a spec with the page size
     * and row limit of the component.
     */
    dataProps?: (string | ChatUiDataPropSpec)[];
}

/** A reference prop of a component, with how much of its data the component shows. */
export interface ChatUiDataPropSpec {
    /** Name of the prop. */
    name: string;

    /**
     * Rows in the first page. If the artifact holds those rows inline, they are ready at once.
     * Otherwise the component renders first, in the `loading` state, and the first page loads once
     * it mounts. Default 100.
     */
    pageSize?: number;

    /** Most rows the component can show. A larger artifact is `tooLarge`. Default no limit. */
    maxRows?: number;
}

/**
 * Passed to {@link ChatUiComponentSpec.render}: the render context of the part that holds the
 * component - `chatModel` and `messageId` - plus the part itself, the element, its rendered
 * children, the data behind its reference props, and a way to run actions.
 */
export interface ChatUiRenderContext extends ChatUiDocumentContext {
    /** The catalog that renders the component - for example to check a URL. */
    catalog: ChatUiCatalog;

    /** The element the component renders for, with its id. */
    element: ChatUiNode;

    /** The rendered child elements, for a component whose `slots` include `default`. */
    children: ReactNode[];

    /** The rendered elements of each named slot, for a component that takes them. */
    slots: Record<string, ReactNode[]>;

    /** The data behind each reference prop that has a value, by prop name - see `dataProps`. */
    data: Record<string, ChatDataHandle>;

    /**
     * Run an action the model wrote, such as the click of a button - see
     * {@link ChatUiCatalog.runActionAsync}. Rejects an action that fails its checks.
     */
    runActionAsync(action: ChatUiAction): Promise<unknown>;
}

/** Passed to {@link ChatUiCatalog.renderDocument}: where the document shows, and its state. */
export interface ChatUiDocumentContext extends ChatPartRenderContext {
    /**
     * The part that holds the answer: the tool call that showed it, the data part that carried
     * it, or the text part that holds its tag.
     */
    part: ChatToolCallPart | ChatDataPart | ChatTextPart;

    /** True while the answer is still streaming, so that any element or prop may be incomplete. */
    isPartial: boolean;
}

/** Passed to {@link ChatUiCatalogConfig.fallback}: an element that cannot render. */
export interface ChatUiFallbackSpec {
    /** Name of the catalog component, if the element names one. Else null. */
    component: string;

    /** A line for the user, such as `This chart could not be displayed.`. */
    caption: string;

    /** What is wrong, in the kit's `path: message` form. */
    errors: string[];

    /** What the model wrote - the element, the document, or the tag. */
    input: unknown;
}

/** Passed to {@link ChatUiCatalogConfig.placeholder}: an element still streaming in. */
export interface ChatUiPlaceholderSpec {
    /** Name of the catalog component, once known. Else null. */
    component: string;

    /** The component's name for display, such as `Chart`, once known. Else null. */
    displayName: string;
}
