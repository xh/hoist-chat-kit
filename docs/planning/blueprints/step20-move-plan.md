# Step 20: Moving Chat Kit and Blueprints into hoist-react

> **Draft plan, no code.** Spec step 20: Hoist Blueprints moves into hoist-react as
> `@xh/hoist/blueprint`, with chat kit. Most of this is John's or Anselm's call, so it's a list
> of decisions, each with a recommendation. **J** marks John's call, **A** Anselm's, and **J+A**
> both.

## Where things stand

- **Chat kit** is `@xh/hoist-chat-kit`, Apache-2.0 like hoist-react. Its packages are `core`,
  `transport`, `threads`, `genui`, `cmp/markdown`, `desktop/cmp/{chat,genui,threads,workspace,blueprint}`,
  `blueprint`, `impl`, `styles` and `skills`, with 173 spec files and 3,383 tests.
- **Blueprints** lives in chat kit's `blueprint` and `desktop/cmp/blueprint`, and imports chat
  kit's `genui` for answers and the Architect's chat tools.
- **hoist-react `blueprints`** carries the framework pieces Blueprints needs: the aggregators,
  `fmtCompact`, the daterange periods, `cellStyle`/`rowStyle`, `setViewSpecs` and more. All are
  listed under 92.0.0-SNAPSHOT, with develop merged at 5faa9c16a.
- **hoist-core `blueprints`** has the `io.xh.hoist.blueprint` storage service, controller and
  tables, which decision 163 targets at 46.0-SNAPSHOT with v46 upgrade notes.
- **Anselm's branches:**
  - chat kit `genui-ui-formats`: already merged into `blueprints`.
  - chat kit `genui-building-blocks` (Nov 15): not merged.
  - hoist-react `genui-building-blocks`: 65 files, about 6,500 lines.
  - hoist-react `chart-spike`, the Chart V2 brief and spikes: 128 files, about 13,000 lines.

## Decisions

### D20-1. Package layout (J+A)

Recommendation: the chat domain under `@xh/hoist/chat`, Blueprints under `@xh/hoist/blueprint`,
and desktop components where Hoist keeps them.

| Chat kit | hoist-react |
|---|---|
| `core`, `transport`, `threads`, `genui` | `chat/core`, `chat/transport`, `chat/threads`, `chat/genui` |
| `cmp/markdown` (`chatMarkdown`) | `cmp/markdown`, beside Hoist's own markdown component |
| `desktop/cmp/{chat,genui,threads,workspace}` | `desktop/cmp/chat/*` |
| `blueprint` | `blueprint` |
| `desktop/cmp/blueprint` | `desktop/cmp/blueprint` |
| `styles` | each package's own `.scss`, with variables in `styles/vars.scss` |
| `impl` | each package's `impl`, keeping today's boundary |

- **The `impl` boundary carries over as it is:** `@internal` stays internal, and the docs
  index's `includeInternal` rule applies. Nothing in chat kit's `impl` becomes public in the move.
- **Desktop versus shared:** the split stays. Models, contracts and validators are shared, and
  only `desktop/` renders. Blueprints has no mobile components, and the move adds none.
- **Plain-Node modules:** the files the Architect harness and `validateBlueprint` load under
  plain Node keep that property. That covers `blueprint/impl/linkParams.ts`, `paramLabel.ts`,
  `gridStyles.ts`, `genui/architect/toolSpecs.ts` and `featureRequestCheck.ts`. A lint rule (no
  `@xh/hoist` imports in files with a `// Node-safe` header) would keep it from regressing.
- **The alternative:** `@xh/hoist/cmp/chat`, as for grids. That's rejected, because chat is a
  domain with services and transports, like `data`, not one component.

### D20-2. What stays app-side (J)

These stay app-side, already as contracts the kit defines:
- registries: an app's widgets, variable types, resolvers, actions and renderers, under dotted
  names;
- `DataCatalog` JSON and the dataset servers behind it, which check every param;
- `BlueprintDataProvider` implementations;
- `FeatureRequestSink` implementations and their stores;
- the LLM relay endpoint, with its keys, roles, limits and tracking;
- blueprint types, routes and app shells.

