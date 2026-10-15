# Design Handoff Reconciliation

This doc checks the design handoff in `.tmp/design-handoff/` against `DECISIONS.md` (D1 to D57),
the plan docs in `planning/` and the current code. Anselm reads it before the build starts.

The handoff is the authority on visual design and interaction. The repo is the authority on
implementation, coding patterns, public API shape and core behavior. Where the two conflict on
one of the latter, the recommendation is the repo's approach, marked **repo default**. Where the
design's approach is clearly better for users, the recommendation says so.

Section 1 lists only real contradictions that `01-decisions.md` sections C and D leave open.
Section 2 drafts the decision entries, numbered from D58. Each draft follows the recommended
default of section 1, so a different answer there changes the draft.

## 1. Conflicts

### Handoff against the repo

**R1. Try Again needs a retry-safe signal.**
- Handoff: P5 status region rules, P6 status vocabulary (11) and error tiers. Offer Try Again only
  when the server marks a failure retry-safe, else Refresh Status. `02-backend-capabilities.md`
  row 5 makes Refresh Status the fallback.
- Repo: D34, D43 and D44 end each failure "with Retry". `retryAsync()` always resends. D19 makes
  `turnId` an idempotency key so that a retry is safe on a backend that honors it.
- Why it matters: under the fallback, a client-mode chat (Toolbox, every helper) loses its only
  recovery. Refresh Status has no model method outside the thread layer
  (`ChatThreadsModel.reloadThreadAsync()`, D46).
- Options: (a) the handoff as written. (b) Retry-safe by default, and a backend opts out with
  `RUN_ERROR.metadata.retrySafe: false`. (c) Option b, plus the kit treats its own `stalled` and
  `incomplete-stream` errors as not retry-safe in server mode, because the server may still run.
- Recommend: c. It keeps the repo default, and the server-mode exception is clearly better for
  users: it stops a resend from running a write twice. Refresh Status shows only when a thread
  layer can reload. Without one, Try Again shows with "It may still be running".

**R2. The duplicate-request wait retries by itself.**
- Handoff: P5 composer state 6 and status region rules. Count down from the server's wait, retry
  at zero, offer Cancel.
- Repo: `ChatRunError.retryAfterSeconds` is this case. `SERVER-MODE.md` 2.5 shows a countdown
  before a manual Retry.
- Recommend: the design, which is better for users. The server named the wait, and `turnId` makes
  the retry idempotent. Retry by itself only when the error is retry-safe (R1).

**R3. Stop waits up to 10 s for the server.**
- Handoff: P6 status vocabulary (8) and `CHAT_TIMING.stopConfirmTimeoutMs`. "Stopping…" until the
  server confirms, then Aborted plus Refresh Status.
- Repo: D38 and `SERVER-MODE.md` 2.4. `stop()` aborts at once, marks the reply aborted, and sends
  `cancelAsync()` without waiting. The model logs a failed cancel and never shows it.
- Recommend: **repo default**. A stop that the user sees take effect at once is the core contract.
  The kit has no confirmation signal to wait for.

**R4. "Detached" means two different things.**
- Handoff: P6 status vocabulary (9). "Continues in [thread]", with a link to another thread's row.
- Repo: D38 and D42. A detached reply is one the user left running on the server, in the same
  thread (`metadata.detached`).
- Recommend: **repo default** meaning. Show a detached reply as P5's "Still working" with Refresh
  Status. Build the link to another thread only if a backend event names one. No such event
  exists.

**R5. A down vote needs a comment, and feedback has reasons.**
- Handoff: P6 Feedback and P1 action bar rules. A down vote saves nothing until the user sends
  a required comment. Reasons are optional toggles. An up vote offers an "Add a comment" link.
- Repo: `ChatFeedbackConfig` has `commentOn` (default `negative`) and `requireComment` (default
  false). `ChatFeedbackSpec` has no reasons.
- Recommend: **repo default** for the config. Apply the design's flow when `requireComment` is
  true. When it is false, a down vote saves at once and the form is optional. Add `reasons` to the
  config and the spec (D70). The design's premise, "the backend rejects a down vote without
  one", is one backend's rule, not the kit's.

**R6. The model reports failures with toasts.**
- Handoff: P6 error tiers. Feedback fails inline in its form. The helper uses no toasts. A toast
  is only for what is off screen.
- Repo: `ChatModel.submitFeedbackAsync()` rolls back with a toast. `undoTurnAsync()` reports a
  failed undo with a toast (D48).
- Recommend: the design. Where an error shows is interaction. The model records the failure in an
  observable and the component renders it inline. An app that uses the engine alone (D57) reads
  the same observable.

