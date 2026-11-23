# Blueprints UI, round 4: build plan

Decisions 187 (selection actions move off the canvas) and 188 (drop onto any container). Mockups for the parts that need John's eye: https://claude.ai/artifact/GysG8N2gABwH5RYmY1Ba8D. Rules from `ui-plan.md` and `ui-plan-3.md` still hold. Owners: **ck** chat kit (design model, Inspector, menus), **hr** layout and overlay, **tb** Toolbox (document bar). `blueprints-ui` reviews in page 1 of John's debug Chromium.

## Choices, resolved (decision 189: all as recommended)

| # | Question | Resolved |
|---|---|---|
| R4-1 | How to switch between design actions and using the widgets | An **Edit \| Interact** segmented control at the left of the designer's canvas header, beside Undo/Redo. Hold **Alt** in Edit for a one-off Interact click. Run stays the reader's preview |
| R4-2 | Quick-action bar shape | One compact row under the identity line: Duplicate, Wrap in ▾, the selection's own actions, then Delete at the right in danger. Labels collapse to icons below 320px |
| R4-3 | Insertion indicator | A 2px primary line between children on the container's main axis, with 6px end caps, plus a dashed `primary-trans2` outline on the target container. Refusal: a danger dashed outline and a chip at the pointer with the reason |

## Rules for this round

- The canvas shows outlines only: hover (1px dashed), selection (2px), view (2px over a `primary-trans1` tint), drop target (dashed `primary-trans2`), and refusal (dashed danger). No name tags and no toolbar. Structure, the breadcrumb and the Inspector name the element.
- Every design action has one implementation in `BlueprintDesignModel`. The Inspector bar, the context menu and the keyboard call the same methods, so their labels, enabled state and refusals match.
- Every refusal is a sentence the user sees: a disabled item's tooltip, or the drop chip.

## New kit APIs

```ts
/** Actions for the current selection, in display order; shared by the Inspector bar and the context menu. */
designActions(sel: BlueprintSelection): DesignAction[];   // {id, label, icon, intent, shortcut, disabledReason, run | menu}
/** Wrap an element in a new container of the given widget type. One edit. */
wrapIn(id: string, widgetType: string): string | null;    // refusal or null
/** Move or insert into a container at an index. One edit. Same code as a drop. */
dropAt(source: DropSource, target: {container: string; index?: number; cell?: Partial<GridCell>; zone?: DockZone}): string | null;
/** Where a drop at a point would land, without dropping. For tests and the overlay. */
previewDrop(source: DropSource, x: number, y: number): {container: string; index?: number; refusal?: string} | null;
type DropSource = {element: string} | {widget: string};  // existing element, or a palette widget type
```

`WidgetSpec.designActions?(ctx)` adds widget-specific actions (a container's "Add a widget…", a view's "Hide header").

## Batches

### A: Actions off the canvas (ck, hr)

| # | Item | Owner | Check |
|---|---|---|---|
| A1 | Remove the selection toolbar and the hover and selection name tags. Outlines stay as listed in the rules | hr | Select and hover in P3: outlines only, no `__tag`, no `selection-toolbar` |
| A2 | Quick-action bar under the identity line (R4-2): a compact Hoist `toolbar` on `--xh-bg`, no band. Order: Duplicate (copy), Wrap in ▾ (object-group), then the selection's own actions, then a filler, then Delete (circle-minus, danger). Minimal buttons with icon plus label. Tooltips carry the shortcut ("Duplicate · Ctrl+D", "Delete · Del") | ck | posGrid shows Duplicate, Wrap in, Delete. A box also shows Add a widget. Each is one edit |
| A3 | Wrap in ▾ lists every container widget (box, panel, tabs, tileFrame, toolbar, dashCanvas, dashContainer) with its glyph. Ones that refuse the element are disabled, with the reason in a tooltip | ck | Wrap posGrid in a panel: one edit, and the panel is selected. Undo restores |
| A4 | Container actions: "Add a widget…" opens the Add palette as a popover filtered by `canMoveTo`, and inserts at the end | ck | Add a stat card to a box from its bar |
| A5 | Children list in every container's Inspector, a "Children" section: `sortableList` rows with glyph, id, kind; a click selects; reorder by drag or Alt+↑/↓ (one edit); remove (danger); "Add a widget…" below. A canvas and a dash container list children without reorder, since position comes from layout | ck | Reorder a box's children from its Inspector: the canvas follows, one edit |
| A6 | Context menu in Edit mode on any element (canvas or Structure row): the same `designActions`, then a divider and "Select <parent id>" so a right-click on a nested element can climb. It replaces the browser menu only in Edit | ck | Right-click posGrid: Duplicate, Wrap in ▸, Delete, Select positions |
| A7 | Keyboard shortcuts unchanged (Del, Ctrl+D, Esc, Enter, arrows). Remove "Move earlier/later" from menus | ck | Shortcut and bar do the same edit |

