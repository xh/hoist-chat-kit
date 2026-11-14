# Hoist Chat Kit v2 Upgrade Notes

> **From:** v1.x → v2.0.0 | **Released:** unreleased | **Difficulty:** 🟢 LOW

## Overview

Hoist Chat Kit v2 is a light upgrade. It needs hoist-react v90.1. Its other required steps apply
only to apps that set the busy line of the status region, that style or test the status region,
that write a `ChatUiAdapter`, that export a catalog for a server, that render or style the
metrics component themselves, or that set `state` on an `AgUiCodec`.

- **Busy-line settings (required if used)** - v2 removes the settings of the status region's busy
  line, as the region no longer shows one - see Step 1.
- **Status region CSS and tests (required if an app styled or tested them)** - the region shows a
  line only for what stops a send or needs the user's action - see Step 2.
- **Protocol adapters (required if used)** - `ChatUiAdapter.translate()` takes a context object,
  not the catalog - see Step 3.
- **Catalog exports with text formats (required if used)** - if you configure text formats,
  regenerate the export - see Step 4.
- **Metrics component (required if rendered or styled directly)** - the metrics spec renders
  Hoist's `StatCard`, and the kit's own `ChatUiMetrics` is gone - see Step 5.
- **Segment switches (required if used)** - `ChatUiTextSegment` gained a `document` member, so an
  exhaustive `switch` over segments needs a case for it.
- **Agent state (required if used)** - `AgUiCodecConfig.state` is gone, as the chat now holds the
  agent's state - see Step 6.

## Prerequisites

Before starting, make sure:

- [ ] The app runs Hoist Chat Kit v1.x.
- [ ] The app runs hoist-react v90.1 or later. Follow hoist-react's v90 upgrade notes first.

## Upgrade Steps

### 1. Remove the Busy-Line Settings

`ChatStatusRegion` no longer shows "Assistant is working · Esc to stop" while a reply runs. The reply
shows its own progress. These settings set that line, so v2 removes them. Passing one fails to
compile.

**Find affected code:**

```bash
grep -rnE "showStopHint|busyIcon|ChatStatusRegion\.defaults|ChatStatusRegionDefaults|statusRegionProps|chatStatusRegion\(" client-app/src/
```

Remove each one:

- The `showStopHint` and `assistantName` props of `ChatStatusRegion`, also in a `ChatPanel`'s
  `statusRegionProps`.
- `ChatStatusRegion.defaults`, and the `ChatStatusRegionDefaults` type.
- `ChatKit.defaults.busyIcon`.

**Before:**

```typescript
ChatStatusRegion.defaults.showStopHint = false;
ChatKit.defaults.busyIcon = () => Icon.cog({className: 'app-busy'});

chatPanel({model: chatModel, statusRegionProps: {assistantName: 'Analyst'}});
```

**After:**

```typescript
chatPanel({model: chatModel});
```

The composer's Stop button now names Esc in its tooltip, "Stop (Esc)".

### 2. Check Status Region CSS and Tests

The region now shows a line only for a blocked send, offline, a failure, a retry countdown and a
restored draft. It shows none while a reply runs or waits for the user's answer. A reply left
running on the server, or a stalled one, shows a line only with Refresh Status.

**Find affected code:**

```bash
grep -rnE "xh-chat-status-region(__lead|__hint|--busy|--attention)|is working|Waiting for your answer above" client-app/src/
```

- Remove CSS for `xh-chat-status-region__lead`, `xh-chat-status-region__hint`,
  `xh-chat-status-region--busy` and `xh-chat-status-region--attention`. The region no longer
  renders them.
- Update tests that expect the busy line or "Waiting for your answer above." in the region. A
  screen reader still hears a turn that pauses for the user's answer.

### 3. Update Protocol Adapters

