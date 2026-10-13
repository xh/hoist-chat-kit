# Research: Toolbox `weatherv2` LLM chat integration

Prior art and first consumer for `@xh/hoist-chat-kit`. Source: `origin/weatherv2` in `/Users/amcclain/dev/toolbox`, read with `git show` only (the working tree stayed on `develop`). Merge base with `origin/develop`: `5a6c744112a4`. The branch adds 55 files, about 10,500 lines. Nothing was run. Where a finding comes from reading code, not from observed behavior, the text says so.

Path shorthand: `W` = `client-app/src/examples/weatherv2`. Line numbers refer to the files on `origin/weatherv2`.

## 1. Architecture

### Pieces

| Piece | File | Role |
|-------|------|------|
| Chat panel | `W/harness/ChatHarnessPanel.ts` (387 lines) | `hoistCmp.factory` with `creates(ChatHarnessModel)` (l.13-16). Renders a `panel` with a message list, an error strip, and an input row (l.33-37). |
| Chat model | `W/harness/ChatHarnessModel.ts` (325) | Holds the conversation, runs the tool loop, runs the typewriter. |
| Chat service | `W/svc/LlmChatService.ts` (266) | A `HoistService`. Builds the system prompt and posts to the proxy (`generateAsync`, l.79-103). |
| Tool service | `W/svc/LlmToolService.ts` (615) | A `HoistService`. Holds tool definitions and `executeToolAsync` (l.37-47). |
| Server proxy | `LlmController.generate` (POST `llm/generate`) and `LlmService.generate` | A thin, non-streaming relay to the Anthropic Messages API. |

Services register in `AppModel.initAsync` with `XH.installServicesAsync([LlmChatService, LlmToolService, WeatherDataService], ctx)` (`AppModel.ts:31`). `Bootstrap.ts` augments `XHApi` with `llmChatService` and `llmToolService`. The model reaches them as `XH.llmChatService` and `XH.llmToolService` (`ChatHarnessModel.ts:134-135`).

### Data flow for one user turn

1. `sendMessageAsync` (l.72-87) trims the input, appends `{role:'user', content: string}` to `messages` (the Anthropic-shaped history), and calls `rebuildDisplayMessages()`. It then starts `doGenerateAsync()` and links the promise to `generateTask` (a `TaskObserver.trackLast()`).
2. `doGenerateAsync` (l.131-227) reads the live dashboard with `getCurrentSpec()` (l.270-278). That calls `dashCanvasModel.getPersistableState()`. It builds the system prompt once, with the widget catalog, spec docs, rules, and a "Current Dashboard State" block annotated with instance IDs (`LlmChatService.ts:41-72`). It also fetches the tool definitions.
3. The tool loop runs at most `MAX_TOOL_ITERATIONS = 5` times (l.26, 146-187):
   - Call `chatSvc.generateAsync(systemPrompt, this.messages, tools)`, which returns the content blocks.
   - Push `{role:'assistant', content: blocks}` onto `messages`.
   - Collect `text` blocks.
   - If there are no `tool_use` blocks, break.
   - Otherwise run each block through `toolSvc.executeToolAsync(name, input)` sequentially. Build `tool_result` blocks with `tool_use_id`, `content`, and `is_error`, and push them as one `{role:'user', content: toolResults}` message.
4. After the loop, one assistant `DisplayMessage` is appended. It has all text parts joined by blank lines, all `ToolCallDisplay`s, and the elapsed time (l.207-221). A single `XH.successToast('Dashboard updated.')` fires if any dashboard-mutating tool succeeded (l.193-205). Then the typewriter starts (l.220).
5. On any exception, `lastError` is set (l.222-226). The panel shows Retry and Edit buttons.

The server never sees display messages. The client sends `{systemPrompt, messages, tools}` on every hop, with full history each time. The server adds `model`, `max_tokens`, and the API key, and returns the raw Anthropic response (`LlmService.groovy:58-87`).

### Layout and mounting

- The app shell is `panel({tbar: appBar(...), item: hframe(frame(dashCanvas), panel({model: harnessPanelModel, items: [...], omit: !showHarness}))})` (`AppComponent.ts:33, 88-109`).
- The chat is a **right-side, resizable sidebar**. `AppModel.ts:33-40` builds `new PanelModel({side:'right', defaultSize:500, minSize:300, resizable:true, collapsible:false, persistWith:{...this.persistWith, path:'harnessPanel'}})`.
- That one side panel hosts three mutually independent children, each toggled by an app-bar button: chat (`showChatHarness`, default `true`), JSON editor (`showJsonHarness`), and widget chooser (`showWidgetChooser`). All three are `@bindable @persist` on `AppModel` (l.24-27). The side panel is omitted when none is shown. When several are shown, they stack vertically, each `flex: 1, minHeight: 0`.
- The app bar button uses the `sparklesIcon` and the label "Dashboard Agent" (`AppComponent.ts:56-64`).

