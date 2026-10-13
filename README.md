# 💬 Hoist Chat Kit

Chat components for [Hoist React](https://github.com/xh/hoist-react) applications.

------------------------------------------

Hoist Chat Kit is a companion library to Hoist React (`@xh/hoist`), published to npm as
`@xh/hoist-chat-kit`. It is in early development.

## Using the kit in an app

The package ships as TypeScript and SCSS source, as `@xh/hoist` does. Your app compiles it with
the rest of its code.

1. Add the package: `pnpm add @xh/hoist-chat-kit`.
2. Add it to `extraIncludePaths` in your app's `rsbuild.config.mjs`, so the build transpiles it.

The kit needs `@xh/hoist` v89 or later, with `react` and `react-dom` v19. Your app supplies these
as peer dependencies.

## Development

This repo uses [pnpm](https://pnpm.io), pinned via the `packageManager` field in `package.json`.
Run `corepack enable pnpm` once so Corepack provides the right version.

```bash
pnpm install     # needs a Font Awesome Pro registry token in ~/.npmrc
pnpm lint        # eslint, stylelint, prettier --check
pnpm typecheck   # tsc, against the installed @xh/hoist
pnpm test        # unit tests (Vitest), on the @xh/hoist test kit
```

[CLAUDE.md](./CLAUDE.md) holds the full development guide: architecture, conventions, testing, and
the Git and release workflow. It serves human and AI developers alike.

------------------------------------------

📫☎️🌎 info@xh.io | <https://xh.io>

Copyright © 2026 Extremely Heavy Industries Inc.
