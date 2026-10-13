# Architecture

This doc describes the structure of Hoist Chat Kit. It covers the layers and the flow of one turn
from the composer to the rendered parts. It also covers render performance, and where an app
plugs in.

## Layers

The kit has three layers. Each layer depends only on the layers below it.

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Components          desktop/cmp/chat/     cmp/markdown/                  │
│                     ChatPanel, ChatMessageList, ChatMessageView,         │
│                     ChatComposer, ChatToolCall, ChatReasoning, ...       │
│                     Render the models. Never see a wire format.          │
├──────────────────────────────────────────────────────────────────────────┤
│ Models              core/                                                │
│                     ChatModel, ChatComposerModel, ChatMessage, ChatPart, │
│                     ChatToolSpec. Own the state and the turn loop.       │
│                     Platform-neutral.                                    │
├──────────────────────────────────────────────────────────────────────────┤
│ Transports, codecs  transport/                                           │
│                     HoistChatTransport, SseChatTransport,                │
│                     ScriptedChatTransport, AgUiCodec, AnthropicCodec.    │
│                     Turn a backend's stream into ChatEvents.             │
└──────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
        hoist-core endpoint, AG-UI agent server, or a scripted demo
```

- **Transports and codecs** carry the request to a backend and turn its stream into
  `ChatEvent`s, which are AG-UI 1.0 events. A transport owns the framing, such as NDJSON or SSE.
  A codec owns the format, such as AG-UI or the Anthropic Messages API. See
  [`/transport/`](../transport/README.md).
- **Models** hold the conversation. `ChatModel` runs each turn, applies the events to immutable
  `ChatMessage` records, and runs client tools. See [`/core/`](../core/README.md).
- **Components** render the models with Hoist components and element factories. The desktop
  components live in [`/desktop/cmp/chat/`](../desktop/cmp/chat/README.md). The streaming
  markdown renderer is platform-neutral, in [`/cmp/markdown/`](../cmp/markdown/README.md).

The kit owns its message model. No component sees a provider's or a protocol's wire format, so
protocol churn stops at the codec. See [Protocols](./protocols.md) for how each protocol maps
onto the model.

## The Flow of One Turn

This is what happens when the user types a question and presses Enter.

```
ChatComposer            Enter key
     │
     ▼
ChatComposerModel       submitAsync() - canSend?
     │
     ▼
ChatModel.sendAsync()   1. Append the user message and an empty assistant message
     │                  2. Clear the draft. status = 'submitted'
     ▼
ChatModel (step loop)   3. Build a ChatRunRequest: threadId, runId, messages, tools, signal
     │
     ▼
HttpChatTransport       4. codec.encodeRequest(request) - the JSON body
     │                  5. POST through Hoist's FetchService
     ▼
Backend                 6. Streams records: NDJSON lines or SSE events
     │
     ▼
ChatCodec decoder       7. Each record becomes zero or more ChatEvents
     │
     ▼
ChatModel               8. Buffer events. Flush at most every 32 ms, in one MobX action
     │
     ▼
ChatStreamReducer       9. Apply the batch: a new ChatMessage, new objects for changed parts
     │
     ▼
ChatModel.messages      10. Replace the message in the array. status = 'streaming'
     │
     ▼