### How tools mutate the app

All tools run client-side, inside `LlmToolService`.

- **Dashboard tools.** `getCurrentStateArray()` reads `weatherV2DashModel.dashCanvasModel.getPersistableState().value.state` (l.324-328). Tools edit that array immutably. They validate the whole resulting spec with `validateSpec` and throw on failure. They then call `applyState`, which is `dashCanvasModel.setPersistableState(new PersistableState({state}))` (l.331-334). Hoist's persisted DashCanvas state is the DSL, so no translation layer exists.
- **App tools.** These call `viewManager.saveAsAsync`, `selectViewAsync`, and `resetAsync`. `XH.toggleTheme()` switches the theme. They set `appModel.showWidgetChooser`, `appModel.showJsonHarness`, and `appModel.manualEditingEnabled` directly (l.81-136).
- The service reaches the app through `XH.appModel as AppModel` with `import type {AppModel}`. The README (agent note 7) requires this to keep the runtime import graph acyclic.

## 2. Tool definitions

### Shape

`LlmToolService.ts:8-16`:

```ts
export interface ToolDefinition {
    name: string;
    description: string;
    input_schema: {type: 'object'; properties: Record<string, any>; required?: string[]};
}
```

This is the **Anthropic wire format** (snake_case `input_schema`). The tools live in one module-level `TOOL_DEFINITIONS: ToolDefinition[]` constant (l.357-615). `getToolDefinitions()` returns it (l.32-34).

Execution is **not** a registry. It is one `switch (name)` in `doExecuteAsync` (l.52-141), with a `default` that throws `Unknown tool`. Definitions and implementations are linked only by name strings. Adding a tool means editing three places: the definitions array, the switch, and (in the panel) `friendlyToolSummary`. The schemas are hand-written JSON Schema objects. There is no runtime input validation beyond ad hoc checks inside each implementation (for example `if (!instanceId) throw ...`).

### Tools (13)

| Tool | Kind | Behavior | Impl line |
|------|------|----------|-----------|
| `set_dashboard` | dashboard | Replace the whole spec. Runs `migrateSpec` and `validateSpec`. Returns "Dashboard updated with N widgets: ids". | 148-166 |
| `add_widget` | dashboard | Append a widget. Auto-places at the bottom when `layout` is omitted. Returns the new instance ID. | 169-201 |
| `remove_widget` | dashboard | Remove by instance ID. Fails validation if other widgets bind to it. | 204-235 |
| `update_widget` | dashboard | Shallow-merge `state`, merge `bindings` by input name, merge `layout`. | 238-292 |
| `move_widget` | dashboard | Delegates to `update_widget` with layout only. | 295-302 |
| `list_widgets` | dashboard | Returns pretty JSON of IDs, types, layouts, state. | 305-317 |
| `save_dashboard_as_view` | app | `viewManager.saveAsAsync`. | 81-93 |
| `switch_to_view` | app | Case-insensitive name lookup. The error lists the available views. | 95-109 |
| `reset_dashboard` | app | `viewManager.resetAsync()`. | 111-114 |
| `toggle_theme` | app | `XH.toggleTheme()`. | 116-120 |
| `open_widget_chooser` | app | Sets `showWidgetChooser = true`. | 122-125 |
| `show_json_spec` | app | Sets `showJsonHarness = true`. | 127-130 |
| `toggle_manual_editing` | app | Flips `manualEditingEnabled`. | 132-136 |

The planning log (`PROGRESS.md`) says "6 tools implemented" for the first tool pass. The dashboard tools and `toggle_manual_editing` came later, so the log is stale.

### Results and errors

- `executeToolAsync` wraps `doExecuteAsync` in try/catch and returns `{content: string, isError: boolean}` (l.37-47). Success returns a human-readable sentence (or JSON text for `list_widgets`). A thrown error becomes `{content: e.message, isError: true}`.
- The model turns that into a `tool_result` block `{tool_use_id, content, is_error}` (`ChatHarnessModel.ts:175-180`). It sends the block back as a `user` message.
- Error messages are written for the LLM to self-correct. Examples are `Invalid viewSpecId "x". Available types: ...`, `No widget found with instanceId "x". Current widgets: ...`, and `Validation failed: <joined messages>`. The validation messages come from `validateSpec` in `dash/validation.ts`.
- There is no per-tool timeout, no cancellation, and no confirmation step for destructive tools. `set_dashboard` and `reset_dashboard` run immediately.
- The system prompt steers tool choice in prose (`TOOL_USE_GUIDANCE`, `LlmChatService.ts:227-258`). It says to prefer `set_dashboard` when a plan needs more than 3 calls, because every granular call rebuilds the dashboard.

