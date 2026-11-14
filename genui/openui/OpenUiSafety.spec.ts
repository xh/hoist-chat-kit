import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {div, fragment} from '@xh/hoist/cmp/layout';
import {type PlainObject, XH} from '@xh/hoist/core';
import {initTestAppAsync} from '@xh/hoist/test-support';
import {createElement, StrictMode} from 'react';
import {beforeAll, describe, expect, it, onTestFinished, vi} from 'vitest';
import {ChatModel, type ChatMessageSpec, type ChatTextPart, type ChatToolSpec} from '../../core';
import {ScriptedChatTransport, textEvents} from '../../transport';
import {chatUiActionSchema, describeChatUiAction} from '../ChatUiAction';
import {ChatUiCatalog} from '../ChatUiCatalog';
import type {ChatUiComponentSpec, ChatUiDocumentContext} from '../ChatUiComponentSpec';
import {openUiLangAdapter} from './OpenUiLangAdapter';
import {
    openUiLangFormat,
    type OpenUiLangFormatOptions,
    type OpenUiToolCall
} from './OpenUiLangFormat';

/**
 * A model writes each OpenUI Lang program, and a prompt injection can steer what it writes. Apps
 * rely on the format to run exactly what a button showed, to bound what a program can cost and
 * how often it calls a tool, and to leave a trace of each call.
 */
