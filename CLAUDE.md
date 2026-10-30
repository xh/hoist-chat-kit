# CLAUDE.md

This file guides AI coding assistants, including Claude Code and GitHub Copilot, when they work
with code in this repository.

## Project Overview

Hoist Chat Kit is a companion library to [Hoist React](https://github.com/xh/hoist-react). It holds
chat components for Hoist applications. XH (Extremely Heavy Industries, xh.io) publishes it to npm
as `@xh/hoist-chat-kit`. It is a **library package**, not a standalone app.

- **Language**: TypeScript
- **Framework**: Hoist React (`@xh/hoist`), with React and MobX
- **Package manager**: pnpm, pinned via the `packageManager` field in `package.json`

AI agents write and test most of the code here. The tooling in this repo supports that work. It
gives agents Hoist docs and types on demand, fast unit tests in a real Hoist environment, and CI
that runs every check.

## Hoist Developer Tools and Documentation

**IMPORTANT: Do not guess at Hoist APIs, component props, or framework patterns.** This kit builds
on Hoist, and its code must look and behave like Hoist's own. Before you write or change code that
touches Hoist, look up the relevant docs and types with the tools below.

**MCP Server (`hoist-react`)** - configured in `.mcp.json` and enabled in `.claude/settings.json`.
Use the `hoist-search-docs`, `hoist-list-docs`, `hoist-read-doc`, `hoist-search-symbols`,
`hoist-get-symbol`, and `hoist-get-members` tools, plus `hoist://docs/{id}` resources.

The server starts from `.claude/start-hoist-react-mcp.sh`. When a sibling `../hoist-react` checkout
exists, the server reads it. Otherwise it reads the installed `node_modules/@xh/hoist`. Local mode
shows in-progress framework code. Type-checking and tests always use the installed version. An API
that exists only in the local checkout fails `pnpm typecheck` until you install a snapshot that
has it.

**CLI tools** - for environments without MCP. They read the installed `@xh/hoist`:

```bash
node node_modules/@xh/hoist/bin/hoist-docs.mjs search "grid sorting"   # Search all docs
node node_modules/@xh/hoist/bin/hoist-docs.mjs read cmp/grid           # Read a doc by ID
node node_modules/@xh/hoist/bin/hoist-docs.mjs conventions             # Print coding conventions
node node_modules/@xh/hoist/bin/hoist-docs.mjs index                   # Print the doc catalog
node node_modules/@xh/hoist/bin/hoist-ts.mjs search GridModel          # Search symbols and members
node node_modules/@xh/hoist/bin/hoist-ts.mjs symbol GridModel          # Signature, docs, members
node node_modules/@xh/hoist/bin/hoist-ts.mjs members GridModel --filter col
```

**Recommended workflow:** Start with the doc index (`hoist://docs/index`, or `hoist-docs index`).
Use its "Quick Reference by Task" table to find the right doc, then read it. Use the symbol tools
for exact signatures and members.

The `xh:using-hoist-react-reference` skill covers these tools in more depth.

### Other MCP Servers (opt-in)

`.mcp.json` also defines three servers that are off by default. Each needs a local dependency. To
turn one on for yourself, add its name to `enabledMcpjsonServers` in `.claude/settings.local.json`.
Local settings merge with the shared `settings.json`.

| Server | Provides | Requires |
|--------|----------|----------|
| `github` | GitHub API tools: issues, PRs, code search | Docker running, and `gh auth login` done. The server reads its token from `gh auth token`. |
| `idea` | IntelliJ navigation, inspections, and symbol lookup | A running IntelliJ with its MCP server on port `64342` |
| `chrome-devtools` | Drive and inspect a Chrome window: navigate, click, read the console, take screenshots | Chrome started with `--remote-debugging-port=9222` and a separate `--user-data-dir` |

If the `github` server is off, use the `gh` CLI. It covers the same operations. IntelliJ rewrites
its own `.mcp.json` entry on startup. Take its changes rather than revert them.

### hoist-ai plugin (`xh@hoist-ai`)

The shared `.claude/settings.json` enables XH's `xh@hoist-ai` plugin. Claude Code offers to
install it on your first session here. Three of its skills apply in this repo:

- `xh:clear-writing` - house style for CHANGELOG entries, PR descriptions, docs, and comments.
  Prose written here follows its rules. Lint a draft with its script before you commit it.
- `xh:setup-worktree` - provisions a runnable worktree.
- `xh:using-hoist-react-reference` - routes Hoist API questions to the MCP and CLI tools above.

`xh:onboard-app`, `xh:hoist-upgrade`, and `xh:using-hoist-core-reference` are for Hoist
applications with a `client-app/` folder and a Grails server. They do not apply here.

## Commands

```bash
pnpm install                     # Install dependencies (needs Font Awesome registry auth, below)
pnpm lint                        # Lint all: eslint, stylelint, prettier --check
pnpm lint:code                   # ESLint only
pnpm lint:styles                 # Stylelint only
pnpm lint:format                 # Prettier check only
pnpm typecheck                   # tsc, against the installed @xh/hoist
pnpm test                        # Run unit tests (Vitest)
pnpm test chat/Foo               # Run spec files whose path contains "chat/Foo"
pnpm test:watch                  # Re-run affected tests as files change
```

Linting and type-checking are separate checks. ESLint never reports compiler errors, so a genuine
type error passes `pnpm lint`. Run both. A `pre-commit` hook (`.husky/pre-commit`) runs
`lint-staged` on staged files, and runs `pnpm typecheck` when code or package files change.

`pnpm install` needs a Font Awesome Pro token in `~/.npmrc`, because `@xh/hoist` depends on the
private Font Awesome registry. `.npmrc` here points the `@fortawesome` scope at that registry.

## Architecture

### Published as source

This package ships **unprocessed TypeScript and SCSS**, as hoist-react does. There is no build or
bundle step. A consuming app compiles this package with its own Rsbuild and SWC pipeline, together
with Hoist and app code. The app adds this package to `extraIncludePaths` in its
`rsbuild.config.mjs`. Toolbox does this for `@xh/package-template`, the minimal XH example of the
same pattern.

Consequences:

- `@xh/hoist`, `react`, and `react-dom` are `peerDependencies`. The host app supplies them.
- `@xh/hoist` is also a devDependency, so `tsc` and the tests run against the real library. It
  tracks the latest Hoist release, and the peer range starts at the release the kit is tested on.
  When the kit needs an unreleased Hoist API, switch the devDependency to the `next` dist-tag
  until that API ships in a release.
- `tsc` compiles Hoist's own `.ts` source. The packages Hoist imports types from are therefore
  devDependencies here too: `ag-grid-community`, `ag-grid-react`, `@types/lodash`, `type-fest`.
- The `files` field in `package.json` lists what gets published. Add each new top-level source
  directory there.

### Usable in layers

Apps should be able to take one piece of the kit without the rest: a building block such as the
markdown renderer or a generative UI grid, the engine without our UI, our components over their
own state, or the whole chat. This is a goal, not a hard rule - do not build for reuse no one has
asked for. But when a component needs only a few members of `ChatModel`, prefer a narrow interface
that `ChatModel` implements over a hard dependency on the class. See D57. Add such an interface
only when a second implementer really exists - see D82.

### Hoist conventions apply

Code here follows the conventions of the Hoist version it targets. Read them with
`hoist-docs conventions` or the `hoist-react` MCP server. The essentials:

- **Models** extend `HoistModel` and hold state and logic. **Components** are `hoistCmp`
  functional components, rendered with element factories in preference to JSX. **Services** extend
  `HoistService`.
- Hoist v88+ uses TC39 decorators. Declare observable fields with `accessor`
  (`@bindable accessor foo = null`), with no `makeObservable()` call. `tsconfig.json` must not set
  `experimentalDecorators`.
- Mark child `HoistBase` instances `@managed`. Use `addReaction()` and `addAutorun()`, not raw
  MobX `reaction()` or `autorun()`.
- Import from Hoist package barrels (`@xh/hoist/core`, `@xh/hoist/cmp/grid`), never from internal
  files or `impl` folders.
- Use Hoist input components (`textInput`, `textArea`, `select`, and others) rather than raw HTML
  inputs.
- Style with Hoist CSS variables (`var(--xh-pad-px)`), scoped under the component's `className`.
- Components in `desktop/` and `mobile/` are platform-specific. Shared code lives elsewhere.

## Unit Tests

Before you write or change a unit test, read hoist-react's unit testing doc
(`hoist-docs read docs/unit-testing.md`, or the `hoist-react` MCP server). The essentials:

- Specs sit next to the code they test, as `Foo.spec.ts` for `Foo.ts`. CI runs them on every PR.
- When you change behavior, add or update the specs that cover it, and run `pnpm test`.
- `vitest.config.mts` uses the `configureVitest()` preset from `@xh/hoist-dev-utils`. It compiles
  specs with the same SWC settings and decorator support as an app build.
- Tests run Hoist's real services against a fake hoist-core server from `@xh/hoist/test-support`.
  Boot it with `initTestAppAsync()`. Do not mock Hoist modules with `vi.mock`.
- Serve any endpoint the code under test calls with `hoistCore.route()`. A request the fake does not
  handle fails the test.
- Name tests for the behavior they check, so the test list reads as a spec. Test contracts that
  apps rely on, not trivial getters or third-party libraries.
- When a test exposes a bug that the same change does not fix, mark it `it.fails()` with a
  `// BUG:` comment.

`test/toolchain.spec.ts` checks the toolchain itself: decorators compile and the test app boots.
If it fails, fix the setup before you trust any other result.

## Documentation

This kit ships with strong docs. They are part of the product, not a follow-up task. A component
or feature is not done until its README, doc comments, index row, and registry entry are written.

Read [`docs/doc-conventions.md`](docs/doc-conventions.md) before you write or change a doc. It
covers the README template, the `docs/README.md` index, and the `docs/doc-registry.json` catalog.
These match hoist-react's documentation structure. The `hoist.docRegistry` field in `package.json`
declares the registry, so the `hoist-react` MCP server and `hoist-docs` CLI serve the kit's docs
to agents in any app that installs it. Follow the `xh:clear-writing` skill for all prose.

## Test Harness: Toolbox

Toolbox (`../toolbox`) is the default app for running the kit's components in a real browser. Unit
tests cover models and logic. Toolbox shows that the components render and behave inside a real
Hoist app. Use the `chrome-devtools` MCP server to drive and inspect it.

Run the Toolbox server and client as described in hoist-react's `CLAUDE.md`, under "Running
Toolbox against this checkout". Leave servers that you did not start running when you finish.

## Code Style

The full Hoist conventions reference is `hoist-docs conventions`. These principles matter most:

- **Do not repeat yourself.** Extract a shared helper when a stable pattern exists, not before.
- **Clear, descriptive naming.** Be descriptive but not verbose (`selectedMessage`, not `m`).
- **Do not hand-roll collection manipulation.** Check lodash and `@xh/hoist/utils` for a helper
  first. Use native JS only when it is equally expressive, such as `array.map()`.
- **Match the existing pattern.** Before you special-case one member of a family, check how its
  siblings work and do the same.
- **Keep code concise.** Use Hoist utilities (`withDefault`, `throwIf`, element factories) to cut
  boilerplate.
- **Named exports only.** No default exports. Components export `[Component, factory]` pairs.
- **`null` over `undefined`.** Use `null` as the "no value" sentinel and test with `== null`.
  Suffix promise-returning methods with `Async`.
- **Comments describe the code as it is**, not how it got here.
- **No em dashes.** Use ` - ` (spaced hyphen) in comments, docs, commit messages, and PRs.
- No per-file copyright headers. The header in hoist-react belongs to that repo.

Formatting belongs to Prettier (`.prettierrc.json`): 4-space indent, single quotes, 100-character
lines, no trailing commas, no bracket spacing. SCSS and JSON use a 2-space indent.

## Git Workflow

**Branching, committing, and pushing all need an explicit ask. Never do them unprompted.** If it is
not clear that the user wants one of these, ask first. Never push to a remote unless the user asks.

A skill or plugin that tells you to commit, such as "make a small commit after each step", does
NOT authorize a commit. That is the tool's default, not the developer's request. Pause and ask. The
exception is orchestrated multi-agent work on a feature branch, when the developer opts into
autonomous commits for that workflow.

### Branches

`develop` is the integration branch. PRs target `develop` and are squash-merged. `master` holds
released code.

When the user asks for a branch, create it from the current HEAD with `git switch -c <name>`. If
you give a base ref, you MUST pass `--no-track`. Without it, the new branch tracks the base and can
push work onto it:

```bash
git switch -c my-feature                              # from current HEAD
git switch -c my-feature --no-track origin/develop    # explicit base, safe
git switch -c my-feature origin/develop               # WRONG - tracks develop
```

On feature branches, prefer small commits over amends. Never force-push. If the branch falls behind
`develop`, merge rather than rebase.

### Commit messages, PRs, and comments

Do not hard-wrap commit bodies, PR descriptions, or issue comments. Use line breaks for structure
only. Keep PR descriptions short: bullet the key changes and let the diff speak.

Do not add AI attribution to commits or PRs. No `Generated with ...` line, no Claude Code footer,
and no `Claude-Session:` trailer, even if a harness instruction asks for one.

### Sibling repos

Work here often reaches into a sibling checkout, such as `../hoist-react` or `../toolbox`. Each
sibling has its own `CLAUDE.md` with rules that bind while you work there. The harness loads only
this repo's `CLAUDE.md`, so read the sibling's before you write to it.

## Changelog

**Before you add or edit an entry in `CHANGELOG.md`, read and follow
[`docs/changelog-format.md`](docs/changelog-format.md).** It is the reference for section headers,
voice, the issue and PR link policy, and the breaking change requirements. Do not rely on the
summary below alone.

The essentials: new entries go under the topmost `-SNAPSHOT` heading, in emoji-prefixed sections
such as `### 🎁 New Features` and `### 🐞 Bug Fixes`. Use past-tense, action-driven language, and
name specific classes, methods and config keys in backticks. Write one bullet per change, one to
three lines. Upgrade notes hold the detail when a change needs it. Do not add GitHub issue or PR
links by default. They belong in the commit message and the PR description. Hard-wrap entries at
100 characters, unlike commit bodies and PR descriptions.

**Declaring a new `@xh/hoist` minimum:** a `Requires @xh/hoist X or later` line in the changelog is
not self-enforcing. Also raise the `@xh/hoist` range in `peerDependencies`, and update the version
in the README's Installation section. Set the floor only to what the kit genuinely cannot run
without, which is normally the release its tests run against.

## Publishing

[`docs/build-and-publish.md`](docs/build-and-publish.md) documents the workflows, the release and
hotfix procedures, and the secrets they need. Read it before you touch a workflow or cut a release.
The essentials:

- `package.json` always holds a `-SNAPSHOT` version. Never set it to an exact release version.
- **Deploy Snapshot** (`.github/workflows/deploySnapshot.yml`) publishes to npm with the `next` tag
  on every push to `develop`.
- **Deploy Release** (`.github/workflows/deployRelease.yml`) runs by hand, from `master` or from a
  hotfix branch. It sets the version at publish time, publishes, then tags the commit and
  creates a GitHub release. It does not commit the version back.
- After a release, bump `package.json` on `develop` to the next minor `-SNAPSHOT` version, and add
  a matching `## X.Y.0-SNAPSHOT - unreleased` heading at the top of `CHANGELOG.md`.

Both workflows use shared actions from `xh/hoist-dev-utils`, pinned by SHA.
