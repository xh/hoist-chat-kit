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
* Added `ChatUiDocument`, a flat, id-keyed answer of nested components. `validateDocument()`,
  `repairDocument()` and `renderDocument()` check, fix and render one, with a placeholder for an
  element still streaming and a fallback for one that fails.
* Added the `show_ui` document tool, for nested answers, and `displayTools`, which display a
  catalog's calls in a chat whose server runs the tool loop.
* Added component tags in markdown. `ChatUiCatalog.parseTags()` reads `<ui-NAME .../>` tags with
  the browser's XML parser, holds back a tag still streaming, and ignores tags in code.
* Added data by reference. A component's `dataProps` name an artifact in a `ChatArtifactRegistry`,
  which loads each range of rows once through the app's `ChatDataSource`.
* Added `ChatDataView`, `ChatChartView` and `applyDataView()`, a closed grammar that filters,
  sorts and scales an artifact for a table or a chart.
* Added typed `ChatUiAction`s, run with `context.runActionAsync()`. `openUrl` opens only URLs that
  `urlAllowList` allows. Card buttons take typed actions: `send` only, unless `actionTypes` allows
  more.
* Added `toToolSchemas()`, `toPrompt()` and `version` to `ChatUiCatalog`, so a server can register
  the catalog from a build-time export and detect drift.
* Added caps on elements, nesting and inline rows per answer, and an error boundary per element.
* Added `ChatModelConfig.catalog`. The chat adds the catalog's tools for its history mode, renders
  component tags and `xh.chat.ui` documents in replies, and sends the catalog's version.
* Added `ChatModel.artifacts`, a registry per chat with a `dataSource` option. It takes artifacts
  from `xh.chat.artifact` events, tool results, `chatToolResult({artifacts})` and loaded history.
* Added `ChatUiCatalogConfig.modes`, the delivery modes a catalog uses. They set the tools a
  client-mode chat sends, and the default modes of `toPrompt()` and `toToolSchemas()`.
* Added message context to the codecs. The context of a `send` action - a few short values such as
  record ids - shows under the sent message, and goes to the model as an AG-UI context entry, or as
  a `<message-context>` block after the message text.
* Added `ChatDataHandle.isComplete`, which says when a handle's first page holds every row, so a
  view can sort and rank the whole result.
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
* Added `ChatUiComponentSpec.result`, the text sent to the model once a component shows.
* Added `isChatImageAllowed()`, which applies an image policy to a URL.
* Added `ChatModelConfig.historyMode`. In `server` mode an agent service owns the history, each
  request carries only the new messages, and the chat records the server's thread and message ids.
* Added `turnId`, `trigger`, `stepIndex`, `newMessages`, `replacedMessageId` and `runOptions` to
  `ChatRunRequest`. A retry sends the same `turnId`, so a backend can key runs by it.
* Added bindable `ChatModel.runOptions`, for options the user picks per turn. Each send records a
  copy on the user message, and every request of the turn carries that copy.
* Added `ChatModel.detach()` and abort reasons. A stop aborts with a `ChatAbortError` and calls the
  new `ChatTransport.cancelAsync()`. In server mode, a detach, clear or load leaves the run going.
* Added `cancelUrl` to the HTTP transports, which posts the run's ids when the user stops a run.
* Added the `xh.chat.textReplace` and `xh.chat.message` events, and `retryAfterSeconds` on
  `ChatRunError`, read from the `metadata` of `RUN_ERROR`.
* Added `ChatModelConfig.textTransform`, which rewrites model text as it streams, for example to
  strip leaked tags.
* Added `ChatModelConfig.track`, which records each finished turn with Hoist activity tracking,
  without message text.
* Added `ChatModel.submitFeedbackAsync()` and `ChatModelConfig.feedback`. A rating shows at once and
  reverts, with a toast, if the submit fails.
* Added `ChatModel.prependMessages()` and `hasOlderMessages`, for history loaded a page at a time.
* Added `marker` and `metadata` to the `xh.chat.source` event and to `sourceEvents()`.
* Added `citations` to `ChatMarkdown`, and `citationMarkers` to the chat. `[1]` and `[1, 2]` in
  the text render as buttons for the sources they cite, by `marker` or by position.
* Added `marker` and `metadata` to `ChatSourcePart`. The source list and citation chips number
  sources by `marker`, so they match the markers in the text.
* Added `onSourceClick` to the chat, called when the user clicks a source, a citation chip or a
  marker. Apps with a document viewer open the source there in place of its URL.
* Added `markdownPlugins`, which adds app remark and rehype plugins after the kit's own, for
  example `remark-math` and `rehype-katex` for math.
* Added `ChatThreadsModel` and the `ChatThreadStore` adapter, a thread layer for conversations a
  backend stores. It holds a chat per open thread, so turns run on in the background. A turn that
  pauses for the user keeps its chat, and shows in `awaitingThreadIds`.
* Added paged thread lists, server-side search, paged history, deep links, and rename, pin and
  delete that show at once and roll back with a toast if the store fails.
* Added `groupThreadsByRecency()`, which groups threads into Pinned, Today, Yesterday and older
  groups by the browser's calendar days.
* Added `LocalChatThreadStore`, an in-memory store for tests and demos, with latency, failures and
  held calls on request.
* Added `ChatModel.setThreadCreator()` and `addSendBlocker()`, the seams a thread layer uses to
  create threads on the backend and to hold back sends.
* Added the `empty-response` error code. A run that finishes with nothing in the reply now fails,
  with Retry, rather than show a blank message.
* Added `ChatModelConfig.contextProviders`, which send live context, such as the state of a grid,
  with every step. `AgUiCodec` sends them as `context` entries. `AnthropicCodec` and
  `ChatCompletionsCodec` send them after the history, so that the cached history stays valid.
* Added undo for client tools. A tool returns `chatToolResult(output, {undo})`, and
  `ChatModel.undoTurnAsync()` undoes the latest reply's changes, from an Undo action on the reply.
* Added `ChatToolSpec.preview`, which shows what a call will change on its approval card.
  `preview: true` renders an inline call while it waits. It replaces `approvalPreview`, which is
  deprecated and logs a warning.
* Added `ChatCompletionsCodec`, for model gateways that speak the OpenAI chat completions format,
  such as Azure OpenAI and LiteLLM.
* Added `flush()` to `ChatDecoder`, for events a decoder holds back until its stream ends.
  `ChatCompletionsCodec` uses it to send one `RUN_FINISHED` per step, with the token usage.
* Added `ChatService`, which reads the app's LLM backend from the `chatConfig` soft config and
  builds a transport for it, so a helper agent needs no wiring of its own.
* Added `gridTools` and `dashCanvasTools`, tool groups that let a helper agent arrange a grid or a
  `DashCanvas`, each with a context provider, a prompt, suggestions and undo for every change.
* Added `ChatStreamReducer` and `createChatRunRequest()`, so an app can run a transport without
  `ChatModel`. The helper fills in a request from the messages, and the reducer folds the streamed
  events into the app's own `ChatMessage`.
* Added `ChatComposerHost`, the members a composer needs from its conversation. `ChatModel`
  implements it. Create a `ChatComposerModel` with a `host` of your own to use the composer
  without a `ChatModel`.

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
