# Feedback 1 - Reconciliation Against Current Code

Inputs: `.tmp/hoist-chat-kit-feedback-1/review-2026-10-13-detailed.md` (K, C, G, T, P ids),
`review-2026-10-13-summary.md` (decisions), and `enterprise-requirements-synthesis.md` section 9
(S9-n) plus the section 2 claims.

Code checked: kit `feature/chat-kit-v1-broaden` at `0092f4c`. The fixes landed in `e09e93d`, and
`develop` has not moved. Toolbox `feature/weatherv2-chat-kit` at `78ff0430`. Line numbers refer to
those commits.

Repros: one throwaway Vitest spec, run in the repo, then removed. A copy is in
`/tmp/reconcile/reconcile-tmp.spec.ts`. Results are quoted as "Repro".

Counts: Fixed 29, Still open 32, Disputed 1, Obsolete 1.

## Findings

| Source and id | Finding (short) | Status | Evidence (file:line) | Notes |
|---|---|---|---|---|
| Review K1 | `transport/` imports runtime code from `core/impl` | Fixed | `impl/abort.ts`, `impl/ids.ts`, `transport/impl/streams.ts:2`, `transport/ScriptedChatTransport.ts:5-6` | Moved to a shared top-level `impl/` |
| Review K2 | Renderer signatures differ | Fixed | `core/ChatModel.ts:82,92-98`, `core/ChatToolSpec.ts:81` | Both are `(part, context)`, with `context = {chatModel, messageId}`. `getMessage()` added at `ChatModel.ts:462` |
| Review K3 | `placeholder` and `maxRows` on the composer model | Fixed | `desktop/cmp/chat/ChatComposer.ts:29,32`, `impl/ChatComposerLocalModel.ts:37-39` | Both are now props |
| Review K4 | `fetchOpts.signal` replaces Hoist's aborter, so Hoist's `timeout` cannot abort the fetch. The ordering is undocumented | Still open | `transport/HttpChatTransport.ts:109-126`. Hoist `svc/FetchService.ts:457-464` spreads `fetchOpts` last | The comment explains the signal but not the lost Hoist abort. D14 notes the `FetchOptions.signal` proposal |
| Review K5 | `cacheControl` adds a system breakpoint even when the app marked one | Fixed | `transport/codec/AnthropicCodec.ts:68-69,261,282-285` | Skips the system breakpoint if any system block is marked. Also caps the total at 4 |
| Review K6 | DESIGN says `renderNDJSON` buffers 8 KB | Still open | `planning/DESIGN.md:312` | It is 32 KB. Moved from line 261 |
| Review K7 | D14 says `AbortSignal.any` needs a 2024+ browser without noting it is within Hoist targets | Still open | `DECISIONS.md:161` | Unchanged |
| Review C1 | Chat and markdown READMEs missing | Fixed | `desktop/cmp/chat/README.md`, `cmp/markdown/README.md` | Every README path in `docs/doc-registry.json` resolves |
| Review C2 | `message` passed to every tool card re-renders all cards on every flush | Fixed | `desktop/cmp/chat/ChatMessageView.ts:131-134,410,412` | Stable context from `useMemo([chatModel, message.id])` |
| Review C3 | `spec.renderer` runs on every render, even when collapsed | Fixed | `desktop/cmp/chat/ChatToolCall.ts:66-68,114-120,150-157` | `hasBody` comes from data. The body is a memoized `hoistCmp` that mounts only when expanded |
| Review C4 | Interactive tool waiting on the user shows a "Pending" spinner | Fixed | `desktop/cmp/chat/impl/ToolCallStatus.ts:12-14,34-38` | Shows the hand icon and "Waiting for you" |
| Review C5 | `onWheel` unsticks when the viewport cannot scroll | Fixed | `desktop/cmp/chat/impl/ChatMessageListLocalModel.ts:80-83` | Checks `scrollHeight > clientHeight` |
| Review C6 | `closeInlineSyntax` ignores `_`. `'Next is ***'` becomes `'Next is ******'` | Still open (narrowed) | `cmp/markdown/impl/StreamingMarkdown.ts:151,183-191`, spec `StreamingMarkdown.spec.ts:81-87` | Underscore half fixed, with specs. Repro: `closeMarkdownSyntax('Next is ***')` returns `"Next is ******"` |
| Review C7 | Unmatched citation numbered `idx + 1` collides with a real source and is dropped | Fixed | `desktop/cmp/chat/impl/ChatCitations.ts:38-54,76-91`, `ChatCitations.spec.ts` | References are keyed and numbered once per message |
| Review C8 | Five components omit `model: false` | Disputed | `ChatMessageView.ts:130`, `ChatToolCall.ts:56`, `ChatReasoning.ts:44`, `ChatSources.ts:30`, `impl/ChatCopyButton.ts:25` | Each calls `useLocalModel()`. Hoist throws for that when the model spec is falsy: `@xh/hoist/core/model/Hooks.ts:49-53` |
| Review C9 | Model-authored markdown loads any http(s) image. A file part with `url` renders an `img` | Still open (narrowed) | Fixed for markdown: `cmp/markdown/ChatMarkdown.ts:60,100-109`, D16. Open: `desktop/cmp/chat/ChatFileChip.ts:40,72-75`, `ChatMessageView.ts:400-401` | An assistant file part (`xh.chat.file`, `core/impl/ChatStreamReducer.ts:416-424`) with an image `url` loads it with no policy |
| Review C10 | `useOnResize(fitInput)` keeps the first render's closure | Fixed | `desktop/cmp/chat/ChatComposer.ts:69-76`, `impl/ChatComposerLocalModel.ts:37-44` | `fitInput` is on the local model and reads current props |
| Review C11 | Edit box uses a magic `12` for max rows | Still open | `desktop/cmp/chat/ChatMessageView.ts:289` | - |
| Review C12 | `ChatMessageListLocalModel` captures the first `model` | Fixed | `desktop/cmp/chat/impl/ChatMessageListLocalModel.ts:22` | `@lookup(ChatModel)` |
| Review C13 | `@debounced(1500) resetCopied` not cancelled on destroy | Still open | `desktop/cmp/chat/impl/ChatCopyButton.ts:65-68` | Hoist `@debounced` keeps a lodash `debounce` with no cancel |
| Review C14 | `.xh-app & ... .xh-button.bp6-button` override repeated across SCSS files | Still open | 9 files, e.g. `desktop/cmp/chat/ChatToolCall.scss:31` | No mixin in `styles/` |
| Review C (untested list) | Specs for underscore emphasis, `***`, IME, citation numbering, consecutive blockquotes | Still open (narrowed) | Added: `StreamingMarkdown.spec.ts:81`, `ChatComposer.spec.ts:37-38`, `ChatCitations.spec.ts`. Missing: `***`, blockquotes in `splitMarkdownBlocks` | - |
| Review G1 | Unsupported schema keywords pass silently | Still open | `genui/impl/validateSchema.ts:31,59`. No keyword check in `genui/ChatUiCatalog.ts:76-94` | Repro: `$ref`, `allOf`, `exclusiveMinimum`, tuple `items`, `prefixItems`, `uniqueItems` and `not` all return `[]`. Now documented as a choice: `genui/README.md:302-306,369-372` |
| Review G2 | Full schema walk on every flush for every catalog call, and `render` cannot use hooks | Fixed | `desktop/cmp/chat/ChatToolCall.ts:150-157`, `genui/ChatUiCatalog.ts:202-213,231-239` | Validation runs only when the part changes. `chatUiComponent` owns hooks |
| Review G3 | No genui README, index row, registry entry or CHANGELOG. Protocols says "next deliverable" | Fixed | `genui/README.md`, `docs/README.md:41-43,64`, `docs/doc-registry.json:165`, `CHANGELOG.md:43-51`, `docs/protocols.md:132`, `DECISIONS.md` D15 Update | - |
| Review G4 | `key in properties` lets inherited keys bypass `additionalProperties: false` | Still open | `genui/impl/validateSchema.ts:129` | Repro: `{toString}`, `{constructor}` and `{"__proto__": ...}` return `[]`, while `{zzz}` reports "unknown property" |
| Review G5 | `new RegExp(pattern, 'u')` compiled per check, and throws in render for a pattern that is invalid with `u` | Fixed | `genui/impl/validateSchema.ts:89-95,260-272`, spec `validateSchema.spec.ts:117` | Cached, and a bad pattern becomes an error message. Repro: `'^\\_+$'` returns one error, no throw. It is not rejected at catalog construction |
| Review G6 | Inline component renders for `output-denied` and `approval-requested` | Still open (narrowed) | `desktop/cmp/chat/ChatToolCall.ts:217`, `impl/ToolCallStatus.ts:87` | Catalog tools never set `needsApproval` (`ChatUiCatalog.ts:186-214`), so this needs an app inline tool with approval. Repro: a denied inline call shows both its renderer output and "Denied - not shown." |
| Review G7 | `ChatDataRenderer` gained a third positional argument | Fixed | `core/ChatModel.ts:82` | Same as K2 |
| Review G8 | Each component description is sent twice per request. "the most rows or items" reads awkwardly | Still open | `genui/ChatUiCatalog.ts:189,272,259` | - |
| Review G9 | No specs for G1, G4, G6, or the inline `ChatToolCall` | Still open (narrowed) | Inline status covered: `desktop/cmp/chat/impl/ToolCallStatus.spec.ts`. No specs for G1, G4 or G6 | - |
| Review G10 | `execute` returns a fixed "Rendered X" result | Still open | `genui/ChatUiCatalog.ts:200` | Nit |
| Review G11 | `getComponent` runs `find` on every call | Still open | `genui/ChatUiCatalog.ts:97-99` | Nit |
| Review G12 | `validate` TSDoc says "then its `validate`" with no condition. Keyword list only in TSDoc | Still open (narrowed) | `genui/ChatUiCatalog.ts:101-105`. List now in `genui/README.md:302-320` | The TSDoc sentence is unchanged |
| Review T1 | `link:` dependency, aliases and tsconfig `paths` block a merge | Still open | Toolbox `client-app/package.json:46`, `client-app/rsbuild.config.mjs:26-44,60`, `client-app/tsconfig.json:21-29`, `weatherv2/README.md:106-125` | Blocker |
| Review T2 | Exact prerelease pin of `@xh/hoist` | Fixed | Toolbox `client-app/package.json:45` (`"next"`), commit `fa0c8baf` | - |
| Review T3 | Relay forwards the client body with only `model`, `max_tokens` and `stream` overridden | Fixed | Toolbox `LlmService.groovy:30-41,147-189` | Key allowlist, server tools rejected, message and size caps, params from config. It does not require `input_schema` on client tools |
| Review T4 | No `X-Accel-Buffering: no` | Fixed | Toolbox `LlmController.groovy:37` | - |
| Review T5 | `generate` endpoint and `JSONClient` have no caller | Fixed | Toolbox `LlmController.groovy`, `LlmService.groovy` | Removed |
| Review T6 | Rate limit counts every model step. `maxSteps` defaults to 10 against `llmRateLimit` 20 | Still open | Kit `core/ChatModel.ts:230`. Toolbox sets no `maxSteps`. `BootStrap.groovy:221-225` | Now documented (config note, `LlmService.groovy:40-41`), but neither number changed |
| Review T7 | weatherv2 README documents the temporary link setup, uses em dashes, and has no CHANGELOG entry | Still open (narrowed) | Toolbox `weatherv2/README.md:106-125`. `CHANGELOG.md` has no entry for the kit, the Chat Kit app or `/llm/stream` | Em dashes are gone. The rest waits on T1 |
| Review T8 | Double cache breakpoint in Toolbox | Fixed | Kit side, see K5 | - |
| Review T9 | No connect timeout. Thread use not documented | Fixed | Toolbox `LlmService.groovy:72-94`, kit `transport/README.md:415` | 10 s connect timeout, pool capped by `llmMaxStreams` |
| Review D (note) | nginx entry points omit the new apps | Still open | Toolbox `docker/nginx/app.conf:52` | Omits `weatherv2` and now `chatkit` (`client-app/src/apps/chatkit.ts`) |
| Review P1 | PROGRESS phase table stale | Fixed | `PROGRESS.md:8-16` | - |
| Review P2 | Review 2 untriaged | Fixed | `e09e93d`. Review 3 confirms C-01 to C-37 | - |
| Review P3 | README says Toolbox Weather V2 uses the kit, which is true only on an unmerged branch | Still open | `README.md:104` | - |
| Review P4 | Em dashes in workflow comments | Still open | `.github/workflows/deployRelease.yml:1,130`, `deploySnapshot.yml:1` | - |
| Review P5 | PR #6 body promises more than the branch holds | Fixed | PR #6 body matches the branch | No longer a draft |
| Review course corrections | CC1 to CC5 | Obsolete (sequencing only) | `git log origin/develop..HEAD` | The fixes landed on the broaden branch, not on `develop` before a rebase. Each CC's content is tracked in its ids above |
| Summary decision | Model-authored images | Fixed | `DECISIONS.md` D16, `cmp/markdown/ChatMarkdown.ts:60` | Blocked by default. File chips: see C9 |
| Summary decision | Toolbox branch stacks on unmerged `weatherv2` | Still open | `origin/weatherv2` is 57 commits ahead of `origin/develop` and not merged | Blocks the Toolbox merge along with T1 |
| Synthesis S9-1 | A failed backend tool shows as a success | Still open | `core/impl/ChatStreamReducer.ts:372-384`, `transport/ChatEvent.ts:258-266` | Repro: `TOOL_CALL_RESULT` with any error flag gives `output-available`. No `xh.chat.toolError` event |
| Synthesis S9-2 | No error boundary per message or part | Still open | No `errorBoundary` anywhere in `core/`, `desktop/`, `cmp/` or `genui/` | Repro: one throwing data renderer makes `chatMessageList` throw, and the whole list fails to render |
| Synthesis S9-3 | Renderer signatures differ and re-render on every flush | Fixed | See K2, C2, C3 | - |
| Synthesis S9-4 | Two READMEs missing | Fixed | See C1 | - |
| Synthesis S9-5 | Remote images in model markdown and `ChatFileChip` | Still open (narrowed) | See C9 | Markdown is blocked with an allow-list function. File chips still load `url` |
| Synthesis S9-6 | `headers` static, no idle timeout | Still open (narrowed) | `transport/HttpChatTransport.ts:20-36,121` | `headers` may be a sync function. `url` and `params` are static, nothing is async, and there is no `idleTimeout` |
| Synthesis S9-7 | `canSend` fixed, composer settings fixed | Still open | `core/ChatComposerModel.ts:42-46,77` | `readonly` settings, no `sendBlocker` |
| Synthesis S9-8 | `AgUiCodec` always sends `state: {}` | Still open | `transport/codec/AgUiCodec.ts:81` | - |
| Synthesis S9-9 | Suggestions keyed by text | Fixed | `desktop/cmp/chat/ChatSuggestions.ts:46-49` | Key is `${idx}-${text}` |
| Synthesis S9-10 | Server example relays the body unchecked | Still open (narrowed) | Toolbox fixed (T3). Kit `transport/README.md:543` still posts `request + [...]` | Prose caution at `transport/README.md:599-601`, but the example has no allowlist |
| Synthesis section 2 gaps | Browser-minted assistant ids, `RUN_STARTED` ignored, no server cancel, English labels, sources always open a new tab, no windowing, `createdAt` never shown | Still open (roadmap gaps, not defects) | e.g. `core/ChatModel.ts:724`, `core/ChatModel.ts:320`, `desktop/cmp/chat/ChatSources.ts:86` | Track as v1 roadmap items, not fixes. The approval label is now overridable with `approvalPrompt` (`ChatToolCall.ts:164-167`) |

