# Dashboards and visualizations as JSON or code, and how LLMs generate or edit them

Scope: Grafana (schema v2, Foundation SDK, Grafana Assistant, mcp-grafana), Vega-Lite (and the LLM research built on it: LIDA, Data Formulator, Flint, VegaChat), Perspective (viewer config, workspace layout, built-in LLM agent), plus finance-industry profiles: AG Grid AI Toolkit, interop.io io.Intelligence, HERE (ex-OpenFin) Studio, Bloomberg ASKB.

All sources checked 2026-11-21. "Snippet only" marks a claim seen in a search result summary but not on a fetched page.

Major news since older training-era knowledge, for the report writer:
- Perspective moved from `finos/perspective` to `perspective-dev/perspective` (OpenJS onboarding, packages renamed `@perspective-dev/*`), deprecated the separate `perspective-workspace` package in v5.0 (2026-07-28), folded multi-panel dashboards into `<perspective-viewer>` itself, and shipped a first-party LLM agent in v5.2 (2026-08-10). This is the closest analogue to Hoist Blueprints found.
- Grafana schema v2 is no longer preview: dynamic dashboards (built on v2) went GA in Grafana 13 (2026-04-08) and are on by default; v1 dashboards migrate to v2 on open.
- Microsoft Data Formulator no longer targets Vega-Lite directly; it now renders through Flint (MIT, 2026), an LLM-oriented intermediate chart language that compiles to Vega-Lite, ECharts, Chart.js, Plotly and Excel.

## Q1. What does the model emit: a JSON dashboard/layout/chart spec, code, or a component tree?

### Takeaway
Grafana and Perspective agents emit typed JSON configs through tool calls against a known schema (whole-document or field-wise patches), not code. Vega-Lite is a JSON chart spec, but the most prominent research systems have moved either to code (LIDA) or to a higher-level intermediate spec (Flint). Finance products mostly emit state patches against an existing component (AG Grid) or select/compose saved layouts (interop.io), with HERE Studio as the outlier that generates whole widgets.

