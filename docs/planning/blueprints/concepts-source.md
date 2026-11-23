# Source material for Toolbox's Blueprints Concepts pages

For blueprints-tb. Each Concepts page below lists what the deck says about it, the technical doc section that has the detail, and real JSON to build its live example from. The JSON is taken verbatim from the seeded blueprints in `toolbox/client-app/src/blueprints/scenarios/`, sometimes trimmed. An excerpt is not a whole blueprint, so validate each example you assemble (`validateBlueprint`) before you ship it.

- Deck: https://claude.ai/artifact/D6Ht8waG4dFGB35sn6bXTs (slide titles are quoted below; speaker notes carry the decision numbers).
- Technical doc: https://claude.ai/artifact/GXQDDHZdAFFZoH597ToQe5 (section numbers below).
- Spec: `docs/planning/blueprints/spec.md` holds the design with illustrative examples.

## 1. Blueprints and documents

Deck: "A blueprint is one JSON document that Hoist renders", "Decisions that shape everything else", glossary card Blueprint.

- A blueprint is one plain JSON document. Hoist renders it with real Hoist widgets. The same document always renders the same UI.
- The document is the source of truth. Widget models derive their state from it, and nothing outside it changes behavior.
- It holds no functions or expressions, only names from closed registries, so a saved or model-written blueprint can't run code.
- One format serves dashboards, reports and chat answers.

Doc: sections 2 (glossary) and 4 (the format).

Example: P1 is the smallest whole blueprint (`p1-one-grid.json`, used as is):

```json
{
    "schema": {"blueprint": 1, "widgets": {"cubeGrid": 1}, "resolvers": {"today": 1}},
    "variables": {
        "asOf": {"type": "localDate", "label": "As of", "setBy": "prompt", "default": {"resolver": "today"}}
    },
    "sources": {"positions": {"dataset": "positions", "params": {"asOf": {"$var": "asOf"}}}},
    "root": "posGrid",
    "elements": {
        "posGrid": {
            "component": "cubeGrid",
            "config": {"source": "positions", "groupBy": ["sector", "symbol"], "columnState": ["mktVal", "pnlDay"]}
        }
    }
}
```

## 2. Elements and layout

Deck: glossary card Element.

- Every element sits in one flat map keyed by id. `root` names the top one.
- A container lists its children by reference. The reference carries placement (`x`, `y`, `w`, `h` on a dashboard, a title on a tab), so a widget's config holds no layout and a move changes only references.
- Each element has one parent. Containers declare named slots that match their Hoist props: a panel has `children`, `tbar`, `bbar` and `headerItems` (decision 157).
- Flat by id means a blueprint streams in any order and edits by path.

Doc: section 4, elements, child references and slots.

Example: P2's dashboard canvas (`p2-linked-dashboard.json`, the root element):

```json
"dashboard": {
    "component": "dashCanvas",
    "children": [
        {"id": "headline", "x": 0, "y": 0, "w": 12, "h": 2},
        {"id": "posGrid", "x": 0, "y": 2, "w": 8, "h": 7},
        {"id": "sectorChart", "x": 8, "y": 2, "w": 4, "h": 7},
        {"id": "ordersGrid", "x": 0, "y": 9, "w": 12, "h": 5}
    ]
}
```

## 3. Widgets

Deck: "Built from Hoist, and it gives back to Hoist", glossary card Widget, the Registry half of "The Data Catalog and Registry sit beside the work".

- A widget is a Hoist model and component that the document configures. 30 are built in.
- Each is named after the Hoist component it renders, such as `cubeGrid`, `dashCanvas`, `chart` or `statCard`, so Hoist's docs apply (chat kit D132).
- A widget declares its config schema, its outputs and the paths presets may control. Its state lives in its config, never hidden in the model.
- Apps register their own widgets under dotted names, such as `toolbox.portfolioBuilder`.

Doc: section 8 (registries). The Registry page already shows each widget's live example, so this page can point there.

Example: S1's treemap and grid (see Data binding, which reuses them).

## 4. Variables

Deck: glossary card Variable.

- Every value that moves is a variable: a prompt, a selection, a date, a filter. A filter is just a variable of type `filter`.
- Variables live only at the root. Each declares a type, a label, a default and `setBy`, which names the one thing that may set it: a prompt, a widget, an output, a resolver or an action.
- A default is a literal or a resolver, such as `previousBusinessDay`, so a saved blueprint keeps moving with time.

