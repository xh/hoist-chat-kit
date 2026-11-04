# Changelog

<!--
  Entry conventions: docs/changelog-format.md - read it before adding entries here.

  The three rules that account for most review feedback:

  1. Every bullet needs an explicit grammatical subject. No "Provides support for ..." or "Misc.
     improvements to ...".
  2. Open with a past-tense verb (Added / Fixed / Removed / Renamed) when reporting an action on the
     codebase, or with the symbol itself (`Foo.bar` now ...) when a living API changed behavior.
  3. Plain ASCII punctuation only. Use " - " for in-sentence breaks, never an em dash.
-->

## 2.0.0-SNAPSHOT - unreleased

### 💥 Breaking Changes (upgrade difficulty: 🟢 LOW - remove the busy-line settings)

* `ChatStatusRegion` now shows only what stops a send or needs the user's action. A reply in
  progress, or one waiting for the user's answer, shows no line there - the reply shows its own
  progress. A reply left running on the server, or a stalled one, shows a line only with Refresh
  Status. Screen readers still hear a turn that pauses for the user's answer.
* Removed `ChatStatusRegion`'s `assistantName` and `showStopHint` props,
  `ChatStatusRegion.defaults`, and `ChatKit.defaults.busyIcon`, which set the busy line. Remove them
  from the app. The composer's Stop button now names Esc in its tooltip.
* Removed the `xh-chat-status-region__lead` and `xh-chat-status-region__hint` classes of the busy
  line.

### 🎁 New Features

* `ChatThreadsModel` now blocks sends while the server runs a turn that the chat does not follow:
  a thread whose last reply was left running, or one the store lists as running with no messages
  saved yet. Send's tooltip says "Wait for the reply to finish.", and the status region shows the
  reply's own status.

### 🐞 Bug Fixes

* Fixed Refresh Status in a `ChatThreadsModel` chat to reload the thread list too. The list could
  show a thread as running after its run had finished.
* Fixed a reply left running on the server - detached live, loaded with `loadMessages()`, or
  replayed with `replayChatEvents()` - to keep its unfinished tool calls and sub-agents open. They
  showed as failed or cancelled, and the timeline said "Stopped". They now show as "Not finished
  yet", and close when the next turn starts.

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
