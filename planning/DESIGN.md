# Hoist Chat Kit - Design Spec (v1)

Internal build spec for the first iteration. The lead agent owns it. Sub-agents build against it,
and flag conflicts to the lead rather than diverging silently. Public docs (READMEs, `docs/`)
derive from it, but this file is not shipped.

## 1. Goals

- A Hoist-native kit for LLM chat UIs: models, transports, and desktop components.
- Code indistinguishable from hoist-react's best: `HoistModel`/`hoistCmp`, element factories,
  TC39 decorators, `xh-` BEM classes, Hoist CSS vars, null over undefined, named exports.
- Real token streaming end to end, cancellable.
- Provider- and protocol-neutral UI. Components never see a provider wire format.
- First consumer: the Toolbox `weatherv2` dashboard agent. Its chat UI must come entirely from
  the kit.

## 2. Package layout

Top-level source directories, like hoist-react. Each has an `index.ts` barrel and a `README.md`.
Each is listed in `package.json` `files`.

```
core/                 Platform-neutral models and types
  ChatModel.ts        Conversation state and the run loop (HoistModel)
  ChatMessage.ts      Immutable message record
  ChatPart.ts         Part types (discriminated union) and helpers
  ChatToolSpec.ts     Tool declaration: schema, execute, approval, display
  ChatComposerModel.ts Draft text and attachments (HoistModel)
  impl/               Stream reducer, id generation, history helpers
transport/            Getting events from a backend
  ChatEvent.ts        Event vocabulary (AG-UI 1.0 subset, see section 5)
  ChatTransport.ts    Transport interface + ChatRunRequest
  ChatCodec.ts        Codec interface (request encoding, event decoding)
  HoistChatTransport.ts   NDJSON over XH.fetchNdjson - the default for Hoist servers
  SseChatTransport.ts     SSE over fetch - for AG-UI agent servers
  ScriptedChatTransport.ts Scripted events for tests and demos
  codec/AgUiCodec.ts      AG-UI RunAgentInput encoding, pass-through decoding
  codec/AnthropicCodec.ts Anthropic Messages encoding, SSE event decoding
  impl/               SSE line parser, partial-JSON parser
cmp/markdown/         Platform-neutral streaming markdown renderer
desktop/cmp/chat/     Desktop components (Blueprint-based Hoist desktop)
styles/               Shared SCSS: --xh-chat-* custom properties, light and dark
docs/                 Concept docs, index, registry
```

Import paths for apps: `@xh/hoist-chat-kit/core`, `@xh/hoist-chat-kit/transport`,
`@xh/hoist-chat-kit/cmp/markdown`, `@xh/hoist-chat-kit/desktop/cmp/chat`.

Mobile: none in v1. Everything in `core/`, `transport/` and `cmp/` must stay platform-neutral
(no imports from `@xh/hoist/desktop`), so a `mobile/cmp/chat` can follow.

## 3. Data model

### 3.1 Messages are immutable records

`ChatMessage` follows the `StoreRecord` precedent: an immutable object, replaced on change.
`ChatModel.messages` is an `@observableRef` array. The stream reducer produces a new
`ChatMessage` (and new part objects only for the parts that changed). Memoized `hoistCmp`
components then re-render only the message and part that changed.

```ts
export type ChatRole = 'user' | 'assistant' | 'system';
export type ChatMessageStatus = 'pending' | 'streaming' | 'complete' | 'error' | 'aborted';

export interface ChatMessageSpec {       // plain JSON - initialMessages, persistence
    id?: string;
    role: ChatRole;
    parts?: ChatPart[];
    content?: string;                    // shorthand for a single text part
    status?: ChatMessageStatus;          // default 'complete'
    createdAt?: number;
    error?: string;
    metadata?: PlainObject;
}

export class ChatMessage {
    readonly id: string;
    readonly role: ChatRole;
    readonly parts: ChatPart[];
    readonly status: ChatMessageStatus;
    readonly createdAt: number;
    readonly error: string;              // null unless status 'error'
    readonly metadata: PlainObject;      // usage, finishReason, elapsedMs, model...

    constructor(spec: ChatMessageSpec);
    get text(): string;                  // text parts joined with blank lines
    get toolCalls(): ChatToolCallPart[];
    get isUser(): boolean; get isAssistant(): boolean;
    get isStreaming(): boolean;          // pending or streaming
    withChanges(changes: Partial<ChatMessageSpec>): ChatMessage;
    toSpec(): ChatMessageSpec;           // JSON-safe (drops attachment File objects)
}
```

