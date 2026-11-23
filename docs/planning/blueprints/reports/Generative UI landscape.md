# How Blueprints fits the generative UI landscape

## Summary

Blueprints sits with the dashboards-as-code tools, where the model writes a declarative spec that persists as an editable document. Unlike [Grafana](https://grafana.com/docs/grafana/latest/whatsnew/whats-new-in-v13-0/), [Power BI](https://learn.microsoft.com/en-us/power-bi/developer/projects/projects-report) or [Cube](https://github.com/cube-js/cube), it is a library inside the host app, over the app's own data and components. Its nearest peers are [Perspective's embedded agent](https://github.com/perspective-dev/perspective/blob/master/docs/md/how_to/javascript/agent.md), which lacks a semantic layer, and [Cube's dashboard agents](https://cube.dev/blog/cube-agentic-analytics), which run only in Cube Cloud. It leads on its document model and finance-aware catalog, and trails on interop standards, governed grounding and maturity, as it is still a draft.

## Landscape map

| Product | Group | Emits | Persists |
|---|---|---|---|
| Hoist Blueprints | Hoist library | Declarative spec | Saved and editable |
| Vercel AI SDK | Generative UI | Tool call to prebuilt component | Thread history |
| json-render | Generative UI | Declarative spec | Saved and editable |
| assistant-ui | Generative UI | Declarative spec | Thread history |
| Tambo | Generative UI | Tool call to prebuilt component | Thread history |
| LangGraph generative UI | Generative UI | Tool call to prebuilt component | Thread history |
| CopilotKit and AG-UI | Generative UI | Tool call to prebuilt component | Thread history |
| A2UI | Generative UI | Declarative spec | One-off |
| OpenUI (Thesys) | Generative UI | Declarative spec | Thread history |
| MCP Apps | Generative UI | Tool call to prebuilt component | Thread history |
| OpenAI Apps SDK and ChatKit | Generative UI | Tool call to prebuilt component | Thread history |
| Hex | AI analytics and BI | Code | Saved and editable |
| ThoughtSpot | AI analytics and BI | Query or text answer | Saved and editable |
| Tableau Pulse | AI analytics and BI | Query or text answer | One-off |
| Tableau Agent and Next | AI analytics and BI | Declarative spec | Saved and editable |
| Power BI Copilot | AI analytics and BI | Declarative spec | Saved and editable |
| Fabric data agents | AI analytics and BI | Query or text answer | One-off |
| Metabase | AI analytics and BI | Query or text answer | Saved and editable |
| Lightdash | AI analytics and BI | Query or text answer | Saved and editable |
| Superset and Preset | AI analytics and BI | Query or text answer | Saved and editable |
| Evidence | AI analytics and BI | Code | Saved and editable |
| Rill | AI analytics and BI | Query or text answer | Thread history |
| Bloomberg ASKB | AI analytics and BI | Query or text answer | One-off |
| Cube | Semantic layer | Query or text answer | Saved and editable |
| dbt Semantic Layer and Apache Ossie | Semantic layer | Query or text answer | One-off |
| Malloy | Semantic layer | Query or text answer | One-off |
| Snowflake semantic views | Semantic layer | Query or text answer | One-off |
| Databricks metric views | Semantic layer | Query or text answer | One-off |
| Looker | Semantic layer | Query or text answer | One-off |
| AtScale | Semantic layer | Query or text answer | One-off |
| Grafana | Dashboards as JSON or code | Declarative spec | Saved and editable |
| Vega-Lite | Dashboards as JSON or code | Declarative spec | Saved and editable |
| Flint and Data Formulator | Dashboards as JSON or code | Declarative spec | Saved and editable |
| Perspective | Dashboards as JSON or code | Declarative spec | Saved and editable |
| AG Grid AI Toolkit | Dashboards as JSON or code | Declarative spec | One-off |
| interop.io io.Intelligence | Dashboards as JSON or code | Tool call to prebuilt component | Saved and editable |
| HERE Studio | Dashboards as JSON or code | Code | Saved and editable |

Judgment calls: json-render and Perspective count as "Saved and editable" because their output is a standalone, editable document, though the host app stores it. Tableau Agent and Next count as "Declarative spec" because they write Tableau's own view definitions, but the agent's wire format is unverified. HERE Studio's output format is undisclosed, so "Code" is unverified. Databricks rows reflect metric views, since Genie's output was not researched.

## Comparison

| Product | Model emits | Validation and safety | Persistent and editable | Live data and semantic layer | Refinement | Embeds | Licence or hosting |
|---|---|---|---|---|---|---|---|
| [Hoist Blueprints](../spec.md) | JSON document, edited through JSON Pointer ops | Schema and semantic checks; atomic edits; typed actions | Drafts, numbered publishes, presets, history, undo | Data Catalog with field kinds; Cube views, browser joins | Chat, design mode or raw JSON, all as edits | Hoist library inside the host app | App hosts data, storage and LLM relay |
| [Vercel AI SDK](https://github.com/vercel/ai/blob/main/content/docs/04-ai-sdk-ui/04-generative-user-interfaces.mdx) | Tool calls mapped to app components | Zod tool inputs; developer-written components | Replays stored message history | Tool results; no semantic layer | New chat turn | npm library, any backend | Apache-2.0 |
| [json-render](https://github.com/vercel-labs/json-render/blob/main/README.md) | Flat element map, streamed as JSON Patch | Catalog allowlist, Zod props, `validateSpec` | Standalone spec; app stores it | JSON Pointer state; no semantic layer | Patch, merge or diff edit modes | React plus many other renderers | Apache-2.0, Vercel Labs |
| [assistant-ui](https://github.com/assistant-ui/assistant-ui/blob/main/apps/docs/content/docs/tools/generative-ui-formats.mdx) | Component tree, spec or sandboxed HTML | Specs run no code; cross-site widget sandbox | Thread history; optional cloud | Spec state and `$calc`; none | `prompt_user` and follow-ups | React primitives, several runtimes | MIT plus optional cloud |
| [Tambo](https://github.com/tambo-ai/tambo/blob/main/README.md) | Zod-validated props for registered components | Zod prop schemas | Threads; interactable components persist | MCP and local tools; none | Model updates interactable components | React SDK plus backend | MIT; cloud shut 2026-10-31 |
| [LangGraph generative UI](https://docs.langchain.com/langsmith/generative-ui-react) | `{name, props}` pushed into UI state | Developer components; shadow DOM isolates styles only | Graph state, merged by ID | Graph tools; none | Merge or delete by ID | Needs LangSmith deployment | MIT; LangSmith commercial |
| [CopilotKit and AG-UI](https://github.com/CopilotKit/CopilotKit) | Tool calls, A2UI specs or MCP Apps | Zod props; MCP Apps sandbox | Threads survive reloads | Shared agent and UI state; none | Shared state, interrupts | React, Angular, Vue, Slack | MIT; optional hosted tier |
| [A2UI](https://a2ui.org/specification/v1.0-a2ui/) | JSON surface and data-model updates | Host catalog, schema, functions by name only | Surfaces update by ID; host stores | JSON Pointer data model; none | `action` events to the agent | Six native renderer families | Apache-2.0, Google-led |
| [OpenUI (Thesys)](https://github.com/thesysdev/openui/blob/main/README.md) | OpenUI Lang over registered components | Zod components; Autofix repair | Threads; streams progressively | Claimed but undocumented; none | Follow-up turns | React, Vue, Svelte, Angular | MIT; paid OpenUI Cloud |
| [MCP Apps](https://modelcontextprotocol.io/seps/1865-mcp-apps-interactive-user-interfaces-for-mcp) | Tool call; host renders developer HTML | Sandboxed iframe, audit log, user consent | Live iframe in the chat | Tool results and UI tool calls | Follow-up messages, tool calls | Any MCP Apps host | Apache-2.0 |
| [OpenAI Apps SDK and ChatKit](https://developers.openai.com/apps-sdk) | MCP tool calls; fixed widget JSON | Approval gates, Directory review | Chat history | Tool results; none | Follow-ups and widget actions | ChatGPT and Codex only | Free to build; OpenAI-hosted |
| [Hex](https://learn.hex.tech/docs/getting-started/ai-overview) | SQL, Python and JavaScript app code | Per-cell accept; Governed mode; evals | Threads backed by editable projects | Own YAML models; imports dbt, Cube, Snowflake | Prompt, or edit the code | Presigned iframe; MCP server | SaaS, per editor seat |
| [ThoughtSpot](https://docs.thoughtspot.com/cloud/latest/spotter) | Search tokens; whole Liveboards | RLS and CLS; coaching; benchmarks | Standard Liveboards; ten checkpoints | TML models; live warehouse queries | Tokens, prompts, Liveboard editing | Visual Embed SDK, React, MCP | SaaS; LLM tokens unmetered |
| [Tableau Pulse](https://docs.salesforce.com/tableau/current/en-us/online/pulse_intro.md) | Narration of precomputed insights | Certified metrics; Einstein Trust Layer | Metric persists; summaries regenerate | Metric definitions on data sources | Filters and follow-ups | `<tableau-pulse>` web component | SaaS; Tableau+ for some features |
| [Tableau Agent and Next](https://help.tableau.com/current/pro/desktop/en-us/desktop_einstein.htm) | Views and calculations; Next viz JSON (unverified) | Semantic model checks; Q&A Calibration | Saved workbooks and Next assets | Tableau Semantics on Data 360 | Prompt, then normal authoring | Embedding SDK; read-only MCP | SaaS; Server needs own LLM |
| [Power BI Copilot](https://learn.microsoft.com/en-us/power-bi/create-reports/copilot-create-reports) | Report pages and visuals | Verified answers; PBIR JSON schemas | Ordinary reports; PBIR files | Semantic models through DAX | Prompt to add, change, delete; undo | Secure embeds; app-owns-data unverified | Fabric capacity units |
| [Fabric data agents](https://learn.microsoft.com/en-us/fabric/data-science/concept-data-agent) | Read-only SQL, DAX or KQL | User credentials, RLS, Purview | History may not persist | Lakehouse, warehouse, semantic models | Follow-ups within 25-row context | M365 Copilot, Teams, Foundry | Fabric F2 or higher |
| [Metabase](https://www.metabase.com/docs/latest/ai/metabot) | Query-builder questions or SQL | User permissions; SQL reviewed before running | Saves to dashboards; YAML sync | Models, metrics, segments | Follow-ups; open in editor | React SDK, `useMetabot` | AGPL; free with own key |
| [Lightdash](https://docs.lightdash.com/guides/ai-agents) | `metricQuery` over dbt explores | Verified answers; evals; PR writeback | Dashboards; YAML via CLI and PRs | dbt semantic layer | Explore, then back to agent | Customer embeds; MCP server | MIT core; agents need Enterprise |
| [Superset and Preset](https://superset.apache.org/user-docs/using-superset/using-ai-with-superset/) | MCP tool calls that build charts | RBAC; preview before save | Saved charts; last-write-wins layout | Datasets with metrics | `update_chart`; Explore links | MCP only; no native chat yet | Apache-2.0; Preset Enterprise |
| [Evidence](https://evidence.dev/blog/evidence-agent) | Evidence Markdown with SQL | Diff to accept; static validator | Git repo; branch and merge | SQL sources; YAML metrics | Refine the diff; follow-ups | Studio, Claude, ChatGPT | MIT; agent in Studio only |
| [Rill](https://docs.rilldata.com/developers/build/ai-configuration) | Metrics-view queries; YAML via coding agents | Security policies; numbers-from-tools check | Chat; dashboards are YAML files | Metrics views | Visual or YAML editor | Iframe embed; MCP Apps charts | Apache-2.0; AI Chat in Cloud |
| [Bloomberg ASKB](https://www.marketsmedia.com/bloomberg-introduces-agentic-ai-to-the-terminal/) | Charts, tables and BQL | Not described | Workflow templates save | BQL over Bloomberg data | Natural-language follow-ups | Terminal only | Terminal entitlement |
| [Cube](https://docs.cube.dev/reference/embed-apis/chat-api) | REST query JSON; Semantic SQL plus Vega-Lite | Closed vocabulary; token-scoped RLS | Workbooks and dashboards agents keep editing | Own semantic layer, queried live | Chat plus direct widget edits | Embeddable components; Chat API | Core Apache-2.0; agents Cloud only |
| [dbt Semantic Layer and Apache Ossie](https://docs.getdbt.com/docs/dbt-ai/mcp-available-tools) | `query_metrics` tool calls | Read-only; closed metric names | One-off results | MetricFlow metrics | Conversation in the MCP client | MCP, GraphQL, JDBC | Apache-2.0 engine; hosted APIs paid |
| [Malloy](https://docs.malloydata.dev/documentation/user_guides/publishing/mcp_agents) | Malloy query text with render tags | Compile before run | Not documented | Malloy models | Conversation in the MCP client | MCP, REST, React SDK | MIT, self-hostable |
| [Snowflake semantic views](https://docs.snowflake.com/en/user-guide/views-semantic/semantic-view-yaml-spec) | SQL via Cortex Analyst | Verified queries; private fields | One-off | Semantic views with synonyms | Not researched | Not researched | Snowflake service |
| [Databricks metric views](https://docs.databricks.com/aws/en/metric-views/semantic-metadata) | Not researched (Genie) | Not researched | Not researched | Metric views with synonyms and formats | Not researched | Not researched | Databricks service |
| [Looker](https://docs.cloud.google.com/looker/docs/mcp) | LookML-backed queries via MCP | Agent inherits user's roles | Commit changes in Looker UI | LookML models | Not researched | MCP; Conversational Analytics API | Google Cloud; MCP in preview |
| [AtScale](https://www.atscale.com/blog/enterprise-ai-mcp-semantic-layer/) | Queries via in-product MCP | Not researched | Not researched | SML semantic models | Not researched | MCP endpoint | SML is open source |
| [Grafana](https://grafana.com/docs/grafana/latest/as-code/observability-as-code/schema-v2/) | v2 dashboard JSON (Assistant format unverified) | CUE schema, Zod; checks panels return data | Versions; Git Sync PRs | Opaque per-plugin queries | Plans, panel actions, JSON view | Assistant only inside Grafana | AGPL; Assistant needs Grafana Cloud |
| [Vega-Lite](https://github.com/vega/vega-lite) | Chart JSON spec | Versioned JSON Schemas; CSP interpreter | Spec files | Inline, URL or runtime data | Edit the spec | JavaScript library | BSD-3-Clause |
| [Flint and Data Formulator](https://github.com/microsoft/flint-chart) | Short semantic chart specs | Compiler fills low-level settings | Branching, editable chart history | Data semantic model; connectors | Style agent; branch from any point | React component, MCP server | MIT |
| [Perspective](https://github.com/perspective-dev/perspective/blob/master/docs/md/how_to/javascript/agent.md) | Viewer and workspace config via tools | Entitlements; generated schemas; strict restore | Versioned save tokens the host stores | Named tables; host data notes | Chat tab beside settings UI | Web component, React | Apache-2.0; bring your own model |
| [AG Grid AI Toolkit](https://www.ag-grid.com/javascript-data-grid/ai-toolkit.md) | Grid state JSON | Host validates against JSON Schema | Ephemeral unless host saves | Column descriptions | Model returns only changes | Inside AG Grid | Enterprise licence |
| [interop.io io.Intelligence](https://docs-ai.interop.io/modules/mcp/capabilities) | MCP calls that compose workspaces | User confirmation required | Saved JSON workspace layouts | Each app's own data | In-chat drag and drop | Is the desktop shell | Commercial |
| [HERE Studio](https://www.here.io/blog/product/the-ai-enterprise-browser-inside-here-studio) | Apps or widgets, format undisclosed | Approved connectors only | Published into Supertabs | Organization's data connectors | Not described | Is the browser shell | Commercial |

## How Blueprints compares

### Where Blueprints is ahead

- **One document for model, designer and user.** The Architect, design mode, a raw JSON edit and a grid sort all make the same checked edit, with history and undo. [Hex](https://learn.hex.tech/docs/explore-data/threads) and [Evidence](https://docs.evidence.dev/editing) come closest, since agent and human edit the same code.
- **Atomic, validated edits against a version base.** An edit applies whole or not at all, and returns coded issues with optional fixes. By contrast, [json-render](https://github.com/vercel-labs/json-render/blob/main/apps/web/content/docs/api/core.mdx) leaves storage and undo to the app, [Grafana Assistant](https://grafana.com/docs/grafana-cloud/machine-learning/assistant/guides/dashboarding/) cannot undo once the dashboard has changed, and [Superset](https://superset.apache.org/user-docs/using-superset/using-ai-with-superset/) layout edits are last-write-wins.
- **Typed variables and widget-to-widget bindings.** A grid's selection can filter a chart or set a source parameter through a declared writer. [Grafana](https://github.com/grafana/grafana/blob/main/apps/dashboard/kinds/v2/dashboard_spec.cue) links panels only through dashboard variables, [Perspective](https://github.com/perspective-dev/perspective/blob/master/rust/perspective-viewer/src/rust/agent/tools.rs) cross-filters by row selection, and [Vega-Lite](https://vega.github.io/vega-lite/docs/parameter.html) selections stay inside one spec.
- **Finance-aware field kinds.** A kind such as `pnl`, `bps` or `ticker` sets format, aggregator and renderer once for every blueprint. [Apache Ossie](https://raw.githubusercontent.com/open-semantic-interchange/OSI/main/core-spec/spec.md) and [Snowflake](https://docs.snowflake.com/en/user-guide/views-semantic/semantic-view-yaml-spec) carry no format at all, and [Databricks](https://docs.databricks.com/aws/en/metric-views/semantic-metadata) formats have no finance kinds.
- **Runs on the app's own stack.** Blueprints renders Hoist components over the app's data layer, storage and LLM relay. [Cube's agents](https://github.com/cube-js/cube) need Cube Cloud, [Grafana Assistant](https://grafana.com/docs/grafana/latest/whatsnew/whats-new-in-v13-0/) needs a Grafana Cloud account, and [Power BI Copilot](https://learn.microsoft.com/en-us/power-bi/create-reports/copilot-introduction) needs Fabric capacity.
- **Authoring and running are separate.** Designers edit a draft, publish numbered versions and define presets, while users run the latest publish. [A2UI](https://a2ui.org/specification/v1.0-a2ui/) and [json-render](https://github.com/vercel-labs/json-render/blob/main/apps/web/content/docs/api/core.mdx) leave such storage to the host. Personalizations are deferred in the plan.
- **The model never sees dataset rows.** The Architect gets only schemas for dataset sources, like [Perspective's default](https://github.com/perspective-dev/perspective/blob/master/docs/md/how_to/javascript/agent.md) and [A2UI's server-side binding](https://developers.googleblog.com/a2ui-10-build-delightful-fast-reliable-agentic-experiences/). [Cube's Chat API](https://docs.cube.dev/reference/embed-apis/chat-api) instead returns up to 100 result rows in its tool calls.
- **Chat answers rebind into dashboards.** An answer is itself a blueprint, and adding it to a host maps its literals onto the host's variables and sources. [Hex](https://learn.hex.tech/docs/explore-data/threads) and [ThoughtSpot](https://developers.thoughtspot.com/docs/custom-chatbot-integration-mcp) also turn answers into saved artifacts.
- **Joins without backend work.** A source can left-join other sources by key, choosing a mode from each side's grain. Semantic layers such as [Cube](https://docs.cube.dev/reference/embed-apis/chat-api) and [dbt](https://docs.getdbt.com/docs/dbt-ai/mcp-available-tools) join on the server, which an app must first set up.

### Where others are ahead

- **Maturity.** Blueprints is a draft spec running in Toolbox, and its move to hoist-react, `openBlueprint` and personalizations are still planned. [A2UI 1.0](https://developers.googleblog.com/a2ui-10-build-delightful-fast-reliable-agentic-experiences/), [AG-UI 1.0](https://github.com/ag-ui-protocol/ag-ui) and [MCP Apps](https://github.com/modelcontextprotocol/ext-apps) are stable, with named enterprise adopters.
- **Reach beyond one framework.** A2UI renders natively on web, Flutter, SwiftUI and Compose ([roadmap](https://a2ui.org/roadmap/)), and MCP Apps run in ChatGPT, Claude and VS Code ([ext-apps](https://github.com/modelcontextprotocol/ext-apps)). Blueprints renders only in Hoist desktop apps, and a mobile renderer is unscheduled.
- **Agents served to Claude and ChatGPT.** [Rill](https://docs.rilldata.com/developers/build/ai-configuration), [Hex](https://learn.hex.tech/docs/hex-4-0/what-is-hex-4-0), [Metabase](https://www.metabase.com/docs/latest/ai/mcp) and [ThoughtSpot](https://developers.thoughtspot.com/docs/custom-chatbot-integration-mcp) expose MCP servers to outside agents. The Architect runs only in the browser, and a server-run Architect is open question Q22.
- **Expressive range.** [Hex Generative apps](https://learn.hex.tech/docs/share-insights/apps/generative-apps), [assistant-ui widgets](https://github.com/assistant-ui/assistant-ui/blob/main/apps/docs/content/docs-sites/generative-frame/security.mdx) and [MCP Apps](https://modelcontextprotocol.io/seps/1865-mcp-apps-interactive-user-interfaces-for-mcp) can show any web UI, sandboxed where the code is untrusted. Blueprints shows only registered widgets, by design, so a new visual needs app code.
- **Governed grounding and evals.** [ThoughtSpot](https://docs.thoughtspot.com/cloud/latest/notes) ships a benchmark platform, [Lightdash](https://docs.lightdash.com/guides/ai-agents) eval suites as code, and [Power BI](https://learn.microsoft.com/en-us/power-bi/create-reports/copilot-prepare-data-ai) verified answers. Blueprints' scenario harness is internal, and catalog fields have `guidance` but no synonyms or verified examples.
- **Checking the data, not only the document.** [Grafana Assistant](https://grafana.com/docs/grafana-cloud/machine-learning/assistant/guides/dashboarding/) checks that panels return data, and [Rill](https://github.com/rilldata/rill/releases/tag/v0.92.1) checks that the analyst's numbers come from tool results. Blueprints validates schema and semantics only.
- **Identity-scoped execution.** [Cube](https://docs.cube.dev/reference/embed-apis/chat-api), [Fabric data agents](https://learn.microsoft.com/en-us/fabric/data-science/concept-data-agent) and [Metabase](https://www.metabase.com/docs/latest/ai/settings) run every agent query as the user, with row-level security in the layer. Blueprints leaves this to the app, and browser aggregation means access control must happen before rows arrive.
- **Human review before an AI edit lands.** [Hex](https://learn.hex.tech/docs/explore-data/notebook-view/notebook-agent) holds each changed cell for accept or undo, [Evidence](https://docs.evidence.dev/editing) shows diffs, and [Grafana](https://grafana.com/docs/grafana/latest/whatsnew/whats-new-in-v13-0/) and [Lightdash](https://docs.lightdash.com/guides/developer/dashboards-as-code) route edits through Git pull requests. An Architect edit applies at once, with undo and history afterwards.
- **Compact model targets.** [OpenUI Lang](https://github.com/thesysdev/openui/blob/main/README.md) claims fewer tokens than JSON specs (vendor benchmark), and [Flint](https://github.com/microsoft/flint-chart) compiles short specs into verbose chart config. Blueprints has not measured its JSON against either.

### What to borrow

- **Tool entitlements, from [Perspective](https://github.com/perspective-dev/perspective/blob/master/docs/md/how_to/javascript/agent.md).** A tool the app withholds is never offered to the model. Blueprints would let an app hide `query_dataset` or `edit_blueprint` outright, rather than only refusing calls inside them.
- **Plan then build, from [Grafana Assistant](https://grafana.com/docs/grafana-cloud/machine-learning/assistant/guides/dashboarding/).** The Architect would propose tabs, widgets and variables for approval before a whole-dashboard build. That adds a checkpoint before its costliest request.
- **Result checks, from [Grafana Assistant](https://grafana.com/docs/grafana-cloud/machine-learning/assistant/guides/dashboarding/) and [Rill](https://github.com/rilldata/rill/releases/tag/v0.92.1).** The validator would warn when a new widget's source returns no rows, and check that numbers in an answer's text come from tool results.
- **AI context on fields, from [Apache Ossie](https://raw.githubusercontent.com/open-semantic-interchange/OSI/main/core-spec/spec.md) and [Snowflake](https://docs.snowflake.com/en/user-guide/views-semantic/semantic-view-yaml-spec).** Catalog fields would gain `synonyms` and example questions, matching OSI's `ai_context`. That also opens an import path from OSI into the Data Catalog.
- **Verified answers and evals, from [Lightdash](https://docs.lightdash.com/guides/ai-agents) and [ThoughtSpot](https://docs.thoughtspot.com/cloud/latest/notes).** Ship the scenario harness as an eval kit apps run on their own catalog. Apps could also pin verified blueprints that guide the Architect.
- **Pending edits, from [Hex](https://learn.hex.tech/docs/explore-data/notebook-view/notebook-agent) and [Evidence](https://docs.evidence.dev/editing).** A large Architect edit would show as a diff to accept, built with the existing `diffOps`. Small edits keep applying at once, with undo.
- **"How it arrived", from [ThoughtSpot](https://www.thoughtspot.com/press-releases/thoughtspot-deepens-integration-with-claude-to-advance-agentic-analytics-for-the-enterprise) and [Power BI](https://learn.microsoft.com/en-us/power-bi/create-reports/copilot-prepare-data-ai).** Each widget would show its dataset, parameters, filter and field definitions, as Spotter shows its tokens. A user could then check a number against its definition.
- **Answers in outside chat hosts, from [Rill](https://docs.rilldata.com/developers/build/ai-configuration).** Serve answer blueprints as MCP Apps, as Rill serves charts to Claude and ChatGPT. Blueprints would reach users outside Hoist apps, which matters only once an app asks for it.

## Generative UI libraries and protocols

### [Vercel AI SDK](https://github.com/vercel/ai/blob/main/content/docs/04-ai-sdk-ui/04-generative-user-interfaces.mdx)

- Emits tool calls. The app switches on typed `tool-${name}` parts and renders its own React component ([docs](https://github.com/vercel/ai/blob/main/content/docs/04-ai-sdk-ui/04-generative-user-interfaces.mdx)).
- Safety rests on Zod `inputSchema` on developer-defined tools. Whether tool outputs are schema-checked is unverified.
- Persistence is stored `UIMessage[]` that re-render; refinement is a new chat turn ([persistence](https://github.com/vercel/ai/blob/main/content/docs/04-ai-sdk-ui/03-chatbot-message-persistence.mdx)). Data comes from tool results, with no semantic layer.
- AI SDK RSC streams server components from `streamUI`, but its docs call it experimental and recommend AI SDK UI ([RSC overview](https://github.com/vercel/ai/blob/main/content/docs/05-ai-sdk-rsc/01-overview.mdx)).
- npm library for any backend, Apache-2.0 ([LICENSE](https://github.com/vercel/ai/blob/main/LICENSE)). `ai` 7.0.179 shipped 2026-11-20 ([releases](https://github.com/vercel/ai/releases)).

Checked 2026-11-21.

### [json-render](https://github.com/vercel-labs/json-render/blob/main/README.md)

- Emits a flat `root` plus `elements` map of `{type, props, children}`, streamed as RFC 6902 JSONL patches ([streaming](https://github.com/vercel-labs/json-render/blob/main/apps/web/content/docs/streaming.mdx)).
- Safety: catalog allowlist, Zod props, named actions and `validateSpec`; v0.23.1 bounded hostile specs ([catalog](https://github.com/vercel-labs/json-render/blob/main/apps/web/content/docs/catalog.mdx); [changelog](https://github.com/vercel-labs/json-render/blob/main/apps/web/content/docs/changelog.mdx)).
- Refinement passes `currentSpec` with `patch`, `merge` or `diff` edit modes. Experimental Jev has the model only pick from app-supplied candidates ([core API](https://github.com/vercel-labs/json-render/blob/main/apps/web/content/docs/api/core.mdx); [Jev](https://github.com/vercel-labs/json-render/blob/main/apps/web/content/docs/jev.mdx)).
- Data binds through a `state` model with `$state` and `$bindState` JSON Pointers, and `watch` actions fetch live data; no semantic layer ([data binding](https://github.com/vercel-labs/json-render/blob/main/apps/web/content/docs/data-binding.mdx)).
- Specs export to standalone code; the app owns storage and versions ([code export](https://github.com/vercel-labs/json-render/blob/main/apps/web/content/docs/code-export.mdx)).
- `<Renderer>` drops into any React tree, with renderers from Vue to SwiftUI. Apache-2.0, v0.23.2 on 2026-11-18 ([README](https://github.com/vercel-labs/json-render/blob/main/README.md)).

Checked 2026-11-21.

### [assistant-ui](https://github.com/assistant-ui/assistant-ui/blob/main/apps/docs/content/docs/tools/generative-ui-formats.mdx)

- Four answer formats: markdown, a `present` tree of your components, a `render_spec` spec with state and bindings, and model-written HTML widgets ([formats](https://github.com/assistant-ui/assistant-ui/blob/main/apps/docs/content/docs/tools/generative-ui-formats.mdx)).
- Spec mode "runs no model-written code". Widgets run in a cross-site Safe Content Frame with a `default-src 'none'` CSP ([security](https://github.com/assistant-ui/assistant-ui/blob/main/apps/docs/content/docs-sites/generative-frame/security.mdx)).
- Its published comparison found specs scored at or above `present` trees, and widgets won only computational tasks ([formats](https://github.com/assistant-ui/assistant-ui/blob/main/apps/docs/content/docs/tools/generative-ui-formats.mdx)).
- Output persists as thread history, with optional hosted Assistant Cloud. Refinement uses `prompt_user` and follow-up messages ([README](https://github.com/assistant-ui/assistant-ui/blob/main/README.md)).
- MIT React primitives with runtimes for AI SDK, LangGraph and custom backends. `@assistant-ui/core` 0.3.37 shipped 2026-11-18 ([releases](https://github.com/assistant-ui/assistant-ui/releases)).

Checked 2026-11-21.

### [Tambo](https://github.com/tambo-ai/tambo/blob/main/README.md)

- **Status: Tambo Cloud shut down.** The hosted API stopped 2026-10-31, and user data is deleted 2026-11-30. The open source stays self-hostable, with no maintenance commitment ([shutdown post](https://tambo.co/blog/posts/tambo-is-shutting-down)).
- Emits tool calls whose arguments are Zod-validated props for registered components ([README](https://github.com/tambo-ai/tambo/blob/main/README.md)).
- "Interactable components" persist on the page and update as users refine requests; threads live in the Tambo backend ([README](https://github.com/tambo-ai/tambo/blob/main/README.md)).
- Data arrives through MCP servers, browser-side tools and `contextHelpers`; no semantic layer.
- MIT SDK, with `apps/api` under Apache-2.0. Last release `react-v1.4.0` on 2026-10-08 ([releases](https://github.com/tambo-ai/tambo/releases)).

Checked 2026-11-21.

### [LangGraph generative UI](https://docs.langchain.com/langsmith/generative-ui-react)

- Graph code pushes `{name, props}` UI messages into a `ui` state channel. The client loads components bundled with the agent ([docs](https://docs.langchain.com/langsmith/generative-ui-react)).
- Components are trusted developer code. They render in a shadow DOM, which isolates styles, not code.
- A push with the same `id` and `merge: true` updates props, and `ui.delete(id)` removes an element. UI persists as graph state, so likely with the thread (unverified).
- Needs LangSmith and the Agent Server to bundle and serve components. Libraries are MIT; LangSmith pricing is unverified ([langgraphjs](https://github.com/langchain-ai/langgraphjs)).

Checked 2026-11-21.

### [CopilotKit and AG-UI](https://github.com/CopilotKit/CopilotKit)

- AG-UI is an event protocol, not a UI spec: 31 event types in eight families, including JSON Patch `StateDelta` ([AG-UI README](https://github.com/ag-ui-protocol/ag-ui); [events](https://docs.ag-ui.com/concepts/events)).
- CopilotKit renders three tiers: registered components via Zod-typed tool calls, A2UI specs, and MCP Apps in a sandbox ([CopilotKit README](https://github.com/CopilotKit/CopilotKit); [docs](https://docs.copilotkit.ai/generative-ui)).
- Agent and UI share one state layer, and conversations "survive reloads, devices, and sessions, with generative UI intact" ([README](https://github.com/CopilotKit/CopilotKit)).
- React is GA, with Angular, Vue and React Native. AG-UI has first-party integrations with Google ADK, AWS Strands and Microsoft Agent Framework ([AG-UI docs](https://docs.ag-ui.com/introduction)).
- MIT, with optional CopilotKit Intelligence, cloud or self-hosted. The AG-UI 1.0 date rests on one secondary source ([byteiota](https://byteiota.com/ag-ui-1-stable-spec/)); CopilotKit's funding and usage figures are unverified.
- AG-UI lists Open-JSON-UI as another UI spec; its origin and backer are unverified ([AG-UI README](https://github.com/ag-ui-protocol/ag-ui)).

Checked 2026-11-21.

### [A2UI](https://a2ui.org/specification/v1.0-a2ui/)

- **Status: 1.0 stable on 2026-11-11; the repo moved to the `a2ui-project` org** ([blog](https://developers.googleblog.com/a2ui-10-build-delightful-fast-reliable-agentic-experiences/); [repo](https://github.com/a2ui-project/a2ui)).
- Emits JSON envelopes (`createSurface`, `updateComponents`, `updateDataModel`, `deleteSurface`) over a flat component list linked by ID ([spec](https://a2ui.org/specification/v1.0-a2ui/)).
- Safety: a host-owned catalog, schema validation, and functions called by name with `allowedCallers`. No executable code; built for remote, untrusted agents ([README](https://github.com/a2ui-project/a2ui/blob/main/README.md)).
- A separate data model binds by JSON Pointer `@path`, with two-way inputs. Server-side binding means "sensitive values never reach the model" ([blog](https://developers.googleblog.com/a2ui-10-build-delightful-fast-reliable-agentic-experiences/)).
- Surfaces update by ID, but storage is the host's. Refinement is `action` events back to the agent ([spec](https://a2ui.org/specification/v1.0-a2ui/)).
- Apache-2.0, with renderers for React, Lit, Angular, Flutter, SwiftUI and Compose. Named adopters include Atlassian and Bloomberg ([roadmap](https://a2ui.org/roadmap/); [blog](https://developers.googleblog.com/a2ui-10-build-delightful-fast-reliable-agentic-experiences/)).

Checked 2026-11-21.

### [OpenUI (Thesys)](https://github.com/thesysdev/openui/blob/main/README.md)

- **Status: Thesys C1 became OpenUI.** OpenUI launched 2026-03-11 as "the actively developed successor to C1", and C1 docs moved under `/legacy` ([legacy docs](https://docs.thesys.dev/legacy)).
- Emits OpenUI Lang, a compact streaming language over registered components. Vendor benchmark: 4,800 tokens against 10,180 for json-render over seven scenarios ([README](https://github.com/thesysdev/openui/blob/main/README.md)).
- Components take Zod schemas, the system prompt comes from the library, and "Autofix" repairs invalid output ([docs](https://www.openui.com/docs)).
- Renders each component as its line arrives; Agent Interface provides threads. Its "built-in data fetching" is claimed but undocumented.
- MIT, for React, Vue, Svelte and Angular. OpenUI Cloud lists a free tier of 3K calls a month ([pricing](https://www.thesys.dev/pricing)); a third-party page says 5K ([toolradar](https://toolradar.com/tools/thesys/pricing)).

Checked 2026-11-21.

### [MCP Apps](https://modelcontextprotocol.io/seps/1865-mcp-apps-interactive-user-interfaces-for-mcp)

- **Status: MCP-UI is "now standardized into MCP Apps".** SEP-1865 is Final, and the 2026-01-26 spec is stable ([mcpui.dev](https://mcpui.dev/); [ext-apps](https://github.com/modelcontextprotocol/ext-apps)).
- The developer predeclares `ui://` HTML templates. The model only calls the tool, and the host renders the template with the result ([SEP-1865](https://modelcontextprotocol.io/seps/1865-mcp-apps-interactive-user-interfaces-for-mcp)).
- Safety: sandboxed iframe, reviewable templates, auditable JSON-RPC, and user consent for UI-initiated tool calls ([SEP-1865](https://modelcontextprotocol.io/seps/1865-mcp-apps-interactive-user-interfaces-for-mcp)).
- Data flows through tool results and tool calls from the UI; no semantic layer. The UI refines by sending follow-up messages.
- Hosts include ChatGPT, Claude, VS Code and Goose. Apache-2.0, ext-apps v2.1.0 on 2026-11-10 ([ext-apps](https://github.com/modelcontextprotocol/ext-apps)).

Checked 2026-11-21.

### [OpenAI Apps SDK and ChatKit](https://developers.openai.com/apps-sdk)

- **Status: the Apps SDK docs now say "Plugins", and ChatGPT is fully MCP Apps-compatible since 2026-02-22** ([plugins index](https://developers.openai.com/apps-sdk); [changelog](https://developers.openai.com/apps-sdk/changelog)).
- Tools return MCP UI resources. Safety comes from approval-gated tools, app permission controls and Directory review ([changelog](https://developers.openai.com/apps-sdk/changelog)). Developers report inconsistent CSP after redeploys ([forum](https://community.openai.com/t/published-apps-sdk-widget-updates-csp-behavior-inconsistent-after-redeploy-anyone-else-seeing-this/1381690)).
- ChatKit widgets are a fixed node set designed in Widget Builder and served from your backend ([guide](https://developers.openai.com/api/docs/guides/chatkit-widgets)). Whether the model composes widget JSON freely is unverified.
- Refinement: plugin UI sends follow-up messages and calls tools; widget actions reach the backend through `onAction` ([guide](https://developers.openai.com/api/docs/guides/chatkit-widgets)).
- Renders only in ChatGPT and Codex. Free to build; ChatKit's licence is unverified.

Checked 2026-11-21.

## AI analytics and BI

### [Hex](https://learn.hex.tech/docs/getting-started/ai-overview)

- Emits code. Notebook Agent writes SQL, Python and chart cells, and Generative apps are agent-written JavaScript pushed live ([notebook agent](https://learn.hex.tech/docs/explore-data/notebook-view/notebook-agent); [generative apps](https://learn.hex.tech/docs/share-insights/apps/generative-apps)).
- Each changed cell waits for accept or undo. Governed mode limits Threads to endorsed sources and semantic models ([Threads](https://learn.hex.tech/docs/explore-data/threads)).
- Each Thread is backed by a real, editable project. Hex 4.0 (beta) projects are "defined entirely by code" and editable over MCP ([4.0](https://learn.hex.tech/docs/hex-4-0/what-is-hex-4-0)).
- Semantic models are YAML, synced from dbt MetricFlow, Cube, Snowflake Semantic Views and Apache Ossie ([semantic models](https://learn.hex.tech/docs/connect-to-data/semantic-models/intro-to-semantic-models)).
- Embeds through presigned iframes, Enterprise only ([signed embedding](https://learn.hex.tech/docs/share-insights/embedding/signed-embedding)). SaaS: Professional $36 and Team $75 per editor a month ([pricing](https://hex.tech/pricing/)).

Checked 2026-11-21.

### [ThoughtSpot](https://docs.thoughtspot.com/cloud/latest/spotter)

- Spotter turns questions into ThoughtSpot search tokens, shown with each answer. SpotterViz builds whole Liveboards from prompts ([Spotter](https://docs.thoughtspot.com/cloud/latest/spotter); [SpotterViz](https://docs.thoughtspot.com/cloud/latest/spotter-viz)).
- RLS and CLS apply. 26.11 makes a benchmark platform and Spotter monitoring GA ([release notes](https://docs.thoughtspot.com/cloud/latest/notes)).
- Output saves as standard Liveboards, and SpotterViz keeps ten checkpoints. Liveboard and Answer TML is editable YAML ([SpotterViz](https://docs.thoughtspot.com/cloud/latest/spotter-viz); [TML](https://developers.thoughtspot.com/docs/tml)).
- Visual Embed SDK offers a React `SpotterEmbed`. Spotter MCP returns iframe URLs, never rows ([Embed Spotter](https://developers.thoughtspot.com/docs/embed-spotter); [Spotter MCP](https://developers.thoughtspot.com/docs/custom-chatbot-integration-mcp)).
- **Status:** headless `SpotterAgentEmbed` is slated for deprecation in favour of MCP ([class docs](https://developers.thoughtspot.com/docs/Class_SpotterAgentEmbed)).
- SaaS, and "ThoughtSpot does not meter or charge for LLM tokens" ([pricing](https://www.thoughtspot.com/pricing)). Docs and pricing page partly conflict on Spotter in Embedded.

Checked 2026-11-21.

### [Tableau Pulse](https://docs.salesforce.com/tableau/current/en-us/online/pulse_intro.md)

- Narrates precomputed statistical insights, and "this model doesn't analyze your data" ([Pulse](https://docs.salesforce.com/tableau/current/en-us/online/pulse_intro.md)).
- Analysts author certifiable metric definitions. Tableau Cloud runs AI through the Einstein Trust Layer, with PII masking and zero retention ([Trust](https://help.tableau.com/current/tableau/en-us/tableau_gai_einstein_trust.htm)).
- The metric definition persists; insight summaries regenerate.
- Embeds as a `<tableau-pulse>` web component with filter controls ([embed](https://help.tableau.com/current/api/embedding_api/en-us/docs/embedding_api_pulse.html)).
- Q&A runs on GPT-5.2 through Azure OpenAI. Some features need Tableau+ ([Pulse](https://docs.salesforce.com/tableau/current/en-us/online/pulse_intro.md)).

Checked 2026-11-21.

### [Tableau Agent and Tableau Next](https://help.tableau.com/current/pro/desktop/en-us/desktop_einstein.htm)

- Tableau Agent creates visualizations and calculations in worksheets ([help](https://help.tableau.com/current/pro/desktop/en-us/desktop_einstein.htm)). Whether its output is a normal editable worksheet is unverified.
- Tableau Next builds visualizations over Tableau Semantics on Salesforce Data 360 ([overview](https://docs.salesforce.com/tableau/current/en-us/tableau-next/tableau_next_overview.md)). Viz definitions are JSON through the Connect REST API; whether the agent writes that JSON is unverified ([REST](https://developer.salesforce.com/docs/analytics/tableau-next-rest-api/references/tableau-next-connect-api)).
- Q&A Calibration (beta) lets admins mark answers Verified or Inaccurate ([Trailhead](https://trailhead.salesforce.com/content/learn/modules/agentic-analytics-administration/visualize-data-with-tableau-next)).
- Embeds through the Analytics Embedding SDK. The hosted Tableau Next MCP server is read-only ([SDK](https://developer.salesforce.com/docs/analytics/sdk/guide/sdk-integration-initialize-embed.html); [MCP](https://developer.salesforce.com/docs/platform/hosted-mcp-servers/references/reference/tableau-next.html)).
- Tableau Server 2025.3+ runs with the customer's own LLM ([help](https://help.tableau.com/current/pro/desktop/en-us/desktop_einstein.htm)). Sources conflict on whether Tableau Next AI usage is metered ([pricing blog](https://www.tableau.com/blog/tableau-agentic-analytics-pricing-updates)).

Checked 2026-11-21.

### [Power BI Copilot](https://learn.microsoft.com/en-us/power-bi/create-reports/copilot-create-reports)

- Generates report pages, then adds, changes or deletes visuals by prompt, with undo. It cannot change styling ([create reports](https://learn.microsoft.com/en-us/power-bi/create-reports/copilot-create-reports)).
- "Prep data for AI" saves a schema, verified answers and AI instructions on the semantic model ([prep](https://learn.microsoft.com/en-us/power-bi/create-reports/copilot-prepare-data-ai)).
- Pages are ordinary reports. PBIR is GA and the default format, with public JSON schemas that Desktop validates ([PBIR](https://learn.microsoft.com/en-us/power-bi/developer/projects/projects-report)).
- Microsoft ships `powerbi-authoring` skills so coding agents edit PBIR and semantic models ([Power BI Agentic](https://learn.microsoft.com/en-us/power-bi/developer/agentic/power-bi-agentic-overview)).
- Needs paid Fabric F2+ or Premium P1+, billed as capacity units. Standalone Copilot is retiring ([overview](https://learn.microsoft.com/en-us/power-bi/create-reports/copilot-introduction)). Copilot in app-owns-data embeds is unverified.

Checked 2026-11-21.

### [Fabric data agents](https://learn.microsoft.com/en-us/fabric/data-science/concept-data-agent)

- Emits read-only SQL, DAX or KQL, and returns text and tables capped at 25 rows by 25 columns ([concept](https://learn.microsoft.com/en-us/fabric/data-science/concept-data-agent)).
- Runs with the user's credentials, with RLS, CLS and Purview. Instructions rank organization, then role, developer, then user prompt.
- Conversation history "might not always persist". Agent config versions through Git and deployment pipelines.
- Consumable from Microsoft 365 Copilot, Copilot Studio and Teams. The concept page says GA, though an older page said preview.

Checked 2026-11-21.

### [Metabase](https://www.metabase.com/docs/latest/ai/metabot)

- Metabot builds query-builder questions and SQL, and searches existing content first ([Metabot](https://www.metabase.com/docs/latest/ai/metabot)).
- Runs only with the user's permissions. Generated SQL is reviewed, not run automatically ([AI settings](https://www.metabase.com/docs/latest/ai/settings)).
- Charts save to dashboards. Coding agents author content through the `mb` CLI, versioned as YAML in the Representation Format (Pro/Enterprise) ([agent-driven development](https://www.metabase.com/docs/latest/ai/agent-driven-development)).
- Embeds as React `MetabotQuestion` or headless `useMetabot`, on Pro and Enterprise ([embedded AI chat](https://www.metabase.com/docs/latest/embedding/sdk/ai-chat)).
- AGPL core. Metabot works on every plan with your own API key ([LICENSE](https://github.com/metabase/metabase/blob/master/LICENSE.txt); [AI settings](https://www.metabase.com/docs/latest/ai/settings)).

Checked 2026-11-21.

### [Lightdash](https://docs.lightdash.com/guides/ai-agents)

- Agents emit a `metricQuery` over dbt-defined explores, and build charts and dashboards ([dashboards as code](https://docs.lightdash.com/guides/developer/dashboards-as-code)).
- Verified answers, per-agent data access, eval suites as code, and writeback as pull requests ([AI agents](https://docs.lightdash.com/guides/ai-agents)).
- Dashboards download and upload as YAML with a JSON schema. UI edits can sync back as PRs ([dashboards as code](https://docs.lightdash.com/guides/developer/dashboards-as-code)).
- Agents embed for customers and serve Claude and Cursor over MCP ([AI agents](https://docs.lightdash.com/guides/ai-agents)).
- MIT outside `ee/`. Self-hosted agents need an Enterprise licence key ([self-host](https://docs.lightdash.com/self-host/enterprise-features/ai-agents)).

Checked 2026-11-21.

### [Apache Superset and Preset](https://superset.apache.org/user-docs/using-superset/using-ai-with-superset/)

- A built-in MCP server offers `generate_chart`, `generate_dashboard`, `execute_sql` and more ([Using AI](https://superset.apache.org/user-docs/using-superset/using-ai-with-superset/)).
- RBAC applies to every tool, and charts stay previews until the user saves. Preset claims "zero privilege escalation" ([Preset MCP](https://preset.io/blog/preset-mcp-announcement/)).
- Saved charts edit through MCP or the UI. Concurrent layout edits are last-write-wins.
- No native chatbot yet. The SIP-214 chat extension was on a branch in June 2026; whether it merged is unverified ([repo recap](https://preset.io/blog/apache-superset-repo-recap-june-2026/)).
- Apache-2.0. Preset MCP and its chatbot are for Enterprise customers.

Checked 2026-11-21.

### [Evidence](https://evidence.dev/blog/evidence-agent)

- The agent writes Evidence Markdown, mixing prose, SQL and components, the same format humans write ([editing](https://docs.evidence.dev/editing)).
- Changes arrive as diffs to accept. Evidence Core adds a static validator that agents call ([Evidence Core](https://evidence.dev/blog/evidence-core)).
- Projects are code in a repo, and insights branch and merge into reports ([agent blog](https://evidence.dev/blog/evidence-agent)).
- Runs with existing auth, row-level security and page access.
- MIT framework; Evidence Core open-sourced 2026-08-26. The agent is Studio only ([agent docs](https://docs.evidence.dev/features/evidence-agent)). Sources conflict on its default model.

Checked 2026-11-21.

### [Rill](https://docs.rilldata.com/developers/build/ai-configuration)

- AI Chat emits metrics-view queries, and `create_chart` renders interactive charts in Claude and ChatGPT through MCP Apps ([AI configuration](https://docs.rilldata.com/developers/build/ai-configuration)).
- Metrics-view security policies govern data. v0.92.1 checks that "the analyst's numbers come from tool results" ([v0.92.1](https://github.com/rilldata/rill/releases/tag/v0.92.1)).
- Coding agents write YAML canvas dashboards through a local MCP server. Canvas has visual and YAML editors ([quickstart](https://docs.rilldata.com/developers/get-started/ai-quickstart); [canvas](https://docs.rilldata.com/developers/build/dashboards/canvas)).
- Whether chat output saves as a dashboard is undocumented.
- Apache-2.0. AI Chat and the hosted MCP server are Rill Cloud features.

Checked 2026-11-21.

### [Bloomberg ASKB](https://www.marketsmedia.com/bloomberg-introduces-agentic-ai-to-the-terminal/)

- Beta since 2026-02-23 on the Terminal. Creates charts and tables, and returns the BQL behind an analysis ([Markets Media](https://www.marketsmedia.com/bloomberg-introduces-agentic-ai-to-the-terminal/)).
- Data binding is Bloomberg's own BQL over Bloomberg data, reusable in Excel or BQuant.
- Workflows save to a firm-shared library as templates. How charts persist is not described.
- For enabled Terminal users only; no embedding or validation details found.

Checked 2026-11-21.

## Semantic layers

### [Cube](https://docs.cube.dev/reference/embed-apis/chat-api)

- The AI API returns a Cube REST query of measures, dimensions and filters ([AI API, snippet](https://cube.dev/docs/product/apis-integrations/ai-api)). The Chat API agent emits Semantic SQL plus a data-free Vega-Lite spec ([Chat API](https://docs.cube.dev/reference/embed-apis/chat-api)).
- A missing field yields a message, not an invented member. Row-level security follows the caller's token or security context.
- Commercial Cube saves chat insights to workbooks and dashboards that users and agents keep editing ([GA blog](https://cube.dev/blog/cube-agentic-analytics)). The storage format is unpublished.
- Embeds dashboards, workbooks and chats. The Chat API is on Premium and Enterprise plans.
- Core is Apache-2.0 and headless; agents and dashboards are Cube Cloud only ([README](https://github.com/cube-js/cube)). The "D3" name was dropped at GA on 2025-10-29.

Checked 2026-11-21.

### [dbt Semantic Layer, MetricFlow and Apache Ossie](https://docs.getdbt.com/docs/dbt-ai/mcp-available-tools)

- dbt's MCP `query_metrics` takes metrics, `group_by` and `where`, read-only. `text_to_sql` and `execute_sql` are free-SQL escape hatches ([MCP tools](https://docs.getdbt.com/docs/dbt-ai/mcp-available-tools)).
- Results are one-off; saved queries are human-authored. Metrics have a `label` but no format or unit ([metric properties](https://docs.getdbt.com/reference/metric-properties)).
- MetricFlow is Apache-2.0 from v0.209.0, and hosted APIs stay proprietary ([dbt blog](https://www.getdbt.com/blog/dbt-labs-affirms-commitment-to-open-semantic-interchange-by-open-sourcing-metricflow)). A report that the README still says "source-available" is unverified.
- **Status: OSI is now Apache Ossie, incubating at the ASF**, with more than 50 member organizations ([Ossie](https://ossie.apache.org/updates/ossie-enters-apache-incubator/)).
- Ossie gives datasets, fields and metrics an `ai_context` with synonyms and examples, but no format or unit ([spec](https://raw.githubusercontent.com/open-semantic-interchange/OSI/main/core-spec/spec.md)).

Checked 2026-11-21.

### [Malloy](https://docs.malloydata.dev/documentation/user_guides/publishing/mcp_agents)

- Agents emit Malloy query text through Publisher's MCP server. `malloy_compile` checks a query before it runs ([MCP agents](https://docs.malloydata.dev/documentation/user_guides/publishing/mcp_agents)).
- Render tags such as `# bar_chart` and `# currency=usd2m` put chart and format choices in the model ([visualizations](https://docs.malloydata.dev/documentation/visualizations/overview); [numbers](https://docs.malloydata.dev/documentation/visualizations/numbers)).
- The Publisher MCP endpoint "has no authentication" and binds `0.0.0.0` by default.
- Whether generated queries persist is not documented. Refinement happens in the MCP client's conversation.
- MIT throughout, maintained by Credible, with a React SDK ([publisher](https://github.com/malloydata/publisher)).

Checked 2026-11-21.

### [Snowflake semantic views](https://docs.snowflake.com/en/user-guide/views-semantic/semantic-view-yaml-spec)

- Cortex Analyst generates SQL from semantic views ([YAML spec](https://docs.snowflake.com/en/user-guide/views-semantic/semantic-view-yaml-spec)).
- Grounding uses `synonyms`, `sample_values`, `verified_queries` question-and-SQL pairs, and separate SQL-generation instructions.
- `access_modifier` marks facts and metrics private. There is no format, unit or display-name property.
- Hex and Cube import Snowflake Semantic Views, and ThoughtSpot has early access ([Hex](https://learn.hex.tech/docs/connect-to-data/semantic-models/intro-to-semantic-models); [ThoughtSpot](https://docs.thoughtspot.com/cloud/latest/notes)).

Checked 2026-11-21.

### [Databricks metric views](https://docs.databricks.com/aws/en/metric-views/semantic-metadata)

- Metric views carry `display_name`, up to 10 `synonyms`, and a `format` block with currency codes, decimals and abbreviation ([semantic metadata](https://docs.databricks.com/aws/en/metric-views/semantic-metadata)).
- Synonyms import into Genie, and formats flow into dashboards and visualizations.
- Sources conflict on preview versus GA status and the required runtime ([business semantics](https://docs.databricks.com/aws/en/business-semantics)).
- What Genie emits, and how its answers persist, was not researched (unverified).

Checked 2026-11-21.

### [Looker](https://docs.cloud.google.com/looker/docs/mcp)

- The Looker-managed MCP server connects Gemini CLI, Claude Desktop and Cursor to LookML models. Agents inherit the user's roles ([MCP](https://docs.cloud.google.com/looker/docs/mcp)).
- A LookML VS Code extension (preview) has an agent that writes LookML ([Next '26](https://cloud.google.com/blog/products/business-intelligence/looker-updates-for-agentic-bi-at-next26)).
- Changes made through MCP Toolbox must be committed in the Looker UI ([codelab](https://codelabs.developers.google.com/codelabs/looker-mcp-toolbox?hl=de)).
- The Conversational Analytics API embeds Gemini agents. Managed MCP is in preview and excludes customer-hosted instances. LookML presentation fields were not checked (unverified).

Checked 2026-11-21.

### [AtScale](https://www.atscale.com/blog/enterprise-ai-mcp-semantic-layer/)

- Serves an in-product MCP endpoint at `<atscale-host>/mcp` ([AtScale blog](https://www.atscale.com/blog/enterprise-ai-mcp-semantic-layer/)).
- Listed in the Databricks MCP Marketplace since 2025-12-01 ([BusinessWire](https://www.businesswire.com/news/home/20251201005442/en/AtScale-Delivers-Semantic-Intelligence-to-Databricks-MCP-Marketplace/)).
- Joined OSI in January 2026; its SML modelling language is open source ([BusinessWire](https://www.businesswire.com/news/home/20260127372541/en/AtScale-Joins-the-Open-Semantic-Interchange-OSI-Bringing-over-a-Decade-of-Semantic-Layer-Expertise-to-support-Open-Standards)).
- What its agents emit, and how output is validated or persists, was not researched (unverified).

Checked 2026-11-21.

## Dashboards as JSON or code

### [Grafana](https://grafana.com/docs/grafana/latest/as-code/observability-as-code/schema-v2/)

- **Status: schema v2 is the default.** Dynamic dashboards on v2 went GA in Grafana 13 on 2026-04-08, and v1 dashboards migrate on open ([GA](https://grafana.com/whats-new/2026-04-08-dynamic-dashboards-is-now-generally-available/)).
- v2 has a flat `elements` map that layouts reference by name, nine typed variable kinds, and conditional rendering. CUE defines it, and the UI checks it with Zod ([CUE](https://github.com/grafana/grafana/blob/main/apps/dashboard/kinds/v2/dashboard_spec.cue); [validation](https://github.com/grafana/grafana/blob/main/public/app/features/dashboard-scene/v2schema/validation.ts)).
- Assistant offers "dashboard plans" to preview before building, and checks that panels return data. Its emit format is undocumented ([Assistant guide](https://grafana.com/docs/grafana-cloud/machine-learning/assistant/guides/dashboarding/)).
- mcp-grafana offers summary, JSONPath property and patch tools, so agents need not load whole dashboards ([mcp-grafana](https://github.com/grafana/mcp-grafana)).
- Git Sync is GA for commits and PRs ([v13](https://grafana.com/docs/grafana/latest/whatsnew/whats-new-in-v13-0/)). Assistant undo fails once the dashboard has changed ([Assistant guide](https://grafana.com/docs/grafana-cloud/machine-learning/assistant/guides/dashboarding/)).
- AGPL-3.0. Assistant is a Grafana Cloud service, and on-prem preview still needs a Cloud account ([grafana](https://github.com/grafana/grafana)).

Checked 2026-11-21.

### [Vega-Lite](https://github.com/vega/vega-lite)

- A declarative JSON chart grammar with versioned JSON Schemas; v6.5.0 shipped 2026-10-08 ([releases](https://github.com/vega/vega-lite/releases); [schema](https://github.com/vega/schema/tree/master/vega-lite)).
- Typed params and selections filter across composed views, within one spec ([params](https://vega.github.io/vega-lite/docs/parameter.html)). Named data binds at runtime ([data](https://vega.github.io/vega-lite/docs/data.html)).
- Expressions run through `Function` unless `vega-interpreter` evaluates them for CSP ([vega-interpreter](https://github.com/vega/vega/tree/main/packages/vega-interpreter)).
- VegaChat reports "near-zero" invalid charts from natural language ([arXiv](https://arxiv.org/abs/2601.15385)). LIDA emits Python code instead, and has been dormant since 2024 ([LIDA](https://github.com/microsoft/lida)).
- BSD-3-Clause.

Checked 2026-11-21.

### [Flint and Data Formulator](https://github.com/microsoft/flint-chart)

- **Status: Data Formulator v0.7 renders through Flint, not raw Vega-Lite** ([Data Formulator](https://github.com/microsoft/data-formulator)).
- Flint compiles short specs to Vega-Lite, ECharts, Chart.js, Plotly and Excel. It ships an MCP server and a React component ([Flint](https://github.com/microsoft/flint-chart)).
- A hierarchical data semantic model drives scales, axes and formatting ([paper](https://arxiv.org/abs/2607.20775)).
- Data Formulator keeps editable charts in one branching history, with persistent sessions and database connectors ([0.7 release](https://github.com/microsoft/data-formulator/releases/tag/0.7.0)).
- MIT. Flint 1.1 shipped 2026-11-15.

Checked 2026-11-21.

### [Perspective](https://github.com/perspective-dev/perspective/blob/master/docs/md/how_to/javascript/agent.md)

- **Status: v5.2 (2026-08-10) added an embedded LLM agent.** The repo moved to `perspective-dev`, and v5.0 folded `perspective-workspace` into the viewer ([releases](https://github.com/perspective-dev/perspective/releases)).
- Agent tools read schema and config, write `ViewerConfig`, manage panels, and patch workspace state field by field ([tools.rs](https://github.com/perspective-dev/perspective/blob/master/rust/perspective-viewer/src/rust/agent/tools.rs)).
- Entitlements hide tools from the model, with `read_data` and `execute_code` off by default. Generated JSON schemas and strict `restore()` reject invented fields ([save and restore](https://github.com/perspective-dev/perspective/blob/master/docs/md/how_to/javascript/save_restore.md)).
- `save()` tokens are versioned JSON the host stores. `masters` panels cross-filter the others.
- No semantic layer: the agent learns names and types "but not what they _mean_", so hosts add data notes ([agent.md](https://github.com/perspective-dev/perspective/blob/master/docs/md/how_to/javascript/agent.md)).
- Apache-2.0. The agent is opt-in, with any OpenAI-compatible endpoint or an in-page model.

Checked 2026-11-21.

### [AG Grid AI Toolkit](https://www.ag-grid.com/javascript-data-grid/ai-toolkit.md)

- `getStructuredSchema()` returns a JSON Schema of grid state. The model returns `gridState`, applied through `setState` ([toolkit](https://www.ag-grid.com/javascript-data-grid/ai-toolkit.md)).
- The host validates the response, with ajv suggested, and writes all prompting.
- Columns take a `description` for the model. State is ephemeral unless the host saves it.
- An Enterprise licence feature, shipped in 34.3 ([what's new, snippet](https://www.ag-grid.com/blog/whats-new-in-ag-grid-34-3/)).

Checked 2026-11-21.

### [interop.io io.Intelligence](https://docs-ai.interop.io/modules/mcp/capabilities)

- MCP tools create or restore desktop workspaces and find preconfigured layouts. A Workspace Widget MCP App previews them in chat ([capabilities](https://docs-ai.interop.io/modules/mcp/capabilities)).
- Action capabilities need user confirmation through MCP elicitation and sampling.
- io.Connect workspace layouts are JSON ([workspaces, snippet](https://docs.interop.io/desktop/capabilities/windows/workspaces/overview/index.html)). The AI's emit format is not stated.
- Commercial.

Checked 2026-11-21.

### [HERE Studio](https://www.here.io/blog/product/the-ai-enterprise-browser-inside-here-studio)

- HERE is OpenFin, renamed in 2024 ([Markets Media, snippet](https://www.marketsmedia.com/openfin-evolves-to-here-and-launches-enterprise-browser/)).
- Studio builds an app or widget from connected data, composable into a dashboard called a Supertab. The output format is undisclosed, so "Code" is unverified ([blog](https://www.here.io/blog/product/the-ai-enterprise-browser-inside-here-studio)).
- Uses only approved data connectors. "Compliance by construction" is a marketing claim, and intent-based FDC3 is a roadmap preview.
- Commercial. Persistence and versioning are not described.

Checked 2026-11-21.
