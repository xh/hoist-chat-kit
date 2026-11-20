# Scenarios: Hoist Blueprints

> **Draft.** Each scenario describes a blueprint from the user's side: who asks, what they ask,
> what they see and do, and what the scenario tests in [`spec.md`](./spec.md). The next step
> writes the Data Catalog for each domain and the blueprint JSON for each scenario.

The scenarios run from simple to complex. P1 to P5 and W1 to W3b test the core format. P6 to
P11 and W4 test step 11's widgets and the joins. Three more wait until the rest work: see
[Follow-up](#follow-up).
The portfolio scenarios run against an extended position dataset, closer to what client apps
hold. Its Data Catalog is also the starting point for extending Toolbox's position generator.
The weather scenarios are simpler than client data, and show that the system works outside
finance.

## Data

### Portfolio

| Dataset | Parameters | Holds |
|---|---|---|
| `positions` | `asOf` (`localDate`) | One row per position. Updates live for the current day |
| `orders` | `asOf` | One row per order. Updates live as orders arrive |
| `hypotheticalPortfolio` | `portfolio`, `asOf` | The position fields, for a hypothetical portfolio |
| `fundSummary` | `asOf`, `fund` | One row per fund: `manager`, `style`, `nav`, `pnlDay`, `pnlMtd`, `pnlYtd`, and the series `pnlHistory`, `cumPnlHistory` and `drawdownHistory`. Keyed by `fund`, so positions can join it |
| `prices` | `symbol`, `start`, `end` | One row per day: `open`, `high`, `low`, `close` and `volume`. Keyed by `symbol` and `day` |

The `positions` dataset extends Toolbox's current data:

| Group | Fields |
|---|---|
| Dimensions | `fund`, `strategy`, `book`, `trader`, `model`. `assetClass` > `instrumentType` (equity, option, future, bond, FX). `sector` > `industry`. `region` > `country`. `ccy`. `symbol` |
| Identifiers | `isin`, `cusip`, `issuer`, and `underlying` for options. Attributes, not dimensions |
| Exposure | `quantity`, `price`, `notional`, `mktVal`, `grossExposure`, `netExposure`, `betaAdjExposure`, `pctNav` |
| P&L | `pnlDay`, `pnlMtd`, `pnlYtd` |
| Greeks | `delta`, `gamma`, `vega`, `theta`, on options only |
| Fixed income | `duration`, `dv01`, `yield`, on bonds only |
| Risk | `beta`, `var95`, `var99` |
| Series | `closeHistory` and `pnlHistory`, recent values as number arrays. `pnlHistory` sums at group rows |
| Parameterized | `return(start, end)`, and `shockedPnl(shock)` for an equity shock as a fraction |

The `orders` dataset carries the position dimensions, so a selection in a positions grid
filters orders. It adds `dir`, `quantity`, `price`, `mktVal`, `commission`, `confidence` and
`time`.

`fund` and `portfolio` are app variable types. A `fund` is a fund code, with an input that
shows each fund's name and AUM. A `portfolio` is a list of tickers and weights.

Some measures do not add up, and test the aggregators:

- `yield`, `duration` and `beta` are averages weighted by market value.
- `var95`, `var99`, `pctNav` and `return` roll up on the server. `shockedPnl` adds up.

### Weather

| Dataset | Parameters | Holds |
|---|---|---|
| `weather` | `city`, `units` | One row per three-hour step for five days: `time`, `temp`, `feelsLike`, `tempMin`, `tempMax`, `humidity`, `pressure`, `windSpeed`, `windGust`, `precipProbability`, `precipVolume` and `conditions` |
| `currentWeather` | `city`, `units` | One row: `temp`, `feelsLike`, `humidity`, `pressure`, `windSpeed`, `windGust` and `conditions` |

## Portfolio

### P1. One grid

**Who.** A portfolio manager in a chat beside an empty blueprint, in design mode.

**Prompt.** "Show me my positions grouped by sector."

**Sees.** One Cube grid over `positions`, grouped by sector, then symbol, with market value and
day P&L. The Architect picks those two columns from more than 40 fields, guided by each
field's `guidance`. Market value shows in millions and P&L as whole dollars, red when
negative, from the kinds in the Data Catalog. Values update live. The PM sorts by P&L. The sort
lasts for the session only.

**Tests.**

- The smallest useful blueprint: one source, one element as the root.
- The Architect chooses fields from a large catalog.
- Formats from kinds, with no format in the blueprint.
- Live updates reach the grid with no reload.
- A sort that is not personalizable stays transient.

### P2. A linked dashboard

**Who.** The same PM, in design mode.

**Prompt.** "Build me a P&L dashboard. Put headline numbers across the top, positions by
strategy and trader below, and a chart of P&L by sector that follows whatever I select in the
grid. Under the positions, show the orders for whatever I select."

**Sees.** A canvas with four parts:

- A row of stat cards: gross exposure, net exposure, day P&L and the number of positions. Each
  card is a widget over `positions`, so its number is computed, not written by the LLM.
- A Cube grid grouped by strategy, then trader.
- A column chart of day P&L by sector. Selecting "Merger Arb > Freda Klecko" in the grid
  filters the chart to that strategy and trader. Clearing the selection shows everything.
- A flat grid of orders under the positions, filtered by the same selection. New orders appear
  as they arrive. Each order's direction shows as a colored badge.

**Tests.**

- Three widgets share the `positions` source and one request.
- A second dataset, `orders`, in a flat `cubeGrid`.
- A grid output sets a `filter` variable, and the chart and the orders grid both bind it. A null
  selection means no filter.
- Live updates on two sources.
- A renderer that draws a badge.
- Computed values are widgets over a source, never inline values.
- Canvas placement through child references.

### P3. A morning report with controls

**Who.** A designer building a report for PMs to run each morning.

**Prompts.** A conversation of several steps:

1. "Build a morning report. Let the user pick a fund and an as-of date at the top. Default the
   fund to their own and the date to the previous business day."
2. "Add tabs for Overview, Positions and Orders."
3. "On Overview, show stat cards, day P&L by sector and day P&L by region."
4. "On Positions, show the position grid. Let users group it by any of fund, strategy, trader,
   sector or region. Give them a P&L view and a Risk view of the columns."
5. "Add buttons to show winners only, losers only, or everything."
6. "When a user selects a symbol, show its price history for the last three months beside the
   grid."
7. "On Orders, show the orders for whatever is selected on the Positions tab."
8. "Show every market value in full dollars, show all Greeks in thousands, and add YTD return
   to the Risk view."
9. "Add a button that publishes this report to the PM pack."

**Sees.** In run mode:

- A fund prompt and an as-of prompt in the blueprint's toolbar. The fund prompt is the `fund`
  type's own input, which shows each fund's name and AUM, and defaults through the app's
  `userFund` resolver. The date always starts at the previous business day.
- A tab container with three canvases.
- On Positions, a grouping chooser bound to a grouping variable, and a preset switch between
  "P&L view" and "Risk view". The P&L view shows market value and day, MTD and YTD P&L. The
  Risk view shows exposures, beta, VaR, and % of NAV drawn as a bar. Three buttons set a P&L
  filter. Beside the Cube
  grid, a price chart reloads when the selected symbol changes.
- On Orders, a grid of orders filtered by the selection on the Positions tab.
- A "Publish to PM pack" button, which asks the user to confirm before it runs.
- After prompt 8, one edit has redefined the `mv` and `greek` named formats for this blueprint,
  added a `retYtd` instance of `return` to the source, and added it to the Risk view. Every
  market value and Greek changes, and the designer can undo it all in one step.

**Tests.**

- An app variable type, `fund`, with its own input in the toolbar.
- Prompted variables with resolver defaults: the app's `userFund` and the built-in
  `previousBusinessDay`.
- A variable bound to the parameters of three datasets.
- A grouping variable set by a widget and bound to `groupBy`.
- Presets that control column state.
- Action buttons that set a `filter` variable whose `setBy` is `"action"`.
- An output of type `string`, the selected symbol, bound to a source parameter, so the price
  chart reloads. Its date range comes from resolvers over the as-of date.
- One filter variable applied to two datasets that share field names.
- A renderer that draws a bar.
- An app action type with `sideEffects: true`, which always asks to confirm.
- Nested layout: canvases inside a tab container.
- A build over several prompts, each one checked edit.
- An edit with several operations, applied and undone as one: named formats redefined for every
  field of a kind, a parameterized field added as a source instance, and a preset's values
  changed.

### P4. A chat answer added to a dashboard

**Who.** A PM running the P2 dashboard, with a chat beside it. The PM has write access.

**Prompts.**

1. "Which traders lost the most in Technology today?"
2. "Add that chart to my dashboard."

**Sees.**

1. The Architect reads the dashboard's context and calls `query_dataset` on `positions` with a
   Technology filter. It answers with text and one segment: a bar chart of day P&L by trader.
   The answer is fixed.
2. The Architect asks to switch to design mode, then adds a chart to the dashboard. The
   artifact becomes the dashboard's existing `positions` source, the Technology filter becomes
   the chart's widget filter, and the chart takes a place on the canvas. It now updates live.

**Tests.**

- One answer segment, rendered in the reply.
- Context from the host blueprint reaches the Architect.
- Adding a segment to a host: an artifact becomes a dataset source, the host's source is
  reused, and the widget gets a child reference.
- An authored change asks for design mode.

### P5. A risk and stress report

**Who.** A risk manager, building with the Architect in design mode.

**Prompt.** "Build a risk report by fund and strategy. Show VaR at 95 and 99, beta-adjusted
exposure, and P&L under equity shocks of minus 10, minus 5, plus 5 and plus 10 percent. Add a
tab for options with their Greeks by underlying, and a tab for bonds with duration, DV01 and
yield by issuer. Then add a tab where I can build a hypothetical portfolio from tickers and
weights, and run the same stress on it."

**Sees.** An as-of prompt, and a tab container with four tabs:

- **Risk.** A Cube grid grouped by fund, then strategy, with VaR, beta-adjusted exposure and
  four shocked P&L columns. A column chart of shocked P&L by fund.
- **Options.** A Cube grid of options only, grouped by underlying, with delta, gamma, vega and
  theta in thousands.
- **Bonds.** A Cube grid of bonds only, grouped by issuer, with duration and yield as averages
  weighted by market value, and DV01 summed.
- **Hypothetical.** A portfolio builder, where the user adds tickers and weights. Beside it, a
  Cube grid over the `hypotheticalPortfolio` dataset shows VaR and the four shocked P&L columns for that
  portfolio. It reloads as the portfolio changes.

**Tests.**

- One parameterized field used four times, as source instances with different shocks.
- The `"server"` aggregator: VaR rolls up on the server at each grouping level.
- Weighted averages through the `weightedAverage` aggregator.
- Widget filters that restrict a grid to one instrument type.
- Null values: Greeks are empty on equities and bonds, and duration on everything but bonds.
- Fields from nested categories, such as Risk > Greeks.
- An app widget, `portfolioBuilder`, sets an app-type variable, `portfolio`, that a source binds.
- Two datasets with the same fields, `positions` and `hypotheticalPortfolio`, used by sources side by side.

### P6. A fund overview from one request

**Who.** A PM, in design mode, on an empty blueprint. This is the "whole dashboard from one
request" scenario.

**Prompt.** "Build me a fund overview. Headline NAV and today's, MTD and YTD P&L, each with its
trend. Positions by sector and symbol, with a sparkline of each one's recent closes. And where
today's P&L sits by sector and strategy."

**Sees.**

- Fund and as-of prompts in the blueprint's toolbar.
- A row of four stat cards over `fundSummary`, each with a trend line under its figure.
- A grid of positions grouped by sector, then symbol, with a sparkline column of recent closes.
- A heatmap of day P&L, with sectors across and strategies down.

**Tests.**

- Two sources whose `asOf` and `fund` parameters bind the same variables.
- A statCard `trend`, a series field drawn as a sparkline, and a heatmap whose axes are
  dimensions.
- The grid and the heatmap share one source.

### P7. Sparklines in a grid

**Who.** The P2 PM, on the P2 dashboard, in design mode.

**Prompt.** "Add a sparkline of each position's P&L history to the positions grid, and show
percent of NAV as a bar."

**Sees.** Two new columns. Group rows draw the summed P&L history on their own scale.

**Tests.**

- An edit to the grid alone, with no new source.
- A series column, and the `progress` renderer on `pctNav`.

### P8. Fund details joined onto positions

**Who.** A PM, in design mode, on an empty blueprint.

**Prompt.** "Show positions grouped by fund manager and style, with each fund's NAV beside its
positions. Only Macro and Credit funds."

**Sees.** A grid of positions grouped by manager, then style, then fund, with a NAV column.
NAV shows on fund rows and at the total.

**Tests.**

- A join on `fundSummary` by `fund`, bringing `manager`, `style` and `nav`.
- Grouping by joined dimensions, and a filter on a joined field.
- Both sources bind `asOf` to the same variable.

### P9. A heatmap that drives a grid

**Who.** A risk manager, in design mode, on an empty blueprint.

**Prompt.** "Show today's P&L by sector and strategy as a heatmap. When I click a cell, list
its positions below."

**Sees.** A heatmap over a grid. Clicking a cell filters the grid to its sector and strategy.
Clearing it shows every position.

**Tests.**

- The heatmap's `selection` output sets a filter variable, and the grid binds it.
- One positions source for both.

### P10. A lookback and a date range

**Who.** The P3 designer, on the P3 report.

**Prompts.**

1. "Add a lookback prompt, default 3M, and show each symbol's return over it."
2. "Let me pick the price chart's dates."

**Sees.**

1. A lookback prompt in the toolbar, and a return column in the positions grid.
2. A date range picker for the price chart, which still waits for a selected symbol.

**Tests.**

- A `period` variable that the user sets, with default `3M`.
- A `return` instance whose `start` is a `periodStart` resolver over the period and `asOf`.
- A column added through the grid's presets, where a preset controls its column state.
- A `dateRange` variable, bound to `prices` through `rangeStart` and `rangeEnd`.

### P11. An answer's cards and note added to a dashboard

**Who.** The P2 PM, with a chat beside the dashboard, in run mode.

**Prompts.**

1. "How is Oak Mount doing today?"
2. "Put those numbers and the note on my dashboard."

**Sees.**

1. An answer with stat cards and a callout over the query result.
2. The Architect asks for design mode, then adds a `fundSummary` source, a row of stat cards
   and the callout to the dashboard. The fund becomes a prompt that defaults to Oak Mount.

**Tests.**

- An answer's stat cards and callout added to a host.
- A literal parameter becomes a host variable (decision 135).
- The callout's text reads `{source.field}`, never a number the model computed.
- Design mode is asked for before any edit.

## Weather

### W1. Weather for one city

**Who.** Any user, in a chat beside an empty blueprint.

**Prompt.** "Show me the weather in London for the next few days."

**Sees.** A city prompt in the toolbar, set to London. Stat cards for the current temperature,
feels-like, humidity and wind. A line chart of temperature and feels-like over the next five
days. Changing the city reloads everything.

**Tests.**

- Two datasets with the same parameters, bound to one variable.
- A literal from the prompt, "London", becomes a variable's default.
- Kinds outside finance: temperature, percent and speed.

### W2. Two cities side by side

**Who.** A designer.

**Prompt.** "Compare New York and London side by side: current conditions, temperature,
precipitation and wind for the next five days. Let users switch between Fahrenheit and Celsius
with a toggle. In a forecast grid, highlight any three-hour step with more than a 60 percent
chance of rain."

**Sees.** Two city prompts, a units toggle, and two matching columns of widgets: stat cards, a
temperature chart, a precipitation chart, a wind chart and a forecast grid. Changing either
city reloads only its own column. The units toggle reloads both.

**Tests.**

- One dataset used by two sources with different parameters.
- A variable that many sources bind, the units.
- A toggle as a widget that sets a variable.
- Conditional styles in a grid, which come in plan step 13. The blueprint for this scenario
  marks them as pending.

### W3. A quick answer with UI

**Who.** A user with a chat open beside the W2 dashboard.

**Prompt.** "Will I need an umbrella in Chicago tomorrow? When is rain most likely?"

**Sees.** A text answer that says whether to take an umbrella, with a chart of the chance of rain
through the day. The headline figures, such as the highest chance of rain, appear in the text
or as stat cards of inline values the LLM computed, which a chat answer allows. The Architect
chooses one segment or several. Chicago is not on the dashboard, so the answer does not change
it.

**Tests.**

- A chart of the chance of rain through the day, over the query result.
- Any stat cards hold inline computed values, allowed in a chat answer only.
- A question that does not touch the host, even with a host open.
- If the user then says "add Chicago to my dashboard", the Architect adds a third city column
  and turns the computed numbers into widgets over a source.
- Several segments in one reply, each its own blueprint, are covered by the library's tests and
  a scripted conversation, not by this scenario.

### W4. One city's day on two axes

**Who.** A weather user, in design mode, on an empty blueprint.

**Prompt.** "London today: temperature and chance of rain on one chart, each on its own axis,
with headline numbers above."

**Sees.** Stat cards over current weather, and a chart of temperature on the left axis and
chance of rain on the right.

**Tests.** A chart's `y2` on a second axis, outside finance.

## Follow-up

These wait until the scenarios above work. The design already has room for each: personalizations
are stored operations at the same paths as other edits, the edit tools enforce access, and
locking concerns where data is kept, not the format.

- **Access.** A PM with read access asks to add a column to the orders grid. The Architect
  explains that the change needs write access, and offers a personal copy. If the column state
  were personalizable, it would add the column as a personalization.
- **Personalizations meet a publish.** A PM saves a different fund, hides a column under one
  preset, and rearranges a canvas. The designer then adds a column, adds a chart and removes
  another, and publishes. This settles Q25.
- **A locked copy.** A PM saves a copy of the morning report as of today's close for a
  committee. Its as-of date is fixed, its prompts are gone, and it shows the data as it was.
  This settles Q15 and Q13.