## 3. Reusable, weak, and app-specific

### Reusable candidates for the kit

- **Panel structure.** Message list, empty state with clickable suggestions, error strip with Retry and Edit, textarea with Enter-to-send (Shift+Enter for a newline), and Send button disabled while pending (`ChatHarnessPanel.ts:45-387`).
- **Thinking-dots placeholder** while the task is pending (l.51-56, 75-94).
- **Tool-call cards.** Collapsible native `<details>`, with a summary row, a small input and result display, and a readonly `jsonInput` (copy and fullscreen buttons) for payloads of 120 characters or more (l.139-201). Error results get an error class.
- **Assistant markdown rendering** through Hoist's `markdown` component, plus per-message elapsed time (l.104-110, 203-211).
- **Model skeleton.** `userInput`, `messages`, `lastError`, `generateTask = TaskObserver.trackLast()`, `sendMessageAsync`, `retryLastAsync`, `editLast`, `clearChat` (`ChatHarnessModel.ts:36-121`).
- **The tool-use loop** with an iteration cap, sequential execution, and `is_error` propagation (l.146-187), once it is lifted off Anthropic types.
- **Tool service contract.** Names, descriptions, JSON-schema input, and `execute` returning `{content, isError}`, with errors caught and fed back (`LlmToolService.ts:37-47`).
- **Server proxy.** The config-driven API key, model, and max tokens, per-user rate limit, and `DataNotAvailableException` for a missing key (`LlmService.groovy:50-119`). This probably belongs in hoist-core or the kit's server docs, not the client package.
- **Chat CSS.** See section 4.
- **Persisted side-panel pattern** (`PanelModel` right, resizable, persisted). This is an app pattern the kit could document or wrap.

### Ad hoc or weak (observations from reading the code)

1. **Fake typewriter instead of streaming.** The full response arrives first. The client then reveals it with a 12 ms `setInterval`, in `max(3, ceil(len/100))`-character steps (`ChatHarnessModel.ts:283-316`). It is skipped for messages under 30 characters. During the animation the bubble renders plain text, then swaps to markdown at the end (`ChatHarnessPanel.ts:101-110`). The swap causes a reflow and a visible jump. Latency is the full round-trip plus the animation.
2. **Index-based display messages.** `typingMessageIdx` and `getDisplayContent(index, ...)` identify messages by array position. React keys are indices (`key: index`, l.113). `rebuildDisplayMessages` (l.235-268) reconciles two parallel arrays by interleaving. It only handles user messages, so `editLast` and `clearChat` can desynchronize `messages` and `displayMessages`. Display messages need stable IDs, and one source of truth is better than two parallel arrays.
3. **`_isGenerating` guard.** A synchronous boolean (l.49-52, 75, 85) sits next to `generateTask.isPending`. The comment says MobX batching can miss same-tick calls. `@action` on an `async` method only wraps the synchronous portion. The `.finally(() => (this._isGenerating = false))` pattern is easy to break. The kit should have one in-flight state machine (idle, sending, streaming, awaiting tool, error) instead.
4. **Scroll handling.** A `ref` callback on the message div sets `scrollTop = scrollHeight` (`ChatHarnessPanel.ts:65-67`). It runs on every render, so it forces the view to the bottom even when the user has scrolled up to read. There is no "stick to bottom only if already at bottom" logic and no jump-to-latest affordance. With real streaming this gets much worse.
5. **Anthropic wire types leak into the UI model.** `ContentBlock` and `ChatMessage` (`LlmChatService.ts:9-31`) use `tool_use_id`, `is_error`, and `stop_reason`. `ChatHarnessModel` builds and inspects blocks directly (l.155-180). `ToolDefinition` uses `input_schema`. Provider details (OpenAI, Bedrock) would require changes across UI, model, and tool service. The kit needs a neutral message model (`text`, `toolCall`, `toolResult` parts) with the provider mapping on the transport edge.
6. **Mid-loop failure loses state (read from code, not run).** If `generateAsync` throws on iteration 2 or later, `allToolCalls` and any text are discarded because the display message is only appended after the loop. The tools already ran and the dashboard already changed. The UI shows only the error. `editLast` pops the last message only if it is a string-content user message (l.101-112). When the last message is a `tool_result` user message, `userInput` becomes `''` and only that message is dropped, which leaves an assistant `tool_use` with no matching `tool_result`. The Anthropic API would likely reject the next request. I did not verify that API behavior.
7. **Stale system prompt within a turn.** The prompt, including the current dashboard JSON, is built once before the loop (l.137-139). The dashboard changes during the loop. The prompt mentions `list_widgets` for that case, but it is only guidance.
8. **No conversation bounds.** The full history is resent on every hop, with no truncation, summarization, or token budget. Tool results (including `list_widgets` JSON) stay in the history forever.
9. **No cancel/stop.** There is no abort for an in-flight request or loop, and no `autoAbortKey` use. `clearChat` during a pending request does not stop the loop. The loop would append to the cleared `messages`.
10. **`formatMessageContent` is app-specific and legacy.** It replaces fenced JSON with `[Dashboard spec applied]` (l.323-325), a leftover from the pre-tool "LLM emits JSON" design. `parseSpecFromResponse` (`LlmChatService.ts:109-138`) looks unused by the tool-based flow (I found no caller in the files read).
11. **Hardcoded tool names in the UI.** `friendlyToolSummary` switches on 13 tool names (l.214-247). `DASH_TOOLS` in the model hardcodes which tools count as "dashboard mutating" for the toast (l.193-199). Both should be metadata on the tool definition (`label`, `summarize(input)`, `mutates`).
12. **Raw DOM for details.** `createElement('details', ...)` is used instead of an element factory (l.143-158). It works, but it is the one non-Hoist pattern in the panel.
13. **Misc.** `track` metadata on `generateAsync` is hardcoded to category `WeatherV2` (l.91-97). The panel strings ("Dashboard Agent", "Tell the agent what to build...") are inline. The `textArea` is disabled while pending, so focus is lost after each send. There is no per-message copy, regenerate, or feedback.

