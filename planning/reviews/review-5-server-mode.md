# Review 5 - Server mode, threads, codecs and service

Scope: `core/`, `transport/`, `threads/`, `svc/` and top-level `impl/` on `feature/server-mode`
(HEAD `9689284`, 42 commits ahead of `origin/develop`), with the READMEs of those packages.
Checked against `planning/PLAN-2.md`, `planning/SERVER-MODE.md`, `planning/HELPERS.md` and D19 to
D54. Generative UI, the desktop components, markdown and assist belong to the second reviewer.
Line numbers refer to HEAD.

## Check results

| Check | Result |
|-------|--------|
| `pnpm typecheck` | Pass (exit 0) |
| `pnpm lint` | Pass: eslint, stylelint, prettier all clean |
| `pnpm test` | Pass: 48 files, 922 tests |
| Scratch specs | Five scratch tests in `threads/`, run with `pnpm test`, then deleted. They confirm S-M1, S-M2, S-m1 and S-m2. |
| Anthropic cache order | Checked against Anthropic's prompt caching docs for S-m3. |

Counts: Blocker 0, Major 2, Minor 5, Nit 7.

The run lifecycle holds up well. Stop, detach, clear, load and destroy each abort with the right
reason. A cancel goes out only for a stop with a step in flight. Server ids land in metadata and
never move a kit id. The thread id adopts once, from a creator or `RUN_STARTED`. The overlay in
`ChatThreadsModel` and its list numbering handle stale lists, failed edits and a newer rename over
an older one. Each concurrency rule of section 3.3 has a passing test. The findings below are the
gaps left at the edges.

## Findings

