# Component Helper Agents - Design Spec

Internal build spec for plan 2, work package 9 (decision D24). The lead owns it. Source: the use
case in `.tmp/hoist-chat-kit-feedback-1/use-case-4-component-helper-agents.md`, and the Toolbox
weather agent, which is the first working instance.

## 1. What a helper is

A small, optional assistant beside one complex Hoist component, such as a `Grid` or a
`DashCanvas`. The user says what they want ("group by sector and hide the id columns"), and the
helper changes the component through typed client tools. It runs the client-owned shape (D19):
client tools, approvals and a relayed model. It needs no threads and no workspace.

Rules:

- A helper is a no-op when no LLM backend is configured. Its button does not render.
- Tools act only on the model they were built for. Destructive tools need approval. Every change
  can be undone.
- The model never writes config that the app evaluates. The tools are the schema.
- The kit owns the tools and prompts. The enterprise owns the model and its configuration, once,
  on the server (bring your own LLM).

## 2. Core seams (platform-neutral)

### 2.1 Context providers

```ts
export interface ChatContextProvider {
    name: string;                          // 'grid', 'dashboard'
    description?: string;                  // what this context is, for the model
    getContext: (request: ChatRunRequest) => Awaitable<string | PlainObject>;
}
```

`ChatModelConfig.contextProviders` runs each provider at every step. `ChatRunRequest.context`
carries the results as `{name, description, value}`. `AgUiCodec` sends them as AG-UI `context`
entries (`{description, value}`, value as JSON text). `AnthropicCodec` appends one system block
per provider after the app's static blocks and leaves them uncached, so the static prompt keeps
its cache breakpoint. Providers should describe structure by default (columns, sorts, groups,
widgets), not row values. That keeps data inside the browser unless the app chooses otherwise.

### 2.2 Undo

`ChatToolSpec.execute` may return `chatToolResult(result, {undo})`. The model keeps each turn's
undo thunks in memory, keyed by message id, newest first. The assistant message shows an Undo
action while the thunks exist, and runs them in reverse order. Undo is not available after a
reload, because thunks cannot be stored. An undone turn records `metadata.undone: true`.

### 2.3 Preview before apply

`ChatToolSpec.preview?: (input: PlainObject) => string | ReactNode` shows what a call will change
on its approval card ("Will hide 3 columns: id, sellerId, ..."). It generalizes the generative UI
`approvalPreview` flag from WP 0 into one option.

## 3. Tool groups derived from Hoist models

A tool group is a function that returns `ChatToolSpec[]` plus a context provider for one model.
Each tool's `execute` calls the model's public API. Groups are opt-in per capability.

| Factory | Package | Capabilities |
|---|---|---|
| `gridTools(gridModel, {capabilities})` | `assist/` (platform-neutral) | `columns` (show, hide, reorder, resize, pin), `sort`, `group`, `filter` (through the grid's filter model when present), `autosize`, `export`, `select` |
| `dashCanvasTools(dashCanvasModel, {capabilities})` | `desktop/assist/` | `widgets` (list, add, remove, move, resize, configure), `layout`, `views` (save, switch, reset, when a view manager is present) |

- Each tool has a JSON schema built from the model's current state where it helps, such as an
  `enum` of the grid's column ids, refreshed every step.
- Each group ships a short capability description for the system prompt and three suggestion
  chips.
- Destructive tools (reset, remove all) default to `needsApproval`.
- Every tool returns an undo thunk built from the model's persistable state, which both
  `GridModel` and `DashCanvasModel` already expose.
- The weather agent's 13 dashboard tools become the reference for `dashCanvasTools`. The Toolbox
  weather agent then switches to the shared group, plus its own weather-specific tools.

Check every Hoist API with the hoist-react MCP tools before writing a tool: column state,
`sortBy`, `groupBy`, filter models, `DashCanvasModel` view state and its persistable state.

## 4. The assistant model and form factor

- `ChatAssistantModel` (in `assist/`) builds and owns a `ChatModel` from tool groups, context
  providers, a short prompt and the default transport. Config: `{groups, title?, prompt?,
  suggestions?, transport?, onAskInChat?}`. Without `transport`, it asks `XH.chatService` for the
  default.
- `chatAssistantButton` (desktop) goes last in a `Panel` header. `chatAssistantContainer` wraps
  the panel's content. In a component 740 px or wider, the helper docks inside it, 360 to 420
  px. Otherwise it opens in a popover anchored to the button. One `ChatModel` serves open and
  close. The look follows Claude Design prompt 7 (D73).
- No persistence (A2, R12). The conversation lives in memory for the life of the component, and
  never shows in a thread list. "Ask in chat", through `onAskInChat`, is the bridge to a real
  thread.

## 5. Bring your own LLM

### 5.1 `ChatService`

A `HoistService` in a new `svc/` package. The app installs it like any Hoist service. It reads a
client-visible config, `xhChatConfig`:

```json
{"enabled": true, "url": "llm/stream", "codec": "anthropic", "cacheControl": true}
```

`codec` is `anthropic`, `openai-chat` or `agui`. `XH.chatService.isEnabled` gates helper buttons.
`XH.chatService.createTransport(overrides?)` builds a `HoistChatTransport` with the matching
codec. Model choice, keys, limits and roles stay on the server.

### 5.2 `ChatCompletionsCodec`

Encodes OpenAI chat completions requests (`messages` with system, user, assistant `tool_calls` and
`tool` messages, `tools` as functions, `stream: true`). It decodes the streamed
`chat.completion.chunk` records: content deltas, `tool_calls` fragments by index with ids and
names in the first fragment, `finish_reason`, and the final usage chunk. Most enterprise gateways
speak this format (Azure OpenAI, LiteLLM, Portkey, internal model services). Test it with recorded
streams, as for `AnthropicCodec`. The Responses API codec comes after.

### 5.3 Toolbox

The Toolbox relay learns a second upstream: an `llmProvider` config (`anthropic` or
`openai-compatible`) selects the upstream URL and the request shape. That proves the bring your
own LLM seam end to end, if an OpenAI-compatible key is available. Otherwise only the recorded
codec tests prove it.

## 6. Order of work

1. Core seams: context providers, undo, preview. Specs.
2. `ChatCompletionsCodec` and `ChatService`. Specs.
3. `gridTools` and `dashCanvasTools`, with specs against real models in the Hoist test app.
4. `ChatAssistantModel` and `chatAssistantButton`, after the design handoff.
5. Toolbox: a grid helper on an existing Toolbox grid page, and the weather agent moved onto
   `dashCanvasTools`.
6. Docs: `assist/README.md`, a helper recipe, and a bring your own LLM section in the transport
   README.
