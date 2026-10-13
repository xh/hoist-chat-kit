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

**Library developers:** See [`/CLAUDE.md`](../CLAUDE.md) for the development guide, and
[Documentation Conventions](./doc-conventions.md) before you write or change a doc.

The kit builds on Hoist React. For Hoist's own APIs, use the hoist-react documentation index and
its tools.

## Quick Reference by Task

| If you need to... | Start here |
|---|---|
| Understand how the kit fits together | [Architecture](./architecture.md) |
| Add a chat to an app | [`/core/`](../core/README.md#configuration-pattern) |
| Configure a `ChatModel` and its composer | [`/core/`](../core/README.md) |
| Let the model act on the app with client tools | [`/core/`](../core/README.md#configuration-pattern) |
| Ask the user to approve a tool call | [`/core/`](../core/README.md#ask-for-approval-before-a-tool-runs) |
| Let the user answer a tool call | [`/core/`](../core/README.md#let-the-user-answer-a-tool-call) |
| Save and restore a conversation | [`/core/`](../core/README.md#persist-and-restore-a-conversation) |
| Handle errors, retries and finish reasons | [`/core/`](../core/README.md#handle-errors-and-finish-reasons) |
| Connect to a hoist-core server | [`/transport/`](../transport/README.md#relay-claude-through-a-hoist-server) |
| Write a Grails controller that streams a model reply | [`/transport/`](../transport/README.md#hoist-server-example) |
| Call Claude, with a system prompt and prompt caching | [`/transport/`](../transport/README.md#relay-claude-through-a-hoist-server) |
| Connect to an AG-UI agent server | [`/transport/`](../transport/README.md#connect-to-an-ag-ui-agent-server) |
| Build a demo or a unit test with no backend | [`/transport/`](../transport/README.md#script-a-demo-or-a-test) |
| Write a custom transport or codec | [`/transport/`](../transport/README.md#extension-points) |
| Look up a `ChatEvent` or an `xh.chat.*` event | [`/transport/`](../transport/README.md#chatevent) |
| Render generative UI or app content in the chat | [Protocols](./protocols.md#generative-ui) |
| Learn how AG-UI, A2UI, OpenUI or MCP Apps relate to the kit | [Protocols](./protocols.md) |
| Put a chat panel on screen | [`/desktop/cmp/chat/`](../desktop/cmp/chat/README.md) |
| Customize the composer, the message list or the empty state | [`/desktop/cmp/chat/`](../desktop/cmp/chat/README.md) |
| Theme the chat with CSS variables | [`/desktop/cmp/chat/`](../desktop/cmp/chat/README.md) |
| Render streaming markdown | [`/cmp/markdown/`](../cmp/markdown/README.md) |
| Write or update a doc | [Documentation Conventions](./doc-conventions.md) |

## Package Documentation

### Models and Transports

| Package | Description | Key Topics |
|---------|-------------|------------|
| [`/core/`](../core/README.md) | Platform-neutral chat models: conversation state, the turn loop, messages, parts, tools and the composer | ChatModel, ChatMessage, ChatPart, ChatToolSpec, ChatComposerModel, ChatRunError, turns, steps, approvals, interactive tools, persistence, finish reasons |
| [`/transport/`](../transport/README.md) | Transports and codecs that turn a backend's stream into AG-UI events, with server contracts | ChatTransport, HoistChatTransport, SseChatTransport, ScriptedChatTransport, HttpChatTransport, AgUiCodec, AnthropicCodec, ChatEvent, xh.chat events, NDJSON, Grails controller |

### Components

| Package | Description | Key Topics |
|---------|-------------|------------|
| [`/desktop/cmp/chat/`](../desktop/cmp/chat/README.md) | Desktop chat components: panel, message list, message view, composer, tool cards and more | ChatPanel, ChatMessageList, ChatMessageView, ChatComposer, ChatToolCall, ChatReasoning, ChatSources, ChatEmptyState, ChatSuggestions, ChatErrorBanner, theming |
| [`/cmp/markdown/`](../cmp/markdown/README.md) | Platform-neutral markdown renderer for streaming model output | ChatMarkdown, streaming, block memoization, markdown components, links |

## Concepts

| Concept | Description | Key Topics |
|---------|-------------|------------|
| [Architecture](./architecture.md) | The kit's layers, the flow of one turn, render performance, extension seams and the platform split | layers, turn flow, immutable messages, flush batching, memoization, extension points, desktop, mobile |
| [Protocols](./protocols.md) | How AG-UI, Anthropic, OpenAI, A2UI, OpenUI, MCP Apps and the Vercel AI SDK relate to the kit | AG-UI, Anthropic, OpenAI, A2UI, OpenUI, MCP Apps, generative UI, data parts, Vercel AI SDK, tool states |

## Conventions

| Doc | Description | Key Topics |
|-----|-------------|------------|
| [Documentation Conventions](./doc-conventions.md) | How to write and maintain the kit's docs | README template, index, registry, code examples, anti-patterns |
