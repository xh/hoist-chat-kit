# Review 7 - Chat UI layer depth

Scope: the chat UI layer on `develop` at `9bf00bc`. That covers `desktop/cmp/chat/`,
`desktop/cmp/threads/`, `desktop/cmp/workspace/`, `cmp/markdown/`, `threads/`, `desktop/impl/`,
`styles/`, and the UI parts of `core/`. The review prepares the layer review that Anselm runs next
(HANDOFF, "Open review threads"). It proposes calls, and Anselm makes them. The review changes
no code.

## The test

A feature stays if it passes one of two tests:

1. **A consumer in hand needs it.** The consumers are the first integration, the Toolbox Guideline
   Assistant, the Toolbox Chat Kit demos, and Weather V2's Dashboard Agent.
2. **It shows the direction of chat UI.** The kit should impress customers and keep Hoist at the
   front of UI work. Agent features belong here: tool calls, approvals, AG-UI interrupts, undo of
   an agent's changes, and generative UI. Each one needs a Toolbox demo that shows it well.

A feature that fails both tests serves a backend no one has. Most of it came from app 1,
from app 2 (the OpenUI app, which will not adopt the kit), or from the design brief's wish to
serve every use case at once.

## What the first integration needs

A retrieval Q&A app with no tools, reasoning, attachments or generative UI. The server owns all
state, and the browser mints the thread ids. It needs:

- Threads: list, title search, inline rename, delete with confirm, recency groups, New Chat, a
  running badge, and turns that run on in the background.
- Document scope for each question, through the scope chip.
- `[n]` and `[n, m]` citation markers, a source list, and PDF documents in the side panel through
  `documentRenderer`. The viewer reports `opening`, `notLocated` or `error`.
- Feedback: thumbs, a required comment on thumbs down, `clearable: false`, and comments capped at
  2,000 characters.
- The no-answer reply, `textReplace` and a `textTransform`, inline errors with the
  `retryAfterSeconds` countdown, and a stall cue for answers of up to three minutes.
- The empty state with suggestions. KaTeX would be nice.

It does not need tools, approvals, interrupts, reasoning, the timeline, generative UI, attachments,
undo, Edit or Regenerate (its backend only appends, D83), pins, deep links, paging or row states
beyond "running".

**Gaps in the Toolbox recipe.** The Guideline Assistant does not set `clearable: false`,
`maxCommentLength: 2000`, `allowEdit: false`, `allowRegenerate: false` or a `textTransform`. The
integration needs all five, so the recipe should show them.

## Size of the layer

| Area | Source lines | Spec lines |
|---|---|---|
| `desktop/cmp/chat/` | about 14,000 | about 6,000 |
| Threads, thread list, workspace | about 4,600 | about 2,700 |
| `cmp/markdown/` | about 1,100 | about 600 |
| `--xh-chat-*` CSS variables | 111 | - |

The activity timeline alone is about 2,600 source lines, the largest feature in the layer.

## Proposed calls

### Cut: no consumer, and no showcase value

| Feature | Lines saved | Origin | Note |
|---|---|---|---|
| Pin: `pinThreadAsync`, `pinned`, the Pinned group | about 110 | SERVER-MODE 3.1 | No backend in hand has pins |
| Thread list paging and history paging | about 125, plus ChatModel hooks | app 2, D46 | Keep optional `cursor` fields in the store types as a cheap way back |
| Deep link `route` binding | about 70, plus 128 spec | apps 1 and 2, D74 | The "not found" half (R14) was never built: `TODO(R14, D74)` at `ChatWorkspace.ts:340` |
| `allowConcurrentTurns: false` | about 30 | app 2, D46 | No backend in hand runs one turn per user |
| Selected thread restored after a reload | about 90, plus 179 spec | D74 | Caused Major bug D-M8. No consumer asks for it |
| Stale-data warning, `dataRefreshedAt` | about 35 | app 1, D75 | An app can add it through `messageHeaderItems` |
| Markdown table cap (H7) | about 100 | design brief | A frame that scrolls sideways covers retrieval answers |
| `ChatThreadListHost` | about 95 | D57 | D82's own test drops it: one implementer, 21 members |
| `shortcuts.toggleDock` | a few | D66 | The dock was never built (`TODO(dock)`) |
| Composer pill `status` dot and `readonly` | about 40, 3 CSS variables | app 2 profiles | Keep the pill as the scope chip's base |
| Feedback `reasons`, and `commentOn: 'positive' \| 'both'` | about 150 | design brief, D70 | No backend asks for them |