**R7. Suggestions send on click.**
- Handoff: P5 empty state, P4 and P7. An empty-state suggestion fills the composer and never
  sends.
- Repo: `ChatSuggestions` sends the prompt on click, unless the app passes `onSelect`.
- Recommend: the design, which is better for users. The user reads and edits the prompt before it
  goes. Follow-up chips on a reply (P4) still send. Note the change in the changelog.

**R8. A follow-up chip's tooltip shows only its own text.**
- Handoff: P4 follow-ups. Truncate a long chip and show its full text in a tooltip.
- Repo: D17 and D56. A model-written button's tooltip shows the prompt and the `context` it
  sends, because the label can differ from the prompt.
- Recommend: **repo default**. It is a security rule. A chip whose label equals its prompt meets
  both.

**R9. Favicons load from server URLs.**
- Handoff: P3 sources list and hover card. The server supplies favicons, else a letter tile.
- Repo: D16 and D33. An image URL loads only if `allowImages` permits it, because an image
  request can leak conversation data.
- Recommend: **repo default**. A favicon URL follows `allowImages`. Inline `data:` favicons always
  show. Otherwise show the letter tile.

**R10. The helper adapter replaces tool groups.**
- Handoff: P7 spec, `ChatHelperAdapter` (`boundary()`, `snapshot()`, `restore()`,
  `isChangedSince()`, `highlight()`, `docs`) and `HelperTool` (`preview: 'never' | 'auto' |
  'always'`, `run()`).
- Repo: `ChatToolGroup` `{tools, contextProvider, prompt, suggestions}` (D51), tools as
  `ChatToolSpec` with `chatToolResult(result, {undo})` (D48). `ChatToolSpec.preview` (D49, D53)
  means what to render before approval. `needsApproval` means ask first.
- Why it matters: `preview` would mean two things. P7's `preview: 'always'` is the repo's
  `needsApproval: true`.
- Recommend: **repo default**. Add P7's extra members to `ChatToolGroup` as optional fields (D73).
  Map `'always'` and `'auto'` onto `needsApproval`.

**R11. Which helper changes ask first.**
- Handoff: P7 "Making changes". Removals wait for Apply. The helper never saves a view, submits a
  form or presses a host button.
- Repo: D51. `remove_widgets` and `set_dashboard` apply at once. `save_view` and `open_view` exist
  and are on by default when a view manager is present.
- Recommend: the design for removals, which is better for users: `remove_widgets` and a
  `set_dashboard` that drops widgets get `needsApproval`. For views, keep the tools but take
  `views` out of the default capabilities, so an app opts in.

**R12. Helper conversations do not persist.**
- Handoff: A2 and P7 "Conversation lifetime". The conversation lives and dies with the page.
- Repo: `HELPERS.md` 4. "Persistence is optional: the last conversation per component through
  `persistWith`."
- Recommend: A2, which Anselm decided. Update `HELPERS.md`. Listed here because section A, not C or
  D, settles it.

**R13. The inline grid goes away.**
- Handoff: B1 and P4. Never mount a Grid inline. A result renders as a plain preview table, and the
  Grid opens only in the side panel.
- Repo: `GENUI-2.md` 5 keeps "the existing inline-data grid" for small results.
  `chatUiGrid` and `chatUiGridSpec()` (D15, D18) mount a Hoist Grid inline today.
- Recommend: build to B1, keep the public names. `chatUiGrid` renders the preview tier and opens
  the Grid in the side panel (D69). Update `GENUI-2.md` 5.

**R14. A missing deep-linked thread.**
- Handoff: P5 "Opening a thread". Show "Thread not found" for a deep link the user cannot open.
- Repo: `SERVER-MODE.md` 3.3 rule 8 and D46. A 404 or an empty page means an empty thread.
- Recommend: keep rule 8 for a thread this session created. A route-selected id that the list
  does not hold and the store reports as 404 is "not found" (D74).

**R15. `agentIcon` against `assistantIcon`.**
- Handoff: A5, `agentIcon`, kit-wide and per agent profile.
- Repo: `ChatMessageList` and `ChatMessageView` take `assistantName` and `assistantIcon`, with
  `Icon.ai()` as the default. The helper plan names `ChatAssistantModel` and
  `chatAssistantButton`.
- Recommend: **repo default** naming. Call it `assistantIcon` everywhere, and call a profile a
  `ChatAssistantProfile` (D61).

**R16. A "Not sent" state on the user message.**
- Handoff: P1 user message matrix and P6 error tiers. "Not sent." under the bubble, with Edit.
- Repo: a turn's failure lives on its assistant reply (`ChatMessageStatus`). User messages carry
  no failure state.