## Still open, by severity

**Blocker**
1. T1 - the Toolbox `link:` dependency, rsbuild aliases and tsconfig `paths`. CI cannot install
   or build without the sibling checkout.
2. The Toolbox branch stacks on unmerged `weatherv2` (57 commits).

**Major**
3. S9-1 - a backend tool failure renders as a success. `setToolResult` always sets
   `output-available` (`ChatStreamReducer.ts:372-384`). Reproduced.
4. S9-2 - no error boundary. One throwing renderer takes down the whole message list. Reproduced.
5. G1 - unsupported schema keywords (`$ref`, `allOf`, `not`, `exclusiveMinimum`, tuple `items`,
   `uniqueItems`) pass silently. Now documented, but the catalog's safety claim still depends on
   app schemas avoiding them. Reproduced.

**Minor**
6. G4 - inherited keys (`toString`, `constructor`, `__proto__`) bypass
   `additionalProperties: false` (`validateSchema.ts:129`). Reproduced.
7. G6 - a denied inline call still shows its component under "Denied - not shown."
   (`ChatToolCall.ts:217`). Reproduced. Catalog tools are not affected by default.
8. C9 / S9-5 - assistant file parts with an image `url` load it with no image policy
   (`ChatFileChip.ts:72-75`).
9. S9-10 - the kit README's server example still relays the client body unchecked
   (`transport/README.md:543`).
10. T6 - `maxSteps` 10 against a 20-calls-per-hour limit. Documented, not changed.
11. T7 - the weatherv2 README documents the link setup, and there is no Toolbox CHANGELOG entry.
12. nginx `app.conf:52` omits `weatherv2` and `chatkit`.
13. G8 - component descriptions sent twice per request.
14. C6 - `'Next is ***'` streams as `'Next is ******'`. Reproduced.
15. S9-6, S9-7, S9-8 - static `url` and `params`, no idle timeout, fixed composer settings,
    `AgUiCodec` `state: {}`.
16. K4 - the lost Hoist timeout abort is undocumented in `HttpChatTransport.ts:109-126`.
17. P3 - `README.md:104` claims Toolbox usage that is not merged.
18. G9 and the untested list - no specs for G1, G4, G6, `***` or consecutive blockquotes.

**Nit**
19. K6 (`DESIGN.md:312`, 8 KB), K7 (`DECISIONS.md:161`), C11 (`ChatMessageView.ts:289`), C13
    (`ChatCopyButton.ts:65-68`), C14 (SCSS override repeated in 9 files), G10, G11, G12 (TSDoc
    sentence), P4 (workflow em dashes).
