# Review 4 - Toolbox Integration and Hands-On UX

Reviewer scope: the Toolbox branch `feature/weatherv2-chat-kit` (commit `17c4ea3f` plus the
uncommitted Chat Kit app and agent tweaks), the weatherv2 Dashboard Agent, the new Chat Kit demo
app, and `LlmController` / `LlmService`. Hands-on at 1400x900 and with the chat at about 420px,
in light and dark themes, on http://localhost:3000. Live LLM turns used: 4 (weatherv2 build,
weatherv2 reset with Deny, Chat Kit live KPI and card, Chat Kit live stop mid-stream).

Screenshots are in `planning/screenshots/4x-*.png`.

## Summary

The app code is close to a model example. Models own their `ChatModel`s, components use
`chatPanel` with slots, tools are declared once as `ChatToolSpec`s, and the old chat is gone from
the client. The weak spots are on the server and at a few kit seams. The relay is hand-rolled
Groovy that already differs from the kit's own README example. Its errors log as stack traces
and get emailed as client errors. It also forwards any request key the browser sends. In the
kit, the most serious UX problem is a metric tile that cuts off large numbers: a live answer
showed $48.5 billion as "$48,500,000...", which reads as $48.5 million. Approvals also give the
user too little to decide on.

Counts: 5 Major, 18 Minor, 12 Nit.

## Findings

### Major

| id | where | finding | recommended fix | screenshot |
|----|-------|---------|-----------------|------------|
| M1 | Kit: `desktop/cmp/genui/ChatUiMetrics.scss:49-56` (`&__value` ellipsis). Screen: Chat Kit Live model | A metric value that does not fit is cut off with an ellipsis. Live Claude sent `value: 48500000000`, `format: 'currency'`. The tile showed "$48,500,000...", which reads as $48.5M and is 1000x wrong. Never truncate a number. | **Kit.** Scale large values automatically: billions, millions and thousands with a suffix, as Hoist's number formatters can. Or shrink the font to fit. Show the full value in a tooltip. Add a spec test with a 12-digit currency value. | `4x-live-genui-streaming.png` |
| M2 | Kit: `desktop/cmp/chat/ChatToolCall.ts:158` ('Allow this tool to run?'). Toolbox: `LlmToolService.ts:212-221` (`reset_dashboard`), `chatkit/demos/approvalDemo.ts:39-58` | Approval asks "Allow this tool to run?" for every tool and shows only raw input JSON. In weatherv2, `reset_dashboard` throws away the user's unsaved work. The card does not say so, and "tool" is jargon that the agent's own prompt tells the model to avoid. The order demo makes the user approve a trade by reading `{"symbol":"NVDA","side":"SELL",...}`. | **Kit:** add `approvalPrompt` to `ChatToolSpec`, as `string \| (input) => string`, for example "Discard unsaved changes and reset the dashboard?". Use a field/value list rather than JSON as the default approval body, or let `renderer` render during `approval-requested`. **Toolbox:** set the prompt on `reset_dashboard` and `submit_order`, and give `submit_order` an order-ticket renderer. Format the summary quantity ("SELL 2,000 NVDA"). | `4x-weather-approval.png`, `4x-approval-raw-json-dark.png` |
| M3 | Toolbox: `LlmController.groovy:47-79`, `LlmService.groovy:109-177`. Kit: `transport/README.md` "Hoist Server Example" | Every app has to copy about 150 lines of Groovy to stream a model's reply: write and flush per line, detect a disconnect, a private copy of hoist-core's `NDJSON_POISON`, and an SSE parser. Toolbox has already drifted from the kit's own example: it does not set `X-Accel-Buffering: no` (see m12). This is the most important framework gap behind the transport. | **hoist-core:** add a streaming helper, for example `renderNDJSON(source, flushEachLine: true)` or `streamNDJSON {emit -> ...}`, with disconnect detection (`emit` returns false). **Kit:** shrink the README example to use it. **Toolbox:** adopt it. | - |
| M4 | Toolbox: `LlmService.groovy:114` (`request + [model, max_tokens, stream]`), `LlmController.groovy:13` (`@AccessAll`) | The relay forwards every key the browser sends: `system`, `tools` (including Anthropic server tools such as web search or code execution, which cost extra), `tool_choice`, `thinking`, `metadata` and others. Any logged-in Toolbox user can use the server's key for any prompt, limited only by the per-step rate limit. The kit README warns about exactly this ("treat it as untrusted"). | **Toolbox:** keep only `system`, `messages`, `tools` (client tools only: reject any entry with a `type` other than `custom`) and `tool_choice`. Cap the body size and the message count. Consider `@AccessRequiresRole` for the live demos. | - |
| M5 | Toolbox: `LlmService.groovy:131, 192` (`throw new RuntimeException`). Log: `/tmp/toolbox-server.log` 15:03:00 | A rate limit hit, and any upstream non-200 such as 429 or 529, throws a plain `RuntimeException`. The server logs these at ERROR with a full stack trace. The kit passes them to `XH.handleException`, so each also posts a client error, and `ClientErrorEmailService` emails it. The log shows both for one rate-limit hit. The user sees raw upstream JSON (`...failed with status 529: {"type":"error",...}`). | **Toolbox:** throw `RoutineRuntimeException` for the rate limit. Map upstream 429 and 529 to a routine exception with a plain message ("The model is busy - try again in a minute"). Use `ExternalHttpException` for other upstream failures, and log only the upstream body. | - |

