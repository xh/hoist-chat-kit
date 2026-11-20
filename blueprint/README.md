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
- **Design mode for people.** Placeable components edit a blueprint's elements, config,
  variables, sources and presets. Each change is one edit, so undo and history work.
- **Stored blueprints.** A repository that the app provides keeps one shared draft per blueprint
  and numbered publishes, and checks the draft's version on every save.
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

Design mode and storage each add a model over a `BlueprintModel`:

```
BlueprintDesignModel                  # Design mode for people
├── selection: BlueprintSelection     # An element, variable, source or preset group
└── Methods:
    ├── addWidget() / removeElement() / moveElement() / setConfig() / setChildTitle()
    ├── addVariable() / updateVariableDecl() / removeVariable()
    ├── addSource() / changeSourceDataset() / updateSourceDecl() / removeSource()
    ├── addPresetGroup() / addPresetControl() / duplicatePreset() / removePresetGroup()
    └── renameId()                    # Rename an element, variable or source everywhere

BlueprintDocumentModel                # A stored blueprint, open in the BlueprintModel
├── document: BlueprintDocument       # The version open, with the user's access
├── isDirty / isStale
└── Methods:
    ├── openAsync() / createAsync() / reloadAsync()
    ├── saveDraftAsync() / publishAsync()
    └── copyAsync() / deleteAsync() / updateAccessAsync()
```

A blueprint holds these top-level keys:

| Key | Holds |
|-----|-------|
| `variables` | Values that widgets share, by name, each with a type and what sets it |
| `sources` | Data by name: a dataset with parameters, an artifact, or inline rows |
| `formats` | Named number and date formats |
| `presets` | Named groups of settings, such as column sets or a variable's default, that a user switches between |
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

### Build a designer for people

Give a `BlueprintDesignModel` to the view and to the design components. Each component fills its
container, and all of them share the design model's selection:

```typescript
import {hframe, vframe} from '@xh/hoist/cmp/layout';
import {panel} from '@xh/hoist/desktop/cmp/panel';
import {BlueprintDesignModel} from '@xh/hoist-chat-kit/blueprint';
import {
    blueprintView,
    elementInspector,
    elementOutline,
    widgetPalette
} from '@xh/hoist-chat-kit/desktop/cmp/blueprint';

const designModel = new BlueprintDesignModel({blueprintModel: model});

hframe(
    panel({title: 'Add', width: 180, item: widgetPalette({designModel})}),
    blueprintView({model, designModel, flex: 1}),
    vframe({
        width: 440,
        items: [
            panel({title: 'Outline', height: 220, item: elementOutline({designModel})}),
            panel({title: 'Config', flex: 1, item: elementInspector({designModel})})
        ]
    })
);
```

| Component | What a designer does with it |
|-----------|------------------------------|
| `elementOutline` | See the element tree, and select an element |
| `elementInspector` | Edit the selected element's config, remove the element, and edit a tab container's tabs |
| `widgetPalette` | Add a widget, into the selected container or the root |
| `variablesEditor` | Add, rename and remove variables, and set each one's type, writers, default and options |
| `sourcesEditor` | Add, rename and remove sources, and set each one's dataset, parameters, filter and fields |
| `presetsEditor` | Make groups of presets over widgets' preset paths and variables' defaults, and edit their presets |

Each change is one edit by the user, with a description, so undo, redo and history apply. Text
commits on blur or Enter. A refused edit leaves the blueprint as it was, and shows its issues at
the property. A property that presets control shows a badge, and an edit of it changes the active
preset. Design mode needs write access, and a chat answer has none.

### Generate a config editor from a schema

`toEditorSpec(schema)` turns a widget's config schema into a tree of `EditorNode`s, one per
property. The registry's annotations pick an editor: a source select for `x-source`, a field
picker or a `GroupingChooser` for `x-field`, a `FilterChooser` for `x-filter`, and pickers for
`x-format`, `x-renderer` and `x-action`. A property marked `x-binding` can take a variable in
place of a value. A shape with no editor falls back to JSON, so every value stays editable. The
inspector draws these nodes, so a new widget gets an editor from its schema alone.

### Give a config property a default

Give the property JSON Schema's `default`, not a sentence in its description:

```typescript
stripeRows: {type: 'boolean', default: true, description: 'Alternate the background of rows.'}
```

The validator ignores `default`. Design mode shows an unset property at its default, and writes
nothing until the user changes it. The widget applies it, with `configDefault(key)` on
`BlueprintWidgetModel`.

### Save, open and publish blueprints

A `BlueprintDocumentModel` opens a stored blueprint in a `BlueprintModel`, through the app's
repository:

```typescript
import {BlueprintDocumentModel, HoistCoreBlueprintRepository} from '@xh/hoist-chat-kit/blueprint';

const doc = new BlueprintDocumentModel({
    blueprintModel: model,
    repository: new HoistCoreBlueprintRepository()
});

await doc.openAsync(id); // The latest publish, in run mode
await doc.openAsync(id, {as: 'draft'}); // The draft, in design mode, for a writer
await doc.saveDraftAsync();
await doc.publishAsync('Adds the risk view');
```

