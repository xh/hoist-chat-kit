# Vertical Slice: Hoist Blueprints

> **Draft for review.** The plan for the first working version of Hoist Blueprints, built by
> four Claude Code sessions with an orchestrator. Read [`spec.md`](./spec.md) first. This plan
> says what to build now, who builds it, and how the parts meet.

## Goal

A blueprint renders and runs in Toolbox, on real Toolbox data, with live updates. A person can
paste a blueprint, see its issues, see it render, and watch its variables change. The engine and
validator are real library code in chat kit, with unit tests.

## Done when

1. In a Blueprints tab in Toolbox, the scenario blueprint `p1-one-grid.json` renders a Cube grid
   of positions grouped by sector, from the extended position data, with formats from the
   catalog's kinds. Values update live.
2. Changing the as-of prompt in the blueprint's toolbar reloads the grid.
3. `p2-linked-dashboard.json` renders: stat cards, the strategy and trader grid, the sector chart
   and the orders grid. Selecting a row in the grid filters the chart and the orders grid.
4. The JSON harness applies a pasted blueprint. It shows each validation issue with its path, and
   keeps the last valid blueprint on screen when the new one fails.
5. The inspector shows each variable with its writer and its current value, and the blueprint's
   issues.
6. Items 1 to 5 are checked in a real browser, as "Browser checks" below describes, with
   screenshots.
7. The chat kit unit tests cover the edit engine, the validator and the runtime, and `pnpm test`,
   `pnpm lint` and `pnpm typecheck` pass in chat kit and Toolbox.
8. The LLM harness in `tools/llm-test/` validates with the library's validator, not its own copy.

Items 1, 2, 4 and 5 come first. Item 3 is the stretch goal of the slice.

## Browser checks

Every change a user can see is checked in a real browser before it counts as done. Unit tests
alone do not count.

- Use a headless browser, such as the Playwright MCP tools in headless mode. Never open a
  visible window, and never drive John's own browser, as he may be using the desktop.
- Test against the one shared Toolbox, which `blueprints-tb` runs. Log in to the throwaway H2
  server as hoist-react's `CLAUDE.md` describes, with `agent@xh.io` and `localDevOnly`.
- For each check, load the blueprint, do what the "Done when" item says, and confirm the result.
  Read the browser console, and treat any error as a failure.
- Save a screenshot of each passing check to `~/xh/worktrees/blueprints/screenshots/<session>/`,
  named for the item, so John can review them.

## After the slice

The spec's plan continues with step 5, which covers every scenario, step 6, which chooses the
schema toolchain, and step 7, which lets the Architect edit a blueprint in Toolbox through chat
kit. Step 7 can start as soon as the slice works, beside step 5. Step 8 then makes chat answers
blueprints.

## Out of scope

Presets, personalizations, publishing, access and modes, versions and migrations, the Architect
inside Toolbox, chat answers, `request_feature`, conditional styles and the `"server"`
aggregator. The format already has room for each, so none changes what the slice builds.

## Sessions

| Session | Worktree | Branch | Owns |
|---|---|---|---|
| `blueprints-ck` | `~/xh/worktrees/blueprints/hoist-chat-kit` | `blueprints` | The Blueprints library: the document model, edit engine, validator, registry, variables, sources, data provider interface and the widgets |
| `blueprints-tb` | `~/xh/worktrees/blueprints/toolbox` | `blueprints` | The Toolbox client: the Blueprints tab, the JSON harness, the inspector, the data provider that calls the server, and the app's registry entries |
| `blueprints-data` | `~/xh/worktrees/blueprints/toolbox-data` | `blueprints-data` | The Toolbox server: the extended position and order data, the Data Catalog endpoint, the query endpoint and live updates |
| `blueprints-data` (from phase 3) | `~/xh/worktrees/blueprints/hoist-core` | `blueprints` | The hoist-core blueprint storage: domain, service, access and endpoints |
| `blueprints-hr` | `~/xh/worktrees/blueprints/hoist-react` | `blueprints` | Changes to hoist-react that the slice needs, on request only |
| Orchestrator | The session that wrote this plan | None | The spec, the guidance notes, decisions with John, and reviews. `blueprints-tb` merges `blueprints-data` into `blueprints` |

## Where the code goes

Hoist Blueprints is built in chat kit for now, and moves into hoist-react as
`@xh/hoist/blueprint` with chat kit later. Lay it out as hoist-react would:

| Path in chat kit | Holds |
|---|---|
| `blueprint/` | Platform-neutral core: types, edit engine, validator, registry, `BlueprintModel`, variables, sources, the data provider interface |
| `blueprint/impl/` | Internals that no app imports |
| `desktop/cmp/blueprint/` | Desktop widgets and containers: `dashCanvas`, `tabContainer`, `cubeGrid`, `chart`, `statCardStrip`, and the blueprint's toolbar |

Start from the harness in `docs/planning/blueprints/tools/llm-test/src/`. Its `engine.ts` and
`validate.ts` pass every scenario, so port them, with their tests, instead of rewriting them.
`registry.json` next to the spec holds the widget specs for the slice's widgets.

## Contracts between sessions

### The data provider

Chat kit defines the interface, and Toolbox implements it. Field names match the Data Catalog
exactly.

```ts
interface BlueprintDataRequest {
    dataset: string;
    params: Record<string, unknown>;    // resolved values, never bindings
    fields: (string | {name: string, field: string, params: Record<string, unknown>})[];  // a name, or a field instance
    groupBy: string[][];                // the grouping levels the widgets need
    filter?: FilterSpec;                // the source filter, sent to the server
}

interface BlueprintDataProvider {
    loadAsync(req: BlueprintDataRequest, loadSpec?: LoadSpec): Promise<{rows: PlainObject[]}>;
    subscribe?(req: BlueprintDataRequest, onUpdate: (u: {replace?: PlainObject[], add?: PlainObject[], update?: PlainObject[], remove?: string[]}) => void): () => void;
}
```

- Each row carries an `id` field, stable across updates, which the source's Cube uses as its
  `idSpec`.
- `fields` lists every field the source's Cube needs: each widget's columns and measures, and
  every dimension a widget groups, filters, sorts, charts or reads an output by, plus weight
  fields. The server returns exactly these, and no more. `groupBy` only tells the server the
  levels, for when it rolls measures up. The fake provider also returns only `fields`, so a
  missing field shows up in tests.
- A source starts once its required parameters have values. If the provider has `subscribe`, the
  source calls only `subscribe`: its first update is `{replace: rows}`, the whole snapshot, and
  changes follow. That way no change falls between a load and a subscription. Otherwise the
  source calls `loadAsync`. It calls the function `subscribe` returned when a parameter changes
  or the blueprint closes.
- `replace` swaps every row of the source's Cube. A provider may send it again at any time, for
  example after the web socket reconnects.
- A field instance travels in `fields` as an object, and its `name` is the column key in each
  row.
- The library ships a fake provider over seeded data, ported from the harness's `data.ts`, so
  the library and the Toolbox client can work before the server is ready.

### The Toolbox server

| Endpoint | Request | Response |
|---|---|---|
| `GET blueprints/catalog` | None | The portfolio Data Catalog as JSON. Its content is `catalogs/portfolio.json` from the planning folder |
| `POST blueprints/data` | A `BlueprintDataRequest` | `{rows}`, with an `id` on each row |
| `POST blueprints/subscribe` | A `BlueprintDataRequest`, plus `channelKey` and `topic` | `{rows}`. Then pushes `{add, update, remove}` to the topic over Hoist's web socket, as `PositionSession` does today |
| `POST blueprints/unsubscribe` | `channelKey` and `topic` | Nothing. Ends the pushes. The provider's unsubscribe function calls it |
| `GET blueprints/funds` | None | Each fund's `name` and `aum`, for the `fund` input. A fund's value is its name |

- Data follows `catalogs/portfolio.json`: every dimension, identifier, measure and parameter,
  with the aggregators it names. `return` and `shockedPnl` take their parameters through field
  instances in the request: `{"name": "retYtd", "field": "return", "params": {...}}` in
  `fields`.
- `asOf` changes the data, so positions differ by date. Today's date updates live.
- Orders carry the position dimensions, so a selection in a positions grid filters them.
- `prices` and `hypotheticalPortfolio` come after `positions` and `orders`.
- In the slice, the server returns leaf rows and ignores `groupBy`. Cube groups on the client, and
  the measures that roll up on the server carry leaf values until the `"server"` aggregator
  exists.
- The planning folder's `catalogs/portfolio.json` is the source. Toolbox keeps a copy, which the
  orchestrator asks to refresh when the source changes.

## Milestones

### `blueprints-ck`

1. Commit the planning folder, `docs/planning/blueprints/`, as the branch's first commit. Its
   `.gitignore` keeps out the harness's `node_modules` and `results`.
