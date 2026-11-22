# Blueprints UI, round 3: build plan

From John's use of the built round-2 UI: modern but professional, one use of colour, strong contrast between sections and content. Mockups for the parts that need John's eye: https://claude.ai/artifact/C5VsrsEofnuNgUoZxUPE7n. Round 1's rules (`ui-plan.md`) still hold. Owners: **ck** chat kit, **tb** Toolbox, **hr** layout and overlay, **huc** hoist-ui-components (hoist-react inputs). `blueprints-ui` reviews each batch in John's debug Chromium.

## Rules for every batch

- Primary marks the open, selected or bound item: open list row, selected segment, active rail tab, selected index entry. Danger only for removal. Success, warning and purple only on chips by kind.
- Surfaces: content on `--xh-bg`. Section bands, category rows, cell headers and the dock rail on `--xh-bg-alt`. `--xh-panel-title-bg` only for real panel titles.
- No switches on desktop. Booleans are two-option segmented controls.
- Tree grids use `treeStyle: 'none'` plus row classes by row type. `highlights` only where every branch has the same depth.

## Choices, defaulted (decision 184: recommendations stand until John reviews the mockups)

| # | Question | Resolved |
|---|---|---|
| R3-1 | Format options grouping | `formFieldSet`, collapsed unless an override is set |
| R3-2 | Boolean labels | Positive state first, positive label ("Visible: Show \| Hide") |
| R3-3 | Built-ins | Revised by John: one nav entry per role, whose page lists each widget's `wrapper()` with its options rail in sequence, under an in-page scroll-spy index. `builtins/<role>?widget=<name>` opens a widget. A nav entry per widget made the left nav too long |
| R3-4 | Catalog fields | `dataView` cards, no grid |
| R3-5 | Catalog JSON panel | Closed by default, remembered per user |

## Batches

### I: Inspector (ck; huc for I4's toggle)

| # | Item | Check |
|---|---|---|
| I1 | Section band: full Inspector width, 28px, `--xh-bg-alt`, 1px `--xh-border-color` above and below, 11px semibold uppercase .06em in `--xh-text-color`, count in a pill on `--xh-bg`, chevron right, whole band toggles, `position: sticky; top: 0` | Scroll posGrid's Inspector: each band sticks as its section passes. Band, content and panel title are three different grounds in both themes |
| I2 | Identity line above the first band: id in mono 13px semibold, one muted line of kind and wiring | posGrid shows "posGrid" then "Grid · reads …" |
| I3 | Format options in a `formFieldSet` under the Format row, spanning the row: title "Format options", mono summary of set overrides, collapsible (R3-1). Replaces the left rule | Market Value: collapsed with no override; set Precision 1, it opens and reads "precision 1"; an invalid value turns the card danger |
| I4 | Booleans as two-option `segmentedControl`, `intent: 'primary'`, labels from `x-labels` (default On/Off), positive first (R3-2). huc adds click-anywhere toggle for two-option boolean controls | Column Visible and Group counts show segmented controls; one click anywhere flips; one edit each; no `bp6-switch` left in the Inspector |
| I5 | Column drawer on `--xh-bg`. Open row `--xh-intent-primary-trans1`, one 2px primary inset rule down row and drawer. One disclosure chevron per row (rotates 180°, 120ms, none under reduced motion, primary when open). No up/down buttons. Remove as `circle-minus` in danger text | Open Market Value: one continuous rule, no second ground, one chevron |
| I6 | Sort by: drop Text/List and the raw string. Closed, element chips with direction glyphs. The chevron opens a `sortableList` of keys: field `select` (label plus mono name), Asc \| Desc icon segmented, remove, then "Add a sort key". Unrepresentable parts of an old string (abs) show as a muted tag on the key, never an error | posGrid: chips "pnlDay ↓"; add, reorder and flip each one edit; no validation dead end from any prior value |

### R: Rail, trees and cell headers (tb, ck, hr)

| # | Item | Owner | Check |
|---|---|---|---|
| R1 | Dock rail: `--xh-bg-alt`, 1px right rule. 32px buttons, 14px icons, inactive `--xh-text-color-muted` (hover `--xh-text-color` on `--xh-bg-highlight`). Active: `primary-trans1` fill, primary icon, 3px primary bar on the rail's outer edge | tb | The active tab is identifiable at a glance in both themes |
| R2 | Structure: `treeStyle: 'none'`, `rowClassFn` with `xh-blueprint-tree__row--category \| --container \| --leaf \| --slot`. Category: 24px `--xh-bg-alt` band, 10.5px semibold uppercase, count right, 1px rules. Container: semibold, primary icon. Slot: italic muted | ck | Elements, Sources and Variables read as bands; no depth tint |
| R3 | The Catalog's dataset tree and field groups: the same row classes | tb | Organization and Measures read as bands |
| R4 | Cell header ground: 28px, `--xh-bg-alt`, 1px `--xh-border-color` bottom rule, in run and design mode | hr | Every `gridCanvas` cell header differs from its body in both themes |
| R5 | Cell header content: `WidgetSpec.icon` (12px, primary text), title (12px semibold), id in mono muted (design mode only), header items right | ck | sectorChart shows chart icon, "Day P&L by Sector", `sectorChart` |

### T: Toolbox pages (tb)

| # | Item | Check |
|---|---|---|
| T1 | Concepts pages in `wrapper()`, as `chatDemoPage`: copy and Next in the info panel, the example in the island, JSON and Map in the options rail | Matches Chat Kit › Components layout |
| T2 | Built-ins: one `wrapper()` page per widget under its role in the nav (R3-3). Info panel: summary, facts (role, children, per-cell or per-child settings, what persists), Open in Registry, related concept. Island: a rich live example. Options rail: the widget's main settings, using the E1 picture cards where they exist | Each built-in loads with no console errors |
| T3 | Examples: dashCanvas with three stat cards over a chart and a grid, every cell headed and movable, with Reset layout. tabContainer with three tabs of real content and options for tab position and switcher. Inputs: an overview page with each input bound to a variable, its label from the variable's `label`, and its live value under it | No raw variable names as labels; dashCanvas cells drag and reset |
| T4 | Data Catalog fields as cards (R3-4), in a plain scrolling list rather than Hoist's `DataView`, whose fixed row heights clip long guidance and whose group rows can't stick: name, label, type and role tags on line 1; guidance as full prose; a properties line with only those set. By group / By kind as sticky bands | positions › fund shows its guidance in full; empty properties never render |
| T5 | Kinds and formats on one scrolling page: index on the left in two groups, click scrolls, scroll-spy marks the visible entry. Kind card: base, currency, format, three live samples (negatives in danger), Used-by chips that open the field. Format card: pattern, options, samples | Click pnl in the index: it scrolls and the index follows the scroll |
| T6 | JSON in a right collapsible, resizable `panel` titled "JSON · <name>", following the selected field, kind or format, with Copy in its bbar. Closed by default, persisted (R3-5). Replaces the JSON dialog | Select fund, then pnl: the panel follows |

### S: Sortable list polish (huc)

| # | Item | Check |
|---|---|---|
| S1 | Drag overlay: `--xh-bg`, 1px primary border, 4px radius, soft shadow, 3px `primary-trans1` ring, slight tilt (none under reduced motion). Slot left behind: dashed primary outline on `primary-trans1` | Drag a column in the Inspector and a tab in DynamicTabSwitcher |
| S2 | Two-option boolean `segmentedControl` toggles on a click anywhere (for I4) | One click on the selected segment flips the value |

## Order

S2 first (it blocks I4), then I1, I2 and I5 together, then I3, I4, I6. R and T in parallel with I. S1 any time.
