# Changelog

<!--
  New entries go in a fragment in changelog.d/, not in this file. A release assembles them here.
  Entry conventions: docs/changelog-format.md - read it before adding or editing entries.

  The three rules that account for most review feedback:

  1. Every bullet needs an explicit grammatical subject. No "Provides support for ..." or "Misc.
     improvements to ...".
  2. Open with a past-tense verb (Added / Fixed / Removed / Renamed) when reporting an action on the
     codebase, or with the symbol itself (`Foo.bar` now ...) when a living API changed behavior.
  3. Plain ASCII punctuation only. Use " - " for in-sentence breaks, never an em dash.
-->

## 4.0.0-SNAPSHOT - unreleased

## 3.1.0 - 2026-11-25

### 🎁 New Features

* `ChatPanel` now takes a file dropped anywhere on it, when its composer enables attachments. A
  hint covers the panel while files are dragged over it and states the attachment rules, and a
  drop adds the files to the composer. A `ChatComposer` used on its own still takes a drop on the
  composer only.
* `ChatPanel` now shows at compact density when it is narrow, as `ChatWorkspace` already did. It
  measures its own width and adds `xh-chat--compact`, so a panel docked at the side of an app no
  longer needs the class from the app. The new `ChatKit.defaults.compactMaxWidth` sets the width
  at or below which both show at compact density. Default 380. Set it to null to never add the
  class from the width.

### 🐞 Bug Fixes

* Compact density no longer hides text with no way to read it. The empty state and suggestions
  show in full, and tool call titles and "Not found" details show in a tooltip.
* A failed tool call row no longer cuts its title when the error beside it is long. The error now
  gives way first.
* The header of a generative UI card shows its title and meta in a tooltip. A narrow card cut them
  with no way to read the rest.
* `ChatComposerModel.addFilesAsync()` now types a text file by its extension when the browser
  gives it no type, as it can for a markdown file. The codecs then send it as text, and no longer
  leave it out of the request as an unreadable file.
* `ChatThreadList` and `ChatWorkspace` now refuse a file dropped on them, as `ChatMessageList`
  does. The browser no longer opens a file that misses the chat and lands on the thread list.

### ⚙️ Technical

* Moved changelog entries to fragments in `changelog.d/`, which a release assembles into
  `CHANGELOG.md` with `pnpm changelog release`. Snapshot builds list the unreleased entries in
  their published `CHANGELOG.md`. See `docs/changelog-format.md`.

### ✨ Styles

* Restyled the hint shown over a file drop zone, and added the `xh-chat-drop-hint` class to it,
  with `xh-chat-panel__drop-hint` for the hint of a `ChatPanel`: a scrim, with a large icon over
  a heading and the attachment rules. Added the `--xh-chat-drop-hint-*` variables for its scrim,
  outline, colors and sizes.
* A `ChatPanel` takes `xh-chat-panel--dragging` while files are over it. A composer inside a
  `ChatPanel` no longer shows `xh-chat-composer__drop-hint` or takes `xh-chat-composer--dragging`.
* The hint over a composer now takes its scrim from `--xh-chat-drop-hint-bg`, which fixes a
  scrim too weak to cover the composer in the dark theme.

## 3.0.0 - 2026-11-21

Requires `@xh/hoist` 91 or later.

### 💥 Breaking Changes (upgrade difficulty: 🟢 LOW - requires Hoist v91)

See [`docs/upgrade-notes/v3-upgrade-notes.md`](docs/upgrade-notes/v3-upgrade-notes.md) for
detailed, step-by-step upgrade instructions with before/after code examples.

* The kit now requires `@xh/hoist` 91 or later. Its styles read Hoist's renamed CSS variables, such
  as `--xh-spacing` in place of `--xh-pad-px`. The kit's own `--xh-chat-*` variables are unchanged.
* The kit's components now take child elements as `children`, as Hoist 91's element factories do.
  The docs and examples use `children` too. The legacy `item` and `items` keys still work in Hoist
  91.

### 🎁 New Features

* Added `ChatToolSpec.canAllowForConversation`, to let the user allow a tool for the rest of the
  conversation. Its approval card offers Allow for this conversation, and later calls of the tool
  run with no approval. `ChatModel.allowedTools` names the allowed tools, and
  `resetAllowedTools()` forgets them. Clearing the chat or loading another thread asks again.
  `approveToolCallAsync()` takes `{forConversation: true}` to do the same in code.

### 🐞 Bug Fixes

* Fixed a data part whose renderer returns null to take no space in the reply. It left an empty
  wrapper, and each one added a gap between the parts around it. A renderer's component that
  renders nothing now takes no gap either. For a type that never shows, set `display: 'hidden'` in
  its activity spec.
* Fixed the side panel to show a document's page, as "Page 12 of 38", in a toolbar. It showed as a
  bare line under the header.