describe('OpenUI Lang safety', () => {
    beforeAll(() => initTestAppAsync());

    describe('a mutation runs what its button showed', () => {
        it('sends the arguments of the tooltip, whatever a step before it sets', async () => {
            const save = saveTool();
            renderProgram(
                'root = Stack([go])\n' +
                    '$region = "emea"\n' +
                    'saved = Mutation("save_region", {region: $region})\n' +
                    'go = Trigger("Save", Action([@Set($region, "ATTACKER"), @Run(saved)]))',
                {tools: [save], mutationTools: ['save_region']}
            );
            expect(title()).toBe(
                'Sets $region to "ATTACKER", then runs the tool save_region with {"region":"emea"}'
            );

            await clickAsync();
            await waitFor(() => expect(save.execute).toHaveBeenCalledOnce());
            expect(save.execute.mock.calls[0][0]).toEqual({region: 'emea'});
        });

        it('runs the tool of the tooltip, whatever a step before it sets', async () => {
            const save = saveTool(),
                deleteAll = {...saveTool(), name: 'delete_all'};
            renderProgram(
                'root = Stack([go])\n' +
                    '$t = "save_region"\n' +
                    'm1 = Mutation("save_region", {region: "a"})\n' +
                    'm2 = Mutation($t, {region: "b"})\n' +
                    'go = Trigger("Save", Action([@Set($t, "delete_all"), @Run(m1), @Run(m2)]))',
                {tools: [save, deleteAll], mutationTools: ['save_region', 'delete_all']}
            );
            expect(title()).toBe(
                'Sets $t to "delete_all", then runs the tool save_region with {"region":"a"}, ' +
                    'then runs the tool save_region with {"region":"b"}'
            );

            await clickAsync();
            await waitFor(() => expect(save.execute).toHaveBeenCalledTimes(2));
            expect(deleteAll.execute).not.toHaveBeenCalled();
        });

        it('gives no action for arguments too long to show in full', async () => {
            silenceLogs();
            const save = saveTool();
            renderProgram(
                'root = Stack([go])\n' +
                    `saved = Mutation("save_region", {region: "ok", note: "${'x'.repeat(1200)}"})\n` +
                    'go = Trigger("Save", Action([@Run(saved)]))',
                {tools: [save], mutationTools: ['save_region']}
            );
            expect(title()).toBe('');

            await clickAsync();
            await settleAsync();
            expect(save.execute).not.toHaveBeenCalled();
        });

        it('gives no action for a tool that is not a name', () => {
            silenceLogs();
            renderProgram(
                'root = Stack([go])\n' +
                    'saved = Mutation(123, {region: "x"})\n' +
                    'go = Trigger("Save", Action([@Run(saved)]))',
                {tools: [saveTool()], mutationTools: ['save_region']}
            );

            expect(title()).toBe('');
        });

        it('shows the tool and every argument in the approval of a tool with no prompt', async () => {
            const confirm = vi.spyOn(XH, 'confirm').mockResolvedValue(true),
                save = {...saveTool(), needsApproval: true};
            onTestFinished(() => confirm.mockRestore());
            renderProgram(
                'root = Stack([go])\n' +
                    'saved = Mutation("save_region", {region: "emea"})\n' +
                    'go = Trigger("Save", Action([@Run(saved)]))',
                {tools: [save], mutationTools: ['save_region']}
            );

            await clickAsync();
            await waitFor(() => expect(save.execute).toHaveBeenCalledOnce());
            expect(confirm.mock.calls[0][0]).toMatchObject({
                message: `Run the tool 'save_region' with {"region":"emea"}?`
            });
        });

        it('runs no step while the chat is busy', async () => {
            silenceLogs();
            const save = saveTool(),
                {chatModel} = renderProgram(
                    'root = Stack([note, go])\n' +
                        '$region = "emea"\n' +
                        'note = Note("Region " + $region)\n' +
                        'saved = Mutation("save_region", {region: $region})\n' +
                        'go = Trigger("Save", Action([@Set($region, "x"), @Run(saved)]))',
                    {tools: [save], mutationTools: ['save_region'], delayMs: 200}
                );
            void chatModel.sendAsync('hello');
            await settleAsync();
            expect(chatModel.isBusy).toBe(true);

            await clickAsync();
            await settleAsync();
            // The set comes first, and still does not run, as the mutation after it cannot.
            expect(text('note')).toBe('Region emea');
            expect(save.execute).not.toHaveBeenCalled();
        });

        it('asks for approval before any step, and runs none if the user refuses', async () => {
            silenceLogs();
            const confirm = vi.spyOn(XH, 'confirm').mockResolvedValue(false),
                save = {...saveTool(), needsApproval: true};
            onTestFinished(() => confirm.mockRestore());
            renderProgram(
                'root = Stack([note, go])\n' +
                    '$region = "emea"\n' +
                    'note = Note("Region " + $region)\n' +
                    'saved = Mutation("save_region", {region: $region})\n' +
                    'go = Trigger("Save", Action([@Set($region, "x"), @Run(saved)]))',
                {tools: [save], mutationTools: ['save_region']}
            );

            await clickAsync();
            await waitFor(() => expect(confirm).toHaveBeenCalledOnce());
            await settleAsync();
            expect(text('note')).toBe('Region emea');
            expect(save.execute).not.toHaveBeenCalled();
        });

        it('gives no action for two messages in one action, as the second would go nowhere', () => {
            silenceLogs();
            renderProgram(
                'root = Stack([go])\n' +
                    'go = Trigger("Ask", Action([@ToAssistant("First"), @ToAssistant("Second")]))',
                {}
            );

            expect(title()).toBe('');
        });
    });

    describe('queries are bounded', () => {
        it.each<[string, string]>([
            ['past the ceiling of a day', '3000000'],
            ['that is not a number', '"soon"'],
            ['that is negative', '-5']
        ])('does not hammer a tool for a refresh interval %s', async (_, interval) => {
            vi.useFakeTimers();
            const getSales = salesTool();
            renderProgram(SALES.replace('{total: 0})', `{total: 0}, ${interval})`), {
                tools: [getSales],
                queryTools: ['get_sales']
            });

            await act(() => vi.advanceTimersByTimeAsync(5000));
            expect(getSales.execute).toHaveBeenCalledTimes(1);
        });

        it('runs none of the calls of a program that holds more than the cap', async () => {
            silenceLogs();
            const getSales = salesTool(),
                lines = ['root = Stack([note])', 'note = Note("x")'];
            for (let i = 0; i < 9; i++)
                lines.push(`q${i} = Query("get_sales", {region: "r${i}"}, {})`);
            renderProgram(lines.join('\n'), {tools: [getSales], queryTools: ['get_sales']});

            await settleAsync();
            expect(getSales.execute).not.toHaveBeenCalled();
        });

        it('takes the cap from maxCalls', async () => {
            const getSales = salesTool(),
                lines = ['root = Stack([note])', 'note = Note("x")'];
            for (let i = 0; i < 9; i++)
                lines.push(`q${i} = Query("get_sales", {region: "r${i}"}, {})`);
            renderProgram(lines.join('\n'), {
                tools: [getSales],
                queryTools: ['get_sales'],
                maxCalls: 10
            });

            await waitFor(() => expect(getSales.execute).toHaveBeenCalledTimes(9));
        });

        it('reports each call that runs to onToolCall', async () => {
            const calls: OpenUiToolCall[] = [];
            renderProgram(SALES, {
                tools: [salesTool()],
                queryTools: ['get_sales'],
                onToolCall: call => calls.push(call)
            });

            await waitFor(() => expect(text('note')).toBe('Total 10'));
            expect(calls).toEqual([
                {kind: 'query', toolName: 'get_sales', args: {region: 'emea'}, messageId: 'm1'}
            ]);
        });

        it('passes the result of one query to another only between listed tools', async () => {
            silenceLogs();
            const program =
                    'root = Stack([note])\n' +
                    'a = Query("get_token", {}, {token: ""})\n' +
                    'b = Query("lookup", {q: "id " + a.token}, {ok: false})\n' +
                    'note = Note("ok " + b.ok)',
                tools = () => ({
                    getToken: {name: 'get_token', execute: vi.fn(async () => ({token: 'T1'}))},
                    lookup: {name: 'lookup', execute: vi.fn(async (_: PlainObject) => ({ok: true}))}
                });

            // With both listed, the second query runs once the first has a result.
            const both = tools();
            const first = renderProgram(program, {
                tools: [both.getToken, both.lookup],
                queryTools: ['get_token', 'lookup']
            });
            await waitFor(() => expect(text('note')).toBe('ok true'));
            expect(both.lookup.execute).toHaveBeenLastCalledWith({q: 'id T1'}, expect.anything());
            first.unmount();

            // With only the first listed, its result goes nowhere.
            const one = tools();
            renderProgram(program, {tools: [one.getToken, one.lookup], queryTools: ['get_token']});
            await waitFor(() => expect(one.getToken.execute).toHaveBeenCalled());
            await settleAsync();
            expect(one.lookup.execute).not.toHaveBeenCalled();
        });

        it('runs the queries of an older reply only once the user acts in it', async () => {
            const getSales = salesTool(),
                initialMessages: ChatMessageSpec[] = [
                    {id: 'm1', role: 'assistant', parts: [textPart(SALES)]},
                    {id: 'u2', role: 'user', parts: [textPart('More')]},
                    {id: 'm2', role: 'assistant', parts: [textPart('Done.')]}
                ];
            renderProgram(SALES, {
                tools: [getSales],
                queryTools: ['get_sales'],
                initialMessages
            });

            await settleAsync();
            expect(getSales.execute).not.toHaveBeenCalled();
            expect(text('note')).toBe('Total 0');

            fireEvent.click(screen.getByTestId('field'));
            await waitFor(() => expect(text('note')).toBe('Total 20'));
        });

        it('stops the refresh timer of a reply once the chat holds a later one', async () => {
            vi.useFakeTimers();
            const getSales = salesTool(),
                {chatModel} = renderProgram(SALES.replace('{total: 0})', '{total: 0}, 30)'), {
                    tools: [getSales],
                    queryTools: ['get_sales'],
                    initialMessages: [
                        {
                            id: 'm1',
                            role: 'assistant',
                            parts: [textPart(SALES)]
                        }
                    ]
                });
            await act(() => vi.advanceTimersByTimeAsync(31000));
            expect(getSales.execute).toHaveBeenCalledTimes(2);

            await act(async () => {
                void chatModel.sendAsync('Next');
                await vi.advanceTimersByTimeAsync(1000);
            });
            const calls = getSales.execute.mock.calls.length;
            await act(() => vi.advanceTimersByTimeAsync(120000));
            expect(getSales.execute).toHaveBeenCalledTimes(calls);
        });

        it('gives a tool plain JSON, and reads its result as plain JSON', async () => {
            class Live {
                total = 5;
                secret() {
                    return 'hidden';
                }
            }
            const execute = vi.fn(async (_: PlainObject) => new Live());
            renderProgram(
                'root = Stack([note])\n' +
                    '$o = {a: 1}\n' +
                    'sales = Query("get_sales", {region: "x", fn: $o.constructor}, {total: 0})\n' +
                    'note = Note("Total " + sales.total + " " + sales.secret)',
                {tools: [{name: 'get_sales', execute}], queryTools: ['get_sales']}
            );

            await waitFor(() => expect(text('note')).toContain('Total 5'));
            expect(execute.mock.calls[0][0]).toEqual({region: 'x'});
            expect(text('note')).not.toContain('secret');
        });
    });

    describe('evaluation is bounded', () => {
        it('refuses a program whose shared expressions double with each line', () => {
            silenceLogs();
            const lines = ['root = Stack([note])', 'note = Note(a0)', '$s = "x"'];
            for (let i = 0; i < 40; i++) lines.push(`a${i} = a${i + 1} + a${i + 1}`);
            lines.push('a40 = $s');
            const started = Date.now(),
                {container} = renderProgram(lines.join('\n'), {});

            expect(Date.now() - started).toBeLessThan(2000);
            expect(container.textContent).toContain('too large to evaluate');
        });

        it('refuses an @Each nested past the cap, and one whose lists multiply too far', () => {
            silenceLogs();
            const list = `[${[...Array(60).keys()].join(',')}]`,
                deep = renderProgram(
                    'root = Stack([note])\n' +
                        `$a = ${list}\n` +
                        'note = Note("n=" + @Count(@Each($a, "i", @Each($a, "j", @Each($a, "k", @Each($a, "l", i))))))',
                    {}
                );
            expect(deep.container.textContent).toContain('nests @Each 4 deep');
            deep.unmount();

            const wide = renderProgram(
                'root = Stack([note])\n' +
                    `$a = ${list}\n` +
                    'note = Note("n=" + @Count(@Each($a, "i", @Each($a, "j", @Each($a, "k", i + j + k)))))',
                {}
            );
            expect(wide.container.textContent).toContain('too large to evaluate');
        });

        it('still runs an @Each of a modest size', () => {
            renderProgram(
                'root = Stack([note])\n' +
                    '$a = [1, 2, 3]\n' +
                    'note = Note("n=" + @Count(@Each($a, "i", @Each($a, "j", i + j))))',
                {}
            );
            expect(text('note')).toBe('n=3');
        });
    });

    describe('a slip in one prop', () => {
        it.each<[string, string]>([
            ['a field that is not there', '{x: $o.missing}'],
            ['a function', '{x: $o.constructor}']
        ])('leaves %s out of a @ToAssistant context, and renders the rest', (_, context) => {
            const chatModel = createChatModel({});
            renderProgram(
                'root = Stack([note, go])\n' +
                    '$o = {a: 1}\n' +
                    'note = Note("hello")\n' +
                    `go = Trigger("Ask", @ToAssistant("hi", ${context}))`,
                {chatModel}
            );

            expect(text('note')).toBe('hello');
            expect(title()).toBe('Sends: "hi"');
        });

        it('drops an action whose steps data wrote, with an expression that throws', () => {
            silenceLogs();
            renderProgram(
                'root = Stack([note, go])\n' +
                    'note = Note("hello")\n' +
                    'go = Trigger("Go", {steps: [{type: "set", target: "$x", valueAST: {k: "Comp", name: "constructor", args: []}}]})',
                {}
            );

            expect(text('note')).toBe('hello');
            expect(title()).toBe('');
        });

        it('logs no warning about the steps of an action that the state runs in full', () => {
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
            onTestFinished(() => warn.mockRestore());
            renderProgram(
                'root = Stack([go])\n$n = 1\n' +
                    'go = Trigger("Go", Action([@Set($n, 2), @ToAssistant("A")]))',
                {chatModel: createChatModel({})}
            );

            expect(title()).toBe('Sets $n to 2, then sends: "A"');
            expect(warn.mock.calls.flat().join(' ')).not.toContain('holds 2 steps');
        });
    });

    describe('options', () => {
        it('takes bindings as the one switch for the evaluator', () => {
            expect(() => openUiLangFormat({root: 'stack', builtinFunctions: true})).toThrow(
                'need bindings'
            );
            expect(() =>
                openUiLangFormat({root: 'stack', bindings: false, queryTools: ['get_sales']})
            ).toThrow('need bindings');
        });

        it('leaves the built-in functions out of the prompt with builtinFunctions off', () => {
            const prompt = createCatalog({bindings: true, builtinFunctions: false}).toPrompt();

            expect(prompt).toContain('Declare mutable state');
            expect(prompt).not.toContain('## Built-in Functions');
        });
    });

    describe('a program that mounts twice', () => {
        it('keeps working under StrictMode, which unmounts and mounts it again', async () => {
            const getSales = salesTool(),
                catalog = createCatalog({bindings: true, queryTools: ['get_sales']}),
                chatModel = createChatModel({tools: [getSales]}),
                segments = catalog.parseText(SALES, {messageId: 'm1', partId: 'p1'});
            render(
                createElement(
                    StrictMode,
                    null,
                    fragment(
                        segments.map((it, idx) =>
                            div({key: idx, item: catalog.renderSegment(it, context(chatModel))})
                        )
                    )
                )
            );
            await waitFor(() => expect(text('note')).toBe('Total 10'));

            fireEvent.click(screen.getByTestId('field'));
            await waitFor(() => expect(text('note')).toBe('Total 20'));
            expect(text('field')).toBe('region=apac');
        });
    });

    describe('openUiLangAdapter', () => {
        const program = 'root = Stack([list])\nlist = Items(["one", "two", "three"])';

        it('renders every item of a program that arrives whole while its reply streams', () => {
            const catalog = createCatalog({}),
                adapter = openUiLangAdapter({root: 'stack'}),
                doc = adapter.translate(program, {catalog, isPartial: true});

            expect(doc.elements.list.props.items).toEqual(['one', 'two', 'three']);
            expect(doc.elements.list.isPartial).toBe(false);
        });

        it('still holds back the item that a program cut short is writing', () => {
            const doc = openUiLangAdapter({root: 'stack'}).translate(
                'root = Stack([list])\nlist = Items(["one", "two", "thr',
                {catalog: createCatalog({}), isPartial: true}
            );

            expect(doc.elements.list.props.items).toEqual(['one', 'two']);
        });

        it('runs the queries of a whole program while its reply streams', async () => {
            const getSales = salesTool(),
                catalog = new ChatUiCatalog({components: SPECS}),
                chatModel = createChatModel({
                    tools: [getSales],
                    initialMessages: [
                        {
                            id: 'm1',
                            role: 'assistant',
                            status: 'streaming',
                            parts: []
                        } as ChatMessageSpec
                    ]
                }),
                renderers = catalog.createDataRenderers([
                    openUiLangAdapter({root: 'stack', queryTools: ['get_sales']})
                ]);
            vi.spyOn(chatModel, 'streamingMessageId', 'get').mockReturnValue('m1');
            render(
                fragment(
                    renderers.openui(
                        {type: 'data', id: 'd1', dataType: 'openui', data: SALES},
                        {chatModel, messageId: 'm1'}
                    )
                )
            );

            await waitFor(() => expect(text('note')).toBe('Total 10'));
        });
    });
});