- Recommend: **repo default** model. The view shows "Not sent" when the turn failed before the run
  started, for example offline or a failed thread create (D43). No new message status.

**R17. A `noAnswer` part type.**
- Handoff: P3 "No answer". Render the template from a structured `noAnswer` part from the server.
- Repo: D2 fixes the part types, and D8 routes app content through `data` parts.
- Recommend: **repo default**. A `data` part with the reserved `dataType` `xh.chat.noAnswer`, sent
  as an `xh.chat.data` event (D72).

**R18. Internal and external sources act differently.**
- Handoff: P3 marker rules. An internal marker opens the viewer, an external one pins its card,
  and Ctrl/Cmd-click opens a new tab.
- Repo: `ChatSourcePart` has no kind. `onSourceClick` defaults to opening `source.url` in a new tab
  (`SERVER-MODE.md` 4.2).
- Recommend: add `sourceType: 'url' | 'document'` to `ChatSourcePart`, after the AI SDK's
  `source-url` and `source-document` parts (D2). Keep `onSourceClick` as the seam (D72).

**R19. Source numbers.**
- Handoff: P3 and B5. "Number sources in order of first citation, matching the markers."
- Repo: `marker` is the number that the text cites (`SERVER-MODE.md` 4.2).
- Why it matters: if a server's numbers do not follow first citation, the list must either break
  its sequence or renumber, and renumbering breaks the match with the text.
- Recommend: **repo default**. List sources in marker order and never renumber. A server that
  numbers in first-citation order gets the design as drawn.

**R20. CSS class names.**
- Handoff: `css/*.css` uses short blocks: `.xh-chat-msg`, `.xh-chat-cp*`, `.xh-chat-ws`,
  `.xh-chat-fb`, `.xh-chat-skel`.
- Repo: D1 and D10 BEM names on the shipped components: `xh-chat-message`, `xh-chat-composer`.
  Apps can already style against them.
- Recommend: **repo default**. Port the rules onto the kit's class names. New components take full
  BEM names (`xh-chat-workspace`, `xh-chat-feedback-form`).

### Within the handoff

| # | Contradiction | Recommend |
|---|---|---|
| H1 | Large export confirm: P4 `table.exportConfirmAbove` is 10,000 rows. P6 says over 100,000 rows or about 25 MB. | One app-set threshold, default 10,000 rows, on `ChatUiGrid.defaults`. |
| H2 | After Undo: P4's apply matrix shows Redo. P6 and P7 say no Redo. | No Redo, as D48 has none. |
| H3 | A failed apply: P4 and P6 keep the card proposed with Retry. P7 says "Nothing changed" and no Retry. | Retry for a previewed apply that fails. No Retry for a change that applied at once. |
| H4 | Esc order: `01-decisions.md` C says popover, hover card, side panel, helper. P6 says popup, inline edit, stop. P7 says popup, stop, close helper. P3 closes the viewer on Esc. | Popups first, then the region with focus acts: the viewer closes, an edit cancels, a reply stops, a helper closes. One action per press. |
| H5 | Remapping: P5 and P6 say apps remap with "Hoist hotkeys". B3 says kit config. Hoist's `useHotkeys` registers keys but offers no app-wide remap. | Kit config, per B3 (D66). |
| H6 | P1 groups reasoning and tool calls into a process group of 28 px rows. P2 puts tool calls in a timeline block. No spec says which a reply gets. | The timeline block for `display: 'timeline'` calls (D23). P1 rows for `card` calls and for reasoning alone. |
| H7 | P1 renders markdown tables of up to 12 rows inline. B1 caps a preview at 8 rows. | Markdown tables of up to 12 rows stay plain. Larger ones get the preview card. |
| H8 | P5's status region priority lists 9 states. P6 adds interrupted, cancelled by the server and detached, with no place in the order. | Rank them with failed. |

P1's chart height (172 px, 140 docked) differs from P4's (220, 160). The README rule that a spec
table beats a frame settles it for P4.

## 2. Draft decision entries

Each entry is in `DECISIONS.md` format. The italic *From* line under each heading names its
source, and goes when the entry moves to `DECISIONS.md`.

D57 applies to every new component. These are the narrow interfaces the specs allow, in the
pattern of `ChatComposerHost`:

| Component | Depends on |
|---|---|
| Composer status region | `ChatComposerHost`, extended with an optional `replyStatus`, `retryAsync()` and `refreshStatusAsync()` |
| Reply header, failed row, live cues | A `ChatMessage` and a `ChatReplyStatus` (D62), not the model |
| Feedback form | `ChatFeedbackHost`: `canSubmitFeedback`, `feedbackConfig`, `submitFeedbackAsync()` |
| Timeline approval and question panels | `ChatApprovalHost`: `approveToolCallAsync()`, `denyToolCallAsync()`, `addToolOutputAsync()` |
| Thread list | `ChatThreadListHost`: threads, selection, the rename, pin and delete actions. `ChatThreadsModel` implements it |
| Side panel, citations, result cards | `ChatSidePanelHost` (D68), so a card works without a workspace |
| Announcer | Plain calls, `announce(text, politeness)`. No model |
| Helper button and container | A `ChatToolGroup` and a host that owns a `ChatModel`. `ChatAssistantModel` is one host |

## D58. Design tokens replace the kit's theme variables

*From: all specs, `css/*.css`, `01-decisions.md` D, `04-build-map.md`.*

**Decision.** `styles/vars.scss` takes the design's tokens and drops the old names, with no
aliases. The kit is pre-1.0 (D26), so the changelog lists the renames as breaking.

- Sizes are unitless numbers with a `-px` twin, as Hoist's `--xh-pad` and `--xh-pad-px` are.
  Timings are unitless milliseconds with a `-ms` twin. Percentages and easing curves have no twin.
- Each `--xh-chat-*` token reads an unprefixed hook first, as today: `--chat-turn-gap` overrides
  `--xh-chat-turn-gap`. Tokens live on `body`, so a hook works only on `body` or above.
- Values follow the specs: one 4 px radius, a 1,100 px column and a 640 px prose cap, a 13 px body,
  full `--xh-border-color` frames, and no shadows or literal colors.
- `--xh-chat-meta-text-color` is the one dark override, for contrast (A6).
- `.xh-chat--compact` sets the compact values on the `-px` twins directly, because a descendant
  cannot re-derive a twin computed on `body`. A component sets it when docked or under 380 px of
  measured width.
- The renames follow the table in `04-build-map.md`. Each component's tokens sit in its own section
  of `vars.scss`.

**Why.** Hoist's own variables use unitless numbers with twins, so apps theme the kit as they theme
Hoist. The old px-only names could not feed a `calc()` with other Hoist sizes.

**Alternatives.** Keep the old names as aliases. They would double the token list before 1.0, when
no release promises them.

## D59. Kit-wide settings live in `ChatKit.defaults`

*From: A1, A5, B3, B6, P2, P6, `01-decisions.md` D.*

**Decision.** `core/ChatKit.ts` exports `ChatKit`, a class with a `static defaults` object, as
`GridModel.defaults` and `FetchService.defaults` are in Hoist. An app sets fields at startup, in
its `AppModel` or `Bootstrap.ts`. A setting that belongs to one component sits in that component's
`defaults`, as with Hoist's `Button.defaults`. Instance config and props always win. Section 3
lists every setting and its home.

**Why.** A library has no app config of its own, and several settings span many components. Hoist's
`static defaults` pattern needs no service install and no server round trip, and Hoist developers
already know it.

**Alternatives.** Fields on `ChatService`. It is optional, it reads the backend config (D50), and a
chat without a backend still needs these settings. A soft config. It suits server-admin settings,
but icons and key bindings are code.

## D60. Reduced motion, with `reducedMotionSpinner`

*From: A1, P1, P6.*

**Decision.** Under `prefers-reduced-motion: reduce`, or inside an `.xh-chat--reduced-motion`
element, each moving cue in chat has a static twin: a solid caret, no shimmer, instant reveals,
and text that lands in whole lines at most 4 times a second. The ticking elapsed time and the
status words still show "busy". `ChatKit.defaults.reducedMotionSpinner` is `'static'` or `'spin'`,
default `'static'`. Static swaps Hoist's `Spinner` for a static hourglass icon inside chat only.
`'spin'` keeps Hoist's spinner.

**Why.** Anselm chose the static spinner (A1). Hoist's spinner ignores reduced motion on purpose,
because Citrix sessions often report it. The flag lets an app on Citrix keep Hoist's behavior.

## D61. The assistant icon and assistant profiles

*From: A5, P1, P5, P7.*

**Decision.** `ChatKit.defaults.assistantIcon` is a function that returns the icon, default
`() => Icon.ai()`. A `ChatAssistantProfile` `{id, name, icon?, description?, status?}` overrides it
for one assistant. A component's `assistantIcon` prop overrides both. The reply header, the
empty state, the helper button and header, the workspace header and the launcher read it in that
order: prop, profile, kit default. A reply names its profile in `metadata.assistantId`, set from a
routing event when the backend sends one.