### Minor

| id | where | finding | recommended fix | screenshot |
|----|-------|---------|-----------------|------------|
| m1 | Kit: `ChatToolCall.ts:182-210` (inline caption), `impl/ToolCallStatus.ts:62-63` | Inline generative UI captions ("Show chart · View input ⌄") read as two buttons under every component. They show "Pending" or "Preparing" while the rest of the reply streams, even though the component already shows its data. | **Kit:** for `display: 'inline'`, show the status only while the component has no output to render. Once the arguments are complete, the caption is just a quiet label: an icon and "Chart", or nothing, with "View input" shown on hover or focus. Consider an overflow menu for "View input". | `4x-genui-streaming-pending-captions-dark.png`, `4x-genui-captions-read-as-buttons-dark.png` |
| m2 | Kit: `desktop/cmp/chat/impl/ChatCitations.ts` (rendered as a row after the text part) | Citation chips render as a row of their own after a text part. After a code block or a blockquote they look like stray chips ("1 2" under the Groovy block, "3" under the tip). | **Kit:** attach the chips to the end of the last paragraph or list item in the part. If the part ends in a code block, a table or a blockquote, put them after the last prose block. | `4x-citations-after-code-block.png` |
| m3 | Kit: `impl/ChatCitations.ts:49` (`numberCitations`) | While streaming, citation numbers change and collide. Each text part numbers unknown citations from `sources.length + 1`, so before the sources arrived the AG-UI citation showed "2", the same number as the hoist-core citation, then became "3". | **Kit:** number citations across the whole message in order of first appearance, and keep each number once assigned. Map sources to those numbers when they arrive. | - |
| m4 | Kit: `core/ChatModel.ts:748` (`elapsedMs: Date.now() - turn.startedAt`) | The time shown on a reply includes the time the turn waited for the user. The Approval demo showed "14s" and the weatherv2 deny turn "13s", mostly my own think time. | **Kit:** subtract paused time. Record pause and resume times on the turn. | `4x-weather-narrow-dark.png` |
| m5 | Kit: `transport/codec/AnthropicCodec.ts:157, 235-239`. Toolbox: `LlmChatService.ts:31-33` | Prompt caching: weatherv2 marks its static block itself, but `cacheControl: true` still marks the last (live dashboard state) block, because `withCacheBreakpoint` checks only the last block. The captured live request had `cache_control` on both system blocks and wrote 1,904 cache tokens for the changing state. Nothing marks the messages, so each tool-loop step re-sends the history uncached (1,851 input tokens on step 2). | **Kit:** skip the system breakpoint when any system block is already marked, as the doc comment implies. Add an optional rolling breakpoint on the last message, which pays off across the steps of a tool loop. | - |
| m6 | Kit: `desktop/cmp/genui/ChatUiGrid.ts` (column sizing) | Grid columns are sized evenly, not to content. Name truncates ("Amazon.com I...", "Taiwan Semic...") while Sector and Qty have room to spare. In the trades grid, right-aligned Price sits against left-aligned Trader ("$126.10 JL"). At 420px only 3.5 columns show, and the numeric columns sit behind a horizontal scrollbar. Headers cut off ("Qty"). | **Kit:** autosize columns to content once the rows arrive. Give text columns a max width and number columns a min width, and add padding between a right-aligned and a left-aligned column. In a narrow panel, offer an "expand" action that opens the grid in a dialog. | `4x-genui-grid-name-truncation-dark.png`, `4x-genui-trades-grid-column-layout.png`, `4x-narrow-genui-metrics-grid.png` |
| m7 | Kit: `ChatToolCall.scss:77` (`&__status`), tool call group rows | In a tool group, each row's status (check, "Running", "Failed") sits at the far right of the content column, about 1000px from its label on a wide panel. The eye has to cross the whole width to pair them. | **Kit:** put the status next to the summary, or cap the row width in the group. | `4x-tool-group-status-far-right.png` |
| m8 | Kit: `core/ChatComposerModel.ts:126` (`XH.warningToast`). Toolbox: `DashboardAgentModel.ts:43` (`XH.successToast`) | A rejected attachment shows as a global toast in the bottom-right corner, over the composer's Send button. Weatherv2's "Dashboard updated." toast lands in the same place, since the agent panel is on the right. | **Kit:** show rejected files inline in the composer, under the chips. **Toolbox:** show the weatherv2 toast at the top, or skip it, since the tool cards already say what changed. | `4x-attachments-composer.png` |
| m9 | Toolbox: `chatkit/demos/scriptUtils.ts:5-24`, `richContentDemo.ts:60-63`, `attachmentsDemo.ts:61-68`. Kit: `transport/ScriptedChatTransport.ts:24`, `desktop/cmp/chat/impl/ChatFormat.ts:19` | Workarounds that point at kit gaps for scripted chats. `respond` gets only `requestIndex`, so the demos work out the step and turn from the message parts. There is no `citationEvents()` builder, so the demo writes raw `xh.chat.citation` CUSTOM events. `formatFileSize` exists in `impl/` but is not exported, so the demo writes its own `fmtSize`. | **Kit:** pass a context to `respond`: `{requestIndex, stepIndex, turnIndex, userMessage}`. Add `citationEvents()`. Export `formatFileSize`. Consider exporting the demo's `markdown()` dedent helper as a script utility. **Toolbox:** delete the helpers once the kit has them. | - |
| m10 | Toolbox: `chatkit/AppComponent.ts:108-116`, `weatherv2/harness/DashboardAgentPanel.ts:24-32` | Both apps hand-write the same "Clear conversation" header button. Nearly every chat needs one. | **Kit:** export a `chatClearButton` (or a `ChatPanel` prop) with the right icon, tooltip, disabled state and a confirm while a turn runs. | - |
| m11 | Toolbox: `LlmController.groovy:8-34`, `LlmService.groovy:44-47, 58-93`, weatherv2 `README.md:66-67` | Dead code from the old chat: `POST /llm/generate`, `LlmService.generate()`, the `JSONClient` field and getter, and its config handling. The README itself says the endpoint "no longer has a client caller". The controller javadoc still says it serves "the Weather V2 dashboard", but it now serves the Chat Kit demo too. | **Toolbox:** remove `generate` and the `JSONClient`, update the javadoc, and drop the README sentence. | - |
| m12 | Toolbox: `LlmController.groovy:51-52` | No `X-Accel-Buffering: no` header, though the kit README's example sets it. hoist-core's `ApplicationConfig` also adds `application/x-ndjson` to server compression. Behind nginx, tokens may arrive in bursts. I have not verified this against the deployed config. | **Toolbox:** set the header. Watch the deployed response in the network panel to confirm that lines arrive one at a time. | - |
| m13 | Toolbox: `LlmService.groovy:53-56` (`HttpClients.custom()...build()`) | The stream client uses the HttpClient 5 default pool, at most 5 connections per route (checked: `DEFAULT_MAX_CONNECTIONS_PER_ROUTE = 5` in httpclient5-5.6.4). A 6th concurrent stream, from any user, waits for a free connection. Each stream also holds a Tomcat request thread for its whole length. The kit README example has the same pool. | **Toolbox and kit README:** build a `PoolingHttpClientConnectionManager` with a higher per-route limit and a short connection-request timeout, so a full pool fails fast with a routine error. Note the thread cost in the README. | - |
| m14 | Toolbox: `LlmService.groovy:182-200`. Kit: `transport/HttpChatTransport.ts` (`headers` is static) | The rate limit counts model calls (steps), not turns. One weatherv2 build took 2 calls, and a tool loop takes more. The live Chat Kit demo shares the same 20 per hour, so a limit can hit mid-turn and leave the tool loop half done. The server cannot count turns: the Anthropic body has no thread or turn id, and transport headers are fixed. | **Kit:** let `headers` be a function of the `ChatRunRequest`, so an app can send `threadId` and `runId`. **Toolbox:** count turns, or budget tokens rather than calls. | - |
| m15 | Toolbox: `LlmController.groovy:67-75` | A failure after the stream starts writes the NDJSON poison line and rethrows. The client sees a generic fetch parse failure, not a `ChatRunError` with a code, and the rethrow then hits Grails error handling on a committed response. The kit contract prefers an error record. | **Toolbox:** once committed, write an Anthropic `{"type":"error","error":{"type":"api_error","message":...}}` line, log at WARN, and return normally. | - |
| m16 | Toolbox: `weatherv2/harness/DashboardAgentModel.ts:37-40`, `svc/LlmChatService.ts`, `AppModel.ts:24-28` | Hoist idiom. `DashboardAgentModel` reaches through `(XH.appModel as AppModel).weatherV2DashModel`, but `AppModel` builds it and could pass the dash model to its constructor. `LlmChatService` is a `HoistService` with no state that only builds a prompt, so it could be a module function. Names left over from the old chat: `harness/`, `showChatHarness`, `harnessPanelModel`, `chat-btn`. | **Toolbox:** pass `WeatherV2DashModel` to the constructor. Make the prompt builder a function, or move it into the agent model. Rename the harness items to "agent". | - |
| m17 | Toolbox: `client-app/src/examples/chatkit/` | The Chat Kit example has no README, but weatherv2 and favicons do, and the kit docs send readers to Toolbox. | **Toolbox:** add a README with a table of the demos, the kit API each one shows and its source file. Note that the live demo needs `llmApiKey` and shares the LLM rate limit. | - |
| m18 | Toolbox: `client-app/package.json:46`, `rsbuild.config.mjs:26-60`, `tsconfig.json` paths | `"@xh/hoist-chat-kit": "link:../../hoist-chat-kit"` plus custom aliases. This blocks a merge: CI and other developers have no sibling checkout. Developing the kit inline needs custom aliases because there is no supported mode for it, unlike `runHoistInline` for hoist-react. | **Toolbox:** switch to a published `@xh/hoist-chat-kit` snapshot before merge. **hoist-dev-utils:** consider a generic "inline package" option for `configureRsbuild`. | - |

