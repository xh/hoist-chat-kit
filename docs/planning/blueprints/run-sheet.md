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

## L. Step 15, the demo apps (Toolbox 545763f2 to 7055bb51)

1. Examples lists Portfolio Blueprints and Weather Blueprints. Each opens on its own library only: 8 portfolio presets, or 6 weather (W1-W5, S5).
2. Weather: W3 shows a temperature gauge (blue to red) for New York, conditions cards, and temperature and precipitation charts. W4 shows New York and London side by side. W5 has a °C/°F toggle that switches every source and redraws the gauges.
3. Portfolio: P3 opens by link at `/portfolioBlueprints/morning-report?asOf=...`. Fund and date changes, the treemap filter (S1) and the Columns selector work, and the portfolio builder (P5) runs.
4. A weather link opened in the Portfolio app shows the denied view.
5. Blueprints tab: a Portfolio / Weather picker swaps the library, catalog and Registry. Links read `/app/blueprints/weather/<token>` and `/app/blueprints/portfolio/<token>`.
6. Architect header shows "N calls left this hour". At zero, or when paused, the composer blocks with the server's reason.
7. Admin > LLM: today's calls, failures, refusals and tokens per user and app. Day picker and export work.

## Results, sections G to L (tb, Nov 21)

Environment notes: from 08:16 to 08:22, hr's dry-run server joined the shared server's cluster and emptied John's roles. Restarted 08:22, and roles restored. Fixed during the run: e615eeed (tab crashed on first render), ae413725 (failed open showed the previous blueprint).

### G
- G1 S1: PASS, with a visual note. Intro reads "Managed by Dana Whitfield, a Long/Short fund", with NAV, day and YTD. Four stat cards: Day and YTD have trends, NAV and MTD have none. The treemap Technology click filters the grid to Technology, and a second click restores all sectors. Sparklines draw on the total and on group rows. Summary row is on. Visual: with the Architect and Inspector open, the stat-card values truncate ("3,959....", "877,8...") and the callout text overflows its cell (shot g1-s1.png).
- G2 S2: PASS, with visual notes. Lookback prompt shows 3M. The window is MTD 2026-11-01 to 2026-11-20, ending at as-of. Both price charts show "Select a row in Holdings to see this." until V is picked. Then the window chart draws close and volume as splines on two y axes, and the lookback chart draws a close areaspline. Window QTD and lookback 1M reload them (window from 2026-10-01, lookback from 2026-10-20). Heatmap: x is sector, y is strategy. Waterfall x is strategy. Visual (shot g2-s2.png): the Holdings grid shows only Symbol, since Market Value and Day P&L are clipped in a w4 cell. The heatmap labels 5 of 9 sector columns. The waterfall has no closing total bar, though its callout says "ending at the fund's total". The chartNote callout (h1) shows only its title. The window picker label truncates.
- G3 S3: PASS. The Long/Short style row's NAV is 8,100.7m: Red River 4,056.3m plus Oak Mount 4,044.5m.
- G4 S4: FAIL on layout, PASS on behavior. The switch toggles totals (Total row on, off, on). One click on "Publish to PM pack" shows one confirm, "Publish the report for Oak Mount, 2026-11-20". OK shows the toast "Published the report for Oak Mount, 2026-11-20, to the PM pack." The Fund select lists Black Crescent, Hudson Bay, Oak Mount, Red River and Winter Star. Fails (shot g4-s4.png, mainPanel about 490px wide with the Architect and Inspector open): (1) the inputBar in mainPanel's tbar shows only Fund and As of. The separator, Totals switch, slider and filter chooser are clipped, with no overflow menu, so they can't be reached. (2) In the body box, the actions buttonGroup stretches to fill the column, leaving a tall blank band, and the grid gets the bottom third. Both are kit rendering (the tbar toolbar's overflow, and the buttonGroup's flex in a column box), so they're for ck.
- G5 S5: PASS, with visual notes. Opened via `/app/blueprints/weather/weather-around-the-world`, and the tab switched to Weather with the 6 weather presets. City panel titles London, New York, Tokyo and Sydney come from their variables. The Units toolbar keeps its select visible. Visual (shot g5-s5.png): each city name shows twice, in the canvas cell header and again as the card panel's title. The "Card panels and sparkline trends" callout (h1) shows only its title. Wind has no unit.
- G6 visual polish: FAIL, for John to judge from shots g1, g2, g4 and g5. Recurring issues at a realistic width (Architect plus Inspector open, canvas about 760px): callouts in h1 or h2 cells clip to their titles, stat-card values truncate, narrow grid cells clip their columns, panel titles repeat inside cell headers, and S4's tbar clips its inputs.

