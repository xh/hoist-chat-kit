---
name: design-data-catalog
description: Design or change an app's Data Catalog for Hoist Blueprints, and the server datasets behind it - datasets and their `key`, fields, kinds and formats, aggregators, parameters, and the guidance the Architect reads. Use this whenever a task adds or changes a dataset, field, kind, format or parameter in a `DataCatalog` JSON, writes the server endpoint that answers blueprint data requests, or asks to "add a dataset for blueprints", "let the Architect see our trades", "make this field joinable", "why does this column total blank" or "make VaR roll up". Pairs with extend-blueprints for the registry side. Not for writing blueprint JSON against an existing catalog (use blueprint-architect).
---

# Designing a Data Catalog

A catalog reaches three readers. The validator refuses any name the catalog does not hold. The
Architect chooses data from the catalog's guidance. The app's server answers each request for a
dataset. A catalog that serves only the validator still renders. But the Architect picks the
wrong measure, a total shows a wrong number, or a link reads data the user may not see. This
skill is the design workflow, and no doc restates its rules.

In an app, the kit's files are under `node_modules/@xh/hoist-chat-kit/`. With the Hoist Docs MCP
server, read a doc by its id, such as `chat-kit:docs/blueprint-format.md`.

## Before you design

1. Read the JSON shape in `blueprint/DataCatalog.ts`: `DatasetDef`, `FieldDef`, `ParamDef` and
   `KindDef`.
2. Read, in `docs/blueprint-format.md`, "Read Data from Sources", "Join Sources", "Format Values"
   and "Draw Values with Renderers". They say how blueprints use what you declare.
3. Read the request your server answers, in `blueprint/BlueprintDataProvider.ts`.
4. Read "The Server Is the Boundary" and "What a Link Can Do" in `docs/blueprint-security.md`.

## 1. Datasets and their grain

- **One dataset per grain of row.** Parameters choose the slice, such as `asOf` and `fund`. When
  users ask for totals of a coarser thing, such as a fund's NAV, add a coarse dataset beside the
  fine one. It is cheaper than rolling up fine rows, and it gives joins a coarser grain.
- **Declare `key` on every dataset:** the fields that identify one row. Check it against the row
  id the server builds. A join takes its grain from the two keys, so a wrong key gives wrong
  numbers silently. Every key field must be a field of the dataset, and the catalog refuses one
  that is not. A join can group by a key field, for a coarser value or a reduce. That key field
  must also be a dimension, or the join refuses it (`join.keyNotDimension`).
- **A series is a field of type `number[]`.** Its `kind` applies to each point. A series whose
  aggregator is `SUM` sums point by point, and any other never rolls up. Compute it only when a
  request names it, and say its size in its guidance.

## 2. Fields, kinds and formats

- **A field's name is its permanent ID.** Use the short form people in the field use, such as
  `ccy`. To retire one, mark it `deprecated` with `replacedBy`.
- **Define a shared field once,** in the catalog's `fields`, and list it by name in each dataset.
  A fund or a trader then shows the same way everywhere.
- **Give each kind of value its own kind and its own named format,** such as `mv` for market value
  and `exposure` for exposure. A blueprint can redefine a format by name, and the change then
  reaches only what the user meant. A kind carries a default format, aggregator and renderer, and
  a field overrides them.
- **Mark an identifier, such as an ISIN, as an attribute with `UNIQUE`,** not as a dimension.
  Grouping by an identifier is never useful.
- **Mark a field that only drives a renderer,** such as an icon code. Say so in its guidance, so
  the Architect does not show it as a column.
- **Keep categories few and plain,** with the one-level form where it suffices.

## 3. Aggregators

An aggregator says what a field shows on a group row, and what a join reduces it to. A field
takes its kind's aggregator unless it sets its own. For each field, ask what it should show under
every grouping it can appear in.