**Server-minted thread ids** are also a cut candidate (`createThreadAsync`, re-keying, a delete
during a create, five hard specs). Both backends in hand mint ids in the browser. Check first:
re-keying also serves a thread id that `RUN_STARTED` assigns (D39).

### Cut list: Anselm's calls (2026-10-18)

| # | Feature | Call |
|---|---|---|
| 1 | Pin | Cut |
| 2 | Thread list paging, history paging | Cut both. Keep an optional cursor field in the store types for a hosted backend that pages history |
| 3 | Deep link `route` binding | Keep. Routing grows in Hoist apps. Build the missing "not found" view (R14) |
| 4 | `allowConcurrentTurns: false` | Cut the setting. Turns in several threads at once stay the default |
| 5 | Selected thread restored after a reload | Cut. The last thread is first in the list, one click away |
| 6 | Stale-data warning | Cut |
| 7 | Markdown table cap | Keep, with a configurable row limit, default 100 |
| 8 | `ChatThreadListHost` | Cut. D89 moves the seam to the chat behind `ChatThreadsModel` |
| 9 | `shortcuts.toggleDock` | Cut until a dock exists. Check every component in a 380 px panel |
| 10 | Composer pill `status` and `readonly` | Cut |
| 11 | Feedback `reasons`, `commentOn: 'positive' \| 'both'` | Cut |
| 12 | Server-minted thread ids | Cut the create call from the threads model. A transport for a backend that mints ids creates the thread on its first request and reports the id on `RUN_STARTED`, which D39 adopts |

Follow-ups from the walk:

- D89: build the threads-to-chat seam and the workspace's slot for an app's conversation view
  when an app needs them.
- Transport docs present a direct browser call with the user's OAuth token and a Hoist relay as
  equal options. Done, uncommitted.

### Trim: keep the feature, drop the depth

| Feature | Keep | Drop |
|---|---|---|
| Thread search | The debounced title search | `searchesMessages`, `snippet`, "Searching titles" |
| Thread row states | Running, and maybe the cheap finished-away dot | Awaiting, `lastRunEnd`, `lastRunReason` |
| Workspace layout | Collapse to a rail, a popover sidebar when narrow, a minimum conversation width, PanelModel's saved size | Width memory per band, the 60% data share, the give-way order. About 150 source and 120 spec lines |
| Side panel | The document request and `documentRenderer` | The app-content slot (`sidePanel`, `sidePanelOpen`, the toggle), which no one uses. Table and chart requests move to the generative UI layer |
| Citations | `[n]`, `[1, 2]` and `[1][2]` markers, hover cards | The grouped `[2–5]` button, range expansion, the pinned web card, Ctrl-click, Copy Excerpt |
| Sources list | Document rows, marker order, "Show N More" | Favicons and letter tiles (R9), the `url` row variant, the "searched but never cited" line |
| Feedback form (841 lines) | Thumbs, a required comment, `clearable`, the error states, the rating restored after reload | "Add a comment" after a saved rating, the counter, the "thanks" timer, the module-level `statesByThread` map (leak D-n8) |
| Status vocabulary (13 reply and 9 composer values) | Failed with Try Again, the countdown, stalled, detached, Refresh Status | Separate looks for `interrupted` and `cancelledByServer`, the `offline` state. Move the auto-retry from the status region's local model to the composer model, with a cap |
| Drafts | Drafts per thread, kept in memory | Local storage, the "Draft restored" notice, `ChatKit.clearLocalData()`. Three review 6 bugs came from it. This settles B6 |
| Shortcuts | `/` for the composer, New Chat, Esc | The remap table (B3, H5), `toggleSidebar`, F6 region cycling |
| CSS variables | About 45 tokens that apps theme: color, type, rhythm, citations, sidebar | 51 variables read once and about 15 motion knobs, which become SCSS locals. Rename `--xh-chat-mention-*`, which colors thumbs and highlights, not mentions |
| `LocalChatThreadStore` | The class, for the kit's own specs | The "demos and offline development" pitch. Mark it as a test fixture |
| `ChatToolDisplay` (6 values) | `card`, `inline`, `hidden`, and `timeline` if the timeline stays | `answer` (no user) and `pinned` (only the timeline plan) |

