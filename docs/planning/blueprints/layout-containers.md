# Layout Containers for Blueprints

> **Draft proposal, no code.** John asked how Blueprints' layout containers should work, without
> the limits of today's `DashCanvas` and `DashContainer`. hr wrote it, and blueprints-ui supplied
> the interaction requirements, cited here as R1 to R24 and E1 to E12. Items marked **J** are
> John's decisions.

## Recommendation

Build **controlled layout primitives**, with Blueprints as their first consumer. Build them in the
chat kit now, alongside UI round 2, and move them into hoist-react with everything else at step
20 (decided, D-L7). Leave `DashCanvas` and `DashContainer` as they are for apps. Later, rebuild
those two over the same primitives in a major release of their own. This is option (c). It takes
the safe part of (b), a new path that leaves apps alone, and adds (a)'s goal of one implementation
in hoist-react.

- **Canvas:** a thin controlled wrapper over react-grid-layout (RGL), with no `DashCanvasModel`.
  The blueprint's child references are the layout. A finished gesture becomes one edit.
- **Dash container:** a native renderer of splits and tabs in place of GoldenLayout. It reads the
  `layout` format the blueprint uses today, unchanged.
- **Overlay:** hover, selection and drop marks draw in one layer above the whole blueprint, not
  inside any container.

## Why not (a) or (b)

**(a) Change hoist-react's models.** For the canvas this is possible but awkward. It means a
controlled mode inside a 774-line model built around its own `state`, persistence and RGL guards.
Every app would carry both modes. For the dash container, (a) means changing GoldenLayout itself
(see below). Apps persist `DashContainer` and `DashCanvas` state in preferences and views, so any
change to those models is a breaking change for them.

**(b) Fork Blueprints-native copies.** This leaves apps safe, but it makes a second copy of each
model, shaped to Blueprints, that a later fold-back must reconcile with the first.

**(c)** keeps (b)'s isolation and avoids the copy. The primitives are small, controlled and not
specific to Blueprints. The legacy models later become stateful wrappers over them.

## What is wrong today

### Two sources of truth

The blueprint holds each child's placement. Each container also keeps its own copy in a Hoist
model and writes changes back:

- **Canvas.** `DashCanvasWidgetModel` loads the children into `DashCanvasModel.state`, and a
  reaction writes `state` back as an edit. The mirror needs guards in both repositories:
  - a skip while a palette drop is in progress (`DROP_VIEW_ID`);
  - a `dragCancelled` flag that had a bug of its own (c5f498d);
  - title and placement equality checks;
  - a canvas reset when a child gains or loses its header;
  - hoist-react's committed-layout check in `useRglLayoutChangeHandler`.
- **Dash container.** `DashContainerWidgetModel` passes `layout` to `loadStateAsync`, and a
  reaction writes `state` back. Each external change to the layout, such as an undo or an
  Architect edit, destroys and rebuilds the whole GoldenLayout instance behind a 500 ms mask.

Rule 2 for widgets (blueprint-extensions.md) says a widget keeps no private state the blueprint
cannot see. Both containers break it in spirit: the Hoist model is the private copy.

### GoldenLayout

`DashContainer` runs on a fork of GoldenLayout 1.5.9 in `kit/golden-layout`: about 4,600 lines
of imperative JavaScript, with no maintained upstream.

- **Security:** `Tab.setTitle` and `DragProxy` set titles with `innerHTML`. The fix is in hr's
  unpushed PR branch `fix-dash-tab-title-text`. Other templates still parse markup.
- **The DOM is GoldenLayout's.** Tabs, stack headers and the rename form are DOM nodes that
  `DashContainerModel` reaches into with `querySelector`. The stack menu renders in a React root
  of its own. Header items cannot be React nodes in a tab (R10).
- **No accessibility.** The fork has no `tabindex`, `role`, `aria-*` or key handling. Tabs cannot
  take focus, and they cannot switch by keyboard (R18, R19).
