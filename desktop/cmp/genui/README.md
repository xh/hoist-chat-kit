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
shows them inline in its reply: a result table, a Hoist chart, a row of KPI tiles, and a detail
card. Add them to a `ChatUiCatalog` next to your own components. The model can then answer with
real Hoist UI in place of long tables of text.

Import from `@xh/hoist-chat-kit/desktop/cmp/genui`.

Key features:

- **Factories that return specs** - `chatUiGridSpec()`, `chatUiChartSpec()`, `chatUiMetricsSpec()`
  and `chatUiCardSpec()` each return a `ChatUiComponentSpec`, with a props schema, checks, a
  description for the model, and an example.
- **Result tables in two tiers** - inline, a table is a light preview of its first rows and
  columns, with a footer that says what it leaves out. Expand opens one Hoist `Grid` over the
  whole result, in the chat's side panel or in a dialog.
- **Data inline or by reference** - the model writes the rows or points, or names an artifact
  that a tool produced. A table by reference pages through the chat's `ChatDataSource`.
- **Hoist components inside** - the chart is a Hoist `Chart` with its own `ChartModel`, created
  with the card and destroyed with it. Expand opens it with switchers for its type and axes.
- **Streaming** - table rows and chart points fill in as the model writes them. A chart fills
  the same model. Nothing is rebuilt per update.
- **Typed, formatted values** - the model declares a type and a number format, such as
  `currency` or `percent`. Hoist's formatters render each value.
- **Themes** - the components use Hoist and chat CSS variables, and the chart uses Hoist's chart
  themes, so they follow the light and dark themes.
- **Numbers that never cut short** - a KPI tile shows a large value in a compact form, such as
  `$48.5B`, with the full value in a tooltip.
- **Follow-up actions** - a card's follow-up chips run typed actions. By default each one sends
  a message as the user's next turn, and its tooltip shows what the click does.
- **One card frame** - every card shares a 28 px header strip, a footer for counts, and the same
  loading, failed and empty states. `.xh-chat--compact` narrows them for a docked chat.

## Architecture

```
chatUiGridSpec(opts)    → ChatUiComponentSpec<ChatUiGridSpecProps>    → ChatUiGrid  → ChatUiTableView
chatUiChartSpec(opts)   → ChatUiComponentSpec<ChatUiChartSpecProps>   → ChatUiChart → ChatUiChartView
chatUiMetricsSpec(opts) → ChatUiComponentSpec<ChatUiMetricsSpecProps> → ChatUiMetrics
chatUiCardSpec(opts)    → ChatUiComponentSpec<ChatUiCardSpecProps>    → ChatUiCard
```

Each factory returns a spec for a `ChatUiCatalog`. The catalog turns the spec into a tool named
`show_<name>`: `show_grid`, `show_chart`, `show_metrics` and `show_card` by default. When the
model calls the tool, the catalog checks the props against the spec's schema and its `validate`
function. It then calls the spec's `render`, which returns the matching component.

While the model writes the props, `render` runs with `isPartial: true` and props that may be cut
short. The components handle this:

- `ChatUiGrid` says "Building table…" until the title arrives, then shows skeleton rows until
  the columns are complete and the rows begin. The preview then shows the rows written so far.
  The last row is left out until the props are complete, as it may still be missing values.
- `ChatUiChart` waits until the chart type and axes are complete, creates its `ChartModel`, and
  passes the series to `setSeries()`. Hoist updates the points in place.
- `ChatUiMetrics` shows each tile once it is complete.
- `ChatUiCard` shows fields as they arrive, and its actions once the props are complete.

A table or chart card keeps the height it will need from the moment its type is known, so
nothing below it moves when the data lands. A skeleton still shown after a second shimmers three
times, then holds still.

### Two tiers

A component that can show more than fits inline has two tiers (D69):

| Card | Inline tier | Full tier |
|------|-------------|-----------|
| Table | A plain HTML table: at most 8 rows and 6 columns, on Hoist's compact grid tokens | `ChatUiTableView`: one Hoist `Grid` that pages through the result, with find, a column chooser and export |
| Chart | A Hoist `Chart` at a fixed height: at most 5 series, each sampled down to 500 points | `ChatUiChartView`: every series in full, with switchers for the type and the axes |

The preview is not an ag-Grid instance, so a long thread with many tables stays light. Its cells
use the same formatter as the full grid. A table whose result fits the preview has no full tier,
only a download.

Expand, or View Full Table, opens the full tier as a request in the chat's side panel - see
`ChatSidePanelHost`. `ChatWorkspace` publishes one. Where no side panel is in model context, or
it has no room, the full tier opens in a dialog. Closing the side panel returns focus to the
button that opened it.

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
    tools: appTools,
    catalog
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

Column types decide how the preview and the full grid show each cell:

