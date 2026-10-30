---
name: triage-integration-asks
description: Triage and answer requests from apps that build on hoist-chat-kit - feature requests, bug reports, API asks and feedback, usually written by an app's coding agent and relayed by the maintainer, often generic or sanitized. Use this whenever the user pastes or relays asks, "kit requests", "integration asks", a list from an app agent, or a single request for a new prop, slot, hook, default, CSS variable, export or behavior change that came from an app, even if they only say "handle these" or "here's the next round".
---

# Triage integration asks

Apps that build on the kit send asks: new props and slots, hooks, exports, styling variables,
behavior changes and bug reports. Most come from an app's coding agent. They are the best signal
the kit has of real use, and the goal is to say yes to the need behind each one.

An app agent sees one app. The kit serves every app, for years. So an ask's proposed API is a
description of a need, not a spec. Your job is to find the shape the kit can support: consistent
with its patterns and Hoist's idioms, testable, and reliable. Sometimes that is the shape asked
for. Often it is a better one. Sometimes the answer is a decline with another way to reach the
goal, or a question. Be neither deferential nor dismissive.

## What the input looks like

- The maintainer relays the asks. An app in a secure environment may not share its code, so the
  asks can be generic, with names and data removed. Do not count on seeing the app.
- An ask may cite a kit version and `file:line`, carry a priority (blocker, parity, needed, nice
  to have), offer options ("A, or B"), or say why CSS or an existing prop falls short.
- One batch can hold asks that depend on each other, or that share one underlying problem.

## Process

### 1. Split and restate

For each ask, write down:

- **Type:** bug, gap in an existing feature, new capability, docs gap, or already supported.
- **Goal:** what the app or its user needs, in one sentence, apart from the API it proposes.
- **Confidence** in that goal. If the ask hides something the kit shows on purpose, such as a
  failure, a status or a hint, find out why the app wants it gone before you design anything.
  "Users find recovered failures alarming" and "we show failures our own way" lead to different
  answers.

### 2. Check what exists

Look before you judge. Each of these has changed an answer before.

- **The docs and the code.** The kit may already do it, and the answer is a pointer or a doc fix.
  Read the component's README, its Common Pitfalls, the Theming section of
  `desktop/cmp/chat/README.md`, and the seam table in `docs/architecture.md` ("Where an App Plugs
  In"). Read the code at the version the ask cites.
- **The ask's own claims.** Check each statement the ask makes about current behavior against the
  code. App agents get these wrong, and a wrong premise leads to a wrong design. For example, an
  ask said the busy status line's screen reader announcement included its "Esc to stop" hint, but
  the status region never announces the busy line at all. Requirements copy such claims, so
  check them too. Say so in the triage, and correct the app in the reply. Check your own
  statements about current behavior the same way before they go into a doc or a reply.
- **Planned work.** Read `planning/HANDOFF.md` and the open GitHub issues (`gh issue list`). An
  ask may already be tracked or deferred, with open questions recorded.
- **`DECISIONS.md`.** Find the entries that cover the area. An ask that reverses a decision is a
  question for the maintainer. Do not reverse it quietly.
- **Earlier answers.** Search the CHANGELOG and `git log` for the component and the feature. A
  follow-up ask often means an earlier answer covered only the case in front of it. For example,
  the busy line was split into spans for an app to style apart, and the tooltip kept the whole
  line. Fix the gap in the earlier answer. Do not add a
  parallel feature. Also check that the new answer does not contradict an old one.
- **Hoist precedent.** Use the hoist-react MCP tools. If Hoist solves the same problem, follow it.

### 3. Choose the shape

Prefer these, roughly in this order. Each one exists for a reason the app agent cannot see.

- **Fix the kit's rule or default for every app,** rather than add a hook for one app to override
  it. A hook is a second way to decide one thing, and it leaves every other app with the old
  behavior. When an ask offers "fix the rule, or give us a hook", take the fix.
- **Fix at the root.** If a bug in one component comes from a shared mixin or helper, fix the
  shared code, so its siblings get the fix too.
- **Use the kit's existing seams** before you invent one:
  - A component's static `defaults` for an app-wide setting of one component (D59, as
    `ChatSources.defaults`). It reaches a component that `ChatPanel` renders deep inside, with no
    new pass-through prop.
  - `ChatKit.defaults` for a setting that spans components.
  - A component prop, and the existing `*Props` pass-throughs on `ChatPanel`.
  - A `--xh-chat-*` CSS variable, read inside the kit's own rule so it wins in both themes.
  - The BEM class names, which are part of the theme contract.
  - An optional member on a host interface (`ChatTranscript`, `ChatComposerHost`,
    `ChatFeedbackHost`), which `ChatModel` already has.
  - `ChatModelConfig` for behavior of the conversation.
- **Merge asks that share one concept.** Two asks about selection and "away" state became one
  `isChatShown`. One mechanism beats two.
- **Respect the invariants.** Typical ones:
  - Components never see a wire format, and protocols plug in as adapters (D2).
  - The render context stays stable, so parts do not re-render on every token.
  - Data that round-trips through a protocol keeps its place in it.
  - A display-only resolver never runs, answers or approves a tool call.
  - A narrow interface needs a second implementer (D82).
  - Nothing exports from an `impl` folder, and apps do not parse streams by hand.
- **Leave app logic in the app.** Rules for one backend belong in the app's codec, decoder,
  `runOptions` or CSS. Request fields only one codec needs do not go on `ChatRunRequest`.
- **Name it in the kit's vocabulary.** Match how sibling props and defaults are named. The ask's
  names are suggestions.
- **Scope it narrowly.** A custom busy icon for the status line does not have to change every
  spinner in the kit.