- **No reporting.** A stack does not report its active item, so selection cannot reveal an
  element in a background stack (R5, E10). The kit's `activateView` reaches into GoldenLayout's
  internals instead.
- **Styling:** its own `lm_*` classes and CSS, under Hoist's overrides.

### Hoist styling that blocks kit chrome

- An inline `flex: 1` on the panel header title beats any stylesheet (E3).
- `titleDetails` joins into the title text (R10).
- Panel headers sit five or six classes deep (E2).

These hit both the canvas and the apps. They are worth fixing in hoist-react whatever John
decides (D-L8).

## What Blueprints needs

ui's list is the requirement. The four that decide the design:

| Need | Requirements | Today |
|---|---|---|
| One overlay layer above everything | R6, E7, E8 | Cells clip, so marks sit inside them |
| Real hit targets for view, body and gap | R1 to R3, E1 | Header clicks needed a mapping |
| Header as React nodes, no inline styles | R10, E2, E3 | Inline flex, title text joined |
| One edit per gesture, no internal persistence | R12, R15, E5 | Mirror with guards, full rebuilds |

The rest follow from a controlled design:
- R4: controlled props for every view setting;
- R9: a mode prop with no remounts;
- R17: keyboard moves rendered from props at once;
- R22: run-mode tab switching.

## The proposal

### Canvas: controlled RGL

RGL stays. It is maintained, and it already takes a `layout` prop and reports drag, resize and
external drops.

- The wrapper derives `layout` from the child references on every render. It holds no copy.
- `onDragStop` and `onResizeStop` become one `applyEdit`. A drop from the palette becomes
  `addWidget`. Resize snaps to the same grid as a move (R13).
- Keyboard moves and resizes, arrows and Shift+arrows (R17), go through `setChildPlacement`, as
  the handles' edits do. The canvas renders the new placement from props at once.
- Each cell is the kit's own frame, with a header of React nodes from the kit, and a body.
  Hoist's `Panel` header is not used, so E2 and E3 go away.
- **A view is selectable** (R1, R11). The frame carries `data-blueprint-view`, naming the child
  and its canvas, apart from the widget's `data-blueprint-element`. The header shows the child
  reference's `title`, else the widget's, and is left out when the reference sets `hideHeader`
  (UI round 2, choice R2-1). A view with no header still selects by its frame's border.
- **An empty canvas renders its frame** and an overlay slot for the hint, never a placeholder in
  its place, so it still takes drops (R8, E9). An empty stack does the same.
- **Test for focus** (R19, E12): deriving `layout` on every render must not remount the root or a
  frame, so a keyboard nudge keeps focus.
- **Esc cancels a drag** by rendering the document's layout again, so the cell snaps back (E5).
  Ending react-draggable's drag still needs the synthetic `mouseup`, as it does today.
- **A reader's rearrangement (R21)** is a transient config layer, under rule 1 for widgets: state
  a user can change is config, and in run mode it stays transient. "Reset layout" drops the layer.
  It covers placement only. A reader cannot add, remove or rename views, or change header items
  (R20).
- **No drags between canvases** (R16, decision 153). A view moves into another container through
  Structure or a menu. Docking, below, moves views within one dash container only.

### Dash container: splits and tabs, no GoldenLayout

The `layout` format is already a tree. `row` and `column` nodes are splits with `width` and
`height` percentages, `stack` nodes are tab sets, and `view` nodes name children. A native
renderer reads it as it is, so **blueprints need no migration**.

- **Splits** (R23): a split component with draggable dividers, controlled by the node's sizes.
  The candidate is react-resizable-panels (MIT). Its separators are focusable and move by
  keyboard. Check the license and version when D-L3 is decided. The alternative is a splitter
  built on Hoist's resizable `Panel`, which is less code to add but has no keyboard support.
- **Tabs:** Hoist's `TabContainer`, which already reports `activeTabId` (R5) and switches by
  keyboard through Blueprint's tabs (R18). Its tab order comes from the node.