2. Port the types, edit engine and validator into `blueprint/`, with unit tests from the
   harness's self-test and the scenario blueprints.
3. Build `BlueprintModel`: it holds the blueprint, applies edits, resolves variables (prompts,
   defaults, resolvers and constants) and builds sources. Each source holds a Cube, merges its
   widgets' demands into one request, and loads through the provider, with live updates.
4. Build `dashCanvas` and `cubeGrid` over hoist-react's `DashCanvas` and `CubeGrid`, and the
   toolbar that renders prompts. P1 renders on the fake provider.
5. Build `statCardStrip`, `chart`, outputs, and filter variables for P2.

### `blueprints-tb`

1. Commit the chat kit rename already in the worktree: `chatUiMetricsSpec` became
   `chatUiStatCardsSpec`.
2. Add a Blueprints tab, with the JSON harness and the inspector, over the library's fake
   provider.
3. Implement `BlueprintDataProvider` over the server endpoints, and switch to it when the data
   session's endpoints are merged.
4. Register Toolbox's app pieces: the `fund` variable type with its input, the `userFund`
   resolver, and the `ticker` renderer.

### `blueprints-data`

1. Extend the position generator to `catalogs/portfolio.json`, keeping Toolbox's existing
   portfolio examples working.
2. Add the catalog, data and subscribe endpoints, for `positions` then `orders`.
3. Add `prices` and `hypotheticalPortfolio`.

### `blueprints-hr`

On request only. The likely needs are a way to drive `DashCanvasModel`'s layout from child
references, and small `CubeGrid` changes. Every hoist-react change gets a unit test, and a
CHANGELOG entry under the current snapshot.

## Working rules

- Read your repo's own `AGENTS.md` or `CLAUDE.md` first. Chat kit's conventions bind in chat kit.
- Commit small, tested changes on your own branch as you go. Never push. Never force anything.
- Change only your own worktree. Ask the orchestrator for a change anywhere else.
- Send questions, milestones and anything that changes a contract to the orchestrator. Decisions
  about the format go to John through the orchestrator, who records them in the spec.
- If the spec is silent or wrong, say so, and do not invent a rule in code.
- When a design change affects the seeded blueprints, delete and reseed them in both repositories
  without asking. John said so directly. Other stored blueprints still need his okay before deletion.
- Major design or spec decisions go to John through the orchestrator before they are built: a
  contract apps implement, new public API, persistence, a new format section, or a reversal of an
  earlier decision. Minor choices that follow from conventions or earlier decisions are decided,
  reported and logged.
- While John is away, the orchestrator decides where the path is clear and consistent with the
  design, unless reversing it later would be expensive. Core decisions go to John as a prompt,
  which reaches his phone.
- The orchestrator sends each design or implementation decision to the deck session
  (`hoist-chat-kit-38`) and the research session (`hoist-chat-kit-e5`), so their presentation
  and landscape artifacts stay current.
- The orchestrator records every decision made during the slice in
  [`decisions.md`](./decisions.md), for John to review.
- Run Toolbox as hoist-react's `CLAUDE.md` describes. From `toolbox/client-app`,
  `XH_INLINE_PACKAGES=@xh/hoist-chat-kit pnpm startWithHoist` builds hoist-react and chat kit from
  the sibling worktrees. Check whether a server already runs on port 3000 or 8080 before you
  start one. The machine runs short of memory with several sessions open, so run one Toolbox
  client and one server between all the sessions, and stop any you start when you are done.

## Before the branches merge to develop

- Chat kit's `package.json` lists `docs` in `files`, so `docs/planning/` would publish to npm.
  Exclude it, or move the planning docs, before `blueprints` reaches `develop`.
- If Toolbox's `client-app/tsconfig.json` `paths` stay uncommented on `blueprints` so that its
  pre-commit typecheck sees the sibling worktrees, comment them again before the merge.
- Revert chat kit's typecheck and test setup that points `@xh/hoist` at the sibling hoist-react
  worktree, once a published Hoist snapshot holds what the blueprints branch needs. It is three
  settings, each marked "Remove before merging": the `paths` entry in `tsconfig.json`, and
  `inlineHoist: true` and `XH_HOIST_REACT_PATH` in `vitest.config.mts`. The LLM harness's
  `tools/llm-test/tsconfig.json` has the same `paths` entry. Until then, chat kit's CI fails on
  this branch, because it needs the sibling worktree.
