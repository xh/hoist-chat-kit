# Step 12: Refining the Architect

> **Draft plan, no runs yet.** New harness scenarios for step 11's widgets and the joins, how
> they score, how the prompt stays small, and what to run.

## New Scenarios

Each scenario follows the shape of [`scenarios.md`](./scenarios.md). P6 is the "whole dashboard
from one request" scenario. P7, P10 and P11 edit a host: P2 or P3, from `blueprints/`.

### P6. A fund overview from one request

**Who.** A PM, in design mode, on an empty blueprint.

**Prompt.** "Build me a fund overview. Headline NAV and today's, MTD and YTD P&L, each with its
trend. Positions by sector and symbol, with a sparkline of each one's recent closes. And where
today's P&L sits by sector and strategy."

**Sees.**

- A toolbar with fund and as-of prompts.
- A tileFrame of four statCards over `fundSummary`, each with a `trend` from `pnlHistory` or
  `cumPnlHistory`.
- A grid of `positions` grouped by sector, then symbol, with a sparkline column over
  `closeHistory`.
- A heatmap of `pnlDay` with x `sector` and y `strategy`, over the grid's source.

**Tests.**

- Two sources whose `asOf` and `fund` params bind the same variables.
- statCard `trend`, a `number[]` sparkline renderer, and a heatmap whose axes are dimensions.
- The grid and the heatmap share one source.
- A layout built from panels, boxes and a tileFrame, with no hand-placed text in place of
  titles.

### P7. Sparklines in a grid

**Who.** The P2 PM, on the P2 dashboard.

**Prompt.** "Add a sparkline of each position's P&L history to the positions grid, and show
percent of NAV as a bar."

**Sees.** Two new columns. Group rows draw the summed history on their own scale.

**Tests.**

- One edit to the grid's `columns`, with no new source.
- The `sparkline` renderer on `pnlHistory`, and `progress` on `pctNav`.

### P8. Fund details joined onto positions

**Who.** A PM, in design mode, on an empty blueprint.

**Prompt.** "Show positions grouped by fund manager and style, with each fund's NAV beside its
positions. Only Macro and Credit funds."

**Sees.** A grid of `positions` grouped by manager, then style, then fund, with a NAV column.

**Tests.**

- A join on `fundSummary` by `fund`, with `manager`, `style` and `nav`.
- Grouping by joined dimensions.
- A source filter on a joined field, `style`.
- Both sources bind `asOf` and `fund` to the same variables.

### P9. A heatmap that drives a grid

**Who.** A risk manager, in design mode, on an empty blueprint.

**Prompt.** "Show today's P&L by sector and strategy as a heatmap. When I click a cell, list
its positions below."

**Sees.** A heatmap over a grid. Clicking a cell filters the grid, and clearing it shows every
position.

**Tests.**

- The heatmap's `selection` output sets a filter variable, and the grid binds it.
- A null selection means no filter.

### P10. A lookback and a date range

**Who.** The P3 designer, on the P3 report.

**Prompts.**

1. "Add a lookback prompt, default 3M, and show each symbol's return over it."
2. "Under the grid, chart the selected symbol's closes. Let me pick the chart's dates."

**Sees.**

1. A lookback prompt in the toolbar, and a return column whose header names the period.
2. A chart of `prices` with its own date range picker. It asks for a symbol until one is
   selected.

**Tests.**

- A `period` variable, set by a prompt, with default `3M`.
- A `return` instance whose `start` binds `periodStart` over the period and `asOf`.
- A `dateRange` variable set by a `dateRangePicker`, bound to `prices` through `rangeStart` and
  `rangeEnd`.
- A `symbol` param bound to the grid's selection, which waits while it is empty (decision 140).

### P11. An answer's cards and note added to a dashboard

**Who.** The P2 PM, with a chat beside the dashboard.

**Prompts.**

1. "How is the Macro fund doing today?"
2. "Put those numbers and the note on my dashboard."

**Sees.**

1. An answer with stat cards and a callout.
2. A tileFrame of statCards and a callout on the dashboard, over the host's sources. The fund
   becomes a host variable.

**Tests.**

