# Step 11: Widget Catalog Proposal

A proposal for John, revised with his decisions (decision 127) and `blueprints-hr`'s second review.
Nothing here exists yet. hr checked every wrapped component in hoist-react 91, and each exists.

Two rules bind every widget (decision 126). State a user can change is config at a declared preset
path, and stays transient in run mode. A widget keeps no private state.

## Containers and Layout

Containers have chrome and a default layout. Layout has neither: it only arranges children.

### Layout

| Widget | Wraps | Main config | Children |
|--------|-------|-------------|----------|
| `box` | `box`, `hbox`, `vbox`, `frame` (`cmp/layout`) | `direction` (`row` or `column`), `fill` (a frame, which flexes to fill, or a box), `gap`, `align` | any; each reference takes `flex`, or a `width` or `height` |
| `separator` | `separator` (`cmp/layout`), or `toolbarSep` (`desktop/cmp/toolbar`) | `label`, in a box only | none |
| `spacer` | `spacer` or `filler` (`cmp/layout`) | `size`, or none to fill | none |

`separator` and `spacer` render by their parent. In a `toolbar`, a separator is a `toolbarSep`. In
a row `box` it is a vertical `Separator`, and in a column `box` a horizontal one. A `spacer` takes
its parent's main axis the same way. The format holds one `separator` and one `spacer`. Only the
renderer reads the parent.

### Containers

| Widget | Wraps | Main config | Accepts | Preset paths |
|--------|-------|-------------|---------|--------------|
| `panel` | `panel` (`desktop/cmp/panel`) with a `PanelModel` | `title`, `icon`, `style` (`plain` or `card`), `collapsible`, `compactHeader` | any, laid out as a vertical frame; a `toolbar` in its `tbar` or `bbar` slot | `/collapsed` |
| `tabContainer` | as now | as now | any, one per tab | as now |
| `dashCanvas` | as now | as now | any, placed on its grid | as now |
| `dashContainer` | `DashContainer` (`desktop/cmp/dash`) | `layout`: GoldenLayout's tabs and stacks | any | `/layout` |
| `tileFrame` | `tileFrame` (`cmp/layout`) | `minTileWidth`, `maxTileWidth`, `minTileHeight`, `maxTileHeight`, `desiredRatio`, `spacing` | `content` and `data` widgets that make sense as tiles; never a layout or container | none |
| `toolbar` | `toolbar` (`desktop/cmp/toolbar`) | `vertical` | `input` widgets, `separator` and `spacer` only | none |

- **`panel` takes Hoist's card as a style.** `style: 'card'` draws a `card` (`cmp/card`) in place
  of the panel's chrome: a bordered group with a title. One widget covers a titled group.
- **A container may hold a `box`.** For example, a `panel` holds a row `box` of two grids with a
  `separator` between them.
- **No container persists its own state.** `panel` and `dashContainer` give their models no
  `persistWith`. They drive collapsed state and layout from config, and write each change back as
  a transient change.
- **`dashContainer` is the most work of these.** Its views are registered view specs with state of
  their own, so each child element must render as a Dash view. It belongs after the first batch. Its
  `/layout` is GoldenLayout's own state, which the validator cannot check, so it takes a size cap.
- **`dockContainer`: not proposed.** It docks collapsible views at the bottom of an app, as for
  chat windows. That is app chrome, not report layout. Revisit if a demo asks for it.

### Format changes for containers

- **`children.accepts` takes categories and widgets as separate lists:** `{categories: [...],
  widgets: [...]}`. A category is one of `container`, `layout`, `content`, `data`, `input` and
  `action`. Every widget's spec gives its `category` now: `box` adds `layout`, and `markdown` adds
  `content`. Separate lists need no reserved names, so adding a category later cannot collide with
  an app's widget.
- **`emptyText` on each container**, shown while it has no children, in place of a `placeholder`
  widget. The reserved `placeholder` and `fallback` widgets, which `degradeAnswer()` places in a
  chat answer, stay as they are: they stand in for broken content, not empty containers.

## Content

| Widget | Wraps | Main config |
|--------|-------|-------------|
| `markdown` | `chatMarkdown` (this kit) | `text`; an optional `source` |
| `callout` | `callout` (`cmp/callout`) | `intent`, `title`, `text` as markdown; an optional `source` |

Their text reads variables and source values, such as `P&L for {fund}: {positions.pnlDay}`.

- `{name}` is a variable's value, formatted by its type.
- `{source.field}` is the field's aggregate over the source's rows, by the field's aggregator,
  formatted by the field's format. The rows are those the source's filter leaves.
- `{{` and `}}` write literal braces.

The validator checks each reference: a known variable, or a known source and field. The widget
reads the aggregate from the root of a View over the source, as `statCard` does. This pulls
forward plan step 19, and extends it to source values. A template may name any source of the
blueprint. The optional `source` key names a default, so `{pnlDay}` can stand for
`{positions.pnlDay}`.