### 3.2 Parts

Discriminated by `type`. Plain readonly objects. Every part has an `id` and the `step` (model
call index within the assistant turn, 0-based) that produced it.

```ts
export type ChatPart =
    | ChatTextPart | ChatReasoningPart | ChatToolCallPart
    | ChatFilePart | ChatSourcePart | ChatDataPart;

interface ChatTextPart      {type: 'text'; id; step?; text: string; state: 'streaming'|'done';
                             citations?: ChatCitation[]}
interface ChatReasoningPart {type: 'reasoning'; id; step?; text: string; state;
                             startedAt: number; endedAt: number; encryptedValue?: string}
interface ChatToolCallPart  {type: 'toolCall'; id /* = toolCallId */; step?; toolName: string;
                             state: ChatToolCallState; inputText: string; input: PlainObject;
                             output: any; errorText: string; providerExecuted?: boolean}
interface ChatFilePart      {type: 'file'; id; step?; name: string; mediaType: string;
                             size?: number; url?: string; data?: string /* base64 */}
interface ChatSourcePart    {type: 'source'; id; step?; url?: string; title?: string;
                             snippet?: string}
interface ChatDataPart      {type: 'data'; id; step?; dataType: string; data: any}

type ChatToolCallState =
    | 'input-streaming'      // args arriving
    | 'input-available'      // args complete, not yet run
    | 'approval-requested'   // waiting on the user
    | 'running'              // client tool executing
    | 'output-available'     // result in `output`
    | 'output-error'         // failed, message in `errorText`
    | 'output-denied';       // user rejected

interface ChatCitation {id; title?; url?; citedText?; sourceId?}
```

State names match the Vercel AI SDK `UIMessage` tool states (plus `running`), the de facto
vocabulary, so adapters stay trivial. `data` parts are the generative-UI seam: A2UI surfaces,
OpenUI payloads, MCP App resources, and AG-UI activities all arrive as `data` parts keyed by
`dataType` and render through a renderer registry (section 7.4).

## 4. ChatModel

```ts
export interface ChatModelConfig {
    transport: ChatTransport;
    tools?: ChatToolSpec[];              // client tools + display config for server tools
    maxSteps?: number;                   // model calls per user turn, default 10
    initialMessages?: ChatMessageSpec[];
    threadId?: string;                   // default: generated
    composer?: ChatComposerConfig;       // config for the managed composerModel
    dataRenderers?: Record<string, ChatDataRenderer>;
    onTurnComplete?: (message: ChatMessage) => void;  // assistant turn finished (any outcome)
}

export type ChatStatus = 'ready' | 'submitted' | 'streaming' | 'error';

export class ChatModel extends HoistModel {
    declare config: ChatModelConfig;
    readonly transport: ChatTransport;
    readonly tools: ChatToolSpec[];
    readonly maxSteps: number;
    readonly threadId: string;
    @managed readonly composerModel: ChatComposerModel;

    @observableRef accessor messages: ChatMessage[];
    @observable accessor status: ChatStatus = 'ready';
    @observableRef accessor lastError: Error = null;

    @computed get isBusy(): boolean;                  // submitted or streaming
    @computed get isEmpty(): boolean;
    @computed get lastMessage(): ChatMessage;
    @computed get pendingApprovals(): ChatToolCallPart[];

    sendAsync(input?: string | ChatSendSpec): Promise<void>;   // default: composer draft
    stop(): void;                                    // abort; keep partial as 'aborted'
    retryAsync(): Promise<void>;                     // after error: re-run last user turn
    regenerateAsync(messageId?: string): Promise<void>;  // default: last assistant message
    editMessageAsync(messageId: string, text: string): Promise<void>; // truncate, resend
    approveToolCallAsync(toolCallId: string): Promise<void>;
    denyToolCallAsync(toolCallId: string, reason?: string): Promise<void>;
    addToolOutputAsync(toolCallId: string, output: any): Promise<void>; // human-in-the-loop
    clear(): void;
    loadMessages(specs: ChatMessageSpec[]): void;
    getMessageSpecs(): ChatMessageSpec[];
    getToolSpec(name: string): ChatToolSpec;
}

export interface ChatSendSpec {text?: string; files?: ChatFilePart[]; metadata?: PlainObject}
```

### 4.1 The run loop (one user turn)

1. `sendAsync` appends a user message (text part plus file parts), clears the composer, then
   appends an assistant message with status `pending` and no parts. Status becomes `submitted`.