Recommendations:
- Ship `HoistCoreBlueprintRepository` and `InMemoryBlueprintRepository` in hoist-react.
- Keep Toolbox's `JsonBlobBlueprintRepository` in Toolbox, as an example of a repository without
  hoist-core's service. Promote it only if a second app asks for it (YAGNI).
- Keep the blueprint shell, meaning the library, workspace and inspector that tb built, in
  Toolbox until a second app needs it. The kit's `desktop/cmp/blueprint/design` pieces move as
  they are.

### D20-3. Dependencies chat kit brings (J)

| Package | Version | Licence | Used by | Recommendation |
|---|---|---|---|---|
| `@ag-ui/client`, `@ag-ui/core` | 1.0.4 | MIT | `chat/transport` (AG-UI) | dependency |
| `rxjs` | 7.8.1 | Apache-2.0 | AG-UI's client | dependency |
| `zod` | 4.6.7 | MIT | tool and answer schemas | dependency |
| `json-schema-to-ts` | 3.1.1 | MIT | types only | dev or type dependency, if no runtime import |
| `@openuidev/lang-core` | 1.1.0 | MIT | OpenUI Lang answers | **optional** peer dependency |
| `classnames`, `lodash` | - | MIT | already in hoist-react | nothing new |

- All licences are MIT or Apache-2.0, compatible with hoist-react's Apache-2.0.
- **`@openuidev/lang-core` runs install-time telemetry.** Chat kit's CI disables it with
  `OPENUI_TELEMETRY_DISABLED`. As an optional peer dependency, apps that don't use OpenUI never
  install it. Apps that do need the same variable, documented in upgrade notes. **J** decides
  whether a dependency with install telemetry is acceptable in Hoist at all.
- Bundles: Hoist apps import by path, so an app that never imports `@xh/hoist/chat` never bundles
  AG-UI, rxjs or zod. Install size still grows for every app.

### D20-4. The hoist-core side (J)

The storage service (`io.xh.hoist.blueprint`) is built on hoist-core `blueprints` for v46.

- **It ships in hoist-core 46,** released alongside the hoist-react release that brings Blueprints.
- **Recommended core, not the floor:** add Blueprints to `docs/version-compatibility.md`'s
  "Recommended Core" column, not to `MIN_HOIST_CORE_VERSION`. Only `HoistCoreBlueprintRepository`
  needs 46. Apps using another repository, or no Blueprints, run on 45. The repository should
  detect a missing endpoint and say "needs hoist-core 46", rather than failing obscurely.
- **No other hoist-core work:** the LLM relay stays app-side (D20-2).

### D20-5. Order relative to Anselm's work (J+A)

Recommendation:
1. Anselm lands chat kit `genui-building-blocks` into chat kit `develop`, and hoist-react
   `genui-building-blocks` into hoist-react `develop`, or folds them into this move.
2. hoist-react `blueprints` merges into `develop`, with its 92.0.0 framework features.
3. The move: chat kit, with Blueprints, into hoist-react `develop`, as one branch.
4. Chart V2 after the move. Blueprints' `chart` widget wraps today's `ChartModel` through
   chat kit's chart layout, and step 11's "Aligning with Chart V2" section already names the
   mapping, so Chart V2's PR migrates the widget.

**Why this order:** moving first means every later chat change is one PR in one repo. Doing Chart
V2 first would make the move carry two chart models at once.

**A** decides whether `genui-building-blocks` merges before the move or joins it, and whether Chart
V2 waits until after.

### D20-6. History and mechanics (J)

Recommendations:
- **Keep chat kit's history:** `git filter-repo --to-subdirectory-filter`, mapped to D20-1's
  paths, then merged into hoist-react with `--allow-unrelated-histories`, so blame survives. The
  alternative, a squashed copy, is simpler but loses about 3 months of reasons.
- **One move PR**, with no behaviour change: paths, imports, styles and docs only. A follow-up PR
  then retires anything duplicated, such as two markdown components.