//------------------
// Helpers
//------------------
const SALES =
    'root = Stack([field, note])\n' +
    '$region = "emea"\n' +
    'field = Field("region", $region)\n' +
    'sales = Query("get_sales", {region: $region}, {total: 0})\n' +
    'note = Note("Total " + sales.total)';

const STACK: ChatUiComponentSpec = {
        name: 'stack',
        description: 'A vertical stack.',
        props: {type: 'object', additionalProperties: false, properties: {}},
        slots: ['default'],
        standalone: false,
        render: (_, {children}) => fragment({items: children})
    },
    NOTE: ChatUiComponentSpec<{text: string}> = {
        name: 'note',
        description: 'A short note.',
        props: {
            type: 'object',
            required: ['text'],
            additionalProperties: false,
            properties: {text: {type: 'string', maxLength: 400}}
        },
        render: ({text}) => div({'data-testid': 'note', item: text} as PlainObject)
    },
    ITEMS: ChatUiComponentSpec<{items: string[]}> = {
        name: 'items',
        description: 'A list.',
        props: {
            type: 'object',
            required: ['items'],
            additionalProperties: false,
            properties: {items: {type: 'array', items: {type: 'string'}}}
        },
        render: ({items}) =>
            div({'data-testid': 'items', item: (items ?? []).join(',')} as PlainObject)
    },
    // Shows its label and value, and sets the value to `apac` on click.
    FIELD: ChatUiComponentSpec<{label: string; value?: string}> = {
        name: 'field',
        description: 'An input.',
        props: {
            type: 'object',
            required: ['label'],
            additionalProperties: false,
            properties: {label: {type: 'string'}, value: {type: 'string'}}
        },
        stateProps: ['value'],
        render: ({label, value}, {setProp}) =>
            div({
                'data-testid': 'field',
                item: `${label}=${value}`,
                onClick: () => setProp('value', 'apac')
            } as PlainObject)
    },
    // A button that shows what its action does as its title, and runs it on click.
    TRIGGER: ChatUiComponentSpec = {
        name: 'trigger',
        description: 'A button.',
        props: {
            type: 'object',
            required: ['label'],
            additionalProperties: false,
            properties: {
                label: {type: 'string'},
                action: chatUiActionSchema({types: ['send', 'state']})
            }
        },
        render: ({label, action}, {runActionAsync}) =>
            div({
                'data-testid': 'trigger',
                title: action ? describeChatUiAction(action) : '',
                item: label,
                onClick: () => (action ? runActionAsync(action).catch(() => null) : null)
            } as PlainObject)
    },
    SPECS = [STACK, NOTE, ITEMS, FIELD, TRIGGER];