- **Every substituted value goes in as text, after the markdown is parsed,** variables included.
  Otherwise a data string such as `[Log in](https://evil.example)` would become a link in the
  report. Escaping is not enough: GFM links a bare URL with the escapes in it.
- **A template reads root aggregates only,** and shows a placeholder until each source it names
  has loaded. `WidgetSpec.demand()` returns a demand per source (decision 130, built in a362e59),
  so a template's demand names every source it reads. A template never joins sources.

## Data

| Widget | Wraps | Main config | Outputs | Preset paths |
|--------|-------|-------------|---------|--------------|
| `statCard` | `statCard` (`cmp/statcard`) | `source`, `field`, `agg`, `label`, `format`, `deltaField`, `intent`, `trend` | none | none |
| `treemap` | `treeMap` with a `TreeMapModel` (`cmp/treemap`) | `source`, `groupBy` (dimensions), `value` (measure), `heat` (measure), `colorMode`, `maxDepth` | `selection`, a filter of the node clicked | `/groupBy`, `/colorMode` |
| `heatmap` | `chart` (Highcharts `heatmap`) | `source`, `x` and `y` (dimensions), `value` (measure) | `selection`, a filter of the cell clicked | none |
| `propertyTable` | `propertyTable` (`cmp/propertytable`) | `source`, `fields` (a field list with label and format), `filter`, `columns`, `labelSide` | none | none |
| `progress` renderer | `progressBar` (`cmp/progressbar`) | `max`, or a `maxField`; `target`, or a `targetField` | n/a | n/a |
| `sparkline` renderer | `sparkline` (`cmp/sparkline`) | `type` (`line`, `area` or `bar`), `colorBy` | n/a | n/a |

- **`statCard` replaces `statCardStrip`.** One card reads one field of one source, and a
  `tileFrame` or a `box` lays cards out. Chat kit's stat cards translate into a `tileFrame` of
  `statCard`s. P2, P3, the answer translations and their specs change with it. Nothing has been
  released, so this needs no migration.
- **`heatmap` is its own widget,** as decided, so `y` keeps one meaning in `chart`.
- **`propertyTable` shows the aggregate of the rows its filter leaves:** the root of a View with
  that filter. One row shows its own values, and many rows show their totals.
- **`limitBars` is dropped.**

### Sparklines

- **A catalog field type `number[]`,** such as a fund's daily returns, oldest first. It never
  rolls up: a group row shows it blank. Its `kind` says what each point means, such as `pnl`, so
  the points format as the kind's values do.
- **A `sparkline` grid renderer** over Hoist's `Sparkline`. It scales every row of a column to the
  same `min` and `max`, so the rows compare, as Hoist's README requires. It has no sort or export
  value, so the column turns both off.
- **A `trend` on `statCard`,** naming a `number[]` field to draw as a sparkline under the figure.
  It fills the need for a small standalone sparkline, without a widget of its own.
- **Sample series from `blueprints-data`**, in the fake provider and in Toolbox's data.

## Charts

The `chart` widget keeps building its series from a source, and adds an escape hatch:

- **`highchartsConfig`,** a Highcharts options object merged over the generated config. I propose
  this name rather than `highcharts`, because hoist-react's `ChartModel` and the Chart V2 brief
  both use it.
- **Its top-level keys come from an allowlist:** `title`, `subtitle`, `legend`, `tooltip`,
  `xAxis`, `yAxis`, `plotOptions` and `chart`. A blueprint is JSON, so it holds no functions. The
  paths left are strings and references into the page, so the validator also refuses:
    - `chart.renderTo`, at any depth, which would render the chart into another element of the
      page;
    - any string that contains `<`, at any depth. Highcharts sanitizes text, but its sanitizer
      still allows links and inline styles in titles, labels and the `format` templates. Templates
      such as `{point.y}` stay valid. This follows chat kit's D128;
    - `useHTML`, `events`, `series` and `data`;
    - `categories` on any axis, and `keys` under `plotOptions`, which relabel or remap the
      generated data. What a chart draws stays its source's data;
    - an object past a size and depth cap.
- **A `selection` output,** a filter of the point clicked: its `x`, and its `groupBy` value.
- **More types:** `spline` and `areaspline` (enum values), a second y-axis (`y2`), and `waterfall`,
  for P&L attribution. Hoist loads no Highcharts modules, and the app does. Toolbox loads
  `heatmap`, `treemap` and `highcharts-more`, so the treemap, heatmap and waterfall all work
  there. A registry entry names the modules it needs, and a widget whose modules are missing
  draws a fallback element.

### Aligning with Chart V2

Anselm's Chart V2 brief (hoist-react `origin/chart-spike`) proposes `TimeSeriesChartModel` and the
portable pattern. The blueprint `chart` should move onto it later. Findings 09 and 11 overlap with
our work in seven places:

| Chart V2 | Blueprints today | Align |
|----------|------------------|-------|
| A definition and a state overlay, each model method writing one layer (09, section 4) | Config, and presets and transient changes over it | The same idea. When `chart` moves, its config is the portable spec, and its preset paths are V2's state keys. |
| Source and type on the widget, not the spec (09, section 7) | `source` in the config, `component` on the element | Equivalent. Keep `source` in config, and read it into the widget's source when the chart moves. |
| `splitBy`, which partitions and never aggregates | `chart.groupBy`, which splits the first `y` into series | The same meaning. Adopt V2's name when the chart moves, and accept `groupBy` as an alias. |
| `NamedRef` (`{id, args}`), bare built-in names, dotted app names, and a `NamedRegistry<T>` in core (09, section 8) | Formats as a name, options, or `{name, ...changes}`; renderers, resolvers and actions by plain name | Dotted app names are built (decision 130). `{id, args}` is the gap left. When `NamedRegistry` lands, our registries should sit on it, and blueprints should write `{id, args}`. That waits for John and Anselm. See the last section. |
| `highchartsConfig` on the spec and each series, hidden from the agent profile | The proposed `highchartsConfig`, open to the Architect within an allowlist | The same key, so it carries over. The Architect sees it only through the allowlist. |
| A data source registry and `describe_data_source` (11, section 3.1) | `DataCatalog` and `describe_catalog` | Raise with Anselm: V2's discovery should read the `DataCatalog`, not a second registry. |
| `range` as a `DateRangeSelection`, reused rather than a second vocabulary (09, section 9) | The proposed `dateRange` variable type | The same type, so a chart range binds a `dateRange` variable directly. |

## Inputs

Each input writes the variable whose `setBy` names it, and shows that variable's value. It holds no
value of its own. Its `category` is `input`, so a `toolbar` accepts it.

| Widget | Wraps (`desktop/cmp/input`) | Main config | Value |
|--------|-----------------------------|-------------|-------|
| `select` | `select` | `label`, `placeholder`, `multiple`; options from the variable's `options` list | `string`, or `string[]` |
| `dateInput` | `dateInput` | `label` | `localDate` |
| `dateRangePicker` | `dateRangePicker` (`desktop/cmp/daterange`) | `label`, `presets` | `dateRange` |
| `numberInput` | `numberInput` | `label`, `min`, `max`, `precision` | `number` |
| `textInput` | `textInput` | `label`, `placeholder` | `string` |
| `switchInput` | `switchInput` | `label` | `bool` |
| `slider` | `slider`, committing on release | `label`, `min`, `max`, `step` | `number` |
| `filterChooser` | `filterChooser` (`desktop/cmp/filter`) | `source`; `fields`, to limit them | `filter` |

- `select` ships with option lists. A dataset field's values need a `BlueprintDataProvider`
  request that does not exist yet.
- `filterChooser` has no `persistWith` and no favorites. It offers values of dimensions only, as a
  snapshot capped at 1,000.
- `dateRangePicker`'s `DateRangePickerModel` has no `persistWith`. Its whole value, the preset
  included, lives in the variable.

## Time

### A `dateRange` variable type

- **Its value is Hoist's `DateRangeSelection`** (`cmp/daterange`): a preset such as MTD, a
  relative lookback, a month, quarter or year, or a custom range. It is plain JSON, and Hoist's
  `parseDateRangeSelection()` checks it.
- **`rangeStart(range, asOf)` and `rangeEnd(range, asOf)` resolvers** give its two `localDate`s,
  through Hoist's `resolveDateRange()`. A source's `start` and `end` params bind them.
- **`resolveDateRange()` needs a whole `DateRangeContext`:** `today`, `maxDate`, `isBusinessDay`
  and the presets, not only `asOf`. hr proposes a small `dateRangeContext({anchorDate, ...})`
  builder in hoist-react for it.
- **A preset names a token from the app's presets.** A blueprint that names an app-specific token
  fails `parseDateRangeSelection()` in another app. The validator checks each token against the
  presets the app registers, and blueprints may always use Hoist's built-in presets.

### A `period` variable type

- **A count and a unit:** `D`, `W`, `M`, `Q` or `Y`, such as `3M`.
- **A lookback by default.** `+` makes it forward, such as `+3M` for a projection.
- **Business days by default,** with `calendar: 'business' | 'calendar'` on the variable type, or
  on a param that takes a period. Business days are weekdays for now. Holiday calendars come
  later, through the `isBusinessDay` that Hoist's `DateRangeContext` already takes.
- **A period shifts a date.** `periodStart(asOf, period)` is the date one period back: 3M before
  a return's `asOf` is the prior close it starts from. `periodEnd(asOf, period)` is the date one
  period forward, for a `+` period.
