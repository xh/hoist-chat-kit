import {initTestAppAsync} from '@xh/hoist/test-support';
import {beforeAll, describe, expect, it, onTestFinished} from 'vitest';
import {ScriptedChatTransport} from '../../../../transport';
import {
    CHAT_SUBAGENT_DATA_TYPE,
    type ChatActivitySpec,
    type ChatDataPart,
    ChatModel,
    type ChatPart,
    type ChatToolCallPart,
    type ChatToolCallState,
    type ChatToolSpec
} from '../../../../core';
import {
    type ChatProcessRun,
    type ChatTimelineGroup,
    getActivityDisplay,
    getToolCallDisplay,
    groupParts,
    groupProcessRuns
} from './groupParts';

/**
 * groupParts decides what an assistant message shows as one row. Apps rely on it to fold runs of
 * tool calls into a quiet "Used 3 tools" row, while calls that need the user stay in view.
 */
describe('groupParts', () => {
    beforeAll(() => initTestAppAsync());

    it('folds two or more consecutive tool calls of one step into a group', () => {
        const parts = [text('t1'), call('c1'), call('c2'), call('c3'), text('t2')],
            groups = groupParts(parts, chatModel());

        expect(groups.map(it => it.type)).toEqual(['text', 'toolCallGroup', 'text']);
        expect(groups[1]).toMatchObject({id: 'tools-c1', parts: [parts[1], parts[2], parts[3]]});
    });

    it('leaves a single tool call ungrouped', () => {
        expect(groupParts([text('t1'), call('c1'), text('t2')], chatModel())[1]).toMatchObject({
            type: 'toolCall',
            id: 'c1'
        });
    });

    it('starts a new group at a change of step', () => {
        const groups = groupParts(
            [
                call('c1', {step: 0}),
                call('c2', {step: 0}),
                call('c3', {step: 1}),
                call('c4', {step: 1})
            ],
            chatModel()
        );
        expect(groups.map(it => it.id)).toEqual(['tools-c1', 'tools-c3']);
    });

    it('keeps calls that wait for approval or an answer out of groups', () => {
        const groups = groupParts(
            [
                call('c1'),
                call('c2', {state: 'approval-requested'}),
                call('c3'),
                call('c4', {toolName: 'ask', state: 'input-available'}),
                call('c5')
            ],
            chatModel([{name: 'ask', interactive: true, renderer: () => null}])
        );
        expect(groups.map(it => it.id)).toEqual(['c1', 'c2', 'c3', 'c4', 'c5']);
    });

    it('groups calls that are still running', () => {
        const groups = groupParts([call('c1'), call('c2', {state: 'running'})], chatModel());
        expect(groups[0].type).toBe('toolCallGroup');
    });

    it('keeps inline calls out of groups', () => {
        const groups = groupParts(
            [call('c1'), call('c2', {toolName: 'show_chart'}), call('c3')],
            chatModel([{name: 'show_chart', display: 'inline', renderer: () => null}])
        );
        expect(groups.map(it => it.id)).toEqual(['c1', 'c2', 'c3']);
    });

    it('groups consecutive files and leaves out sources', () => {
        const groups = groupParts(
            [
                {type: 'file', id: 'f1', name: 'a.png', mediaType: 'image/png'},
                {type: 'file', id: 'f2', name: 'b.png', mediaType: 'image/png'},
                {type: 'source', id: 's1', url: 'https://xh.io'},
                text('t1')
            ],
            chatModel()
        );
        expect(groups.map(it => it.type)).toEqual(['fileGroup', 'text']);
        expect(groups[0]).toMatchObject({id: 'files-f1'});
    });

    it('leaves out reasoning with no text to show', () => {
        const groups = groupParts([reasoning('r1', ''), text('t1')], chatModel());
        expect(groups.map(it => it.id)).toEqual(['t1']);
    });
});

/**
 * groupProcessRuns gathers a reply's steps into process blocks, which stack tighter than its
 * output. Users rely on a reply's steps reading as one block, split only by text between them.
 */