- **Specs join hoist-react's suite.** Chat kit's `test/` fixtures move under hoist-react's
  `test-support`, or next to `blueprint`. CI time grows by about the size of chat kit's suite, and
  its timing specs need the same load tolerance as hoist-react's.
- **Docs:**
  - chat kit's `docs/` and READMEs move into hoist-react's `docs/` and package READMEs;
  - Hoist Docs drops the separate `chat-kit` library, and doc ids lose the `chat-kit:` prefix;
  - the three skills update their doc references.
- **Planning stays in chat kit:** `docs/planning/blueprints`, `DECISIONS.md` and the planning
  docs stay in the chat kit repo, archived. Only the user docs and the Architect harness move.

### D20-7. Reverting the decision 29 paths (J)

These exist only for the `blueprints` branches, and go in the move PR:
- chat kit `tsconfig.json`'s `paths: {"@xh/hoist/*": ["../hoist-react/*"]}`;
- `vitest.config.mts`'s `XH_HOIST_REACT_PATH`, and `inlineHoist`;
- Toolbox's tsconfig paths to the sibling hoist-react (d80dc961);
- `XH_INLINE_PACKAGES=@xh/hoist-chat-kit` in Toolbox's dev scripts and docs, including the
  inline start and spec commands in `docs/running-locally.md` (7d5dbd9a). Plain `pnpm test`
  fails the blueprint specs at import until then;
- the harness's relative imports (`../../../../../../blueprint/...`), which become hoist-react
  paths. Its plain-Node loading has to keep working there (D20-1).

Once the move lands, nothing points at a sibling checkout.

### D20-8. Versioning, upgrade notes, and what apps change (J)

- **hoist-react version:** Blueprints and chat ship in the major that `develop` holds, now
  92.0.0. They're new packages, not breaking ones, apart from the import move below.
- **Chat kit's last release:** a final `@xh/hoist-chat-kit` that re-exports from `@xh/hoist/chat`
  and `@xh/hoist/blueprint`, marked deprecated, so apps move their imports at their own pace
  through one major. Then the package stops. The alternative is a hard cut at the move.
- **Upgrade notes** (`docs/upgrade-notes/v92-upgrade-notes.md`):
  - an import map from `@xh/hoist-chat-kit/...` to `@xh/hoist/...`, with a codemod in the
    style of v91's CSS codemod;
  - the new dependencies, and `OPENUI_TELEMETRY_DISABLED` for apps on OpenUI;
  - hoist-core 46 for `HoistCoreBlueprintRepository`;
  - any renamed CSS variables (chat kit's `--xh-chat-*` checked against v91's naming grammar).
- **Apps change:**
  - their imports;
  - removing `@xh/hoist-chat-kit` from `package.json` after the shim release;
  - Toolbox's inline settings.

  No app code changes beyond paths, since the contracts in D20-2 keep their shapes.
- **CHANGELOG:** one 🎁 entry for Chat and Blueprints arriving in hoist-react, linking chat
  kit's CHANGELOG for its history, plus the import change under 💥 if D20-8's shim isn't used.

### D20-9. Skills' final home (J)

D15-5 put the three skills (`blueprint-architect`, `design-data-catalog` and
`extend-blueprints`) inside chat kit until hoist-ai's reorganization.

Recommendation: they move with the package into hoist-react's `skills/`, shipped in its `files`,
until John's hoist-ai reorganization decides otherwise.

## Order of work, once decided

1. John and Anselm: D20-1 to D20-9.
2. Anselm's `genui-building-blocks` lands, or is folded in (D20-5).
3. hoist-react `blueprints` merges to `develop`, and hoist-core `blueprints` to `develop` (46).
4. The move PR (hr, with ck): history import, paths, styles, docs, the decision 29 reverts, specs
   green in hoist-react, and Toolbox switched to `@xh/hoist` imports and green.
5. The chat kit shim release, and upgrade notes with the codemod.
6. Chart V2, migrating the `chart` widget.
