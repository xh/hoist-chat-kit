# Transport Package

| Section | Description |
|---------|-------------|
| [Overview](#overview) | How the chat gets events from a backend, and the key features |
| [Architecture](#architecture) | Transports, codecs, `ChatEvent`, and how they fit together |
| [Configuration Pattern](#configuration-pattern) | Choosing and configuring a transport and a codec |
| [Common Usage Patterns](#common-usage-patterns) | Direct calls or a Hoist relay, Anthropic, bring your own LLM, AG-UI agents, server-owned conversations, scripted demos and tests, use without `ChatModel` |
| [Server Contracts](#server-contracts) | What each transport expects from its backend |
| [Hoist Server Example](#hoist-server-example) | A hoist-core controller that relays an Anthropic stream |
| [Properties/API Reference](#propertiesapi-reference) | Config tables, the event vocabulary, and `xh.chat.*` events |
| [Extension Points](#extension-points) | Writing a custom transport or codec |
| [Common Pitfalls](#common-pitfalls) | Mistakes that compile but misbehave |
| [Related Packages](#related-packages) | Core models, protocols, and Hoist packages |

## Overview

The `/transport/` package connects a `ChatModel` to the backend that runs the model or agent. A
transport runs one step, that is one model call, and yields the events of the reply as they
arrive. The chat model drives the conversation and never sees the wire format. The same UI
therefore works against a Hoist server, an AG-UI agent server, or a scripted demo.

Import from `@xh/hoist-chat-kit/transport`.

Key features:

- **AG-UI events as the wire vocabulary** - every transport yields `ChatEvent`s, which are AG-UI
  1.0 events, typed from the official `@ag-ui/core`. `AgUiCodec` runs the official
  `@ag-ui/client` checks on each stream. Any AG-UI agent server works with the kit, with no
  adapter.
- **Direct calls or a Hoist relay** - call a backend from the browser with the user's OAuth
  token, or relay it through your Hoist server when it needs a secret key. The kit supports both
  equally. See [Choose where requests go](#choose-where-requests-go).
- **Transports carry, codecs translate** - the framing (NDJSON or Server-Sent Events) and the
  format (AG-UI, Anthropic or OpenAI chat completions) vary on their own. Pick one of each.
- **`HoistChatTransport`** - NDJSON from your own hoist-core server, through `XH.fetchNdjson`,
  with Hoist's auth headers, correlation IDs, tracing, activity tracking and error handling.
- **`SseChatTransport`** - Server-Sent Events (SSE) straight from an AG-UI agent server, or from
  an SSE proxy.
- **`AnthropicCodec`** - lets a server relay Claude's stream line by line, with nothing to
  translate. The kit translates the stream in tested TypeScript.
- **`ChatCompletionsCodec`** - the same for the OpenAI chat completions format, which most model
  gateways speak. See [Bring your own LLM](#bring-your-own-llm).
- **Live context** - each request carries the output of the chat's context providers, and each
  codec sends it to the model in its own format.
- **`ScriptedChatTransport`** - canned events with realistic pacing, for demos and unit tests.
- **Real cancellation** - a stop closes the HTTP connection, so the server can stop generating
  tokens. A `cancelUrl` also posts a cancel, for a backend that keeps running after a disconnect.
- **Both conversation shapes** - each request carries the whole history. For an agent service
  that owns the history, it also carries the turn's ids.

## Architecture

```
ChatTransport (interface)
├── cancelAsync?(run): Promise<void>            # Cancel a run the user stopped
├── reconnect?(run, signal)                     # Reserved - reattach to a running run
├── supportsInterrupts?: boolean                # True if it can send a resume list
└── run(request): AsyncIterable<ChatEvent>      # One step - one model call
    │
    ├── HttpChatTransport (abstract)            # POST a JSON body, read a streamed response
    │   ├── codec: ChatCodec                    # Encodes the body, decodes each record
    │   ├── HoistChatTransport                  # NDJSON via XH.fetchNdjson
    │   └── SseChatTransport                    # text/event-stream via XH.fetch
    │
    └── ScriptedChatTransport                   # Scripted events, no backend

ChatCodec (interface)
├── encodeRequest(request): body                # May be async
├── createDecoder(request): ChatDecoder         # One decoder per step, may hold state
├── AgUiCodec                                   # AG-UI RunAgentInput, official checks on events
├── AnthropicCodec                              # Messages API body, Anthropic stream events
└── ChatCompletionsCodec                        # Chat completions body, OpenAI chunks

ChatRunRequest
├── threadId, runId                             # Conversation and step ids
├── historyMode: 'client' | 'server'            # Who owns the history
├── trigger, turnId, stepIndex                  # What started the step, and its turn
├── messages: ChatMessage[]                     # History, ending with the reply being built
├── newMessages: ChatMessage[]                  # What the server has not seen
├── replacedMessageId: string                   # The reply a retry or regenerate replaces
├── runOptions: PlainObject                     # Options the user picked, copied at send
├── catalogVersion: string                      # Version of the chat's generative UI catalog
├── resume?: ResumeEntry[]                      # Responses to the last interrupted run
├── tools: ChatToolSpec[]                       # Tools to send to the model
├── context: ChatRunContext[]                   # Live context from the context providers
└── signal: AbortSignal                         # Aborts the step, with a ChatAbortError
```

For each step, `ChatModel` builds a `ChatRunRequest` and iterates `transport.run()`. An HTTP
transport asks its codec for the request body, posts it, and reads the response one record at a
time. Each record is a parsed NDJSON line or the parsed `data` of an SSE event. The codec's
decoder turns each record into zero or more `ChatEvent`s. The chat applies the events to the
assistant message. See [Architecture](../docs/architecture.md) for the full flow of a turn.

The last message of `request.messages` is the assistant message under construction. On the first
step it has no parts. On later steps it holds the parts of the earlier steps, including tool
calls with their results. A codec encodes those parts into the provider's own history format.

## Configuration Pattern

Pick a transport by where the events come from, then a codec by their format.

| Backend | Transport | Codec |
|---------|-----------|-------|
| Your hoist-core server relays the Anthropic Messages API | `HoistChatTransport` | `AnthropicCodec` |
| Your hoist-core server emits AG-UI events, for example from its own agent | `HoistChatTransport` | `AgUiCodec` (default) |
| An AG-UI agent server, such as LangGraph, Mastra or Pydantic AI | `SseChatTransport` | `AgUiCodec` (default) |
| A proxy that relays Anthropic's SSE stream unchanged | `SseChatTransport` | `AnthropicCodec` |
| Your hoist-core server relays an OpenAI-compatible gateway | `HoistChatTransport` | `ChatCompletionsCodec` |
| No backend - a demo, a test, or offline work | `ScriptedChatTransport` | None |
| Anything else, such as a WebSocket | Your own `ChatTransport` | Your choice |

The HTTP transports share one config, `HttpChatTransportConfig`:

```typescript
import {AnthropicCodec, HoistChatTransport} from '@xh/hoist-chat-kit/transport';

const transport = new HoistChatTransport({
    url: 'chat/stream',                                  // Relative to XH.baseUrl
    codec: new AnthropicCodec({system: SYSTEM_PROMPT}),  // Default an AgUiCodec
    params: {agent: 'portfolio'},                        // Query string
    track: {category: 'Chat', message: 'Assistant call'},
    timeout: 60_000,                                     // Until the response starts
    idleTimeout: 90_000                                  // Longest silence while it streams
});
```

`url`, `headers` and `params` each take a value, or a function of the request that returns one.
The function may be async, for example to fetch a short-lived token before each step:

```typescript
new SseChatTransport({
    url: req => `https://agents.example.com/threads/${req.threadId}/runs`,
    headers: async () => ({Authorization: `Bearer ${await getTokenAsync()}`})
});
```

`idleTimeout` fails a step whose server goes quiet, with error code `stalled`. Any data resets
it. A server that can go quiet for long, such as an agent that runs a slow tool, sends
heartbeats: an SSE comment, or an NDJSON record of the form `{"type": "xh.heartbeat"}`. The
transport reads a heartbeat as data, never decodes it, and resets the timer.

## Common Usage Patterns

### Choose where requests go

The kit supports two ways to reach a backend, and neither is preferred. Pick by what the backend
needs.

| The backend | Call it | Transport |
|---|---|---|
| Takes the user's OAuth token, and checks access and limits itself | Straight from the browser | `SseChatTransport`, or your own |
| Needs a secret API key, such as a model provider | Through a relay on your Hoist server | `HoistChatTransport` |
| Needs server-side work first, such as data the browser cannot see | Through a relay on your Hoist server | `HoistChatTransport` |

If a backend accepts the user's OAuth token, call it from the browser. The request skips a hop,
and the backend's team owns its own access rules. Never put a secret API key in the browser,
where any user can read it.

For a direct call, get the token from the OAuth client that your app's `AuthModel` holds. Name an
access token for the backend in that client's `accessTokens` config, then fetch it before each
step:

```typescript
async function getTokenAsync(): Promise<string> {
    const token = await XH.authModel.client.getAccessTokenAsync('agentService');
    return token.value;
}

new ChatModel({
    transport: new SseChatTransport({
        url: 'https://agents.example.com/portfolio',
        headers: async () => ({Authorization: `Bearer ${await getTokenAsync()}`})
    })
});
```

See Hoist's `docs/authentication.md` for the `AuthModel` and its access tokens. The examples below
use the same `getTokenAsync()`.

Hoist sends cookies with every request (`credentials: 'include'`). A browser allows that across
origins only when the backend answers with `Access-Control-Allow-Credentials: true` and names your
origin exactly. A backend that authenticates by header alone often sends neither, and the browser
then blocks every call. Pass `fetchOpts: {credentials: 'omit'}` to the transport, and the same
`fetchOpts` to any other `XH.fetchJson` call your app makes to that backend. The backend's CORS
rules must also allow each header you send, such as `Authorization`, any API key header, and
`Content-Type`. Hoist adds headers of its own: `X-Correlation-ID` when the app turns on
`FetchService.defaults.autoGenCorrelationIds`, and `traceparent` when Hoist tracing is on. If the
backend does not allow `X-Correlation-ID`, pass `correlationId: false`. If it does not allow
`traceparent`, return `traceparent: null` from `headers`. Hoist sends no header set to null.

In local dev, a backend's CORS rules may not list your dev server's origin. Proxy the backend
through the dev server instead, with a `proxy` in the `devServerOptions` of `configureRsbuild()`,
and point the app's URLs at the proxied paths. That `proxy` replaces Hoist's default one for
`/api`, so repeat that entry too. Copy it from `configureRsbuild.js` in `@xh/hoist-dev-utils`. A local dev server that proxies the backend on your app's own origin hides all of
this, so test against the real origin before you deploy.

### Relay Claude through a Hoist server

The server holds the API key, and the browser builds the Messages API body.

```typescript
new ChatModel({
    transport: new HoistChatTransport({
        url: 'chat/stream',
        codec: new AnthropicCodec({
            // A function runs before every step, so it sees the app's current state.
            system: () => this.buildSystemPrompt(),
            params: {
                thinking: {type: 'adaptive', display: 'summarized'},
                tools: [{type: 'web_search_20260209', name: 'web_search'}]
            },
            cacheControl: true
        })
    }),
    tools: this.tools
});
```

`AnthropicCodec` options:

- **`system`** - a string, a list of Messages API text blocks, or a function that returns either.
  The function can be async. System messages in the history are appended to it.
- **`model`** and **`maxTokens`** - leave these out when the server sets them, as the example
  server below does.
- **`params`** - other fields for the body, such as `thinking`, `output_config` or `temperature`.
  Tools in `params.tools` go ahead of the chat's own tools. Use them for Anthropic server tools,
  such as web search.
- **`cacheControl`** - true to mark prompt cache breakpoints, so that Anthropic caches the
  prompt across the steps and turns of a chat. See below.
- **`prepareBody`** - a function that adjusts the finished body before it goes out. It can be
  async.

With `cacheControl`, the codec marks up to three breakpoints, in this order:

1. The last block of the history. Each step and turn then reads the conversation so far from the
   cache, and writes only what it adds. This pays off most in a tool loop, where every step
   resends the whole turn.
2. The last system block - unless you mark any system block yourself. Your placement then
   stands, and the codec adds none to the system prompt.
3. The last tool definition.

Anthropic allows at most 4 breakpoints per request, and the codec counts the ones you set. It
stops adding marks at the limit, in the order above.

A breakpoint caches everything before it, so it pays off only when that content repeats. To keep
a block that changes on every step out of the cache, put it after the cached block, unmarked. If
your system prompt ends with live state, return blocks from `system` with the static part first,
and mark that block with `cache_control` yourself. The live block after it then goes out fresh
on each step, and the static part comes from the cache.

The chat's live context, from its `contextProviders`, goes at the end of the last user turn, as
one unmarked text block per provider, after the history's breakpoint. Each step sends it fresh,
and the next step reads the history before it from the cache. In the system prompt, it would come
before the history, and each change would void the cached history.

The structured context of a user message, from `metadata.context`, goes after the message's text
as a `<message-context>` block of JSON. It stays with the message, so it is cached with the
history.

```typescript
new AnthropicCodec({
    system: () => [
        {type: 'text', text: STATIC_INSTRUCTIONS, cache_control: {type: 'ephemeral'}},
        {type: 'text', text: `Current dashboard:\n${JSON.stringify(this.dashSpec)}`}
    ],
    // An opaque id for the user, which the Messages API accepts as `metadata.user_id`.
    prepareBody: body => ({...body, metadata: {user_id: this.userHash}})
});
```

How the codec encodes the history:

- Each step of an assistant turn becomes an assistant turn, with its thinking, text and tool
  calls. A user turn with the tool results follows it. Failed and denied calls carry
  `is_error: true`.
- Thinking goes back with its signature. Thinking with no signature, for example from an
  interrupted stream, is dropped, because the API would reject it.
- Attached images and PDFs become `image` and `document` blocks. Text files, including JSON, XML,
  YAML and CSV, become text documents. Other files become a text note, so the model knows the
  file was left out.
- A request with no user content throws, because the API would reject it.

The codec decodes text, thinking with its signature, tool calls with streamed input, and
citations. It also decodes server tool calls, such as web search, with their results. It keeps
the data that must go back to Anthropic unchanged, such as redacted thinking and server tool result
blocks, on the part as `providerData.anthropic`. An Anthropic `error` event becomes `RUN_ERROR`,
with the Anthropic error type as its code.

| Anthropic `stop_reason` | `finishReason` |
|-------------------------|----------------|
| `end_turn`, `stop_sequence` | `stop` |
| `max_tokens`, `model_context_window_exceeded` | `length` |
| `tool_use` | `tool-calls` |
| `refusal` | `content-filter` |
| Anything else, such as `pause_turn` | `other` |

The raw value goes in `metadata.stopReason`, and the token counts go in `metadata.usage`. Cache
reads and writes count within `inputTokens`, as AG-UI counts them.

**Not yet supported:** a turn that continues after a `pause_turn` response. The API pauses a long
server tool loop and expects the client to send the paused turn back. The kit ends the turn at
the pause.

### Bring your own LLM

An enterprise picks its own model and gateway, and configures it once, on the server. The kit
owns the tools and the prompts. Most gateways speak the OpenAI chat completions format, such as
Azure OpenAI, LiteLLM, Portkey and internal model services. `ChatCompletionsCodec` speaks it, so a
hoist-core relay can forward the gateway's stream with nothing to translate.

Point a `HoistChatTransport` at the relay, with the codec:

```typescript
new HoistChatTransport({
    url: 'llm/stream',
    codec: new ChatCompletionsCodec({
        system: 'You help the user arrange their dashboard.',
        params: {temperature: 0.2}
    })
});
```

`ChatCompletionsCodec` options:

- **`system`** - a string, or a function of the request that returns one. The function can be
  async. System messages in the history follow it, in one `system` message.
- **`model`** - leave it out when the server or gateway sets it.
- **`params`** - other body fields, such as `temperature`, `max_completion_tokens` or
  `reasoning_effort`. Tools in `params.tools` go ahead of the chat's own tools.
- **`includeUsage`** - true, the default, to ask for token counts with
  `stream_options: {include_usage: true}`. Set it false for a gateway that rejects
  `stream_options`.
- **`prepareBody`** - a function that adjusts the finished body before it goes out.

The chat's live context goes last, as a `user` message with one tagged section per provider, so
that a gateway's prefix cache still covers the history. The structured context of a user message,
from `metadata.context`, follows its text as a `<message-context>` block of JSON.

How the codec encodes the history:

- Each step of an assistant turn becomes an `assistant` message, with its text and its finished
  tool calls as `tool_calls`. A `tool` message with the result follows each call. The format has
  no error flag, so the result of a failed call starts with `Error:`.
- Reasoning does not go back to the model.
- Images become `image_url` parts. PDFs with inline data become `file` parts. Text files become
  text. Other files become a text note, so the model knows the file was left out.

The codec decodes text, `refusal` text, and tool calls. A tool call arrives in fragments by
`index`. The first fragment holds the call's id and name, and later ones stream its arguments.
Some gateways and open models add `reasoning_content`, which the codec decodes as reasoning.

The chunk that carries `finish_reason` ends the step with `RUN_FINISHED`, as the `[DONE]`
sentinel never reaches a codec. With `includeUsage`, the token counts come in a chunk of their own
after it. The codec holds `RUN_FINISHED` back until that chunk, or the end of the stream, and
sends one `RUN_FINISHED` with the counts. A record with an `error` becomes `RUN_ERROR`, with the
error's `code`, or else its `type`, as its code.

| `finish_reason` | `finishReason` |
|-----------------|----------------|
| `stop` | `stop` |
| `length` | `length` |
| `tool_calls`, `function_call` | `tool-calls` |
| `content_filter` | `content-filter` |
| Anything else | `other` |

A relay for a gateway follows the [Hoist Server Example](#hoist-server-example), with three
changes. It posts to the gateway's `/chat/completions` endpoint with the gateway's key. It writes
the `data` of each SSE event as one NDJSON line. It drops the `[DONE]` line, which is not JSON.

Like `AnthropicCodec`, the codec needs the whole history, so it throws for a chat in server mode.

### Connect to an AG-UI agent server

```typescript
import {AgUiCodec, SseChatTransport} from '@xh/hoist-chat-kit/transport';

new ChatModel({
    transport: new SseChatTransport({
        url: 'https://agents.example.com/portfolio',
        headers: async () => ({Authorization: `Bearer ${await getTokenAsync()}`}),
        codec: new AgUiCodec({
            context: () => [{description: 'Selected sector', value: this.selectedSector}],
            forwardedProps: {tenant: 'emea'},
            state: () => ({selectedSector: this.selectedSector})
        })
    })
});
```

`AgUiCodec` sends each step as an AG-UI `RunAgentInput`:

```
{threadId, runId, protocolVersion: '1.0', state, messages, tools, context, forwardedProps}
```

User messages carry their text as `content`, or a list of text, image, audio, video and document
parts when they have attachments. Each step of an assistant turn becomes three kinds of message: a
`reasoning` message per reasoning part, an `assistant` message with its text and its finished
`toolCalls`, and a `tool` message per call result. A failed or denied call also carries `error`.
Tools go out as `{name, description, parameters}`. `context`, `forwardedProps` and `state` take a
value, or a function that builds the value for each step. `state` defaults to `{}`. The structured
context of the turn's user message, from `metadata.context`, goes last in `context`, as JSON.

Before it sends a request, the codec runs the official `@ag-ui/client` check on it. The check
strips fields AG-UI does not define, with a console warning. A malformed field, such as a
`context` value that is not a string, fails the turn before the request goes, with a
`ChatRunError` coded `invalid-request`.

Decoding runs the official `@ag-ui/client` checks on each record, in the order its own agents run
them:

- **Enforcement.** The decoder drops a record of an unknown `type`, and strips fields AG-UI does
  not define, each with a console warning. A malformed value in a field AG-UI defines fails the
  turn.
- **Chunk expansion.** `TEXT_MESSAGE_CHUNK`, `REASONING_MESSAGE_CHUNK` and `TOOL_CALL_CHUNK`
  become start, content and end events, so the chat sees only those.
- **Sequence checks.** A stream must open with `RUN_STARTED`, close each message before
  `RUN_FINISHED`, and follow AG-UI's other ordering rules.

A stream that breaks a rule fails the turn with a `ChatRunError` coded `invalid-stream`, such as
`Invalid AG-UI stream: First event must be 'RUN_STARTED'`. Hoist reports it as a client error, as
it is a bug in the backend. The checks cannot be turned
off. A stream that ends before `RUN_FINISHED` passes them, and the chat then fails it as
`incomplete-stream`. A backend that emits AG-UI by hand must follow the spec, so test its streams
with the kit. See [Support by spec area](../docs/protocols.md#support-by-spec-area) for
what the kit does with each part of the spec.

`AgUiCodec` sends every message the chat holds, in both history modes. In server mode it also
puts the turn in `forwardedProps`. See [Server-owned conversations](#server-owned-conversations).

### Server-owned conversations

With `historyMode: 'server'` on the `ChatModel`, an agent service owns the history, the threads
and the tool loop. Each request still holds the whole history in `messages`, so a client-mode
codec works unchanged. A server-mode codec also sends these fields:

| Field | Value |
|-------|-------|
| `newMessages` | What the server has not seen: the user message on the first step of a turn, or the reply on a `continue` step, whose last step holds the client's tool results. |
| `turnId` | Id of the user message the turn answers. The same for every step of the turn, and for a retry, regenerate or edit of it. |
| `trigger` | `submit`, `retry`, `regenerate`, `edit`, or `continue` for a later step of a turn. |
| `stepIndex` | Zero-based index of the step within its turn. |
| `replacedMessageId` | The reply that a `retry` or `regenerate` replaces, or null. |
| `runOptions` | The options the user picked, copied when the message was sent, or null. |
| `catalogVersion` | Version of the chat's generative UI catalog, or null. The server compares it with the version of the catalog export it loaded. |
| `resume` | The responses to the interrupts of the thread's last interrupted run, as AG-UI resume entries, or null. `AgUiCodec` sends them as `RunAgentInput.resume`. See [Answer an agent's questions](../core/README.md#answer-an-agents-questions). |

A backend with an idempotency key keys runs by `turnId` and `trigger`. It replays a finished run
for a `retry`, and starts a new run for a `regenerate` or an `edit`.

`AgUiCodec` encodes a server-mode request as a `RunAgentInput` whose `messages` holds every
message the chat holds, as in client mode. AG-UI 1.0 has no mode for new messages only: an agent
"MUST treat it as the complete history it is being shown". Adapters that keep state, such as
LangGraph's, merge the history by message id. Adapters that keep none, such as Pydantic AI's by
default, need all of it. A tool result always travels with the assistant message that called the
tool.

Each message goes with the server's id where the chat has one, so that an adapter that merges by
id finds its own messages. A message takes its `metadata.serverId`. A reply that streamed as
several AG-UI messages goes back as those messages, with the ids its parts keep. Their order is
the order the official client assembles them in. A message with no server id takes the kit's id.

A backend that cannot take the whole history can set `newMessagesOnly: true` on the codec. This
is outside the AG-UI spec. In server mode, `messages` then holds only what the server has not
seen. On the first step of a turn, that is the user message. On a `continue` step, it is the
client tool calls of the reply's last step, with their results. Each result still travels with the assistant
message that called the tool. Use it only with a backend that keeps the history itself and needs
this. A stateless adapter loses all context with it.

The turn goes in `forwardedProps`, merged under any props the app sets:

```json
{
    "threadId": "7f3c...",
    "runId": "b21e...",
    "messages": [
        {"id": "51c0...", "role": "user", "content": "What changed in the leave policy?"},
        {"id": "e7a2...", "role": "assistant", "content": "Two things changed..."},
        {"id": "9a4d...", "role": "user", "content": "Which form applies?"}
    ],
    "forwardedProps": {
        "turnId": "9a4d...",
        "trigger": "submit",
        "runOptions": {"documentIds": ["doc-1"]},
        "tenant": "emea"
    }
}
```

`replacedMessageId` joins them for a retry or regenerate. `catalogVersion` joins them for a chat
with a catalog. `runOptions` is left out when it is null. A key the app sets in its own
`forwardedProps` wins over the kit's.

`AnthropicCodec` serves client mode only. The Messages API keeps no state, so it needs the whole
history, and the codec throws for a server-mode request. Use `AgUiCodec`, or write a codec for
the agent service's own format.

What a server-mode backend sends back:

- `RUN_STARTED` with its own `threadId`, if it mints thread ids. The chat adopts the id from the
  first run of a new thread, once. Its `runId` becomes the reply's `metadata.runId`.
- `xh.chat.message` with `{role, serverId}`, for the server's ids of the reply and the user
  message. They become `metadata.serverId`. A `messageId` in the `result` of `RUN_FINISHED` also
  works, for the reply.
- `xh.chat.textReplace` to reset the answer (`text: ''`) or to send its final text whole.
- `xh.chat.artifact`, or `metadata.artifacts` on a `TOOL_CALL_RESULT`, for result sets that
  generative UI components show by reference.
- `RUN_ERROR` with `metadata.retryAfterSeconds`, to ask for a wait before a retry.

A backend that mints its own thread ids needs no separate create call. A new thread's first
request carries the id the browser minted. Create the thread when that request arrives, in the
server's run endpoint or in a custom transport. Then report the backend's id on `RUN_STARTED`.
The chat adopts it, and `ChatThreadsModel` re-keys the thread's summary, selection, draft and
route to it. Key the create by the browser's id. A retry of a first turn that failed before
`RUN_STARTED` then finds the same thread.

A stop closes the connection and calls `cancelAsync()`. With a `cancelUrl`, the HTTP transports
post `{threadId, runId, turnId}` there, with the `headers` and `params` of the stopped step. The
`runId` is the one the server reported on `RUN_STARTED`. A detach, a clear or a load also closes
the connection, but sends no cancel. So a backend that supports them must keep a run going when
the client disconnects, and save its answer for the next load of the thread.

```typescript
new SseChatTransport({
    url: 'https://agents.example.com/runs',
    cancelUrl: run => `https://agents.example.com/runs/${run.runId}/cancel`,
    headers: async () => ({Authorization: `Bearer ${await getTokenAsync()}`})
});
```

### Script a demo or a test

`ScriptedChatTransport` plays back events with no backend. Give it one response per step, in
order across all turns, or a `respond` function that reacts to the request. It adds the
`RUN_STARTED` and `RUN_FINISHED` events where a response leaves them out.

```typescript
import {
    citationEvents,
    dataEvents,
    reasoningEvents,
    ScriptedChatTransport,
    scriptedDelay,
    sourceEvents,
    textEvents,
    toolCallEvents
} from '@xh/hoist-chat-kit/transport';

const transport = new ScriptedChatTransport({
    responses: [
        // Step 1 - think, then call the client tool getWeather.
        [
            reasoningEvents('The user wants the weather in Paris. I will look it up.'),
            toolCallEvents('getWeather', {city: 'Paris'})
        ],
        // Step 2 - the chat sends the tool result back, and the model answers.
        [
            scriptedDelay(400),
            textEvents('It is **18°C** and sunny in Paris.'),
            citationEvents([{sourceId: 'paris', title: 'Paris forecast'}]),
            sourceEvents([{id: 'paris', url: 'https://example.com/paris', title: 'Paris forecast'}]),
            dataEvents('weather-card', {city: 'Paris', tempC: 18})
        ]
    ]
});
```

A `respond` function suits a demo that the user can type into. Its second argument, a
`ScriptedRequestContext`, says where the request falls. It holds the `turnIndex`, the `stepIndex`
within the turn, and the `userMessage` the turn answers. Its `attempt` counts the earlier answers to
that message, from a retry or a regenerate.

```typescript
new ScriptedChatTransport({
    respond: (request, {stepIndex, userMessage, attempt}) => {
        // Fail the first try of each message, so the user can see Retry.
        if (attempt === 0) return errorEvents('The model is overloaded.', 'overloaded_error');
        // Look the city up in the first step, then answer with the tool result.
        if (stepIndex === 0) return toolCallEvents('getWeather', {city: userMessage.text});
        return textEvents('It is **18°C** and sunny.');
    }
});
```

The helpers are `textEvents()`, `reasoningEvents()`, `toolCallEvents()`, `subagentEvents()`,
`activityEvents()`, `sourceEvents()`, `citationEvents()`, `dataEvents()`, `noAnswerEvents()`,
`errorEvents()`, `interruptEvents()` and `scriptedDelay()`. A citation attaches to the text part
before it, and refers to a source by `sourceId` or by `url`. A source can carry a `sourceType`, a
`marker`, the number that cites it as `[n]` in the text, and `metadata`. `noAnswerEvents()` writes a
fixed "not found" reply. Pass `{retryAfterSeconds}` as the third argument of `errorEvents()` to ask
for a wait before a retry. Pass a `result` to `toolCallEvents()` to simulate a tool that the backend
runs, or an `error` for one that fails. `interruptEvents()` ends the run with interrupts, to ask the
user questions. A script reads the answers from the next request's `resume`. `subagentEvents()`
wraps events in a sub-agent's start and end, and marks its tool calls and activities as the
sub-agent's. The activity timeline nests its calls, and its activities whose spec has `display:
'timeline'`. `activityEvents()` writes an AG-UI `ACTIVITY_SNAPSHOT`, such as a skill the agent
loads. A response can also be an async iterable of events, which sets its own pace.

In a unit test, set `delayMs: 0` and read `transport.requests` to check what the chat sent:

```typescript
import {ChatModel} from '@xh/hoist-chat-kit/core';
import {ScriptedChatTransport, textEvents, toolCallEvents} from '@xh/hoist-chat-kit/transport';
import {initTestAppAsync} from '@xh/hoist/test-support';
import {beforeAll, describe, expect, it} from 'vitest';

describe('AssistantModel tools', () => {
    beforeAll(async () => {
        await initTestAppAsync();
    });

    it('runs the tool the model calls, and sends the result back', async () => {
        let sector = null;
        const transport = new ScriptedChatTransport({
                responses: [[toolCallEvents('filter_sector', {sector: 'Energy'})], textEvents('Done.')],
                delayMs: 0
            }),
            chatModel = new ChatModel({
                transport,
                tools: [{name: 'filter_sector', execute: input => (sector = input.sector)}]
            });

        await chatModel.sendAsync('Show only energy stocks');

        expect(sector).toBe('Energy');
        expect(chatModel.lastMessage.toolCalls[0].state).toBe('output-available');
        expect(transport.requests).toHaveLength(2);
    });
});
```

### Use a transport without ChatModel

An app that keeps its own conversation state can still use the kit's transports and codecs. Build a
request with `createChatRunRequest()`, iterate `transport.run()`, and fold the events into an
assistant message with `ChatStreamReducer` from `/core/`.

```typescript
import {ChatMessage, ChatStreamReducer} from '@xh/hoist-chat-kit/core';
import {
    AnthropicCodec,
    createChatRunRequest,
    HoistChatTransport
} from '@xh/hoist-chat-kit/transport';

const transport = new HoistChatTransport({url: 'chat/stream', codec: new AnthropicCodec()}),
    controller = new AbortController(),
    request = createChatRunRequest({
        messages: [new ChatMessage({role: 'user', content: 'Summarize this quarter.'})],
        signal: controller.signal
    }),
    reducer = new ChatStreamReducer(request.stepIndex);

let reply = new ChatMessage({role: 'assistant', status: 'pending'});
for await (const event of transport.run(request)) {
    reply = reducer.apply(reply, [event]);
    onReply(reply);                       // Your own state update
}
reply = reducer.finish(reply);
if (reply.status !== 'error') reply = reply.withChanges({status: 'complete'});
```

`createChatRunRequest()` needs only the messages. Every other field defaults to what `ChatModel`
sends for the first step of a turn in client mode. The request gets new thread and run ids, and the
last user message as `turnId` and `newMessages`. It has no tools and no context.

Pass any field to set it. Pass the same `threadId` for each turn of a conversation. Pass a `signal`
if you want to stop the step, because the default signal never aborts.

The reducer returns a new message for each batch and never marks it `complete`. `finish()` fails a
reply whose stream ended without `RUN_FINISHED`, or that finished with no content.

To answer the client tool calls in the reply, run the tools yourself. Give each tool call part its
`output` and the state `output-available`, in a new message. Then send a request for the next step.
Pass the same `threadId` and `turnId`, `trigger: 'continue'` and the next `stepIndex`. Pass the
reply as the last of the `messages` and as `newMessages`. Fold that step's events into the same
reply, with a new reducer.

## Server Contracts

### Events, for every backend

These rules apply to any backend, whatever the transport and codec. They are stated as AG-UI
events. The `AnthropicCodec` produces them from Anthropic's stream.

- A step is one AG-UI run, from `RUN_STARTED` to `RUN_FINISHED` or `RUN_ERROR`. AG-UI's own
  `STEP_STARTED` and `STEP_FINISHED` mark stages within a run. The kit ignores them.
- A stream that ends with neither `RUN_FINISHED` nor `RUN_ERROR` fails the turn, with error code
  `incomplete-stream`.
- With `AgUiCodec`, a stream must also follow AG-UI's rules. It opens with `RUN_STARTED`, closes
  each message before `RUN_FINISHED`, and sends well-formed fields. A stream that breaks a rule
  fails the turn. See [Connect to an AG-UI agent server](#connect-to-an-ag-ui-agent-server).
- After `RUN_ERROR`, the chat reads on until the stream ends, as it does after `RUN_FINISHED`, so
  close the stream after the last run. A `RUN_STARTED` after the error starts a new run, as AG-UI
  allows, and clears the error. If the stream ends on the error, its `message` shows to the user,
  and its `code` becomes `ChatRunError.code`.
- Tool call ids must be unique within a turn. A tool call part takes its id, and the chat ignores
  a second `TOOL_CALL_START` with an id already used in the turn. Text message ids can repeat from
  one step to the next.
- A tool that the backend runs must send its result as `TOOL_CALL_RESULT` in the same step.
  Otherwise the chat fails the call, or runs it if a client tool has the same name. Send
  `xh.chat.providerExecuted` to mark a call as the backend's before its result arrives.
- A backend tool that fails reports it on its result, as AG-UI's event has no error field. Set
  `metadata.error` to the error text, or set `metadata.isError: true` and send the error text as
  `content`. A backend that cannot set `metadata` sends `xh.chat.toolError` in place of the
  result. Either way the call shows as failed, and the model sees the error.
- Tool arguments must parse as a JSON object. An empty argument string counts as `{}`. Anything
  else fails the call with `Invalid tool input`.
- `RUN_FINISHED` can carry `usage` and `metadata`. The chat records both on the message. Set
  `metadata.finishReason` to one of `stop`, `length`, `tool-calls`, `content-filter` or `other`.

### HoistChatTransport

- The endpoint receives a POST with a JSON body, the request as encoded by the codec. With the
  default `AgUiCodec`, the body is an AG-UI `RunAgentInput`.
- It responds with `application/x-ndjson`: one JSON record per line, in the codec's format. That
  is AG-UI events by default, or Anthropic stream events with an `AnthropicCodec`.
- It must **flush after each line**, so tokens reach the user as the model writes them.
- It ends the response when the step ends, after the codec's closing record: `RUN_FINISHED` in
  AG-UI, `message_stop` from Anthropic.
- A failure before the stream starts should render as a normal Hoist error, a non-2xx status with
  an exception body. The chat then gets a `FetchException` with the server's details.
- A failure mid-stream should go out as an error record, such as `RUN_ERROR` in AG-UI or an
  Anthropic `error` event. The chat shows it as the turn's error, with its code, and does not
  report it as an exception. Hoist's unparseable last line, as `renderNDJSON` writes it, also
  ends the turn. But `fetchNdjson` then throws a generic failure, which Hoist reports as a client
  error.
- It should stop work when the client disconnects. The transport closes the connection when the
  user stops the turn.
- During a long silence it may send `{"type": "xh.heartbeat"}` lines, which reset
  `idleTimeout` and are never decoded.

### SseChatTransport

- The endpoint receives a POST with a JSON body, the request as encoded by the codec, and an
  `Accept: text/event-stream` header. With the default `AgUiCodec`, the body is an AG-UI
  `RunAgentInput`, as AG-UI's HTTP agents expect.
- It responds with `text/event-stream`. The `data` of each event is one JSON record in the
  codec's format. The transport passes the `event` name to the codec with the data.
- The transport skips comments, which serve as keep-alives, the `[DONE]` sentinel, and data that
  is not JSON. Any data, a comment included, resets `idleTimeout`.
- It ends the response when the step ends, after the codec's closing record, and it should stop
  work when the client disconnects.

### ScriptedChatTransport

No server. Each step takes the next response from `responses`, or the result of `respond`. A
request past the end of `responses` fails with `ScriptedChatTransport has no response for request
<n>.`. The transport stops at once, with an abort error, when the request's signal aborts. The
`userMessage` and `attempt` of its `respond` context follow the request's `turnId`.

## Hoist Server Example

This hoist-core controller and service relay the Anthropic Messages API as NDJSON, one Anthropic
stream event per line, flushed per line. Pair it with `HoistChatTransport` and `AnthropicCodec`.
It follows the Toolbox implementation in
`grails-app/controllers/io/xh/toolbox/llm/LlmController.groovy` and
`grails-app/services/io/xh/toolbox/llm/LlmService.groovy`.

### Why not `renderNDJSON`

`BaseController.renderNDJSON` suits large row sets. It wraps the output in a large
`BufferedOutputStream`. It flushes after the first row, then each time the buffer fills, and at the
end. That batching is right for a grid load. For a token stream, it holds back most of the reply
until the buffer fills, so the user sees text in bursts. It also takes an `Iterable` or `Iterator`,
but tokens arrive through a callback from the upstream HTTP client.

So the controller writes each line and flushes it itself. The response commits on the first
line, so a failure before then renders a normal Hoist error response, and the client throws it as
a `FetchException`. A routine exception, such as a rate limit, keeps its `isRoutine` flag, so
Hoist logs it quietly rather than as a client error. A failure after the first line ends the
stream with an Anthropic `error` event instead. The chat shows that as the turn's error, with
Retry, and never reports it as an exception.

Each stream holds a Tomcat request thread, and a connection to Anthropic, for its whole length. Size
the HTTP client's pool for the streams you expect at once. Give it a short wait for a connection, so
that a full pool fails fast rather than queue.

### Controller

```groovy
package com.example.myapp.chat

import io.xh.hoist.BaseController
import io.xh.hoist.json.JSONSerializer
import io.xh.hoist.security.AccessRequiresRole

import static java.nio.charset.StandardCharsets.UTF_8

@AccessRequiresRole('CHAT_USER')   // An example role - use your app's own
class ChatController extends BaseController {

    def chatService

    /**
     * POST /chat/stream
     * Body: an Anthropic Messages request body, as built by AnthropicCodec.
     * Returns: NDJSON - one Anthropic stream event per line, flushed as each arrives.
     */
    def stream() {
        def body = parseRequestJSON()
        if (!body.messages) throw new RuntimeException('messages array is required.')

        response.contentType = 'application/x-ndjson'
        response.characterEncoding = 'UTF-8'
        // Ask an nginx proxy not to buffer the stream.
        response.setHeader('X-Accel-Buffering', 'no')

        OutputStream out = null
        try {
            chatService.stream(body, authUsername) { String event ->
                try {
                    out = out ?: response.outputStream
                    out.write((event + '\n').getBytes(UTF_8))
                    out.flush()
                    return true
                } catch (IOException ignored) {
                    // The client disconnected or stopped the turn - tell the service to stop.
                    return false
                }
            }
        } catch (Throwable t) {
            // Before the first line, Hoist renders the exception as a normal error response.
            if (!response.committed) throw t

            // After it, end the stream with an Anthropic error event, which the chat shows as the
            // turn's error. The response is committed, so there is nothing more to render.
            logWarn('Chat stream failed after it started', t.message)
            def error = [type: 'error', error: [type: 'api_error', message: 'The reply failed. Try again.']]
            try {
                out.write((JSONSerializer.serialize(error) + '\n').getBytes(UTF_8))
                out.flush()
            } catch (Throwable ignored) {}
        }
    }
}
```

### Service

```groovy
package com.example.myapp.chat

import io.xh.hoist.BaseService
import io.xh.hoist.config.ConfigService
import io.xh.hoist.exception.DataNotAvailableException
import io.xh.hoist.exception.ExternalHttpException
import io.xh.hoist.exception.RoutineRuntimeException
import io.xh.hoist.json.JSONSerializer
import org.apache.hc.client5.http.classic.methods.HttpPost
import org.apache.hc.client5.http.config.RequestConfig
import org.apache.hc.client5.http.impl.classic.CloseableHttpClient
import org.apache.hc.client5.http.impl.classic.CloseableHttpResponse
import org.apache.hc.client5.http.impl.classic.HttpClients
import org.apache.hc.client5.http.impl.io.PoolingHttpClientConnectionManagerBuilder
import org.apache.hc.core5.http.io.entity.StringEntity
import org.apache.hc.core5.util.Timeout

import static io.xh.hoist.util.StringUtils.elide
import static java.nio.charset.StandardCharsets.UTF_8

/**
 * Relays the Anthropic Messages API as a token stream. The API key lives in the `chatApiKey`
 * config, so it never reaches the client.
 *
 * The browser builds the request body, so the service treats it as untrusted. It forwards only
 * `system`, `messages`, `tools` and `tool_choice`, rejects any other key, and sets `model`,
 * `max_tokens` and `stream` itself. It accepts only client tools, which have no `type`, and caps
 * the size of the body.
 */
class ChatService extends BaseService {

    ConfigService configService

    // A raw client, as JSONClient reads the whole response. The response timeout bounds each
    // read, not the whole stream - Anthropic sends `ping` events. Compression is off, as a
    // compressed stream can be buffered along the way. The pool allows 50 streams at once, and a
    // request that finds it full waits at most 5 seconds.
    private final CloseableHttpClient streamClient = HttpClients.custom()
        .disableContentCompression()
        .setConnectionManager(
            PoolingHttpClientConnectionManagerBuilder.create()
                .setMaxConnPerRoute(50)
                .setMaxConnTotal(50)
                .build()
        )
        .setDefaultRequestConfig(
            RequestConfig.custom()
                .setResponseTimeout(Timeout.ofMinutes(2))
                .setConnectionRequestTimeout(Timeout.ofSeconds(5))
                .build()
        )
        .build()

    /**
     * Stream a response, passing the JSON `data` of each Anthropic SSE event to `onEvent`.
     * Throws before the first event for a missing key or a rejected request. `onEvent` returns
     * false to stop, which aborts the upstream call, so no more tokens are generated or billed.
     */
    void stream(Map request, String username, Closure<Boolean> onEvent) {
        def key = configService.getPwd('chatApiKey')
        if (!key?.trim()) throw new DataNotAvailableException('Chat API key not configured.')

        def json = JSONSerializer.serialize(createBody(request))
        if (json.length() > MAX_BODY_CHARS) {
            throw new RoutineRuntimeException('This conversation is too large to send. Clear it to start again.')
        }

        def post = new HttpPost('https://api.anthropic.com/v1/messages')
        post.setHeader('Content-Type', 'application/json')
        post.setHeader('x-api-key', key)
        post.setHeader('anthropic-version', '2023-06-01')
        post.setEntity(new StringEntity(json, UTF_8))

        CloseableHttpResponse response = null
        boolean complete = false
        try {
            response = streamClient.execute(post)
            if (response.code == 429 || response.code == 529) {
                // Busy or rate limited - routine, so not logged or reported as an error.
                throw new RoutineRuntimeException('The model is busy - try again in a minute.')
            }
            if (response.code != 200) {
                // Not passed through as is - an upstream 401 would read as a Hoist auth failure.
                def detail = elide(response.entity?.content?.getText('UTF-8') ?: '', 500)
                logError("Chat API call failed with status ${response.code}", detail)
                throw new ExternalHttpException('The chat service failed.', null, 502)
            }
            complete = relayEvents(response, onEvent)
            if (!complete) logInfo("Client disconnected - aborted stream for $username")
        } finally {
            // Abort rather than drain - closing an unread response reads it to the end.
            if (!complete) post.abort()
            try { response?.close() } catch (Exception ignored) {}
        }
    }

    /** The body to send upstream - the client's allowed keys, plus the server's own settings. */
    private Map createBody(Map request) {
        // A codec may send `model`, `max_tokens` and `stream`. The server sets them itself.
        def disallowed = request.keySet() - CLIENT_KEYS - ['model', 'max_tokens', 'stream']
        if (disallowed) {
            throw new RoutineRuntimeException("Request key(s) not accepted: ${disallowed.join(', ')}.")
        }
        if (!request.messages) throw new RoutineRuntimeException('Request has no messages.')

        // Server tools, such as web search or code execution, carry a `type`. They cost extra and
        // reach other systems, so only the server may add them.
        if ((request.tools ?: []).any { it.type }) {
            throw new RoutineRuntimeException('Request includes server tools, which are not accepted.')
        }

        return request.subMap(CLIENT_KEYS) + [
            model     : configService.getString('chatModel'),
            max_tokens: configService.getInt('chatMaxTokens'),
            stream    : true
        ]
    }

    /** Parse the SSE stream. Returns true if it ended normally, false if `onEvent` stopped it. */
    private boolean relayEvents(CloseableHttpResponse response, Closure<Boolean> onEvent) {
        def reader = new BufferedReader(new InputStreamReader(response.entity.content, UTF_8)),
            data = new StringBuilder()
        String line
        while ((line = reader.readLine()) != null) {
            if (line.startsWith('data:')) {
                // Join multi-line data with a space, to keep one event per NDJSON line.
                if (data) data.append(' ')
                data.append(line.substring(5).trim())
            } else if (!line && data) {
                // A blank line ends the event. Each data payload carries its own `type`.
                if (!onEvent(data.toString())) return false
                data.setLength(0)
            }
        }
        return !data || onEvent(data.toString())
    }

    @Override
    void destroy() {
        streamClient.close()
        super.destroy()
    }

    /** Request keys forwarded from the client. */
    private static final List<String> CLIENT_KEYS = ['system', 'messages', 'tools', 'tool_choice']

    private static final int MAX_BODY_CHARS = 4_000_000
}
```

The browser builds the request body, so the service treats it as untrusted. It builds the
upstream body from an allowlist, rejects tools the client should not choose, and caps the size.
Add checks for anything else that costs money or reaches other systems. The Toolbox service also
caps the number of messages, adds a per-user rate limit, and takes other request params, such as
`thinking`, and any server tools only from config.

Gate the endpoint by role, as `@AccessRequiresRole` does above, so that only the users meant to
reach the model can. If the server relays to an agent service of your own rather than to
Anthropic, it forwards who the user is: the server sets the identity headers on the upstream call,
from the authenticated Hoist user. They never come from the browser, which could set any value.

If tokens still arrive in bursts, check each layer between the server and the browser for
buffering or compression. Watch the response in the browser's network panel to confirm that
lines arrive one at a time.

## Properties/API Reference

See `ChatEvent.ts`, `ChatTransport.ts`, `ChatCodec.ts`, `HttpChatTransport.ts`,
`ScriptedChatTransport.ts` and the files in `codec/` for the full doc comments.

### HttpChatTransportConfig

Shared by `HoistChatTransport` and `SseChatTransport`.

| Property | Type | Description |
|----------|------|-------------|
| `url` | `string \| (request) => Awaitable<string>` | Endpoint to post to, or a function that builds it per request. Relative URLs resolve against `XH.baseUrl`. Required. |
| `codec` | `ChatCodec` | Encodes requests and decodes records. Default a new `AgUiCodec`. |
| `headers` | `PlainObject \| (request) => Awaitable<PlainObject>` | Extra headers for each request, for example to authenticate with an agent server. A function builds them per request, for example to send a fresh token, or the `threadId` and `runId` so the server can count turns rather than calls. |
| `params` | `PlainObject \| (request) => Awaitable<PlainObject>` | Query string parameters for each request, or a function that builds them per request. |
| `track` | `string \| TrackOptions` | Track each step with Hoist activity tracking, as `FetchOptions.track` does. |
| `timeout` | `PromiseTimeoutSpec` | Wait for the response to start. Default the `FetchService` default. No timeout applies once the response streams. |
| `idleTimeout` | `number` | Longest wait for data, in milliseconds, from the request to the first record and between records. Fails the step with code `stalled`. Default none. |
| `fetchOpts` | `PlainObject` | Options for the browser's `fetch`, such as `{credentials: 'omit'}` for a cross-origin backend. The transport's own `signal` wins. Default none. |
| `correlationId` | `boolean` | False to send no correlation id header, true to always send one. Default the `FetchService` default. |
| `cancelUrl` | `string \| (run) => Awaitable<string>` | Endpoint to post `{threadId, runId, turnId}` to when the user stops a run, with the `headers`, `params`, `fetchOpts` and `correlationId` of the stopped step. Default none. |

### AnthropicCodecConfig

| Property | Type | Description |
|----------|------|-------------|
| `system` | `AnthropicSystemPrompt \| (request) => Awaitable<AnthropicSystemPrompt>` | System prompt as text or text blocks, or a function that builds it per step. Takes precedence over `params.system`. |
| `model` | `string` | Model to call. Leave out if the server sets it. |
| `maxTokens` | `number` | Sent as `max_tokens`. Leave out if the server sets it. |
| `params` | `PlainObject` | Other body fields. Tools listed here go ahead of the chat's tools. Default `{}`. |
| `cacheControl` | `boolean` | True to mark cache breakpoints on the history, the last system block unless the app marks one, and the last tool, up to the limit of 4. Default false. |
| `prepareBody` | `(body, request) => Awaitable<PlainObject>` | Adjust the finished body. |

### ChatCompletionsCodecConfig

| Property | Type | Description |
|----------|------|-------------|
| `system` | `string \| (request) => Awaitable<string>` | System prompt, or a function that builds it per step. History system messages and live context follow it. |
| `model` | `string` | Model to call. Leave out if the server sets it. |
| `params` | `PlainObject` | Other body fields. Tools listed here go ahead of the chat's tools. Default `{}`. |
| `includeUsage` | `boolean` | True to send `stream_options: {include_usage: true}`. Default true. |
| `prepareBody` | `(body, request) => Awaitable<PlainObject>` | Adjust the finished body. |

### AgUiCodecConfig

| Property | Type | Description |
|----------|------|-------------|
| `context` | `AgUiContext[] \| (request) => AgUiContext[]` | Ambient information for the agent, as `{description, value}` items. The chat's live context follows these entries. Default none. |
| `forwardedProps` | `PlainObject \| (request) => PlainObject` | App values passed to the agent untouched. Default none. |
| `state` | `PlainObject \| (request) => PlainObject` | The agent's state, sent as `state`. Default `{}`. |
| `newMessagesOnly` | `boolean` | True to send only what the server has not seen, in server mode. Outside the AG-UI spec. See [Server-owned conversations](#server-owned-conversations). Default false. |

### ScriptedChatTransportConfig

| Property | Type | Description |
|----------|------|-------------|
| `responses` | `ScriptedResponse[]` | Response to each step, in order across all turns. |
| `respond` | `(request, context) => Awaitable<ScriptedResponse>` | Builds the response to each step, with a `ScriptedRequestContext` of `requestIndex`, `turnIndex`, `stepIndex`, `userMessage` and `attempt`. Use it or `responses`. |
| `delayMs` | `number` | Pause before each event, in milliseconds. Default 25. Use 0 in tests. |

### ChatEvent

The kit acts on these AG-UI 1.0 events. It accepts the rest and ignores them.

| Event | Fields used | Effect on the assistant message |
|-------|-------------|---------------------------------|
| `RUN_STARTED` | `threadId`, `runId` | Records `metadata.runId`. In server mode, the first run of a new thread may set the chat's `threadId`. |
| `RUN_FINISHED` | `outcome?`, `usage?`, `metadata?`, `result?` | Records `finishReason`, `usage` and any `metadata`. A `result.messageId` sets `metadata.serverId`, if no event set it. An `interrupt` outcome adds its interrupts to `metadata.interrupts`, and the reply pauses for the user. Marks the step complete. |
| `RUN_ERROR` | `message`, `code?`, `metadata?` | Fails the message, with `metadata.errorCode`. Records `metadata.retryAfterSeconds` if given. |
| `TEXT_MESSAGE_START` | `messageId` | Opens a text part on its first content, with the `messageId` as its `serverId`. |
| `TEXT_MESSAGE_CONTENT` | `messageId`, `delta` | Appends to the text part. |
| `TEXT_MESSAGE_END` | `messageId` | Marks the text part `done`. |
| `TEXT_MESSAGE_CHUNK` | `messageId?`, `delta?` | Opens or appends. |
| `REASONING_START`, `REASONING_MESSAGE_START` | `messageId` | Opens a reasoning part. Both ids map to one part. The `REASONING_MESSAGE_START` id is its `serverId`. |
| `REASONING_MESSAGE_CONTENT`, `REASONING_MESSAGE_CHUNK` | `messageId`, `delta` | Appends to the reasoning part. |
| `REASONING_MESSAGE_END` | `messageId` | Marks the reasoning part `done`. |
| `REASONING_END` | `messageId` | Marks every reasoning part of the step `done`. |
| `REASONING_ENCRYPTED_VALUE` | `subtype`, `entityId`, `encryptedValue` | Stores the signature on the reasoning part or the tool call. |
| `TOOL_CALL_START` | `toolCallId`, `toolCallName`, `parentMessageId?` | Adds a tool call in `input-streaming`, with the `parentMessageId` as its `parentServerId`. |
| `TOOL_CALL_ARGS` | `toolCallId`, `delta` | Appends to `inputText`, with a best-effort parse into `input`. |
| `TOOL_CALL_END` | `toolCallId` | Parses the input. `input-available`, or `output-error` for bad JSON. |
| `TOOL_CALL_CHUNK` | `toolCallId?`, `toolCallName?`, `delta?` | Starts or appends. |
| `TOOL_CALL_RESULT` | `toolCallId`, `messageId`, `content`, `metadata?` | `output-available`, with `providerExecuted: true` and the `messageId` as `resultServerId`. JSON content is parsed. `output-error` if `metadata.error` or `metadata.isError` is set. |
| `ACTIVITY_SNAPSHOT` | `messageId`, `activityType`, `content`, `replace?` | Adds or replaces a data part, with `dataType` set to `activityType`. |
| `SUBAGENT_STARTED` | `subagentRunId`, `name`, `description?`, `parentSubagentRunId?` | Adds a data part of type `xh.chat.subagent`, with the run id as its id. Tool calls with the same `subagentRunId` nest under it in the activity timeline. |
| `SUBAGENT_FINISHED`, `SUBAGENT_ERROR` | `subagentRunId`, `result?` or `message`, `outcome?` | Ends the sub-agent's data part, with its result or error. A `suspended` outcome sets it `waiting` for the user, until a later run starts it again. |
| `CUSTOM` | `name`, `value` | The `xh.chat.*` events below. Others are ignored. |

A text, reasoning or tool call part keeps the `metadata` of its events, merged key by key, with
the last write winning, and `AgUiCodec` sends it back with the history. A reasoning span's
`REASONING_START` adds none. A result's metadata stays off its call.

Ignored: `STEP_STARTED`, `STEP_FINISHED`, `RAW`, `STATE_SNAPSHOT`, `STATE_DELTA`,
`MESSAGES_SNAPSHOT` and `ACTIVITY_DELTA`. `AgUiCodec` drops events of an unknown type, and expands
chunk events before the chat sees them.

When a stream ends, the chat closes the step. Open text and reasoning parts become `done`, and
tool calls that never saw `TOOL_CALL_END` get their input parsed.

### Kit events: `xh.chat.*`

Content that AG-UI has no event for travels as a `CUSTOM` event with a name that starts with
`xh.chat.`.

| `name` | `value` | Effect |
|--------|---------|--------|
| `xh.chat.source` | `{id?, sourceType?, url?, title?, snippet?, marker?, metadata?}` | Appends a source part. `marker` is the number that cites it in the text, as in `[1]`. `sourceType` is `url` for a web page or `document` for a document of the app's own. It defaults to `url` for a source with a `url`, else `document`. |
| `xh.chat.citation` | `{id?, title?, url?, citedText?, sourceId?}` | Adds a citation to the open text part, or else the last one. |
| `xh.chat.data` | `{id?, dataType, data}` | Adds a data part, or replaces the one with the same `id`. The `dataType` `xh.chat.noAnswer` is reserved for a fixed "not found" reply, with `data` as `{documents?: [{id?, name}], documentCount?}`. |
| `xh.chat.file` | `{id?, name, mediaType, size?, url?, data?}` | Appends a file part. |
| `xh.chat.providerData` | `{subtype, entityId, data}` | Merges `data` into the `providerData` of a reasoning part or a tool call, by provider key. |
| `xh.chat.providerExecuted` | `{toolCallId}` | Marks a tool call as run by the backend, before its result arrives. |
| `xh.chat.toolError` | `{toolCallId, message}` | Fails a tool call the backend ran, in place of its result. `output-error`, with `message` as `errorText`. |
| `xh.chat.textReplace` | `{text}` | Sets the text of the open text part, or else of the reply's last text part. Adds a part if the reply has no text. `text: ''` resets the answer. |
| `xh.chat.message` | `{role, serverId}` | Records the server's id for the reply (`role: 'assistant'`) or the user message (`role: 'user'`), as `metadata.serverId`. |
| `xh.chat.artifact` | `{id, columns, rows?, totalRows, metadata?}` | Records a result set on the reply's `metadata.artifacts`, replacing one with the same `id`, and adds it to the chat's `artifacts`. A `TOOL_CALL_RESULT` with a list in `metadata.artifacts` does the same. See [Show data by reference](../genui/README.md#show-data-by-reference). |

A Hoist server that emits AG-UI events can send a data part like this:

```json
{"type": "CUSTOM", "name": "xh.chat.data", "value": {"dataType": "price-chart", "data": {"symbol": "XH"}}}
```

A codec for a document search that matched nothing sends the fixed reply in place of an answer:

```json
{"type": "CUSTOM", "name": "xh.chat.data", "value": {"dataType": "xh.chat.noAnswer", "data": {"documents": [{"name": "Reserves Policy"}], "documentCount": 4}}}
```

## Extension Points

### Write a custom transport

Implement `ChatTransport` for a backend that the HTTP transports do not cover, such as a
WebSocket or an SDK with its own client. `run()` must:

1. Yield `ChatEvent`s in arrival order, and end when the run ends.
2. Stop and settle at once when `request.signal` aborts. The signal's `reason` is a
   `ChatAbortError`, whose `reason` says why: `stop`, `detach`, `clear`, `load` or `destroy`.
3. Throw on a failure to connect. For a failure mid-stream, throw or yield `RUN_ERROR`.
4. End a complete run with `RUN_FINISHED`.

Implement `cancelAsync(run)` too if the backend keeps running after a disconnect. The chat calls
it when the user stops a step in flight, and logs a failure at warn level.

```typescript
import type {ChatEvent, ChatRunRequest, ChatTransport} from '@xh/hoist-chat-kit/transport';

export class AgentSdkTransport implements ChatTransport {
    constructor(private readonly client: AgentClient) {}

    async *run(request: ChatRunRequest): AsyncGenerator<ChatEvent> {
        const {threadId, runId, messages, signal} = request,
            prompt = findLast(messages, it => it.isUser)?.text,
            stream = this.client.stream({threadId, prompt, signal});

        yield {type: 'RUN_STARTED', threadId, runId};
        for await (const chunk of stream) {
            yield {type: 'TEXT_MESSAGE_CHUNK', messageId: runId, delta: chunk.text};
        }
        yield {type: 'RUN_FINISHED', threadId, runId, metadata: {finishReason: 'stop'}};
    }
}
```

To reuse the kit's HTTP handling with a new framing, extend `HttpChatTransport` and implement
`fetchRecords(opts)`. The base class owns the request body, the decoding and the cancellation.
Pass `opts.fetchOpts` through to the fetch, because it carries the signal that cancels the
stream.

### Write a custom codec

Implement `ChatCodec` to speak a new wire format over the existing transports. For example, a
codec for the OpenAI Responses API would encode the history as Responses input items and decode
its stream into `ChatEvent`s. See [Protocols](../docs/protocols.md#openai).

- `encodeRequest(request)` returns the body for one step. It can be async.
- `createDecoder(request)` returns a function for one step. The function takes a record and the
  SSE event name, if any, and returns zero or more events. It can hold state across the records
  of a step, such as block indexes. To hold events back until the stream ends, give the function
  a `flush()` that returns them. The HTTP transports call it after the last record.
- Send exactly one `RUN_FINISHED` per step.
- Map the provider's stop reason to the `finishReason` values, and keep the raw value as
  `metadata.stopReason`.
- Keep provider data that must go back with the history in `providerData`, under the provider's
  key, through `xh.chat.providerData` events. Read it back in `encodeRequest`.

## Common Pitfalls

### Sending through `renderNDJSON`

`renderNDJSON` buffers its output, so a token stream reaches the user in bursts. Write and flush
each line yourself, as the [Hoist Server Example](#hoist-server-example) does.

### Leaving the API key or model choice to the client

The browser builds the request body, and a user can change it. Keep the API key on the server.
Set or cap `model` and `max_tokens` there, and check any tools that the body declares.

### Ending a stream without a closing record

A server that closes the response without `RUN_FINISHED` or `message_stop` fails every turn with
`incomplete-stream`. Relay the closing record, or emit one.

### Reusing tool call ids

Tool call ids must be unique within a turn, across all its steps. An agent server that numbers
calls from 1 in each step loses every call after the first step.

### Capturing live state once in a codec option

The codec and its options live as long as the transport. Send live state through the chat's
`contextProviders`, which run before every step, or build it inside the `system`, `context` or
`forwardedProps` function, which also runs per step. Do not rebuild the transport to change the
prompt.

```typescript
// ✅ Do: Read live state in the function
new AnthropicCodec({system: () => buildPrompt(this.dashModel.spec)});

// ❌ Don't: Capture state once - the prompt never changes
new AnthropicCodec({system: buildPrompt(this.dashModel.spec)});
```

## Related Packages

- [`/core/`](../core/README.md) - `ChatModel`, messages, parts and tools
- [`/desktop/cmp/chat/`](../desktop/cmp/chat/README.md) - desktop components
- [Architecture](../docs/architecture.md) - layers and the flow of one turn
- [Protocols](../docs/protocols.md) - AG-UI, Anthropic, OpenAI, generative UI and the Vercel AI
  SDK vocabulary
- hoist-react `/svc/` - `FetchService`, `fetchNdjson`, `FetchOptions` and `FetchException`