describe('groupProcessRuns', () => {
    beforeAll(() => initTestAppAsync());

    it('gathers consecutive reasoning, tool rows and tool groups into one run', () => {
        const host = chatModel(),
            runs = groupProcessRuns(
                groupParts(
                    [reasoning('r1'), call('c1'), call('c2', {step: 1}), call('c3', {step: 1})],
                    host
                ),
                host
            );

        expect(runs).toHaveLength(1);
        expect(runs[0]).toMatchObject({type: 'process', id: 'process-r1'});
        expect((runs[0] as ChatProcessRun).groups.map(it => it.id)).toEqual([
            'r1',
            'c1',
            'tools-c2'
        ]);
    });

    it('starts a new run after text, and leaves inline calls as output', () => {
        const host = chatModel([{name: 'show_chart', display: 'inline', renderer: () => null}]),
            runs = groupProcessRuns(
                groupParts(
                    [
                        call('c1'),
                        text('t1'),
                        call('c2', {step: 1}),
                        call('c3', {step: 2, toolName: 'show_chart'})
                    ],
                    host
                ),
                host
            );

        expect(runs.map(it => it.type)).toEqual(['process', 'text', 'process', 'toolCall']);
    });
});

/**
 * How a reply chooses between P1 process rows and the activity timeline (H6). Apps rely on the
 * `display` of each tool deciding it: `timeline` calls gather into one block with the narration
 * between them, and `card` calls and reasoning alone keep their rows.
 */
