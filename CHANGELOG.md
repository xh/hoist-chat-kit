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

Requires `@xh/hoist` 90.1 or later.

### 💥 Breaking Changes (upgrade difficulty: 🟢 LOW - Hoist 90.1, drop busy-line settings, update adapters)

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
* `ChatUiAdapter.translate()` now takes `{catalog, isPartial}` as its second argument, in place of
  the catalog. See
  [Update Protocol Adapters](docs/upgrade-notes/v2-upgrade-notes.md#3-update-protocol-adapters).
* `chatUiMetricsSpec()` now renders Hoist's `StatCardStrip`, with a `StatCard` per figure. Removed
  the `ChatUiMetrics` component, `chatUiMetrics()`, `ChatUiMetricsProps` and the
  `xh-chat-ui-metrics__*` classes. The spec's name and props are unchanged. See
  [Move Metrics Code to StatCard](docs/upgrade-notes/v2-upgrade-notes.md#5-move-metrics-code-to-statcard).
* Removed `AgUiCodecConfig.state`. The chat now holds the agent's state, and `AgUiCodec` sends it
  with each run. Move a codec `state` to `ChatModelConfig.prepareAgentState`. A backend that
  emits `STATE_SNAPSHOT` now gets its state back with every run. See
  [Move the Agent State to the Chat](docs/upgrade-notes/v2-upgrade-notes.md#6-move-the-agent-state-to-the-chat).

### 🎁 New Features

* `ChatThreadsModel` now blocks sends while the store lists a thread as running and its history has
  no settled reply to that turn yet. The status region shows the block only with Refresh Status,
  once the automatic checks below stop.

* `ChatThreadsModel` now checks on a turn that runs on the server while its chat does not follow
  it, and loads the reply once the thread list shows the run done. Set the interval with
  `ChatKit.defaults.statusRefreshMs` or `ChatThreadsConfig.statusRefreshMs`, null for none.
* Added `chatAnnouncer.withdraw()`, to take back an announcement whose news no longer holds. The
  status region withdraws a status's announcement once it passes.
* `ChatMessageList` now shows "Still working on the server" for such a turn with no reply saved
  yet, in place of the empty state or after the user's question. The composer's start items breathe
  while it runs.

* Added `ChatThreadsModel.showThreadTitle()`, to show a title the backend already holds, such as
  one it wrote in the background. The list and the workspace header show it at once, with no
  store call and no list reload.
* Added `ChatThreadsConfig.titleThreadAsync`, to give a thread the user starts a title of the app's
  own, such as a summary that a model writes. The model calls it once per thread, as soon as the
  backend has the thread, then saves the title through the store and shows it. A rename by the
  user wins.

* Added `ChatUiTextFormat`, a grammar for UI in reply text, and `ChatUiCatalogConfig.textFormats`.
  The tag grammar is now the first format, `chatUiTagFormat()`, and the default. `modes` take the
  name of a format, such as `tags`, to explain it to the model. `ChatUiCatalog.version` now covers
  any format other than the default, by name and by its optional `version`.
* Added `ChatUiCatalog.parseText()`, to split text with every text format, `toCopyText()`, to
  turn parsed text into words, and `toExport()`, to export the catalog for a server in one call.
* Added `ChatUiDocument.isPartial`, true while a document still grows, and
  `ChatUiElement.isPartial`, so that a format can mark each element of a partial document as
  complete. A complete element renders in full while the rest streams.
* `ChatUiCatalog.createDataRenderers()` now renders a document from an adapter or an `xh.chat.ui`
  data part as partial while it sets `isPartial`, with a placeholder for each element still to
  come. An adapter sets it from the `isPartial` of its context.
* Added `ChatUiComponentSpec.standalone`. A component that sets it to `false` shows only inside a
  nested answer, with no tool or tag of its own.
* Added `chatUiStackSpec()`, a column or row container for nested answers, and `chatUiTextSpec()`,
  a markdown text component for the prose between their components. Neither is standalone.
* Added `chatUiTabsSpec()` and `chatUiSectionSpec()`, containers for nested answers over Hoist's
  `TabContainer` and `Card`. Tabs show one child at a time, named by `titles`. A section groups
  its children under a title, and the user can collapse it. Neither is standalone.
* Added `chatUiCalloutSpec()`, a note, success, warning or error message over Hoist's `Banner`,
  with the `show_callout` tool. Its text renders as chat markdown, which loads no image.
* Added `chatUiBadgesSpec()`, a row of Hoist `Badge` labels, and `chatUiDividerSpec()`, a rule
  between the parts of a nested answer. Neither is standalone.
* Added `chatUiTreeMapSpec()`, boxes sized by one number and colored by another over Hoist's
  `TreeMap`, with the `show_treemap` tool. The app imports two Highcharts modules in its
  `Bootstrap.ts`: `highcharts/modules/heatmap`, then `highcharts/modules/treemap`.
* Added `ChatModel.streamingMessageId`, the id of the reply in progress. It changes only as a turn
  starts or ends, so a renderer that reads it does not re-render as the reply streams.
* Enhanced Copy and the announcement of a finished reply to read UI in the reply's text as words,
  from `toCopyText()`, not as its source. A host's `getCopyText` still wins for Copy.
* Added `openUiLangFormat()` in `/genui/openui/`, an experimental text format for OpenUI Lang. It
  renders each program in the reply text with catalog components, element by element as it
  streams, and keeps the prose around a fenced program as markdown. Its prompt section comes from
  lang-core's own generator, with the kit's rules.
* Added `openUiLangAdapter()`, which renders an OpenUI Lang program sent in a data part of type
  `openui`, element by element while the reply streams.
* Added `toOpenUiLibrary()`, which exports a catalog as an OpenUI library: the JSON Schema that
  OpenUI parsers read programs against, and a signature per component. The format's entry in
  `toExport().formats` carries it, for a server. `formatOpenUiProgram()` writes a document as a
  program, for prompt examples and scripted demos.
* Added `isChatUiActionSchema()`, true for a schema that `chatUiActionSchema()` returned. Formats
  use it to find action props, so place that schema in a props schema as is, not as a clone.
* Added support for AG-UI shared state. `ChatModel.agentState` holds the state an agent shares,
  such as the to-do list of a LangGraph deep agent, as an observable JSON value for the app to
  render. `STATE_SNAPSHOT` replaces it, `STATE_DELTA` patches it, and each run sends it back.
* Added `ChatModel.setAgentState()`, to change the agent's state while no turn runs, with
  `canSetAgentState` to say when. Added `ChatModelConfig.agentState`, for its first value.
  `clear()` and `loadMessages()` reset the state, and `loadMessages()` takes one in its new `opts`.
* Added `ChatModelConfig.prepareAgentState`, which sets the agent's state before each step, for
  values of the app's own that every run must carry, such as the current selection.
* Added `ChatMessagePage.agentState`, for a `ChatThreadStore` to return the state its backend
  holds for a thread. `ChatThreadsModel` also keeps the state of a closed thread in memory, and
  gives it to the thread's next chat.
* Added `ChatRunRequest.agentState` and `ChatStreamReducer.agentState`, for an app that runs a
  transport without `ChatModel`.
* Added state to generative UI documents. `ChatUiDocument.state` takes a `ChatUiStateSpec`, which
  creates the state of a rendered document and resolves the document for it. The catalog keeps
  the state while the document shows, and renders again when an observable it reads changes.
* Added `ChatUiComponentSpec.stateProps`, for the props that a user changes, and
  `context.setProp()` to write one. The write goes to the document's state where
  `ChatUiElement.bindings` ties the prop to it. Otherwise the catalog keeps the value.
* Added the `state` action, which runs steps on the state of its document and says what they do
  in its `summary`. `chatUiActionSchema()` allows it only where `types` lists `state`. A `state`
  action with a `disabledReason` never runs, and the built-in button shows the reason.
* Added form components to `/desktop/cmp/genui/`: `chatUiFormSpec()`, `chatUiButtonSpec()`, and
  input specs over Hoist's `TextInput`, `TextArea`, `NumberInput`, `Select`, `DateInput`,
  `Checkbox`, `SwitchInput` and `SegmentedControl`. `chatUiInputSpecs()` returns them all. Each
  input validates with Hoist rules, and a button in a form sends the field values with its
  message.
* Added `chatUiRadioGroupSpec()`, a list of choices with one selected over Hoist's `RadioInput`,
  and `chatUiSliderSpec()`, a number in a range over Hoist's `Slider`. A slider with `range` holds
  a low and a high value. `chatUiInputSpecs()` returns both.
* Added `chatUiProgressSpec()`, a column of bars over Hoist's `ProgressBar`, and
  `chatUiStepsSpec()`, a sequence of steps with a status each over Hoist's `Steps`. Neither is
  standalone.
* Added `chatUiKeyValuesSpec()`, a list of labeled values over Hoist's `KeyValueList`. It is not
  standalone.
* Added `trend` to a metric of `chatUiMetricsSpec()`, a list of recent values that the stat card
  draws as a Hoist `Sparkline`. The `maxTrendPoints` option bounds it.
* `chatUiDividerSpec()` now renders Hoist's `Separator`, and takes an optional `label`. The rule
  is a `div` with the `separator` role, in place of an `hr`.
* The text input and text area specs now set `maxLength` on Hoist's `TextInput` and `TextArea`,
  so the user cannot type more than a message carries.
* Added `bindings` and `builtinFunctions` to `openUiLangFormat()` and `openUiLangAdapter()`. With
  `bindings`, a program runs `$variables`, expressions, `@Set` and `@Reset` on lang-core's own
  store and evaluator, and a state prop takes a `$variable` both ways. Both are off by default.
* Added `queryTools` to the same options. A program's `Query()` calls only the chat tools that
  the app lists there, and refuses a tool that needs approval. A program cannot change data: the
  kit runs no `Mutation()`, and the options throw for `mutationTools`.
* Added `maxCalls`, `maxCallsPerMinute` and `onToolCall` to the same options. A program holds at
  most 8 `Query()` statements by default, the programs of a chat start at most 60 calls a minute,
  and `onToolCall` reports each call that runs. Only the first three programs of a reply run
  queries, and a program in an older reply runs them only once the user acts in it.
* Added a gate in front of every evaluation of an OpenUI Lang program, from the parse on. A
  program past a limit on its length, its statements or the values it expands to shows as one
  fallback, in a few milliseconds. The fallback says why, in plain words.
  `/genui/openui/README.md` lists each limit.
* Added `caption` to `ChatUiFallbackSegment`, for a format to say why content cannot show.
* `toOpenUiLibrary()` now throws for a component that nests an action below the top level of a
  prop. Give the action a prop of its own, or a list prop whose items are actions.
* The OpenUI Lang prompt now takes only its grammar from lang-core. The kit writes the sections
  on actions, filters, forms and the data workflow from the catalog, with the catalog's own
  components in their examples. Its default `examples` are now at most two complete programs,
  each in a fence in inline mode, in place of one program per component.
* Added `computed` to the `openui` diagnostics of a document segment: the ids of the elements
  with a prop that the state computes.
* A `Query()` now runs a tool with no `parameters` schema only with no arguments.
* The built-in button now sizes to its label, and a field in a form fills the form's width.
* An OpenUI Lang action now comes only from action syntax, such as `@Set` and `@ToAssistant`.
  An action written as data, or one that the user could not review in full, renders as a
  disabled button that says why. The steps of an `Action([...])` evaluate in order when the
  button renders, so a step sees the values that a `@Set` before it sets.
* `openUiLangFormat()` now renders a statement still being written without the value that a
  chunk cut short, so a valid program shows no fallback as it streams. It reads one action where
  a prop takes a list, and shows an argument written by name as a fallback that names it.
* Added `isOpenUiDocumentSegment()`. The document segment of an OpenUI Lang program carries
  `openui`, with the parser's errors, the undefined names and the unused statements.
* The OpenUI Lang prompt now offers each action prop only the steps that its schema accepts, and
  says what lang-core's text names that the catalog lacks. The kit's rules sit with lang-core's
  own rules.

### 🐞 Bug Fixes

* Fixed `describeChatUiAction()` and `formatChatUiContext()` to show a character the user could
  not see, such as a zero-width space or a right-to-left override, as its code. The tooltip of a
  `send` action now shows its text and each context value as a JSON string, so text cannot pose
  as the words around it. The url of an `openUrl` action shows in quotes too.
* Fixed `ChatUiChart` and `ChatUiChartView` to escape the text they pass to Highcharts: series,
  slice and category names, axis titles, and the column labels and row text of a chart by
  reference. Highcharts reads such text as markup, so a model or a result could draw a link that
  skipped the chat's link checks, or an inline style that loads a URL.

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
  every tool call, sub-agent and reasoning part by the load, so each showed "<0.1s". The timeline,
  its screen reader labels and the reasoning label now show no time for them. A backend that
  stores events should stamp each one as the agent emits it.

### ⚙️ Typescript API Adjustments

* `ChatUiActionType` and `ChatUiAction` gained `state`. Add a case for it to a `switch` over
  action types that must cover every type.
* `ChatUiRenderContext` gained `setProp`. Add it to a render context built by hand, as in a spec
  that calls a component's `render` directly.

### ✨ Styles

* `ChatWorkspace` lays out its sidebar and side panel for the 1px panel splitter of Hoist 90, in
  place of the 8px splitter of Hoist 89.
* Added the `xh-chat-timeline--detached`, `xh-chat-timeline__item--unfinished`,
  `xh-chat-tool-call--unfinished`, `xh-chat-tool-call__glyph--unfinished` and
  `xh-chat-message-list__awaiting-reply` classes. A detached
  reply's timeline no longer takes `xh-chat-timeline--stopped`.
* Added the `xh-chat-ui-form`, `xh-chat-ui-field` and `xh-chat-ui-button` classes, on the form
  components. They take their look from Hoist's `FormFieldSet`, `FormField` and `Button`.

### 📚 Libraries

* @xh/hoist `89.3 → 90.1`
* @openuidev/lang-core `1.1.0` - added as an optional peer dependency, at that exact
  version. Apps that use `/genui/openui/` install it with `zod`. Other apps never load it.

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
