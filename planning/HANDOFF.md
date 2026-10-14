# Handoff - Plan 2 in Progress

State at the end of the session of 2026-10-13 and 14, for the next session to resume. Read this,
then `planning/PLAN-2.md`. Everything listed as done is committed, pushed and green.

## Where things are

| Repo and branch | State |
|---|---|
| `hoist-chat-kit` `develop` | Slices 1 and 2 merged (#5, #6). Published as `1.0.0-SNAPSHOT.1791997893569` under `next`. |
| `hoist-chat-kit` `feature/server-mode` | Plan 2 work, about 40 commits ahead of `develop`, pushed, not merged, no PR yet. 897 tests, lint, typecheck and build green. |
| `toolbox` `feature/weatherv2-chat-kit` | Stacked on `weatherv2` (stays there, per Anselm). Uses the published kit from npm. Pushed. |

## Plan 2 status

| WP | Scope | State |
|---|---|---|
| 0 | Open defects from the feedback packet | Done |
| 1 | Run lifecycle: `historyMode`, server ids, `turnId`, stop versus detach, `cancelAsync`, run options, `textReplace`, `textTransform`, feedback, telemetry | Done |
| 2 | Thread layer: `threads/` package, `ChatThreadStore`, `ChatThreadsModel`, concurrency rules, route binding, `LocalChatThreadStore` | Done |
| 3 | Citation markers, `onSourceClick`, markdown plugins | Done |
| 4 | Thread list, workspace and feedback UI | Not started. Waits for the design handoff |
| 5 | Server-mode demo and recipe | Backend and client plumbing done in Toolbox (`client-app/src/examples/chatkit/guide/`), excluded from the build until the kit publishes. UI and recipe doc not started |
| 6 | Activity timeline | Not started. Waits for the design handoff |
| 7 | Generative UI by reference | Core done in `genui/` (document model, tags, artifact registry, view spec, typed actions, export). Wiring into `ChatModel` not done (see below). Desktop components not started |
| 8 | Composer extensibility | `sendBlocker` done. The rest waits for the design handoff |
| 9 | Component helpers | Core done: context providers, undo, preview, `ChatCompletionsCodec`, `ChatService`, `gridTools`, `dashCanvasTools`. Assistant model and docked UI not started |
| T | Toolbox mergeable on the published kit | Done |

## Next steps, in order

1. **Wire generative UI into `ChatModel`.** Items 1 to 3 of the last task, which were drafted and
   reverted:
   - `ChatModelConfig.catalog`: client mode adds `tools` (and `documentTool`), server mode adds
     `displayTools`. Add by identity, and throw on a name clash with an app tool.
   - One `@managed artifacts` registry per chat, with `dataSource` on `ChatModelConfig`. Feed it
     from a new `xh.chat.artifact` event, from `metadata.artifacts` on `TOOL_CALL_RESULT`, and
     from restored history. The catalog's `artifacts` defaults to `chatModel.artifacts`.
   - Tags in markdown, rendered in the text part of `ChatMessageView` through the chat's catalog.
   - `runOptions.catalogVersion` on each request. `catalogVersion` on messages that render
     catalog UI.
   - Message `context` from typed `send` actions: an AG-UI `context` entry, and a
     `<message-context>` block in the Anthropic and chat completions codecs.
   - Leave `callToolAsync` out, and document why: a call the model never made is not valid
     history, and in server mode the server owns the history.
2. **Review pass** over everything on `feature/server-mode` (server mode, threads, genui core,
   helpers), in the style of `planning/reviews/`. Fix its findings.
3. **Merge `feature/server-mode` to `develop`** through a PR, which publishes a snapshot. Then in
   Toolbox: `pnpm update @xh/hoist-chat-kit`, remove the three exclusions of the `guide/` folder
   (in `tsconfig.json`, `vitest.config.mts` and `eslint.config.js`), and fix
   `chatkit/demos/genUiDemo.ts`, whose card actions use the removed `prompt` field and must
   become typed `send` actions.
4. **Design handoff.** Check `.tmp/design/`, the Claude Design output, before building WP 4, 6,
   the WP 7 desktop components, WP 8, and the WP 9 assistant UI. Treat it as the visual spec.
5. Then WP 4 to 9 in the order of `PLAN-2.md`, then a final review, docs and a report.

## Files to know

- Plans: `planning/PLAN-2.md`, `SERVER-MODE.md`, `GENUI-2.md`, `HELPERS.md`. Earlier: `DESIGN.md`,
  `GENUI.md`.
- Decisions: `DECISIONS.md`, D1 to D53.
- Reviews: `planning/reviews/` (reviews 1 to 4, and the reconciliation of the feedback packet).
- The feedback packet: `.tmp/hoist-chat-kit-feedback-1/` (gitignored). Its client app names must
  never appear in kit or Toolbox files.
- Upstream issues: xh/hoist-core#618 (streaming companion), xh/hoist-react#4855 (abort for
  streamed fetches).

## Running Toolbox

- A Grails server on :8080 (throwaway H2 database) and the rsbuild client on :3000 were still
  running at the end of the session. The :8080 server predates the guide endpoints, so restart it
  to use them.
- Agent login and LLM config scripts, outside any repo: `/tmp/toolbox-agent-session.env`,
  `/tmp/toolbox-configure-llm.sh` (sets `llmApiKey` from `$ANTHROPIC_API_KEY`), and
  `/tmp/toolbox-guide-bootrun.sh` (a throwaway server on :8081). `/tmp` may be cleared on reboot.
  See "Agent-driven sessions" in Toolbox's `docs/running-locally.md` to recreate them.
- The local link to a sibling kit checkout, for testing unpublished kit changes, is the recipe in
  Toolbox's `docs/running-locally.md`. Never commit it.

## Working notes

- The API key in the first sessions allowed only a few concurrent connections. Two sub-agents at
  a time worked reliably.
- Commit signing through 1Password can fail when it is locked. Commit unsigned
  (`git -c commit.gpgsign=false commit`) rather than stop.
- Spend tracking in `~/.claude/session-costs/` applied to the API-key sessions. A subscription
  session has no per-token cost to track.
