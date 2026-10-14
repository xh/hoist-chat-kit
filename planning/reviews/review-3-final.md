# Review 3 - Final pre-release review

Scope: the whole package, reviewed in the working tree of `feature/chat-kit-v1-broaden` (HEAD
`53c3ada` plus uncommitted work, including the untracked `desktop/cmp/genui/`). Line numbers refer
to the working tree.

## Check results

| Check | Result |
|-------|--------|
| `pnpm typecheck` | Pass (exit 0) |
| `pnpm lint` | Pass: eslint, stylelint, prettier all clean |
| `pnpm test` | Pass: 24 files, 346 tests |
| `pnpm build` | Pass: `105 files, 554 KB unpacked - OK`. Contents are right apart from G-B1 (no `genui/README.md` to ship) and n-10 (no `CHANGELOG.md`). |
| README snippets | Compiled in a scratch project against the real API (`/tmp`, not in the repo). One failure: m-1. |
| Links and anchors | Checked every relative link and anchor in all 12 docs. Two broken, both G-B1. |

Earlier reviews: I checked the fixes for review 1 (M1-M7, m1-m20, the nits) and review 2
(C-01 to C-37) against the code. They are all real. The one partial fix is C-19:
`ChatMessageView` still exports `isLast`, `isEditing` and `onEditingChange`, but marks them
`@internal`, which is acceptable.

Counts: Blocker 1, Major 4, Minor 12, Nit 13.

## Findings