* Fixed `ChatWorkspace` to size its sidebar and side panel for Hoist's 1px panel splitter. It still
  reserved 8px per splitter, the width before Hoist 90, so a narrow workspace cut the side panel
  7px more than it needed to.
* Fixed `ChatThreadsModel` to count a new thread as saved once its reply records the run id from
  `RUN_STARTED`. It waited for the reply's first content, so a backend that plans or sets up
  tools before it answers held back the `titleThreadAsync` call and the route's thread id until
  then.

### ⚙️ Technical

* Removed the install step that added the kit to `extraIncludePaths`. `configureRsbuild()` compiles
  the kit's TypeScript without it, so apps can drop that entry.

### 🤖 AI Docs + Tooling

* The package now ships its Hoist Docs index (`hoist-docs/index.json.gz`), built at publish by
  `@xh/hoist-docs-builder` and declared by `hoistDocs` in `package.json`. Hoist Docs
  (`@xh/hoist-docs`) reads it from the installed package and serves the kit's docs and API to
  agents in apps that install it, next to hoist-react's and hoist-core's.
* Switched this repo's `.mcp.json` from the hoist-react MCP server to Hoist Docs, and removed
  `.claude/start-hoist-react-mcp.sh`.

## 2.1.0 - 2026-11-16

### ⚙️ Technical

* Updated the kit to build and test against `@xh/hoist` 90.1. It still supports `@xh/hoist` 89.3.1
  or later.
* `chatMarkdown` with a table or a code fence, rendered on its own outside a chat, needs
  `@xh/hoist` 90 or later. On 89 it shows "No model found", from a Hoist bug fixed in 90.

## 2.0.0 - 2026-11-16

### 💥 Breaking Changes (upgrade difficulty: 🟢 LOW - remove the busy-line settings)

See [`docs/upgrade-notes/v2-upgrade-notes.md`](docs/upgrade-notes/v2-upgrade-notes.md) for
detailed, step-by-step upgrade instructions with before/after code examples.

* `ChatStatusRegion` now shows only what stops a send or needs the user's action. A reply in
  progress, or one waiting for the user's answer, shows no line, as the reply shows its progress.
* Removed the busy line's settings: `showStopHint` and `assistantName` on `ChatStatusRegion`,
  `ChatStatusRegion.defaults` with its `ChatStatusRegionDefaults` type, and
  `ChatKit.defaults.busyIcon`. The Stop button names Esc in its tooltip.
* Removed the `xh-chat-status-region__lead`, `xh-chat-status-region__hint`,
  `xh-chat-status-region--busy` and `xh-chat-status-region--attention` classes, which the region no
  longer renders.

### 🎁 New Features

* `ChatThreadsModel` now checks on a turn that runs on the server while its chat does not follow
  it, and loads the reply once the thread list shows the run done. Set the interval with
  `ChatKit.defaults.statusRefreshMs` or `ChatThreadsConfig.statusRefreshMs`, null for none. The
  checks stop after `statusRefreshTimeoutMs`, which both also take.
* `ChatThreadsModel` now blocks sends while the store lists a thread as running and its history has
  no settled reply to that turn yet. The status region shows the block only with Refresh Status,
  once the automatic checks stop.
* `ChatMessageList` now shows "Still working on the server" for such a turn with no reply saved
  yet, in place of the empty state or after the user's question. The composer's start items breathe
  while it runs.
* `ChatModel.setStatusRefresher()` now takes `ChatStatusRefresherOptions`, for an app with a thread
  layer of its own. They drive the new `ChatModel.isRunningOnServer` and
  `ChatModel.isStatusRefreshAutomatic` getters.
* Added `chatAnnouncer.withdraw()`, to take back an announcement whose news no longer holds. The
  status region withdraws a status's announcement once it passes.
* Added `ChatThreadsModel.showThreadTitle()`, to show a title the backend already holds, such as
  one it wrote in the background. The list and the workspace header show it at once, with no
  store call and no list reload.
* Added `ChatThreadsConfig.titleThreadAsync`, to give a thread the user starts a title of the app's
  own, such as a summary that a model writes. The model calls it once per thread, as soon as the
  backend has the thread, then saves the title through the store and shows it. A rename by the
  user wins.

### 🐞 Bug Fixes

* Fixed the thread list to stop showing a thread as working within one `statusRefreshMs` check
  of its run's end, whether the thread is open or not. While the list shows a thread as working
  that no chat on the page streams, `ChatThreadsModel` reloads the list on each check, up to
  `statusRefreshTimeoutMs` per thread. Before, the row stayed "working" until something else
  reloaded the list.
* Fixed Refresh Status in a `ChatThreadsModel` chat to reload the thread list too. The list could
  show a thread as running after its run had finished.
* Fixed a reply left running on the server, live, loaded or replayed, to show its unfinished server
  calls and sub-agents as "Not finished yet", not as failed, cancelled or "Stopped". Once the
  conversation moves past the reply, it reads as complete and its open work closes.
