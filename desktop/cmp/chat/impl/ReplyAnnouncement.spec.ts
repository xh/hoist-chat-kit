import {initTestAppAsync} from '@xh/hoist/test-support';
import {beforeAll, describe, expect, it, onTestFinished} from 'vitest';
import {ChatMessage, ChatModel, type ChatPart} from '../../../../core';
import {ScriptedChatTransport} from '../../../../transport';
import {formatReplyAnnouncement} from './ReplyAnnouncement';

/**
 * What a screen reader hears when a reply finishes. It must say who replied, how much work it
 * took, then the start of the answer as plain words - never markup, and never the whole reply.
 */
describe('formatReplyAnnouncement', () => {
    beforeAll(() => initTestAppAsync());

    it('names the assistant, its tool count and time, then the first paragraph', () => {
        const message = reply(
            'HY Credit is the **only** desk over its limit.\n\nEM Rates is next.',
            {
                tools: 7,
                elapsedMs: 42_300
            }
        );
        expect(formatReplyAnnouncement(message, 'Credit Analyst')).toBe(
            'Credit Analyst replied after 7 tools, 42 seconds. HY Credit is the only desk over its ' +
                'limit. Continues in the message.'
        );
    });

    it('leaves out what it has no count for, and uses the singular for one', () => {
        expect(formatReplyAnnouncement(reply('Done.', {tools: 1, elapsedMs: 300}), 'Bot')).toBe(
            'Bot replied after 1 tool. Done.'
        );
        expect(formatReplyAnnouncement(reply('Done.', {elapsedMs: 1000}), 'Bot')).toBe(
            'Bot replied after 1 second. Done.'
        );
        expect(formatReplyAnnouncement(reply(''), 'Bot')).toBe('Bot replied.');
    });

    it('cuts a long first paragraph at 300 characters, on a word', () => {
        const long = Array(80).fill('word').join(' '),
            text = formatReplyAnnouncement(reply(long), 'Bot').replace('Bot replied. ', '');
        expect(text.endsWith('… Continues in the message.')).toBe(true);
        expect(text.replace('… Continues in the message.', '').length).toBeLessThanOrEqual(300);
        expect(text).not.toMatch(/wor…/);
    });

    it('reads markdown as plain words, skipping code, links, headings and citation markers', () => {
        const message = reply(
            '```sql\nselect 1\n```\n\n## See [the report](https://x.io) for `desk` limits [1].'
        );
        expect(formatReplyAnnouncement(message, 'Bot')).toBe(
            'Bot replied. See the report for desk limits.'
        );
    });

    it('counts agents and failures, leaving out hidden calls and narration', () => {
        const call = (id: string, toolName: string, state = 'output-available'): ChatPart => ({
                type: 'toolCall',
                id,
                toolName,
                state: state as any,
                step: 0,
                inputText: '{}',
                input: {},
                output: null,
                errorText: null
            }),
            message = new ChatMessage({
                role: 'assistant',
                parts: [
                    {type: 'data', id: 'sa1', dataType: 'xh.chat.subagent', data: {name: 'A'}},
                    call('c1', 'step', 'output-error'),
                    {type: 'text', id: 'n1', text: 'Checking the marks.', state: 'done'},
                    call('c2', 'step'),
                    call('h1', 'log'),
                    {type: 'text', id: 't1', text: 'Two desks are over.', state: 'done'}
                ]
            }),
            host = new ChatModel({
                transport: new ScriptedChatTransport(),
                tools: [
                    {name: 'step', display: 'timeline'},
                    {name: 'log', display: 'hidden'}
                ]
            });
        onTestFinished(() => host.destroy());

        expect(formatReplyAnnouncement(message, 'Bot', host)).toBe(
            'Bot replied after 2 tools and 1 agent, 1 failed. Two desks are over.'
        );
    });

    it('counts activities by their noun, between tools and agents', () => {
        const skill = (id: string): ChatPart => ({
                type: 'data',
                id,
                dataType: 'skill',
                data: {}
            }),
            message = new ChatMessage({
                role: 'assistant',
                parts: [
                    skill('s1'),
                    {type: 'data', id: 'sa1', dataType: 'xh.chat.subagent', data: {name: 'A'}},
                    skill('s2'),
                    {type: 'data', id: 'x1', dataType: 'trace', data: {}},
                    ...reply('Done.', {tools: 3}).parts
                ]
            }),
            host = new ChatModel({
                transport: new ScriptedChatTransport(),
                activities: [
                    {dataType: 'skill', display: 'timeline', noun: 'skill'},
                    {dataType: 'trace', display: 'hidden', noun: 'trace'}
                ]
            });
        onTestFinished(() => host.destroy());

        expect(formatReplyAnnouncement(message, 'Bot', host)).toBe(
            'Bot replied after 3 tools, 2 skills and 1 agent. Done.'
        );
    });
});

//------------------
// Helpers
//------------------
function reply(
    text: string,
    {tools = 0, elapsedMs = 0}: {tools?: number; elapsedMs?: number} = {}
): ChatMessage {
    const calls: ChatPart[] = Array.from({length: tools}, (_, idx) => ({
        type: 'toolCall',
        id: `c${idx}`,
        toolName: 'query',
        state: 'output-available',
        step: 0,
        inputText: '{}',
        input: {},
        output: 'ok',
        errorText: null
    }));
    return new ChatMessage({
        role: 'assistant',
        parts: [
            ...calls,
            ...(text ? [{type: 'text', id: 't1', text, state: 'done'} as ChatPart] : [])
        ],
        metadata: {elapsedMs}
    });
}
