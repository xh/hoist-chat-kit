import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {div, fragment} from '@xh/hoist/cmp/layout';
import type {PlainObject} from '@xh/hoist/core';
import {initTestAppAsync} from '@xh/hoist/test-support';
import {createElement, StrictMode} from 'react';
import {beforeAll, describe, expect, it, onTestFinished, vi} from 'vitest';
import {ChatModel, type ChatMessageSpec, type ChatTextPart, type ChatToolSpec} from '../../core';
import {ScriptedChatTransport, textEvents} from '../../transport';
import {CHAT_UI_ACTION_TYPES, chatUiActionSchema, describeChatUiAction} from '../ChatUiAction';
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

    describe('a program cannot change data', () => {
        it('has no mutationTools option, and says so to an app that passes one', () => {
            const opts = {root: 'stack', bindings: true, mutationTools: ['save_region']};

            expect(() => openUiLangFormat(opts)).toThrow('has no mutationTools option');
            expect(() => openUiLangAdapter(opts)).toThrow('has no mutationTools option');
        });

        it('renders a program with a Mutation, and disables the button that would run it', async () => {
            silenceLogs();
            const save = saveTool();
            renderProgram(
                'root = Stack([note, go])\n' +
                    '$region = "emea"\n' +
                    'saved = Mutation("save_region", {region: $region})\n' +
                    'note = Note("Status " + saved.status)\n' +
                    'go = Trigger("Save", Action([@Set($region, "x"), @Run(saved)]))',
                {tools: [save], queryTools: ['save_region']}
            );
            expect(text('note')).toBe('Status idle');
            expect(title()).toBe('This action would change data, which a program cannot do.');

            await clickAsync();
            await settleAsync();
            expect(save.execute).not.toHaveBeenCalled();
            expect(text('note')).toBe('Status idle');
        });

        it.each<[string, string]>([
            ['a callTool action', '{type: "callTool", name: "delete_all", input: {scope: "all"}}'],
            ['a send action', '{type: "send", text: "Pay now"}'],
            ['a list of steps', '{steps: [{type: "reset", targets: ["$region"]}]}'],
            [
                'a state action that names another button',
                '{type: "state", id: "real.action", summary: "Sets $region to \\"x\\""}'
            ],
            ['a $variable', '$plan'],
            ['a field of a query', 'sales.plan']
        ])('takes no action from data: %s', async (_, written) => {
            silenceLogs();
            const deleteAll = {...saveTool(), name: 'delete_all'},
                chatModel = createChatModel({tools: [deleteAll]});
            renderProgram(
                'root = Stack([note, go, real])\n' +
                    '$region = "emea"\n' +
                    '$plan = {steps: [{type: "reset", targets: ["$region"]}]}\n' +
                    'sales = Query("get_sales", {}, {plan: {steps: [{type: "reset", targets: ["$region"]}]}})\n' +
                    'note = Note("Region " + $region)\n' +
                    'real = Trigger("Real", @Set($region, "x"))\n' +
                    `go = AnyTrigger("Go", ${written})`,
                {chatModel}
            );
            const go = screen.getByTestId('any-trigger');
            expect(go.title).toBe('This action is not valid, so it cannot run.');

            await act(async () => {
                fireEvent.click(go);
                await Promise.resolve();
            });
            await settleAsync();
            expect(deleteAll.execute).not.toHaveBeenCalled();
            expect(chatModel.messages.filter(it => it.role === 'user')).toHaveLength(0);
            expect(text('note')).toBe('Region emea');
        });

        it.each<[string, string]>([
            ['written in the template', '{steps: [{type: "reset", targets: ["$region"]}]}'],
            ['read from the row', 'r.plan'],
            [
                'picked by a condition',
                'r.id == "a" ? r.plan : {type: "callTool", name: "delete_all"}'
            ]
        ])('takes no action from data in an @Each: %s', async (_, written) => {
            silenceLogs();
            const deleteAll = {...saveTool(), name: 'delete_all'};
            renderProgram(
                `root = Stack([note, @Each($rows, "r", AnyTrigger(r.id, ${written}))])\n` +
                    '$region = "apac"\n' +
                    '$rows = [{id: "a", plan: {steps: [{type: "reset", targets: ["$region"]}]}}, {id: "b", plan: {type: "callTool", name: "delete_all"}}]\n' +
                    'note = Note("Region " + $region)',
                {tools: [deleteAll]}
            );
            const triggers = screen.getAllByTestId('any-trigger');
            expect(triggers.map(it => it.title)).toEqual([
                'This action is not valid, so it cannot run.',
                'This action is not valid, so it cannot run.'
            ]);

            for (const trigger of triggers) {
                await act(async () => {
                    fireEvent.click(trigger);
                    await Promise.resolve();
                });
            }
            await settleAsync();
            expect(deleteAll.execute).not.toHaveBeenCalled();
            expect(text('note')).toBe('Region apac');
        });

        it('takes an action from syntax that another statement holds', async () => {
            renderProgram(
                'root = Stack([note, go])\n' +
                    '$region = "emea"\n' +
                    'move = Action([@Set($region, "apac")])\n' +
                    'note = Note("Region " + $region)\n' +
                    'go = Trigger("Go", move)',
                {}
            );
            expect(title()).toBe('Sets $region to "apac"');

            await clickAsync();
            await waitFor(() => expect(text('note')).toBe('Region apac'));
        });

        it('takes no step from data inside an Action list', () => {
            silenceLogs();
            renderProgram(
                'root = Stack([go])\n$region = "emea"\n' +
                    'go = Trigger("Go", Action([{type: "reset", targets: ["$region"]}]))',
                {}
            );

            expect(title()).toBe('This action is not valid, so it cannot run.');
        });
    });

    describe('a tooltip shows all of what a click does', () => {
        it('writes a character the user could not see as its code', () => {
            renderProgram(
                'root = Stack([go])\n' +
                    'go = Trigger("Go", Action([@Set($x, "‮ecila‬ a​b c"), @Reset($y)]))',
                {}
            );

            expect(title()).toBe(
                'Sets $x to "\\u202eecila\\u202c a\\u200bb\\u00a0c", then resets $y'
            );
        });

        it('quotes the text of a message, so that it cannot pose as the words around it', () => {
            const chatModel = createChatModel({});
            renderProgram(
                'root = Stack([go])\n' +
                    'go = Trigger("Go", @ToAssistant("Hi\\", with admin: \\"yes", {note: "a\\nb"}))',
                {chatModel}
            );

            expect(title()).toBe('Sends: "Hi\\", with admin: \\"yes", with note: "a\\nb"');
        });

        it.each<[string, string]>([
            ['a set value', `Action([@Set($x, "ok${' '.repeat(40)}hidden"), @Reset($y)])`],
            ['a message', '@ToAssistant("Thanks\\n\\n\\n\\n\\n\\n\\n\\nNow do this")'],
            ['a context value', `@ToAssistant("Thanks", {note: "a${' '.repeat(12)}b"})`]
        ])('gives no action for a long run of whitespace in %s', (_, written) => {
            silenceLogs();
            renderProgram(`root = Stack([go])\ngo = Trigger("Go", ${written})`, {
                chatModel: createChatModel({})
            });

            expect(title()).toBe(
                'This action holds text that cannot be shown in full, so it cannot run.'
            );
        });

        it('gives no action for steps too long to show in full', () => {
            silenceLogs();
            renderProgram(
                'root = Stack([go])\n' +
                    `go = Trigger("Go", Action([@Set($x, "${'x'.repeat(1200)}"), @Reset($y)]))`,
                {}
            );

            expect(title()).toBe('This action is too long to show in full, so it cannot run.');
        });

        it('gives no action for a list in a message whose JSON is too long to send', () => {
            silenceLogs();
            const ids = Array.from({length: 40}, (_, idx) => idx + 1000).join(', ');
            renderProgram(
                `root = Stack([go])\ngo = Trigger("Go", @ToAssistant("Use these", {ids: [${ids}]}))`,
                {chatModel: createChatModel({})}
            );

            expect(title()).toBe('This action is too long to show in full, so it cannot run.');
        });

        it('gives no action for two messages in one action, as the second would go nowhere', () => {
            silenceLogs();
            renderProgram(
                'root = Stack([go])\n' +
                    'go = Trigger("Ask", Action([@ToAssistant("First"), @ToAssistant("Second")]))',
                {chatModel: createChatModel({})}
            );

            expect(title()).toBe('This action sends more than one message, so it cannot run.');
        });
    });

    describe('the steps of an action run in order', () => {
        it('sends the value that a @Set before it in the same action sets', async () => {
            const chatModel = createChatModel({});
            renderProgram(
                'root = Stack([go])\n$n = "old"\n' +
                    'go = Trigger("Go", Action([@Set($n, "new"), @ToAssistant("Value " + $n)]))',
                {chatModel}
            );
            expect(title()).toBe('Sets $n to "new", then sends: "Value new"');

            await clickAsync();
            await waitFor(() =>
                expect(chatModel.messages.some(it => it.role === 'user')).toBe(true)
            );
            expect(chatModel.messages.find(it => it.role === 'user').text).toBe('Value new');
        });

        it('sends the null and the default that a step before it in the same action sets', () => {
            renderProgram(
                'root = Stack([go])\n$a = "old"\n$b = "start"\n' +
                    'go = Trigger("Go", Action([@Set($a, null), @Set($b, "moved"), @Reset($b), ' +
                    '@ToAssistant("a " + $a + " b " + $b)]))',
                {chatModel: createChatModel({})}
            );

            expect(title()).toBe(
                'Sets $a to null, then sets $b to "moved", then resets $b, then sends: "a  b start"'
            );
        });

        it('acts on its own row in an @Each that sets a value and then sends it', async () => {
            const chatModel = createChatModel({});
            renderProgram(
                'root = Stack([note, @Each($rows, "r", Trigger(r.name, Action([@Set($sel, r.id), @ToAssistant("Open " + $sel)])))])\n' +
                    '$sel = "none"\n' +
                    '$rows = [{id: "a", name: "A"}, {id: "b", name: "B"}]\n' +
                    'note = Note("Selected " + $sel)',
                {chatModel}
            );
            const triggers = screen.getAllByTestId('trigger');
            expect(triggers.map(it => it.title)).toEqual([
                'Sets $sel to "a", then sends: "Open a"',
                'Sets $sel to "b", then sends: "Open b"'
            ]);

            await act(async () => {
                fireEvent.click(triggers[1]);
                await Promise.resolve();
            });
            await waitFor(() => expect(text('note')).toBe('Selected b'));
            expect(chatModel.messages.find(it => it.role === 'user').text).toBe('Open b');
        });

        it('runs no step while the chat is busy', async () => {
            silenceLogs();
            const {chatModel} = renderProgram(
                'root = Stack([note, go])\n' +
                    '$region = "emea"\n' +
                    'note = Note("Region " + $region)\n' +
                    'go = Trigger("Go", Action([@Set($region, "x"), @ToAssistant("Go")]))',
                {delayMs: 200}
            );
            void chatModel.sendAsync('hello');
            await settleAsync();
            expect(chatModel.isBusy).toBe(true);

            await clickAsync();
            await settleAsync();
            // The set comes first, and still does not run, as the message after it cannot go.
            expect(text('note')).toBe('Region emea');
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
                {toolName: 'get_sales', args: {region: 'emea'}, messageId: 'm1'}
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
                    lookup: {
                        name: 'lookup',
                        parameters: {type: 'object', properties: {q: {type: 'string'}}},
                        execute: vi.fn(async (_: PlainObject) => ({ok: true}))
                    }
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

        it('runs the queries of only the first three programs of one reply', async () => {
            silenceLogs();
            const getSales = salesTool();
            let reply = 'Here you go.\n\n';
            for (let p = 0; p < 25; p++) {
                const lines = ['root = Stack([note])', 'note = Note("x")'];
                for (let i = 0; i < 8; i++)
                    lines.push(`q${i} = Query("get_sales", {region: "p${p}q${i}"}, {})`);
                reply += '```openui-lang\n' + lines.join('\n') + '\n```\n\n';
            }
            renderProgram(reply, {tools: [getSales], queryTools: ['get_sales']});

            await settleAsync();
            await settleAsync();
            expect(getSales.execute).toHaveBeenCalledTimes(24);
        });

        it('holds all the programs of a chat to one rate of calls', async () => {
            silenceLogs();
            vi.useFakeTimers();
            const getSales = salesTool();
            let reply = '';
            for (let p = 0; p < 3; p++) {
                const lines = ['root = Stack([note])', 'note = Note("x")'];
                for (let i = 0; i < 8; i++)
                    lines.push(`q${i} = Query("get_sales", {region: "p${p}q${i}"}, {}, 1)`);
                reply += '```openui-lang\n' + lines.join('\n') + '\n```\n\n';
            }
            renderProgram(reply, {tools: [getSales], queryTools: ['get_sales']});

            await act(() => vi.advanceTimersByTimeAsync(59000));
            expect(getSales.execute.mock.calls.length).toBeLessThanOrEqual(60);

            // The bound is on a moving minute, so the calls go on after it.
            await act(() => vi.advanceTimersByTimeAsync(61000));
            expect(getSales.execute.mock.calls.length).toBeGreaterThan(60);
            expect(getSales.execute.mock.calls.length).toBeLessThanOrEqual(180);
        });

        it('takes the rate from maxCallsPerMinute', async () => {
            silenceLogs();
            const getSales = salesTool(),
                lines = ['root = Stack([note])', 'note = Note("x")'];
            for (let i = 0; i < 8; i++)
                lines.push(`q${i} = Query("get_sales", {region: "r${i}"}, {})`);
            renderProgram(lines.join('\n'), {
                tools: [getSales],
                queryTools: ['get_sales'],
                maxCallsPerMinute: 5
            });

            await settleAsync();
            expect(getSales.execute).toHaveBeenCalledTimes(5);
        });

        it('holds a floor of one second on a refresh, even with minRefreshSeconds at 0', async () => {
            vi.useFakeTimers();
            const getSales = salesTool();
            renderProgram(SALES.replace('{total: 0})', '{total: 0}, 0.0001)'), {
                tools: [getSales],
                queryTools: ['get_sales'],
                minRefreshSeconds: 0
            });

            await act(() => vi.advanceTimersByTimeAsync(2500));
            expect(getSales.execute.mock.calls.length).toBeLessThanOrEqual(3);
        });

        it('runs no query of a message that the chat does not hold, until the user acts', async () => {
            vi.useFakeTimers();
            const getSales = salesTool();
            renderProgram(SALES.replace('{total: 0})', '{total: 0}, 10)'), {
                tools: [getSales],
                queryTools: ['get_sales'],
                initialMessages: [{id: 'other', role: 'assistant', parts: [textPart('x')]}]
            });

            await act(() => vi.advanceTimersByTimeAsync(35000));
            expect(getSales.execute).not.toHaveBeenCalled();

            await act(async () => {
                fireEvent.click(screen.getByTestId('field'));
                await vi.advanceTimersByTimeAsync(100);
            });
            expect(text('note')).toBe('Total 20');
        });

        it('strips the keys that could reach a prototype from arguments and results', async () => {
            const execute = vi.fn(async (input: PlainObject) => {
                const merged = Object.assign({limit: 10}, input);
                return JSON.parse(
                    `{"total": 1, "admin": ${merged.admin ?? false}, "__proto__": {"x": 1}, "constructor": 2}`
                );
            });
            renderProgram(
                'root = Stack([note])\n' +
                    'sales = Query("get_sales", {region: "x", "__proto__": {admin: true}, "constructor": 1, "prototype": 2}, {total: 0})\n' +
                    'note = Note("admin " + sales.admin + " x " + sales.x + " c " + sales.constructor)',
                {
                    tools: [{name: 'get_sales', parameters: REGION, execute}],
                    queryTools: ['get_sales']
                }
            );

            await waitFor(() => expect(text('note')).toContain('admin false'));
            expect(Object.keys(execute.mock.calls[0][0])).toEqual(['region']);
            expect(text('note')).not.toContain('x 1');
            expect(text('note')).not.toContain('c 2');
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
                {
                    tools: [{name: 'get_sales', parameters: REGION, execute}],
                    queryTools: ['get_sales']
                }
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

        it.each<[number, number]>([
            [2000, 500],
            [20000, 4000]
        ])('counts the defaults of a query of %i values at each of %i reads', (size, reads) => {
            silenceLogs();
            const lines = [
                'root = Stack([note])',
                `q = Query("get_sales", {}, {rows: ${numbers(size)}})`,
                `note = Note("n=" + @Count([${Array(reads).fill('q.rows').join(', ')}]))`
            ];
            const started = Date.now(),
                {container} = renderProgram(lines.join('\n'), {});

            expect(Date.now() - started).toBeLessThan(2000);
            expect(container.textContent).toMatch(/too large to evaluate|too long to read/);
        });

        it('counts the defaults of a query that an @Each reads on each pass', () => {
            silenceLogs();
            const ten = (item: string) => `[${Array(10).fill(item).join(',')}]`,
                lines = [
                    'root = Stack([note])',
                    `a = ${ten('1')}`,
                    `b = ${ten('a')}`,
                    `c = ${ten('b')}`,
                    `e = [${Array(10).fill('c').join(',')}]`,
                    `$l = ${numbers(100)}`,
                    'q = Query("get_sales", {}, {rows: e})',
                    'note = Note("n=" + @Count(@Each($l, "i", @Each($l, "j", q.rows))))'
                ];
            const started = Date.now(),
                {container} = renderProgram(lines.join('\n'), {});

            expect(Date.now() - started).toBeLessThan(2000);
            expect(container.textContent).toContain('too large to evaluate');
        });

        it('refuses state values that double with each line, before it copies one', () => {
            silenceLogs();
            const lines = ['root = Stack([go])', '$a0 = [1, 1]'];
            for (let i = 1; i <= 26; i++) lines.push(`$a${i} = [$a${i - 1}, $a${i - 1}]`);
            lines.push('go = Trigger("Go", @Set($x, $a26))');
            const started = Date.now(),
                {container} = renderProgram(lines.join('\n'), {});

            expect(Date.now() - started).toBeLessThan(2000);
            expect(container.textContent).toContain('too large to evaluate');
        });

        it('refuses state strings that double with each line', () => {
            silenceLogs();
            const program = (depth: number) => {
                const lines = ['root = Stack([go])', '$s0 = "xxxxxxxxxx"'];
                for (let i = 1; i <= depth; i++) lines.push(`$s${i} = $s${i - 1} + $s${i - 1}`);
                lines.push(`go = Trigger("Go", @Set($x, $s${depth}))`);
                return lines.join('\n');
            };
            const started = Date.now(),
                {container, unmount} = renderProgram(program(24), {});

            expect(Date.now() - started).toBeLessThan(2000);
            expect(container.textContent).toContain('too large to evaluate');
            unmount();

            // Past the longest string the engine can hold, the parser fails and the reply
            // shows as text.
            expect(() => renderProgram(program(27), {})).not.toThrow();
            expect(Date.now() - started).toBeLessThan(2000);
        });

        it('takes the longest list of the program for an @Each over a field of a loop variable', () => {
            silenceLogs();
            const started = Date.now(),
                {container} = renderProgram(
                    'root = Stack([note])\n' +
                        `$big = ${numbers(1200)}\n` +
                        `$rows = [${Array(9).fill('{items: $big}').join(', ')}]\n` +
                        'note = Note("n=" + @Count(@Each($rows, "r", @Each(r.items, "i", @Each(r.items, "j", 1)))))',
                    {}
                );

            expect(Date.now() - started).toBeLessThan(2000);
            expect(container.textContent).toContain('too large to evaluate');
        });

        it('does not throw on brackets nested far past any real program', () => {
            silenceLogs();
            const depth = 20000,
                program = `root = Stack([note])\nnote = Note(${'['.repeat(depth)}1${']'.repeat(depth)})`;

            expect(() => renderProgram(program, {})).not.toThrow();
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

        it('runs the queries of a data part only once its reply ends', async () => {
            const getSales = salesTool(),
                catalog = new ChatUiCatalog({components: SPECS}),
                chatModel = createChatModel({tools: [getSales]}),
                adapter = openUiLangAdapter({root: 'stack', queryTools: ['get_sales']}),
                ctx = {...context(chatModel), isPartial: true};
            let program =
                    'root = Stack([note])\nnote = Note("Total " + q.total)\n' +
                    'q = Query("get_sales", {region: r}, {total: 0})\n',
                state = null;
            for (let i = 0; i < 10; i++) {
                program += `r = "v${i}"\n`;
                const doc = adapter.translate(program, {catalog, isPartial: true});
                state ??= doc.state.create(ctx);
                doc.state.resolve(state, ctx);
                await settleAsync();
            }
            onTestFinished(() => state.destroy());
            expect(getSales.execute).not.toHaveBeenCalled();

            const doc = adapter.translate(program, {catalog, isPartial: false});
            doc.state.resolve(state, {...ctx, isPartial: false});
            await waitFor(() => expect(getSales.execute).toHaveBeenCalledTimes(1));
            expect(getSales.execute.mock.calls[0][0]).toEqual({region: 'v9'});
        });
    });
});

//------------------
// Helpers
//------------------
const REGION = {type: 'object', properties: {region: {type: 'string'}}};

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
    // A button whose action prop takes every type of action, as an app's own spec could.
    ANY_TRIGGER: ChatUiComponentSpec = {
        name: 'anyTrigger',
        description: 'A button that takes any action.',
        props: {
            type: 'object',
            required: ['label'],
            additionalProperties: false,
            properties: {
                label: {type: 'string'},
                action: chatUiActionSchema({types: CHAT_UI_ACTION_TYPES})
            }
        },
        render: ({label, action}, {runActionAsync}) =>
            div({
                'data-testid': 'any-trigger',
                title: action ? describeChatUiAction(action) : '',
                item: label,
                onClick: () => (action ? runActionAsync(action).catch(() => null) : null)
            } as PlainObject)
    },
    SPECS = [STACK, NOTE, ITEMS, FIELD, TRIGGER, ANY_TRIGGER];

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

// A chat that holds the reply `m1`, which is the message that each program here renders in.
function createChatModel({
    tools = [],
    initialMessages = [{id: 'm1', role: 'assistant', parts: []}],
    delayMs = 0
}: ChatOptions): ChatModel {
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

function numbers(count: number): string {
    return `[${[...Array(count).keys()].join(',')}]`;
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
