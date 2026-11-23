# AI in open-source / open-core BI: Metabase, Lightdash, Superset (+Preset), Evidence, Rill

All URLs checked 2026-11-21. "UNVERIFIED" = from prior knowledge or a search snippet, not confirmed on a fetched primary page this session. Release versions as of 2026-11-21 (GitHub API): Metabase v0.65.6 (2026-11-18), Lightdash 3.359.1 (2026-11-20), Superset 6.1.0 (2026-05-13), Evidence `@evidence-dev/evidence@40.1.8` (2026-02-06, last GitHub release on the legacy repo), Rill v0.92.1 (2026-11-19) - [metabase](https://github.com/metabase/metabase/releases), [lightdash](https://github.com/lightdash/lightdash/releases), [superset](https://github.com/apache/superset/releases), [evidence](https://github.com/evidence-dev/evidence/releases), [rill](https://github.com/rilldata/rill/releases).

## Q1. What does the model emit?

### Takeaway
None of the five has the LLM emit free-form UI code at runtime. Metabase, Lightdash, Superset and Rill have the model emit structured tool-call arguments (a query-builder question, a metric query, a chart `form_data`-style spec, a metrics-view query) that the product renders with its own chart components. Evidence is the outlier: its agent writes Evidence Markdown (markdown + SQL + components) pages. SQL is a secondary output in Metabase, Superset and Evidence.

### Cited Findings
**Metabase (Metabot)**
- Metabot builds charts from natural language, including query-builder (GUI) questions, and first searches for existing questions that answer the request - [Metabot docs](https://www.metabase.com/docs/latest/ai/metabot)
- In the native editor it generates SQL ("Currently, only SQL is supported"), fixes SQL errors ("Have Metabot fix it"), and does inline SQL edits (Cmd/Ctrl+Shift+I) - [Metabot docs](https://www.metabase.com/docs/latest/ai/metabot)
- "Research" generates and ranks many charts from one prompt; Metabot also generates charts inside Metabase documents - [Metabot docs](https://www.metabase.com/docs/latest/ai/metabot)
- The docs do not say Metabot builds dashboards; a chart it creates can be saved "to a dashboard or collection" - [Metabot docs](https://www.metabase.com/docs/latest/ai/metabot)
- Cannot add SQL variables, goal lines or chart formatting changes - [Metabot docs](https://www.metabase.com/docs/latest/ai/metabot)
- Embedded Metabot (SDK) "doesn't write SQL, edit dashboards, or create metrics or models"; it finds a metric, model, saved question or table and writes a query against it - [Embedded AI chat docs](https://www.metabase.com/docs/latest/embedding/sdk/ai-chat)
- MCP server tools cover "searching, browsing, querying, and creating content", including a `visualize_query` tool that renders inline charts - [Metabase MCP docs](https://www.metabase.com/docs/latest/ai/mcp)
- Agent-driven development: a coding agent uses the Metabase CLI (`mb`) and a `/metabase-cli` skill to create questions and dashboards in a dev instance; content is then versioned as YAML in the [Metabase Representation Format](https://github.com/metabase/representations) ("the YAML schema and spec for every Metabase entity (questions, dashboards, collections, transforms, and so on)") - [Agent-driven development](https://www.metabase.com/docs/latest/ai/agent-driven-development)

**Lightdash (AI agents)**
- Agents answer metric questions that "run on the definitions and joins in your semantic layer", and build charts, tables and dashboards - [AI agents guide](https://docs.lightdash.com/guides/ai-agents)
- A Lightdash chart is a `metricQuery` (`exploreName`, `dimensions`, `metrics`, `filters`, `sorts`, `tableCalculations`, `additionalMetrics`) plus `chartConfig` and `tableConfig`; SQL-runner charts use `contentType: sql_chart` with raw `sql` - [Dashboards as code](https://docs.lightdash.com/guides/developer/dashboards-as-code)
- Feature flag `ai-filter-expressions` "compact filter expressions" shrink the filter schemas sent to the model by "AI agent and MCP query tools" - i.e. the model fills a structured query/filter schema - [Self-host AI agents](https://docs.lightdash.com/self-host/enterprise-features/ai-agents)
- Post-processing: DuckDB steps over result files and Python steps in a one-off sandbox (`compose-sql-runner` flag) - [Self-host AI agents](https://docs.lightdash.com/self-host/enterprise-features/ai-agents)
- AI writeback edits dbt or Lightdash YAML and opens a pull request; for dbt projects the sandbox runs `lightdash compile` - [AI agents guide](https://docs.lightdash.com/guides/ai-agents); [Self-host AI agents](https://docs.lightdash.com/self-host/enterprise-features/ai-agents)
- "Data apps": a coding agent (Claude or Codex) generates small apps in sandboxes - [Self-host AI agents](https://docs.lightdash.com/self-host/enterprise-features/ai-agents)

**Apache Superset / Preset**
- Superset ships a built-in MCP server; tools include `generate_chart`, `update_chart`, `get_chart_data`, `generate_explore_link`, `generate_dashboard`, `add_chart_to_existing_dashboard`, `manage_dashboard_markdown`, `create_virtual_dataset`, `create_dataset_metric`, `create_dataset_column`, `execute_sql`, `save_sql_query`, `open_sql_lab_with_context` - [Using AI with Superset](https://superset.apache.org/user-docs/using-superset/using-ai-with-superset/)
- Chart previews come back as URL, ASCII, table or Vega-Lite; SQL results include `executed_sql` - [Using AI with Superset](https://superset.apache.org/user-docs/using-superset/using-ai-with-superset/)
- Preset: the open-source MCP service (SIP-187, led by Preset engineers) is "Library-first, not API-proxied" and exposes 20 tools; Preset Chatbot (beta) is a LangGraph agent that calls those MCP tools in sequence - [Preset MCP announcement, 2026-04-01](https://preset.io/blog/preset-mcp-announcement/)
- No native chatbot in Apache Superset yet: SIP-214 added a "Chat" extension contribution type, but the reference chatbot and admin UX were still on a feature branch at end of June 2026 - [Superset repo recap June 2026](https://preset.io/blog/apache-superset-repo-recap-june-2026/) (via search snippet; UNVERIFIED whether merged since)
- UNVERIFIED: the exact chart payload `generate_chart` builds (Superset charts are stored as `viz_type` + `form_data`/`params` JSON, dashboards as `position_json`; the MCP docs page does not specify).

**Evidence**
- The Evidence Agent "builds insights in Evidence Markdown", code that mostly describes the analysis rather than presentation; it can translate reports into their underlying SQL - [Evidence Agent blog, 2026-08-04](https://evidence.dev/blog/evidence-agent)
- In the Studio editor the agent "is trained to generate valid Evidence markdown", can read/edit pages, run SQL, inspect schemas, fix errors, and edit `theme.yaml` and `evidence.config.yaml` - [Evidence editing docs](https://docs.evidence.dev/editing)
- Evidence Core (open-sourced 2026-08-26) adds live warehouse queries, reusable YAML metrics, and "a terser syntax that can be validated statically" - [Evidence Core blog](https://evidence.dev/blog/evidence-core)
- UNVERIFIED this session: page syntax is markdown with fenced ```` ```sql query_name ```` blocks and Svelte-style components such as `<BarChart data={query_name} x=... y=... />` (legacy Evidence syntax; Evidence Core's terser syntax not examined).

**Rill**
- AI Chat and MCP clients query metrics views; clients that support MCP Apps (Claude, ChatGPT) render Rill's interactive charts when the AI calls `create_chart` - [Rill AI configuration](https://docs.rilldata.com/developers/build/ai-configuration)
- v0.92.0: "AI: make `query_metrics_view` tolerate common argument mistakes" - the model emits structured metrics-view query arguments - [Rill v0.92.0](https://github.com/rilldata/rill/releases/tag/v0.92.0)
- Build-time: coding agents write Rill's YAML/SQL resource files (models, metrics views, explore/canvas dashboards) through a local MCP server (`rill start --preview`, `http://localhost:9009/mcp`) that exposes project status, schemas, SQL and file read/write - [Rill AI quickstart](https://docs.rilldata.com/developers/get-started/ai-quickstart)
- Canvas "Custom viz" widgets can use 32 chart types or a Vega-Lite spec - [Rill canvas docs](https://docs.rilldata.com/developers/build/dashboards/canvas)

### Inferences
- Two distinct patterns: (a) runtime analyst agents emit constrained query objects that a fixed renderer draws (Metabase, Lightdash, Superset, Rill Chat); (b) build-time coding agents author declarative definition files (Lightdash YAML, Metabase representations, Rill YAML, Evidence markdown). Evidence's runtime agent collapses the two: its answers are themselves Evidence Markdown.
- Superset's Vega-Lite preview and Rill's Vega-Lite custom viz are the only places a general chart grammar appears.

### Gaps
- Metabot's exact internal representation (MBQL/query-builder JSON vs. SQL) for GUI questions is not documented on the fetched pages.
- Lightdash's main chat agent's exact query-generation method is not documented on fetched pages (the self-host page says so explicitly).
- Whether Superset `generate_dashboard` previews or saves is not stated.

## Q2. How is output validated and kept safe?

### Takeaway
All five inherit the asking user's permissions (RBAC / row-level security / page access) rather than giving the AI its own privileges. Semantic-layer grounding (Lightdash explores, Rill metrics views, Metabase metrics/models, Superset datasets) is the main correctness constraint. Superset is preview-first; Evidence and Metabase SQL edits are diff/accept; Rill and Lightdash add automated checks (numbers-from-tool-results, evals).

### Cited Findings
- **Metabase:** Metabot "can only see what that person has permissions to see and do"; collection scoping "is _not_ a substitute for setting permissions" - [Metabase AI settings](https://www.metabase.com/docs/latest/ai/settings). Generated SQL is not run automatically; user reviews it - [Metabot docs](https://www.metabase.com/docs/latest/ai/metabot). MCP requests run with the signed-in user's data and collection permissions; OAuth scopes (`agent:content:read`, `agent:content:write`, `agent:query:run`, `agent:sql:run`, `agent:delivery:write`) "don't grant additional access" - [Metabase MCP](https://www.metabase.com/docs/latest/ai/mcp). Agent-built content is reviewed in a dev instance and as a YAML diff in a PR before production pulls it - [Agent-driven development](https://www.metabase.com/docs/latest/ai/agent-driven-development). AI usage auditing on Pro/Enterprise - [Metabase AI settings](https://www.metabase.com/docs/latest/ai/settings)
- **Lightdash:** grounded in semantic layer plus project context, per-agent knowledge docs, "verified answers", per-agent data access and permissions; an Issues feature flags wrong-table/misread-term errors and drafts fixes; "Evaluation suites built from real threads catch regressions", definable as code in Git - [AI agents guide](https://docs.lightdash.com/guides/ai-agents). Agent queries run under a marked person, connected person or AI service account and log an "Agent query" line before warehouse execution - [Self-host AI agents](https://docs.lightdash.com/self-host/enterprise-features/ai-agents). Writeback goes through a PR (human review) - [AI agents guide](https://docs.lightdash.com/guides/ai-agents)
- **Superset:** "AI respects Superset's RBAC"; `execute_sql` enforces RBAC; edits need editorship, metric updates need ownership; `permission_denied` on violation. Calculated-column expressions pass the dataset editor's SQL validation; duplicate metric names rejected; temporal filters must be ISO/epoch; failed dashboard markdown ops leave layout unchanged; soft delete + restore - [Using AI with Superset](https://superset.apache.org/user-docs/using-superset/using-ai-with-superset/). `generate_chart` "defaults to preview mode - review before saving" - same source. Preset: "Zero privilege escalation" (RBAC, RLS, column restrictions), preview-first - [Preset MCP announcement](https://preset.io/blog/preset-mcp-announcement/)
- **Evidence:** agent runs in the project runtime with existing auth, row-level security, page-level access control and SSO; "can only access content and data that the current user is permitted to see" - [Evidence Agent blog](https://evidence.dev/blog/evidence-agent). Agent proposes changes as a diff the user accepts/rejects; invalid code underlined with an AI "Fix"; nothing publishes until "Publish" - [Evidence editing](https://docs.evidence.dev/editing). Evidence Core's static validator gives agents specific errors without running the project - [Evidence Core blog](https://evidence.dev/blog/evidence-core). Invalid `SKILL.md` frontmatter blocks publishing; AI Observability (all viewers' conversations) for Developer/Admin roles - [Evidence Agent docs](https://docs.evidence.dev/features/evidence-agent)
- **Rill:** "Access to the underlying data is still governed by your metrics view security policies"; skill `metrics_views` is "a relevance hint, not access control"; skill contents are visible to all AI users so "Never put secrets or sensitive data in a skill" - [Rill AI configuration](https://docs.rilldata.com/developers/build/ai-configuration). v0.92.1: "fix(ai): check that the analyst's numbers come from tool results (#10131)" - [Rill v0.92.1](https://github.com/rilldata/rill/releases/tag/v0.92.1). Coding agents see "parse errors, reconciliation failures, and resource health" via MCP - [Rill AI quickstart](https://docs.rilldata.com/developers/get-started/ai-quickstart). Security policies can hide measures per viewer on a canvas - [Rill canvas docs](https://docs.rilldata.com/developers/build/dashboards/canvas)

### Inferences
- Validation of definition files is done by the product's own parser/reconciler (Rill reconcile, Evidence static validator, Lightdash JSON schema + upload checks, Superset SQL validation) - the declarative format is the safety boundary.
- Rill's hallucinated-number check is the only explicit output-grounding check found.

### Gaps
- No vendor publishes accuracy benchmarks found this session.

## Q3. Persistent and editable, or one-off?

### Takeaway
All five persist AI output as first-class, human-editable objects. Superset defaults to ephemeral previews; Metabase embedded chat defaults to save-off. Lightdash, Metabase (Pro/Ent), Evidence and Rill support git-versioned definitions.

### Cited Findings
- **Metabase:** Metabot charts can be saved to a dashboard or collection and opened in query builder/SQL editor - [Metabot docs](https://www.metabase.com/docs/latest/ai/metabot). Embedded `MetabotQuestion` has `isSaveEnabled` (off by default) and `targetCollection` - [Embedded AI chat](https://www.metabase.com/docs/latest/embedding/sdk/ai-chat). Remote Sync pushes content from a read-write instance to git as YAML; read-only prod pulls; Pro/Enterprise - [Agent-driven development](https://www.metabase.com/docs/latest/ai/agent-driven-development)
- **Lightdash:** analysis can become "a new team dashboard" within the thread or a recurring delivery - [AI agents guide](https://docs.lightdash.com/guides/ai-agents). Charts/dashboards download/upload as YAML (`lightdash download` / `lightdash upload`; upload never deletes; `--force` to create); Git-managed mode with CI `lightdash deploy` + `lightdash upload --force`, and `content_as_code: sync: true` turns UI edits into drafts written back via PR - [Dashboards as code](https://docs.lightdash.com/guides/developer/dashboards-as-code)
- **Superset:** charts not saved unless the user says "save it"; `update_chart` persists with `generate_preview=False`; saved items edited via MCP or UI; markdown tiles add/update/remove but the tool "does not reorder or move existing components"; concurrent layout edits last-write-wins - [Using AI with Superset](https://superset.apache.org/user-docs/using-superset/using-ai-with-superset/)
- **Evidence:** insights are saved artifacts users can save, share, branch, and merge into existing reports/dashboards; projects are code in a repo with branches and deploy previews - [Evidence Agent blog](https://evidence.dev/blog/evidence-agent)
- **Rill:** dashboards are files in the project; canvas has a visual editor with a code-view toggle to edit YAML directly - [Rill canvas docs](https://docs.rilldata.com/developers/build/dashboards/canvas)

### Inferences
- Rill Cloud AI Chat answers appear conversational (charts via `create_chart`), not saved as canvas files - no doc found saying chat output persists as a dashboard.

### Gaps
- Whether Rill Cloud AI Chat can save a chart/canvas: not documented on fetched pages.

## Q4. Binding to live data and semantic layer

### Takeaway
Each binds to the warehouse live through its own semantic object: Lightdash = dbt models/YAML metrics (explores); Rill = metrics views (YAML, Metrics SQL); Metabase = models, metrics, segments, measures, glossary; Superset = datasets (physical/virtual) with dataset metrics/columns; Evidence = SQL sources plus (Evidence Core) reusable YAML metrics.

### Cited Findings
- **Metabase:** Metabot searches "tables, metrics, questions, models, and dashboards"; can use segments and measures in ad-hoc queries but not discover them; glossary terms; SQL generation without a named table checks only the first 100 tables - [Metabot docs](https://www.metabase.com/docs/latest/ai/metabot). Verified/curated content needs Pro/Enterprise - [AI settings](https://www.metabase.com/docs/latest/ai/settings)
- **Lightdash:** queries run on semantic-layer definitions and joins; charts reference `exploreName` + dimension/metric field ids - [AI agents guide](https://docs.lightdash.com/guides/ai-agents); [Dashboards as code](https://docs.lightdash.com/guides/developer/dashboards-as-code)
- **Superset:** MCP exposes `list_datasets`, `get_dataset_info`, `list_metrics`, `create_virtual_dataset` (from user-supplied SQL), `create_dataset_metric` - [Using AI with Superset](https://superset.apache.org/user-docs/using-superset/using-ai-with-superset/)
- **Evidence:** Evidence Core adds "live warehouse queries" and "reusable YAML metrics" - [Evidence Core blog](https://evidence.dev/blog/evidence-core); agent knows data-source schemas and runs SQL - [Evidence editing](https://docs.evidence.dev/editing)
- **Rill:** metrics views define measures, dimensions and time series - [Rill docs home](https://docs.rilldata.com/); `ai_instructions` can live in a metrics view YAML; measure/dimension `description`s are fed to the AI automatically - [Rill AI configuration](https://docs.rilldata.com/developers/build/ai-configuration); canvas components name `metrics_view:` and default filters are Metrics SQL WHERE expressions - [Rill canvas](https://docs.rilldata.com/developers/build/dashboards/canvas)

### Inferences
- Lightdash and Rill have the strongest semantic-layer gating (agent can only pick defined fields); Superset and Metabase allow raw SQL paths alongside.

### Gaps
- Evidence legacy (pre-Core) sources were build-time cached (UNVERIFIED this session); exact live-query mechanics in Core not examined.

## Q5. How does a user refine a result?

### Takeaway
Conversational follow-up everywhere, plus a handoff to the product's normal editor (Metabase query builder/SQL, Lightdash explore, Superset Explore link, Evidence code editor diff, Rill visual/YAML editor).

### Cited Findings
- **Metabase:** follow-ups keep current question context; drill-through; open in query builder/SQL editor; inline SQL accept/reject; re-run prompt; reset conversation - [Metabot docs](https://www.metabase.com/docs/latest/ai/metabot). SDK `useMetabot` exposes `submitMessage`, `retryMessage`, `resetConversation` - [Embedded AI chat](https://www.metabase.com/docs/latest/embedding/sdk/ai-chat)
- **Lightdash:** explore returned charts/tables directly then "zoom back out to the agent for more iteration"; multiple threads - [AI agents guide](https://docs.lightdash.com/guides/ai-agents)
- **Superset:** `update_chart` on previews; `generate_explore_link` / `open_sql_lab_with_context` hand off to the UI - [Using AI with Superset](https://superset.apache.org/user-docs/using-superset/using-ai-with-superset/)
- **Evidence:** accept/reject/refine diff with another message; branch off insights; follow-ups; skills - [Evidence editing](https://docs.evidence.dev/editing); [Evidence Agent blog](https://evidence.dev/blog/evidence-agent)
- **Rill:** canvas visual editor property panel or YAML code view; per-user chat memory - [Rill canvas](https://docs.rilldata.com/developers/build/dashboards/canvas); [Rill AI configuration](https://docs.rilldata.com/developers/build/ai-configuration)

### Inferences
- Refinement-by-handoff works because AI output is the same object type the human editor manipulates - a strong argument for an AI-authorable document format shared with a human editor.

### Gaps
- None material.

## Q6. Embedding in an existing app

### Takeaway
Metabase has the most complete embeddable AI (React SDK `MetabotQuestion` / `useMetabot`, Pro/Enterprise). Lightdash embeds agents for customers. Rill embeds dashboards via iframe + postMessage. Superset has an embedded SDK (UNVERIFIED this session) but no native embedded chat. Every product also exposes MCP so external agents (Claude, ChatGPT, Cursor) can drive it.

### Cited Findings
- **Metabase:** `MetabotQuestion` (inside `MetabaseProvider` with `defineMetabaseAuthConfig`), `layout` = `auto|stacked|sidebar`; headless `useMetabot` returns messages, `CurrentChart`, `isProcessing`; requires SSO; one shared conversation per page; agent text is markdown you must render; "AI chat component is only available on Pro and Enterprise plans" - [Embedded AI chat](https://www.metabase.com/docs/latest/embedding/sdk/ai-chat). "Enable Embedded Metabot" toggle covers full-app and modular embeds - [AI settings](https://www.metabase.com/docs/latest/ai/settings)
- **Lightdash:** agents can be embedded so "your customers can ask about their own data"; Slack; MCP server for Claude/ChatGPT/Cursor; external MCP servers callable from agents - [AI agents guide](https://docs.lightdash.com/guides/ai-agents)
- **Superset/Preset:** MCP for Claude Desktop, Claude Code, ChatGPT (ChatGPT needs Pro/Team/Enterprise/Edu) - [Using AI with Superset](https://superset.apache.org/user-docs/using-superset/using-ai-with-superset/). UNVERIFIED this session: `@superset-ui/embedded-sdk` iframe embedding with guest tokens.
- **Evidence:** agent available in Studio, Claude and ChatGPT, same access controls - [Evidence Agent blog](https://evidence.dev/blog/evidence-agent); Studio MCP server - [Evidence Core blog](https://evidence.dev/blog/evidence-core)
- **Rill:** iframe embedding and postMessage Embed API - [Rill docs home](https://docs.rilldata.com/); v0.92.0 "support alerts for embedded users" - [Rill v0.92.0](https://github.com/rilldata/rill/releases/tag/v0.92.0); Rill MCP Server for Claude Desktop/ChatGPT on Cloud projects; MCP Apps render interactive charts in Claude/ChatGPT - [AI quickstart](https://docs.rilldata.com/developers/get-started/ai-quickstart); [AI configuration](https://docs.rilldata.com/developers/build/ai-configuration)

### Inferences
- Metabase's `useMetabot` + `CurrentChart` split (headless conversation state, vendor-rendered chart) is the closest analogue to a chat kit with a pluggable UI catalog.
- Rill rendering charts inside Claude/ChatGPT via MCP Apps shows the generative-UI surface moving to the host chat client.

### Gaps
- Whether Rill embeds AI Chat inside embedded dashboards: not found.
- Lightdash embedding mechanics (iframe vs SDK) for agents: not on fetched pages.

## Q7. Licence and hosting model

### Takeaway
All cores are open source (AGPL for Metabase, MIT for Lightdash outside `ee/`, Apache-2.0 for Superset and Rill, MIT for Evidence), but the AI analyst features are mostly paid or cloud: Lightdash agents need an Enterprise licence key when self-hosted; Preset MCP/Chatbot are Enterprise; Evidence Agent is Studio-only; Rill AI Chat is a Cloud feature. Metabase is the exception: Metabot works on every plan with your own API key, with SDK chat, verified content and Remote Sync on Pro/Enterprise.

### Cited Findings
- **Metabase:** AGPL outside top-level `enterprise/`, Metabase Commercial License inside; `metabase/metabase` Docker image is AGPL, `metabase-enterprise` commercial - [LICENSE.txt](https://github.com/metabase/metabase/blob/master/LICENSE.txt). "Metabot is available on every Metabase plan" - [Metabot docs](https://www.metabase.com/docs/latest/ai/metabot). "Connecting your own AI provider doesn't require a paid Metabase plan"; Metabase-hosted AI is Cloud-only, billed by tokens on top of subscription; providers include Anthropic, Bedrock, Gemini Enterprise, Azure, Ollama/OpenAI-compatible - [AI settings](https://www.metabase.com/docs/latest/ai/settings). MCP server on every plan; MCP tools access/analytics and headless JWT on Pro/Enterprise - [Metabase MCP](https://www.metabase.com/docs/latest/ai/mcp). SDK AI chat Pro/Enterprise - [Embedded AI chat](https://www.metabase.com/docs/latest/embedding/sdk/ai-chat). Agent-driven development/Remote Sync Pro/Enterprise - [Agent-driven development](https://www.metabase.com/docs/latest/ai/agent-driven-development)
- **Lightdash:** MIT except `packages/backend/src/ee` (own licence) - [LICENSE](https://github.com/lightdash/lightdash/blob/main/LICENSE). AI agents carry Pro and Enterprise badges - [AI agents guide](https://docs.lightdash.com/guides/ai-agents). Self-hosted needs an Enterprise licence key (`LIGHTDASH_LICENSE_KEY`), `AI_COPILOT_ENABLED=true`, a provider (OpenAI default; Anthropic, Gemini, Vertex, Azure, OpenRouter, Bedrock); writeback needs `ANTHROPIC_API_KEY` and a sandbox provider - [Self-host AI agents](https://docs.lightdash.com/self-host/enterprise-features/ai-agents). Cloud Pro "$2400 / month, unlimited users" - [pricing](https://lightdash.com/pricing) (search snippet only - UNVERIFIED)
- **Superset/Preset:** Apache-2.0 - [apache/superset](https://github.com/apache/superset). MCP server requires Superset 5.0+ and admin deployment; the AI docs page is labeled unreleased "Next" docs - [Using AI with Superset](https://superset.apache.org/user-docs/using-superset/using-ai-with-superset/); [MCP admin docs](https://superset.apache.org/admin-docs/configuration/mcp-server). Preset MCP "now available for Enterprise customers"; Preset Chatbot beta, contact sales - [Preset MCP announcement](https://preset.io/blog/preset-mcp-announcement/)
- **Evidence:** MIT - [evidence-dev/evidence](https://github.com/evidence-dev/evidence). Evidence Core is open source; Studio is the hosted platform adding hosted dev env, page-level access control, the analytics agent and hosted MCP server - [Evidence Core blog](https://evidence.dev/blog/evidence-core). Agent is "Studio only", enabled per organization - [Evidence Agent docs](https://docs.evidence.dev/features/evidence-agent)
- **Rill:** Apache-2.0 - [rilldata/rill](https://github.com/rilldata/rill). AI Chat and the hosted MCP server are listed as Rill Cloud features; local building uses Rill Developer + local MCP + your coding agent - [AI quickstart](https://docs.rilldata.com/developers/get-started/ai-quickstart)

### Inferences
- The open-source tier typically gives you the declarative format and an MCP/file surface for your own coding agent; the vendor's built-in analyst agent is the monetized layer (except Metabase).

### Gaps
- Evidence Studio and Rill Cloud plan prices/tiers for AI not fetched.
- Evidence Core's licence and repo not confirmed (blog doesn't state it; the MIT figure is for `evidence-dev/evidence`).
- Evidence Agent default model: one docs page says GPT-4o, a LinkedIn post says Claude Opus 4.7 - conflicting, UNVERIFIED (search snippets).

## Q8. Is the dashboard definition a declarative file an LLM can author?

### Takeaway
Yes for four of five, and vendors now market this explicitly for coding agents. Rill (YAML canvas/explore + metrics views) and Evidence (markdown + SQL + components) are file-native - the file is the source of truth. Lightdash (chart/dashboard YAML via CLI, git sync) and Metabase (Representation Format YAML via Remote Sync, Pro/Ent) are DB-native with a YAML projection. Superset's AI path is tool calls against its API, not files.

### Cited Findings
- **Rill:** canvas = `rows:` -> `items:` (each with `width` and one component key such as `kpi_grid`, `line_chart`, `table`), components reference `metrics_view:`; tabs via `tabs:` with `label` + `rows`; `defaults: filters:`, `filters.pinned`, `filters.required`, `if` conditions - [Rill canvas](https://docs.rilldata.com/developers/build/dashboards/canvas). `rill init` writes agent instruction files (Claude Code, Cursor, AGENTS.md) and `.mcp.json` - [AI quickstart](https://docs.rilldata.com/developers/get-started/ai-quickstart)
- **Evidence:** reports are markdown with SQL and components - [Evidence editing](https://docs.evidence.dev/editing); Evidence Core's stated goal is "the best framework for building data apps with coding agents", with statically validatable syntax - [Evidence Core blog](https://evidence.dev/blog/evidence-core)
- **Lightdash:** dashboard YAML `tiles` (`x`, `y`, `w`, `h`, `type: saved_chart`, `properties.chartSlug`), `filters`, `tabs`, `config`; charts hold `metricQuery` + `chartConfig`; editor JSON-schema validation; "AI coding assistants such as Cursor, Claude Code, and Codex can create and edit charts" - [Dashboards as code](https://docs.lightdash.com/guides/developer/dashboards-as-code)
- **Metabase:** [Representation Format](https://github.com/metabase/representations) YAML for questions, dashboards, collections, transforms; agents create content via `mb` CLI then Remote Sync serializes to git - [Agent-driven development](https://www.metabase.com/docs/latest/ai/agent-driven-development); MCP can help create "serialized YAML files that you can import" - [Metabase MCP](https://www.metabase.com/docs/latest/ai/mcp)
- **Superset:** AI creates charts/dashboards via MCP tools; no file-authoring workflow in the AI docs - [Using AI with Superset](https://superset.apache.org/user-docs/using-superset/using-ai-with-superset/). UNVERIFIED: Superset's import/export bundles are ZIPs of YAML (dashboards with `position` layout, charts with `params`), usable as files but not positioned as an AI authoring format.

### Inferences
- Comparison with a JSON-document approach: these formats are all *reference-by-name into a semantic layer* (`metrics_view`, `exploreName`, `chartSlug`, SQL query names) rather than inline data, so the LLM writes small documents and the runtime resolves data - the same property a JSON document gains by referencing app data sources. YAML/markdown choice is driven by git-diffability and human co-editing; validation lives in the product's parser (Rill reconcile, Evidence static validator, Lightdash JSON schema), which is format-agnostic. Lightdash ships a JSON schema for its YAML, showing YAML vs JSON is a surface choice over a schema.
- Two layouts appear: grid coordinates (Lightdash `x/y/w/h`) vs. row/item flow (Rill `rows/items/width`). Flow layouts are easier for LLMs to author without overlap errors (inference, not vendor claim).
- Evidence's markdown-first format mixes narrative and charts, the closest to "LLM writes a document"; its agent emits the same format as human authors.

### Gaps
- Exact Evidence Core syntax and Rill explore-dashboard YAML keys not examined.

## Q9. Genuine strengths per product

### Takeaway
Metabase: broadest AI on a free tier plus the best embeddable chat SDK. Lightdash: deepest agent-ops (verified answers, evals, writeback PRs) on a dbt semantic layer. Superset: open, RBAC-respecting MCP with preview-first safety and a broad tool catalog. Evidence: one format for humans and agent, git-native, agent output mergeable into reports. Rill: file-native YAML dashboards on metrics views with agent-friendly local MCP and an explicit grounding check.

### Cited Findings
- Metabase: Metabot on every plan with BYO key; headless `useMetabot` hook - [AI settings](https://www.metabase.com/docs/latest/ai/settings); [Embedded AI chat](https://www.metabase.com/docs/latest/embedding/sdk/ai-chat)
- Lightdash: verified answers, Issues triage, eval suites as code, writeback PRs - [AI agents guide](https://docs.lightdash.com/guides/ai-agents)
- Superset: preview-first, zero privilege escalation, MCP tool catalog growing to "nearly every part of Superset" (May 2026) - [Preset MCP announcement](https://preset.io/blog/preset-mcp-announcement/); [repo recap May 2026](https://preset.io/blog/apache-superset-repo-recap-may-2026/) (search snippet)
- Evidence: insights branchable and mergeable into reports; context and skills in git - [Evidence Agent blog](https://evidence.dev/blog/evidence-agent)
- Rill: YAML canvas with visual/code toggle; numbers-from-tool-results check; MCP Apps charts in Claude/ChatGPT - [Rill canvas](https://docs.rilldata.com/developers/build/dashboards/canvas); [Rill v0.92.1](https://github.com/rilldata/rill/releases/tag/v0.92.1); [AI configuration](https://docs.rilldata.com/developers/build/ai-configuration)

### Inferences
- Convergence across all five in 2026: MCP server + Agent Skills (`SKILL.md`) + project-context files + user-permission inheritance. Evidence, Rill and Lightdash all adopted the Agent Skills format ([Evidence Agent docs](https://docs.evidence.dev/features/evidence-agent); [Rill AI configuration](https://docs.rilldata.com/developers/build/ai-configuration)); Lightdash's skills support not confirmed.

### Gaps
- No independent quality comparison of the agents found.
