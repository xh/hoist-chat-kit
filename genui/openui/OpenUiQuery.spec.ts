import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {div, fragment} from '@xh/hoist/cmp/layout';
import {type PlainObject, XH} from '@xh/hoist/core';
import {initTestAppAsync} from '@xh/hoist/test-support';
import {beforeAll, describe, expect, it, onTestFinished, vi} from 'vitest';
import {ChatModel, type ChatToolSpec, chatToolResult} from '../../core';
import {ScriptedChatTransport, textEvents} from '../../transport';
import {chatUiActionSchema, describeChatUiAction} from '../ChatUiAction';
import {ChatUiCatalog} from '../ChatUiCatalog';
import type {ChatUiComponentSpec, ChatUiDocumentContext} from '../ChatUiComponentSpec';
import {openUiLangFormat, type OpenUiLangFormatOptions} from './OpenUiLangFormat';

/**
 * A program can read data with `Query()`, through the chat's tools. A model writes the program,
 * and a query runs with no click. So apps rely on the format to run only the tools they list,
 * and never a tool that needs approval.
 */
describe('OpenUI Lang queries', () => {
    beforeAll(() => initTestAppAsync());

    const SALES =
        'root = Stack([field, note])\n' +
        '$region = "emea"\n' +
        'field = Field("region", $region)\n' +
        'sales = Query("get_sales", {region: $region}, {total: 0})\n' +
        'note = Note("Total " + sales.total)';

    describe('Query', () => {
        it('runs a listed tool once the program is complete, and shows its result', async () => {
            const getSales = salesTool(),
                {rerender} = renderProgram(SALES.slice(0, -8), {
                    tools: [getSales],
                    queryTools: ['get_sales'],
                    isStreaming: true
                });

            // While the program streams, the query shows its defaults and runs nothing.
            await settleAsync();
            expect(text('field')).toBe('region=emea');
            expect(getSales.execute).not.toHaveBeenCalled();

            rerender(SALES);
            await waitFor(() => expect(text('note')).toBe('Total 10'));
            expect(getSales.execute).toHaveBeenCalledExactlyOnceWith(
                {region: 'emea'},
                expect.objectContaining({toolCallId: expect.any(String)})
            );
        });

        it('runs again when a $variable in its arguments changes', async () => {
            const getSales = salesTool();
            renderProgram(SALES, {tools: [getSales], queryTools: ['get_sales']});
            await waitFor(() => expect(text('note')).toBe('Total 10'));

            fireEvent.click(screen.getByTestId('field'));
            await waitFor(() => expect(text('note')).toBe('Total 20'));
            expect(getSales.execute).toHaveBeenCalledTimes(2);
            expect(getSales.execute).toHaveBeenLastCalledWith({region: 'apac'}, expect.anything());
        });

        it('runs again on a @Run of the query', async () => {
            const getSales = salesTool();
            renderProgram(
                `${SALES.replace('note]', 'note, go]')}\ngo = Trigger("Refresh", @Run(sales))`,
                {
                    tools: [getSales],
                    queryTools: ['get_sales']
                }
            );
            await waitFor(() => expect(getSales.execute).toHaveBeenCalledTimes(1));
            expect(screen.getByTestId('trigger').title).toBe('Refreshes sales');

            await clickAsync('trigger');
            await waitFor(() => expect(getSales.execute).toHaveBeenCalledTimes(2));
        });

        it('runs no tool that the app did not list', async () => {
            silenceLogs();
            const getSales = salesTool(),
                other = {...salesTool(), name: 'get_costs'};
            renderProgram(SALES, {tools: [getSales, other], queryTools: ['get_costs']});

            await settleAsync();
            expect(getSales.execute).not.toHaveBeenCalled();
            expect(text('note')).toBe('Total 0');
        });

        it('runs no tool at all by default', async () => {
            const getSales = salesTool();
            renderProgram(SALES, {tools: [getSales]});

            await settleAsync();
            expect(getSales.execute).not.toHaveBeenCalled();
            expect(text('note')).toBe('Total 0');
        });

        it.each<[string, Partial<ChatToolSpec>]>([
            ['that needs approval', {needsApproval: true}],
            ['that needs approval for these arguments', {needsApproval: ({region}) => !!region}],
            [
                'whose schema refuses the arguments',
                {parameters: {type: 'object', properties: {region: {enum: ['amer']}}}}
            ],
            ['whose schema the kit cannot check in full', {parameters: {type: 'object', not: {}}}],
            ['that the server runs', {execute: undefined}]
        ])('refuses a tool %s', async (_, overrides) => {
            silenceLogs();
            const confirm = vi.spyOn(XH, 'confirm'),
                execute = vi.fn(async () => ({total: 10})),
                tool = {...salesTool(), execute, ...overrides};
            onTestFinished(() => confirm.mockRestore());
            renderProgram(SALES, {tools: [tool], queryTools: ['get_sales']});

            await settleAsync();
            expect(execute).not.toHaveBeenCalled();
            expect(confirm).not.toHaveBeenCalled();
            expect(text('note')).toBe('Total 0');
        });

        it('reads a result that the tool wrote as JSON for the model', async () => {
            const tool: ChatToolSpec = {
                name: 'get_sales',
                execute: async () => chatToolResult(JSON.stringify({total: 42}))
            };
            renderProgram(SALES, {tools: [tool], queryTools: ['get_sales']});

            await waitFor(() => expect(text('note')).toBe('Total 42'));
        });

        it('holds an automatic refresh to the least interval', async () => {
            vi.useFakeTimers();
            const getSales = salesTool();
            renderProgram(SALES.replace('{total: 0})', '{total: 0}, 1)'), {
                tools: [getSales],
                queryTools: ['get_sales'],
                minRefreshSeconds: 30
            });
            await act(() => vi.advanceTimersByTimeAsync(100));
            expect(getSales.execute).toHaveBeenCalledTimes(1);

            await act(() => vi.advanceTimersByTimeAsync(20000));
            expect(getSales.execute).toHaveBeenCalledTimes(1);

            await act(() => vi.advanceTimersByTimeAsync(11000));
            expect(getSales.execute).toHaveBeenCalledTimes(2);
        });

        it('stops its refreshes once the program goes away', async () => {
            vi.useFakeTimers();
            const getSales = salesTool(),
                {unmount} = renderProgram(SALES.replace('{total: 0})', '{total: 0}, 30)'), {
                    tools: [getSales],
                    queryTools: ['get_sales']
                });
            await act(() => vi.advanceTimersByTimeAsync(100));

            unmount();
            await vi.advanceTimersByTimeAsync(120000);
            expect(getSales.execute).toHaveBeenCalledTimes(1);
            expect(getSales.execute.mock.calls[0][1].signal.aborted).toBe(true);
        });
    });

    describe('prompt', () => {
        it('teaches Query with lang-core text, and lists only the tools the app allows', () => {
            const prompt = createCatalog({
                queryTools: [
                    {
                        name: 'get_sales',
                        description: 'Sales by region.',
                        parameters: {type: 'object', properties: {region: {type: 'string'}}},
                        returns: {type: 'object', properties: {total: {type: 'number'}}}
                    }
                ]
            }).toPrompt();

            expect(prompt).toContain('## Query');
            expect(prompt).toContain('- get_sales(region?: string) → {total?: number}');
            expect(prompt).toContain('Sales by region.');
            expect(prompt).toContain('- Query can call only: get_sales.');
            expect(prompt).toContain('- Do not use Mutation.');
            // Tools turn bindings on, as a query re-runs on a $variable.
            expect(prompt).toContain('value?: $binding<string>');
        });

        it('leaves Mutation out of the prompt, and tells the model to ask the assistant', () => {
            const prompt = createCatalog({queryTools: ['get_sales']}).toPrompt();

            expect(prompt).not.toContain('## Mutation');
            expect(prompt).toContain('## Query');
            expect(prompt).toContain('- A program cannot change data.');
            expect(prompt).toContain('send a message with @ToAssistant');
        });
    });
});