### Must stay app-specific

- The system prompt text and builder (`LlmChatService.ts:41-72, 144-266`), including widget docs from `widgetRegistry.generateLLMPrompt()`, the city list, and the dashboard-state block.
- All 13 tool definitions and implementations. The shape of the registry is kit material, but the tools mutate `weatherV2DashModel`, `viewManagers.weatherDashboardV2`, and `AppModel` flags.
- The `getCurrentSpec()` context provider (`ChatHarnessModel.ts:270-278`).
- Suggestion copy and empty-state intro (`ChatHarnessPanel.ts:252-275`), the panel title and icon, and the input placeholder.
- The "Dashboard updated." toast rule, the `friendlyToolSummary` labels, and the `sparklesIcon` registration (each app registers its own FA icons).
- The persistence key, layout, and app-bar toggle.

## 4. Styling

All chat styles are in `W/WeatherV2.scss` (lines 226-590), under `weather-v2-*` BEM-ish class names. The file is plain nested SCSS with 2-space indent. The chat section contains **no hex colors** (my count of `#xxx` matches in lines 226-590 was 0).

Key selectors and patterns:

```scss
.weather-v2-chat-body { min-height: 0; overflow: hidden; }          // l.228: messages scroll inside, not the panel

.weather-v2-chat-messages {                                          // l.302
  flex: 1; overflow-y: auto; padding: 8px;
  display: flex; flex-direction: column; gap: 8px; }

.weather-v2-chat-msg {                                               // l.311
  padding: 8px 10px; border-radius: 6px;
  &--user      { background: var(--xh-bg-highlight); align-self: flex-end; max-width: 90%; }
  &--assistant { background: var(--xh-bg-alt);       max-width: 95%; }
  &__role      { font-size: var(--xh-font-size-small-px); color: var(--xh-text-color-muted); ... }
  &__content   { white-space: pre-wrap; overflow-wrap: break-word; font-size: var(--xh-font-size-px);
                 &--typing::after { content: '\25AE'; animation: blink-cursor 0.6s step-end infinite; } } }

.weather-v2-chat-markdown { white-space: normal; ... }               // l.359, ~100 lines of p/ul/ol/code/pre/table/blockquote
                                                                     //   rules using --xh-bg-alt, --xh-border-color,
                                                                     //   --xh-orange (blockquote border), --xh-blue (links)
.weather-v2-thinking-dot { animation: thinking-bounce 1.2s ease-in-out infinite; ... }  // l.476, 3 dots with staggered delay

.weather-v2-chat-error { border-top: var(--xh-border-solid); background: var(--xh-red-trans1);
  &__message { color: var(--xh-intent-danger); } }                   // l.516

.weather-v2-tool-call {                                              // l.540: <details> card
  background: var(--xh-bg-highlight); border: 1px solid var(--xh-border-color);
  &__summary { list-style: none; &::before { content: '\25B6'; ... } }   // custom disclosure triangle
  &[open] > &__summary::before { transform: rotate(90deg); }
  &__error { color: var(--xh-intent-danger); } }

.weather-v2-chat-input { display: flex; gap: 8px; padding: 8px; border-top: var(--xh-border-solid); align-items: flex-end; }

.weather-v2-chat-suggestion { border: 1px solid var(--xh-border-color); background: var(--xh-bg-alt);
  &:hover { background: var(--xh-bg-highlight); border-color: var(--xh-blue-muted); } }
.weather-v2-chat-empty { background: radial-gradient(ellipse at center,
    color-mix(in srgb, var(--xh-bg-alt) 40%, transparent) 0%, transparent 70%); }  // l.242
```

