import {HoistService, XH} from '@xh/hoist/core';
import {throwIf} from '@xh/hoist/utils/js';
import {
    AgUiCodec,
    AnthropicCodec,
    type ChatCodec,
    ChatCompletionsCodec,
    HoistChatTransport,
    type HoistChatTransportConfig
} from '../transport';

declare module '@xh/hoist/core' {
    export interface XHApi {
        /** The kit's default LLM backend - present once the app installs {@link ChatService}. */
        chatService: ChatService;
    }
}

/**
 * The app's LLM backend, as set by the client-visible `chatConfig` soft config. The enterprise
 * chooses the model, keys, limits and roles once, on the server. The browser learns only where
 * to post and which wire format the server relays.
 */
export interface ChatConfig {
    /** True to turn the backend on. Helpers do not show while it is off. */
    enabled: boolean;

    /** Endpoint of the app's relay on its hoist-core server, relative to `XH.baseUrl`. */
    url: string;

    /**
     * Wire format that the relay speaks:
     *
     *  - `anthropic` - the Anthropic Messages API, through an {@link AnthropicCodec}.
     *  - `openai-chat` - the OpenAI chat completions API, as most model gateways speak it,
     *    through a {@link ChatCompletionsCodec}.
     *  - `agui` - an AG-UI agent, through an {@link AgUiCodec}.
     */
    codec: ChatCodecName;

    /** True to mark Anthropic prompt cache breakpoints. Anthropic only. Default false. */
    cacheControl?: boolean;

    /** Longest wait for data from the server, in milliseconds - see `idleTimeout`. */
    idleTimeout?: number;
}

/** The wire formats a {@link ChatConfig} can name. */
export type ChatCodecName = 'anthropic' | 'openai-chat' | 'agui';

/** Options for {@link ChatService.createTransport}. */
export interface ChatServiceTransportOptions extends Partial<HoistChatTransportConfig> {
    /**
     * Instructions for the model - sent as the system prompt to Anthropic and chat completions
     * backends, and as a `context` entry to an AG-UI agent, which owns its own prompt. Static
     * text, so that it caches: send live state through `ChatModelConfig.contextProviders`. Ignored
     * if a `codec` is given.
     */
    system?: string;
}

/**
 * Resolves the app's default LLM backend from the client-visible `chatConfig` soft config, so
 * that a helper agent needs no wiring of its own. Install it in the app's `AppModel`:
 *
 * ```
 * await XH.installServicesAsync(ChatService);
 * ```
 *
 * Then gate a helper on {@link isEnabled}, and build its transport with {@link createTransport}.
 * The config names the relay endpoint and its wire format. A missing config, or one with
 * `enabled: false`, turns helpers off.
 */
export class ChatService extends HoistService {
    static instance: ChatService;

    /** The name of the soft config this service reads. */
    static readonly CONFIG_NAME = 'chatConfig';

    /** The backend config, or null if the app has none. */
    get config(): ChatConfig {
        return XH.getConf(ChatService.CONFIG_NAME, null);
    }

    /** True if an LLM backend is configured and turned on. Helpers show only while it is. */
    get isEnabled(): boolean {
        const {config} = this;
        return config?.enabled === true && !!config.url;
    }

    /**
     * Create a transport to the configured backend: a {@link HoistChatTransport} posting to the
     * configured `url`, with the codec for its wire format.
     *
     * @param opts - a system prompt for the codec, and any transport options - which take
     *      precedence over the config, as does a `codec`.
     * @throws if no backend is enabled.
     */
    createTransport(opts: ChatServiceTransportOptions = {}): HoistChatTransport {
        throwIf(
            !this.isEnabled,
            `ChatService has no LLM backend - enable it with the '${ChatService.CONFIG_NAME}' config.`
        );
        const {url, idleTimeout} = this.config,
            {system, ...rest} = opts;
        return new HoistChatTransport({
            url,
            idleTimeout,
            ...rest,
            codec: rest.codec ?? this.createCodec(system)
        });
    }

    //------------------
    // Implementation
    //------------------
    private createCodec(system: string): ChatCodec {
        const {codec, cacheControl = false} = this.config;
        switch (codec) {
            case 'anthropic':
                return new AnthropicCodec({system, cacheControl});
            case 'openai-chat':
                return new ChatCompletionsCodec({system});
            case 'agui':
                return new AgUiCodec({
                    context: system
                        ? [{description: 'Instructions from the app', value: system}]
                        : null
                });
            default:
                throw XH.exception(
                    `Unknown codec '${codec}' in '${ChatService.CONFIG_NAME}' - use 'anthropic', 'openai-chat' or 'agui'.`
                );
        }
    }
}
