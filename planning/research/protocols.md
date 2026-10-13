# Agent-to-UI protocols: status and recommendation for hoist-chat-kit

Research date: 2026-10-13. Sources are primary docs, repos, and the npm registry unless marked. Items I could not confirm are marked **UNVERIFIED**. Where a source was a vendor claim or a secondary blog, I say so.

## 1. Summary table

| Protocol / project | What it is | Layer | Status (Oct 2026) | License | Adoption signal |
|---|---|---|---|---|---|
| AG-UI | Event stream between agent backend and frontend | Runtime transport | `@ag-ui/core` and `@ag-ui/client` **1.0.2** (2026-10-05); deprecated THINKING_* events removed in 1.0.0 | MIT | ~16.5k GitHub stars; many first-party framework integrations |
| A2UI | Declarative JSON UI description, rendered by client from a trusted catalog | UI payload | **v0.9.1** production, **v1.0 release candidate**; "early-stage public preview" | Apache-2.0 | Google-led, CopilotKit contributes; renderers for Lit, Angular, Flutter |
| MCP Apps (SEP-1865) | MCP extension: tools point to `ui://` HTML resources shown in a sandboxed iframe | UI payload + bridge | Spec **2026-01-26, Stable**; SDK `@modelcontextprotocol/ext-apps` 2.0.3 | Apache-2.0 (repo badge); npm says MIT | Claude, ChatGPT, VS Code, Goose, Postman listed as clients |
| MCP-UI (`mcp-ui`) | SDK that pioneered the pattern; now MCP Apps compliant | UI payload SDK | `@mcp-ui/client` 7.1.1, `@mcp-ui/server` 6.1.0 | Apache-2.0 | ~5.2k stars |
| OpenUI (Thesys) | Generative UI framework and "OpenUI Lang" streaming language | UI payload + renderer | `@openuidev/react-lang` **1.0.0** (2026-10-12); repo ~10.8k stars | MIT | Vendor-promoted; C1 docs now redirect to openui.com |
| Open-JSON-UI | OpenAI's internal declarative schema, "open standardized" | UI payload | Only described by CopilotKit docs; no primary spec found (**UNVERIFIED**) | Unknown | Low evidence |
| W3C Open UI CG | Standardizes styleable HTML controls | Web platform | Active mailing list into May 2026 | W3C CLA | Unrelated to agents |
| Vercel AI SDK | `useChat`, UIMessage `parts`, UI message stream protocol | Client SDK + wire format | `ai` 7.0.139, `@ai-sdk/react` 4.0.142 | Apache-2.0 | De facto reference for part model |
| assistant-ui | React chat primitives with runtime abstraction | Client SDK | `@assistant-ui/react` 0.15.28 (pre-1.0) | MIT | Integrates with AI SDK, OpenUI, CopilotKit |
| CopilotKit | Agentic app framework; first-party AG-UI client | Client SDK | `@copilotkit/react-core` 1.79.0 | MIT | Creator of AG-UI |

Versions and dates come from `registry.npmjs.org` queries run today. Star counts come from GitHub pages fetched today.

## 2. AG-UI

**Sources:** https://docs.ag-ui.com/concepts/events, https://github.com/ag-ui-protocol/ag-ui, https://docs.ag-ui.com/sdk/js/client/abstract-agent, https://docs.ag-ui.com/sdk/js/client/subscriber

### Events

All events carry `type`, and optionally `timestamp`, `rawEvent`, `metadata`. Most accept an optional `subagentRunId`.

