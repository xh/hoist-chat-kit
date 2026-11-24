# Blueprints UI: Inspector build plan

Decision 206: the Inspector redesign, approved with every recommendation (I-1 to I-14), except that booleans keep the On | Off segmented control. Proposal and mockups: https://claude.ai/artifact/7NwChMNC2kCeNhcypPGkwJ. Owners:
- **ck**: the kit, meaning the Inspector, the schemas, the descriptions and the Architect's view of them.
- **tb**: Toolbox, meaning the Registry page and the docbar.
- **hr**: hoist-react, meaning the segmented control's selected state.

`blueprints-ui` checks each batch on page 1 of John's debug Chromium, in both the light and dark themes.

## Choices, resolved (decision 206)

| # | Resolved |
|---|---|
| I-1 | A list item with more than six settings, or with a list inside, opens its own page. Its row in the list opens its common settings in place |
| I-2 | Six fixed sections, in this order: Data, the widget's list, Content, Appearance, Behavior, Layout. Empty sections are hidden. Display and Style merge into Appearance |
| I-3 | Advanced settings sit behind a "N more" row at the end of each section, and its fold state is remembered per widget type. A setting with a value always shows |
| I-4 | Help is a rich tooltip on the label, plus the focused row's first sentence. Every property has a description, enforced by a test |
| I-5 | **Amended:** booleans keep On \| Off segmented controls, not switches. The selected option is filled and the others outlined, so the state reads at a glance |
| I-6 | Picture cards for four options or fewer. Beyond that, a select with an icon per option (e.g. chart type) |
| I-7 | The header holds + (add after) and ⋯ (Duplicate, Wrap in, Change type, Delete). The action strip and the bottom Remove button go |
| I-8 | Layout (today's Placement) comes last, folded to a one-line summary. A selected view shows its View and Position sections first |
| I-9 | A dot marks a set row. Hovering shows ↺ to reset it, and Delete on a focused control resets it |
| I-10 | "Find a setting" opens with / or the header's magnifier. It searches labels, keys and descriptions, including hidden settings and item pages |
| I-11 | The schema owns grouping (annotations below). `WidgetSpec.sections` goes once every widget has moved |
| I-12 | Chart series become a `series` map keyed by measure, like the grid's `columns`. `highchartsConfig` stays as the escape hatch |
| I-13 | The canvas outlines the column, series or view whose row or page is open |
| I-14 | Section headers in sentence case, with no band fill and a rule between sections |

## Rules

- **Rows.** A 104px label column, then the control, every control ending at the same right edge. Only multi-value controls stack the label above: field lists, text areas, filters and lists. Numbers that belong together share a row (Width · Min · Max; Column · Row · Width · Height).
- **Counts** are words: "3 set", "5 columns", "none".
- **States**, the same for every control:
  - unset with a default: the default in muted text, nothing written;
  - set: the dot, plus ↺ on hover;
  - unset where the widget decides: says what happens ("Auto", "From the field", "No title");
  - bound to a variable: a chip replaces the control;
  - required and missing (192): warning-tinted, and the widget's "Needs setup" button focuses the row;
  - set by a preset: a badge that selects the preset group.
- **Defaults (108, 112): two gaps to close in A.**
  - A boolean writes its value even when it equals the default (`ConfigEditors.ts:291`). Picking the default must remove the value, as choices and pairs already do.
  - The Inspector reads the schema's `default` (`editorSpec.ts:118`) instead of `configDefault` (`BlueprintWidgetModel.ts:190`). It must read `configDefault`, so it shows what the widget draws.
- **Folding** is keyed by widget type plus section, not by label alone.
- **Speed.** A row redraws only for its own value, issues, badge or binding. A page renders one item, and folded sections and "N more" don't render their rows.

## Schema annotations (ck)

```ts
// A widget property
showGroupRowCounts: {
    type: 'boolean', default: true, title: 'Group counts',
    description: 'Shows how many rows each group holds, after its label.',
    'x-group': 'appearance',   // data | list | content | appearance | behavior | layout
    'x-advanced': true         // behind "N more"; absent means common
}

// A list item's schema
columns: {additionalProperties: {
    type: 'object',
    'x-groups': [{id: 'header', label: 'Header'}, {id: 'values', label: 'Values'},
                 {id: 'size', label: 'Size and position'}, {id: 'styles', label: 'Conditional styles'},
                 {id: 'chooser', label: 'Chooser and export', collapsed: true}],
    'x-common': ['headerName', 'format', 'width', 'hidden'],   // shown when the row opens
    'x-summary': ['format', 'pinned', 'width'],                 // the row's chips
    'x-page': true,                                             // force a page, or false to forbid one
    properties: {headerName: {/* ... */ 'x-group': 'header'}, /* ... */}
}}
```

| Annotation | Inspector | Registry page (tb) | Architect (`describe_registry`) |
|---|---|---|---|
| `description` | Tooltip, focused-row help, search | Shown per property | Passed through, as today |
| `x-group` | Section | Groups properties under the same six headings | Passed through |
| `x-advanced` | Behind "N more" | A "More" heading per group | Passed through. The prompt says to prefer common settings and leave advanced ones unset unless asked |
| `x-groups`, `x-common`, `x-summary`, `x-page` | A list item's groups, inline settings, chips and page | Nested items grouped the same way | Stripped, as `x-thumbnails`, `x-labels` and `x-unset` are |

A property is common unless marked `x-advanced`, so a new property shows until someone decides to hide it. List items invert this with `x-common`.

## Batches

Order: S runs alongside everything. Then A, B, C and D in that order.

### S: speed

The redesign doesn't wait on these.

| # | Owner | Item | Check |
|---|---|---|---|
| S1 | ck | Pass stable callbacks through refs to a drawer row's Select, and to the field list's "Add a field…" select | On one-grid with a column drawer open, a pick's second commit redraws only the changed select |
| S2 | tb | Split the docbar into small observers (status chip, undo/redo, Issues, "vN live", Publish). Make autosave's status changes one update | An Inspector edit redraws about 30 or fewer docbar components, down from about 260 |
| S3 | tb | Write `EditorModel.draft` in the edit's own action, or make it a computed. Skip `closeCompare` when no compare is open. Load the store that `noteLoad` reloads on every edit only while its view shows | `mobx.spy` over one edit shows none of the three |

### A: annotations, descriptions, defaults (ck)

| # | Item | Check |
|---|---|---|
| A1 | `x-group` and `x-advanced` on every widget's properties, following the proposal's common and advanced table (grid, column, chart, dashboard, stat card), and the rest by the same rule | A registry test: every property has an `x-group` from the six, and no section has more than four common settings without a reason in the test's allow-list |
| A2 | A description on every property and every list-item property. ck writes the missing ones: every `source` and `title`, the chart's `x` and `y`, 10 of the stat card's 11, all of the property table, the style-rule enums, and the panes layout. The first sentence says what it does in reader terms; a second, if needed, says when to use it | A registry test fails on any property without a description |
| A3 | `x-groups`, `x-common`, `x-summary` and `x-page` on the grid's `columns`, `rowStyles` and `rowActions`, action steps, and sources. Add the chart's `series` map (I-12) here, or in D if it slows A | A schema test covers each list item |
| A4 | The two defaults gaps above | A boolean set to its default removes the key from config. The Inspector's shown default equals `configDefault` for every property with a non-static default |
| A5 | `describe_registry` passes `x-group` and `x-advanced`, and strips the list-item annotations. The Architect prompt prefers common settings | A spec on the tool's output. An Architect turn that builds a grid sets no advanced settings unless asked |

### B: the surface (ck; hr for B6)

| # | Item | Check |
|---|---|---|
| B1 | Header: name, type, + and ⋯ (Duplicate Ctrl+D, Wrap in, Change type, Delete Del), then the Reads / Sets / Presets line. The action strip and bottom Remove go | Nothing overflows at the Inspector's default width. Ctrl+D and Del still work |
| B2 | The six sections from `x-group`, in order, empty ones hidden, sentence-case headers. Fold state keyed by widget type plus section. A folded section shows a one-line summary | Grid, chart, panel, select, dashboard, a dashboard view and a stat card match the mockups' order |
| B3 | Row anatomy: the 104px label column, a shared right edge, stacked labels only for multi-value controls, grouped number rows | Every control on the grid and a column ends at the same x (measured) |
| B4 | "N more" rows that name what's hidden. A hidden setting with a value shows anyway | Folding hides only unset advanced settings. The row's tooltip lists each with its first sentence |
| B5 | States and reset, per the rules above. On a segmented control, an unset option showing its default is outlined in the intent (border and text, no fill), not dimmed with opacity: at today's 0.6 its text measures 2.8:1 in dark against 8.1:1 for the unselected option | Each of the six states renders as the mockup does. ↺ and Delete reset. The dashboard's defaults (12, 50, 10) read as defaults. On a segmented control, default, set and unselected are distinct in both themes |
| B6 | **hr**: Hoist's two-option `SegmentedControl` shows its selected option filled and the others outlined in the intent, in both themes. Today a minimal primary option looks as selected as the filled one | On \| Off, Show \| Hide and By sign \| None read at a glance in both themes. Measure contrast between the selected and unselected fill |
| B7 | Help: a Hoist tooltip on the label (description, default, bindable, key), and the focused row's first sentence muted under its control | One row shows help at a time. The native `title` is gone |
| B8 | Pictures: cards for four options or fewer. The chart type becomes a select with icons | The chart's Appearance fits without scrolling at the default width |
| B9 | Number inputs and text boxes get accessible names | Precision, Width, Min and Max width, Label and Null display have names in the accessibility tree |

### C: lists and pages (ck)

| # | Item | Check |
|---|---|---|
| C1 | List rows: grip, label, field in mono, chips from `x-summary`, ›. Hidden columns are struck through. Remove moves to ⋯ on the page, or Delete on the row | No red remove icon on every row |
| C2 | A row's click or Enter/Space opens its `x-common` settings in place, with an "All N settings" link | Opening NAV shows Header, Format, Width and Visible |
| C3 | Pages: › on the row, the link, or → opens the item's page as the Inspector's body. The bar holds back, the item's name and "2 of 5 ↑ ↓" (Alt+↑ / Alt+↓). The page's sections come from `x-groups`, and the format options become ordinary rows | From Columns: open NAV's page, step to Market Value, and go back with ← or Escape. Focus returns to the row |
| C4 | The breadcrumb gains the item: `main › posGrid › Columns › NAV`. Pages within pages add a step (`… › NAV › Rule 1`) | Each crumb navigates. "Columns" opens the grid with its list in view |
| C5 | The canvas outlines the item whose row is open or whose page shows (I-13) | A column's outline follows ↑ ↓ on its page |
| C6 | Apply the pattern to row actions, style rules, action steps and sources | Each opens its page when it has more than six settings or a list inside. Buttons stay inline |

### D: series, search, Registry (ck; tb for D3)

| # | Item | Check |
|---|---|---|
| D1 | The chart's `series` map keyed by measure: name, colour, type, axis, format, visible. A Series list with pages | Styling a series needs no `highchartsConfig`. The Architect validates a series entry |
| D2 | "Find a setting", via / or the header magnifier: a filter across labels, keys and descriptions, hidden settings and item pages included. Picking a result opens its section or page and focuses the row | "pinned" finds each column's Pinned. Escape closes the search |
| D3 | **tb**: the Registry page groups each widget's properties by `x-group` with a "More" heading for `x-advanced`, and shows list items' `x-groups` | It matches the Inspector's sections for the grid and the chart |