- The answer's `statCards` and `callout` translate to `tileFrame`, `statCard` and `callout`.
- A literal param becomes a host variable (decision 135).
- The callout's text reads `{source.field}`, never a number the model computed.
- Design mode is asked for before any edit.

### W4. One city's day on two axes

**Who.** A weather user, in design mode, on an empty blueprint.

**Prompt.** "London today: temperature as a line and chance of rain as columns on one chart,
with headline numbers above."

**Sees.** A tileFrame of statCards over current weather, and a chart with `y2` on a second axis.

**Tests.** A chart with `y2` and its own chart type, outside finance.

## Scoring

Scoring stays as it is now. Each scenario has hand-written checks in `scenarios.ts`, one per
test above. Each run also reports final validator errors, edits applied, and model calls. The
harness gains a count of `describe_registry` calls per run, to see whether the index sends the
model to the full specs.

Each scenario's host blueprint loads from `blueprints/`, as P4 and W3b do now. A check reads the
final blueprint. It never compares it against one expected blueprint, because several layouts
are correct.

## Keeping the Prompt Small

The prompt and tools measure 13,044 tokens (`pnpm test --dry`). The widget index is 7,008 of the
prompt's 21,798 characters. It grows with each widget's `guidance`. statCard's guidance alone is
about 590 characters.

**Proposal.**

1. Give each widget spec a short `summary`, one line of at most 15 words.
2. Group the index by `category`, one line per widget: name, label and summary. For example,
   "Data: cubeGrid (grid of rows, grouped or flat), chart, heatmap...".
3. Serve `guidance` only through `describe_registry` with names. It already returns it.
4. Move the widget rules in the prompt's format section, such as `highchartsConfig`, templates
   and date ranges, into each widget's guidance. Keep only the cross-widget rules in the prompt.
5. Let `describe_registry` take a `category`, so the model can read a whole category in one call.

**Decision for John.** Item 1 adds a field to `WidgetSpec`, which apps fill for their own
widgets. The alternative is to cut `guidance` to its first sentence in the index. That needs no
new field, but it ties the index to how each guidance starts.

**How to check it.** Run the full set with both index forms. Keep the compact index if every
check holds, and watch `describe_registry` calls rise in its place.

## Runs

A full round of the eight current scenarios on both models at medium effort cost $1.69:
Opus $1.25 and Sonnet $0.44 (run of Nov 18, 23:40). The single-request scenarios cost $0.05 to
$0.10 on Opus and $0.02 to $0.06 on Sonnet. P3's multi-step edit cost $0.40 on Opus and $0.18
on Sonnet.

**Plan.**

1. The new scenarios, three times each on both models, at medium effort. Results vary between
   runs: Sonnet missed W3's chart in both of its last two runs, and Opus failed three of W3b's
   five checks once.
2. Fix what fails in the prompt or the validator, as `guidance.md` records.
3. One full round of every scenario, as a regression check.
4. The index A/B, as above.

**What would change the default model.** Sonnet is the default (decision 65). Propose Opus as
the default if Sonnet fails a check on P6, P8 or P10 in two of three runs where Opus passes.
Those scenarios need the most planning. A single miss is variance, as decision 87 treated W1.

## Latency and Cost Levers

Measured in the Nov 18 round:

- Output tokens are 25 to 67 percent of each run's cost. Cache reads are already 59 to 96 percent
  of input tokens.
- Opus wrote 9,874 output tokens on P5 to Sonnet's 2,361, and took 72 seconds to Sonnet's 14.
- P3 took 25 and 28 calls, with 8 and 9 of them `describe_registry`.

Levers to try, each as its own run:

1. **Low effort on Sonnet.** The harness has `--effort`. Output dominates cost and time, so this
   is the first to try.
2. **The compact index.** A smaller prompt cuts each first call's cache write.
3. **Fewer describe calls.** Tell the model to describe every widget it plans in one call, by
   names or by category.
4. **Fewer edit calls.** Tell the model to make a multi-part change as one `edit_blueprint`
   call, where the parts do not depend on what an earlier part returned.
5. **Haiku 5.5 for answers.** A third model for answer-only scenarios, such as W3, which need no
   planning. This needs Haiku's prices in the harness.