Doc: section 4, variables and the `setBy` table.

Example: S1's variables (`s1-overview-showcase.json`):

```json
"variables": {
    "fund": {"type": "toolbox.fund", "label": "Fund", "setBy": "prompt", "default": {"resolver": "toolbox.userFund"}},
    "asOf": {"type": "localDate", "label": "As of", "setBy": "prompt", "default": {"resolver": "previousBusinessDay"}},
    "sectorPick": {"type": "filter", "setBy": {"element": "sectorMap", "output": "selection"}}
}
```

S4's variables show every widget-set kind (`setBy: {"element": ...}`), including a bool, a number and a filter.

## 5. Data binding

Deck: "The Map shows how values move through a blueprint", the Wiring card on "People edit on the canvas".

- Config reads a variable one way: `{"$var": "name"}`. Each widget schema marks the paths that accept a binding, and the validator checks the types match.
- Widgets connect only through variables, never through references to each other: a treemap's selection sets `sectorPick`, and the grid's filter reads it.
- The Map view draws these links. The Inspector's Wiring card lists what the selected widget reads and sets.

Doc: section 4 (bindings) and section 12 (Map, Wiring).

Example: S1's treemap filters its grid (`s1-overview-showcase.json`, with `sectorPick` from Variables above):

```json
"sectorMap": {
    "component": "treemap",
    "config": {"source": "positions", "groupBy": ["sector", "symbol"], "value": "mktVal", "heat": "pnlDay", "maxDepth": 1}
},
"posGrid": {
    "component": "cubeGrid",
    "config": {
        "source": "positions",
        "groupBy": ["sector", "strategy", "symbol"],
        "columnState": ["mktVal", "pnlDay", "pnlHistory"],
        "sortBy": "mktVal|desc",
        "filter": {"$var": "sectorPick"},
        "showSummary": "top"
    }
}
```

## 6. Sources and joins

Deck: the three data-layer slides ("The Data Catalog says what each field means", "One request per source, shaped for each widget", "Drop it into an app"), glossary cards Source, Data Catalog and Kind.