- **Docking** keeps GoldenLayout's placement: drag between stacks, onto edges to split, and into
  tab strips. The next section gives the full behavior.
- **Header items** are React nodes in the stack's tab strip (R10).

### Docking

Docking places a view in a dash container by dragging it, as GoldenLayout does today. The
container computes the target, the kit draws the preview, and the drop is one edit (R7, R14,
R15).

**Sources.** A drag starts from a tab in a tab strip, or from the palette for a new widget. A
drag starts after the pointer moves 5 pixels, so a click on a tab still selects it.

**Drop zones.** Over a stack, the pointer picks one zone at a time:

| Zone | Where the pointer is | Result |
|---|---|---|
| Center | The middle of a stack's body | The view joins the stack as its last tab |
| Edge | The outer quarter of a stack's body, on one of its four sides | The stack splits on that side, and the view takes a new stack there |
| Tab strip | Between two tabs, or after the last | The view joins the stack at that index |
| Root edge | The outer 16 pixels of the whole container | The whole layout splits, and the view takes the new side |

**Sizes.** An edge drop gives the new stack half of the target's size, and the target keeps the
other half. A root-edge drop gives the new side a third. Every split keeps its children's sizes
summing to 100.

**Preview.** While a zone is active, the kit's overlay layer draws the preview, not the
container, so all marks have one home:
- for center and edge zones, a translucent box over the area the view would take, in the style
  of the canvas drop placeholder (`--xh-intent-primary-trans1` with a dashed border);
- for a tab strip, an insertion bar between the tabs.

There is one preview at a time, and it moves without delay as the pointer crosses zones.

**Refusal.** On entering a zone, the container dry-runs the move with `canMoveTo`, once per zone
per drag. A refused zone draws the preview in the danger intent, shows the reason as its label,
and takes no drop.

**Clean-up.** A move that empties a stack removes it. A split left with one child is replaced
by that child. Both happen in the same edit as the move.

**Cancel.** Esc, or a drop outside every zone, ends the drag with no edit (R12).

**Keyboard alternatives** (R18, R19). Every drag placement has a keyboard path, through the
model, with no drag:
- **Alt+Up and Alt+Down** on a focused tab move it earlier or later in its strip (R18). These
  are the keys that move an element in its slot on the canvas, in Structure and in toolbars, and
  they do not clash with the browser's Alt+Left for Back.
- **Move to** in the view's menu and the Structure row menu lists each stack by its tabs, and
  each side of each stack: "Into Positions and Orders", "Split right of Positions". That covers
  every zone except the tab strip index, which Alt+Up and Alt+Down cover.
- **Arrow keys** on a focused split divider resize it, through the split component.

Each one is one edit, as a drag is.

### Overlay layer

`BlueprintView` draws one layer above the blueprint (R6). It holds outlines, name tags, the
selection toolbar and drop marks. It places them from each frame's rect and repositions on layout
changes, through a `ResizeObserver` and the containers' gesture events.

Containers then only expose frames and events. They draw no chrome themselves, which removes
E7 and E8.

## Persistence and personalization

The two widget rules (blueprint-extensions.md) settle this:

1. **State a user can change is config.** Placement and layout are config paths:
   - `children` for a canvas;
   - `layout` for a dash container.
   In design mode a gesture is an edit, and in run mode it stays transient.
2. **No private state.** The containers keep none. Selection, active tabs and hidden views are
   view state in `BlueprintDesignModel`, as today.

Saved personal layouts come later through presets, as `personalizable` paths on `children` or
`layout`. The containers need no persistence of their own, so container-level persistence is off
for Blueprints by construction (R15).

## Mobile

Hoist has no mobile `DashCanvas` or `DashContainer`, and Blueprints has no mobile components
(D20-1). This proposal adds none. The format keeps the option open:
- a canvas's children are already in reading order, so a mobile renderer can stack them;
- splits can stack;
- tabs can use Hoist's mobile `TabContainer`.

