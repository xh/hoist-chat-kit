# Generative UI

| Section | Description |
|---------|-------------|
| [Overview](#overview) | What the catalog does, and the key features |
| [Architecture](#architecture) | The catalog, the document model, the four delivery modes, and the cost of a render |
| [Configuration Pattern](#configuration-pattern) | Creating a catalog and wiring it to a `ChatModel` |
| [Common Usage Patterns](#common-usage-patterns) | Components, partial props, nested answers, tags, data by reference, views, actions, export, adapters |
| [Properties/API Reference](#propertiesapi-reference) | Catalog config, component spec, render context, document, limits, actions, and the schema subset |
| [Extension Points](#extension-points) | Your own components, fallbacks, action handlers and adapters |
| [Common Pitfalls](#common-pitfalls) | Mistakes that compile but misbehave |
| [Related Packages](#related-packages) | The built-in components, the core models, and the chat components |

## Overview

The `/genui/` package lets a model show real Hoist components inline in its reply, such as a
grid of positions or a chart of a time series. The app decides which components exist
and what props they take. The model picks a component and writes its props. The kit checks the
props, renders the component, and streams it in as the model writes.

Import from `@xh/hoist-chat-kit/genui`. The package is platform-neutral. The built-in desktop
components live in [`/desktop/cmp/genui/`](../desktop/cmp/genui/README.md).

Key features:

- **A catalog the app controls** - `ChatUiCatalog` holds the components the model may show. The
  model can name only a catalog component and pass only props that pass validation. Nothing it
  writes runs as code.
- **One document model** - every answer is a `ChatUiDocument`, a flat map of elements keyed by
  id. A tool call is a one-element document, and a nested answer is a tree of ids.
- **Four delivery modes** - component tools, display tools for a server-run loop, tags in a
  markdown answer, and a `show_ui` tool that takes a whole document.
- **Streaming** - a component renders while the model writes its props. A document renders what
  has arrived, with a placeholder for the rest.
- **Errors the model can fix** - invalid props fail the call with a list of problems, each with
  the path of the prop at fault. The model corrects the props and calls again.
- **Data by reference** - the model names a result set that a tool produced, and never writes
  its rows. The kit loads the rows through the app's `ChatDataSource`.
- **Typed actions** - buttons run checked actions, such as sending a message or opening an
  allowed URL, never code.
- **A server export** - the catalog exports its tool schemas, its prompt and a version hash, so
  a server agent can register it.
- **Fallbacks** - an element that fails its checks, or throws, renders as a caption with a "View
  input" disclosure. The rest of the answer still renders.
- **Protocol adapters** - a `ChatUiAdapter` translates the UI payload of a protocol, such as
  OpenUI or A2UI, into a document. The protocol's UI then draws with Hoist components.

## Architecture

```
ChatUiCatalog
├── components: ChatUiComponentSpec[]   # What the model may show
├── tools: ChatToolSpec[]               # One inline client tool per component
├── documentTool: ChatToolSpec          # The show_ui tool, for nested documents
├── displayTools: ChatToolSpec[]        # Display-only specs, for a server-run loop
├── instructions: string                # System prompt text for the tools mode
├── version: string                     # Content hash, to detect drift
└── Methods:
    ├── validate()                      # Check props against a spec
    ├── validateDocument()              # Check a document's structure and elements
    ├── repairDocument()                # Make lossless fixes to a document
    ├── renderDocument()                # Render a document, with placeholders and fallbacks
    ├── parseTags()                     # Split text into markdown and component tags
    ├── renderSegment()                 # Render a tag segment
    ├── runActionAsync()                # Check and run a typed action
    ├── isUrlAllowed()                  # Check a URL against urlAllowList
    ├── toToolSchemas()                 # Export the tools as JSON
    ├── toPrompt()                      # Export the prompt, per delivery mode
    └── createDataRenderers()           # Data renderers for documents and adapters
```

A `ChatUiComponentSpec` declares one component. It has a `name`, a `description` for the
model, and a JSON Schema for its `props`. It can add a `validate` function, for checks the
schema cannot express, an `example`, and a `result` that tells the model what it showed. A
container lists its `slots`, and a component that shows an artifact lists its `dataProps`. Its
`render` function returns the component.

### The document model

```json
{
    "root": "summary",
    "elements": {
        "summary": {"component": "stack", "props": {}, "children": ["kpis", "trend"]},
        "kpis": {"component": "kpis", "props": {"data": "q3_totals"}},
        "trend": {"component": "trendChart", "props": {"data": "q3_sales", "x": "day", "y": ["revenue"]}}
    }
}
```

`stack`, `kpis` and `trendChart` here are app components that take data by reference, not the
built-in ones. Elements refer to their children by id, so a document can stream in any order. Each element
has a `component`, its `props`, and the ids of its `children` or of the elements in each named
slot. An element has at most one parent.

`renderDocument()` takes each document through the same steps:

1. `migrateDocument()` upgrades a document from an older `catalogVersion`.
2. `repairDocument()` makes lossless fixes, such as dropping unknown keys.
3. The structure check refuses a document with a cycle, an element under two parents, or too many
   elements or levels. Such a document renders as one fallback.
4. Each element renders inside its own error boundary. An element that has not arrived renders as
   a placeholder while the document streams. An element with an unknown component or invalid
   props renders as a fallback, and logs a warning once.

### Four delivery modes

| Mode | Wire | Who answers | Use |
|------|------|-------------|-----|
| Component tools | `show_<name>` tool calls | The browser, whose `execute` checks the props | A client-run loop |
| Display tools | The same tools, registered by the server | The server, with an acknowledgment | A server-run loop. The kit renders from the call's input |
| Tags in markdown | `<ui-grid data="sales" title="Q3"/>` in the answer text | No one, as the text is the answer | A server agent whose answer is markdown. Cheapest in tokens |
| UI document | The `show_ui` tool, or an `xh.chat.ui` data part | Either | Nested answers, and the target of protocol adapters |

Per-component tools are more reliable than one tool that takes a union of every component. The
model sees one small schema per tool, and the provider can enforce it. Use `show_ui` only for
answers that nest.

### How a call becomes a component

1. The catalog turns each spec into a `ChatToolSpec`. The tool's `parameters` is the props
   schema, so the model gets an exact schema per component. Its `display` is `inline`.
2. The model calls the tool, `show_grid` for example, and streams the props as the tool input.
3. While the input streams, the tool's renderer checks the partial props with the checks that
   streaming props could still pass. If they could still become valid, it renders them as a
   one-element document, with `isPartial: true`.
4. Once the input is complete, the chat runs the tool. Its `execute` checks the props in full,
   then the spec's `validate`. Valid props return the spec's `result` to the model, or by
   default "Rendered grid for the user.". Invalid props throw an error that lists each problem.
5. The renderer draws the complete props with `isPartial: false`. Invalid props render nothing.

### Inline display

A tool with `display: 'inline'` shows its rendered output as part of the reply, with no card around
it. The output is the progress, so the quiet status line under it is mostly empty. It shows
"Rendering…" while the input streams, and a note while the call waits for approval or after it fails
or is denied. A failed call shows a short message for the user, such as "Could not show the chart.".
The error text, which is written for the model, shows behind the "View input" toggle, with the
input. The toggle appears when the user hovers over or focuses the component. A denied call renders
no component, nor does a call that waits for approval, unless its tool sets `preview: true`.

### Each render is a model call

A catalog tool is a client tool, so a step that shows a component ends at the call. The chat
then sends the result back to the model in a new step, for the model to go on writing. Each
component a reply shows costs:

- **Latency** - one more model call before the reply goes on.
- **A step** - one of the chat's `maxSteps`, which defaults to 10.
- **Tokens** - the props stay in the history. Every later step resends them, up to the limits
  of the schema - for example 100 rows of a grid.

Keep row and point limits as low as the use allows, and raise `maxSteps` for a chat that shows
several components per reply. Prompt caching in `AnthropicCodec` reads the resent history from
the cache, which cuts the cost of the tokens but not of the call. Tags and data by reference
avoid most of this cost: a tag costs no call, and a reference costs a few tokens.

### Safety model

- The model can show only components the app put in the catalog, with props that pass the
  schema and `validate`. A prop the schema does not declare fails with `additionalProperties:
  false`.
- Nothing the model writes runs as code or loads as HTML. Tag attributes are read by the
  browser's XML parser from an escaped copy, never by a regular expression over the raw markup.
- A view over data uses a closed set of filter operators. The kit never evaluates an expression
  the model wrote.
- Caps bound each answer: elements per document, levels of nesting, and items per inline array
  prop. Schema limits, such as `maxItems` and `maxLength`, bound each prop.
- Each action is checked before it runs. `openUrl` opens only `http` and `https` URLs that
  `urlAllowList` allows, and no URL by default. An action with `confirm` asks the user first.
- For data the model should not see, a component takes a reference in its props and loads the
  data itself.
- A `send` action shows exactly what it sends. The built-in card shows each action in its
  tooltip, and a sent message as the user's own, capped at 200 characters. Structured context is
  a flat object of at most 8 short values, such as record ids. It goes on the message's
  `metadata.context`, never inside its text, and shows under the sent message and in the tooltip.
- Tag names, action names and data types are looked up as own properties only, so a name such as
  `constructor` is unknown, never a member that every object inherits.
- Tags in fenced and inline code stay text. Tags in an indented code block render, so tell the
  model to fence code.

## Configuration Pattern

Create the catalog once, for example on the model that owns the chat. Pass it to the `ChatModel`
as `catalog`, and pass its `instructions` to the model with the system prompt:

```typescript
import {ChatModel} from '@xh/hoist-chat-kit/core';
import {chatUiChartSpec, chatUiGridSpec} from '@xh/hoist-chat-kit/desktop/cmp/genui';
import {ChatArtifactRegistry, ChatUiCatalog} from '@xh/hoist-chat-kit/genui';
import {AnthropicCodec, HoistChatTransport} from '@xh/hoist-chat-kit/transport';
import {HoistModel, managed} from '@xh/hoist/core';

export class AnalystModel extends HoistModel {
    readonly catalog = new ChatUiCatalog({
        components: [chatUiGridSpec({maxRows: 50}), chatUiChartSpec(), positionCardSpec],
        instructions: 'Use a grid for positions and trades, and a chart for performance.',
        urlAllowList: ['https://research.example.com']
    });

    @managed readonly chatModel = new ChatModel({
        transport: new HoistChatTransport({
            url: 'llm/stream',
            codec: new AnthropicCodec({
                system: `${APP_PROMPT}\n\n${this.catalog.instructions}`,
                cacheControl: true
            })
        }),
        tools: appTools,
        catalog: this.catalog,
        dataSource: resultSetSource,
        // Each component a reply shows takes a step.
        maxSteps: 16
    });
}
```

The chat adds the catalog's tools to its own, by its history mode:

| History mode | Tools the chat adds |
|--------------|---------------------|
| `client` | The component tools for the `tools` mode, and `show_ui` for the `document` mode. The browser runs them. |
| `server` | The `displayTools`. The server registers the tools and answers their calls. The chat renders each call, and never sends these tools to the model. |

A catalog tool must not share its name with an app tool. The `ChatModel` constructor throws if
one does. A catalog tool that the app also lists in `tools` is added once.

The catalog's `modes` set how the model delivers UI. They select the tools the chat sends, and
the default modes of `instructions`, `toPrompt()` and `toToolSchemas()`:

```typescript
const catalog = new ChatUiCatalog({
    components,
    modes: ['tools', 'tags', 'document']
});
// in the system prompt, with the modes above
catalog.toPrompt({rules: ['Show at most three components.']})
```

The chat also does the rest of the wiring:

- Each chat manages its own artifact registry, `chatModel.artifacts`, which the catalog reads by
  default. Give the chat a `dataSource` for rows not yet in the browser.
- The desktop message view renders component tags in the text of a reply, and data parts of type
  `xh.chat.ui` as documents.
- Each request carries `catalog.version`, as `ChatRunRequest.catalogVersion`.
- A reply that shows catalog UI records the catalog's version as `metadata.catalogVersion`. A
  stored reply renders through the catalog's `migrations` from that version.

## Common Usage Patterns

### Write a component spec

A spec pairs a tight schema with a `render` that returns a Hoist component. This one shows the
detail of one position, by symbol:

```typescript
import type {ChatUiComponentSpec} from '@xh/hoist-chat-kit/genui';
import {chatUiFrame} from '@xh/hoist-chat-kit/desktop/cmp/genui';

interface PositionCardProps {
    symbol: string;
    note?: string;
}

export const positionCardSpec: ChatUiComponentSpec<PositionCardProps> = {
    name: 'position',
    description: 'The detail of one position in the book, by symbol. Use it when the user asks about a single holding.',
    props: {
        type: 'object',
        required: ['symbol'],
        additionalProperties: false,
        properties: {
            symbol: {type: 'string', pattern: '^[A-Z.]{1,8}$', description: 'Ticker symbol.'},
            note: {type: 'string', maxLength: 200, description: 'One line of context.'}
        }
    },
    validate: ({symbol}) =>
        XH.portfolioService.hasPosition(symbol) ? [] : [`symbol: no position in ${symbol}`],
    render: ({symbol, note}, {isPartial}) =>
        isPartial ? null : chatUiFrame({title: symbol, item: positionDetail({symbol, note})}),
    example: {symbol: 'NVDA', note: 'Largest detractor today.'}
};
```

`render` runs as a component of its own, so it may call React hooks, such as `useLocalModel()`
for a `GridModel` the component owns. The catalog renders it with any model in context, as
`useLocalModel()` needs.

### Render props as they stream

While the props stream, `context.isPartial` is true and any prop may be missing or cut short.
The rules for a component that streams well:

- Render what is there, or a placeholder. `chatUiSkeleton(height)` draws a pulsing one.
- Leave out the last item of an array while partial, as it may still be missing values.
- Build an expensive model only once the props it depends on are complete. A grid's columns,
  for example, are complete once its rows begin. Load later props into the same model.

Schema order matters. The generated instructions ask the model to write props in the order the
schema lists them, so list the props a component needs first, first.

### Write a container

A container lists its child lists in `slots`: `default` for its `children`, and other names for
named slots. It renders the children it receives:

```typescript
const stackSpec: ChatUiComponentSpec<{gap?: number}> = {
    name: 'stack',
    description: 'A vertical stack of components, with an optional header.',
    props: {type: 'object', additionalProperties: false, properties: {gap: {type: 'integer', maximum: 32}}},
    slots: ['default', 'header'],
    render: ({gap = 8}, {children, slots}) => vbox({style: {gap}, items: [...(slots.header ?? []), ...children]})
};
```

The model nests components with the `show_ui` tool, or a server sends a document as an
`xh.chat.ui` data part. A chat with a catalog renders that part. Without one, register the data
renderer with `createDataRenderers()`.

### Read tags in a markdown answer

A server agent can place components in its answer text, where they belong. The desktop message
view renders the tags of each reply in a chat with a catalog. A custom text renderer splits a text
part with `parseTags()` and renders each segment:

```typescript
const segments = catalog.parseTags(part.text, {isStreaming: part.state === 'streaming'});

segments.map((segment, idx) =>
    segment.type === 'markdown'
        ? chatMarkdown({key: idx, content: segment.text})
        : fragment({key: idx, item: catalog.renderSegment(segment, {chatModel, messageId, part})})
);
```

The grammar is a self-closing tag: `<ui-NAME prop="text" prop='JSON'/>`. Text that starts with
`[` or `{` parses as JSON, and so does a number or boolean for a prop that takes no text. Every
value is checked against the props schema. While the text streams, a tag cut off at the end
becomes a placeholder segment, and renders as "Building chart…". An unknown tag name, invalid
props, or broken markup becomes a fallback segment. Tags in fenced or inline code, and tags
escaped with a backslash, stay markdown. Set `tagPrefix` to change the `ui-` prefix.

`toPrompt({modes: ['tags']})` explains the grammar to the model, and lists each component with its
props. The prompt and the parser come from one catalog, so they always agree.

### Show data by reference

A server tool stores its result and returns an artifact: an id, the columns, the total row count,
and perhaps the first rows. The model names the artifact in a reference prop. The kit resolves the
prop to a `ChatDataHandle`, loads its first page, and re-renders as the rows arrive.

```typescript
const resultGridSpec: ChatUiComponentSpec<{data: string} & ChatDataView> = {
    name: 'results',
    description: 'A table over a result a tool returned. Pass its id as data.',
    props: {
        type: 'object',
        required: ['data'],
        additionalProperties: false,
        properties: {data: {type: 'string', maxLength: 64}, ...CHAT_DATA_VIEW_PROPERTIES}
    },
    dataProps: [{name: 'data', pageSize: 200, maxRows: 100000}],
    render: ({data, ...view}, {data: handles}) => resultTable({handle: handles.data, view})
};
```

The built-in table and chart take data this way with `byReference: true`, and need no spec of
their own: `chatUiGridSpec({byReference: true})` and `chatUiChartSpec({byReference: true})`. See
[`/desktop/cmp/genui/`](../desktop/cmp/genui/README.md#show-a-table-by-reference).

Render by the handle's `state`:

- `waiting` - no artifact has that id yet, and the reply still streams.
- `loading` - the first page is loading.
- `ready` - the first page is in `frame`. Page through the rest with `loadRangeAsync()`.
- `missing`, `tooLarge` or `failed` - show a short note in place of the data.

Each `ChatModel` keeps the artifacts of its thread in `chatModel.artifacts`. The chat adds them
as they arrive:

- An `xh.chat.artifact` event, with the artifact as its value.
- A backend tool result with `metadata.artifacts`, a list of artifacts.
- A client tool that returns `chatToolResult(output, {artifacts})`.
- Stored messages, which keep the artifacts of each reply in `metadata.artifacts`.

`clear()` and `loadMessages()` empty the registry. Give the chat a data source for rows not yet
in the browser:

```typescript
const chatModel = new ChatModel({
    transport,
    catalog,
    dataSource: {
        loadAsync: async ({artifactId, offset, limit, signal}) =>
            fromColumnar(await XH.fetchJson({url: 'results/page', params: {artifactId, offset, limit}, signal}))
    }
});
```

A client tool tells the model the id of each artifact it returns:

```typescript
execute: async ({query}) => {
    const result = await runQueryAsync(query);
    return chatToolResult(`Saved ${result.totalRows} rows as ${result.id}.`, {
        artifacts: [{id: result.id, columns: result.columns, rows: result.rows.slice(0, 200), totalRows: result.totalRows}]
    });
}
```

The registry loads each range once. A second request for a range in flight shares the first, and
a loaded range is cached for the life of the registry. Each row gets a synthetic id in
`CHAT_DATA_ROW_ID`, the row's index in the whole result. Use it as a store's `idSpec`, so a result
with duplicate values in its own `id` column cannot break the store.

Inline data stays fine for small components, such as metric tiles and cards, under schema
`maxItems`.

### Slice data with a view

A view is the closed grammar the model uses to ask for a slice of an artifact. `applyDataView()`
filters, sorts, keeps the top rows, scales numbers, and selects columns, in that order:

```typescript
const view: ChatChartView = {
    type: 'bar',
    x: 'region',
    y: ['sales'],
    filter: [{field: 'year', op: 'eq', value: 2024}],
    sortBy: 'sales|desc',
    top: 10,
    units: 'millions'
};
// A view must see every row, or its sort and top N work on the first page alone.
const sliced = handle.isComplete ? applyDataView(handle.frame, view) : null;
```

A view applies to the rows of the frame it gets. A handle's `frame` holds the first page, so give
the data prop a `pageSize` as large as the most rows the component shows, and apply the view only
when `handle.isComplete` is true. For a larger artifact, load all of it with `loadRangeAsync(0,
handle.totalRows)`, or have the server compute the slice and return it as a new artifact.

Filters take `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `in` and `notNull`, and nothing else. A value
converts to its column's type, so `"2024"` matches 2024. `units` scales the `y` columns of a
chart, or the `number` columns of a table other than those formatted as `percent` or `none`.
`integer` columns, which often hold years and counts, keep their values. A
view that names an unknown column throws. Check it first with `findDataViewProblems()`. Merge
`CHAT_DATA_VIEW_PROPERTIES` or `CHAT_CHART_VIEW_PROPERTIES` into a component's props schema to
offer the grammar to the model. A chart and a table can show different views of one artifact.

### Run actions

A component that offers buttons takes typed actions in its props, with `chatUiActionSchema()` in
its schema, and runs them with `context.runActionAsync()`:

```typescript
properties: {
    actions: {type: 'array', maxItems: 4, items: chatUiActionSchema({types: ['send', 'navigate'], requireLabel: true})}
}

// in render
button({
    text: action.label,
    tooltip: describeChatUiAction(action),
    onClick: () => context.runActionAsync(action).catchDefault()
});
```

| Type | Does |
|------|------|
| `send` | Sends `text` as the user's message, with a flat `context` of at most 8 short values on its `metadata.context` |
| `openUrl` | Opens `url` in a new tab, if `urlAllowList` allows it |
| `navigate` | Routes the app to `route`, with `params`, through `XH.navigate()` |
| `callTool` | Runs a client tool of the chat with `input`, once the input passes the tool's schema |
| `app` | Runs the handler in `actionHandlers` for `name`, with `params` |

Each action may add a `label` and a `confirm: {title, message}`. An action with `confirm` asks the
user with `XH.confirm()` first, and does nothing if they cancel. A `callTool` action for a tool
with `needsApproval` asks first, with the tool's `approvalPrompt`. A `callTool` action waits while
the chat is busy, and refuses a tool whose schema uses keywords the catalog cannot check. Its call
is not part of the history, so an undo the tool returns is not kept. `runActionAsync()` rejects an
action that fails its checks. Treat every payload as untrusted, also in an `app` handler.

### Export the catalog for a server

A server that runs the tool loop registers the catalog's tools and prompt itself. It never takes a
prompt from the browser. Write the export to a file at build time, for the server to load:

```typescript
// scripts/exportCatalog.ts - run with your TypeScript runner as part of the build
import {writeFileSync} from 'node:fs';
import {catalog} from '../client-app/src/chat/catalog';

const modes = ['tools', 'tags', 'document'] as const;
writeFileSync(
    'grails-app/conf/chatCatalog.json',
    JSON.stringify(
        {
            version: catalog.version,
            tools: catalog.toToolSchemas({modes: [...modes]}),
            prompt: catalog.toPrompt({modes: [...modes]})
        },
        null,
        2
    )
);
```

The browser sends only `catalog.version`. `AgUiCodec` sends it in `forwardedProps`, with the
turn's ids. The server compares it with the version in its export to detect drift. In the
browser, give a server-mode `ChatModel` the catalog. The chat adds the catalog's `displayTools`,
which render each call as the client tools do, with no `execute`, and are not sent to the model.

`version` is an FNV-1a hash of the catalog's content: the names, descriptions, schemas, examples,
slots and data props of its components, its modes, its instructions, its tag prefix and its limits.
Render functions do not count. A document keeps the `catalogVersion` it was written against.
`migrations` upgrade a stored document from an older version.

### Adapt a protocol's UI payload

A `ChatUiAdapter` translates a protocol's payload into a `ChatUiDocument`. The payload arrives in
a data part: an AG-UI `ACTIVITY_SNAPSHOT` event, or an `xh.chat.data` event, with the adapter's
`dataType`. Register the adapters as the chat's data renderers:

```typescript
import type {ChatUiAdapter, ChatUiDocument, ChatUiElement} from '@xh/hoist-chat-kit/genui';

// A payload of the shape {root, components: [{id, type: 'Column' | 'Stat', ...}]}.
const reportAdapter: ChatUiAdapter = {
    dataType: 'report-ui',
    translate: (payload): ChatUiDocument => ({
        root: payload.root,
        elements: Object.fromEntries(payload.components.map(it => [it.id, toElement(it)]))
    })
};

function toElement(c: PlainObject): ChatUiElement {
    switch (c.type) {
        case 'Column':
            return {component: 'stack', props: {}, children: c.childIds};
        case 'Stat':
            return {component: 'metrics', props: {items: [{label: c.label, value: c.value}]}};
        default:
            return {component: c.type, props: {}}; // Renders as a fallback.
    }
}

const chatModel = new ChatModel({
    transport,
    catalog,
    dataRenderers: catalog.createDataRenderers([reportAdapter])
});
```

`createDataRenderers()` also returns a renderer for documents sent as they are, with the
`dataType` `xh.chat.ui`. A chat with a catalog adds that renderer itself. The catalog repairs and
checks each document before it renders.

## Properties/API Reference

### ChatUiCatalogConfig

| Property | Type | Description |
|----------|------|-------------|
| `components` | `ChatUiComponentSpec[]` | Components the model can show. Names and tool names must be unique. Required. |
| `modes` | `ChatUiDeliveryMode[]` | How the model delivers UI: `tools`, `tags`, `document`. Sets the tools a client-mode chat sends, and the default modes of the prompt and the export. Default `['tools']`. |
| `instructions` | `string` | Guidance for the model, added to the end of the generated prompt. |
| `tagPrefix` | `string` | Prefix of component tags in markdown. Default `ui-`. |
| `documentToolName` | `string` | Name of the document tool. Default `show_ui`. |
| `limits` | `ChatUiLimits` | Caps on elements, depth and inline rows. |
| `artifacts` | `(chatModel) => ChatArtifactRegistry` | The artifact registry of a chat, for reference props. Default `chatModel.artifacts`. |
| `actionHandlers` | `Record<string, ChatUiActionHandler>` | Handlers for `app` actions, by name. |
| `urlAllowList` | `string[] \| (url: URL) => boolean` | Origins, or a check, for URLs that actions and components may open. Default none. |
| `migrations` | `Record<string, (doc) => ChatUiDocument>` | Upgrades for stored documents, keyed by the version they upgrade from. |
| `fallback` | `(spec: ChatUiFallbackSpec) => ReactNode` | Renders an element that cannot render. Default a caption with a "View input" disclosure. |
| `placeholder` | `(spec: ChatUiPlaceholderSpec) => ReactNode` | Renders an element still streaming in. Default "Building chart…". |

### ChatUiComponentSpec

| Property | Type | Description |
|----------|------|-------------|
| `name` | `string` | Name, unique in the catalog. The tool is `show_<name>`. Required. |
| `toolName` | `string` | Tool name, in place of `show_<name>`. |
| `description` | `string` | What the component shows and when to use it, for the model. Required. |
| `props` | `PlainObject` | JSON Schema for the props - the tool's input schema. Required. |
| `validate` | `(props) => string[]` | Checks the schema cannot express. Runs on complete props only. |
| `render` | `(props, context) => ReactNode` | Render the component. May use hooks. Required. |
| `result` | `(props) => string` | The result sent to the model once the component shows. Default "Rendered `<name>` for the user." |
| `example` | `P` | Example props, shown to the model in the prompt. |
| `slots` | `string[]` | Child lists of a container: `default` for `children`, other names for named slots. Default none. |
| `dataProps` | `(string \| ChatUiDataPropSpec)[]` | Props that name an artifact, typed as strings. Each takes a `pageSize`, default 100, and a `maxRows`. |

### ChatUiRenderContext

Passed to `render`. Extends the chat's `ChatPartRenderContext`, which holds `chatModel` and
`messageId`.

| Property | Type | Description |
|----------|------|-------------|
| `part` | `ChatToolCallPart \| ChatDataPart \| ChatTextPart` | The tool call, data part or text part that holds the component. |
| `isPartial` | `boolean` | True while the answer streams. |
| `catalog` | `ChatUiCatalog` | The catalog, for example to check a URL. |
| `element` | `ChatUiNode` | The element the component renders for, with its id. |
| `children` | `ReactNode[]` | Rendered `children`, for a container. |
| `slots` | `Record<string, ReactNode[]>` | Rendered named slots, for a container. |
| `data` | `Record<string, ChatDataHandle>` | The data behind each reference prop with a value. |
| `artifacts` | `ChatArtifactRegistry` | The registry `data` reads, for a side panel request. |
| `runActionAsync` | `(action) => Promise<unknown>` | Check and run a typed action. |

### ChatUiDocument and ChatUiElement

| Property | Type | Description |
|----------|------|-------------|
| `root` | `string` | Id of the top element. |
| `elements` | `Record<string, ChatUiElement>` | Each element, by id. |
| `catalogVersion` | `string` | The catalog version the document was written against. |
| `component` | `string` | Element: name of a catalog component. |
| `props` | `PlainObject` | Element: props for the component. |
| `children` | `string[]` | Element: ids of the child elements. |
| `slots` | `Record<string, string[]>` | Element: ids of the elements in each named slot. |

### ChatUiLimits

| Property | Type | Description |
|----------|------|-------------|
| `maxElements` | `number` | Most elements in one document. Default 50. |
| `maxDepth` | `number` | Most levels of nesting, counting the root. Default 8. |
| `maxInlineRows` | `number` | Most items in any array prop of one element. Default 500. |

### ChatDataHandle

| Property | Type | Description |
|----------|------|-------------|
| `artifactId` | `string` | Id of the artifact, as the model wrote it. |
| `state` | `string` | `waiting`, `loading`, `ready`, `missing`, `tooLarge` or `failed`. |
| `artifact` | `ChatArtifact` | The artifact - its columns and metadata - once known. |
| `frame` | `ChatDataFrame` | The first page of rows, once `ready`. |
| `totalRows` | `number` | Rows in the whole result, once known. |
| `error` | `unknown` | Why the first page failed, if `failed`. |
| `loadRangeAsync` | `(offset, limit) => Promise<ChatDataFrame>` | Load a range of rows. |

### Supported JSON Schema keywords

The catalog checks props with a built-in subset of JSON Schema, and adds no validator
dependency. Its constructor walks each props schema and throws on any keyword that affects
validity but that it does not check, such as `$ref`, `$defs`, `allOf`, `not`, `if`,
`exclusiveMinimum`, `uniqueItems`, `multipleOf`, `minProperties`, `prefixItems`, array-form
`items` or `patternProperties`. The error names each keyword and where it sits. The catalog
sends annotations, such as `title`, `description`, `default` and `format`, to the model, and does
not check them.
The constructor also compiles each `pattern` with the `u` flag, and throws on one that does not
compile. Pair a `pattern` with a `maxLength`, as a long string makes a costly match.

| Keyword | Checked | While partial |
|---------|---------|---------------|
| `type`, including a list of types | Always | Checked |
| `required` | Always | Skipped - a property may not be written yet |
| `properties`, `additionalProperties` | Always | Checked |
| `enum`, `const` | Always | A string passes if it starts an allowed value |
| `items`, `maxItems` | Always | Checked |
| `minItems` | Always | Skipped |
| `maxLength` | Always | Checked |
| `minLength`, `pattern` | Always | Skipped - the last string may be cut short |
| `minimum` | Always | Skipped for a positive number, which more digits may raise |
| `maximum` | Always | Skipped for a negative number, which more digits may lower |
| `anyOf`, `oneOf` | Always | `oneOf` may match more than one branch |

Each problem is a message prefixed with the path of the prop at fault, such as
`rows[3].value: expected number, got string`. In a document, the path starts at the element, as
in `elements.chart.props.rows[3].value`. See `genui/impl/validateSchema.ts` for the details.

## Extension Points

- **Your own components** - write a `ChatUiComponentSpec` for any Hoist component, as above. The
  built-in `chatUiFrame`, `fmtChatUiNumber`, `CHAT_UI_NUMBER_FORMAT_SCHEMA` and
  `CHAT_UI_DECIMALS_SCHEMA` give your components the same look and number formats as the
  built-in ones.
- **The built-in components** - `chatUiGridSpec()`, `chatUiChartSpec()`, `chatUiMetricsSpec()`
  and `chatUiCardSpec()` return specs with options for names, descriptions and limits. See
  [`/desktop/cmp/genui/`](../desktop/cmp/genui/README.md).
- **Instructions and rules** - pass `instructions` to say which component suits which question,
  and `rules` to `toPrompt()` to add to its list of rules.
- **Fallbacks and placeholders** - pass `fallback` and `placeholder` to draw them with the app's
  own components.
- **App actions** - register `actionHandlers`, and allow `app` actions in a component's schema.
- **Data sources** - implement `ChatDataSource` to page rows from the app's server.
- **Adapters** - implement `ChatUiAdapter` for a protocol, and register it with
  `createDataRenderers()`.

## Common Pitfalls

### Leaving the instructions out of the system prompt

The tool descriptions alone do not tell the model when to prefer a component over text, or the
rules for limits and errors. Add `catalog.instructions`, or `toPrompt()` for other modes, to the
system prompt.

### Reading props as if they were complete

While `isPartial` is true, any prop may be missing, and the last array item or string may be
cut short. `validate` has not run.

```typescript
// ✅ Do: Wait for the props a model depends on
render: ({rows}, {isPartial}) => (isPartial ? chatUiSkeleton(120) : myGrid({rows}));

// ❌ Don't: Index into props that may not exist yet
render: ({rows}) => myGrid({firstSymbol: rows[0].symbol, rows});
```

### Rendering a handle as if it were ready

A reference prop resolves to a handle in any of six states. Its `frame` is null until `ready`.

```typescript
// ✅ Do: Render by state
render: (_, {data}) => (data.data?.state === 'ready' ? resultTable({frame: data.data.frame}) : dataNote(data.data))

// ❌ Don't: Read the rows straight away
render: (_, {data}) => resultTable({frame: data.data.frame})
```

### Loose schemas

A schema with no `maxItems` or `maxLength` lets the model send as much as it likes, and every
later step resends it. Bound every array and every free-text string. Pass large data by
reference.

### Too few steps

Each component a reply shows takes one of the chat's `maxSteps`. A reply that shows four
components and calls two app tools needs at least seven steps. Raise `maxSteps` to suit.

### Using schema keywords the catalog does not check

The catalog throws on a schema keyword it cannot check, rather than let invalid props through.
Schema generators emit `$ref` and `$defs` for shared types. Inline those types, and move any
rule the subset cannot express, such as unique items, to `validate`.

### Trusting an action payload

The model writes every action, and a prompt injection can steer what it writes. Do not run an
action's payload outside `runActionAsync()`. In an `app` handler, check the params as you would
check user input.

### Sending the prompt from the browser

A server that takes its prompt from the browser lets any user rewrite it. Load the exported
prompt on the server, and send only `catalog.version` from the browser.

## Related Packages

- [`/desktop/cmp/genui/`](../desktop/cmp/genui/README.md) - the built-in grid, chart, metrics and
  card components, and the frame and number formats for your own
- [`/core/`](../core/README.md) - `ChatModel`, `ChatToolSpec` and data renderers
- [`/desktop/cmp/chat/`](../desktop/cmp/chat/README.md) - the chat components that display tool
  calls, including inline ones
- [Protocols](../docs/protocols.md) - how A2UI, OpenUI and MCP Apps relate to the catalog
- hoist-react `/cmp/grid/` and `/cmp/chart/` - the Hoist components most catalog components wrap
