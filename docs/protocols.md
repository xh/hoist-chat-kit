# Agent-to-UI Protocols

How Hoist Chat Kit relates to the protocols and vocabularies that connect agents and models to a
UI. Each section marks what the kit builds now, and what an app or a later release can add.

The status of each outside protocol is as of October 2026. These protocols are young and still
change. Check each project's own docs for its current state.

## Summary

| Protocol | What it is | Layer | In the kit |
|----------|------------|-------|------------|
| [AG-UI](#ag-ui) | Event stream between an agent backend and a frontend | Wire events | **Built.** The kit's own event vocabulary. |
| [Anthropic Messages API](#anthropic-messages-api) | Claude's request format and SSE stream | Provider format | **Built.** `AnthropicCodec`. |
| [OpenAI](#openai) | The Responses and Chat Completions streams | Provider format | **Not built.** A codec can add it. |
| [A2UI](#a2ui) | Declarative JSON UI, drawn from a client catalog | UI payload | **Adapter seam built.** An app adapter maps it to catalog components. |
| [OpenUI (Thesys)](#openui-thesys) | Generative UI framework and streaming UI language | UI payload | **Adapter seam built.** An app adapter maps it to catalog components. |
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

Every kit transport yields `ChatEvent`s. These are the AG-UI 1.0 events, with the same type
strings and field names. The kit mirrors the types in `transport/ChatEvent.ts` and takes no
runtime dependency on `@ag-ui/*`.

- **AG-UI servers work with no adapter.** `SseChatTransport` with the default `AgUiCodec` posts
  an AG-UI `RunAgentInput` and reads the SSE event stream, as AG-UI's HTTP agents expect.
- **Hoist servers can speak AG-UI too.** A hoist-core endpoint can emit the same events as NDJSON
  for `HoistChatTransport`. There is no kit-specific protocol to learn.
- **One AG-UI run is one kit step**, that is one model call. AG-UI's `STEP_STARTED` and
  `STEP_FINISHED` mark stages within a run, and the kit ignores them.

| AG-UI events | Kit support |
|--------------|-------------|
| `RUN_STARTED`, `RUN_FINISHED`, `RUN_ERROR` | Used. `RUN_FINISHED` sets the finish reason, usage and metadata. |
| `TEXT_MESSAGE_*` | Used. Text parts. |
| `REASONING_*`, `REASONING_ENCRYPTED_VALUE` | Used. Reasoning parts, with signatures kept for the history. |
| `TOOL_CALL_*`, `TOOL_CALL_RESULT` | Used. Tool call parts, run in the browser or by the backend. A result with `metadata.error` fails its call. |
| `ACTIVITY_SNAPSHOT` | Used. Data parts, keyed by `activityType`. |
| `CUSTOM` | Used for the kit's `xh.chat.*` events. Others ignored. |
| `STATE_SNAPSHOT`, `STATE_DELTA`, `MESSAGES_SNAPSHOT` | Ignored. |
| `ACTIVITY_DELTA`, `SUBAGENT_*`, `RAW`, `STEP_*` | Ignored. |

An AG-UI `RUN_FINISHED` with an `outcome` of `success` maps to the finish reason `stop`. Any
other outcome, such as `interrupt`, maps to `other`. The kit pauses for the user through its own
tool states, approvals and interactive tools, and not through AG-UI interrupts.

Content that AG-UI has no event for travels as `CUSTOM` events named `xh.chat.*`: sources,
citations, data parts, files, provider data and tool errors. See
[Kit events](../transport/README.md#kit-events-xhchat).

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

**Status in the kit: not built.** No OpenAI codec ships yet.

A codec for OpenAI would plug in beside `AnthropicCodec`, with no change to the models or the
components. A server would relay the OpenAI stream, and the codec would translate it.

An OpenAI codec would:

1. Encode the history as OpenAI input. Each step of an assistant turn becomes the model's output
   items and its function calls, followed by the function call results.
2. Decode the stream events into `ChatEvent`s, keyed by the item and output index of each event.
3. Map the OpenAI end states to the kit's finish reasons, and keep the raw value as
   `metadata.stopReason`.
4. Keep reasoning data that must go back with the history in `providerData.openai`.

This table sketches the mapping. It comes from the OpenAI SDK event names, and the kit has not
tested it.

| Kit event | Responses API | Chat Completions |
|-----------|---------------|------------------|
| `RUN_STARTED` | `response.created` | First chunk |
| `TEXT_MESSAGE_CONTENT` | `response.output_text.delta` | `choices[].delta.content` |
| `REASONING_MESSAGE_CONTENT` | `response.reasoning_summary_text.delta` | No standard field |
| `TOOL_CALL_START` | `response.output_item.added` with a `function_call` item | First `tool_calls[i]` fragment |
| `TOOL_CALL_ARGS` | `response.function_call_arguments.delta` | `tool_calls[i].function.arguments` |
| `TOOL_CALL_END` | `response.function_call_arguments.done` | `finish_reason` of `tool_calls` |
| `xh.chat.citation` | `response.output_text.annotation.added` | None |
| `RUN_FINISHED` | `response.completed`, `response.incomplete` | `finish_reason`, then `[DONE]` |
| `RUN_ERROR` | `response.failed`, `error` | An error body |

Chat Completions also serves many OpenAI-compatible vendors. A Chat Completions codec would cover
them, apart from vendor-specific fields such as non-standard reasoning deltas.

## Generative UI

Generative UI lets a model put real UI in the chat, such as a grid, a chart or a form, and not
only text. Three protocols compete here: A2UI, OpenUI and MCP Apps.

**Status in the kit: built.** A `ChatUiCatalog` lets the model show the app's own Hoist
components, and an adapter seam lets A2UI and OpenUI payloads draw with them.

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
JSON, so new content never breaks the chat.

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
