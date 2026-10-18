# Server Mode and the Thread Layer - Design Spec

Internal build spec for plan 2, work packages 1 to 3 (see `PLAN-2.md` and decisions D19 to D21).
The lead owns it. Workers build against it and flag conflicts rather than diverge.

Sources: the enterprise reports in `.tmp/hoist-chat-kit-feedback-1/` (app 1 section 5.1, app 2
sections 1, 2 and 7, app 3 sections 2 and 4) and the research report
`research/chat-ui-libraries-and-patterns.md` ("Adapter contract for a thread store", and section
1.7 on assistant-ui's 2026 bugs).

## 1. Principles

1. **Kit ids never change.** A message keeps the id the kit gave it for its whole life, so React
   keys, the reducer and the renderers never remap. Server ids live in `metadata.serverId` and
   `metadata.runId`. When the kit loads history from a server, it uses the server's id as the kit
   id, so the two agree from then on. This avoids the id reconciliation that cost app 2 most of
   its model code.
2. **The thread id may change once.** In server mode, the first run may report a server thread
   id on `RUN_STARTED`. `ChatModel.threadId` takes it, and the thread layer re-keys the thread.
   After that it is fixed.
3. **The run owner is a model, never a component.** `ChatModel` and `ChatThreadsModel` own all
   run and load state. Components only render. A remount never cancels a run.
4. **Every async result is checked for staleness.** A list, load or run result is applied only if
   it still belongs to the current selection and to the newest request of its kind.

## 2. Run lifecycle (WP 1)

### 2.1 `ChatModelConfig` additions

```ts
historyMode?: 'client' | 'server';         // default 'client' (D19)
runOptions?: PlainObject;                  // initial value of the observable runOptions
textTransform?: (text: string, context: {message: ChatMessage; isStreaming: boolean}) => string;
feedback?: ChatFeedbackConfig;             // see section 4.1
track?: boolean | ChatTrackOptions;        // per-turn activity tracking, default false
```

- `@bindable accessor runOptions: PlainObject` holds per-turn options picked in the UI, such as a
  document scope, an agent profile or tool toggles. `sendAsync` copies the current value onto the
  user message (`metadata.runOptions`) and onto each `ChatRunRequest` of that turn. Codecs encode
  the copy, never the live value, so a picker change mid-turn cannot leak into it.
- `textTransform` runs in the reducer on every text part change, streamed and final, before the
  text is stored. It sanitizes leaked model markup (for example `<thinking>` tags) and is the hook
  for inline tag extraction later (WP 7). It must be pure and fast.

### 2.2 `ChatRunRequest` additions

```ts
historyMode: 'client' | 'server';
trigger: 'submit' | 'retry' | 'regenerate' | 'edit' | 'continue';  // 'continue' = after client tools
turnId: string;            // id of the user message this turn answers - the idempotency key
stepIndex: number;         // model call index within the turn
newMessages: ChatMessage[];  // what the server has not seen: the user message, or tool results
replacedMessageId: string;   // assistant message replaced by retry or regenerate, or null
runOptions: PlainObject;     // copy taken at send time
```

`messages` stays the full history in both modes, so client-mode codecs do not change. A server-mode
codec sends `turnId`, `trigger` and `runOptions` too. `AgUiCodec` sends `messages` in both modes,
as AG-UI 1.0 requires (D85). `newMessages` serves a codec whose backend takes only what it has not
seen.

`turnId` is the user message's kit id. A retry of the same turn reuses it, so a backend with an
idempotency key returns the original result rather than starting a second run.

### 2.3 Server ids

The reducer records:

| Event | Effect |
|---|---|
| `RUN_STARTED {threadId, runId}` | `metadata.runId` on the assistant message. In server mode, if `threadId` differs from `ChatModel.threadId`, the model adopts it (once) |
| `CUSTOM xh.chat.message {role, serverId}` | `metadata.serverId` on the turn's assistant message (`role: 'assistant'`) or its user message (`role: 'user'`) |
| `RUN_FINISHED {result: {messageId}}` | the same, as a fallback for agents that report the id at the end |

`ChatModel.threadId` becomes an `@observable` that only the model sets.

### 2.4 Stop, detach and cancel

`ChatAbortReason = 'stop' | 'detach' | 'clear' | 'load' | 'destroy'`, passed as the abort
signal's `reason`.

- `stop()`: abort with `stop`, mark the message `aborted`, then call `transport.cancelAsync?.({threadId,
  runId, turnId})` without awaiting it. A failed cancel is logged at warn, never shown.
- `clear()`, `loadMessages()` and `destroy()`: abort with their reason. In client mode the message
  is `aborted`, as today. In server mode the server keeps running, so the message is `aborted`
  with `metadata.detached: true`, and no cancel is sent. A thread layer that reloads the thread
  later gets the server's final answer.
- `ChatTransport.cancelAsync?(run: ChatRunRef): Promise<void>` is new and optional.
  `HttpChatTransport` gains `cancelUrl?` (a value or a function of the run) to POST a cancel.
- `ChatTransport.resume?` is defined as a type now and implemented in v1.1.

### 2.5 New events

| Event | Effect |
|---|---|
| `CUSTOM xh.chat.textReplace {text}` | Sets the text of the turn's open text part, or of the last text part if none is open. Covers a RAG backend's "reset" (text `''`) and its authoritative final text |
| `CUSTOM xh.chat.toolError` | From WP 0 |
| `RUN_ERROR {code, metadata: {retryAfterSeconds}}` | `ChatRunError.retryAfterSeconds`. The error banner shows a countdown before Retry (WP 4) |

### 2.6 Telemetry

With `track` on, each finished turn calls `XH.track` once: category `Chat`, message `Turn
complete` (or `Turn failed`), and data `{elapsedMs, steps, toolCalls, toolErrors, finishReason,
errorCode, threadId, runId, historyMode}`. Never message text. Hoist's correlation id already flows
through `FetchService`.

## 3. Thread layer (WP 2)

### 3.1 `ChatThreadStore`

An adapter the app implements against its backend. Only the two list and load methods are
required. The models hide actions the store lacks.

```ts
export interface ChatThreadStore {
    listThreadsAsync(query: ChatThreadQuery): Promise<ChatThreadPage>;
    loadMessagesAsync(spec: {threadId: string; cursor?: string; limit?: number}): Promise<ChatMessagePage>;

    createThreadAsync?(spec: {localId: string; title?: string}): Promise<ChatThreadSummary>; // idempotent per localId
    renameThreadAsync?(threadId: string, title: string): Promise<void>;
    deleteThreadsAsync?(threadIds: string[]): Promise<void>;   // deleting a missing thread succeeds
    pinThreadAsync?(threadId: string, pinned: boolean): Promise<void>;
    submitFeedbackAsync?(spec: ChatFeedbackSpec): Promise<void>;
}

export interface ChatThreadSummary {
    id: string;
    title: string;
    lastActivityAt: number;     // epoch ms, drives sort and recency groups
    createdAt?: number;
    pinned?: boolean;
    isRunning?: boolean;        // the server reports a run in progress
    metadata?: PlainObject;
}

export interface ChatThreadQuery {search?: string; cursor?: string; limit?: number}
export interface ChatThreadPage {threads: ChatThreadSummary[]; nextCursor?: string}
export interface ChatMessagePage {messages: ChatMessageSpec[]; nextCursor?: string}
```

A store that mints ids on the server implements `createThreadAsync`. Without it, the browser mints
the id and the server creates the row on the first turn (apps 2 and 3).

### 3.2 `ChatThreadsModel`

```ts
export interface ChatThreadsConfig {
    store: ChatThreadStore;
    createChatModel: (spec: {threadId: string; isNew: boolean}) => ChatModel;  // app wires transport, tools
    pageSize?: number;                 // default 50
    historyPageSize?: number;          // default 50
    allowConcurrentTurns?: boolean;    // default true; false blocks sends while any thread runs
    route?: {name: string; param: string};   // optional deep links
}

export class ChatThreadsModel extends HoistModel {
    @observableRef accessor threads: ChatThreadSummary[];
    @observable accessor selectedThreadId: string;     // null before the first selection
    @bindable accessor search: string;
    @computed get chatModel(): ChatModel;               // the selected thread's model
    @computed get runningThreadIds: string[];           // local and server-reported
    @computed get canRename / canDelete / canPin: boolean;
    @managed listTask, loadTask: TaskObserver;

    newThread(seed?: ChatSeedSpec): ChatModel;          // selects a fresh thread
    selectThreadAsync(id: string): Promise<void>;
    renameThreadAsync(id: string, title: string): Promise<void>;   // optimistic, rolls back
    deleteThreadsAsync(ids: string[]): Promise<void>;              // optimistic, rolls back
    pinThreadAsync(id: string, pinned: boolean): Promise<void>;
    loadMoreThreadsAsync(): Promise<void>;
    loadOlderMessagesAsync(): Promise<void>;           // for the selected thread
    override doLoadAsync(loadSpec): Promise<void>;     // refreshes the list
}
```

- It holds one `ChatModel` per open thread, keyed by thread id. A model is kept while it is
  selected or busy, and destroyed when it is neither. So a turn keeps running after the user
  switches away, and the list shows it as running (app 3's "In Progress").
- When a model adopts a server thread id (section 2.3), the threads model re-keys it, updates the
  summary and the selection, and replaces the route parameter.
- After a turn completes, it refreshes that thread's summary (debounced list reload), because the
  server may set a title.
- `ChatModel` gains `prependMessages(specs)` and `@observable hasOlderMessages` for paged history.
  The message list keeps the scroll anchor when older messages arrive.

### 3.3 Concurrency rules (the model's spec, one test each)

1. A list response is applied only if no newer list request has resolved. Pending deletes and
   renames are reapplied over it by id.
2. A message load for thread B is discarded if the user has since selected C. Its failure is
   logged, never shown in C.
3. A new thread opened during a load never shows the old thread's messages.
4. Events from a run are applied only to that run's model. Each model already guards its own
   turn, so the threads model must never route events itself.
5. `createThreadAsync` is awaited before the first run, and called once per local id, even if the
   first send is retried.
6. Run options and drafts belong to one thread's model and never leak into another.
7. With `allowConcurrentTurns: false`, a send is blocked while any thread runs, with a reason.
8. A 404 or empty page means an empty thread. Any other load failure blocks sends on that thread
   only, with an error and a Retry.
9. A turn that ends with no content is an error, not a blank success.

### 3.4 Route binding

With `route` set, the selected thread and the route parameter stay in sync both ways: a deep link
selects its thread, and a selection replaces the parameter with no new history entry. Use Hoist's
router (`XH.routerModel`, `XH.navigate`). Check its API with the hoist-react MCP tools.

## 4. Message seams (WP 3)

### 4.1 Feedback

```ts
export interface ChatFeedbackConfig {
    submitAsync?: (spec: ChatFeedbackSpec) => Promise<void>;   // else the thread store's
    commentOn?: 'negative' | 'positive' | 'both' | 'none';      // default 'negative'
    requireComment?: boolean;                                   // default false
}
export interface ChatFeedbackSpec {
    threadId: string;
    messageId: string;          // kit id
    serverId: string;           // metadata.serverId, or null
    runId: string;
    rating: 'positive' | 'negative' | null;   // null clears
    comment?: string;
}
```

`ChatModel.submitFeedbackAsync(messageId, rating, comment?)` stores `metadata.feedback = {rating,
comment}` at once, calls the submitter, and rolls back with a toast on failure. History restores
the rating from the same key. Feedback is tracked when `track` is on.

### 4.2 Citation markers

- `ChatSourcePart` gains `marker?: number` (the number that cites it in the text) and
  `metadata?: PlainObject` (for example a document id and an excerpt).
- `ChatMarkdown` gains `citations?: {sources: ChatSourcePart[]; onClick?: (source) => void}`. A
  remark plugin turns `[1]` and `[1, 2]` in text, never inside code or links, into citation
  buttons for the sources with that `marker`, or the source at that index when no source has a
  marker. A number with no source stays plain text.
- `ChatMessageList` and `ChatPanel` gain `citationMarkers?: boolean` (default false) and
  `onSourceClick?: (source: ChatSourcePart, context: ChatPartRenderContext) => void`. The default
  opens `source.url` in a new tab. An app with a document viewer supplies its own handler.

### 4.3 Markdown plugins

`ChatMarkdown`, `ChatMessageList` and `ChatPanel` gain `markdownPlugins?: {remark?: PluggableList;
rehype?: PluggableList}`, merged after the kit's own plugins (for example KaTeX). The kit takes no
math dependency.

## 5. Out of scope here

Thread list, workspace, feedback and citation UI are WP 4 and wait for the design handoff. The
server-mode demo and recipe are WP 5.