**Why.** Anselm chose sparkles, never the wand, and made it configurable (A5). The kit already names
the props `assistantName` and `assistantIcon`, and a second word for the same thing would split the
API (R15). A function returns a fresh element for each use.

## D62. A display status over the existing statuses

*From: P6 status vocabulary, P1, P2.*

**Decision.** `ChatReplyStatus` is the display vocabulary: `idle`, `submitted`, `streaming`,
`recomposing`, `runningTool`, `paused`, `waitingToRetry`, `detached`, `stalled`, `interrupted`,
`cancelledByServer`, `error` and `aborted`. A pure function in `core/` derives it from a message,
its turn's activity time and the clock. `ChatStatus` and `ChatMessageStatus` do not change. Each
value has one icon, one label and one color in one desktop table.

- `interrupted` and `cancelledByServer` come from `RUN_ERROR` codes `interrupted` and `cancelled`,
  with the server's text as the reason.
- `waitingToRetry` is an error with `retryAfterSeconds` while its countdown runs.
- P6's `stopping` state is left out, as `stop()` takes effect at once (R3).

**Why.** The specs need a richer vocabulary than the model's lifecycle, but most of it is a reading
of state the model already holds. A derived value keeps the model's statuses small, and a pure
function is easy to test against P6's matrix.

**Alternatives.** Add the states to `ChatMessageStatus`. Stored history would then hold clock
states such as `stalled`.

## D63. Stalled is a soft state before D34's hard timeout

*From: P6, P2, `01-decisions.md` D, `02-backend-capabilities.md` row 3.*

**Decision.** A reply is `stalled` after `ChatKit.defaults.stallAfterMs` (30 s) with no bytes,
heartbeats included. Its spinner and caret give way to "No response for 30s" in place, the status
region offers Refresh Status where it can (R1), and Stop stays. The next byte clears it with no
notice. With heartbeats but no events, a timeline shows P2's quiet state, which keeps its spinner.
D34's `idleTimeout` stays the hard failure and must be longer than `stallAfterMs`. A transport
reports each byte it reads, decoded or not, through a new activity callback on the step, so the
model sees heartbeats that never decode.

**Why.** Slow is not broken. A soft state tells the user early without ending a run that may still
answer. Today a heartbeat resets the transport's timer but never reaches the model.

## D64. A failure shows inline, and the next action sits above the composer

*From: P1, P5, P6, `01-decisions.md` C and D.*

**Decision.** The inline failed row in the reply records what happened, with Edit Prompt and Copy
Details. The composer's status region holds the thread's one next action. `ChatErrorBanner`, an
internal component, goes. A body-wide error uses Hoist's `ErrorMessage`.

- "Try Again" resends a turn. "Retry" re-fetches a part.
- A failure is retry-safe unless `RUN_ERROR.metadata.retrySafe` is false. In server mode, the kit's
  own `stalled` and `incomplete-stream` errors are not retry-safe. This amends D34 and D44 for
  server mode.
- A failure that is not retry-safe offers Refresh Status, which calls
  `ChatThreadsModel.reloadThreadAsync()`. Without a thread layer it offers Try Again with "It may
  still be running".
- A retry-safe error with `retryAfterSeconds` counts down and retries at zero, with Cancel.
- The model records feedback and undo failures in observables, and shows no toasts. Components
  render them inline.

**Why.** A failure shows once, at the smallest scope that holds it (P6). A resend that could run a
write twice needs the server's word that it is safe. A client-mode chat keeps its Try Again (R1).

## D65. One announcer for the chat

*From: P1, P2, P6, `01-decisions.md` C.*

**Decision.** The message list is `role="log"` with `aria-live="off"`. A kit announcer renders two
hidden live regions, one polite and one assertive. The announcer reads a finished reply once: the
assistant, its tool count and time, then its first paragraph, cut at 300 characters. Polite
announcements wait at least 2 s apart and coalesce. Assertive ones never wait. Tokens, verb
changes, elapsed ticks and countdown seconds are never announced. `announceSteps` is `'none'`,
`'failures'` or `'all'`, default `'failures'`, in `ChatKit.defaults` and as a message list prop.

**Why.** A live region on the list reads every token. One announcer keeps announcements spaced and
in order across the list, the timeline and the composer.

## D66. The keyboard map, configurable

*From: P6 keyboard map, P5, P7, B3.*

**Decision.** `ChatKit.defaults.shortcuts` maps each action to a key combo, in the format of Hoist's
`useHotkeys`, or to null to drop it:

| Action | Default | Scope |
|---|---|---|
| `newChat` | `mod+shift+o` | Workspace or dock |
| `toggleDock` | `ctrl+.` | Page-wide, only while a dock exists |
| `openHelper` | `mod+i` | Focus inside a component with a helper |
| `focusComposer` | `/` | Focus outside a text field |
| `cycleRegions` | `f6`, Shift+F6 back | Workspace, dock or helper |
| `toggleSidebar` | null | Workspace |

Esc does one thing per press, scoped to the region with focus (H4). No shortcut ever approves,
applies or deletes.

**Why.** Browsers bind some of these keys, so each needs a remap or a way out (B3). Hoist's hotkeys
register keys but offer apps no remap, so the kit owns the map (H5).

## D67. Drafts persist in local storage

*From: B6, P5.*

**Decision.** The composer saves its draft text per thread, after each 500 ms pause, through
`XH.localStorageService`, which keys by app and user. Attachments stay in memory only. A restored
draft shows "Draft from 10:31 restored" with Discard. The draft goes when its message sends.
`ChatKit.defaults.drafts` is `'local'` or `'memory'`, default `'local'`. `ChatKit.clearLocalData()`
removes every kit key. Hoist has no logout hook, so an app calls it from its logout.

**Why.** A draft that survives a reload is the expected behavior (B6). Attachments are base64 in
memory, too large for local storage and too sensitive to leave on disk.

**Alternatives.** Server drafts. They follow the user across machines, but need a store method
that no backend offers.

## D68. The side panel is a request seam, with no viewer in the kit

*From: A3, P3, P4, P5.*

**Decision.** `ChatSidePanelModel` holds one open request at a time. A request is a discriminated
union: `{type: 'document', source, page?, passage?, citation?}`, `{type: 'table', artifactId,
view}` or `{type: 'chart', artifactId, view}`. Opening one replaces the last, and Back returns
focus to the element that opened it. Components reach it through `ChatSidePanelHost`, a narrow
interface. The kit renders tables and charts. An app supplies `documentRenderer` for documents.
Without one, or without room (788 px, P3), a document opens in a new tab with a toast. With no side
panel, a table opens in a dialog (`GENUI-2.md` 5).

**Why.** A document viewer will land in hoist-react (A3). The kit owns only the chat side: the slot,
the request and Back.

## D69. A result table renders a preview inline and the Grid in the side panel

*From: B1, P4.*

**Decision.** `chatUiGrid` keeps its name and spec. Inline, it renders a plain HTML table of at most
8 rows and 6 columns, on Hoist's compact grid tokens. The footer always states what is hidden. View
Full Table opens one Hoist `Grid` in the side panel (D68), paged from the `ChatDataSource`. A result
that fits the preview gets no full tier. `ChatUiGrid.defaults` holds `previewRows`,
`previewColumns`, `pageSize` and `exportConfirmAbove`. `ChatUiChart.defaults` holds
`maxInlineSeries` and `maxInlinePoints`. This replaces the inline grid of `GENUI-2.md` 5.

**Why.** A long thread with many ag-Grid instances is heavy, and B1 makes the preview the inline
tier. Keeping the names keeps app catalogs working.

## D70. Feedback reasons and the inline form

*From: P6 Feedback.*

**Decision.** `ChatFeedbackConfig` gains `reasons?: string[]`, the optional toggles of the form, and
`ChatFeedbackSpec` gains `reasons?: string[]`. The comment form opens inline under the action bar,
never in a popover. With `requireComment`, a rating saves only with its comment. Without it, a
rating saves at once and the comment follows as an update. `commentOn` and `requireComment` keep
their defaults (R5). After a reload the rating comes back, and the comment and reasons do not.

**Why.** P6's form holds required text, an error state and a 380 px layout, which a popover cannot
keep through an outside click. Comment rules depend on the backend, so they stay config.

## D71. Suggestions fill the composer

*From: P5, P4, P7.*

**Decision.** An empty-state suggestion fills the composer and never sends. Suggestions hide once
the input has text. Follow-up chips on a reply still send, with D17's tooltip.

**Why.** The user reads and can edit a prompt before it goes. A follow-up belongs to one reply and
is a quick action, so it keeps its one click.

## D72. Source kinds, favicons and fixed no-answer replies

*From: P3, B5.*

**Decision.** `ChatSourcePart` gains `sourceType: 'url' | 'document'`, default `'url'` when the part
has a URL. A document marker opens the side panel (D68). A URL marker pins its hover card. A
favicon in `metadata.favicon` follows the image policy (R9). The sources list follows marker order
and never renumbers (R19). A `data` part with `dataType` `xh.chat.noAnswer` renders the fixed
"not found" template, with no sources list and no Regenerate.

