# Brief: Blueprints UI/UX pass

You are `blueprints-ui`. Goal: make the human-facing Blueprints UI modern and intuitive, so a user
can get a high-level picture of how a blueprint is structured and wired, and can make changes by
hand without being overwhelmed. John wants **the full design proposal ready when he returns**.
This phase is design only: no code changes in either repo.

## Scope

In scope:
- **Toolbox Blueprints tab:** the blueprint list (library), the designer explanatory panel, and
  the framing around the Architect, blueprint area and inspector.
- **The inspector** and everything in it: Config, Placement, Outline, Variables, Sources,
  Presets, Issues, History, Publishes, JSON.
- **The Data Catalog and Registry pages.**
- **The blueprint area's edit-mode interactions:** selection, hover, drop targets, add, move,
  delete, placement, undo, empty states, keyboard.

- **Widget chrome in the layout:** how widgets are framed in a blueprint: canvas cell and dash
  view wrapping, panel headers, titles, header items, borders, spacing, density, empty and
  loading and error states. These may change in hoist-react, for example the dash canvas view
  frame, or be overridden for blueprints. Say which, and why.

Out of scope: chat kit's chat UI, the rest of Toolbox, and redesigning hoist-react's inputs and
controls themselves.

## Tone

Modern but professional. These apps run in enterprise environments, at large hedge funds and
related businesses. Not a consumer app, but aesthetically pleasing and up to date with the UI
standards users expect from a modern AI-integrated application. Dense data stays legible, and
nothing is decoration for its own sake.

Be exhaustive: cover every surface in scope, every state, and every interaction.

## Where the code lives (read only for now)

- **chat kit**, `~/xh/worktrees/blueprints/hoist-chat-kit`, branch `blueprints`, owned by
  `blueprints-ck`: `desktop/cmp/blueprint/` (widgets, `design/` for the inspector, palette,
  outline and editors), `blueprint/design/BlueprintDesignModel.ts` (every structural operation).
- **Toolbox client**, `~/xh/worktrees/blueprints/toolbox/client-app/src`, branch `blueprints`,
  owned by `blueprints-tb`: `desktop/tabs/blueprints/`, `blueprints/` (the shell, repository,
  catalog and registry pages).

Implementation comes after John approves the design. It will happen in your own worktrees on a
`blueprints-ui` branch off each repo's `blueprints`, merged by ck and tb.

## Constraints

- Use John's Hoist design system, the one the deck was built with. Find it with the Artifact
  tool (`action: list`, `scope: types`, or ask the deck session, `hoist-chat-kit-38`). Map it onto
  Hoist's components and `--xh-*` CSS variables. Don't propose a parallel styling layer.
- Hoist components and element factories, not raw HTML. See the Hoist Docs MCP (`conventions`,
  `cmp/panel`, `cmp/grid`, inputs, `desktop/cmp/dash`).
- chat kit must not depend on Toolbox. Kit UI uses Hoist variables only.
- Every change to a blueprint goes through the design model's edits (`applyEdit`), so undo and
  history keep working. The two widget rules in `spec.md` (phase 3, "Personalizations,
  deferred") still hold.
- The canvas is the container for drag and drop (decision 153). Every structural operation must
  stay reachable by hand.

## Inputs

- John's feedback so far: run sheet sections G to M and their results (`run-sheet.md`, "Results,
  sections G to L"), especially G6 and K14. tb's screenshots are in
  `/tmp/claude-1000/-home-john-xh-worktrees-blueprints-toolbox/695fb876-0b22-4b1a-84c2-1a5cfac4dcc0/scratchpad/shots/`.
- `step13-tools-plan.md` (the last tools pass), and decisions 153 to 157, 171 in `decisions.md`.
- `spec.md` for concepts, and chat kit's `docs/blueprint-format.md` for the format.
- The edit-flow page: https://claude.ai/artifact/FwmiCwj5QHC9TN8MEw3mJB
- The landscape research, for how others do editing UX (Grafana, Hex, Perspective):
  https://claude.ai/artifact/12iFPVbf5pXV65FVbHu5cz
- Toolbox's other tabs, as Hoist UI patterns.

## The browser

John granted you his debug Chromium (port 9222, his logged-in session) for this work, over the
DevTools protocol. Don't launch, close or raise windows, and don't send OS-level input. Toolbox
runs at `http://localhost:3000/app/blueprints` and the demo apps at `/blueprintPortfolio` and
`/blueprintWeather`. Leave the shared servers running. If your own session's permission check
refuses something, ask John. A grant relayed through the orchestrator can't lift it.

## Deliverable

A design proposal as a private artifact, starting with the Artifact tool's `quickstart`, using
the Hoist design system:
- an audit of today's UI, with screenshots and the main problems, ranked;
- the proposed information architecture and layout for each in-scope area, with mockups;
- an "overview" view of a blueprint's structure and wiring (elements, sources, variables,
  bindings);
- edit-mode interaction specs (states, affordances, keyboard, feedback);
- a batched implementation plan, with an owner (kit or Toolbox) per item, and the open choices
  for John.

Send the link to the orchestrator (`blueprints-orchestrator`). Questions for John go there too, or
to John directly in your tab.

## Writing

No em or en dashes. No unfounded estimates. Terse.
