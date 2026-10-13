# Claude Code on the Web - Session Hooks

Scripts that support [Claude Code on the web](https://code.claude.com/docs/en/claude-code-on-the-web)
sessions on this repo. They no-op in local sessions.

* **`session-start.sh`** - registered as a `SessionStart` hook in `.claude/settings.json`. Writes
  Font Awesome Pro registry auth to `~/.npmrc` and runs `pnpm install`, so `pnpm lint`,
  `pnpm typecheck`, and `pnpm test` work from the start. If the environment lacks the
  configuration below, the hook prints a warning and lets the session continue.

## Required environment configuration (claude.ai/code)

Set up the web environment for this repo as follows. Environment variables and the network policy
cannot live in the repo. Only the hooks and settings in `.claude/` can. The environment that
hoist-react sessions use already meets these needs and works here as-is.

### Environment variables

| Variable | Purpose |
|----------|---------|
| `FONTAWESOME_NPM_AUTH_TOKEN` | Auth token for the Font Awesome Pro npm registry. Required for `pnpm install`, because `@xh/hoist` depends on Font Awesome Pro. |

### Network policy domain allowlist

The default `Trusted` network policy allows common package registries but not Font Awesome. In
the environment dialog, follow these steps:

1. Set **Network access** to `Custom`.
2. Check **Also include default list of common package managers**.
3. Add these domains to **Allowed domains**, one per line:

```
npm.fontawesome.com
dl.fontawesome.com
```

The registry serves package metadata from `npm.fontawesome.com` and redirects tarball downloads to
`dl.fontawesome.com`, so `pnpm install` needs both.

The sandbox proxy can block a domain with an HTTP error rather than a failed connection. The
probe in `session-start.sh` then passes and `pnpm install` fails. The hook still exits cleanly,
with a warning.
