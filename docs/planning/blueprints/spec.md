# Spec: Hoist Blueprints

> **Draft.** This spec records decisions as we make them. [`baseline.md`](./baseline.md) holds
> the analysis of Hoist Chat Kit's generative UI that several decisions come from.

## What It Is

A foundation in hoist-react for UIs that a JSON document defines: dashboards, reports, and the
UI that an LLM generates in a chat. An LLM or a person builds and changes the document. Hoist
renders it with widgets, which are Hoist models and components.

The foundation is the UI layer only. Each app brings its own data layer and connects it through
the interfaces the foundation defines. Apps add their own widgets and extend Hoist's.

Hoist Chat Kit builds on the foundation. Its generative UI core, meaning its component catalog,
which becomes the widget registry, its document model and its validation, moves here. Chat kit
keeps what only chat needs.

## Decisions

### Names

| Term | Meaning |
|---|---|
| Hoist Blueprints | The system. Its package is `@xh/hoist/blueprint`. |
| Blueprint | A document. |
| Draft | An unpublished version of a blueprint. |
| Design mode | The mode where a user with write access edits the definition or a preset. |
| Run mode | The mode where a user runs the published blueprint and edits only personalizations. |
| Architect | The AI agent that builds and edits blueprints. |
| Data Catalog | The universe of datasets, their parameters and their fields, shared by all blueprints. It is data, not code. |
| Kind | What a field's value means, such as `pnl`, `fraction` or `ticker`. It sets the field's default format, aggregator and renderer. |
| Registry | A set of things an app provides in code for blueprints to configure, such as widget types, resolvers, formatters, renderers, variable types and aggregators. |
| Preset | A named set of values for preset paths, published by a designer for users to switch between. |
| Preset path | A path in a widget's config that a preset can set. Each widget's schema declares its preset paths. |
| Personalizable | A preset path that the designer lets users change for themselves. |
| Personalization | One user's saved change to a personalizable path. |

### The document is the source of truth

- A document is plain JSON. It saves, versions, copies and diffs.
- The document is the only thing an LLM reads or writes. It never reaches into a widget's models.
- Widget models derive their state from the document, and react when it changes.
- The same document always renders the same UI.

### Widgets are model and component pairs

- Each widget is a `HoistModel` with its component. A widget can hold child models, business
  logic and runtime state.
- Each widget declares its config surface: the part of the document it reads.
- Everything that changes what a widget shows lives in its config. A model holds no hidden
  state that changes behavior.
- A config is small, declarative and named by intent, such as `format: 'ledger'`. It holds no
  functions. Its defaults come from the field schema.
- Rich behavior, such as conditional row styles or rows that expand on load, is a declarative
  rule in the config. The model turns each rule into Hoist config.
- Widgets connect through bindings in the document, never through references between models.
- A built-in widget that renders one hoist-react component takes that component's factory
  name, such as `dashCanvas`, `tabContainer`, `cubeGrid` or `chart`. The name is the registry
  key, the tool name and the name in docs and classes. A widget can add layers over its
  component and keep the name. App widgets name themselves, such as `portfolioBuilder`. If two
  widgets would share a name, the general one takes it. (Chat kit D132.)
- Users never need a widget's name. Each registry entry has a `label`, such as "Grid" or
  "Dashboard", the words users use for it, such as "table", "pivot" or "tabs", and guidance on
  when to choose it. Design mode shows labels. The Architect maps a user's words to a widget,
  and asks when two widgets fit.
- Hoist ships dedicated, configurable widgets. The Cube grid widget renders hoist-react's
  `CubeGrid`, which already handles grouping, pivoting and live updates.
- Chat kit's built-in specs become widgets too. They are the chart, stat cards, card, section,
  tabs, callout, badges, separator, treemap, progress, steps, key values, list, form, button and
  inputs. Its grid becomes `cubeGrid`.
- A built-in widget renders a hoist-react component. If a widget needs a building block that
  Hoist lacks, we build the block in hoist-react, as a component any Hoist app can use. Hoist 91
  did this for `StatCard`, `ProgressBar`, `Steps`, `KeyValueList`, `ItemList`, `Sparkline` and
  `Separator`. (Chat kit D124, D130.)
- A widget takes plain data that a model can write, never callbacks or elements. Text from a
  model never reaches a component as markup: the widget escapes Highcharts text, and markdown
  loads no images. (Chat kit D128.)
- A widget holds one Hoist model for its life, and updates it as its config changes. (Chat kit
  D128.)
- Only `elements` define components, and only a prop that a widget's schema declares as an
  action defines an action (see Q19). A value in a variable or a source never becomes an element
  or an action. (Chat kit D127.)

### Widget specs

Every widget in the registry has a spec in this form:

```ts
interface WidgetSpec<C> {
    name: string;                 // Hoist factory name: 'cubeGrid'
    version: number;
    label: string;                // 'Grid', shown in design mode
    terms: string[];              // ['table', 'pivot'], the words users use
    description: string;          // for users
    guidance: string;             // for the LLM: when to choose it, and over what
    category: 'container' | 'data' | 'input' | 'action';
    config: JsonSchema;
    example: C;
    presetPaths?: string[];       // ['/columnState']
    outputs?: OutputSpec[];       // [{name: 'selection', type: 'filter', folds: true}]
    value?: {type: string};       // for a widget that a variable's setBy names
    children?: {schema: JsonSchema, accepts?: string[]};   // containers only
    size?: {default: Size, min?: Size, max?: Size};        // in canvas units
    demand?(config): {fields: string[], groupBy: string[]};
    validate?(config, ctx): Issue[];
    migrations?: Migration[];
    model: WidgetModelClass;
    component: HoistComponent;
}
```

- The config schema uses the JSON Schema subset that chat kit checks, plus four annotations that
  do not affect validity. `x-binding` marks a path that accepts `{"$var": ...}`. `x-field` marks
  a value that names fields of the widget's source, optionally only dimensions or measures. The
  foundation checks those names against the Data Catalog, and design mode offers a field
  picker. `x-action` marks an action prop, and `x-format` a format prop.
- Every widget that shows data reads it from a source. No widget holds data in its config. In a
  chat answer, values the LLM computed go in an `inline` source, and the widget names its
  fields.
- One grid widget, `cubeGrid`, serves every grid, grouped or flat, because every source holds a
  Cube. Chat kit's inline grid becomes a `cubeGrid` over an `inline` source.
- An output can take one argument. `{"element": "posGrid", "output": "selected", "field":
  "symbol"}` gives the selected row's symbol, or null unless that row has one symbol.
- A chart whose `x` is a dimension aggregates through the Cube. A chart whose `x` is a date or
  time field plots rows as they are.
- The blueprint's toolbar renders prompts and the preset switch. Neither is a widget.
- A grid's `sortBy` uses Hoist's sort form: a string, or a list of them, such as
  `["pnlDay|desc|abs", "symbol"]`. The field `group` names the tree column, in `sortBy` and in
  `columnState`, so the tree column's width, pin and visibility are kept like any column's. With no
  `group` entry, the tree column takes its default: first, pinned left and autosized. An entry,
  once present, applies exactly as written, so an entry without `pinned` unpins the column. A
  widget writes the entry only when the column leaves its default.
- A grid's column state can pin a column with `pinned`, `left` or `right`.
- A user's own column filters are transient for now. They will become a personalizable path of
  their own, applied with AND on top of the designer's `filter`, never in its place.

