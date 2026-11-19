# Guidance: Hoist Blueprints

> **Draft.** Lessons from the design sessions and the LLM test rounds, kept for two future
> skills: one that guides the Architect, and one for designing a Data Catalog. Each entry gives
> the rule, where it came from, and what enforces it today.

The format stays small, and judgment lives here. When a test exposes a problem, decide first
whether the format should prevent it. If not, it is guidance and belongs in this file.

Enforced by:

- **Validator:** the foundation's checks refuse the mistake.
- **Prompt:** the Architect's system prompt or a tool description says it.
- **Not yet:** recorded here only.

## The Architect

### Reading and writing

| Rule | Source | Enforced by |
|---|---|---|
| Read before writing. Use `describe_catalog` for fields and `describe_registry` for a widget's config schema. Never guess a field or config name. | Every test round: both models read first, and no edit failed on a wrong field | Prompt |
| Make one edit for one request, and keep it to what was asked. | P3: one edit per prompt over nine prompts | Prompt |
| Only the first element added to an empty blueprint can omit its parent, and it becomes the root. Every later element needs a parent and a placement. | P3: both models added a second top-level element without a parent on the first edit, in two rounds | Validator and the tool description |
| A path never indexes into an array. Replace the whole array. | Design: index paths break as soon as anything else changes the array | Validator |
| To clear a variable, use `resetVariable`, not `setVariable` with null. | P3: Sonnet's "All" button set a filter to null and was refused | Validator |
| After a refused edit, read each issue's path, fix that path, and send the whole edit again. | Every round: each refused edit was fixed on the next try | Prompt |

### Values and variables

| Rule | Source | Enforced by |
|---|---|---|
| Every value that feeds a blueprint is a variable. Source parameters and filter values a user might change never appear as literals. | Design decision after W1 and W2 built literal cities | Validator, for source parameters |
| A literal that defines what a widget is, such as a chart of one sector, can stay in its config. | P4: Opus turned "Technology" into a constant variable. We kept the rule to values a user might change | Prompt |
| A value the user names stays as given, as a constant, and the reply offers to make it a prompt. An input the user does not name, such as an as-of date or a fund, is a prompted variable. | W2: Opus fixed "New York and London" as constants. We chose to keep what the user asked and offer the prompt | Prompt |
| A required dataset parameter the user did not mention still needs a variable, usually a prompt with a resolver default. | P1: Sonnet added an as-of prompt defaulting to the previous business day without being asked | Validator, for required parameters |
| Use a resolver for a moving date, such as `previousBusinessDay` or `yearStart`. A fixed date freezes the blueprint. | Design: a pinned chat answer keeps "last quarter" only through a resolver | Prompt |

### Ambiguity and limits

| Rule | Source | Enforced by |
|---|---|---|
| If two readings would build very different things, ask one short question before building. If the difference is small, build the likelier reading and say which one you took. | P3: Opus applied "market value" to the market value field only, and asked whether exposures and VaR should change too | Prompt |
| If a request needs something the widgets cannot do, say so plainly, build the closest workaround, and say what it is. | W2: both models said the grid cannot highlight rows, and added a filtered grid of rainy steps | Prompt |
| Offer to send a feature request for a missing capability, and send it only with the user's consent. | Design: plan step 14, `request_feature` | Not yet |
| In design mode, if it is unclear whether a change belongs in the definition or in a preset, ask. | Design: access and modes | Not yet |
| In run mode, a change that needs the definition is refused. Ask for design mode with `request_design_mode` from a user with write access, and edit only if it returns design mode. Offer a copy to a user without it. | Design: access and modes. Decision 83: the approval card's words are the kit's own | Prompt. The edit tools refuse, and the tool rechecks access |

### Chat answers

