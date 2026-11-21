# Step 13: Polishing the Tools

> **Draft plan, no code yet.** The Designer's layout, design-mode ease of use, dragging from the
> palette, and the inspector. Sources: John's earlier feedback, which `blueprints-tb` relayed, and
> the browser run sheets. **Kit** is chat kit, in `desktop/cmp/blueprint/`. **Toolbox** is the
> Designer shell in `toolbox/.../tabs/blueprints/`.

## For John

1. **Drop targets.** Proposal: drag from the palette onto a `dashCanvas` cell, and into a box,
   a panel or a tab strip, each with a drop indicator. The alternative is canvas cells only, which
   is cheaper since Hoist's `DashCanvasModel` already takes drops (`allowsDrop`), but misses most
   layouts.
2. **Inspector tabs.** Toolbox shows about ten tabs, and Publishes and JSON fall into overflow.
   Proposal: three groups, Outline, Data (Variables, Sources, Presets) and Document (Issues,
   History, Publishes, JSON).
3. **Dashboard toolbar.** Every preset group adds a picker, so the toolbar grows. Proposal: the
   prompts stay, and the preset groups move into one "Views" menu once there are more than two.
4. **Grid inspector.** Proposal: collapsible sections, and a compact column list with a detail
   drawer per column in place of the long per-column form.
5. **New public API**, one prop: `ElementInspector.onShowPresetGroup(name)`, so a preset badge
   can open its group in the host's Presets tab.

## Items

| # | Item | Owner |
|---|---|---|
| 1 | Drag from the palette, with drop indicators, onto canvas cells and into containers, as John chooses | Kit |
| 2 | The palette says where a click adds: "Adds into overview", or "after posGrid" | Kit |
| 3 | A grid or chart from the palette with no source offers "Add a source" in place, with a dataset picker, then adds the widget over it | Kit |
| 4 | New widgets show a "configure me" notice, not fake content such as "Label 1" | Kit |
| 5 | Typed value inputs for literals, such as a step's value or a variable default: date, number, bool, options, and an app type's own input | Kit |
| 6 | Dropped: the 0s were the number input's ARIA defaults in browser automation, not what a user sees | - |
| 7 | A source named after its old dataset (`positions1`) offers a rename when its dataset changes | Kit |
| 8 | Re-picking a resolver keeps the args the new one takes | Kit |
| 9 | A box whose `align` is not stretch, holding a grid or chart, gets a validator warning and an inline hint | Kit |
| 10 | Placement fields in the inspector: a box child's flex, width and height, a tab's title, a canvas child's size. No more JSON for these | Kit |
| 11 | The grid inspector, as John chooses | Kit |
| 12 | A preset badge links to its group, through the new prop | Kit and Toolbox |
| 13 | A one-line description under each section of the Variables, Sources and Presets editors | Kit |
| 14 | A toolbar with one child never overflows into its menu | Kit |
| 15 | Dropped: the 3px target was react-select's empty inner input, which a user never clicks | - |
| 16 | The editors follow Toolbox's styling (John: the old Inspector was "pretty bad") | Kit |
| 23 | A tileFrame shows how many tiles fit, and warns past it | Kit |
| 24 | A propertyTable's fields use the grid's column picker | Kit |
| 17 | Inspector tab groups, as John chooses | Toolbox |
| 18 | A calmer blueprint header: status and Design/Run stay, while Reload, Save as new and Share move into a menu | Toolbox |
| 19 | The Registry gets the Data Catalog's card treatment, as John asked: "switch everything to that" | Toolbox |
| 20 | Dataset cards show the key ("grain: fund") and the datasets each can join | Toolbox |
| 21 | Registry cards render each widget's example live | Toolbox |
| 25 | The library list gains an owner column and a search | Toolbox |
| 26 | The Inspector is resizable, and keeps its size | Toolbox |
| 22 | Dashboard toolbar views menu, as John chooses | Kit |

## Order

1. Quick fixes: items 7, 8 and 14. No decisions are needed.
2. Ease of use: items 2 to 5, 9, 10, 13, 23 and 24.
3. After John's choices: drag (1), the grid inspector (11), preset badges (12), the toolbar
   menu (22) and the Toolbox layout (17 and 18).
4. Styling and Toolbox: items 16, 19, 20, 21, 25 and 26. The Data Catalog cards are done
   (Toolbox `152fa0f8`, `f3175c9a`).

`blueprints-tb` checks each batch in the browser, as in earlier steps. Kit items come with specs.
