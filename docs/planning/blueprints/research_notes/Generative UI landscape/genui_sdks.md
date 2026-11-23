# Generative UI SDKs and libraries for React apps

All sources checked 2026-11-21. GitHub metadata (releases, licences, push dates) came from `gh` against each repo on that date. Products covered: Vercel AI SDK (UI + RSC), Vercel Labs json-render, assistant-ui (incl. its `generative-frame` package), Tambo, LangGraph/LangChain generative UI. Added because they matter to the landscape: Google A2UI, CopilotKit (AG-UI), Thesys OpenUI, MCP Apps.

Product status at a glance (each line is sourced in the sections below):

| Product | Model emits | Licence / hosting | Latest release seen | Status |
|---|---|---|---|---|
| AI SDK UI (`ai`, `@ai-sdk/react`) | Tool calls; app maps typed tool parts to its own components | Apache-2.0 library | `ai` 7.0.179, 2026-11-20 | Active, recommended path |
| AI SDK RSC (`@ai-sdk/rsc`) | Server-rendered React components streamed from `streamUI` tool handlers | Apache-2.0 library, needs an RSC framework | 3.0.179, 2026-11-20 | Still published; docs say "experimental", recommend AI SDK UI; marked "paused" in Oct 2024 |
| json-render | Declarative JSON spec (flat element map) streamed as RFC 6902 JSONL patches, constrained to a Zod catalog | Apache-2.0 library (Vercel Labs) | v0.23.2, 2026-11-18 | Very active, pre-1.0 |
| assistant-ui | Tool calls -> tool UIs; `present` node tree; spec-mode JSONL patches; sandboxed HTML/SVG widgets | MIT library + optional hosted Assistant Cloud | `@assistant-ui/core` 0.3.37, 2026-11-18 | Very active |
| Tambo | Tool calls whose args are Zod-validated props for registered components | MIT SDK (API under Apache-2.0); Tambo Cloud shut down | `react-v1.4.0`, 2026-10-08 | Hosted cloud ended 2026-10-31; OSS self-host only, no maintenance promise |
| LangGraph generative UI | Graph code pushes `{name, props}` UI messages into a `ui` state channel; client loads bundled components | MIT libraries; component bundling served by LangSmith deployment | `@langchain/langgraph-ui` 1.8.1, 2026-11-20 | Active |
| A2UI (added) | Declarative JSON protocol: flat component list + separate data model | Apache-2.0 | Python SDKs, 2026-11-17; spec v1.0 | Active, multi-vendor |
| CopilotKit (added) | All three: tool-call components, A2UI specs, MCP Apps | MIT + optional cloud "Intelligence" | v1.90.0, 2026-11-20 | Very active |
| OpenUI / Thesys (added) | "OpenUI Lang", a compact non-JSON UI language | MIT | `@openuidev/react-ui` 0.18.9, 2026-11-16 | Active |

## What does the model emit: code, a component tree, or a declarative spec?

### Takeaway
The field has converged on two patterns: (1) **tool call -> pre-built component**, where the model picks one registered component and fills its props (AI SDK UI, Tambo, CopilotKit "controlled", assistant-ui tool UIs, LangGraph); and (2) **declarative spec composed from a catalog**, where the model assembles a tree of allowed components with bindings (json-render, A2UI, assistant-ui spec mode, OpenUI Lang). Model-written code survives only as an explicitly sandboxed "open-ended" tier (assistant-ui widgets, MCP Apps). AI SDK RSC is the odd one out: the model emits tool calls, but the server returns rendered React Server Components.

