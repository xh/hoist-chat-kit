# Hoist Blueprints

## Overview

A blueprint is a JSON document that defines a dashboard or a report over an app's data. It names
the widgets to show, the data they read, and the variables that link them. A `BlueprintModel`
opens a blueprint, loads its data through the app's provider, and renders it with Hoist
components. People and LLMs write blueprints, and the same engine checks every edit.

Key features:

- **Data from a catalog.** An app describes its datasets and fields once, in a `DataCatalog`.
  Blueprints name those fields, and the validator refuses any name the catalog does not hold.
- **Hoist widgets.** Each element is a widget from a `BlueprintRegistry`: a Cube grid, a chart,
  stat cards, a dashboard canvas, tabs, buttons and choosers. Apps add their own.
- **Variables.** A variable holds a value that widgets share, such as an as-of date or a grid's
  selection. A prompt, a widget, an action or a resolver sets it.
- **Edits as operations.** An edit is a list of operations on JSON Pointer paths, applied as one
  unit. With any error, nothing applies.
- **Modes and access.** Run mode runs the blueprint. Design mode, which needs write access,
  changes its definition.
- **The Architect.** An LLM builds and edits blueprints through tools that read the catalog and
  the registry, and edit through the same engine.
- **Chat answers.** A UI answer in a chat is a blueprint too, so a user can add it to a dashboard.

## Architecture

```
BlueprintModel
├── blueprint: Blueprint          # The definition, as the model holds it now
├── version: number               # Rises with each edit that changes the definition
├── mode / access                 # Run or design, read or write
├── variables: BlueprintVariable[]
├── catalog: DataCatalog          # The datasets and fields that sources read
├── registry: BlueprintRegistry   # Widgets, variable types, resolvers, actions, renderers
└── Methods:
    ├── setBlueprint()            # Open a blueprint, which must have no errors
    ├── applyEdit()               # Apply operations as one unit, in design mode
    ├── setVariable()             # Set a variable that a prompt, action or the Architect sets
    ├── setMode()                 # Switch mode. Design mode needs write access
    └── runActionsAsync()         # Run an action, or a list of up to 8 as steps
```

A blueprint holds these top-level keys:

| Key | Holds |
|-----|-------|
| `variables` | Values that widgets share, by name, each with a type and what sets it |
| `sources` | Data by name: a dataset with parameters, an artifact, or inline rows |
| `formats` | Named number and date formats |
| `presets` | Named groups of settings, such as column sets, that a user switches between |
| `root` | The ID of the top element |
| `elements` | Each element by ID: its widget, its config, and for a container, its child references |

A source is one of three kinds. Widgets do not know which kind they read.

| Kind | Created by | Runs again | Allowed in |
|------|------------|------------|------------|
| `dataset` | The blueprint | When its parameters change, and on refresh | Any blueprint |
| `artifact` | A tool in a chat, such as `query_dataset` | Never | Chat answers only |
| `inline` | The LLM or a person | Never | Chat answers, or a short list a person writes |

A source loads its rows into a Hoist `Cube`. Each widget reads its source through a Cube `View`,
grouped and filtered for that widget.

## Configuration Pattern

Build the catalog and registry once, at app start. Open a model per blueprint.

```typescript
import {BlueprintModel, BlueprintRegistry, DataCatalog} from '@xh/hoist-chat-kit/blueprint';
import {blueprintView} from '@xh/hoist-chat-kit/desktop/cmp/blueprint';

const catalog = new DataCatalog(catalogJson),
    registry = new BlueprintRegistry({widgets: [tickerWidgetSpec]});

const model = new BlueprintModel({
    blueprint: dashboardJson,
    catalog,
    registry,
    dataProvider: new PortfolioDataProvider(),
    mode: 'run',
    access: 'write'
});

blueprintView({model});
```

`dataProvider` implements `BlueprintDataProvider`: `loadAsync()` for each request, or
`subscribe()` for live rows. See `BlueprintDataProvider.ts`. `FakeBlueprintDataProvider` gives
repeatable rows from the catalog alone, for tests and demos.

## Common Usage Patterns

### Edit a blueprint in code

```typescript
const {version, issues} = model.applyEdit({
    base: model.version,
    ops: [{op: 'set', path: '/elements/posGrid/config/groupBy', value: ['sector']}]
});
```

The operations are `set`, `remove`, `addElement`, `removeElement`, `moveElement` and `renameId`.
A path never indexes into an array: set the whole array. `validateBlueprint()` checks a blueprint
without a model, and returns its issues, each with a stable `code` and a `path`.

### Let the Architect edit a blueprint in a chat

The Architect's tools run in the browser against the model. Give them to the chat, with the
blueprint's context and the Architect's prompt:

```typescript
import {architectPrompt} from '@xh/hoist-chat-kit/blueprint';
import {architectChatTools, blueprintContextProvider} from '@xh/hoist-chat-kit/genui/architect';

const chatModel = new ChatModel({
    tools: architectChatTools(blueprintModel, {catalog: chatUiCatalog}),
    contextProviders: [blueprintContextProvider(blueprintModel)],
    transport
});
const system = architectPrompt({
    catalogs: [catalog],
    registry,
    withAnswers: true
});
```

Send `system` as the model's system prompt, as you send `catalog.toPrompt()` for a chat kit
catalog. The context provider sends, with every step, the version that edits take as base, the
mode and access, and each variable's current value.