**Why.** Each keeps the part model of D2 and the image policy of D16, and gives P3 what it needs to
tell sources apart.

## D73. Helpers extend tool groups

*From: P7, A2, A4.*

**Decision.** `ChatToolGroup` gains optional members for the helper UI: `title`, `boundary()` for
the data boundary line, `isChangedSince(snapshot)` to retire Undo, `highlight(targets)` for the
change flash, and `docs`, the only pages an answer may cite. A helper's conversation lives in
memory for the life of its component (A2). `ChatAssistantModel` owns the chat. A desktop button and
a container dock inside the component at 740 px or wider, else open as a popover. A tool that
removes something asks first (R11). Several changes from one turn share one card and one Undo,
under D48.

**Why.** Tool groups already hold the tools, the context and the undo (D48, D51). Optional members
add what P7 draws, with no second adapter type.

## D74. Thread list additions

*From: P5.*

**Decision.** `ChatThreadSummary` gains `lastRunEnd?: 'complete' | 'interrupted' | 'failed'` and
`lastRunReason?`. The thread layer tracks "finished away" per session. A store declares whether its
search covers message text, with `searchesMessages`, and returns `snippet` per match. Otherwise
the list says "Searching titles". A route-selected thread that the store reports missing is "not
found" (R14). Sidebar width and its collapsed state persist through `persistWith`.

**Why.** Each row state in P5 needs one field the summary lacks. Search falls back to titles
(`02-backend-capabilities.md` row 7).

## D75. Small API additions the specs need

*From: P1, P2, P5, P6.*

**Decision.**

- `approveToolCallAsync(id, reason?)`, as `denyToolCallAsync()` already takes one (P2).
- `ChatModelConfig.dataRefreshedAt`, a function that returns the app's last data refresh, for the
  stale reply warning (P1, `02-backend-capabilities.md` row 15).
- The reducer flags a text part that `xh.chat.textReplace` shortened, so the view can hold the old
  text as "Revising" (P6).
- `ChatComposerHost` gains optional members for the status region (D64).

**Why.** Each fills a gap between the specs and the model, without a change to an existing
contract.

## 3. Where config lives

Hoist exposes app-wide settings in three ways, per `hoist-docs`:

- `static defaults` on a model, service or component (`GridModel.defaults`, `FetchService.defaults`,
  `Button.defaults`). Code-level, set at startup, and instance config wins.
- Soft config through `XH.getConf()`, set by admins on the server. The kit reads `chatConfig` this
  way (D50).
- Preferences through `XH.getPref()`, set per user. Persisted UI state uses `persistWith`.

`AppSpec` configures the app's bootstrap and holds no library settings. The proposal is
`ChatKit.defaults` for settings that span components (D59), component `defaults` for settings of
one component, and the existing per-instance config for the rest.

```ts
export interface ChatKitDefaults {
    assistantIcon: () => ReactElement;              // () => Icon.ai()
    reducedMotionSpinner: 'static' | 'spin';        // 'static'
    stallAfterMs: number;                           // 30_000
    announceSteps: 'none' | 'failures' | 'all';     // 'failures'
    drafts: 'local' | 'memory';                     // 'local'
    shortcuts: ChatShortcuts;                       // see D66
}

// In the app's AppModel or Bootstrap.ts:
ChatKit.defaults.shortcuts.newChat = null;
```

| Setting | Spec | Home |
|---|---|---|
| `reducedMotionSpinner` | A1, P6 | `ChatKit.defaults` |
| `assistantIcon` | A5, P7 | `ChatKit.defaults`, then profile, then prop |
| Assistant profiles | P5, A5 | `ChatModelConfig`, per chat |
| `shortcuts` | B3, P5, P6, P7 | `ChatKit.defaults` |
| `stallAfterMs` | P6, `01-decisions.md` D | `ChatKit.defaults`, overridable in `ChatModelConfig` |
| `idleTimeout` | D34 | Transport config, or `chatConfig` soft config. Unchanged |
| `drafts` | B6 | `ChatKit.defaults` |
| `announceSteps` | P2 | `ChatKit.defaults`, then a message list prop |
| `CHAT_TIMING` constants | P6 | Internal. Not config, except the stall time |
| `table.*` (preview rows and columns, page size, export confirm) | P4, P6 | `ChatUiGrid.defaults` |
| `chart.maxInlineSeries`, `chart.maxInlinePoints` | P4 | `ChatUiChart.defaults` |
| `tiles.max`, `followUps.max` | P4 | Catalog component specs, as schema `maxItems`, so the model's prompt agrees |
| `preview.timeoutMs` | P4 | `ChatUiGrid.defaults` and `ChatUiChart.defaults` |
| Feedback comments and reasons | P6 | `ChatModelConfig.feedback`, per chat |
| Data refresh time | P1 | `ChatModelConfig.dataRefreshedAt` |
| Data boundary, docs map, change highlight | P6, P7 | `ChatToolGroup`, per helper |
| Sidebar, viewer and helper widths | P3, P5, P7 | `persistWith` on each model, per user |
| Compact density | P1, P5 | Set by the component from its measured width, or a `compact` prop |
| `labelled` helper button | P7 | Prop |