### Nit

| id | where | finding | recommended fix | screenshot |
|----|-------|---------|-----------------|------------|
| n1 | Toolbox: `chatkit/demos/errorsDemo.ts:38-50` | Requests alternate fail and succeed by `requestIndex % 2`, so Regenerate on the good long reply fails again. | Script by attempt per user message: fail the first try of each user message only. | `4x-errors-banner-light.png` |
| n2 | Toolbox: `chatkit/AppComponent.ts:117-122` | Each demo's empty state repeats the panel title and icon right under the header ("Rich content" twice). | Use the empty-state title for the prompt ("Try a reply with tables and code") rather than the demo name. | - |
| n3 | Toolbox: `chatkit/AppComponent.ts:86-88` | The nav's busy spinner (`spinnerThird`) is so small it reads as a stray ")". | Use a small dot or `Icon.spinner` at a readable size, with a tooltip. | - |
| n4 | Kit: `cmp/markdown/ChatMarkdown.scss:17-50` | h3 has equal top and bottom margins (10px/10px), so a heading does not group with what follows. h2 at 17px and h3 at 15px are hard to tell apart. | More space above a heading than below it, and a wider size step. | `4x-stopped-reply.png` |
| n5 | Kit: genui chart theme (dark) | In dark theme the two line series are teal and green, which are hard to tell apart. | Use a categorical palette with more contrast, or different dash styles. | `4x-genui-captions-read-as-buttons-dark.png` |
| n6 | Kit: genui chart and grid | Screen readers hear the chart only as "Created with Highcharts 12.6.2". The grid always exposes ag-grid's "Loading..." live region. | Give the chart an accessible name from its title. Hide the grid's loading overlay once rows have arrived. | - |
| n7 | Kit: `ChatMessageView` user message with files only | A user message with only files leaves an empty gap under the chips, where the bubble would be. | Leave the bubble out entirely when there is no text. | `4x-attachments-sent.png` |
| n8 | Kit: `ChatSources` | When the list is pinned to the bottom, opening "3 sources" expands under the composer, out of view. | If the list was at the bottom, keep it there when the user opens the last element. | - |
| n9 | Kit: `impl/ChatComposerLocalModel.ts:51-56` | Escape does nothing in the composer, even while a reply streams. | Consider Escape to stop a streaming reply, and to clear a recalled draft. | - |
| n10 | Kit: `ChatMessageView.ts:362-377` | The hidden-thinking header label "thought 3.4s" is lowercase and cryptic next to "11s". | "Thought for 3.4s" in a tooltip on the time, or a muted icon. | `4x-weather-live-done.png` |
| n11 | Toolbox: weatherv2 prompt | On a build, the first several seconds show only "Build dashboard · Preparing", with no text. | Ask the model for one short lead-in sentence before `set_dashboard`, or have the summary count widgets as the arguments stream in. | `4x-weather-live-streaming.png` |
| n12 | Toolbox: `weatherv2/README.md` lines 29-50, 69, 164, 169 | Lines run past 100 characters. Line 69 breaks the wrap mid-paragraph. | Re-wrap to 100. | - |