function salesTool() {
    return {
        name: 'get_sales',
        parameters: {
            type: 'object',
            additionalProperties: false,
            properties: {region: {type: 'string'}}
        },
        execute: vi.fn(async ({region}: PlainObject, _context: PlainObject) => ({
            total: region === 'apac' ? 20 : 10
        }))
    };
}

function saveTool() {
    return {
        name: 'save_region',
        execute: vi.fn(async (_input: PlainObject, _context: PlainObject) => 'Saved.')
    };
}

function createCatalog(opts: Partial<OpenUiLangFormatOptions>): ChatUiCatalog {
    return new ChatUiCatalog({
        components: SPECS,
        textFormats: [openUiLangFormat({root: 'stack', ...opts})],
        modes: ['openui']
    });
}

interface ChatOptions {
    tools?: ChatToolSpec[];
    initialMessages?: ChatMessageSpec[];
    delayMs?: number;
}

function createChatModel({tools = [], initialMessages = [], delayMs = 0}: ChatOptions): ChatModel {
    const chatModel = new ChatModel({
        tools,
        initialMessages,
        transport: new ScriptedChatTransport({respond: () => textEvents('Done.'), delayMs})
    });
    onTestFinished(() => chatModel.destroy());
    return chatModel;
}

function textPart(text: string): ChatTextPart {
    return {type: 'text', id: 'p1', text, state: 'done'};
}

