# Generative UI - Design Spec

Internal build spec for generative UI. The lead owns it. It has two parts:

- [Part 1](#part-1-first-version) is the first version: catalog components as client tools, with
  data inline in the props (D15). It shipped. Sections that part 2 replaces say so.
- [Part 2](#part-2-revision-2) is revision 2, plan 2 work package 7 (D22). It adds what the
  enterprise apps need: data by reference, server-run loops, tags in markdown, nested layouts and
  typed actions.

Part 2 sources: synthesis section 6.3, app 1 section 4 (its grids and charts over server result
sets), app 2 section 8, and the research report `research/generative-ui-frameworks.md`
(json-render's flat document, its twelve catalog recommendations, adapter feasibility). All in
`.tmp/hoist-chat-kit-feedback-1/`.

## Part 1: First version

### 1.1. Goal

A model in a Hoist chat can show real Hoist components inline in its reply: a grid of positions,
a chart of a time series, a row of metric tiles, a detail card. The app decides which components
exist and what props they take. The model picks a component and fills its props. The kit checks
the props, renders the component, and streams it in as the model writes.

This answers the reason a client gave for adopting OpenUI: Hoist had no generative UI story. Ours
is built on Hoist's own grids and charts, which suit data-dense enterprise apps better than a
generic component kit.

### 1.2. Approach: catalog components as tools

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

### 1.3. API sketch

**Superseded in part** by [2.1](#21-one-document-model): `ChatUiNode` becomes `ChatUiElement`,
inside a `ChatUiDocument`.

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

### 1.4. Built-in components (desktop)

**Superseded in part** by [2.5](#25-built-in-components) and D69: the inline grid is now a preview
table, with the full Grid in the side panel.

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

### 1.5. Constraints and safety

**Superseded in part** by [2.3](#23-data-by-reference) for data by reference, and [2.8](#28-safety).

- The model can only name catalog components and only pass schema-valid props. Nothing it writes
  runs as code. No HTML, no URLs loaded unless a component allows them.
- Data volume is bounded by schema limits (`maxItems`) and by `maxRows`.
- For app data the model should not see, a component can take a reference (an id from an earlier
  tool result) and fetch the data itself in `render`.

### 1.6. Protocol adapters

**Superseded in part** by [2.1](#21-one-document-model): `translate()` returns a document. The
adapters move to v1.1 ([2.9](#29-order-of-work)).

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

### 1.7. Demo

**Done.**

- Weather agent: "Chart the 5-day forecast for Tokyo inline" renders a Hoist chart in the chat.
  "Compare today's conditions in 4 cities" renders a grid or metric tiles.
- Chat Kit demo page: a scripted conversation that shows each built-in component, including a
  streaming grid.

### 1.8. Order of work

**Done.**

1. `genui/` catalog, schema subset checker, tool generation, instructions, tests.
2. `desktop/cmp/genui/` built-in components.
3. Weather agent integration and the demo page.
4. Docs: `genui/README.md`, a generative UI concept doc, registry entries.
5. Adapter interface. The OpenUI Lang adapter if budget remains.

## Part 2: Revision 2

### 2.1. One document model

Every delivery mode produces the same flat, id-keyed document, after json-render and A2UI:

```ts
export interface ChatUiDocument {
    root: string;                          // id of the top element
    elements: Record<string, ChatUiElement>;
    catalogVersion?: string;               // the catalog it was written against
}

export interface ChatUiElement {
    component: string;                     // a catalog name
    props: PlainObject;
    children?: string[];                   // element ids
    slots?: Record<string, string[]>;      // named child lists, such as header or actions
}
```

A one-component tool call is a one-element document. A nested answer is a tree of ids. A
streaming document renders what resolves and shows a placeholder for a child id that has not
arrived. `ChatUiNode` gains an `id` and becomes the element type. `ChatUiAdapter.translate()`
returns a document.

`catalog.validateDocument(doc, {isPartial})` checks structure (missing root, dangling ids, cycles,
depth and element caps) and each element's props. `catalog.repairDocument(doc)` makes lossless
fixes only, such as dropping unknown top-level keys. Problems it cannot fix go back to the model in
the kit's `path: message` form.

### 2.2. Four delivery modes

| Mode | Wire | Who answers | Use |
|---|---|---|---|
| Client tools | `show_<name>` tool calls | The browser (`execute` validates) | A client-run loop. Built |
| Display tools | The same tools, registered by the server | The server returns an acknowledgment at once | A server-run loop. The kit renders from the call's input |
| Tags in markdown | `<ui-grid data="sales" title="..."/>` in the answer text | No one, the text is the answer | A server agent whose answer is markdown. Cheapest in tokens |
| UI document | A `show_ui` tool whose input is a `ChatUiDocument`, or an `xh.chat.ui` data part | Either | Nested answers, and the target of the OpenUI Lang and A2UI adapters |

- `ChatModelConfig.catalog?: ChatUiCatalog` wires a catalog into a chat. In client mode the
  catalog's tools join the model's tools. In server mode they become display-only specs (no
  `execute`, not sent to the model), because the server registers them itself.
- **Tags.** The text renderer splits a text part into markdown and tag segments
  (`catalog.parseTags(text)`). While streaming, it holds back a partial tag and shows a
  placeholder ("Building chart..."). A closed tag renders through the catalog. Attributes are
  untrusted: values that start with `[` or `{` parse as JSON, others stay strings, and all are
  checked against the props schema. The parser uses the browser's XML parser on an escaped copy,
  never a regex over raw HTML. The tag prefix defaults to `ui-` and is configurable.
- `catalog.toPrompt()` publishes the tag grammar together with the components, so the prompt and
  the parser come from one source.

### 2.3. Data by reference

The model names data that a tool produced. It does not write the rows.

- A component spec declares its reference props: `dataProps: ['data']`. The props schema types
  them as strings, which name an artifact.
- `ChatArtifactRegistry`, managed by each `ChatModel`, maps artifact ids to entries. It is fed by:
  - `xh.chat.artifact {id, columns, rows?, totalRows, metadata?}` events, and tool results that
    carry the same shape under `metadata.artifacts`;
  - restored history, which keeps artifacts in `message.metadata.artifacts`;
  - an app-supplied `ChatDataSource`, for rows not yet in the browser.
- `ChatDataSource.loadAsync({artifactId, offset, limit, signal}): Promise<ChatDataFrame>`. The
  registry de-duplicates loads by id and range and caches them for the life of the chat.
- `ChatDataFrame {columns: ChatDataColumn[]; rows: PlainObject[]; totalRows: number}` and
  `ChatDataColumn {name, type: 'string' | 'number' | 'integer' | 'date' | 'datetime' | 'boolean',
  label?, format?}`. A `fromColumnar()` helper converts column-oriented frames.
- The renderer resolves reference props before it renders, and hands the component a
  `ChatDataHandle` per prop: `{state: 'waiting' | 'loading' | 'ready' | 'missing' | 'tooLarge' |
  'failed', frame, totalRows, loadRangeAsync(offset, limit), error}`. `waiting` means the turn is
  still streaming and the artifact may yet arrive.
- Rows get a reserved synthetic id, so a result set with its own `id` column cannot break a Hoist
  store.
- Inline data stays allowed for small components (metric tiles, cards) under schema `maxItems`.

### 2.4. One view spec for tables and charts

```ts
export interface ChatDataView {
    columns?: (string | {name: string; label?: string; format?: string})[];
    sortBy?: string;                       // 'field' or 'field|desc'
    filter?: {field: string; op: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'notNull'; value?: any}[];
    top?: number;                          // the first N rows after sorting
    units?: 'none' | 'thousands' | 'millions' | 'billions';
}
export interface ChatChartView extends ChatDataView {
    type: 'line' | 'column' | 'bar' | 'area' | 'pie' | 'scatter';
    x: string;
    y: string[];
    groupBy?: string;
    stacking?: 'normal' | 'percent';
    colorBySign?: boolean;
}
```

`applyDataView(frame, view)` is a pure function, tested on its own. The filter grammar is a closed
set of operators, so the kit never evaluates an expression the model wrote. A chart can show a
different slice of the same artifact than a table does.

### 2.5. Built-in components

- **Result table** in two tiers.
  - The inline preview is a light, plain table of the first N rows and M columns, with a footer
    ("Showing 8 of 1,240 rows, 6 of 14 columns"), an Expand action and a download. It is not an
    ag-Grid instance, so a long thread stays cheap. Formatting goes through the same column
    formatters as the full grid.
  - Expand opens one full Hoist `Grid` in the workspace side panel, or a dialog without a workspace.
    It pages through the data source, with find, a column chooser and export with row caps. The
    chat stays mounted.
- **Chart over a reference**, on Hoist `ChartModel`, from a `ChatChartView`. An expanded view adds
  type and axis switchers and updates series in place, so the zoom survives.
- **Host formatting hooks** on the catalog: `columnFormatter?: (column: ChatDataColumn) =>
  Partial<ColumnSpec>`, so grids in the chat match the app's own grids.
- **Layout**: `stack` and `columns` in v1.0, `tabs` in v1.1. Each takes children and slots.
- The existing inline-data grid, chart, metrics and card stay, for small results. **Superseded**
  for the grid by D69: a result table always renders the preview inline.

### 2.6. Typed actions

```ts
export type ChatUiAction =
    | {type: 'send'; text: string; context?: PlainObject}
    | {type: 'openUrl'; url: string}
    | {type: 'navigate'; route: string; params?: PlainObject}
    | {type: 'callTool'; name: string; input?: PlainObject}
    | {type: 'app'; name: string; params?: PlainObject};
// each may add: label, confirm: {title, message}
```

Components run actions through `context.runAction(action)`. `send` goes through
`ChatModel.sendAsync` with structured `context` on the message, never hidden in its text.
`openUrl` and link props pass the catalog's `urlAllowList` hook. `app` actions go to
`catalog.actionHandlers`. All payloads are untrusted. The card's action buttons move onto this.

### 2.7. Server export and versioning

- `catalog.toToolSchemas()`, `catalog.toPrompt({rules, modes})`, and `catalog.version`, a content
  hash of the names, schemas and descriptions.
- A documented build step writes the export to a JSON file that the server loads. The browser
  sends only `catalog.version` (in `forwardedProps` or run options), so the server can detect
  drift. The server never accepts a prompt from the browser.
- A stored document keeps its `catalogVersion`. On load, an unknown component or failed check
  renders a fallback element (a caption plus "View input") and logs once. `migrations: {[version]:
  (doc) => doc}` on the catalog upgrade old documents.

### 2.8. Safety

The first version's rules stand: catalog names only, schema-checked props, no HTML, no script,
no expression evaluation. Add: the `urlAllowList` hook, caps on elements per document and rows per
inline prop, an error boundary per element with the fallback, and image props governed by the
image policy (D16).

### 2.9. Order of work

1. **Core (no design needed).** The document model, `validateDocument` and `repairDocument`, the
   tag parser, `ChatArtifactRegistry`, `ChatDataSource`, `applyDataView`, the catalog export and
   version, typed actions, and the `catalog` config on `ChatModel`. Specs for all of them.
2. **Desktop (after the design handoff).** The result table in two tiers, the chart over a
   reference, `stack` and `columns`, placeholders, and the fallback element.
3. **Demo.** A scripted analytics agent in the Toolbox Chat Kit app, on a fake `ChatDataSource`
   with a few thousand rows. It shows a preview table, an expanded grid, a chart over the same
   artifact, and tags in a markdown answer.
4. **Docs.** `genui/README.md`, a generative UI concept doc, and a server recipe for exporting the
   catalog and answering display tools.
5. **v1.1.** `tabs`, document streaming by patches, and the OpenUI Lang and A2UI adapters.