| Tool | What it does |
|------|--------------|
| `read_blueprint` | Reads the blueprint, whole or at given paths, with its version |
| `describe_catalog` | Lists datasets, or describes the fields of one |
| `describe_registry` | Lists widgets and other entries, or gives an entry's config schema |
| `edit_blueprint` | Applies an edit, in design mode with write access |
| `validate_blueprint` | Checks the blueprint, or an edit as a dry run |
| `set_variable` | Sets a variable that a prompt or the Architect may set |
| `query_dataset` | Queries a dataset, and returns the result as an artifact of the reply |
| `find_usages` | Finds every path that uses a field, a format, a variable or a source |
| `request_design_mode` | Asks the user, on the chat's approval card, to switch to design mode |
| `read_answer` | Reads an answer of the chat, to add it to the blueprint |

`architectChatTools()` adds `read_answer` only with the chat's `catalog`, and
`request_design_mode` only for a target that can change its mode.

### Answer questions with blueprints in a chat

Give the chat kit catalog the app's data, and `show_ui` takes an answer blueprint. See
[Answer with blueprints](../genui/README.md#answer-with-blueprints). An answer may read the
artifact of a query and hold values the LLM computed inline. Its dataset sources load within the
chat's bounds: only the latest reply loads at once.

### Add a chat answer to a blueprint

Pass `addToBlueprint(model)` as the catalog's `answers.addToHost`. Each complete answer then shows
an "Add to dashboard" button to a user with write access:

```typescript
import {addToBlueprint} from '@xh/hoist-chat-kit/genui/architect';

const chatUiCatalog = new ChatUiCatalog({
    components,
    answers: {dataCatalog: catalog, dataProvider, addToHost: addToBlueprint(blueprintModel)}
});
```

The click switches the blueprint to design mode and asks the Architect to add the answer. Design
mode ends with that turn, unless the user had it on. The Architect reads the answer with
`read_answer`, and translates it. It turns an artifact into a dataset source, reuses the host's
sources and variables, and turns a computed value into a widget over a source.

A user can also ask in their own words. In run mode, the Architect then calls
`request_design_mode`, and edits only if the user approves.

### Mark the fields and entries a blueprint uses

`fieldUsages(blueprint, catalog)` returns each field a blueprint uses, by dataset, with each path
that uses it. `registryUsages(blueprint, registry, catalog)` does the same for widgets,
presentations, variable types, resolvers, actions and renderers. The Architect's `find_usages`
reads the same function, so a panel and the Architect agree.

## Properties/API Reference

### BlueprintModelConfig

| Property | Type | Description |
|----------|------|-------------|
| `blueprint` | `Blueprint` | The blueprint to open. Throws if it has errors. Default none |
| `catalog` | `DataCatalog` | The datasets and fields its sources read |
| `registry` | `BlueprintRegistry` | The widgets and other entries its elements use |
| `dataProvider` | `BlueprintDataProvider` | Loads its dataset sources |
| `mode` | `'run' \| 'design'` | The user's mode. Design takes effect only with write access. Default `run` |
| `access` | `'read' \| 'write'` | The user's access. Default `read` |
| `urlAllowList` | `string[]` | URLs that `openUrl` may open, each an http or https origin with an optional path. Default none |
| `isAnswer` | `boolean` | True for a chat answer, which may hold literal parameters, artifacts and inline rows |
| `artifacts` | `Record<string, string>` | The dataset behind each artifact a chat answer can name |
| `artifactProvider` | `BlueprintArtifactProvider` | The rows of those artifacts |
| `defaultPresentation` | `string` | The presentation a widget draws in when its config names none, such as a chat's `card` |

## Extension Points

- **Widgets.** Register a `WidgetSpec` with a config schema, guidance for the Architect, and a
  desktop component. `addPresentation()` adds another way to draw an existing widget, as chat kit
  adds the `card` that grids and charts take in a reply.
- **Variable types, resolvers, actions and renderers.** Register each in `BlueprintRegistry`. An
  action declares a parameter schema, and the runner checks its parameters before it runs. Give
  an action with side effects `sideEffects: true`, so that it always asks the user to confirm.
- **Data.** Implement `BlueprintDataProvider` over the app's services. Add
  `loadAggregatesAsync()` when the server can roll up groups the browser cannot.

## Common Pitfalls

### Putting chat data in a dashboard

A dashboard loads its data each time it opens, and a chat's artifacts live only in that chat. The
validator refuses an artifact source outside a chat answer. It warns of inline rows there, and
refuses more than 50. Turn an artifact into a dataset source, and a computed value into a widget
over a source.

### Opening a blueprint in design mode by default

A model opens in run mode with read access unless the app says otherwise. Open design mode only
for a user who designs, with write access. In run mode, a change a user makes in a widget stays
transient.

### Trusting the parameters of an action

A model, or a user's input, may have chosen an action's parameters. The runner checks them
against the action's schema, but an app action's `run` must still treat them as untrusted.

## Related Packages

- [`/genui/`](../genui/README.md) - chat kit's catalog, which renders chat answers as blueprints.
- [`/desktop/cmp/genui/`](../desktop/cmp/genui/README.md) - the components that answers draw with.
- [`/core/`](../core/README.md) - `ChatModel`, which runs the Architect's tools.
- hoist-react's Cube and `StatCardStrip`, which blueprint sources and widgets build on.