function context(chatModel: ChatModel): Omit<ChatUiDocumentContext, 'isPartial'> {
    return {chatModel, messageId: 'm1', part: textPart('')};
}

// Renders a program as the message view does, in a chat with the given tools.
function renderProgram(
    program: string,
    opts: Partial<OpenUiLangFormatOptions> & ChatOptions & {chatModel?: ChatModel}
) {
    const {tools, initialMessages, delayMs, chatModel: given, ...formatOpts} = opts,
        catalog = createCatalog({bindings: true, ...formatOpts}),
        chatModel = given ?? createChatModel({tools, initialMessages, delayMs}),
        ret = render(
            fragment(
                catalog
                    .parseText(program, {messageId: 'm1', partId: 'p1'})
                    .map((it, idx) =>
                        div({key: idx, item: catalog.renderSegment(it, context(chatModel))})
                    )
            )
        );
    return {...ret, chatModel};
}

function text(testId: string): string {
    return screen.getAllByTestId(testId)[0].textContent;
}

function title(): string {
    return screen.getByTestId('trigger').title;
}

async function clickAsync() {
    await act(async () => {
        fireEvent.click(screen.getByTestId('trigger'));
        await Promise.resolve();
    });
}

// Let the calls that a render or a click started run, and their results render.
async function settleAsync() {
    await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 20));
    });
}

function silenceLogs() {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {}),
        error = vi.spyOn(console, 'error').mockImplementation(() => {});
    onTestFinished(() => {
        warn.mockRestore();
        error.mockRestore();
    });
}
