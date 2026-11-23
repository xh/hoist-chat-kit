# Generative UI protocols and hosted generative UI services

All sources checked 2026-11-21. "Search summary" means the fact came from a web-search result summary, not a page I fetched in full. Treat those as weaker. UNVERIFIED marks claims I could not confirm against a primary source.

Products covered: A2UI (Google), AG-UI + CopilotKit, MCP Apps (SEP-1865) + MCP-UI, OpenUI (Thesys) + Thesys C1 / OpenUI Cloud, OpenAI Apps SDK (now "Plugins") + ChatKit widgets. Added: Open-JSON-UI and Vercel json-render (short, mostly gaps).

Name collision: the generative-UI "OpenUI" is `thesysdev/openui` (Thesys, MIT), openui.com. SAP's OpenUI5 and wandb's "open-ui" are unrelated - [search summary](https://raw.githubusercontent.com/thesysdev/openui/HEAD/README.md).

Layering, as the projects describe it: AG-UI is a runtime event protocol that carries payloads; A2UI, MCP Apps and Open-JSON-UI are UI specs that describe what to show - [AG-UI README](https://github.com/ag-ui-protocol/ag-ui). CopilotKit maps these to three tiers: Controlled (registered components via tool calls), Declarative (A2UI), Open-ended (MCP Apps sandbox) - [CopilotKit README](https://github.com/CopilotKit/CopilotKit).

## 1. What does the model emit?

### Takeaway
Three families. Declarative specs over a host-owned catalog (A2UI JSON, OpenUI Lang, C1, ChatKit widget JSON). Tool calls that select a pre-registered component (CopilotKit Controlled). Full HTML/JS apps in a sandboxed iframe (MCP Apps, OpenAI Apps SDK), where the *developer* writes the HTML and the model only picks the tool and its args.

### Cited Findings
- **A2UI**: agent sends JSON envelopes. Server-to-client messages: `createSurface`, `updateComponents`, `updateDataModel`, `deleteSurface`, plus `callRendererFunction` and `agentFunctionResponse` in 1.0 - [A2UI v1.0 spec](https://a2ui.org/specification/v1.0-a2ui/).
- **A2UI**: components are a flat adjacency list linked by IDs. One component must have `"id": "root"`, and updates buffer until it exists. Each component can set `@catalogId`, defaulting to the surface's `catalogId` - [A2UI v1.0 spec](https://a2ui.org/specification/v1.0-a2ui/).
- **A2UI**: the stream is a sequence of JSON objects, JSONL in the examples. The spec is transport-agnostic and requires only delimited envelopes (newline, WebSocket frame, SSE event) - [A2UI v1.0 spec](https://a2ui.org/specification/v1.0-a2ui/).
- **A2UI**: "the agent describes what to show, and every app draws the UI with its own native components." LLMs compose through "A2UI Express" or through "system one" decision models that pick components - [Google Developers Blog, A2UI 1.0, 2026-11-11](https://developers.googleblog.com/a2ui-10-build-delightful-fast-reliable-agentic-experiences/).
- **AG-UI**: emits no UI itself. It is an event stream: lifecycle (`RunStarted`/`RunFinished`/`RunError`/`Step*`), text message, tool call (`ToolCallStart`/`Args`/`End`/`Result`), state (`StateSnapshot`, `StateDelta`, `MessagesSnapshot`), activity (`ActivitySnapshot`/`ActivityDelta`), subagent, reasoning, `Raw`/`Custom` - [AG-UI events docs](https://docs.ag-ui.com/concepts/events). "AG-UI 1.0 defines 31 event types in eight families" - [AG-UI README](https://github.com/ag-ui-protocol/ag-ui).
- **CopilotKit, Controlled/tool-based**: you register a React component with `useComponent`, and CopilotKit exposes it to the agent as a tool. The model emits a tool call with Zod-typed args - "no handler, no user interaction, no server-side execution" - [CopilotKit docs, generative UI](https://docs.copilotkit.ai/generative-ui).
- **MCP Apps**: servers predeclare UI resources under the `ui://` URI scheme, typed `text/html;profile=mcp-app`. Tools reference them through metadata. The model calls the tool, and the host renders the HTML template with the tool result - [SEP-1865](https://modelcontextprotocol.io/seps/1865-mcp-apps-interactive-user-interfaces-for-mcp).
- **MCP-UI**: pioneered three content types: HTML, external URL, and remote DOM - [SEP-1865](https://modelcontextprotocol.io/seps/1865-mcp-apps-interactive-user-interfaces-for-mcp). The current mcpui.dev shows only `rawHtml` through `createUIResource` - [mcpui.dev](https://mcpui.dev/).
- **OpenUI**: the model emits **OpenUI Lang**, "a compact, streaming-first language" for structured UI built from your registered components - [OpenUI README](https://raw.githubusercontent.com/thesysdev/openui/HEAD/README.md). The README claims "up to 67% fewer tokens than equivalent JSON." Its 7-scenario benchmark (tiktoken, GPT-5 encoder) gives 4,800 tokens for OpenUI Lang, 10,180 for Vercel json-render and 9,948 for Thesys C1 JSON. This is a vendor benchmark - [OpenUI README](https://raw.githubusercontent.com/thesysdev/openui/HEAD/README.md).
- **Thesys C1**: the legacy docs archive covers the C1 API, `C1Component`, `C1Chat` and `ThemeProvider` - [Thesys legacy docs](https://docs.thesys.dev/legacy). I could not fetch C1's wire format. The README benchmark calls it "Thesys C1 JSON" - [OpenUI README](https://raw.githubusercontent.com/thesysdev/openui/HEAD/README.md).
- **ChatKit widgets**: a `WidgetRoot` holding `WidgetNode`s. Containers: `Card`, `ListView`. Layout: `Box`, `Row`, `Col`, `Form`, `Divider`, `Spacer`, `Transition`. Content: `Text`, `Title`, `Caption`, `Markdown`, `Image`, `Icon`, `Badge`. Inputs: `Button`, `Select`, `DatePicker`. You design JSON in the Widget Builder (widgets.chatkit.studio) and "serve it from your backend" - [OpenAI ChatKit widgets guide](https://developers.openai.com/api/docs/guides/chatkit-widgets).
- **OpenAI Apps SDK**: MCP tools return UI resources rendered in ChatGPT, and the docs now present this as "Plugins" (skills, MCP servers, optional UI) - [OpenAI developers, plugins index](https://developers.openai.com/apps-sdk). ChatGPT is "fully compatible with the MCP Apps spec" (changelog, 2026-02-22) - [Apps SDK changelog](https://developers.openai.com/apps-sdk/changelog).

### Inferences
- Only A2UI, OpenUI/C1 and ChatKit widgets have the *model* author the UI structure. In MCP Apps and the Apps SDK, a developer authors the UI ahead of time. The model picks a tool and supplies its data, so these are "agent-invoked apps," not generative layout.
- ChatKit widgets read as developer-templated JSON, not model-composed. The guide describes no path where the model generates the widget tree (see Gaps).

### Gaps
- No OpenUI Lang syntax sample was available in the fetched README or docs landing page. Read openui.com/docs/openui-lang for the grammar.
- C1's exact wire format (XML-like DSL vs JSON) is UNVERIFIED. The legacy docs pages that would show it were not fetched.
- Whether ChatKit lets the model generate widget JSON freely, or only fill developer templates, is not stated in the guide.

## 2. How is output validated and kept safe?

### Takeaway
The declarative specs get safety from a host-owned component catalog plus schema validation, with no executable code: A2UI's functions-by-name, OpenUI's Zod schemas. MCP Apps and the Apps SDK run arbitrary developer HTML, contained by a mandatory iframe sandbox, predeclared reviewable templates, auditable JSON-RPC, and host consent for UI-initiated tool calls.

### Cited Findings
- **A2UI**: "Security first... The app developer controls what the agent can and cannot do in the app." It validates inputs and outputs against a schema and disallows arbitrary executable code. A widget catalog "provides access to the widgets the agent is allowed to compose" - [A2UI README](https://github.com/google/A2UI) (now served from `github.com/a2ui-project/a2ui`).
- **A2UI**: functions are invoked by name, `{"@call": ..., "args": ...}`, "which avoids sending executable code." `regex` uses a restricted dialect with a static safety check. "Components MUST remain flat," and the top-level schema allows only a fixed set of keys, so validators can check the tree - [A2UI v1.0 spec](https://a2ui.org/specification/v1.0-a2ui/).
- **A2UI**: "A2UI reliably binds to your data and child components on the server, so sensitive values never reach the model" - [A2UI 1.0 blog](https://developers.googleblog.com/a2ui-10-build-delightful-fast-reliable-agentic-experiences/).
- **OpenUI**: "Restrict output to the components you define and register." It defines props "up front with Zod schemas" and generates the system prompt from the library - [OpenUI README](https://raw.githubusercontent.com/thesysdev/openui/HEAD/README.md). An "Autofix" feature repairs invalid output when you call a provider directly - [OpenUI docs](https://www.openui.com/docs). OpenUI Cloud is positioned around "validation, error correction, fallbacks, versioning, audit trails, state management" - [search summary of Thesys LinkedIn](https://linkedin.com/company/thesysdev) (undated).
- **CopilotKit Controlled**: component props are a Zod schema, and only registered tool names render - [CopilotKit docs](https://docs.copilotkit.ai/generative-ui). The Open-ended tier is "a full interface that runs in a sandbox, built on MCP Apps" - [CopilotKit README](https://github.com/CopilotKit/CopilotKit).
- **MCP Apps**: mitigations are iframe sandboxing "with restricted permissions," predeclared templates that "hosts can review," "auditable messages" (all UI-to-host traffic is loggable JSON-RPC), and "user consent" (hosts can require approval for UI-initiated tool calls). External URLs were deferred from the MVP over model visibility, screenshotting and review concerns - [SEP-1865](https://modelcontextprotocol.io/seps/1865-mcp-apps-interactive-user-interfaces-for-mcp).
- **MCP-UI**: "All remote code executes in sandboxed iframes" - [mcpui.dev](https://mcpui.dev/).
- **OpenAI Apps SDK**: approval-gated tools deliver input through `ui/notifications/tool-input` only *after* approval. Users and admins get app permission controls (2026-06-12). Plugins are reviewed for the ChatGPT Directory - [Apps SDK changelog](https://developers.openai.com/apps-sdk/changelog); [plugins index](https://developers.openai.com/apps-sdk). Developers report inconsistent CSP (`connectDomains`) behavior after redeploys - [OpenAI community thread, May 2026](https://community.openai.com/t/published-apps-sdk-widget-updates-csp-behavior-inconsistent-after-redeploy-anyone-else-seeing-this/1381690).
- **ChatKit widgets**: the guide does not cover security. A fixed node set validated in chatkit-python is implied by an issue where a Builder-generated `Card > ListView` failed validation until ListView joined Card's allowed children - [chatkit-python issue #47](https://github.com/openai/chatkit-python/issues/47).

### Inferences
- The catalog-plus-schema model (A2UI, OpenUI) is the pattern that fits a host app that already owns a component library. The iframe model suits third-party UI the host does not trust.

### Gaps
- C1's server-side validation behavior is not documented in fetched sources.

## 3. Persistent/editable vs one-off; incremental updates?

### Takeaway
A2UI is the most explicitly incremental: addressable surfaces, component and data-model updates, and deletes. AG-UI adds state snapshots and JSON Patch deltas. OpenUI and C1 stream progressively within a turn. MCP Apps streams partial tool input and keeps a live iframe that can call tools. ChatKit widgets stream only `Text`/`Markdown`. No product describes a user-editable, persisted layout artifact.

### Cited Findings
- **A2UI**: `createSurface` can carry `components` and `dataModel` in one message (new in 1.0). `updateComponents`, `updateDataModel` and `deleteSurface` mutate a named surface - [A2UI v1.0 spec](https://a2ui.org/specification/v1.0-a2ui/). "The app streams in the UI as the agent works" - [A2UI 1.0 blog](https://developers.googleblog.com/a2ui-10-build-delightful-fast-reliable-agentic-experiences/).
- **AG-UI**: `StateSnapshot` replaces client state. `StateDelta` applies RFC 6902 JSON Patch in sequence, and the client may request a fresh snapshot if patches look inconsistent. `ActivitySnapshot`/`ActivityDelta` do the same for structured activity messages, which are stripped from `RunAgentInput` and never go back to the agent - [AG-UI events](https://docs.ag-ui.com/concepts/events).
- **OpenUI**: "Emit UI incrementally as tokens arrive." The renderer "draws each component as its line arrives" - [OpenUI README](https://raw.githubusercontent.com/thesysdev/openui/HEAD/README.md); [OpenUI docs](https://www.openui.com/docs). The OpenUI Cloud positioning names "versioning" and "state management" - [search summary, Thesys LinkedIn](https://linkedin.com/company/thesysdev).
- **MCP Apps**: predeclared templates separate presentation from data, so hosts can prefetch and cache them - [SEP-1865](https://modelcontextprotocol.io/seps/1865-mcp-apps-interactive-user-interfaces-for-mcp). ChatGPT's implementation pushes `ui/notifications/tool-input`, and theme changes via `ui/notifications/host-context-changed` - [Apps SDK changelog](https://developers.openai.com/apps-sdk/changelog).
- **OpenAI Apps SDK**: OpenAI published guidance on "preserving state in plugin UI" (2025-11-04). `requestModal({ template })` opens another registered template (2026-01-15) - [Apps SDK changelog](https://developers.openai.com/apps-sdk/changelog). A forum bug report describes the previous widget hiding when a second one renders - [OpenAI community](https://community.openai.com/t/bug-previous-widget-hides-disappears-upon-second-rendering/1371722).
- **ChatKit widgets**: only `Markdown` and `Text` support streaming updates, through a `streaming` flag. No general widget-update mechanism is described - [ChatKit widgets guide](https://developers.openai.com/api/docs/guides/chatkit-widgets).
- **Thesys Artifacts/Reports API**: a separately billed API priced per "page operation" - [Thesys pricing](https://www.thesys.dev/pricing). The name suggests persistent documents, but its edit model is UNVERIFIED.

### Inferences
- A2UI's surface/data-model split is the closest to a persistent, re-renderable artifact: you can store the component list and data model and replay them. None of these products positions output as a durable, user-editable dashboard; persistence is left to the host.

### Gaps
- Whether `ui/notifications/tool-input-partial` (streaming partial tool args into the iframe) is in the stable MCP Apps spec is UNVERIFIED. I did not read the full ext-apps spec.

## 4. How does it bind to live data? Semantic layer or data model?

### Takeaway
A2UI has a first-class data model with JSON Pointer bindings, two-way input binding and server-side binding that keeps values from the model. AG-UI has shared agent state. MCP Apps binds through tool results plus UI-initiated tool calls. None offers a semantic layer (metrics, dimensions). Data semantics stay in the agent's tools.

### Cited Findings
- **A2UI**: bindings use JSON Pointer (RFC 6901) through `{"@path": "..."}`, absolute from `/`, relative inside list templates. Input components bind two-way, and changes stay local until an `action` sends them to the agent. `formatString` interpolates `${...}` - [A2UI v1.0 spec](https://a2ui.org/specification/v1.0-a2ui/).
- **A2UI**: 1.0 adds bidirectional function calls (`callAgentFunction`/`callRendererFunction`), "so a picker can check availability on the spot." Python "A2UI Macros" handle programmatic expansion and data binding. Server-side binding means "sensitive values never reach the model" - [A2UI 1.0 blog](https://developers.googleblog.com/a2ui-10-build-delightful-fast-reliable-agentic-experiences/); [spec](https://a2ui.org/specification/v1.0-a2ui/).
- **A2UI + MCP**: you can render A2UI inside an MCP App, embed MCP Apps in A2UI surfaces, serve A2UI layouts from an MCP server, and call MCP tools from A2UI - [a2ui.org roadmap](https://a2ui.org/roadmap/).
- **AG-UI / CopilotKit**: "One state layer that both the agent and your UI read and write in real time" - [CopilotKit README](https://github.com/CopilotKit/CopilotKit). The state events are `StateSnapshot`/`StateDelta` - [AG-UI events](https://docs.ag-ui.com/concepts/events).
- **MCP Apps**: UI-host communication reuses MCP JSON-RPC, so the iframe can call server tools - [SEP-1865](https://modelcontextprotocol.io/seps/1865-mcp-apps-interactive-user-interfaces-for-mcp). ChatGPT exposes the full tool-result envelope, including hidden `_meta`, through `window.openai.toolResponseMetadata`. It recommends `outputSchema` for structured content. `_meta.ui.visibility` can hide a tool from the model, for UI-only data tools - [Apps SDK changelog](https://developers.openai.com/apps-sdk/changelog).
- **OpenUI**: lists "Built-in data fetching: Yes" in its comparison table, with no detail - [OpenUI README](https://raw.githubusercontent.com/thesysdev/openui/HEAD/README.md).

### Inferences
- A2UI's `@path` data model plus agent functions comes closest to a "live data binding" story. A semantic layer (governed metrics) would sit outside all of these, behind the agent's tools.

### Gaps
- OpenUI's and C1's data-fetching mechanism is undocumented in the sources I fetched.

## 5. How does a user refine a result?

### Takeaway
Everywhere, refinement means interaction events sent back to the agent, followed by a new or updated render. No product offers direct manipulation of the generated layout.

### Cited Findings
- **A2UI**: renderer-to-agent messages are `action`, `callAgentFunction`, `rendererFunctionResponse` and `error`. `action` is the only user-event message - [A2UI v1.0 spec](https://a2ui.org/specification/v1.0-a2ui/).
- **AG-UI**: bidirectional, so clients read the event stream and can interrupt it. 1.0 adds interrupts and subagents - [CopilotKit blog, 2025-06-02](https://copilotkit.ai/blog/big-updates-on-ag-ui); [AG-UI events](https://docs.ag-ui.com/concepts/events). The 1.0 feature list (subagents, interrupts, metadata, multimodal tool results, token usage) comes from a search summary - [byteiota](https://byteiota.com/ag-ui-1-stable-spec/). A draft `MetaEvent` carries side-band annotations such as user feedback - [AG-UI events](https://docs.ag-ui.com/concepts/events).
- **MCP Apps / ChatGPT**: the UI can send follow-up messages (`sendFollowUpMessage`, with `scrollToBottom`) and call tools. Hosts may require consent - [Apps SDK changelog](https://developers.openai.com/apps-sdk/changelog); [SEP-1865](https://modelcontextprotocol.io/seps/1865-mcp-apps-interactive-user-interfaces-for-mcp).
- **ChatKit widgets**: actions bind to `Button.onClickAction`, `ListViewItem.onClickAction`, `Form.onSubmitAction`, and `onChangeAction` on `Select`/`DatePicker`. The client's `onAction` callback forwards the payload to your backend - [ChatKit widgets guide](https://developers.openai.com/api/docs/guides/chatkit-widgets).
- **OpenUI**: Agent Interface provides threads and streaming messages. Follow-up mechanics are not described - [OpenUI docs](https://www.openui.com/docs).

### Gaps
- No source describes editing a generated layout in place, such as moving or reconfiguring a component, in any of these products.

## 6. Embedding and frameworks/renderers

### Takeaway
A2UI has the widest native renderer set. OpenUI covers four web frameworks. CopilotKit is React-first with Angular, Vue and React Native. MCP Apps embeds anywhere that can host an iframe and ships React hooks plus an app-bridge for hosts. ChatKit is a JS web component with React bindings.

### Cited Findings
- **A2UI**: official renderers for React, Lit, Angular, Flutter, SwiftUI and Jetpack Compose, plus MCP Apps - [a2ui.org roadmap](https://a2ui.org/roadmap/). Compose is "currently v0.9.1, and v1.0 coming soon." Agent SDKs ship for TypeScript, Dart and Python. ByteDance released a Lynx renderer in June 2026 - [A2UI 1.0 blog](https://developers.googleblog.com/a2ui-10-build-delightful-fast-reliable-agentic-experiences/).
- **AG-UI**: community SDKs for Kotlin, Go, Dart, Java, Rust, Ruby, C++ and .NET. The TypeScript, Python and .NET SDKs are generated from the 1.0 JSON Schema - [AG-UI docs](https://docs.ag-ui.com/introduction); [AG-UI README](https://github.com/ag-ui-protocol/ag-ui). First-party agent integrations: Microsoft Agent Framework, Google ADK, AWS Strands, Bedrock AgentCore, Mastra, Pydantic AI, Agno, LlamaIndex, AG2. Community: Claude Agent SDK, OpenAI Agents SDK, Cloudflare Agents - [AG-UI docs](https://docs.ag-ui.com/introduction).
- **CopilotKit**: React/Next.js GA. Angular, Vue and React Native supported. Slack and Teams GA on cloud-hosted "Intelligence" - [CopilotKit README](https://github.com/CopilotKit/CopilotKit).
- **MCP Apps**: SDK packages `@modelcontextprotocol/ext-apps` (View-side `App`, `PostMessageTransport`), `/react` (hooks), `/app-bridge` (host embedding) and `/server`. Hosts: ChatGPT, Claude, VS Code, Goose, Postman, MCPJam, mcp-use, Alpic Playground. "Host support varies" - [ext-apps README](https://github.com/modelcontextprotocol/ext-apps).
- **MCP-UI**: `@mcp-ui/server` and `@mcp-ui/client` (npm), `mcp-ui-server` (PyPI) and `mcp_ui_server` (gem). The client's `AppRenderer` is "the recommended MCP Apps Client SDK" - [mcpui.dev](https://mcpui.dev/).
- **OpenUI**: runtimes for React, Vue, Svelte and Angular. Packages include `@openuidev/react-lang`, `react-ui` (prebuilt chat), `react-headless`, `langchain` (streams through AG-UI), `a2ui`, `assistant-ui`, `browser-bundle` (CDN/iframe) and `server` - [OpenUI README](https://raw.githubusercontent.com/thesysdev/openui/HEAD/README.md).
- **ChatKit**: JS types for `@openai/chatkit@1.7.0` expose widget `onAction` - [jsDelivr types](https://cdn.jsdelivr.net/npm/@openai/chatkit@1.7.0/types/index.d.ts). The server side is `chatkit-python` - [chatkit-python docs](https://openai.github.io/chatkit-python/concepts/widgets).
- **OpenAI Apps SDK**: renders only inside ChatGPT, and since 2026-03-25 Codex plugins too - [Apps SDK changelog](https://developers.openai.com/apps-sdk/changelog). MCP Apps compatibility makes the same server portable to other MCP Apps hosts - [ext-apps README](https://github.com/modelcontextprotocol/ext-apps).

### Inferences
- Only A2UI, OpenUI, CopilotKit and ChatKit embed in *your own* app with *your own* components. MCP Apps embeds third-party UI into a host. The Apps SDK targets ChatGPT as the host.

## 7. Licence and hosting model

### Takeaway
The protocols are open: A2UI Apache-2.0, AG-UI MIT, MCP Apps/ext-apps Apache-2.0, MCP-UI Apache-2.0, CopilotKit MIT, OpenUI MIT. The paid layers are OpenUI Cloud (formerly C1, per call plus pass-through tokens), CopilotKit Intelligence (free Developer plan, self-hostable) and OpenAI (ChatGPT distribution, checkout).

### Cited Findings
- **A2UI**: Apache-2.0, 17.7k stars - [A2UI repo](https://github.com/google/A2UI).
- **AG-UI**: "open source under the MIT License," 20.9k stars - [AG-UI README](https://github.com/ag-ui-protocol/ag-ui).
- **CopilotKit**: MIT, 38.9k stars. CopilotKit Intelligence is cloud-hosted or self-hosted ("Kubernetes cluster, VPC, or air-gapped"), and "The Developer plan is free" - [CopilotKit README](https://github.com/CopilotKit/CopilotKit). Paid tier prices: UNVERIFIED.
- **MCP Apps**: Apache 2.0, 3.1k stars - [ext-apps README](https://github.com/modelcontextprotocol/ext-apps). **MCP-UI**: Apache 2.0 - [mcpui.dev](https://mcpui.dev/).
- **OpenUI**: MIT - [OpenUI README](https://raw.githubusercontent.com/thesysdev/openui/HEAD/README.md).
- **OpenUI Cloud** (thesys.dev/pricing): Free $0 (3K calls/mo, BYO key). Build $49/mo (25K calls, $0.002/call overage). Grow $499/mo (500K calls, $0.001 overage, SSO/SAML). Scale custom (self-hosting or VPC, SLAs). "Every response generated consumes OpenUI Cloud API calls + LLM tokens." LLM tokens are pass-through at provider rates with no markup. Reports/Artifacts API: 100 pages free, then $0.01 per page operation. Zero data retention on paid models. Free-model data "may be used for training" - [Thesys pricing](https://www.thesys.dev/pricing). A third-party October 2026 summary said the free tier was 5K calls - [toolradar](https://toolradar.com/tools/thesys/pricing). This conflicts with the official 3K; trust the official page.
- **OpenUI Gateway**: "OpenRouter for Generative UI. One API for models across providers" - [OpenUI docs](https://www.openui.com/docs).
- **OpenAI**: the Apps SDK is free to build with, distributed through ChatGPT Directory review. A Checkout API covers product checkout, reservations and quote requests - [OpenAI plugins index](https://developers.openai.com/apps-sdk). ChatKit licence: UNVERIFIED (I believe chatkit-js is Apache-2.0 but did not confirm).

## 8. Backers, maturity and adoption

### Takeaway
As of 2026-11-21: A2UI 1.0 is stable (2026-11-11), AG-UI 1.0 is stable (around 2026-09-30), and MCP Apps is stable (2026-01-26) with SEP-1865 Final. OpenUI launched 2026-03-11 and superseded C1. The OpenAI Apps SDK has been rebranded in the docs as Plugins and is MCP Apps-compatible. Adoption numbers are almost all vendor-reported.

### Cited Findings
- **A2UI (Google)**: v0.8 is deprecated, v0.9/v0.9.1 previous, v1.0 current - [a2ui.org roadmap](https://a2ui.org/roadmap/). v0.9 was announced 2026-04-17 - [search summary of Google Developers Blog](https://developers.googleblog.com/en/a2ui-v0-9-generative-ui/). 1.0 was announced 2026-11-11. Named adopters: Atlassian (Jira agent cards), Alation, Bloomberg, ByteDance (Lynx renderer), Gemini Notebook, and Gemini Enterprise agents (Gemini supports 0.9.1). The post gives no usage numbers - [A2UI 1.0 blog](https://developers.googleblog.com/a2ui-10-build-delightful-fast-reliable-agentic-experiences/). The repo is now under the `a2ui-project` org, and protocol v1.1 is on the roadmap - [A2UI repo](https://github.com/google/A2UI).
- **AG-UI (CopilotKit)**: launched around May 2025 - [CopilotKit blog 2025-06-02](https://copilotkit.ai/blog/big-updates-on-ag-ui). 1.0 has a "stable, frozen specification backed by a JSON Schema," is "backwards compatible in both directions," and is "adopted by Google, Microsoft, Amazon, and Oracle" - [AG-UI README](https://github.com/ag-ui-protocol/ag-ui). The 1.0 date of 2026-09-30 rests on one secondary source - [byteiota](https://byteiota.com/ag-ui-1-stable-spec/). TS core packages reached 1.0.4 on 2026-11-05 and 1.0.5 on 2026-11-17 - [AG-UI releases](https://github.com/ag-ui-protocol/ag-ui/releases). Bedrock AgentCore Runtime added AG-UI support in March 2026 - [AWS What's New](https://aws.amazon.com/about-aws/whats-new/2026/03/amazon-bedrock-agentcore-runtime-ag-ui-protocol). Oracle Agent Spec integration - [Oracle blog](https://blogs.oracle.com/ai-and-datascience/announcing-ag-ui-integration-for-agent-spec). CopilotKit's $27M Series A (May 2026) and "2M+ weekly interactions" are vendor or funding-coverage claims and UNVERIFIED - [search summary, marktechpost](https://www.marktechpost.com/2026/05/21/how-copilotkit-is-redefining-the-agentic-ai-stack-in-2026/).
- **MCP Apps**: SEP-1865 was created 2025-11-21 and is now Final, Extensions Track. Its authors include the MCP-UI creators (Ido Salomon, Liad Yosef) and Olivier Chafik, who wrote the ext-apps prototype. Author employers (e.g. Anthropic, OpenAI) are not stated in the SEP, so they are UNVERIFIED. It unifies MCP-UI and the OpenAI Apps SDK - [SEP-1865](https://modelcontextprotocol.io/seps/1865-mcp-apps-interactive-user-interfaces-for-mcp). Spec 2026-01-26 is Stable, and a draft is in development - [ext-apps README](https://github.com/modelcontextprotocol/ext-apps). The extension ID is `io.modelcontextprotocol/ui`, negotiated through extension capabilities - [search summary, spec mirror](https://raw.githubusercontent.com/modelcontextprotocol/ext-apps/main/specification/2026-01-26/apps.mdx). A claim that it was folded into a "2026-07-28 extensions framework" is UNVERIFIED - [NYU Shanghai RITS blog](https://rits.shanghai.nyu.edu/ai/mcp-apps-interactive-uis-become-an-official-part-of-mcp).
- **MCP-UI**: "now standardized into MCP Apps" and continues as a community playground. Earlier adopters: Postman, HuggingFace, Shopify, Goose, ElevenLabs - [mcpui.dev](https://mcpui.dev/); [SEP-1865](https://modelcontextprotocol.io/seps/1865-mcp-apps-interactive-user-interfaces-for-mcp).
- **Thesys**: C1 was announced in April 2025 - [BusinessWire](https://www.businesswire.com/news/home/20250418761213/en). C1 launched on Product Hunt 2025-09-30 and OpenUI on 2026-03-11 - [search summary, Product Hunt](https://www.producthunt.com/products/thesys/launches/openui-2). C1 docs now live under `/legacy`. OpenUI is "the actively developed successor to C1," C1 APIs "keep working," and a migration guide maps C1 props to `AgentInterface` - [Thesys legacy docs](https://docs.thesys.dev/legacy). docs.thesys.dev redirects to openui.com/docs?from=c1 (observed 307). OpenUI had about 3.1k stars in early April 2026 - [search summary, ecosyste.ms](https://awesome.ecosyste.ms/projects/github.com%2Fthesysdev%2Fopenui). The claim that ">10,000 devs used our API" comes from Product Hunt marketing - [Product Hunt](https://www.producthunt.com/p/undefined/over-10000-devs-used-our-api-for-ai-interfaces-now-we-are-open-sourcing-it).
- **OpenAI**: the Apps SDK (built on MCP) went fully MCP Apps-compatible on 2026-02-22. Codex plugin distribution came 2026-03-25. `_meta["openai/visibility"]` was deprecated for `_meta.ui.visibility` on 2026-07-21. The latest entry is 2026-08-21 (OAuth/CIMD) - [Apps SDK changelog](https://developers.openai.com/apps-sdk/changelog). The docs index now frames it as "Plugins," with "legacy window.openai APIs" - [plugins index](https://developers.openai.com/apps-sdk). SEP-1865 says the Apps SDK "launched in November 2025." My recollection is DevDay, October 2025, so that date is UNVERIFIED. ChatKit: no 2026 changelog found.

### Inferences
- Convergence: MCP Apps absorbed MCP-UI and the Apps SDK. A2UI renders inside MCP Apps. AG-UI carries both, and OpenUI ships an `@openuidev/a2ui` package. The live standards question is now A2UI (declarative, native components) vs MCP Apps (sandboxed HTML), with AG-UI as transport.

## Genuine strengths (per product)
- **A2UI**: native rendering with the host's own components; no code execution; a rich data model with JSON Pointer binding; server-side binding hides sensitive values from the model; incremental surface updates; the widest renderer set (web, Flutter, Swift, Compose); Apache-2.0 with Google backing and real enterprise adopters - sources above.
- **AG-UI**: framework-neutral M+N transport; JSON Patch state sync; frozen JSON Schema 1.0; adopted by the agent frameworks of every major cloud; MIT.
- **CopilotKit**: one library spanning all three tiers (Controlled, A2UI, MCP Apps) plus shared state and HITL; self-hostable; MIT.
- **MCP Apps**: a formal MCP standard with ChatGPT, Claude and VS Code hosts; full interactivity for arbitrary UI; a sound sandbox, audit and consent model; prefetchable templates.
- **OpenUI / C1**: token-efficient streaming format (vendor-claimed); Zod-typed component libraries; four web frameworks; MIT core with an optional hosted gateway and autofix.
- **OpenAI Apps SDK / ChatKit**: distribution to ChatGPT users and Codex; checkout; ChatKit gives a ready chat UI with a fixed, designable widget set (Widget Builder).

## Additional related protocols (short)
- **Open-JSON-UI**: listed by AG-UI alongside A2UI and MCP Apps as a generative UI spec - [AG-UI README](https://github.com/ag-ui-protocol/ag-ui). Origin, backer and spec are UNVERIFIED. I believe it is an open take on OpenAI's ChatKit widget schema promoted by CopilotKit, but could not confirm.
- **Vercel json-render**: a JSON UI-spec renderer used as OpenUI's benchmark baseline (10,180 tokens vs OpenUI's 4,800) - [OpenUI README](https://raw.githubusercontent.com/thesysdev/openui/HEAD/README.md). No other details were verified.