### Trim list: Anselm's calls (2026-10-18)

The walk set one rule: when the conversation model already holds a state, the UI that shows it is
cheap. Keep that UI.

| # | Feature | Call |
|---|---|---|
| 1 | Thread search | Keep the title search. Drop `searchesMessages`, `snippet` and "Searching titles" |
| 2 | Thread row states | Keep all four: running, awaiting, new reply, ended early. The kit also sets "ended early" from its own chats when a background reply fails or is cut short, with the store's `lastRunEnd` as the fallback for threads not open |
| 3 | Workspace layout | One saved width per panel, clamped so the conversation stays readable. Drop width memory per band, the 60% data share and the give-way order |
| 4 | Side panel | Keep as built, with the app slot and the document status line. Tables and charts go to the generative UI review |
| 5 | Citations | Keep grouping, labeled "N sources" when the numbers are not consecutive. Drop range expansion. A web citation opens like any link. Keep Copy Excerpt |
| 6 | Sources list | Drop favicons and their image rules. A web source shows a globe icon in the common row style. Drop the "searched but never cited" line |
| 7 | Feedback form | Keep "Add a comment", the counter and the "thanks" message. Replace the module-level `statesByThread` map with a draft on the chat's feedback state |
| 8 | Status vocabulary | Keep as built. Auto-retry already has a cap in `ChatComposerModel` |
| 9 | Drafts | Keep local drafts through `XH.localStorageService`, which keys by app and user. Drop the "clear on logout" guidance. Deleting a thread clears its draft. Keep `ChatKit.clearLocalData()` as a documented utility. Settles B6 |
| 10 | Shortcuts | Keep as built, without `toggleDock` |
| 11 | CSS variables | Slim and correct after the first integration sets its theme. Keep every color, type and spacing token. Make single-use sizes and motion knobs SCSS locals. Rename `--xh-chat-mention-*` |
| 12 | `LocalChatThreadStore` | Keep as a test helper beside the kit's test support. Drop the "demos and offline development" pitch |
| 13 | `ChatToolDisplay` | Merge `answer` into `inline`, which falls back to the output as markdown when there is no `renderer`. Decide `pinned` with the timeline |

### Keep, and give it a showcase

The calls below go against a strict "no consumer, cut it" reading. They follow the second test.

- **Activity timeline: trim hard, then show it in Weather V2.** A live view of an agent's steps is
  the direction of chat UI. The current build guesses too much. Drop the plan read from guessed keys
  (`PLAN_LIST_KEYS`), retry detection, three levels of sub-agent nesting, the quiet state with its
  two-minute announcement, and its own question-and-choices path, which AG-UI interrupts now
  cover. Keep a summary line ("Using 4 tools", time, failures) over flat call rows, with one level
  of sub-agent rows. Weather V2 builds a dashboard in several tool calls, so it shows the result.
- **Undo of a reply's changes: keep, and make Weather V2 its consumer.** D80 removed its first
  consumer. Weather V2's tools change the dashboard, so each tool can return
  `chatToolResult({undo})` that restores the spec. One click then undoes a whole reply. That is a
  strong demo, and it keeps D82's planned undo sub-model honest.
- **Interrupt panels: keep the model side (AG-UI requires it, D88).** Consider one form for all
  questions in place of the wizard with its review step. That removes most of
  `InterruptsLocalModel`.
- **Tool approval, reasoning, code blocks, attachments and the error boundary:** keep as built.

### Showcase: Anselm's calls (2026-10-18)

| Feature | Call |
|---|---|
| Activity timeline | Keep the summary row, steps, nested sub-agents, retry detection and the quiet state. Drop the plan, the `pinned` display and the built-in question buttons |
| Undo | Remove per-tool undo. Nothing in its place until a clear spec exists |
| Interrupt panels | Keep as built: one question at a time, then a review step |
| Tool approval, reasoning, code blocks, attachments, error boundary | Keep as built |
| Weather V2 1: build as a timeline | Do it: the dashboard tools use `display: 'timeline'` |

Weather V2 proposals 2 to 5 (preview before apply, follow-up chips, reasoning, approval for bulk
removes) are still to walk. Proposal 1 of the original list, undo, is dropped with undo.

## Library calls

