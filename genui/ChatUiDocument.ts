import type {PlainObject} from '@xh/hoist/core';

/**
 * A generative UI answer: a flat map of elements keyed by id, with the id of the top element. Every
 * delivery mode produces one - a tool call to a catalog component is a one-element document, a
 * nested answer from the `show_ui` tool is a tree of ids, and a {@link ChatUiAdapter} translates a
 * protocol's payload into one.
 *
 * Elements refer to their children by id, so a document streams in any order. While it streams, a
 * child that has not arrived renders as a placeholder.
 *
 * ```json
 * {
 *     "root": "summary",
 *     "elements": {
 *         "summary": {"component": "stack", "props": {}, "children": ["kpis", "trend"]},
 *         "kpis": {"component": "metrics", "props": {"items": [{"label": "Revenue", "value": 1.2e6}]}},
 *         "trend": {"component": "chart", "props": {"data": "q3_sales", "type": "line", "x": "day", "y": ["revenue"]}}
 *     }
 * }
 * ```
 *
 * Check a document with {@link ChatUiCatalog.validateDocument}, and render it with
 * {@link ChatUiCatalog.renderDocument}.
 */
export interface ChatUiDocument {
    /** Id of the top element. */
    root: string;

    /** The elements of the document, keyed by id. */
    elements: Record<string, ChatUiElement>;

    /**
     * The `version` of the catalog the document was written against. A catalog upgrades a document
     * from an older version with its `migrations`.
     */
    catalogVersion?: string;
}

/** One component of a {@link ChatUiDocument}, with its props and the ids of its children. */
export interface ChatUiElement {
    /** Name of a component in the catalog. */
    component: string;

    /** Props for the component, checked against its schema before it renders. */
    props: PlainObject;

    /**
     * Ids of the child elements, in display order - for a component whose `slots` include
     * `default`. Passed to the component as `context.children`, rendered.
     */
    children?: string[];

    /**
     * Ids of the elements in each named slot, such as `header` or `actions` - for a component that
     * lists the slot in its `slots`. Passed to the component as `context.slots`, rendered.
     */
    slots?: Record<string, string[]>;
}

/** A {@link ChatUiElement} with its id - the element a component renders for. */
export interface ChatUiNode extends ChatUiElement {
    /** Id of the element in its document. */
    id: string;
}

/** Caps that bound a generative UI answer - see {@link ChatUiCatalogConfig.limits}. */
export interface ChatUiLimits {
    /** Most elements in one document. Default 50. */
    maxElements?: number;

    /** Most levels of nesting in one document, counting the root as one. Default 8. */
    maxDepth?: number;

    /**
     * Most items in any array prop of one element, such as the rows of an inline grid, whatever
     * its schema allows. Default 200. Large data belongs in an artifact - see
     * {@link ChatUiComponentSpec.dataProps}.
     */
    maxInlineRows?: number;
}

/**
 * The `dataType` of a data part that holds a {@link ChatUiDocument}, as sent by a server in an
 * `xh.chat.data` event. {@link ChatUiCatalog.createDataRenderers} renders it.
 */
export const CHAT_UI_DOCUMENT_DATA_TYPE = 'xh.chat.ui';

/**
 * Wrap one component in a document of its own - the form of a tool call or a tag.
 *
 * @param component - name of a catalog component.
 * @param props - props for the component.
 * @param id - id of the element. Default `root`.
 */
export function toChatUiDocument(
    component: string,
    props: PlainObject,
    id: string = 'root'
): ChatUiDocument {
    return {root: id, elements: {[id]: {component, props: props ?? {}}}};
}