- **It lands on a business day in the period's direction.** 1M back from a Monday lands at or
  before that date. In business mode, `D` counts business days.
- **A dataset param type** too, for rolling windows such as a 3M volatility.

A period is not a `RelativeDateRangeSelection`. A relative selection is a rolling window that ends
on its anchor, so its first day is one day after the date a period gives. It counts calendar days,
and it only looks back. hr proposes new helpers in hoist-react's `cmp/daterange`, beside
`DateRangeUtils`, so Chart V2 and apps share them:

- `parsePeriod('3M' | '+3M')`, returning `{count, unit, forward}`, with `DateRangeUnit`'s units;
- `shiftByPeriod(date, period, {isBusinessDay, calendar})`, which counts business days for `D`,
  and lands other units with `businessDayOnOrBefore()` going back, or a new
  `businessDayOnOrAfter()` going forward.

A lookback period still converts to a `RelativeDateRangeSelection`, for the picker's display only.
These are new public hoist-react APIs, so they go to John before hr builds them.

## Chat Kit's Components on Dashboards

| Chat component | Becomes |
|----------------|---------|
| `callout` | `callout` |
| `text` | `markdown` |
| `card`, `section` | `panel`, with `style: 'card'` |
| `stack` | `box` |
| `statCards` | a `tileFrame` of `statCard`s |
| `treemap` | `treemap` |
| `select`, `dateInput`, `numberInput`, `textInput`, `switch`, `segmentedControl`, outside a `form` | the inputs |

The dashboard widget is the definition, and `toAnswerBlueprint()` translates the chat
component's props into its config, as it does for stat cards and grids now. The registry already
names a same-named chat component's bridge `chatUi<Name>`, so none of Anselm's components change.
An answer then holds real widgets, and "Add to dashboard" carries them as they are.

An input inside a `form` stays on its bridge. Under chat kit's D129, it registers its field with
the form's `FormModel`, and the form sends the values.

Keep these answer-only: `form`, `button`, `tableView` and `badges`.

## Recommended Order

The first batch, in order:

1. **`box`, `separator`, `spacer`, `panel`, `emptyText` and category `accepts`.** Every later
   widget is placed through these, and the Architect writes a report top to bottom with them.
2. **`markdown` and `callout`, with templates.** A blueprint reads as a report with live figures
   in its text, which is the most visible step for the demo.
3. **`statCard` and `tileFrame`,** replacing `statCardStrip`. It changes P2, P3 and the answer
   translations, so it goes before anything builds on them.
4. **`toolbar` and the inputs:** `select` (lists), `dateInput`, `filterChooser`, then
   `numberInput`, `textInput`, `switchInput` and `slider` on the same base.
5. **Time:** the `dateRange` and `period` types, `dateRangePicker`, and the resolvers. hr's
   hoist-react work for periods can start alongside step 1.
6. **`treemap`, the chart's `selection` output, and `highchartsConfig`.**

Then the join layer (decision 132), on hr's `KeyedAggregator`, `LastAggregator` and
`FirstAggregator`. It covers the catalog `key`, `joins` on sources and their three modes, routing,
and pushdown up to 2,000 keys. It also covers the `join.*` validation codes, the Architect
guidance and a Joins section in the sources editor. Joins go one level deep, and none collects a
time series.

After that, in order: sparklines (`number[]`, the renderer and `statCard`'s `trend`, once
`blueprints-data` supplies series); `heatmap`; `propertyTable`; `dashContainer`; the `progress`
renderer and the other chart types; and `select` over a dataset field, once John decides the
provider request.

## Format Changes to Decide

1. `children.accepts` as `{categories, widgets}`, and `emptyText` on containers.
2. `statCardStrip` removed for `statCard` and `tileFrame`.
3. Templates in `markdown` and `callout`, with `{variable}` and `{source.field}`. Decision 130
   settled `WidgetSpec.demand()` returning a demand per source.
4. `highchartsConfig` on `chart`, with its allowlist and refusals.
5. `number[]` fields, with `kind` for their points, and the `sparkline` renderer.
6. The `dateRange` and `period` variable types, `calendar`, and their resolvers, with hr's new
   hoist-react helpers: `parsePeriod()`, `shiftByPeriod()`, `businessDayOnOrAfter()` and
   `dateRangeContext()`.
7. `heatmap` as its own widget.
8. A registry field for the Highcharts modules a widget needs.
9. **Now, before blueprints are stored:** `{id, args}` refs for formats, renderers, resolvers and
   actions, as Chart V2 proposes. Steps 10 and 11 make blueprints stored documents. Changing the
   shape later means migrating every stored blueprint. `NamedRegistry<T>` in core is hoist-react
   API. This waits for John and Anselm. Decision 130 settled dotted names for app entries, built
   in 37adb1c.
