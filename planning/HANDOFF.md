# Handoff

The one status document for the kit: where things stand, the standing instructions, and what
comes next. Read it at the start of a session or after a context reset, then the decisions it
names in `DECISIONS.md`.

## Where things are

| Repo and branch | State |
|---|---|
| `hoist-chat-kit` `develop` | Plan 2 (#7), the layered API and the design UI (#8) merged, then pared back: no component helper (D80), no `ChatService` (D81). The AG-UI 1.0 effort's three deliverables squash-merged and pushed on 2026-10-17. |
| `hoist-chat-kit` `archive/helpers` | The removed helper code and its plan, `planning/HELPERS.md`. Not for merge. |
| `toolbox` `feature/chat-kit-guide-ui` | Worktree `../toolbox-worktrees/feature-chat-kit-guide-ui`, on the local kit. Guideline Assistant tab and the Chat Kit demos, with the Agent Questions demo. Its last two commits, a Hoist snapshot bump and that demo, are not yet pushed. |
| `toolbox` `feature/weatherv2-chat-kit` | On the published kit. Pushed. |
| `toolbox` `archive/chat-kit-grid-helper` | The removed Grid Helper tab. Not for merge. |
| `hoist-chat-kit` `spike/ag-ui-client` | Local only, with no worktree. The AG-UI spike behind D84, cited in `planning/AG-UI.md`. Not for merge. |

## Layered API course correction (D82)

- `ChatMessageListHost` is gone. The list and view take a read-only `ChatTranscript` or a `ChatModel`, and `isChatModel()` gates every action.
- `ChatComposerHost` is trimmed to `isBusy`, `sendAsync`, `messages` and `sendBlockedReason`. Stop, drafts per thread and the status region need a `ChatModel`.
- `ChatThreadListHost` and `ChatSidePanelHost` stay as they were. `createChatRunRequest()` and `ChatStreamReducer` stay.
- Next structural task: split `ChatModel` into managed sub-models (feedback, undo, run lifecycle, thread binding), bound with `uses()`. It waits until the first integration ships.

## Next

1. The first app integration starts on the published snapshot: a guideline assistant with
   server-owned threads, document scope, `[n]` citations, a source viewer, and feedback with a
   comment required on a thumbs down.
2. Known kit gaps: no source line on help answers, no transport reconnect after a reload, no Continue
   after a reply is cut at its length limit.

## Next session: start here

The review of the kit's three layers - the engine, the chat UI and the generative UI - resumes
with Anselm. The engine work is done for now. Anselm settles whether any engine work remains, then
the review moves to the chat UI layer. See [Open review threads](#open-review-threads-with-anselm).

## AG-UI 1.0 effort: done (2026-10-17)

The engine layer is now an AG-UI 1.0 client on the official packages. The plan and evidence are in
`planning/AG-UI.md`, the interrupt design in `planning/INTERRUPTS.md`, and the decisions in D84
to D88. Three squash commits on `develop`:

1. **Remove `announceSteps`.** Failed steps are always announced. The "Step N done" mode is gone.
2. **The protocol layer.**
   - Event types come from `@ag-ui/core`.
   - `AgUiCodec` runs `@ag-ui/client`'s checks on every stream and request. A rejected stream
     fails as `invalid-stream`, and a rejected request as `invalid-request`.
   - Each request carries the whole history, with the server's message ids (D85, D87). The
     `newMessagesOnly` opt-in is outside the spec.
   - The chat reads on after `RUN_ERROR`, so a later run in the stream can follow.
   - The official conformance corpus runs in `pnpm test`, against a committed gap list.
3. **Interrupts.**
   - A server agent's questions and tool approvals pause the reply. The chat answers in the next
     run's `resume`, and covers every interrupt as AG-UI requires.
   - Answer panels in Claude Code's style, Hoist forms of simple fields, and a review step.
   - `ChatTransport.resume()` is now `reconnect()`.

Conformance stands at 44 of the 61 fixtures that apply. The 17 gaps are listed with reasons in
`test/conformance/agUiKnownGaps.ts`:

- 8 shared state (plan item 6)
- 3 metadata on parts and calls, and 2 sub-agent attribution of text (plan item 5)
- 2 history snapshots and 1 activity patch (plan item 7)
- 1 by design: an encrypted value with no message keeps a part of its own

Engine work still on the table, for Anselm to decide on:

- **Item 5** - metadata on parts and calls, and sub-agent attribution of text.
- **Item 6** - shared state. Settle first: how a backend returns the state on reload, edits
  during a run, and a size cap.
- **Item 7** - activity patches, history snapshots and a status line from `STEP_*`. Wait for a
  consumer.
- **Curated libraries** - whether `@ag-ui/client`'s `parseSSEStream` should replace the kit's
  own SSE parser.

The official client's checks warn through the console, not Hoist's logging (D84). Toolbox's Agent
Questions demo shows each interrupt shape. The spike behind D84 is on the local branch
`spike/ag-ui-client`. It is not for merge.

## Open review threads with Anselm

A layer-by-layer review of the kit is in progress, to find what the OpenUI-based enterprise app's
feedback drove too far. That app has committed to OpenUI and will not adopt the kit. These are
topics to discuss with Anselm, not work to start.

- **Done:** the engine layer. It led to the AG-UI effort above, now merged.
- **Next:** the chat UI layer. Check its depth feature by feature. Much of it came from a design
  brief that aimed at all four use cases at once. Walk the design reconciliation rows (R1 to R20,
  H1 to H8 in `planning/design-reconciliation.md`) as part of it. The build followed each
  recommendation (D76), and any row Anselm does not change stands as confirmed.
- **Then:** the generative UI layer. Each of these has no consumer outside that app:
  - nested documents, with slots and the `show_ui` tool
  - the `ChatUiAdapter` socket
  - catalog versions and migrations
  - the five action types
  D15's premise, winning that client back from OpenUI, no longer holds. Toolbox uses only
  per-component tools with the four built-ins.
- **Stale decisions:** D61 plans assistant profiles and `metadata.assistantId`. Neither was
  built.
- **Curated libraries:** at each layer, ask whether a library should replace the kit's own SSE
  parser, its parser for partial JSON, its JSON Schema checker or its streaming markdown. The
  research names Streamdown for markdown.

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
- **Git.** Kit: commit on feature branches as you go when Anselm asks for it, never on
  `develop`. Anselm pushes and opens the pull requests. Toolbox: ask before a commit, and never
  commit on `develop`, `master` or other existing branches. No AI attribution.
- **Hoist snapshot.** Always take the latest `next` snapshot when the lockfile changes.
- **hoist-react.** Do not change it. Stub a gap in the kit and list it for Anselm.
- **Open design items** B1 to B6: build to the default, and mark `// TODO(design-open B<n>)`.

## Upstream asks

- xh/hoist-core#618 (open): streaming responses and a streaming proxy mode. Each app now relays a
  token stream with its own Groovy, and `renderNDJSON` buffers 32 KB before it flushes.
- xh/hoist-react#4855 (open): let `FetchService` abort a streamed response. The kit works around it
  with `fetchOpts.signal` (D14).
- Icons: Hoist registers no hourglass or code-branch icon. The kit uses stand-ins.

## Toolbox worktree

- `../toolbox-worktrees/feature-chat-kit-guide-ui` (branch `feature/chat-kit-guide-ui`). The main
  `../toolbox` checkout belongs to another session. Never touch it.
- The worktree links the local kit through uncommitted edits to `client-app/package.json`,
  `pnpm-lock.yaml`, `rsbuild.config.mjs` and `tsconfig.json`. The `tsconfig.json` edit is the
  `paths` block from Toolbox's `docs/running-locally.md`, which gives `tsc` one copy of Hoist's
  types. Never commit those four. Commit with explicit paths.
- To bump Hoist in Toolbox, set the four aside, run `pnpm update @xh/hoist` in `client-app`,
  stage the lockfile, then restore the link edits and run `pnpm install` before committing.
- The local kit is the main checkout, so Toolbox shows whichever kit branch is checked out.

## Running Toolbox

- Start a throwaway server on :8080, with an H2 database and the agent login, by the `bootRun`
  command in Toolbox's `docs/running-locally.md` ("Agent-driven sessions"). Start the client with
  `pnpm start` in `client-app`. Log in by POSTing to `/api/xh/login` from a page on :3000.
- The live model demo needs the `llmApiKey` and `llmModel` configs. The other demos are scripted.
- A hidden tab throttles timers. Set a scripted demo's `transport.delayMs = 0` from the page to
  finish it.
- Stop the servers you started when done.

## Files to know

- Plans: `planning/AG-UI.md` (the current effort), `planning/INTERRUPTS.md`,
  `planning/PLAN-2.md`, `planning/SERVER-MODE.md`, `planning/GENUI.md`.
- AG-UI conformance: `test/conformance/README.md`, and the gap list beside it.
- Design: `.tmp/design-handoff/` and `planning/design-reconciliation.md`.
- The first integration's brief and API: `.tmp/hoist-chat-kit-feedback-1/`. Toolbox's emulation:
  `client-app/src/examples/chatkit/guide/`.
- Reviews: `planning/reviews/`.

## Release notes for later

- npm's `latest` tag points at a snapshot from the first setup publish, because npm tags a
  package's first publish as `latest`. Correct it at the first real release.
