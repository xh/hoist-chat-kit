# Progress

Running log of the first build iteration of Hoist Chat Kit. Newest entries go at the top of the
log. `planning/DESIGN.md` holds the build spec, and `DECISIONS.md` holds the design decisions.

## Plan

| Phase | Scope | Status |
|---|---|---|
| 0. Research | Protocols, prior art, the Toolbox `weatherv2` chat | Done |
| 1. Vertical slice | Core models, transports, codecs, streaming markdown, message list, composer, tool cards | In progress |
| 2. First consumer | Toolbox streaming endpoint, `weatherv2` chat on the kit, browser check | Not started |
| 3. CI | Lint, typecheck, tests, package build, CodeQL gate | In progress |
| 4. Broaden | Citations, attachments, code highlighting, approvals, SSE transport, demo pages | Not started |
| 5. Review and docs | Review passes against Hoist conventions, READMEs, architecture doc, report | Not started |

## Log

### 2026-10-13

- Researched agent-to-UI protocols, chat UI prior art, and the `weatherv2` chat. The notes are in
  `planning/research/`.
- Wrote the build spec and the first design decisions.
- Wrote the contract types: parts, events, transport and codec interfaces, tool spec, message
  record, and the public API of `ChatModel` and `ChatComposerModel`.
- Started four parallel work streams. Two failed at once with HTTP 429: the API key allows only
  a few concurrent connections. Parallel work is now capped at two sub-agents at a time.
- Gated CodeQL on repo visibility. Added a package build check to CI and to both deploy
  workflows.
