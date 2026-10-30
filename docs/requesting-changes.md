# Request a Change to the Kit

How to ask the kit's maintainers for a feature, an API change or a bug fix. This doc is for app
developers and the coding agents that work for them. A request in this shape gets an answer
sooner, and the answer fits the app better.

## Check What the Kit Already Does

Many asks have an answer in the kit today. Before you write one, check these:

- Search the kit's docs with the `hoist-search-docs` MCP tool or the `hoist-docs` CLI. Read the
  Common Pitfalls section at the end of each package README.
- For a setting that should apply across the app, look for the component's static `defaults`,
  such as `ChatSources.defaults`, and for `ChatKit.defaults`. A default reaches a component that
  `chatPanel` renders inside itself, with no new prop.
- For styling, read the Theming section of the
  [desktop chat README](../desktop/cmp/chat/README.md#theming). The `--xh-chat-*` variables and
  the `xh-chat-` BEM class names are the kit's theme contract.
- For the places an app plugs in, read "Where an App Plugs In" in
  [Architecture](./architecture.md#where-an-app-plugs-in).
- Read the CHANGELOG entries since the version you use.

## Write the Request

Write one section per ask, and number the asks so that the answer can refer to each one. Each
section holds these parts:

| Part | What to write |
|---|---|
| Type | Bug, feature request or docs gap |
| Component or API | The kit class, component or config it concerns |
| Current behavior | What the kit does today |
| Need | What the app or its user must be able to do, in one or two sentences |
| Why | The reason behind the need, in terms of the user or the product |
| Requirements | Testable conditions that a fix must meet |
| What you tried | The props, defaults, variables or CSS you tried, and why each falls short |
| Priority | Blocker, needed or nice to have |
| Proposed API | Optional. One shape that would work for you |

State the kit version that you checked against, as the full snapshot version when you use one.

**The Why matters most.** The maintainers serve many apps. They look for the shape that meets your
need and fits every other app. If two reasons lead to different designs, they ask before they
build. A request with its reason skips that round trip. This holds most of all when you ask to
hide something the kit shows on purpose, such as a failure or a status.

**A proposed API is a suggestion.** The kit may meet the need in another shape, such as a
component default in place of a new prop. The answer says what it changed and why.

### Report a Bug

A bug report needs a way to see the bug:

- The steps that show it, starting from a plain `chatPanel` where you can
- The expected result and the actual result
- The stream that shows it, if the bug follows from events: the AG-UI events or the raw records
- Any console errors, in full
- How often it happens, and where it does not

## Keep the Request Generic

A request can leave a secure environment only if it holds nothing private. Leave out client names,
user data, internal URLs and code that is not yours to share. Describe the case in general terms,
such as "a research agent that loads skills". Name the kit's own classes and files freely.

## What the Answer Holds

Each ask gets one of these answers:

- **Landed** - the snapshot to install, an example, and what the app can now remove
- **Landed in another shape** - the same, plus what differs from the ask and why
- **Already supported** - a pointer to the API or the doc
- **Declined** - the reason, and a way to reach the goal today
- **Questions** - what the maintainers need to know before they choose a shape
- **Deferred** - what the ask waits on, such as a design pass

Do not build on a guess about the shape of an open ask. Until it lands, work through the kit's
documented seams. Do not import from an `impl` folder, and do not depend on markup beyond the
theme contract. A workaround through internals can break in any release.

## Template

```markdown
# hoist-chat-kit requests

Checked against `@xh/hoist-chat-kit` <version>.

## Ask 1: <what the app needs, as a short sentence>

- **Type:** Feature request
- **Component:** `ChatStatusRegion`
- **Priority:** Needed

**Current behavior:** ...

**Need:** ...

**Why:** ...

**Requirements:**

- ...

**What we tried:** ...

**Proposed API (optional):** ...
```

## Related

- [Documentation index](./README.md)
- [Architecture](./architecture.md)
- [Desktop chat components](../desktop/cmp/chat/README.md)
