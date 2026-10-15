# Service Package

| Section | Description |
|---------|-------------|
| [Overview](#overview) | What `ChatService` does, and the key features |
| [Architecture](#architecture) | The service, its soft config, and the transport it builds |
| [Configuration Pattern](#configuration-pattern) | Creating the soft config and installing the service |
| [Common Usage Patterns](#common-usage-patterns) | Gating a helper, building its transport, and testing |
| [Properties/API Reference](#propertiesapi-reference) | The config keys, and the service API |
| [Extension Points](#extension-points) | Codecs and transport options of your own |
| [Common Pitfalls](#common-pitfalls) | Mistakes that compile but misbehave |
| [Related Packages](#related-packages) | Transports, tool groups, and Hoist services |

## Overview

The `/svc/` package holds `ChatService`, a Hoist service that resolves the app's default LLM
backend from server config. A helper agent asks it for a transport, so it needs no wiring of its
own. The enterprise picks the model, the keys, the limits and the roles once, on the server. The
browser learns only where to post and which wire format the server relays.

Import from `@xh/hoist-chat-kit/svc`.

Key features:

- **One soft config** - `chatConfig`, a client-visible JSON config, names the relay endpoint and
  its wire format.
- **Off by default** - `isEnabled` is false with no config, so a helper's button need not render.
- **Three wire formats** - `anthropic`, `openai-chat` for OpenAI-compatible gateways, and `agui`
  for an agent server.
- **A ready transport** - `createTransport()` builds a `HoistChatTransport` with the codec for
  the configured format.

## Architecture

```
ChatService (HoistService, installed as XH.chatService)
├── config: ChatConfig              # The chatConfig soft config, or null
├── isEnabled: boolean              # True if a backend is configured and turned on
└── createTransport(opts?)          # HoistChatTransport to config.url, with the matching codec
    ├── 'anthropic'   -> AnthropicCodec({system, cacheControl})
    ├── 'openai-chat' -> ChatCompletionsCodec({system})
    └── 'agui'        -> AgUiCodec({context: [system as a context entry]})
```

The service reads the config with `XH.getConf('chatConfig', null)` each time, so it holds no
state of its own.

## Configuration Pattern

1. Create the soft config on the server, with `clientVisible: true`. Hoist reserves the `xh`
   prefix for its own configs, so the kit's config has none.

    ```groovy
    configService.ensureRequiredConfigsCreated([
        new ConfigSpec(
            name: 'chatConfig',
            valueType: 'json',
            defaultValue: [enabled: false, url: 'llm/stream', codec: 'anthropic'],
            clientVisible: true,
            groupName: 'Chat',
            note: 'LLM backend for the chat kit. Keep keys and model names in server-only configs.'
        )
    ])
    ```

2. Add a relay endpoint at that `url` that forwards each request to the model, as the
   [Hoist Server Example](../transport/README.md#hoist-server-example) shows.

3. Install the service in the app's `AppModel`. The kit already adds `chatService` to the type
   of `XH`.

    ```typescript
    override async initAsync(ctx: InitContext) {
        await XH.installServicesAsync(ChatService, ctx);
    }
    ```

## Common Usage Patterns

### Gate a helper on the backend

```typescript
const {chatService} = XH;
if (!chatService?.isEnabled) return null;
```

`XH.chatService` is undefined if the app did not install the service. Check for it in shared code.

### Build a transport

```typescript
new ChatModel({
    transport: XH.chatService.createTransport({system: group.prompt}),
    tools: group.tools,
    contextProviders: [group.contextProvider]
});
```

`system` is static text, so that the prompt caches. Send live state through the chat's
`contextProviders` - see [`/core/`](../core/README.md#send-live-context-with-every-step). An
AG-UI agent owns its own prompt, so the service sends `system` to it as a `context` entry.

Any other option is a `HoistChatTransport` option, and takes precedence over the config:

```typescript
XH.chatService.createTransport({
    system: HELPER_PROMPT,
    track: {category: 'Helper', message: 'Grid helper call'},
    idleTimeout: 60_000
});
```

### Test a helper

Seed the config in the test kit's fake server before boot, and install the service in the test
app model:

```typescript
class HelperTestModel extends TestAppModel {
    override async initAsync(ctx: InitContext) {
        await XH.installServicesAsync(ChatService, ctx);
    }
}

beforeAll(async () => {
    hoistCore.configs.chatConfig = {enabled: true, url: 'llm/stream', codec: 'openai-chat'};
    hoistCore.route('POST', 'llm/stream', () => recordedReply());
    await initTestAppAsync({modelClass: HelperTestModel});
});
```

## Properties/API Reference

### ChatConfig

The value of the `chatConfig` soft config.

| Key | Type | Description |
|-----|------|-------------|
| `enabled` | `boolean` | True to turn the backend on. Required. |
| `url` | `string` | Endpoint of the relay, relative to `XH.baseUrl`. Required. |
| `codec` | `'anthropic' \| 'openai-chat' \| 'agui'` | Wire format that the relay speaks. Required. |
| `cacheControl` | `boolean` | True to mark Anthropic prompt cache breakpoints. Anthropic only. Default false. |
| `idleTimeout` | `number` | Longest wait for data from the relay, in milliseconds. Default none. |

### ChatService

| Member | Description |
|--------|-------------|
| `config` | The `chatConfig` value, or null. |
| `isEnabled` | True if `enabled` is true and `url` is set. |
| `createTransport(opts?)` | A `HoistChatTransport` to the configured backend. Throws if no backend is enabled, or if `codec` is unknown. |
| `ChatService.CONFIG_NAME` | The config name, `chatConfig`. |

`createTransport()` takes `ChatServiceTransportOptions`: `system`, plus any
`HoistChatTransportConfig` option. A `codec` replaces the configured one, and the service then
ignores `system`.

## Extension Points

- **A codec of your own** - pass `codec` to `createTransport()`. The transport keeps the
  configured `url` and options, with a codec you build, such as an `AnthropicCodec` with system
  blocks of its own.
- **Transport options** - `headers`, `params`, `track` and the timeouts pass through.

## Common Pitfalls

### Reading the config before the service is installed

`XH.chatService` exists only after `installServicesAsync()`. A component that renders before the
app model's init, or in an app that never installs the service, sees `undefined`.

### Putting keys or model choice in the config

`chatConfig` is client-visible. Keep API keys, model names, limits and roles in server-side
configs that the relay reads.

## Related Packages

- [`/transport/`](../transport/README.md) - transports and codecs, and
  [Bring your own LLM](../transport/README.md#bring-your-own-llm)
- [`/core/`](../core/README.md) - `ChatModel`, context providers and undo
- hoist-react `/svc/` - `ConfigService` and `XH.getConf()`