### M: Edit and Interact (tb, ck, hr)

| # | Item | Owner | Check |
|---|---|---|---|
| M1 | **Edit \| Interact** segmented control (icons arrow-pointer, hand-pointer) at the left of the canvas header, before Undo/Redo, in design mode only (R4-1). Shortcut: E and I, when focus is on the canvas. Persisted per user | tb | Both states show; the choice survives a reload |
| M2 | Edit: clicks select, right-click opens the design menu, widgets' own menus and clicks are suppressed (as today) | ck, hr | — |
| M3 | Interact: clicks, right-clicks, sorting, tab switching and inputs reach the widgets. The selection outline stays but nothing new selects. Hover outlines are off. Runtime edits (a header sort, a column resize) still write back as named edits | ck, hr | Right-click a grid in Interact: the grid's menu. Sort it: one edit "posGrid: sort by" |
| M4 | Hold Alt in Edit: the next click passes through as in Interact. The cursor shows `pointer` and hover outlines hide while Alt is down. Alt+arrow shortcuts keep priority when focus is on a list handle | hr | Alt+click a tab in a tabs element: it switches without selecting |
| M5 | Run stays the reader's view: no Inspector, Structure or outlines | — | Unchanged |

### D: Drop onto any container (hr, ck)

| # | Item | Owner | Check |
|---|---|---|---|
| D1 | Drag sources: a palette tile, a Structure row, and, in Edit, a press-and-drag on the selected element (after a 4px threshold). Canvas cells keep their header drag | hr, ck | Drag the selected posGrid by its body into a box |
| D2 | Target: the deepest container under the pointer that `canMoveTo` accepts. If the deepest refuses, show its refusal rather than silently picking an ancestor | hr | — |
| D3 | Indicator (R4-3): for box, panel, toolbar and tileFrame, a 2px primary insertion line between children on the main axis, with 6px end caps, and the target outlined dashed in `primary-trans2`. For tabs: a vertical line between tab buttons (inserts a tab), or the body (appends to the active tab's container). Canvas: today's cell footprint. Dash container: today's dock zones | hr | Drag over a row box: a vertical line between children; over a column box: a horizontal one |
| D4 | Refusal: a danger dashed outline on the target, a chip at the pointer ("Can't drop here: a toolbar holds inputs and buttons only"), and a `not-allowed` cursor. Dropping does nothing | hr, ck | Drag a grid onto a toolbar: refusal chip, no edit |
| D5 | Drop is one edit through `dropAt`. The dropped element is selected | ck | Undo restores |
| D6 | Drag-free test path: `previewDrop(source, x, y)` and `dropAt(source, target)` from DevTools, as hr did for docking | ck, hr | Both return a refusal string or null, and match the pointer path |

## Order

A1 and A2 first (the toolbar goes when the bar exists), then A3-A7. M1-M4 in parallel with A. D after A5 lands, since the children list and `dropAt` share the insertion code.
