# Phase 4 Design: Steps 16 to 18

> **Draft design, no code.** Step 16: conditional styles on `cubeGrid`. Step 17:
> `request_feature`. Step 18: `openBlueprint` drill-in. Step 19 (variable text in titles and
> headers) is ck's, and lives elsewhere. Items marked **John** change the format or a contract
> apps implement.

## Step 16: Conditional Styles on `cubeGrid`

A grid colors, bolds or flags cells and rows by their values, such as Day P&L under -100k in red.
It's built on hoist-react's `ColumnSpec.cellStyle` and `GridConfig.rowStyle` (hoist-react
6cf46519e).

### Format

Cell rules sit with the column they style, in `columns`, and row rules sit on the grid:

```json
"config": {
    "source": "positions",
    "columns": {
        "pnlDay": {"styles": [
            {"when": {"field": "pnlDay", "op": "<", "value": {"$var": "lossLimit"}}, "style": {"color": "danger", "fontWeight": "bold"}},
            {"when": {"field": "pnlDay", "op": ">", "value": 100000}, "style": {"color": "success"}}
        ]}
    },
    "rowStyles": [
        {"when": {"field": "sector", "op": "=", "value": "Energy"}, "style": {"background": "warning", "border": "warning"}, "rows": "leaves"}
    ]
}
```

- **`when`** is a `FilterSpec`, the grammar every blueprint filter uses, tested against the row's
  record. A leaf tests its own values, and a group row tests its aggregates. Its values can bind
  variables, so a threshold can be a prompt. Fields must be fields of the grid's source, and the
  validator checks them as it checks any filter.
- **`rows`**: `all` (the default), `leaves` or `groups`.
- **Order:** rules apply in order, and a later match wins property by property, as CSS does.
- **Caps:** 10 rules a column, 10 row rules.

**John - D16-1:** `columns.<field>.styles` and `rowStyles` are a new format section. One
alternative is a single grid-level list with a `fields` target. It's flatter, but it splits a
column's look between `columns` and the list. I recommend the per-column form, which matches
Hoist's `cellStyle` and `rowStyle`.

### The style allowlist

A style is a closed object. Every value comes from a list or a strict pattern, never free CSS:

| Key | Values | Becomes |
|---|---|---|
| `color` | an intent (`primary`, `success`, `warning`, `danger`), `muted`, or `#rrggbb` | `color: var(--xh-intent-<i>-text-color)`, the muted text variable, or the hex |
| `background` | an intent, or `#rrggbb` | `background-color: var(--xh-intent-<i>-trans1)`, or the hex |
| `fontWeight` | `bold`, `normal` | itself |
| `fontStyle` | `italic`, `normal` | itself |
| `textDecoration` | `underline`, `line-through`, `none` | itself |
| `align` | `left`, `center`, `right` | `text-align`, and `justify-content` for flex cells |
| `border` | an intent | an inset 3px left border in the intent's color, which leaves the column's width alone |

- **Safety:** this is the same approach as `highchartsConfig`, but stricter, since it's an
  allowlist rather than a list of refusals. Hex must match `^#[0-9a-fA-F]{6}$`. No key takes a free
  string, so nothing can spell `url(`, `var(--x)` or an expression. A binding goes only inside
  `when`, never in `style`.
- **Theme:** intents and `muted` follow the light and dark themes. A hex doesn't, so its guidance
  says to prefer intents, and to use a hex only for a brand color.
- **Rendering:** each column compiles its rules into one `cellStyle` function, and the grid into
  one `rowStyle` function, built again only when the resolved config changes. Each `Filter` is
  parsed once per build. A call returns only the properties its matching rules set: Hoist's grid
  clears a property a later call leaves out or sets to null (hoist-react 6cf46519e).
- **Accessibility:** color must not be the only signal. The guidance pairs a color with bold, or
  with a border on rows.

### Validator codes

- `style.unknownColumn`: `columns.<field>` names a field the source lacks. It already applies to
  `columns`.
- Filter checks on `when`: the existing filter codes, at `.../styles/<i>/when`.
- `style.badColor`: a color that's neither a known token nor a 6-digit hex. The schema catches
  this too, but the code gives a clearer message.