| id | severity | file:line | finding | recommended fix |
|---|---|---|---|---|
| S-M1 | Major | `core/ChatModel.ts:505`, `threads/ChatThreadsModel.ts:458-483`, `threads/README.md:325` | **Confirmed.** A chat counts its thread id as the backend's if it gets both a `threadId` and any `initialMessages`. The thread layer always passes `threadId`. So an app that gives each new thread a greeting, a common pattern, turns off both id paths. The chat never calls `createThreadAsync` (zero store calls in the scratch test), and in server mode it ignores the id on `RUN_STARTED` (the id stays `local-1`). The first run then goes to an id a minting backend does not know. The list, the route and later loads keep that id. Nothing warns. D39 names `initialMessages` on purpose, but it did not foresee a greeting on a new thread. | Count an id as provisional unless the initial messages hold a user message, as a greeting alone is not history. Or add `ChatModelConfig.isNewThread`, and have `openThread` check it for `isNew` chats and throw as it does for a wrong id. Say in the `createChatModel` docs that a new thread's chat must not look loaded. Add a spec. |
| S-M2 | Major | `threads/ChatThreadsModel.ts:536-544,566-579`, `threads/README.md:82-86` | **Confirmed.** A background chat whose turn pauses for approval, or for an interactive tool, is no longer busy. `onBusyChange` then closes it and destroys its `ChatModel` (scratch test: `isAwaitingUser` true, then `isDestroyed` true). The pending question is lost, and nothing in the list shows that the thread waits on the user. In server mode the store has no record of the pause, so a reload shows a call with no result. This breaks the layer's promise that a turn runs on in the background. | Keep a chat open while `isAwaitingUser` is true, as for `isBusy`. Add `awaitingThreadIds` (or fold such threads into a "needs you" state) so the list can show it. Add a spec. |
| S-m1 | Minor | `threads/ChatThreadsModel.ts:387-402,505-518` | **Confirmed.** A delete during the first turn's `createThreadAsync` deletes the local id. The create still succeeds, and the store then holds a thread under its own id that the user deleted. The next list shows it again (scratch test: the list holds "Hello" after the delete). | Before the store delete, await any create in `threadCreates` for the ids, and delete the ids it returned. Or delete both ids. |
| S-m2 | Minor | `transport/codec/AgUiCodec.ts:81-84,229-235`, `transport/README.md:394-396` | **Confirmed.** On a server-mode `continue` step, `AgUiCodec` sends the whole last step: its text, every tool call, and a `tool` message for each. That includes calls the server ran and their results (`srv1-result` in the scratch test). The docs say it sends "its tool calls and the results the client gave them". A server that appends `messages` to its stored history duplicates its own text and tool results. | Send only the client calls' results in server mode (`!providerExecuted`), with the assistant message that holds their calls. Or document that the server must dedupe by tool call id and message id. Add the case to the server-mode spec. |
| S-m3 | Minor | `transport/codec/AnthropicCodec.ts:76-83,101-102,185-191`, `ChatCompletionsCodec.ts:60-62,176` | `AnthropicCodec` appends provider context to the system prompt and says this keeps the cache. Anthropic caches the prefix in the order tools, system, messages, and "any change to [system] ... misses the cache for the system prompt and every cached message after it" (prompt caching docs). A grid helper's context changes after each tool call, so each step rewrites the whole history cache and reads none of it. Only the tools and the static system block stay cached. OpenAI-style prefix caching has the same problem with `ChatCompletionsCodec`. The spec chose the placement (HELPERS 2.1), but the doc claim is wrong and the cost is real. | Fix the doc claim at least. Better: send context as a text block at the end of the last user turn, after the history breakpoint. Anthropic's mid-conversation system messages are another option. Do the same for `ChatCompletionsCodec`. |
| S-m4 | Minor | `threads/README.md:439-442` | The pitfall "Retrying a turn while turns may not overlap" says a retry or regenerate does not wait while another thread runs. The code blocks both (`ChatModel.ts:613,634`), as D35 and D46 say, and a spec checks it ("blocks retry and regenerate while blocked"). The pitfall tells apps the opposite. | Delete the pitfall, or rewrite it: "Retry, regenerate and edit wait too. Resuming a paused turn does not." |
| S-m5 | Minor | `threads/ChatThreadsModel.spec.ts` | No spec covers: a delete that stops a running background turn and sends its cancel (D46), a background chat that pauses (S-M2), a new thread with a greeting (S-M1), a delete during a create (S-m1), and `ChatThreadsModel.destroy()` mid-turn. | Add behavior-named specs for each. |
| S-n1 | Nit | `core/ChatModel.ts:159-163`, `core/README.md:690,710` | The `sendBlocker` docs say only `sendAsync` and `editMessageAsync` do nothing while blocked. `retryAsync` and `regenerateAsync` do nothing too. `sendBlockedReason` also reads blockers added with `addSendBlocker`. | Name all four methods, and the added blockers. |
| S-n2 | Nit | `transport/README.md:1010-1012` | "Write a custom codec" gives "an OpenAI codec" as the example of a codec to write. The kit now ships `ChatCompletionsCodec`. | Use another example, such as the OpenAI Responses API. |
| S-n3 | Nit | `core/ChatModel.ts:827-829` | The feedback revert compares by identity, and a cleared rating is null. Suppose a slow clear fails after a later clear succeeds. Both are null, so the old failure reverts to the rating before it. The user then sees a rating the server no longer has. | Keep a per-message submit counter, and revert only if no later submit started. |
| S-n4 | Nit | `core/ChatModel.ts:739-763` | `isUndoing` blocks undo, but not sends, retries or regenerates. A new turn's tools can run while an async undo restores the same model. | Add `isUndoing` to the checks in `sendAsync` and the re-run methods, or to `sendBlockedReason`. |
| S-n5 | Nit | `transport/SseChatTransport.ts:52-61` | A chunk whose only events are `[DONE]` or data that is not JSON yields nothing, so it does not reset `idleTimeout`. The docs say any data resets it. | Yield `{data: null}` when a chunk produced no record. |
| S-n6 | Nit | `threads/ChatThreadsModel.ts:593-606` | `saveDraft` skips a chat whose run options were set to null, so a reopened thread gets the app's default options back. Drafts of new threads that never ran stay in the map forever, as such threads cannot be selected again. | Save when the options differ from the chat's initial value. Drop the draft of a new thread that never ran when it closes. |
| S-n7 | Nit | `core/ChatModel.ts:1306-1312` | `trackTurn` reports `steps: turn.step + 1`, so a turn stopped during its thread create or context providers reports one step with no request sent. | Count steps that made a request. |
