# Changelog

## 1.0.0-SNAPSHOT - unreleased

### 🎁 New Features

* Added `ChatModel`, which runs a conversation with an LLM or agent: streamed replies, client
  tools that act on the app, tool approvals, stop, retry, regenerate and edit.
* Added interactive tools, which the user answers through a renderer. The turn pauses until the
  app passes each answer to `ChatModel.addToolOutputAsync()`.
* Added `ChatToolSpec.approvalPrompt`, a question or rich content shown on the approval card in
  place of the generic "Allow this action to run?".
* Added `ChatMessage` and its typed parts (text, reasoning, tool call, file, source, data), with
  `toSpec()` and `loadMessages()` for storing and restoring history.
* Added `ChatRunError`, the `lastError` of a failed turn, with a machine-readable `code` such as
  `overloaded_error` or `incomplete-stream`. Errors within the stream show in the chat and never
  reach `XH.handleException`.
* Added `metadata.elapsedMs` on each reply. It leaves out time the turn spent paused for the user.
* Added `HoistChatTransport`, which streams replies from a hoist-core endpoint as NDJSON, and
  `SseChatTransport` for Server-Sent Events servers, such as AG-UI agents. Both extend
  `HttpChatTransport`, a base class for custom framings. `headers` may be a function of the request.
* Added `AgUiCodec` and `AnthropicCodec`. With `AnthropicCodec`, a Hoist server can relay the
  Anthropic stream unchanged. It supports system blocks, a `prepareBody` hook and prompt caching.
* Added `cacheControl` prompt caching to `AnthropicCodec`. It marks the history, the system prompt
  and the tools, keeps breakpoints the app sets, and stays within Anthropic's limit of 4.
* Added `ScriptedChatTransport`, which replays canned events for tests and demos. `respond` gets
  the turn, the step and the attempt of each request. Added `citationEvents()` to its builders.
* Added the desktop `ChatPanel` and its parts: message list, message view, composer with
  attachments, tool call cards, reasoning, code blocks, sources and an empty state with
  suggestions.
* Added `chatClearButton`, a header button that clears the conversation, and confirms first while
  a reply streams.
* Added `ChatMarkdown`, a streaming-safe markdown renderer that re-renders only the block that is
  still growing. `trailingContent` adds inline content at the end of the last paragraph.
* Added an image policy to `ChatMarkdown`. Model-written images show as links unless
  `allowImages` permits them, so a prompt-injected reply cannot leak data through an image URL.
* Added `messageActions` and `messageHeaderItems` to the message list, for feedback buttons and
  other per-message content. Consecutive tool calls of one step fold into one "Used 3 tools" row.
* Added inline citation chips at the end of the paragraph they support. Their numbers hold steady
  while the reply streams and match the source list.
* Added a stable `ChatPartRenderContext` for tool and data renderers. Each renderer renders as a
  component of its own, so it may use hooks and re-renders only when its part changes.
* Added generative UI. A `ChatUiCatalog` turns app components into tools the model calls to show
  them inline, with schemas, checked props, streaming renders and generated instructions.
* Added `ChatToolSpec.display: 'inline'`, which shows a tool's rendered output as part of the
  reply. A status shows only while the call streams or waits, or after it fails.
* Added the built-in generative UI components `chatUiGridSpec()`, `chatUiChartSpec()`,
  `chatUiMetricsSpec()` and `chatUiCardSpec()`, on Hoist grids and charts. KPI tiles show large
  values in a compact form, and grid columns size to their content.
* Added `ChatUiAdapter`, which draws a protocol's UI payload, such as A2UI or OpenUI, with catalog
  components through `ChatUiCatalog.createDataRenderers()`.
* Added `chatUiFrame`, `fmtChatUiNumber` and the number format schemas, so that app components
  match the built-in ones.

### ✨ Styles

* Added `--xh-chat-*` CSS variables for the chat's colors, widths, radii and fonts, built from
  Hoist's theme variables, with light and dark defaults.

### ⚙️ Technical

* Added a package build check (`pnpm build`) to CI and to both deploy workflows.
* CodeQL now runs only when the repo is public, because code scanning needs GitHub Code Security on
  a private repo.