| Rule | Source | Enforced by |
|---|---|---|
| Look at the data with `query_dataset`, then answer. Answer in text alone when one or two facts answer the question. Show UI when the answer holds a series over time, a ranking, a comparison, or more numbers than a sentence carries, and still say the answer in one sentence of text. A question with several parts, such as a headline and its detail, takes a segment for each part. | W3: Sonnet answered the umbrella question in text, and Opus with a chart and a grid. In Toolbox, three of four runs of W3 and P4 answered in prose alone, where a chart of rain through the day or a ranking of traders served the user better | Prompt |
| Widgets that interact go in one segment. Segments never share variables. | Design: segments are isolated | Not yet |
| A segment may hold literal parameters, artifacts and computed inline values. A dashboard may not. | Design: answers are fixed records. Decision 83: a person may author a short inline list | Validator: an artifact outside an answer is an error, and an inline source a warning, an error over 50 rows |
| A question never changes the host blueprint. | W3: the host stayed unchanged on both models | Prompt |
| To add an answer to the host, read it with `read_answer`, then translate it. Reuse a host source that gives the artifact's rows, else add the source `read_answer` gives. Keep the query's filter, grouping and sort, and give each new widget a child reference. | P4: both models added the chart over the host's existing source | Prompt. `read_answer` maps each artifact to its source and widget config, and finds matching host sources |
| Bind a literal parameter to a host variable only when it means the same thing, not when it merely holds the same value today. A date that means today, or one relative to it, becomes the host's variable or a resolver. | Decision 83 | Prompt |
| A computed number in an answer becomes a widget over a source when it moves into a dashboard. | Design: dashboards are fetched each time they open | Prompt |
| A widget allowed only in answers maps to a host widget, such as `tabs` to `tabContainer`, or the Architect asks. | Design: chat kit's specs are answer-only | Validator: the host's registry lacks them |
| An OpenUI Lang `$variable` becomes a host variable that defaults to the value the program declares, not the user's current one, set by the host widget that writes it. `@Set` and `@Reset` become `setVariable` and `resetVariable`. | Decision 83: a current value is one user's transient choice | Prompt |

### Model choice

Sonnet 5.5 at medium effort matched Opus 5.5 on every scenario so far, at about 40 percent of
the cost. Opus spent more on reasoning, and wrote more careful notes on readings it chose. Test
both again on harder scenarios before choosing a default.

In Toolbox, through the real Architect on real data, both passed every check on P1, P2 and P3
from empty, and Sonnet cost about half as much. Sonnet took more refused edits on P2 and
recovered. Opus took fewer model calls on P2. P3's nine turns cost $0.23 on Sonnet and $0.46 on
Opus. Sonnet 5.5 is now the default (decision 65).

## Designing a Data Catalog

| Rule | Source | Enforced by |
|---|---|---|
| Give each kind of value its own named format. A redefinition then reaches only what the user meant. | P3: "market values in full dollars" could not use `mv`, which exposures and VaR shared, so the catalog now separates `mv` and `exposure` | Not yet |
| Define a field that several datasets share once, in the catalog's `fields`, and list it by name in each dataset. | Design: shared identifiers such as fund, strategy and trader must show the same way everywhere | Not yet |
| Write `guidance` for the LLM on every measure that is easy to confuse with another, such as market value and gross exposure. | P1: both models picked market value as the default size measure, as its guidance says | Not yet |
| Mark an identifier, such as an ISIN or a CUSIP, as an attribute with `UNIQUE`, not as a dimension. | Design: grouping by an identifier is never useful | Not yet |
| Choose each measure's aggregator deliberately: a sum, a weighted average, or `server` for a measure only the backend can roll up, such as VaR. | Design: a shocked P&L adds up, but a VaR does not | Not yet |
| A field's name is its permanent ID. Use the short form people in the field already use, such as `ccy`. | Design: names never change | Not yet |
| Keep categories few and plain, and use the one-level form where it suffices. | Design: catalog review | Not yet |
| Give a parameter its `options` when its values are a closed set, such as weather units. | Design: catalog review | Validator, for the type |
| Give a parameter a `kind` when its value shows in labels, and a signed one a format with `withPlusSign`. An instance's default label shows its parameter values. | P5: four shock columns all read "Shocked P&L", and then "(5%)" next to "(-5%)" | Not yet |
| Mark a field that exists only to drive a renderer, such as a weather icon code, so the LLM does not show it as a column. | Design: catalog review | Field guidance |

## The format

Lessons that changed the format itself. They are in the spec, and listed here so the next
test round can watch for related problems.

- **Preset groups.** Opus grouped presets by name without being told. The spec now holds named
  preset groups, one switch each.
- **Preset values in the blueprint's own shape.** Values keyed by path needed escaped pointers to
  edit. A preset's `set` now mirrors the blueprint, so every path stays plain.
- **Check every key.** The validator let an unknown key under `presets` through. Every object in
  a blueprint should refuse keys it does not know.
