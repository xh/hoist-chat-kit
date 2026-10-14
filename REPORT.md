# Hoist Chat Kit - First Iteration Report

Date: 2026-10-13. Scope: the first major iteration of `@xh/hoist-chat-kit`, built by a lead agent
that orchestrated sub-agents for research, implementation, review and browser verification.

## Summary

The kit is a Hoist-native package for LLM chat UIs and inline generative UI. It has models,
streaming transports, protocol codecs, desktop components, and a component catalog that lets a
model show real Hoist grids, charts, metric tiles and cards in a reply. The Toolbox `weatherv2`
dashboard agent now runs entirely on the kit, with real token streaming. A new Toolbox "Chat Kit"
app demonstrates every component, including a live model that renders Hoist grids and charts.

| Item | State |
|---|---|
| Package | `@xh/hoist-chat-kit` 1.0.0-SNAPSHOT. Slice 1 is merged to `develop` and published to npm under `next`. Slice 2 is on `feature/chat-kit-v1-broaden` (complete and verified, with commits pending (see Process notes)). |
| Tests | 390 unit tests on the Hoist test kit, all passing. |
| CI | Lint, typecheck, tests and a package build check on every PR and push. CodeQL runs once the repo is public. |
| Docs | Package READMEs for all six source packages, an architecture overview, a protocol guide, the docs index and registry, `DECISIONS.md` (decisions D1 to D18). |
| Toolbox | Branch `feature/weatherv2-chat-kit`, off `weatherv2`, pushed and never merged. |
| Spend | About $225 of the $500 budget. |

## What was built

### Packages

| Package | Contents |
|---|---|
| `core/` | `ChatModel` (the conversation and its run loop), `ChatMessage` and its typed parts, `ChatToolSpec`, `ChatComposerModel`, `ChatRunError` |
| `transport/` | `HoistChatTransport` (NDJSON from hoist-core), `SseChatTransport`, `ScriptedChatTransport`, `HttpChatTransport` base, `AgUiCodec`, `AnthropicCodec`, the `ChatEvent` vocabulary |
| `genui/` | `ChatUiCatalog`, component specs, a JSON Schema subset checker, the protocol adapter interface |
| `cmp/markdown/` | `ChatMarkdown`, a streaming-safe markdown renderer |
| `desktop/cmp/chat/` | `ChatPanel`, message list, message view, composer, tool call cards and groups, reasoning, code blocks, sources, file chips, empty state, suggestions, clear button |
| `desktop/cmp/genui/` | Catalog components for a Hoist grid, a Hoist chart, metric tiles and a detail card |

### Capabilities

- **Streaming.** Real token streaming from a hoist-core endpoint through `XH.fetchNdjson`, with
  cancel. Events are batched into one render per 32 ms, and only the changed message and part
  re-render.
- **Agent loop.** Client tools that act on the app run in the browser. A turn takes several model
  calls when tools run. Tools can need approval, with a per-tool approval prompt. Interactive
  tools wait for the user's answer. Backend tools stream their results.
- **Messages.** Retry, regenerate, edit and resend, copy, app-defined message actions such as
  feedback, and history that can be saved and restored.
- **Rich content.** Streaming markdown with code blocks, tables, citations and sources, reasoning
  disclosure, file attachments with validation, and grouped tool calls.
- **Generative UI.** Each catalog component becomes a tool, so the model gets an exact props
  schema. The kit validates the props, sends any errors back to the model to fix, and renders the
  component inline while its props stream.
- **Protocols.** AG-UI 1.0 events are the wire vocabulary, so AG-UI agent servers work over
  `SseChatTransport`. `AnthropicCodec` lets a Hoist server relay Anthropic's stream unchanged,
  with prompt caching.
- **Safety.** Markdown images are blocked unless the app allows them. The Toolbox relay accepts
  only an allowlist of request fields and keeps the key, model and limits on the server.

## Key decisions

`DECISIONS.md` records each one with its reasons. The most important:

1. **The kit owns its message model** (D2, D3). Messages are immutable records of typed parts,
   following the `StoreRecord` precedent. Protocols are adapters, so their churn stops at the codec.