| Category | Events and fields |
|---|---|
| Lifecycle | `RunStarted` (`threadId`, `runId`, optional `parentRunId`, `input`); `RunFinished` (optional `outcome` of `success` or `interrupt` with `interrupts`, optional `result`); `RunError` (`message`, `code?`); `StepStarted` / `StepFinished` (`stepName`) |
| Text | `TextMessageStart` (`messageId`, `role`); `TextMessageContent` (`messageId`, `delta`); `TextMessageEnd`; `TextMessageChunk` (convenience form, expands to start/content/end) |
| Tool call | `ToolCallStart` (`toolCallId`, `toolCallName`, `parentMessageId?`); `ToolCallArgs` (`toolCallId`, `delta` = JSON string fragment); `ToolCallEnd`; `ToolCallResult` (`messageId`, `toolCallId`, `content`, `role?`); `ToolCallChunk` |
| State | `StateSnapshot` (`snapshot`); `StateDelta` (`delta` = JSON Patch ops); `MessagesSnapshot` (`messages`) |
| Reasoning | `ReasoningStart`, `ReasoningMessageStart` (`role: "reasoning"`), `ReasoningMessageContent` (`delta`), `ReasoningMessageEnd`, `ReasoningMessageChunk`, `ReasoningEnd`, `ReasoningEncryptedValue` (`subtype`, `entityId`, `encryptedValue`). The old `THINKING_*` events were deprecated and removed in 1.0.0. |
| Activity | `ActivitySnapshot` (`messageId`, `activityType`, `content`, `replace?`); `ActivityDelta` (`messageId`, `activityType`, `patch`) |
| Subagent | `SubagentStarted`, `SubagentFinished`, `SubagentError` (with `parentToolCallId`, `parentMessageId`) |
| Special | `Raw` (`event`, `source?`), `Custom` (`name`, `value`) |
| Draft | `MetaEvent` (`metaType`, `payload`), extended `RunStarted`/`RunFinished` for interrupts and branching |

`ActivitySnapshot` is the main hook for generative UI inside a message stream: the agent emits a typed `activityType` plus content, and the frontend picks a renderer by type.

### Transport

The README states AG-UI is event-based and transport-agnostic. It works over SSE, WebSockets, and webhooks, with a reference HTTP implementation. In practice the client posts a `RunAgentInput` (thread, run, messages, tools, context, state, forwarded props) and reads an SSE stream with one JSON event per `data:` frame. I did not fetch the encoder page to confirm the exact framing, so treat the framing detail as **partly UNVERIFIED**. `@ag-ui/encoder` 1.0.2 exists on npm.

### JS client SDK and consumption

- `@ag-ui/core` (types, event schemas) and `@ag-ui/client` (`AbstractAgent`, `HttpAgent`) are both at 1.0.2, MIT.
- `AbstractAgent` takes `agentId`, `threadId`, `initialMessages`, `initialState`. It exposes `messages`, `state`, `runAgent(params, subscriber?)` returning `{result, newMessages}`, `subscribe(subscriber)`, `events$` (a replaying observable), `abortRun()`, `use()` middleware, `clone()`.
- `AgentSubscriber` has per-event callbacks (`onTextMessageContentEvent`, `onToolCallArgsEvent`, `onToolCallResultEvent`, `onStateDeltaEvent`, `onActivitySnapshotEvent`, `onCustomEvent`, `onRawEvent`, `onEvent`), run lifecycle hooks (`onRunInitialized`, `onRunFailed`, `onRunFinalized`), and state hooks (`onMessagesChanged`, `onStateChanged`, `onNewMessage`, `onNewToolCall`). Handlers may return `{messages?, state?, stopPropagation?}` to mutate state.
- The client reduces events into a `messages` array and a `state` object. A chat UI can either subscribe to `onMessagesChanged` (simple, loses streaming granularity) or consume events directly (what an adapter would do).

### Who emits it

From the README integrations table: Microsoft Agent Framework, Google ADK, Google Antigravity, AWS Strands, Mastra, Pydantic AI, Agno, LlamaIndex, AG2 (first party); LangChain and CrewAI (partnerships); Claude Agent SDK, Claude Managed Agents SDK, Langroid, Cloudflare Agents (community). In progress: AWS Bedrock Agents, OpenAI Agent SDK. Community server SDKs exist for Kotlin, Go, Dart, Java, Rust, Ruby, C++, .NET. Clients: CopilotKit, Slack/Teams, React Native. The README also says AG-UI supports A2A and MCP Apps.

### License and caveats

MIT. The GitHub README shows 271 open issues and 197 open PRs, so it is busy. The "partnership" and "first party" labels come from the project's own README, not independent confirmation. I did not verify that each framework's integration is production grade.

## 3. A2UI

**Sources:** https://github.com/google/A2UI, https://a2ui.org/, https://a2ui.org/specification/v0.9-a2ui/