- A source names a dataset from the app's Data Catalog and binds its parameters. Widgets name a source and never hold data, so a saved blueprint is always live.
- Widgets that share a source share one request. Each source holds a Cube, and each widget reads its own View of it, so a selection filters with no reload.
- A source can join other sources by key, with no backend join. The grain of each side picks the mode: same grain copies values, a coarser one keeps one value per key (a fund's NAV), a finer one reduces first.
- The model reads schemas, never rows.

Doc: section 9 (the data layer) and the joins design note `docs/planning/blueprints/joins-design.md`.

Example: S3's joined positions source (`s3-joins-showcase.json`):

```json
"positions": {
    "dataset": "positions",
    "params": {"asOf": {"$var": "asOf"}},
    "joins": [
        {"source": "funds", "on": {"fund": "fund"}, "fields": ["nav", "manager", "style"]},
        {"source": "prices", "on": {"symbol": "symbol"}, "fields": ["close"], "as": {"close": "lastClose"}}
    ]
},
"funds": {"dataset": "fundSummary", "params": {"asOf": {"$var": "asOf"}}}
```

`prices` takes `start` and `end` from variables. See the full file.

## 7. Presets

Deck: glossary card Preset.

- A preset group is a named set of values that a designer publishes for users to switch between, such as column views on a grid.
- The group lists the paths it controls. Each preset sets every one of them, so switching always gives the same result.
- A `presetSelector` widget shows the switch, wherever the designer puts it. P3 puts it in the grid's cell header (decisions 154 and 157).

Doc: section 7 (state layers).

Example: P3's `posViews` group and its selector (`p3-morning-report.json`):

```json
"presets": {
    "posViews": {
        "label": "Columns",
        "controls": [{"path": "/elements/posGrid/config/columnState"}],
        "default": "pnl",
        "items": {
            "pnl": {"label": "P&L view", "set": {"elements": {"posGrid": {"config": {"columnState": ["mktVal", "pnlDay", "pnlMtd", "pnlYtd"]}}}}},
            "risk": {"label": "Risk view", "set": {"elements": {"posGrid": {"config": {"columnState": ["grossExposure", "netExposure", "betaAdjExposure", "beta", "var95", "pctNav", "retYtd", "delta", "vega"]}}}}}
        }
    }
},
"posViewsSelector": {"component": "presetSelector", "config": {"group": "posViews", "display": "segmented", "label": "Columns"}}
```

## 8. Actions

Deck: "Safe by construction", "Decisions that shape everything else".

- Actions are typed, from a registry. Each type declares its parameters, so every action is checked before it runs.
- Built in: `setVariable`, `resetVariable`, `refresh`, `navigate`, `openUrl` and `openBlueprint`. Apps add their own under dotted names.
- A prop takes one action or a list of up to 8 steps. An action with side effects always asks the user to confirm, and a chat answer can't use one.
- `openBlueprint` drills into another blueprint of the same type, in a dialog or popover, and a row action reads the clicked row with `{"$row": field}`.

Doc: section 4 (actions and drill-in).

Example: S4's buttons (`s4-inputs-showcase.json`):

```json
"actions": {
    "component": "buttonGroup",
    "config": {
        "buttons": [
            {"label": "Clear filters", "icon": "reset", "action": [{"type": "resetVariable", "variable": "posFilter"}, {"type": "resetVariable", "variable": "minPnl"}]},
            {"label": "Refresh", "icon": "refresh", "action": {"type": "refresh"}},
            {"label": "Publish to PM pack", "icon": "share", "action": {"type": "toolbox.publishToPmPack", "fund": {"$var": "fund"}, "asOf": {"$var": "asOf"}}}
        ]
    }
}
```

P3's row action (`posGrid.config.rowActions`):

```json
[{"label": "Open detail", "icon": "external-link", "action": {"type": "openBlueprint", "blueprint": "symbol-detail", "variables": {"symbol": {"$row": "symbol"}, "asOf": {"$var": "asOf"}}}}]
```

## 9. Design, run, publish

Deck: "People edit on the canvas", "A library to find blueprints, a dock to build them", "Built, and next".

- Every change is an edit: a list of operations on JSON Pointer paths, checked as a whole and applied all or nothing. One edit is one undo step and one history entry. People, the Architect and a grid sort all use the same path.
- Design mode edits the draft or a preset. Run mode is for users: changes there stay transient.
- A blueprint has one draft and numbered publishes. Users run the latest publish, and writers share the draft.
- Blueprints are stored through a repository contract the app implements (JsonBlob, or hoist-core's `BlueprintService`). Each has a type and a stable token, the same in every environment, and opens by URL.

Doc: sections 6 (edits and versions), 10 (storage), 12 (design mode) and 14 (opening by URL). The edit-flow page diagrams an edit from the tool call to the screen and back: https://claude.ai/artifact/FwmiCwj5QHC9TN8MEw3mJB

Example edit (from the edit-flow page):

```json
{
    "base": 7,
    "description": "Stripe the positions grid",
    "ops": [{"op": "set", "path": "/elements/posGrid/config/stripeRows", "value": true}]
}
```

## 10. The Architect

Deck: "The Architect builds with the same checked edits", "Key decision: every chat answer is a blueprint".

- The Architect is the AI agent that builds and edits blueprints through the same checked edits people make. The tools enforce mode and access, not the prompt.
- It reads the catalog and registry before it writes, so it never guesses a field or a config key.
- It answers questions with answer blueprints in the chat, and "Add to dashboard" translates an answer into the host blueprint.
- Sonnet 5.5 is the default. The final dry run measured $0.910 over 65 calls for both demo scripts, a drill-in and a feature request (decision 173).
- When it can't do something, it offers a workaround and, with the user's approval of the whole payload, files a feature request that stays in the app (decision 168).

Doc: section 11 (the Architect) and `docs/planning/blueprints/guidance.md` (what it has learned).

No example blueprint: a short recorded exchange, or a link to the Architect dock, fits this page better.

## Diagrams and pictures

- Deck slide "A blueprint is one JSON document that Hoist renders": a five-step flow, from people and the Architect to Blueprint, Widgets, Sources and App data. It's HTML boxes, not an image.
- The edit-flow page: two Mermaid diagrams, an edit flowing down to the screen and a user's change flowing back up.
- Screenshots of the redesigned UI (light theme, except the Registry): JPEGs in the deck session's scratchpad, `/tmp/claude-1000/-home-john-xh-worktrees-blueprints-hoist-chat-kit/5965f363-c039-4229-95c2-a90fdcefb3fa/scratchpad/deck-img/`. Live Toolbox shows these better than pictures.
