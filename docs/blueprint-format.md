# Blueprint Format

A blueprint is a JSON document that defines a dashboard, a report or a chat answer over an app's
data. This doc is the reference for its format: each top-level key, the rules the validator
enforces, and the forms values take. For the classes that open, edit and store blueprints, see
[`/blueprint/`](../blueprint/README.md). For a registry entry's own contract, see
[Extending Blueprints](./blueprint-extensions.md).

Every rule here has one checker, `validateBlueprint()`. `BlueprintModel` runs it on every open and
every edit, and the Architect's tools run it too, so a person, an LLM and the app see the same
issues.

## Read a Blueprint at a Glance

```json
{
    "schema": {"blueprint": 1, "widgets": {"dashboard": 1, "cubeGrid": 1, "chart": 1}},
    "variables": {
        "asOf": {"type": "localDate", "label": "As of", "setBy": "prompt", "default": {"resolver": "previousBusinessDay"}},
        "selection": {"type": "filter", "setBy": {"element": "posGrid", "output": "selection"}}
    },
    "sources": {
        "positions": {"dataset": "positions", "params": {"asOf": {"$var": "asOf"}}}
    },
    "root": "page",
    "elements": {
        "page": {"component": "panel", "tbar": [{"id": "asOfInput"}], "children": [{"id": "dashboard"}]},
        "asOfInput": {"component": "variableInput", "config": {"variable": "asOf"}},
        "dashboard": {
            "component": "dashboard",
            "children": [
                {"id": "posGrid", "x": 0, "y": 0, "w": 8, "h": 6},
                {"id": "sectorChart", "x": 8, "y": 0, "w": 4, "h": 6}
            ]
        },
        "posGrid": {"component": "cubeGrid", "config": {"source": "positions", "groupBy": ["sector", "symbol"], "columnState": ["mktVal", "pnlDay"]}},
        "sectorChart": {"component": "chart", "config": {"source": "positions", "type": "column", "x": "sector", "y": ["pnlDay"], "filter": {"$var": "selection"}}}
    }
}
```

| Key | Holds |
|-----|-------|
| `schema` | The format's version, and the version of each widget, variable type and resolver it uses. The library writes it on save |
| `variables` | Values that widgets share, by name |
| `sources` | Data by name, each read by any number of widgets |
| `formats` | Named number and date formats, beside the catalog's |
| `presets` | Named groups of settings that a user switches between |
| `root` | The ID of the top element |
| `elements` | Every element by ID: its widget, its config, and for a container, its child references |

Every object in a blueprint refuses keys it does not know (`structure.unknownKey`), except below
the top level of a chart's `highchartsConfig`. An ID uses
only letters, digits, `_` and `-`, and is never `__proto__`, `prototype` or `constructor`.

## Lay Out Elements

Every element sits in the flat `elements` map. An element has a `component`, the name of a
registered widget, and an optional `config`, checked against that widget's config schema. A
container also lists its children.

- **Child references.** A container's `children` is a list of references: the child's ID, plus
  what the container needs to place it. A `dashboard` takes `x`, `y`, `w` and `h` on a grid of
  its `columns`, 12 by default. It can also take `title`, which replaces the widget's title in the
  cell header, and `hideHeader`, which draws the cell without one. Every other cell has a header,
  titled by the widget's label where nothing gives a title. A dashboard packs its cells upward unless
  its `compact` says `'horizontal'`, or `false` for cells that stay where they are put. Its other
  layout settings follow Hoist's `DashCanvas`: `margin`, `containerPadding`, `maxRows`,
  `showGridBackground`, `preventCollision` and `layoutLocked`. Unlike Hoist, `layoutLocked`
  defaults to `true` on a dashboard and on a `panes`: readers cannot rearrange either unless
  it sets `layoutLocked: false`, and design mode always can. A `tabContainer` takes `title` and
  `icon`. A `box` takes `flex`,
  `width` and `height`. A child with none of these takes an equal share of the box, except an
  input, a button row, a toolbar or a separator, which keep their own size, and `markdown` or a
  `callout` in a column, which keep their own height. Give text a `flex` for a share it scrolls in.