| id | severity | file:line | finding | recommended fix |
|---|---|---|---|---|
| G-B1 | Blocker | `genui/` (no README), `docs/README.md:58-68`, `docs/doc-registry.json`, `desktop/cmp/genui/README.md:240,267` | The `/genui/` package (`ChatUiCatalog`, `ChatUiComponentSpec`, `ChatUiAdapter`, `ChatUiRenderContext`, the schema subset) has no README, no index row and no registry entry. Per CLAUDE.md the feature is not done. The genui desktop README links to `../../../genui/README.md` twice, and the target does not exist. Nothing documents the adapter path (`createDataRenderers`, `renderNode`), the supported JSON Schema keywords, or partial validation, apart from TSDoc. | Write `genui/README.md` from the seven-section template. Cover the catalog, the component spec, `isPartial`, the schema subset and its partial rules, adapters, the cost per render (m-6), and pitfalls. Add the index row, the registry entry and a Quick Reference row. |
| M-1 | Major | `desktop/cmp/chat/ChatToolCall.ts:203`, `impl/ToolCallStatus.ts:61-65`, `core/ChatModel.ts:563-572,582-611` | **Confirmed.** An inline catalog call shows a spinner and "Pending" under a component that has already rendered. The cause: a catalog tool is a client tool, `TOOL_CALL_END` sets `input-available`, and `execute` runs only after the step's stream ends. The spinner therefore stays while the model streams more calls or text. With two `show_*` calls in one step, the first shows "Pending" for the whole of the second. Inline output-error captions also show the model-facing text "Invalid props - nothing was shown. Fix and retry: ..." to the user. | In `inlineToolCall`, show the status only for `input-streaming` ("Preparing"), `approval-requested`, `output-error` and `output-denied`. Show nothing for `input-available` and `running`, because the component itself is the progress. For an inline `output-error`, show a short "Could not show <title>" and put `errorText` behind the existing "View input" toggle. Add a spec for the inline caption at each state. |
| M-2 | Major | `docs/protocols.md:16-17,132,157-168,178-180,191-193`, `DECISIONS.md:163-176`, `docs/architecture.md:9-31,143-157,164-174`, `README.md:12-26,107-114`, `docs/README.md:41`, `core/README.md:703-713`, `desktop/cmp/chat/README.md:487-494` | The docs still describe the catalog as future work. Protocols says "Seam built. Renderer planned" and "A Hoist component catalog is the next deliverable", and calls it "the planned registry" three times. D15 says "The full registry follows" and is not marked as updated. Architecture leaves `genui/` and `desktop/cmp/genui/` out of the layers, the seams table and the platform table. The root README's features and doc table leave out generative UI components. The index sends "Render generative UI" to the protocols section that calls the work planned. The core and desktop chat READMEs do not link the genui packages. | Rewrite protocols "Generative UI" as built: the catalog, `display: 'inline'`, and `ChatUiAdapter` as the A2UI and OpenUI path. Update D15 in place, or add D17 for the shipped design and mark D15 superseded. Add both genui packages to the architecture layers, the seams and the platform table, to the root README, and to Related Packages. Point the Quick Reference row at `/genui/`. |
| M-3 | Major | `CHANGELOG.md:5-32` | The CHANGELOG has no entry for generative UI, the largest feature an app developer sees: `ChatUiCatalog`, adapters, the four desktop components, `ChatToolSpec.display: 'inline'`, interactive tools, `HttpChatTransport`, and `ChatRunError` codes. It also has no `✨ Styles` entry for the `--xh-chat-*` variables. Two bullets break the past-tense rule: line 21 "`ChatMarkdown` shows..." and line 25 "Tool and data renderers receive...". | Add bullets for each item. Add a `### ✨ Styles` section for the theme variables. Rewrite lines 21 and 25 as "Added ...". |
| M-4 | Major | `desktop/cmp/genui/ChatUiChart.ts:112,124-125,38`, `impl/ChatUiChartData.ts:79-80` | The model-facing schema contradicts itself for pies. `xAxis.description` says "Leave out for a pie chart", and the TSDoc says "Not used by a pie chart". But a pie's plain values take their slice names from `xAxis.categories`, and `categories.description` says "for a category axis or a pie". A model that follows the instructions omits `xAxis`, and the slices show as "Item 1", "Item 2". | Change the `xAxis` description to "For a pie, give only `categories`, the slice names." Fix the TSDoc to match, or tell the model to send `[name, value]` pairs for a pie. Add a pie example to the instructions. |
| m-1 | Minor | `desktop/cmp/chat/README.md:235` | **Confirmed by compiling.** `hoistCmp.factory<{data: PlainObject[]}>(...)` fails with TS2559: "has no properties in common with type 'HoistProps<HoistModel>'". This is the README's model for a renderer with hooks, and the pitfalls point back to it. | `interface ForecastChartProps extends HoistProps {data: PlainObject[]}`, then `hoistCmp.factory<ForecastChartProps>(...)`. |
| m-2 | Minor | `desktop/cmp/genui/ChatUiCard.ts:186-193`, `desktop/cmp/genui/README.md:165-166` | A card action shows `text` but sends `prompt`, which can be 500 characters and which the user never sees. Under the D16 threat model, a prompt-injected reply can label a button "Show trades" and send other instructions as the user's own message. | Show the prompt as the button tooltip. Or put it in the composer for the user to send. Document the choice next to D16. |
| m-3 | Minor | `genui/impl/validateSchema.ts:90-93`, `core/impl/parsePartialJson.ts:7,93` | `parsePartialJson` keeps a number cut short at the end (`{"days": 12` gives `{days: 12}`, and the spec asserts this). The doc says "Partial keys, numbers and literals are dropped". `validateSchema` checks `minimum` while partial, so `{"year": 2` fails `minimum: 1900`. The renderer then returns null and unmounts the component mid-stream, and its `GridModel` or `ChartModel` is destroyed and rebuilt. | Skip `minimum` (and `maximum` for negative values) when `isPartial`, as `minLength` is skipped. Fix the `parsePartialJson` doc to say a trailing number is kept once it parses. |
| m-4 | Minor | `desktop/cmp/genui/ChatUiGrid.ts:300` | `emptyText` is fixed when the `GridModel` is created. On the streaming path, which is the normal one, the model is created while `isPartial` is true, so a finished grid with zero rows never shows "No rows.". | Set `emptyText: 'No rows.'` always (the skeleton covers the partial state). Or update it in a reaction on `isPartial`. |
| m-5 | Minor | `desktop/cmp/genui/ChatUiGrid.ts:49,63`, `ChatUiChart.ts:31,67`, `ChatUiMetrics.ts:43,49`, `ChatUiCard.ts:37,51` | `GridComponentProps`, `GridComponentOptions`, `ChartComponentProps` and the rest are the only public kit types without the `Chat` prefix (D10). The factories `gridComponent()` and `chartComponent()` are just as generic, and an app that imports them beside its own grid code will collide. | Rename to `ChatUiGridSpecProps` and `ChatUiGridSpecOptions` (or similar), and the factories to `chatUiGridSpec()` and the rest, while no app depends on them. |
| m-6 | Minor | `genui/ChatUiCatalog.ts:177-193`, `desktop/cmp/genui/README.md:232-241` | Each `show_*` call is a client tool, so every render ends the step and starts another model call. That adds latency, takes one of `maxSteps`, and resends the full props (up to 100 rows) in the history on every later step. No doc says so. | Document it in the genui READMEs and the `ChatUiCatalog` TSDoc, with the advice to keep `maxRows` and `maxPoints` low and to raise `maxSteps`. Consider a later option that answers catalog calls without another step. |
| m-7 | Minor | `core/README.md:339-358` | The persistence example saves only in `onTurnComplete`. `clear()` with no turn running saves nothing, so a reload restores the cleared chat. With a turn running, `clear()` fires `onTurnComplete` before the wipe, which saves the old messages. | Save from a reaction on `[threadId, messages]` that skips while `isBusy`. Or show an explicit save after `clear()`. |
| m-8 | Minor | `desktop/cmp/chat/README.md:270`, `cmp/markdown/README.md:60`, `docs/README.md:17` | The shipped docs link to `DECISIONS.md` and `CLAUDE.md`, which the `files` list leaves out, so the links break in the npm package and in the hoist-react doc tools. | State the D16 rationale inline, which the markdown README already does, and drop the links. Or ship `DECISIONS.md`. |
| m-9 | Minor | `docs/architecture.md:9` | "Each layer depends only on the layers below it" is not true. `transport/` imports `core` types and runtime code from `core/impl` (`ScriptedChatTransport.ts:4-5`, `impl/streams.ts:2`). `core` imports types from `transport`. A sibling package also imports another package's `impl/`, against the Hoist rule. | Say that core and transport share types and are peers. Move `raceAbort`, `sleepAsync` and `genChatId` to a shared internal module, such as `core/impl` re-exported as `@internal` from the core barrel, or a top-level `impl/`. |
| m-10 | Minor | `desktop/cmp/genui/ChatUiMetrics.ts:73,115`, `desktop/cmp/genui/README.md:188,255-263` | One concept has two names. The model writes `items`, and the component takes `metrics`, which needs a pitfall section of its own. | Rename the schema key to `metrics` (the model does not care), and drop the pitfall. |
| m-11 | Minor | specs | The new genui and inline code has no tests. Missing: `ChatUiGridLocalModel` and `ChatUiChartLocalModel` (model created once the rows or series begin, not rebuilt while they stream, destroyed on unmount, `sortBy` written after the rows), the inline caption (which would have caught M-1), `ChatToolCallGroup` opening while it runs and closing when done, `ChatUiCard` actions (disabled while busy, sending the prompt), and `validateSchema` `minimum` while partial (m-3). | Add behavior-named specs. Render the components with `@testing-library/react`, as `ChatMessageList.spec.ts` does. |
| m-12 | Minor | `docs/README.md:41,52-75`, `docs/doc-registry.json` | The index has no "Models" row for `/genui/`, and no Quick Reference rows for "Write a catalog component" or "Adapt A2UI or OpenUI payloads". Part of G-B1, listed apart because it lives in the index. | Add these rows with G-B1. |
| n-1 | Nit | `genui/ChatUiComponentSpec.ts:29` | The TSDoc example `render: ({items = []}) => metricTiles({items})` passes `items` to an element factory. The genui README calls this a pitfall. | `metricTiles({metrics: items})`. |
| n-2 | Nit | `genui/ChatUiCatalog.ts:225`, `desktop/cmp/chat/ChatToolCall.ts:144`, `ChatMessageView.ts:461` | Two idioms for one need. `chatUiComponent` sets `model: uses('*', {optional: true})`, while `toolCallBody` and `dataPart` use the default `uses('*')`. All three have the same comment about `useLocalModel()`. | Use one form. `uses('*', {optional: true})` is the safer one. |
| n-3 | Nit | `genui/impl/validateSchema.ts:87` | `new RegExp(pattern, 'u')` compiles on every check. An invalid app pattern throws inside a renderer and breaks the render. | Compile once per schema with a cache. Turn a bad pattern into one error message. |
| n-4 | Nit | `desktop/cmp/genui/ChatUiCard.ts:148` | The card shows the last field while it is still partial (a number cut short flickers). Metrics, grid and chart all drop the last item. | `dropRight` the fields while `isPartial`, as metrics does. |
| n-5 | Nit | `core/ChatModel.ts:236-238`, `genui/ChatUiCatalog.ts:78-82` | No check for a duplicate tool name across app tools and catalog tools. `getToolSpec` picks the first one quietly. | `throwIf` on duplicate names in the `ChatModel` constructor. |
| n-6 | Nit | `desktop/cmp/genui/ChatUiMetrics.ts:169`, `cmp/markdown/ChatMarkdown.ts:123` | Class names built with template strings, the C-27 pattern. | Use `classNames` (move `ClassNames.ts` to a shared `impl/` so that `cmp/` can use it too). |
| n-7 | Nit | `desktop/cmp/genui/*.scss` | Hard-coded spacing: `gap: 4px` and `2px`, `minmax(150px)`, `3px` accents (C-37). | Use `--xh-pad-*` for gaps. |
| n-8 | Nit | `ChatUiChart.ts:91,202`, `ChatUiGrid.ts:98,256` | Defaults appear twice: 280 in the factory and in render, 360 in the factory and in the local model. | One module constant each. |
| n-9 | Nit | `desktop/cmp/genui/index.ts` | Apps that write their own catalog components cannot reuse `chatUiFrame`, `fmtChatUiNumber`, `NUMBER_FORMAT_SCHEMA` or `DECIMALS_SCHEMA` for a matching look and schema. | Export them, or say why they are internal. |
| n-10 | Nit | `package.json:15-25` | `CHANGELOG.md` does not ship (npm no longer adds it on its own), while `@xh/hoist` ships its own. | Add `CHANGELOG.md` to `files`. |
| n-11 | Nit | `DECISIONS.md:80-82,160-161` | D6 and D14 say "The report proposes...", but no report exists in the repo. D6 says `renderNDJSON` "buffers 32 KB before it flushes". It also flushes after the first row (`BaseController.groovy:89`), as the transport README says correctly. | Name the proposal (an issue link) or drop the sentence. Say "flushes after the first row, then every 32 KB". |
| n-12 | Nit | `README.md:9`, `transport/README.md:173,189,218,374,379-382`, `cmp/markdown/README.md:132`, `desktop/cmp/genui/README.md:240,267` | Prose lines over 100 characters, and an odd break at `transport/README.md:381` ("That batching is" / "right for..."). | Re-wrap at 100. |
| n-13 | Nit | `core/ChatModel.ts:183` | `this.messages.length === 0`, the n9 pattern from review 1. | `isEmpty(this.messages)`. |

