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
* Added `url`, `headers` and `params` as functions of the request, sync or async, on the HTTP
  transports, for example to send a fresh token with each step.
* Added `idleTimeout` to the HTTP transports. A stream that sends nothing for longer fails with
  code `stalled`. SSE comments and `{"type": "xh.heartbeat"}` NDJSON records reset it.
* Added an error flag for backend tools: `metadata.error` or `metadata.isError` on
  `TOOL_CALL_RESULT`, or an `xh.chat.toolError` event, fails the call as `output-error`.
* Added `ChatModelConfig.sendBlocker`, which returns a reason to hold back sending. The composer
  disables Send and shows the reason as a tooltip and an accessible status.
* Added bindable `enableAttachments`, `accept`, `maxFiles` and `maxFileSize` on
  `ChatComposerModel`, so that apps can change them after construction.
* Added `state` to `AgUiCodec`, a value or a function of the request, sent as the run's `state`.
* Added `ChatToolSpec.approvalPreview`, which renders an inline call while it waits for approval.
* Added `ChatUiComponentSpec.result`, the text sent to the model once a component shows.
* Added `isChatImageAllowed()`, which applies an image policy to a URL.

### 🐞 Bug Fixes

* Fixed a failed backend tool showing as a success. `AnthropicCodec` now fails a server tool call
  whose result block reports an error, such as a web search over its `max_uses`.
* Fixed one throwing renderer breaking the whole message list. Each message and part now renders
  in an error boundary, with a compact note in place of a part that fails.
* Fixed `ChatUiCatalog` accepting schema keywords it does not check, such as `$ref` or `allOf`.
  It now throws on them, and on a `pattern` that does not compile.
* Fixed inherited keys such as `toString` passing `additionalProperties: false` in catalog props.
* Fixed a denied inline call still showing its component, and an inline call showing before
  approval.
* Fixed file chips loading images at a URL with no image policy. They now follow `allowImages`.
* Fixed a trailing `***` streaming as `******`.

### ✨ Styles

* Added `--xh-chat-*` CSS variables for the chat's colors, widths, radii and fonts, built from
  Hoist's theme variables, with light and dark defaults.

### ⚙️ Technical

* Reduced the catalog instructions to each tool's name and example props, so that each component
  description reaches the model once, in its tool.
* Added a package build check (`pnpm build`) to CI and to both deploy workflows.
* CodeQL now runs only when the repo is public, because code scanning needs GitHub Code Security on
  a private repo.
