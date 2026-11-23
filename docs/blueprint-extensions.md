# Extending Blueprints

Blueprints configure what a `BlueprintRegistry` holds: widgets, variable types, resolvers, actions,
renderers and date range presets. The kit registers its built-ins under bare names, such as
`cubeGrid` or `refresh`. An app adds its own under dotted names, such as `acme.ticker`, so they
never clash with a built-in. Every `add` method refuses an app entry whose name has no dot.

This doc covers each entry's contract. The format the entries plug into is in
[Blueprint Format](./blueprint-format.md), and the classes are in
[`/blueprint/`](../blueprint/README.md). An app's datasets and fields belong in its `DataCatalog`,
not in the registry.

```typescript
import {BlueprintRegistry} from '@xh/hoist-chat-kit/blueprint';

const registry = new BlueprintRegistry({
    widgets: [headlineWidgetSpec],
    variableTypes: [{name: 'acme.fund', matches: 'string', input: fundInput}],
    resolvers: [lastMonthEndResolver],
    actions: [publishAction],
    renderers: [tickerRenderer],
    dateRangePresets: [fiscalYtdPreset]
});
```

Each entry reaches three readers: the validator, the Architect, which reads its guidance and
schema through `describe_registry`, and design mode, which builds editors from its schema. Write
each one for all three.

## Treat Config and Link Values as Untrusted

A blueprint's config comes from a person, an LLM, or a link's params. The validator checks every
value against its schema before a widget sees it, but a schema cannot say everything:

- **Text never becomes markup.** Escape any text you pass to Highcharts, which reads titles,
  labels and formatter output as HTML. Render markdown with images and raw HTML off.
- **No code in config.** A config holds plain data. Never take a function, an element, or a
  string that you evaluate.
- **Data access stays on the server.** A link can set a prompt variable, so a source param such
  as `fund=OTHER` can come from anyone. The dataset's server checks the user's access to every
  param.
- **Action params stay untrusted** after the runner checks them against the schema. An app
  action's `run` treats them as input from the user.

[Blueprint Security](./blueprint-security.md) covers the boundaries in full.

## Add a Widget

A widget is a `WidgetSpec`: a config schema, words for users and the Architect, and a model and
component pair.

```typescript
import type {WidgetSpec} from '@xh/hoist-chat-kit/blueprint';

export const headlineWidgetSpec: WidgetSpec = {
    name: 'acme.headline',
    version: 1,
    label: 'Headline',
    terms: ['big number', 'headline figure'],
    summary: 'One large figure over a source, for a wall display.',
    guidance:
        'One figure, the total of field over the source, in large type for a screen across the room. For a figure with a change or a trend, use statCard.',
    category: 'data',
    config: {
        type: 'object',
        additionalProperties: false,
        required: ['source', 'field'],
        properties: {
            source: {type: 'string', 'x-source': true},
            field: {type: 'string', 'x-field': 'measure'},
            caption: {type: 'string', maxLength: 60, 'x-binding': true},
            filter: {type: 'object', 'x-filter': true, 'x-binding': true}
        }
    },
    demand: cfg => (cfg.source ? {[cfg.source]: {fields: [cfg.field], groupBy: []}} : {}),
    size: {default: {w: 3, h: 2}, min: {w: 2, h: 2}},
    example: {component: 'acme.headline', config: {source: 'positions', field: 'mktVal'}},
    model: HeadlineWidgetModel,
    component: headlineWidget
};
```

### Write the config schema

The schema uses the JSON Schema subset that chat kit checks, with no `$ref`. `addWidgets()`
throws on a keyword the validator lacks. Annotations tell the validator, the Architect and the
editors what a value means:

| Annotation | Marks | The kit then |
|------------|-------|--------------|
| `x-source` | A source name | Checks the source, and offers a source picker |
| `x-field` | A field of the widget's source: `any`, `dimension` or `measure` | Checks the name against the catalog, and offers a field picker |
| `x-binding` | Whether a value may be `{"$var": name}`. Default true for a boolean, number, string, enum or string list with no other annotation | Checks the variable's type against the value's. `false` keeps a value literal |
| `x-filter` | A filter in Hoist's `FilterSpec` form | Checks each field, and offers a `FilterChooser` |
| `x-format` | A format: a name, an object, or a name with changes | Offers a format editor |
| `x-renderer` | A renderer name, or a name with options | Checks it, and offers a picker |
| `x-action` | An action, or a list of steps | Checks each step against its type's params |
| `x-sort` | A Hoist sort: a sorter such as `pnl\|desc\|abs`, or a list of them | Edits it as keys over the source's fields, each with a direction, in a drawer |
| `x-template` | Text with `{variable}` and `{source.field}` references. `'variables'` marks a title, which reads variables only | Checks each reference, and warns of a literal figure. Fills a title's variables in `resolvedConfig` |
| `x-preset` | The name of one of the blueprint's preset groups | Checks the name |
| `x-blueprint` | The id of a stored blueprint of the same type | Offers a picker over the repository's list |
| `x-unit` | The unit of a number, such as `px` | Shows it beside the editor |
| `x-icon` | A Font Awesome icon name | Picks it with Hoist's `iconPicker`, from Hoist's icons and any the app registers with `Icon.register` |
| `x-starter: false` | An optional property | Leaves it out of a new widget's config |
| `x-thumbnails` | On an enum, a kit thumbnail per option, by value, such as `{line: 'chart.line'}` | Shows a card with its picture for each option. `thumbnailPreview(name)` draws one |
| `x-unset` | What an unset value means, where that is known but is no value of the property, such as `No limit` | Shows it in place of a default. A `default` shows as itself, such as `10` or `Vertical (default)` |
| `x-labels` | On a boolean, a label per value, the positive state first, such as `{false: 'Show', true: 'Hide'}` for a `hidden` titled "Visible". On a choice, a label for any option, such as `{false: 'Free'}` | Shows one segment per boolean value, in this order, without it On then Off. Names a choice's options |
| `x-settings: {in, show}` | A list of fields whose items have more settings in `in`, a sibling map keyed by field | Edits each item's map entry in the item's drawer, the `show` keys first, and folds the map into the list |

- Give a property JSON Schema's `title` when its label should differ from its key, as a column's
  `headerName` reads "Header".
- Give a property JSON Schema's `default`, not a sentence. Design mode shows an unset property at
  its default, and the model reads it with `configDefault(key)`.
- Write a `description` on any property whose name does not say what it does. The Architect reads
  it, and the inspector shows it as a hint.
- Mark `x-binding: false` on a value the widget writes back from the user, such as a collapsed
  state, a sort or a layout, so a binding cannot be overwritten. Mark `x-binding: true` on template
  text or an object that may bind, as those do not by default.

### Describe it for users and the Architect

- `label` is the name users see, and `terms` the words they use for it.
- `summary`, at most 15 words, is the widget's line in the Architect's index.
- `guidance` is what the Architect reads before it uses the widget: when to choose it, over what,
  and the mistakes to avoid. Say when to choose a sibling instead.
- `category` places it in the palette and in the index: `container`, `layout`, `content`,
  `data`, `input` or `action`.
- `example` is a valid element, which the Architect copies and a registry browser can render.
  Give what the example names beyond itself in `exampleBlueprint`: a container's child
  elements by ID, and any variables or preset groups it reads, so the example renders on its own.
- `sections` groups config keys under headings in the inspector.
- `icon` names a Hoist `Icon` factory. `preview` is a small picture for Add tiles, registry rows
  and blueprint schematics: a kit glyph's name, such as `grid`, `chart`, `stat` or `input`, or a
  function that draws SVG shapes into a `{width, height}` box. Draw with the classes
  `xh-blueprint-preview__fg`, `__mid`, `__bg` and `__line`, so the picture takes the theme's
  colors. A widget with no preview shows its icon.