`ChatUiAdapter.translate(payload, catalog)` is now `translate(payload, {catalog, isPartial})`. The
chat calls it again as a reply streams, with `isPartial` true until the reply ends, so an adapter
can return the document that has arrived so far. Set the document's `isPartial` from it, and the
catalog renders the document as partial, with a placeholder for each element still to come. A
document without `isPartial` renders complete, as in v1. A `translate()` that throws renders a
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

### 4. Regenerate the Catalog Export

If you configure text formats, regenerate the export. `ChatUiCatalog.version` now covers the
catalog's `textFormats`, unless they are the default tag format alone. A catalog with the default
keeps its v1 version. A server that compares the version in its catalog export with the one the
browser sends sees drift until the export is rebuilt. Apps that export no catalog, or that keep
the default format, need no change.

- Run the app's catalog export script again, and deploy the new export with the server.
- Optionally, switch the script to `catalog.toExport()`, which returns the version, tools and prompt
  in one call. See
  [Export the catalog for a server](../../genui/README.md#export-the-catalog-for-a-server).

### 5. Move Metrics Code to StatCard

`chatUiMetricsSpec()` now renders Hoist's `StatCardStrip`, with a `StatCard` per figure. The spec
keeps its name, its tool `show_metrics` and its props, so catalogs, prompts and stored replies need
no change. The kit's own `ChatUiMetrics` component, its `chatUiMetrics()` factory, the
`ChatUiMetricsProps` type and the `xh-chat-ui-metrics__*` classes are gone. Apps that only list
`chatUiMetricsSpec()` in a catalog need no change.

**Find affected code:**

```bash
grep -rnE "chatUiMetrics\(|ChatUiMetrics\b|ChatUiMetricsProps|xh-chat-ui-metrics__" client-app/src/
```

- Replace a direct `chatUiMetrics()` call with Hoist's `statCardStrip()` and `statCard()`, from
  `@xh/hoist/cmp/statcard`. Format each value with `fmtChatUiNumber()` to match the chat.
- Move style overrides of the `xh-chat-ui-metrics__*` classes to Hoist's `--xh-stat-card-*`
  variables, set under `.xh-chat-ui-metrics`. The `--xh-chat-tile-min-width` and
  `--xh-chat-tile-value-font-size` variables still apply.

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

### 6. Move the Agent State to the Chat

The chat now holds the state that an AG-UI agent shares, as `ChatModel.agentState`. The agent
patches that state as it runs, and `AgUiCodec` sends it back with each run. The codec's own
`state` option sent a state that the chat could not see, so v2 removes it. Passing it fails to
compile. Apps that never set `state` on an `AgUiCodec` need no change.

**Find affected code:**

```bash
grep -rnE "AgUiCodec\(" client-app/src/
```

- Move a fixed `state` to the chat's config, as `agentState`.
- Replace a `state` function with a call to `setAgentState()` when the app's value changes. The
  chat takes a change only while no turn runs, so set it again when a turn ends.
- If the value only informs the agent, send it as `context`, which the codec still builds for
  each step.

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
this.chatModel = new ChatModel({transport: new SseChatTransport({url})});
this.addReaction({
    track: () => [this.selectedSector, this.chatModel.isBusy],
    run: ([selectedSector, isBusy]) => {
        const {chatModel} = this;
        if (!isBusy) chatModel.setAgentState({...chatModel.agentState, selectedSector});
    },
    fireImmediately: true
});
```

See [Share state with an agent](../../core/README.md#share-state-with-an-agent).

## Verification Checklist

- [ ] `tsc` passes, with no reference to the removed settings, and each `ChatUiAdapter` takes the
      context object.
- [ ] While a reply runs, the line above the composer is empty, and the reply shows its progress.
- [ ] A failed reply still shows its line, with Try Again or Refresh Status.
- [ ] A reply that shows metrics draws a row of Hoist stat cards, with deltas in color.
- [ ] If the catalog configures text formats, a server that loads its export reports no version
      drift for the current client.
- [ ] If the app set `state` on an `AgUiCodec`, the agent still receives it, as the `state` of
      each run.
