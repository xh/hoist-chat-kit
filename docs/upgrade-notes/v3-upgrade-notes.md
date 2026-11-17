# Hoist Chat Kit v3 Upgrade Notes

> **From:** v2.x → v3.0.0 | **Released:** unreleased | **Difficulty:** 🟢 LOW

## Overview

Hoist Chat Kit v3 moves the kit to `@xh/hoist` v91. Hoist v91 renames its CSS variables, and the
kit's styles now read the new names. The kit's own `--xh-chat-*` variables keep their names and
their defaults.

- **Hoist v91 (required)** - the kit needs `@xh/hoist` v91 or later - see Step 1.
- **The kit version (required)** - see Step 2.

## Prerequisites

Before starting, make sure:

- [ ] The app runs Hoist Chat Kit v2.x.

## Upgrade Steps

### 1. Upgrade Hoist to v91

Follow the hoist-react v91 upgrade notes. They include the CSS variable codemod and the move to AG
Grid 36.3. Run the codemod over all of the app's styles and code. It also rewrites the Hoist names
that the app's overrides of `--xh-chat-*` variables read.

**Before:**

```scss
body.xh-app {
  --xh-chat-side-pad: var(--xh-pad-px);
}
```

**After:**

```scss
body.xh-app {
  --xh-chat-side-pad: var(--xh-spacing);
}
```

### 2. Update the Kit

Set `@xh/hoist-chat-kit` to `^3.0.0` in the app's `package.json`, then install.

## Verification Checklist

- [ ] The browser console shows no Hoist development-mode warnings about CSS variables.
- [ ] The chat shows its usual spacing, frames and colors in light and dark themes.
