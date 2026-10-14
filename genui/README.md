# Generative UI

| Section | Description |
|---------|-------------|
| [Overview](#overview) | What the catalog does, and the key features |
| [Architecture](#architecture) | The catalog, component specs, tools, inline display, and the cost of a render |
| [Configuration Pattern](#configuration-pattern) | Creating a catalog and wiring it to a `ChatModel` |
| [Common Usage Patterns](#common-usage-patterns) | Writing components, partial props, app data, and protocol adapters |
| [Properties/API Reference](#propertiesapi-reference) | Catalog config, component spec, render context, and the schema subset |
| [Extension Points](#extension-points) | Your own components, instructions, and adapters |
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
- **One tool per component** - each component becomes a client tool, `show_<name>`, with the
  component's props schema as its input schema. Every transport and codec works with it
  unchanged.
- **Streaming** - a component renders while the model writes its props, so a grid fills row by
  row and a chart draws as its points arrive.
- **Errors the model can fix** - invalid props fail the call with a list of problems, each with
  the path of the prop at fault. The model corrects the props and calls again.
- **Generated instructions** - the catalog writes the system prompt text that explains when to
  show UI, with an example for each component. Each component's description reaches the model
  once, in its tool.
- **A checked schema** - the catalog refuses a props schema that relies on a JSON Schema keyword
  it does not check, so no invalid props get through unnoticed.
- **Protocol adapters** - a `ChatUiAdapter` translates the UI payload of a protocol, such as
  OpenUI or A2UI, into catalog components. The protocol's UI then draws with Hoist components.

## Architecture

```
ChatUiCatalog
├── components: ChatUiComponentSpec[]   # What the model may show
├── tools: ChatToolSpec[]               # One inline client tool per component
├── instructions: string                # System prompt text for the model
└── Methods:
    ├── getComponent()                  # A spec by name
    ├── validate()                      # Check props against a spec
    ├── renderNode()                    # Render an adapter's node, with its children
    └── createDataRenderers()           # Data renderers for protocol adapters
```

A `ChatUiComponentSpec` declares one component. It has a `name`, a `description` for the
model, and a JSON Schema for its `props`. It can add a `validate` function, for checks the
schema cannot express, an `example`, and a `result` that tells the model what it showed. Its
`render` function returns the component.

### How a call becomes a component

1. The catalog turns each spec into a `ChatToolSpec`. The tool's `parameters` is the props
   schema, so the model gets an exact schema per component. Its `display` is `inline`.
2. The model calls the tool, `show_grid` for example, and streams the props as the tool input.
3. While the input streams, the tool's renderer checks the partial props with the checks that
   streaming props could still pass. If they could still become valid, it calls the spec's
   `render` with `isPartial: true`.
4. Once the input is complete, the chat runs the tool. Its `execute` checks the props in full,
   then the spec's `validate`. Valid props return the spec's `result` to the model, or by
   default "Rendered grid for the user.". Invalid props throw an error that lists each problem.
5. The renderer draws the complete props with `isPartial: false`. Invalid props render nothing.

Per-component tools are more reliable than one `render_ui` tool that takes a union of every
component. The model sees one small schema per tool, and the provider can enforce it.

### Inline display

A tool with `display: 'inline'` shows its rendered output as part of the reply, with no card around
it. The output is the progress, so the quiet status line under it is mostly empty. It shows
"Rendering…" while the input streams, and a note while the call waits for approval or after it fails
or is denied. A failed call shows a short message for the user, such as "Could not show the chart.".
The error text, which is written for the model, shows behind the "View input" toggle, with the
input. The toggle appears when the user hovers over or focuses the component. A denied call
renders no component, nor does a call that waits for approval, unless its tool sets
`approvalPreview`.

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
the cache, which cuts the cost of the tokens but not of the call.

### Safety model

- The model can show only components the app put in the catalog, with props that pass the
  schema and `validate`. A prop the schema does not declare fails with `additionalProperties:
  false`.
- Nothing the model writes runs as code or loads as HTML. A component that shows a URL or an
  image decides for itself what to allow.
- Schema limits - `maxItems`, `maxLength` - bound the data the model can send.
- For data the model should not see, a component takes a reference in its props, such as an id
  from an earlier tool result. It loads the data itself in `render`.
- An action that sends a message for the user should show exactly what it sends. The built-in
  card shows each action's prompt in its tooltip, and then as the user's own message, and caps
  it at 200 characters.

## Configuration Pattern

Create the catalog once, for example on the model that owns the chat. Pass its `tools` to the
`ChatModel`, and its `instructions` to the model with the system prompt:

```typescript
import {ChatModel} from '@xh/hoist-chat-kit/core';
import {chatUiChartSpec, chatUiGridSpec} from '@xh/hoist-chat-kit/desktop/cmp/genui';
import {ChatUiCatalog} from '@xh/hoist-chat-kit/genui';
import {AnthropicCodec, HoistChatTransport} from '@xh/hoist-chat-kit/transport';
import {HoistModel, managed} from '@xh/hoist/core';

export class AnalystModel extends HoistModel {
    readonly catalog = new ChatUiCatalog({
        components: [chatUiGridSpec({maxRows: 50}), chatUiChartSpec(), positionCardSpec],
        instructions: 'Use a grid for positions and trades, and a chart for performance.'
    });

    @managed readonly chatModel = new ChatModel({
        transport: new HoistChatTransport({
            url: 'llm/stream',
            codec: new AnthropicCodec({
                system: `${APP_PROMPT}\n\n${this.catalog.instructions}`,
                cacheControl: true
            })
        }),
        tools: [...appTools, ...this.catalog.tools],
        // Each component a reply shows takes a step.
        maxSteps: 16
    });
}
```

Tool names must be unique across the app's tools and the catalog's. The `ChatModel` constructor
throws if two tools share a name.

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

### Show app data the model should not see

Take a reference in the props, and load the data in the component:

```typescript
const exposureSpec: ChatUiComponentSpec<{clientId: string}> = {
    name: 'exposure',
    description: "A client's exposure by asset class. Pass the client id from find_client.",
    props: {
        type: 'object',
        required: ['clientId'],
        properties: {clientId: {type: 'string'}}
    },
    render: ({clientId}, {isPartial}) => (isPartial ? null : exposureGrid({clientId}))
};
```

The model sees only the id and the tool result, never the exposure figures.

### Adapt a protocol's UI payload

A `ChatUiAdapter` translates a protocol's payload into `ChatUiNode`s - catalog component names,
props, and children. The payload arrives in a data part: an AG-UI `ACTIVITY_SNAPSHOT` event, or
an `xh.chat.data` event, with the adapter's `dataType`. Register the adapters as the chat's data
renderers:

```typescript
import type {ChatUiAdapter, ChatUiNode} from '@xh/hoist-chat-kit/genui';

// A payload of the shape {elements: [{type: 'Table' | 'Stat' | 'Section', ...}]}.
const reportAdapter: ChatUiAdapter = {
    dataType: 'report-ui',
    translate: payload => payload.elements.flatMap(toNodes)
};

function toNodes(el: PlainObject): ChatUiNode[] {
    switch (el.type) {
        case 'Table':
            return [
                {
                    component: 'grid',
                    props: {
                        title: el.title,
                        columns: el.headers.map((header, idx) => ({field: `c${idx}`, headerName: header})),
                        rows: el.rows.map(row => Object.fromEntries(row.map((v, idx) => [`c${idx}`, v])))
                    }
                }
            ];
        case 'Stat':
            return [{component: 'metrics', props: {metrics: [{label: el.label, value: el.value}]}}];
        case 'Section':
            return [{component: 'section', props: {title: el.title}, children: el.items.flatMap(toNodes)}];
        default:
            return []; // Leave out what the catalog cannot show.
    }
}

const chatModel = new ChatModel({
    transport,
    tools: catalog.tools,
    dataRenderers: catalog.createDataRenderers([reportAdapter])
});
```

The catalog checks each node's props before it renders. A node with an unknown component or
invalid props renders nothing, with a warning in the console. A container component, such as
`section` above, receives its rendered children as `context.children`.

## Properties/API Reference

### ChatUiCatalogConfig

| Property | Type | Description |
|----------|------|-------------|
| `components` | `ChatUiComponentSpec[]` | Components the model can show. Names and tool names must be unique. Required. |
| `instructions` | `string` | Guidance for the model, added to the end of the generated `instructions`. |

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
| `example` | `P` | Example props, shown to the model in the instructions. |

### ChatUiRenderContext

Passed to `render`. Extends the chat's `ChatPartRenderContext`, which holds `chatModel` and
`messageId`.

| Property | Type | Description |
|----------|------|-------------|
| `part` | `ChatToolCallPart \| ChatDataPart` | The tool call that showed the component, or the data part an adapter translated. |
| `isPartial` | `boolean` | True while the props stream. |
| `children` | `ReactNode[]` | Rendered children of an adapter's node. Empty for a tool call. |

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
`rows[3].value: expected number, got string`. See `genui/impl/validateSchema.ts` for the details.

## Extension Points

- **Your own components** - write a `ChatUiComponentSpec` for any Hoist component, as above. The
  built-in `chatUiFrame`, `fmtChatUiNumber`, `CHAT_UI_NUMBER_FORMAT_SCHEMA` and
  `CHAT_UI_DECIMALS_SCHEMA` give your components the same look and number formats as the
  built-in ones.
- **The built-in components** - `chatUiGridSpec()`, `chatUiChartSpec()`, `chatUiMetricsSpec()`
  and `chatUiCardSpec()` return specs with options for names, descriptions and limits. See
  [`/desktop/cmp/genui/`](../desktop/cmp/genui/README.md).
- **Instructions** - pass `instructions` to say which component suits which question. Pass a
  `description` per component that names your app's records.
- **Adapters** - implement `ChatUiAdapter` for a protocol, and register it with
  `createDataRenderers()`.

## Common Pitfalls

### Leaving the instructions out of the system prompt

The tool descriptions alone do not tell the model when to prefer a component over text, or the
rules for limits and errors. Add `catalog.instructions` to the system prompt.

### Reading props as if they were complete

While `isPartial` is true, any prop may be missing, and the last array item or string may be
cut short. `validate` has not run.

```typescript
// ✅ Do: Wait for the props a model depends on
render: ({rows}, {isPartial}) => (isPartial ? chatUiSkeleton(120) : myGrid({rows}));

// ❌ Don't: Index into props that may not exist yet
render: ({rows}) => myGrid({firstSymbol: rows[0].symbol, rows});
```

### Loose schemas

A schema with no `maxItems` or `maxLength` lets the model send as much as it likes, and every
later step resends it. Bound every array and every free-text string.

### Too few steps

Each component a reply shows takes one of the chat's `maxSteps`. A reply that shows four
components and calls two app tools needs at least seven steps. Raise `maxSteps` to suit.

### Using schema keywords the catalog does not check

The catalog throws on a schema keyword it cannot check, rather than let invalid props through.
Schema generators emit `$ref` and `$defs` for shared types. Inline those types, and move any
rule the subset cannot express, such as unique items, to `validate`.

## Related Packages

- [`/desktop/cmp/genui/`](../desktop/cmp/genui/README.md) - the built-in grid, chart, metrics and
  card components, and the frame and number formats for your own
- [`/core/`](../core/README.md) - `ChatModel`, `ChatToolSpec` and data renderers
- [`/desktop/cmp/chat/`](../desktop/cmp/chat/README.md) - the chat components that display tool
  calls, including inline ones
- [Protocols](../docs/protocols.md) - how A2UI, OpenUI and MCP Apps relate to the catalog
- hoist-react `/cmp/grid/` and `/cmp/chart/` - the Hoist components most catalog components wrap
