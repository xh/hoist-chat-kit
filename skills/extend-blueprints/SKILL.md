---
name: extend-blueprints
description: Add to what Hoist Blueprints can configure - a new widget, variable type, resolver, action, renderer or date range preset - either as a hoist-chat-kit built-in or as an app's own entry under a dotted name such as `acme.ticker`. Use this whenever a task adds or changes a `WidgetSpec`, `ActionSpec`, `ResolverSpec`, `RendererSpec` or `VariableTypeSpec`, registers something in a `BlueprintRegistry`, writes a blueprint widget's model or component, or asks for "a new blueprint widget", "a gauge/map/timeline widget for dashboards", "an action that publishes", "a resolver for fiscal year start" or "let the Architect use our component". Pairs with design-data-catalog for the data side. Not for writing blueprint JSON with existing widgets (use blueprint-architect).
---

# Extending Blueprints

Each registry entry reaches three readers: the validator, the Architect, and design mode. An
entry that serves only the first renders but goes unused, or used wrongly. This skill is the
workflow. The contracts are in `docs/blueprint-extensions.md`, and the boundaries every entry
keeps are in `docs/blueprint-security.md`. Read both before you start.

In an app, the kit's files are under `node_modules/@xh/hoist-chat-kit/`. With the Hoist Docs MCP
server, read a doc by its id, such as `chat-kit:docs/blueprint-extensions.md`.

## 1. Decide where it goes

- **An app's entry** goes in the app's `BlueprintRegistry` config, under a dotted name. A widget
  carries its `model` and `component` on its spec.
- **A built-in** goes in hoist-chat-kit, under a bare name, only if any Hoist app could use it. It
  renders a hoist-react component. If Hoist lacks the component, build it in hoist-react first,
  as a component any app can use.
- **A sibling first.** Read the specs of the entries closest to yours, and match their shape,
  names and wording. A new widget beside `statCard` reads like `statCard`.

## 2. Write the spec, test first

1. Write a failing spec for the behavior: what the widget renders from a config, what its
   validator refuses, what its demand asks of the source. Built-in widget specs live beside
   their components in `desktop/cmp/blueprint/`, such as `BlueprintDataWidgets.spec.ts`. They
   boot a real Hoist app with `initTestAppAsync()` and read data from
   `FakeBlueprintDataProvider`.
2. Write the spec: the sections "Add a Widget" to "Add Date Range Presets" in
   `docs/blueprint-extensions.md` give each property. For a widget, the config schema and its
   annotations come first, since the validator, the editors and the Architect all read them.
3. Write the model and component under the two widget rules in "Write the model and component".
   Escape every string you hand to Highcharts.
4. Run the specs until they pass, then lint and typecheck.

## 3. Write for the Architect

The Architect chooses an entry from its one-line `summary`, then reads its `guidance` and schema.

- **Summary:** what it is, in at most 15 words, in users' words.
- **Guidance:** when to choose it, over what sibling, and the mistake a model would make with
  it. Say what a value means, not how the code reads it.
- **Descriptions:** on every property whose name does not say what it does, and on every slot.
- **Defaults** in the schema's `default`, never in a description.
- **Example:** a valid element the Architect can copy.

Then prove it. In hoist-chat-kit, add a scenario to the Architect harness in
`docs/planning/blueprints/tools/llm-test`, worded as a user would ask without naming the widget.
Write its hand-written answer, run `pnpm selftest`, and run the scenario on both models with
`pnpm test --scenarios <id> --repeat 2`. A failed check is a guidance or schema problem first.

## 4. Finish the built-in

A built-in is not done until each of these is:

- Registered: `BUILT_IN_WIDGETS` in `blueprint/builtInWidgets.ts`, `BlueprintViewModel`'s
  map, the package index, and the config type exported from `blueprint/index.ts`.
- Listed: the "Built-in Widgets" table in `docs/blueprint-format.md`, and `WIDGETS` in
  `docs/planning/blueprints/tools/check-blueprints.py`.
- Recorded: a CHANGELOG entry, per `docs/changelog-format.md`.
- Seen: rendered in Toolbox, through its Blueprints tab, in run mode and design mode.

An app's entry is done when its specs pass, the app's Architect chooses it from a user's words,
and it renders in the app.
