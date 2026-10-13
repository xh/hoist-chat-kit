# Generative UI - Design Spec

Internal build spec for the generative UI registry, the deliverable that follows the chat UI (see
DECISIONS D15). The lead owns it.

## 1. Goal

A model in a Hoist chat can show real Hoist components inline in its reply: a grid of positions,
a chart of a time series, a row of metric tiles, a detail card. The app decides which components
exist and what props they take. The model picks a component and fills its props. The kit checks
the props, renders the component, and streams it in as the model writes.

This answers the reason a client gave for adopting OpenUI: Hoist had no generative UI story. Ours
is built on Hoist's own grids and charts, which suit data-dense enterprise apps better than a
generic component kit.

## 2. Approach: catalog components as tools

The kit already runs tool calls end to end: streamed input, partial JSON parse, input schemas sent
to the model, per-tool card renderers, and error results the model can recover from. Generative UI
reuses all of it. Each catalog component becomes one client tool:

- The tool's `parameters` is the component's props schema, so the model gets an exact JSON Schema
  per component. Per-component tools are more reliable than one `render_ui` tool with a union.
- The tool's `execute` validates the props and returns a short result ("Rendered grid with 12
  rows") or throws the validation errors, which go back to the model so it can correct itself.
- The tool's `renderer` draws the component from the call's input. While the input streams, the
  renderer gets the partial parse, so a grid can fill row by row and a chart can show a skeleton.
- The tool card chrome is replaced by the component itself (a flag on `ChatToolSpec`), with a small
  caption and a "view input" disclosure for debugging.

No new core concepts are needed, so every transport and codec works with generative UI unchanged.

## 3. API sketch

New package `genui/` (platform-neutral) and `desktop/cmp/genui/` (built-in Hoist renderers).

```ts
export interface ChatUiComponentSpec<P = PlainObject> {
    /** Name of the component - the tool is named `show_<name>` unless `toolName` is set. */
    name: string;
    toolName?: string;

    /** When to use it, for the model. */
    description: string;

    /** JSON Schema for the props. Keep it tight: enums, required fields, bounded arrays. */
    props: PlainObject;

    /** Extra checks the schema cannot express. Return error messages, empty if valid. */
    validate?: (props: P) => string[];

    /** Render the component. `isPartial` is true while the props still stream. */
    render: (props: P, context: ChatUiRenderContext) => ReactNode;

    /** Example props, included in the generated instructions. */
    example?: P;
}

export interface ChatUiRenderContext {
    chatModel: ChatModel;
    message: ChatMessage;
    part: ChatToolCallPart;
    isPartial: boolean;
}

export class ChatUiCatalog {
    constructor(config: {components: ChatUiComponentSpec[]; instructions?: string});
    readonly components: ChatUiComponentSpec[];

    /** One client tool per component, for ChatModelConfig.tools. */
    get tools(): ChatToolSpec[];

    /** System prompt text that explains the catalog: when to show UI, limits, examples. */
    get instructions(): string;

    /** Validate props for a component: JSON Schema subset plus `validate`. */
    validate(name: string, props: PlainObject): string[];
}
```

The JSON Schema checker is a small built-in subset (type, required, properties,
additionalProperties, enum, items, minItems, maxItems, minimum, maximum, pattern). The kit adds no
validator dependency.

## 4. Built-in components (desktop)

- `gridComponent({name?, maxRows?})` - a Hoist `Grid`. Props: `title`, `columns` (field, header,
  type: string, number, date, bool, with number format), `rows`, `sortBy`. A local `GridModel` per
  rendered call, destroyed with it. Data comes from the model's props, capped by `maxRows`.
- `chartComponent()` - a Hoist `Chart` (Highcharts). Props: `title`, `type` (line, column, bar,
  area, pie), `categories` or a datetime x-axis, `series` (name, data). The app's Highcharts must be
  installed, as for any Hoist chart.
- `metricsComponent()` - a row of KPI tiles. Props: `items` (label, value, format, delta, intent).
- `cardComponent()` - a titled detail card of label and value fields, with optional actions that
  send a follow-up message.

Apps register their own components the same way, for example a position grid bound to an app
store, where the model passes only a filter.

## 5. Constraints and safety

- The model can only name catalog components and only pass schema-valid props. Nothing it writes
  runs as code. No HTML, no URLs loaded unless a component allows them.
- Data volume is bounded by schema limits (`maxItems`) and by `maxRows`.
- For app data the model should not see, a component can take a reference (an id from an earlier
  tool result) and fetch the data itself in `render`.

## 6. Protocol adapters

A `ChatUiAdapter` translates a protocol's UI payload into catalog renders:

```ts
export interface ChatUiAdapter {
    /** The data part type this adapter handles, e.g. 'openui' or 'a2ui'. */
    dataType: string;
    /** Translate a payload into catalog component renders, in order. */
    translate(payload: any, catalog: ChatUiCatalog): ChatUiNode[];
}
export interface ChatUiNode {component: string; props: PlainObject; children?: ChatUiNode[]}
```

The catalog registers itself as the `dataRenderers` entry for each adapter's `dataType`. OpenUI
Lang (an OpenUI `Renderer` stream) and A2UI (`updateComponents` surfaces) can then render with
Hoist components, through a mapping of their component names to catalog names. v1 ships the
interface and docs. An OpenUI Lang adapter is the first planned implementation.

## 7. Demo

- Weather agent: "Chart the 5-day forecast for Tokyo inline" renders a Hoist chart in the chat.
  "Compare today's conditions in 4 cities" renders a grid or metric tiles.
- Chat Kit demo page: a scripted conversation that shows each built-in component, including a
  streaming grid.

## 8. Order of work

1. `genui/` catalog, schema subset checker, tool generation, instructions, tests.
2. `desktop/cmp/genui/` built-in components.
3. Weather agent integration and the demo page.
4. Docs: `genui/README.md`, a generative UI concept doc, registry entries.
5. Adapter interface. The OpenUI Lang adapter if budget remains.
