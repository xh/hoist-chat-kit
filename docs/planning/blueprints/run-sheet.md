# Blueprints browser run sheet

Debug Chromium (port 9222), Toolbox desktop app, Blueprints tab. Check the console after every step. A failed step is noted and the run continues, unless it blocks the steps after it.

Toolbox commits under test: ff8f930b (editor placement, decision 119) and 379a9594 (`blueprintsRepository` config). The reader steps need a non-admin user to impersonate, since `HOIST_ADMIN` holds write access to every blueprint.

## A. Server restart

1. Stop the running `bootRun`, then start `./gradlew bootRun -PrunHoistInline=true` (hoist-core `blueprints`, with data's impersonation refusals). It runs on MySQL.
2. In the server log: a clean start, and the blueprint tables created.
3. Admin > Config: set `xhBlueprintConfig` to `{enabled: true, createRoles: ['*']}`. `blueprintsRepository` is listed at `jsonBlob`.
4. Reload the client page. The client already runs with ck inlined, and HMR is off, so a reload picks up both repos.

## B. Storage - first on JsonBlob, then again on hoist-core

Run B1-B8 and C at `blueprintsRepository = jsonBlob`. Then set it to `hoistCore` in Admin > Config, reload the client, and run B1-B9 and C again. Each repository starts with its own empty library.

1. Empty library: the four presets are seeded, each published at v1. The first draft opens in design mode.
2. Autosave: edit, wait a second. Status goes `Draft vN - unsaved`, then `Saving...`, then `Draft vN+1`. Reload the page: the edit is kept.
3. Publish with a note. The Publishes tab lists it. Open v1 is read-only, and Back to draft returns.
4. New (empty dashboard), Copy (named copy, opens), Delete (opens the first left).
5. Registry: add an example. It becomes a new blueprint and opens.
6. Conversations: two blueprints, a message in each. Switch between them, then reload the page: each keeps its own thread.
7. Reader view (impersonate a non-admin): only published blueprints are listed. Each opens at its latest publish in run mode, with no Publish or Design/Run buttons. Copy works and gives the reader their own draft, which opens and autosaves.
8. An unpublished new blueprint is hidden from the reader until it is published.
9. hoist-core only, still impersonating: publish the reader's copy. It is refused, and the status shows the `edit.notAllowed` issue naming impersonation. Delete it: the error names impersonation. Stop impersonating: John can publish and delete again.

## C. Stale flow (two tabs on one blueprint)

1. Tab A: edit and let it save.
2. Tab B: edit. Autosave holds, and the status warns `saved elsewhere, your edits are not`. Publish is hidden.
3. Tab B: select another row. The confirm appears, and Cancel keeps B on its row with the edits.
4. Tab B: Reload. B shows A's version, with no warning.
5. Repeat 1-2, then Save as new. A new row opens with B's edits and B's conversation. The original holds A's version.

## D. Design editors (P3 and P2 copies, no model calls)

1. Placement: in design, the Outline tab has an "Add widget" strip above the tree, and the Inspector has Variables (the editor), Sources and Presets tabs. Switch to Run, or open a publish: the strip, Sources and Presets go, and Variables shows the read-only grid. Back to Design: they return.
2. Palette: add one widget of each category. Each is one edit, and the new element is selected.
3. Remove P3's `positions` tab from the inspector. Check the confirm text, that it is one edit, and that undo restores it.
4. P3 tabs: retitle, reorder, add a tab.
5. posGrid Columns > mktVal: Format `mv` with precision 2, then Renderer `bar`. The column follows.
6. A button group action: change the type, add a step, bind a param to a variable. Type `publishToPmPack`: confirm is on and locked.
7. Variables: retype `symbol`. Switch `priceStart` from resolver to user and back (one edit each). Add and remove a variable. Removing `grouping` is refused, with its reason.
8. Sources: add a source and change its dataset. Rebind `asOf`. Give mktVal an override label: the column header changes. Add an instance. Switching `positions` to `orders` is refused under Dataset.
9. Presets: make presets for posGrid Sort by. The property leaves the config, with one preset. Copy a preset, make it active, change Sort by in the inspector: the badge names the copy, and only that preset changes. Release Column state from Columns: it returns to the config at the active preset.

## E. Schema defaults (ck 6fade54)

1. Select a grid with no style set. The Inspector shows its style defaults.
2. The grid renders as it did before the change.

## F. P3 headline (7fffb7b)

1. P3 Overview: the four headline cards sit on one row at the default width.
2. Narrow the window: the cards stay readable down to ck's 100px floor.

## G. Decision 141 showcases (Blueprints tab, each preset in run mode)

1. **S1 Portfolio overview:** intro reads "P&L for <fund> as of <date>" with NAV and P&L. Four stat cards: NAV, Day and YTD with trends, MTD without. Sector treemap click filters the Positions grid, second click clears. P&L history sparklines draw on symbol rows and summed group rows. Summary row on. Callouts fit their cells. The intro reads "Managed by <manager>, a <style> fund."
2. **S2 Risk and time:** Lookback prompt shows 3M. Window picker (MTD/QTD/YTD) ends at the as-of date. Both price charts show "Select a row in Top holdings..." until a holding is picked, then the window chart draws a close spline with volume on a right axis and the lookback chart a close areaspline. Changing window or lookback reloads them. Heatmap is sector x strategy. Waterfall steps day P&L by strategy.
3. **S3 Joining sources** (ck 0c489eb): the Long/Short style row shows its two funds' summed NAV.
4. **S4 Inputs and actions:** toolbar fits, the switch toggles totals. Click "Publish to PM pack" once, confirm, check the toast. The Fund select lists the five funds from the data.
5. **S5 Weather:** panel titles come from the city variables. The toolbar keeps its select visible.
6. **All five:** visual polish.

## H. Step 14, open by URL

1. A link opens the draft (`?draft`), a numbered publish (`?version=1`), and sets a variable from an extra param, such as `asOf=2026-11-02`.
2. A reader (impersonated) given a draft link falls back to the latest publish, with a warning toast.
3. An unknown id shows the denied view.
4. Copy link copies the current URL, and pasting it in a new tab opens the same document.
5. Selecting rows updates the address bar, and Back leaves the Blueprints tab rather than stepping through rows.

## I. Step 13, batches 1 and 2

tb lists the steps when it runs them.

## J. Step 13, Toolbox Inspector and header (89ad7a7d, 66bd0a08)

1. Inspector outer tabs are Outline / Data / Document. In design, Data shows Variables, Sources and Presets. In run, or on a publish, it shows Variables only. Document shows Issues, History, Publishes and JSON, with row counts in the inner titles.
2. Header: status, Publish, Design/Run and a "⋮" menu. The menu offers Copy link and Share... (owner only). Share... opens the share panel, and clicking outside closes it.
3. Stale draft (two tabs): the menu button turns into a warning icon, and the menu adds Reload and Save as new, which still work.

## K. Step 13, Toolbox catalog, registry and library (8e092c25, 4bfb2fa2, f3d833c8)

1. Library search filters the list, and selection still opens a blueprint.
2. Inspector: drag it wider, reload, and the width holds.
3. Data Catalog: each card shows Grain and Joins lines, and they read sensibly for positions, prices and weather.
4. Registry: cards grouped by kind with counts. Search and the origin toggles narrow them. Expand a widget (cubeGrid, chart, statCard, treemap): its example renders with data, or shows a reason. "Add as a new blueprint" still works. In the Answers context, widgets say they render in the Dashboard registry only.
5. Registry: the renderer sample, resolver value and action sample still show in expanded cards, and "What the Architect sees" follows the expanded entry.
6. Library owner (f5c4a5b3), on both repositories (jsonBlob and hoistCore): another user's shared blueprint shows their username in muted text, your own shows none, and searching by a username finds their blueprints. Seeded globals show `toolbox` on hoistCore, and the seeding user on jsonBlob.
7. Design mode: a preset-controlled property's badge is a link. Clicking it opens Data > Presets with that group selected (07b1a681).
8. Drag a palette widget onto a dashCanvas cell: it lands where dropped in one edit, and undo removes it. It does nothing in run mode.
9. In the outline, drag rows into a container, and before or after a row. A refusal shows under the tree.
10. Rename an element from the Config inspector header's ID field.
11. P3 Positions tab: the posGrid cell header shows a "Columns" segmented selector (P&L view / Risk view) that switches the grid's columns. The dashboard toolbar has no preset picker. Prompted variables keep their inputs.
12. S4: the input toolbar sits in the Positions panel's top toolbar as before, and the outline lists it as "Toolbar · tbar".
13. Presets editor on a copy of P3: remove the selector and the `preset.noSelector` warning appears. "Add selector" puts one back in posGrid's cell header.
14. Styling (ck babdadf, Toolbox 8f4f300b): review the Inspector's editors (Placement, a grid's Data / Columns / Style sections, Variables, Sources, Presets) against the Data Catalog cards, and name the worst remaining looks for ck. The palette strip wraps as rows.
