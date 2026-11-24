import {describe, expect, it} from 'vitest';
import {ChatMessage, type ChatContextProvider} from '../../core';
import type {Blueprint} from '../../blueprint';
import {
    architectConversationRecord,
    architectTurnRecord,
    ArchitectTurnCapture,
    hashText
} from './architectRecord';
import {architectHarnessScenario, architectRecordMarkdown} from './architectRecordFormats';

const T = Date.UTC(2026, 10, 24, 9, 0, 0),
    HOST: Blueprint = {
        schema: {blueprint: 1},
        root: 'grid',
        elements: {grid: {component: 'cubeGrid', config: {source: 'positions'}}}
    } as Blueprint;

const call = (id: string, toolName: string, input: object, end: object, at: number) =>
    ({
        id,
        type: 'toolCall',
        toolName,
        state: 'done',
        inputText: JSON.stringify(input),
        input,
        output: null,
        errorText: null,
        startedAt: at,
        endedAt: at + 40,
        ...end
    }) as any;

/** A recorded conversation: a turn that queries, edits, is refused once and answers, then another. */
function conversation(): ChatMessage[] {
    const rows = Array.from({length: 12}, (_, i) => ({symbol: `S${i}`, pnlDay: i}));
    return [
        new ChatMessage({
            id: 'u1',
            role: 'user',
            content: 'Add a chart of P&L by sector.',
            createdAt: T
        }),
        new ChatMessage({
            id: 'a1',
            role: 'assistant',
            createdAt: T + 10,
            metadata: {
                model: 'claude-sonnet-5-5',
                usage: [
                    {
                        model: 'claude-sonnet-5-5',
                        inputTokens: 1000,
                        outputTokens: 50,
                        cachedInputTokens: 800
                    },
                    {
                        model: 'claude-sonnet-5-5',
                        inputTokens: 1200,
                        outputTokens: 70,
                        cachedInputTokens: 900
                    }
                ]
            },
            parts: [
                {id: 't1', type: 'text', text: 'Looking at the data first.', state: 'done'} as any,
                call(
                    'c1',
                    'query_dataset',
                    {dataset: 'positions'},
                    {output: {rows, totalRows: 12}},
                    T + 100
                ),
                call(
                    'c2',
                    'edit_blueprint',
                    {
                        description: 'Add a sector chart',
                        ops: [{op: 'set', path: '/elements/chart', value: {}}]
                    },
                    {output: {applied: true, version: 4, warnings: []}},
                    T + 200
                ),
                call(
                    'c3',
                    'edit_blueprint',
                    {
                        description: 'Retitle',
                        ops: [{op: 'set', path: '/elements/grid/config/title', value: 'P'}]
                    },
                    {
                        state: 'error',
                        errorText: JSON.stringify({
                            applied: false,
                            version: 4,
                            issues: [
                                {
                                    code: 'edit.notAllowed',
                                    severity: 'error',
                                    path: '',
                                    message: 'run mode'
                                }
                            ]
                        })
                    },
                    T + 300
                ),
                call(
                    'c4',
                    'show_ui',
                    {root: 'answer', elements: {}},
                    {output: {shown: true}},
                    T + 400
                ),
                {id: 't2', type: 'text', text: 'Added the chart.', state: 'done'} as any
            ]
        }),
        new ChatMessage({id: 'u2', role: 'user', content: 'Thanks.', createdAt: T + 1000}),
        new ChatMessage({
            id: 'a2',
            role: 'assistant',
            createdAt: T + 1010,
            content: "You're welcome."
        })
    ];
}

async function captured() {
    const capture = new ArchitectTurnCapture({
            blueprintOf: () => ({blueprint: HOST, id: 'bp7', type: 'dashboard', name: 'Risk'})
        }),
        providers: ChatContextProvider[] = [
            {name: 'blueprint', getContext: () => ({version: 3, mode: 'design', access: 'write'})},
            {
                name: 'ui_context',
                getContext: () => ({mode: 'design', selection: {kind: 'element', id: 'grid'}})
            }
        ],
        wrapped = capture.wrap(providers);
    for (const step of [0, 1]) {
        for (const it of wrapped) await it.getContext({turnId: 'u1', stepIndex: step} as any);
    }
    return capture;
}

