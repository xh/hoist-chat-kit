# Handoff

The one status document for the kit: where things stand, the standing instructions, and what
comes next. Read it at the start of a session or after a context reset, then the decisions it
names in `DECISIONS.md`.

## Where things are

| Repo and branch | State |
|---|---|
| `hoist-chat-kit` `develop` | Plan 2 (#7), the layered API and the design UI (#8) merged, then pared back: no component helper (D80), no `ChatService` (D81). Published under `next`. |
| `hoist-chat-kit` `archive/helpers` | The removed helper code and its plan, `planning/HELPERS.md`. Not for merge. |
| `toolbox` `feature/chat-kit-guide-ui` | Worktree `../toolbox-chatkit`, on the local kit. Guideline Assistant tab and the Chat Kit demos. Pushed. |
| `toolbox` `feature/weatherv2-chat-kit` | On the published kit. Pushed. |
| `toolbox` `archive/chat-kit-grid-helper` | The removed Grid Helper tab. Not for merge. |

## Layered API course correction (D82)

- `ChatMessageListHost` is gone. The list and view take a read-only `ChatTranscript` or a `ChatModel`, and `isChatModel()` gates every action.
- `ChatComposerHost` is trimmed to `isBusy`, `sendAsync`, `messages` and `sendBlockedReason`. Stop, drafts per thread and the status region need a `ChatModel`.
- `ChatThreadListHost` and `ChatSidePanelHost` stay as they were. `createChatRunRequest()` and `ChatStreamReducer` stay.
- Next structural task: split `ChatModel` into managed sub-models (feedback, undo, run lifecycle, thread binding), bound with `uses()`. It waits until the first integration ships.

## Next

1. The owner confirms the design reconciliation defaults (D76, `planning/design-reconciliation.md`).
2. The first app integration starts on the published snapshot: a guideline assistant with
   server-owned threads, document scope, `[n]` citations, a source viewer, and feedback with a
   comment required on a thumbs down.
3. Known kit gaps: no source line on help answers, no transport resume for a reconnect, no Continue
   after a reply is cut at its length limit.

## Standing instructions from Anselm

- **Scope.** Build for the integrations in hand. A use case on the table is not a request to build
  it. Ask hoist-react and hoist-core only for what the kit cannot work without.
- **The design handoff** (`.tmp/design-handoff/`) is the authority on look and interaction only.
  The repo decides code structure, API and behavior. Record departures as decisions.
- **CSS variables** follow hoist-react's `css-var-simplify` branch: `--xh-chat-*` only, units in
  values, no unprefixed hooks, no `-px` or `-ms` twins, Hoist's naming grammar. Reads of Hoist's
  own variables keep the installed v89 names until the kit moves to the Hoist major that renames
  them, then run Hoist's codemod.
- **Layering (D57, D82)** is a goal, not a rule: prefer a narrow interface over a hard
  `ChatModel` dependency only where a second implementer really exists.
- **Names.** Never name a client or a private app in kit or Toolbox files. Toolbox may be named.
- **Git.** Kit: commit and push on feature branches, and open PRs to `develop`. Merges to
  `develop` need Anselm's request. Toolbox: commit and push only on branches made for this
  project, never on `develop`, `master` or other existing branches. No AI attribution.
- **hoist-react.** Do not change it. Stub a gap in the kit and list it for Anselm.
- **Open design items** B1 to B6: build to the default, and mark `// TODO(design-open B<n>)`.

## Upstream asks

- xh/hoist-core#618 (open): streaming responses and a streaming proxy mode. Each app now relays a
  token stream with its own Groovy, and `renderNDJSON` buffers 32 KB before it flushes.
- xh/hoist-react#4855 (open): let `FetchService` abort a streamed response. The kit works around it
  with `fetchOpts.signal` (D14).
- Icons: Hoist registers no hourglass or code-branch icon. The kit uses stand-ins.

## Toolbox worktree

- `../toolbox-chatkit` (branch `feature/chat-kit-guide-ui`). The main `../toolbox` checkout
  belongs to another session. Never touch it.
- The worktree links the local kit through uncommitted edits to `client-app/package.json`,
  `pnpm-lock.yaml`, `rsbuild.config.mjs` and `tsconfig.json`. Never commit those four. Commit
  with explicit paths.

## Running Toolbox

- Start a throwaway server on :8080, with an H2 database and the agent login, by the `bootRun`
  command in Toolbox's `docs/running-locally.md` ("Agent-driven sessions"). Start the client with
  `pnpm start` in `client-app`. Log in by POSTing to `/api/xh/login` from a page on :3000.
- The live model demo needs the `llmApiKey` and `llmModel` configs. The other demos are scripted.
- A hidden tab throttles timers. Set a scripted demo's `transport.delayMs = 0` from the page to
  finish it.
- Stop the servers you started when done.

## Files to know

- Plans: `planning/PLAN-2.md`, `planning/SERVER-MODE.md`, `planning/GENUI.md`.
- Design: `.tmp/design-handoff/` and `planning/design-reconciliation.md`.
- The first integration's brief and API: `.tmp/hoist-chat-kit-feedback-1/`. Toolbox's emulation:
  `client-app/src/examples/chatkit/guide/`.
- Reviews: `planning/reviews/`.

## Release notes for later

- npm's `latest` tag points at a snapshot from the first setup publish, because npm tags a
  package's first publish as `latest`. Correct it at the first real release.
