# Plan 2 - Server-Owned Conversations and the Enterprise Shape

Internal plan for the second iteration, written after the feedback packet of 2026-10-14
(`.tmp/hoist-chat-kit-feedback-1/`). The lead owns it. It replaces the broaden plan in
`planning/DESIGN.md` and the next steps of the first iteration.

## 1. What the packet says

The packet holds an independent code review, two enterprise app reports, an analysis of a third
app that XH must port within weeks, a fourth use case, and ecosystem research. Its one strategic
finding: **every enterprise consumer has a server-owned conversation, and none runs a tool in the
browser.** A separate agent service owns the loop, the tools, the history and the threads. The
browser sends one message and renders the stream.

The kit's first slice targets the other shape: the browser owns the history and runs the tool
loop (D7). That shape stays. It is the Toolbox weather agent and use case 4 (helper agents on Hoist
components). But v1.0 must serve both shapes, and the enterprise shape comes first, because app 3
is scheduled now.

Every other finding follows from that one:

| Area | What the apps need first |
|---|---|
| Run lifecycle | Server ids on messages, a turn id for idempotency, send only the new message, stop versus detach, a cancel hook, async headers, an idle timeout |
| Threads | A thread store adapter, a thread list with rename, delete, search and recency groups, background turns across threads, the concurrency rules |
| Message UI | Error boundaries, message actions with feedback, `[n]` citation markers, a source viewer seam, a text transform seam, a text replace event |
| Layout | A workspace shell: thread sidebar, conversation, side panel, all on `PanelModel` |
| Tools | An error flag on backend tool results, an activity timeline for many calls with nested sub-agents |
| Generative UI | Data by reference, inline tags in markdown, a catalog a server can register, a two-tier result table |
| Composer | Send gating, pill menus, run options captured per turn (document scope), seeding |
| Helpers | Context providers, undo, tools derived from Hoist models, a docked form factor, a default transport from server config |

The research confirms the architecture: own message model, AG-UI vocabulary, codec and transport
split, immutable records, an app-controlled catalog. Nothing argues for a change of direction.

## 2. Where the packet is out of date

The packet reviewed what was pushed on the evening of 2026-10-13. Since then, slice 2 landed (#6):
review 2 fixed, the render context unified, renderers mounted as components, images blocked by
default, message actions, grouped tool calls, the genui built-ins, the Toolbox demo app, and the
hardened Toolbox relay. `planning/reviews/feedback-1-reconciliation.md` checks all 63 findings:
29 fixed, 32 still open, 1 disputed (C8: components with local models need a model spec), 1
obsolete.

## 3. Direction changes

Each becomes a DECISIONS entry (D19 onward).

1. **Two conversation shapes, both first-class.** `historyMode: 'client' | 'server'` on
   `ChatModel`. Client mode is today's behavior. In server mode the request carries only the new
   messages, a `trigger` (`submit`, `retry`, `regenerate`, `edit`) and a stable `turnId`, and the
   server's ids replace the browser's.
2. **A thread layer in the kit.** `ChatThreadStore` (an adapter the app implements),
   `ChatThreadsModel` (one `ChatModel` per open thread, so a turn can run in the background), and
   `chatThreadList`. App 2's concurrency rules become its spec.
3. **A workspace shell.** `chatWorkspace` with a thread sidebar and a side panel on `PanelModel`,
   sized to its parent. Apps stop building the shell by hand.
4. **Generative UI binds data by reference.** One catalog with four delivery modes: display tools
   the server answers, client tools (built), tags in markdown, and a UI document in the stream.
   A `ref` prop resolves through an artifact registry and a `ChatDataSource` loader. GENUI.md is
   revised before more built-ins are written.
5. **An activity timeline replaces stacked tool cards for agentic replies.** The tool `display`
   setting becomes one enum: `card`, `inline`, `timeline`, `answer`, `pinned`, `hidden`.
6. **Bring your own LLM.** A `ChatService` resolves a default transport from server config, and a
   `ChatCompletionsCodec` covers OpenAI-compatible gateways, the universal enterprise format.
7. **hoist-core needs a streaming companion.** `renderSSE()`, a streaming `renderNDJSON()`, and a
   streaming proxy mode. Owner to be decided (question 2).

## 4. Work packages

Ordered by dependency and by app 3's needs. Visual work waits for the Claude Design handoff,
expected later on 2026-10-14 under `.tmp/design/`. It covers the thread, the timeline, citations,
result cards, the workspace and the composer.

| WP | Scope | Needs design | Size guess |
|---|---|---|---|
| 0 | Open defects: tool result error flag, error boundaries, schema checker rejects unsupported keywords, inherited keys, denied inline calls, file chip images, `***`, async `url`/`headers`/`params`, idle timeout, observable composer settings, `AgUiCodec` state function, server example allow-list, `maxSteps` versus the rate limit | No | Small |
| 1 | Run lifecycle: `historyMode`, server ids, `turnId`, `trigger`, `newMessages`, abort reasons (stop, detach, clear, load, destroy), `cancelAsync`, `ChatRunOptions` captured per send, `xh.chat.textReplace`, a text transform seam, retry-after errors, per-turn `track` | No | Medium |
| 2 | Thread layer models: `ChatThreadStore`, `ChatThreadsModel` with the concurrency rules as specs, background turns, route binding | No | Medium |
| 3 | Message seams: feedback with comment, `[n]` citation markers, `onSourceClick`, remark and rehype plugin injection (KaTeX) | Partly | Small |
| 4 | Thread list, workspace and feedback UI | Yes | Medium |
| 5 | The server-mode recipe and demo: a guideline-assistant demo in Toolbox on a fake thread store and a custom SSE codec, plus a recipe doc. App 3's port follows it | After 4 | Medium |
| 6 | Activity timeline | Yes | Medium |
| 7 | Generative UI by reference: GENUI.md revision, artifact registry, `ChatDataSource`, view spec, two-tier table, tags in markdown, catalog export | Yes | Large |
| 8 | Composer extensibility: `sendBlocker`, `chatComposerMenu`, `seed()`, mentions | Yes | Medium |
| 9 | Component helpers: `contextProviders`, undo, `gridTools`, `dashCanvasTools`, docked assistant, `ChatService`, `ChatCompletionsCodec` | Partly | Large |
| T | Toolbox: drop the `link:` dependency for the published kit, CHANGELOG, nginx entries | No | Small |

WP 0 to 3 and T need no design and can start now. WP 4 to 8 start when the design lands.

## 5. What stays out of the kit

- App 3's PDF viewer, its admin console, and its API client. The kit gives seams
  (`onSourceClick`, `ChatThreadStore`, a codec), and the app supplies the parts.
- hoist-core changes, unless question 2 says otherwise.
- Client names. Kit and Toolbox docs describe the shapes generically ("a guideline assistant over
  a document library"), never the client or its vendor.

## 6. Answers from Anselm, 2026-10-14

1. **Budget.** $700 more on top of the $242 spent, for the full v1.0: WP 0 to 9.
2. **hoist-core companion.** The hoist-core team owns it (D25). The report specifies it.
3. **Pre-releases.** The lead's choice: snapshots now, pinnable by exact version, and a beta tag
   when the v1.0 API settles (D26).
4. **Toolbox base.** The chat work stays stacked on `weatherv2`.

The defaults taken without asking are D27 (Hoist 89 floor), D28 (no Python reference agent), D29
(AG-UI interrupts first), and a scripted analytics demo with a fake `ChatDataSource` in WP 7.
