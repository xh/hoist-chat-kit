# Progress

Running log of the first build iteration of Hoist Chat Kit. Newest entries go at the top of the
log. `planning/DESIGN.md` holds the build spec, and `DECISIONS.md` holds the design decisions.

## Plan

| Phase | Scope | Status |
|---|---|---|
| 0. Research | Protocols, prior art, the Toolbox `weatherv2` chat | Done |
| 1. Vertical slice | Core models, transports, codecs, streaming markdown, message list, composer, tool cards | Done, first review fixed |
| 2. First consumer | Toolbox streaming endpoint, `weatherv2` chat on the kit, browser check | Done |
| 3. CI | Lint, typecheck, tests, package build, CodeQL gate | Done |
| 4. Broaden | Code highlighting, demo pages, generative UI catalog (`planning/GENUI.md`) | Done |
| 5. Review and docs | Review passes against Hoist conventions, READMEs, architecture doc, report | Final review fixed |

## Log

### 2026-10-14

- Wired generative UI into `ChatModel`: the `catalog` and `dataSource` configs, a managed
  artifact registry per chat, tags rendered in replies, the catalog version on requests and
  replies, and message context in the codecs (D54). 922 tests.
- Read the feedback packet from three enterprise apps and wrote plan 2: server-owned
  conversations become first-class beside client-owned ones (D19 to D29). Filed
  xh/hoist-core#618 and xh/hoist-react#4855.
- Merged slice 2 (#6). Made the Toolbox branch build on the published kit.
- On `feature/server-mode`: fixed the packet's open defects, built the run lifecycle, the thread
  layer, citation markers, the generative UI core and the helper agent core. 897 tests.
- Built the guideline assistant backend and client plumbing in Toolbox.
- Stopped at a clean point to move to a subscription session. `planning/HANDOFF.md` lists the
  next steps.

### 2026-10-13

- Ran the final reviews (kit-wide, and Toolbox plus live UX) and fixed their findings. 390 tests.
- Built the generative UI catalog, Hoist grid, chart, metric and card components, and a Toolbox
  Chat Kit demo app with seven demos, including a live model that renders Hoist grids and charts.
- Merged slice 1 to `develop` (#5), which published the first snapshot.
- hoist-react fixed the `DashCanvas` regression (#4846). Toolbox tracks `next` again.
- Commit signing through 1Password started to fail, so slice 2 waits uncommitted, with backups.
- Wrote `REPORT.md`.

- Wrote the generative UI design (`planning/GENUI.md`): catalog components become client tools,
  so they reuse streaming, schemas, validation and renderers.
- Documented `core` and `transport`, the architecture, and the protocol positioning.
- Fixed all Major findings of review 1 (core and transport), and most Minor ones. 221 tests.
- Built the Toolbox harness: a token-streaming `llm/stream` endpoint, chat-kit linked into the
  client, and both servers running on a throwaway database. Found a hoist-react regression that
  breaks every `DashCanvas` (`ContextMenu` called as a function after #4839) and pinned Toolbox to
  an earlier snapshot. A fix is due on hoist-react `develop`.
- Built the core models, transports, codecs and desktop components.

- Researched agent-to-UI protocols, chat UI prior art, and the `weatherv2` chat. The notes are in
  `planning/research/`.
- Wrote the build spec and the first design decisions.
- Wrote the contract types: parts, events, transport and codec interfaces, tool spec, message
  record, and the public API of `ChatModel` and `ChatComposerModel`.
- Started four parallel work streams. Two failed at once with HTTP 429: the API key allows only
  a few concurrent connections. Parallel work is now capped at two sub-agents at a time.
- Gated CodeQL on repo visibility. Added a package build check to CI and to both deploy
  workflows.
