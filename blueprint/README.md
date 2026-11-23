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
    ├── restoreAsync() / rollbackAsync() / updatePublishAsync()
    └── copyAsync() / renameAsync() / deleteAsync() / updateAccessAsync()
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

[Blueprint Format](../docs/blueprint-format.md) is the reference for every key, rule and value
form. [Blueprint Security](../docs/blueprint-security.md) covers what a blueprint, an answer and a
link can reach.

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

### Share values between widgets

A variable holds a value that widgets read with `{"$var": name}`: an as-of date from a prompt, a
fund from a `select`, or a grid's selection as a filter. Its `setBy` names every writer, so a
widget's config never names the variable it writes. A source param always binds a variable. See
[Share Values with Variables](../docs/blueprint-format.md#share-values-with-variables).

### Read and join data

A source names a dataset and binds its params, and every widget on it shares one request. A
source's `filter` runs on the server, and a widget's in the browser. A source can `join` fields
from other sources on a shared key, and each dataset's `key` sets how each joined field rolls up.
See [Read Data from Sources](../docs/blueprint-format.md#read-data-from-sources) and
[Join Sources](../docs/blueprint-format.md#join-sources).

### Place toolbars and header items in slots

A container holds named slot lists beside `children`: a `panel`'s `tbar`, `bbar` and
`headerItems`, and a `dashboard` cell's `headerItems`. An element sits in exactly one slot list
of one parent. `addElement` and `moveElement` take a `slot`, and `of` for a slot on a child
reference. See [Lay Out Elements](../docs/blueprint-format.md#lay-out-elements).

### Let users switch views with presets

A preset group holds named sets of values for paths that widgets declare, such as a grid's
columns. A `presetSelector` shows the group in the header of the widget it controls, and switches
the active preset. A group with no selector stays at its default. See
[Switch Views with Presets](../docs/blueprint-format.md#switch-views-with-presets).

### Run actions from buttons

A `buttonGroup` button runs an action, or up to 8 as steps: `setVariable`, `resetVariable`,
`refresh`, `navigate`, `openUrl`, or an app's own. The runner checks every step before the first
runs, and an action with side effects asks first. `openUrl` opens only URLs on the model's
`urlAllowList`. See [Run Actions](../docs/blueprint-format.md#run-actions).

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

Beside a designer, add `uiContextProvider(designModel)` to `contextProviders` and pass
`withUiContext: true` to `architectPrompt()`. Each step then says what the user selected, with
its widget, container and dashboard cell, and the active tabs and presets, so a request such as "make
the selected widget taller" has a target. When a request needs a target and the user selected
nothing, the Architect asks. It never changes the selection. Its context sits after the prompt's
cache point, so it costs a few tokens a step and keeps the cache.

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
| `list_blueprints` | Lists the published blueprints of this one's type, with the variables a link may set, for an `openBlueprint` target |
| `request_design_mode` | Asks the user, on the chat's approval card, to switch to design mode |
| `read_answer` | Reads an answer of the chat, to add it to the blueprint |
| `request_feature` | Sends the app a request for a capability the registry lacks, once the user approves it |

`architectChatTools()` adds `read_answer` only with the chat's `catalog`, `request_design_mode`
only for a target that can change its mode, `request_feature` only with a `featureRequests` sink,
and `list_blueprints` only for a model that a `BlueprintDocumentModel` holds, whose repository it
lists.

### Take feature requests from the Architect

When a user asks for something no registry entry can do, the Architect builds the closest
supported way, then offers a feature request. Give it a sink, and tell its prompt:

```typescript
const featureRequests: FeatureRequestSink = {
    submitAsync: request => XH.postJson({url: 'blueprints/featureRequest', body: request})
};
architectChatTools(blueprintModel, {catalog: chatUiCatalog, featureRequests});
architectPrompt({catalogs: [catalog], registry, withAnswers: true, withFeatureRequests: true});
```

- The user approves or declines each request on the chat's approval card, which shows every field
  it sends. A declined request sends nothing.
- `userWords` must copy one of the user's messages word for word, apart from whitespace, so the
  model cannot put words in the user's mouth. A `fragment` is config only, at most 5,000
  characters, and never holds inline rows or artifacts.
- The tool sends at most one request a turn. The kit adds `context`: the app, its version, the
  user and the time. The sink adds what it knows, such as the blueprint open.
- A request is untrusted input. The server checks it again, and caps how many each user sends.
  Throw from `submitAsync` to refuse one, with a message the model passes on.

### Choose the Architect's model

Sonnet 5.5 at medium effort is the default, and the model the kit tests most. In the Architect
harness's full round of step 12, on Nov 20, 2026, with 16 scenarios on each model, Sonnet passed
77 of 87 checks for $1.13, and Opus 5.5 passed 84 of 87 for $2.32. After that round's fixes,
Sonnet passed every run of the scenarios that need the most planning. Opus is worth twice the
cost where a miss costs more: it took fewer refused edits, and answered with UI more often where
Sonnet answered in text. Low effort on Sonnet saved 11% with the same checks over one round.

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
| `elementOutline` | See the element tree, select an element, and drag one into a container or before or after another |
| `elementInspector` | Edit the selected element's config, its place in its container and the variable an input sets, rename or remove it, and edit a tab container's tabs |
| `widgetPalette` | Add a widget into the selected container or the root, or drag one onto a dashboard cell |
| `variablesEditor` | Add, rename and remove variables, and set each one's type, writers, default and options |
| `sourcesEditor` | Add, rename and remove sources, and set each one's dataset, parameters, filter and fields |
| `presetsEditor` | Make groups of presets over widgets' preset paths and variables' defaults, and edit their presets |
| `blueprintStructure` | See the elements as a tree with their slots, and the sources, variables and preset groups, each counted. Filter by id, select a slot as the place to add, and rename, duplicate, move, add into or delete from a row's menu. Give it an `onAdd(section)` for each section's "+" |
| `blueprintInspector` | Inspect whatever is selected in one frame: the element's path, its id, which a click renames, what it reads, a menu and its issues, over the editor for its kind. Each editor takes `framed` to drop its own header there |
| `blueprintMap` | See every variable, source, preset group and element in lanes, with the wires between them, and trace what feeds the selection and what it feeds |

Each change is one edit by the user, with a description, so undo, redo and history apply. Text
commits on blur or Enter. A refused edit leaves the blueprint as it was, and shows its issues at
the property. A property that presets control shows a badge, and an edit of it changes the active
preset. Give `elementInspector` an `onShowPresetGroup(name)` and the badge opens its group: the
group is selected, and the host shows its `presetsEditor`. Design mode needs write access, and a
chat answer has none.

On the dashboard, the selected element has a toolbar, and the keys act on it: `?` lists them. A key
pressed in a widget's own grid, button or input stays with that control. An empty container
offers to add a widget: give `blueprintView` an `onAddWidget(place)` to open the host's palette
there, and an `onAskArchitect()` for the empty dashboard's second button. Set the design model's
`onRequestAdd` to open that palette from the `/` key; the palette then focuses its search. Give `blueprintMap` an
`onOpenElement(id)` to show an element on the dashboard from a double-click. `wiringFor(blueprint,
selection)` lists what a selection reads and sets, and what reads and sets it.

### Picture widgets and blueprints

`widgetPreview(spec, size)` draws a widget's `preview` glyph as an SVG, or its icon when it has
none, for an Add tile or a registry row. `blueprintSchematic(blueprint, registry)` draws a
blueprint's first canvas from its layout alone, each cell at its place with its widget's glyph,
for a library card. Both take the theme's colors and need no data:

```typescript
import {blueprintSchematic, widgetPreview} from '@xh/hoist-chat-kit/desktop/cmp/blueprint';

div({style: {height: 92}, item: blueprintSchematic(blueprint, model.registry)});
widgetPreview(model.registry.widgets.cubeGrid, {width: 120, height: 40});
```

### Generate a config editor from a schema

`toEditorSpec(schema)` turns a widget's config schema into a tree of `EditorNode`s, one per
property. The registry's annotations pick an editor: a source select for `x-source`, a field
picker or a `GroupingChooser` for `x-field`, a `FilterChooser` for `x-filter`, and pickers for
`x-format`, `x-renderer` and `x-action`, and a select of the variables an action may set for an
action param marked `x-variable`. A property that binds, by type or by `x-binding`, can take a
variable in place of a value. A shape with no editor falls back to JSON, so every value stays editable. The
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
    repository: new HoistCoreBlueprintRepository({type: 'acme.dashboard'})
});

await doc.openAsync(id); // The latest publish, in run mode
await doc.openAsync(id, {as: 'draft'}); // The draft, in design mode, for a writer
await doc.saveDraftAsync();
await doc.publishAsync('Adds the risk view');
```

- **One type per repository.** A type, such as `acme.dashboard` or `acme.printReport`, is one use
  of blueprints in an app, with its own widgets and datasets. Build a repository for each type, and
  open its blueprints in a model with that type's registry and catalog. A repository scopes every
  read and write to its type, so a blueprint of another type is missing to it, even by id.
- **One shared draft, numbered publishes.** Writers edit the draft. A publish copies it as the
  next number and never changes. Readers open only the latest publish.
- **The repository decides access.** Each record carries `access`, `canPublish` and `canShare`.
  A record that does not grant write access opens read-only.
- **One write at a time.** Saves, publishes and copies run in order. A save asked for while
  another runs joins one follow-up save of the latest blueprint.
- **Stale drafts.** If another save landed first, the document turns `isStale`. It keeps the
  user's edits and refuses further saves, and the model refuses every further edit as
  `edit.blocked`, as none could be saved. Offer `reloadAsync()`, which discards the edits, or
  `createAsync(name)`, which saves them as a new blueprint that records the draft it copies. If
  the user has lost access to that draft, the new blueprint is created without the record, so the
  edits are not lost.
- **Copies into another type.** `copyAsync(name, from, into)` copies into the type that `into`
  names, with its repository, registry and catalog. The copy must pass that type's validation,
  and records no source.
- **Renames for personalizations.** The draft keeps the renames of elements, variables and sources
  since the last publish, and each publish records them.
- **Publish history.** `restoreAsync(3)` brings publish 3's content back into the draft as one
  edit, "Restore v3", which undo takes back. It renames back the ids renamed since, so the next
  publish records those renames and personalizations follow them. `rollbackAsync(3)` publishes
  v3's content again, noted "Rolled back to v3", and leaves the writer's unpublished draft as it
  was. `updatePublishAsync(3, {note, label, pinned})`
  changes a publish's note, label or pin, never its content, where `canUpdatePublishes`.
  `diffBlueprints(a, b, renames)` says what each part of a blueprint added, removed, renamed and
  changed between two versions.

### Choose a repository

| Repository | Use it for |
|------------|------------|
| `HoistCoreBlueprintRepository` | Blueprints in hoist-core's database, through its `xhBlueprint` endpoints. Enable them in hoist-core with the `xhBlueprintConfig` config |
| `InMemoryBlueprintRepository` | Tests and demos. It keeps nothing, and grants only what its config says: by default, read access |
| Your own | Another store. Implement `BlueprintRepository`, as below |

### Write a repository

Implement `BlueprintRepository`. Its doc comment states the contract in full. The essentials:

- Hold one `type` of blueprint, and scope every read and write to it. Answer for a blueprint of
  another type as for a missing one.
- Give each blueprint an `id` that is a stable token, the same in every environment, never a
  database id. Links carry it.
- Keep names unique per owner and type. Reject a create or copy with a name the user already has,
  with an `httpStatus` of 400.

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
- Implement `renameAsync` only if the store can rename a blueprint. The library offers renaming
  only then, to writers. Refuse a name the blueprint's owner already has, with an `httpStatus` of
  400, and leave the description as it is when the call omits it.
- Implement `updatePublishAsync` only if the store can change a publish's note, label and pin.
  Change only the keys given, clear a note or label on null or a blank, trim a label to 50
  characters, and leave the content as it was.
- Implement `updateAccessAsync` only if the store can share. The library offers sharing only
  then. A grantee is a username, `role:<ROLE>`, or `*` for everyone. Name the forms the store
  takes in `sharingModes`, and set `canShareGlobally` on a record whose user may share it with
  everyone. `isGlobal(summary)` says whether everyone may read a blueprint.

### Open a blueprint from a link

A link names a blueprint by id in its path, and takes its version, presets and variable values as
query params:

```
/blueprints/:id?version=3&preset=view:byStrategy&asOf=2026-11-20&fund=A&fund=B
```

- A link to a blueprint of another type opens nothing, as for a missing one, even if a
  repository fails to scope by type.
- `version=N` opens publish N, and `draft` opens the draft. With neither, a link opens the latest
  publish. `preset=group:item` repeats once per group. `id`, `version`, `draft` and `preset` are
  reserved, so no variable may take those names (`variable.reservedName`).
- Every other param that names a variable a link may set (`setBy` `prompt`, `action`, or a widget
  without `output`) sets it. A value takes its type's text form: `2026-11-20`, `3M`, `true`, a
  date range preset token or `from..to`, and a list as the param repeated. A link cannot set a
  `filter`, or an app type with no field type unless the type gives a `urlCodec`. Other params
  are left to the host.

```typescript
// The app's route: {name: 'blueprint', path: '/blueprints/:id'}
const {issues} = await documentModel.openLinkAsync(XH.routerState.params);

// A toolbar button that copies a link to the blueprint as it is now.
blueprintLinkButton({documentModel, route: 'default.blueprint'});
```

`openLinkAsync()` opens the version the link names, then applies its presets and values before the
blueprint's sources start, so each loads once. A reader given a link to the draft or an older
publish gets the latest publish. A value that does not fit is dropped, and one notice names what
was ignored. Its values are transient: never saved, and never a user action.

A link is untrusted input. Its values reach config only at bindable paths, and the dataset server
still checks the user's access to every param. Hoist's router keeps only declared params when it
builds a URL, so `blueprintLinkUrl()` writes the query itself, and `XH.navigate()` to a blueprint
route leaves the values out of the address bar.

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

An app names each entry it registers with a dotted prefix, such as `acme.fund`, so it cannot
clash with a built-in. `BlueprintRegistry` refuses an undotted app name.
[Extending Blueprints](../docs/blueprint-extensions.md) gives each entry's contract in full.

- **Widgets.** Register a `WidgetSpec` with a config schema, guidance for the Architect, and a
  desktop component. The Architect's prompt lists each widget by its `category` with its
  one-line `summary`, and reads the full `guidance` on demand. Its `category` also places it in
  the palette. A container's `children.accepts`
  lists the categories and widgets it takes as children, and the validator refuses any other.
  `modules` names the Highcharts modules a widget needs, such as `heatmap`. The app loads them,
  and a widget whose module is missing draws a notice in its place.
  `addPresentation()` adds another way to draw an existing widget, as chat kit adds the `card`
  that grids and charts take in a reply.
- **Variable types, resolvers, actions and renderers.** Register each in `BlueprintRegistry`. An
  action declares a parameter schema, and the runner checks its parameters before it runs. Give
  an action with side effects `sideEffects: true`, so that it always asks the user to confirm.
  Give an action for chat answers only `allowedIn: ['answers']`, so the validator refuses it in a
  dashboard. Mark a param that names a variable to set with `x-variable`, as `setVariable` does:
  the validator checks the name, and the editor offers only the variables an action may set.
- **Date range presets.** A `dateRange` variable names Hoist's presets, such as `mtd`. Register
  the app's own with `dateRangePresets`, each under a dotted token, and the validator accepts it.
- **Dataset keys.** Give each catalog dataset a `key`, the fields that identify one of its rows. A
  source can then join it: a join's grain, from the two keys, decides whether each joined field
  copies onto rows, shows only where a row pins the key, or reduces to the key first. A wrong key
  gives wrong numbers without an error.
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

- [Blueprint Format](../docs/blueprint-format.md),
  [Extending Blueprints](../docs/blueprint-extensions.md) and
  [Blueprint Security](../docs/blueprint-security.md) - the reference docs for this package.
- [`/genui/`](../genui/README.md) - chat kit's catalog, which renders chat answers as blueprints.
- [`/desktop/cmp/genui/`](../desktop/cmp/genui/README.md) - the components that answers draw with.
- [`/core/`](../core/README.md) - `ChatModel`, which runs the Architect's tools.
- hoist-react's Cube, layout and `StatCard`, which blueprint sources and widgets build on.
