# Commercial BI AI: Hex, ThoughtSpot, Tableau (Pulse / Agent / Next), Power BI Copilot + Fabric data agents

All sources checked 2026-11-21. Vendor docs preferred throughout; the few press/third-party items are flagged. "UNVERIFIED" marks claims I could not confirm in a primary source this session.

## Q1. What does the model emit (code, chart spec, full dashboard definition, NL answer + chart)?

### Takeaway
Every vendor now has both a "chat answer" surface and a "build the artifact" surface. Hex emits code (SQL, Python, and for Generative apps JavaScript/React) into notebook cells and code-defined projects. ThoughtSpot emits its own search-token query (not SQL) that becomes a saved Answer, and SpotterViz builds whole Liveboards. Tableau Agent builds worksheet views and calculations (classic) and Tableau Next visualizations over Tableau Semantics; Pulse only narrates precomputed insights. Power BI Copilot generates report pages and visuals over a semantic model, plus DAX queries; Fabric data agents emit read-only SQL/DAX/KQL and return text/tables.

### Cited Findings
**Hex**
- Notebook Agent creates Python, SQL, Markdown, Pivot, Input parameter, Single value and Chart cells; edits @-mentioned cells; moves and deletes cells after checking downstream lineage; can arrange a published app's layout (rows, columns, tabs) and publish it - [Hex Notebook agent](https://learn.hex.tech/docs/explore-data/notebook-view/notebook-agent)
- Notebook Agent is "intended to be used by technical users who can audit the SQL and code that the agent suggests" - [Hex AI overview](https://learn.hex.tech/docs/getting-started/ai-overview)
- Threads agent "can generate and execute SQL, create visualizations, and search for semantic columns"; results render as tables, pivots and charts with an explanation of its logic - [Hex Threads](https://learn.hex.tech/docs/explore-data/threads)
- Generative apps are "code-generated apps" producing web-style interfaces rather than the fixed grid of Classic apps; the agent writes into a virtual file system and the app is written in JavaScript; each file write pushes the updated app live to the App tab; the agent can screenshot the app to check its own output - [Hex Generative apps docs](https://learn.hex.tech/docs/share-insights/apps/generative-apps); [Introducing Generative Data Apps (blog)](https://hex.tech/blog/introducing-generative-data-apps/); [changelog 2026-05-12](https://learn.hex.tech/changelog/2026-05-12)
- Hex 4.0 (public beta): "4.0 projects are defined entirely by code" in a file directory read and written by both the Hex agent and external agents - [What is Hex 4.0](https://learn.hex.tech/docs/hex-4-0/what-is-hex-4-0)
- Modeling Agent "generates and edits semantic models" - [Hex AI overview](https://learn.hex.tech/docs/getting-started/ai-overview)
- "Hex Magic" is older branding: the current AI overview lists Notebook Agent, Threads, Generative apps, Chat With App Agent, Modeling Agent and Context Studio, and does not name Magic as a separate feature - [Hex AI overview](https://learn.hex.tech/docs/getting-started/ai-overview); legacy page still exists at [What is Hex Magic](https://learn.hex.tech/docs/hex-magic/what-is-hex-magic) (not re-read)

**ThoughtSpot**
- Spotter is "built on top of the BI industry's leading relational search model"; Spotter Classic turns questions into ThoughtSpot search tokens, and tokens are shown with each answer - [Spotter overview](https://docs.thoughtspot.com/cloud/latest/spotter); token behaviour per [Spotter coaching docs](https://docs.thoughtspot.com/cloud/latest/spotter-coach-conversation) and earlier versions such as [10.15 Getting started](https://docs.thoughtspot.com/cloud/10.15.0.cl/spotter-getting-started) (summarised via search, not fully re-read)
- Spotter MCP default response returns per answer: title, search query, "TML tokens", an embeddable `iframe_url`, and an `answer_id` that can be saved to a dashboard; no result rows are returned - values are rendered inside the visualization; opt-in "full" response adds formulas, parameters, subqueries, chart type and data source ID - [Spotter MCP in custom apps](https://developers.thoughtspot.com/docs/custom-chatbot-integration-mcp)
- Spotter 3 is "built on a new agent platform", queries structured and unstructured data, cross-model search, external tools (Slack, Confluence, Jira) - [Spotter overview](https://docs.thoughtspot.com/cloud/latest/spotter)
- SpotterViz "can now autonomously create Liveboards based on your prompts, populating them with relevant visualizations and KPIs"; generates Answers grouped by theme, layout with tabs/groups, and AI "insight tiles" that rerun on each load; edits chart type, axes, colours, labels, conditional formatting in bulk - [SpotterViz](https://docs.thoughtspot.com/cloud/latest/spotter-viz)
- SpotterViz file upload (GA in 26.11.0.cl) builds a Liveboard from a Tableau workbook (.twb/.twbx), image or PDF - [26.11.0.cl release notes](https://docs.thoughtspot.com/cloud/latest/notes)

**Tableau**
- Tableau Agent (authoring, Desktop 2025.1+, Cloud, Server 2025.3+) can "Create visualizations", "Create and explain calculations", "Filter and sort data" - [Build Views and Explore Data with Tableau Agent](https://help.tableau.com/current/pro/desktop/en-us/desktop_einstein.htm)
- Tableau Agent in Pulse (formerly Enhanced Q&A / Discover) answers from pre-calculated insights; "this model doesn't analyze your data"; insight summaries are LLM summaries of statistically detected drivers, trends, contributors, outliers - [About Tableau Pulse](https://docs.salesforce.com/tableau/current/en-us/online/pulse_intro.md)
- Tableau Next: Concierge "provides immediate, reliable answers to your data questions in plain language" and can "instantly create a data visualization from the user's natural language request" (TC25, older, April-May 2025) - [Agentic analytics blog](https://www.tableau.com/blog/agentic-analytics-new-paradigm-for-business-intelligence); [TC25 top 10](https://www.tableau.com/en-gb/blog/top-10-announcements-keynote-tc25)
- Tableau Next agent capabilities are packaged as an "Analytics and Visualization" Agentforce template with Data Analysis and Semantic Model Curation topics - [Trailhead: Visualize data with Tableau Next](https://trailhead.salesforce.com/content/learn/modules/agentic-analytics-administration/visualize-data-with-tableau-next); [Enable Tableau Next AI Features](https://help.tableau.com/current/tableau-next/en-us/tableau_next_setup_guide_enable_tua_ai.htm)
- Tableau Next visualizations have a JSON definition via the Connect REST API "create visualization": body includes data source, visual fields, interactions, labels, view, and a visual spec of type Vizql, Table, Map, Flow or Radial - [Tableau Next Connect REST API](https://developer.salesforce.com/docs/analytics/tableau-next-rest-api/references/tableau-next-connect-api) (seen via search snippet; page not fully read)

**Power BI / Fabric**
- Copilot pane generates a report page from a prompt or "Suggest content for this report", then adds, changes (type or fields) or deletes visuals; undo/redo supported - [Create and edit reports with Copilot (ms.date 2026-07-06)](https://learn.microsoft.com/en-us/power-bi/create-reports/copilot-create-reports)
- Copilot also writes DAX queries, narrative summary visuals, measure descriptions, and (web modeling, preview) edits DAX measures, tables, columns, relationships - [Copilot for Power BI overview (ms.date 2026-08-24)](https://learn.microsoft.com/en-us/power-bi/create-reports/copilot-introduction)
- Fabric data agent: NL2SQL (lakehouse/warehouse), NL2DAX (semantic models), NL2KQL (KQL/Eventhouse), plus Microsoft Graph; returns "human-readable response, which might include structured data such as tables, summaries, or key insights"; capped at 25 rows x 25 columns - [Fabric data agent concept (ms.date 2026-05-11)](https://learn.microsoft.com/en-us/fabric/data-science/concept-data-agent)
- "Power BI Desktop for Apps (preview)": describe a custom Fabric app in chat, connect semantic models, preview and refine before publishing - [Copilot for Power BI overview](https://learn.microsoft.com/en-us/power-bi/create-reports/copilot-introduction)
- Power BI Agentic (the `powerbi-authoring` plugin for coding agents such as GitHub Copilot CLI, Claude Code, Cursor): skills to "Create, edit and validate Power BI reports in the PBIR ... format" and author semantic models, plus the Power BI Modeling/Authoring MCP server to inspect schemas, run DAX, edit models - [Power BI Agentic overview (ms.date 2026-06-04)](https://learn.microsoft.com/en-us/power-bi/developer/agentic/power-bi-agentic-overview)

### Inferences
- Two families: (a) query-generation over a semantic layer, result shown as a vendor chart (ThoughtSpot tokens, Fabric data agent DAX/SQL, Tableau Pulse/Concierge, Hex Threads); (b) artifact-generation that writes the vendor's own persisted definition (SpotterViz Liveboards, Power BI report pages, Hex cells/Generative apps, Tableau Next visualizations).
- ThoughtSpot is the only one whose generated query language is a constrained, human-readable token query rather than SQL/DAX; this is its core accuracy story.
- Hex Generative apps are the outlier: free-form generated JS/React code, i.e. the "generate code" end of the spectrum, versus everyone else's "fill a vendor schema" approach.

### Gaps
- Exact form of Tableau Agent's authoring output (does it place fields on shelves of a normal, editable worksheet?) - the help page does not say. UNVERIFIED.
- Whether Tableau Next's agent writes the same JSON visual spec exposed by the Connect REST API - not documented in what I could read. UNVERIFIED.
- Power BI Desktop for Apps output format (what code/definition it generates) - not read. UNVERIFIED.

## Q2. How is output validated and kept safe?

### Takeaway
All four ground the model in a governed semantic layer and run queries under the end user's identity, so permissions and row-level security apply. Curated "verified" examples are universal (ThoughtSpot reference questions/memory, Power BI verified answers, Tableau Q&A Calibration, Hex endorsements). Human review is explicit only for authoring flows: Hex's per-cell accept/undo, SpotterViz checkpoints, Power BI undo. Benchmarks/evals are a 2026 addition: ThoughtSpot Benchmark tab, Hex Evals.

### Cited Findings
**Hex**
- Threads "heavily prioritizes semantic models and endorsed data sources"; Governed mode limits the agent to Admin-chosen sources (endorsed only, semantic models only, custom policy); admins can force it on - [Hex Threads](https://learn.hex.tech/docs/explore-data/threads)
- Viewing a shared Thread requires "Can view results" on all its data connections; agent cites projects used and exposes tool calls and thinking text - [Hex Threads](https://learn.hex.tech/docs/explore-data/threads)
- Notebook Agent changes are per-cell: each touched cell must be confirmed or undone via a "Pending changes" modal; deletions require Accept/Deny - [Hex Notebook agent](https://learn.hex.tech/docs/explore-data/notebook-view/notebook-agent)
- Context Studio (Admins/Managers) monitors AI usage and manages workspace rules, semantic models and endorsements; "Hex's AI providers do not train on customer data" - [Hex AI overview](https://learn.hex.tech/docs/getting-started/ai-overview)
- Hex has an Evals feature under agent management - [Hex Evals](https://learn.hex.tech/docs/agent-management/evals) (seen in search only)
- Embedded RLS via user attributes passed to the Embed API and used in parameterised SQL - [Hex signed embedding](https://learn.hex.tech/docs/share-insights/embedding/signed-embedding)

**ThoughtSpot**
- Reference questions save a verified question-answer pair that guides (does not force) Spotter's reasoning; latest docs label them legacy memory and direct new definitions to be added from a conversation; business terms map to search tokens and reviewers approve/edit/reject them; data model instructions are "the strongest coaching tool" - [Reference questions (26.8)](https://docs.thoughtspot.com/cloud/26.8.0.cl/spotter-reference-questions); [Coaching within a conversation](https://docs.thoughtspot.com/cloud/latest/spotter-coach-conversation); [Training options](https://docs.thoughtspot.com/cloud/latest/spotter-training-options) (summarised via search)
- 26.11.0.cl adds GA: Spotter benchmark platform (latency/accuracy against expected text or SQL answers), Monitoring for Spotter (usage Liveboard, searchable exportable chat log), memory generated from Liveboards; Early Access AI Context generation on Model save - [26.11.0.cl release notes](https://docs.thoughtspot.com/cloud/latest/notes)
- Spotter MCP enforces existing RLS/CLS automatically; creating charts or Liveboards requires data download and content-creation privileges - [Spotter MCP in custom apps](https://developers.thoughtspot.com/docs/custom-chatbot-integration-mcp)
- SpotterViz inherits RLS/CLS, requires TML edit permission, and Spotter enabled on the underlying Models; no formal approval step - user reviews, re-prompts, and clicks Save; revert via "the past ten checkpoints" - [SpotterViz](https://docs.thoughtspot.com/cloud/latest/spotter-viz)
- Press release (vendor, 2026-11-18): via the Claude connector, answers use "certified metrics, joins, synonyms, business definitions, and row-level security" and return search tokens so users can check and re-run them - [ThoughtSpot / Claude press release](https://www.thoughtspot.com/press-releases/thoughtspot-deepens-integration-with-claude-to-advance-agentic-analytics-for-the-enterprise)

**Tableau**
- Pulse governance: analysts author metric definitions; definitions can be certified; edit/delete access restricted per user/group; data sources have a separate Create Metric Definitions permission; Pulse Q&A answers from statistical insights, not from the LLM analysing data - [About Tableau Pulse](https://docs.salesforce.com/tableau/current/en-us/online/pulse_intro.md)
- AI in Tableau Cloud runs through the Einstein Trust Layer (PII masking, zero data retention with LLM providers); Tableau Server does not use the Trust Layer and connects to the customer's own LLM provider - [Tableau Agent help](https://help.tableau.com/current/pro/desktop/en-us/desktop_einstein.htm); [AI in Tableau and Trust](https://help.tableau.com/current/tableau/en-us/tableau_gai_einstein_trust.htm)
- Pulse Q&A is "now powered by GPT-5.2"; geo-aware routing through Azure OpenAI - [About Tableau Pulse](https://docs.salesforce.com/tableau/current/en-us/online/pulse_intro.md)
- Tableau Next agent depends on the semantic model and notifies the user if the model "isn't properly configured for use with Tableau Agent"; Q&A Calibration (Beta) lets admins mark responses Verified (used as guided examples) or Inaccurate - [Trailhead: Visualize data with Tableau Next](https://trailhead.salesforce.com/content/learn/modules/agentic-analytics-administration/visualize-data-with-tableau-next)
- Concierge Testing Center for analysts to check answers (2025, older) - [Semantic data model blog, 2025-09-25](https://www.tableau.com/blog/your-semantic-data-model-secret-trusted-agentic-analytics) (via search snippet)

**Power BI / Fabric**
- "Prep data for AI" (preview): AI data schema, verified answers (bound to a visual plus trigger phrases), AI instructions, all saved on the semantic model; model can be marked "Approved for Copilot"; "How Copilot arrived at this" (HCAAT) explains answers - [Prepare your data for AI (ms.date 2026-05-26)](https://learn.microsoft.com/en-us/power-bi/create-reports/copilot-prepare-data-ai)
- Fabric data agent: runs with the requesting user's credentials, "strictly enforces read-only access", only generates read queries, RLS/CLS still apply, Purview DLP/access policies enforced; precedence model organisational > role > developer instructions > user prompt; query validated before execution - [Fabric data agent concept](https://learn.microsoft.com/en-us/fabric/data-science/concept-data-agent)
- For semantic-model sources, data agents do not take example query pairs; use verified answers in Prep for AI instead - [Fabric data agent concept](https://learn.microsoft.com/en-us/fabric/data-science/concept-data-agent); [Add data sources](https://learn.microsoft.com/en-us/fabric/data-science/data-agent-add-datasources)
- Copilot report creation requires the Q&A switch on the model, edit access to report/workspace or Build on the model - [Copilot overview](https://learn.microsoft.com/en-us/power-bi/create-reports/copilot-introduction); [Create reports with Copilot](https://learn.microsoft.com/en-us/power-bi/create-reports/copilot-create-reports)
- PBIR edits are validated against public JSON schemas; Power BI Desktop raises blocking errors (invalid schema, missing required props) or auto-fixes non-blocking ones - [PBIR report folder (ms.date 2026-09-23)](https://learn.microsoft.com/en-us/power-bi/developer/projects/projects-report)

### Inferences
- Validation is overwhelmingly "constrain the input space" (semantic model, endorsed sources, read-only, user identity) rather than "check the output"; schema validation of a generated definition exists only where the definition is a file (PBIR schemas, TML import validation).
- "Verified answer" mechanics converge: a curated question -> known-good artifact mapping that biases but does not force the model.

### Gaps
- None of the vendors publish accuracy figures in docs I read; ThoughtSpot and Hex only expose benchmarking/eval tooling.

## Q3. Is the output persistent and editable, or one-off?

### Takeaway
All four make AI output first-class, human-editable artifacts. Hex Threads are backed by a real project; Spotter answers save to Liveboards and SpotterViz writes "standard ThoughtSpot Liveboards"; Power BI Copilot pages are ordinary report pages. Pulse and Fabric data agent answers are the most ephemeral: data agent chat history "might not always persist".

### Cited Findings
- Hex: each Thread is backed by an unlisted project; "Save as project" exposes the same project (no copy); editors can edit the underlying Notebook; selecting a cell reference jumps to that cell; sharing roles Full/Can edit/Can view/Can view app - [Hex Threads](https://learn.hex.tech/docs/explore-data/threads)
- Hex Generative apps open in a code editor inside Hex for manual edits (July 2026) - [changelog 2026-07-21](https://learn.hex.tech/changelog/2026-07-21) (via search snippet); Notebook Agent chat requests persist 30 days - [Notebook agent](https://learn.hex.tech/docs/explore-data/notebook-view/notebook-agent)
- ThoughtSpot: saved SpotterViz output is "standard ThoughtSpot Liveboards" that can be shared, scheduled, exported, embedded - [SpotterViz](https://docs.thoughtspot.com/cloud/latest/spotter-viz); MCP answers carry an `answer_id` savable to a dashboard and Liveboards can be created programmatically from a session - [Spotter MCP in custom apps](https://developers.thoughtspot.com/docs/custom-chatbot-integration-mcp)
- ThoughtSpot "Send To ThoughtSpot": "artifacts built in Claude Data become ThoughtSpot Liveboards in a single action"; mechanism (TML or otherwise) not stated - [press release 2026-11-18](https://www.thoughtspot.com/press-releases/thoughtspot-deepens-integration-with-claude-to-advance-agentic-analytics-for-the-enterprise)
- Spotter 3 scheduling (GA 26.11): "Send me updates on this answer every Monday" via email/Slack - [26.11.0.cl notes](https://docs.thoughtspot.com/cloud/latest/notes)
- Power BI: save a Copilot-generated report like any other; it reopens in Reading view, Edit restores the Copilot pane - [Create reports with Copilot](https://learn.microsoft.com/en-us/power-bi/create-reports/copilot-create-reports)
- Power BI verified answers, AI instructions and schema persist on the semantic model (LSDL) - [Prep data for AI](https://learn.microsoft.com/en-us/power-bi/create-reports/copilot-prepare-data-ai)
- Fabric data agent: "Conversation history ... might not always persist"; agent config itself is versioned with Git integration and deployment pipelines - [Fabric data agent concept](https://learn.microsoft.com/en-us/fabric/data-science/concept-data-agent)
- Tableau Next: assets (semantic models, metrics, vizzes, dashboards) live in workspaces; vizzes built with Visualization Builder, dashboards with Dashboard Builder - [Tableau Next overview](https://docs.salesforce.com/tableau/current/en-us/tableau-next/tableau_next_overview.md)
- Tableau Pulse: persistent object is the analyst-authored metric definition/metric; AI-generated insight summaries are regenerated, not authored - [About Tableau Pulse](https://docs.salesforce.com/tableau/current/en-us/online/pulse_intro.md)

### Inferences
- The convergent pattern: the chat transcript is disposable; the thing worth keeping is materialised into the vendor's existing editable artifact, then edited with normal tools.

### Gaps
- Whether a Tableau Next agent-generated viz is auto-saved or must be saved explicitly - not documented in sources reached. UNVERIFIED.
- Whether Tableau Agent (authoring) output is a normal editable worksheet - likely but UNVERIFIED.

## Q4. How does it bind to live data, and what semantic layer?

### Takeaway
Each binds to its own semantic layer and queries the warehouse live: Hex semantic models (native YAML, or synced from dbt MetricFlow, Cube, Snowflake Semantic Views); ThoughtSpot Models (TML), with Snowflake Semantic View sync in early access; Tableau Semantics over Salesforce Data 360 for Next, and published data sources / metric definitions for Pulse and classic; Power BI semantic models (TMDL) via XMLA/DAX, with Import, DirectQuery and Direct Lake.

### Cited Findings
- Hex semantic models: authored in Modeling Workbench, YAML spec, sync/convert from dbt MetricFlow, Cube, Snowflake Semantic Views and Apache Ossie; LookML not mentioned - [Intro to semantic models](https://learn.hex.tech/docs/connect-to-data/semantic-models/intro-to-semantic-models)
- Hex semantic project sync with GitHub YAML is one-way (GitHub into Hex) - [Modeling Workbench](https://learn.hex.tech/docs/connect-to-data/semantic-models/semantic-authoring/semantic-authoring-overview) (via search snippet)
- Hex agents use any data connection or semantic model the user can access; Threads can query multiple connections in one conversation - [Notebook agent](https://learn.hex.tech/docs/explore-data/notebook-view/notebook-agent); [Threads](https://learn.hex.tech/docs/explore-data/threads)
- ThoughtSpot: Spotter needs a Model (`worksheetId`) for Classic/Spotter 2; Spotter 3 can use a model ID or `auto_mode` (off by default on Embedded) - [Embed Spotter](https://developers.thoughtspot.com/docs/embed-spotter)
- ThoughtSpot TML covers Models, Views, SQL Views, Tables, Answers, Liveboards, Monitor alerts - [TML (developers)](https://developers.thoughtspot.com/docs/tml)
- ThoughtSpot Snowflake Semantic View integration (Early Access, 26.11) - [26.11.0.cl notes](https://docs.thoughtspot.com/cloud/latest/notes)
- SpotterViz Liveboards "use live data connections and query the warehouse in real time" - [SpotterViz](https://docs.thoughtspot.com/cloud/latest/spotter-viz)
- Tableau Next: data "is always a Data 360 object: a DMO, DLO, CIO, or CSV stored as a DLO"; semantic models = data model + business definitions; "Tableau Semantics ... also controls the queries necessary for analytics" - [Tableau Next overview](https://docs.salesforce.com/tableau/current/en-us/tableau-next/tableau_next_overview.md)
- Tableau Agent (classic authoring) needs a worksheet connected to a data source; extracts recommended; live connections work; cubes unsupported - [Tableau Agent help](https://help.tableau.com/current/pro/desktop/en-us/desktop_einstein.htm)
- Fabric data agent: NL2DAX uses the model's metadata (descriptions, synonyms, measures, relationships), validates, executes via XMLA endpoint; up to five sources (lakehouse, warehouse, semantic model, KQL, ontology, Graph); only Read permission on the model needed - [Fabric data agent concept](https://learn.microsoft.com/en-us/fabric/data-science/concept-data-agent); [Add data sources](https://learn.microsoft.com/en-us/fabric/data-science/data-agent-add-datasources)
- Power BI Copilot cannot create pages over real-time streaming models, live connections to Analysis Services, or models with implicit measures disabled - [Create reports with Copilot](https://learn.microsoft.com/en-us/power-bi/create-reports/copilot-create-reports)
- PBIR `definition.pbir` references the semantic model `byPath` (local TMDL folder) or `byConnection` (Fabric workspace) - [PBIR report folder](https://learn.microsoft.com/en-us/power-bi/developer/projects/projects-report)

### Inferences
- Hex is the only one that federates other vendors' semantic layers (dbt, Cube, Snowflake) as a first-class input; ThoughtSpot is starting to (Snowflake Semantic Views). Tableau Next and Power BI keep the semantic layer proprietary.

### Gaps
- Tableau Semantics file/API format (is a semantic model a declarative document?) - not found. UNVERIFIED.

## Q5. How does a user refine a result?

### Takeaway
Follow-up prompts everywhere. Beyond that: Hex lets you drop into the notebook and edit the SQL/Python directly; ThoughtSpot exposes the search tokens for inspection and editing, plus Liveboard edit mode; Power BI lets you add/change/delete visuals by prompt and then edit normally; Tableau Pulse offers filter/explore controls.

### Cited Findings
- Hex Threads: follow-up questions; explore from charts and cells; Can-edit users edit the underlying notebook - [Hex Threads](https://learn.hex.tech/docs/explore-data/threads); Notebook Agent edits @-mentioned cells, "Fix with agent"/"Quick fix" - [Notebook agent](https://learn.hex.tech/docs/explore-data/notebook-view/notebook-agent); Generative apps: prompt for broad style changes, quick edits or chart controls for small ones, inspect logic behind any element - [Hex 4.0](https://learn.hex.tech/docs/hex-4-0/what-is-hex-4-0)
- ThoughtSpot: Spotter Agent suggests follow-ups and explains calculated fields; Spotter 3 Liveboard side panel reads all tabs, charts and filters so users ask without restating context - [Spotter overview](https://docs.thoughtspot.com/cloud/latest/spotter); tokens let users "check, question, and re-run" - [press release](https://www.thoughtspot.com/press-releases/thoughtspot-deepens-integration-with-claude-to-advance-agentic-analytics-for-the-enterprise); SpotterViz: re-prompt, edit visuals, revert checkpoints - [SpotterViz](https://docs.thoughtspot.com/cloud/latest/spotter-viz)
- Power BI: prompt to add, change (type/fields) or delete visuals; undo/redo; Copilot does not support styling or formatting changes or custom visuals - [Create reports with Copilot](https://learn.microsoft.com/en-us/power-bi/create-reports/copilot-create-reports)
- Fabric data agent: follow-ups inherit the 25-row-capped context; Microsoft recommends a new chat in such cases - [Fabric data agent concept](https://learn.microsoft.com/en-us/fabric/data-science/concept-data-agent)
- Tableau Pulse embed exposes filters (`<pulse-filter>`, `applyFilterAsync`, `applyTimeDimensionAsync`) - [Embed Tableau Pulse](https://help.tableau.com/current/api/embedding_api/en-us/docs/embedding_api_pulse.html) (via search snippet)

### Inferences
- The products split on the "edit the generated query" axis: Hex (raw SQL/Python) and ThoughtSpot (tokens) expose it; Power BI and Tableau hide the query behind the visual and refine by prompt or normal authoring UI.

### Gaps
- Whether Tableau Next agent results can be opened directly in Visualization Builder for manual edits. UNVERIFIED.

## Q6. Does it embed in an existing app?

### Takeaway
ThoughtSpot is strongest: a Visual Embed SDK (JS + React) with a `SpotterEmbed` component, plus a hosted MCP server for headless agent use. Hex embeds via presigned iframe URLs (Enterprise add-on), now including Generative apps. Tableau embeds Pulse via a `<tableau-pulse>` web component and Next via the Analytics Embedding SDK. Power BI supports Copilot in secure (Entra) embeds; app-owns-data support is unclear.

### Cited Findings
- ThoughtSpot `SpotterEmbed` (Visual Embed SDK): cookieless auth needs SDK 1.45.0+ / 26.2.0.cl+; token expiry at least 10 min; events and `HostEvent.ResetSpotterConversation` - [Embed Spotter](https://developers.thoughtspot.com/docs/embed-spotter); React import from `@thoughtspot/visual-embed-sdk/react` appears in tutorials - [Spotter embed tutorial](https://developers.thoughtspot.com/docs/tutorials/spottercode-embed/embed-spotter) (via search)
- `SpotterAgentEmbed` (headless chat, no ThoughtSpot UI) is slated for deprecation; ThoughtSpot recommends the Spotter MCP Server for custom UIs - [SpotterAgentEmbed class](https://developers.thoughtspot.com/docs/Class_SpotterAgentEmbed) (via search snippet)
- New Spotter experience in embeds is opt-in via `spotterExperienceVersion: SPOTTER_2026_11`; SDK v1.54.0+ recommended - [developers what's new](https://developers.thoughtspot.com/docs/whats-new) (via search summary; not fully read)
- Spotter MCP: renders answers as iframes via `startAutoMCPFrameRenderer`; endpoints `agent.thoughtspot.app/mcp` (OAuth) and `/token/mcp` (bearer); min 10.11.0.cl - [Spotter MCP in custom apps](https://developers.thoughtspot.com/docs/custom-chatbot-integration-mcp)
- Hex: Embed API `createPresignedUrl` server-side, single-use URLs, user attributes for RLS, 20 req/min multi-tenant; "available with the Embedded Analytics add-on for customers on the Enterprise plan" - [Hex signed embedding](https://learn.hex.tech/docs/share-insights/embedding/signed-embedding); Generative apps embeddable with pass-through auth and RLS, styleable from pasted CSS or a screenshot (2026-05-21) - [Hex changelog 2026-05-21](https://learn.hex.tech/changelog/2026-05-21)
- Hex MCP server lets ChatGPT, Claude, Codex start Threads and (4.0 beta) create, edit and publish projects; CLI for Threads - [Hex Threads](https://learn.hex.tech/docs/explore-data/threads); [Hex 4.0](https://learn.hex.tech/docs/hex-4-0/what-is-hex-4-0)
- Tableau Pulse: `<tableau-pulse>` web component or `new TableauPulse()`, connected-app JWT with `tableau:insights:embed`, Embedding API 3.8+ - [Embed Tableau Pulse](https://help.tableau.com/current/api/embedding_api/en-us/docs/embedding_api_pulse.html) (via search snippet); Pulse Lightning Web Component - [Configure a Pulse LWC](https://help.tableau.com/current/online/en-us/lwc_tableau_pulse.htm) (title only)
- Tableau Next: Analytics Embedding SDK web components (`AnalyticsVisualization`, `AnalyticsDashboard`), users must exist in the Salesforce org - [Add a Tableau Next component to your web app](https://developer.salesforce.com/docs/analytics/sdk/guide/sdk-integration-initialize-embed.html); hosted Tableau Next MCP server is read-only (list/get dashboards, visualizations, semantic models, metrics) - [Tableau Next hosted MCP](https://developer.salesforce.com/docs/platform/hosted-mcp-servers/references/reference/tableau-next.html) (via search snippet); Tableau Next MCP Authoring was "coming soon in Beta" on the August 2026 features page - [Tableau August 2026 features](https://www.tableau.com/2026-2-august-features) (via search snippet)
- Power BI: "Enable Copilot" checkbox for secure portal/website embeds; needs Copilot tenant switch and Premium/paid Fabric capacity - [Embed a report in a secure portal](https://learn.microsoft.com/en-us/power-bi/collaborate-share/service-embed-secure) (via search snippet); Copilot prompt limit applies to "Power BI Embedded" - [Copilot overview](https://learn.microsoft.com/en-us/power-bi/create-reports/copilot-introduction); Copilot narrative visual embed needs `MLModel.Execute.All` - [Narrative visual embed](https://learn.microsoft.com/power-bi/create-reports/copilot-narrative-visual-embed-power-bi) (via search)
- Fabric data agents are consumable from Microsoft 365 Copilot, Copilot Studio, Azure AI Foundry, Teams and external orchestrators - [Fabric data agent concept](https://learn.microsoft.com/en-us/fabric/data-science/concept-data-agent)

### Inferences
- The industry direction for "agent in your own app" is MCP + vendor-rendered iframes (ThoughtSpot deprecating its headless SDK in favour of MCP; Hex MCP; Tableau Next MCP read-only today). The rendered chart remains the vendor's; the host app owns the conversation.

### Gaps
- Power BI Copilot in app-owns-data ("embed for your customers") and A-SKU Embedded capacity: only community/Q&A posts (one AI-generated) say unsupported. UNVERIFIED.
- Whether Hex Threads themselves can be embedded - docs silent.

## Q7. Licence / hosting model

### Takeaway
All SaaS-first. Tableau Server and Power BI Desktop are the on-prem/desktop exceptions; Tableau Server needs a customer LLM. AI is bundled into upper tiers rather than sold as metered tokens, except Power BI, where Copilot consumes Fabric capacity units.

### Cited Findings
- Hex: Community free (agent trial), Professional $36/Editor/mo, Team $75/Editor/mo, Enterprise custom; monthly per-seat AI credit grants that don't roll over; BYOK (OpenAI/Anthropic) and embedded add-on Enterprise only - [Hex pricing](https://hex.tech/pricing/); Threads on all plans, Explorer role or higher - [Hex Threads](https://learn.hex.tech/docs/explore-data/threads)
- ThoughtSpot Analytics: from $25/user/mo (no Spotter listed), $50/user/mo incl. "Spotter AI Agents (25 queries/month per user)", usage-based from $0.10/credit with unlimited LLM tokens, Enterprise custom; Embedded: Developer free 1 yr, Enterprise flexible incl. Spotter; "ThoughtSpot does not meter or charge for LLM tokens" - [ThoughtSpot pricing](https://www.thoughtspot.com/pricing) (page text flattened; tier mapping not fully certain)
- Docs: Spotter included with new per-user and consumption plans; add-on for ThoughtSpot Embedded and legacy row-based/unlimited plans - [Spotter overview](https://docs.thoughtspot.com/cloud/latest/spotter) - conflicts partly with the pricing page, which lists Spotter in Embedded Enterprise; SpotterViz included at no extra charge wherever Spotter is - [SpotterViz](https://docs.thoughtspot.com/cloud/latest/spotter-viz)
- SpotterViz uses the LLM configured at the customer's LLM gateway and "works best with Claude Opus 4.8" - [SpotterViz](https://docs.thoughtspot.com/cloud/latest/spotter-viz)
- Tableau Agent (classic): Tableau Cloud+ or Tableau+; AI usage unmetered on Cloud; Server 2025.3+ bills tokens under customer's LLM agreement - [Tableau Agent help](https://help.tableau.com/current/pro/desktop/en-us/desktop_einstein.htm); Pulse forecasts and some features need Tableau+; 60-day Try AI trial - [About Tableau Pulse](https://docs.salesforce.com/tableau/current/en-us/online/pulse_intro.md)
- Tableau Next: from $40/user/mo billed annually; Standard Creator and Consumer licences; bundled in Salesforce Core/Advanced/Max editions; usage metering conflicting (Salesforce FAQ says Data Services/Flex credits may still apply; Tableau blog says unmetered) - [Tableau pricing](https://www.tableau.com/pricing); [Tableau Next pricing](https://www.salesforce.com/analytics/pricing/tableau-next/); [Agentic analytics pricing blog](https://www.tableau.com/blog/tableau-agentic-analytics-pricing-updates) (all via search summary)
- Power BI Copilot: paid Fabric F2+ or Premium P1+; Pro/PPU alone insufficient; no trial capacities or sovereign clouds; billed by token consumption as Fabric CUs; Fabric Copilot Capacity option - [Copilot overview](https://learn.microsoft.com/en-us/power-bi/create-reports/copilot-introduction)
- Standalone Copilot and app-scoped Copilot in Power BI are retiring; report-scoped Copilot pane (GA) unaffected - [Copilot overview](https://learn.microsoft.com/en-us/power-bi/create-reports/copilot-introduction); [retirement announcement](https://aka.ms/PBINov26) (not opened)
- Fabric data agent GA; F2+ or P1+ with Fabric enabled; LLM not changeable - [Fabric data agent concept](https://learn.microsoft.com/en-us/fabric/data-science/concept-data-agent); an older Learn page variant said public preview - conflict noted by search results, concept page (ms.date 2026-05-11) says GA

### Inferences
- For an XH-style client (hedge funds, often on-prem or private cloud), only Tableau Server and Power BI Desktop + PBIR tooling run outside the vendor's SaaS; all the agentic features in this survey are SaaS-only.

### Gaps
- Exact Hex credit amounts per tier and which plans include semantic models/Governed mode - pricing page does not state.

## Q8. Is the dashboard/report definition a declarative file an LLM could edit?

### Takeaway
Yes for Power BI (PBIR JSON with public JSON schemas, GA and default format since ~Sept 2026, plus TMDL for models) and ThoughtSpot (TML YAML for Answers, Liveboards and Models, with import/export/validate REST endpoints). Hex is now code-defined (`.hex.yaml` export; Hex 4.0 file directory edited by external agents via MCP). Tableau Next exposes JSON visualization definitions through REST; classic Tableau workbooks are XML. Microsoft explicitly ships an LLM skill set for editing PBIR, the clearest vendor endorsement of the "agent edits a JSON document" approach.

### Cited Findings
- PBIR: "a publicly documented format that supports modifications from non-Power BI applications. Each file has a public JSON schema"; one file per page (`page.json`), visual (`visual.json`: position, formatting, query), bookmark; "PBIR is generally available and is the default report format"; legacy reports auto-convert on save; Desktop detects external edits ("Apply external changes"); Fabric Git integration and REST APIs export PBIR; limits 1,000 pages, 1,000 visuals/page - [PBIR report folder (ms.date 2026-09-23)](https://learn.microsoft.com/en-us/power-bi/developer/projects/projects-report)
- Gotcha: PBIR files can contain literal data values (e.g. filter value 'Contoso', slicer selections) - [PBIR report folder](https://learn.microsoft.com/en-us/power-bi/developer/projects/projects-report)
- Microsoft's `powerbi-report-cli` skill: "Create, edit and validate Power BI reports in the PBIR ... format", produce a design brief, build a report from an existing semantic model; `semantic-model-authoring` skill for models; Desktop Bridge lets agents reload models and capture screenshots for visual verification - [Power BI Agentic overview](https://learn.microsoft.com/en-us/power-bi/developer/agentic/power-bi-agentic-overview); skills at [microsoft/skills-for-fabric](https://github.com/microsoft/skills-for-fabric)
- TML: "a scriptable format ... for exporting, modifying, and migrating metadata objects"; YAML; REST Import/Export/Validate endpoints; Git integration exists - [TML (developers)](https://developers.thoughtspot.com/docs/tml)
- Liveboard TML: `liveboard` with `visualizations` (each with an `answer` block), `filters`, `layout.tabs[].tiles` (x/y/height/width or size), `parameter_overrides`, `views`; download, modify, upload supported; no TML for R/Python vizzes - [Liveboard TML](https://docs.thoughtspot.com/cloud/latest/tml-liveboards)
- Answer TML: `search_query` ("fully disambiguated search query" string), `tables`, `answer_columns`, `table`, `chart` (type, chart_columns, axis_configs, color), `display_mode` (CHART_MODE/TABLE_MODE) - [Answer TML](https://docs.thoughtspot.com/cloud/latest/tml-answers)
- 26.11 TML additions: `enable_personalized_view_upsert` on import, `author` block - [26.11.0.cl notes](https://docs.thoughtspot.com/cloud/latest/notes)
- SpotterViz doc lists TML edit permission as a prerequisite but does not say it generates TML - [SpotterViz](https://docs.thoughtspot.com/cloud/latest/spotter-viz)
- Hex: projects export to YAML recording cell logic and app layout; Git export on Team/Enterprise creates merge commits on publish; `ExportProject` API returns `.hex.yaml`; Generative app code exportable/importable as YAML - [Hex Git export](https://learn.hex.tech/docs/explore-data/projects/git-export); [Import and export](https://learn.hex.tech/docs/explore-data/projects/import-export); [API reference](https://learn.hex.tech/docs/api-integrations/api/reference) (via search summary)
- Hex 4.0: projects "defined entirely by code"; Claude, Codex, Cursor can create, edit and publish via the Hex MCP server (beta; CLI coming) - [What is Hex 4.0](https://learn.hex.tech/docs/hex-4-0/what-is-hex-4-0)
- Hex semantic models have a YAML spec - [Intro to semantic models](https://learn.hex.tech/docs/connect-to-data/semantic-models/intro-to-semantic-models)
- Tableau Next: Connect REST API create/update/get visualization with JSON body (fields, interactions, view, visual spec type Vizql/Table/Map/Flow/Radial); "API-first analytics platform" - [Connect REST API](https://developer.salesforce.com/docs/analytics/tableau-next-rest-api/references/tableau-next-connect-api) (via search snippet); [Tableau Next overview](https://docs.salesforce.com/tableau/current/en-us/tableau-next/tableau_next_overview.md)
- Classic Tableau workbooks (.twb) are XML - UNVERIFIED this session (general knowledge); indirectly, ThoughtSpot SpotterViz ingests .twb/.twbx to rebuild them as Liveboards - [26.11.0.cl notes](https://docs.thoughtspot.com/cloud/latest/notes)

### Inferences
- PBIR is the closest commercial analogue to a JSON-document blueprint: per-object JSON files, public versioned schemas, a validator in the host app, and an official LLM skill pack. Note the Copilot pane in-product does not appear to expose PBIR; the PBIR path is the coding-agent path.
- TML is the closest analogue that embeds a semantic query (`search_query` tokens) directly in the viz definition, so a generated definition is grounded by construction; layout and query live in one document.
- Hex went furthest toward "the artifact is code": Generative apps are JS, projects are files, and external agents write them.
- None publish their in-product agent's intermediate representation; the declarative file is what users and external agents edit, while the in-product agent's internal format is undocumented.

### Gaps
- Whether ThoughtSpot "Send To ThoughtSpot" and SpotterViz use TML internally - not stated. UNVERIFIED.
- Public JSON schema for Tableau Next visual specs - not found.

## Genuine strengths per product

### Takeaway
Hex: code transparency and openness (raw SQL/Python, YAML/Git, federated semantic layers, external agents via MCP). ThoughtSpot: grounded-by-construction token queries, autonomous Liveboard building, and the richest embedding and MCP developer surface. Tableau: the trust and governance stack (Trust Layer, certified Pulse metrics, statistics-not-LLM insights) and Salesforce workflow integration. Power BI: an open, schema-validated report format with first-party LLM tooling, plus enterprise governance (Purview, RLS, read-only agents) across M365.

### Cited Findings
- Hex: agent output is auditable code, with per-cell accept/undo - [Notebook agent](https://learn.hex.tech/docs/explore-data/notebook-view/notebook-agent); dbt/Cube/Snowflake semantic sync - [Semantic models](https://learn.hex.tech/docs/connect-to-data/semantic-models/intro-to-semantic-models); Threads backed by real, editable projects - [Threads](https://learn.hex.tech/docs/explore-data/threads)
- ThoughtSpot: tokens shown with every answer, RLS/CLS inherited, benchmark tab, SpotterViz full-Liveboard generation with checkpoints, SDK + MCP + React embedding - [Spotter MCP](https://developers.thoughtspot.com/docs/custom-chatbot-integration-mcp); [SpotterViz](https://docs.thoughtspot.com/cloud/latest/spotter-viz); [26.11 notes](https://docs.thoughtspot.com/cloud/latest/notes); [Embed Spotter](https://developers.thoughtspot.com/docs/embed-spotter)
- Tableau: Pulse Q&A grounded in precomputed statistical insights ("this model doesn't analyze your data"), certified metric definitions, Einstein Trust Layer PII masking and zero retention, on-prem Server option with BYO LLM - [Pulse](https://docs.salesforce.com/tableau/current/en-us/online/pulse_intro.md); [Tableau Agent](https://help.tableau.com/current/pro/desktop/en-us/desktop_einstein.htm)
- Power BI: PBIR public schemas + Desktop validation + agent skills - [PBIR](https://learn.microsoft.com/en-us/power-bi/developer/projects/projects-report); [Power BI Agentic](https://learn.microsoft.com/en-us/power-bi/developer/agentic/power-bi-agentic-overview); data agent governance precedence model, Purview, Git/deployment pipelines for agent config - [Fabric data agent](https://learn.microsoft.com/en-us/fabric/data-science/concept-data-agent)

### Inferences
- Tableau's agentic story is split across three products (classic Tableau Agent, Pulse, Next) with differing data foundations; it is the least coherent for an outside integrator, and Next ties you to Salesforce Data 360.
- Power BI's in-product Copilot report editing is the most limited (no styling, no custom visuals), but its file-format openness is the strongest.

### Gaps
- No independent accuracy benchmarks across these products were found; all capability claims are vendor-stated.
- ThoughtSpot release timing conflict: one search summary said 26.11.0.cl GA is November 24; the fetched release notes page says 26.11.0.cl is "now available" and 26.12.0.cl GA is November 24 - [26.11.0.cl notes](https://docs.thoughtspot.com/cloud/latest/notes).