## Notes on the asked-about areas

- **Render context memoization.** Correct. `ChatMessageView` builds the context with
  `useMemo([chatModel, message.id])`. `toolCallBody` and `dataPart` are memoized on stable props,
  and the spec checks that a data part skips render while other parts change.
- **Image policy.** Correct. Blocked images render as links, a function policy is read through a
  ref, and data URLs are stripped by react-markdown's URL transform. Reasoning text gets the policy
  too. Highcharts tooltips render as SVG text, so a model-written `<img>` in a series name does not
  load (checked against the Highcharts 12.6 AST allowlist in Toolbox).
- **GridModel and ChartModel lifecycle.** No leaks found. Each is `@managed` on the local model.
  It is rebuilt only on a structural change to the columns or the layout, with `XH.safeDestroy`
  on the old one, and is destroyed when the component unmounts. A model written out of schema
  order (rows before columns) rebuilds the grid on each column delta. That is correct but wasteful,
  and the catalog instructions could ask for schema order.
- **`(AgGrid as any)`.** Acceptable. The sizing statics are attached at runtime with no type, and
  Hoist's own `AgGridLocalModel` uses the same cast.
- **Tool call grouping.** Correct, with a spec. When a second call arrives, the first card
  remounts inside the new group (its key changes from the part id to `tools-<id>`), and any
  open/closed state the user set is lost. That is minor and not listed.