2. **AG-UI 1.0 is the wire vocabulary** (D4). It is MIT-licensed, many agent frameworks emit it,
   and its events map almost one to one onto the parts. The kit mirrors the types and takes no
   runtime dependency.
3. **Codecs and transports are separate** (D5). With `AnthropicCodec`, the translation lives once,
   in tested TypeScript, and each app's server only relays.
4. **The client runs the tool loop** (D7), because many chat tools act on the app itself.
5. **Generative UI is a catalog of Hoist components exposed as tools** (D15). It reuses the tool
   machinery, gives the model a typed schema per component, and keeps the app in control of what
   can render. OpenUI Lang and A2UI plug in through an adapter that maps their components to the
   catalog. This answers the claim that Hoist had nothing for generative UI. Hoist's grids and
   charts suit data-dense apps better than a generic component kit.
6. **Images in model output are blocked by default** (D16), to close a known data exfiltration
   channel in LLM chat UIs.

## Verified and untested

### Verified

- **Unit tests.** 390 tests cover the run loop, the stream reducer, the partial JSON parser,
  both codecs against recorded streams, the SSE parser at every chunk boundary, both HTTP
  transports against Hoist's fake server, the composer, the markdown helpers, the catalog and its
  schema checker, and the component local models.
- **Browser, Chrome.** Driven through the Chrome DevTools MCP server and checked against
  screenshots (`planning/screenshots/`):
  - token streaming, multi-step tool turns, approve and deny, stop, error and retry, regenerate,
    edit, copy, scroll behavior, composer keys and auto-grow, and grouped tool calls
  - every Chat Kit demo, in light and dark themes, at about 420 px and at full width
- **Live model.** About 22 live turns in total against Claude Sonnet 5.5 through the Toolbox relay.
  - The weather agent rebuilt dashboards, recovered from a failed tool call, and used prompt
    caching (about 7,600 cached tokens per step).
  - The live demo rendered a 12-row Hoist grid and a chart from the catalog.
- **Network.** A page-side reader through the dev proxy saw the stream arrive in increments, and
  stopping a reply aborted the upstream call within about a second.
- **Server.** curl checks showed that disallowed fields are rejected, that a rate-limit hit
  returns a routine error with no stack trace, and that streaming still works.

### Not tested

- Browsers other than Chrome. `AbortSignal.any` needs a browser released in 2024 or later.
- The upstream 429, 529 and 5xx paths, a full connection pool, and a failure mid-stream on the
  server. The code handles them, but they were not triggered.
- A real file chosen through the operating system file picker. The automation environment blocked
  it, so attachments were tested with simulated drops.
- Screen readers. The components have labels, `role="log"`, live state and focus handling, but no
  assistive technology was run.
- The weather widgets themselves. They need an OpenWeatherMap key (`weatherApiKey`), which the
  throwaway database does not have, so they show no data. The agent and its tools work.
- `SseChatTransport` against a real AG-UI server. It is tested against recorded streams only.

## Known gaps

- **Mobile.** No mobile components yet. The models are platform-neutral, so `mobile/cmp/chat` can
  follow.
- **Threads.** No conversation list, thread persistence service or branching ("< 2/3 >").
- **Codecs.** No OpenAI codec yet (Responses or Chat Completions). `pause_turn` continuation is
  not handled.
- **Generative UI adapters.** The adapter interface ships, but there is no OpenUI Lang or A2UI
  adapter yet, and no MCP Apps host.
- **Code highlighting.** Code blocks have a language label and copy, but no syntax highlighting.
  CodeMirror's highlighter is already a Hoist dependency and is the planned route.
- **One extra model call per catalog render.** The model gets the tool result and continues, so
  it can comment on what it showed. An option to end the turn after a render would halve the cost
  of UI-only replies.
- **Rate limits.** The Toolbox limit counts model calls, not turns, and lives in memory on each
  server node.
- **Scripted turn count.** `ScriptedChatTransport` keeps counting turns after the chat is cleared,
  so a demo that branches on `turnIndex` misbehaves after a Clear. The Toolbox demos branch on the
  message text instead.

