# 💬 Hoist Chat Kit

Chat components for [Hoist React](https://github.com/xh/hoist-react) applications.

------------------------------------------

Hoist Chat Kit is a companion library to Hoist React (`@xh/hoist`), published to npm as
`@xh/hoist-chat-kit`. It gives a Hoist app a complete chat with an LLM or an agent. It holds the
models, the transports that stream replies from a backend, and the desktop components. Its code
follows Hoist's own conventions, so it reads and behaves like the rest of a Hoist app.

## Features

- **Real token streaming** - replies render as they arrive, and a stop closes the connection, so
  the server stops generating.
- **A client-side tool loop** - the model calls tools that run in the browser and act on the app.
  It can filter a grid, change a dashboard, or open a view.
- **Human in the loop** - tool calls can wait for the user to approve them, with a question
  that suits each call, or for the user to answer them.
- **Generative UI** - the model shows the app's own Hoist components inline in its reply: grids,
  charts, KPI tiles and cards, or components the app writes. A catalog the app controls limits
  the model to known components with checked props, and adapters draw A2UI or OpenUI payloads
  with the same components.
- **Rich message parts** - markdown text, reasoning, tool call cards, files, sources with inline
  citations, and app-defined data parts.
- **Conversation actions** - stop, retry, regenerate, edit a past message, and persist history.
- **Protocol-neutral** - AG-UI events are the wire vocabulary. Codecs translate AG-UI and the
  Anthropic Messages API, and you can add your own.
- **Built for hoist-core** - the default transport streams NDJSON from your own server, with
  Hoist's auth, tracing and error handling.

## Quick Start

Create a `ChatModel` with a transport and a tool, then render it with `chatPanel`.

```typescript
import {ChatModel} from '@xh/hoist-chat-kit/core';
import {chatPanel} from '@xh/hoist-chat-kit/desktop/cmp/chat';
import {AnthropicCodec, HoistChatTransport} from '@xh/hoist-chat-kit/transport';
import {hoistCmp, HoistModel, managed, uses, XH} from '@xh/hoist/core';
import {Icon} from '@xh/hoist/icon';

export class AssistantModel extends HoistModel {
    @managed readonly chatModel = new ChatModel({
        transport: new HoistChatTransport({
            url: 'chat/stream',
            codec: new AnthropicCodec({system: 'You are a helpful assistant in a Hoist app.'})
        }),
        tools: [
            {
                name: 'set_theme',
                description: 'Switch the app between its light and dark themes.',
                parameters: {
                    type: 'object',
                    properties: {dark: {type: 'boolean', description: 'True for the dark theme.'}},
                    required: ['dark']
                },
                displayName: 'Change theme',
                icon: Icon.sun(),
                execute: ({dark}) => {
                    XH.setTheme(dark ? 'dark' : 'light');
                    return `The app now uses the ${dark ? 'dark' : 'light'} theme.`;
                }
            }
        ]
    });
}

export const assistantPanel = hoistCmp.factory({
    model: uses(AssistantModel),
    render({model}) {
        return chatPanel({model: model.chatModel, title: 'Assistant', icon: Icon.ai(), flex: 1});
    }
});
```

The `chat/stream` endpoint is a hoist-core controller that relays the Anthropic Messages API as
NDJSON. See the [Hoist Server Example](./transport/README.md#hoist-server-example) for a complete
controller and service.

## Installation

The kit needs `@xh/hoist` v89 or later, with `react` and `react-dom` v19. Your app supplies these
as peer dependencies.

The package ships as TypeScript and SCSS source, as `@xh/hoist` does, and your app compiles it
with the rest of its code.

1. Add the package: `pnpm add @xh/hoist-chat-kit`.
2. Add it to `extraIncludePaths` in your app's `rsbuild.config.mjs`, so the build transpiles it:

```javascript
import configureRsbuild from '@xh/hoist-dev-utils/configureRsbuild';
import path from 'node:path';

export default ({envMode}) =>
    configureRsbuild({
        appCode: 'myApp',
        // ...
        extraIncludePaths: [path.resolve('node_modules/@xh/hoist-chat-kit')]
    });
```

Toolbox compiles the kit this way. Its Weather V2 example uses the kit for its Dashboard Agent.

## Documentation

Start with the [Documentation Index](./docs/README.md). Its Quick Reference table maps common
tasks to the right doc.

| Doc | Covers |
|-----|--------|
| [Architecture](./docs/architecture.md) | Layers, the flow of one turn, render performance, extension points |
| [`/core/`](./core/README.md) | `ChatModel`, messages and parts, tools, approvals, persistence, errors |
| [`/transport/`](./transport/README.md) | Transports, codecs, `ChatEvent`, server contracts, the Grails example |
| [`/genui/`](./genui/README.md) | The generative UI catalog, component specs and protocol adapters |
| [`/desktop/cmp/chat/`](./desktop/cmp/chat/README.md) | Desktop components and theming |
| [`/desktop/cmp/genui/`](./desktop/cmp/genui/README.md) | The built-in grid, chart, KPI tile and card components |
| [`/cmp/markdown/`](./cmp/markdown/README.md) | The streaming markdown renderer |
| [Protocols](./docs/protocols.md) | AG-UI, Anthropic, OpenAI, A2UI, OpenUI, MCP Apps, the Vercel AI SDK |

## Development

This repo uses [pnpm](https://pnpm.io), pinned via the `packageManager` field in `package.json`.
Run `corepack enable pnpm` once so Corepack provides the right version.

```bash
pnpm install     # needs a Font Awesome Pro registry token in ~/.npmrc
pnpm lint        # eslint, stylelint, prettier --check
pnpm typecheck   # tsc, against the installed @xh/hoist
pnpm test        # unit tests (Vitest), on the @xh/hoist test kit
pnpm build       # pack the package and check what it ships
```

`CLAUDE.md`, at the root of the repository, holds the full development guide: architecture,
conventions, testing, and the Git and release workflow. It serves human and AI developers alike.

------------------------------------------

📫☎️🌎 info@xh.io | <https://xh.io>

Copyright © 2026 Extremely Heavy Industries Inc.