Observations:

- **Hoist vars used:** `--xh-bg`, `--xh-bg-alt`, `--xh-bg-highlight`, `--xh-border-color`, `--xh-border-solid`, `--xh-text-color-muted`, `--xh-font-size-px`, `--xh-font-size-small-px`, `--xh-intent-danger`, `--xh-red-trans1`, `--xh-blue`, `--xh-blue-muted`, `--xh-orange`, `--xh-border-radius-px` (the last in the app root, l.12).
- **Dark theme:** there are no `xh-dark` selectors or theme branches in the file. Dark mode works only because every color goes through `--xh-*` variables that Hoist re-maps for dark. The kit should keep this rule. I did not render it in dark mode.
- **Hardcoded values:** pixel radii (`6px`, `8px`, `4px`), `11px` for the elapsed label, and gaps in px. The kit should prefer `--xh-pad-px` multiples and `--xh-border-radius-px`.
- **Class names:** the prefix `weather-v2-` must become a kit prefix (for example `xh-chat-`) with a documented class contract. Components are not wrapped in a single root `className`, so styles are global class selectors rather than scoped under one component class. The kit's CLAUDE.md asks for scoping under the component's `className`.
- **Transcluded markdown styles** were adapted from Toolbox's `MarkdownPanel.scss` (comment at l.357-358). The kit should check whether Hoist's `markdown` component already ships styling to avoid duplication.

## 5. Server

### Endpoint contract

- `POST /llm/generate` (`LlmController.generate`, `@AccessAll`, extends the Toolbox `BaseController`).
- Request body: `{systemPrompt: string, messages: [{role, content: string | block[]}], tools?: [...]}`. The controller throws `RuntimeException` (HTTP 500) if `systemPrompt` or `messages` is missing (`LlmController.groovy:28-29`).
- Response: the Anthropic Messages response, unchanged (`content[]`, `stop_reason`, `usage`, ...). The client reads `content` and `stop_reason` (`LlmChatService.ts:100-102`).
- No endpoint takes `model` or `maxTokens` from the client. Both come from config.
- `@AccessAll` means any authenticated user can call it. There is no role gate.

### `LlmService.generate` (`LlmService.groovy:50-87`)