- `style.tooManyRules`: past a cap.
- `style.foldsNothing`, a warning: a `rows: groups` rule over a measure whose aggregator leaves
  group rows blank, such as a keyed value off its key, so it can never match.

### The Architect and the harness

- **Guidance in the `cubeGrid` spec:**
  - use styles for a threshold the user names, and bind it to a variable when the user might
    change it;
  - prefer intents;
  - put a column's rules in `columns`;
  - pair color with weight;
  - don't restyle what a renderer already shows, such as a `delta` arrow's color.
- **New scenario, P15:** "In my positions grid, show today's P&L in red when it's below minus
  100k and green above 100k, and shade the Energy rows." The checks:
  - two `pnlDay` rules using `danger` and `success`;
  - an Energy row rule;
  - no hex;
  - no binding in `style`;
  - the blueprint validates.

  Run it on both models.

### Who builds what

- **ck:**
  - the schema, the validator codes and the compiler from rules to `cellStyle`/`rowStyle` in
    `CubeGridWidgetModel`;
  - specs: each key maps to its CSS, later rules win, a group row tests its aggregates, a bound
    threshold moves the style without a reload, and hostile values are refused;
  - the guidance, and P15.
- **hr:** reviews the result. Nothing more is needed in hoist-react.

## Step 17: `request_feature`

When a user asks for something the registry can't do, the Architect offers to send a feature
request. It sends it only after the user approves the exact payload.

### The tool

- **Present only when the host passes a sink:** `architectChatTools(model, {catalog,
  featureRequests})`. Without one, the tool doesn't exist, and the prompt says nothing about it.
- **It always needs approval.** It uses the kit's approval card, as `request_design_mode` does.
  The card shows the whole payload, nothing hidden: the summary, category, the user's words
  quoted, the workaround, and the fragment's size with an expand option. Deny sends nothing.
- **When to offer it** (prompt and guidance): after trying the closest supported way, once per
  missing capability, and never instead of building what the registry already allows.

### The request

```json
{
    "summary": "A gauge that shows a target band",
    "category": "widget",
    "userWords": "can the gauge show our risk limit band in amber?",
    "workaround": "Added a callout under the gauge with the limit.",
    "fragment": {"component": "gauge", "config": {"source": "risk", "field": "var95"}}
}
```

| Field | Rule |
|---|---|
| `summary` | Up to 120 characters |
| `category` | `widget`, `renderer`, `variableType`, `resolver`, `action`, `format`, `data` or `other` |
| `userWords` | Up to 1,000 characters, and must appear word for word in one of the user's messages in this chat. The tool refuses it otherwise, so the model can't invent a quote or slip in text the user never wrote |
| `workaround` | Up to 500 characters: what the Architect did instead, or `null` |
| `fragment` | Optional: one element or config object, at most 5,000 characters of JSON. It must not hold `inline` rows or artifact references, so no data leaves with the request |

The kit adds `context` the model can't set: the app, its version, the user and the time. The
sink adds what the host knows, such as the blueprint open. Pass `withFeatureRequests` to
`architectPrompt()` with the sink, and the prompt gains its rules.

### The sink

```typescript
interface FeatureRequestSink {
    /** Store or forward a request. Returns an id to show the user, or throws to refuse it. */
    submitAsync(request: FeatureRequest): Promise<{id?: string; message?: string}>;
}
```

- **Limits:** one request per turn, enforced by the tool, and a per-user daily cap, enforced by
  the host's server.
- **Toolbox's sink:** POST `/blueprints/featureRequest`. The server validates the shape and caps
  again, checks the user is signed in, and stores the request: a `TrackService` entry in category
  `Blueprint Feature Request`, plus a JsonBlob list, viewed in an admin grid. That's as far as
  this design goes.

**John - D17-1:**
- The request shape and the `FeatureRequestSink` contract. Both are a new public API, and a
  contract apps implement.
- The external destination: GitHub issues, Jira, Slack or email, and who triages. Left open on
  purpose.

### Who builds what