- **Idea:** the agent sends declarative JSON describing a UI, and the client renders it with native components. The README tagline: safe like data, expressive like code.
- **Versions:** v0.9.1 is current production, v1.0 is a release candidate (previously called v0.10), v0.8 is legacy. v1.0 adds client-to-server RPC (`actionResponse`), action IDs, and renames `theme` to `surfaceProperties`. npm `@a2ui/web_core` is 0.13.0 (2026-10-09), so package numbering is separate from spec numbering. The project calls itself early-stage public preview.
- **Messages (v0.9, server to client):** an envelope with exactly one of `createSurface` (`surfaceId`, `catalogId`, optional `theme`, `sendDataModel`), `updateComponents` (flat list of components by id; a component with id `root` must exist), `updateDataModel` (JSON Pointer path + value; omitted path replaces the model), `deleteSurface`.
- **Client to server:** an `action` message with `name`, `surfaceId`, `sourceComponentId`, `timestamp`, `context`. Input components bind two-way to the local data model; the server only hears about changes when an action fires, unless `sendDataModel` is true.
- **Catalog:** identified by `catalogId` (URI-style string). A Basic Catalog ships (Card, Button, TextField, and so on). Clients advertise `supportedCatalogIds` and may send `inlineCatalogs`. Custom catalogs are the extension point. This is the mapping of declarative components to native widgets: the renderer holds a registry from component type name to a native implementation (Lit, Angular, Flutter, Markdown renderers exist; official React is "planned" per the README).
- **Dynamic values:** a property may be a literal, a JSON Pointer `path`, or a `FunctionCall`. Templated containers resolve relative paths per array item.
- **Security:** no executable code. Agents can only request components present in the client's catalog. Custom wrappers (including sandboxed iframes) are the client's responsibility.
- **v0.9 design shift:** designed to be embedded in the model prompt rather than constrained by structured output, so it needs more post-generation validation and repair.
- **Relation to A2A and AG-UI:** A2A is one transport; separate A2A extension specs are published for v1.0, v0.9.1, v0.8. The README says it is compatible with AG-UI as a transport. REST is a planned transport.
- **License:** Apache-2.0. Created by Google, with CopilotKit contributions.
- **Not verified:** actual production adoption beyond the quickstart (Gemini-powered ADK sample). The pages I fetched did not mention Gemini Enterprise or Flutter GenUI adoption.

## 4. MCP Apps, MCP-UI, and the OpenAI relationship

**Sources:** https://github.com/modelcontextprotocol/ext-apps (spec `specification/2026-01-26/apps.mdx`), https://github.com/idosal/mcp-ui

### MCP Apps (SEP-1865)

- **Status:** spec dated 2026-01-26 marked Stable; a draft continues. Extension ID `io.modelcontextprotocol/ui`. SDK `@modelcontextprotocol/ext-apps` 2.0.3 (the repo says the wire protocol is unchanged between 1.x and 2.x).
- **Delivery:** a tool declares `_meta.ui.resourceUri` pointing at a `ui://` resource. The host fetches it with `resources/read`. MIME type is `text/html;profile=mcp-app` (the only type in the MVP; others reserved). Content is `text` or base64 `blob`. The flat key `_meta["ui/resourceUri"]` is deprecated.
- **Resource metadata (`_meta.ui`):** `csp` (`connectDomains`, `resourceDomains`, `frameDomains`, `baseUriDomains`), `permissions` (`camera`, `microphone`, `geolocation`, `clipboardWrite`), `domain`, `prefersBorder`. Tool metadata: `visibility` of `model`, `app`, or both. Omitted CSP means restrictive defaults (`default-src 'none'`); hosts must not allow undeclared domains.
- **Host rendering requirements:** native/desktop hosts may render the iframe directly. **Web hosts MUST use a sandbox proxy**: a different-origin intermediate iframe (`allow-scripts allow-same-origin`) which loads the inner iframe with a CSP built from the declared metadata. The proxy and host handshake with `ui/notifications/sandbox-proxy-ready` and `ui/notifications/sandbox-resource-ready`. The host must not message the View before `ui/notifications/initialized`.
- **postMessage bridge (JSON-RPC 2.0):**
  - View to host requests: `ui/initialize`, `tools/call`, `resources/read`, `ui/open-link`, `ui/message` (post into the conversation), `ui/request-display-mode` (`inline`, `fullscreen`, `pip`), `ui/update-model-context`, `ping`.
  - Host to view notifications: `ui/notifications/tool-input`, `tool-input-partial` (optional streaming args), `tool-result`, `tool-cancelled`, `host-context-changed`, and `ui/resource-teardown`.
  - View to host notifications: `ui/notifications/initialized`, `ui/notifications/size-changed`.
