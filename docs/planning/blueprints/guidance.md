# Guidance: Hoist Blueprints

The lessons this file gathered from the design sessions and the LLM test rounds now live where
they are enforced or taught. Add a new lesson there, not here:

- **The in-app Architect's rules:** its system prompt, `blueprint/architect/architectPrompt.ts`,
  and each widget's `guidance` in `blueprint/impl/builtInWidgets.ts`.
- **Rules the format can enforce:** `validateBlueprint`, with a stable issue code.
- **A coding agent writing blueprints:** the `blueprint-architect` skill.
- **Adding widgets and other registry entries:** the `extend-blueprints` skill.
- **Designing a Data Catalog:** the `design-data-catalog` skill.
- **Choosing the Architect's model:** the blueprint README's "Choose the Architect's model". The
  history behind it is below.

When a test exposes a problem, decide first whether the format should prevent it. If it should,
change the validator. If not, it is guidance for the prompt or a skill.

## Model choice history

Sonnet 5.5 at medium effort matched Opus 5.5 on every scenario so far, at about 40 percent of
the cost. Opus spent more on reasoning, and wrote more careful notes on readings it chose. Test
both again on harder scenarios before choosing a default.

In Toolbox, through the real Architect on real data, both passed every check on P1, P2 and P3
from empty, and Sonnet cost about half as much. Sonnet took more refused edits on P2 and
recovered. Opus took fewer model calls on P2. P3's nine turns cost $0.23 on Sonnet and $0.46 on
Opus. Sonnet 5.5 is now the default (decision 65). Adding answers to a host passed on both models, with design mode asked for first every time.
Sonnet answers in text alone more often than Opus: W3's rain question got prose in every Sonnet
run, which is a fair reading of it. An app that wants more UI in answers should test Opus there.

Step 12's full regression round (Nov 20, harness results `2026-11-20T23-24-27-800Z`, 16 scenarios
per model at medium effort): Sonnet passed 77 of 87 checks for $1.13, and Opus 84 of 87 for
$2.32. After the step 12 fixes, Sonnet passed P6, P8 and P10 in every run, so decision 143's rule
for moving the default to Opus was not met (decision 149). Low effort on Sonnet cost 11% less with
the same checks over one round, and the Architect stays at medium (decision 151).