- **SSE parser: keep ours.** `@ag-ui/client`'s `parseSSEStream` drops event names, fails on CRLF
  and on `data: [DONE]`, emits nothing for comment heartbeats, and works on rxjs Observables. The
  Anthropic and Chat Completions codecs depend on all four. The swap would save no lines. We took
  one idea from it: a 10 MB cap on one line or event. The cap is now in `SseParser`, uncommitted.
- **Streaming markdown: keep ours, and borrow one idea.** Streamdown bypasses Hoist's
  `Markdown`, pulls in shiki and sanitize packages, allows every image by default, and has no
  citations. Its repair step, `remend` (Apache-2.0, no dependencies, 1.4.0), looked like a fit for
  `closeMarkdownSyntax`. A scratch run of the kit's 30 closer spec cases through it matched only 15.
  It leaves code fences open, leaves trailing markers such as `**` and `` ` `` as raw text, and
  turns ``**bold `code`` into ``**bold `code**` ``, which nests wrong. Keep the kit's closer. Borrow
  one idea: a half-streamed link renders as a live link to the truncated URL today, and a spec
  asserts that. `remend` points the link at a sentinel until the URL is complete. The kit could
  render the link text with no `href` until then.
- **Partial JSON and the JSON Schema checker** belong to the generative UI review.

## The reconciliation rows

D76 says any row Anselm does not change stands as confirmed. The proposals above change these:

| Row | Built | Proposal |
|---|---|---|
| R5 | Optional `reasons` on a thumbs down | Drop `reasons` |
| R9 | Favicons follow `allowImages`, else a letter tile | Drop favicons. Sources show document rows |
| R14 | "Not found" for a missing deep-linked thread | Never built. Drop it with the `route` binding |
| R18 | `sourceType: 'url' \| 'document'` | Keep both types. Drop the web-only card behaviors |
| H2, H3 | No Redo. Retry for a failed previewed apply | Confirm, with Weather V2 as the undo consumer |
| H5 | Shortcuts remap through `ChatKit.defaults.shortcuts` | Fixed keys, each one able to turn off |
| H6 | The timeline for `display: 'timeline'` calls | Confirm, with the trimmed timeline |
| H7 | Markdown tables capped at 12 rows | Drop the cap |
| H8 | Interrupted, cancelled and detached rank with failed | Fold interrupted and cancelled into failed |
| B3 | Shortcuts on and remappable | Settle as fixed keys |
| B6 | Drafts in local storage | Settle as drafts kept in memory |

The proposals confirm R1 to R4, R6 to R8, R13, R15 to R17, R19, R20, H1, H4, B1, B2, B4 and B5 as
built.

## Weather V2 proposals

The Dashboard Agent runs on the kit: `chatPanel`, `HoistChatTransport` with `AnthropicCodec`, and
13 browser tools with cards and one approval (`reset_dashboard`). It shows little of what the kit
can do. In order of value:

1. **Undo each reply.** Each tool that changes the spec returns `chatToolResult({undo})`, which
   restores the spec from before the call. The reply then shows Undo. This is the strongest
   single addition.
2. **Show the build as a timeline.** A `set_dashboard` call and several `add_widget` calls read
   best as one summary row that opens into the steps. This uses the trimmed timeline.
3. **Preview before apply.** A large change shows an inline card of the proposed layout, with
   Apply and Discard, through a `ChatUiCatalog` component. This shows generative UI on real app
   state, and H3's retry for a previewed apply.
4. **Follow-up chips.** After a build, offer two or three next steps ("Add a precipitation
   chart", "Save as a view"). Today only a generative UI card has follow-up actions, so this
   needs the built-in card or a small catalog component.
5. **Reasoning.** Turn on extended thinking for a build request, so the reasoning disclosure has
   a live consumer.
6. **Approval for bulk removes.** Extend `needsApproval` to a reply that removes several widgets.

The Toolbox Chat Kit README also omits the Timeline and Agent Questions demos from its table.

## Proposed order

1. Anselm makes the calls above. Record each change as a decision and update
   `planning/design-reconciliation.md`.
2. Close the Toolbox recipe gaps for the first integration. They are small and unblock the port.
3. Make the cuts and trims on one feature branch, one commit per feature, with docs updated in
   the same commit.
4. Build the Weather V2 proposals on a Toolbox branch, starting with undo and the timeline.
5. Then the generative UI layer review.
