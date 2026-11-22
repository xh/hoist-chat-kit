# Blueprints UI: build plan

Working spec for the UI pass John approved in full (decision 174). The design, with mockups:
https://claude.ai/artifact/LhTwEFVpH7YNHi2MwEEtdL. This file is enough to build from without it.

Owners: **ck** chat kit (`desktop/cmp/blueprint/`, `blueprint/design/`), **tb** Toolbox
(`client-app/src/blueprints/`, `desktop/tabs/blueprints/`), **hr** hoist-react. ck and tb commit to
their `blueprints` branches, so the shared dev servers run the work under review. The hr item is its
own PR off `develop`. `blueprints-ui` (design lead) reviews each batch in John's debug Chromium
against the mockups and sends findings to the owner and a verdict to the orchestrator. tb drives that
browser only when `blueprints-ui` hands it over.

## Rules for every batch

- Every change to a blueprint is one design model call, so one `applyEdit`, one history row, one undo
  step. Selection, hover and view state never edit.
- Kit never imports Toolbox. Kit styles use `--xh-*` variables only, BEM under `xh-blueprint-*`.
  Toolbox uses `tb-*`.
- Hoist components and factories, no raw HTML layout. Inputs and controls stay Hoist's own.
- Spec phase 3's two widget rules hold. Run-mode changes stay transient.
- Decision 153 holds: drag and drop happens on `dashCanvas` only. Moves into other containers go
  through Structure or menus.
- Checks run on a copy of a seed (for example "ui-check P3"), never on the seeds. Delete copies after.

## Choices, resolved (decision 174)

| # | Resolved |
|---|---|
| C1 | The Blueprints tab drops Toolbox's `wrapper()` rail. Its explanation moves to the Library intro and a "How Blueprints work" dialog |
| C2 | Data Catalog and Registry are sibling page tabs of Blueprints, scoped by the type picker, with "Add to draft" actions back into the editor |
| C3 | One left dock with a rail: Architect, Structure, Add, History in design; Architect, Values, History in run. One tab open at a time |
| C4 | The Map draws lanes with edges |
| C5 | Data Catalog is master-detail, with today's dataset cards as the list |
| C6 | Cell header restyle is a kit override under `.xh-blueprint-dash-canvas`. Only the drop placeholder color goes to hr now |
| C7 | Delete runs without a confirm when `describeRemoval` lists only the element. It confirms when the removal cascades |
| C8 | `Esc` selects the parent, and clears at the root |
| C9 | `duplicateElement` is added to the design model |

## New kit APIs

All on `BlueprintDesignModel` unless noted. Editing calls go through its private `edit()`.

```ts
/** Element under the pointer on the canvas, in Structure or the Map. View state, never an edit. */
@observable hoveredId: string;
setHovered(id: string): void;

/** Copies an element and its subtree with fresh ids, placed after it (on a canvas, at the first free place). Selects the copy. */
duplicateElement(id: string): BlueprintEditResult & {id?: string};

/** Dry run of moveTo: the issues applyEdit would return, applying nothing. */
canMoveTo(id: string, targetId: string, where: 'into' | 'before' | 'after'): BlueprintIssue[];

/** Moves a canvas cell by whole grid units. Calls within 1s on the same id fold into one edit. */
nudgeChild(id: string, change: {dx?: number; dy?: number; dw?: number; dh?: number}): BlueprintEditResult;

/** Moves an element one place earlier or later in its slot. */
reorder(id: string, step: -1 | 1): BlueprintEditResult;

/** Ancestors of an element, root first, for the breadcrumb. */
pathTo(id: string): string[];

/** Element ids the last Architect edit added or changed, from BlueprintModel.history. */
get lastArchitectTouched(): string[];
```

```ts
// blueprint/design/wiring.ts
export interface BlueprintWiring {
    reads: WiringRef[];       // element: its source and bound variables. source: param variables. variable: resolver inputs
    sets: WiringRef[];        // element: variables its outputs or value write
    readBy: WiringRef[];      // source or variable: who reads it
    setBy: WiringRef[];       // variable: its writers (prompt, element, output, resolver, action, link)
    presets: WiringRef[];     // element: groups controlling its paths. preset group: controlled paths, selectors
    waitsFor?: WiringRef[];   // source: output-bound params with no value
}
export interface WiringRef {kind: 'element' | 'source' | 'variable' | 'preset' | 'prompt' | 'link'; id: string; path?: string; label?: string}
export function wiringFor(blueprint: Blueprint, selection: BlueprintSelection): BlueprintWiring;
export function wiringGraph(blueprint: Blueprint): {nodes: BlueprintSelection[]; edges: WiringEdge[]};
```

