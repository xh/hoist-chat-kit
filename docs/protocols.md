# Agent-to-UI Protocols

How Hoist Chat Kit relates to the protocols and vocabularies that connect agents and models to a
UI. Each section marks what the kit builds now, and what an app or a later release can add.

The status of each outside protocol is as of October 2026. These protocols are young and still
change. Check each project's own docs for its current state.

## Summary

| Protocol | What it is | Layer | In the kit |
|----------|------------|-------|------------|
| [AG-UI](#ag-ui) | Event stream between an agent backend and a frontend | Wire events | **Built.** The kit's own event vocabulary, on the official packages. |
| [Anthropic Messages API](#anthropic-messages-api) | Claude's request format and SSE stream | Provider format | **Built.** `AnthropicCodec`. |
| [OpenAI](#openai) | The Responses and Chat Completions streams | Provider format | **Chat Completions built.** `ChatCompletionsCodec`. A codec can add Responses. |
| [A2UI](#a2ui) | Declarative JSON UI, drawn from a client catalog | UI payload | **Adapter seam built.** An app adapter maps it to catalog components. |
| [OpenUI (Thesys)](#openui-thesys) | Generative UI framework and streaming UI language | UI payload or reply text | **Adapter seam built.** An app adapter maps it to catalog components, or the app draws reply text with OpenUI's own renderer. |
| [MCP Apps](#mcp-apps) | MCP tools that return sandboxed HTML views | UI payload | **Seam built.** Host not planned for now. |
| [Vercel AI SDK](#vercel-ai-sdk-vocabulary) | `UIMessage` parts and tool states | Message model | **Built.** The kit's part and state names. |

The kit owns its message model, and each protocol is an adapter into it. Components render only
`ChatMessage` and its parts, so a change in a protocol stops at its codec. See
[Architecture](./architecture.md).

## AG-UI

**Status in the kit: built.** AG-UI is the kit's wire vocabulary.

AG-UI is an open, MIT-licensed protocol for the event stream between an agent backend and a
frontend. It reached 1.0 in October 2026. Agent frameworks such as LangGraph, Mastra, Pydantic AI
and Google ADK emit it.

Every kit transport yields `ChatEvent`s. These are the AG-UI 1.0 events, typed from the official
`@ag-ui/core` package, with `type` widened to its string. `AgUiCodec` runs the official
`@ag-ui/client` checks on every AG-UI stream, so the kit follows the spec's rules for what to
accept, strip and reject. A stream that breaks them fails the turn. The kit keeps its own message
model and reducer, and does not use the client's agent classes.

- **AG-UI servers work with no adapter.** `SseChatTransport` with the default `AgUiCodec` posts
  an AG-UI `RunAgentInput` and reads the SSE event stream, as AG-UI's HTTP agents expect.
- **Hoist servers can speak AG-UI too.** A hoist-core endpoint can emit the same events as NDJSON
  for `HoistChatTransport`. There is no kit-specific protocol to learn.
- **One AG-UI run is one kit step**, that is one model call. AG-UI's `STEP_STARTED` and
  `STEP_FINISHED` mark stages within a run, and the kit ignores them.

### Support by spec area

| Spec area | Supported | Not yet |
|-----------|-----------|---------|
| Run lifecycle | `RUN_STARTED`, `RUN_FINISHED` and `RUN_ERROR`. `RUN_FINISHED` sets the finish reason, usage and metadata. A new run after `RUN_ERROR` clears the error. The kit checks the sequence rules. | - |
| Validation | The kit drops events of an unknown type and strips unknown fields, each with a console warning. A malformed known field fails the turn. | - |
| Text | `TEXT_MESSAGE_*`, chunks included, as text parts that keep the server's message ids and metadata. | - |
| Tool calls | `TOOL_CALL_*` and `TOOL_CALL_RESULT`, as tool call parts, run in the browser or by the backend. A call keeps the server's ids for its message and its result, and its metadata. A result with `metadata.error` fails its call. | Metadata on a result. |
| Reasoning | `REASONING_*` and `REASONING_ENCRYPTED_VALUE`, as reasoning parts, with signatures, metadata and the server's message ids kept for the history. | - |
| Activity | `ACTIVITY_SNAPSHOT`, as data parts keyed by `activityType`, with their `subagentRunId`. A `ChatActivitySpec` shows a type as a row in the activity timeline. | `ACTIVITY_DELTA`. |
| Sub-agents | `SUBAGENT_*`, as data parts of type `xh.chat.subagent`. The timeline nests their calls and activities. | Attribution of text and reasoning to a sub-agent. |
| Metadata | Metadata on text, reasoning and tool calls, merged from their events and sent back with the history. `metadata` on events the kit reads, such as `RUN_ERROR` and `TOOL_CALL_RESULT`. | Metadata on a tool result or an activity. |
| Shared state | The `state` a codec sends with each run. | `STATE_SNAPSHOT` and `STATE_DELTA`. |
| History snapshots | - | `MESSAGES_SNAPSHOT`. |
| Pass-through | `CUSTOM` events named `xh.chat.*`. Others are ignored, as is `RAW`. | - |
| Requests | A `RunAgentInput` with `protocolVersion: '1.0'`, the whole history with the server's ids and metadata, tools, context, `state`, `forwardedProps` and `resume`, checked before it goes. | - |
| Interrupts | The `interrupt` outcome on `RUN_FINISHED`, answered in the next run's `resume`: questions, forms of simple fields, and approvals of server tool calls. A sub-agent's `suspended` outcome. | A form beyond a flat object of simple fields. Approval with edited arguments. |

The official AG-UI 1.0 conformance corpus runs in the kit's CI, from `test/conformance/` in the
repo. Of the 61 fixtures that apply to a client other than the official ones, 47 pass. 8 more
fail only because the kit keeps no shared state. A committed list names each gap and its reason,
and a gap that closes fails the run until it leaves the list.

An AG-UI `RUN_FINISHED` with an `outcome` of `success` maps to the finish reason `stop`. Any
other outcome maps to `other`. An `interrupt` outcome pauses the reply for the user, who answers
in the next run's `resume` list. See
[Answer an agent's questions](../core/README.md#answer-an-agents-questions).

Content that AG-UI has no event for travels as `CUSTOM` events named `xh.chat.*`: sources,
citations, data parts, files, provider data and tool errors. See
[Kit events](../transport/README.md#kit-events-xhchat).

AG-UI has no way to say that a model call was abandoned and retried. The kit reads
`metadata.superseded: true` on `TEXT_MESSAGE_END` and `TOOL_CALL_END` as that mark, and drops
the part. See [Retry a model call](../transport/README.md#retry-a-model-call).

## Anthropic Messages API

**Status in the kit: built.** `AnthropicCodec` in `/transport/`.

`AnthropicCodec` builds a Messages API request body from the chat history, and decodes
Anthropic's stream events into `ChatEvent`s. A server only relays the stream, as NDJSON for
`HoistChatTransport` or as SSE for `SseChatTransport`. The translation lives once, in tested
TypeScript, and not in each app's server.

| Anthropic stream | Kit events |
|------------------|------------|
| `message_start` | `RUN_STARTED`. Records the model and usage. |
| `content_block_start` with type `text` | `TEXT_MESSAGE_START`. Consecutive text blocks continue one text part. |
| `text_delta` | `TEXT_MESSAGE_CONTENT` |
| `citations_delta` | `xh.chat.citation`, sent when the text block stops |
| `thinking` or `redacted_thinking` block | `REASONING_START` and `REASONING_MESSAGE_START`. Redacted data goes to `providerData.anthropic`. |
| `thinking_delta` | `REASONING_MESSAGE_CONTENT` |
| `signature_delta` | `REASONING_ENCRYPTED_VALUE` when the block stops |
| `tool_use` block, `input_json_delta` | `TOOL_CALL_START`, `TOOL_CALL_ARGS` |
| `server_tool_use` block | The same, plus `xh.chat.providerExecuted` |
| Server tool result block, such as web search | `TOOL_CALL_RESULT`, with `metadata.error` if the block reports an error. The block goes to `providerData.anthropic` for the next request. |
| `content_block_stop` | `TEXT_MESSAGE_END`, `REASONING_END` or `TOOL_CALL_END` |
| `message_delta`, `message_stop` | `RUN_FINISHED`, with the finish reason, `stopReason`, model and usage |
| `error` | `RUN_ERROR`, with the Anthropic error type as its code |
| `ping`, unknown events | Ignored |

**Not yet supported:** a turn that continues after a `pause_turn` stop reason. See
[`/transport/`](../transport/README.md#relay-claude-through-a-hoist-server) for the request
encoding, prompt caching and the other codec options.

## OpenAI

**Status in the kit: Chat Completions built.** `ChatCompletionsCodec` in `/transport/`. No codec
for the Responses API ships yet.

`ChatCompletionsCodec` builds a chat completions request body from the chat history, and decodes
the streamed `chat.completion.chunk` records into `ChatEvent`s. Most model gateways speak this
format, such as Azure OpenAI, LiteLLM, Portkey and internal model services. A server relays the
request to the gateway and relays the stream back, as for `AnthropicCodec`. See
[Bring your own LLM](../transport/README.md#bring-your-own-llm).

The API keeps no state, so each request carries the whole history. The codec therefore throws for
a chat with `historyMode: 'server'`.

| Chat Completions stream | Kit events |
|-------------------------|------------|
| First chunk | `RUN_STARTED` |
| `delta.content`, `delta.refusal` | `TEXT_MESSAGE_START`, `TEXT_MESSAGE_CONTENT` |
| `delta.reasoning_content`, which some gateways and open models add | `REASONING_START`, `REASONING_MESSAGE_CONTENT` |
| First `tool_calls[i]` fragment, with the call's id and name | `TOOL_CALL_START` |
| `tool_calls[i].function.arguments` | `TOOL_CALL_ARGS` |
| `finish_reason` | `TEXT_MESSAGE_END`, `REASONING_END` and `TOOL_CALL_END`, then `RUN_FINISHED` with the finish reason, `stopReason` and model |
| Usage chunk, with `includeUsage` | The usage on `RUN_FINISHED`, which the codec holds back until the usage arrives |
| A record with an `error`, or an SSE event named `error` | `RUN_ERROR`, with the error's `code` or `type` as its code |

Chat Completions has no standard field for citations, so this codec sends none.

A codec for the Responses API would plug in beside the others, with no change to the models or
the components. It would encode the history as Responses input items, and decode each stream
event by its item and output index. It would keep reasoning data that must go back with the
history in `providerData.openai`. This table sketches the mapping. It comes from the OpenAI SDK
event names, and the kit has not tested it.

| Kit event | Responses API |
|-----------|---------------|
| `RUN_STARTED` | `response.created` |
| `TEXT_MESSAGE_CONTENT` | `response.output_text.delta` |
| `REASONING_MESSAGE_CONTENT` | `response.reasoning_summary_text.delta` |
| `TOOL_CALL_START` | `response.output_item.added` with a `function_call` item |
| `TOOL_CALL_ARGS` | `response.function_call_arguments.delta` |
| `TOOL_CALL_END` | `response.function_call_arguments.done` |
| `xh.chat.citation` | `response.output_text.annotation.added` |
| `RUN_FINISHED` | `response.completed`, `response.incomplete` |
| `RUN_ERROR` | `response.failed`, `error` |

## Generative UI

Generative UI lets a model put real UI in the chat, such as a grid, a chart or a form, and not
only text. Three protocols compete here: A2UI, OpenUI and MCP Apps.

**Status in the kit: built.** A `ChatUiCatalog` lets the model show the app's own Hoist
components, and an adapter seam lets A2UI and OpenUI payloads draw with them. The model can
deliver UI in four ways: component tools, display tools, tags in markdown and UI documents. See
[Four delivery modes](../genui/README.md#four-delivery-modes).

### The catalog: components as tools

An app registers Hoist components in a `ChatUiCatalog`, each with a typed props schema. The
catalog turns each component into a client tool, `show_<name>`, with `display: 'inline'`. It
also writes the model's instructions. The model calls a tool with the component's props, and the
chat renders the component inline in the reply as the props stream. The catalog checks the props
against the schema, and returns any problems to the model so it can correct them.

```typescript
const catalog = new ChatUiCatalog({
    components: [chatUiMetricsSpec(), chatUiGridSpec({maxRows: 50}), chatUiChartSpec()]
});

new ChatModel({
    transport: new HoistChatTransport({
        url: 'llm/stream',
        codec: new AnthropicCodec({system: `${appPrompt}\n\n${catalog.instructions}`})
    }),
    tools: appTools,
    catalog
});
```

A catalog that the app controls keeps the model to known components and known props. It also
puts Hoist's own grids and charts in the chat, which suit data-dense apps better than generic
component kits do. The built-in grid, chart, KPI tiles and card are in
[`/desktop/cmp/genui/`](../desktop/cmp/genui/README.md). See [`/genui/`](../genui/README.md) for
the catalog, its safety model, and the cost of each render.

### Other delivery modes

The catalog's `modes` set how the model delivers UI. Component tools are the default. The other
modes put the same components in a reply:

- **Tags in markdown.** The model writes a tag such as `<ui-grid data="sales"/>` in its answer
  text, and the message view renders the component in its place. Tags cost the fewest tokens.
  See [Read tags in a markdown answer](../genui/README.md#read-tags-in-a-markdown-answer).
- **The `show_ui` document tool.** The model sends a document, a flat map of elements that nest
  by id, for an answer with a layout. A server can also send a document as an `xh.chat.ui` data
  part. See [The document model](../genui/README.md#the-document-model).
- **Display tools.** In server mode, the server registers the catalog's tools and answers their
  calls. The chat renders each call from its input. See
  [Export the catalog for a server](../genui/README.md#export-the-catalog-for-a-server).

In every mode, a component can show data by reference. A tool stores its result as an artifact,
and the model names the artifact in a prop, not the rows. The kit loads the rows in pages. See
[Show data by reference](../genui/README.md#show-data-by-reference).

### Protocol adapters

A `ChatUiAdapter` translates a protocol's UI payload into catalog components. The payload
arrives in a data part with the adapter's `dataType`. The catalog registers a data renderer for
each adapter, which translates the payload and renders the resulting components:

```typescript
new ChatModel({
    transport,
    catalog,
    dataRenderers: catalog.createDataRenderers([a2uiAdapter, openUiAdapter])
});
```

The kit ships the interface and no adapter. Each protocol names its components its own way, and
an app maps those names to the components in its catalog. See
[Adapt a protocol's UI payload](../genui/README.md#adapt-a-protocols-ui-payload) for a worked
adapter.

### The seam below: data parts and `dataRenderers`

A `ChatDataPart` carries content that the app or a protocol defines, keyed by `dataType`. A
backend sends one as an `xh.chat.data` event or an AG-UI `ACTIVITY_SNAPSHOT`. The app registers
a renderer per `dataType` in `ChatModelConfig.dataRenderers`. A part with no renderer shows as
JSON, so new content never breaks the chat. A `ChatActivitySpec` in `ChatModelConfig.activities`
shows a type as a row in the activity timeline instead, for an agent's activity that is not a
tool call, such as a skill it loads. See
[Show an agent's activities](../core/README.md#show-an-agents-activities).

```typescript
new ChatModel({
    transport,
    dataRenderers: {
        // App content: a chart the backend chose to show.
        'price-chart': part => priceChart({symbol: part.data.symbol})
    }
});
```

A tool's `renderer` is a second seam. It draws a tool call as UI. Examples are a chart of the
data that the tool returned, or a form that answers an interactive tool. See
[`/core/`](../core/README.md#let-the-user-answer-a-tool-call).

### A2UI

A2UI is a Google-led, Apache-licensed format. The agent sends declarative JSON that describes a
UI surface, and the client renders it with native components from a catalog that the client
trusts. It sends no code. As of October 2026, v0.9.1 is the production version, and v1.0 is a
release candidate. The project calls itself an early-stage public preview, and an official React
renderer is planned but not released.

**In the kit:** an A2UI payload arrives as a data part. A `ChatUiAdapter` maps its components to
catalog components, which then render it with Hoist components. The kit ships no A2UI adapter.
A2UI's model fits the catalog well, because both map component names to native components.

### OpenUI (Thesys)

OpenUI is an MIT-licensed generative UI framework from Thesys. Its core is OpenUI Lang, a compact
language for model-written UI that renders as it streams. An app registers a component library,
generates a system prompt from it, and draws each component as its lines arrive.

"Open UI" here means Thesys OpenUI. The W3C Open UI community group works on standard HTML
controls and does not relate to agents.

**In the kit:** an OpenUI payload arrives as a data part, and a `ChatUiAdapter` maps it to catalog
components. The kit ships no OpenUI adapter. The catalog follows the same idea as OpenUI, a
registered component library with typed props and a generated prompt, on Hoist components.

A model that writes OpenUI Lang as its reply text needs no adapter. The app draws each text part
with OpenUI's own renderer, through `ChatModelConfig.textRenderer`, and gives Copy and screen
readers words through `getCopyText`. See
[Render reply text yourself](../desktop/cmp/chat/README.md#render-reply-text-yourself).

### MCP Apps

MCP Apps is an extension to the Model Context Protocol (MCP). A tool declares a `ui://` resource,
and the host fetches its HTML and shows it in a sandboxed iframe. The view and the host talk
over a JSON-RPC bridge on `postMessage`. A web host must load the view through a sandbox proxy on
a separate origin, with a Content Security Policy built from the resource's metadata.

**In the kit:** a tool call or a data part can carry an MCP App resource today. The kit ships no
MCP Apps host. A correct host needs a separate sandbox origin and a message bridge, which need a
security review and a hosting decision per app.

## Vercel AI SDK Vocabulary

**Status in the kit: built, as names.** The kit does not depend on the AI SDK and does not read
its stream format.

The kit's part types and tool call states follow the Vercel AI SDK `UIMessage` vocabulary, which
most chat libraries share. Code and developers who know the AI SDK can read the kit's messages
at once, and an adapter between the two stays small.

| Kit part | AI SDK `UIMessage` part |
|----------|-------------------------|
| `text` | `text` |
| `reasoning` | `reasoning` |
| `toolCall` | `tool-<name>`, or `dynamic-tool` |
| `file` | `file` |
| `source` | `source-url`, `source-document` |
| `data` | `data-<name>` |

| Kit tool call state | AI SDK tool state |
|---------------------|-------------------|
| `input-streaming` | `input-streaming` |
| `input-available` | `input-available` |
| `approval-requested` | `approval-requested` |
| `running` | None. The kit adds it for tools that run in the browser. |
| `output-available` | `output-available` |
| `output-error` | `output-error` |
| `output-denied` | `output-denied` |

The AI SDK also has an `approval-responded` state. The kit moves an approved call straight to
`input-available`, then `running`.

The finish reasons follow the AI SDK set too: `stop`, `length`, `tool-calls`, `content-filter` and
`other`. The kit adds `max-steps` for a turn that hits its step limit.

A codec for the AI SDK UI message stream is possible, but not built. It overlaps AG-UI, which
covers the same events.

## Related

- [`/transport/`](../transport/README.md) - transports, codecs, `ChatEvent` and server contracts
- [`/core/`](../core/README.md) - messages, parts, tools and data renderers
- [Architecture](./architecture.md) - layers and the flow of one turn
