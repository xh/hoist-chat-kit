import {initTestAppAsync} from '@xh/hoist/test-support';
import {beforeAll, describe, expect, it, onTestFinished} from 'vitest';
import {ScriptedChatTransport} from '../../../../transport';
import {
    CHAT_SUBAGENT_DATA_TYPE,
    ChatMessage,
    ChatModel,
    type ChatPart,
    type ChatToolCallPart,
    type ChatToolCallState,
    type ChatToolSpec
} from '../../../../core';
import {
    buildTimelineItems,
    type ChatTimelineAgentItem,
    type ChatTimelineBatchItem,
    type ChatTimelineCallItem,
    formatStepDuration,
    getTimelineState,
    parsePlan,
    summarizeInput,
    summarizeTimeline
} from './ChatTimelineItems';

/**
 * The rows and the one-line summary of an activity timeline. Users rely on twenty calls reading
 * as a few rows - batches, sub-agents - and on the line counting failures as warnings, with
 * "retried" once a retry succeeded.
 */
describe('ChatTimelineItems', () => {
    beforeAll(() => initTestAppAsync());

    it('merges three or more consecutive calls of one tool into a batch', () => {
        const items = buildTimelineItems(
            [call('a1', 'query'), call('a2', 'query'), call('a3', 'query'), call('b1', 'read')],
            host()
        );
        expect(items.map(it => it.type)).toEqual(['batch', 'call']);
        expect((items[0] as ChatTimelineBatchItem).items.map(it => it.id)).toEqual([
            'a1',
            'a2',
            'a3'
        ]);
    });

    it('never batches across narration, nor two calls alone', () => {
        const items = buildTimelineItems(
            [call('a1', 'query'), call('a2', 'query'), text('t1'), call('a3', 'query')],
            host()
        );
        expect(items.map(it => it.type)).toEqual(['call', 'call', 'narration', 'call']);
    });

    it('nests calls and sub-agents under the sub-agent that made them', () => {
        const items = buildTimelineItems(
            [
                call('c1', 'plan'),
                agent('outer'),
                call('c2', 'read', {subagentRunId: 'outer'}),
                agent('inner', 'outer'),
                call('c3', 'read', {subagentRunId: 'inner'}),
                call('c4', 'read')
            ],
            host()
        );

        expect(items.map(it => it.id)).toEqual(['c1', 'outer', 'c4']);
        const outer = items[1] as ChatTimelineAgentItem;
        expect(outer.items.map(it => it.id)).toEqual(['c2', 'inner']);
        expect((outer.items[1] as ChatTimelineAgentItem).items.map(it => it.id)).toEqual(['c3']);
    });

    it('marks a later call with the same tool and input as a retry', () => {
        const items = buildTimelineItems(
            [
                call('m1', 'marks', {state: 'output-error'}),
                call('m2', 'marks'),
                call('r1', 'read'),
                call('x1', 'marks', {input: {desk: 'Other'}})
            ],
            host()
        );
        expect((items as ChatTimelineCallItem[]).map(it => it.retry)).toEqual([0, 1, 0, 0]);
    });

    it('counts failures, and says retried only when every failure was retried with success', () => {
        const retried = summarize([
                call('m1', 'marks', {state: 'output-error'}),
                call('m2', 'marks')
            ]),
            notRetried = summarize([
                call('m1', 'marks', {state: 'output-error'}),
                call('m2', 'marks', {state: 'output-error'})
            ]);

        expect(retried).toMatchObject({failedCount: 1, isAllRetried: true});
        expect(notRetried).toMatchObject({failedCount: 2, isAllRetried: false});
    });

    it('finds the calls that run, and those that wait for the user', () => {
        const summary = summarize(
            [
                call('c1', 'read', {state: 'running'}),
                call('c2', 'insert', {state: 'approval-requested'}),
                call('c3', 'ask', {state: 'input-available'})
            ],
            [{name: 'ask', interactive: true, renderer: () => null}]
        );
        expect(summary.running.map(it => it.id)).toEqual(['c1']);
        expect(summary.approval.id).toBe('c2');
        expect(summary.question.id).toBe('c3');
    });

    it('takes the latest finished sentence of narration, never one being written', () => {
        const streaming = summarize([
                call('c1', 'read'),
                text('t1', 'Six desks have limits today. Pulling exposure', 'streaming')
            ]),
            done = summarize([call('c1', 'read'), text('t1', 'One. Two desks are over.')]);

        expect(streaming.narration).toBe('Six desks have limits today.');
        expect(done.narration).toBe('Two desks are over.');
    });

    it('reads a plan from common shapes, and leaves other values to render as they are', () => {
        const todos = parsePlan(
                call('p1', 'todo', {
                    input: {
                        todos: [
                            {content: 'Load limits', status: 'completed'},
                            {content: 'Compare', status: 'in_progress'},
                            {content: 'Save', status: 'cancelled'}
                        ]
                    }
                }),
                () => null
            ),
            other = parsePlan(call('p2', 'todo', {input: {x: 1}}), () => null);

        expect(todos.items).toEqual([
            {title: 'Load limits', status: 'done'},
            {title: 'Compare', status: 'active'},
            {title: 'Save', status: 'skipped'}
        ]);
        expect(other.items).toBeNull();
    });

    it('summarizes input on one line, from the tool or the first text value', () => {
        const sql = call('c1', 'run_sql', {
            input: {sql: 'SELECT desk,   gross_limit\n  FROM limits'}
        });
        expect(summarizeInput(sql, null)).toEqual({text: 'SELECT desk, gross_limit', isCode: true});
        expect(summarizeInput(sql, {name: 'run_sql', summary: () => 'Limits'})).toEqual({
            text: 'Limits',
            isCode: false
        });
    });

    it('formats step times, with "<0.1s" for quick calls', () => {
        expect(formatStepDuration(40)).toBe('<0.1s');
        expect(formatStepDuration(600)).toBe('0.6s');
        expect(formatStepDuration(18_400)).toBe('18.4s');
        expect(formatStepDuration(64_000)).toBe('1m 04s');
    });

    describe('getTimelineState', () => {
        const live = new ChatMessage({role: 'assistant', status: 'streaming'});

        it('runs while calls run, and is done once the answer starts below', () => {
            const running = summarize([call('c1', 'read', {state: 'running'})]),
                finished = summarize([call('c1', 'read')]);

            expect(state(live, running, true)).toBe('running');
            expect(state(live, finished, false)).toBe('running');
            expect(state(live, finished, true)).toBe('done');
        });

        it('goes quiet with no data, and waits on the user before all else', () => {
            const running = summarize([call('c1', 'read', {state: 'running'})]),
                waiting = summarize([call('c1', 'read', {state: 'approval-requested'})]);

            expect(state(live, running, false, true)).toBe('quiet');
            expect(state(live, waiting, false, true)).toBe('approval');
        });

        it('ends stopped or failed with the reply', () => {
            const summary = summarize([call('c1', 'read', {state: 'running'})]);
            expect(state(new ChatMessage({role: 'assistant', status: 'aborted'}), summary)).toBe(
                'stopped'
            );
            expect(state(new ChatMessage({role: 'assistant', status: 'error'}), summary)).toBe(
                'failed'
            );
        });
    });
});