### H
- H1: PASS. `?draft` opens the morning-report draft v2. An in-app link to version 1 with `asOf=2026-11-02`, and a page load of `?version=1&asOf=2026-11-03`, both open publish v1 with asOf set. The address bar then drops the variable.
- H2: PASS (impersonating jm.haynes.42@gmail.com, which has no roles; impersonation then ended). A reader's `?draft` link opens publish v1, with the toast "Showing the latest published version, as the link names one you may not open."
- H3: FIXED then PASS. An unknown id showed "Pick a blueprint, or start a new one." instead of the refusal, because emptyText checked the selection first (fixed in the commit below). It now shows "There is no publish of this blueprint that you may open.", with no stale blueprint and no Inspector.
  fix: 4460ad93 Show a link's refusal in the denied view, ahead of the no-selection text
- H4: PASS, with a note. On P3's publish, the "⋮" menu offers Copy link only (Share needs an editable draft). Copy link toasts "Link copied." I didn't read the clipboard back, since that raises a permission prompt in John's browser. The link URLs themselves are covered by H1.
- H5: PASS. From Home, open Blueprints and select P2 then P1. The URL becomes `/app/blueprints/portfolio/linked-dashboard?draft=true`, then `/app/blueprints/portfolio/one-grid?draft=true`. Back returns to `/app/home`.

### J (on my copy of P3, "tb-run P3 copy")
- J1: PASS. The outer tabs are Outline, Data and Document. In design, Data has Variables (8), Sources and Presets. In run, Data has Variables (8) only. Document has Issues, History, Publishes and JSON. Counts show only where a grid has rows.
- J2: PASS. The header holds "Draft v1", Publish, Design/Run and "⋮". The menu offers Copy link and Share.... Share... opens the panel (Everyone can view, Can edit, Can view, and the note), and a click outside closes it.
- J3: PASS. A save from "elsewhere", made through the repository as another tab would, then a UI edit, gives "Not saved - changed elsewhere". Publish hides, the "⋮" button turns to a warning, and the menu adds Reload and Save as new. Reload takes v2 and discards the edit. Save as new, after a second stale save, opens "tb-run P3 save-as-new" with the edit, while the original keeps v3 without it (shot j3-stale.png).

