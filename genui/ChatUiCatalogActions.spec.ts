import {type PlainObject, XH} from '@xh/hoist/core';
import {initTestAppAsync} from '@xh/hoist/test-support';
import {beforeAll, describe, expect, it, onTestFinished, vi} from 'vitest';
import {ChatModel, type ChatToolSpec} from '../core';
import {ScriptedChatTransport, textEvents} from '../transport';
import {type ChatUiAction, chatUiActionSchema, describeChatUiAction} from './ChatUiAction';
import {ChatUiCatalog, type ChatUiCatalogConfig} from './ChatUiCatalog';
import {findSchemaProblems, validateSchema} from './impl/validateSchema';

/**
 * Components run actions that the model wrote, such as the buttons of a card. The model's output
 * is untrusted, so apps rely on the catalog to check every action before it runs, to send
 * structured context beside a message rather than inside it, to open only allowed URLs, and to
 * ask the user first where the action or its tool says so.
 */
describe('ChatUiCatalog actions', () => {
    beforeAll(() => initTestAppAsync());

    describe('send', () => {
        it('sends the text as the user message', async () => {
            const chatModel = createChatModel();
            await runAsync({type: 'send', text: 'Show my trades.'}, {chatModel});

            expect(chatModel.messages[0]).toMatchObject({role: 'user', text: 'Show my trades.'});
            expect(chatModel.messages[0].metadata.context).toBeUndefined();
        });

        it('sends structured context on the message metadata, never in its text', async () => {
            const chatModel = createChatModel(),
                context = {accountId: 'A-17', quarter: 3};
            await runAsync({type: 'send', text: 'Close these.', context}, {chatModel});

            expect(chatModel.messages[0].text).toBe('Close these.');
            expect(chatModel.messages[0].metadata.context).toEqual(context);
            expect(chatModel.messages[0].text).not.toContain('A-17');
        });

        it('refuses text past the length cap, and context the user could not read', async () => {
            const chatModel = createChatModel(),
                send = vi.spyOn(chatModel, 'sendAsync');

            await expect(
                runAsync({type: 'send', text: 'x'.repeat(201)}, {chatModel})
            ).rejects.toThrow('text: expected at most 200 characters');
            await expect(
                runAsync({type: 'send', text: 'Go', context: {blob: 'x'.repeat(101)}}, {chatModel})
            ).rejects.toThrow('context.blob: expected at most 100 characters');
            await expect(
                runAsync({type: 'send', text: 'Go', context: {ids: [1, 2]}}, {chatModel})
            ).rejects.toThrow('context.ids: expected');
            const many = Object.fromEntries([...Array(9).keys()].map(it => [`k${it}`, it]));
            await expect(
                runAsync({type: 'send', text: 'Go', context: many}, {chatModel})
            ).rejects.toThrow('context has more than 8 entries');
            expect(send).not.toHaveBeenCalled();
        });
    });

    describe('openUrl', () => {
        it.each<[string, ChatUiCatalogConfig['urlAllowList'], string, boolean]>([
            ['an allowed origin', ['https://example.com'], 'https://example.com/r?id=1', true],
            ['another origin', ['https://example.com'], 'https://example.com.evil.io/r', false],
            [
                'another scheme on an allowed host',
                ['https://example.com'],
                'http://example.com/r',
                false
            ],
            [
                'a URL the function allows',
                url => url.hostname.endsWith('.xh.io'),
                'https://docs.xh.io/x',
                true
            ],
            [
                'a URL the function refuses',
                url => url.hostname.endsWith('.xh.io'),
                'https://xh.io.evil/x',
                false
            ],
            ['any URL, with no allow list', null, 'https://example.com/r', false],
            ['a javascript URL, even if allowed', () => true, 'javascript:alert(1)', false],
            ['a data URL, even if allowed', () => true, 'data:text/html,<b>x</b>', false],
            ['a relative URL', () => true, '/admin', false]
        ])('checks %s', (_, urlAllowList, url, allowed) => {
            expect(createCatalog({urlAllowList}).isUrlAllowed(url)).toBe(allowed);
        });

        it('takes each allow list entry as its origin, and refuses one that is not a URL', () => {
            const catalog = createCatalog({urlAllowList: ['https://example.com/reports/']});
            expect(catalog.isUrlAllowed('https://example.com/r?id=1')).toBe(true);
            expect(() => createCatalog({urlAllowList: ['example.com']})).toThrow('is not a URL');
        });

        it('opens an allowed URL in a new window, and refuses others', async () => {
            const open = vi.spyOn(XH, 'openWindow').mockImplementation(() => {}),
                catalog = createCatalog({urlAllowList: ['https://example.com']});
            onTestFinished(() => open.mockRestore());

            await runAsync({type: 'openUrl', url: 'https://example.com/report'}, {catalog});
            await expect(
                runAsync({type: 'openUrl', url: 'https://evil.example/x'}, {catalog})
            ).rejects.toThrow('URL not allowed');

            expect(open).toHaveBeenCalledExactlyOnceWith('https://example.com/report', '_blank');
        });
    });

    describe('navigate', () => {
        it('routes the app', async () => {
            const navigate = vi.spyOn(XH, 'navigate').mockImplementation(() => null);
            onTestFinished(() => navigate.mockRestore());

            await runAsync({type: 'navigate', route: 'default.trades', params: {id: 7}});

            expect(navigate).toHaveBeenCalledExactlyOnceWith('default.trades', {id: 7});
        });
    });

    describe('callTool', () => {
        const FILTER: ChatToolSpec = {
            name: 'filter_grid',
            parameters: {
                type: 'object',
                required: ['region'],
                additionalProperties: false,
                properties: {region: {type: 'string'}}
            },
            execute: ({region}) => `Filtered to ${region}.`
        };

        it('runs a client tool with checked input, and resolves to its result', async () => {
            const chatModel = createChatModel([FILTER]);
            expect(
                await runAsync(
                    {type: 'callTool', name: 'filter_grid', input: {region: 'EMEA'}},
                    {chatModel}
                )
            ).toBe('Filtered to EMEA.');
        });

        it('refuses an unknown tool, a backend tool, and input that fails its schema', async () => {
            const chatModel = createChatModel([FILTER, {name: 'search_web'}]);

            await expect(
                runAsync({type: 'callTool', name: 'drop_table'}, {chatModel})
            ).rejects.toThrow("No client tool named 'drop_table'.");
            await expect(
                runAsync({type: 'callTool', name: 'search_web'}, {chatModel})
            ).rejects.toThrow("No client tool named 'search_web'.");
            await expect(
                runAsync({type: 'callTool', name: 'filter_grid', input: {region: 1}}, {chatModel})
            ).rejects.toThrow(
                "Invalid input for tool 'filter_grid': region: expected string, got number"
            );
        });

        it('asks first for a tool that needs approval, with its approval prompt', async () => {
            const confirm = mockConfirm(false),
                execute = vi.fn(),
                chatModel = createChatModel([
                    {
                        ...FILTER,
                        execute,
                        needsApproval: true,
                        approvalPrompt: ({region}) => `Filter to ${region}?`
                    }
                ]);

            expect(
                await runAsync(
                    {type: 'callTool', name: 'filter_grid', input: {region: 'EMEA'}},
                    {chatModel}
                )
            ).toBeNull();
            expect(confirm).toHaveBeenCalledWith(
                expect.objectContaining({message: 'Filter to EMEA?'})
            );
            expect(execute).not.toHaveBeenCalled();
        });
    });

    describe('callTool refusals', () => {
        it('refuses a tool whose schema the catalog cannot fully check', async () => {
            const chatModel = createChatModel([
                {
                    name: 'loose',
                    parameters: {type: 'object', allOf: [{required: ['id']}]},
                    execute: () => 'Ran.'
                }
            ]);
            await expect(runAsync({type: 'callTool', name: 'loose'}, {chatModel})).rejects.toThrow(
                'keywords the catalog cannot check'
            );
        });

        it('refuses while the chat is busy', async () => {
            const chatModel = createChatModel([{name: 'go', execute: () => 'Ran.'}]),
                sent = chatModel.sendAsync('Hi');
            await expect(runAsync({type: 'callTool', name: 'go'}, {chatModel})).rejects.toThrow(
                'Wait for the reply to finish.'
            );
            await sent;
        });
    });

    describe('without a ChatModel', () => {
        it('refuses actions that message the chat, and says why', async () => {
            await expect(runAsync({type: 'send', text: 'Hi'})).rejects.toThrow(
                'No chat to send to'
            );
            await expect(runAsync({type: 'callTool', name: 'go'})).rejects.toThrow(
                'No chat to send to'
            );
        });
    });

    describe('app', () => {
        it('runs the handler for its name, with the params and the chat', async () => {
            const handler = vi.fn(() => 'done'),
                catalog = createCatalog({actionHandlers: {exportTrades: handler}}),
                chatModel = createChatModel();

            expect(
                await runAsync(
                    {type: 'app', name: 'exportTrades', params: {format: 'xlsx'}},
                    {catalog, chatModel}
                )
            ).toBe('done');
            expect(handler).toHaveBeenCalledWith({format: 'xlsx'}, {chatModel, messageId: 'm1'});
        });

        it('refuses an action named for a member every object inherits', async () => {
            await expect(runAsync({type: 'app', name: 'constructor'})).rejects.toThrow(
                "No handler for app action 'constructor'."
            );
        });

        it('refuses an action with no handler', async () => {
            await expect(runAsync({type: 'app', name: 'wipe'})).rejects.toThrow(
                "No handler for app action 'wipe'."
            );
        });
    });

    describe('checks', () => {
        it.each<[string, PlainObject, string]>([
            ['an unknown type', {type: 'eval', code: 'x'}, 'Invalid action'],
            ['a missing field', {type: 'navigate'}, 'route: required'],
            ['an unknown field', {type: 'send', text: 'x', html: '<b>'}, 'html: unknown property'],
            [
                'a URL that is not http',
                {type: 'openUrl', url: 'file:///etc/passwd'},
                'url: expected to match'
            ],
            [
                'a confirm with no message',
                {type: 'send', text: 'x', confirm: {title: 'Sure?'}},
                'message: required'
            ]
        ])('refuses %s', async (_, action, error) => {
            await expect(runAsync(action as ChatUiAction)).rejects.toThrow(error);
        });

        it('asks the user to confirm first, and does nothing if they cancel', async () => {
            const confirm = mockConfirm(false),
                handler = vi.fn(),
                catalog = createCatalog({actionHandlers: {wipe: handler}});

            await runAsync(
                {type: 'app', name: 'wipe', confirm: {title: 'Wipe', message: 'Wipe the draft?'}},
                {catalog}
            );

            expect(confirm).toHaveBeenCalledExactlyOnceWith({
                title: 'Wipe',
                message: 'Wipe the draft?'
            });
            expect(handler).not.toHaveBeenCalled();
        });

        it('runs a confirmed action', async () => {
            mockConfirm(true);
            const handler = vi.fn(),
                catalog = createCatalog({actionHandlers: {wipe: handler}});

            await runAsync({type: 'app', name: 'wipe', confirm: {message: 'Wipe?'}}, {catalog});

            expect(handler).toHaveBeenCalledOnce();
        });
    });

    describe('chatUiActionSchema', () => {
        it('uses only keywords the catalog checks', () => {
            expect(findSchemaProblems(chatUiActionSchema())).toEqual([]);
        });

        it('limits the types, and requires a label for a button', () => {
            const schema = chatUiActionSchema({types: ['send'], requireLabel: true});

            expect(validateSchema({type: 'send', label: 'Go', text: 'Go.'}, schema)).toEqual([]);
            expect(validateSchema({type: 'send', text: 'Go.'}, schema)).toEqual([
                'label: required'
            ]);
            expect(
                validateSchema({type: 'openUrl', label: 'Go', url: 'https://x.io'}, schema)
            ).not.toEqual([]);
        });
    });

    describe('describeChatUiAction', () => {
        it.each<[ChatUiAction, string]>([
            [{type: 'send', text: 'Show trades.'}, 'Sends: "Show trades."'],
            [
                {type: 'send', text: 'Explain it.', context: {ticker: 'XYZ', quarter: 3}},
                'Sends: "Explain it.", with ticker: XYZ, quarter: 3'
            ],
            [{type: 'openUrl', url: 'https://x.io/r'}, 'Opens https://x.io/r'],
            [{type: 'navigate', route: 'default.trades'}, 'Goes to default.trades'],
            [{type: 'callTool', name: 'filter_grid'}, 'Runs the tool filter_grid'],
            [{type: 'app', name: 'exportTrades'}, 'Runs exportTrades']
        ])('describes %o', (action, text) => {
            expect(describeChatUiAction(action)).toBe(text);
        });
    });
});

//------------------
// Helpers
//------------------
function createCatalog(config: Partial<ChatUiCatalogConfig> = {}): ChatUiCatalog {
    return new ChatUiCatalog({
        components: [
            {name: 'note', description: 'A note.', props: {type: 'object'}, render: () => null}
        ],
        ...config
    });
}

function createChatModel(tools: ChatToolSpec[] = []): ChatModel {
    const ret = new ChatModel({
        transport: new ScriptedChatTransport({responses: [textEvents('OK.')], delayMs: 0}),
        tools
    });
    onTestFinished(() => ret.destroy());
    return ret;
}

function runAsync(
    action: ChatUiAction,
    opts: {catalog?: ChatUiCatalog; chatModel?: ChatModel} = {}
): Promise<unknown> {
    const {catalog = createCatalog(), chatModel = null} = opts;
    return catalog.runActionAsync(action, {chatModel, messageId: 'm1'});
}

function mockConfirm(result: boolean) {
    const ret = vi.spyOn(XH, 'confirm').mockResolvedValue(result);
    onTestFinished(() => ret.mockRestore());
    return ret;
}
