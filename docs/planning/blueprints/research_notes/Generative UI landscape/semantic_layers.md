# Semantic layers and their AI features (Cube, dbt Semantic Layer / MetricFlow / OSI, Malloy, others)

All sources checked 2026-11-21 unless marked otherwise. "Snippet" means the claim comes from a search-result summary of the cited page, not a full fetch of it. UNVERIFIED means I could not confirm it from a primary source this session.

Comparison target: an LLM that emits a JSON dashboard document bound to a Data Catalog (datasets, keys, field kinds such as pnl / fraction / ticker that set default format, aggregator and renderer), with in-browser aggregation and joins.

## Q1. What does the model emit?

### Takeaway
Every serious semantic layer restricts the LLM to a constrained query against named measures and dimensions. The layer, not the model, then compiles the SQL. Cube emits a JSON REST query (AI API) or "Semantic SQL" plus a Vega-Lite spec (agent Chat API). dbt emits a `query_metrics` call (metrics + group_by + where). Malloy emits Malloy query text. Snowflake, Databricks and Looker emit SQL or LookML-backed queries. Only Cube's agent emits a chart spec, and only Cube's commercial platform (and Databricks AI/BI) persist agent-built dashboards.

### Cited Findings
**Cube**
- AI API: "you can send the AI API a message (or conversation of messages) and it will return a Cube REST API query. Optionally, it will also run the query and return the results." Endpoint `/cubejs-api/v1/ai/query/completions`, with `"runQuery": true` to execute inline. If the model lacks the needed fields, the response has an explanatory message and no `cube_query` - [Cube AI API docs](https://cube.dev/docs/product/apis-integrations/ai-api) (snippet; the URL now 308-redirects to docs.cube.dev and the page could not be fetched directly); [Cube blog: practical guide to the AI API](https://cube.dev/blog/a-practical-guide-to-getting-started-with-cubes-ai-api) (snippet)
- The Cube REST query format is a JSON object with `measures`, `dimensions`, `segments`, `filters` (`member` / `operator` / `values`), `timeDimensions`, plus `ungrouped`, `joinHints` and `timezone`. Members are named `cube_name.member_name` - [Cube REST query format](https://docs.cube.dev/reference/core-data-apis/rest-api/query-format) (snippet)
- Chat API (agent): the NDJSON stream exposes tool calls. `cubeSqlApi` returns `sqlQuery`, `schema`, `data` (capped at 100 rows), `totalRows`, `truncated` and `vegaSpec`, "a Vega-Lite v5 chart spec that contains no data", so rows come from `result.data`. `cubeMeta` returns cube and member metadata. The stream carries SQL, not REST query JSON - [Cube Chat API](https://docs.cube.dev/reference/embed-apis/chat-api)
- D3 agents "use Semantic SQL to query semantic definitions directly and create ad-hoc calculations on the fly", and ad-hoc calculations "can be saved and reused across workbooks and, when needed, added to the shared semantic model" - [Cube: announcing D3](https://cube.dev/blog/announcing-cube-d3) (snippet, June 2025, older)
- Agents build workbooks and dashboards with tables, bars, lines, heatmaps, KPI cards and custom HTML/markdown charts - [Cube Agentic Analytics GA, 2025-10-29](https://cube.dev/blog/cube-agentic-analytics)

**dbt Semantic Layer**
- The dbt MCP server's Semantic Layer tools: `list_metrics`, `get_dimensions`, `get_entities`, `get_dimension_values`, `list_saved_queries`, `get_metrics_compiled_sql` (compiled SQL without executing) and `query_metrics` ("Executes metric queries with filtering and grouping options") - [dbt MCP available tools](https://docs.getdbt.com/docs/dbt-ai/mcp-available-tools)
- `query_metrics` takes `metrics: list[str]` plus optional `group_by`, `order_by`, `where` and `limit`, and is marked read-only and idempotent - [Glama listing of dbt-mcp query_metrics](https://glama.ai/mcp/servers/dbt-labs/dbt-mcp/tools/query_metrics) (snippet, third-party mirror of the repo)
- The same server also offers `text_to_sql` (free SQL from natural language, needs AI features enabled) and `execute_sql` (one read-only `SELECT`, run with the user's development credentials) - [dbt MCP available tools](https://docs.getdbt.com/docs/dbt-ai/mcp-available-tools)

**Malloy**
- Publisher's MCP server: `malloy_getContext` (discovery entry point that returns environments, packages, sources and the fields most relevant to a question), `malloy_executeQuery` (ad-hoc `query` string, or named `queryName` + `sourceName`; returns JSON), `malloy_compile` (compile-check source without running it), `malloy_reloadPackage` and `malloy_searchDocs`. Bundled agent skills are exposed as MCP prompts. The agent emits Malloy query text - [Malloy docs: MCP agents](https://docs.malloydata.dev/documentation/user_guides/publishing/mcp_agents)
- Malloy render tags on a query pick a visualization: "Simply adding # bar_chart before the query tags it and tells the rendering library to show the result as a bar chart", with properties `.stack`, `.size`, `.x`, `.y`, `.series`, `.title` and `.subtitle` - [Malloy visualizations overview](https://docs.malloydata.dev/documentation/visualizations/overview) (snippet). So an LLM writing Malloy can emit a query and its chart choice in one program.

**Others**
- Snowflake: semantic views carry `verified_queries` as `question` + `sql` pairs, and Cortex Analyst generates SQL - [Snowflake semantic view YAML spec](https://docs.snowflake.com/en/user-guide/views-semantic/semantic-view-yaml-spec)
- Looker: the Looker-managed MCP server lets agents such as Gemini CLI, Claude Desktop, Cursor and Copilot "securely connect to a Looker instance and interact with business data and LookML models". A LookML VS Code extension (preview) has an agent that "translates business intent directly into production-ready code" - [Looker-managed MCP server](https://docs.cloud.google.com/looker/docs/mcp) (snippet); [Looker at Next '26](https://cloud.google.com/blog/products/business-intelligence/looker-updates-for-agentic-bi-at-next26) (snippet)

### Inferences
- Cube's AI API output (REST query JSON) is the closest analogue to the target's per-widget data binding. It is a declarative, closed vocabulary of member names that a validator can check, and that is the shape the target's JSON dashboard spec should keep for its dataset/field references.
- Cube's agent splits the output into a query (SQL) and a data-free Vega-Lite spec. The target's JSON dashboard document does the same job one level up: it binds layout and renderers to catalog fields.
- Malloy alone puts query and presentation in one language, through tags. That is elegant, but it makes the LLM write a program rather than fill a schema.

### Gaps
- I could not fetch Cube's current AI API page (redirect, then 404 on the GitHub source path). Whether the AI API is still supported or has been superseded by the Chat API is UNVERIFIED.
- I did not find the format Cube uses to store agent-built dashboards (a JSON spec, or an internal DB model). UNVERIFIED.

## Q2. How is output validated and kept safe?

### Takeaway
Validation lives in two places. A closed vocabulary means the model can only name defined members (Cube REST, dbt `query_metrics`, Malloy compile). Identity-scoped execution means the layer applies row-level security from the caller's context (Cube security context, Looker user roles, dbt credentials). Free-SQL escape hatches exist in Cube (Semantic SQL), dbt (`text_to_sql`, `execute_sql`) and Snowflake.

### Cited Findings
- Cube: if the model lacks the needed fields, the AI API returns a message and no `cube_query`. It never invents members - [Cube AI API docs](https://cube.dev/docs/product/apis-integrations/ai-api) (snippet)
- Cube Chat API: `sessionSettings.userAttributes`, `groups` and `securityContext` drive row-level security. With a Cube token (`X-Cube-Auth-Token`, `chat` scope), "the agent queries with the same token, so row-level access matches direct API queries". A body `securityContext` (up to 64 KB, `chat-security-context` scope) replaces the token claims. `allowChatWorkspaceAuthoring: false` stops the agent saving explorations, reports, workbooks or dashboards - [Cube Chat API](https://docs.cube.dev/reference/embed-apis/chat-api)
- Cube Analytics Chat queries the semantic model and runs ad hoc analysis on existing measures and dimensions "while maintaining full governance" - [Cube Agentic Analytics GA](https://cube.dev/blog/cube-agentic-analytics)
- Cube's MCP connectors: admins choose which tools the agent can use, and "nothing is enabled by default" - [Cube changelog 2026-06-19](https://cube.dev/changelog/2026-06-19-changelog-mcp-connectors)
- Cube Core warns that development mode disables authentication on several endpoints: "Never expose it to the internet or use it in production" - [cube-js/cube README](https://github.com/cube-js/cube)
- dbt: `execute_sql` accepts only a single read-only `SELECT`. The CLI tools "could modify your data models, sources, and warehouse objects. Proceed only if you trust the client." Remote tools "can change without notice or a deprecation period" - [dbt MCP available tools](https://docs.getdbt.com/docs/dbt-ai/mcp-available-tools)
- Malloy: `malloy_compile` returns structured diagnostics and can include the generated SQL. A reload that fails to compile keeps the previous model. The Publisher MCP endpoint "has no authentication", binds `0.0.0.0` by default, and the docs recommend `--host 127.0.0.1` locally and an authenticating gateway for wider exposure - [Malloy docs: MCP agents](https://docs.malloydata.dev/documentation/user_guides/publishing/mcp_agents)
- Malloy renderer: a bad tag value such as `# currency=yen` is logged and ignored, and the table still renders - [@malloydata/render validation doc](https://cdn.jsdelivr.net/npm/@malloydata/render@0.0.424/docs/validation.md) (snippet)
- Snowflake: facts and metrics carry `access_modifier` (`public_access` / `private_access`). Verified query SQL must be correct, because "invalid or inaccurate queries can hurt Cortex Analyst's accuracy" - [Snowflake semantic view YAML spec](https://docs.snowflake.com/en/user-guide/views-semantic/semantic-view-yaml-spec); [Snowflake verified query repository](https://docs.snowflake.com/en/user-guide/views-semantic/verified-query-repository) (snippet)
- Looker managed MCP: "the AI agent will inherit the Looker roles and access of the user who authenticated". During preview, admins register each agent manually through OAuth - [Looker-managed MCP server](https://docs.cloud.google.com/looker/docs/mcp) (snippet)

### Inferences
- The target's in-browser aggregation means access control has to happen before data reaches the browser. The catalog can only constrain which fields a spec may reference. That matches the "closed vocabulary" half of these systems but not the "identity-scoped execution" half.
- Malloy's "log and ignore a bad presentation tag, still render" is a useful precedent for tolerant validation of LLM-written display hints.

### Gaps
- How Cube validates Semantic SQL written by its agent (rejecting raw table access, for example) is UNVERIFIED.

## Q3. Is generated output persistent and editable, or one-off?

### Takeaway
Cube (commercial) is the only product here where agent output becomes a saved, user-editable artifact: workbooks and dashboards with an agent that keeps editing them. Databricks AI/BI dashboards come close. dbt, Malloy Publisher MCP and Snowflake Cortex Analyst return one-off query results. Their persistent assets are human-authored (saved queries, Malloy packages, verified queries).

### Cited Findings
- Cube: "Insights from Analytics Chat can be saved to a workbook for further analysis." Users keep fine-grained control over fields, filters, colors and labels. Dashboards are shareable artifacts. "Workbook and dashboard agents" create and update visualizations - [Cube Agentic Analytics GA, 2025-10-29](https://cube.dev/blog/cube-agentic-analytics)
- Cube dashboards (Nov 2026): cross-filtering is configured on the dashboard's Editing tab and stored in the URL ("Cross-filters are kept in the URL, so they survive a reload"). Cross-filters reach the Dashboard Agent. Scheduled refreshes keep viewer-added dynamic controls - [Cube changelog 2026-11-07](https://cube.dev/changelog/2026-11-07-changelog-cross-filtering)
- Cube changelog entries include a Dashboard Agent (May 2026), Agent Skills (2026-06-05) and Python Analysis in workbooks (2026-07-31) - [Cube changelog 2026-06-05](https://cube.dev/changelog/2026-06-05-changelog-agent-skills); [Cube changelog 2026-07-31](https://cube.dev/changelog/2026-07-31-changelog-python-analysis) (snippet; the May Dashboard Agent date is from a search summary and is UNVERIFIED)
- Cube Chat API threads can be fetched by `chatId`, and a suspended turn can be resumed for 24 hours. Ephemeral external users are removed after `ephemeralTtlSeconds` (one week by default) - [Cube Chat API](https://docs.cube.dev/reference/embed-apis/chat-api)
- dbt: `list_saved_queries` exposes human-defined saved queries. `query_metrics` returns results only - [dbt MCP available tools](https://docs.getdbt.com/docs/dbt-ai/mcp-available-tools)
- Malloy: the MCP docs do not say whether generated queries are saved. `malloy_compile` + `malloy_reloadPackage` let an agent author model source on disk, and reloading can overwrite on-disk edits - [Malloy docs: MCP agents](https://docs.malloydata.dev/documentation/user_guides/publishing/mcp_agents)
- Looker: changes made through Gemini and the MCP Toolbox cannot be committed and promoted to production from there. You test and commit them in the Looker UI - [Google codelab: Looker MCP Toolbox (German)](https://codelabs.developers.google.com/codelabs/looker-mcp-toolbox?hl=de) (snippet)

### Inferences
- Cube's commercial platform is the nearest direct competitor to the target concept: agent-built, persisted, editable dashboards over a semantic layer, embeddable. It is closed-source and Cloud-only, and its dashboard format is not public.

### Gaps
- Whether Cube's agent edits dashboards by diffing a document or through UI-level tool calls is UNVERIFIED.

## Q4. How does it bind to live data, and what metadata does the model see?

### Takeaway
All of them bind live by compiling queries against the warehouse at request time. None of them push data to the client for local aggregation. The metadata given to the model is converging on: description, synonyms, a free-text AI-instructions field, data type, sample/enum values, and verified example queries.

### Cited Findings
- Cube Chat API: the `cubeMeta` tool returns cube and member metadata to the agent - [Cube Chat API](https://docs.cube.dev/reference/embed-apis/chat-api)
- Cube Core exposes models through "SQL, REST, and GraphQL APIs" - [cube-js/cube README](https://github.com/cube-js/cube)
- dbt metrics: `name`, `type` (simple, cumulative, ratio, derived, conversion), `description`, `label` ("Display name in downstream tools"), `filter`, `hidden`, `config` (meta, group, tags, enabled) - [dbt metric properties](https://docs.getdbt.com/reference/metric-properties). Dimensions, entities and distinct dimension values are discoverable via `get_dimensions`, `get_entities` and `get_dimension_values` - [dbt MCP available tools](https://docs.getdbt.com/docs/dbt-ai/mcp-available-tools)
- Malloy: discovery returns model entities with their model path and `#(doc)` description, and tags can carry annotations that agents read - [Malloy docs: MCP agents](https://docs.malloydata.dev/documentation/user_guides/publishing/mcp_agents)
- OSI / Apache Ossie spec (`0.3.0.dev0` draft): datasets, fields, relationships and metrics all carry `description` and `ai_context`. `ai_context` is a string or an object with `instructions`, `synonyms` and `examples`, described as "Additional context for AI tools (e.g., synonyms, common terms)". Fields carry a `datatype` enum (String, Integer, Decimal, Float, Boolean, Date, Time, DateTime, DateTimeTz, Opaque) and `dimension.is_time` - [OSI core spec.md](https://raw.githubusercontent.com/open-semantic-interchange/OSI/main/core-spec/spec.md)
- Snowflake semantic views: dimensions carry `synonyms`, `description`, `expr`, `data_type`, `is_enum`, `sample_values` and `cortex_search_service` (for value lookup). Metrics carry `synonyms`, `description`, `expr`, `non_additive_dimensions` and `using_relationships`. Model-level `module_custom_instructions` has `sql_generation` and `question_categorization` - [Snowflake semantic view YAML spec](https://docs.snowflake.com/en/user-guide/views-semantic/semantic-view-yaml-spec)
- Databricks metric views: `synonyms` (up to 10 per field) "are automatically imported to help Genie better discover and understand available fields and measures" - [Databricks metric view semantic metadata](https://docs.databricks.com/aws/en/metric-views/semantic-metadata)

### Inferences
- The target's Data Catalog "field kind" (pnl, fraction, ticker) carries semantic type plus presentation and aggregation defaults. None of these layers has a first-class equivalent. The nearest are dbt metric `type` and `agg`, Snowflake `default_aggregation` on facts, and Databricks `format`. Adding `description`, `synonyms` and `ai_context`-style fields to the catalog would align it with OSI.

### Gaps
- Whether Cube's data model has a dedicated AI-context or synonyms property (beyond `description` and `meta`) is UNVERIFIED.

## Q5. How does a user refine a result?

### Takeaway
Refinement is conversational everywhere: a follow-up turn in the thread. Cube adds direct manipulation of saved workbook and dashboard widgets, plus agent edits to them. dbt and Malloy leave refinement to the MCP client conversation.

### Cited Findings
- Cube AI API accepts a "conversation of messages", so prior turns refine the next query - [Cube AI API docs](https://cube.dev/docs/product/apis-integrations/ai-api) (snippet)
- Cube Chat API threads persist by `chatId`, and `input` continues the thread - [Cube Chat API](https://docs.cube.dev/reference/embed-apis/chat-api)
- Cube: save chat insights to a workbook, then edit fields, filters, colors and labels directly. Users can "review or edit" agent Semantic SQL - [Cube Agentic Analytics GA](https://cube.dev/blog/cube-agentic-analytics); [Cube: announcing D3](https://cube.dev/blog/announcing-cube-d3) (snippet)
- Snowflake: verified queries can be added through Snowsight, which can suggest them from user history - [Snowflake verified query repository](https://docs.snowflake.com/en/user-guide/views-semantic/verified-query-repository) (snippet)

### Inferences
- Cube's mix of agent-built output and hand-editable widgets is the same refinement model the target aims for with editable JSON dashboard documents.

### Gaps
- No primary source describes refinement UX for Malloy Publisher, dbt Insights or Databricks Genie in detail.

## Q6. Does it embed in an existing app?

### Takeaway
All four embed, through MCP plus REST or GraphQL. Cube has the richest embedding surface: a headless Core API, an agent Chat API with streamed NDJSON, and embeddable dashboards, workbooks and chats. Malloy Publisher ships a React SDK and MCP. dbt offers MCP plus GraphQL, JDBC and Python SDK.

### Cited Findings
- Cube: dashboards, workbooks and analytics chats can be embedded with frontend components that match an app's theming, and headless APIs remain available - [Cube Agentic Analytics GA](https://cube.dev/blog/cube-agentic-analytics). The Chat API (`POST .../agents/{agentId}/chat/stream-chat-state`) is available on Premium and Enterprise plans - [Cube Chat API](https://docs.cube.dev/reference/embed-apis/chat-api)
- Cube D3 agents are accessible through MCP (Claude Desktop) and A2A, with iframe support - [Cube: announcing D3](https://cube.dev/blog/announcing-cube-d3) (snippet); [Cube D3 webinar listing](https://www.brighttalk.com/webcast/20955/647380) (snippet). Cube describes exposing governed analytics "through interfaces including MCP, SQL, REST, and GraphQL" - [Cube article: analytics MCP server](https://cube.dev/articles/analytics-mcp-server) (updated 2026-11-18)
- Cube's agent can also call out to external MCP servers (Notion, Linear, Sentry, Attio, or any remote MCP endpoint) - [Cube changelog 2026-06-19](https://cube.dev/changelog/2026-06-19-changelog-mcp-connectors)
- dbt: Semantic Layer APIs are GraphQL, JDBC and a Python SDK, on the "dbt platform | Starter, Enterprise, Enterprise+" plans - [dbt SL API overview](https://docs.getdbt.com/docs/dbt-cloud-apis/sl-api-overview). The MCP server runs locally (self-hosted) or remotely (dbt-hosted), and the Semantic Layer tools are on both - [dbt MCP available tools](https://docs.getdbt.com/docs/dbt-ai/mcp-available-tools)
- Malloy Publisher: "One data model, served over MCP and REST to AI agents, applications, and BI tools." It publishes an OpenAPI spec, offers an `@malloy-publisher/sdk` package used in a Vite + React data-app example, and supports "No-build HTML data apps" - [malloydata/publisher README](https://github.com/malloydata/publisher). Run it with `npx @malloy-publisher/server`; MCP is on port 4040 at `/mcp` - [Malloy docs: MCP agents](https://docs.malloydata.dev/documentation/user_guides/publishing/mcp_agents)
- Looker: Conversational Analytics API for embedding custom Gemini-based agents. Embedded Conversational Analytics agents are GA per Next '26 - [Looker at Next '26](https://cloud.google.com/blog/products/business-intelligence/looker-updates-for-agentic-bi-at-next26) (snippet)
- AtScale: in-product MCP endpoint at `<atscale-host>/mcp`, listed in the Databricks MCP Marketplace since 2025-12-01 - [AtScale MCP blog](https://www.atscale.com/blog/enterprise-ai-mcp-semantic-layer/) (snippet); [BusinessWire 2025-12-01](https://www.businesswire.com/news/home/20251201005442/en/AtScale-Delivers-Semantic-Intelligence-to-Databricks-MCP-Marketplace/) (snippet)

### Inferences
- For a Hoist app, the cheapest integration is a server-side MCP or REST call to Cube Core or Malloy Publisher, with the rows mapped into the Data Catalog. The semantic layer then replaces the catalog's source, not the dashboard generator.

### Gaps
- Cube's own MCP server (endpoint, tool list, whether it ships in Core) is not documented in any page I could fetch. UNVERIFIED.

## Q7. Licence and hosting model

### Takeaway
The engines are open; the AI is mostly commercial. Cube Core is Apache 2.0, but its agents, chat, dashboards and Chat API are Cube Cloud only. MetricFlow is Apache 2.0 since v0.209.0, but the hosted Semantic Layer APIs and remote MCP are dbt platform only (the dbt MCP server itself can run locally). Malloy and Publisher, MCP server included, are MIT and fully self-hostable. OSI / Apache Ossie is Apache 2.0.

### Cited Findings
- Cube: "Cube Client is MIT licensed" and "Cube Backend is Apache 2.0 licensed". "Cube Core is headless: it doesn't ship a UI." The commercial Cube is "an agentic analytics platform built on Cube Core" and adds Analytics Chat, workbooks and dashboards, embedded surfaces, managed deployment, RBAC, multi-tenancy and BI integrations - [cube-js/cube README](https://github.com/cube-js/cube)
- Cube dropped the "D3" name and unified its semantic layer and agentic products as "Cube" at GA on 2025-10-29 - [Cube Agentic Analytics GA](https://cube.dev/blog/cube-agentic-analytics)
- MetricFlow licence history: versions up to 0.140.0 were AGPL, 0.150.0 to 0.208.2 were BSL, and 0.209.0 onward are Apache 2.0. dbt announced the change at Coalesce on 2025-10-14, tied to OSI - [dbt Labs blog](https://www.getdbt.com/blog/dbt-labs-affirms-commitment-to-open-semantic-interchange-by-open-sourcing-metricflow) (snippet); [dbt-labs/metricflow](https://github.com/dbt-labs/metricflow) (snippet). A search summary says the README still calls MetricFlow "source-available"; that conflict is UNVERIFIED. The hosted dbt Semantic Layer service and APIs remain proprietary - [Atlan: MetricFlow Apache 2](https://atlan.com/know/ai-agent/semantic-layer/metricflow-apache-2-license-dbt-semantic-layer/) (snippet, vendor commentary)
- Malloy core is MIT - [malloydata/malloy CONTRIBUTING](https://raw.githubusercontent.com/malloydata/malloy/HEAD/CONTRIBUTING.md) (snippet). Publisher is "MIT license", "Created and maintained by Credible" - [malloydata/publisher README](https://github.com/malloydata/publisher)
- OSI is now Apache Ossie (incubating at the ASF; page dated 2026-07-10), Apache-2.0. The coalition "has grown from 17 launch partners to more than 50 organizations". Committers come from Snowflake, Dremio, Salesforce, Databricks, dbt Labs, RelationalAI, GoodData and Honeydew. Converters to the dbt Semantic Layer and Apache Polaris are merged - [Apache Ossie enters incubator](https://ossie.apache.org/updates/ossie-enters-apache-incubator/); [OSI GitHub](https://github.com/open-semantic-interchange/OSI)
- AtScale joined OSI in January 2026, and its SML modelling language is open source - [BusinessWire 2026-01-27](https://www.businesswire.com/news/home/20260127372541/en/AtScale-Joins-the-Open-Semantic-Interchange-OSI-Bringing-over-a-Decade-of-Semantic-Layer-Expertise-to-support-Open-Standards) (snippet)
- Looker managed MCP is in preview for Google Cloud core and original Looker instances. Customer-hosted instances are not supported - [Looker-managed MCP server](https://docs.cloud.google.com/looker/docs/mcp) (snippet)

### Inferences
- Malloy + Publisher is the only fully self-hostable, permissively licensed stack with a first-party MCP server and presentation tags. That fits XH's privacy-conscious, self-hosted hedge-fund clients well.

### Gaps
- Whether Cube was an OSI launch partner is UNVERIFIED (the Ossie page does not name it).

## Q8. Does the semantic layer carry presentation metadata a UI generator could use?

### Takeaway
It varies widely. Databricks metric views and Malloy carry real format specs (currency with code, percent, decimals, abbreviation). Cube has `format` (percent, currency, d3-format strings) and `title`. dbt has only `label`. Snowflake semantic views and the OSI spec have no format or unit property at all. The target's "field kind sets default format, aggregator and renderer" idea sits ahead of every open standard here.

### Cited Findings
- Cube: `format: percent` (do not multiply by 100 in SQL), `format: currency`, and "Measures with numeric types support custom formatting using d3-format specifier strings" - [Cube types and formats](https://cube.dev/docs/schema/reference/types-and-formats) (snippet; the current docs.cube.dev URL returned 404)
- Malloy: `# percent`, `# currency`, `# currency=usd2m` (renders "$42.5m"), and the verbose `# currency { scale=m decimals=2 }`. An annotation before a definition list "is distributed to each member of the list" - [Malloy numbers](https://docs.malloydata.dev/documentation/visualizations/numbers) (snippet); [Malloy tags](https://docs.malloydata.dev/documentation/language/tags) (snippet). Chart tags (`# bar_chart` and others) put the renderer choice in the model too - [Malloy visualizations overview](https://docs.malloydata.dev/documentation/visualizations/overview) (snippet)
- Databricks metric views (YAML 1.1, Runtime 17.3): `display_name` (255 chars), `synonyms`, `comment`, and `format` with types number, currency (ISO-4217 `currency_code`), percentage, byte, date and date_time. Options include `decimal_places` (max / exact / all, 0 to 10), `hide_group_separator` and `abbreviation` (none / compact / scientific). "Display names and format specifications are automatically populated in dashboard datasets and visualizations" - [Databricks metric view semantic metadata](https://docs.databricks.com/aws/en/metric-views/semantic-metadata). Search results disagree on Preview vs GA status and Runtime 17.2 vs 17.3 - [Databricks UC business semantics](https://docs.databricks.com/aws/en/business-semantics) (snippet)
- dbt: metrics have `label` ("Display name in downstream tools") and no format or unit property - [dbt metric properties](https://docs.getdbt.com/reference/metric-properties). Downstream tools such as Lightdash put `format` inside `meta` by their own convention - [Lightdash metrics docs](https://docs.lightdash.com/semantic-layer/metrics.md) (snippet)
- OSI / Ossie: no format or unit property. `label` means "Label for categorization", not a display name. Vendor-specific data goes in `nonportable_extensions` (`vendor_name` + `data`), and core behaviour must not depend on it - [OSI core spec.md](https://raw.githubusercontent.com/open-semantic-interchange/OSI/main/core-spec/spec.md)
- Snowflake: no format, unit or display-name property. `labels` only marks a dimension or fact as a filter - [Snowflake semantic view YAML spec](https://docs.snowflake.com/en/user-guide/views-semantic/semantic-view-yaml-spec)
- Looker LookML has `label` and `value_format_name` / `value_format` on fields - UNVERIFIED this session (from prior knowledge, not fetched).

### Inferences
- Databricks' `format` block is the most complete open-ish model of numeric presentation, and a good reference for the target's field-kind defaults. Malloy's tags are the only ones that also choose a renderer.
- Because OSI carries no presentation metadata, a catalog that imports OSI would still need its own format/renderer layer (or a `nonportable_extensions` entry).
- No layer models finance-specific kinds (pnl sign colouring, bps, ticker). That remains the target's own differentiator.

### Gaps
- No units-of-measure property (beyond currency code) exists in any spec I checked.

## Q9. Genuine strengths per product

### Takeaway
Cube is the most complete product (semantic layer + agents + persisted, editable dashboards + embedding). dbt has the deepest data-team adoption and a broad MCP tool surface. Malloy is the most elegant language, with presentation in the model and a fully MIT self-hostable MCP stack. OSI/Ossie is the interchange standard to align with.

### Cited Findings
- Cube: open Apache 2.0 core with SQL / REST / GraphQL APIs - [cube-js/cube README](https://github.com/cube-js/cube). A conversational agent that outputs governed queries plus data-free Vega-Lite specs, with per-user row-level security via token or security context - [Cube Chat API](https://docs.cube.dev/reference/embed-apis/chat-api). Saved, editable, embeddable workbooks and dashboards - [Cube Agentic Analytics GA](https://cube.dev/blog/cube-agentic-analytics). Active 2026 cadence: cross-filtering, MCP connectors, Python analysis - [Cube changelog 2026-11-07](https://cube.dev/changelog/2026-11-07-changelog-cross-filtering). Can import Snowflake Semantic Views and serve Snowflake's CoCo agent over MCP (2026-09-17) - [Cube changelog listing](https://cube.dev/changelog/2026-07-17-changelog-dbt-integration) (snippet; the exact source page for the CoCo item is UNVERIFIED)
- dbt: a typed metric taxonomy (simple, cumulative, ratio, derived, conversion) - [dbt metric properties](https://docs.getdbt.com/reference/metric-properties). An MCP server that pairs metric querying with lineage, model health and compiled-SQL preview (`get_metrics_compiled_sql`) - [dbt MCP available tools](https://docs.getdbt.com/docs/dbt-ai/mcp-available-tools). Apache 2.0 MetricFlow is the OSI reference implementation - [dbt Labs blog](https://www.getdbt.com/blog/dbt-labs-affirms-commitment-to-open-semantic-interchange-by-open-sourcing-metricflow) (snippet)
- Malloy: compile-before-run validation with SQL preview, plus `malloy_getContext` relevance-ranked field discovery - [Malloy docs: MCP agents](https://docs.malloydata.dev/documentation/user_guides/publishing/mcp_agents). MIT throughout - [malloydata/publisher README](https://github.com/malloydata/publisher)
- OSI/Ossie: vendor-neutral YAML/JSON with a JSON Schema (`ossie-schema.json`), `ai_context` with synonyms and examples, and more than 50 member organisations - [OSI GitHub](https://github.com/open-semantic-interchange/OSI); [Apache Ossie enters incubator](https://ossie.apache.org/updates/ossie-enters-apache-incubator/)
- Databricks: the richest built-in format and display metadata, flowing automatically into dashboards and Genie - [Databricks metric view semantic metadata](https://docs.databricks.com/aws/en/metric-views/semantic-metadata)
- Snowflake: verified question-to-SQL pairs and split custom instructions (SQL generation vs question categorisation) as LLM grounding - [Snowflake semantic view YAML spec](https://docs.snowflake.com/en/user-guide/views-semantic/semantic-view-yaml-spec)

### Inferences
- Lessons for the target: (1) keep the LLM's data references to a closed, validatable vocabulary, as Cube REST and dbt `query_metrics` do. (2) Give catalog fields `description`, `synonyms` and verified examples, aligned with OSI `ai_context`. (3) Model formats with the precision of Databricks `format` (currency code, decimals, abbreviation). (4) Consider an import path from OSI/Ossie or Cube/dbt metadata into the Data Catalog.

### Gaps
- Independent accuracy benchmarks comparing these products were out of scope and not searched.