## Code Review Notes

What works well, worth keeping as the pattern:

- `AppModel` owns `DashboardAgentModel` so the conversation survives hiding the panel, and
  `ChatKitDemoModel` owns one `@managed` `ChatModel` per demo.
- `LlmToolService` declares each tool once, with schema, title, icon, summary and `execute`.
  Errors are written for the model. `describeWidget` gives readable summaries while the input
  streams.
- `AnthropicCodec({system: () => ...})` rebuilds the live dashboard state for each step.
- The demos cover the kit's surface well: rich markdown, reasoning and a failing tool, approval,
  generative UI with a follow-up from card actions, errors, retry and stop, attachments, and a
  live model.
- On the server, `post.abort()` rather than draining on disconnect, and opening the upstream
  call before the first write, are both right. I confirmed the disconnect live: stopping a
  streaming reply logged "Client disconnected - aborted LLM stream" within a second.

Hands-on checks that passed: stick-to-bottom while streaming, the jump-to-bottom button,
ArrowUp recall, Enter to send, Shift+Enter, focus moves to the composer after a suggestion
click, visible focus rings on message actions, Stop leaves a "Stopped" marker, error banner with
Edit and Retry, Deny path and the model's recovery, 420px panel layout (metrics reflow 2x2), and
light and dark themes overall.

Not covered: real file attach through the OS picker (upload was blocked in this environment, so
I tested with a synthetic drop of in-page `File` objects), the weather widgets themselves (the
weather API returned 400 in this environment), and a deployed nginx path.
