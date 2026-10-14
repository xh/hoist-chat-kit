import {type InitContext, type PlainObject, XH} from '@xh/hoist/core';
import {hoistCore, initTestAppAsync, TestAppModel} from '@xh/hoist/test-support';
import {beforeAll, describe, expect, it, onTestFinished} from 'vitest';
import {ChatMessage, ChatModel} from '../core';
import {
    AgUiCodec,
    AnthropicCodec,
    ChatCompletionsCodec,
    type ChatRunRequest,
    HoistChatTransport
} from '../transport';
import {ChatService} from './ChatService';

/**
 * ChatService is how a helper agent finds the app's LLM backend with no wiring of its own. It must
 * read the server's `chatConfig`, stay off - so helpers do not show - unless a backend is enabled,
 * and build a transport that speaks the relay's wire format.
 */
describe('ChatService', () => {
    beforeAll(async () => {
        hoistCore.configs.chatConfig = {
            enabled: true,
            url: 'llm/stream',
            codec: 'anthropic',
            cacheControl: true
        };
        await initTestAppAsync({modelClass: ChatTestModel});
    });

    it('installs on XH and reads the enabled backend from chatConfig', () => {
        expect(XH.chatService).toBe(ChatService.instance);
        expect(XH.chatService.isEnabled).toBe(true);
        expect(XH.chatService.config.codec).toBe('anthropic');
    });

    it.each([
        ['no config', undefined],
        ['enabled: false', {enabled: false, url: 'llm/stream', codec: 'anthropic'}],
        ['no url', {enabled: true, codec: 'anthropic'}]
    ])('is disabled, and builds no transport, with %s', async (_, config) => {
        await loadChatConfigAsync(config);

        expect(XH.chatService.isEnabled).toBe(false);
        expect(() => XH.chatService.createTransport()).toThrow("'chatConfig' config");
    });

    it('builds an Anthropic transport with the prompt and cache setting', async () => {
        await loadChatConfigAsync({
            enabled: true,
            url: 'llm/stream',
            codec: 'anthropic',
            cacheControl: true,
            idleTimeout: 30000
        });

        const transport = XH.chatService.createTransport({system: 'Be brief.'}),
            {codec} = transport;

        expect(transport).toBeInstanceOf(HoistChatTransport);
        expect(transport).toMatchObject({url: 'llm/stream', idleTimeout: 30000});
        expect(codec).toBeInstanceOf(AnthropicCodec);
        expect(codec).toMatchObject({system: 'Be brief.', cacheControl: true});
    });

    it('builds a chat completions transport for an OpenAI-compatible gateway', async () => {
        await loadChatConfigAsync({enabled: true, url: 'llm/openai', codec: 'openai-chat'});

        const {codec} = XH.chatService.createTransport({system: 'Be brief.'}),
            body = await codec.encodeRequest(request());

        expect(codec).toBeInstanceOf(ChatCompletionsCodec);
        expect(body.messages[0]).toEqual({role: 'system', content: 'Be brief.'});
    });

    it('builds an AG-UI transport that sends the prompt as context', async () => {
        await loadChatConfigAsync({enabled: true, url: 'agent', codec: 'agui'});

        const {codec} = XH.chatService.createTransport({system: 'Be brief.'}),
            body = await codec.encodeRequest(request());

        expect(codec).toBeInstanceOf(AgUiCodec);
        expect(body.context).toEqual([
            {description: 'Instructions from the app', value: 'Be brief.'}
        ]);
    });

    it('takes transport options over the config, including a codec of its own', async () => {
        await loadChatConfigAsync({enabled: true, url: 'llm/stream', codec: 'anthropic'});
        const codec = new AgUiCodec(),
            transport = XH.chatService.createTransport({url: 'llm/other', codec});

        expect(transport.url).toBe('llm/other');
        expect(transport.codec).toBe(codec);
    });

    it('throws for a codec it does not know', async () => {
        await loadChatConfigAsync({enabled: true, url: 'llm/stream', codec: 'gemini'});
        expect(() => XH.chatService.createTransport()).toThrow("Unknown codec 'gemini'");
    });

    it('streams a reply from the configured relay', async () => {
        await loadChatConfigAsync({enabled: true, url: 'llm/openai', codec: 'openai-chat'});
        hoistCore.route('POST', 'llm/openai', () => ndjson(OPENAI_REPLY));
        const model = new ChatModel({transport: XH.chatService.createTransport()});
        onTestFinished(() => model.destroy());

        await model.sendAsync('Hi');

        expect(model.lastMessage.text).toBe('Hello.');
        expect(model.lastMessage.status).toBe('complete');
    });
});

//------------------
// Helpers
//------------------
class ChatTestModel extends TestAppModel {
    override async initAsync(ctx: InitContext) {
        await XH.installServicesAsync(ChatService, ctx);
    }
}

/** Serve a new `chatConfig` - or none - and reload configs, as a new page load would. */
async function loadChatConfigAsync(config: PlainObject) {
    if (config === undefined) {
        delete hoistCore.configs.chatConfig;
    } else {
        hoistCore.configs.chatConfig = config;
    }
    await XH.configService.initAsync(null);
}

function request(): ChatRunRequest {
    const message = new ChatMessage({id: 'u1', role: 'user', content: 'Hi'});
    return {
        threadId: 't1',
        runId: 'r1',
        historyMode: 'client',
        trigger: 'submit',
        turnId: 'u1',
        stepIndex: 0,
        messages: [message],
        newMessages: [message],
        replacedMessageId: null,
        runOptions: null,
        catalogVersion: null,
        tools: [],
        context: [],
        signal: new AbortController().signal
    };
}

const OPENAI_REPLY = [
    {
        object: 'chat.completion.chunk',
        model: 'gpt-test',
        choices: [{index: 0, delta: {content: 'Hello.'}}]
    },
    {
        object: 'chat.completion.chunk',
        model: 'gpt-test',
        choices: [{index: 0, delta: {}, finish_reason: 'stop'}]
    }
];

function ndjson(records: PlainObject[]): Response {
    return new Response(records.map(it => JSON.stringify(it) + '\n').join(''), {
        headers: {'Content-Type': 'application/x-ndjson'}
    });
}