ChatMessageList         11. Re-render the changed message
ChatMessageView             and, within it, only the changed parts
```

When the stream ends, the chat looks at the step's tool calls:

1. If the step made no client tool calls, the turn is complete. The message becomes `complete`,
   the chat records `metadata.elapsedMs`, and `onTurnComplete` runs.
2. If a call needs approval, or waits on an interactive tool, the turn pauses. The message
   becomes `paused`, and the chat becomes `ready` until the user answers.
3. Otherwise the chat runs each client tool's `execute` in order. It then starts the next step,
   back at item 3 of the diagram, with the tool results in the history.

A turn ends early on a `RUN_ERROR`, a thrown error, or `stop()`. Content received so far stays.
The chat closes any open part, so the history stays valid for the next request. See
[Turns and steps](../core/README.md#turns-and-steps) for the full rules.

Only one turn runs at a time. The chat guards against a second send with a plain field, not with
MobX state, so two sends in the same tick cannot both start.

## Immutable Messages and Render Performance

A long reply streams thousands of small deltas. The kit keeps that cheap in three ways.

### Immutable records

`ChatModel.messages` is an `@observableRef` array of immutable `ChatMessage` objects, after the
Hoist `StoreRecord` model. Each change makes a new message, and new objects for only the parts
that changed. The other parts keep their identity.

Hoist components are memoized by default. A message view whose `message` prop did not change
skips its render. Within the message that changed, a text or reasoning part whose props did not
change skips its render too. While a reply streams, the earlier messages and the finished text of
the last message do not re-render.

Plain records also serialize with no extra code. `getMessageSpecs()` returns them as JSON for
storage, and `loadMessages()` restores them.

### Flush batching

The chat does not apply each event as it arrives. It buffers events and applies them together,
at most once every 32 milliseconds, in one MobX action. A fast stream of hundreds of events per
second then causes a few dozen renders per second at most. The reducer parses streaming tool
arguments once per batch, not once per fragment.

### Memoized markdown blocks

`ChatMarkdown` splits streaming text into top-level blocks, such as paragraphs, lists and code
fences. Finished blocks render once and stay memoized. Only the last block re-renders as text
arrives, with any open syntax closed, such as an unterminated code fence or `**`. When the part
is done, the full text renders as one document, so footnotes and reference links resolve.

## Where an App Plugs In

| Seam | Where | Use it to |
|------|-------|-----------|
| Tools | `ChatModelConfig.tools`, as `ChatToolSpec[]` | Let the model act on the app, ask the user, or display backend tool calls |
| Tool display | `displayName`, `icon`, `summary`, `renderer` on `ChatToolSpec` | Show a tool call as a custom card body, such as a chart or a form |
| Approvals | `needsApproval` on `ChatToolSpec` | Ask the user before a tool runs |
| Data renderers | `ChatModelConfig.dataRenderers` | Render app content and generative UI from data parts, by `dataType` |
| Transports | `ChatModelConfig.transport` | Connect to any backend, or implement `ChatTransport` |
| Codecs | `HttpChatTransportConfig.codec` | Speak a new wire format, or implement `ChatCodec` |
| Live context | `system` on `AnthropicCodec`, `context` on `AgUiCodec` | Describe the app's current state to the model before each step |
| Lifecycle | `onTurnComplete`, observable `status` and `lastError` | Save history, show toasts, react to errors |
| Component slots | `ChatPanel` and `ChatComposer` props | Add header buttons, composer toolbars, an empty state and suggestions |
| Markdown | `markdownComponents` on the message list | Replace how markdown elements render, such as code blocks |
| Theme | `--xh-chat-*` CSS variables | Change colors, widths and radii, with light and dark defaults |

The component slots and the theme variables are covered in
[`/desktop/cmp/chat/`](../desktop/cmp/chat/README.md).

## Platform Split

The kit ships desktop components now. `core/`, `transport/` and `cmp/` import nothing from
`@xh/hoist/desktop`. A mobile package, `mobile/cmp/chat`, can follow with no change to the
models, the transports or the markdown renderer.

| Package | Platform | Contents |
|---------|----------|----------|
| `core/` | Neutral | Models, messages, parts and tools |
| `transport/` | Neutral | Transports, codecs and events |
| `cmp/markdown/` | Neutral | The streaming markdown renderer |
| `desktop/cmp/chat/` | Desktop | Panel, message list, composer, tool cards and the rest |
| `styles/` | Neutral | The `--xh-chat-*` CSS variables |

App code follows the same split. Put tool specs, prompts and data renderers in shared code when
they render with neutral components. Put a `renderer` that uses desktop buttons or inputs in
desktop code.

## Related

- [`/core/`](../core/README.md) - `ChatModel`, messages, parts and tools
- [`/transport/`](../transport/README.md) - transports, codecs and server contracts
- [`/desktop/cmp/chat/`](../desktop/cmp/chat/README.md) - desktop components
- [`/cmp/markdown/`](../cmp/markdown/README.md) - streaming markdown
- [Protocols](./protocols.md) - AG-UI, Anthropic, generative UI and the Vercel AI SDK vocabulary
