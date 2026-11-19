# Hoist Chat Kit v3 Upgrade Notes

> **From:** v2.x → v3.0.0 | **Released:** unreleased | **Difficulty:** 🟢 LOW

## Overview

Hoist Chat Kit v3 moves the kit to `@xh/hoist` v91. The kit's styles read Hoist's renamed CSS
variables, and its code and docs pass child elements as `children`. The kit's own `--xh-chat-*`
variables keep their names and their defaults.

The kit no longer uses Blueprint, which Hoist v91 removes. Its popovers, tooltips and dialogs are
Hoist's own. An app that passes `popoverProps` in `ChatThreadListProps.rowMenuProps` passes Hoist
`PopoverProps`. Set `offset` there in place of Popper.js `modifiers`.

- **Hoist v91 (required)** - upgrade the app to Hoist v91 first - see Prerequisites.
- **The kit version (required)** - see Step 1.

## Prerequisites

Before starting, make sure:

- [ ] The app runs Hoist Chat Kit v2.x.
- [ ] The app runs `@xh/hoist` v91 or later, with the hoist-react v91 upgrade notes complete. Their
  codemods also cover the app's use of the kit, such as the Hoist variables that its
  `--xh-chat-*` overrides read, and the child elements it passes to kit components.

## Upgrade Steps

### 1. Update the Kit

Set `@xh/hoist-chat-kit` to `^3.0.0` in the app's `package.json`, then install.

## Verification Checklist

- [ ] The chat shows its usual spacing, frames and colors in light and dark themes.
