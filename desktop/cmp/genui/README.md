# Desktop Generative UI Components

| Section | Description |
|---------|-------------|
| [Overview](#overview) | What the built-in components are, and the key features |
| [Architecture](#architecture) | Factories, components, and how a call becomes a rendered component |
| [Configuration Pattern](#configuration-pattern) | Adding the components to a `ChatUiCatalog` and a `ChatModel` |
| [Common Usage Patterns](#common-usage-patterns) | Grids, charts, metrics, cards, and direct use |
| [Properties/API Reference](#propertiesapi-reference) | Factory options and the props each component takes |
| [Extension Points](#extension-points) | Renaming, describing, limiting, and writing your own |
| [Common Pitfalls](#common-pitfalls) | Mistakes that compile but misbehave |
| [Related Packages](#related-packages) | The catalog, the chat components, and Hoist packages |

## Overview

The `/desktop/cmp/genui/` package holds four ready-made components for generative UI. A model
shows them inline in its reply: a Hoist grid, a Hoist chart, a row of KPI tiles, and a detail
card. Add them to a `ChatUiCatalog` next to your own components. The model can then answer with
real Hoist UI in place of long tables of text.

Import from `@xh/hoist-chat-kit/desktop/cmp/genui`.

Key features:

- **Factories that return specs** - `chatUiGridSpec()`, `chatUiChartSpec()`, `chatUiMetricsSpec()`
  and `chatUiCardSpec()` each return a `ChatUiComponentSpec`, with a props schema, checks, a
  description for the model, and an example.
- **Hoist components inside** - the grid is a Hoist `Grid` with its own `GridModel`, and the
  chart is a Hoist `Chart` with its own `ChartModel`. Each model is created with the component and
  destroyed with it.
- **Streaming** - grid rows and chart points fill in as the model writes them, into the same
  model. Nothing is rebuilt per update.
- **Typed, formatted values** - the model declares a type and a number format, such as
  `currency` or `percent`. Hoist's formatters render each value.
- **Themes** - the components use Hoist and chat CSS variables, and the chart uses Hoist's chart
  themes, so they follow the light and dark themes.
- **Numbers that never cut short** - a KPI tile shows a large value in a compact form, such as
  `$48.5B`, with the full value in a tooltip. Grid columns size to their content.
- **Follow-up actions** - card buttons send a prompt as the user's next message. The user sees
  the prompt before and after the click.

## Architecture

```
chatUiGridSpec(opts)    → ChatUiComponentSpec<ChatUiGridSpecProps>    → ChatUiGrid
chatUiChartSpec(opts)   → ChatUiComponentSpec<ChatUiChartSpecProps>   → ChatUiChart
chatUiMetricsSpec(opts) → ChatUiComponentSpec<ChatUiMetricsSpecProps> → ChatUiMetrics
chatUiCardSpec(opts)    → ChatUiComponentSpec<ChatUiCardSpecProps>    → ChatUiCard
```

Each factory returns a spec for a `ChatUiCatalog`. The catalog turns the spec into a tool named
`show_<name>`: `show_grid`, `show_chart`, `show_metrics` and `show_card` by default. When the
model calls the tool, the catalog checks the props against the spec's schema and its `validate`
function. It then calls the spec's `render`, which returns the matching component.

While the model writes the props, `render` runs with `isPartial: true` and props that may be cut
short. The components handle this:

- `ChatUiGrid` waits until the columns are complete and the first row has arrived. It then
  creates its `GridModel`, and loads the rows written so far with `loadData()`. The last row is
  left out until the props are complete, as it may still be missing values. Columns autosize to
  their content as rows load, until the user resizes one.
- `ChatUiChart` waits until the chart type and axes are complete, creates its `ChartModel`, and
  passes the series to `setSeries()`. Hoist updates the points in place.
- `ChatUiMetrics` shows each tile once it is complete.
- `ChatUiCard` shows fields as they arrive, and its actions once the props are complete.

A grid or chart shows a pulsing placeholder until it has enough props to render.

## Configuration Pattern

Create the catalog once, then give its tools to the `ChatModel` and its instructions to the
model:

```typescript
import {ChatModel} from '@xh/hoist-chat-kit/core';
import {
    chatUiCardSpec,
    chatUiChartSpec,
    chatUiGridSpec,
    chatUiMetricsSpec
} from '@xh/hoist-chat-kit/desktop/cmp/genui';
import {ChatUiCatalog} from '@xh/hoist-chat-kit/genui';
import {AnthropicCodec, HoistChatTransport} from '@xh/hoist-chat-kit/transport';

const catalog = new ChatUiCatalog({
    components: [
        chatUiMetricsSpec(),
        chatUiGridSpec({maxRows: 50}),
        chatUiChartSpec(),
        chatUiCardSpec()
    ],
    instructions: 'Use a grid for positions and trades, and a chart for performance over time.'
});

const chatModel = new ChatModel({
    transport: new HoistChatTransport({
        url: 'llm/stream',
        codec: new AnthropicCodec({system: `${appPrompt}\n\n${catalog.instructions}`})
    }),
    tools: [...appTools, ...catalog.tools]
});
```

The chart needs Highcharts, installed by the app in its `Bootstrap.ts` as for any Hoist chart.

## Common Usage Patterns

Each component a reply shows costs a model call, a step and the tokens of its props on every
later step. See [Each render is a model call](../../../genui/README.md#each-render-is-a-model-call).
Keep `maxRows` and `maxPoints` as low as the use allows.

### Show a grid

The model declares typed columns, then sends rows keyed by column field:

```json
{
    "title": "Top positions",
    "columns": [
        {"field": "symbol", "headerName": "Symbol"},
        {"field": "pnl", "headerName": "P&L", "type": "number", "format": "currency", "decimals": 0},
        {"field": "weight", "type": "number", "format": "percent"},
        {"field": "tradeDate", "type": "date"}
    ],
    "rows": [{"symbol": "AAPL", "pnl": 125000, "weight": 0.082, "tradeDate": "2026-10-01"}],
    "sortBy": "pnl|desc"
}
```

Column types map to Hoist columns and store fields:

| Type | Values | Hoist column |
|------|--------|--------------|
| `string` | Any value, shown as text | Flexible width |
| `number` | Numbers, rendered in the column's `format` | `number`, right-aligned |
| `date` | `YYYY-MM-DD` strings, stored as `LocalDate` | `localDate` |
| `boolean` | `true` or `false` | `boolCheck` |

A value that does not fit its column's type fails the call, so the model can correct it. The grid
is just tall enough for its rows, up to `maxHeight`, then scrolls. Columns size to their content
and headers. Text columns stop at a maximum width and number columns keep a minimum, so a narrow
chat scrolls the grid sideways rather than hide its numbers. The context menu copies cells,
autosizes columns, and exports to Excel or CSV.

### Show a chart

```json
{
    "title": "Monthly revenue",
    "type": "column",
    "xAxis": {"categories": ["Jan", "Feb", "Mar"]},
    "yAxis": {"title": "USD", "format": "currency", "decimals": 0},
    "series": [{"name": "Revenue", "data": [182000, 205000, 231000]}]
}
```

For a time series, set `xAxis.type` to `datetime` and send `[date, value]` pairs. A date is a
`YYYY-MM-DD` string, read at local midnight, or epoch milliseconds. Axis labels show large values
in a compact form, such as `$1.25M`, and tooltips show them in full.

A pie takes one series of `[name, value]` pairs, one per slice. The schema, the description and
the checks all tell the model so:

```json
{"type": "pie", "series": [{"name": "Weight", "data": [["Tech", 0.42], ["Energy", 0.18]]}]}
```

A pie may also send plain values with `xAxis.categories` as the slice names. A slice with no name
fails the call.

### Show metrics and a card

```json
{"metrics": [
    {"label": "Revenue", "value": 1250000, "format": "currency", "decimals": 0},
    {"label": "Margin", "value": 0.184, "format": "percent", "delta": 0.012, "deltaLabel": "vs Q2"},
    {"label": "Open issues", "value": 7, "intent": "warning"}
]}
```

A delta shows with an arrow, green when up and red when down. It takes the format and decimals
of its value, unless the model sets `deltaFormat`. A large `number` or `currency` value, from
100,000 up, shows to three significant digits with a `K`, `M`, `B` or `T` suffix. Its tooltip
shows the full value. The model sends the full number.

A card shows one record. Each action is a button that sends its `prompt` through
`ChatModel.sendAsync()`, as the user's own message. The prompt shows in the button's tooltip
before the click, and in the chat after it, so the user sees exactly what an action sends.
Prompts are at most 200 characters. The buttons are disabled while the chat is busy.

```json
{
    "title": "Acme Corp",
    "subtitle": "Counterparty - Tier 1",
    "fields": [{"label": "Exposure", "value": 4200000, "format": "currency", "decimals": 0}],
    "actions": [{"text": "Show trades", "prompt": "Show my open trades with Acme Corp."}]
}
```

### Render a component directly

The components also work outside a catalog, for example in a data renderer or a custom tool
renderer. Pass the props the model would write:

```typescript
chatUiGrid({columns, rows, maxHeight: 240});
chatUiMetrics({metrics});
chatUiCard({title, fields, actions, chatModel});
```

## Properties/API Reference

### Number formats

Every numeric value takes a `format` and optional `decimals`:

| Format | Shows | Default decimals |
|--------|-------|------------------|
| `number` | `1,234,567` | Suits the value |
| `percent` | A fraction as a percentage, `0.125` as `12.5%` | 1 |
| `currency` | `$1,250,000.00` | 2 |
| `none` | The number as is, `2026` | All |

### Factory options

All factories take `name`, the catalog name and the `show_<name>` tool, and `description`, the
text that tells the model when to use the component.

| Factory | Option | Type | Description |
|---------|--------|------|-------------|
| `chatUiGridSpec` | `maxRows` | `number` | Most rows the model may send. Default 100. |
| | `maxColumns` | `number` | Most columns. Default 12. |
| | `maxHeight` | `number` | Tallest the grid grows, in pixels, before it scrolls. Default 360. |
| `chatUiChartSpec` | `maxSeries` | `number` | Most series. Default 8. |
| | `maxPoints` | `number` | Most points per series. Default 500. |
| | `height` | `number` | Chart height, in pixels. Default 280. |
| `chatUiMetricsSpec` | `maxItems` | `number` | Most tiles. Default 8. |
| `chatUiCardSpec` | `maxFields` | `number` | Most fields. Default 16. |
| | `maxActions` | `number` | Most actions. Default 4. |

### Component props

| Component | Props from the model | Other props |
|-----------|----------------------|-------------|
| `ChatUiGrid` | `title`, `columns`, `rows`, `sortBy` | `isPartial`, `maxHeight` |
| `ChatUiChart` | `title`, `type`, `xAxis`, `yAxis`, `series` | `isPartial`, `height` |
| `ChatUiMetrics` | `metrics` | `isPartial` |
| `ChatUiCard` | `title`, `subtitle`, `fields`, `actions` | `chatModel`, `isPartial` |

See the TSDoc in each source file for the full shape of the props.

## Extension Points

- **Describe your data** - pass a `description` that names your app's records, so the model
  knows when a grid or chart fits.
- **Rename** - pass `name` to give a component a domain name, such as `positions`. This also
  renames its tool.
- **Limit** - lower `maxRows`, `maxPoints` and the other limits to keep replies small and fast.
- **Write your own** - a component bound to app data follows the same pattern. Write a spec
  with a props schema and a `render` that returns a Hoist component. See
  [`/genui/`](../../../genui/README.md). For data the model should not see, take an id in the
  props and load the data in the component.
- **Match the look** - `chatUiFrame` draws the bordered surface and header of the built-in
  components, and `chatUiSkeleton` their placeholder. `fmtChatUiNumber` formats a number with a
  `ChatUiNumberFormat`, optionally `compact`. `CHAT_UI_NUMBER_FORMAT_SCHEMA` and
  `CHAT_UI_DECIMALS_SCHEMA` declare the same number props in your own schemas.

## Common Pitfalls

### Sending fractions as percentages

The `percent` format multiplies by 100, as Excel does. The model must send `0.125` for 12.5%.
The format descriptions in each schema tell the model so.

### Expecting a chart without Highcharts

`ChatUiChart` renders a Hoist `Chart`, which shows a placeholder if the app has not installed
Highcharts. Install it in `Bootstrap.ts` with `installHighcharts()`.

### Keeping limits high

Every later step of a turn resends a component's props with the history. A grid of 100 rows
costs those tokens on each step after it. Lower `maxRows` and `maxPoints` to what a reader can
take in, and point the model at a filter for more.

## Related Packages

- [`/genui/`](../../../genui/README.md) - `ChatUiCatalog`, `ChatUiComponentSpec`, and protocol
  adapters
- [`/desktop/cmp/chat/`](../chat/README.md) - the chat components that display tool calls,
  including inline generative UI
- [`/core/`](../../../core/README.md) - `ChatModel` and `ChatToolSpec`
- [Protocols](../../../docs/protocols.md) - how generative UI protocols relate to the kit
- hoist-react `/cmp/grid/` - `GridModel`, columns, and renderers
- hoist-react `/cmp/chart/` - `ChartModel`, and installing Highcharts
- hoist-react `/format/` - the number and date formatters
