# Generative UI - Design Spec, Revision 2

Internal build spec for plan 2, work package 7 (decision D22). It revises `planning/GENUI.md`,
which described the first version: catalog components as client tools, with data inline in the
props. That version shipped and stays. This revision adds what the enterprise apps need: data by
reference, server-run loops, tags in markdown, nested layouts, and typed actions. The lead owns it.

Sources: synthesis section 6.3, app 1 section 4 (its grids and charts over server result sets),
app 2 section 8, and the research report `research/generative-ui-frameworks.md` (json-render's
flat document, its twelve catalog recommendations, adapter feasibility). All in
`.tmp/hoist-chat-kit-feedback-1/`.

## 1. One document model

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

## 2. Four delivery modes

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

## 3. Data by reference

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

## 4. One view spec for tables and charts

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

## 5. Built-in components

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
- The existing inline-data grid, chart, metrics and card stay, for small results.

## 6. Typed actions

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

## 7. Server export and versioning

- `catalog.toToolSchemas()`, `catalog.toPrompt({rules, modes})`, and `catalog.version`, a content
  hash of the names, schemas and descriptions.
- A documented build step writes the export to a JSON file that the server loads. The browser
  sends only `catalog.version` (in `forwardedProps` or run options), so the server can detect
  drift. The server never accepts a prompt from the browser.
- A stored document keeps its `catalogVersion`. On load, an unknown component or failed check
  renders a fallback element (a caption plus "View input") and logs once. `migrations: {[version]:
  (doc) => doc}` on the catalog upgrade old documents.

## 8. Safety

The first version's rules stand: catalog names only, schema-checked props, no HTML, no script,
no expression evaluation. Add: the `urlAllowList` hook, caps on elements per document and rows per
inline prop, an error boundary per element with the fallback, and image props governed by the
image policy (D16).

## 9. Order of work

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