## What apps keep

Everything. `DashCanvas`, `DashContainer`, their models, their persisted state formats, the
ViewManager integration and the GoldenLayout fork stay unchanged until the fold-back (D-L6). Apps
also get hr's two pending fixes (D-L8).

## Landing in step 20

The primitives are built in the chat kit now, alongside UI round 2, and move with everything
else (D-L7).

1. **Now, in the chat kit:**
   - the primitives: controlled grid canvas, split, tab stack and docking;
   - the `dashCanvas` and `dashContainer` widgets switched to them;
   - the overlay layer in `BlueprintView`.

   They sit in a package of their own, not under `blueprint`, because they do not depend on
   Blueprints. They stay `@internal` until the fold-back.
2. **Step 20's move** carries them into hoist-react with the rest of the chat kit. D20-1's table
   gains a row for their package (D-L11). The move PR still changes no behavior (D20-6).
3. **The fold-back, in a later major:** `DashCanvasModel` and `DashContainerModel` are rebuilt as
   stateful wrappers over the primitives. GoldenLayout's state maps almost one to one onto the
   split and tab tree, so a converter can carry apps' saved state across.

Until step 20, the primitives' dependencies, such as a split library (D-L3), are chat kit
dependencies. They join D20-3's table.

## Costs

- **New code:** a controlled canvas wrapper, a split and tab renderer, docking with its zones,
  previews and keyboard paths, and the overlay layer. The chat kit's widget models shrink,
  because the mirror and its guards go.
- **Work beside UI round 2:** both change the same widgets and `BlueprintView`, so they need one
  owner, or a clear split of files between ck and the primitives' builder.
- **A new dependency** if D-L3 picks a split library. It joins D20-3's table.
- **Two paths in hoist-react** until the fold-back: the legacy models and the primitives.
- **The fold-back** needs a converter for apps' saved state, and its own upgrade notes.
- **Drag still needs a human.** RGL and HTML5 drag need trusted events (E6), so drag checks stay
  manual either way.

## Decisions

| # | Decision | Recommendation | Who |
|---|---|---|---|
| D-L1 | The approach | (c): controlled primitives, Blueprints first, legacy unchanged | J |
| D-L2 | GoldenLayout in Blueprints | Remove it. Splits and tabs render natively, from today's `layout` format. Docking keeps its placements | J |
| D-L3 | Split component | react-resizable-panels, after a license and version check. Otherwise Hoist's resizable `Panel` | J |
| D-L4 | Canvas engine | Keep RGL, controlled from the document, with no `DashCanvasModel` | J |
| D-L5 | Reader rearrangement (R21) | Yes, as a transient layer with "Reset layout" | J |
| D-L6 | Fold-back | A later major, with a state converter. Not part of step 20 | J |
| D-L7 | Timing | **Decided:** built in the chat kit now, beside UI round 2, and moved at step 20 | J |
| D-L8 | hoist-react fixes for everyone, now | The panel title's inline flex to CSS, `titleDetails` as a node, and hr's two pending dash PRs | J |
| D-L9 | New layout kinds (R23, R24) | Splits come with D-L2. Tabs nested in a canvas view work through nesting. A tab strip as a header item, and maximizing a view, wait | J |
| D-L10 | Mobile | None now. The format keeps a stacked mobile renderer possible | J |
| D-L11 | The primitives' package | Chat kit `desktop/cmp/layout`, `@internal`. At step 20, hoist-react `desktop/cmp/dash/layout`, beside the models it later serves. Not `desktop/cmp/dock`, which is Hoist's docked-panel component | J |
| D-L12 | Docking behavior | As in Docking: four zones, half-size edge splits, one preview, refusal before the drop, clean-up in the same edit, and a keyboard path for every placement | J |
| D-L13 | Who builds it | One owner for the primitives, with a file split agreed with ck, because UI round 2 changes the same widgets and `BlueprintView` | J |