| Type | Values | Shown as |
|------|--------|----------|
| `string` | Any value | Text |
| `number`, `integer` | Numbers | The column's `format` and `decimals`, right-aligned, negatives in parentheses |
| `date`, `datetime` | `YYYY-MM-DD` strings, or ISO date-times | A formatted date, or date and time |
| `boolean` | `true` or `false` | A check mark for `true`, blank otherwise |

A value that does not fit its column's type fails the call, so the model can correct it.

The preview shows the first rows after `sortBy`. Its columns follow the model's order, and the
first one always shows. It shows as many columns as fit at 110 px each, up to the preview limit,
and 3 at compact density. The footer always states what the preview leaves out, as "Showing 8 of
30 rows · 6 of 8 columns". Numbers align right, with negatives in parentheses. Dates show as
`YYYY-MM-DD`, and a long text cell shows its full value in a tooltip.

The download in the footer exports every row of the result, not just the preview, with Hoist's
grid export. The full grid's Export does the same for the rows its view shows, and waits for Load
Next to finish. Above `exportConfirmAbove` rows, either one asks the user first, as it loads every
row into the browser.

### Show a table by reference

For a result that a tool produced, give the table an artifact in place of rows. Create the spec
with `byReference: true`. The model then writes the artifact's id and a `ChatDataView` over it,
and never copies the rows:

```json
{
    "title": "Largest positions",
    "data": "positions-1",
    "columns": ["symbol", "desk", "gross", "pnl"],
    "sortBy": "gross|desc",
    "units": "millions"
}
```

The catalog resolves `data` through the chat's artifact registry, and loads its first page of
`pageSize` rows. The preview applies the view to that page. The full grid starts from the same
page, and Load Next loads the next one from the chat's `ChatDataSource`. It never loads more on
scroll. Its sort and Find cover the rows loaded so far, and the status bar says so. Its count
says how many loaded rows the view's filter and `top` keep, as "Loaded 1,000 of 2,500 rows · 40
shown". The view's columns show in its order, and the rest start hidden in the column chooser.

A preview that cannot show keeps its height and says why, with only the actions that can work:
Retry for rows that failed to load, nothing for an artifact that is gone or a view that names a
column the result does not have.

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

The chart card puts the title in its header strip, never in the plot, and fixes the body at the
`--xh-chat-chart-height` CSS variable: 220 px, and 160 px at compact density. A legend shows only
for two or more series, and the second series is dashed as well as colored. The header holds
Expand and an options menu: Copy Image, Download PNG, Download CSV, then Expand. Download CSV is
the accessible fallback for the chart's data.

With `byReference: true`, the model names an artifact and a `ChatChartView` over it: the type,
the `x` column and the numeric `y` columns, one series each, or one per value of `groupBy`. A date
`x` column makes a time axis. A view with no numeric column says so, and offers the table.

The expanded chart switches between line, column, bar and area, and picks its x and y columns
from the artifact. A change of type updates the series in place, so a zoom survives it.

### Show metrics and a card

```json
{"metrics": [
    {"label": "Revenue", "value": 1250000, "format": "currency", "decimals": 0},
    {"label": "Margin", "value": 0.184, "format": "percent", "delta": 0.012, "deltaLabel": "vs Q2"},
    {"label": "Open issues", "value": 7, "intent": "warning"}
]}
```

Tiles are outlined, at least 150 px wide, and wrap: four fit at 820 px, and two per row at 380 px.
A delta shows with an arrow, in Hoist's positive color when up and its negative color when down.
With `invert`, for a metric where up is bad, a rise shows in the negative color. It takes the
format and decimals of its value, unless the model sets `deltaFormat`. An `intent` colors the
tile's outline. A large `number` or `currency` value, from
100,000 up, shows to three significant digits with a `K`, `M`, `B` or `T` suffix. Its tooltip
shows the full value. The model sends the full number.

A card shows one record, with its title and subtitle in the header strip. Each action is a typed
`ChatUiAction` with a `label`, shown as an outlined chip after the card. A click runs it through
the catalog's `runActionAsync()`. A long chip is cut to one line. By default the card takes `send` actions
only. A `send` action sends its `text` as the user's own message, with any structured `context` on
the message's `metadata.context`. The context is a flat object of at most 8 short values, such as
record ids. The button's tooltip describes the action and its context before the click, and the
chat shows both after it. Sent text is at most 200 characters. Buttons that send a message or run
a tool are disabled while the chat is busy, or while a send blocker gives a reason to wait. In a
message list over a host that is not a `ChatModel`, the card hides them.

```json
{
    "title": "Acme Corp",
    "subtitle": "Counterparty - Tier 1",
    "fields": [{"label": "Exposure", "value": 4200000, "format": "currency", "decimals": 0}],
    "actions": [
        {"type": "send", "label": "Show trades", "text": "Show my open trades with Acme Corp.", "context": {"counterpartyId": 4417}}
    ]
}
```

