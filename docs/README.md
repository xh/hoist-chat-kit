# Hoist Chat Kit Documentation Index

This is the catalog of all Hoist Chat Kit documentation. It lists the package READMEs and the
concept docs, with a description and the key topics of each, for fast and targeted lookup.

## How to Use This Index

**AI coding agents:** Scan the tables below and match the **Key Topics** column against the
classes and patterns you work with. Use the [Quick Reference by Task](#quick-reference-by-task)
table to map a goal to the right doc.

**Application developers:** Start with [Architecture](./architecture.md) for how the parts fit
together. Then read [`/core/`](../core/README.md) for the chat model, and
[`/transport/`](../transport/README.md) to connect it to your server.

**Library developers:** See `CLAUDE.md` at the root of the repository for the development guide,
and [Documentation Conventions](./doc-conventions.md) before you write or change a doc.

The kit builds on Hoist React. For Hoist's own APIs, use the hoist-react documentation index and
its tools.

## Quick Reference by Task

| If you need to... | Start here |
|---|---|
| Understand how the kit fits together | [Architecture](./architecture.md) |
| Add a chat to an app | [`/core/`](../core/README.md#configuration-pattern) |
| Configure a `ChatModel` and its composer | [`/core/`](../core/README.md) |
| Let the model act on the app with client tools | [`/core/`](../core/README.md#configuration-pattern) |
| Ask the user to approve a tool call, with a question of your own | [`/core/`](../core/README.md#ask-for-approval-before-a-tool-runs) |
| Let the user answer a tool call | [`/core/`](../core/README.md#let-the-user-answer-a-tool-call) |
| Save and restore a conversation | [`/core/`](../core/README.md#persist-and-restore-a-conversation) |
| Handle errors, retries and finish reasons | [`/core/`](../core/README.md#handle-errors-and-finish-reasons) |
| Connect to an agent service that owns the history and threads | [`/core/`](../core/README.md#run-a-server-owned-conversation) |
| Send per-turn options, such as a document scope | [`/core/`](../core/README.md#pick-options-per-turn) |
| Stop a run, or leave it running on the server | [`/core/`](../core/README.md#stop-or-detach-a-turn) |
| Send ratings and comments on replies | [`/core/`](../core/README.md#rate-a-reply) |
| Describe the app's live state to the model at every step | [`/core/`](../core/README.md#send-live-context-with-every-step) |
| Let the user undo the changes a reply made | [`/core/`](../core/README.md#undo-a-replys-changes) |
| Add a helper agent beside a grid or a dashboard | [`/assist/`](../assist/README.md) |
| Let the model arrange a grid: columns, sorts, groups, filters | [`/assist/`](../assist/README.md#arrange-a-grid) |
| Let the model arrange a `DashCanvas` and its views | [`/assist/`](../assist/README.md#arrange-a-dashboard) |
| Use the app's configured LLM backend, with no wiring | [`/svc/`](../svc/README.md) |
| Connect to an OpenAI-compatible model gateway | [`/transport/`](../transport/README.md#bring-your-own-llm) |
| List a user's stored threads, and switch between them | [`/threads/`](../threads/README.md) |
| Implement a thread store for your backend | [`/threads/`](../threads/README.md#configuration-pattern) |
| Run turns in the background while the user reads another thread | [`/threads/`](../threads/README.md#let-turns-run-in-the-background) |
| Link to a thread with a route parameter | [`/threads/`](../threads/README.md#link-to-a-thread) |
| Group a thread list into Today, Yesterday and older | [`/threads/`](../threads/README.md#group-the-list-by-recency) |
| Show a user's threads in a sidebar, with rename, pin and delete | [`/desktop/cmp/threads/`](../desktop/cmp/threads/README.md) |
| Show the thread list over threads the app holds | [`/desktop/cmp/threads/`](../desktop/cmp/threads/README.md#back-the-list-with-your-own-model) |
| Put a full-page chat on screen, with a thread sidebar and a side panel | [`/desktop/cmp/workspace/`](../desktop/cmp/workspace/README.md) |
| Fill the workspace's side panel, header or notice line | [`/desktop/cmp/workspace/`](../desktop/cmp/workspace/README.md#common-usage-patterns) |
| Encode a request for a server-owned conversation | [`/transport/`](../transport/README.md#server-owned-conversations) |
| Connect to a hoist-core server | [`/transport/`](../transport/README.md#relay-claude-through-a-hoist-server) |
| Write a Grails controller that streams a model reply | [`/transport/`](../transport/README.md#hoist-server-example) |
| Call Claude, with a system prompt and prompt caching | [`/transport/`](../transport/README.md#relay-claude-through-a-hoist-server) |
| Connect to an AG-UI agent server | [`/transport/`](../transport/README.md#connect-to-an-ag-ui-agent-server) |
| Build a demo or a unit test with no backend | [`/transport/`](../transport/README.md#script-a-demo-or-a-test) |
| Run a transport and fold its events into your own state, without `ChatModel` | [`/transport/`](../transport/README.md#use-a-transport-without-chatmodel) |
| Write a custom transport or codec | [`/transport/`](../transport/README.md#extension-points) |
| Look up a `ChatEvent` or an `xh.chat.*` event | [`/transport/`](../transport/README.md#chatevent) |
| Let the model show Hoist components inline in its reply | [`/genui/`](../genui/README.md) |
| Write a catalog component of your own | [`/genui/`](../genui/README.md#write-a-component-spec) |
| Adapt A2UI, OpenUI or another protocol's UI payload | [`/genui/`](../genui/README.md#adapt-a-protocols-ui-payload) |
| Show grids and charts over a result set by reference | [`/genui/`](../genui/README.md#show-data-by-reference) |
| Put components in a markdown answer as tags | [`/genui/`](../genui/README.md#read-tags-in-a-markdown-answer) |
| Export a catalog for a server that runs the tool loop | [`/genui/`](../genui/README.md#export-the-catalog-for-a-server) |
| Render app content in the chat as a data part | [`/desktop/cmp/chat/`](../desktop/cmp/chat/README.md#render-a-tool-call-as-ui) |
| Learn how AG-UI, A2UI, OpenUI or MCP Apps relate to the kit | [Protocols](./protocols.md) |
| Put a chat panel on screen, with a clear button | [`/desktop/cmp/chat/`](../desktop/cmp/chat/README.md) |
| Customize the composer, the message list or the empty state | [`/desktop/cmp/chat/`](../desktop/cmp/chat/README.md) |
| Theme the chat with CSS variables | [`/desktop/cmp/chat/`](../desktop/cmp/chat/README.md#theming) |
| Add feedback buttons or other message actions | [`/desktop/cmp/chat/`](../desktop/cmp/chat/README.md#add-message-actions-such-as-feedback) |
| Render a tool call or a data part as UI | [`/desktop/cmp/chat/`](../desktop/cmp/chat/README.md#render-a-tool-call-as-ui) |
| Allow markdown images in replies | [`/desktop/cmp/chat/`](../desktop/cmp/chat/README.md#allow-images) |
| Let the model show grids, charts, KPI tiles and cards | [`/desktop/cmp/genui/`](../desktop/cmp/genui/README.md) |
| Render streaming markdown | [`/cmp/markdown/`](../cmp/markdown/README.md) |
| Write or update a doc | [Documentation Conventions](./doc-conventions.md) |

## Package Documentation

### Models and Transports

| Package | Description | Key Topics |
|---------|-------------|------------|
| [`/core/`](../core/README.md) | Platform-neutral chat models: conversation state, the turn loop, messages, parts, tools and the composer | ChatModel, ChatMessage, ChatPart, ChatToolSpec, ChatComposerModel, ChatRunError, ChatContextProvider, contextProviders, chatToolResult, undoTurnAsync, preview, turns, steps, approvals, interactive tools, persistence, finish reasons, historyMode, runOptions, stop and detach, feedback, textTransform, activity tracking |
| [`/threads/`](../threads/README.md) | Platform-neutral thread layer: a store adapter, one chat per open thread, background turns, paging, search, edits with rollback and deep links | ChatThreadsModel, ChatThreadStore, ChatThreadSummary, ChatThreadListHost, LocalChatThreadStore, groupThreadsByRecency, background turns, runningThreadIds, createThreadAsync, re-keying, optimistic rename and delete, paged history, search, route binding, concurrency rules |
| [`/transport/`](../transport/README.md) | Transports and codecs that turn a backend's stream into AG-UI events, with server contracts | ChatTransport, HoistChatTransport, SseChatTransport, ScriptedChatTransport, HttpChatTransport, AgUiCodec, AnthropicCodec, ChatCompletionsCodec, bring your own LLM, OpenAI chat completions, ChatRunContext, ChatEvent, xh.chat events, NDJSON, Grails controller, prompt caching, citationEvents, server-owned conversations, turnId, newMessages, cancelUrl, createChatRunRequest, ChatStreamReducer |
| [`/svc/`](../svc/README.md) | `ChatService`, which resolves the app's default LLM backend from the `chatConfig` soft config | ChatService, XH.chatService, chatConfig, ChatConfig, isEnabled, createTransport, bring your own LLM, codec, anthropic, openai-chat, agui |
| [`/assist/`](../assist/README.md), [`/desktop/assist/`](../assist/README.md#arrange-a-dashboard) | Tool groups for component helper agents: `gridTools`, and `dashCanvasTools` in `/desktop/assist/` | ChatToolGroup, gridTools, dashCanvasTools, GridToolCapability, DashCanvasToolCapability, settingsSchema, helper agents, GridModel, DashCanvasModel, ViewManagerModel, undo, context provider, suggestions |
| [`/genui/`](../genui/README.md) | Generative UI: a catalog of app components the model can show inline, as tools, tags or nested documents, with data by reference, typed actions and a server export | ChatUiCatalog, ChatUiComponentSpec, ChatUiDocument, ChatUiRenderContext, ChatArtifactRegistry, ChatDataView, ChatUiAction, ChatUiAdapter, parseTags, show_ui, JSON Schema subset, partial props, inline display |

### Components

| Package | Description | Key Topics |
|---------|-------------|------------|
| [`/desktop/cmp/chat/`](../desktop/cmp/chat/README.md) | Desktop chat components: panel, message list, message view, composer, tool cards and more | ChatPanel, ChatMessageList, ChatMessageView, ChatComposer, ChatToolCall, ChatClearButton, ChatReasoning, ChatSources, ChatEmptyState, ChatSuggestions, render context, message actions, tool call groups, inline tool calls, citations, approvalPrompt, allowImages, theming |
| [`/desktop/cmp/threads/`](../desktop/cmp/threads/README.md) | Desktop thread list: recency groups, search, inline rename, pin, delete with confirm, and row states | ChatThreadList, ChatThreadListHost, ChatThreadsModel, recency groups, inline rename, pin, delete confirm, running, awaiting, finishedAwayThreadIds, lastRunEnd, listbox, keyboard |
| [`/desktop/cmp/workspace/`](../desktop/cmp/workspace/README.md) | Desktop full-page chat: a thread sidebar and rail, the conversation, header and notice slots, and a side panel, laid out by its own width | ChatWorkspace, ChatWorkspaceModel, sidebar, rail, side panel, header, notice, PanelModel, persistWith, ResizeObserver, breakpoints, compact density |
| [`/desktop/cmp/genui/`](../desktop/cmp/genui/README.md) | Built-in generative UI components for a ChatUiCatalog: a Hoist grid, a Hoist chart, KPI tiles and a detail card | chatUiGridSpec, chatUiChartSpec, chatUiMetricsSpec, chatUiCardSpec, ChatUiGrid, ChatUiChart, ChatUiMetrics, ChatUiCard, ChatUiFrame, fmtChatUiNumber, number formats, compact numbers, streaming |
| [`/cmp/markdown/`](../cmp/markdown/README.md) | Platform-neutral markdown renderer for streaming model output | ChatMarkdown, streaming, block memoization, markdown components, image policy, links, trailingContent |

## Concepts

| Concept | Description | Key Topics |
|---------|-------------|------------|
| [Architecture](./architecture.md) | The kit's layers, the flow of one turn, the two conversation shapes, render performance, extension seams and the platform split | layers, turn flow, conversation shapes, server mode, immutable messages, flush batching, memoization, extension points, desktop, mobile |
| [Protocols](./protocols.md) | How AG-UI, Anthropic, OpenAI, A2UI, OpenUI, MCP Apps and the Vercel AI SDK relate to the kit | AG-UI, Anthropic, OpenAI, A2UI, OpenUI, MCP Apps, generative UI, data parts, Vercel AI SDK, tool states |

## Conventions

| Doc | Description | Key Topics |
|-----|-------------|------------|
| [Documentation Conventions](./doc-conventions.md) | How to write and maintain the kit's docs | README template, index, registry, code examples, anti-patterns |
