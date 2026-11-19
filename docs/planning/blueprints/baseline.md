# Baseline: Chat Kit Generative UI

This doc records what the generative UI package of Hoist Chat Kit already decides, and what the
new foundation in hoist-react should keep, change or add. The source is `hoist-chat-kit` on
`develop` at `4373a7a`, in `genui/` and `desktop/cmp/genui/`. A number such as D32 names an
entry in chat kit's `DECISIONS.md`.

Chat kit built this package to show components in a chat answer. The foundation must also serve
dashboards and reports that people save, share, edit and re-run. Most gaps below come from that
difference.

## The Document

```ts
interface ChatUiDocument {
    root: string;
    elements: Record<string, ChatUiElement>;
    catalogVersion?: string;
}
interface ChatUiElement {
    component: string;
    props: PlainObject;
    children?: string[];
    slots?: Record<string, string[]>;
}
```

- Elements sit in a flat map and refer to their children by ID, so a document can stream in any
  order.
- The model writes the IDs as plain strings. An ID must be unique in its document.
- Code checks the structure: one parent per element, no cycles, and the root is no element's
  child. Caps limit the size: 50 elements, 8 levels and 500 items per array prop by default.
- A container is an element with `slots`. Layout and component config therefore share one tree.
- Every prop is a literal. A document has no variables, no bindings and no outputs.

**The key pattern.** No single JSON Schema describes a document. A generic envelope holds the
elements, code checks the structure, and each element's props pass its component's own schema.
The pillars design does not need a closed union of every widget or a `$ref` bundle. App
components join the catalog, and nothing re-lists Hoist's components.

**Verdict.**

| Keep | Change | Add |
|---|---|---|
| Flat element map with ID references | Decide where a dashboard keeps position and size: on the container's props by child ID, or in a separate layout | Variables, bindings, widget outputs |
| Envelope plus a schema per component | | Edit operations, so a chat can change one prop without a rewrite |
| Structure checks and caps | | |
| Readable IDs | | |

## The Catalog and Component Spec

`ChatUiComponentSpec` has `name`, `toolName`, `description`, `props` (a JSON Schema),
`validate`, `render`, `result`, `example`, `slots` and `dataProps`. `ChatUiCatalog` holds the
specs. It validates, repairs, migrates and renders documents. It also builds tools and prompts
for the chat.

Several parts tie the catalog to chat:

- The render context extends `ChatPartRenderContext`, which holds `chatModel`, `messageId` and
  the message part.
- `toolName`, `result`, the four delivery modes, tag parsing and `createDataRenderers()` exist
  only for chat.
- `render` is a function that returns a React node, with an `isPartial` flag for streaming.

A dashboard widget also needs what chat never did: state that the user changes, such as sort,
column widths and grouping, written back into the document. Hoist does that with a `HoistModel`
per widget and persistence.

**Verdict.** Keep the app-controlled catalog, `description`, `example`, `validate` and `slots`.
Move the core into hoist-react with no dependency on `ChatModel`. Chat kit then builds tools,
tags and prompts on top. Decide whether a widget is a `render` function or a model and component
pair. Add declared outputs, props that can bind to a variable, and how a widget states the data
it needs.

## Validation

- Chat kit checks props with its own subset of JSON Schema, in `impl/SchemaUtils.ts`. It refuses
  any schema keyword it does not check, such as `$ref`, `$defs`, `allOf` and `not` (D32).
- It rejected Ajv because Ajv compiles schemas with `new Function`, which a strict content
  security policy forbids.
- A partial mode skips checks that streaming props could still pass, such as `required` and
  `minItems`.
- A problem is a string in `path: message` form, such as `elements.chart.props.rows[3].value:
  expected number, got string`.
- `repairDocument()` makes lossless fixes, such as dropping unknown keys.

**Verdict.** Keep the CSP-safe validator, the partial mode and repair. Change problems from
strings to structured issues with a code, a severity and a path. Semantic rules, such as a
binding that names an unknown variable, need the same form, and an agent that edits by path
needs exact paths.

## Versions

`catalogVersion` is an FNV-1a hash of the catalog's content: names, descriptions, schemas,
examples, slots, data props, modes, instructions, tag prefix and limits. `migrations` upgrade a
stored document, keyed by the version they upgrade from.

A hash suits chat, where the goal is to detect drift between browser and server. It does not
suit saved dashboards. An edit to one description changes the hash, so each such edit needs a
migration that does nothing. A hash also cannot say which release of which component a document
needs.

**Verdict.** Change to explicit versions for saved documents, likely one per component, so a
migration targets the component that changed. Chat can keep a hash for drift.

## Data

Components get data in one of two ways.

- **Inline.** The props hold the data: grid columns and rows, chart series, metric values, card
  fields.
- **By reference.** A prop names an artifact that a tool produced:
  `{id, columns, rows?, totalRows, metadata}`. `ChatArtifactRegistry` caches pages, and the app's
  `ChatDataSource` loads them with `{artifactId, offset, limit, signal}`. A component reads a
  handle in one of six states: `waiting`, `loading`, `ready`, `missing`, `tooLarge` or `failed`.