- **Build only what someone asked for.** Ideas beyond the ask wait until an app needs them.

### 4. Give each ask a verdict

| Verdict | Means |
|---|---|
| Take | Build it as asked. |
| Take, reshaped | Build the need in the kit's shape. Say what differs and why. |
| Already supported | Point to the API or the doc. Fix the doc if the app could not find it. |
| Decline | Say why, and give a way to reach the goal today. |
| Need answers | Ask narrow, concrete questions. |
| Defer | It needs a design pass, a spike or a decision first. Say what it waits on. |

- Every decline names an alternative. Where it fits, invite a concrete case: "If you have a case
  this rule does not cover, say what it is." A later round can take an ask that showed its case.
- Make questions answerable in one line. "Where does the ring show: beside the header's status,
  or in the reply body before the first token?" beats "Can you say more?"
- An ask that offers to drop its feature ("or say the kit prefers none") still gets a real
  answer. Split it into what lands now, what waits, and what nobody needs yet.

### 5. Sort the asks into three groups

- **Clear wins.** You are highly confident, and the maintainer has nothing to decide. Examples: a
  bug you reproduced, a doc fix, or a missing piece whose shape follows an existing pattern
  exactly. A clear win has no choice between shapes, changes no default and reverses no
  decision.
- **Discuss.** Important asks that need the maintainer: a choice between shapes, a decision to
  reverse, a default to change, or a question to send the app. Order them by importance.
- **Park.** Asks that are complicated and of low value. They wait until the end.

A minor choice does not keep an ask out of the clear wins, such as a name, or which of two
existing homes a setting goes in. If you have a confident answer that follows an existing
pattern, make the choice and name it in the ask's line: "Ask 1 (stop hint, as
`ChatStatusRegion.defaults.showStopHint`)". The maintainer can object. If you doubt an ask
otherwise, it is not a clear win.

### 6. Walk the maintainer through, one step at a time

The maintainer works through this between meetings and calls. An overview of every ask at once is
hard to absorb, and when an interruption comes, the easy wins stay undone. So capture the easy
wins first, then take one decision at a time.

1. **Open with the groups, one line each,** and nothing more:

   ```markdown
   Doing now, no decisions needed: Ask 3 (link color in the dark theme), Ask 5 (Copy's aria-label).
   To discuss, one at a time: Ask 1, Ask 2.
   Parked for the end: Ask 4.
   ```

2. **Build the clear wins** (steps 7 and 8). Report each one as done in a line.
3. **Take the discussion items one per message,** in order of importance. Each message holds one
   decision, in this shape:

   ```markdown
   **Ask 1: <what the app wants, in a few words>.** Recommend: <verdict and shape, in one line>.

   **Your call:** <one question>

   - <one or two bullets of why, only what the decision needs>
   ```

   When the maintainer answers, build what they approved, then bring the next item. Work that is
   built stays done if the maintainer has to leave.
4. **Bring the parked items last,** one line each. Ask whether to discuss them now, defer them,
   or decline them.

Rules for every message to the maintainer:

- Keep it short. The maintainer asks for detail when they want it.
- Write decisions in plain words: "an app-wide setting for one component goes on that
  component's `defaults`". Nobody can hold decision numbers in their head. Add the number after
  the words only as a reference.
- Put a fact the maintainer needs, such as a wrong claim in the ask, in that item's bullets.
- Leave out build plans, file lists and the reply to the app, unless the maintainer asks.
- Raise only decisions about these asks. Release timing, unrelated cleanup and ideas for other
  work are not part of the walk-through.

### 7. Reproduce bugs first

Write a failing spec that shows the bug before you fix it. If the report does not give enough to
reproduce it, ask the app for the steps or the stream that shows it. Do not fix a guess.

### 8. Build

Follow `CLAUDE.md`. A change is done with its specs, doc comments, README section, index and
registry rows, and CHANGELOG entry. Add a `DECISIONS.md` entry when the change makes a design
choice: a new seam, a new convention, or a declined option that will come up again. Run the
change in Toolbox when it is visual. If you checked it by unit tests only, the reply says so.

Add CHANGELOG entries under the topmost heading as it stands. Which release a change ships in is
the maintainer's plan. Do not infer it from the repo's state.

Branching, committing, pushing and publishing each need the maintainer's ask, as `CLAUDE.md`
states.

### 9. Write the reply to the app

Write the reply once every ask is built, declined or parked. The app agent may have nothing but the
installed package and this reply. Write it to stand alone.

- **Version.** The exact snapshot to install, once the maintainer has published one. Leave a
  placeholder until then.
- **Each ask, by the app's own numbers:**
  - Landed: a short code example, the behavior, and what the app can now remove.
  - Reshaped: what differs from the ask, and why, in a sentence.
  - Declined: the reason and the way to reach the goal today.
  - Open: the questions, and "do not build on a guess about its shape" where the shape is open.
- **Changes that can affect the app's CSS or tests,** such as new markup, new accessible names or
  changed defaults.
- **Not changed,** when the app might expect otherwise.

Cite README sections, which ship with the package. `DECISIONS.md` does not ship, so explain a
decision in words. Never give a decision number alone. Keep the reply generic: name no client and
no other app. Follow the `xh:clear-writing` skill.

## Signs you are being too deferential

- You took the ask's API name and shape without checking how sibling settings work.
- You added a hook, a pass-through or an option because the ask offered it.
- You exported an internal helper so the app can call it.
- You added an interface that only one class implements.
- "It's small, just add the prop" is the whole argument.

## Signs you are being too dismissive

- A decline gives no alternative.
- You declined a vague ask instead of asking what it needs.
- You answered the proposed API and missed the goal behind it.