## Asks for hoist-react and hoist-core

The kit does not modify either repo. These are the changes it needs from them:

1. **hoist-core: a streaming render helper.** `BaseController.renderNDJSON` buffers 32 KB before it
   flushes, which suits large datasets but not token streams. Each app now writes about 150 lines
   of Groovy to relay a stream. A `renderNDJSON` option to flush each line, or a `streamNDJSON`
   helper with disconnect handling, would remove that. Toolbox's `LlmController.stream` is the
   reference.
2. **hoist-react: abort for streamed fetches.** `FetchService` releases an `autoAbortKey` once the
   response headers arrive, so `abort(key)` cannot stop a streaming body. A `signal` option on
   `FetchOptions` would let the kit drop its `fetchOpts.signal` workaround (D14).
3. **hoist-react: a regression, now fixed.** #4839 broke every `DashCanvas`, and #4846 fixed it.
   Toolbox was pinned to an earlier snapshot in between, and now tracks `next` again.

## Recommended next steps

1. **Ship the second slice.** Merge `feature/chat-kit-v1-broaden`, then switch Toolbox from the
   `link:` dependency to the published snapshot, so its branch builds without a sibling checkout.
2. **Generative UI depth.**
   - Build an OpenUI Lang adapter onto the catalog, and add an option to skip the follow-up model
     call after a render.
   - Compare the catalog with the existing client proof of concept that renders grids and charts
     inline, and close the gaps.
3. **Threads and persistence.** A `ChatThreadService` backed by hoist-core JSON blobs, a thread
   list component, and branching.
4. **Code highlighting** with CodeMirror's highlighter.
5. **An OpenAI codec** (Responses API), for apps on Azure OpenAI.
6. **Mobile components** on the same models.
7. **hoist-core streaming helper.** Upstream the Toolbox relay as a hoist-core service with
   allowlisting, rate limits and error mapping, so apps get a safe LLM proxy with no Groovy of
   their own.

## How to run the demos

You need the Toolbox prerequisites (JDK, Node, pnpm, and a Font Awesome token) and an Anthropic API
key for the live demos.

1. Check out both repos side by side: `hoist-chat-kit` on `feature/chat-kit-v1-broaden`, and
   `toolbox` on `feature/weatherv2-chat-kit`.
2. In `hoist-chat-kit`, run `pnpm install`. Toolbox links the kit through
   `"@xh/hoist-chat-kit": "link:../../hoist-chat-kit"`, so kit edits hot-reload.
3. Start the Toolbox server on a throwaway database. See "Agent-driven sessions" in Toolbox's
   `docs/running-locally.md`. A normal MySQL setup also works.
4. In the Toolbox Admin Console, set the `llmApiKey` config to an Anthropic key and `llmModel` to
   `claude-sonnet-5-5`.
5. In `toolbox/client-app`, run `pnpm install` and then `pnpm start`.
6. Open the apps:
   - <http://localhost:3000/chatkit/> - the Chat Kit demos. Every demo except "Live model" runs on
     scripted replies and needs no key.
   - <http://localhost:3000/weatherv2/> - the weather dashboard, with the Dashboard Agent on the
     right.

Each example's README in Toolbox (`client-app/src/examples/chatkit/README.md` and
`weatherv2/README.md`) describes its architecture.

## Process notes

- **Concurrency.** The API key allows only a few concurrent connections. Two of the first four
  sub-agents failed with HTTP 429, so work ran at most two sub-agents at a time from then on.
  Failed agents were resumed with their context intact, so nothing was lost.
- **Reviews.** Four review passes ran: core and transport, components, a final kit-wide pass, and
  a Toolbox and live UX pass. Each fed a fix pass. The reports are in `planning/reviews/`.
- **Commit signing.** Commit signing through 1Password failed from late in the session, so the
  final commits waited until signing was available again. The slice 2 work is complete, but it was not yet committed when this report was written. Backups of both working trees are in `/tmp/chatkit-backup/`.
- **npm tags.** npm's `latest` tag points at a snapshot from the initial setup publish, because
  npm tags a package's first publish as `latest`. Correct it at the first real release.
