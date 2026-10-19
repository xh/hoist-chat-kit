import type {ChatToolSpec} from '../../core';
import {
    type ScriptedItem,
    scriptedDelay,
    subagentEvents,
    textEvents,
    toolCallEvents
} from '../../transport';

/**
 * An agentic run for the activity timeline, scripted for `ScriptedChatTransport`: a query,
 * narration, a batch of three calls, a sub-agent with a failed call that is retried, and
 * the answer. Every call is a backend call with its result in the script, so the chat runs no
 * tools. Pair it with {@link AGENT_RUN_TOOLS}, which give the calls `display: 'timeline'`.
 *
 * Specs use it with `delayMs: 0`. A demo can play it as is, at the transport's default pace.
 */
export function agentRunScript({withPauses = false}: {withPauses?: boolean} = {}): ScriptedItem[] {
    const pause = (ms: number) => (withPauses ? [scriptedDelay(ms)] : []);
    return [
        toolCallEvents(
            'run_sql',
            {sql: 'SELECT desk, gross_limit FROM limits WHERE as_of = :today'},
            {toolCallId: 'sql1', result: [{desk: 'Technology', gross_limit: 250_000_000}]}
        ),
        pause(400),
        textEvents('Six desks have limits today. Pulling gross exposure for each in parallel.', {
            messageId: 'n1'
        }),
        ['Technology', 'Regional Banks', 'Energy'].map((desk, idx) =>
            toolCallEvents('query_exposure', {desk}, {toolCallId: `q${idx + 1}`, result: {desk}})
        ),
        pause(400),
        subagentEvents(
            'Limits Checker',
            [
                toolCallEvents(
                    'read_policy',
                    {file: 'Risk Policy 2026.pdf'},
                    {toolCallId: 'p1', result: 'Gross limits apply per desk.'}
                ),
                toolCallEvents(
                    'fetch_marks',
                    {url: 'GET marks-service/v2/marks'},
                    {toolCallId: 'm1', error: '504 Timeout'}
                ),
                pause(400),
                toolCallEvents(
                    'fetch_marks',
                    {url: 'GET marks-service/v2/marks'},
                    {toolCallId: 'm2', result: {marks: 6}}
                )
            ],
            {
                subagentRunId: 'agent1',
                description: 'Compare exposure to limits and explain breaches',
                result: '2 desks over limit. Technology at 112%, Regional Banks at 104%.'
            }
        ),
        textEvents(
            'Two desks are over their gross limit: **Technology (112%)** and **Regional Banks (104%)**.',
            {messageId: 'answer'}
        )
    ];
}

/** The tools of {@link agentRunScript}: backend tools shown in the timeline. */
export const AGENT_RUN_TOOLS: ChatToolSpec[] = [
    {name: 'run_sql', displayName: 'Load desk limits', display: 'timeline'},
    {name: 'query_exposure', displayName: 'Query exposure', display: 'timeline'},
    {name: 'read_policy', displayName: 'Read policy', display: 'timeline'},
    {name: 'fetch_marks', displayName: 'Fetch intraday marks', display: 'timeline'}
];
