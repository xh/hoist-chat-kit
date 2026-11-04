# Hoist Chat Kit v2 Upgrade Notes

> **From:** v1.x → v2.0.0 | **Released:** unreleased | **Difficulty:** 🟢 LOW

## Overview

Hoist Chat Kit v2 is a light upgrade. Its required steps apply only to apps that set the busy line
of the status region, or that style or test the status region.

- **Busy-line settings (required if used)** - v2 removes the settings of the status region's busy
  line, as the region no longer shows one - see Step 1.
- **Status region CSS and tests (required if an app styled or tested them)** - the region shows a
  line only for what stops a send or needs the user's action - see Step 2.

## Prerequisites

Before starting, make sure:

- [ ] The app runs Hoist Chat Kit v1.x.

## Upgrade Steps

### 1. Remove the Busy-Line Settings

`ChatStatusRegion` no longer shows "Assistant is working · Esc to stop" while a reply runs. The reply
shows its own progress. These settings set that line, so v2 removes them. Passing one fails to
compile.

**Find affected code:**

```bash
grep -rnE "showStopHint|busyIcon|ChatStatusRegion\.defaults|ChatStatusRegionDefaults" client-app/src/
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

## Verification Checklist

- [ ] `tsc` passes, with no reference to the removed settings.
- [ ] While a reply runs, the line above the composer is empty, and the reply shows its progress.
- [ ] A failed reply still shows its line, with Try Again or Refresh Status.
