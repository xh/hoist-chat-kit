# Step 15: The Demo

> **Draft plan, no code.** Two Toolbox apps on the foundation, gating for the Claude API, the
> library's docs, and two skills. Items marked **John** need his decision before they are built.

## The Two Apps

Both apps share one shell: a library of the app's blueprints, the `BlueprintView`, the Architect
beside it, chat answers, Share, Copy link and the `/:id` route. Toolbox's Blueprints tab already
has every piece (`BlueprintsPanelModel`, decision 152's route). tb extracts it into a shell inside
Toolbox, which the tab and both apps use. It stays in Toolbox until a third user appears (YAGNI).

**John - D15-1:** add the apps beside the current Portfolio and Weather examples, as Weather V2 sat
beside V1, or replace them. I recommend beside: the hand-built apps are the before picture.

### Weather

It starts from Weather V2 (Toolbox PR #855, branch `weatherv2`, closed May 21 and since deleted,
head `4042d27`). V2 proved "the dashboard is a JSON spec an LLM writes". The foundation now covers
everything V2 did:

| V2 | On the foundation | State |
|---|---|---|
| City Chooser publishing `selectedCity` | A `select` prompt on a `city` variable, bound to each source's `city` param | Exists (s5, W1, W2) |
| Units Toggle | A `units` variable with options, bound to the `units` param | Exists |
| Forecast, precip and wind charts | `chart` with `y2`, spline and areaspline (step 11) | Exists |
| Summary grid, 5 days | `cubeGrid` over `weather` grouped by `day`, with `tempMin` and `tempMax` | Exists |
| Current Conditions solid gauge | None | **Missing:** a `gauge` widget, see D15-2 |
| Markdown title | `markdown` | Exists |
| Dash Inspector, the live wiring | Toolbox's Inspector: Variables, Sources, Outline | Exists. A live value per variable may be missing, so tb checks |
| JSON harness | The Inspector's JSON tab, with edits applied | Exists |
| Chat harness | The Architect | Exists |
| `LlmService` relay with a rate limit | `llm/stream`, with roles, limits and tracking | Exists, see Gating |

The demo script is V2's `DEMO-SCRIPTS.md`, carried over in the same order:

1. "Build me a weather dashboard for New York": conditions, a temperature forecast and
   precipitation, all bound to one city prompt.
2. "Compare New York and London side by side": two city variables, each with its own column. This
   is scenario W2.
3. "Add a units toggle set to metric, and a title": a new variable bound into every source.
4. Show the wiring: the Inspector's Variables and Sources, live as the city changes.
5. The JSON is the API: edit the city in the JSON tab, apply, then Copy link and open it in a
   second browser as a reader.

Seeds: s5 plus one blueprint for each of demos 1 to 3, which is their expected result and the
fallback if the model goes wrong live.

**John - D15-2:** a `gauge` widget, a new built-in: a Highcharts `solidgauge` over one measure,
with `min`, `max` and color stops, and `modules: ['solid-gauge']` (Toolbox loads it). Without it,
Current Conditions shows as a `statCard`. I recommend the gauge, since it's V2's headline visual.

### Portfolio

It replaces the hand-built Portfolio example's views with blueprints over the portfolio catalog
(`positions`, `fundSummary`, `orders`, `prices`, `hypotheticalPortfolio`). The seeds are s1 to s4
and P2, P3 and P5, which already exist. The demo script is a PM's morning:

1. Open the morning report (P3) by link, as a reader, at a fund and date from the link.
2. Change the fund and the as-of date. Pick a sector in the treemap, and the grid filters.
3. Switch the column preset with its `presetSelector` (decision 154).
4. Ask a question ("Why is Tech down today?"). A chat answer shows a grid, which is then added to
   the dashboard.
5. Ask the Architect for "a heatmap of today's P&L by sector and strategy, beside the grid". Then
   save, publish, Copy link, and share with a role.
6. Joins: fund NAV and style beside positions, totalled once per fund (s3).
7. What-if: build a hypothetical portfolio with the portfolio builder (s4).

Missing: nothing in the kit. tb confirms the portfolio builder and the joins showcase run in the
app shell.

## Gating the Claude API

Toolbox's relay already has most of it (`LlmService`, `LlmConfig`):

- **Roles:** `TOOLBOX_LLM_USER` to call, and `TOOLBOX_LLM_UNLIMITED` for no limit. Both go to
  `HOIST_ADMIN` members.
- **Limits:** `rateLimit` calls per user per hour, and `maxStreams` concurrent streams. The server
  sets the model and `max_tokens`, and rejects other params and server tools.
- **Tracking:** every call goes to `TrackService` under category `LLM`, with its token counts, and
  at WARN when it fails or is refused.

Missing for a demo shown to people outside XH:

| Gap | Design | Owner |
|---|---|---|
| Limits count per server instance | Count in a cluster-wide hoist-core `Cache`. A small race is acceptable for a demo limit | data |
| A limit counts calls, not spend | Add `dailyTokenLimit` per user (input plus output, cache reads included) to `llmConfig`, checked before each call against tokens tracked so far today | data |
| No ceiling across all users | Add `dailyTokenBudget` for the whole app. Past it, only `TOOLBOX_LLM_UNLIMITED` calls, and the client says the demo has paused for the day | data |
| Calls tracked without context | The client sends `app`, `feature` (`architect` or `answer`) and `blueprintId` in a header. The server adds them to the `LLM` track entry. The admin Activity tab then splits use by app and feature | data, tb |
| No view of spend | A grid in Toolbox's admin over today's `LLM` track entries, summed per user and app | tb |
| The UI hides the limit | The Architect shows calls and tokens left today from a small `llm/usage` endpoint, and turns read-only at zero | tb, data |

The limits live in the `llmConfig` soft config, so an admin changes them without a deploy. The
roles stay as they are. A demo audience gets `TOOLBOX_LLM_USER` through a role grant, or through a
directory group mapped to it.

**John - D15-3: the limits themselves:** `rateLimit` per hour, `dailyTokenLimit` per user,
`dailyTokenBudget` for the app, and who gets `TOOLBOX_LLM_USER` for an outside demo. For scale,
step 12's whole test round cost $13.43, measured by the harness. I make no estimate per demo.

**John - D15-4, only if needed:** if a cluster-wide counter needs more than hoist-core's
replicated `Cache`, that's a hoist-core change. data checks first and raises it only then.

## Docs

Chat kit (ck, with hr reviewing):

- `blueprint/README.md`: finish its sections on the format, variables, presets and selectors,
  sources and joins, actions, slots (decision 157) and links. It stays the entry point.
- A new `docs/blueprint-format.md`: the user-facing format reference, cut from `spec.md`'s current
  rules, without the planning history.
- A new `docs/blueprint-widgets.md`: writing an app widget. Covers `WidgetSpec`, `x-binding`, the
  two widget rules, slots, `modules`, and config and link values as untrusted input.
- A new `docs/data-catalog.md`: designing a catalog. Covers fields, formats, kinds, aggregators,
  keyed values and joins, and the rule that the server checks access on every param.
- A new `docs/blueprint-security.md`: what a blueprint, an answer and a link can and can't reach.
  Covers bindings, markup, `highchartsConfig`, `openUrl`'s allow list and the server as boundary.
- `docs/README.md` rows and `docs/doc-registry.json` for each of these. Update the CHANGELOG's
  Blueprints entry.

hoist-react (hr): the cube, daterange and format READMEs already cover hr's additions. hr checks
`docs/README.md` and the docs roadmap list them, and confirms the tab-title fix's CHANGELOG entry
once its PR merges.

## The Two Skills

`guidance.md` becomes two skills, and then shrinks to a pointer, so each rule has one home.

- **Blueprint Architect skill:** for a coding agent that writes or edits blueprint JSON. That
  means seeded blueprints, an app's built-in ones, and scenario fixtures. It covers the rules in
  "The Architect", "Chat answers" and "The format", and how to check work: `validateBlueprint` and
  `check-blueprints.py`. The in-app Architect keeps its system prompt (`architectPrompt`). Rules
  the prompt enforces stay there, and the skill links to them rather than copying them. Owner: ck.
- **Data Catalog skill:** for a developer designing an app's catalog. It covers the rules in
  "Designing a Data Catalog", the server's param check, and how to check work. Owner: data.

Home: the `xh@hoist-ai` plugin, which app developers already install. The names are
`xh:blueprint-architect` and `xh:design-data-catalog`. They read the kit's docs through the Hoist
Docs MCP server (`library: "chat-kit"`), so they don't repeat the docs.

**John - D15-5:** the skills' home and names. The alternative is shipping them inside chat kit,
versioned with the library. hoist-ai is where XH's other skills live, so I recommend it.

## Order and Owners

1. John: D15-1 to D15-5.
2. In parallel:
   - data: cluster-wide limits, token limits, the budget and tracked context.
   - tb: the shared shell, from the Blueprints tab.
   - ck: the `gauge` widget, if D15-2 is approved.
3. tb: the Weather app with its seeds, then the Portfolio app with its seeds. tb also builds the
   usage display and the admin spend grid.
4. A dry run of both scripts, headless, against the H2 throwaway server (hr). tb and ck fix what
   it finds.
5. ck: the chat kit docs. data: the catalog doc. hr reviews both.
6. ck and data: the two skills, written once the docs settle, since they point to them.
7. John: a live run of both scripts, as a role-limited user.