Built from the same walk the validator does over `$var`, `setBy`, `source` and preset `controls`.
Pure, specced.

Registry: `WidgetSpec.icon` (an `Icon` factory name), and `sections` on every built-in widget.

## Batches

Order: 0, 1, then 2 to 4 (kit core), then 5 (Toolbox shell), then 6 and 7 in parallel.
Each row's check is what the design lead runs in the browser to pass it.

### Batch 0: fixes

| # | Item | Owner | Check |
|---|---|---|---|
| 0.1 | A click on a `dashCanvas` cell header selects the widget in the cell. A click on a header item selects that item | ck | P3 copy, Overview: click "Day P&L by Sector" header, Inspector shows `sectorChart`. Click posViewsSelector in Pos Grid's header, it is selected |
| 0.2 | An empty canvas shows its hint as an overlay over a live canvas, so it takes a palette drop | ck | New blueprint: hint shows; drag Grid from the palette onto it (real pointer, John, if automation can't drag) lands in one edit |
| 0.3 | Selecting an element in an inactive tab activates the tab and scrolls it into view | ck | P3 copy on Overview: select `ordersGrid` in the outline, Orders tab activates with it outlined |
| 0.4 | Canvas and outline refusals show as a danger toast with a "Show" action selecting the element named. The message under the tree goes | ck | Outline: drag a grid into a cell header, toast states the refusal, Show selects it, nothing under the tree |
| 0.5 | Panel `tbar` and `bbar` toolbars use Hoist's overflow menu | ck | S4 copy with Architect and Inspector open: Totals switch, slider and filter reachable from the overflow button |

### Batch 1: widget chrome

| # | Item | Owner | Check |
|---|---|---|---|
| 1.1 | One frame, one title. A widget in a `dashCanvas` cell renders without its own title or border, and hands title, icon and header items to the cell (`DashCanvasViewModel`). Outside a canvas, `presentation: 'panel'` uses one compact Hoist panel header, never the `card` legend | ck | S1: "Market value by sector" and "Positions" each appear once. S5: each city once. W3: "Humidity" once per gauge. No card legend inside any cell |
| 1.2 | Cell header 28px, `--xh-bg` background, bottom border, title 12px weight 600 in `--xh-text-color`, header items right-aligned at compact size. Design mode adds the element id after the title in `--xh-font-family-mono`, `--xh-text-color-muted`. Scoped to `.xh-blueprint-dash-canvas` | ck | Compare against mockup 3.9 in light and dark. Run mode shows no ids |
| 1.3 | A cell whose widget has no title and no header items hides its header (`hidePanelHeader`) | ck | S1 stat cards and callout cells have no empty header strip |
| 1.4 | Canvas `margin: [8, 8]`, `containerPadding: [8, 8]`, square cells, one border each. `showGridBackground` in design mode only | ck | Design shows column grid behind cells, run doesn't. Gaps 8px |
| 1.5 | Stat card values never ellipsize. They step through compact formats, then shrink by container query. Starter `h` fits value plus one trend line | ck | S1 at the audited width (Architect and Inspector open): NAV reads `3.96b` or similar, never `3,959....`; no empty lower half |
| 1.6 | Callout and markdown starters size to their text. In design, a clipped text cell shows a bottom fade and a "Content clipped · make taller" chip that grows `h` by the overflow in one edit | ck | S1 and S2 callouts: chip shows on a clipped one; clicking it is one history row and shows the full text |
| 1.7 | Validator warning when a cell is narrower than its widget's `sizes.min` (new code `layout.tooNarrow`), cell outlined in warning color in design | ck | Shrink a grid cell below its min width: warning in Issues and on the cell |
| 1.8 | Drop placeholder: `--xh-intent-primary-trans1` fill, 1px dashed `--xh-intent-primary` border | hr | Separate PR off hr `develop`. Toolbox Layout > DashCanvas demo: drag a view, placeholder matches |

### Batch 2: canvas editing layer

| # | Item | Owner | Check |
|---|---|---|---|
| 2.1 | Hover: 1px dashed `--xh-intent-primary` outline, name tag (`id · Label`) above, drag grip in the cell header. Innermost element wins. Hover in Structure or the Map outlines on the canvas. Uses `hoveredId` | ck | Hover a stat card inside `headline`: tag names the card, not the tile frame. Hover an outline row: canvas outlines it |
| 2.2 | Selection: 2px solid outline and a toolbar above the element (inside it when there's no room): parent, name, duplicate, add (containers and slots), more (Move earlier/later, Move to ▸, Wrap in panel, Copy id), delete | ck | Select `posGrid`: toolbar shows; ↑ selects `positions`; add lists only cell-header widgets (inputs) |
| 2.3 | `duplicateElement` from the toolbar, row menu and `Ctrl+D` | ck | Duplicate `sectorChart`: one edit, copy placed in a free spot and selected, undo removes it. Duplicate `headline`: subtree copied with new ids |
| 2.4 | Delete per C7: no confirm for a lone element, with toast "Removed X." and an Undo button (`ToastSpec.actionButtonProps`); confirm naming the count when it cascades. Selection moves to next sibling, else previous, else parent. Refusal toast names readers as links | ck | Delete `regionChart`: no confirm, toast Undo restores. Delete `headline`: confirm "Remove 5 elements". Delete variable `asOf` from Structure: refused, readers listed |
| 2.5 | Keyboard (below), via `useHotkeys`, active when focus is on canvas, Structure or Map and not in an input. `?` opens the list | ck | Run every key in the table on a P3 copy. Typing in an Inspector input never triggers one |
| 2.6 | `nudgeChild` folding: repeated arrows within 1s make one edit | ck | Press → five times on `posGrid`: x moves 5, History gains one row, one undo restores |
| 2.7 | Architect halo: elements in `lastArchitectTouched` get a 3px `--xh-intent-primary-trans2` halo for a few seconds; static under `prefers-reduced-motion` | ck | Ask the Architect for one change: touched cell haloes, then settles |
| 2.8 | Selecting a source, variable or preset washes every element that reads it with `--xh-intent-primary-trans1` | ck | Select source `positions`: headline cards, both charts and posGrid wash; priceChart doesn't |
| 2.9 | Placeholders, one style (Hoist `placeholder` in the cell body): empty canvas (with Add a widget, Ask the Architect), empty container ("+ Add to X", design only), needs config ("Pick a source" focusing the field), waiting on a selection, loading (per-cell `mask`), source failed (Retry), no rows (names the variables in play) | ck | Each state reproduced once and compared with mockup 5.8. No canvas-wide mask on reload |

Keyboard:

| Key | Action |
|---|---|
| `Esc` | Cancel a drag, else select parent, else clear |
| `Enter` | Select first child |
| `[` `]` | Previous, next sibling |
| `F2` | Rename the selection's id |
| `/` | Focus Add's search |
| `Del` `Backspace` | Delete (2.4) |
| `Ctrl+D` | Duplicate |
| Arrows | Canvas cell: nudge one unit. Structure: previous, next row |
| `Shift`+arrows | Canvas cell: resize one unit |
| `Alt+↑` `Alt+↓` | Move earlier, later in its slot (`reorder`) |
| `Ctrl+Z`, `Ctrl+Shift+Z` | Undo, redo (`⌘` on macOS). In an input, the browser's text undo |
| `?` | Shortcut list |

No Design/Run shortcut.

### Batch 3: Structure and Inspector frame

| # | Item | Owner | Check |
|---|---|---|---|
| 3.1 | `blueprintStructure`: sections Elements (tree), Sources, Variables, Presets, each with count and "+". Rows: category icon, id, muted label; variables show their current value, sources their dataset and widget count. Elements in inactive tabs dim. Slot nodes ("Cell header", "Top toolbar", "Content") for every container with more than one slot, empty ones included. Filter field. Row context menu: Rename, Duplicate, Move to slot ▸, Add child ▸, Delete. Issue dots | ck | P3 copy: 18 elements, 3 sources, 8 variables, 1 preset group listed with counts; `posViewsSelector` sits under posGrid's "Cell header" node; filter "price" leaves priceChart, prices, priceStart |
| 3.2 | Structure drag uses `canMoveTo` during dragover: ⊘ cursor and reason tooltip on refused targets before the drop. Insertion line drawn at the target depth; "into" highlights the row | ck | Drag a grid over a cell header node: ⊘ and reason while hovering, no edit on drop (real pointer if needed) |
| 3.3 | `blueprintInspector`: one panel by `selection.kind`. Frame: breadcrumb (`pathTo`, each clickable), header (icon, mono id with rename on click or F2, subtitle "Label · reads X", ⋯ menu), issues block with Show links, then cards | ck | Select element, source, variable, preset in turn: same frame each time; breadcrumb on posGrid reads tabs › positions › posGrid |
| 3.4 | Add tab content: search; category sections of tiles with icon (`WidgetSpec.icon`) and the first sentence of `guidance`; "Click adds into/after X" line; tiles the target slot won't accept dim with the reason as tooltip; the add target outlines on the canvas while the pointer is over Add | ck | Select posGrid's cell header node: only inputs enabled. Hover the Add panel: target outlined |

### Batch 4: Inspector content

| # | Item | Owner | Check |
|---|---|---|---|
| 4.1 | Wiring card first for every kind (from `wiringFor`). Element: Reads, Sets, Presets. Variable: Set by, Read by, Now. Source: Read by, Waits. Preset group: Controls, Shown by. Every chip selects its target | ck | posGrid: Reads positions, grouping, pnlFilter; Sets selection, symbol; Presets posViews. asOf: Read by positions, orders, prices.end, priceStart, yearStart, reportActions. prices: Waits for symbol |
| 4.2 | `sections` on every built-in widget: Data, Content or Display, Columns or Series, Interaction, Style (collapsed); Placement last, titled "Placement in <parent>". Open state persists per section name | ck | Chart, stat card, treemap, select each show sections, no long unsectioned list |
| 4.3 | Placement in one row: canvas X Y W H; box Flex Width Height; tab Title and Icon (`iconPicker`). Slot select only with several slots | ck | posGrid: four small inputs in one row |
| 4.4 | Field rows label-left (96px). Bind button shows on hover or focus only. A bound field shows a variable chip with × to unbind in place of the input | ck | posGrid Data: Group by and Filter show chips; Sort by shows a link icon only on hover |
| 4.5 | Preset badge on the section header holding the controlled path, linking to the group | ck | posGrid Columns header shows "Preset · P&L view"; click selects posViews |
| 4.6 | Presets editor on the same cards and full-width rows; active preset marked "editing" | ck | posViews in a wide Inspector: no fixed-width inputs, no empty right side |
| 4.7 | Nothing selected shows the blueprint: name, description, counts, root config | ck | Clear selection: blueprint summary, no "Select an element" text |

### Batch 5: Toolbox shell

| # | Item | Owner | Check |
|---|---|---|---|
| 5.1 | Tab layout: type picker (Portfolio, Weather) left of page tabs Blueprints, Data Catalog, Registry (`tabContainer`). Routes `/app/blueprints/<type>`, `/<type>/<token>` (unchanged), `/<type>/catalog`, `/<type>/registry`. No `wrapper()` rail | tb | Each route loads its page; switching type keeps the page; old blueprint links still open |
| 5.2 | Library page: two-line intro; grid grouped Yours, Shared with you, Examples; Name column with description line; Owner; Status pills (Draft vN, Published vN, lock for read-only); Updated; row menu (Open, Copy, Copy link, Share…, Delete); New ▾ (Empty dashboard, From a Registry example, Ask the Architect); search; empty-state text for Yours | tb | Portfolio: 9 examples grouped; search "toolbox" and a username work as K1/K6; Enter and double-click open |
| 5.3 | Quick switcher: the document name ▾ opens a searchable popover of recent and all blueprints, plus "Open Library" | tb | Switch P3 to S1 and back from the popover |
| 5.4 | Document bar: ‹ Library, name ▾, status pill, Undo/Redo with description tooltips, issues chip (popover list, each selects its target), Canvas/Map/JSON, Design/Run, Publish, ⋮ (Copy link, Share…, Make a copy, Rename, Delete, How Blueprints work). States per the table below | tb | Each state below reproduced and matched |
| 5.5 | Publish popover: version, change summary since last publish from History grouped by kind, note field, warnings shown, errors block | tb | P3 copy after 3 edits: summary counts them; an error disables Publish with the tooltip |
| 5.6 | Left dock: collapsible, resizable `panel` (persisted width and tab), icon rail always visible. Design: Architect, Structure (3.1), Add (3.4), History. Run: Architect, Values (today's run-mode variables grid with Reset to default), History. Readers' dock starts collapsed. Keyboard icon at the rail foot | tb | Toggle Design/Run: tabs swap; collapse keeps the rail; reload keeps tab and width |
| 5.7 | Inspector: right `panel` hosting `blueprintInspector`, design only, persisted width (today's `blueprintsInspector` key) | tb | Hidden in run and on a publish |
| 5.8 | History tab: one timeline of edits and publishes; author icon (user or Architect); undone edits struck through; Show selects what an edit touched; publish rows with Open and Compare | tb | Make 2 edits, undo 1: struck row; Show on an Architect edit selects its element |
| 5.9 | JSON as a full view with Revert/Apply (today's `applyJsonEdit`) | tb | Edit JSON, Apply: one history row |
| 5.10 | Architect edit card framing: Show and Undo for the edit, around the chat's tool result | tb | After an Architect turn, Undo on its card reverts that edit |
| 5.11 | Stale state inline: pill "Not saved · changed in another tab" with Reload and Save as new buttons; Publish hidden | tb | Rerun C2 to C5 of the run sheet |
| 5.12 | "How Blueprints work" dialog: concepts and the resource links from the old rail | tb | Opens from ⋮ and the Library intro |
| 5.13 | `/blueprintPortfolio` and `/blueprintWeather` use the same shell | tb | Both load with the new layout; L3 and L4 still pass |

Status states (5.4):

| State | Pill | Actions |
|---|---|---|
| Draft saved | `Draft vN · saved` (primary) | All |
| Saving | `Saving…` | Publish waits |
| Errors | `N errors` chip (danger) | Publish disabled, tooltip "Fix N errors to publish" |
| Changed elsewhere | `Not saved · changed in another tab` (warning) | Reload, Save as new inline; Publish hidden |
| Publish, owner | `Published vN · read only` (success, lock) | Back to draft, Make a copy |
| Publish, reader | `Published vN` | Make a copy |
| Architect turn | `Architect editing…` | Undo disabled until it ends |

### Batch 6: Map

| # | Item | Owner | Check |
|---|---|---|---|
| 6.1 | `blueprintMap`: lanes Variables (grouped Prompts, Computed, Set by widgets, Set by actions, Constants), Sources (with params), Presets, Elements (grouped by tab, tile frames collapsed). Nodes are Hoist `vbox`es of DOM nodes; one SVG overlay draws edges from measured boxes, redrawn on resize. Edges from `wiringGraph` | ck | P3 copy matches the artifact's Map: every variable, source, preset and element present, edges as drawn |
| 6.2 | Click selects (shared selection), hover previews the trace, double-click an element opens Canvas with it selected. A selection draws upstream in `--xh-intent-primary`, downstream dashed in `--xh-intent-warning-text-color`, presets in purple (`--xh-purple`), dims the rest. Issue dots on nodes. Read-only | ck | Select posGrid: positions, asOf, fund, yearStart, grouping, pnlFilter, posViews upstream; selection, symbol, prices, priceChart, ordersGrid downstream |
| 6.3 | Map in the Canvas/Map/JSON switcher. History Compare opens the JSON view as a diff (`diffOps`) | tb | Compare on a publish row shows the diff |

### Batch 7: reference pages

| # | Item | Owner | Check |
|---|---|---|---|
| 7.1 | Data Catalog: left `dataView` of the dataset cards with a filter matching datasets and fields; right detail with header (name, description, join chips that select the dataset, params), tabs Fields (full-height tree grid), Parameters, Used by (the open draft's sources and widgets). "Add as source to <draft>" when a writable draft is open: `addSource(dataset, {addVariables: true})`, back to the editor with the source selected. Kinds, Formats, JSON keep their tabs | tb | K3 lines still read right; filter "pnlDay" shows it under positions; Add as source on a P3 copy adds and selects it |
| 7.2 | Registry: left tree grid by kind with counts, search and origin filter, context toggle (Dashboard, Answers); right detail with header and tabs Example (live, first), Config, Outputs and presets, JSON, What the Architect sees. "Add to <draft>" for widgets at the editor's add target; "New blueprint from example" | tb | K4 and K5 still pass in the new layout; Add to draft selects the new widget in the editor |

## Not in this pass

Multi-select, a Design/Run shortcut, dragging across containers on the canvas, editing in the Map,
upstreaming the cell header restyle to hr.
