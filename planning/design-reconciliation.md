# Design Reconciliation - To Confirm

The design handoff (`.tmp/design-handoff/`) disagreed with the repo, or with itself, at the points
below. The build follows the choice in each row (D76). Confirm each row, or name the ones to
change. The full analysis of each conflict is in this file's history at commit `a25313a`.

"Repo" means the build kept the kit's existing API or behavior. "Design" means it took the
handoff's.

## Handoff against the repo

| # | Question | Built | Side | Decision |
|---|---|---|---|---|
| R1 | When to offer Try Again | Try Again by default. In server mode, a stall or a dropped stream offers Refresh Status, or Try Again with "may still be running" | Repo, plus a server-mode rule | D62, D64 |
| R2 | A duplicate-request wait | Count down and retry by itself, if the error is retry-safe | Design | D64 |
| R3 | Stop | Takes effect at once. No wait for the server | Repo | - |
| R4 | A detached reply | "Still working", with Refresh Status | Repo | D62 |
| R5 | A thumbs down | Saves at once. A comment is required only when `feedback.requireComment` is set. Optional `reasons` | Repo, with the design's form | D70, D77 |
| R6 | Where failures show | Inline, not in toasts | Design | D64 |
| R7 | A suggestion click | Fills the composer. A reply's follow-up chips still send | Design | D71 |
| R8 | A follow-up chip's tooltip | Shows the prompt it sends | Repo | - |
| R9 | Favicons | A URL favicon follows `allowImages`. A `data:` favicon always shows. Else a letter tile | Repo | D72 |
| R13 | The inline grid | A preview table inline, the full Grid in the side panel | Design (B1) | D69 |
| R14 | A missing deep-linked thread | "Not found" when the store reports it missing | Repo | D74 |
| R15 | The assistant icon's name | `assistantIcon`. Assistant profiles are not built | Repo | D61 |
| R16 | A "Not sent" user message | Shown when the turn failed before the run started. No new message status | Repo | D43 |
| R17 | A no-answer reply | A `data` part with `dataType` `xh.chat.noAnswer` | Repo | D72 |
| R18 | Document and web sources | `sourceType: 'url' \| 'document'` on `ChatSourcePart`. Apps open documents through `onSourceClick` | Design, on the repo's seam | D72 |
| R19 | Source numbers | In marker order, never renumbered | Repo | - |
| R20 | CSS class names | The kit's BEM names | Repo | - |

R10, R11 and R12 were about the component helper, which the kit no longer ships (D80).

## Within the handoff

| # | Question | Built |
|---|---|---|
| H1 | The export confirm threshold | One threshold, default 10,000 rows, on `ChatUiGrid.defaults` |
| H2 | Redo after Undo | No Redo (D48) |
| H3 | A failed apply | Retry for a previewed apply. None for a change that applied at once |
| H4 | The Esc order | Popups first. Then the region with focus acts: the viewer closes, an edit cancels, a reply stops. One action per press |
| H5 | Remapping shortcuts | Kit config, `ChatKit.defaults.shortcuts` (D66) |
| H6 | Timeline or process rows | The timeline for `display: 'timeline'` calls. Plain rows for `card` calls and for reasoning alone (D78) |
| H7 | Markdown tables | Up to 12 rows plain, larger ones capped |
| H8 | Status region order | Interrupted, cancelled and detached rank with failed |

## Open design items

The build follows each default, and the code carries `// TODO(design-open B<n>)`.

| Item | Default |
|---|---|
| B1. Inline grid or preview table | Preview table inline, the Grid in the side panel |
| B2. Regenerate | Replaces the reply. No branch switcher |
| B3. Shortcuts | On, each one remappable or off in `ChatKit.defaults.shortcuts` |
| B4. Document scope | Per thread. Each question stores its scope |
| B5. Citation numbers | One sequence for documents and web pages |
| B6. Drafts | Local storage, keyed by user and thread. An app clears them with `ChatKit.clearLocalData()` |

## In the handoff, not built

Each needs a backend capability, an app decision or a spec the handoff lacks:

- Assistant status dots and assistant profiles (P5).
- The context meter (P5).
- Feature availability and entitlement (P6).
- "Answered in another window" for approvals (P6).
- A server-side export over the confirm threshold (P4, P6).
- A status endpoint per run, for Refresh Status beyond a thread reload (P5).
- Reattach after a reconnect, which needs `ChatTransport.reconnect` (P2, P5).
- Continue after a reply is cut at its length limit (P1).
- The page dock, the launcher and "Open Full Page" (P3, P4, P5).
- Mentions of people, desks and records (P5).