- **Slot lists.** A container can hold named lists beside `children`, each named for the
  component prop it fills. A `panel` has `tbar` and `bbar`, toolbars above and below its
  content, and `headerItems`, inputs in its header. A child reference can hold a slot list too,
  as a `dashboard` cell holds `headerItems` for its header. A reference in a slot other than
  `children` holds the ID alone.

    ```json
    {"id": "posGrid", "x": 0, "y": 0, "w": 8, "h": 6, "headerItems": [{"id": "posViews"}]}
    ```

- **One place each.** An element sits in exactly one slot list of one parent, and `root` has
  none (`structure.twoParents`, `structure.notPlaced`). Each slot accepts only the widgets or
  categories its spec names (`element.notAccepted`), up to its `maxItems` (`slot.full`).
- **No layout in config.** A move or a rearrange changes only child references.
- **A free canvas.** A `dashboard` does not compact. The validator refuses cells that overlap or
  reach past the last column (`layout.overlap`, `layout.outOfBounds`).

Containers nest, so a `tabContainer` can hold dashboards, and a dashboard can hold a `panel` with a
grid and its toolbar. [Built-in Widgets](#built-in-widgets) lists each container.

## Share Values with Variables

Every value that feeds a blueprint is a variable: an as-of date, a fund, a grid's selection. A
variable lives at the root, under its name, with a `type`, an optional `label`, what sets it, and
a default. A variable with no `label` shows to users by its name in words, as `asOf` reads "As Of".

```json
"variables": {
    "asOf": {"type": "localDate", "label": "As of", "setBy": "prompt", "default": {"resolver": "previousBusinessDay"}},
    "fund": {"type": "acme.fund", "setBy": "prompt", "default": {"value": "Oak Mount"}, "options": {"source": "funds", "field": "fund"}},
    "periodStart": {"type": "localDate", "setBy": "resolver", "compute": {"resolver": "quarterStart", "args": {"from": {"$var": "asOf"}}}},
    "selection": {"type": "filter", "setBy": [{"element": "stratGrid", "output": "selection"}, {"element": "posGrid", "output": "selection"}]}
}
```

**Types.** Hoist's field types `string`, `number`, `int`, `bool`, `date` and `localDate`, plus
`filter`, `dateRange` and `period`, an app's own types under dotted names such as `acme.fund`, and
lists of any of these, written `string[]`. An app type declares the field type its values match,
so an `acme.fund` binds wherever a `string` fits.

**What sets it.** `setBy` names every writer, and nothing else can set the variable:

| `setBy` | Set by | A link and the Architect can set it |
|---------|--------|-------------------------------------|
| `"prompt"` | The user, through a `variableInput` element that shows it. Validation warns of one that none shows | Yes |
| `{"element": id}` | A widget that shows the value and sets it, such as a `select` | Yes |
| `{"element": id, "output": name}` | A widget's runtime state, such as a grid's `selection`. An output can take an argument, such as `"field": "symbol"` | No |
| `"resolver"` | Its `compute`, run again whenever its inputs change | No |
| `"action"` | Actions, such as buttons for MTD and YTD | Yes |
| `"host"` | App code, through `BlueprintModel.setHostVariable()`, for a blueprint hosted inside an app. Never personalizable | No |
| Absent | Nothing. The variable is a constant | No |

- Only a `filter` variable takes several writers. Their filters join with AND, and a writer with
  no value adds nothing. Any other variable has at most one (`variable.writerConflict`).
- A widget's config never names a variable it writes. The variable's `setBy` names the widget.

**Defaults.** A default is an object, so a literal that is itself an object never reads as a
resolver: `{"value": ...}` or `{"resolver": name, "args": {...}}`. A resolver's args can bind other
variables, and the validator refuses a cycle (`variable.cycle`). The built-in resolvers are
`today`, `previousBusinessDay`, `dateOffset`, `monthStart`, `quarterStart`, `yearStart`,
`rangeStart`, `rangeEnd`, `periodStart` and `periodEnd`. `describe_registry` lists each one's
args.

**Options.** `options` limits a prompt's choices: `{"values": [...]}`, or `{"source", "field"}`
for the values of a field in one of the blueprint's sources.

**Bindings.** Config reads a variable one way, `{"$var": "asOf"}`. A property whose value is a
boolean, a number, a string, one of an enum or a list of strings takes a binding, unless its
schema says `x-binding: false`. A reference, such as a source, a field or a format, takes none, nor
does an object. Config holds no expressions. The validator checks each binding:

- The variable's type fits the property (`binding.typeMismatch`), and so does every value it may
  hold (`binding.outOfRange`).
- A required property reads a variable with a default, as it may otherwise be empty
  (`binding.mayBeNull`).
- A path that presets control is bound inside each preset, never in the element's config
  (`preset.stillInConfig`). A binding in a preset is checked as one in config is.

A bound value changes through its variable, so a user does not personalize it at its own path.

**Literals.** A source parameter always binds a variable, and so does a filter value a user
might change. A literal that defines what a widget is, such as a chart of one sector, can stay
in config. A chat answer is a fixed record, so its parameters can be literals.

## Read Data from Sources

A source names a dataset from the app's `DataCatalog` and binds its parameters. Widgets name a
source and never repeat its parameters. Widgets on one source share one request, and each reads
the source's Cube through its own `View`.

```json
"sources": {
    "positions": {
        "dataset": "positions",
        "params": {"asOf": {"$var": "asOf"}},
        "filter": {"field": "fund", "op": "=", "value": {"$var": "fund"}},
        "fields": {
            "pnlDay": {"label": "Today"},
            "retMtd": {"field": "return", "params": {"start": {"$var": "monthStart"}, "end": {"$var": "asOf"}}}
        }
    }
}
```

- **Demand.** Each widget states the fields and groupings it needs. The library combines them
  into one request per source, `{dataset, params, fields, groupBy, filter}`.
- **Two filters.** A source's `filter` goes to the server with the request. A widget's `filter`
  applies in the browser, so a filter bound to a selection updates with no reload.
- **Field instances.** A catalog field with parameters, such as a return over a period, needs an
  instance under the source's `fields`, with a key such as `retMtd`. Widgets name the instance as
  they name any field. Without a `label`, it shows the field's label and its parameter values.
- **Display overrides.** An entry with no `field` key changes how a catalog field shows over
  this source: its `label`, `description`, `align`, `width`, `format` and `renderer`. It never
  changes the data. A blueprint cannot define any other field.
- **Waiting.** A source waits while a required parameter has no value, or while a parameter
  bound to a widget's output has none, so a price chart waits for a selected symbol.
- **Server rollups.** A field whose aggregator is `server` shows the totals the server computes
  for each group. A widget filter that cannot fold into those groups blanks them, and the
  validator warns (`filter.cannotFold`).

A source is one of three kinds, and widgets do not know which they read:

| Kind | Key | Runs again | Allowed in |
|------|-----|------------|------------|
| Dataset | `dataset` | When its parameters change, and on refresh | Any blueprint |
| Artifact | `artifact` | Never | Chat answers only |
| Inline | `inline` | Never | Chat answers, or a short list a person writes, up to 50 rows |

## Join Sources

A source can take fields from other sources, so one widget shows data from several datasets
without the server joining them:

```json
"positions": {
    "dataset": "positions",
    "params": {"asOf": {"$var": "asOf"}},
    "joins": [{"source": "fundSummary", "on": {"fund": "fund"}, "fields": ["nav"]}]
}
```

A join is a left join. `on` maps each field of this source to the joined source's field it
matches, and `as` renames a joined field whose name this source already has. Each catalog dataset
declares its `key`, and the two keys set the grain of each joined field:

- **The same grain.** Values copy onto the primary's rows, and roll up as usual.
- **A coarser grain**, such as a fund's NAV on positions. The value shows on each group that pins
  the key, blank where it would mean nothing, and the total counts each key once.
- **A finer grain**, such as a time series. The joined source reduces to the key first.

A filter on joined fields runs on the joined source first, and the primary's request then filters
on the matching keys. A joined source shares the primary's parameters unless it binds its own.

## Filter Rows

Every filter in a blueprint is a Hoist `FilterSpec` as JSON: the form that `FilterChooser`, `Store`
and `Cube` take, and that hoist-core parses.

```json
{
    "op": "AND",
    "filters": [
        {"$var": "selection"},
        {"field": "region", "op": "=", "value": ["EMEA", "APAC"]},
        {"field": "pnlDay", "op": "<", "value": {"$var": "lossLimit"}}
    ]
}
```

- A field filter is `{field, op, value}`. A compound is `{op, filters}`, with `op` `AND` or `OR`.
- The operators are Hoist's: `=`, `!=`, `>`, `>=`, `<`, `<=`, `like`, `not like`, `begins`,
  `not begins`, `ends`, `not ends`, `includes` and `excludes`. A list value with `=` or `!=`
  means any of the values, or none of them.
- A whole filter, or one member of a compound, can be `{"$var": name}` for a `filter` variable.
  A field filter's `value` can bind a variable of the field's type.
- A bound value that is null drops its clause, so "all funds" needs no special case. A literal
  `null` keeps Hoist's meaning and matches empty values.

## Format Values

A format is an object of Hoist's own format options. It holds no functions.

| Group | Options |
|-------|---------|
| Number | `precision` (0 to 12, `auto`, or `null` for full), `zeroPad`, `ledger`, `forceLedgerAlign`, `withPlusSign`, `withSignGlyph`, `withCommas`, `colorSpec`, `prefix`, `label`, `strictZero`, `zeroDisplay`, `nullDisplay`, `tooltip` |
| Scale | `scale`: `none`, `thousands`, `millions`, `billions`, or `auto` for a compact form such as `$48.5B` |
| Date | `date`: `date`, `dateTime`, `time` or `compact`, with an optional `pattern` |

Anywhere a format goes, it can be a name, an object, or a name with changes:
`{"name": "pnl", "precision": 2}`. A name resolves in the blueprint's `formats` first, then in
the catalog's, so a blueprint that redefines `pnl` changes every column that uses it.

A catalog format's `label` can follow a dataset param, as a wind speed reads in mph or m/s by its
units: `{"label": {"param": "units", "values": {"imperial": " mph", "metric": " m/s"}}}`. Each
source applies it from its own params, unless a more specific level names a label of its own. The
catalog refuses a param its dataset does not take, and a value that is not text.

Options merge one by one, and the more specific level wins: the field's kind, then the catalog
field, then the source's display override, then the widget's own setting, then the active preset.

## Draw Values with Renderers

A renderer draws a value as more than text. A blueprint names one, `"renderer": "badge"`, or
with options, `{"name": "bar", "max": 0.1}`. The more specific setting replaces the other whole,
from the kind, to the field, to the source, to the widget's column.

| Renderer | Draws |
|----------|-------|
| `bar` | A bar sized against the largest value in the column, or against `max` |
| `badge` | A Hoist badge, its intent mapped from the value by `intents` |
| `delta` | An arrow and a color for the sign |
| `progress` | A progress bar to `max` or a row's `maxField`, with an optional target |
| `sparkline` | A sparkline of a series field |

## Style Cells and Rows by Their Values

A grid colors, bolds or flags cells and rows by their values. A column's rules sit in its
`columns` entry, and row rules on the grid:

```json
"columns": {
    "pnlDay": {"styles": [
        {"when": {"field": "pnlDay", "op": "<", "value": {"$var": "lossLimit"}}, "style": {"color": "danger", "fontWeight": "bold"}}
    ]}
},
"rowStyles": [
    {"when": {"field": "sector", "op": "=", "value": "Energy"}, "style": {"background": "warning", "border": "warning"}, "rows": "leaves"}
]
```

- `when` is a filter, tested on each row: a leaf's own values, or a group row's totals. Its
  values can bind variables, so a threshold can be a prompt.
- `rows` picks `all` rows (the default), `leaves` or `groups`.
- Rules apply in order, and a later match wins property by property. A column and the grid hold
  at most 10 rules each (`style.tooManyRules`).
- A style takes `color` (an intent, `muted` or `#rrggbb`), `background` (an intent or `#rrggbb`),
  `fontWeight`, `fontStyle`, `textDecoration`, `align`, and `border` (an intent). It takes no other
  key, no free CSS, and no binding (`style.badColor` for a bad color).
- A `groups` rule over a measure that group rows show blank never matches, and the validator warns
  (`style.foldsNothing`).

## Write Text with Live Values

A `markdown` or `callout` element's text, and other text marked `x-template`, reads values as it
renders: `{fund}` for a variable, and `{positions.pnlDay}` for a source's total of a field,
formatted as the field formats. `{{` and `}}` write a literal brace. The validator checks every
reference, and warns of a figure written into the text, such as `$4.2m` or `3.5%`
(`template.literalFigure`), as it would be wrong the next day.

Titles read variables too, so a title can say what the user chose: `"P&L for {fund}"`. A widget's
`title`, a tab's or a `panes` view's `title` on its child reference, a `statCard`'s
`label` and a grid column's `headerName` all fill each `{variable}` as plain text, and follow the
variable as it changes. A title reads variables only. A source reference in one is an error
(`template.variablesOnly`), as is a name that is no variable (`template.unknownRef`).

## Switch Views with Presets

A preset group holds named sets of values that a user switches between, such as a grid's P&L
and Risk columns.

```json
"presets": {
    "posViews": {
        "label": "Columns",
        "controls": [{"path": "/elements/posGrid/config/columnState", "personalizable": true}],
        "default": "pnl",
        "items": {
            "pnl": {"label": "P&L", "set": {"elements": {"posGrid": {"config": {"columnState": ["mktVal", "pnlDay", "pnlMtd"]}}}}},
            "risk": {"label": "Risk", "set": {"elements": {"posGrid": {"config": {"columnState": ["mktVal", "var95", "beta"]}}}}}
        }
    }
}
```

- `controls` lists the paths the group's presets set. Each is a widget's preset path, which its
  spec declares, or a variable's default. A path belongs to one group at most.
- A controlled path leaves the element's config, since a preset always applies
  (`preset.stillInConfig`). Every preset sets every path its group controls, so a group has at
  least one preset (`preset.noItems`), and a path the widget requires may leave its config.
- A preset's `set` has the shape of the blueprint itself, holding only the controlled paths.
- A `presetSelector` widget shows the group, as a segmented control, buttons, a select, or a
  toggle for exactly two presets. Put it in the header of the widget the group controls: its
  dashboard cell's `headerItems`, or its panel's. A group with no selector stays at its default, and
  the validator warns (`preset.noSelector`).

## Run Actions

An action prop, such as each button of a `buttonGroup`, takes one action or a list of up to 8
that run as steps:

```json
{"label": "MTD", "action": {"type": "setVariable", "variable": "period", "value": "MTD"}}
```

- An action's parameters sit beside its `type`, and the runner checks them against the type's
  schema before any step runs. Values are literals, `{"$var": name}`, or, for an action run on a
  row, `{"$row": field}`.
- The built-in types are `setVariable`, `resetVariable`, `refresh`, `navigate`, `openUrl` and
  `openBlueprint`. Chat answers add chat kit's `send` and `callTool`. Apps add their own.
- A grid's `rowActions` list actions on a row, in its right-click menu, the first also on a double
  click. `{"$row": field}` reads the row's fields and the value of each group on its path.
- An action can set only a variable a link could set. To clear one, use `resetVariable`.
- Each step starts once the one before it ends. If a step fails, the rest do not run, and the
  user sees why. A step with `confirm`, or of a type with side effects, asks the user first.
- `openUrl` opens only the http and https URLs on the app's allow list, which is empty by default.
- `openBlueprint` opens another blueprint of the same type over this one, in a dialog or a
  popover at its button: `{"type": "openBlueprint", "blueprint": id, "as": "dialog", "variables":
  {"symbol": {"$row": "symbol"}}}`. Its values reach the target as a link's do, so the target takes
  only the variables a link may set. It opens in run mode, read only, cannot open another, and only
  dashboards may use it.

## Change a Blueprint with Edits

Every change is an edit: a list of operations, applied as one unit. With any error, nothing
applies, and the edit returns its issues. One edit is one undo step and one history entry.

```json
{
    "base": 42,
    "description": "Add a returns chart",
    "ops": [
        {"op": "addElement", "id": "retChart", "element": {"component": "chart", "config": {"source": "positions", "x": "sector", "y": ["retMtd"]}}, "parent": "overview", "child": {"x": 0, "y": 6, "w": 6, "h": 4}}
    ]
}
```

| Op | Does |
|----|------|
| `set` / `remove` | Sets or removes the value at a path |
| `addElement` | Adds an element, with its reference in a `parent`'s slot list: `children` by default, or the `slot` given, on the child reference `of` names |
| `removeElement` | Removes an element and its reference, and its view from a panes widget's layout. Refuses one that still has children |
| `moveElement` | Moves a reference to another parent, slot or index, dropping its view from the panes widget it leaves. The element does not change |
| `renameId` | Renames an element, variable or source, and updates every reference to it |

- A path is a JSON Pointer from the root, such as `/elements/posGrid/config/groupBy`.
- A path never holds an array index. Replace the whole array.
- `base` is the version the edit was written against. An edit on an older version is refused
  (`edit.staleBase`): read the blueprint again and rewrite the edit.

## Read Validation Issues

```json
{"code": "variable.typeMismatch", "severity": "error", "path": "/elements/pnlChart/config/filter", "message": "Variable 'asOf' is a localDate, but 'filter' takes a filter."}
```

- `code` is stable, named by area, such as `structure.twoParents` or `field.notDimension`. A widget's
  own codes take its name, such as `gauge.minNotUnderMax`. Match on the code, never the message.
- An `error` blocks an edit, an open and a publish. A `warning` does not.
- `config.incomplete` marks a widget left unfinished: a required property missing, or a list or
  text short of its minimum. A person editing in design mode may leave a widget so. The issue is
  a warning on the property, and the widget draws a note that names what it lacks, with a way to
  set it. Publishing refuses while any widget is unfinished. The Architect's edits and a chat
  answer count it as an error, so they build complete widgets. Pass `strict` to
  `validateBlueprint()` to count it so too.
- `path` points into the blueprint as it would be after the edit, and `op`, when present, is the
  index of the operation that caused it.

## Chat Answers

A UI answer in a chat is a blueprint too, so a user can add it to a dashboard. An answer differs
in four ways:

- It is fixed once its turn ends, with no design mode and no publishing.
- It may hold literal parameters, artifact sources and inline rows the LLM computed.
- It cannot use an action with side effects, or one not allowed in answers.
- Each segment of a reply is its own blueprint, and no segment reads another's variables.

To add an answer to a dashboard, the Architect translates it. An artifact becomes a dataset
source, a literal becomes a variable or a resolver, and a computed value becomes a widget over a
source.

## Built-in Widgets

`describe_registry` gives each widget's full config schema and guidance. An app's widgets sit
beside these under dotted names.

| Widget | Category | Shows |
|--------|----------|-------|
| `dashboard` | container | A 12-column grid of widgets placed by x, y, w and h. A dashboard's usual root |
| `tabContainer` | container | One child at a time, under a row of tabs |
| `panes` | container | Views a user drags into tabs, stacks, rows and columns |
| `panel` | container | A titled section or card that stacks its children, with `tbar`, `bbar` and `headerItems` |
| `box` | layout | A row or column of children, with no chrome |
| `tileFrame` | container | Equal tiles that wrap, such as a row of stat cards |
| `separator` | layout | A rule between siblings, with an optional label |
| `spacer` | layout | Empty room that pushes its siblings apart |
| `markdown` | content | Markdown text, with live values |
| `callout` | content | A tinted note with an icon, for a caveat, a warning or a takeaway |
| `toolbar` | container | A row of inputs, on its own or in a panel's `tbar` or `bbar` |
| `select`, `dateInput`, `dateRangePicker`, `numberInput`, `textInput`, `switchInput`, `slider` | input | An input that sets one variable |
| `variableInput` | input | The input a prompted variable's type calls for, usually in the root panel's `tbar` |
| `filterChooser` | input | A filter built from the values of its source's dimensions |
| `groupingChooser` | input | The dimensions a grid groups by |
| `buttonGroupInput` | input | A segmented control that picks one option of a string variable |
| `presetSelector` | input | A preset group's presets, to switch between them |
| `buttonGroup` | action | A row of buttons, each running an action |
| `cubeGrid` | data | A flat or grouped grid. Its selection is an output |
| `chart` | data | A Hoist chart, grouped by a dimension or over time. Its selection is an output |
| `statCard` | data | One headline number, with an optional change and trend |
| `gauge` | data | One reading on an arc from `min` to `max`, such as humidity or usage against a limit |
| `propertyTable` | data | Labeled values: the totals of some rows, or one row's values |
| `heatmap` | data | Cells colored by a value over two dimensions. Its selection is an output |
| `treemap` | data | Nested boxes sized by a value and colored by heat. Its selection is an output |

`heatmap`, `treemap`, `gauge` and some chart types need Highcharts modules. A widget whose module
the app has not loaded draws a notice in its place.
