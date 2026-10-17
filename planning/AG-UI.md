# AG-UI 1.0 Adoption

The build plan for making the kit a conforming AG-UI 1.0 client: what to build, in what order,
and the evidence behind it. Agreed with Anselm on 2026-10-17. The decisions are D84 to D86 in
`DECISIONS.md`.

## Goal

- The kit is an AG-UI 1.0 client, with a published table of what it supports.
- The official AG-UI conformance suite runs in the kit's CI and proves that table.
- The kit builds on the official packages where they add value. This is Hoist's standing rule:
  use a curated library, and write our own only when we are confident it is the right choice.
  Before writing any AG-UI spec logic, check whether `@ag-ui/core` or `@ag-ui/client` has it.

## Decisions

- **D84.** Take AG-UI types from `@ag-ui/core`. Run `@ag-ui/client`'s enforcement, chunk
  expansion and sequence verification inside `AgUiCodec`. Keep the kit's own message model,
  reducer and transports. Do not let the client's agent classes own a conversation.
- **D85.** `AgUiCodec` sends every message the chat holds, in both history modes. Sending only
  new messages becomes an opt-in that the docs mark as outside the spec.
- **D86.** Interrupts use the standard AG-UI 1.0 outcome and `resume` only, and the
  `xh.chat.interrupt` event of D29 is dropped. The design is in
  [Interrupts](#4-interrupts-clarifying-questions-and-server-tool-approvals).

## Spike evidence

The spike is on the local branch `spike/ag-ui-client`, commit `eb1a522`, in the worktree
`.claude/worktrees/ag-ui-spike`. It is not for merge. Take code from it:

- `transport/impl/agUiChecks.ts` - the official checks wrapped around a decoder.
- `test/spike/AgUiConformance.spec.ts` - a runner for the conformance corpus, with the mapping
  from kit replies to AG-UI messages.
- `test/spike/AgUiPerf.spec.ts` and `test/spike/AgUiTruncated.spec.ts` - the timing and
  truncation probes.
- `test/spike/ag-ui-1.0/` - the vendored fixtures.

### Conformance

The corpus is `spec/1.0/conformance/streams` in `ag-ui-protocol/ag-ui`, commit `89cedd3`
(2026-10-16): 68 fixtures that test consumers. Its README says a third-party client relaxes
three groups: the SHOULD-level `warnings` and `noWarnings` checks, the `era-*` fixtures, and the
admitted gap `unknown-enum-value-role-fatal`. Drop the `expectOverrides.dotnet` blocks too. That
leaves 61 fixtures that apply to the kit.

With message ids and state set aside:

| Lane | Passes |
|---|---|
| `develop` | 30 of 61 |
| The official checks inside `AgUiCodec` | 51 of 61 |

The checks fix every failure about strictness: streams the spec says to reject, and fields it
says to strip. Of the 10 that still fail:

- **7 are real kit gaps**, all in message assembly: `reopen-closed-message-appends`,
  `activity-snapshot-then-delta`, `messages-snapshot-reconciles-by-id`,
  `metadata-merges-last-write-wins`, `open-metadata-preserved`,
  `tool-call-metadata-lands-on-the-call`, and sub-agent attribution on text, in
  `subagent-unannounced-attribution-accepted` and `subagent-terminal-closes-open-chunk-stream`.
- **3 are artifacts of the spike's mapping**: `encrypted-value-unknown-entity-tolerated`, where
  the kit keeps an encrypted value as a part of its own, `unknown-part-in-message-list`, which
  tests input messages the spike passed through as is, and part of the sub-agent pair above.

Also, 28 message checks fail only because the kit drops the server's message ids, and the 8
`state` fixtures fail because the kit keeps no AG-UI state.

### Speed

One 2,000-token reply, by the length of the thread before it:

| Approach | 50 messages | 200 messages | 1,000 messages |
|---|---|---|---|
| The kit alone | 2 ms | 2 ms | 2 ms |
| The official checks in front of the kit | 11 ms | 13 ms | 11 ms |
| The official agent class owning the conversation | 204 ms | 682 ms | 1,113 ms |

The agent class deep-copies its whole message list on every event. Upstream issue #2838 reports
the same in 1.0.

### Bundle

Minified and gzipped, as an app would ship them:

| What | Minified | Gzipped |
|---|---|---|
| The official checks, the D84 choice | 305 KB | 63 KB |
| `HttpAgent` | 471 KB | 96 KB |
| `@ag-ui/core` types and `EventType` | 1 KB | - |
| For scale: AG Grid community | 2,010 KB | 511 KB |
| For scale: React DOM | 610 KB | 109 KB |

Zod 3.25 is 237 KB of the checks' 305 KB. Hoist depends on Zod 4 only for its dev tooling, so
this is the first Zod in app bundles. RxJS adds 13 KB.

### Integration

- The checks run synchronously, so they wrap the decoder that `AgUiCodec.createDecoder()`
  returns. The transports, `ChatModel` and the public API do not change.
- With the checks on, 14 of the kit's own specs failed, all for one reason: their AG-UI test
  streams do not start with `RUN_STARTED`, which the spec requires.
- A stream that ends before `RUN_FINISHED` passes the checks, so `ChatModel` still fails it as
  `incomplete-stream`, and Try Again behaves as before.
- The checks print warnings with `console.warn`, not through Hoist's logging.

### The ecosystem

- Front ends outside CopilotKit mostly take `@ag-ui/core`'s types and handle messages
  themselves: TanStack AI, Tambo, and OpenUI's own adapter.
- assistant-ui uses `@ag-ui/client`'s `HttpAgent`, with its own parser and message model.
- The Vercel AI SDK and OpenAI ChatKit have no AG-UI support.
- Since 1.0 the spec is the authority. The TypeScript client is one of three first-party SDKs,
  maintained by CopilotKit, with a release every two to three weeks.
- Open upstream issues to watch:
  - #1397 and PR #1637: the client's hard Zod 3 dependency.
  - #1230: protobuf weight in `HttpAgent`.
  - #2838: the per-event deep copy.
  - #2329, #2510 and #2650: error handling.

### Server-owned history

AG-UI 1.0 says the agent "MUST treat it as the complete history it is being shown", and has no
delta mode. How real adapters treat a request that carries only new messages:

- **LangGraph** merges by message id and appends only new ones. It never treats a missing
  message as a deletion. It ends every run with a `MESSAGES_SNAPSHOT` of the whole checkpoint.
- **ADK** drops messages it has seen.
- **Mastra** dedupes by id, but a tool result must travel with the assistant message that called
  the tool, or the model calls it again.
- **Strands**, with a session manager, works with new messages only, but its default snapshot
  then holds only the current turn.
- **Pydantic AI** and **Microsoft Agent Framework** keep no state by default, and lose all
  context with new messages only.
- **CopilotKit** loads a thread through its own `connect` replay, then sends the whole thread on
  every run.

Upstream issues #2230, #2186, #1386 and #2062 ask for a delta mode, and #2475 and #2159 ask about
paged history. None has a ruling.

## Work plan

Three deliverables come first, as three pull requests to `develop`, in this order:

1. **Remove the `announceSteps` setting** (item 1). It is small, touches only desktop
   components, and shares no code with the AG-UI work, so it ships first on its own.
2. **The AG-UI protocol layer** (items 2 and 3). The official packages, the conformance suite in
   CI, and the history fix.
3. **Interrupts** (item 4). They build on the protocol layer: the official types and helpers, the
   strict checks, and a resumed run that carries the whole history (D85).

Items 5 to 7 follow. Each item is done when its specs pass, its docs are written, and the
conformance gap list is current.

### 1. Remove the `announceSteps` setting

- Remove `announceSteps` from `ChatMessageList`, `ChatMessageView`, `ChatTimeline` and
  `ChatKit.defaults`, and remove the `ChatAnnounceSteps` type.
- Keep the mid-run "Step failed" announcements as fixed behavior.
- Drop the "Step N done" mode, and the internal `stepOffset` plumbing that numbers its steps.
- Update the specs, the core and desktop chat READMEs, and D65.

### 2. The protocol layer on the official packages (D84)

1. Add `@ag-ui/core` and `@ag-ui/client` as dependencies.
2. Take the AG-UI types from `@ag-ui/core` in place of the mirrored ones in
   `transport/ChatEvent.ts`. Keep the kit's public names, such as `ChatEvent`, as aliases or
   unions over the official types, so app code does not change.
3. Bring `transport/impl/agUiChecks.ts` over from the spike, and run the checks in every
   `AgUiCodec` decoder. There is no switch to turn them off. Keep RxJS inside this module.
4. Make the kit's AG-UI test streams conform: each starts with `RUN_STARTED`. Update the
   `AgUiCodec` decoder spec for the strict behavior.
5. Vendor the corpus under `test/conformance/ag-ui-1.0/`, with its `MANIFEST.txt` and the
   upstream commit noted. Write a CI runner from the spike's runner:
   - It asserts each fixture's result against a committed list.
   - A fixture is a pass, or a known gap with its reason.
   - A gap that starts to pass must leave the list, so progress cannot regress unnoticed.
   - Document the mapping from kit replies to AG-UI messages in the runner.
6. Docs:
   - The transport README: the checks, and that a malformed AG-UI stream now fails the turn.
   - `docs/protocols.md`: the published support table, by spec area.
   - `docs/architecture.md`, and the index and registry keywords.
   - Remove the "no runtime dependency on `@ag-ui/*`" statements, which D84 retires.

### 3. History in AG-UI requests (D85)

- `AgUiCodec` sends every message the chat holds, in both modes.
- Add an opt-in for new messages only, marked in the docs as outside the spec. Settle its name
  with Anselm.
- Tool results always travel with the assistant message that called them.
- Update the transport README's "Server-owned conversations" section and
  `planning/SERVER-MODE.md`.

### 4. Interrupts: clarifying questions and server tool approvals

Write a short spec of this design for Anselm to review before any code. Use the client's helpers:
`getRunOutcome()`, `isInterruptExpired()` and `buildResumeArray()`.

Settled (D86):

- Standard AG-UI 1.0 only: the `interrupt` outcome on `RUN_FINISHED`, and `RunAgentInput.resume`.
  Document that a LangGraph agent sets `emitInterruptOutcome: true`, as LangGraph's adapter
  otherwise uses its own legacy channel.
- Answer forms: v1 renders a `responseSchema` that is a flat object of simple fields - text,
  number, date, one choice, several choices, a switch - on Hoist's `FormModel` and inputs. A
  schema beyond that shows the question, says it cannot be answered here, and offers Decline.
  Expand only on real need. AG-UI leaves the schema unbounded, so this subset is the kit's call.
- A question with no schema: a text box with Send, which answers with the text, or with no
  payload when empty, and Decline, which sends `cancelled`.
- A new message while questions are open declines them all in the run that sends it.
- Look: model the question surface on Claude Code's latest clarifying questions - a distinct,
  attractive surface with large, button-like choices.

Proposed defaults, to confirm in the spec:

- Questions show in the reply, and in the timeline for agent replies. The composer's status
  region says the reply waits for the user, as for client pauses.
- One choice field with three options or fewer shows as buttons. Anything more shows the form.
- An interrupt with a `toolCallId` uses the existing Allow and Deny card. AG-UI does not say how
  approve and deny are expressed. Check what real adapters expect before fixing a convention.
  LangGraph passes a `resolved` payload to the agent as is, and a `cancelled` one as a sentinel.
- Several questions each get a panel. The run resumes once all are answered or declined.
- A question past its `expiresAt` disables its controls, and is declined on the next run.
- Open questions live on the reply, which takes the existing `paused` status. `AgUiCodec` writes
  the `resume` list. Other codecs ignore interrupts.
- Open questions are kept in the reply's metadata, so a stored thread can carry them across a
  reload. A real backend must report them in its history. Until one exists, test against a
  scripted agent in Toolbox.

### 5. Message-assembly gaps the suite found

Close only what the suite reports:

- keep the server's message ids on parts
- append when a closed message reopens
- merge per-item metadata onto parts
- attribute text and reasoning to their sub-agent

Leave activity patches and history snapshots for item 7.

### 6. Shared state

Follow AG-UI 1.0:

- A snapshot replaces the state.
- A delta is a JSON Patch on the current state.
- The baseline is the `state` the request sent.
- The chat holds the state per thread as an observable value, sends it back on every run, and
  lets app components read and change it.

Settle these with Anselm before building:

- How a backend returns the state when a thread reloads.
- What happens if the user edits the state while a run is in progress.
- Whether to cap its size.

### 7. Later

Wait for a consumer before building these:

- **Activity patches.**
- **History snapshots.** In server mode with paged history, a snapshot cannot follow the spec's
  rules as they stand. LangGraph's carries the whole thread, so the pages not yet loaded would
  land at the bottom. Strands' carries only the current turn, so every older message would drop.
- **A status line from `STEP_*` events.**

## Working rules for this effort

- Work on a feature branch, never on `develop`. Ask Anselm before you commit, unless he says to
  commit as you go.
- Ask Anselm about any decision this plan does not settle. Do not guess, and do not build ahead
  of the plan.
- Docs are part of done: READMEs, doc comments, the index and the registry.
- Follow the `xh:clear-writing` skill for prose. No em dashes.
