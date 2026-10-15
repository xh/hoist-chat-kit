# Changelog

## 1.0.0-SNAPSHOT - unreleased

### 💥 Breaking Changes

* Renamed and reworked the `--xh-chat-*` CSS variables. Sizes and times carry their units, and
  apps override the variables on `body.xh-app`. The unprefixed `--chat-*` hooks are gone. Some
  variables merged or went away, such as `--xh-chat-shadow`. See
  [Theming](desktop/cmp/chat/README.md#theming).
* Renamed the `chatModel` prop of `ChatMessageView` to `host`, which takes any
  `ChatMessageListHost`, such as a `ChatModel`.
* Removed the error banner with Retry from the end of the message list. A failed reply shows what
  happened inline, and the composer's status region holds the next action.
* Changed empty-state suggestions to fill the composer rather than send, so the user reads and
  can edit a prompt first. They hide while the composer has text. `onSelect` still overrides.
* Changed `ChatModel.submitFeedbackAsync()` and `undoTurnAsync()` to record a failure in
  `feedbackErrors` and `undoErrors`, by message id, in place of a toast.
* Renamed the approval buttons to Allow and Deny, with Allow first.
* Changed the sources list to count the sources a citing reply never cites, without numbers, so
  every number matches a marker. Numbers follow `marker` and never renumber.
* Changed `ChatMarkdownCitations.renderMarker` to replace the marker button, and to receive the
  number that cites the source.
* Changed `chatUiGrid` to render a light preview table inline, in place of a Hoist grid. Its full
  grid opens in the side panel or a dialog. Removed its `maxHeight` option and prop.
* Changed the `table` and `chart` requests of `ChatSidePanelModel` to take a `ChatDataView` or
  `ChatChartView` as `view`, and a `registry` that holds the artifact. A chart request requires
  its `view`.
* Changed the default height of `chatUiChart` from 280 px to the `--xh-chat-chart-height` CSS
  variable, 220 px or 160 px at compact density.
* Lowered the default `maxItems` of `chatUiMetricsSpec()` from 8 to 4. More metrics read better
  as a table.
* Changed `dashCanvasTools` to ask before `remove_widgets`, and before a `set_dashboard` that
  drops widgets. The `views` capability is now opt-in: name it in `capabilities` to offer it.

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
* Added `ChatAssistantModel`, a helper agent beside one component. It owns a short-lived chat
  built from the component's tool groups, and offers "Ask in chat" through an app seam.
* Added `chatAssistantButton` and `chatAssistantContainer`, which dock the helper inside a
  component 740 px or wider, or open it in a popover. `Ctrl/Cmd+I` opens it from the component.
* Added optional helper members to `ChatToolGroup`: `title`, `boundary()`, `snapshot()`,
  `isChangedSince()`, `highlight()` and `docs`. Undo retires once the component changes by hand.
* Added `targets` to `chatToolResult()`, for a helper to flash what a tool call changed.
* Added `ChatStreamReducer` and `createChatRunRequest()`, so an app can run a transport without
  `ChatModel`. The helper fills in a request from the messages, and the reducer folds the streamed
  events into the app's own `ChatMessage`.
* Added `ChatComposerHost`, the members a composer needs from its conversation. `ChatModel`
  implements it. Create a `ChatComposerModel` with a `host` of your own to use the composer
  without a `ChatModel`.
* Added `chatThreadList`, a desktop thread list with recency groups, search, inline rename, pin,
  and delete with a confirm. Rows show threads that run, wait for the user or ended early. It is
  a one-level tree grid, as its rows hold buttons. Delete or Backspace deletes the focused row.
* Added `searchesMessages` to `ChatThreadStore` and `ChatThreadListHost`, and `snippet` to
  `ChatThreadSummary`. Search results show their snippet, or "Searching titles" without it.
* Added `ChatThreadListHost`, the members a thread list needs. `ChatThreadsModel` implements it,
  so the list also works over threads an app holds itself.
* Added `chatWorkspace` and `ChatWorkspaceModel`, a full-page chat with a resizable thread
  sidebar, a rail, header and notice slots and a side panel. It lays itself out by its own width,
  measured as it mounts. Each width band sets the sidebar and side panel widths, and the
  conversation keeps 380 or 480 px. With `persistWith`, a reload returns to the open thread,
  unless the user first types in the new chat or changes its run options.
* Added `ChatThreadsModel.finishedAwayThreadIds`, the threads whose turn ended while the user was
  in another thread, and `lastRunEnd` and `lastRunReason` on `ChatThreadSummary`.
* Added `ChatKit.defaults`, the kit-wide settings, after the pattern of Hoist's
  `GridModel.defaults`. It holds the assistant icon, the stall time and the reduced-motion spinner.
  It also holds the steps the announcer reads, where drafts persist and the keyboard shortcuts.
* Added `ChatReplyStatus` and `getChatReplyStatus()`, the display status of a reply, such as
  `runningTool`, `stalled` or `cancelledByServer`. The desktop `ChatStatusCue` draws each status
  with one icon, label and color, and `ChatElapsed` ticks the time taken.
* Added a soft stalled state. A reply with no data for `stallAfterMs`, heartbeats included, shows
  "No response for 30s" until the next byte. `ChatModel.lastActivityAt` holds the activity time.
* Added `ChatRunRequest.onActivity`, which `HttpChatTransport` calls for each record it reads, so
  the chat sees heartbeats that never decode to events.
* Added `chatAnnouncer`, the kit's one voice for screen readers. The message list is a silent log,
  and the announcer reads each reply once as it finishes. The list and the composer render its
  regions, and each announcement reads once, in the newest visible set.
* Added a static twin for each moving chat cue, under reduced motion or inside an
  `xh-chat--reduced-motion` element. Set `ChatKit.defaults.reducedMotionSpinner` to `'spin'` to
  keep Hoist's spinner.
* Added `ChatMessageListHost`, the members the message list and its views read. `ChatModel`
  satisfies it. Pass a `host` of your own to show messages without a `ChatModel`.
* Added an inline failed row to a failed reply, with Edit Prompt and Copy Details. A message whose
  turn failed before its run started shows "Not sent" with Edit.
* Added thumbs to each reply when the chat takes feedback. A rating that asks for a comment opens
  an inline comment form, and with `requireComment` saves only with its comment.
* Added `reasons`, `clearable` and `maxCommentLength` to `ChatModelConfig.feedback`, and `reasons`
  to `ChatFeedbackSpec`. The form offers reasons as toggles on a negative rating.
* Added the full feedback flow: "Thanks" after a save, "Add a comment" after an up vote, and
  failures inline with Retry. One form is open per thread, and its draft survives a thread switch.
* Added a failed undo under the reply, with Retry, and a "Changes undone." note once it succeeds.
* Added a reason input to the approval panel, sent with Allow or Deny. A new request takes focus
  only from the conversation, while the composer is empty.
* Added the keyboard map from `ChatKit.defaults.shortcuts`: new chat, `/` to focus the composer,
  F6 between workspace regions, and an optional sidebar toggle. Each one can be remapped or set
  to null.
* Added Escape on the workspace side panel, which closes it. Escape stops a reply from the list,
  then focuses the composer.
* Added notices for a reply cut off at the length limit or ended by the server. The header warns
  of failed tools, and of a reply older than the host's `dataRefreshedAt`.
* Added keyboard moves between messages. Each message is a focusable `article`, Up and Down move
  between messages, and Escape stops a reply while focus is in the list.
* Added `ChatStatusRegion`, one line above the composer with the thread's next action: Try
  Again, Refresh Status, a countdown to a retry with Cancel, or Discard for a restored draft.
  `ChatPanel` renders it. The turn retries on its own at most 3 times in a row.
* Added retry safety. A failure is retry-safe unless `RUN_ERROR` sets `metadata.retrySafe: false`.
  In server mode, the kit's own `stalled`, `incomplete-stream` and `connection-lost` errors are
  not retry-safe. There, a stream that throws records `connection-lost`, unless it got a 4xx.
* Added `ChatModel.setStatusRefresher()` and `refreshStatusAsync()` for Refresh Status.
  `ChatThreadsModel` wires them to reload the thread.
* Added composer drafts in local storage, per thread, set by `ChatKit.defaults.drafts`. A
  restored draft shows "Draft from 10:31am restored." with Discard. A chat that moves to another
  thread shows that thread's draft, or empties. Call `ChatKit.clearLocalData()` on logout.
* Added thread ids to `ChatKit.clearLocalData()`, to remove the drafts of those threads only.
  `ChatThreadsModel` removes the drafts of the threads it deletes.
* Added `chatComposerPill`, a chip for the composer's left slot that opens a menu or a popover,
  and `chatScopeChip`, which scopes a question to the app's documents through `runOptions`.
* Added an offline state to the composer. It keeps the draft, disables Send and queues nothing.
* Added `ChatModelConfig.dataRefreshedAt`, and an optional reason to `approveToolCallAsync()`.
* Added `metadata.runStarted` to a reply whose run the backend began, and `metadata.endedAt` to
  each settled reply. A wait before a retry runs from `endedAt`.
* Added `host` to `ChatPartRenderContext`, and an optional `sendAsync()` to
  `ChatMessageListHost`, so that part renderers work over a host that is not a `ChatModel`.
* Added `ChatTextPart.revising`, set while the server rewrites streamed text that
  `xh.chat.textReplace` shortened. The reply then reads as `recomposing`, "Revising".
* Added a thread's run options to its chat when it opens, from its last question, so that a
  document scope stays with the thread.
* Added `sourceType` to `ChatSourcePart` and the `xh.chat.source` event: `document` for the app's
  own documents, or `url` for web pages. It defaults to `url` for a source with a URL.
* Added citation cards. A marker opens its source's title, excerpt and Open action on hover or
  focus. A web page's marker pins its card, and Ctrl or Cmd click opens a new tab.
* Added `[2–5]` ranges to citation markers. Four or more sources collapse to one marker.
* Added `ChatSidePanelModel`, the side panel's request seam, and `ChatSidePanelHost`. A document's
  citation opens in the app's `documentRenderer`, framed by `ChatSidePanel` with Back and status.
  The panel fills its column, and shows a page label once the viewer reports a page.
* Added `documentRenderer` and `sidePanel` to `ChatWorkspaceModel`, so a cited document opens
  beside the conversation. Without room, it opens in a new tab.
* Added the fixed "not found" reply, a data part of type `xh.chat.noAnswer` that renders as
  `ChatNoAnswer`, with no sources list and no Regenerate. Added `noAnswerEvents()`.
* Added `ChatTimeline`, the activity timeline for calls to tools with `display: 'timeline'`. One
  28 px line shows the current step while an agent works, then "Used 7 tools and 1 agent".
* Added the timeline's tree of rows, opened from its line: calls with their time and details,
  batches, narration, sub-agents and a pinned plan. Approvals and questions show while closed.
* Completed `ChatToolSpec.display` as the `ChatToolDisplay` enum: `card`, `inline`, `timeline`,
  `answer`, `pinned` and `hidden`. `card` stays the default.
* Added sub-agents from AG-UI's `SUBAGENT_*` events, as data parts of type `xh.chat.subagent`. A
  call's `subagentRunId` nests it under its sub-agent in the timeline. A sub-agent left running
  ends with its run or turn, and a stop cancels it.
* Added `cancelled` to tool call parts, set on calls open at a stop, with `isToolCallCancelled()`
  and `isToolCallFailed()`. The timeline and tool rows show such calls as cancelled, not failed.
* Added `announceSteps` to the message list, which also announces calls shown as cards.
* Added `startedAt` and `endedAt` to tool call parts, for the time each call took.
* Added `subagentEvents()`, and an `error` option for `toolCallEvents()`, to script agent runs.
* Added `addToolOutputAsync()` to `ChatMessageListHost`, for the timeline's question buttons.
* Added agents and failures to the announcement of a finished reply. It leaves out plan and
  hidden calls, and timeline narration.
* Added `emptyStateProps` to `ChatPanel`, for the heading, text and icon of its empty state, and
  `description` to `ChatSuggestion`, a line under the card's label.
* Added `composerModel` to `ChatSuggestions` and `ChatEmptyState`, so that suggestions work over
  a host that is not a `ChatModel`. With no composer and no `onSelect`, they render nothing.
* Added the full tier of result tables and charts. Expand opens one Hoist grid that pages
  through the result, with find, a column chooser and export, or a chart with type and axis
  switchers. It opens in the chat's side panel, else in a dialog.
* Added `ChatUiTableView` and `ChatUiChartView`, the full tiers, for apps to mount in their own
  layouts.
* Added `byReference` to `chatUiGridSpec()` and `chatUiChartSpec()`, for a table or chart of an
  artifact with a view over it. The model names the artifact and never copies its rows.
* Added `ChatUiGrid.defaults` for the preview's rows and columns, the page size and the row count
  above which an export asks first. Added `ChatUiChart.defaults` for the inline series and points.
* Added `invert` to metric tiles, for a metric where up is bad.
* Added `artifacts` to `ChatUiRenderContext`, and `decimals` to `ChatDataColumn`.
* Added `isChatUiMessagingAction()`. A card hides its `send` and `callTool` actions in a message
  list over a host that is not a `ChatModel`, and the catalog refuses them there.
* Added `useChatMarkdownStreaming()`, for a markdown component override to tell if its block
  still streams, and `isStreaming` to `ChatCodeBlock`.

### 🐞 Bug Fixes

* Fixed a failed reply announcing twice to screen readers. The failed row and the "Not sent"
  note have no alert role, and the composer's status region announces the failure once.
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

* Restyled the generative UI cards to the design: a 28 px header strip with Expand and options,
  a footer that says what a preview leaves out, and loading, failed and empty states that keep
  their height. Metric tiles are outlined, and card actions are follow-up chips after the card.
* Replaced the typing dots with a live status in the reply header, such as "Writing 6s". Added a
  caret at the end of streaming text. Inline spinners use Hoist's `Spinner` at 1em.
* Changed the generative UI skeleton from an endless pulse to a shimmer that starts after 1 s,
  sweeps three times, then holds still.
* Restyled the messages to the design. A reply has one quiet header line, and its reasoning and
  tool calls stack as 28 px outline rows. Prose stops at the prose width, and the action bar sits
  in the gap below a reply.
* Restyled markdown in replies. H1 and H2 render at Hoist's large font size, and tables render
  plain on Hoist's compact grid tokens. A table of more than 12 rows shows its first 12 in a
  card, with "Showing 12 of N rows" and Show All.
* Restyled code blocks as cards with a 28 px header strip. Once it ends, a block over 20 lines
  shows its first 20, with a button for the rest.
* Restyled the composer to the design: one hairline border, Hoist's focus border and shadow, and
  a 2 px top edge while busy. Pills sit on the left, and attach and Send on the right.
* Changed Send to a small primary button, and Stop to a button that keeps the word "Stop". The
  input grows to 8 lines by default.
* Restyled the empty state. `ChatPanel` centers the composer, with the heading above and the
  suggestion cards below. The first send moves it to the bottom, and focus stays in the input.
* Restyled citations and the sources list to the design: 14 px markers that never start a line,
  three rows then "Show N More", and document and web page rows styled apart. Favicons follow the
  image policy, else a letter tile shows.
* Changed the workspace side panel to open a table or chart wider than a document. It takes 60%
  of the width it shares with the conversation, from 480 to 900 px.
* Added the `xh-chat--compact` density class for narrow hosts, such as a docked side panel.
* Added `--xh-chat-*` CSS variables for the chat's colors, widths, radii and fonts, built from
  Hoist's theme variables, with light and dark defaults.
* Restyled the feedback form and the approval panel to the design. The approval panel sits in
  the attention-color frame, with its buttons left-aligned.

### ⚙️ Technical

* Reduced the catalog instructions to each tool's name and example props, so that each component
  description reaches the model once, in its tool.
* Added a package build check (`pnpm build`) to CI and to both deploy workflows.
* CodeQL now runs only when the repo is public, because code scanning needs GitHub Code Security on
  a private repo.