## 4. Open items

The build follows each default. The marker `// TODO(design-open B<n>)` goes in the code
below.

| Item | Default | Marker goes in |
|---|---|---|
| B1. Inline grid or preview table | P4's preview table inline, the Grid in the side panel | `desktop/cmp/genui/ChatUiGrid.ts`, the new preview table in `desktop/cmp/genui/impl/`, the markdown table rule in `cmp/markdown/ChatMarkdown.ts` |
| B2. Regenerate replaces | Replace. No branch switcher. The model stays able to add branches | `core/ChatModel.ts` `regenerateAsync()`, the action bar in `desktop/cmp/chat/ChatMessageView.ts` |
| B3. Default shortcuts | On, each one remappable or off through `ChatKit.defaults.shortcuts` | `core/ChatKit.ts`, and the new hotkey hook in `desktop/cmp/chat/impl/` |
| B4. Document scope per thread | Per thread. Each question stores its own scope in `metadata.runOptions` | The new scope chip in `desktop/cmp/chat/`, and the run options a thread restores in `threads/ChatThreadsModel.ts` |
| B5. One citation sequence | One numbered sequence for documents and web pages | `desktop/cmp/chat/ChatSources.ts`, `desktop/cmp/chat/impl/ChatCitations.ts` |
| B6. Drafts in local storage | Local, keyed by user and thread, cleared on logout | `core/ChatComposerModel.ts`, `core/ChatKit.ts` `clearLocalData()` |

## 5. Build risks

### hoist-react changes the specs seem to need (A4)

| Need | Spec | Why |
|---|---|---|
| `Icon.hourglass()` and `Icon.codeBranch()` | A1, P6 | Hoist's Font Awesome library registers neither icon, and the kit has no Font Awesome dependency |
| Check: a collapsed `Panel` that shows custom content, for the 40 px sidebar rail | P5 | The rail holds expand, New Chat, search and a spinner |

### Kit gaps under the specs

- Heartbeats never reach the model (D34), so the stall timer needs the activity callback of D63.
- Reattach (capability 6) depends on `ChatTransport.resume`, which is a type only, planned for
  v1.1 (`SERVER-MODE.md` 2.4). P2's reconnect markers and P5's "reattached" state need it.
- D23's `display` enum is not built. `ChatToolSpec.display` still takes only `card` and `inline`,
  and H6's rule depends on it.
- "Continue" after a length cut (P1) has no model method and no backend capability. The
  `continue` trigger already means "after client tools".

### Backend capabilities missing from `02-backend-capabilities.md`

- Assistant status for the profile menu's dots (P5).
- Context use and context size for the meter (P5).
- Assistant availability and entitlement, for the feature panel (P6) and the helper button (P7).
- "Answered in another window" for approvals (P6).
- A server-side export over the confirm threshold (P4, P6).
- A status endpoint per run, for Refresh Status beyond a thread reload (P5).
- The thread "interrupted" signal (P5).

### Underspecified

- The dock and launcher. The kit draws them, but the app owns the page layout. "Opens left of the
  dock, taking width from the app" (P3, P4, P5) needs the app to place a kit dock component, and
  "Open Full Page" needs an app route.
- `BoundaryDeclaration`, `ChangeTarget` and the "Show" action on a change line (P7) have no shapes.
- The scope chip's document list: no spec says where the list of documents comes from (P3).
- Mentions (P5): no provider API for people, desks, agents, records and documents.
- "Acknowledged within 1 s" for a pending user message (P1). The likely signal is `RUN_STARTED`.

### Size

P5 and P6 are each larger than any work package so far. P5 holds the workspace breakpoints, the
sidebar and rail, the thread list, the launcher and dock, the composer pills, mentions, the meter
and offline. P6 holds 13 statuses, live cues, feedback, approvals, error tiers, focus, the
announcer and the boundary line. Split WP 4 and WP 8 into smaller pieces before the build, with
one Toolbox check after each.
