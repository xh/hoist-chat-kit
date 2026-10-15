# Handoff - Design Build, eRESI Path First

State as of 2026-10-14 evening, for the next session or after a context reset. Read this, then
`DECISIONS.md` D57 to D76 and `planning/design-reconciliation.md`.

## Where things are

| Repo and branch | State |
|---|---|
| `hoist-chat-kit` `develop` | Plan 2 core merged (#7). Snapshot `1.0.0-SNAPSHOT.1792010786479` under `next`. |
| `hoist-chat-kit` `feature/layered-api` | Pushed, no PR. `ChatComposerHost`, public `ChatStreamReducer`, `createChatRunRequest()`, D57. |
| `hoist-chat-kit` `feature/design-ui` | Stacked on `feature/layered-api`. Pushed. Tokens on the simplified CSS model (D58), D58 to D76. Build in progress. |
| `toolbox` `feature/weatherv2-chat-kit` | On the published kit. Guide folder builds and tests. Pushed. |

## Standing instructions from Anselm

- **The design handoff** (`.tmp/design-handoff/`) is the authority on look and interaction only.
  The repo decides code structure, API and behavior. Record departures as decisions.
- **CSS variables** follow hoist-react's `css-var-simplify` branch: `--xh-chat-*` only, units in
  values, no unprefixed hooks, no `-px` or `-ms` twins, Hoist's naming grammar. Reads of Hoist's
  own variables keep the installed v89 names until the kit moves to the Hoist major that renames
  them, then run Hoist's codemod.
- **Layering (D57)** is a goal, not a rule: prefer a narrow interface over a hard `ChatModel`
  dependency when cheap.
- **eRESI first.** The first real integration is the eRESI guideline assistant in Veracity
  (server-owned threads, document scope, `[n]` citations, a source viewer, feedback with a comment
  required on down, text reset). Never name the client or app in kit or Toolbox files.
- **Git.** Kit: commit and push on dedicated feature branches. Toolbox: commit and push freely on
  `feature/weatherv2-chat-kit` and new branches made for this project; never touch `develop`,
  `master` or other existing branches. Merges to `develop` need Anselm. No AI attribution.
- **hoist-react** gaps (an hourglass icon, Splitter keyboard support, a logout hook): stub in the
  kit and list them for Anselm. Do not change hoist-react.
- **Browser checks** in Toolbox may use the local link recipe in Toolbox's
  `docs/running-locally.md`. Never commit the link. A hidden tab throttles timers: set a scripted
  demo's `transport.delayMs = 0` from the page to finish it.
- Open design items B1 to B6: build to the default, mark `// TODO(design-open B<n>)`.

## Build order (eRESI path first)

1. Tokens (D58). Done.
2. P6 primitives: `ChatKit.defaults`, `ChatReplyStatus`, soft stall, live cues with reduced-motion
   twins, the announcer. In progress (agent).
3. P5 thread list (`chatThreadList`) and workspace shell (`chatWorkspace`). In progress (agent).
4. P1 restyle of the message components, the inline failed row, the status region above the
   composer (D64), and message views over a narrow interface (D57).
5. P5 composer: pills, the document scope chip (B4), status region, drafts (D67), empty state and
   suggestions that fill the composer (D71).
6. P3: sources list, citation styling and hover card, `sourceType` (D72), the no-answer data part,
   and the side panel request seam (D68) with an app-supplied document renderer.
7. P6 feedback form (D70), approvals and the keyboard map (D66).
8. Toolbox: the guideline assistant UI on these components (WP 5), checked at 1,440, 900 and 380
   px in light and dark. This is the reference for the eRESI integration.
9. Then P2 timeline, P4 result cards, P7 helper.

Each step: a sub-agent builds with specs, then a review against the screenshots in Toolbox, then
commit and push.

## Files to know

- Design: `.tmp/design-handoff/` (README, `01-decisions.md`, `04-build-map.md`, `specs/p*.md`,
  `screens/`). Reconciliation: `planning/design-reconciliation.md`.
- eRESI: `.tmp/hoist-chat-kit-feedback-1/veracity-eresi-chat-integration-brief.md` and
  `eresi-api/`. Toolbox's emulation: `client-app/src/examples/chatkit/guide/`.
- Plans: `planning/PLAN-2.md`, `SERVER-MODE.md`, `GENUI-2.md`, `HELPERS.md`.

## Running Toolbox

- Throwaway server on :8080 with an H2 database and the agent login from
  `/tmp/toolbox-agent-session.env`. Start it with the `bootRun` command in Toolbox's
  `docs/running-locally.md` ("Agent-driven sessions"). Client: `pnpm start` in `client-app`. Log in by
  POSTing to `/api/xh/login` from a page on :3000.
- Stop the servers you started when done.
