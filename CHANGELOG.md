# Changelog

## 1.0.0-SNAPSHOT - unreleased

### 🎁 New Features

* Added `ChatModel`, which runs a conversation with an LLM or agent: streamed replies, client
  tools that act on the app, tool approvals, stop, retry, regenerate and edit.
* Added `ChatMessage` and its typed parts (text, reasoning, tool call, file, source, data), with
  `toSpec()` and `loadMessages()` for storing and restoring history.
* Added `HoistChatTransport`, which streams replies from a hoist-core endpoint as NDJSON, and
  `SseChatTransport` for Server-Sent Events servers, such as AG-UI agents.
* Added `AgUiCodec` and `AnthropicCodec`. With `AnthropicCodec`, a Hoist server can relay the
  Anthropic stream unchanged. It supports system blocks, prompt caching and a `prepareBody` hook.
* Added `ScriptedChatTransport`, which replays canned events for tests and demos.
* Added the desktop `ChatPanel` and its parts: message list, message view, composer with
  attachments, tool call cards, reasoning, code blocks, sources and an empty state with
  suggestions.
* Added `ChatMarkdown`, a streaming-safe markdown renderer that re-renders only the block that is
  still growing.

### ⚙️ Technical

* Added a package build check (`pnpm build`) to CI and to both deploy workflows.
* CodeQL now runs only when the repo is public, because code scanning needs GitHub Code Security on
  a private repo.