### K
- K1: PASS. Library search narrows by name or owner ("toolbox" keeps 8 rows, a nonsense name leaves none), and selecting a row still opens the blueprint.
- K2: PASS. The Inspector width set to 520 survives a reload (stored as `blueprintsInspector` per user). Restored to 440 after the run.
- K3: PASS. Portfolio: positions "GRAIN fund, strategy, book, trader, model, symbol JOINS fundSummary on fund; prices on symbol; hypotheticalPortfolio on symbol". prices "GRAIN symbol, day JOINS positions on symbol; hypotheticalPortfolio on symbol". Weather: weather "GRAIN city, time JOINS currentWeather on city". Each type's catalog lists only its own datasets.
- K4: PASS. Portfolio sections: Widgets (31), Variable types (2), Resolvers (11), Actions (6), Renderers (6). Search "grid" leaves cubeGrid. The App-only origin gives 1, 2, 1, 1, 1. Expanded examples render live with data for cubeGrid, chart, statCard, treemap and gauge (shot k4-registry.png). "Add as a new blueprint" on treemap opens "Example - Treemap" with no errors. In the Answers context, a widget says "Renders in the Dashboard registry only."
- K5: PASS. The toolbox.ticker renderer sample draws "Symbol". The previousBusinessDay resolver shows `asOf = "2026-11-20"`. The publishToPmPack action sample shows "Publish the report for fund, asOf ← {...}" (placeholder params, not a date). "What the Architect sees" shows describe_registry for the expanded entry and follows it to gauge.
- K6: PASS on hoistCore. Seeded globals show `toolbox` in muted grey (rgb 158,158,158), both as John and as the reader. My own copy shows no owner. Search by "toolbox" finds them. Not run on the JsonBlob store, which would mean changing the `blueprintsRepository` config. The JsonBlob owner is covered by a spec.
- K7: PASS. On my P3 copy in design, posGrid's Config shows the badge "Preset: Columns › P&L view". Clicking it gives Inspector Data > Presets with the selection `{kind: preset, id: posViews}` (shot k7-presets.png).
- K8: NOT RUN, needs John. The palette-to-canvas drop uses native HTML5 drag-and-drop into react-grid-layout. DevTools mouse drags and synthetic DragEvents both left the blueprint unchanged (version unchanged), so this needs a real pointer.
- K9: NOT RUN, needs John. Outline row drag: ag-grid re-renders rows during the drag ("Node is detached"), so this needs a real pointer.
- K10: PASS. Selecting regionChart and entering `regionPnl` in the Config header's ID field gives one edit, "Rename element regionChart to regionPnl". The canvas ref follows, and the selection moves to regionPnl.
- K11: PASS. On the P3 copy's Positions tab, the "Pos Grid" cell header shows "Columns: P&L view | Risk view". Risk view switches the columns from Market Value, Day, MTD and YTD P&L to Gross, Net and Beta-Adj Exposure, Beta and VaR (95%). There's no preset picker in the dashboard toolbar, and the Fund and As of prompts stay (shot k11-selector.png).
- K12: PASS. S4's outline shows inputBar as "Toolbar · tbar" (shot g4-s4.png), and the inputs sit in the Positions panel's top toolbar. Clipping is noted in G4.
- K13: PASS. Removing posViewsSelector on the copy raises `preset.noSelector`: "no presetSelector shows the group, so it stays at its default. Add one beside the widget it controls." The Presets editor's "Add selector" adds `presetSelector1` (`{group: posViews, display: toggle}`) to posGrid's cell headerItems, and the warning clears.
- K14: FOR JOHN (shots k7-presets.png and k14-grid-inspector.png). Sections draw as catalog-style cards (Placement; Data (6) with count and chevron). One-line fields sit beside labels, while Group by, Sort by and Filter keep labels above. The palette wraps as rows. Worst looks I'd name for ck: (1) the wrapped palette takes about a third of the Inspector's height and squeezes the outline tree to about 250px, clipping rows; (2) the Presets editor doesn't use the card sections, and its inputs keep a fixed ~390px width that leaves the right of a wide Inspector empty; (3) placement number fields are full width for one or two digits.

### I (ck's step 13 batches 1 and 2, as seen in passing)
- PASS, as observed: palette target hint ("Adds into headline", "Adds after posGrid, in positions"); Placement fields as a card (X, Y, W, H); section hints in the Presets editor ("The paths the group's presets set. Each leaves the config.", "The preset a user starts on."); tileFrame labels "Min tile width (px)" through "Spacing (px)"; a lone toolbar child stays visible (S2's windowBar and S5's unitsBar). Not exercised one by one: re-picking a resolver keeps its args, a source renamed with its dataset, adding a source in place from the palette, starters and the "Sets" picker, typed date and option values, the box align warning, tileFrame minOverMax, and the propertyTable column picker.

