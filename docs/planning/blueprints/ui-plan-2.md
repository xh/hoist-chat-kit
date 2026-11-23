# Blueprints UI, round 2: build plan

Working spec for round 2, from John's review of the built round-1 UI. The design, with mockups:
https://claude.ai/artifact/6muAyGKnEaAidabwR34HQe. Round 1's rules (`ui-plan.md`, "Rules for every
batch") still hold. Owners: **ck** chat kit, **tb** Toolbox, **hr** hoist-react. `blueprints-ui`
reviews each batch in John's debug Chromium and sends a verdict to the orchestrator.

Out of scope: canvas and dash-container internals, covered by `layout-containers.md` (hr and ui).
Coming from the `hoist-ui-components` session: `chip` and `sortableList`. Batches here use today's
spans and list editors until they land (batch H).

## Choices, resolved (decision 178: all as recommended)

| # | Question | Resolved |
|---|---|---|
| R2-1 | Canvas view settings in the format | `title` and `hideHeader` on a canvas child reference |
| R2-2 | Grid summary row | `showSummary: 'top' \| 'bottom' \| false`, as Hoist's GridModel. Existing `true` migrates to `'top'` |
| R2-3 | Library and Add previews | Schematics drawn from layout, not screenshots |
| R2-4 | Concept pages | Small live example blueprints, read-only |
| R2-5 | Maximize | Both "Expand" (hides the left nav) and "Fill" (also hides Toolbox's tab bar) |

Layout containers follow `layout-containers.md` (decision 179), built by hr on `blueprints-url`.

## New kit APIs

```ts
// BlueprintSelection.kind gains 'view': {kind: 'view', id: childId, of: canvasId}
/** The view (canvas cell) holding an element, if any. */
viewOf(id: string): {id: string; of: string} | null;

/** Kit overlay over a blueprint view: hover tag, selection toolbar, outlines. */
export const designOverlay: ElementFactory<{designModel: BlueprintDesignModel}>;

/** An SVG schematic of a blueprint's first canvas, from layout alone. */
export function blueprintSchematic(blueprint: Blueprint, registry: BlueprintRegistry): ReactElement;

// WidgetSpec.preview: a glyph name or (size) => ReactElement, for Add tiles, Registry rows, schematics.
// Schema annotation `x-thumbnails`: {value: glyphName} per enum option, rendered with radioCardInput.
```

## Batches

### A: Inspector forms basics (ck)

| # | Item | Check |
|---|---|---|
| A1 | Fix the column settings drawer: the chevron opens a drawer of the column's settings below its row | posGrid Columns: the chevron on Market Value opens Header, Format, Precision, Renderer, and they edit (one edit each) |
| A2 | Sections on `--xh-bg`, divided by a 1px rule and a 12px semibold header. No tinted cards | Computed: section body background equals the Inspector's |
| A3 | Labels in `--xh-text-color`, weight 500, 11.5px. Muted only for hints, counts and meta | Label contrast at least 4.5:1 in light and dark |
| A4 | One grid per row: 104px label, control, 26px action column. Labels above only for lists and multi-line editors | Every one-line field in posGrid's sections shares the same label and control left edges |
| A5 | Remove and delete icons in danger text colour, add affordances in primary. "Remove <id>" as a danger action at the end of the Inspector | Computed colours on posGrid's column remove icons and the Remove action |
| A6 | Summary row as a segmented Top / Bottom / Off (after R2-2), with the format change and migration | Each option is one edit and the grid follows. An old `true` reads as Top |
| A7 | Action variables as rows: parameter, then a chip (`$var`), "row · field" chip (`$row`) or typed input. JSON in the section's ⋯ menu | posGrid's "Open detail" shows symbol ← row · symbol and asOf ← asOf, with no JSON editor |

### B: Overlay layer (ck)

| # | Item | Check |
|---|---|---|
| B1 | `designOverlay` over the blueprint view's scroll area, drawing from element rects, repositioned on scroll, resize, tab switch and layout change | Scroll the canvas: outlines track. Switch tabs: they move |
| B2 | Hover: 1px dashed outline and tag outside top-left (inside when no room). Selection: 2px outline and toolbar outside top-left. No tag on the selected element | Hover a stat card: the outline shows despite its border, and the tag sits above it. Select posGrid: the toolbar sits above its view, not over the grid |
| B3 | Toolbar as a tab of the selection outline: the same 2px primary border on its top and sides, flush with the outline's left edge. Along its bottom, where the outline's top line runs beneath it, a 1px `--xh-border-color` rule replaces the primary line, so the tab is attached to the outline but visibly separate from the widget. `--xh-tbar-bg` background (button hover `--xh-bg`), top corners 5px, no shadow. Name, then Select parent, Add (primary), Duplicate (success), More, divider, Delete (danger) | Outline and toolbar read as one shape with no line between them, and the button colours and order match |
| B4 | Remove round 1's in-cell tag, in-header toolbar and CSS outlines | No `::before` tag or `--selected` outline on design elements |

### C: Canvas views (ck, after R2-1)

| # | Item | Check |
|---|---|---|
| C1 | `'view'` selection: a click on a view's header (not on items) or frame selects it. Esc climbs widget, then view, then canvas. Enter goes view, then widget | Click Pos Grid's header: the view is selected and the breadcrumb ends "posGrid view" |
| C2 | View Inspector: Header (show or hide, title with bind, icon), header items as a list, placement row | Edit the title: one edit, and the widget's own title is untouched |
| C3 | A selected widget in a view shows a collapsed "Canvas view" section (title, show header, placement), with "Select the view" | posGrid's Inspector ends with it, and its Placement card is gone |
| C4 | Gap hover: a faint dashed canvas outline only, no tag. Click selects the canvas | Hover between Pos Grid and Price: only the faint outline |
| C5 | Structure lists a view between canvas and widget only when it has its own settings | P3's posGrid view (header items) shows; plain cells don't |
| C6 | Format: `title` and `hideHeader` on canvas child refs, validated | A hidden-header view still selects by its frame |

### D: Breadcrumbs (ck)

| # | Item | Check |
|---|---|---|
| D1 | Each step: kind icon, 6px gap, id. The current step adds its kind label and a primary trans1 background. Separator: 13px muted chevron with 3px each side | Compare with the mockup in both themes |
| D2 | Overflow folds the middle steps into ⋯ with a menu | At a 280px Inspector, P3's posGrid shows tabs › ⋯ › posGrid |

### E: Thumbnails (ck, tb)

| # | Item | Owner | Check |
|---|---|---|---|
| E1 | `x-thumbnails` with `radioCardInput` for chart type, summary row, preset selector display, box direction, treemap colour mode, stat card trend, tile frame layout | ck | Each renders cards with a preview that follows the theme |
| E2 | `WidgetSpec.preview` glyphs for every built-in widget, falling back to the icon | ck | Add tiles show glyphs |
| E3 | `blueprintSchematic` | ck | P3's schematic shows its Overview cells in place |
| E4 | Library Cards view with schematics, and Registry rows with glyphs | tb | List or Cards persists per user |

### F: Reference pages and Library (tb)

| # | Item | Check |
|---|---|---|
| F1 | Catalog: one left list with Datasets, Kinds and Formats as sections, one filter. The page tabs go | The filter "pnl" shows pnlDay under positions and the pnl kind |
| F2 | Dataset detail without tabs: header, facts (Grain, Joins, Parameters, Used by), then Fields at full height with a By group / By kind switch | No tab strip in the detail |
| F3 | Kind detail and format detail (pattern plus three sample values) | Select mv: three samples render |
| F4 | JSON as a header action (dialog with Copy). The catalog JSON goes in the list's ⋯ | No JSON tab |
| F5 | Registry: origin toggles under search in the left panel. "Show as: Dashboard \| Chat answer" inside the Example tab. JSON as a header action | The page bar has neither control |
| F6 | Library fills the page. Name takes the free width | No 1280px cap |

### G: Blueprints tab restructure (tb)

| # | Item | Check |
|---|---|---|
| G1 | Left nav (grouped `tabContainer`, as in the Chat Kit tab): Overview, Concepts, Built-ins, Examples | Matches the mockup |
| G2 | Concept pages: short copy, one live read-only example, JSON and Map toggles, next link | Each page loads its example with no console errors |
| G3 | Built-ins by role (`category`): each widget with summary, live example, facts and "Open in Registry". App entries in a "From this app" group | Layout lists box, panel, tabs, dashCanvas, tileFrame, toolbar |
| G4 | Examples: Portfolio and Weather as sections opening the full UI on their type, with Data Catalog and Registry sub-items routing straight to them. No type button group | Each sub-item's route loads directly |
| G5 | Routes as in the design. Existing blueprint links still open | Old `/app/blueprints/portfolio/<token>` links work |
| G6 | Maximize: Expand hides the nav, Fill also hides Toolbox's tab bar. Esc restores. Persists per user | Both states, and a reload keeps them |

### H: Coming components (ck, tb)

Swap in `chip` (wiring, bound fields, Catalog facts, Registry toggles) and `sortableList` (columns,
row actions, steps, header items, presets, tabs) when `hoist-ui-components` lands them.
Requirements are in the design, section 10. Their proposal (https://claude.ai/artifact/FsUkZBzcEj9xxdH4R7Rmgd,
section 4) is settled by John as `Chip` / `chip()` in hoist-react `cmp/chip`, with the list on
@dnd-kit/react. Any key a chip or the list handles stops propagating, so it never reaches the
canvas design keys:
- kinds as `minimal` plus intent: variable primary, source success, element none, set warning;
  preset as `color: 'var(--xh-purple)'`;
- mono through the `xh-font-family-mono` class;
- `onRemove` separate from `onClick`, also on Backspace/Delete;
- `active` for filter toggles.

`sortableList` takes its array as `value` (or `bind`), plus `renderItem` and `renderDetail(item)`
(the host tracks the one open row). It reorders on Alt+Up/Down with one `onReorder` per completed
move, and leaves the "Add…" row to the host as a sibling. Rows carry no border or background: the
host styles them, and the list draws only the drag chrome. A host-placed handle uses
`handle: 'custom'` with `ctx.handleRef` from `renderItem`. Built on hoist-react branch
`hoist-ui-components`.

## Order

A first (the drawer is broken today), then B and D, then C after R2-1, then E and F in parallel,
then G, then H when the components land.