- **One shared draft, numbered publishes.** Writers edit the draft. A publish copies it as the
  next number and never changes. Readers open only the latest publish.
- **The repository decides access.** Each record carries `access`, `canPublish` and `canShare`.
  A record that does not grant write access opens read-only.
- **One write at a time.** Saves, publishes and copies run in order. A save asked for while
  another runs joins one follow-up save of the latest blueprint.
- **Stale drafts.** If another save landed first, the document turns `isStale`. It keeps the
  user's edits and refuses further saves. Offer `reloadAsync()`, which discards the edits, or
  `createAsync(name)`, which saves them as a new blueprint that records the draft it copies. If
  the user has lost access to that draft, the new blueprint is created without the record, so the
  edits are not lost.
- **Renames for personalizations.** The draft keeps the renames of elements, variables and sources
  since the last publish, and each publish records them.

### Choose a repository

| Repository | Use it for |
|------------|------------|
| `HoistCoreBlueprintRepository` | Blueprints in hoist-core's database, through its `xhBlueprint` endpoints. Enable them in hoist-core with the `xhBlueprintConfig` config |
| `InMemoryBlueprintRepository` | Tests and demos. It keeps nothing, and grants only what its config says: by default, read access |
| Your own | Another store. Implement `BlueprintRepository`, as below |

### Write a repository

Implement `BlueprintRepository`. Its doc comment states the contract in full. The essentials:

- Act for the signed-in user. List only the blueprints that user may read, and fill each record's
  `access`, `canPublish` and `canShare`. Only a server is a security boundary, so refuse drafts
  and older publishes to readers there.
- Refuse a save or publish whose `base` is not the draft's version, with `edit.staleBase`. If the
  server cannot check this atomically, set `enforcesBase` to false, and the library checks first.
- Number each publish as the next one, created only if absent. Publishing increments the draft's
  version, and returns the new version as `draftVersion`.
- Accept a create's `copiedFrom` only if the user may open that version, as `openAsync` would.
  Refuse it with an `httpStatus` of 404, 403 or 400, and the library creates the blueprint
  without it.
- Report a refused save or publish as an issue. Return null from `openAsync` or `copyAsync` for a
  blueprint that is missing or that the user may not open. Reject from any other call.
- Implement `updateAccessAsync` only if the store can share. The library offers sharing only
  then.

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

### BlueprintDocumentModel config

| Property | Type | Description |
|----------|------|-------------|
| `blueprintModel` | `BlueprintModel` | The model that holds the blueprint open |
| `repository` | `BlueprintRepository` | Where blueprints persist. Required |
| `migrate` | `(blueprint) => Blueprint` | Upgrades a blueprint that an older library saved, as it opens. Default none |

## Extension Points

- **Widgets.** Register a `WidgetSpec` with a config schema, guidance for the Architect, and a
  desktop component. `addPresentation()` adds another way to draw an existing widget, as chat kit
  adds the `card` that grids and charts take in a reply.
- **Variable types, resolvers, actions and renderers.** Register each in `BlueprintRegistry`. An
  action declares a parameter schema, and the runner checks its parameters before it runs. Give
  an action with side effects `sideEffects: true`, so that it always asks the user to confirm.
  Give an action for chat answers only `allowedIn: ['answers']`, so the validator refuses it in a
  dashboard.
- **Data.** Implement `BlueprintDataProvider` over the app's services. Add
  `loadAggregatesAsync()` when the server can roll up groups the browser cannot.
- **Storage.** Implement `BlueprintRepository` over another store. See
  [Write a repository](#write-a-repository).
- **Design components.** Each design component takes the design model and nothing else, so an app
  can place it anywhere, or replace it with its own over the same `BlueprintDesignModel`.

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

### Keeping drafts from readers in the browser only

`BlueprintDocumentModel` refuses a draft to a reader, but a browser is not a security boundary.
A repository must refuse drafts to readers on its server, or say in its docs that it cannot.

### Saving over a stale draft

After `isStale`, the document refuses to save, so a second writer cannot overwrite the first.
Do not retry the save. Offer the user a reload, which discards their edits, or a new blueprint
that keeps them.

### Trusting the parameters of an action

A model, or a user's input, may have chosen an action's parameters. The runner checks them
against the action's schema, but an app action's `run` must still treat them as untrusted.

## Related Packages

- [`/genui/`](../genui/README.md) - chat kit's catalog, which renders chat answers as blueprints.
- [`/desktop/cmp/genui/`](../desktop/cmp/genui/README.md) - the components that answers draw with.
- [`/core/`](../core/README.md) - `ChatModel`, which runs the Architect's tools.
- hoist-react's Cube and `StatCardStrip`, which blueprint sources and widgets build on.
