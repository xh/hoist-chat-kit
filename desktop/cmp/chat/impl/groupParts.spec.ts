import {describe, expect, it} from 'vitest';
import type {
    ChatModel,
    ChatPart,
    ChatToolCallPart,
    ChatToolCallState,
    ChatToolSpec
} from '../../../../core';
import {type ChatProcessRun, groupParts, groupProcessRuns} from './groupParts';

/**
 * groupParts decides what an assistant message shows as one row. Apps rely on it to fold runs of
 * tool calls into a quiet "Used 3 tools" row, while calls that need the user stay in view.
 */
describe('groupParts', () => {
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

//------------------
// Helpers
//------------------
function chatModel(tools: ChatToolSpec[] = []): ChatModel {
    return {getToolSpec: (name: string) => tools.find(it => it.name === name) ?? null} as ChatModel;
}

function reasoning(id: string, content: string = 'Thinking it over.'): ChatPart {
    return {type: 'reasoning', id, text: content, state: 'done', startedAt: 0, endedAt: 10};
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