| Aggregator | Use for |
|---|---|
| `SUM`, `AVG`, `MIN`, `MAX` | Measures that add up, or whose extremes mean something |
| `UNIQUE` | A value that all of a group's rows share, such as a price by symbol. Blank otherwise |
| `{type: 'weightedAverage', weightField, absolute}` | Ratios such as beta or duration |
| `{type: 'last' \| 'first', orderField}` | A value per period, reduced to its latest or earliest, such as a close by day. `orderField` is required: without it the field does not roll up, and only a join reports it |
| `"server"` | Measures only the server can roll up, such as VaR or a return. The Cube shows them as `SUPPLIED` |
| None | A number shows blank on group rows. Any other type, and a dimension, defaults to `UNIQUE`. No join can reduce a field with none |

- **A blank beats a wrong number.** If `SUM` is right for one grouping and wrong for another,
  such as a quantity across symbols, use `UNIQUE`.
- **A `"server"` field obliges the server** to answer each request's `groupBy` sets with their
  aggregates, and `loadAggregatesAsync` with new ones.
- **A keyed field is never declared.** A measure joined from a coarser dataset becomes keyed on
  its own, such as NAV joined onto positions. It shows where a row pins the join's key. It also
  totals once per key on a row grouped only by that key and the joined dataset's own dimensions,
  such as a fund's style. A total applies the field's own aggregator, for `SUM`, `AVG`, `MIN`,
  `MAX` and `UNIQUE` only.
- **Check each field a join could reduce.** For a per-period dataset, an OHLC bar is first by
  period, `MAX`, `MIN` and last by period.

## 4. Joins

Blueprints declare joins. A join's `on` maps each field of the primary source to the field of the
joined source it matches, such as `{"fund": "fund"}`. The catalog makes joins possible, and
decides whether they are right:

- A `key` on both datasets, and the `on` fields as dimensions.
- Aggregators that reduce correctly by the join's key.
- A coarse dataset for values per key, such as a fund's manager and style.

Put a field on the dataset itself, joined on the server, when every row needs it at that grain.
Leave it to a blueprint join when it has a different grain, or when only some blueprints need
it. Say in the dataset's guidance when to join it, and on which key.

## 5. Parameters and entitlement

- **Trust no parameter.** A link, a prompt or an edited blueprint can set it. On every request,
  the server parses each value and checks the user's access to it, such as to the fund. It
  refuses a bad value with a 400 that names the parameter. Narrowing the catalog in the browser
  is a presentation scope, not a security boundary.
- **Type each parameter,** and give it `options` when its values are a closed set.
- **Give a parameter a `kind`** when its value shows in labels. Give a signed one a format with
  `withPlusSign`, so "Shocked P&L (+5%)" and "(-5%)" read apart.
- **Bound what a parameter can cost.** An empty parameter can widen a request, such as to every
  symbol at once. Cap the rows on the server, with a clear error past the cap, and say the cost
  in the dataset's guidance.

## 6. Write for the Architect

The Architect's index shows each dataset in one line, with all of its `guidance`, else its
`description`. `describe_catalog` gives the fields, with the same fallback.

- **Dataset guidance:** what one row is, when to choose the dataset over its siblings, and its
  cost. Keep it short: the index puts all of it in every prompt.
- **Field guidance:** on every measure that is easy to confuse with another, such as market value
  and gross exposure. Say what a value means and its units, such as "Always zero or less".
- **Description** is for people. Write `guidance` where a model would choose wrongly from the
  label alone.

## Check your work

- **Build the catalog in a unit test.** `new DataCatalog(json)` throws on an unknown kind or a
  key field the dataset lacks. Also check that each dataset a blueprint may join has a `key`. Load
  each seeded blueprint with `validateBlueprint` against it, as blueprint-architect says.
- **Spec the server:** each dataset's row id matches its `key`, a bad parameter returns a 400,
  and a `"server"` field's totals match the rows they cover.
- **Measure it live:** the size and time of a wide request, with and without its costly fields.
- **Prove the guidance.** In hoist-chat-kit, add a scenario to the Architect harness in
  `docs/planning/blueprints/tools/llm-test`. Word it as a user would ask, without naming the
  dataset or field, and run it as extend-blueprints describes.
