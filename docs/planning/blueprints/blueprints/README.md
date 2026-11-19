# Scenario Blueprints

The blueprint for each scenario in [`../scenarios.md`](../scenarios.md), written by hand against
the catalogs in [`../catalogs/`](../catalogs/). `../tools/check-blueprints.py` checks each one:
structure, variables and their writers, sources and their parameters, and every field a widget
names. It stands in for Blueprints' own validation until that exists.

| File | Scenario |
|---|---|
| `p1-one-grid.json` | P1. One grid |
| `p2-linked-dashboard.json` | P2. A linked dashboard |
| `p3-morning-report.json` | P3. A morning report, after all nine prompts |
| `p3-edit-prompt-8.json` | P3, prompt 8, as one edit |
| `p4-answer.json` | P4. The chat answer's segment |
| `p4-edit.json` | P4. The edit that adds the chart to the P2 dashboard |
| `p5-risk-report.json` | P5. A risk and stress report |
| `w1-one-city.json` | W1. Weather for one city |
| `w2-two-cities.json` | W2. Two cities side by side |
| `w3-segment-1.json` | W3. The stat cards segment |
| `w3-segment-2.json` | W3. The chart segment |

- The `base` of each edit is a sample version number.
- `art_7f2` is a `query_dataset` result over `positions`, and `art_9c4` one over `weather`.
- W2's forecast grid has no conditional style yet. Rain over 60 percent gets one in plan step 13.