Pass `actionTypes` to allow more kinds of action, such as `navigate` or `app`. See [Run
actions](../../../genui/README.md#run-actions) for each type and its checks.

### Render a component directly

The components also work outside a catalog, for example in a data renderer or a custom tool
renderer. Pass the props the model would write. A table by reference takes a `ChatDataHandle`,
which the catalog loads for its own components:

```typescript
chatUiGrid({columns, rows});
chatUiGrid({dataHandle: registry.getHandle(artifactId), registry, view});
chatUiMetrics({metrics});
chatUiCard({
    title,
    fields,
    actions,
    chatModel,
    runActionAsync: action => catalog.runActionAsync(action, {chatModel, messageId})
});
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
| `chatUiGridSpec` | `maxRows` | `number` | Most rows the model may send inline. Default 100. |
| | `maxColumns` | `number` | Most columns inline. Default 12. |
| | `byReference` | `boolean` | Take an artifact and a view, not rows. Default false. |
| `chatUiChartSpec` | `maxSeries` | `number` | Most series inline. Default 8. |
| | `maxPoints` | `number` | Most points per series inline. Default 500. |
| | `maxRows` | `number` | Most rows of an artifact to chart, by reference. Default 5,000. |
| | `height` | `number` | Chart body height, in pixels. Default the `--xh-chat-chart-height` variable. |
| | `byReference` | `boolean` | Take an artifact and a chart view, not series. Default false. |
| `chatUiMetricsSpec` | `maxItems` | `number` | Most tiles. Default 4. |
| `chatUiCardSpec` | `maxFields` | `number` | Most fields. Default 16. |
| | `maxActions` | `number` | Most actions. Default 4. |
| | `actionTypes` | `ChatUiActionType[]` | Kinds of action the model may put on the card. Default `['send']`. |

### App-wide defaults

Set these once at startup, in the app's `AppModel` or `Bootstrap.ts`, as for Hoist's own
component defaults:

```typescript
ChatUiGrid.defaults.exportConfirmAbove = 50_000;
```

| Default | Value | Description |
|---------|-------|-------------|
| `ChatUiGrid.defaults.previewRows` | 8 | Most rows the preview shows |
| `ChatUiGrid.defaults.previewColumns` | 6 | Most columns the preview shows |
| `ChatUiGrid.defaults.pageSize` | 1,000 | Rows per page of the full grid, and the first page of a table by reference. Read as each table renders. |
| `ChatUiGrid.defaults.exportConfirmAbove` | 10,000 | Rows above which an export asks first |
| `ChatUiChart.defaults.maxInlineSeries` | 5 | Most series an inline chart draws |
| `ChatUiChart.defaults.maxInlinePoints` | 500 | Most points per series an inline chart draws, sampled evenly |

### Component props

| Component | Props from the model | Other props |
|-----------|----------------------|-------------|
| `ChatUiGrid` | `title`, `columns`, `rows`, `sortBy` | `isPartial`, `dataHandle`, `registry`, `view` |
| `ChatUiChart` | `title`, `type`, `xAxis`, `yAxis`, `series` | `isPartial`, `height`, `dataHandle`, `registry`, `view` |
| `ChatUiTableView` | - | `request`, `tbarItems`, `panelProps` |
| `ChatUiChartView` | - | `request`, `tbarItems`, `panelProps` |
| `ChatUiMetrics` | `metrics` | `isPartial` |
| `ChatUiCard` | `title`, `subtitle`, `fields`, `actions` | `chatModel`, `runActionAsync`, `isPartial` |

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
- **Show the full tier elsewhere** - `ChatUiTableView` and `ChatUiChartView` take a table or
  chart request. Mount one in your own layout, or publish your own `ChatSidePanelModel`.
- **Match the look** - `chatUiFrame` draws the bordered surface, header strip and footer of the
  built-in components, and `chatUiSkeleton` their placeholder. `fmtChatUiNumber` formats a number with a
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
take in. For larger results, use a table by reference.

### Expecting a sort over a page

A view applies only to the rows at hand. For a table by reference, those are the first
`pageSize` rows. Over a larger artifact, its sort and filter work on that page, and the footer
does not claim a total it cannot know. A sort adds "sorted within the first 1,000" to the
footer, and the full grid stays on offer. Have the tool sort and filter on the server, or raise
`ChatUiGrid.defaults.pageSize`.

## Related Packages

- [`/genui/`](../../../genui/README.md) - `ChatUiCatalog`, `ChatUiComponentSpec`, and protocol
  adapters
- [`/desktop/cmp/chat/`](../chat/README.md) - the chat components that display tool calls,
  including inline generative UI, and `ChatSidePanel`, which shows the full tier
- [`/core/`](../../../core/README.md) - `ChatModel` and `ChatToolSpec`
- [Protocols](../../../docs/protocols.md) - how generative UI protocols relate to the kit
- hoist-react `/cmp/grid/` - `GridModel`, columns, and renderers
- hoist-react `/cmp/chart/` - `ChartModel`, and installing Highcharts
- hoist-react `/format/` - the number and date formatters
