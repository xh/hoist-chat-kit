# Joins Between Sources

The design for joining sources, by `blueprints-hr`, as John approved it in decisions 131 and 132.
The spec's "Sources can join" section states the rules. This note holds the detail.

## Declaration and grain

```json
"positions": {
    "dataset": "positions",
    "joins": [{"source": "funds", "on": {"fund": "fund"}, "fields": ["nav", "manager"], "as": {"nav": "fundNav"}}]
}
```

`on` maps a primary field to a secondary field. Widgets read `positions` only.

Each catalog dataset declares `key: string[]`, the fields that identify a row. Comparing the keys
with `on`, mapped into the secondary's names, gives:

- **unique:** the secondary's key is a subset of `on`, so each key matches at most one secondary row.
- **sameGrain:** the primary's key is a subset of `on`.

| Case | Dimensions and attributes | Measures |
|---|---|---|
| unique and sameGrain | Row join | Row join, aggregating normally |
| unique, primary finer | Row join | Keyed join |
| not unique (secondary finer, or a time series) | Reduce to `on`, then as above | Reduce to `on`, then as above |

Joined dimensions and attributes (a dimension, `UNIQUE`, or no aggregator) are always copied onto
the primary's rows. A copied dimension can then be grouped by, filtered and selected, as when
positions group by a `sector` joined from instruments. Only measures from a coarser secondary need
the keyed mode.

## Source and View mechanics

- The secondary is a normal source with its own Cube. The primary's Cube adds the joined fields, so
  its joins are part of its `cubeKey`, and changing them rebuilds the Cube.
- The primary keeps an index from key to its row IDs, and a map from key to the secondary's values.
- Joined values are written onto the primary's rows on load and on every update from either side,
  in one batched `updateDataAsync` per tick. A primary row with no match gets nulls (a left join).
- **Reduce** runs a View over the secondary's Cube, grouped by `on`, with each field's catalog
  aggregator. It stays connected: a secondary tick reduces again, and changed keys are diffed and
  pushed through the index.
- **Duplicates:** if two secondary rows share a key in unique mode, the first wins, and
  `join.duplicateKey` is logged once per load.

## The keyed mode: `KeyedAggregator`

A Cube aggregator in hoist-react: `new KeyedAggregator({keyFields: ['fund'], rootAggregator: 'SUM'})`.

- A row that pins every key field shows the value its leaves share: a fund row, a strategy under a
  fund, a position row.
- The root applies `rootAggregator` over the distinct key tuples among its leaves, so it counts the
  keys this View shows, per View's filter.
- Any other row is blank, such as NAV by sector.

It shares the pinning logic with `SUPPLIED`. `SUPPLIED` stays for what only a server can compute.
Server-rolled measures on a secondary are out of v1.

## hoist-react aggregators

Built on hoist-react `blueprints`: `KeyedAggregator`, and `LastAggregator` and `FirstAggregator`,
each with a required `orderField`, such as the latest price by date. The catalog writes them as
`{type: 'last', orderField: 'date'}`. There is no series aggregator: collecting a time series
through a join waits for a hoist-core data backend (decision 132).

## Routing

The join owns the routing, and `demand()` never routes. A widget names a joined field under the
primary, as it names any of the primary's fields.

- The primary's request leaves out joined field names and adds its `on` fields.
- The secondary's request adds, as one more demand beside its own widgets': each joined field some
  widget names under the primary, mapped back through `as`; its `on` fields; and the fields its
  reduce aggregators read, such as an `orderField` or a weight field.
- Only demanded joined fields are fetched.
- A secondary computes its join demand from every source whose `joins` name it, so a column added
  to a grid over the primary widens the secondary's request through the reload-only-for-new-fields
  rule.

## Parameters, filters and request order

- The secondary binds its own parameters. A parameter name shared with the primary but bound
  differently warns `join.paramMismatch`.
- **Pushdown:** a source-filter clause on a joined field runs on the secondary's rows, and the
  primary's request gets `{field: onField, op: '=', value: keys}`. The primary then loads after the
  secondary. Without pushdown, both load in parallel, and joined fields stay blank until the
  secondary arrives.
- Above 2,000 keys, the filter falls back to the browser (`join.pushdownTooLarge`, info). A later
  option may let a join choose its strategy.
- Widget filters on joined fields work unchanged, because the values sit on the rows.

## Validation codes

`join.unknownSource`, `join.self`, `join.chained` (joins are one level deep in v1),
`join.unknownField`, `join.typeMismatch`, `join.noKey`, `join.fieldCollision` (needs `as`),
`join.noReduction`, `join.lastNeedsOrder`, and `join.paramMismatch` (a warning). The validator records
each field's mode in its issues' `info`, for the Architect and design mode.

## The Architect and design mode

- **Guidance:** join when a widget needs another dataset's fields on its own rows, or wants to group
  by them, and otherwise show the other dataset in its own widget. Share parameters, take `on` from
  the catalog keys, alias collisions, and name the aggregator when a join reduces. `describe_catalog`
  shows `key`.
- **Design mode:** the sources editor gains a Joins section: a source picker, `on` pairs of
  type-compatible dimensions, a field list with aliases, each field's mode read-only, and the
  warnings. Removing a secondary source cleans up the joins that name it.

## Specs

- Grain classification across the cases in the table.
- Each mode's values at each level, including the root counting each key once under a filtered View.
- Left-join blanks, the duplicate warning, and the parameter warning.
- Pushdown ordering and the cap fallback.
- Live ticks from each side, batched once per tick, including a primary tick bringing a new key and
  a secondary tick changing a joined dimension.
- Routing: a joined field named under the primary is in the secondary's request and absent from the
  primary's. An unused joined field is fetched by neither.

## Risks

- A wrong catalog `key` gives silently wrong numbers. The duplicate warning catches only part of it.
- A secondary tick that changes a joined dimension rebuilds the primary's Views.
- Pushdown with a changing key set resubscribes the primary. Throttle it, or fall back to the browser.
- Mismatched as-of dates between the two sides only warn.
