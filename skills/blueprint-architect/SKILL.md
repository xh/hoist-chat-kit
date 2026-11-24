---
name: blueprint-architect
description: Write or edit Hoist Blueprint JSON by hand, as a coding agent - an app's seeded or built-in blueprints, a demo's dashboards, chat answer fixtures, and the scenario blueprints in hoist-chat-kit's planning folder. Use this whenever a task creates or changes a blueprint file or a blueprint literal in code (a `.json` with `root` and `elements`, a `Blueprint` object, an edit's `ops`), seeds blueprints into a repository, or asks to "build a dashboard blueprint", "add a widget to the seeded dashboard", "fix this blueprint's validation errors" or "write the expected answer for this scenario". Not for the in-app Architect, which has its own system prompt, and not for adding new widget types (use extend-blueprints).
---

# Blueprint Architect

Write blueprints the way the in-app Architect does, and check them the way the kit checks them.
A blueprint that passes `validateBlueprint` can still be a poor one: literal dates that freeze,
values that never reach a prompt, a selector no one can find. The Architect's rules catch those.

In an app, the kit's files are under `node_modules/@xh/hoist-chat-kit/`. The paths below are from
the kit's root. With the Hoist Docs MCP server, read a doc by its id, such as
`chat-kit:docs/blueprint-format.md`.

## Before you write

1. Read the format reference, `docs/blueprint-format.md`, for the sections the task touches.
2. Read the app's `DataCatalog`: each dataset's params, `key` and fields, with their types, kinds,
   dimensions and guidance. Never guess a field name.
3. Read the schema and guidance of each widget you use. Built-ins are in
   `blueprint/builtInWidgets.ts`, one `WidgetSpec` each. An app's are in its
   `BlueprintRegistry` config, under dotted names such as `acme.ticker`.
4. Read the Architect's rules in `blueprint/architect/architectPrompt.ts`: the `FORMAT`,
   `EDITING` and `ANSWERS` sections. They bind you as they bind the Architect, and stay the one
   home for those rules. This skill adds only what a coding agent needs beyond them.

## What a coding agent adds

The prompt's rules assume the Architect's tools. Writing files by hand, also:

- **Leave `schema` to the library**, except in a fixture that tests it. The library writes the
  version map on save.
- **Give a seed a stable id and one type.** A seeded blueprint keeps one id, its token, in every
  environment, and belongs to one repository type, such as `acme.dashboard`. Use only that
  type's widgets and datasets.
- **Write a fixture's answer as the Architect should.** A scenario's hand-written answer is the
  bar the models are measured against, so it follows every rule, including the ones the
  validator only warns of.

## Check your work

- **Validate the whole blueprint.** `validateBlueprint(blueprint, {catalog, registry})` returns
  every issue, with a stable `code` and a `path`. Pass `isAnswer: true` for a chat answer. Fix
  every error, and fix or justify every warning.
- **Keep a spec for seeds.** In an app, add a unit test that loads each seeded blueprint and
  expects no errors against the app's real catalog and registry. A catalog change that breaks a
  seed then fails the build.
- **In hoist-chat-kit's planning folder**, run `python3 docs/planning/blueprints/tools/check-blueprints.py`
  for the scenario blueprints, and `pnpm selftest` in `docs/planning/blueprints/tools/llm-test`
  for the harness's hand-written answers and edits.
- **Open it.** Render the blueprint in the app, in run mode and design mode, before you call it
  done. The validator cannot see a layout that reads badly.

## Write an edit instead of a file

When the task changes a stored blueprint through the library, write an edit, not a new document:
`{base, description, ops}`. The ops are in
[Change a Blueprint with Edits](../../docs/blueprint-format.md#change-a-blueprint-with-edits).
An edit applies whole or not at all, so after a refusal, fix each issue's path and send the whole
edit again.