- **ck:** the tool, the approval card, the word-for-word quote check, the fragment scrubbing, the
  prompt and guidance, and specs. The specs cover: a denial sends nothing, an invented quote is
  refused, inline rows are stripped or refused, and there's no tool without a sink.
- **tb:** Toolbox's sink, its endpoint, and the admin grid.
- **data:** the endpoint's server-side checks and cap.

## Step 18: `openBlueprint` Drill-in

A button or a row action opens another blueprint in a dialog or a popover, with variables passed
in, such as clicking a position to open its symbol's detail.

### The action

```json
{"type": "openBlueprint", "blueprint": "symbol-detail", "as": "dialog", "variables": {"symbol": {"$row": "symbol"}, "asOf": {"$var": "asOf"}}}
```

| Param | Rule |
|---|---|
| `blueprint` | The target's id, of the same type as the host blueprint |
| `as` | `dialog` (the default) or `popover`, anchored to the button |
| `title` | Optional. Defaults to the target's name |
| `variables` | Values for the target's variables: literals, `{"$var"}` or `{"$row"}`. The target decides which it accepts |

- **Values go through step 14.** The runner formats each value in its link text form, then opens
  through `BlueprintDocumentModel.openLinkAsync`. The target's `parseBlueprintLink` then applies
  the same rules a link meets: only link-settable variables, strict parsing per type,
  `checkVariableValue`, the caps, and one notice for anything ignored. There's one path for
  values crossing blueprints, and it's already specced.
- **Access:** the target opens through the host's repository, as the user. A reader gets the latest
  publish. A blueprint the user can't open shows `openAsync`'s refusal as a toast, and nothing
  opens. Repositories scope by type, so another type's id opens nothing.
- **Allowed in:** dashboards only. An answer would open stored blueprints from an LLM's choice, so
  answers wait until there's a reason to allow it.
- **Nesting:** a drill-in opens in run mode and read-only, and can't open another drill-in.
  `check()` refuses `openBlueprint` inside one, so its buttons show disabled with the reason.
- **Rendering:** a nested `BlueprintModel` shares the host's catalog, registry and data provider,
  and is destroyed on close. The dialog sizes to the target's root, within the viewport. A popover
  is for small targets, and its guidance says so.
- **Description:** "Open Symbol detail with symbol = AAPL", from the resolved values. That's its
  tooltip, as for every action.
- **Row actions:** `cubeGrid` has no action prop yet, though the format's action grammar already
  has `{"$row": field}`. Add `rowActions` (`x-action`) to `cubeGrid`: a list of
  `{label, icon, action}`, shown as the row's context menu, with the first also run on double
  click.

### Choosing the target

- **Design mode:** the action editor's `blueprint` param gets an `x-blueprint` picker over the
  host repository's list.
- **The validator** is synchronous and has no repository, so it checks only the shape. A missing
  or forbidden target is found when the action runs.
- **The Architect** needs the library to write the action. A new tool, `list_blueprints`, returns
  each summary's id, name and description, and the names and types of the variables a link may
  set, read from the target's latest publish (decision 167).

**John - D18-1:**
- The `openBlueprint` params and `cubeGrid.rowActions`, which are format changes.
- `list_blueprints`, which gives the Architect a view of the user's library. It shows only what
  the repository lists for that user.

The opener sits in the kit's desktop package, so apps implement nothing new.

### Who builds what

- **ck:**
  - the action spec and runner;
  - the value formatting, which reuses `blueprintLinkParams`' text forms, split out so both use one
    formatter;
  - the dialog and popover host, the nesting check, `x-blueprint`, `list_blueprints` and the
    guidance;
  - specs: values parse as a link does, a forbidden target opens nothing, nesting is refused, and a
    row action passes the row's value.
- **tb:**
  - a "Symbol detail" seed in Portfolio Blueprints, and a row action on P3's position grid that
    opens it;
  - a harness scenario: "When I click a position, open the symbol's detail".
- **hr:** review, and a headless check of the dialog and its notices.

## Order

1. John: D16-1, D17-1 and D18-1.
2. Step 16, which has no dependencies.
3. Step 18, which builds on step 14's formatter, split out first.
4. Step 17 last: its tool lands once John names the destination, while the sink and Toolbox's
   store can go first.