2. For each step, up to `maxSteps`:
   1. Build a `ChatRunRequest` (`threadId`, new `runId`, `messages` - the full history including
      the in-progress assistant message's earlier steps, `tools`, `signal`) and iterate
      `transport.run(request)`.
   2. Feed events to the stream reducer (`impl/ChatStreamReducer`). Buffer events and flush into
      `messages` at most every ~32 ms in one action (`STREAM_FLUSH_MS`). Flush at stream end.
      The first content event moves status to `streaming` and the message to `streaming`.
   3. When the stream ends, find this step's tool calls in state `input-available` whose tool
      has an `execute`. No such calls: the turn is complete. Calls that need approval move to
      `approval-requested` and the loop pauses (status `ready`), and `approveToolCallAsync` /
      `denyToolCallAsync` resume it once none are pending. Otherwise run each `execute` in order
      (state `running`, then `output-available` or `output-error`) and continue to the next step.
   4. A tool call with no result and no client `execute` (unknown tool) becomes `output-error`
      with "No handler for tool '<name>'", and the loop continues so the model can recover.
3. On `RUN_ERROR` or a thrown error: message status `error` with `error` text, model
   `lastError` set, status `error`. On `stop()`: abort the signal, message status `aborted`,
   status `ready`. In-flight `streaming` parts are marked `done`.
4. On completion: status `ready`, message `complete`, `metadata.elapsedMs` set,
   `onTurnComplete` called.

Concurrency: one turn at a time. `sendAsync` while busy is a no-op (logged at debug). Guard
synchronously (not via MobX state) so two sends in one tick cannot both start.

Use `XH.handleException` only for unexpected errors in the model itself. Run errors are part of
the conversation: show them in the message and error banner, and log with `logError`. Tool
`execute` errors become the tool result (`output-error`) and go back to the model.

## 5. Events: AG-UI 1.0 is the kit's wire vocabulary

`transport/ChatEvent.ts` declares `ChatEvent`, a subset of AG-UI 1.0 events with identical
`type` strings and field names (checked against `@ag-ui/core@1.0.2` type declarations, kept
for reference at `/tmp/agui-pkg/package/dist/version-Dr0GiU8W.d.mts`). The kit takes no runtime
dependency on `@ag-ui/*`. The types are mirrored.

Supported events and how the reducer applies them:

| Event | Fields used | Effect |
|---|---|---|
| `RUN_STARTED` | `threadId, runId` | none (debug) |
| `RUN_FINISHED` | `outcome?, usage?, metadata?` | record usage, `metadata.finishReason` |
| `RUN_ERROR` | `message, code?` | message error |
| `STEP_STARTED/FINISHED` | `stepName` | none (debug) |
| `TEXT_MESSAGE_START` | `messageId, role?` | open a text part (lazily, on first content) |
| `TEXT_MESSAGE_CONTENT` | `messageId, delta` | append to the open text part |
| `TEXT_MESSAGE_END` | `messageId` | text part `done` |
| `TEXT_MESSAGE_CHUNK` | `messageId?, delta?` | start-or-append |
| `REASONING_START` / `REASONING_MESSAGE_START` | `messageId` | open reasoning part, `startedAt` |
| `REASONING_MESSAGE_CONTENT` | `messageId, delta` | append |
| `REASONING_MESSAGE_END` / `REASONING_END` | `messageId` | reasoning `done`, `endedAt` |
| `REASONING_MESSAGE_CHUNK` | `messageId?, delta?` | start-or-append |
| `REASONING_ENCRYPTED_VALUE` | `subtype, entityId, encryptedValue` | store on the part |
| `TOOL_CALL_START` | `toolCallId, toolCallName` | tool part `input-streaming` |
| `TOOL_CALL_ARGS` | `toolCallId, delta` | append `inputText`; best-effort partial parse into `input` |
| `TOOL_CALL_END` | `toolCallId` | parse `inputText` (empty is `{}`); `input-available` or `output-error` on bad JSON |
| `TOOL_CALL_CHUNK` | `toolCallId?, toolCallName?, delta?` | start-or-append |
| `TOOL_CALL_RESULT` | `toolCallId, content` | `output-available`, `providerExecuted: true`; JSON-parse `content` when it parses |
| `ACTIVITY_SNAPSHOT` | `messageId, activityType, content, replace?` | upsert `data` part (`dataType` = `activityType`) |
| `CUSTOM` | `name, value` | kit extensions below; otherwise ignored (debug) |
| `RAW`, `STATE_*`, `MESSAGES_SNAPSHOT`, `ACTIVITY_DELTA`, `SUBAGENT_*` | - | ignored in v1 (debug log) |

Unknown event types are ignored, never thrown.

Kit extensions travel as AG-UI `CUSTOM` events, names prefixed `xh.chat.`:

| `name` | `value` | Effect |
|---|---|---|
| `xh.chat.source` | `{id?, url?, title?, snippet?}` | append a `source` part |
| `xh.chat.citation` | `{id?, title?, url?, citedText?, sourceId?}` | append a citation to the open (or last) text part |
| `xh.chat.data` | `{id?, dataType, data}` | upsert a `data` part |
| `xh.chat.file` | `ChatFilePart` fields | append a `file` part |

Why AG-UI as the vocabulary: it hit 1.0 (MIT) with broad framework support, its event set maps
almost one to one onto the part model, and any AG-UI agent server then works with the kit
directly over `SseChatTransport`. A Hoist server can emit the same events as NDJSON. The kit
still owns its UI model (section 3), so protocol churn stops at the reducer.

## 6. Transports and codecs

```ts
export interface ChatRunRequest {
    threadId: string;
    runId: string;
    messages: ChatMessage[];
    tools: ChatToolSpec[];
    signal: AbortSignal;
}

export interface ChatTransport {
    /** Run one model call. Yields events as they arrive. Ends when the run ends. */
    run(request: ChatRunRequest): AsyncIterable<ChatEvent>;
}

export interface ChatCodec {
    /** Request body for the backend. */
    encodeRequest(request: ChatRunRequest): PlainObject;
    /** Per-run decoder: one raw record (parsed JSON line or SSE data) to zero or more events. */
    createDecoder(): (raw: PlainObject) => ChatEvent[];
}
```

- `HoistChatTransport({url, codec = new AgUiCodec(), track?, timeout?})` - POSTs the encoded
  body with `XH.fetchNdjson({url, method: 'POST', body})` and decodes each line. Aborts through
  `autoAbortKey` + `XH.fetchService.abort()` when `signal` aborts. Gets Hoist auth, correlation
  ids, tracing and error decoding for free. The default for apps with a hoist-core server.
- `SseChatTransport({url, codec = new AgUiCodec(), headers?})` - POSTs with `XH.fetch` (raw
  `Response`), parses `text/event-stream` frames, and passes each `data:` JSON (with the `event:`
  name) to the decoder. For AG-UI agent servers and SSE proxies.
- `ScriptedChatTransport({responses | respond, delayMs?})` - yields scripted events with
  realistic pacing. Helpers build common sequences (`textEvents(text)`, `toolCallEvents(name,
  input)`, `reasoningEvents(text)`). For tests, demos, and offline Toolbox pages.
- `AgUiCodec` - encodes `RunAgentInput` (AG-UI messages: user/assistant/tool/reasoning, tools as
  `{name, description, parameters}`, `context: []`, `forwardedProps`), decodes by pass-through
  of known event types.
- `AnthropicCodec({system?, model?, maxTokens?, params?})` - encodes Anthropic Messages API
  bodies (`system` may be a function of the request, so apps can inject live context;
  `messages` built from history with steps split into assistant `tool_use` / user `tool_result`
  turns; files as image/document blocks; tools as `{name, description, input_schema}`;
  `stream: true`). Decodes raw Anthropic SSE event JSON (`message_start`,
  `content_block_start/delta/stop`, `message_delta`, `message_stop`, `error`, `ping`) into
  `ChatEvent`s, including thinking, signatures, citations and server tool blocks. Lets a Hoist
  server proxy Anthropic with no translation of its own.

Server contract for `HoistChatTransport`: a controller that reads the JSON body and writes one
JSON object per line, flushing after each. hoist-core's `renderNDJSON` flushes after the first
row, then every 32 KB, so a token stream needs its own flush (see Toolbox `LlmController.stream`). That gap
goes in the report.

## 7. Components (desktop)

All in `desktop/cmp/chat/`, exported as `[Component, factory]` pairs via `hoistCmp.withFactory`,
class names `xh-chat-*` (BEM: `xh-chat-message__body`, `xh-chat-message--user`). Each SCSS
file is imported by its component. Use Hoist inputs (`textArea`), `button`, `clipboardButton`,
`Icon`, `panel`, layout boxes. Element factories, never JSX.

| Component | Model | Purpose |
|---|---|---|
| `ChatPanel` | `uses(ChatModel)` | Composite: `panel` (passes `PanelProps` through: title, icon, headerItems, tbar, compactHeader...) holding message list + composer. Props: `emptyState?: ReactNode`, `suggestions?: ChatSuggestion[]`, `composerProps?`, `messageListProps?`. |
| `ChatMessageList` | `uses(ChatModel)` | Scroll container. Sticks to bottom while streaming unless the user scrolls up, shows a scroll-to-bottom button. Renders `chatEmptyState` when empty, `chatErrorBanner` after the last message on error. |
| `ChatMessageView` | none (props: `message`, `chatModel`) | Role layout: user right-aligned bubble, assistant full width without bubble. Header with role label and elapsed time. Renders parts in order via the part renderers. Hover action bar: copy; regenerate (last assistant); edit (user, inline). Typing indicator while `pending`. |
| `ChatComposer` | `uses(ChatComposerModel)` | Auto-growing `textArea`, Enter sends, Shift+Enter newline, IME-safe (`isComposing`). Send button morphs to Stop while busy. Attachment tray (chips). Injection surfaces: `leftItems`, `rightItems` (toolbar slots next to send), `topItems`. Paste and drop files when attachments are enabled. |
| `ChatToolCall` | none (props: `part`, `message`, `chatModel`) | Collapsible card: icon, display name or summary, status (spinner, check, error, denied), input and output (JSON) in the body. Approve / Deny buttons when `approval-requested`. Uses `ChatToolSpec.renderer` when given. |
| `ChatReasoning` | none | Collapsible "Thinking..." / "Thought for 12s"; open while streaming, collapses when done. |
| `ChatCodeBlock` | none | Fenced code: language label, copy button, horizontal scroll. Syntax highlighting via CodeMirror's `@lezer/highlight` when available (broaden phase). |
| `ChatSources` | none | Numbered source list and inline citation chips with tooltips. |
| `ChatFileChip` | none | File/image attachment chip, with remove in the composer. |
| `ChatEmptyState` | none | Icon, title, text, suggestion chips. |
| `ChatSuggestions` | `uses(ChatModel)` | Clickable prompt chips that send. |
| `ChatErrorBanner` | `uses(ChatModel)` | Error text plus Retry (and Edit last prompt). |
| `ChatTypingIndicator` | none | Three-dot pulse. |

`cmp/markdown/ChatMarkdown` (platform-neutral) wraps Hoist's `markdown` (react-markdown +
remark-gfm). While a part streams it splits text into top-level blocks, memoizes finished
blocks, re-renders only the tail, and closes unterminated syntax in the tail (open code fence,
`**`, `` ` ``, `[text](`). When the part is `done` it renders the full text as one document, so
footnotes and reference links resolve. Props: `content`, `isStreaming`, `components`
(react-markdown overrides, e.g. `pre` to `chatCodeBlock`), `onLinkClick?`. Links open in a new
tab with `rel="noopener noreferrer"`. Raw HTML is never rendered.

### 7.1 Message layout and styling

- Column max width `var(--xh-chat-content-max-width, 820px)`, centered.
- User bubble: `--xh-chat-user-bg` (default derived from `--xh-bg-alt`), radius
  `--xh-chat-bubble-radius`, max width 80%.
- Assistant: no background, full width.
- Everything themed with Hoist vars (`--xh-text-color`, `--xh-text-color-muted`,
  `--xh-border-color`, `--xh-pad-px`, `--xh-font-size-px`, `--xh-intent-*`). Dark theme:
  `.xh-dark` overrides only where a Hoist var is not enough. No hex colors except in
  `styles/vars.scss` defaults.

### 7.2 Actions

Copy on every message (text parts). Regenerate on the last assistant message when not busy. Edit
on user messages: inline `textArea` with Cancel / Send, which calls `editMessageAsync`.

### 7.3 Tools

```ts
export interface ChatToolSpec {
    name: string;
    description?: string;                 // sent to the model
    parameters?: PlainObject;             // JSON Schema for the input
    execute?: (input: PlainObject, ctx: ChatToolContext) => Awaitable<any>;
    needsApproval?: boolean | ((input: PlainObject) => boolean);
    displayName?: string;                 // card title, default humanized name
    icon?: ReactElement;
    summary?: (part: ChatToolCallPart) => string;   // one-line card summary
    renderer?: (part: ChatToolCallPart, ctx: ChatToolRenderContext) => ReactNode;
    sendToModel?: boolean;                // default true; false = display-only server tool
}
export interface ChatToolContext {chatModel: ChatModel; toolCallId: string; signal: AbortSignal}
```

A spec without `execute` describes a server-side tool: it is not sent to the model by the client
codec unless `sendToModel` is true, and it only configures display. `execute` results are
JSON-serialized for the model; strings pass as is.

### 7.4 Data parts (generative UI seam)

`ChatModelConfig.dataRenderers` maps `dataType` to `(part, ctx) => ReactNode`. Unknown types
render a compact JSON view. A2UI, OpenUI and MCP Apps renderers plug in here later, without
changes to the core.

## 8. ChatComposerModel

```ts
export interface ChatComposerConfig {
    placeholder?: string;                 // default 'Send a message...'
    enableAttachments?: boolean;          // default false
    accept?: string[];                    // MIME types or extensions
    maxFiles?: number;                    // default 10
    maxFileSize?: number;                 // bytes, default 10 MB
    maxRows?: number;                     // auto-grow cap, default 10
}

export class ChatComposerModel extends HoistModel {
    readonly chatModel: ChatModel;
    @bindable accessor text: string = '';
    @observableRef accessor attachments: ChatFilePart[] = [];
    @computed get isEmpty(): boolean;     // no text (trimmed) and no attachments
    @computed get canSend(): boolean;     // !isEmpty && !chatModel.isBusy
    addFilesAsync(files: File[]): Promise<void>;   // validate, read to base64, toast on reject
    removeAttachment(id: string): void;
    clear(): void;
    focus(): void;
    submitAsync(): Promise<void>;         // chatModel.sendAsync() with the draft
}
```

Up arrow in an empty composer recalls the last user message text.

## 9. Testing

Vitest on the Hoist test kit (`initTestAppAsync`, fake hoist-core, `hoistCore.route`). No
`vi.mock` of Hoist. Spec files beside sources.

- `ChatMessage`, part helpers - construction, `withChanges`, `toSpec` round trip.
- `ChatStreamReducer` - every event row in section 5, chunk forms, unknown events, bad JSON.
- `ChatModel` with `ScriptedChatTransport` - send, stream, flush batching (fake timers), stop,
  error, retry, regenerate, edit, tool loop, approval, deny, maxSteps, unknown tool, concurrency
  guard, `onTurnComplete`.
- `AnthropicCodec` - request encoding (steps, tool results, files, system function) and decoding
  of recorded Anthropic streams (text, tool use, thinking + signature, citations, error).
- `AgUiCodec` - RunAgentInput shape.
- SSE parser - frames, multi-line data, comments, CRLF, chunk boundaries.
- `HoistChatTransport` - against `hoistCore.route('POST', 'chat', ...)` returning an NDJSON
  `Response`; abort.
- `ChatComposerModel` - canSend, attachments validation, recall.
- `ChatMarkdown` helpers - block splitting, syntax closing.

## 10. Toolbox

- Branch `feature/weatherv2-chat-kit`, off `origin/weatherv2`, pushed, never merged.
- Server: `LlmService.stream()` posts to Anthropic with `stream: true` and relays each SSE
  `data:` JSON as one NDJSON line, flushed per line. `LlmController.stream` endpoint. Existing
  config entries (`llmApiKey`, `llmModel`, `llmMaxTokens`, `llmRateLimit`) are reused.
- Client: weatherv2 chat becomes `ChatModel` + `chatPanel` with `HoistChatTransport({url:
  'llm/stream', codec: new AnthropicCodec({system: () => buildSystemPrompt(...)})})` and its 13
  tools as `ChatToolSpec[]`. Prompts, suggestions and dashboard tools stay app code.
- A "Chat Kit" demo page in Toolbox showing the component set on `ScriptedChatTransport`
  (markdown, code, reasoning, tool states, approval, sources, attachments, errors).

## 11. Conventions checklist for every file

- Read `hoist-docs conventions` before writing. Model members in canonical order with section
  dividers. `declare config` first. `@managed` children. `addReaction`/`addAutorun`.
- `null` sentinel, `== null` checks, `withDefault`, `throwIf`, lodash over hand-rolled loops.
- TSDoc on every export, written from the caller's view. No em dashes in code. No copyright
  headers.
- Imports: external, then `@xh/hoist`, then relative. Barrels only, never `impl` from outside.
- `hoistCmp.withFactory` for public components, `hoistCmp.factory` for internal ones.
  `displayName` matches the export. `className` in the spec, applied to the root.
