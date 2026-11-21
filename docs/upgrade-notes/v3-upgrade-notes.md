# Hoist Chat Kit v3 Upgrade Notes

> **From:** v2.x → v3.0.0 | **Released:** unreleased | **Difficulty:** 🟢 LOW

## Overview

Hoist Chat Kit v3 moves the kit to `@xh/hoist` v91. The kit's styles read Hoist's renamed CSS
variables, and its code and docs pass child elements as `children`. The kit's own `--xh-chat-*`
variables keep their names and their defaults, apart from the metrics and record card variables that
Hoist's own now replace. Its other required steps apply only to apps that write a `ChatUiAdapter`,
that export a catalog for a server, that use the metrics component themselves, that set `state` on
an `AgUiCodec`, or that style the record card.

- **Hoist v91 (required)** - upgrade the app to Hoist v91 first - see Prerequisites.
- **The kit version (required)** - see Step 1.
- **Protocol adapters (required if used)** - `ChatUiAdapter.translate()` takes a context object,
  not the catalog - see Step 2.
- **Catalog exports with text formats (required if used)** - if you configure text formats,
  regenerate the export - see Step 3.
- **Metrics component (required if used)** - the metrics spec is now the stat cards spec, over
  Hoist's `StatCard`, and the kit's own `ChatUiMetrics` is gone - see Step 4.
- **Segment switches (required if used)** - `ChatUiTextSegment` gained a `document` member, so an
  exhaustive `switch` over segments needs a case for it.
- **Agent state (required if used)** - `AgUiCodecConfig.state` is gone, as the chat now holds the
  agent's state - see Step 5.
- **Record card styles (required if used)** - `ChatUiCard` is now a Hoist `Card` that holds a
  `PropertyTable`. Move an override of `--xh-chat-card-section-pad` or of the
  `xh-chat-ui-card__fields`, `__field`, `__label` and `__value` classes to Hoist's `--xh-card-*`
  and `--xh-property-table-*` variables, under `.xh-chat-ui-card`.

## Prerequisites

Before starting, make sure:

- [ ] The app runs Hoist Chat Kit v2.x.
- [ ] The app runs `@xh/hoist` v91 or later, with the hoist-react v91 upgrade notes complete. Their
  codemods also cover the app's use of the kit, such as the Hoist variables that its
  `--xh-chat-*` overrides read, and the child elements it passes to kit components.

## Upgrade Steps

### 1. Update the Kit

Set `@xh/hoist-chat-kit` to `^3.0.0` in the app's `package.json`, then install.

### 2. Update Protocol Adapters

`ChatUiAdapter.translate(payload, catalog)` is now `translate(payload, {catalog, isPartial})`. The
chat calls it again as a reply streams, with `isPartial` true until the reply ends, so an adapter
can return the document that has arrived so far. Set the document's `isPartial` from it, and the
catalog renders the document as partial, with a placeholder for each element still to come. A
document without `isPartial` renders complete, as in v2. A `translate()` that throws renders a
placeholder while the reply streams, and a fallback once it ends. Apps that register no adapter
need no change.

**Find affected code:**

```bash
grep -rnE "ChatUiAdapter|translate\(" client-app/src/
```

**Before:**

```typescript
const adapter: ChatUiAdapter = {
    dataType: 'myproto',
    translate: (payload, catalog) => toDocument(payload, catalog)
};
```

**After:**

```typescript
const adapter: ChatUiAdapter = {
    dataType: 'myproto',
    translate: (payload, {catalog, isPartial}) => ({
        ...toDocument(payload, catalog, isPartial),
        isPartial
    })
};
```

### 3. Regenerate the Catalog Export

If you configure text formats, regenerate the export. `ChatUiCatalog.version` now covers the
catalog's `textFormats`, unless they are the default tag format alone. A catalog with the default
keeps its v2 version. A server that compares the version in its catalog export with the one the
browser sends sees drift until the export is rebuilt. Apps that export no catalog, or that keep
the default format, need no change.