The first widgets, for the scenarios:

| Name | Label | Main config | Outputs or value | Preset paths |
|---|---|---|---|---|
| `dashCanvas` | Dashboard | `columns`, `rowHeight`. Child references take `x`, `y`, `w`, `h` | None | None |
| `tabContainer` | Tabs | Child references take `title`, `icon` | None | None |
| `cubeGrid` | Grid | `source`, `groupBy`, `columnState`, `sortBy`, `filter`, `expandLevel`, `summaryRow`. `columnState` lists field names, or objects with `field`, `width`, `hidden`, `pinned`, `format` and `renderer` | Outputs `selection` (a filter) and `selected` (one field's value) | `columnState`, `sortBy` |
| `chart` | Chart | `source`, `type`, `x`, `y`, `groupBy` to split series, `stacking`, `filter`, `sortBy`, `top`, `title` | None | `type` |
| `statCardStrip` | Stat cards | `source`, `title`, `cards`: each a `field`, `label`, `format` and `agg`. A card with `agg: "count"` and no field counts rows | None | None |
| `groupingChooser` | Grouping | `dimensions` the user can choose from | Value: a list of dimensions | None |
| `buttonGroup` | Buttons | `buttons`: each a `label`, `icon` and `action` | None | None |
| `buttonGroupInput` | Toggle | `options`: each a `value` and `label` | Value: one option | None |

### The layout is made of elements

```json
{
    "root": "tabs",
    "elements": {
        "tabs": {
            "component": "tabContainer",
            "children": [
                {"id": "overview", "title": "Overview"},
                {"id": "risk", "title": "Risk"}
            ]
        },
        "overview": {
            "component": "dashCanvas",
            "config": {"columns": 12},
            "children": [
                {"id": "posGrid", "x": 0, "y": 0, "w": 8, "h": 6},
                {"id": "pnlChart", "x": 8, "y": 0, "w": 4, "h": 6}
            ]
        },
        "risk": {
            "component": "dashCanvas",
            "children": [{"id": "riskGrid", "x": 0, "y": 0, "w": 12, "h": 8}]
        },
        "posGrid": {"component": "cubeGrid", "config": {"groupBy": ["sector"]}},
        "pnlChart": {"component": "chart", "config": {"type": "line"}},
        "riskGrid": {"component": "cubeGrid", "config": {"groupBy": ["region"]}}
    }
}
```

- Every element, container or widget, sits in one flat map keyed by ID. `root` names the top
  element.
- An element has a `component` and its `config`. A container also has `children`.
- A child reference is an object: the child's ID, plus what the container needs to place it.
  Each container declares a schema for its child references. A `dashCanvas` takes `x`, `y`, `w`
  and `h`. A `tabContainer` takes `title` and `icon`.
- A widget's config holds no layout. A move or a rearrange changes only child references.
- An element has at most one parent, so the layout places each widget exactly once.
- Layouts nest, for example a tab container that holds canvases.
- A designer can make a container's placement personalizable, so a user in run mode can
  rearrange it. How such a personalization meets a publish that adds or removes a child is Q25.
- A mobile renderer can ignore placement and show the children in list order. A container keeps
  its children in reading order, and a rearrange re-sorts them, top to bottom, then left to right.
- A `dashCanvas` does not compact its widgets. Placement is free, and the validator refuses
  children that overlap or reach past the last column. Whether a canvas can compact is open for
  later.

### Variables carry every value that moves

```json
{
    "variables": {
        "asOf": {
            "type": "localDate",
            "label": "As of",
            "setBy": "prompt",
            "default": {"resolver": "previousBusinessDay"}
        },
        "portfolio": {
            "type": "portfolio",
            "label": "Portfolio",
            "setBy": {"element": "portfolioBuilder"},
            "default": {"value": {"holdings": [{"symbol": "AAPL", "weight": 0.5}]}, "personalizable": true}
        },
        "selection": {
            "type": "filter",
            "setBy": [
                {"element": "stratGrid", "output": "selection"},
                {"element": "posGrid", "output": "selection"}
            ]
        },
        "periodStart": {
            "type": "localDate",
            "setBy": "resolver",
            "compute": {"resolver": "quarterStart", "args": {"from": {"$var": "asOf"}}}
        },
        "benchmark": {"type": "string", "default": {"value": "SPX"}}
    },
    "sources": {
        "positions": {
            "dataset": "positions",
            "params": {"asOf": {"$var": "asOf"}, "portfolio": {"$var": "portfolio"}}
        }
    },
    "elements": {
        "portfolioBuilder": {"component": "portfolioBuilder"},
        "stratGrid": {"component": "cubeGrid", "config": {"source": "positions", "groupBy": ["strategy"]}},
        "posGrid": {"component": "cubeGrid", "config": {"source": "positions", "groupBy": ["sector", "symbol"]}},
        "pnlChart": {"component": "chart", "config": {"source": "positions", "filter": {"$var": "selection"}}}
    }
}
```

- Variables live only at the root of the document. Nothing else declares them.
- Every value that feeds a blueprint is a variable. A source parameter always binds one, and so
  does a filter value a user might want to change: a blueprint never holds such a value as a
  literal. A literal that defines what a widget is, such as a chart of Technology alone, can stay
  in its config. A variable with no `setBy` is a constant, declared at the root, so every input
  to the blueprint is in one place. A chat answer is the exception: it is a fixed record, and its
  parameters can be literals.
- A value the user names stays as given, as a constant, and the Architect offers to make it a
  prompt. An input the user does not name, such as an as-of date, is a prompted variable.
- A variable has a readable ID, a type and a label. The types are Hoist's field types
  (`string`, `number`, `int`, `bool`, `date` and `localDate`), app types such as `portfolio`,
  lists of these, written such as `string[]`, and `filter`. A filter is a variable, not a
  separate concept.
- A variable's `options` limits its values, for a prompt's choices: `{"values": [...]}`, or
  `{"dataset": "positions", "field": "fund"}` for a dimension's values. An app variable type can
  supply its own choices and its own input.
- An app variable type declares the field type its values match, such as `fund` matching
  `string`. A `fund` variable can then bind to a parameter or a filter on a `string` field.
- Config reads a variable one way: `{"$var": "asOf"}`. Config holds no expressions. Each
  widget's schema marks the paths that accept a binding, and the foundation checks that the
  variable's type matches.
- Resolvers, such as `today`, `previousBusinessDay`, `dateOffset` or `userPref`, come from a closed
  registry that apps can extend. A resolver's arguments can read other variables. The validator
  refuses a cycle with the code `variable.cycle`, and the foundation computes dependent variables
  again when a variable changes.
- A variable that outputs set holds its default until an output has a value. An output with a
  `field` argument takes that field from the selected row, or null unless the row has one value
  for it.

A variable's `setBy` names what can set it, and nothing else can:

| `setBy` | Set by | URL and Architect can set it | Can be `personalizable` |
|---|---|---|---|
| `"prompt"` | An input in the blueprint's toolbar | Yes | Yes |
| `{"element": id}` | A widget that shows the value and sets it, such as a portfolio builder | Yes, and the widget shows the new value | Yes |
| `{"element": id, "output": name}` | A widget's runtime state, such as its selection. An output with an argument adds it, such as `"field": "symbol"` | No | No |
| `"resolver"` | Its `compute`, a resolver computed again whenever its inputs change | No | No |
| `"action"` | Actions, such as buttons for MTD and YTD | Yes | Yes |
| Absent | Nothing. The variable keeps its default | Only as a definition edit in design mode | No |

- A prompt is for a simple value, such as a date. A widget is for a rich value, such as a
  portfolio a user builds from tickers or a hypothetical strategy.
- A widget whose value is empty, such as a portfolio with no holdings, sets its variable to null,
  never to an empty value. A source that needs the variable then waits, as for any missing
  required parameter.
- A widget spec declares its outputs and the value it can show, each with a type. A widget's
  config never names a variable it writes. The foundation connects each widget to the variables
  whose `setBy` name it.
- A grouped grid publishes its selection as a filter, for example `sector = Technology AND
  symbol = NVDA`.
- A `filter` variable can list several writers. The foundation joins their filters with AND,
  and a writer with no value adds nothing. In the example, a selection in the strategy grid and
  one in the position grid together filter the chart. URL parameters and the Architect cannot
  set a filter that has several writers.
- Every other variable has at most one writer.
- A filter clause bound to a null variable is dropped, as [Filters use Hoist's filter
  form](#filters-use-hoists-filter-form) sets out. A required value that is null shows the
  widget's empty state.
- A default is an object: `{"value": ...}` for a literal, or `{"resolver": ..., "args": ...}`.
  It applies until a writer sets a value. Because the default is always an object, a literal
  that is itself an object, such as a portfolio, never reads as a resolver.
- `"personalizable": true` in the default lets a user's chosen value replace the default, as a
  personalization. The foundation refuses it on a variable that an output or a resolver sets.

Variable values are not part of the definition:

- The definition holds each declaration and default. The current value is transient state,
  unless a personalization saves it.
- The Architect sets a variable to change what is shown now, and edits the document to change
  the definition. These are separate tools.

### Widgets read sources

```json
{
    "sources": {
        "positions": {
            "dataset": "positions",
            "params": {"asOf": {"$var": "asOf"}, "portfolio": {"$var": "portfolio"}},
            "fields": {
                "retMtd": {"field": "return", "params": {"start": {"$var": "monthStart"}, "end": {"$var": "asOf"}}},
                "retYtd": {"field": "return", "params": {"start": {"$var": "yearStart"}, "end": {"$var": "asOf"}}}
            }
        }
    },
    "elements": {
        "posGrid": {
            "component": "cubeGrid",
            "config": {"source": "positions", "groupBy": ["sector", "symbol"], "columnState": ["mktVal", "retMtd", "retYtd"]}
        },
        "sectorChart": {
            "component": "chart",
            "config": {"source": "positions", "x": "sector", "y": ["mktVal"], "filter": {"$var": "selection"}}
        }
    }
}
```

- A source names a dataset from the Data Catalog and binds its parameters. The LLM reads the
  dataset's fields before anything runs.
- Everything behind a dataset belongs to the app: queries, joins, server aggregation and
  caching.
- A blueprint declares its sources at the root, next to its variables. A widget names one
  source and never repeats its parameters.
- Widgets that share a source share one request. A source holds a Hoist `Cube`, and each widget
  queries it with its own `View`.
- A widget's config states its demand: a grid needs its columns and `groupBy` fields, and a
  chart needs `x` and `y`. The foundation combines the demands on a source into one request,
  `{dataset, params, fields, groupBy, filter}`. The app's data layer returns leaf rows for Cube
  to group, or aggregates on the server where only the server can.
- A source filter goes to the server with the request. A widget filter applies in the browser
  through the widget's `View`, so a filter bound to a selection updates with no reload.

A source is one of three kinds. Widgets do not know which kind they read.

| Kind | Created by | Runs again | Live updates | LLM sees the rows |
|---|---|---|---|---|
| `dataset` | The blueprint | When its parameters change, and on refresh | Yes | No, only the schema |
| `artifact` | A tool in a chat | Never | No | Yes |
| `inline` | The LLM or a person | Never | No | Yes |

- An artifact records the dataset and parameters it came from, if any. The foundation ships a
  `query_dataset` tool, built from the Data Catalog, that records them.
- Inline data comes from no source. A blueprint that is not a chat answer never holds values
  that the LLM computed from a source. A computed value is a widget over a source, so it is
  fetched each time the blueprint opens.
- A blueprint never depends on chat storage. An artifact with no dataset becomes an `inline`
  source if it is small, or a snapshot that the blueprint owns.

Live data:

- A data provider answers the first request and can then push updates. The source applies each
  update to its Cube, and the views carry it to the widgets.
- The source owns the subscription. It ends the subscription when a bound parameter changes or
  the blueprint closes.
- A widget never copies rows out of its view.

- If a source's required parameter is null, the source does not load, and its widgets show
  their empty state. A price chart waits for a selected symbol this way.
- Inline source fields can name catalog kinds, so computed values format like any other.

Measures that roll up on the server, with the `"server"` aggregator:

- A request's `groupBy` lists the grouping sets that need server values: each a sorted list of
  dimensions, and `[]` for the grand total. A grid grouped by fund, then strategy, needs `[fund]`
  and `[fund, strategy]`.
- A widget filter's single-value `=` clauses on dimensions fold into its sets, so a selection
  needs no new request. A widget filter that cannot fold shows its server fields blank, and the
  validator warns with `filter.cannotFold` at the widget's `/config/filter`. A filter cannot fold
  if it has an OR, a list value, an operator other than `=`, or a clause on a field that is not a
  dimension. A bound filter folds only if every writer is an output marked `"folds": true` in its
  spec, meaning it only sets single-value `=` clauses on dimensions, as `cubeGrid`'s `selection`
  does, or a constant whose literal folds. A prompt, an action, a resolver or an unmarked output
  counts as not folding. At runtime, any value that cannot fold blanks the server fields,
  whatever the validator said.
- The server returns `aggregates` beside `rows`: each `{dims, values}`, keyed by the dimension
  values that define the group, not by a row id. `dims` is `{}` for the grand total.
- Hoist's Cube holds them through a `SuppliedAggregator`, token `SUPPLIED`, which the catalog's
  `"server"` maps onto. A group with no value yet shows blank. The source fetches only the sets
  it lacks, and keeps loaded sets until a parameter changes.
- Live pushes carry `aggregates` with the row changes, applied in one pass, so a rollup never
  lags its rows.

Paging and very large results come later, as a capability a dataset declares.

### Filters use Hoist's filter form

Every filter in a blueprint is a Hoist `FilterSpec` as JSON: the form that `FilterChooser`,
`Store` and `Cube` take, and that hoist-core's `FieldFilter` and `CompoundFilter` parse.

```json
{
    "op": "AND",
    "filters": [
        {"$var": "selection"},
        {"field": "region", "op": "=", "value": ["EMEA", "APAC"]},
        {"field": "pnlDay", "op": "<", "value": {"$var": "lossLimit"}},
        {"field": "asOfDate", "op": ">=", "value": "2026-07-01"}
    ]
}
```

- A field filter is `{field, op, value}`. `field` names a dataset field or a source instance,
  such as `retMtd`. A value converts to the field's type. A `localDate` is written as
  `YYYY-MM-DD`.
- A compound filter is `{filters, op}`, where `op` is `AND` or `OR`, and `AND` by default.
  Compounds nest.
- The operators are Hoist's: `=`, `!=`, `>`, `>=`, `<`, `<=`, `like`, `not like`, `begins`,
  `not begins`, `ends`, `not ends`, `includes` and `excludes`. A list value with `=` or `!=`
  means any of the values, or none of them.
- A blueprint holds no function filters.
- A whole filter, or a member of a compound, can be `{"$var": name}` for a `filter` variable. A
  field filter's `value` can be `{"$var": name}` for a variable of the field's type.
- A bound value that is null drops its clause, and a compound left empty means no filter. A
  literal `null` keeps Hoist's meaning: `{"field": "sector", "op": "=", "value": null}` matches
  empty values.
- Source filters, widget filters, `filter` variables and the conditions of conditional styles
  all use this form. `FilterChooser` edits it in design mode.
- Chat kit's views move onto this form. `eq` and `neq` become `=` and `!=`. `gt`, `gte`, `lt`
  and `lte` become `>`, `>=`, `<` and `<=`. `in` becomes `=` with a list, and `notNull` becomes
  `!=` with `null`.

### Chat answers are blueprints

- Each UI segment of a reply is one blueprint: a component tool call, a tag, an OpenUI Lang
  program, a `show_ui` document or an adapter's data part. It renders where it appears in the
  reply. Text stays chat kit's text, outside any blueprint.
- Segments are isolated. Each one streams, validates and fails on its own, and no segment reads
  another's variables. Segments can read the same artifact, as artifacts belong to the chat.
- Widgets that interact go in one segment. The Architect decides this as it writes the reply,
  and builds them as one `show_ui` blueprint with its own variables and bindings.
- A text format or an adapter produces its segment's blueprint directly.
- An answer blueprint is fixed once its turn ends: its definition no longer changes. Its dataset
  sources still load, within chat kit's bounds. It can hold literal parameters, artifacts and
  computed inline values. It has no design mode and no publishing.
- To combine earlier segments, the Architect writes a new answer with one segment that holds
  them and wires them together.
- The chat shell, meaning the message list and the composer, is chat kit's own UI. It is not a
  blueprint.

A chat can open beside a host blueprint. The Architect then gets the host's variables and their
current values, its sources, a summary of its elements, and the user's mode and access level.

- To answer a question about what the user sees, the Architect writes its own answer blueprint
  with the host's current values as literals. The host does not change.
- To change the host, the Architect edits the host, in design mode, with write access.

To add an answer to the host, the user chooses one or more segments, and the Architect
translates each one. It does not copy them. In the host, they can share the host's variables
and sources.

- An artifact source becomes a dataset source.
- A literal parameter binds to a matching host variable, becomes a new variable, or becomes a
  resolver, such as `quarterStart` for a relative date.
- A computed value becomes a widget over a source.
- A new widget reuses a host source with the same dataset and parameters.
- The Architect renames an ID that collides, and updates its references.
- Each new widget gets a child reference in a container.
- If a mapping is unclear, the Architect asks.

Chat kit's work on its `genui-building-blocks` and `genui-ui-formats` branches sets these rules:

- A text format or an adapter turns what a model writes into an answer blueprint. The tag
  grammar and OpenUI Lang are text formats, and A2UI is an adapter. Delivery stays in chat kit. (Chat kit D121, D123.)
- An OpenUI Lang program keeps its state in lang-core's runtime, outside the blueprint. On each
  change of state the program resolves to a plain blueprint, which the foundation checks like any
  other. (Chat kit D126, D127.)
- OpenUI Lang's conditions, `@Each` templates and queries have no equivalent in a blueprint. To
  add such an answer to a host, the Architect rewrites it with variables and sources, and asks
  where it cannot.
- A chat answer cannot change data. Its sources only read. (Chat kit D127.)
- A source in a chat answer follows chat kit's bounds on queries. A source in an older reply
  loads only once the user acts in it. Only the latest reply refreshes on a timer. A chat caps
  the loads its answers start in a minute. (Chat kit D127.)
- Chat kit's tabs spec matches titles to children by position. It moves to child references,
  which carry each tab's title.

### Actions are typed and checked

```json
"elements": {
    "periodButtons": {
        "component": "buttonGroup",
        "config": {
            "buttons": [
                {"label": "MTD", "action": {"type": "setVariable", "variable": "period", "value": "MTD"}},
                {"label": "YTD", "action": {"type": "setVariable", "variable": "period", "value": "YTD"}}
            ]
        }
    },
    "posGrid": {
        "component": "cubeGrid",
        "config": {
            "rowActions": [{
                "label": "Open detail",
                "action": {"type": "openBlueprint", "blueprint": "positionDetail", "variables": {"symbol": {"$row": "symbol"}}}
            }]
        }
    }
}
```

- Action types come from a registry. Each type declares a schema for its parameters, so the
  foundation checks every action, and the LLM sees what each type takes.
- Hoist Blueprints registers `setVariable`, `resetVariable`, `refresh`, `navigate`, `openUrl`
  and `openBlueprint`. `refresh` names sources, or reloads them all. Chat kit registers `send`
  and `callTool`. An app registers its own types, each with a schema. These replace chat kit's
  generic `app` action.
- An action lives on a prop that a widget's schema declares as an action, such as a button's
  `action`, a card's `actions` or a grid's `rowActions`. Actions are config, so edits,
  validation, presets and migrations apply to them.
- An action can set only a variable that URL parameters and the Architect can set: one whose
  `setBy` is `"prompt"`, a widget or `"action"`. An input that shows the variable updates. An
  action never sets a variable that an output or a resolver sets.
- An action's parameters sit beside its `type`, as `setVariable` holds `variable` and `value`.
- An action's values are literals or `{"$var": name}`. A row action can read a field of the
  clicked row with `{"$row": field}`. An action reads no other context, and holds no
  expressions.
- Every action shows a description, built from its type and values, as its tooltip. The values
  an action runs with are the values its description showed. An action can add `confirm`.
- An action type that changes data declares `sideEffects: true`. It always asks the user to
  confirm, and a chat answer cannot use it.
- `openUrl` opens only URLs that the allow list permits. An app's handler treats its parameters
  as untrusted.
- A list of actions runs as steps, at most 8. The foundation checks every step before the first
  runs. Each step starts once the one before it finishes. If a step fails, the steps after it do
  not run, and the user sees why.
- `openBlueprint` opens another blueprint in a popover or a dialog over the current one, and
  passes in variables that URL parameters could set. It comes after the proof of concept.
- OpenUI Lang maps onto these types. `@Set` and `@Reset` become `setVariable` and
  `resetVariable` on an `"action"` variable, `@Run` becomes `refresh`, `@ToAssistant` becomes
  `send`, and `@OpenUrl` becomes `openUrl`.

### Every change is an edit

```json
{
    "base": 42,
    "description": "Group positions by region, add a returns chart",
    "ops": [
        {"op": "set", "path": "/elements/posGrid/config/groupBy", "value": ["region", "symbol"]},
        {
            "op": "addElement",
            "id": "retChart",
            "element": {"component": "chart", "config": {"source": "positions", "x": "sector", "y": ["retMtd"]}},
            "parent": "overview",
            "child": {"x": 0, "y": 6, "w": 6, "h": 4}
        }
    ]
}
```

- Every change to a blueprint is an edit: a list of operations. LLMs, editors and interactions
  inside a widget all change a blueprint this way.
- An edit is atomic. All its operations apply, then the foundation checks the result as a
  whole: schemas, structure and semantic rules. If a check fails, nothing applies, and the edit
  returns its issues.
- One edit is one undo step and one history entry. It records its author, a person or the
  Architect, and the Architect's `description`.
- `base` is the version the edit was written against. If the blueprint changed since then, an
  edit that touches none of the changed paths still applies. The foundation refuses an edit that
  overlaps, and its author writes it again.
- A person can make every change an LLM can make, and the reverse. Generic editors come from the
  config schema. Custom editors use Hoist components where they fit, such as `GroupingChooser`
  and `FilterChooser`.

Paths:

- Every path in the system is a JSON Pointer from the root of the blueprint, such as
  `/elements/posGrid/config/groupBy`. Edits, presets, personalizations and validation issues all
  use this form.
- An ID uses only letters, digits, `_` and `-`, so a path never needs escaping.
- A path never holds an array index. An array is replaced whole. Objects keyed by ID, such as
  `elements`, `variables` and `sources`, are addressed by key.

The core operations are `set` and `remove`, at a path. Four structural operations keep the tree
consistent:

| Op | Does |
|---|---|
| `addElement` | Adds an element, and a child reference in `parent` at an optional index. Appends by default |
| `removeElement` | Removes an element and its child reference. Refuses an element that still has children |
| `moveElement` | Moves a child reference to a new parent or position. The element does not change |
| `renameId` | Renames an element, variable or source, and updates every reference and path that names it |

- Each structural operation compiles into core operations. History, undo, presets and
  personalizations store only `set` and `remove`.
- Undo stores the inverse of each operation when it applies.
- A structural operation cleans up nothing else. An edit that removes a grid whose output sets a
  variable fails its checks, unless the same edit also changes the variable.
- A widget turns a user interaction into an edit. A sort becomes `set` on its `sortBy` path. A
  drag becomes one `set` when it ends.
- If the foundation refuses an edit from a user's interaction, such as a drag that overlaps
  another widget, the widget returns to the blueprint's state and the user sees the issue. What
  renders always matches the blueprint.

### State has four layers

| Layer | Meaning | Lives |
|---|---|---|
| Definition | The full authored config | The blueprint |
| Presets | Named sets of values for the paths that presets control, published by the author for users to switch between | The blueprint |
| Personalizations | One user's changes to personalizable paths | Per user, outside the blueprint |
| Transient state | Selection, expanded rows, scroll position and anything else not persisted | The models |

The layers apply in that order.

Two places declare what can vary:

- A widget's schema declares its `presetPaths`, at the size the widget manages its state. For a
  grid, that is the full column state: which columns show, their order and their widths. Every
  blueprint uses the same declaration.
- The designer chooses, in each blueprint, which preset paths a user can personalize. That
  choice shapes how users work with the blueprint. A path that is not a preset path cannot be
  personalizable.

```json
{
    "presets": {
        "posViews": {
            "label": "Columns",
            "controls": [{"path": "/elements/posGrid/config/columnState", "personalizable": true}],
            "default": "full",
            "items": {
                "full": {"label": "Full values", "set": {"elements": {"posGrid": {"config": {"columnState": ["..."]}}}}},
                "millions": {"label": "Millions", "set": {"elements": {"posGrid": {"config": {"columnState": ["..."]}}}}}
            }
        }
    },
    "elements": {
        "posGrid": {
            "component": "cubeGrid",
            "config": {"source": "positions", "groupBy": ["sector"], "sortBy": "pnl|desc"},
            "personalizable": ["/elements/posGrid/config/sortBy"]
        }
    }
}
```

- `presets` holds named preset groups, such as one per grid. Each group has a `label`,
  `controls`, `default` and `items`, and shows as its own switch. A path belongs to at most one
  group.
- A group's `controls` lists the paths its presets control. Those paths leave the element's
  config, because a preset is always active and a value in config would never apply.
- Every preset in a group sets every path the group controls, so switching presets always gives
  the same result.
- A preset's `set` has the shape of the blueprint itself, holding only the controlled paths. An
  edit reaches a preset value with a plain path, such as
  `/presets/posViews/items/full/set/elements/posGrid/config/columnState`.
- A controlled path declares `personalizable` in its group's `controls`. Any other path declares it
  in its element's `personalizable` list, which holds paths inside that element, or in a
  variable's default. Each path has one place for its value and its flag.
- A personalization sits on whatever it replaces. On a controlled path, the foundation keeps a
  user's personalization per preset, so a change to the columns of "Full values" stays with "Full
  values".
- Presets can control a variable's default, for example to switch between approved funds.
- The UI marks each value that a personalization replaces, and offers a reset to the value
  beneath it. A prompted variable shows the mark on its input in the toolbar.

### Versions and migrations

| What | Versioned by | Purpose |
|---|---|---|
| A blueprint's content | A counter that goes up with each edit, plus numbered publishes | History, `base` on edits, drafts and published versions |
| The blueprint format | `schema.blueprint` at the root | Changes to the envelope: elements, variables, sources and presets |
| Each registry entry a blueprint uses | An integer per entry | Changes to one widget's config, a variable type's value or a resolver's arguments |

```json
"schema": {
    "blueprint": 1,
    "widgets": {"cubeGrid": 3, "chart": 1, "portfolioBuilder": 1},
    "variableTypes": {"portfolio": 2},
    "resolvers": {"previousBusinessDay": 1}
}
```

- The versions sit at the root, so elements carry no version noise. The foundation writes the
  map on save, with only the entries the blueprint uses.
- Each registry entry ships one migration per version step. A migration has two pure functions
  over JSON, never over models. `config(config)` upgrades a config. `path(path, value)` upgrades
  one stored operation, and returns its new path and value, or nothing if the path is gone.
- On load, the foundation migrates the envelope, then each element, variable and resolver
  argument. It runs `path()` over every preset value and personalization that touches a migrated
  entry, and drops each operation that maps to nothing.
- Migration happens in memory. The next save or publish writes the new versions, so the
  foundation never rewrites a blueprint that no one edits.
- If a blueprint names a newer version than the app knows, that element renders as a fallback
  with a message. The rest of the blueprint renders.
- A blueprint does not pin a version of the Data Catalog. Fields never change their names, so
  the current catalog is always safe. Validation warns on a deprecated field and reports a
  missing one, and the widget shows the missing column rather than failing.
- Chat kit's content hash stays for one purpose only: to detect drift between the browser's
  prompt and tools and the server's.

### Validation issues

```json
{
    "code": "variable.typeMismatch",
    "severity": "error",
    "path": "/elements/pnlChart/config/filter",
    "message": "Variable 'asOf' is a localDate, but 'filter' takes a filter.",
    "op": 0,
    "fix": [{"op": "set", "path": "/elements/pnlChart/config/filter", "value": {"$var": "selection"}}]
}
```

- `code` is a stable ID, named by area, such as `structure.cycle`, `schema.required`,
  `variable.unknown`, `variable.writerConflict`, `field.deprecated` or `field.notDimension`.
  Widgets and apps add codes under their registry name, such as `cubeGrid.tooManyColumns`.
  Tools and tests match on the code, never on the message.
- `severity` is `error` or `warning`. An error blocks an edit and a publish. A warning does not,
  for example a deprecated field or a variable that nothing reads.
- `path` is a JSON Pointer into the blueprint as it would be after the edit.
- `message` is plain text for a person and the LLM alike. It names the values involved.
- `op` is the index of the operation in the edit that caused the issue, when one did.
- `fix` is optional: operations that resolve the issue, when the fix is mechanical, such as a
  deprecated field swapped for its `replacedBy`. The Architect can apply a fix, and a designer's
  editor can offer it as a button.
- One TS implementation runs every check, in the browser, where the tool loop runs.
- A widget's `validate` returns issues with paths inside its own config, and the foundation
  adds the element's path.
- While an LLM streams an answer, the foundation holds back issues that more input could still
  resolve.

### Authors publish, users run

- A document has a draft and published versions. Users always run the published version.
- Personalizations are edit operations keyed to the document, and to the preset for a path
  that presets control. After a publish, the foundation drops each operation whose path is gone
  or no longer personalizable. The document always wins.

### Access sets what can change

- A user has read or write access to a document.
- A blueprint shows a toggle between run mode and design mode. Only a user with write access sees
  design mode.
- In run mode, an edit goes to the user's personalizations, and only personalizable paths
  accept it.
- In design mode, an edit goes to the draft definition or to a preset.
- If a user without write access wants an authored change, the user saves a copy of the
  document and edits the copy.
- The edit tools enforce mode and access. The prompt does not.

The LLM follows these rules:

- If a request in run mode needs an authored change, the LLM says so. It offers design mode to a
  user with write access, and a copy to a user without it.
- If it is unclear whether an author means the definition or a preset, the LLM asks.
- The LLM gets the current mode and access level with each request.

### Fields live in the Data Catalog

The Data Catalog is the universe of data that blueprints can use: datasets, their parameters
and their fields. It is data, not code, and lives outside every blueprint. It keeps fields and
measures consistent across all blueprints. Hoist Blueprints defines its format, and the app
produces it from code, from a server, or from a stored document with its own versions.

```json
{
    "formats": {
        "mv": {"scale": "millions", "precision": 1, "ledger": true},
        "exposure": {"scale": "millions", "precision": 1, "ledger": true},
        "pnl": {"precision": 0, "ledger": true, "colorSpec": true, "tooltip": true}
    },
    "kinds": {
        "marketValue": {"base": "currency:USD", "format": "mv", "aggregator": "SUM"},
        "exposure": {"base": "currency:USD", "format": "exposure", "aggregator": "SUM"},
        "pnl": {"base": "currency:USD", "format": "pnl", "aggregator": "SUM"},
        "ticker": {"base": "string", "renderer": "ticker"}
    },
    "fields": [
        {"name": "fund", "label": "Fund", "type": "string", "isDimension": true, "category": "Organization"},
        {"name": "trader", "label": "Trader", "type": "string", "isDimension": true, "category": "Organization"},
        {"name": "sector", "label": "Sector", "type": "string", "isDimension": true, "category": "Classification"},
        {"name": "symbol", "label": "Symbol", "type": "string", "kind": "ticker", "isDimension": true, "parentDimension": "sector"},
        {"name": "instrumentName", "label": "Instrument", "type": "string", "aggregator": "UNIQUE"},
        {
            "name": "mktVal",
            "label": "Market Value",
            "type": "number",
            "kind": "marketValue",
            "description": "Value at the close.",
            "guidance": "Use for exposure questions, not grossMv."
        }
    ],
    "datasets": {
        "positions": {
            "label": "Positions",
            "guidance": "One row per position at the close of the as-of date.",
            "params": {"asOf": {"type": "localDate"}},
            "fields": [
                "fund", "trader", "sector", "symbol", "instrumentName", "mktVal",
                {
                    "name": "yield",
                    "type": "number",
                    "kind": "fraction",
                    "aggregator": {"type": "weightedAverage", "weightField": "mktVal", "absolute": true}
                },
                {"name": "var95", "label": "VaR (95%)", "type": "number", "kind": "currency:USD", "aggregator": "server", "category": ["Risk", "VaR"]},
                {"name": "pnlDay", "label": "Day P&L", "type": "number", "kind": "pnl"},
                {"name": "pnlMtd", "label": "MTD P&L", "type": "number", "kind": "pnl"},
                {
                    "name": "return",
                    "type": "number",
                    "kind": "fraction",
                    "aggregator": "server",
                    "params": {"start": {"type": "localDate"}, "end": {"type": "localDate"}}
                },
                {"name": "oldPnl", "type": "number", "aggregator": "SUM", "deprecated": true, "replacedBy": "pnlDay"}
            ]
        },
        "orders": {
            "label": "Orders",
            "params": {"asOf": {"type": "localDate"}},
            "fields": [
                "fund", "trader", "sector", "symbol", "mktVal",
                {"name": "dir", "label": "Direction", "type": "string", "renderer": {"name": "badge", "intents": {"Buy": "success", "Sell": "danger"}}}
            ]
        }
    }
}
```

- Fields that several datasets share, such as fund, strategy, trader and symbol, are defined
  once in the catalog's `fields`. A dataset lists a shared field by name, and defines a field of
  its own as an object. A shared field shows the same way in every dataset.
- A field's `name` is its ID and never changes. Its `label` can change. A field whose meaning
  changes is a new field. Blueprints that use the old field change on purpose, or the old field
  is marked `deprecated` with a `replacedBy`.
- `description` is for users. `guidance` is for the LLM, and falls back to `description`.
- `category` is a list, for any depth of grouping. A string is shorthand for one level.
- `type` is a Hoist `FieldType`: `string`, `number`, `int`, `bool`, `date` or `localDate`. A
  `localDate` travels as `YYYY-MM-DD`, and a `date` as epoch milliseconds.
- Grouping and aggregation use `CubeField`'s own properties: `isDimension`, `aggregator`,
  `parentDimension` and `isLeafDimension`. Only a dimension can appear in `groupBy`.
- A number with no aggregator, from the field or its kind, does not roll up: group rows show it
  blank, so nothing sums by accident. A string or date field with none uses `UNIQUE`.
- `aggregator` takes one of three forms. A Cube token, such as `SUM`. An object for an
  aggregator with config, such as a weighted average. Or `"server"`, for a measure only the
  backend can roll up, which maps onto a new Hoist aggregator that reads the server's values.
- `type` says how a value is stored. `kind` says what it means. The built-in kinds are
  `currency:<code>`, `fraction`, `bps` and `shares`. The Data Catalog defines its own kinds
  under `kinds`, such as `pnl` or `ticker`.
- A catalog kind has a `base`, which is a built-in kind or a type. It can set a named
  `format`, an `aggregator`, a `renderer` and other field defaults. A field takes its kind's defaults, and
  any property the field sets itself wins.
- Every P&L field uses the `pnl` named format through its kind, so a blueprint that redefines
  `pnl` reaches them all.
- A field can declare `params`, typed like variables, such as the start and end of a return.
- A dataset's `params` and a field's `params` take a `type`, `required` and `options`, in the
  form a variable's `options` takes.
- `parentDimension` applies in a dataset that carries the parent field. A dataset without it,
  such as daily prices for one symbol, ignores it.
- The catalogs for the scenarios are in [`catalogs/`](./catalogs/).

A blueprint uses the Data Catalog and adds only what is specific to it:

- A source binds its dataset's parameters.
- A source can declare instances of parameterized fields under its `fields`, each with a key,
  such as `retMtd` and `retYtd`. Widgets name an instance as they name any field. Widgets that
  name the same instance share one request column and one Cube field.
- An instance can give a `label`. Without one, its label is the field's label followed by its
  parameter values in parentheses, each formatted by the parameter's `kind`, or else by its type,
  such as "Shocked P&L (-10%)". A catalog parameter can name a `kind`, as a field does.
- A blueprint cannot define or change any other field.

### Formats are declarative and layered

A format is an object of serializable options with Hoist's own names. It holds no functions.

```json
{"scale": "millions", "precision": 1, "ledger": true, "colorSpec": true, "nullDisplay": "-"}
```

| Group | Options |
|---|---|
| Number | `precision` (0 to 6, `auto`, or `null` for full), `zeroPad`, `ledger`, `forceLedgerAlign`, `withPlusSign`, `withSignGlyph`, `withCommas`, `colorSpec`, `prefix`, `label`, `strictZero`, `zeroDisplay`, `nullDisplay`, `tooltip` |
| Scale | `scale`: `none`, `thousands`, `millions`, `billions`, or `auto` for a compact form such as `$48.5B`. It maps onto `fmtThousands`, `fmtMillions` and `fmtBillions`, and sets the label |
| Date | `date`: `date`, `dateTime`, `time` or `compact`, mapping onto `fmtDate`, `fmtDateTime`, `fmtTime` and `fmtCompactDate`. An optional `pattern` takes a moment format string |

- A field's `kind` sets a default format. A `fraction` shows as a percent. `bps` multiplies by
  10,000 with a `bp` label. A currency defaults to precision 2, and `shares` to precision 0. A
  catalog kind can name its own format.
- Named formats hold house styles, such as `"pnl": {"precision": 0, "ledger": true,
  "colorSpec": true}`. The Data Catalog declares them under `formats`, and fields refer to
  them by name rather than repeat their options.
- A blueprint's `formats` can add names, or redefine a catalog name for that blueprint only. A
  name resolves in the blueprint first, then in the Data Catalog. Redefining `pnl` in a
  blueprint changes every column that uses it in one edit. The UI marks a redefined name.
- Anywhere a format is accepted, it can be a name, an inline object, or a name with changes:
  `{"name": "pnl", "precision": 2}`.
- Formatting that needs code is a formatter in the registry, referenced by name.
- Renderers that draw more than text come from the registry. See
  [Renderers draw values](#renderers-draw-values).

Formats merge option by option, and the more specific level wins:

1. The kind's default.
2. The field's format in the Data Catalog.
3. The widget's format for that field, in the blueprint.
4. Presets and personalizations. A column's format is a natural preset path, for example to
   switch between full values and millions.

A column that sets an option itself keeps it when a named format changes. The Architect's
`find_usages` tool reports which columns use a named format, and which of them change it.

### Renderers draw values

A renderer draws a value as more than text, such as a bar, a badge or an arrow. Every renderer
is code in the registry, with a spec in this form:

```ts
interface RendererSpec<C> {
    name: string;                 // 'bar', 'badge', 'ticker'
    version: number;
    label: string;
    guidance: string;             // for the LLM: when to use it
    config: JsonSchema;           // its options, checked like widget config
    appliesTo: {types?: FieldType[], kinds?: string[]};
    render(value, ctx: {record, field, format, isAggregate, config}): ReactNode;
    exportValue?(value, ctx): string | number;   // for Excel export and copy
}
```

- A blueprint names a renderer, never code: `"renderer": "badge"`, or with options,
  `{"name": "bar", "max": 0.1}`.
- A renderer comes from the kind, then the field, then the widget's setting for that field.
  The more specific one replaces the other whole. Renderers do not merge.
- A renderer uses the format for any text it draws. It can choose not to draw on aggregate rows.
- Grids use renderers for cells. Stat cards and other widgets can use them for values.
- A renderer draws values, and never treats text from a model as markup. Its options pass its
  schema. An export uses `exportValue`, so a bar exports as its number.
- The first built-in renderers are `bar`, `badge`, which maps values to Hoist intents, and
  `delta`, an arrow and a color. An app registers its own, such as `ticker` for its `ticker`
  kind, or `weatherIcon` for a weather `condition` kind.
- A renderer that runs an action on click, such as a link to detail, waits for `openBlueprint`.

### The toolchain follows the design

The design comes first. The schema toolchain is chosen after the first vertical slice. It must:

- Give each component its own schema with no `$ref`, so chat can send one tool per component.
- Validate under a strict content security policy.
- Validate partial config while an LLM streams it.
- Let apps extend Hoist's widgets and types with no fork.

### The Architect's tools

| Tool | Input | Result |
|---|---|---|
| `read_blueprint` | Optional `paths` | The blueprint, or only those subtrees, with its version |
| `describe_catalog` | Optional `dataset`, `category` and `search` | Datasets, parameters and fields: name, label, type, kind, guidance, dimension, aggregator and params |
| `describe_registry` | `kind`: widget, resolver, action, variable type or renderer. Optional `names` | Specs: label, guidance, config schema, outputs, value, preset paths, sizes and an example |
| `edit_blueprint` | `base`, `description` and `ops` | The new version, or the issues with nothing applied. The tool enforces mode and access |
| `validate_blueprint` | Optional `ops` | Issues for the current blueprint, or for the ops as a dry run |
| `set_variable` | `variable` and `value` | The resolved value. Only a variable that a user may set, in any mode |
| `query_dataset` | `dataset`, `params` and `fields`. Optional `groupBy`, `filter`, `sortBy` and `top` | An artifact: its ID, columns, first rows and total rows, with the dataset and parameters it came from |
| `find_usages` | One of `field`, `format`, `variable` or `source` | Every path that uses it, and each column that overrides it |

- The system prompt carries a compact index: each dataset and widget with its label and one
  line. The Architect calls the `describe_` tools for the rest, so a large catalog never fills
  its context.
- A chat answer uses chat kit's tools: one `show_<widget>` tool per widget, and `show_ui` for a
  segment of several widgets. The editing tools above are separate.

## Plan

Hoist Blueprints is built in hoist-chat-kit for now, and moves into hoist-react with chat kit. The
work runs on a `blueprints` branch in sibling worktrees of hoist-react, hoist-chat-kit and
Toolbox, so Toolbox runs both packages inline. To start the client, run this in Toolbox's
`client-app`:

```bash
XH_INLINE_PACKAGES=@xh/hoist-chat-kit pnpm startWithHoist
```

The plan ends with a usable system: people and the Architect build, save, publish and run
blueprints in Toolbox's portfolio and weather apps. Phases 1 to 3 get there. Phase 4 adds
features that the spec already settles, in the order we choose.

### Phase 1: the foundation

1. Write scenarios in prose, from the user's side, for portfolio and weather data. See
   [`scenarios.md`](./scenarios.md). Done.
2. Write each scenario as a blueprint by hand, and settle the questions the scenarios raise.
   Done.
3. Test whether an LLM can build and edit the blueprints. Done: see
   [`guidance.md`](./guidance.md) and `tools/llm-test/`.
4. Build a vertical slice in Toolbox: P1, and P2 as a stretch. See [`slice.md`](./slice.md). It
   includes a JSON harness that applies a pasted blueprint and shows its issues, and an
   inspector that shows variables, their writers, resolved values and issues.

### Phase 2: the scenarios and the Architect

5. Cover the scenarios. Each hand-written blueprint in [`blueprints/`](./blueprints/) renders and
   runs in Toolbox, and passes its checks in the LLM harness:
   - P2: stat cards, charts, outputs and filter variables, if the slice did not finish them.
   - P3: tab containers, the `fund` app variable type and its input, the grouping chooser,
     preset groups and their switch, buttons and actions, an output bound to a source parameter,
     and named formats a blueprint redefines.
   - P5: parameterized field instances, the `"server"` aggregator in hoist-react's Cube, the
     `portfolioBuilder` app widget, and the `hypotheticalPortfolio` dataset.
   - W1 and W2: the weather datasets on Toolbox's server, from Weather V2, the toggle, and the
     `weatherIcon` app renderer.
6. Choose the schema toolchain, as [The toolchain follows the design](#the-toolchain-follows-the-design)
   requires, before step 5 adds many more widgets. Today `registry.json` is hand-written JSON
   Schema. Decide whether it stays that way, or comes from Zod or TypeSpec.
7. Let the Architect edit a blueprint in Toolbox. This can start once the slice works, beside
   step 5. A chat kit `ChatModel` sits beside the blueprint, and calls Claude through Toolbox's
   role-gated LLM relay. The Architect's tools run in the browser as chat kit client tools,
   against `BlueprintModel`, with the same engine and validator. A context provider sends the
   blueprint's version, mode, access and current variable values. The LLM harness's system prompt
   and [`guidance.md`](./guidance.md) become the Architect's prompt, and the scenarios become its
   acceptance tests in a real browser.
8. Make chat answers blueprints. Chat kit's generative UI core moves onto Hoist Blueprints:
   `ChatUiDocument` becomes an answer blueprint, `ChatUiCatalog` becomes the widget registry,
   and `show_ui` and the component tools take blueprint segments. The text formats and adapters
   produce segments. Adding an answer to a host becomes a feature. This covers P4 and W3.

### Phase 3: a usable system

9. Let people design blueprints. Design mode adds, moves, resizes and removes widgets on canvases
   and tabs, and edits variables and sources. A config editor comes from each widget's schema,
   with Hoist editors where they fit: a field picker for `x-field`, `GroupingChooser` and
   `FilterChooser`. Undo, redo and history come from the edits.
10. Save, open and publish blueprints. This settles Q11 and Q12. The app provides storage through
    an interface, with drafts, numbered publishes and the version check on `base` across users.
    Saving writes the `schema` map, and opening runs the migrations. A URL opens a blueprint, and
    its parameters set variables.
11. Run blueprints as users. Preset switches, personalizations with their marks and resets, and
    access with copies, from the follow-up scenarios in
    [`scenarios.md`](./scenarios.md#follow-up). This settles Q13, Q15 and Q25.
12. Build the portfolio and weather apps in Toolbox on the foundation. The weather app starts
    from Weather V2, which never merged, not from the current weather dashboard. A demo that
    calls the Claude API needs gating by role, limits and tracking. Anselm can give access to
    the platform's admin tools. Write the library's READMEs and doc registry entries, and turn
    [`guidance.md`](./guidance.md) into two skills: one for the Architect, one for designing a
    Data Catalog.

### Phase 4: features, in the order we choose

13. Prove that framework features are easy to add. Start with conditional styles on the base
    grid widget. A condition uses the filter grammar. A style is a Hoist intent or a registry
    class, never raw CSS.
14. Add `request_feature`, a tool the Architect uses when a request needs something Blueprints
    cannot do. The Architect says so, offers a workaround, and asks the user before it sends
    anything. A request holds a summary, a category such as "grid: conditional styles", the
    user's words, the workaround, and the relevant blueprint fragment. The app decides what
    leaves its environment, and delivers the request through its own endpoint, such as a
    hoist-core endpoint that forwards to XH's issue tracker. Requests in one category group
    together, with a count.
15. Add `openBlueprint`, to drill into detail such as a position or a strategy in a popover or a
    dialog, without leaving the blueprint.
16. Add text that reads variables, such as a title or a column header of "P&L for {fund}". Until
    then, a title can bind one whole variable.
17. Move Hoist Blueprints into hoist-react as `@xh/hoist/blueprint`, with chat kit.

These are in the spec but not yet in a step. Each needs only a priority, unless noted:

- Paging and very large results, as a capability a dataset declares.
- A mobile renderer, which shows a container's children in list order.
- A server-run Architect, once Q22 is settled.
- The Architect configuring a Data Catalog. This needs a design first: the spec defines the
  catalog's format, but not how it is edited.

## Open Questions

### Later

The vertical slice can stub these. Access, personalizations and locking wait for the follow-up
scenarios.

- **Q11.** Whether publishing needs its own permission, apart from write access. Plan step 10.
- **Q12.** Where things are saved: blueprints, their drafts, published versions and history,
  personalizations, and snapshots a blueprint owns. The slice can use a simple store. Plan step 10.
- **Q13.** Whether a copy records the blueprint and version it came from. Plan step 11.
- **Q15.** How a blueprint says its data is live or locked, for a one-off report that a user
  wants kept as it was. Plan step 11.
- **Q22.** How a server-run Architect edits a blueprint, and where its checks run. AG-UI shared
  state patches with JSON Patch (chat kit D125), but a blueprint changes only through checked
  edits, and the checks run in TS.
- **Q25.** How a personalization meets a publish that changes what it replaced. A personalized
  column state may lack a column the designer added. A personalized list of children may lack a
  widget the designer added. One rule: a personalization of a whole unit applies only while the
  unit names the same columns or children as the definition. Plan step 11.

### Settled

- **Q1.** The name of the system and its package. See [Names](#names).
- **Q2.** The terms for preset paths and personalizations. See [Names](#names).
- **Q3.** Where a layout keeps the position and size of each widget. See
  [The layout is made of elements](#the-layout-is-made-of-elements).
- **Q4.** The form of variables, bindings and widget outputs. See
  [Variables carry every value that moves](#variables-carry-every-value-that-moves).
- **Q5.** How a widget states the data it needs from a dataset. See
  [Widgets read sources](#widgets-read-sources) and
  [Chat answers are blueprints](#chat-answers-are-blueprints).
- **Q6.** The field vocabulary. See [Fields live in the Data Catalog](#fields-live-in-the-data-catalog).
- **Q7.** The format spec. See [Formats are declarative and layered](#formats-are-declarative-and-layered).
- **Q8.** The form of edit operations. See [Every change is an edit](#every-change-is-an-edit).
- **Q9.** Versions and migrations. See [Versions and migrations](#versions-and-migrations).
- **Q10.** The form of validation issues. See [Validation issues](#validation-issues).
- **Q14.** The form of filters. See [Filters use Hoist's filter form](#filters-use-hoists-filter-form).
- **Q16.** The name of the universe of datasets and fields. See [Names](#names).
- **Q17.** How a variable is configured, including what can set it and when it can be
  `personalizable`. See [Variables carry every value that moves](#variables-carry-every-value-that-moves).
- **Q18.** Whether the Data Catalog can define its own kinds of value. See
  [Fields live in the Data Catalog](#fields-live-in-the-data-catalog).
- **Q19.** Actions. See [Actions are typed and checked](#actions-are-typed-and-checked).
- **Q20.** Blueprints in a chat reply. See [Chat answers are blueprints](#chat-answers-are-blueprints).
- **Q21.** Widget names. See [Widgets are model and component pairs](#widgets-are-model-and-component-pairs).
- **Q23.** What a widget spec declares. See [Widget specs](#widget-specs).
- **Q24.** The Architect's tools. See [The Architect's tools](#the-architects-tools).