### L (the demo apps; HIGH 1 from hr's dry run fixed first, renaming the apps blueprintPortfolio and blueprintWeather, 18dc86f1)
- L1: PASS. Examples lists Portfolio Blueprints and Weather Blueprints. /blueprintPortfolio lists the 8 portfolio presets, and /blueprintWeather the 6 weather presets (S5, W1-W5). Full-page deep links load the right app.
- L2: FIXED then PASS. The first W3/W5 gauged temperature on a fixed scale, so W5's °F toggle pegged the gauges (72° on -10 to 40). The kit's guidance also says temperature has no natural range. The seeds now gauge humidity (0-100%, unchanged by units), show temperature as a card, and lay the cards out to fit (19928e4c). W5's °C/°F toggle switches every source (72° and 66° at °F, 22° and 19° at °C), and the gauges hold. W4 shows New York and London side by side (shot l2-w5.png). Left for ck: each gauge shows "Humidity" twice (cell header plus gauge title), and the precipitation chart's y2 (Rain, mm) is formatted as a percent. Left for data: Wind has no unit.
- L3: PASS. /blueprintPortfolio/morning-report?asOf=2026-11-18 opens publish v1 at 2026-11-18. Changing the fund to Red River reloads. The treemap filter (S1) and Columns selector (K11) pass in the shared shell. P5 opens with no errors.
- L4: PASS. /blueprintPortfolio/weather-new-york shows "There is no publish of this blueprint that you may open.", with no stale blueprint (after ae413725 and 4460ad93).
- L5: PASS. The Blueprints tab's Portfolio/Weather picker swaps the library (8 and 6), the catalog (5 datasets and 2) and the Registry. Links read /app/blueprints/portfolio/<token> and /app/blueprints/weather/<token>.
- L6: PARTIAL. John holds TOOLBOX_LLM_UNLIMITED, so `llm/usage` returns callsLeft and tokensLeft as null and the header correctly shows no count. Blocking at zero is covered by llmUsage.spec, but seeing it needs a limited user or a lowered rateLimit.
- L7: FIXED then PASS. Admin > LLM crashed on render: a Hoist column doesn't take `aggregator`. It now has a computed Total row (7a1e60c2). Today it shows john.haynes@xh.io | blueprintPortfolio | 5 calls | 0 | 0 | input 883 | output 1,719 | cache 96,189 | 98,791 tokens, plus Total, with the day picker, Refresh and Export.

### Spend (measured)
- One Architect turn, HIGH 2's repro ("Why is Tech down today?" on P3): 5 calls, 883 input, 1,719 output, 96,189 cache, 98,791 tokens, from the `LLM` track entries in Admin > LLM. I didn't compute dollars. hr measured the same step at $0.044.

### Cleanup
Impersonation ended. My three test blueprints were deleted (tb-run P3 copy, tb-run P3 save-as-new, Example - Treemap). The Inspector is back at 440. No sharing was changed. Variables changed during checks were reset, and none are saved.

Screenshots: /tmp/claude-1000/-home-john-xh-worktrees-blueprints-toolbox/695fb876-0b22-4b1a-84c2-1a5cfac4dcc0/scratchpad/shots/

## M. Phase 4, for John's real pointer and eye

1. P3 in /blueprintPortfolio: right-click a leaf row, and the row menu shows "Open detail" above Hoist's defaults. It opens "Symbol detail" for that symbol. Double-click is already checked.
2. Admin > Requests: review the sample request 61cb322d (a wind rose, filed by tb in an end-to-end check), then delete it or keep it.
3. ~~Your Auth0 session in the debug Chromium expired.~~ Done: John logged in again on Nov 21.
4. Open a drill-in dialog (P3, double-click a symbol row), then resize the window: the dialog refits (ck 4ff3f9a). tb checked it under viewport emulation (818px wide: 736x549; full size: 1100x839).
5. K8: drag a palette widget onto a dashCanvas cell. It lands where dropped, and undo removes it.
6. K9: drag outline rows into a container, and before or after a row. A refusal shows under the tree.
5. Escape cancels a real canvas cell drag: start dragging a cell, press Escape, and the cell returns with no edit (DevTools can't hold a pointer).
6. hoist-react Chip and SortableList (hoist-ui-components): in Toolbox's demo pages and round 2's sortable lists, a pointer drag reorders, a move across lists (desktop GroupingChooser, mobile ColChooser) doesn't crash, a long list auto-scrolls while dragging, and touch drag works on mobile.