describe('groupParts by display mode', () => {
    beforeAll(() => initTestAppAsync());

    const tools: ChatToolSpec[] = [
        {name: 'step', display: 'timeline'},
        {name: 'secret', display: 'hidden'},
        {name: 'final', display: 'inline'},
        {name: 'ask', interactive: true, display: 'hidden', renderer: () => null}
    ];

    it('gathers timeline calls, and the narration between them, into one block', () => {
        const groups = groupParts(
            [
                call('c1', {toolName: 'step'}),
                text('t1'),
                call('c2', {toolName: 'step'}),
                reasoning('r1'),
                call('c3', {toolName: 'step', step: 1}),
                text('answer')
            ],
            chatModel(tools)
        );

        expect(groups.map(it => it.type)).toEqual(['timeline', 'text']);
        expect(groups[0]).toMatchObject({type: 'timeline', id: 'timeline-c1'});
        expect((groups[0] as ChatTimelineGroup).parts.map(it => it.id)).toEqual([
            'c1',
            't1',
            'c2',
            'r1',
            'c3'
        ]);
    });

    it('folds text into the block only once another timeline call follows it', () => {
        const host = chatModel(tools),
            streaming = groupParts([call('c1', {toolName: 'step'}), text('t1')], host),
            folded = groupParts(
                [call('c1', {toolName: 'step'}), text('t1'), call('c2', {toolName: 'step'})],
                host
            );

        expect(streaming.map(it => it.id)).toEqual(['timeline-c1', 't1']);
        expect(folded.map(it => it.id)).toEqual(['timeline-c1']);
    });

    it('keeps the block id from its first call, as text before it folds in', () => {
        const groups = groupParts(
            [text('t0'), call('c1', {toolName: 'step'}), text('answer')],
            chatModel(tools)
        );
        expect(groups.map(it => it.id)).toEqual(['timeline-c1', 'answer']);
        expect((groups[0] as ChatTimelineGroup).parts.map(it => it.id)).toEqual(['t0', 'c1']);
    });

    it('keeps card calls and reasoning alone as process rows', () => {
        const host = chatModel(tools),
            runs = groupProcessRuns(
                groupParts([reasoning('r1'), call('c1'), call('c2'), text('t1')], host),
                host
            );
        expect(runs.map(it => it.type)).toEqual(['process', 'text']);
    });

    it('ends a block at a card call, which keeps its row', () => {
        const groups = groupParts(
            [call('c1', {toolName: 'step'}), call('c2'), call('c3', {toolName: 'step'})],
            chatModel(tools)
        );
        expect(groups.map(it => it.id)).toEqual(['timeline-c1', 'c2', 'timeline-c3']);
    });

    it('leaves out hidden calls, unless one waits for the user', () => {
        const groups = groupParts(
            [
                call('c1', {toolName: 'secret'}),
                call('c2', {toolName: 'ask', state: 'input-available'}),
                text('t1')
            ],
            chatModel(tools)
        );
        expect(groups.map(it => it.id)).toEqual(['c2', 't1']);
    });

    it('treats inline calls as output, not process', () => {
        const host = chatModel(tools),
            runs = groupProcessRuns(
                groupParts([call('c1'), call('c2', {toolName: 'final', step: 1})], host),
                host
            );
        expect(runs.map(it => it.type)).toEqual(['process', 'toolCall']);
    });

    it('puts sub-agents, and the calls they make, in the block', () => {
        const groups = groupParts(
            [
                {
                    type: 'data',
                    id: 'agent1',
                    dataType: CHAT_SUBAGENT_DATA_TYPE,
                    data: {name: 'Checker', status: 'running'}
                },
                {...call('c1'), subagentRunId: 'agent1'},
                text('answer')
            ],
            chatModel(tools)
        );
        expect(groups.map(it => it.id)).toEqual(['timeline-agent1', 'answer']);
        expect(getToolCallDisplay({...call('c1'), subagentRunId: 'agent1'}, chatModel())).toBe(
            'timeline'
        );
    });

    const activities: ChatActivitySpec[] = [
        {dataType: 'skill', display: 'timeline'},
        {dataType: 'trace', display: 'hidden'}
    ];

    it('gathers timeline activities into the block, as peers of the calls', () => {
        const groups = groupParts(
            [
                data('s1', 'skill'),
                text('t1'),
                call('c1', {toolName: 'step'}),
                data('s2', 'skill'),
                text('answer')
            ],
            chatModel(tools, activities)
        );
        expect(groups.map(it => it.id)).toEqual(['timeline-s1', 'answer']);
        expect((groups[0] as ChatTimelineGroup).parts.map(it => it.id)).toEqual([
            's1',
            't1',
            'c1',
            's2'
        ]);
    });

    it('shows a data part inline with no spec, even from a sub-agent, and hides hidden ones', () => {
        const host = chatModel(tools, activities);
        expect(getActivityDisplay(data('d1', 'chart'), host)).toBe('inline');
        // A sub-agent's form or card stays in the reply, never in a closed row.
        expect(getActivityDisplay({...data('d2', 'chart'), subagentRunId: 'a1'}, host)).toBe(
            'inline'
        );
        expect(groupParts([data('d3', 'trace'), text('t1')], host).map(it => it.id)).toEqual([
            't1'
        ]);
    });

    it('reads activity specs from a plain transcript', () => {
        const transcript = {
                messages: [],
                getActivitySpec: (dataType: string) =>
                    activities.find(it => it.dataType === dataType) ?? null
            },
            groups = groupParts([data('s1', 'skill'), data('d1', 'chart')], transcript);
        expect(groups.map(it => it.id)).toEqual(['timeline-s1', 'd1']);
    });
});

//------------------
// Helpers
//------------------
function chatModel(tools: ChatToolSpec[] = [], activities: ChatActivitySpec[] = []): ChatModel {
    const ret = new ChatModel({transport: new ScriptedChatTransport(), tools, activities});
    onTestFinished(() => ret.destroy());
    return ret;
}

function reasoning(id: string, content: string = 'Thinking it over.'): ChatPart {
    return {type: 'reasoning', id, text: content, state: 'done', startedAt: 0, endedAt: 10};
}

function data(id: string, dataType: string): ChatDataPart {
    return {type: 'data', id, dataType, data: {id}};
}

function text(id: string): ChatPart {
    return {type: 'text', id, text: id, state: 'done'};
}

function call(
    id: string,
    {
        toolName = 'lookup',
        state = 'output-available',
        step = 0
    }: {toolName?: string; state?: ChatToolCallState; step?: number} = {}
): ChatToolCallPart {
    return {
        type: 'toolCall',
        id,
        toolName,
        state,
        step,
        inputText: '{}',
        input: {},
        output: null,
        errorText: null
    };
}