- **Undeclared dependencies.** None. Source imports only `@xh/hoist/*`, `react` and `lodash`.
  `classnames` is replaced by a local helper, and Highcharts comes through `@xh/hoist/cmp/chart`.

## Doc lint scores

`ste-lint.py` from the `xh:clear-writing` skill. Target: per100w under 2.5, em_dash 0. All pass.

| Doc | words | total | per100w | em_dash |
|-----|------:|------:|--------:|--------:|
| `README.md` | 485 | 0 | 0.00 | 0 |
| `CHANGELOG.md` | 264 | 3 | 1.14 | 0 |
| `DECISIONS.md` | 1707 | 7 | 0.41 | 0 |
| `docs/README.md` | 707 | 0 | 0.00 | 0 |
| `docs/architecture.md` | 1044 | 3 | 0.29 | 0 |
| `docs/protocols.md` | 1771 | 3 | 0.17 | 0 |
| `docs/doc-conventions.md` | 600 | 2 | 0.33 | 0 |
| `core/README.md` | 3388 | 15 | 0.44 | 0 |
| `transport/README.md` | 3138 | 6 | 0.19 | 0 |
| `cmp/markdown/README.md` | 831 | 2 | 0.24 | 0 |
| `desktop/cmp/chat/README.md` | 1980 | 2 | 0.10 | 0 |
| `desktop/cmp/genui/README.md` | 1185 | 3 | 0.25 | 0 |

## Keep

- The run loop after reviews 1 and 2. Paused turns, restored turns (`getOrRestoreTurn`),
  settle-on-restore, `ChatRunError` codes, `incomplete-stream`, and `XH.handleException` for
  thrown errors are all correct and tested.
- The `HttpChatTransport` base class: one abort pattern, `fetchRecords` as the only seam, and
  clear server contracts in both TSDoc and README.
- `ChatPartRenderContext` and renderers as components of their own. This is the right design
  for generative UI, and the catalog builds on it cleanly.
- The catalog's safety model: the model can only name a component and pass props that pass
  validation, and invalid props go back to the model as a readable error list with paths.
- Streaming genui. Dropping the last row or point while partial, and loading data into one
  model, keeps grids and charts stable as they fill.
- The docs set: seven-section READMEs with pitfalls, a correct registry and index (apart from
  genui), every link resolving apart from G-B1, and all lint scores far under target.