### Cited Findings
**Grafana**
- Schema v2 dashboard spec has a top-level `elements` map, a `layout`, `variables`, `annotations`, `links`, `timeSettings`, `cursorSync`, `tags`, `title`, `liveNow`, `preload` - [Grafana schema v2 docs v12.4](https://grafana.com/docs/grafana/v12.4/observability-as-code/schema-v2/)
- In the CUE source, `elements: [ElementReference.name]: Element`, with `Element: PanelKind | LibraryPanelKind // |* more element types in the future`, and `ElementReference: { kind: "ElementReference", name: string }`. So elements are a flat map keyed by name, and layouts reference them by name - [grafana/grafana apps/dashboard/kinds/v2/dashboard_spec.cue](https://github.com/grafana/grafana/blob/main/apps/dashboard/kinds/v2/dashboard_spec.cue)
- Every node is a `{kind, spec}` pair; v2 "models all dashboard elements as Kubernetes kinds", served under `dashboard.grafana.app` (Swagger for `v2beta1` linked) - [Grafana schema v2 docs (latest)](https://grafana.com/docs/grafana/latest/as-code/observability-as-code/schema-v2/); the CUE source also has a `v2` kind directory alongside `v2beta1`/`v2alpha1` - [grafana-schema generated types](https://github.com/grafana/grafana/tree/main/packages/grafana-schema/src/schema/dashboard)
- The v2 spec has a `prompts?: [...Prompt]` field: "Prompts viewers can run on the dashboard, offered by plugins in the dashboard controls" - [dashboard_spec.cue](https://github.com/grafana/grafana/blob/main/apps/dashboard/kinds/v2/dashboard_spec.cue)
- Foundation SDK: strongly typed builder libraries (Go, TypeScript, Python, PHP, Java). You chain a `DashboardBuilder`, call `build()`, then serialize to JSON (`json.MarshalIndent` / `JSON.stringify`) - [Foundation SDK docs](https://grafana.com/docs/grafana/latest/as-code/observability-as-code/foundation-sdk/), [grafana-foundation-sdk README](https://github.com/grafana/grafana-foundation-sdk)
- Grafana Assistant docs describe actions (scaffold dashboards, generate panels, set variables, change visualizations, refine queries, copy panels/layouts, adjust positioning) but do not state the wire format it emits - [Assistant dashboarding guide](https://grafana.com/docs/grafana-cloud/machine-learning/assistant/guides/dashboarding/)
- Assistant "dashboard plans" (public preview): the Assistant first proposes a plan of titles, tabs/rows, panels, visualization types and variables, offering **Preview** and **Build it** - [Assistant dashboarding guide](https://grafana.com/docs/grafana-cloud/machine-learning/assistant/guides/dashboarding/)
- Grafana's agent blog (2025-07-01, older) says the agent used open-source Grafana MCP Server tools (`list_datasources`, `list_prometheus_metric_names`, label inspection) and "generates a complete, multi-panel dashboard in your Grafana instance with a single command" - [Grafana blog](https://grafana.com/blog/going-beyond-ai-chat-response-how-were-building-an-agentic-system-to-drive-grafana)
- mcp-grafana (the open MCP server any agent can use) offers `get_dashboard_summary`, `get_dashboard_property` (JSONPath), "Update or create a dashboard" (full JSON, with a context-window warning) and "Patch dashboard: Apply specific changes ... without requiring the full JSON" - [grafana/mcp-grafana README](https://github.com/grafana/mcp-grafana)

**Vega-Lite and research systems**
- Vega-Lite is a declarative JSON grammar; current release v6.5.0 (2026-10-08); versioned JSON Schemas published (`vega/schema` has `vega-lite/v6.5.0.json`, `v6.json`) - [vega-lite releases](https://github.com/vega/vega-lite/releases), [vega/schema repo](https://github.com/vega/schema/tree/master/vega-lite)
- LIDA "treats visualizations as code": it generates and executes Python plotting code (matplotlib, seaborn, altair, ggplot), and is "grammar agnostic" - [microsoft/lida README](https://github.com/microsoft/lida). VegaChat's authors likewise classify LIDA and CoML4VIS as systems that "directly produce code" - [VegaChat arXiv 2601.15385](https://arxiv.org/html/2601.15385v1)
- Li et al. (arXiv 2401.11255) evaluated LLMs generating Vega-Lite specs from NL on nvBench; GPT-3.5 with few-shot prompts beat prior approaches - [arXiv 2401.11255](https://www.arxiv.org/pdf/2401.11255) (snippet only)
- VegaChat (JetBrains authors, 2026-01-21) "generates, validates, and assesses declarative visualizations from natural language" - [arXiv 2601.15385](https://arxiv.org/abs/2601.15385)
- Data Formulator (2023 paper) uses "concept binding": the user binds data concepts to visual channels, and an AI agent writes the data transformations - [arXiv 2309.10094](https://arxiv.org/abs/2309.10094)
- Data Formulator v0.7 (2026-05-28) charts are "built on Flint", a "semantic chart engine" with 30+ chart types - [microsoft/data-formulator README](https://github.com/microsoft/data-formulator)
- Flint: "a visualization language for the AI era"; agents write short specs and a compiler handles "verbose low-level settings". 52 chart types, 5 backends (Vega-Lite, ECharts, Chart.js, Plotly, native Excel), 14 themes, 23 interaction presets; ships an MCP server (`flint-chart-mcp`, hosted at `flint.data-formulator.ai/mcp`) and an npm/React library. Flint 1.0 (2026-10-19) added interaction presets and semantic events; 1.1 (2026-11-15) added maps and layout - [microsoft/flint-chart README](https://github.com/microsoft/flint-chart)
- Flint paper: "A Semantics-Driven Data Visualization Intermediate Language" (Wang, Lu, Chen, Sarikaya, Wang; 2026-07-22). Authors describe field meaning through a hierarchical data semantic model and the compiler derives scales, axes and formatting - [arXiv 2607.20775](https://arxiv.org/abs/2607.20775)

**Perspective**
- `<perspective-viewer>` "ships with an embedded LLM agent which drives the viewer through its public API - reading the schema, writing the `ViewerConfig`, choosing a plugin, authoring ExprTK expressions and managing panels" - [perspective agent.md](https://github.com/perspective-dev/perspective/blob/master/docs/md/how_to/javascript/agent.md)
- Agent tools: `get_schema`, `get_view_config`, `set_view_config`, `list_plugins`, `validate_expression`, `get_style_schema`, `list_panels`, `get_workspace`, `add_panel`, `remove_panel`, `activate_panel`, `set_workspace`, `search_docs`, plus experimental `run_script`/`list_scripts`/`stop_script` - [agent.md](https://github.com/perspective-dev/perspective/blob/master/docs/md/how_to/javascript/agent.md)
- `set_workspace` applies "a field-wise update to the dashboard's workspace state; absent fields are unchanged and `null` resets", taking a partial `WorkspaceConfigUpdate`. `add_panel` takes a full `ViewerConfigInitial` with `table` and `columns` required - [agent/tools.rs](https://github.com/perspective-dev/perspective/blob/master/rust/perspective-viewer/src/rust/agent/tools.rs)
- Agent introduced in PR #3209, released v5.2.0 (2026-08-10); workspace/layout tool support in PR #3254, v5.6.1 (2026-10-23); `run_scripts` in v5.9.2 (2026-11-16) - [perspective releases](https://github.com/perspective-dev/perspective/releases), [PR 3209](https://github.com/perspective-dev/perspective/pull/3209), [PR 3254](https://github.com/perspective-dev/perspective/pull/3254), [PR 3289](https://github.com/perspective-dev/perspective/pull/3289)
- `run_script` lets the agent write an ES module that fetches data and calls `psp.emit()` to create a named table - [agent_scripts.md](https://github.com/perspective-dev/perspective/blob/master/docs/md/how_to/javascript/agent_scripts.md)

**Finance-industry**
- AG Grid AI Toolkit: `gridApi.getStructuredSchema()` returns a JSON Schema of the grid state an LLM may change (filtering, sorting, aggregation, pivoting, row grouping, column visibility, column sizing); the model returns `gridState` plus `propertiesToIgnore`, applied with `gridApi.setState(response.gridState, response.propertiesToIgnore)` - [AG Grid AI Toolkit docs](https://www.ag-grid.com/javascript-data-grid/ai-toolkit.md). Shipped in AG Grid 34.3 - [What's New in 34.3](https://www.ag-grid.com/blog/whats-new-in-ag-grid-34-3/) (snippet only)
- interop.io io.Intelligence MCP: "Workspace Orchestration" lets the AI "Create new workspaces or restore existing ones"; "Workspace Discovery" finds "pre-configured workspace layouts that match specific business scenarios"; a "Workspace Widget" MCP App previews or builds a workspace by drag-and-drop in the conversation. The page does not say what format the AI emits - [docs-ai.interop.io capabilities](https://docs-ai.interop.io/modules/mcp/capabilities)
- io.Connect workspace layouts are JSON objects, created programmatically, from app definitions, or from a layout store - [interop.io workspaces overview](https://docs.interop.io/desktop/capabilities/windows/workspaces/overview/index.html) (snippet only)
- HERE Studio (HERE = OpenFin, renamed 2024-06-05) builds "an app that pulls from connected data sources and shapes it into a component"; output is "an individual app or widget", composable into a dashboard called a **Supertab**. Format not disclosed. Blog dated August 2026 - [HERE blog: Inside HERE Studio](https://www.here.io/blog/product/the-ai-enterprise-browser-inside-here-studio); rename date - [Markets Media](https://www.marketsmedia.com/openfin-evolves-to-here-and-launches-enterprise-browser/) (snippet only)
- Bloomberg ASKB (beta 2026-02-23) can "Create charts and tables with intelligent annotations" and, for data analysis, gives "the underlying Bloomberg Query Language (BQL) code" for Excel or BQuant - [Markets Media, 2026-02-23](https://www.marketsmedia.com/bloomberg-introduces-agentic-ai-to-the-terminal/)

### Inferences
- Grafana v2 and Perspective v5 both converged on what Blueprints has: a flat, name-keyed element/panel map plus a separate layout tree that references elements by id. Grafana: `elements` + `ElementReference.name`; Perspective: `panels` + `layout` naming each panel id exactly once.
- The agent tool shape in Perspective (read schema, read config, field-wise patch, validate expression, search docs) is a close template for a Blueprint editing toolset.
- The Flint move is evidence that raw Vega-Lite is too verbose a target for reliable LLM output when style and interaction quality matter; the field is adding a semantic intermediate layer above it.

### Gaps
- Grafana Assistant's internal emit format (full v2 JSON, patches, or scene mutations) is not documented in anything I found.
- HERE Studio output format (generated code vs config) is undisclosed.
- I did not read the full Flint or VegaChat papers; neither abstract gives numbers on spec validity for raw Vega-Lite vs Flint.

## Q2. How is the output validated and kept safe?

### Takeaway
Validation is schema-driven everywhere: Grafana has CUE-defined kinds plus Zod checks in the UI; Perspective has generated JSON Schemas for tool parameters, a `validate()` API, strict `restore()`, and an entitlement model; AG Grid hands you a JSON Schema and tells you to ajv it. Vega-Lite's safety concern is its expression language, which runs via `Function` unless you use the CSP interpreter. Data-side safety is delegated to existing permissions.

### Cited Findings
- Grafana v2 schema is defined in CUE (`apps/dashboard/kinds/v2/dashboard_spec.cue`) and generated to TS types - [dashboard_spec.cue](https://github.com/grafana/grafana/blob/main/apps/dashboard/kinds/v2/dashboard_spec.cue)
- Grafana's frontend validates v2 structures with `zod/mini`; queries are `DataQueryKind` (`{kind: "DataQuery", group, version, datasource?: {name?}, spec: [string]: _}`), and the validator treats `spec.query` as opaque - [validation.ts](https://github.com/grafana/grafana/blob/main/public/app/features/dashboard-scene/v2schema/validation.ts), [dashboard_spec.cue](https://github.com/grafana/grafana/blob/main/apps/dashboard/kinds/v2/dashboard_spec.cue)
- Foundation SDK is "strongly typed", catches errors "at compile time"; errors surface at `build()` - [SDK README](https://github.com/grafana/grafana-foundation-sdk), [SDK docs](https://grafana.com/docs/grafana/latest/as-code/observability-as-code/foundation-sdk/)
- Grafana Assistant "will also validate the panels to ensure data is returned and report any configuration errors", aiming to minimize "No Data" panels; it needs read access to data sources and dashboard write permission to save - [Assistant dashboarding guide](https://grafana.com/docs/grafana-cloud/machine-learning/assistant/guides/dashboarding/)
- mcp-grafana tools require specific RBAC permissions and scopes (`dashboards:read/create/write`, `dashboards:uid:...`) on a service account or on-behalf-of token - [mcp-grafana README](https://github.com/grafana/mcp-grafana)
- Grafana's agent team validates at the agent level with reproducible evals "against a set of scenarios in a controlled Grafana environment" (2025, older) - [Grafana blog](https://grafana.com/blog/going-beyond-ai-chat-response-how-were-building-an-agentic-system-to-drive-grafana)
- Vega-Lite JSON Schemas are published per version - [vega/schema](https://github.com/vega/schema/tree/master/vega-lite)
- Vega by default code-generates expressions and runs them via the `Function` constructor; `vega-interpreter` evaluates the AST instead for CSP compliance, ~10% slower on initial parse/dataflow - [vega-interpreter README](https://github.com/vega/vega/tree/main/packages/vega-interpreter)
- LIDA warns it "generates and executes code" and should run "in a secure environment"; it reports a visualization error rate under 3.5% across 2,200+ visualizations vs a >10% baseline - [LIDA README](https://github.com/microsoft/lida)
- VegaChat reports "near-zero rates of invalid or empty visualizations" on NLV Corpus and a ChartLLM subset - [arXiv 2601.15385](https://arxiv.org/abs/2601.15385)
- Perspective agent tools are each gated by an entitlement (`read_view`, `configure_view`, `manage_layout`, `read_docs`, `execute_code`, `read_data`); default grants all but `execute_code` and `read_data`; "A tool whose entitlement is withheld is never offered to the model" - [agent.md](https://github.com/perspective-dev/perspective/blob/master/docs/md/how_to/javascript/agent.md), [tools.rs](https://github.com/perspective-dev/perspective/blob/master/rust/perspective-viewer/src/rust/agent/tools.rs)
- Perspective's docs bundle includes "generated JSON schemas for `ViewerConfigUpdate` / `ViewerConfigInitial`" that "upgrades the config tools' parameter schemas from permissive objects to the real generated ones"; without it, a weaker model more often "invents a field name that doesn't exist" - [PR 3209](https://github.com/perspective-dev/perspective/pull/3209), [agent.md](https://github.com/perspective-dev/perspective/blob/master/docs/md/how_to/javascript/agent.md)
- Perspective `restore()` "validates its argument, rejecting for example a key the config format does not define"; `perspective-migrate` exposes `validate()` for `ViewConfig`, `ViewerConfig` or `WorkspaceConfig` "with detailed error messages", plus sync `create_validator()` and a `strict` flag (v5.9.0, 2026-11-09) - [save_restore.md](https://github.com/perspective-dev/perspective/blob/master/docs/md/how_to/javascript/save_restore.md), [PR 3280](https://github.com/perspective-dev/perspective/pull/3280)
- Perspective agent has `validate_expression` for ExprTK expressions - [tools.rs](https://github.com/perspective-dev/perspective/blob/master/rust/perspective-viewer/src/rust/agent/tools.rs)
- Perspective `run_script` runs agent JavaScript "in a sandbox subject to CSP", behind the off-by-default `execute_code` entitlement - [PR 3289](https://github.com/perspective-dev/perspective/pull/3289)
- Perspective warns "A key in `agentConfig` is a key in the browser tab" and recommends pointing `url` at a server proxy for anything shared - [agent.md](https://github.com/perspective-dev/perspective/blob/master/docs/md/how_to/javascript/agent.md)
- AG Grid: validate the LLM response against the schema (docs suggest ajv) before `setState`; schema can be customised but must stay a valid `GridState` - [AG Grid AI Toolkit](https://www.ag-grid.com/javascript-data-grid/ai-toolkit.md)
- interop.io: action capabilities (launch, orchestration) "are only available to AI assistants that can request and handle user confirmations"; orchestration requires MCP sampling, discovery requires elicitation - [io.Intelligence capabilities](https://docs-ai.interop.io/modules/mcp/capabilities)
- HERE claims "compliance by construction" and "intent-based FDC3", where apps define which actions AI may take; the article frames intent-based FDC3 as a roadmap preview, and the compliance claim is marketing - [HERE Studio blog](https://www.here.io/blog/product/the-ai-enterprise-browser-inside-here-studio)

### Inferences
- The strongest pattern is "schema-typed tool parameters plus a server-side validator the model can call before committing", which Perspective implements end to end. Grafana validates the result by running queries, a second axis (data validity, not just schema validity) worth copying.
- Opaque query payloads (Grafana `DataQueryKind.spec`) are where schema validation stops; validity then depends on the data source plugin.

### Gaps
- No public detail on how Grafana Assistant guards against destructive edits beyond undo and permissions.

## Q3. Is the output persistent and editable (saved, versioned, diffable, editable by human and model)?

### Takeaway
All three core formats are plain JSON that round-trips through the UI, so human and model edit the same artifact. Grafana adds server-side versions and Git Sync PRs; Perspective is save/restore tokens owned by the host app; Vega-Lite specs are files. Finance products are weaker here: AG Grid state is ephemeral unless the host persists it, HERE and Bloomberg persistence is product-internal.

### Cited Findings
- Grafana 13 Git Sync (GA) connects Grafana to GitHub, GitLab, Bitbucket or other git repos; users edit in Grafana, then save, commit and open a pull request from the UI - [What's new in v13.0](https://grafana.com/docs/grafana/latest/whatsnew/whats-new-in-v13-0/)
- mcp-grafana can list dashboard versions (number, author, timestamp, save message) and load a saved version by `version` - [mcp-grafana README](https://github.com/grafana/mcp-grafana)
- Dashboards provisioned through API, Terraform or Git Sync "continue to work" under v2; v1 dashboards migrate to v2 when opened - [Dynamic dashboards GA, 2026-04-08](https://grafana.com/whats-new/2026-04-08-dynamic-dashboards-is-now-generally-available/)
- Provisioning v2 dashboards from files reportedly fails unless `apiVersion` is `dashboard.grafana.app/v2` - [Grafana community thread](https://community.grafana.com/t/provisioning-in-grafana-13-with-v2-dashboards/163029) (snippet only, single user report)
- Grafana Assistant: in Workspace "you save to Grafana from the canvas"; undo reverts the most recent change, but "You can't undo the change if the dashboard has changed since"; preview dashboards are read-only - [Assistant dashboarding guide](https://grafana.com/docs/grafana-cloud/machine-learning/assistant/guides/dashboarding/)
- Perspective: the viewer's "entire state (sans the data itself) can be serialized" with `save()` and applied with `restore()`; `saveWorkspace()`/`restoreWorkspace()` serialize "every panel plus the layout and cross-filter state" as a `WorkspaceConfig` (`{ version, layout, panels, ... }`); tokens can be persisted "to `localStorage` or a server"; "The JSON format is human-readable" - [save_restore.md](https://github.com/perspective-dev/perspective/blob/master/docs/md/how_to/javascript/save_restore.md)
- Perspective tokens carry a `version`; older tokens are upgraded with `perspective-migrate`, and `restore()` names the release when it rejects a token from another version - [save_restore.md](https://github.com/perspective-dev/perspective/blob/master/docs/md/how_to/javascript/save_restore.md), [PR 3280](https://github.com/perspective-dev/perspective/pull/3280)
- `saveWorkspace()` may return "an equivalent but flatter tree" than the one restored (same-orientation splits are flattened) - [layout.md](https://github.com/perspective-dev/perspective/blob/master/docs/md/how_to/javascript/layout.md)
- LIDA supports `lida.edit(code=..., instructions=...)` on generated code - [LIDA README](https://github.com/microsoft/lida)
- Data Formulator v0.7 adds "persistent sessions & workspaces" and sharing as reports; README says it keeps "editable charts in one history" where users can refine or branch from any point - [data-formulator README](https://github.com/microsoft/data-formulator)
- Flint specs are described as "simple, human-editable" - [flint-chart README](https://github.com/microsoft/flint-chart)
- Bloomberg ASKB Workflows can be saved to a Workflow Library as reusable templates and shared within the firm; the article does not say how individual charts are saved - [Markets Media](https://www.marketsmedia.com/bloomberg-introduces-agentic-ai-to-the-terminal/)
- HERE Studio apps can be published and composed into Supertabs for a team or organization; no versioning detail - [HERE Studio blog](https://www.here.io/blog/product/the-ai-enterprise-browser-inside-here-studio)
- interop.io MCP Apps widgets "save and restore their state" - [io.Intelligence capabilities](https://docs-ai.interop.io/modules/mcp/capabilities)

### Inferences
- Grafana is the only product with first-class review of AI edits as diffs (Git Sync PRs + dashboard versions). Its undo is shallow.
- Perspective's flattening on save means a model diffing its own output against `saveWorkspace()` can see spurious changes; a canonical form matters for diffability.

### Gaps
- Whether Grafana Assistant edits create a new dashboard version per change, or only on explicit save, is not documented.

## Q4. How does it bind to live data, and is there a semantic layer?

### Takeaway
Grafana binds each panel to data-source plugin queries (opaque per-plugin specs), Perspective binds panels to named server-side tables (including derived tables), Vega-Lite takes inline, URL or runtime-inserted named data. None has a true semantic layer; the closest substitutes are Perspective's host-supplied data notes, AG Grid column descriptions, Grafana's Knowledge Graph, and Flint's "data semantic model".

### Cited Findings
- Grafana v2 panels hold `data: QueryGroupKind`; each `PanelQuery` has `refId`, `hidden`, and a `DataQueryKind` with `group` (data source type), `version`, optional `datasource.name`, and a free-form `spec` - [dashboard_spec.cue](https://github.com/grafana/grafana/blob/main/apps/dashboard/kinds/v2/dashboard_spec.cue), [validation.ts](https://github.com/grafana/grafana/blob/main/public/app/features/dashboard-scene/v2schema/validation.ts)
- Grafana Assistant can reuse metrics and thresholds from existing dashboards and alert rules; Knowledge Graph memory, when enabled, adds infrastructure metadata search; docs recommend naming data sources in the prompt - [Assistant dashboarding guide](https://grafana.com/docs/grafana-cloud/machine-learning/assistant/guides/dashboarding/), [Assistant dashboards overview](https://grafana.com/docs/grafana-cloud/machine-learning/assistant/dashboards) (snippet only for naming advice)
- The Grafana agent discovers data via MCP tools (`list_datasources`, `list_prometheus_metric_names`), and preprocesses API responses into "semantic sentences instead of raw JSON", cutting tokens "by up to 4x" (2025) - [Grafana blog](https://grafana.com/blog/going-beyond-ai-chat-response-how-were-building-an-agentic-system-to-drive-grafana)
- mcp-grafana "Run panel query" executes a panel's query with custom time ranges and variable overrides (disabled by default) - [mcp-grafana README](https://github.com/grafana/mcp-grafana)
- Vega-Lite data: inline `values`, `url`, top-level `datasets`, generators, and named sources (`{"name": "myData"}`) that are "a placeholder for data bound at runtime" via `view.insert('myData', data).run()` or changesets - [Vega-Lite data docs](https://vega.github.io/vega-lite/docs/data.html)
- Flint: "authors describe what data fields mean through a hierarchical data semantic model", and the compiler derives visualization config - [arXiv 2607.20775](https://arxiv.org/abs/2607.20775)
- Data Formulator v0.7 has persistent connectors (Superset, Kusto, Cosmos DB, MySQL, PostgreSQL, MSSQL, BigQuery, S3, Azure Blob) and a data-loading agent - [Data Formulator 0.7 release](https://github.com/microsoft/data-formulator/releases/tag/0.7.0)
- Perspective panels bind a named `table` (required for `add_panel`); `derived_tables` are "a pivoted/filtered view of `table` that panels can then bind by name" - [tools.rs](https://github.com/perspective-dev/perspective/blob/master/rust/perspective-viewer/src/rust/agent/tools.rs)
- Perspective agent "learns column names and types from `get_schema`, but not what they _mean_"; hosts add `{title, text}` corpus entries (e.g. "`Discount` is a ratio in [0, 1], not a percent") - [agent.md](https://github.com/perspective-dev/perspective/blob/master/docs/md/how_to/javascript/agent.md)
- Perspective's `read_data` entitlement is withheld by default - [agent.md](https://github.com/perspective-dev/perspective/blob/master/docs/md/how_to/javascript/agent.md)
- Perspective v5.x has Virtual Servers (DuckDB, SQL) in addition to the in-browser WASM engine - [perspective releases](https://github.com/perspective-dev/perspective/releases)
- AG Grid columns can carry a `description` for the LLM, and `includeSetValues` sends Set Filter values for low-cardinality columns - [AG Grid AI Toolkit](https://www.ag-grid.com/javascript-data-grid/ai-toolkit.md)
- HERE Studio apps are "built on the organization's own data connectors", approved connectors only - [HERE Studio blog](https://www.here.io/blog/product/the-ai-enterprise-browser-inside-here-studio)
- Bloomberg ASKB emits BQL, i.e. Bloomberg's own query language is the data binding - [Markets Media](https://www.marketsmedia.com/bloomberg-introduces-agentic-ai-to-the-terminal/)

### Inferences
- Perspective's default of withholding `read_data` (the model sees schema, not rows) is a useful privacy default for hedge-fund clients.
- A "data notes" corpus appended to docs is the lightweight semantic layer that both Perspective and AG Grid settled on; neither has metric definitions or governed measures.

### Gaps
- Did not find a Grafana semantic layer product beyond Knowledge Graph; no evidence of governed metric definitions used by the Assistant.

## Q5. How does a user refine a result (re-prompt, edit JSON, UI editor)?

### Takeaway
Every product supports all three, and the strongest ones put chat and the normal editor side by side over the same state: Grafana's Workspace canvas and panel-menu actions, Perspective's Chat tab inside the settings sidebar, Data Formulator's branching history.

### Cited Findings
- Grafana Assistant: select panels (Cmd/Ctrl-click for several) to give context; panel menu actions "Explain in Assistant", "Troubleshoot panel", "Analyze data", "Suggest improvements"; Dashboarding mode renders the dashboard "live beside the conversation"; plans can be adjusted before build - [Assistant dashboarding guide](https://grafana.com/docs/grafana-cloud/machine-learning/assistant/guides/dashboarding/)
- Grafana 13: "Customize with Assistant" on suggested dashboards, and Assistant-adjusted dashboard templates when metric names or data sources don't match (both public preview) - [What's new in v13.0](https://grafana.com/docs/grafana/latest/whatsnew/whats-new-in-v13-0/)
- Grafana dashboards expose a JSON model view for direct editing - [view dashboard JSON model](https://grafana.com/docs/grafana/v13.0/dashboards/build-dashboards/view-dashboard-json-model/) (snippet only)
- Perspective: Chat tab in the settings sidebar; `agentPrompt(text)` resolves after tool calls apply; `agentReset()`; tool activity fires `perspective-agent-tool` events; users can keep using the normal settings UI on the same config. Partial `restore()` updates individual properties - [PR 3209](https://github.com/perspective-dev/perspective/pull/3209), [save_restore.md](https://github.com/perspective-dev/perspective/blob/master/docs/md/how_to/javascript/save_restore.md)
- Perspective docs suggest copying `save()` output from the dev console as a quick way to author a config - [save_restore.md](https://github.com/perspective-dev/perspective/blob/master/docs/md/how_to/javascript/save_restore.md)
- Data Formulator 0.7: refine 30+ chart types with "a style-refinement agent"; branch from any point in a Data Thread - [data-formulator README](https://github.com/microsoft/data-formulator)
- LIDA: `edit`, `evaluate`, `repair`, `recommend` APIs over generated code - [LIDA README](https://github.com/microsoft/lida)
- AG Grid docs recommend including current grid state in the prompt and asking the LLM to return only changes - [AG Grid AI Toolkit](https://www.ag-grid.com/javascript-data-grid/ai-toolkit.md)
- Bloomberg ASKB: users "ask and refine questions in natural language" - [Markets Media](https://www.marketsmedia.com/bloomberg-introduces-agentic-ai-to-the-terminal/)

### Inferences
- "Plan then build" (Grafana dashboard plans) is a cheap checkpoint before an expensive multi-panel generation, applicable to Blueprint creation.

### Gaps
- None material.

## Q6. Does it embed in an existing app?

### Takeaway
Perspective and AG Grid are components you embed, with the AI surface embedded too (Perspective brings its own chat tab; AG Grid brings only the schema). Vega-Lite and Flint embed as libraries. Grafana dashboards embed via iframes or public dashboards, but the Assistant lives inside Grafana. interop.io and HERE are themselves the host shell.

### Cited Findings
- Perspective agent is "opt-in at runtime": the Chat tab stays hidden and "no network request is ever made until the host calls `agentConfig()`"; connects to any OpenAI-compatible endpoint (presets: `anthropic`, `gemini`, `openai`, `openrouter`, `lmstudio`, `ollama`) or an in-page engine such as WebLLM so "no prompt and no data leave the machine" - [agent.md](https://github.com/perspective-dev/perspective/blob/master/docs/md/how_to/javascript/agent.md), [PR 3209](https://github.com/perspective-dev/perspective/pull/3209)
- Perspective has a `<PerspectiveWorkspace>` React component (v4.1.0) and an `@perspective-dev/anywidget` for VS Code/Jupyter (v5.0.0) - [perspective releases](https://github.com/perspective-dev/perspective/releases)
- AG Grid toolkit "does not include any prompting logic"; the host writes `callLLM` and the system prompt - [AG Grid AI Toolkit](https://www.ag-grid.com/javascript-data-grid/ai-toolkit.md)
- Flint ships as an npm library with a React `FlintChart` component and an MCP server - [flint-chart README](https://github.com/microsoft/flint-chart)
- Grafana Assistant on-prem (public preview) is available to Enterprise and OSS users, who connect a Grafana Cloud account - [What's new in v13.0](https://grafana.com/docs/grafana/latest/whatsnew/whats-new-in-v13-0/)
- HERE lets organizations embed their own AI platform or UI in the browser's side panel in place of HERE's AI Center - [here.io AI page](https://www.here.io/here-browser/ai) (snippet only)
- interop.io MCP Apps render "inline in the chat or open as a standalone window beside the chat in an io.Connect workspace" - [io.Intelligence capabilities](https://docs-ai.interop.io/modules/mcp/capabilities)

### Inferences
- Perspective's in-component agent with host-supplied provider/proxy is the closest product analogue to a Hoist component that owns its own AI editing surface; it is also the clearest precedent that a component library can ship a working agent.

### Gaps
- Did not verify current Grafana embedding options (iframe, public dashboards, Scenes library) in this pass.

## Q7. What is the licence or hosting model?

### Takeaway
The formats are open: Grafana AGPL-3.0 (SDK and MCP server Apache-2.0), Vega-Lite BSD-3, Perspective Apache-2.0, Flint/Data Formulator/LIDA MIT. The AI features split: Grafana Assistant is a Grafana Cloud service (on-prem preview still needs a Cloud account), Perspective's agent is open source and bring-your-own-model, AG Grid's is in the Enterprise licence, and the finance desktops are commercial.

### Cited Findings
- Grafana: AGPL-3.0; latest release v13.3.1 (2026-11-10) - [grafana/grafana](https://github.com/grafana/grafana)
- Grafana Foundation SDK: Apache-2.0; "best suited for Grafana >= 12, but will work with Grafana >= 10" - [grafana-foundation-sdk](https://github.com/grafana/grafana-foundation-sdk)
- mcp-grafana: Apache-2.0 - [grafana/mcp-grafana](https://github.com/grafana/mcp-grafana)
- Grafana Assistant docs live under Grafana Cloud; on-prem use (public preview) requires connecting a Grafana Cloud account - [Assistant dashboarding guide](https://grafana.com/docs/grafana-cloud/machine-learning/assistant/guides/dashboarding/), [What's new in v13.0](https://grafana.com/docs/grafana/latest/whatsnew/whats-new-in-v13-0/)
- Vega-Lite: BSD-3-Clause - [vega/vega-lite](https://github.com/vega/vega-lite)
- Perspective: Apache-2.0, repo now `perspective-dev/perspective`, very active (v5.9.4 on 2026-11-20) - [perspective-dev/perspective](https://github.com/perspective-dev/perspective)
- Data Formulator: MIT; LIDA: MIT, last push 2024-08-08 (effectively dormant); Flint: MIT, repo created 2026-05-13 - [data-formulator](https://github.com/microsoft/data-formulator), [lida](https://github.com/microsoft/lida), [flint-chart](https://github.com/microsoft/flint-chart)
- AG Grid AI Toolkit: Enterprise feature, "included with our Enterprise licence at no extra cost" - [AG Grid AI Toolkit](https://www.ag-grid.com/javascript-data-grid/ai-toolkit.md), [AG Grid AI toolkit page](https://www.ag-grid.com/react-data-grid/ai-toolkit/) (snippet only for "no extra cost")
- interop.io page states only "Copyright © 2026 interop.io. All rights reserved."; commercial - [io.Intelligence capabilities](https://docs-ai.interop.io/modules/mcp/capabilities)
- Bloomberg ASKB is for "enabled users" on the Terminal and Bloomberg Professional app - [Markets Media](https://www.marketsmedia.com/bloomberg-introduces-agentic-ai-to-the-terminal/)

### Inferences
- For a self-hosted, privacy-sensitive client base, Perspective's model (open source, BYO model or in-page model, proxy recommended) is the most compatible; Grafana Assistant is not usable without Grafana Cloud.

### Gaps
- Grafana Assistant pricing not found. HERE and interop.io pricing not public.

## Q8. How does the format handle layout, variables/templating and cross-widget interaction?

### Takeaway
Grafana has the richest variables (9 typed kinds, section-scoped) and nested layout, but cross-panel interaction is via shared variables rather than widget outputs. Vega-Lite has the most rigorous interaction model (typed params and selections that filter or drive scales across composed views) but only within one chart spec. Perspective has the closest model to Blueprints' widget outputs: master panels whose row selection cross-filters others via global filters, plus derived tables. None of them lets one widget's output bind to an arbitrary input of another widget as Blueprints does.

### Cited Findings
**Grafana layout**
- Four layout kinds: `GridLayout` (manual x/y/width/height), `AutoGridLayout` (Grafana places panels; `maxColumnCount` default 3; `columnWidthMode` narrow/standard/wide/custom), `RowsLayout` (any layout nests inside a row), `TabsLayout` (each tab has its own nested layout) - [layout schema v12.4](https://grafana.com/docs/grafana/v12.4/as-code/observability-as-code/schema-v2/layout-schema/), [schema v2 search summary](https://grafana.com/docs/grafana/next/observability-as-code/schema-v2/) (snippet only for AutoGrid defaults)
- Grid layout items reference "a PanelKind from dashboard.spec.elements"; items may carry `repeat`; `conditionalRendering` exists on AutoGrid items, rows and tabs, not on GridLayout items - [layout schema v12.4](https://grafana.com/docs/grafana/v12.4/as-code/observability-as-code/schema-v2/layout-schema/)
- Rows and tabs nest up to three levels; each section can have its own section-level variables; show/hide rules show or hide panels, rows or tabs "based on variable values or query results" - [Dynamic dashboards GA](https://grafana.com/whats-new/2026-04-08-dynamic-dashboards-is-now-generally-available/)
- CUE defines `ConditionalRenderingGroupKind`, `ConditionalRenderingVariableKind`, `ConditionalRenderingDataKind`, `ConditionalRenderingTimeRangeSizeKind` - [dashboard_spec.cue](https://github.com/grafana/grafana/blob/main/apps/dashboard/kinds/v2/dashboard_spec.cue)

**Grafana variables**
- `VariableKind: QueryVariableKind | TextVariableKind | ConstantVariableKind | DatasourceVariableKind | IntervalVariableKind | CustomVariableKind | GroupByVariableKind | AdhocVariableKind | SwitchVariableKind` - [dashboard_spec.cue](https://github.com/grafana/grafana/blob/main/apps/dashboard/kinds/v2/dashboard_spec.cue) (the v12.4 docs list eight, without Switch - [schema v2 v12.4](https://grafana.com/docs/grafana/v12.4/observability-as-code/schema-v2/))
- Variables copied by the Assistant keep their data source and query, so dependent data source variables must come too - [Assistant dashboards overview](https://grafana.com/docs/grafana-cloud/machine-learning/assistant/dashboards) (snippet only)
- `cursorSync`: `Off`, `Crosshair`, `Tooltip` (shared hover across panels) - [schema v2 v12.4](https://grafana.com/docs/grafana/v12.4/observability-as-code/schema-v2/)
- Panels have `links: [...DataLink]` - [dashboard_spec.cue](https://github.com/grafana/grafana/blob/main/apps/dashboard/kinds/v2/dashboard_spec.cue)

**Vega-Lite**
- `params` are either variable params (`name`, `value`, or `expr` referencing other params) or selection params (`select: "point"` on click, `"interval"` on drag); `bind` attaches a param to an input widget (slider, select, radio) or to scales - [Vega-Lite params docs](https://vega.github.io/vega-lite/docs/parameter.html)
- Params act as predicates in conditions and filters (`{"filter": {"param": "brush"}}`); in concatenated views an interval selection in one view can filter another, or drive a scale domain (`"scale": {"domain": {"param": "brush", "encoding": "x"}}`) for overview+detail - [Vega-Lite params docs](https://vega.github.io/vega-lite/docs/parameter.html)
- Flint 1.0 added "interaction presets, semantic events, and an interaction API that connects charts to your app" - [flint-chart README](https://github.com/microsoft/flint-chart)

**Perspective**
- Layout is a tree of `split-layout` (`orientation`, `sizes` fractions, `children`) and leaf `tab-layout` (`tabs` of panel ids, `selected`); "Each panel may appear in the layout at most once. A panel the layout leaves out is removed" - [layout.md](https://github.com/perspective-dev/perspective/blob/master/docs/md/how_to/javascript/layout.md)
- `restoreWorkspace({layout, panels})` builds a whole dashboard; `panels` is a map keyed by id; a layout-only restore moves panels without re-creating or re-querying them - [layout.md](https://github.com/perspective-dev/perspective/blob/master/docs/md/how_to/javascript/layout.md)
- Workspace state includes `derived_tables`, `masters`, `global_filters` and `palette`; "`masters` are panels whose row selection cross-filters the others through `global_filters`" - [tools.rs](https://github.com/perspective-dev/perspective/blob/master/rust/perspective-viewer/src/rust/agent/tools.rs), [agent.md](https://github.com/perspective-dev/perspective/blob/master/docs/md/how_to/javascript/agent.md)
- Perspective has no variables/templating concept in the docs I read; the ViewerConfig fields (`group_by`, `split_by`, `filter`, `sort`, `expressions`, `columns`) are concrete values - [save_restore.md](https://github.com/perspective-dev/perspective/blob/master/docs/md/how_to/javascript/save_restore.md)

**Finance**
- io.Connect workspaces are JSON layouts of apps, arrangement and tabs; cross-app interaction is via interop/FDC3 context rather than the layout format - [Workspace Widget docs](https://docs-ai.interop.io/modules/mcp/mcp-apps/workspace-widget) (snippet only)
- HERE demo: an "FDC3-enabled" generated widget stayed in sync with its Supertab (single demo) - [HERE Studio blog](https://www.here.io/blog/product/the-ai-enterprise-browser-inside-here-studio)

### Inferences
- Mapping to Blueprints: Grafana `elements` + `ElementReference` ~ Blueprint flat element map + child references; Grafana typed `VariableKind`s ~ Blueprint typed variables; Vega-Lite selection params and Perspective `masters`/`global_filters` ~ Blueprint widget outputs bound to other widgets, but each is narrower (Vega-Lite within one chart; Perspective only row-selection-to-filter).
- Grafana's interaction model is variable-centric: panels communicate by writing to and reading from dashboard variables (ad hoc filters, data links that set variables). Blueprints' direct output-to-input binding is more expressive but gives the model more ways to create a broken graph, so it needs validator support for dangling or cyclic bindings. (Grafana data-link-to-variable behaviour: UNVERIFIED in this pass.)
- Perspective's rule that a layout must name every panel exactly once, and silently removes omitted panels, is a sharp edge for model-written layouts; its tool description warns the model explicitly ("naming EVERY panel exactly once").

### Gaps
- Did not verify Grafana's v2 `repeat` semantics or whether a panel can emit a value to a variable natively (vs via data links/plugins).
- No Vega-Lite-scale typed variable model found in Perspective.

## Q9. Genuine strengths (per product)

### Takeaway
Each product is strong on a different axis: Grafana on governance and data-validity checking, Vega-Lite on formal interaction semantics, Perspective on an embeddable agent over a validated config, Flint on LLM-reliable output, AG Grid on minimal-integration state control, interop.io/HERE on desktop-level composition and governance.

### Cited Findings
- Grafana: typed CUE schema, flat element map, nested layouts, 9 variable kinds, conditional rendering, Git Sync PRs, version history, MCP server with summary/JSONPath/patch tools to save context, and Assistant validation that panels return data - [dashboard_spec.cue](https://github.com/grafana/grafana/blob/main/apps/dashboard/kinds/v2/dashboard_spec.cue), [What's new v13.0](https://grafana.com/docs/grafana/latest/whatsnew/whats-new-in-v13-0/), [mcp-grafana](https://github.com/grafana/mcp-grafana), [Assistant guide](https://grafana.com/docs/grafana-cloud/machine-learning/assistant/guides/dashboarding/)
- Vega-Lite: versioned JSON Schemas, compact grammar, rigorous params/selections with widget binding and cross-view filtering, runtime-insertable named data, CSP-safe interpreter option - [params](https://vega.github.io/vega-lite/docs/parameter.html), [data](https://vega.github.io/vega-lite/docs/data.html), [vega-interpreter](https://github.com/vega/vega/tree/main/packages/vega-interpreter)
- Perspective: open-source in-component agent with entitlements, generated-schema tool params, docs-retrieval tool, host data notes, BYO/local model, validation API, master/detail cross-filtering, streaming-scale engine - [agent.md](https://github.com/perspective-dev/perspective/blob/master/docs/md/how_to/javascript/agent.md), [PR 3280](https://github.com/perspective-dev/perspective/pull/3280)
- Flint: short semantic specs compiled to five backends, MCP server, interaction presets - [flint-chart](https://github.com/microsoft/flint-chart)
- LIDA: modular generate/edit/explain/evaluate/repair pipeline with a measured error rate - [LIDA README](https://github.com/microsoft/lida)
- AG Grid: one call yields a JSON Schema of mutable grid state; `propertiesToIgnore` gives patch semantics - [AG Grid AI Toolkit](https://www.ag-grid.com/javascript-data-grid/ai-toolkit.md)
- interop.io: AI orchestration of multi-app desktop workspaces with mandatory user confirmation and in-chat layout preview - [io.Intelligence capabilities](https://docs-ai.interop.io/modules/mcp/capabilities)
- Bloomberg ASKB: answers backed by Bloomberg data with emitted BQL so analysis is reproducible outside chat - [Markets Media](https://www.marketsmedia.com/bloomberg-introduces-agentic-ai-to-the-terminal/)

### Inferences
- The Blueprint design can borrow: Grafana's plan-then-build and data-returning validation; Perspective's entitlement gating, schema-typed patch tools, and "data notes"; AG Grid's "return only changes" contract; Flint's lesson that a semantic, compact target beats a verbose one for LLM reliability.

### Gaps
- No independent evaluation compares these systems' LLM edit success rates.