//------------------
// Helpers
//------------------
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
            properties: {text: {type: 'string', maxLength: 200}}
        },
        render: ({text}) => div({'data-testid': 'note', item: text} as PlainObject)
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
                onClick: () => runActionAsync(action).catch(() => null)
            } as PlainObject)
    };

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

function createCatalog(opts: Partial<OpenUiLangFormatOptions> = {}): ChatUiCatalog {
    return new ChatUiCatalog({
        components: [STACK, NOTE, FIELD, TRIGGER],
        textFormats: [openUiLangFormat({root: 'stack', ...opts})],
        modes: ['openui']
    });
}

// Renders a program as the message view does, in a chat with the given tools.
function renderProgram(
    program: string,
    opts: Partial<OpenUiLangFormatOptions> & {tools?: ChatToolSpec[]; isStreaming?: boolean}
) {
    const {tools = [], isStreaming = false, ...formatOpts} = opts,
        catalog = createCatalog({bindings: true, ...formatOpts}),
        chatModel = new ChatModel({
            tools,
            // The chat holds the reply with the program, as its latest.
            initialMessages: [{id: 'm1', role: 'assistant', parts: []}],
            transport: new ScriptedChatTransport({respond: () => textEvents('Done.'), delayMs: 0})
        }),
        context: Omit<ChatUiDocumentContext, 'isPartial'> = {
            chatModel,
            messageId: 'm1',
            part: {type: 'text', id: 'p1', text: '', state: 'done'}
        },
        view = (source: string, streaming: boolean) =>
            fragment(
                catalog
                    .parseText(source, {isStreaming: streaming, messageId: 'm1', partId: 'p1'})
                    .map((it, idx) => div({key: idx, item: catalog.renderSegment(it, context)}))
            );
    onTestFinished(() => chatModel.destroy());

    const ret = render(view(program, isStreaming));
    return {...ret, rerender: (source: string) => ret.rerender(view(source, false))};
}

function text(testId: string): string {
    return screen.getAllByTestId(testId)[0].textContent;
}

async function clickAsync(testId: string) {
    await act(async () => {
        fireEvent.click(screen.getByTestId(testId));
        await Promise.resolve();
    });
}

// Let the queries that a render started run, and their results render.
async function settleAsync() {
    await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
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