describe('Architect records', () => {
    it('records a turn: its prompt, context, tool calls, edits and refusals, answers, reply and usage', async () => {
        const capture = await captured(),
            record = architectTurnRecord('u1', {
                messages: conversation(),
                contextOf: id => capture.get(id),
                systemPrompt: 'You are the Architect.',
                effort: 'medium',
                maxRows: 5
            });
        expect(record).toMatchObject({
            kind: 'architectTurn',
            turnId: 'u1',
            prompt: 'Add a chart of P&L by sector.',
            model: 'claude-sonnet-5-5',
            effort: 'medium',
            status: 'complete',
            text: 'Looking at the data first.\n\nAdded the chart.',
            context: {
                blueprint: {id: 'bp7', type: 'dashboard', name: 'Risk', version: 3},
                mode: 'design',
                access: 'write',
                uiContext: {selection: {id: 'grid'}},
                systemPrompt: {hash: hashText('You are the Architect.'), length: 22}
            },
            usage: {inputTokens: 2200, outputTokens: 120, cachedInputTokens: 1700},
            answers: [{root: 'answer'}],
            blueprintBefore: HOST
        });
        expect(record.context.systemPrompt).not.toHaveProperty('text');
        expect(record.toolCalls.map(it => [it.name, it.durationMs])).toEqual([
            ['query_dataset', 40],
            ['edit_blueprint', 40],
            ['edit_blueprint', 40],
            ['show_ui', 40]
        ]);
        // Data rows are cut, and the record says so.
        expect(record.toolCalls[0]).toMatchObject({truncated: true, totalRows: {'/rows': 12}});
        expect((record.toolCalls[0].result as any).rows).toHaveLength(5);
        expect(record.redacted).toMatch(/first 5 rows/);
        expect(record.edits).toEqual([
            {
                description: 'Add a sector chart',
                ops: [{op: 'set', path: '/elements/chart', value: {}}],
                applied: true,
                issues: [],
                refusal: null,
                versionAfter: 4
            },
            expect.objectContaining({applied: false, refusal: 'edit.notAllowed', versionAfter: 4})
        ]);
    });

    it('keeps only what a turn was sent at its first step, and nothing for an untracked turn', async () => {
        const capture = await captured();
        expect(capture.get('u1').providers).toEqual({
            blueprint: {version: 3, mode: 'design', access: 'write'},
            ui_context: {mode: 'design', selection: {kind: 'element', id: 'grid'}}
        });
        expect(capture.get('u2')).toBeNull();
    });

    it('adds the full system prompt and the app usage on request', () => {
        const record = architectTurnRecord('u2', {
            messages: conversation(),
            systemPrompt: 'You are the Architect.',
            includeSystemPrompt: true,
            usageOf: () => ({cost: 0.012})
        });
        expect(record.context.systemPrompt.text).toBe('You are the Architect.');
        expect(record).toMatchObject({
            text: "You're welcome.",
            usage: {cost: 0.012},
            redacted: null
        });
    });

    it('records a whole conversation turn by turn', () => {
        const record = architectConversationRecord({messages: conversation(), now: T + 5000});
        expect(record.exportedAt).toBe(new Date(T + 5000).toISOString());
        expect(record.turns.map(it => it.prompt)).toEqual([
            'Add a chart of P&L by sector.',
            'Thanks.'
        ]);
    });

    it('reads as Markdown, a turn or the conversation', async () => {
        const capture = await captured(),
            opts = {messages: conversation(), contextOf: (id: string) => capture.get(id)},
            turn = architectRecordMarkdown(architectTurnRecord('u1', opts)),
            whole = architectRecordMarkdown(architectConversationRecord(opts));
        expect(turn).toMatch(/^## Turn 1/);
        expect(turn).toContain('> Add a chart of P&L by sector.');
        expect(turn).toContain('1. `query_dataset` (40 ms)');
        expect(turn).toContain('- Refused (edit.notAllowed): Retitle, 1 op, version 4');
        expect(turn).toContain('### Reply\n\nLooking at the data first.');
        expect(whole).toMatch(/^# Conversation with the Architect/);
        expect(whole).toContain('## Turn 2');
    });

    it('turns a turn into a harness scenario, with its host and its checks left to a person', async () => {
        const capture = await captured(),
            record = architectTurnRecord('u1', {
                messages: conversation(),
                contextOf: id => capture.get(id)
            }),
            {scenario, host, source} = architectHarnessScenario(record, {id: 'P30'});
        expect(scenario).toEqual({
            id: 'P30',
            title: 'Add a chart of P&L by sector.',
            host: 'p30-host.json',
            context:
                'Mode: design. The user has write access. They are editing the host blueprint below.',
            uiContext: {mode: 'design', selection: {kind: 'element', id: 'grid'}},
            steps: [{prompt: 'Add a chart of P&L by sector.'}],
            checks: []
        });
        expect(host).toEqual(HOST);
        expect(source).toContain('id: "P30"');
        expect(source).toContain('// TODO: what this turn should do');
    });

    it('cuts only data rows, leaving what the model read of the blueprint, registry and catalog whole', () => {
        const objs = (n: number) => Array.from({length: n}, (_, i) => ({id: `x${i}`})),
            messages = [
                new ChatMessage({id: 'u1', role: 'user', content: 'Look.', createdAt: T}),
                new ChatMessage({
                    id: 'a1',
                    role: 'assistant',
                    createdAt: T + 10,
                    parts: [
                        call(
                            'c1',
                            'read_blueprint',
                            {paths: ['/elements/dashboard/children']},
                            {
                                output: {
                                    version: 3,
                                    parts: {'/elements/dashboard/children': objs(6)}
                                }
                            },
                            T
                        ),
                        call(
                            'c2',
                            'describe_catalog',
                            {dataset: 'positions'},
                            {output: {fields: objs(42)}},
                            T
                        ),
                        call(
                            'c3',
                            'query_dataset',
                            {dataset: 'positions'},
                            {
                                output: {
                                    rows: objs(12),
                                    text: objs(12),
                                    byPath: {'/a~b': {rows: objs(7)}}
                                }
                            },
                            T
                        )
                    ]
                })
            ],
            [readCall, catalogCall, queryCall] = architectTurnRecord('u1', {messages}).toolCalls;
        expect(readCall).toMatchObject({
            truncated: false,
            result: {parts: {'/elements/dashboard/children': objs(6)}}
        });
        expect((catalogCall.result as any).fields).toHaveLength(42);
        expect(catalogCall.truncated).toBe(false);
        expect(queryCall.totalRows).toEqual({'/rows': 12, '/text': 12, '/byPath/~1a~0b/rows': 7});
    });

    it('reads a later turn as Markdown under its own number, its cache writes, and long results folded', async () => {
        const capture = await captured(),
            messages = conversation(),
            reply = messages[1];
        (reply.metadata.usage as any[])[0].cacheWriteInputTokens = 300;
        reply.parts.push(
            call(
                'c5',
                'describe_catalog',
                {},
                {output: {fields: Array.from({length: 30}, (_, i) => ({name: `f${i}`}))}},
                T
            )
        );
        const first = architectRecordMarkdown(
                architectTurnRecord('u1', {messages, contextOf: id => capture.get(id)})
            ),
            second = architectRecordMarkdown(architectTurnRecord('u2', {messages}));
        expect(second).toMatch(/^## Turn 2/);
        expect(first).toContain('300 cache writes');
        expect(first).toMatch(/<details>\n<summary>Result, \d+ lines<\/summary>/);
        expect(first).toMatch(/\d+ more lines in the JSON record/);
    });
});
