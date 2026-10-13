#!/usr/bin/env bash
# Starts the hoist-react MCP server. Prefers a sibling ../hoist-react checkout over the version
# installed under node_modules.
#
# - If ../hoist-react/mcp/server.ts exists: runs from the local checkout (local mode).
# - Otherwise: runs from node_modules/@xh/hoist (installed mode).
#
# This kit is often developed alongside hoist-react itself. In local mode the docs and symbol
# tools reflect in-progress framework code, not the last published @xh/hoist snapshot. Toolbox
# uses the same switch for the same reason. Note that `pnpm typecheck` and `pnpm test` always run
# against the installed version, so an API that exists only in the local checkout can show up in
# the MCP tools before the code here can use it.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

LOCAL_SERVER="$PROJECT_DIR/../hoist-react/bin/hoist-mcp.mjs"
LOCAL_SIGNAL="$PROJECT_DIR/../hoist-react/mcp/server.ts"
INSTALLED_SERVER="$PROJECT_DIR/node_modules/@xh/hoist/bin/hoist-mcp.mjs"

if [ -f "$LOCAL_SIGNAL" ]; then
    echo "[hoist-react-mcp] Local hoist-react checkout detected - starting in local mode" >&2
    exec node "$LOCAL_SERVER"
else
    echo "[hoist-react-mcp] No local checkout - starting from node_modules" >&2
    exec node "$INSTALLED_SERVER"
fi