- Run the app's catalog export script again, and deploy the new export with the server.
- Optionally, switch the script to `catalog.toExport()`, which returns the version, tools and prompt
  in one call. See
  [Export the catalog for a server](../../genui/README.md#export-the-catalog-for-a-server).

### 4. Move Metrics to the Stat Cards Spec

`chatUiMetricsSpec()` is now `chatUiStatCardsSpec()`, named for the Hoist `StatCard` it renders.
It renders Hoist's `StatCardStrip`, with a `StatCard` per figure. Its catalog name is now
`statCards`, its tool `show_stat_cards`, and its `metrics` prop is now `cards`. The kit's own
`ChatUiMetrics` component, its `chatUiMetrics()` factory, the `ChatUiMetricsProps` type and the
`xh-chat-ui-metrics__*` classes are gone.

**Find affected code:**

```bash
grep -rnE "chatUiMetrics|ChatUiMetric|xh-chat-ui-metrics|show_metrics|xh-chat-tile" client-app/src/
```

- Rename `chatUiMetricsSpec()` to `chatUiStatCardsSpec()`. Rename the types `ChatUiMetric`,
  `ChatUiMetricsSpecProps` and `ChatUiMetricsSpecOptions` to `ChatUiStatCard`,
  `ChatUiStatCardsSpecProps` and `ChatUiStatCardsSpecOptions`.
- Update prompts, documents and adapters that name the `metrics` component, the `show_metrics`
  tool or the `metrics` prop. Use `statCards`, `show_stat_cards` and `cards`.
- Regenerate a catalog export for a server, as the tool name changed - see Step 3.
- Replace a direct `chatUiMetrics()` call with Hoist's `statCardStrip()` and `statCard()`, from
  `@xh/hoist/cmp/statcard`. Format each value with `fmtChatUiNumber()` to match the chat.
- Move style overrides of the `xh-chat-ui-metrics__*` classes to Hoist's `--xh-stat-card-*`
  variables, set under `.xh-chat-ui-stat-cards`.
- Move an override of `--xh-chat-tile-min-width` or `--xh-chat-tile-value-font-size`, both
  removed, to `--xh-stat-card-min-content-width` or `--xh-stat-card-value-font-size`, set under
  `.xh-chat-ui-stat-cards`.

**Before:**

```typescript
chatUiMetrics({metrics: [{label: 'Revenue', value: 1250000, format: 'currency'}]});
```

**After:**

```typescript
statCardStrip(
    statCard({
        title: 'Revenue',
        value: fmtChatUiNumber(1250000, 'currency', null, {compact: true})
    })
);
```

### 5. Move the Agent State to the Chat

The chat now holds the state that an AG-UI agent shares, as `ChatModel.agentState`. The agent
patches that state as it runs, and `AgUiCodec` sends it back with each run. The codec's own
`state` option sent a state that the chat could not see, so v3 removes it. Passing it fails to
compile. From untyped config, the codec ignores it and logs a warning.

Apps that never set `state` send the same `{}` as before, with one exception. If the backend
already emits `STATE_SNAPSHOT` or `STATE_DELTA`, the chat now holds that state. It sends the
whole of it back with every run, and with every step of a tool loop. Check that the backend
accepts its own state as the `state` of a request.

**Find affected code:**

```bash
grep -rnE "AgUiCodec\(" client-app/src/
```

- Move a `state` that the agent reads to the chat's config, as `prepareAgentState`. It runs
  before each step, as the codec's function did. It gets the state the chat holds, so spread
  that state to keep what the agent wrote.
- Move a fixed `state` the same way. `ChatModelConfig.agentState` sets only the first state of
  the chat's first thread, so it is not a replacement.
- If the value only informs the agent, send it as `context`. If only the server reads it, send
  it as `forwardedProps`. The codec still builds both for each step.

**Before:**

```typescript
new ChatModel({
    transport: new SseChatTransport({
        url,
        codec: new AgUiCodec({state: () => ({selectedSector: this.selectedSector})})
    })
});
```

**After:**

```typescript
new ChatModel({
    transport: new SseChatTransport({url}),
    prepareAgentState: state => ({...state, selectedSector: this.selectedSector})
});
```

See [Share state with an agent](../../core/README.md#share-state-with-an-agent).

## Verification Checklist

- [ ] The chat shows its usual spacing, frames and colors in light and dark themes.
- [ ] `tsc` passes, and each `ChatUiAdapter` takes the context object.
- [ ] A reply that shows stat cards draws a row of Hoist `StatCard`s, with deltas in color.
- [ ] If the catalog configures text formats, a server that loads its export reports no version
      drift for the current client.
- [ ] If the app set `state` on an `AgUiCodec`, the agent still receives it, as the `state` of
      each run.
