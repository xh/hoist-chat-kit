# Transport Package

| Section | Description |
|---------|-------------|
| [Overview](#overview) | How the chat gets events from a backend, and the key features |
| [Architecture](#architecture) | Transports, codecs, `ChatEvent`, and how they fit together |
| [Configuration Pattern](#configuration-pattern) | Choosing and configuring a transport and a codec |
| [Common Usage Patterns](#common-usage-patterns) | Hoist servers, Anthropic, AG-UI agents, scripted demos and tests |
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
  1.0 events with the same type strings and field names. Any AG-UI agent server works with the
  kit, with no adapter.
- **Transports carry, codecs translate** - the framing (NDJSON or Server-Sent Events) and the
  format (AG-UI or Anthropic) vary on their own. Pick one of each.
- **`HoistChatTransport`** - NDJSON from your own hoist-core server, through `XH.fetchNdjson`,
  with Hoist's auth headers, correlation IDs, tracing, activity tracking and error handling.
- **`SseChatTransport`** - Server-Sent Events (SSE) from an AG-UI agent server or an SSE proxy.
- **`AnthropicCodec`** - lets a server relay Claude's stream line by line, with nothing to
  translate. The kit translates the stream in tested TypeScript.
- **`ScriptedChatTransport`** - canned events with realistic pacing, for demos and unit tests.
- **Real cancellation** - a stop closes the HTTP connection, so the server can stop generating
  tokens.

## Architecture

```
ChatTransport (interface)
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
├── AgUiCodec                                   # AG-UI RunAgentInput, events pass through
└── AnthropicCodec                              # Messages API body, Anthropic stream events

ChatRunRequest
├── threadId, runId                             # Conversation and step ids
├── messages: ChatMessage[]                     # History, ending with the reply being built
├── tools: ChatToolSpec[]                       # Tools to send to the model
└── signal: AbortSignal                         # Aborts the step
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
    timeout: 60_000                                      // Until the response starts
});
```

## Common Usage Patterns

### Relay Claude through a Hoist server

This is the default for a Hoist app. The server holds the API key, and the browser builds the
Messages API body.

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
- **`cacheControl`** - true to put a prompt cache breakpoint on the last system block and on the
  last tool. Anthropic then caches the tools and the system prompt across the steps and turns of
  a chat.
- **`prepareBody`** - a function that adjusts the finished body before it goes out. It can be
  async.

A cache breakpoint caches everything before it, so it pays off only when that content repeats.
If your system prompt ends with live state, return blocks from `system` with the static part
first, and mark that block with `cache_control` yourself. The codec leaves a block that already
has a mark alone.

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
citations. It also decodes server tool calls, such as web search, with their results. It keeps the data
that must go back to Anthropic unchanged, such as redacted thinking and server tool result
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

**Not yet supported:** a turn that continues after a `pause_turn` response. The API pauses a long server
tool loop and expects the client to send the paused turn back. The kit ends the turn at the pause.

### Connect to an AG-UI agent server

```typescript
import {AgUiCodec, SseChatTransport} from '@xh/hoist-chat-kit/transport';

new ChatModel({
    transport: new SseChatTransport({
        url: 'https://agents.example.com/portfolio',
        headers: {Authorization: `Bearer ${token}`},
        codec: new AgUiCodec({
            context: () => [{description: 'Selected sector', value: this.selectedSector}],
            forwardedProps: {tenant: 'emea'}
        })
    })
});
```

`AgUiCodec` sends each step as an AG-UI `RunAgentInput`:

```
{threadId, runId, protocolVersion: '1.0', state: {}, messages, tools, context, forwardedProps}
```

User messages carry their text as `content`, or a list of text, image, audio, video and document
parts when they have attachments. Each step of an assistant turn becomes three kinds of message:
a `reasoning` message per reasoning part, an `assistant` message with its text and its finished
`toolCalls`, and a `tool` message per call result. A failed or denied call also carries `error`. Tools go out as
`{name, description, parameters}`. `context` and `forwardedProps` take a value, or a function
that builds the value for each step.

Decoding passes each record through as a `ChatEvent`. The decoder drops records of an unknown
`type`.

### Script a demo or a test

`ScriptedChatTransport` plays back events with no backend. Give it one response per step, in
order across all turns, or a `respond` function that reacts to the request. It adds the
`RUN_STARTED` and `RUN_FINISHED` events where a response leaves them out.

```typescript
import {
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
            sourceEvents([{url: 'https://example.com/paris', title: 'Paris forecast'}]),
            dataEvents('weather-card', {city: 'Paris', tempC: 18})
        ]
    ]
});
```

A `respond` function suits a demo that the user can type into:

```typescript
import {findLast} from 'lodash';

new ScriptedChatTransport({
    respond: (request, requestIndex) => {
        const question = findLast(request.messages, it => it.isUser)?.text ?? '';
        return [textEvents(`You asked: _${question}_. This demo has no model behind it.`)];
    }
});
```

The helpers are `textEvents()`, `reasoningEvents()`, `toolCallEvents()`, `sourceEvents()`,
`dataEvents()`, `errorEvents()` and `scriptedDelay()`. Pass a `result` to `toolCallEvents()` to
simulate a tool that the backend runs. A response can also be an async iterable of events, which
sets its own pace.

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

## Server Contracts

### Events, for every backend

These rules apply to any backend, whatever the transport and codec. They are stated as AG-UI
events. The `AnthropicCodec` produces them from Anthropic's stream.

- A step is one AG-UI run, from `RUN_STARTED` to `RUN_FINISHED` or `RUN_ERROR`. AG-UI's own
  `STEP_STARTED` and `STEP_FINISHED` mark stages within a run. The kit ignores them.
- A stream that ends with neither `RUN_FINISHED` nor `RUN_ERROR` fails the turn, with error code
  `incomplete-stream`.
- After `RUN_ERROR`, the chat stops reading. The `message` shows to the user, and the `code`
  becomes `ChatRunError.code`.
- Tool call ids must be unique within a turn. A tool call part takes its id, and the chat ignores
  a second `TOOL_CALL_START` with an id already used in the turn. Text message ids can repeat from
  one step to the next.
- A tool that the backend runs must send its result as `TOOL_CALL_RESULT` in the same step.
  Otherwise the chat fails the call, or runs it if a client tool has the same name. Send
  `xh.chat.providerExecuted` to mark a call as the backend's before its result arrives.
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
  Anthropic `error` event. Hoist's unparseable last line, as `renderNDJSON` writes it, also works.
  `fetchNdjson` then throws, and the turn fails.
- It should stop work when the client disconnects. The transport closes the connection when the
  user stops the turn.

### SseChatTransport

- The endpoint receives a POST with a JSON body, the request as encoded by the codec, and an
  `Accept: text/event-stream` header. With the default `AgUiCodec`, the body is an AG-UI
  `RunAgentInput`, as AG-UI's HTTP agents expect.
- It responds with `text/event-stream`. The `data` of each event is one JSON record in the
  codec's format. The transport passes the `event` name to the codec with the data.
- The transport skips comments, which serve as keep-alives, the `[DONE]` sentinel, and data that
  is not JSON.
- It ends the response when the step ends, after the codec's closing record, and it should stop
  work when the client disconnects.

### ScriptedChatTransport

No server. Each step takes the next response from `responses`, or the result of `respond`. A
request past the end of `responses` fails with `ScriptedChatTransport has no response for request
<n>.`. The transport stops at once, with an abort error, when the request's signal aborts.

## Hoist Server Example

This hoist-core controller and service relay the Anthropic Messages API as NDJSON, one Anthropic
stream event per line, flushed per line. Pair it with `HoistChatTransport` and `AnthropicCodec`.
It follows the Toolbox implementation in `grails-app/controllers/io/xh/toolbox/llm/LlmController.groovy`
and `grails-app/services/io/xh/toolbox/llm/LlmService.groovy`.

### Why not `renderNDJSON`

`BaseController.renderNDJSON` suits large row sets. It wraps the output in a large
`BufferedOutputStream`. It flushes after the first row, then each time the buffer fills, and at
the end. That batching is
right for a grid load. For a token stream, it holds back most of the reply until the buffer
fills, so the user sees text in bursts. It also takes an `Iterable` or `Iterator`, but tokens
arrive through a callback from the upstream HTTP client.

So the controller writes each line and flushes it itself. It keeps the same error contract as
`renderNDJSON`. The response commits on the first line, so a failure before then renders a normal
error response. A failure after that ends the stream with a line that is not JSON, which makes
`XH.fetchNdjson` throw.

### Controller

```groovy
package com.example.myapp.chat

import io.xh.hoist.BaseController
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
            // Once committed, end with a line that is not JSON, so the client sees a failure.
            if (response.committed) {
                try {
                    out.write(NDJSON_POISON.getBytes(UTF_8))
                    out.flush()
                } catch (Throwable ignored) {}
            }
            throw t
        }
    }

    /** The line that hoist-core's `renderNDJSON` writes on failure, which `fetchNdjson` rejects. */
    private static final String NDJSON_POISON = '//xh-ndjson-stream-error'
}
```

### Service

```groovy
package com.example.myapp.chat

import io.xh.hoist.BaseService
import io.xh.hoist.config.ConfigService
import io.xh.hoist.exception.DataNotAvailableException
import io.xh.hoist.json.JSONSerializer
import org.apache.hc.client5.http.classic.methods.HttpPost
import org.apache.hc.client5.http.config.RequestConfig
import org.apache.hc.client5.http.impl.classic.CloseableHttpClient
import org.apache.hc.client5.http.impl.classic.CloseableHttpResponse
import org.apache.hc.client5.http.impl.classic.HttpClients
import org.apache.hc.core5.http.io.entity.StringEntity
import org.apache.hc.core5.util.Timeout

import static io.xh.hoist.util.StringUtils.elide
import static java.nio.charset.StandardCharsets.UTF_8

/**
 * Relays the Anthropic Messages API as a token stream. The API key lives in the `chatApiKey`
 * config, so it never reaches the client. The server also sets the model and token limit.
 */
class ChatService extends BaseService {

    ConfigService configService

    // A raw client, as JSONClient reads the whole response. The response timeout bounds each
    // read, not the whole stream - Anthropic sends `ping` events. Compression is off, as a
    // compressed stream can be buffered along the way.
    private final CloseableHttpClient streamClient = HttpClients.custom()
        .disableContentCompression()
        .setDefaultRequestConfig(RequestConfig.custom().setResponseTimeout(Timeout.ofMinutes(2)).build())
        .build()

    /**
     * Stream a response, passing the JSON `data` of each Anthropic SSE event to `onEvent`.
     * Throws before the first event for a missing key or a rejected request. `onEvent` returns
     * false to stop, which aborts the upstream call, so no more tokens are generated or billed.
     */
    void stream(Map request, String username, Closure<Boolean> onEvent) {
        def key = configService.getPwd('chatApiKey')
        if (!key?.trim()) throw new DataNotAvailableException('Chat API key not configured.')

        def post = new HttpPost('https://api.anthropic.com/v1/messages')
        post.setHeader('Content-Type', 'application/json')
        post.setHeader('x-api-key', key)
        post.setHeader('anthropic-version', '2023-06-01')
        post.setEntity(new StringEntity(JSONSerializer.serialize(request + [
            model     : configService.getString('chatModel'),
            max_tokens: configService.getInt('chatMaxTokens'),
            stream    : true
        ]), UTF_8))

        CloseableHttpResponse response = null
        boolean complete = false
        try {
            response = streamClient.execute(post)
            if (response.code != 200) {
                // Not passed through as is - an upstream 401 would read as a Hoist auth failure.
                def detail = elide(response.entity?.content?.getText('UTF-8') ?: '', 500)
                throw new RuntimeException("Chat API call failed with status ${response.code}: $detail")
            }
            complete = relayEvents(response, onEvent)
            if (!complete) logInfo("Client disconnected - aborted stream for $username")
        } finally {
            // Abort rather than drain - closing an unread response reads it to the end.
            if (!complete) post.abort()
            try { response?.close() } catch (Exception ignored) {}
        }
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
}
```

The browser builds the request body, so treat it as untrusted. The service above sets `model`,
`max_tokens` and `stream` itself. Add checks for anything else that costs money or reaches other
systems, such as server tools in `tools`. The Toolbox service also adds a per-user rate limit.

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
| `url` | `string` | Endpoint to post to. Relative URLs resolve against `XH.baseUrl`. Required. |
| `codec` | `ChatCodec` | Encodes requests and decodes records. Default a new `AgUiCodec`. |
| `headers` | `PlainObject` | Extra headers for each request, for example to authenticate with an agent server. |
| `params` | `PlainObject` | Query string parameters for each request. |
| `track` | `string \| TrackOptions` | Track each step with Hoist activity tracking, as `FetchOptions.track` does. |
| `timeout` | `PromiseTimeoutSpec` | Wait for the response to start. Default the `FetchService` default. No timeout applies once the response streams. |

### AnthropicCodecConfig

| Property | Type | Description |
|----------|------|-------------|
| `system` | `AnthropicSystemPrompt \| (request) => Awaitable<AnthropicSystemPrompt>` | System prompt as text or text blocks, or a function that builds it per step. Takes precedence over `params.system`. |
| `model` | `string` | Model to call. Leave out if the server sets it. |
| `maxTokens` | `number` | Sent as `max_tokens`. Leave out if the server sets it. |
| `params` | `PlainObject` | Other body fields. Tools listed here go ahead of the chat's tools. Default `{}`. |
| `cacheControl` | `boolean` | True to mark cache breakpoints on the last system block and the last tool. Default false. |
| `prepareBody` | `(body, request) => Awaitable<PlainObject>` | Adjust the finished body. |

### AgUiCodecConfig

| Property | Type | Description |
|----------|------|-------------|
| `context` | `AgUiContext[] \| (request) => AgUiContext[]` | Ambient information for the agent, as `{description, value}` items. Default none. |
| `forwardedProps` | `PlainObject \| (request) => PlainObject` | App values passed to the agent untouched. Default none. |

### ScriptedChatTransportConfig

| Property | Type | Description |
|----------|------|-------------|
| `responses` | `ScriptedResponse[]` | Response to each step, in order across all turns. |
| `respond` | `(request, requestIndex) => Awaitable<ScriptedResponse>` | Builds the response to each step. Use it or `responses`. |
| `delayMs` | `number` | Pause before each event, in milliseconds. Default 25. Use 0 in tests. |

### ChatEvent

The kit acts on these AG-UI 1.0 events. It accepts the rest and ignores them.

| Event | Fields used | Effect on the assistant message |
|-------|-------------|---------------------------------|
| `RUN_STARTED` | `threadId`, `runId` | None |
| `RUN_FINISHED` | `outcome?`, `usage?`, `metadata?` | Records `finishReason`, `usage` and any `metadata`. Marks the step complete. |
| `RUN_ERROR` | `message`, `code?` | Fails the message, with `metadata.errorCode`. |
| `TEXT_MESSAGE_START` | `messageId` | Opens a text part on its first content. |
| `TEXT_MESSAGE_CONTENT` | `messageId`, `delta` | Appends to the text part. |
| `TEXT_MESSAGE_END` | `messageId` | Marks the text part `done`. |
| `TEXT_MESSAGE_CHUNK` | `messageId?`, `delta?` | Opens or appends. |
| `REASONING_START`, `REASONING_MESSAGE_START` | `messageId` | Opens a reasoning part. Both ids map to one part. |
| `REASONING_MESSAGE_CONTENT`, `REASONING_MESSAGE_CHUNK` | `messageId`, `delta` | Appends to the reasoning part. |
| `REASONING_MESSAGE_END` | `messageId` | Marks the reasoning part `done`. |
| `REASONING_END` | `messageId` | Marks every reasoning part of the step `done`. |
| `REASONING_ENCRYPTED_VALUE` | `subtype`, `entityId`, `encryptedValue` | Stores the signature on the reasoning part or the tool call. |
| `TOOL_CALL_START` | `toolCallId`, `toolCallName` | Adds a tool call in `input-streaming`. |
| `TOOL_CALL_ARGS` | `toolCallId`, `delta` | Appends to `inputText`, with a best-effort parse into `input`. |
| `TOOL_CALL_END` | `toolCallId` | Parses the input. `input-available`, or `output-error` for bad JSON. |
| `TOOL_CALL_CHUNK` | `toolCallId?`, `toolCallName?`, `delta?` | Starts or appends. |
| `TOOL_CALL_RESULT` | `toolCallId`, `content` | `output-available`, with `providerExecuted: true`. JSON content is parsed. |
| `ACTIVITY_SNAPSHOT` | `messageId`, `activityType`, `content`, `replace?` | Adds or replaces a data part, with `dataType` set to `activityType`. |
| `CUSTOM` | `name`, `value` | The `xh.chat.*` events below. Others are ignored. |

Ignored: `STEP_STARTED`, `STEP_FINISHED`, `RAW`, `STATE_SNAPSHOT`, `STATE_DELTA`,
`MESSAGES_SNAPSHOT`, `ACTIVITY_DELTA`, and the `SUBAGENT_*` events. Unknown types never throw.

When a stream ends, the chat closes the step. Open text and reasoning parts become `done`, and
tool calls that never saw `TOOL_CALL_END` get their input parsed.

### Kit events: `xh.chat.*`

Content that AG-UI has no event for travels as a `CUSTOM` event with a name that starts with
`xh.chat.`.

| `name` | `value` | Effect |
|--------|---------|--------|
| `xh.chat.source` | `{id?, url?, title?, snippet?}` | Appends a source part. |
| `xh.chat.citation` | `{id?, title?, url?, citedText?, sourceId?}` | Adds a citation to the open text part, or else the last one. |
| `xh.chat.data` | `{id?, dataType, data}` | Adds a data part, or replaces the one with the same `id`. |
| `xh.chat.file` | `{id?, name, mediaType, size?, url?, data?}` | Appends a file part. |
| `xh.chat.providerData` | `{subtype, entityId, data}` | Merges `data` into the `providerData` of a reasoning part or a tool call, by provider key. |
| `xh.chat.providerExecuted` | `{toolCallId}` | Marks a tool call as run by the backend, before its result arrives. |

A Hoist server that emits AG-UI events can send a data part like this:

```json
{"type": "CUSTOM", "name": "xh.chat.data", "value": {"dataType": "price-chart", "data": {"symbol": "XH"}}}
```

## Extension Points

### Write a custom transport

Implement `ChatTransport` for a backend that the HTTP transports do not cover, such as a
WebSocket or an SDK with its own client. `run()` must:

1. Yield `ChatEvent`s in arrival order, and end when the run ends.
2. Stop and settle at once when `request.signal` aborts.
3. Throw on a failure to connect. For a failure mid-stream, throw or yield `RUN_ERROR`.
4. End a complete run with `RUN_FINISHED`.

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

Implement `ChatCodec` to speak a new wire format over the existing transports. For example, an
OpenAI codec would encode the history as OpenAI messages and decode the OpenAI stream into
`ChatEvent`s. See [Protocols](../docs/protocols.md#openai).

- `encodeRequest(request)` returns the body for one step. It can be async.
- `createDecoder(request)` returns a function for one step. The function takes a record and the
  SSE event name, if any, and returns zero or more events. It can hold state across the records
  of a step, such as block indexes.
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

The codec and its options live as long as the transport. Build live content inside the `system`,
`context` or `forwardedProps` function, which runs per step. Do not rebuild the transport to
change the prompt.

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