//------------------
// Helpers
//------------------
function host(tools: ChatToolSpec[] = []): ChatModel {
    const ret = new ChatModel({transport: new ScriptedChatTransport(), tools});
    onTestFinished(() => ret.destroy());
    return ret;
}

function summarize(parts: ChatPart[], tools: ChatToolSpec[] = []) {
    const h = host(tools);
    return summarizeTimeline(buildTimelineItems(parts, h), [], h);
}

function state(
    message: ChatMessage,
    summary: ReturnType<typeof summarize>,
    isFollowed = false,
    isQuiet = false
) {
    return getTimelineState({message, summary, isFollowed, isQuiet});
}

function call(
    id: string,
    toolName: string,
    {
        state = 'output-available',
        input = {desk: 'Rates'},
        subagentRunId
    }: {state?: ChatToolCallState; input?: any; subagentRunId?: string} = {}
): ChatToolCallPart {
    return {
        type: 'toolCall',
        id,
        toolName,
        state,
        step: 0,
        inputText: JSON.stringify(input),
        input,
        output: null,
        errorText: state === 'output-error' ? '504 Timeout' : null,
        ...(subagentRunId ? {subagentRunId} : {})
    };
}

function text(id: string, content: string = id, state: 'done' | 'streaming' = 'done'): ChatPart {
    return {type: 'text', id, text: content, state};
}

function agent(id: string, parentSubagentRunId: string = null): ChatPart {
    return {
        type: 'data',
        id,
        dataType: CHAT_SUBAGENT_DATA_TYPE,
        data: {name: id, status: 'running', ...(parentSubagentRunId ? {parentSubagentRunId} : {})}
    };
}
