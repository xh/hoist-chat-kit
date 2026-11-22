# Layout Containers for Blueprints

> **Draft proposal, no code.** John asked how Blueprints' layout containers should work, without
> the limits of today's `DashCanvas` and `DashContainer`. hr wrote it, and blueprints-ui supplied
> the interaction requirements, cited here as R1 to R24 and E1 to E12. Items marked **J** are
> John's decisions.

## Recommendation

Build **controlled layout primitives** in hoist-react, with Blueprints as their first consumer.
Leave `DashCanvas` and `DashContainer` as they are for apps. Later, rebuild those two over the
same primitives in a major release of their own. This is option (c). It takes the safe part of
(b), a new path that leaves apps alone, and adds (a)'s goal of one implementation in hoist-react.

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
model. If the copy lives in the chat kit, it moves again in step 20.

**(c)** keeps (b)'s isolation and avoids the copy. The primitives are small and controlled, and
the legacy models later become stateful wrappers over them.

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
  `addWidget`.
- Each cell is the kit's own frame: a `data-blueprint-element` hit target, a header of React
  nodes from the kit, and a body. Hoist's `Panel` header is not used, so E2 and E3 go away.
- **Esc cancels a drag** by rendering the document's layout again, so the cell snaps back (E5).
  Ending react-draggable's drag still needs the synthetic `mouseup`, as it does today.
- **A reader's rearrangement (R21)** is a transient config layer, under rule 1 for widgets: state
  a user can change is config, and in run mode it stays transient. "Reset layout" drops the layer.

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
- **Drag between stacks and edges** (R7, R14, R15): HTML5 drag and drop, with edge and center
  zones drawn by the kit. The drop reports a target node and side, so `canMoveTo` can dry-run the
  move before the drop.
- **Header items** are React nodes in the stack's tab strip (R10).

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

The move PR changes no behavior (D20-6), so this lands after it, as its own PR in one repository.

1. Step 20's move lands as planned, with the current containers.
2. Primitives and widgets in one hoist-react PR:
   - the primitives, internal until the fold-back: controlled grid canvas, split, tab stack;
   - the `dashCanvas` and `dashContainer` widgets switched to them;
   - the overlay layer in `BlueprintView`.
3. The fold-back, in a later major: `DashCanvasModel` and `DashContainerModel` rebuilt as
   stateful wrappers over the primitives. GoldenLayout's state maps almost one to one onto the
   split and tab tree, so a converter can carry apps' saved state across.

Built before the move instead, step 2 would span two repositories: primitives in hoist-react,
widgets in the chat kit. It would then move again.

## Costs

- **New code:** a controlled canvas wrapper, a split and tab renderer, kit-drawn drop zones, and
  the overlay layer. The chat kit's widget models shrink, because the mirror and its guards go.
- **A new dependency** if D-L3 picks a split library. It joins D20-3's table.
- **Two paths in hoist-react** until the fold-back: the legacy models and the primitives.
- **The fold-back** needs a converter for apps' saved state, and its own upgrade notes.
- **Drag still needs a human.** RGL and HTML5 drag need trusted events (E6), so drag checks stay
  manual either way.

## Decisions

| # | Decision | Recommendation | Who |
|---|---|---|---|
| D-L1 | The approach | (c): controlled primitives in hoist-react, Blueprints first, legacy unchanged | J |
| D-L2 | GoldenLayout in Blueprints | Remove it. Splits and tabs render natively, from today's `layout` format | J |
| D-L3 | Split component | react-resizable-panels, after a license and version check. Otherwise Hoist's resizable `Panel` | J |
| D-L4 | Canvas engine | Keep RGL, controlled from the document, with no `DashCanvasModel` | J |
| D-L5 | Reader rearrangement (R21) | Yes, as a transient layer with "Reset layout" | J |
| D-L6 | Fold-back | A later major, with a state converter. Not part of step 20 | J |
| D-L7 | Timing | After step 20's move PR, as one hoist-react PR | J |
| D-L8 | hoist-react fixes for everyone, now | The panel title's inline flex to CSS, `titleDetails` as a node, and hr's two pending dash PRs | J |
| D-L9 | New layout kinds (R23, R24) | Splits come with D-L2. Tabs nested in a canvas view work through nesting. A tab strip as a header item, and maximizing a view, wait | J |
| D-L10 | Mobile | None now. The format keeps a stacked mobile renderer possible | J |