* Fixed a failed reply rebuilt by `replayChatEvents` to show as a failed reply, with its error.
  Before, a reply with no parts, run id or error code showed as "Not sent" under the user's
  message, though the backend had the turn. Each rebuilt reply now carries
  `metadata.runStarted: true`, as a live reply does once its run starts. A live reply whose run
  started with no run id, then failed with no parts or code, now shows as failed too.
* Fixed a reply rebuilt by `replayChatEvents` with `status: 'error'`, from events that end in
  neither `RUN_FINISHED` nor `RUN_ERROR`, to read as not retry-safe in server mode. It now gets
  error code `incomplete-stream`, as a live stream that broke off does, so the chat never offers
  Try Again for it. Pass `metadata: {retrySafe: true}` to mark it safe. A record the decoder
  rejects still fails the reply as `invalid-stream`, over the app's `errorCode` and `retrySafe`.
* `isChatRetrySafe` now takes `metadata.retrySafe: true` over the kit's own unsafe error codes.
  Before, only `false` decided.
* Fixed `replayChatEvents` to record no times for events with no `timestamp`. Before, it timed
  every tool call, sub-agent and reasoning part by the load, so each showed "<0.1s". Such parts now
  carry null `startedAt` and `endedAt`, and the timeline, its screen reader labels and the
  reasoning label show no time for them. A backend that stores events should stamp each one as the
  agent emits it.

### ⚙️ Technical

* Added Zod 4 as a dependency of the kit. AG-UI 1.0.4 takes Zod as a peer, so the kit supplies it.
  Apps no longer need the `zod` override that the 1.0.0 README advised, and can remove it.

### ✨ Styles

* Added the `xh-chat-timeline--detached`, `xh-chat-timeline__item--unfinished`,
  `xh-chat-tool-call--unfinished`, `xh-chat-tool-call__glyph--unfinished` and
  `xh-chat-message-list__awaiting-reply` classes. A detached
  reply's timeline no longer takes `xh-chat-timeline--stopped`.

## 1.0.0 - 2026-11-02

The first release of Hoist Chat Kit, a library of chat components for Hoist React applications.
The kit holds a conversation engine, transports and codecs for common backends, generative UI built
on Hoist components, a thread layer, and the desktop chat components. See the
[docs index](docs/README.md) for each package.

Requires `@xh/hoist` 89.3.1 or later, with React 19.

### 🎁 New Features

* Added `ChatModel` in `/core/`, the conversation engine: immutable messages with typed parts, a
  turn loop with client-side tools, approvals and interactive tools, AG-UI interrupts, stop and
  detach, retry, regenerate and edit, feedback, and persistence of history and drafts.
* Added the `/transport/` package: `HoistChatTransport` for NDJSON from a hoist-core server,
  `SseChatTransport` for SSE servers, `HttpChatTransport` as a base for others, and
  `ScriptedChatTransport` for demos and tests. Codecs translate AG-UI, the Anthropic Messages API
  and OpenAI chat completions.
* Added the `/threads/` package: `ChatThreadsModel` over a `ChatThreadStore` the app implements,
  with background turns, search, rename and delete, route binding, and replay of stored AG-UI
  events.
* Added the desktop chat components in `/desktop/cmp/chat/`: `chatPanel`, the message list and
  view, a composer with pills and document scope, tool call cards, reasoning, sources with inline
  citations, a side panel, an empty state and suggestions, all themed with CSS variables.
* Added `chatWorkspace` in `/desktop/cmp/workspace/`, a full-page chat with a thread sidebar,
  header and notice slots and a side panel, and `chatThreadList` in `/desktop/cmp/threads/`.
* Added `chatMarkdown` in `/cmp/markdown/`, a streaming markdown renderer. It renders half-written
  syntax cleanly as text streams, memoizes finished blocks, and blocks raw HTML and images by
  default.
* Added generative UI, as an **experimental** layer. The `/genui/` package holds a `ChatUiCatalog`
  of app components the model can show inline, with checked props, data by reference, typed
  actions, and adapters for A2UI and OpenUI payloads. The `/desktop/cmp/genui/` package holds
  built-in components for it: a result table in two tiers, a Hoist chart, KPI tiles and a detail
  card. These APIs are newer than the rest of the kit, and can change in a minor release while
  the first integrations settle.

### 🤖 AI Docs + Tooling

* Added a documentation registry, `docs/doc-registry.json`, that the `hoist-react` MCP server and
  the `hoist-docs` CLI serve to agents in any app that installs the kit.
* Added `docs/requesting-changes.md`, which shows an app's agent how to ask the kit's maintainers
  for a feature, an API change or a bug fix, and what to check first.

### 📚 Libraries

* @ag-ui/core `1.0`
* @ag-ui/client `1.0`
* classnames `2.5`
* rxjs `7.8`
