# Blueprints UI: docbar build plan

Decision 200: the docbar redesign, approved with every recommendation (D-1 to D-8). Mockups: https://claude.ai/artifact/YbYWtrdrgxP3FbM9gPGvpY. Owners: **tb** Toolbox (docbar, view bar, banner, menus), **ck** chat kit (keys and the hooks the view bar needs). `blueprints-ui` checks each batch on page 1 of John's debug Chromium. Round 5 (Move and Reorder) is not part of this plan.

## Choices, resolved (decision 200: all as recommended)

| # | Resolved |
|---|---|
| D-1 | Run becomes **Preview**, a fourth view beside Canvas, Map and JSON. The Design \| Run control goes |
| D-2 | **Edit \| Interact** sits at the right of the view bar, on the Canvas view only |
| D-3 | Readers get no view bar. Map and JSON move into More as "Show the map" and "Show the JSON" |
| D-4 | Stale is a warning band under the docbar: the explanation, Reload, and Save as new (primary) |
| D-5 | "vN live · N changes" is muted text before Publish, with a warning dot while the draft differs from the live version |
| D-6 | The name in the UI is Preview, not Run |
| D-7 | **P** goes to Preview and back to the view you came from. E, I and ` stay as decision 198 set them. No keys for Map and JSON |
| D-8 | Issues sit right before "vN live" and Publish |

## Rules

- One control per scope. The docbar holds the document (Library, name ▾, status chip, Undo, Redo) and publishing (Issues, "vN live", Publish, More, Expand, Fill). The view bar holds the view (Canvas, Map, JSON, a divider, Preview) and that view's own tools.
- A writer's draft shows the same docbar items in the same places in every view. Only the view bar's right side changes with the view.
- Preview is today's run mode under a new name. Selecting it sets `blueprintModel.mode = 'run'`, and leaving it sets `'design'`. Nothing else about run changes in this plan.
- The status chip stays as built (round, minimal, 180px slot, check or spinner).
- Toolbox keeps `editorView` as the one source of the current view, now `'canvas' | 'map' | 'json' | 'preview'`.

## Kit hooks (ck)

```ts
// Set by the host, as onRequestAdd is. Every surface that binds the design keys binds P to it, run mode included.
designModel.onPreview: () => void;

// BlueprintMap: the legend as a prop, so the view bar's Legend toggle can drive it.
BlueprintMapProps.showLegend?: boolean;   // default true, as today
```

P follows the design keys' rules: never while typing in an input, and it shows in the "?" dialog's Design group as "Preview: the reader's view". With no `onPreview` set, P does nothing and isn't listed. No other kit change is needed. Edit | Interact already reads and sets `designModel.interaction`, and JSON's Apply and Compare live in Toolbox.

## Batches

Order: K first (it unblocks B), then A, B and C, which can go in any order.

### K: keys and hooks (ck)

| # | Item | Check |
|---|---|---|
| K1 | `onPreview` on `designHotkeys` and on `BlueprintView` in run mode, bound to P | With a host toggle wired up: P from the canvas, Structure, the Map, the Inspector and Preview toggles; P in an input types "p"; "?" lists it once |
| K2 | `showLegend` on `BlueprintMap` | false hides the legend strip and the map gives back its height; true restores it |

### A: the docbar (tb)

| # | Item | Check |
|---|---|---|
| A1 | Order: Library · name ▾ · status chip · Undo · Redo · filler · Issues · "vN live · N changes" · Publish · More · Expand · Fill. Edit \| Interact, Canvas \| Map \| JSON and Design \| Run leave the docbar | In Canvas, Map, JSON and Preview, every docbar item keeps its x (measured), and an edit's save moves nothing |
| A2 | Issues as a count chip right before "vN live": danger for errors, warning for warnings, opening the list as today | Its x is fixed. Publish's disabled tooltip still names the errors or unfinished widgets |
| A3 | "vN live · N changes": muted 11px text with a warning dot while the draft differs from the live version, and "Not published yet" before a first publish. A click opens History | The count matches the publish popover's change list. It updates after Publish, Republish and an edit |
| A4 | A publish open: the status chip is success with a lock, then filler, then **Restore vN**, **Back to draft** (primary), Make a copy, More, Expand, Fill | No Undo, Issues or "vN live" |
| A5 | Reader: Library · name ▾ · a neutral outlined chip with the version and date · filler · Make a copy · More · Expand · Fill. More adds "Show the map" and "Show the JSON" | No view bar. Both items open their view and give a way back to the blueprint |

### B: the view bar (tb, after K)

| # | Item | Check |
|---|---|---|
| B1 | A 32px bar on `--xh-bg` atop the content column, between the left rail and the Inspector. Tabs: Canvas, Map, JSON, a divider, Preview. The selected tab has a 2px underline, primary for the work views and success for Preview | Both themes. Readers don't get the bar (A5) |
| B2 | Canvas tools: Edit \| Interact at the right, with the selected option filled in its intent (Edit primary, Interact warning) and the other neutral. The wrapper's title keeps the E, I and ` note | E, I and ` still switch it, and the control follows |
| B3 | Map tools: a Legend toggle driving `showLegend` (K2) | Toggling hides and shows the legend. The Map's panning and scrolling are unchanged |
| B4 | JSON tools: Apply (and the JSON panel's error text) move from the panel's bbar to the view bar. While a compare is open, the "Compare vN with" pickers and Close move up too | Apply applies one edit and reports a failure inline, as now. Compare still works from History's ⇄ |
| B5 | Preview: run mode with a success-tinted bar and the note "As readers see it: no design chrome, layouts locked as set". The rail shows Architect, Values and History, as run does today | No Inspector, Structure or Add. Leaving Preview restores the view you came from |
| B6 | P wired to `onPreview` (K1): to Preview, and back to the previous view | From Canvas, Map and JSON, and back |
| B7 | Publish open: Canvas, Map and JSON (read-only), with no Preview and no Edit \| Interact | JSON's Compare with draft works |

### C: stale (tb)

| # | Item | Check |
|---|---|---|
| C1 | A warning band under the docbar: "This draft was saved in another tab since you opened it, so your edits here aren't saved.", then Reload and Save as new (primary). In the docbar, Undo, Issues, "vN live" and Publish hide, and nothing else moves | Make a copy stale by saving it from outside at its open base, then edit. Both buttons work, the band clears, and the canvas takes no edits while it shows |

## Not in this plan

- A Fit control for the Map, shown in the mockup. The Map has no zoom today, so Fit would need one first. Raise it separately if it's still wanted.
- Move and Reorder (round 5), still with John.