### Declare what the widget connects to

- **Demand.** `demand(config)` returns the fields and groupings the widget needs from each
  source, keyed by source name. A source fetches only what its widgets demand.
- **Outputs.** `outputs` lists runtime state that a variable can read, such as a selection, each
  with a type. Mark a filter output `folds: true` only if it sets single-value `=` clauses on
  dimensions.
- **Value.** `value: {type}` lets a variable's `setBy` name the widget, which shows the value and
  sets it, as an input does.
- **Preset paths.** `presetPaths` lists the config paths a preset can set, such as
  `/columnState`.
- **Containers.** `children` gives the schema of a child reference, and `accepts` the categories
  or widgets it takes. `slots` names other slot lists, each with a `description` in users' words,
  `terms`, `accepts` and an optional `maxItems`. `children.slots` names the slot lists a child
  reference holds.
- **Checks.** `validate(config, ctx)` returns issues the schema cannot express, with paths inside
  the config and codes under the widget's name, such as `acme.headline.noField`.
- **Highcharts modules.** `modules` names each series module the widget needs, such as
  `heatmap`, or gives a function of the config. A widget whose module the app has not loaded
  draws a notice in its place. List every module a module depends on: `solid-gauge` needs
  `highcharts-more`.
- **Starting config.** `starter(config, ctx)` adjusts the config a new widget starts with, or
  returns why it cannot start yet.

### Write the model and component

The model extends `BlueprintWidgetModel`, and the component is a `hoistCmp` that renders it.

```typescript
import {hoistCmp, managed, uses} from '@xh/hoist/core';
import {div} from '@xh/hoist/cmp/layout';
import type {Cube, View} from '@xh/hoist/data';
import {computed, observableRef} from '@xh/hoist/mobx';
import {BlueprintWidgetModel, type BlueprintWidgetConfig} from '@xh/hoist-chat-kit/blueprint';

export class HeadlineWidgetModel extends BlueprintWidgetModel {
    @managed @observableRef accessor view: View = null;

    constructor(config: BlueprintWidgetConfig) {
        super(config);
        this.setCube(this.source?.cube);
        this.addReaction({track: () => this.source?.cube, run: cube => this.setCube(cube)});
    }

    @computed
    get total(): number {
        return this.view?.result.rows[0]?.[this.resolvedConfig.field] ?? null;
    }

    private setCube(cube: Cube) {
        this.registerView(null);
        this.view?.destroy();
        this.view = cube
            ? cube.createView({query: {dimensions: [], includeRoot: true}, connect: true})
            : null;
        this.registerView(this.view);
    }
}

export const headlineWidget = hoistCmp.factory({
    model: uses(HeadlineWidgetModel),
    render({model}) {
        return div({className: 'acme-headline', children: String(model.total ?? '')});
    }
});
```

Two rules bind every widget, so personalizations can come later without rework:

1. **State a user can change is config.** A sort, a column layout or a grouping goes through
   `setConfig(path, value)` or `applyUserEdit(ops)`, at a path listed in `presetPaths`. In design
   mode it becomes an edit. In run mode it stays transient.
2. **A widget keeps no private state** that the blueprint cannot see. It derives everything from
   `resolvedConfig`, its source and its variables.

The model also holds one Hoist model for its life, such as a `ChartModel`, and updates it as its
config changes. `resolvedConfig` gives the config with each binding replaced by its variable's
value. `setOutput(name, value)` publishes an output, and `setValue(value)` sets the variable a
`value` widget shows.

## Add a Presentation

`registry.addPresentation(widget, spec)` adds another way to draw an existing widget, from the
same config and model, as chat kit adds the `card` that grids and charts take in a reply. An
element picks one with its config's `presentation`. `ignores` lists the config keys it does not
draw.

## Add a Variable Type

A variable type is a dotted name for a kind of value, such as `acme.fund`:

| Property | Description |
|----------|-------------|
| `name` | The type's dotted name |
| `matches` | The field type its values match, such as `string`, so it binds wherever that type fits |
| `guidance` | For the Architect: what the values mean, and where they come from |
| `input` | The prompt input, in place of the built-in one for `matches`. It shows `value` and calls `onCommit` |
| `urlCodec` | The text form of a value in a link, for a type whose `matches` has none, such as a portfolio. Without it, a link cannot set the type. `parse` reads untrusted text, and throws or returns null for text it cannot read |

## Add a Resolver

A resolver computes a variable's default or `compute`, such as the last month end:

```typescript
const lastMonthEndResolver: ResolverSpec = {
    name: 'acme.lastMonthEnd',
    returns: 'localDate',
    args: {from: 'localDate, optional. Default today.'},
    guidance: 'The last day of the month before from.',
    resolve: ({from}) => (from ? LocalDate.get(from) : LocalDate.currentAppDay()).startOfMonth().subtract(1).isoString
};
```

`args` describes each argument for the Architect. Arguments arrive resolved, and may be null.
Dates travel as `YYYY-MM-DD`. A resolver is pure: it reads nothing but its arguments and the
registry.

## Add an Action

An action type declares an object schema for its params, which sit beside its `type` in a
blueprint:

| Property | Description |
|----------|-------------|
| `params` | An object schema. `addActions()` throws without one. Mark a param that names a variable to set with `x-variable`, never with `x-binding` |
| `describe` | The action's description, from its resolved params. It is the tooltip, and the text of any confirmation |
| `check` | Why the action cannot run now, or null. Runs before the user confirms |
| `run` | Does the work. Throw to stop the steps after it, with a message the user sees |
| `sideEffects` | True if it changes data. It always asks the user to confirm, and a chat answer cannot use it |
| `allowedIn` | `dashboards`, `answers` or both. The validator refuses it anywhere else |
| `guidance` | For the Architect: when to use it |

`run(params, ctx)` gets `ctx.blueprintModel`, and `ctx.row` for an action run on a row. The
runner checks every step's params before the first runs.

## Add a Renderer

A renderer draws a value as more than text, in a grid cell or a stat card:

| Property | Description |
|----------|-------------|
| `appliesTo` | The field `types` and `kinds` it suits, which design mode uses to offer it |
| `config` | A schema for its options, checked like a widget's config |
| `render` | Draws the value. Use `ctx.formatValue` for any text, and never treat text as markup |
| `exportValue` | The value for an export or a copy, such as a bar's number. Default the raw value |
| `guidance` | For the Architect: when to use it |

`ctx` also gives the field, the resolved format, `isAggregate` for a group row, the row's
`record`, and `columnMax()` and `columnRange()` for a renderer that scales against its column.

## Add Date Range Presets

A `dateRange` variable names Hoist's presets, such as `mtd`. Register the app's own with
`dateRangePresets`, each a Hoist `DateRangePreset` under a dotted token such as `acme.fiscalYtd`,
and the validator, the picker and links accept it.

## Where Each Entry Goes

- **An app's entries** go in the app's `BlueprintRegistry` config, under dotted names, with each
  widget's `model` and `component` on its spec.
- **A built-in** goes in `blueprint/impl/builtInWidgets.ts`, with its schema, spec, demand and
  validator, and `blueprint/impl/builtInSpecs.ts` for resolver and renderer code. Its desktop model
  and component go in `desktop/cmp/blueprint/`, registered in `BlueprintViewModel`'s map and the
  package index. It also needs a row in `docs/planning/blueprints/tools/check-blueprints.py`.

Every entry comes with specs. A widget's specs cover its config, its validator, its demand, and
what it renders, in a real Hoist test app. A widget the Architect may choose also gets a scenario
in the Architect harness, `docs/planning/blueprints/tools/llm-test` in this repo. Word the
scenario as a user would ask, and give it a hand-written answer that passes its checks. Run it on
both models before you rely on the widget's guidance.