- Calls `checkApiKey()` (throws `DataNotAvailableException` when the key is blank or `UNCONFIGURED`) and `checkRateLimit(username)`.
- Builds `{model, max_tokens, system, messages, tools?}`, serializes with `JSONSerializer`, and POSTs to `https://api.anthropic.com/v1/messages` with `x-api-key` and `anthropic-version: 2023-06-01`.
- Uses `new JSONClient()` with no timeout (`timeoutMs` defaults to null in hoist-core's `JSONClient`). It runs inside a `span('generate', ...)`. `executeAsMap` buffers and parses the whole response.
- Failures log and rethrow as a generic `RuntimeException("LLM API call failed: ...")`. The Anthropic status and error type are lost to the client.
- `getAdminStats` shows the four configs. `clearCachesConfigs` covers all four.

### Config entries (`BootStrap.groovy` diff, all group `Toolbox - Example Apps`)

| Name | Type | Default | Note |
|------|------|---------|------|
| `llmApiKey` | `pwd` | `'UNCONFIGURED'` | Anthropic key. |
| `llmModel` | `string` | `'claude-sonnet-4-6'` | Model ID. |
| `llmMaxTokens` | `int` | `8192` | Output cap. The deployment memo said 4096. The code and `PROGRESS.md` raised it for tool use. |
| `llmRateLimit` | `int` | `20` | Requests per user per hour, per server instance. |

`DEPLOYMENT-MEMO.md` proposed an `llmProvider` config and OpenAI fallback. Neither was built.

### Rate limiting

- An in-memory `Map<String, List<Long>>` of timestamps per username, with a one-hour sliding window, guarded by `synchronized` methods (l.34, 92-110).
- `recordRequest` runs only after a successful call (l.81), so failed calls do not count. Check and record are separate synchronized calls, so concurrent requests from one user can pass the check together (read from code).
- Each tool-loop hop is one request. A turn with tools costs 2 to 5 requests, so 20 per hour is a handful of conversations.
- The map is per node and cleared by `clearCaches()` (l.121-126). It is not cluster-aware, which the class doc admits.
- No token or cost accounting. The Anthropic `usage` is returned to the client but not logged or tracked server-side.

### What real token streaming (SSE) would need

**Server (Groovy):**

1. The Anthropic request needs `"stream": true`. The response is then `text/event-stream` (SSE) with events such as `message_start`, `content_block_start`, `content_block_delta`, `content_block_stop`, `message_delta`, and `message_stop`. `JSONClient.executeAsMap` buffers and cannot be used. A raw `CloseableHttpClient` call with `getEntity().getContent()` read line by line is needed (from my knowledge of Anthropic's streaming API, not checked against current docs here).
2. A new controller action that writes to `response.outputStream` and flushes per event. Rate limit and key checks must run **before** the first write, since the status cannot change after commit.
3. Mid-stream error handling. Once committed, an error can only be signaled in-band (a final `error` event).
4. Client disconnect handling. `BaseProxyService` catches `ClientAbortException` for this reason (`BaseProxyService.groovy:~100`).
5. Compression and buffering. hoist-core adds `application/x-ndjson` to `server.compression.mimeTypes` (CHANGELOG "Technical" entry). `text/event-stream` is not mentioned. Proxies (xh-nginx) may need buffering off. I did not verify either.
6. Usage logging from the final `message_delta` event.

**What hoist-core already has (searched `/Users/amcclain/dev/hoist-core`):**

- **No SSE support.** Searches for `text/event-stream`, `StreamingResponseBody`, and `SseEmitter` in `.groovy`, `.java`, and `.md` files found no code hits.
- **`BaseController.renderNDJSON(source, contentType = 'application/x-ndjson')`** (`grails-app/controllers/io/xh/hoist/BaseController.groovy:54-103`). It streams an `Iterable` or `Iterator` through a `BufferedOutputStream` (32 KB buffer) over `response.outputStream`. It flushes after the first element so early failures still return a clean error. On a mid-stream failure it writes a poison line `//xh-ndjson-stream-error` so clients fail parsing instead of treating truncation as success. It is designed for row datasets, but it is the existing chunked-streaming primitive. Two caveats for chat. First, the 32 KB `BufferedOutputStream` only flushes on the first element and at the end, so small per-token rows would sit in the buffer unless the caller forces a flush. That is how I read the code; I did not run it. Second, it takes a pull-based `Iterator`, so an Anthropic SSE reader could be wrapped as an iterator that yields normalized delta objects.
- **`BaseProxyService`** streams an upstream entity with `sourceResponse.entity?.writeTo(response.outputStream)` then `response.flushBuffer()` (`grails-app/services/io/xh/hoist/http/BaseProxyService.groovy:~96-99`). It is a pass-through, not incremental per event.
- `JSONClient` supports a `timeoutMs` per client or call, but only for buffered calls.

**What hoist-react has (searched `/Users/amcclain/dev/hoist-react`, `svc/FetchService.ts`):**

- `XH.fetch(opts)` without `asJson` **returns the raw `Response`** (`FetchService.ts:127-134`: "Set `asJson` to true to return a parsed JSON result, rather than the raw Response"). `abortableFetchAsync` returns `ret` (l.436-505) after checking `ok`. So `response.body.getReader()` is reachable today, and callers can parse SSE themselves. `fetchOpts` is spread into the native `RequestInit` (l.458-465) and `autoAbortKey` plus `XH.fetchService.abort(key)` give cancellation (l.409-415, 247-258).
- **Caveat:** `timeout` wraps the promise from `fetch` to `parseJson`/response (l.416-419), so for a raw `Response` it covers time to headers. It is a request-phase timeout. The `fetchNdjson` doc says the same.
- **`XH.fetchNdjson(opts)` already exists** (`FetchService.ts:156-211`, `XH.ts:311-315`, impl in `svc/impl/NdjsonResultImpl.ts`). It returns `{lines: AsyncGenerator<PlainObject>, meta: Promise|null}`. It parses records incrementally, supports `firstLineIsMeta`, wraps tracing and `track` over the full stream, and raises a `Fetch Stream Failed` exception on poison or truncation. It issues requests by `method`/`params` rules, so a POST with a JSON body should work via `body` and `method: 'POST'`. I did not verify that combination, so check it with a spike.
- Net: **NDJSON is the lowest-friction streaming path that is already supported on both ends.** The server maps Anthropic SSE events to NDJSON lines (`{type:'text_delta', text}`, `{type:'tool_use', ...}`, `{type:'done', usage}`). The client does `for await (const line of XH.fetchNdjson({url, method:'POST', body, ...}).lines)`. SSE proper would need a custom reader over `XH.fetch(...)` plus an SSE line parser, and would not get `fetchNdjson`'s tracing and error semantics. A decision for the kit: use NDJSON over POST, or raw SSE.

## 6. Migration plan sketch

### Replaced by kit imports

| weatherv2 today | Kit replacement (names are proposals) |
|---|---|
| `ChatHarnessPanel.ts` message list, bubbles, thinking dots, empty state, error strip, input, tool-call cards | `chatPanel` (or composable `chatMessageList`, `chatInput`, ...) with config for title, icon, suggestions, empty-state text, placeholder |
| `ChatHarnessModel.ts` (history, send/retry/edit/clear, loop, typewriter) | `ChatModel`, with stable message IDs, an explicit state machine, abort, and real streaming |
| Typewriter and `getDisplayContent` | Removed. Streamed deltas append to the active assistant message. |
| `ContentBlock`, `ChatMessage`, `ToolCallDisplay`, `DisplayMessage` | Kit's provider-neutral message and part types |
| `LlmChatService.generateAsync` and `XH.postJson('llm/generate')` | Kit transport service with streaming (NDJSON via `XH.fetchNdjson`, or SSE), cancellation, and configurable URL and `track` category |
| `ToolDefinition` and the `switch` dispatcher in `LlmToolService` | Kit `ToolRegistry` and `defineTool({name, description, inputSchema, execute, label, mutates})`, with errors caught into `isError` results |
| `friendlyToolSummary` and `DASH_TOOLS` | Per-tool `summarize` and `mutates` metadata |
| Chat SCSS (`WeatherV2.scss` l.226-590) | Kit SCSS under a kit prefix, using Hoist vars only |
| `sparklesIcon` | Kit icon (kit registers its own FA icons) |
| Server `LlmService`/`LlmController` generic parts | Kit server docs or a hoist-core-style reusable service. The config names (`llmApiKey`, `llmModel`, `llmMaxTokens`, `llmRateLimit`) are good defaults. |

### App-specific glue that remains in Toolbox

- `AppModel`: install the kit's services and the app's own tool service or registry, and keep the `PanelModel` side panel and the three `@persist` toggles.
- `AppComponent`: mount `chatPanel(...)` in the existing `harnessPanel` slot and keep the app-bar button.
- The system prompt builder, with `widgetRegistry` docs, the city list, and the current-dashboard block, passed to the kit as a function `() => string`.
- All 13 tools, re-declared with `defineTool`. Dashboard tools keep `getCurrentStateArray`, `applyState`, validation, and auto layout.
- The suggestion lists, intro text, panel title, icon, and the "Dashboard updated." toast (via a `mutates` hook or an `onToolsComplete` callback).
- Bootstrap typing for any app services, and a tiny server shim or config if the server stays app-owned.

### Suggested order

1. Extract the neutral message model and the tool registry. Port weatherv2 with non-streaming transport first. Behavior stays the same, so regressions are easy to spot.
2. Move the panel and SCSS, and fix stable IDs, scroll-stickiness, abort, and the mid-loop state bug.
3. Add streaming (NDJSON first, since both ends exist), then drop the typewriter.
4. Consider server-side usage logging, a role gate, and a cluster-aware rate limit.

Unit-test targets under the kit's rules (fake hoist-core via `hoistCore.route()`): the loop (tool error becomes `isError`, iteration cap, abort), retry and edit after failure at each loop stage, and message-ID stability.

## 7. Intended future direction (README and planning docs)

I found little forward-looking material for the chat agent:

- `README.md` Agent Notes (l.110-143) cover conventions only. Note 6 says the chat harness "shows a helpful error" until `llmApiKey` is set.
- `PLAN.md` section 6.6 lists streaming as a **stretch**: "stream the LLM response for better perceived latency. Show partial response in chat, parse JSON on completion" (l.350-352). `TASKS.md` item 7.9 is the same, unchecked. `DEPLOYMENT-MEMO.md` l.232 says "Stream response if possible (Anthropic supports streaming)".
- `PLAN.md` l.347 describes an auto-retry that sends validation errors back to the LLM ("Your response had errors..."). The tool-based flow replaced this with tool errors returned as `is_error` results.
- `DEPLOYMENT-MEMO.md` mentions an OpenAI fallback provider and an `llmProvider` config. Neither exists in code.
- `ROADMAP.md` Phase 7 includes light/dark theme support, mock data mode (stretch), and demo script walkthroughs.
- `PLAN.md` l.332 proposed the chat panel on "the left or bottom". The build put it on the right.

Several planning docs predate the v88 upgrade and the README says they are not kept in sync. Treat `PROGRESS.md` and the source as the record, and the rest as design history.

## 8. Toolbox: registering weatherv2 and running it locally

### Registration

- **Entry point:** `client-app/src/apps/weatherv2.ts` calls `XH.renderApp({clientAppCode:'weatherv2', clientAppName:'XH Weather V2', componentClass: AppComponent, modelClass: AppModel, containerClass: AppContainer, authModelClass: AuthModel, isMobileApp:false, enableLogout:true, checkAccess:() => true})`.
- Every script in `src/apps/` becomes one Rsbuild entry (`hoist-dev-utils/configureRsbuild.js:295-299, 359`: "one for each script within src/apps/, minus unit tests"). The URL path is therefore `/weatherv2/` (dev: `http://localhost:3000/weatherv2/`). Note that `devServerOpenPage` is `app/` (`rsbuild.config.mjs`).
- **Nav tile:** `ExamplesTabModel.ts` gets an entry `{title:'Weather V2', icon: Icon.sun(), path:'weatherv2', srcPath:'weatherv2', text:[...]}` in the Examples tab.
- **Type augmentation:** `Bootstrap.ts` declares `llmChatService`, `llmToolService`, and `weatherDataService` on `XHApi`.
- **CHANGELOG:** adds a "New Features" bullet under `12.0-SNAPSHOT`.

### Running locally

From `/Users/amcclain/dev/toolbox/CLAUDE.md`, `README.md` ("Running Toolbox", l.135-146), and `docs/running-locally.md`:

- **Server:** from the repo root, `./gradlew bootRun` (API on port 8080). By default it uses the developer's MySQL and OAuth login. See the throwaway H2 recipe below.
- **Client:** from `client-app/`, `pnpm start` (runs `pnpm install && rsbuild dev`, port 3000). `pnpm startWithHoist` runs against the sibling `../../hoist-react` checkout (`rsbuild dev --env-mode inlineHoist`).
- **Throwaway session for agents** (from hoist-react's CLAUDE.md, "Running Toolbox against this checkout", l.505-533): start the server with `APP_TOOLBOX_USE_H2=true APP_TOOLBOX_OAUTH_PROVIDER=NONE APP_TOOLBOX_BOOTSTRAP_ADMIN_USER=agent@xh.io APP_TOOLBOX_BOOTSTRAP_ADMIN_PASSWORD=$AGENT_PASSWORD ./gradlew bootRun`, with `AGENT_PASSWORD=$(openssl rand -hex 12)`. Log in by POSTing to `/api/xh/login` from a page on `localhost:3000`. Never enter the developer's credentials. Check whether servers are already running first (`curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/admin/`, and `:8080`) and leave servers you did not start running.
- **For the chat itself to work**, set the `llmApiKey` config (Admin console, group "Toolbox - Example Apps"). On a fresh H2 database it will be `UNCONFIGURED`, and the chat shows the server's error. The default `llmRateLimit` is 20 per hour per user.

### How a local package is linked into Toolbox

Toolbox has **no local-link mechanism for packages**. The existing pattern, for `@xh/package-template`, is:

- `client-app/package.json:46` declares `"@xh/package-template": "~4.0.0"`, a normal npm dependency installed by pnpm. In this checkout `client-app/node_modules/@xh/package-template` is a pnpm symlink into `.pnpm/@xh+package-template@4.0.0_...` (a store copy, not a sibling checkout).
- `client-app/rsbuild.config.mjs` resolves `customPkgPath = path.resolve('node_modules/@xh/package-template')` and passes `extraIncludePaths: [customPkgPath]` to `configureRsbuild`. The file comment says the package ships uncompiled TS and is "transpiled and processed alongside the app and hoist-react code".
- `configureRsbuild.js` adds `extraIncludePaths` to both the SWC rule `include` and the `include` list (l.343, 366) and runs `checkNoJsxFiles` on them (l.293).
- `pnpm-workspace.yaml` in `client-app/` holds pnpm settings only (not a workspace). `minimumReleaseAgeExclude: ['@xh/*']` lets fresh XH snapshots install immediately, which would cover `@xh/hoist-chat-kit` snapshots too.
- There are no `pnpm link`, `file:`, or `link:` entries and no linking scripts in `client-app/package.json`. The only "local checkout" feature is `inlineHoist` for hoist-react (an alias to `../../hoist-react`).
- **Implication for chat-kit:** (a) published path: add `@xh/hoist-chat-kit` as a dependency (tag `next`, snapshots publish on every push to `develop` per the kit's CLAUDE.md) and add `path.resolve('node_modules/@xh/hoist-chat-kit')` to `extraIncludePaths`. (b) local-dev path, untested: point the dependency at the sibling with `"@xh/hoist-chat-kit": "link:../../hoist-chat-kit"` (or a pnpm override) in a local-only change, and make `extraIncludePaths` use that path. If Rspack resolves symlinks to real paths, the include entry must be the real sibling path. I have not tried this. A small spike is needed, plus a decision on whether the kit's own `node_modules` would duplicate `react` or `@xh/hoist` (peer dependencies in the kit; the host should supply them).
- The kit will also need the Font Awesome icon registration to happen in the consuming app or kit module, since the kit has no `Icons.ts` pattern yet.