- **Capability negotiation:** host advertises `capabilities.extensions["io.modelcontextprotocol/ui"].mimeTypes`; servers should check it and return text-only fallbacks, so a tool result must still carry a meaningful `content` array. This matters for a chat kit: the text fallback is the baseline render.
- **SDK packages:** `ext-apps` (View side, `App`, `PostMessageTransport`), `/react`, `/app-bridge` (embed Views in a chat client), `/server`.
- **Listed clients:** Claude, ChatGPT, VS Code, Goose, Postman, MCPJam, mcp-use, Alpic Playground (README list, not independently verified). The repo ships only `examples/basic-host` as a reference host.

### MCP-UI

Now describes itself as "fully compliant" with MCP Apps and recommends the MCP Apps pattern. `@mcp-ui/server` has `createUIResource`; `@mcp-ui/client` has `AppRenderer` (MCP Apps hosts), `UIResourceRenderer` (legacy hosts), and a web component. Legacy content types `rawHtml`, `externalUrl`, `remoteDom` exist; Remote DOM support looked in progress on the roadmap (**status UNVERIFIED**). The README says an adapter translates mcp-ui postMessage calls to the Apps SDK `window.openai` API for ChatGPT.

### OpenAI Apps SDK

The OpenAI developer docs index I fetched (https://developers.openai.com/apps-sdk) now shows a "Plugins" documentation set where a plugin combines skills, an MCP server, and optional UI returned from MCP tools, plus a "ChatGPT-specific UI extensions" reference. I could not read the reference pages, so the exact relationship to MCP Apps (and whether `window.openai` remains) is **UNVERIFIED** from primary sources. A secondary blog (https://wavect.io/blog/openai-intelligent-ui-vs-openui.md) says the developer route is built on the MCP Apps standard; treat that as unconfirmed. The same blog reports OpenAI announced "Intelligent UI" in ChatGPT on 2026-10-07 and that no embeddable renderer was announced. That is a single secondary source, **UNVERIFIED**.

## 5. "Open UI"

Candidates, in rough order of likelihood for an agent/generative-UI context:

1. **OpenUI by Thesys** (https://github.com/thesysdev/openui, https://www.openui.com). A full-stack generative-UI framework whose core is **OpenUI Lang**, a compact streaming-first language for model-generated UI. MIT, ~10.8k stars, `@openuidev/*` packages (`lang-core`, `react-lang` 1.0.0, `react-ui`, `react-headless`, `langchain`, `assistant-ui`, `a2ui`, plus Vue/Svelte/Angular bindings). You register a component library (Zod-typed), generate a system prompt from it, and a streaming renderer draws each component as lines arrive. It integrates with assistant-ui, CopilotKit, AG-UI, Vercel AI SDK, LangGraph. There is an `@openuidev/a2ui` client for A2UI v1.0 carrying OpenUI Lang payloads. Thesys's older C1 docs (`docs.thesys.dev`) now redirect to openui.com, which suggests OpenUI supersedes the C1 positioning (inference from the redirect; no migration notice was read). Token-saving claims (51.7% fewer tokens than C1 JSON; a secondary review says 67.1% vs JSON) are vendor benchmarks, **UNVERIFIED independently**. It launched on Product Hunt 2026-03-11 (secondary source).
2. **Open-JSON-UI.** CopilotKit and AG-UI docs list it as "an open standardization of OpenAI's internal declarative generative UI schema" alongside A2UI and MCP-UI (https://docs.ag-ui.com/concepts/generative-ui-specs). I found no OpenAI primary page, so its governance and schema stability are **UNVERIFIED**.
3. **W3C Open UI Community Group** (https://open-ui.org, https://www.w3.org/community/open-ui). Standardizes styleable built-in HTML controls. Mailing list active in April and May 2026. Not related to agents. The name collision is plausible if someone says "Open UI" loosely.
4. **OpenAI "Intelligent UI"** in ChatGPT (see section 4). A product feature, not an open spec, and unconfirmed here.

**Most likely meant:** Thesys OpenUI, with Open-JSON-UI second. Ask the requester which. For the kit, either maps onto a declarative-UI renderer registry, so the answer does not change the architecture.

## 6. Generative UI ecosystem

### Vercel AI SDK (v7 line: `ai` 7.0.139, `@ai-sdk/react` 4.0.142)

Sources: https://ai-sdk.dev/docs/ai-sdk-ui/stream-protocol; types read from `ai@7.0.139` `dist/index.d.ts` on unpkg.

- **UI message stream protocol:** SSE, each frame `data: {json}`, header `x-vercel-ai-ui-message-stream: v1`, terminated by `data: [DONE]`. Chunks: `start` (`messageId`), `text-start`/`text-delta`/`text-end` (`id`, `delta`), `reasoning-start`/`-delta`/`-end`, `reasoning-file`, `source-url`, `source-document`, `file`, `data-*` (custom, `data`), `tool-input-start` (`toolCallId`, `toolName`), `tool-input-delta` (`inputTextDelta`), `tool-input-available` (`input`), `tool-approval-request` (`approvalId`), `tool-output-available` (`output`), `start-step`, `finish-step`, `finish`, `abort`, `error` (`errorText`). The doc page did not list `tool-input-error`/`tool-output-error` chunks, though the types have an `output-error` state.
- **`UIMessage.parts`** (from the type definitions): `text`, `reasoning`, `tool-${NAME}`, `dynamic-tool`, `source-url`, `source-document`, `file`, `data-${NAME}`, `step-start`.
- **Tool part states** (confirmed in types): `input-streaming`, `input-available`, `approval-requested`, `approval-responded`, `output-available`, `output-error`, `output-denied`. Static tool parts are typed `tool-<name>`; unknown tools use `dynamic-tool` with an explicit `toolName`.
- `useChat` (React) holds `messages: UIMessage[]`, status, `sendMessage`, `addToolOutput`, and so on. Its transport is pluggable, which is itself a seam example.

### assistant-ui

Source: https://www.assistant-ui.com/docs/runtimes/custom/external-store. Runtime abstraction: `LocalRuntime` (adapter around a chat model call) and `ExternalStoreRuntime` (you own messages; capability-based handlers `onNew`, `setMessages`, `onEdit`, `onReload`, `onCancel`, `onAddToolResult`). `convertMessage` maps your type to `ThreadMessageLike` (`role`, `content` parts). Documented parts: `text`, `tool-call` (`toolCallId`, `result`), `data-*`. Message status: `running`, `complete`, `incomplete`. The page did not list reasoning, source, image, file parts, so I cannot confirm them from this fetch. It is pre-1.0 (0.15.28), so its API may still move. Its design is the closest prior art to the seam proposed below.

### CopilotKit

`@copilotkit/react-core` 1.79.0; v2 API under `@copilotkit/react-core/v2` with `useComponent` (display-only generative UI keyed to a tool call). Its docs organize generative UI as Controlled, Declarative, Open-ended (https://docs.copilotkit.ai/generative-ui; sidebar names only, detail not read). Declarative maps to A2UI/Open-JSON-UI/OpenUI; open-ended maps to MCP Apps.

### Thesys C1

`@thesysai/genui-sdk` 0.10.3 (2026-07-01), non-standard license ("see LICENSE.md"). C1 docs redirect to openui.com, so C1 looks de-emphasized. I did not read C1 format details; **UNVERIFIED**.

### LangGraph / LangChain

Source: https://docs.langchain.com/oss/javascript/langgraph/streaming. Stream modes: `values`, `updates`, `messages` (`[token, metadata]` tuples), `custom` (writer), `tools` (lifecycle `on_tool_start/event/end/error`), `debug`; multiple modes yield `[mode, chunk]`. `useStream` from `@langchain/langgraph-sdk/react` exposes `messages` and `toolProgress` entries with `state` of `starting`/`running`/`completed`/`error`. The docs page did not cover generative UI (`LoadExternalComponent`), so that part is **UNVERIFIED**. LangGraph is also reachable through AG-UI (partnership) and `@openuidev/langchain`.

### OpenAI Apps SDK

See section 4. UI delivery is MCP-tool-based iframe UI; details unverified.

## 7. Provider streaming formats to normalize

Anthropic detail comes from https://platform.claude.com/docs/en/build-with-claude/streaming and `@anthropic-ai/sdk@0.133.0` types. OpenAI Responses event names come from `openai@7.32.0` SDK source (`responses.ts`). The OpenAI API reference pages returned 403 to my fetcher, so field-level OpenAI detail is from SDK types and my background knowledge, flagged where so.

### Anthropic Messages API (SSE; each frame has `event:` and `data:`)

Flow: `message_start` (Message with empty `content`, `usage`), then per block `content_block_start` / N x `content_block_delta` / `content_block_stop` (all with `index`), then `message_delta` (`delta.stop_reason`, `delta.stop_sequence`, cumulative `usage`), `message_stop`. `ping` can appear anywhere, and `error` (`{type:"error", error:{type, message}}`, for example `overloaded_error`). Unknown event types must be tolerated.

| Delta type | Shape | Notes |
|---|---|---|
| `text_delta` | `{text}` | |
| `input_json_delta` | `{partial_json}` | accumulate a string, parse on `content_block_stop`. Starts with `tool_use` block whose `input` is `{}`. |
| `thinking_delta` | `{thinking}` | `signature_delta` (`{signature}`) arrives just before block stop. With `display: "omitted"`, one empty `thinking_delta` then a signature. |
| `citations_delta` | `{citation}` | appends a citation (types include char, page, content block, search result, web search result locations) to the text block |
| `signature_delta` | `{signature}` | integrity of thinking; must be preserved for replay |

Block types in `content_block_start`: `text`, `tool_use` (`id`, `name`), `thinking`, `redacted_thinking`, `server_tool_use` and server tool result blocks (web search, code execution, web fetch, and more), plus a `fallback` block at model boundaries during server-side fallback. Stop reasons (SDK type): `end_turn`, `max_tokens`, `stop_sequence`, `tool_use`, `pause_turn`, `refusal`, `model_context_window_exceeded`.

### OpenAI Responses API

Events are `response.*`, each with `sequence_number`. Relevant names (confirmed in SDK source): `response.created`, `response.in_progress`, `response.queued`, `response.completed`, `response.failed`, `response.incomplete`; `response.output_item.added` / `.done` (item is `message`, `function_call`, `reasoning`, tool call items); `response.content_part.added` / `.done`; `response.output_text.delta` / `.done`; `response.output_text.annotation.added` (citations); `response.refusal.delta` / `.done`; `response.function_call_arguments.delta` / `.done`; `response.reasoning_summary_part.added` / `.done`, `response.reasoning_summary_text.delta` / `.done`, `response.reasoning_text.delta` / `.done`; built-in tool progress families for `web_search_call`, `file_search_call`, `code_interpreter_call`, `image_generation_call`, `mcp_call`, `mcp_list_tools`, `shell_call`, `custom_tool_call_input`; also `response.compaction.compacting` and `response.steer.*` in this SDK version. The terminal events carry the full `response` object. Items are keyed by `item_id` and `output_index`; deltas carry `delta` strings. Error events use `type: "error"` (from background knowledge).

### OpenAI Chat Completions

SSE of `chat.completion.chunk` objects, ending with `data: [DONE]`. Each has `choices[].delta` with optional `role`, `content` (string fragment), `refusal`, and `tool_calls: [{index, id?, type?, function:{name?, arguments}}]` where `id`/`name` appear only in the first fragment for an index and `arguments` is a JSON string fragment. `finish_reason` (SDK type): `stop`, `length`, `tool_calls`, `content_filter`, `function_call`, or null while streaming. A final usage chunk (empty `choices`) appears when `stream_options.include_usage` is set (background knowledge). Reasoning text is not standardized here; compatible vendors add non-standard delta fields (for example `reasoning_content`), which is **UNVERIFIED** here and should be adapter-specific.

## 8. Recommendation

### Position

Define the kit's own normalized message/part/event model and treat every protocol as an adapter into it. Do not adopt any protocol's wire format as the internal model. Reasons:

1. The ecosystem is moving: A2UI is a v1.0 RC in "public preview", AG-UI only reached 1.0 days ago, the OpenAI UI story is unverified, and assistant-ui is pre-1.0. An internal model insulates Hoist apps from churn.
2. The protocols cover different layers. AG-UI and the provider formats are runtime event streams. A2UI, OpenUI Lang, MCP Apps are UI payloads. Provider formats are a subset of both. A kit needs one model that carries all three.
3. The Hoist context favors a MobX-friendly, mutable-in-place model (`@bindable`/observable parts that update as deltas arrive) that none of these ship. Adapters can write into it directly.
4. Enterprise Hoist apps usually own the backend (hoist-core). Many will expose their own endpoint, so a plain "kit event" stream and a simple custom adapter must be easy.

### Normalized model (proposal)

```
ChatMessage { id, role: user|assistant|system, status: streaming|complete|error|aborted, parts: Part[], meta }
Part (discriminated by kind, each with id and state: streaming|done|error):
  text        { text }
  reasoning   { text, signature?, encrypted? }
  toolCall    { toolCallId, name, inputText (raw streamed JSON), input (parsed|null),
                state: input-streaming|input-available|awaiting-approval|running|output-available|output-error|denied,
                output?, error?, providerExecuted? }
  citation    { id, title?, url?, locator?, citedText? }      (also attached as spans on text parts)
  file        { url|data, mediaType }
  data        { dataType, data }        // generic custom part, keyed by type
  ui          { uiKind: 'a2ui'|'mcp-app'|'openui'|string, payload, state }   // generative surface
Event stream (adapter output, a small closed set):
  messageStart/messageEnd, partStart(kind,id,init), partDelta(id,delta), partEnd(id), partUpdate(id,patch),
  toolState(toolCallId,state,payload), error, runStart/runEnd(reason)
```

The tool state names deliberately match the AI SDK (confirmed in its types), which also keeps an AI SDK adapter nearly trivial. `ui` parts carry an opaque payload plus a renderer key.

### Event-to-model mappings

| Normalized | AG-UI | Anthropic SSE | OpenAI Responses | OpenAI Chat Completions | AI SDK stream |
|---|---|---|---|---|---|
| `messageStart` | `TextMessageStart` / `RunStarted` | `message_start` | `response.created` | first chunk with `role` | `start` |
| text `partStart` | `TextMessageStart` | `content_block_start` type `text` | `response.content_part.added` | first `delta.content` | `text-start` |
| text `partDelta` | `TextMessageContent.delta` | `text_delta.text` | `response.output_text.delta` | `delta.content` | `text-delta` |
| text `partEnd` | `TextMessageEnd` | `content_block_stop` | `response.output_text.done` | finish_reason | `text-end` |
| reasoning | `Reasoning*` events | `thinking` block, `thinking_delta`, `signature_delta` | `reasoning_summary_text.delta`, `reasoning_text.delta` | none standard | `reasoning-*` |
| toolCall start | `ToolCallStart` | `content_block_start` type `tool_use` (or `server_tool_use`) | `output_item.added` item `function_call` | first `tool_calls[i]` fragment | `tool-input-start` |
| toolCall args | `ToolCallArgs.delta` | `input_json_delta.partial_json` | `function_call_arguments.delta` | `tool_calls[i].function.arguments` | `tool-input-delta` |
| toolCall input done | `ToolCallEnd` | `content_block_stop` (parse JSON) | `function_call_arguments.done` | finish_reason `tool_calls` | `tool-input-available` |
| toolCall result | `ToolCallResult` | next user turn `tool_result`, or server tool result block | n/a for client tools; built-in call items | next `tool` role message | `tool-output-available` |
| citation | none dedicated (use `Custom` or text annotations) | `citations_delta` | `output_text.annotation.added` | none | `source-url`, `source-document` |
| state sync | `StateSnapshot`/`StateDelta` | none | none | none | `data-*` |
| generative part | `ActivitySnapshot`/`Delta`, `Custom` | none (model emits tool calls) | none | none | `data-*` |
| end / reason | `RunFinished`, `RunError` | `message_delta.stop_reason`, `message_stop`, `error` | `response.completed`/`incomplete`/`failed` | `finish_reason`, `[DONE]` | `finish`, `abort`, `error` |

Normalizer notes:
- Anthropic and Responses key by block `index` or `output_index`/`item_id`; the adapter maps these to stable part ids. Chat Completions keys tool calls by `index`.
- Tool input is accumulated as a raw string and parsed leniently (partial JSON) while streaming; set `input` only when parse succeeds. Parse failure on end becomes `output-error` or an `input` error state.
- Map stop reasons to a small enum (`complete`, `max-tokens`, `tool-use`, `refusal`, `pause`, `error`, `aborted`). Preserve the raw reason in `meta`. `pause_turn` and `refusal` need distinct UI.
- Preserve provider-opaque data (Anthropic `signature`, redacted thinking, AG-UI `ReasoningEncryptedValue`) in the part so a replay round trip is possible, even if the UI never shows it.
- Unknown events must be ignored but surfaced to a debug hook (Anthropic's docs explicitly require this).
- Batch deltas per animation frame before writing to MobX observables to avoid re-render storms on long streams.

### Tiering

| Tier | Item | Rationale |
|---|---|---|
| **First-class adapter now** | AG-UI event adapter | 1.0 reached, MIT, broad first-party framework support, a JS client with subscriber hooks, and it already carries state, activity, reasoning, and interrupts. It is the closest thing to a framework-neutral transport and fits the model almost 1:1. |
| First-class adapter now | AI SDK UI message stream adapter (plus `UIMessage` to/from converter) | Widely used reference part model; state names directly reusable. Cheap to build. Drop it if scope must shrink, since it overlaps AG-UI. |
| First-class adapter now | Anthropic SSE adapter | Stable, documented, and a typical direct-to-LLM source; I would consume `@anthropic-ai/sdk` stream events rather than raw SSE. |
| First-class adapter now | OpenAI Responses adapter; Chat Completions adapter second | Responses is the current OpenAI API shape (SDK 7.x events); Chat Completions covers many compatible vendors. |
| **Documented seam, build later** | Declarative-UI renderer registry hosting A2UI and OpenUI | A2UI is v1.0 RC and preview; OpenUI Lang is vendor-driven. Ship the `ui` part and a registry keyed by `uiKind`, plus an example in Toolbox for a small Hoist-native catalog. Revisit when A2UI v1.0 is final and a React renderer exists (the README says official React is planned). |
| Documented seam, build later (high value) | MCP Apps host (sandbox proxy, bridge) | Spec is Stable and has a React `app-bridge` SDK, so this is the most mature UI payload. But a correct host (proxy origin, CSP, bridge, tool proxying) is security-sensitive and needs a hosting origin decision. Ship a `ui` part of kind `mcp-app` with an interface for a host implementation, and evaluate `@mcp-ui/client` `AppRenderer` or `ext-apps/app-bridge` rather than writing one. |
| Skip / watch | Open-JSON-UI, OpenAI Intelligent UI, C1 | No primary spec or no embeddable renderer. |
| Skip | W3C Open UI | Unrelated. |

### Seam design

- `ChatTransport` interface: `send(request, signal): AsyncIterable<NormalizedEvent>`. Each adapter implements it, composing a wire reader (fetch SSE) and a pure `reduce(rawEvent, state) -> NormalizedEvent[]` function. Pure reducers are easy to unit-test with recorded streams in Vitest, matching the repo's test rules.
- `PartRendererRegistry`: map from `part.kind` (and, for `toolCall`, tool name; for `ui`/`data`, `uiKind`/`dataType`) to a Hoist component. Fallback renderers for unknown kinds (JSON view) so new protocol parts never crash a chat.
- Tool call rendering: one default card showing name, streamed input, state, output; apps override per tool name.
- Approval and interrupts: model `awaiting-approval` as a tool state and an `interrupt` run outcome, since AG-UI interrupts, AI SDK approvals, and MCP-style elicitation all converge there. Details are a later design.
- Persistence: convert the normalized model to and from `UIMessage`-like JSON so history can be stored via hoist-core.
- Ship a tiny kit-native event format (the normalized events as JSON over SSE) so Hoist apps with their own Grails controller need no third-party protocol.

### Open questions for the user

1. Which "Open UI" was meant (Thesys OpenUI is my best guess).
2. Whether the kit should depend on `@ag-ui/client` or reimplement the event reducer. Depending on it gives free spec tracking but adds a runtime dependency (RxJS-based, per the `events$` API) to a source-published package; I did not check its dependency list.
3. Whether an MCP Apps host is in scope for v1, given the sandbox-origin requirement for web hosts.

## Source list

- https://docs.ag-ui.com/concepts/events
- https://docs.ag-ui.com/sdk/js/client/abstract-agent
- https://docs.ag-ui.com/sdk/js/client/subscriber
- https://docs.ag-ui.com/concepts/generative-ui-specs
- https://github.com/ag-ui-protocol/ag-ui
- https://github.com/google/A2UI
- https://a2ui.org/ and https://a2ui.org/specification/v0.9-a2ui/
- https://github.com/modelcontextprotocol/ext-apps (spec 2026-01-26)
- https://github.com/idosal/mcp-ui
- https://developers.openai.com/apps-sdk
- https://github.com/thesysdev/openui and https://www.openui.com/docs
- https://wavect.io/blog/openai-intelligent-ui-vs-openui.md (secondary)
- https://www.w3.org/community/open-ui and https://open-ui.org/
- https://ai-sdk.dev/docs/ai-sdk-ui/stream-protocol
- https://www.assistant-ui.com/docs/runtimes/custom/external-store
- https://docs.langchain.com/oss/javascript/langgraph/streaming
- https://docs.copilotkit.ai/generative-ui
- https://platform.claude.com/docs/en/build-with-claude/streaming
- npm registry (`registry.npmjs.org`) and unpkg type definitions for `ai@7.0.139`, `openai@7.32.0`, `@anthropic-ai/sdk@0.133.0`
