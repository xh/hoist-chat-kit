# Brief: generative UI landscape research

You are `blueprints-research`, a Claude session with one job: survey generative UI in the wild,
and the products comparable to Hoist and Blueprints, for John, Anselm and Lee. Use the
`anthropic-skills:deep-research` skill. Read only: don't edit code, commit or push, and write
only new files in this planning folder. Questions for John go to the orchestrator session in the
main hoist-react workspace (find it with ListAgents), or straight to John when he is in your tab.

## Context: what Blueprints is

Read `spec.md` (the overview and the format) and skim `decisions.md` in this folder first, so
you can compare accurately. In short: a blueprint is a validated, versioned JSON document
(elements, variables, sources, presets) that an LLM Architect builds and edits through JSON
Pointer operations. It renders with Hoist components, and binds to an app's data through a
semantic catalog (datasets, keys, field kinds), with Cube views, aggregators and source joins in
the browser. Chat answers render as blueprints too. It drops into an existing Hoist app.

## Scope

These are candidates to check, not confirmed facts. Some may have changed or may not exist.
Add anything significant that is missing.
- **GenUI libraries and protocols:** Vercel AI SDK generative UI and `json-render`, CopilotKit
  and AG-UI, OpenUI, Thesys C1, Google's A2UI, MCP-UI / MCP Apps, Tambo, assistant-ui,
  LangGraph generative UI.
- **AI analytics and BI:** Hex, ThoughtSpot, Tableau Pulse, Power BI Copilot, Metabase,
  Lightdash, Superset, Evidence, Rill.
- **Semantic layers with AI:** Cube, the dbt Semantic Layer, Malloy.
- **Dashboards as JSON or code:** Grafana dashboard JSON, Vega-Lite, Perspective layouts.

For each, answer:
- What does the model emit: code, a component tree, or a declarative spec?
- How is the output validated and kept safe?
- Is the output persistent and editable, or one-off?
- How does it bind to live data, and is there a semantic layer?
- How does a user refine a result?
- Does it embed in an existing app?
- What is the licence or hosting model?

## Deliverable

A private document (start it with the Artifact tool's `quickstart`, intent `document`):
- a landscape overview and a comparison table;
- a short profile of each entry, with source links and the date checked;
- how Blueprints compares: where it is ahead, where others are ahead, and what to borrow.

Send the comparison findings to the `deck` session in this workspace (`blueprints-deck`, find
it with ListAgents), which is building the Blueprints presentation, and the document link to the
orchestrator.

## Writing

- Cite a source for each claim about another product, and mark anything you could not verify.
- No em or en dashes. No unfounded estimates. Terse. Use the `xh:clear-writing` skill for prose.
- Compare fairly: give each product's strengths, not only Blueprints'.