### Cited Findings
**Vercel AI SDK UI**
- Generative UI in AI SDK UI is "the process of connecting the results of a tool call to a React component". The model calls a tool, the tool executes and returns data, and the data is passed to a React component — [AI SDK docs: Generative User Interfaces](https://github.com/vercel/ai/blob/main/content/docs/04-ai-sdk-ui/04-generative-user-interfaces.mdx)
- Since AI SDK 5.0, tool parts on a `UIMessage` use typed names `tool-${toolName}` and carry states `input-available`, `output-available` and `output-error`. The client switches on `part.type === 'tool-displayWeather'` to render — [same doc](https://github.com/vercel/ai/blob/main/content/docs/04-ai-sdk-ui/04-generative-user-interfaces.mdx)

**Vercel AI SDK RSC**
- `streamUI` "calls a model and allows it to respond with React Server Components". Also provides `createStreamableUI`, `useUIState`, `useAIState`, `createAI` and `useActions` — [AI SDK RSC overview](https://github.com/vercel/ai/blob/main/content/docs/05-ai-sdk-rsc/01-overview.mdx)

**json-render**
- AI "generates interfaces from natural language prompts, constrained to components you define". "AI can only use components in your catalog". The output is a JSON spec — [json-render README](https://github.com/vercel-labs/json-render/blob/main/README.md)
- The spec is flat: a `root` key plus an `elements` map of `{type, props, children:[ids]}`. Optional fields are `visible`, `watch`, and a top-level `state` — [README](https://github.com/vercel-labs/json-render/blob/main/README.md); [data-binding doc](https://github.com/vercel-labs/json-render/blob/main/apps/web/content/docs/data-binding.mdx)
- The stream format is "SpecStream": JSONL where "each line is a JSON patch operation" (RFC 6902 `add/remove/replace/move/copy/test`) that builds the spec progressively — [streaming doc](https://github.com/vercel-labs/json-render/blob/main/apps/web/content/docs/streaming.mdx)
- Two generation modes. "Standalone" outputs only JSONL patches and suits playgrounds, form and dashboard builders. "Inline" embeds UI within a conversation. Both use the same patch format — [generation-modes doc](https://github.com/vercel-labs/json-render/blob/main/apps/web/content/docs/generation-modes.mdx)
- An alternative YAML wire format (`@json-render/yaml`) streams YAML and diffs successive parses into JSON Patch ops — [yaml API doc](https://github.com/vercel-labs/json-render/blob/main/apps/web/content/docs/api/yaml.mdx)
- Experimental "Jev" composition (`experimental_composeSpec`, `experimental_createEvaluator`, since v0.21.0). A decision model "chooses among discrete options instead of writing free-form text". The app supplies "atomic element candidates" (component, concrete props, state bindings, allowed actions), and the model only selects, orders and places them — [jev doc](https://github.com/vercel-labs/json-render/blob/main/apps/web/content/docs/jev.mdx)

**assistant-ui**
- Four answer formats. Markdown. A `present` tree built from your component vocabulary. A spec via `render_spec`, which adds "state, bindings, and conditions" and "runs no model-written code". A widget of "model-written HTML and SVG that runs in a sandboxed frame" via `show_widget` — [assistant-ui: Choosing an answer format](https://github.com/assistant-ui/assistant-ui/blob/main/apps/docs/content/docs/tools/generative-ui-formats.mdx)
- `JSONGenerativeUI` creates `present` and `prompt_user` tools from a component library. `GenerativeUISpec` is "the serializable node tree an assistant emits" — [Generative UI API reference index](https://github.com/assistant-ui/assistant-ui/blob/main/apps/docs/content/docs/(reference)/api-reference/generative-ui/index.mdx)
- Classic tool UIs: the README lists "render tool calls and JSON as React components" and names the `makeAssistantToolUI` primitive — [assistant-ui README](https://github.com/assistant-ui/assistant-ui/blob/main/README.md)
- Spec mode in `generative-frame` "renders your own components from JSONL patches" (`createSpecStream`, `parseSpecStream`, `applyPatch`, `validateSpec`) — [generative-frame intro](https://github.com/assistant-ui/assistant-ui/blob/main/apps/docs/content/docs-sites/generative-frame/index.mdx)

**Tambo**
- "Register your components with Zod schemas. The agent picks the right one and streams the props." "These schemas become LLM tool definitions—the agent calls them like functions and Tambo renders the result" — [Tambo README](https://github.com/tambo-ai/tambo/blob/main/README.md)

**LangGraph**
- Graph code emits UI with `push_ui_message(name, props, message=...)` (Python) or `typedUi<typeof ComponentMap>(config).push(...)` (JS). The `name` keys into a component map exported from `ui.tsx` and registered under the `"ui"` key of `langgraph.json` — [LangChain docs: Generative UI in React](https://docs.langchain.com/langsmith/generative-ui-react)

**A2UI (added)**
- "A2UI expresses UI using _data_, not code", validated against a schema, with "a catalog of components" the agent composes — [A2UI README](https://github.com/a2ui-project/a2ui/blob/main/README.md)
- v1.0 messages: `createSurface`, `updateComponents`, `updateDataModel`, `deleteSurface` (plus `callRendererFunction` and `agentFunctionResponse`). Components form a flat list with `id`s and ID-referenced children, and a component with id `root` is required — [A2UI v1.0 specification](https://a2ui.org/specification/v1.0-a2ui/)

**CopilotKit (added)**
- "Generative UI, three ways". **Controlled**: picks from registered components, via AG-UI tool calls. **Declarative**: a structured spec, via A2UI. **Open-ended**: "ships a full interface that runs in a sandbox", via MCP Apps — [CopilotKit README](https://github.com/CopilotKit/CopilotKit/blob/main/README.md)
- Controlled components are registered with `useComponent({name, parameters: zodSchema, render})`, and the model emits "a tool call whose arguments match the schema" — [CopilotKit docs: generative UI](https://docs.copilotkit.ai/generative-ui)

**OpenUI / Thesys (added)**
- Model emits "OpenUI Lang: a compact, streaming-first language for model-generated UI", generated from an allowed component library — [OpenUI README](https://github.com/thesysdev/openui/blob/main/README.md)
- Vendor-measured token counts: about 52% fewer tokens than json-render and "Thesys C1 JSON" across 7 scenarios (4,800 vs 10,180 tokens in total) — [OpenUI README](https://github.com/thesysdev/openui/blob/main/README.md) (vendor claim, not independently checked)

### Inferences
- Tool-call -> component suits "show this result nicely". Spec composition suits "build me a view/dashboard", which is the shape relevant to a persistent, editable artifact.
- json-render's flat `root` + `elements` map and A2UI's flat ID-referenced list both make per-element addressing (and therefore patching) cheap. Neither uses a nested tree as the wire shape.

### Gaps
- Exact AI SDK v7 changes to generative UI, if any, were not reviewed. The v7 release notes were not read. The generative UI doc still describes the v5 tool-part model.

## How is the output validated and kept safe?

### Takeaway
Spec-based tools validate against a catalog: component-type allowlists, Zod or JSON Schema props, structural validation, and named actions only. Tool-call tools rely on the tool's Zod schema. Where model-written code is allowed, it goes into a cross-origin sandboxed iframe with a strict CSP. Only AI SDK RSC runs app server code chosen by the model at render time, but that code is the developer's own tool handlers.

### Cited Findings
- **AI SDK UI**: tools are defined with Zod `inputSchema` via `tool()`. The model can only trigger developer-defined tools, and the developer writes the component that renders the output — [Generative User Interfaces](https://github.com/vercel/ai/blob/main/content/docs/04-ai-sdk-ui/04-generative-user-interfaces.mdx)
- **json-render**: "Guardrailed - AI can only use components in your catalog". "Predictable - JSON output matches your schema". The catalog defines component props as Zod schemas plus named `actions` — [README](https://github.com/vercel-labs/json-render/blob/main/README.md)
- **json-render**: `validateSpec` checks a spec for structural issues. Built-in form validators (`required`, `email`, `pattern`, ...) attach via `checks` — [catalog doc](https://github.com/vercel-labs/json-render/blob/main/apps/web/content/docs/catalog.mdx); [validation doc](https://github.com/vercel-labs/json-render/blob/main/apps/web/content/docs/validation.mdx)
- **json-render**: v0.23.1 bounded rendered child ids and the number of validation issues reported, a hardening against hostile specs — [changelog](https://github.com/vercel-labs/json-render/blob/main/apps/web/content/docs/changelog.mdx)
- **json-render Jev**: "The composer never executes actions". Edit seed specs "with cycles, shared children, missing references, unreachable nodes, or unsupported expressions are rejected before evaluation" — [jev doc](https://github.com/vercel-labs/json-render/blob/main/apps/web/content/docs/jev.mdx); [core API doc](https://github.com/vercel-labs/json-render/blob/main/apps/web/content/docs/api/core.mdx)
- **assistant-ui**: spec mode "runs no model-written code". In assistant-ui's own runs, "all but one of the 54 spec answers passed validation" — [answer formats doc](https://github.com/assistant-ui/assistant-ui/blob/main/apps/docs/content/docs/tools/generative-ui-formats.mdx)
- **assistant-ui widgets**: "Widget code is written by a model, so treat it as untrusted". Each widget renders in a "Safe Content Frame" on a hashed subdomain of a Public Suffix List domain, so it is a separate site. It cannot reach the host DOM, cookies or storage. An `opaqueOrigin` null-origin sandbox is an alternative. A CSP the widget cannot lift defaults to `default-src 'none'`. The package also ships a `repairLoop` — [generative-frame security](https://github.com/assistant-ui/assistant-ui/blob/main/apps/docs/content/docs-sites/generative-frame/security.mdx); [generative-frame intro](https://github.com/assistant-ui/assistant-ui/blob/main/apps/docs/content/docs-sites/generative-frame/index.mdx)
- **Tambo**: props are Zod `propsSchema`. Schemas become tool definitions — [Tambo README](https://github.com/tambo-ai/tambo/blob/main/README.md)
- **LangGraph**: components are developer-written and bundled, and the model or graph only selects a name and props. They "render in a shadow DOM", which isolates styles only. This is not a security sandbox — [Generative UI in React](https://docs.langchain.com/langsmith/generative-ui-react)
- **A2UI**: "Security first", with "expressing UI as data, validating inputs and outputs against a schema, and disallowing arbitrary executable code". It targets agents that are "remote, third-party, or operat[e] across a trust boundary" — [A2UI README](https://github.com/a2ui-project/a2ui/blob/main/README.md)
- **A2UI spec**: functions declare `allowedCallers` (`rendererOnly`, `agentOnly`, `rendererOrAgent`). `requiresUserActivation` restricts a function to user gestures. Invalid calls fail with `INVALID_FUNCTION_CALL`. Catalogs must not fetch disallowed external refs. Components carry `@checks` validation rules — [A2UI v1.0 spec](https://a2ui.org/specification/v1.0-a2ui/)

### Inferences
- json-render, A2UI and assistant-ui spec mode share the same safety model: catalog allowlist, schema-checked props, named actions handled by app code, and no `eval`. This is the model a Hoist-based kit would copy.
- LangGraph's shadow DOM gives style isolation, not code isolation. Its components are trusted developer code fetched from the deployment.

### Gaps
- No independent security audits were found for any of these libraries.
- Whether AI SDK UI validates tool *outputs* against a schema before rendering was not checked (`outputSchema` support is UNVERIFIED).

## Is the output persistent and editable, or one-off in a chat message?

### Takeaway
Chat-first SDKs (AI SDK, assistant-ui, LangGraph, CopilotKit) persist UI only as part of message or thread history, which can be replayed but is not a first-class editable document. json-render is the clear exception: a spec is a standalone JSON document that the model can refine with patches, that devtools can edit, and that can be exported to code or turned into a full Next.js app. Tambo's "interactable components" persist on the page and the model updates them. A2UI surfaces are long-lived and updated by component id.

### Cited Findings
- **AI SDK UI**: persistence is message persistence. Store and reload `UIMessage[]` with `useChat`/`streamText`. Tool parts, and so the generative UI, re-render from stored messages — [Chatbot Message Persistence](https://github.com/vercel/ai/blob/main/content/docs/04-ai-sdk-ui/03-chatbot-message-persistence.mdx)
- **AI SDK RSC**: has a separate "saving and restoring states" doc. UI state is rebuilt from serialisable AI state — [RSC docs directory](https://github.com/vercel/ai/tree/main/content/docs/05-ai-sdk-rsc) (file `03-saving-and-restoring-states.mdx`; contents not read in detail)
- **json-render**: refinement mode. Passing `currentSpec` "instructs the AI to use the specified edit modes instead of recreating the entire spec". Modes are `patch` (RFC 6902), `merge` (RFC 7396) and `diff` (unified diff) — [core API doc](https://github.com/vercel-labs/json-render/blob/main/apps/web/content/docs/api/core.mdx)
- **json-render**: YAML format supports ` ```yaml-edit ` fences (deep-merged partial YAML) and ` ```diff ` fences against the serialised spec — [yaml API doc](https://github.com/vercel-labs/json-render/blob/main/apps/web/content/docs/api/yaml.mdx)
- **json-render Jev**: "Pass `initialSpec` to edit an existing version. The composer validates and clones it, preserving unchanged elements, IDs, action bindings, and state". Edits are bounded ops: replace, remove subtree, move/reorder — [core API doc](https://github.com/vercel-labs/json-render/blob/main/apps/web/content/docs/api/core.mdx)
- **json-render**: Code Export emits standalone framework code ("no json-render dependencies"). `@json-render/next` and `@json-render/tanstack-start` turn a spec into a full app with routes, layouts and SSR — [code-export doc](https://github.com/vercel-labs/json-render/blob/main/apps/web/content/docs/code-export.mdx); [README](https://github.com/vercel-labs/json-render/blob/main/README.md)
- **json-render**: devtools give a "Spec tree, state editor, action log, stream log, catalog browser, DOM picker". v0.23.0 fixed "Spec Replay" of message parts — [README](https://github.com/vercel-labs/json-render/blob/main/README.md); [changelog](https://github.com/vercel-labs/json-render/blob/main/apps/web/content/docs/changelog.mdx)
- **Tambo**: "Generative Components: Render once in response to a message". "Interactable Components: Persist and update as users refine requests. Shopping carts, spreadsheets, task boards" (`withInteractable`). Threads and messages live in the Tambo backend — [Tambo README](https://github.com/tambo-ai/tambo/blob/main/README.md)
- **LangGraph**: UI elements are stored in a `ui` channel of graph state via `ui_message_reducer` / `uiMessageReducer`. A push with the same `id` and `merge: true` merges props, and `ui.delete(id)` removes the element — [Generative UI in React](https://docs.langchain.com/langsmith/generative-ui-react)
- **CopilotKit**: "Conversations that survive reloads, devices, and sessions, with generative UI intact" (AG-UI Streams) — [CopilotKit README](https://github.com/CopilotKit/CopilotKit/blob/main/README.md)
- **A2UI**: `updateComponents` upserts components by `id` on an existing surface. A `surfaceId` is unique for the renderer's lifetime — [A2UI v1.0 spec](https://a2ui.org/specification/v1.0-a2ui/)

### Inferences
- LangGraph UI state probably persists with the thread whenever a checkpointer is configured, since it is ordinary graph state. The doc does not say so explicitly.
- None of these products ships built-in versioning, saved "documents", or named artifacts outside a thread, json-render included. json-render gives the primitives (a serialisable spec plus patch-based edits), and the app owns storage and versions.

### Gaps
- No product found offers first-class human direct-manipulation editing of a generated layout (drag/drop, property inspector) as a product feature. json-render devtools' state editor is a developer tool. UNVERIFIED whether its spec tree is editable.

## How does it bind to live data, and is there a semantic layer or data catalog?

### Takeaway
No product has a semantic layer or governed data catalog. Data arrives in one of three ways: as tool results (the model calls a data tool and the component gets the result), as a client-side state model that specs bind to by JSON Pointer (json-render, A2UI, assistant-ui spec mode), or through app-registered actions and watchers that fetch data. The catalog is a *component* catalog, not a data catalog.

### Cited Findings
- **AI SDK UI**: data comes from tool execution. The tool "will execute and return data", and that data "can then be passed to a React component" — [Generative User Interfaces](https://github.com/vercel/ai/blob/main/content/docs/04-ai-sdk-ui/04-generative-user-interfaces.mdx)
- **json-render**: a spec `state` object, or runtime state via `StateProvider`/`useStateStore`. Expressions: `$state` (JSON Pointer read), `$bindState` (two-way), `$cond`, `$template`, `$computed` (calls a registered function) — [data-binding doc](https://github.com/vercel-labs/json-render/blob/main/apps/web/content/docs/data-binding.mdx); [README](https://github.com/vercel-labs/json-render/blob/main/README.md)
- **json-render**: `watch` on an element fires an action, e.g. `loadCities`, when a state path changes. This is how app code fetches live data. StateStore adapters exist for Redux, Zustand, Jotai and XState — [README](https://github.com/vercel-labs/json-render/blob/main/README.md)
- **json-render**: OpenAPI integration generates forms and UIs from OpenAPI schemas. The doc marks this as a "Concept", with illustrative examples — [openapi doc](https://github.com/vercel-labs/json-render/blob/main/apps/web/content/docs/openapi.mdx)
- **json-render Jev**: "Jev cannot invent missing prose or data". Candidates bind props to `initialState` with `$state` or are built "from the current records" — [jev doc](https://github.com/vercel-labs/json-render/blob/main/apps/web/content/docs/jev.mdx)
- **assistant-ui spec mode**: specs show values that "`$calc` formulas compute from its state", and "an action handler you write can compute anything else into state" — [answer formats doc](https://github.com/assistant-ui/assistant-ui/blob/main/apps/docs/content/docs/tools/generative-ui-formats.mdx)
- **A2UI**: the data model is separate from components. Bindings use `{"@path": "..."}` JSON Pointers, with relative paths inside list templates. `updateDataModel {path, value}` upserts, and `null` deletes. When `sendDataModel` is true, the full data model goes back to the agent — [A2UI v1.0 spec](https://a2ui.org/specification/v1.0-a2ui/)
- **Tambo**: "Additional context" (`contextHelpers`) passes user state, app settings and the current page to the model. Data access is through MCP servers ("Linear, Slack, databases") and browser-side "Local Tools" — [Tambo README](https://github.com/tambo-ai/tambo/blob/main/README.md)
- **CopilotKit**: "Shared state: One state layer that both the agent and your UI read and write in real time" — [CopilotKit README](https://github.com/CopilotKit/CopilotKit/blob/main/README.md)
- **OpenUI**: its own comparison table claims "Built-in data fetching: Yes" for OpenUI and "No" for json-render, A2UI and CopilotKit — [OpenUI README](https://github.com/thesysdev/openui/blob/main/README.md) (vendor claim; mechanism not verified)

### Inferences
- The split between a UI spec and a separate state/data model (json-render `state`, A2UI `updateDataModel`) is the common design. It lets live data refresh without regenerating layout. This maps onto a Hoist design where a spec binds to app-owned stores and models.
- A semantic layer (governed metrics, dimensions, entitlements) is left entirely to the host app in every product reviewed.

### Gaps
- OpenUI's "built-in data fetching" mechanism was not examined.

## How does a user refine a result?

### Takeaway
Re-prompting is universal. Incremental model edits exist in json-render (patch, merge or diff against `currentSpec`; Jev's bounded replace, remove and move), LangGraph (merge props by UI id), A2UI (upsert components or data by id) and Tambo (the model updates props of interactable components). Direct manipulation is limited to interacting with the rendered components (inputs, `setState` actions, two-way bindings) rather than editing the layout.

### Cited Findings
- **json-render**: `currentSpec` plus `editModes` (`patch` | `merge` | `diff`). The prompt tells the model to edit, not recreate — [core API doc](https://github.com/vercel-labs/json-render/blob/main/apps/web/content/docs/api/core.mdx)
- **json-render**: user interaction through the built-in `setState` action and `$bindState`, which re-evaluate visibility and dynamic props — [README](https://github.com/vercel-labs/json-render/blob/main/README.md)
- **Tambo**: interactable components "Persist and update as users refine requests". "'Add a task' updates your `<TaskBoard>`". Suggestions (`useTamboSuggestions`) offer clickable follow-up prompts — [Tambo README](https://github.com/tambo-ai/tambo/blob/main/README.md)
- **LangGraph**: push again with the same `id` and `merge: true` to update an element's props — [Generative UI in React](https://docs.langchain.com/langsmith/generative-ui-react)
- **A2UI**: the renderer sends an `action` (`name`, `surfaceId`, `sourceComponentId`, `context`, optional `userMessage`) back to the agent, which responds with further `updateComponents` or `updateDataModel` — [A2UI v1.0 spec](https://a2ui.org/specification/v1.0-a2ui/)
- **assistant-ui**: `prompt_user` / `promptUser()` waits for user input. Widgets get an `onPrompt` callback to send follow-up chat messages. The README cites "inline human approvals" — [answer formats doc](https://github.com/assistant-ui/assistant-ui/blob/main/apps/docs/content/docs/tools/generative-ui-formats.mdx); [generative-frame intro](https://github.com/assistant-ui/assistant-ui/blob/main/apps/docs/content/docs-sites/generative-frame/index.mdx); [README](https://github.com/assistant-ui/assistant-ui/blob/main/README.md)
- **AI SDK UI**: refinement is a new chat turn. No incremental UI-edit mechanism is documented in the generative UI guide — [Generative User Interfaces](https://github.com/vercel/ai/blob/main/content/docs/04-ai-sdk-ui/04-generative-user-interfaces.mdx)

### Inferences
- json-render's `patch`/`merge` edit modes plus Jev's bounded edit ops are the most developed "refine an existing artifact" story. They are model-side, though, and the app still owns storage and undo.

### Gaps
- No product found with a documented UI for a human to edit the generated layout directly (move, add or remove elements) and then hand the edited spec back to the model.

## Does it embed in an existing app (library vs hosted product)?

### Takeaway
All are embeddable libraries. Hosted dependencies vary: AI SDK and json-render need none. assistant-ui and CopilotKit offer optional clouds. LangGraph's component bundling depends on a LangSmith/Agent Server deployment. Tambo's SDK assumed the Tambo backend, whose hosted version is now gone.

### Cited Findings
- **AI SDK**: npm library (`ai`, `@ai-sdk/react`) with any backend route — [Generative User Interfaces](https://github.com/vercel/ai/blob/main/content/docs/04-ai-sdk-ui/04-generative-user-interfaces.mdx). RSC needs "frameworks that support React Server Components" — [RSC overview](https://github.com/vercel/ai/blob/main/content/docs/05-ai-sdk-rsc/01-overview.mdx)
- **json-render**: library. `<Renderer spec registry>` drops into any React tree. Renderers exist for React, Vue, Svelte, Solid, React Native, SwiftUI (v0.23.0), PDF, email, Remotion, Ink, R3F, and Chat SDK cards for Slack and Teams. Its docs include A2UI, AG-UI, Adaptive Cards and MCP Apps (`@json-render/mcp`) integrations — [README](https://github.com/vercel-labs/json-render/blob/main/README.md); [changelog](https://github.com/vercel-labs/json-render/blob/main/apps/web/content/docs/changelog.mdx); [docs tree](https://github.com/vercel-labs/json-render/tree/main/apps/web/content/docs)
- **assistant-ui**: React primitives (`ThreadPrimitive`, `MessagePrimitive`, `ComposerPrimitive`...) with runtimes for AI SDK (`useChatRuntime`), LangGraph (`useLangGraphRuntime`), data stream, or custom. `generative-frame` core is framework-agnostic — [README](https://github.com/assistant-ui/assistant-ui/blob/main/README.md); [generative-frame intro](https://github.com/assistant-ui/assistant-ui/blob/main/apps/docs/content/docs-sites/generative-frame/index.mdx)
- **Tambo**: "a React SDK plus a backend that handles conversation state and agent execution". The `TamboProvider` requires an `apiKey` and `userKey`/`userToken` — [Tambo README](https://github.com/tambo-ai/tambo/blob/main/README.md)
- **LangGraph**: prerequisites are LangSmith, the Agent Server and `useStream()`. "LangSmith will automatically bundle your UI components code and styles and serve them as external assets", and `LoadExternalComponent` fetches them — [Generative UI in React](https://docs.langchain.com/langsmith/generative-ui-react)
- **CopilotKit**: frontend SDKs for React, Angular, Vue, React Native, Slack and Teams over AG-UI to LangGraph, CrewAI, Mastra, ADK and PydanticAI agents. "CopilotKit Intelligence" is "cloud-hosted or self-hosted" — [CopilotKit README](https://github.com/CopilotKit/CopilotKit/blob/main/README.md)
- **A2UI**: renderers for "React, Angular, Lit, Flutter, SwiftUI and Jetpack Compose" — [repo description via gh](https://github.com/a2ui-project/a2ui)

### Inferences
- json-render and A2UI are the most "bring your own component library" of the set. Their renderers are thin registries over host components, so a Hoist kit could implement a renderer over Hoist components in the same way. assistant-ui and CopilotKit bring their own chat shell.

### Gaps
- None.

## What is the licence or hosting model?

### Takeaway
All core libraries are permissive OSS (MIT or Apache-2.0). Commercial surfaces are optional hosted services: Assistant Cloud, CopilotKit Intelligence, LangSmith, and the Thesys console/gateway. Tambo Cloud is closed.

### Cited Findings
- **Vercel AI SDK**: Apache-2.0 ("Copyright 2023 Vercel, Inc. Licensed under the Apache License, Version 2.0"). GitHub's licence detector reports NOASSERTION — [vercel/ai LICENSE](https://github.com/vercel/ai/blob/main/LICENSE)
- **json-render**: Apache-2.0, a "Vercel Labs Product" — [README](https://github.com/vercel-labs/json-render/blob/main/README.md)
- **assistant-ui**: "MIT, with optional Assistant Cloud for managed thread persistence and analytics" — [README](https://github.com/assistant-ui/assistant-ui/blob/main/README.md)
- **Tambo**: "MIT unless otherwise noted. Some workspaces (like `apps/api`) are Apache-2.0" — [Tambo README](https://github.com/tambo-ai/tambo/blob/main/README.md)
- **LangGraph JS**: MIT (GitHub licence API, `langchain-ai/langgraphjs`). LangSmith deployment is a LangChain commercial platform — [langgraphjs repo](https://github.com/langchain-ai/langgraphjs). LangSmith pricing and self-host terms: UNVERIFIED
- **A2UI**: Apache-2.0. The repo moved from `google/A2UI` to `a2ui-project/a2ui` (gh redirect) — [a2ui repo](https://github.com/a2ui-project/a2ui)
- **CopilotKit**: MIT — [README](https://github.com/CopilotKit/CopilotKit/blob/main/README.md)
- **OpenUI**: MIT. `@openuidev/observability-cloud` ships events to the hosted "Thesys console" / "OpenUI Gateway". The repo was renamed from `thesysdev/crayon` — [OpenUI README](https://github.com/thesysdev/openui/blob/main/README.md)

### Inferences
- None of the libraries' licences would block use in a commercial XH library. Hosted lock-in risk sits only in the optional clouds, and Tambo is the cautionary example.

### Gaps
- Pricing for Assistant Cloud, CopilotKit Intelligence, LangSmith and Thesys was not researched.

## Current status, latest version and release dates

### Takeaway
AI SDK UI, json-render, assistant-ui, LangGraph, CopilotKit, A2UI and OpenUI all released within the last week. AI SDK RSC is still published in lock-step but labelled experimental, and was formally "paused" in 2024. Tambo is effectively winding down: its hosted cloud is shut, its last release was in early October 2026, and it makes no maintenance commitment.

### Cited Findings
- **AI SDK**: `ai` latest is 7.0.179, published 2026-11-20. 7.0.0 was published 2026-06-25, 6.0.0 on 2025-12-22 and 5.0.0 on 2025-07-31. Dist-tags `ai-v6` and `ai-v5` are still maintained — npm registry (`npm view ai`), checked 2026-11-21; [vercel/ai releases](https://github.com/vercel/ai/releases)
- **AI SDK RSC**: `@ai-sdk/rsc` 3.0.179, modified 2026-11-20 (npm). The docs banner says "AI SDK RSC is currently experimental. We recommend using AI SDK UI for production", with a migration guide — [RSC overview](https://github.com/vercel/ai/blob/main/content/docs/05-ai-sdk-rsc/01-overview.mdx)
- **AI SDK RSC history**: commit "mark AI SDK RSC as paused" (#3250, 2024-10-14), then "update RSC warning wording" (#3258, 2024-10-15). RSC moved to its own package in "extract rsc to separate package" (#5542, 2025-04-08) — [git history of overview doc](https://github.com/vercel/ai/commits/main/content/docs/05-ai-sdk-rsc/01-overview.mdx). Older info: the "paused" wording dates from Oct 2024. Current wording is "experimental"
- **json-render**: v0.23.2 (changelog dated November 18, 2026; GitHub release 2026-11-19). v0.23.0 (2026-11-15) added a SwiftUI renderer. v0.22.0 (2026-11-04) added a Chat SDK renderer. About 19.8k stars — [changelog](https://github.com/vercel-labs/json-render/blob/main/apps/web/content/docs/changelog.mdx); [releases](https://github.com/vercel-labs/json-render/releases)
- **assistant-ui**: `@assistant-ui/core` 0.3.37 (2026-11-18). Repo last pushed 2026-11-21. About 13.4k stars. Packages include `generative-ui`, `react-generative-ui`, `generative-frame`, `safe-content-frame`, `react-a2a`, `react-ag-ui` and `react-mcp` — [releases](https://github.com/assistant-ui/assistant-ui/releases); [packages dir](https://github.com/assistant-ui/assistant-ui/tree/main/packages)
- **Tambo**: "Tambo Cloud is shutting down" (post dated October 1, 2026). New signups are closed. The hosted API stopped 2026-10-31, and user data is deleted 2026-11-30. "Tambo stays open source and self-hostable", but the post makes no development or maintenance commitment. The team now builds "Charming" — [Tambo shutdown post](https://tambo.co/blog/posts/tambo-is-shutting-down); [README](https://github.com/tambo-ai/tambo/blob/main/README.md)
- **Tambo**: last releases `react-v1.4.0` (2026-10-08) and `web-v0.136.0` (2026-10-09). The latest default-branch commit is 2026-10-09 — [releases](https://github.com/tambo-ai/tambo/releases); [commits](https://github.com/tambo-ai/tambo/commits/main)
- **LangGraph**: `@langchain/langgraph-ui` 1.8.1 (2026-11-20). `@langchain/react` 2.0.0-rc.3 (2026-11-19). Python `langgraph` 1.2.24 (2026-11-20). The generative UI doc carries no deprecation or beta marker — [langgraphjs releases](https://github.com/langchain-ai/langgraphjs/releases); [langgraph releases](https://github.com/langchain-ai/langgraph/releases); [Generative UI in React](https://docs.langchain.com/langsmith/generative-ui-react)
- **A2UI**: spec v1.0, "created Nov 20, 2025, last updated Jun 8, 2026". Python SDK releases 2026-11-17. About 17.7k stars — [A2UI v1.0 spec](https://a2ui.org/specification/v1.0-a2ui/); [releases](https://github.com/a2ui-project/a2ui/releases)
- **CopilotKit**: v1.90.0 (2026-11-20). Supports "AG-UI 1.0 + A2UI 1.0". About 38.9k stars — [releases](https://github.com/CopilotKit/CopilotKit/releases); [README](https://github.com/CopilotKit/CopilotKit/blob/main/README.md)
- **OpenUI**: `@openuidev/react-ui` 0.18.9 (2026-11-16). `@openuidev/react-lang` 1.1.1 (npm). About 15.4k stars — [releases](https://github.com/thesysdev/openui/releases)
- **MCP Apps** (the open-ended tier that CopilotKit, assistant-ui and json-render integrate): `modelcontextprotocol/ext-apps` v2.1.0 (2026-11-10), described as the "standard for UIs embedded AI chatbots, served by MCP servers". The older community `MCP-UI-Org/mcp-ui` has client v7.1.1 (2026-05-09), last pushed 2026-09-16 — [ext-apps](https://github.com/modelcontextprotocol/ext-apps); [mcp-ui](https://github.com/MCP-UI-Org/mcp-ui)

### Inferences
- Interop is converging. json-render documents A2UI, AG-UI and MCP Apps integrations. assistant-ui converts A2UI surfaces into its specs and renders MCP Apps widgets. CopilotKit speaks A2UI 1.0. A2UI looks like the emerging neutral wire format, and json-render the most capable React-side spec runtime.

### Gaps
- AI SDK v7 release notes, and whether v7 changed anything in generative UI, were not read.
- No adoption numbers beyond GitHub stars were gathered. Stars come from `gh repo view` on 2026-11-21.

## Strengths per product

### Takeaway
Each product has a distinct strength. AI SDK UI is the simplest and most widely used tool-to-component base. json-render is the richest editable-spec runtime. assistant-ui has the broadest set of formats, plus real sandboxing and a published format comparison. Tambo pioneered persistent interactable components. LangGraph colocates UI with agent graphs. A2UI is the cross-platform, trust-boundary protocol. CopilotKit is the most complete agent-to-app stack. OpenUI is the most token-efficient.

### Cited Findings
- **AI SDK UI**: typed tool parts (`tool-${name}`) with lifecycle states give type-safe rendering of streaming tool input and output with minimal machinery. It is provider-agnostic — [Generative User Interfaces](https://github.com/vercel/ai/blob/main/content/docs/04-ai-sdk-ui/04-generative-user-interfaces.mdx)
- **AI SDK RSC**: server components can stream real UI with server-side data access and no client-side mapping. It is the most "native React" model, but tied to RSC frameworks — [RSC overview](https://github.com/vercel/ai/blob/main/content/docs/05-ai-sdk-rsc/01-overview.mdx)
- **json-render**: catalog-generated prompts (`catalog.prompt()`), patch-streamed progressive render, a state model with two-way bindings and watchers, three edit modes for refinement, code export, devtools, and renderers on about 15 targets — [README](https://github.com/vercel-labs/json-render/blob/main/README.md); [core API doc](https://github.com/vercel-labs/json-render/blob/main/apps/web/content/docs/api/core.mdx)
- **assistant-ui**: the only product reviewed with a published per-format quality comparison (3 models × 6 tasks × 4 formats). Specs scored at or above `present` trees, and widgets won only on computational tasks. It also has cross-site sandboxing for model-written widgets — [answer formats doc](https://github.com/assistant-ui/assistant-ui/blob/main/apps/docs/content/docs/tools/generative-ui-formats.mdx); [security doc](https://github.com/assistant-ui/assistant-ui/blob/main/apps/docs/content/docs-sites/generative-frame/security.mdx)
- **Tambo**: components on the page that the model can update over time (`withInteractable`), plus MCP support (tools, prompts, elicitations, sampling) — [Tambo README](https://github.com/tambo-ai/tambo/blob/main/README.md)
- **LangGraph**: UI lives in agent state, so long-running graphs can push, merge and delete UI elements mid-run. Components are deployed with the agent — [Generative UI in React](https://docs.langchain.com/langsmith/generative-ui-react)
- **A2UI**: a separate data model and component list, native renderers across six UI frameworks, and an explicit design for untrusted remote agents — [A2UI README](https://github.com/a2ui-project/a2ui/blob/main/README.md); [spec](https://a2ui.org/specification/v1.0-a2ui/)

### Inferences
- For a persistent, editable "blueprint" artifact, json-render (spec + patch edits + state binding) and A2UI (spec + data-model separation) are the closest prior art. The tool-call-to-component SDKs only cover the in-chat, one-off end.

### Gaps
- No hands-on testing was done. All findings come from docs and READMEs.