`ChatDataColumn` describes one column: `name`, `type`, `label`, `format`, `decimals` and `units`.
The types are `string`, `number`, `integer`, `date`, `datetime` and `boolean`, with dates as epoch
milliseconds.

An artifact is a snapshot that a tool pushed. Nothing re-runs it with new inputs. A dashboard
must pull: a widget names a dataset and what it needs, and the data layer runs again when a
variable changes. Columns also have no role and no aggregation, so nothing can group or roll up.

**Verdict.** Keep the artifact as one kind of data source, for snapshots and chat answers. Keep
the handle states and paging. Add a dataset source that the app's data layer serves, with the
widget's demand and the bound variables as inputs. Extend the column into the field schema, with
a role and an aggregator.

## Views

`ChatDataView` is the closed grammar the model uses to slice an artifact: `columns`,
`sortBy` as `field|desc`, `filter`, `top` and `units`. `ChatChartView` adds `type`, `x`, `y`,
`groupBy`, `stacking` and `colorBySign`. `applyDataView()` applies a view in the browser.
Filters use the operators `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `in` and `notNull`, and the kit
never evaluates an expression the model wrote.

Hoist already has a filter vocabulary in `FieldFilter`, with operators such as `=`, `!=`, `>`,
`like`, `begins`, `includes` and `excludes`. Stores, Cube and `FilterChooser` all use it.

**Verdict.** Keep the closed grammar. Change the filter to Hoist's `FieldFilter` form, so one
filter runs in a Store, in Cube, and in an app's server query. Add grouping and aggregation for
grids, and filter values that bind to variables and widget outputs.

## Formatting

- `ChatUiNumberFormat` is `number`, `percent`, `currency` or `none`, with `decimals` from 0 to 6.
  Metric tiles add a compact form, such as `$48.5B`. A view can scale numbers to `thousands`,
  `millions` or `billions`.
- `fmtChatUiNumber()` maps each format onto Hoist's number formatters. Currency is always `$`.
- A format can come from three places: the artifact column, a column of the view, or the inline
  props of a grid column, metric or card field. The specific one wins.

That layering is the right shape: the field holds a default, and the widget can override it. But
the format set is thin for financial data. It has no ledger form, no positive and negative
colors, no currency code, no date or time formats, no label for scaled units, no display for
nulls and no conditional style.

**Verdict.** Keep the layering of field default and widget override. Replace the format set with
a richer, declarative spec that maps onto Hoist's formatters and renderers. This is the largest
piece of new design work.

## Two Vocabularies

The inline props and the artifact columns describe the same things in different words.

| Concept | Inline grid column | Artifact column |
|---|---|---|
| Key | `field` | `name` |
| Header | `headerName` | `label` |
| Types | `string`, `number`, `date`, `boolean` | adds `integer`, `datetime` |
| Dates | `YYYY-MM-DD` strings | epoch milliseconds |
| Format | enum of four | free string |

The chart has the same split: `series` and `xAxis` inline, `x` and `y` by reference.

**Verdict.** The foundation needs one field vocabulary, used by inline data, artifacts and
datasets alike.

## Actions

A component's props can hold typed actions from a closed set: `send`, `openUrl`, `navigate`,
`callTool` and `app`. Each can add a `label` and a `confirm` question. The catalog checks every
action before it runs, and `openUrl` opens only URLs that `urlAllowList` allows.

`send` and `callTool` work only in a chat. `navigate`, `openUrl` and `app` work anywhere.

**Verdict.** Keep the closed, checked set. Move the general actions to the foundation, and leave
the chat actions in chat kit. Decide whether a widget publishes a value, such as a selected
sector, through an action or through a declared output.

## Delivery to the Model

- Chat kit delivers the catalog four ways: one tool per component, display tools for a loop that
  runs on a server, tags in markdown, and a `show_ui` tool that takes a whole document (D22).
- One small schema per tool is more reliable than one tool that takes a union of every
  component. `show_ui` is only for answers that nest.
- Each component a reply shows costs one model call, one step and the tokens of its props on
  every later step.
- `toPrompt()` and `toToolSchemas()` export the catalog. A server loads the export and the
  browser sends only the version.

**Verdict.** Delivery stays in chat kit. The foundation supplies what any delivery needs: the
catalog, a schema per component, document checks, and the description and example of each
component. A dashboard is a nested document, so an agent that builds one uses the document form.
Edit operations are new and belong in the foundation.

## Safety

The model can show only catalog components, and nothing it writes runs as code. Caps bound each
document, and lookups by name check own properties only.

**Verdict.** Keep all of it. Saved dashboards add a new concern: a shared document is input from
another user, so it needs the same checks as model output.

## Decisions This Baseline Raises

1. Where a dashboard keeps position and size: container props by child ID, or a separate layout.
2. Whether a widget is a `render` function or a model and component pair, and how widget state
   writes back to the document.
3. The form of variables, bindings and widget outputs.
4. How a widget states the data it needs from a dataset.
5. The field vocabulary, including role, aggregator and format.
6. The format spec.
7. Edit operations for a chat that changes a dashboard.
8. Per-component versions and migrations.
9. Structured validation issues.
