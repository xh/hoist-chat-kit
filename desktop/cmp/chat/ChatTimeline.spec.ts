import {act, fireEvent, render, screen, within} from '@testing-library/react';
import {runInAction} from '@xh/hoist/mobx';
import {fragment, span} from '@xh/hoist/cmp/layout';
import {button} from '@xh/hoist/desktop/cmp/button';
import {creates, hoistCmp, HoistModel, type HoistProps} from '@xh/hoist/core';
import {initTestAppAsync} from '@xh/hoist/test-support';
import {useState} from 'react';
import {afterEach, beforeAll, beforeEach, describe, expect, it, onTestFinished, vi} from 'vitest';
import {
    chatAnnouncer,
    ChatMessage,
    type ChatMessageSpec,
    ChatModel,
    type ChatPart,
    type ChatToolCallPart,
    type ChatToolCallState,
    type ChatToolSpec
} from '../../../core';
import {
    activityEvents,
    errorEvents,
    ScriptedChatTransport,
    scriptedDelay,
    type ScriptedItem,
    subagentEvents,
    textEvents,
    toolCallEvents
} from '../../../transport';
import {AGENT_RUN_TOOLS, agentRunScript} from '../../../test/fixtures/agentRunScript';
import {chatMessageList} from './ChatMessageList';
import {ChatTimeline, chatTimeline} from './ChatTimeline';
import {TIMELINE_MAX_DEPTH} from './impl/ChatTimelineRows';

/**
 * The activity timeline of an agent's reply (P2). Users rely on twenty calls reading as one quiet
 * line that says what runs and how long it has taken, on the block never opening or closing by
 * itself, on approvals and questions showing even while it is closed, and on the done summary
 * riding in the reply's one announcement.
 */
describe('ChatTimeline', () => {
    beforeAll(() => initTestAppAsync());

    beforeEach(() => {
        vi.stubGlobal('ResizeObserver', resizeObserverOf(820));
        Element.prototype.scrollTo ??= () => {};
        chatAnnouncer.clear();
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    describe('activities', () => {
        async function runSkills(dataRenderers = {}) {
            const model = new ChatModel({
                transport: new ScriptedChatTransport({
                    responses: [
                        [
                            activityEvents('skill', {skillName: 'Equity research'}),
                            toolCallEvents('lookup', {desk: 'Rates'}, {result: 'ok'}),
                            subagentEvents(
                                'Checker',
                                [
                                    activityEvents('skill', {skillName: 'Limits'}),
                                    toolCallEvents('load', {desk: 'Rates'}, {result: 'ok'})
                                ],
                                {result: 'All clear.'}
                            ),
                            textEvents('No desk is over its limit.')
                        ]
                    ],
                    delayMs: 0
                }),
                tools: TOOLS,
                activities: [
                    {
                        dataType: 'skill',
                        display: 'timeline',
                        displayName: 'Loaded skill',
                        summary: part => part.data.skillName,
                        noun: 'skill'
                    }
                ],
                dataRenderers
            });
            onTestFinished(() => model.destroy());
            const result = render(chatMessageList({model}));
            await act(() => model.sendAsync('Check the desks.'));
            return result;
        }

        it('counts skills in the line, and shows each as a row among the calls', async () => {
            const {container} = await runSkills();
            expect(container.querySelectorAll('.xh-chat-timeline')).toHaveLength(1);
            expect(lineButton(container).textContent).toContain(
                'Used 2 tools, 2 skills and 1 agent'
            );

            fireEvent.click(lineButton(container));
            const tree = within(timeline(container)).getByRole('tree');
            expect(Array.from(tree.children).map(it => it.getAttribute('aria-label'))).toEqual([
                'Loaded skill, Equity research',
                expect.stringMatching(/^Lookup, Rates/),
                expect.stringMatching(/^Checker, agent, 1 step/)
            ]);

            const agentRow = tree.children[2] as HTMLElement;
            fireEvent.keyDown(agentRow, {key: 'ArrowRight'});
            expect(
                within(agentRow)
                    .getAllByRole('treeitem')
                    .map(it => it.getAttribute('aria-label'))
            ).toEqual([
                'Loaded skill, Limits',
                expect.stringMatching(/^Load, Rates/),
                // The sub-agent's result, as a leaf the user opens.
                'Result, All clear.'
            ]);

            const resultRow = within(agentRow).getAllByRole('treeitem')[2];
            expect(resultRow.querySelector('.xh-chat-timeline__pane')).toBeNull();
            fireEvent.click(resultRow.querySelector('.xh-chat-timeline__row'));
            const pane = resultRow.querySelector('.xh-chat-timeline__pane-body--prose');
            expect(pane.textContent).toBe('All clear.');
            expect(pane.getAttribute('tabindex')).toBe('0');
            expect(resultRow.getAttribute('aria-label')).toBe('Result');
        });

        it('shows a call that starts a sub-agent as the sub-agent row alone', async () => {
            const model = new ChatModel({
                transport: new ScriptedChatTransport({
                    delayMs: 0,
                    responses: [
                        [
                            toolCallEvents(
                                'task',
                                {prompt: 'Check the limits'},
                                {toolCallId: 'task1', result: 'done'}
                            ),
                            subagentEvents(
                                'Researcher',
                                [toolCallEvents('lookup', {desk: 'Rates'}, {result: 'ok'})],
                                {parentToolCallId: 'task1', description: 'Check the limits'}
                            ),
                            textEvents('All clear.')
                        ]
                    ]
                }),
                tools: TOOLS
            });
            onTestFinished(() => model.destroy());
            const {container} = render(chatMessageList({model}));
            await act(() => model.sendAsync('Check.'));

            expect(container.querySelector('.xh-chat-tool-call')).toBeNull();
            expect(lineButton(container).textContent).toContain('Used 1 tool and 1 agent');
            fireEvent.click(lineButton(container));
            const tree = within(timeline(container)).getByRole('tree');
            expect(Array.from(tree.children).map(it => it.getAttribute('aria-label'))).toEqual([
                expect.stringMatching(/^Researcher, Check the limits, agent, 1 step/)
            ]);
        });

        it('shows a spawning call that fails, or waits for the user, as its own card', () => {
            const spawning = (id: string, state: ChatToolCallState): ChatPart => ({
                    ...call(id, {state, toolName: 'task'}),
                    spawnedSubagentRunId: `sa-${id}`
                }),
                agent = (id: string): ChatPart => ({
                    type: 'data',
                    id: `sa-${id}`,
                    dataType: 'xh.chat.subagent',
                    // A sub-agent left open ends complete, so its row says nothing of the failure.
                    data: {name: 'Researcher', status: 'complete', parentToolCallId: id}
                }),
                chatModel = createChat([
                    reply(
                        [
                            spawning('t1', 'output-error'),
                            agent('t1'),
                            spawning('t2', 'output-available'),
                            agent('t2'),
                            text('a', 'Done.')
                        ],
                        {status: 'complete'}
                    )
                ]);
            const {container} = renderChat(chatModel);

            expect(container.querySelectorAll('.xh-chat-tool-call')).toHaveLength(1);
            expect(container.querySelector('.xh-chat-message__warning').textContent).toContain(
                '1 tool failed'
            );

            setMessages(chatModel, [
                reply([spawning('t3', 'approval-requested'), agent('t3')], {status: 'paused'})
            ]);
            expect(container.querySelectorAll('.xh-chat-tool-call')).toHaveLength(1);
        });

        it("shows calls to tools the app does not list as the chat's getToolSpec says", () => {
            const chatModel = new ChatModel({
                transport: new ScriptedChatTransport(),
                getToolSpec: name => ({
                    name,
                    displayName: name.replace(/^acme__/, ''),
                    display: 'timeline'
                })
            });
            onTestFinished(() => chatModel.destroy());
            setMessages(chatModel, [
                reply(
                    [call('c1', {toolName: 'acme__search'}), call('c2', {toolName: 'acme__fetch'})],
                    {
                        status: 'complete'
                    }
                )
            ]);
            const {container} = renderChat(chatModel);

            expect(container.querySelector('.xh-chat-tool-call')).toBeNull();
            expect(lineButton(container).textContent).toContain('Used 2 tools');
            fireEvent.click(lineButton(container));
            const labels = within(timeline(container))
                .getAllByRole('treeitem')
                .map(it => it.getAttribute('aria-label'));
            expect(labels).toEqual([
                expect.stringMatching(/^search/),
                expect.stringMatching(/^fetch/)
            ]);
        });

        it('gives each activity row the icon its spec picks for the part, else the default', () => {
            const chatModel = new ChatModel({
                transport: new ScriptedChatTransport(),
                tools: TOOLS,
                activities: [
                    {
                        dataType: 'skill',
                        display: 'timeline',
                        icon: part =>
                            part.data.skillName === 'Charts'
                                ? span({className: 'app-chart-icon'})
                                : null
                    }
                ]
            });
            onTestFinished(() => chatModel.destroy());
            const skill = (id: string, skillName: string): ChatPart => ({
                type: 'data',
                id,
                dataType: 'skill',
                data: {skillName}
            });
            setMessages(chatModel, [
                reply([skill('s1', 'Charts'), call('c1'), skill('s2', 'Limits')], {
                    status: 'complete'
                })
            ]);
            const {container} = renderChat(chatModel);
            fireEvent.click(lineButton(container));

            const rows = container.querySelectorAll('.xh-chat-timeline__item--activity');
            expect(rows).toHaveLength(2);
            expect(rows[0].querySelector('.app-chart-icon')).toBeTruthy();
            expect(rows[1].querySelector('.app-chart-icon')).toBeNull();
            expect(rows[1].querySelector('.xh-chat-timeline__icon svg')).toBeTruthy();
        });

        it('opens a skill row to its data renderer, else to its data', async () => {
            const plain = await runSkills(),
                row = () => within(timeline(plain.container)).getAllByRole('treeitem')[0];
            fireEvent.click(lineButton(plain.container));
            fireEvent.click(row().querySelector('.xh-chat-timeline__row'));
            expect(row().textContent).toContain('Equity research');
            expect(row().querySelector('.xh-chat-timeline__pane')).toBeTruthy();
            plain.unmount();

            const rendered = await runSkills({skill: part => `Skill card: ${part.data.skillName}`});
            fireEvent.click(lineButton(rendered.container));
            const first = within(timeline(rendered.container)).getAllByRole('treeitem')[0];
            fireEvent.click(first.querySelector('.xh-chat-timeline__row'));
            expect(first.textContent).toContain('Skill card: Equity research');
        });
    });

    describe('a scripted agent run', () => {
        it('sums up the run in one collapsed line, with the answer below the block', async () => {
            const {container} = await runAgent();

            const block = timeline(container),
                head = lineButton(container);
            expect(container.querySelectorAll('.xh-chat-timeline')).toHaveLength(1);
            expect(head.getAttribute('aria-expanded')).toBe('false');
            expect(head.textContent).toContain('Used 7 tools and 1 agent');
            expect(block.querySelector('.xh-chat-timeline__fails').textContent).toContain(
                '1 failed, retried'
            );
            expect(within(block).queryByRole('tree')).toBeNull();

            // The answer is outside the block, and narration never mixes with it.
            const body = container.querySelector('.xh-chat-message__body');
            expect(body.querySelector('.xh-chat-message__text').textContent).toContain(
                'Two desks are over their gross limit'
            );
            expect(body.textContent).not.toContain('Six desks have limits today');
            // No tool rows of P1's kind.
            expect(container.querySelector('.xh-chat-tool-call')).toBeNull();
        });

        it('opens to a tree of rows: calls, narration, a batch and a sub-agent', async () => {
            const {container} = await runAgent();
            fireEvent.click(lineButton(container));

            const block = timeline(container);
            expect(lineButton(container).getAttribute('aria-expanded')).toBe('true');

            const tree = within(block).getByRole('tree'),
                topRows = Array.from(tree.children);
            expect(topRows.map(it => it.getAttribute('aria-label') ?? it.textContent)).toEqual([
                expect.stringMatching(/^Load desk limits, SELECT desk, gross_limit FROM limits/),
                'Six desks have limits today. Pulling gross exposure for each in parallel.',
                'Query exposure, 3 calls',
                expect.stringMatching(/^Limits Checker, .*agent, 3 steps/)
            ]);
            // Done sub-agents start closed.
            expect(topRows[3].getAttribute('aria-expanded')).toBe('false');
        });

        it("draws narration through the chat's textRenderer, or as markdown where it returns null", () => {
            const chatModel = new ChatModel({
                transport: new ScriptedChatTransport(),
                tools: TOOLS,
                textRenderer: part =>
                    part.id === 'n1' ? span({className: 'app-narration', item: 'Drawn'}) : null
            });
            onTestFinished(() => chatModel.destroy());
            setMessages(chatModel, [
                reply([
                    call('c1'),
                    text('n1', 'root = Note()'),
                    call('c2'),
                    text('n2', '**Bold** step'),
                    call('c3')
                ])
            ]);
            const {container} = renderChat(chatModel);
            fireEvent.click(lineButton(container));

            const narration = container.querySelectorAll('.xh-chat-timeline__narration');
            expect(narration).toHaveLength(2);
            expect(narration[0].querySelector('.app-narration').textContent).toBe('Drawn');
            expect(narration[1].querySelector('strong').textContent).toBe('Bold');
        });

        it('moves between rows with the arrow keys, and opens and closes them', async () => {
            const {container} = await runAgent();
            fireEvent.click(lineButton(container));

            const rows = () => screen.getAllByRole('treeitem'),
                [first] = rows();
            expect(rows().filter(it => it.tabIndex === 0)).toEqual([first]);

            act(() => first.focus());
            fireEvent.keyDown(first, {key: 'End'});
            const agentRow = document.activeElement as HTMLElement;
            expect(agentRow.getAttribute('aria-label')).toMatch(/^Limits Checker/);
            expect(rows().filter(it => it.tabIndex === 0)).toEqual([agentRow]);

            fireEvent.keyDown(agentRow, {key: 'ArrowRight'});
            expect(agentRow.getAttribute('aria-expanded')).toBe('true');
            expect(within(agentRow).getByText('2 desks over limit.', {exact: false})).toBeTruthy();

            fireEvent.keyDown(agentRow, {key: 'ArrowRight'});
            const child = document.activeElement as HTMLElement;
            expect(child.getAttribute('aria-label')).toMatch(/^Read policy/);
            expect(child.getAttribute('aria-level')).toBe('2');

            fireEvent.keyDown(child, {key: 'ArrowDown'});
            const failed = document.activeElement as HTMLElement;
            expect(failed.getAttribute('aria-label')).toBe(
                'Fetch intraday marks, GET marks-service/v2/marks, failed: 504 Timeout'
            );
            fireEvent.keyDown(failed, {key: 'ArrowDown'});
            expect((document.activeElement as HTMLElement).getAttribute('aria-label')).toMatch(
                /^Fetch intraday marks, GET marks-service\/v2\/marks, retry 1, done/
            );

            fireEvent.keyDown(document.activeElement, {key: 'ArrowLeft'});
            expect(document.activeElement).toBe(agentRow);
            fireEvent.keyDown(agentRow, {key: 'ArrowLeft'});
            expect(agentRow.getAttribute('aria-expanded')).toBe('false');

            fireEvent.keyDown(agentRow, {key: 'Home'});
            expect(document.activeElement).toBe(rows()[0]);
        });

        it('mounts a row’s details on open, and Escape in them returns to the row', async () => {
            const {container} = await runAgent();
            fireEvent.click(lineButton(container));

            const row = screen.getAllByRole('treeitem')[0];
            expect(within(row).queryByRole('group', {name: 'Input'})).toBeNull();
            fireEvent.keyDown(row, {key: 'Enter'});

            const input = within(row).getByRole('group', {name: 'Input'});
            expect(input.textContent).toContain('"sql": "SELECT desk, gross_limit');
            expect(within(row).getByRole('group', {name: 'Output'})).toBeTruthy();
            expect(within(input).getByRole('button', {name: 'Copy input'})).toBeTruthy();

            const paneBody = input.querySelector<HTMLElement>('.xh-chat-timeline__pane-body');
            act(() => paneBody.focus());
            fireEvent.keyDown(paneBody, {key: 'Escape'});
            expect(document.activeElement).toBe(row);

            fireEvent.keyDown(row, {key: ' '});
            expect(within(row).queryByRole('group', {name: 'Input'})).toBeNull();
        });

        it('folds its summary into the reply announcement, never announcing it alone', async () => {
            const announce = vi.spyOn(chatAnnouncer, 'announce');
            await runAgent({assistantName: 'Analyst'});

            const texts = announce.mock.calls.map(it => it[0]);
            // Narration is not the answer.
            expect(texts).toContainEqual(
                expect.stringMatching(
                    /^Analyst replied after 7 tools and 1 agent, (.*, )?1 failed\. Two desks are over/
                )
            );
            expect(texts.some(it => it.startsWith('Used ') || it.includes('Six desks'))).toBe(
                false
            );
        });
    });

    describe('announcements', () => {
        it('announces a step that fails while the reply runs, and only that', () => {
            const announce = vi.spyOn(chatAnnouncer, 'announce'),
                chatModel = createChat([
                    reply(
                        [
                            call('c1', {state: 'running', toolName: 'fetch_marks'}),
                            call('c2', {state: 'running'})
                        ],
                        {status: 'streaming'}
                    )
                ]);
            renderChat(chatModel);

            act(() =>
                setMessages(chatModel, [
                    reply(
                        [call('c1', {state: 'output-error', toolName: 'fetch_marks'}), call('c2')],
                        {
                            status: 'streaming'
                        }
                    )
                ])
            );

            expect(announce.mock.calls.map(it => it[0])).toEqual([
                'Step failed: Fetch marks, 504 Timeout.'
            ]);
        });

        it('announces a failed call shown as a card', () => {
            const announce = vi.spyOn(chatAnnouncer, 'announce'),
                tools = [{name: 'show_card', display: 'card' as const}],
                chatModel = createChat(
                    [
                        reply([call('k1', {state: 'running', toolName: 'show_card'})], {
                            status: 'streaming'
                        })
                    ],
                    tools
                );
            renderChat(chatModel);

            act(() =>
                setMessages(chatModel, [
                    reply([call('k1', {state: 'output-error', toolName: 'show_card'})], {
                        status: 'streaming'
                    })
                ])
            );
            expect(announce.mock.calls.map(it => it[0])).toEqual([
                'Step failed: Show card, 504 Timeout.'
            ]);
        });

        it('announces once what it waits on after two minutes quiet, keeping its spinner', () => {
            const announce = vi.spyOn(chatAnnouncer, 'announce'),
                {container} = renderReply(
                    [call('c1', {state: 'running', toolName: 'fetch_marks'})],
                    {
                        lastActivityAt: Date.now() - 125_000,
                        stallAfterMs: 30_000
                    }
                );

            expect(announce.mock.calls.map(it => it[0])).toEqual(['Still waiting on Fetch marks.']);
            expect(lineButton(container).querySelector('.xh-chat-spinner')).toBeTruthy();
        });

        it('never announces steps already done when it mounts', () => {
            const announce = vi.spyOn(chatAnnouncer, 'announce');
            renderReply([call('c1', {state: 'output-error'}), call('c2', {state: 'running'})]);
            expect(announce).not.toHaveBeenCalled();
        });
    });

    describe('while running', () => {
        it('counts failures for ChatTimeline.defaults.showSummaryFailureCount false', () => {
            showSummaryFailureCount(false);
            const {container} = renderReply([
                call('c1', {state: 'output-error'}),
                call('c2', {state: 'running'})
            ]);
            expect(timeline(container).querySelector('.xh-chat-timeline__fails').textContent).toBe(
                '1 failed'
            );
        });

        it('shows the running step, the step count and a spinner, and stays collapsed', () => {
            const {container} = renderReply([
                call('c1', {state: 'output-available', toolName: 'load'}),
                call('c2', {state: 'running', toolName: 'fetch_marks'})
            ]);

            const head = lineButton(container);
            expect(head.getAttribute('aria-expanded')).toBe('false');
            expect(head.querySelector('.xh-chat-timeline__stage').textContent).toBe('Fetch marks');
            expect(head.textContent).toContain('2 steps');
            expect(head.querySelector('.xh-chat-spinner')).toBeTruthy();
            expect(timeline(container).classList).toContain('xh-chat-timeline--running');
        });

        it('shows narration as the step, but never with a textRenderer, which may draw source', () => {
            const parts = [call('c1'), text('n1', 'Checking the marks. ')],
                stageOf = (textRenderer = null) => {
                    const chatModel = new ChatModel({
                            transport: new ScriptedChatTransport(),
                            tools: TOOLS,
                            textRenderer
                        }),
                        message = reply(parts, {status: 'streaming'});
                    onTestFinished(() => chatModel.destroy());
                    setMessages(chatModel, [message]);
                    // An app's own block, whose parts may end in narration, in its app's context.
                    const {container, unmount} = render(
                            appContext(
                                chatTimeline({message, host: chatModel, parts, isLast: true})
                            )
                        ),
                        ret = lineButton(container).querySelector(
                            '.xh-chat-timeline__stage'
                        ).textContent;
                    unmount();
                    return ret;
                };

            expect(stageOf()).toBe('Checking the marks.');
            expect(stageOf(() => null)).toBe('Working');
        });

        it('says "Running N steps" when calls run at once', () => {
            const {container} = renderReply([
                call('c1', {state: 'running'}),
                call('c2', {state: 'running'})
            ]);
            expect(lineButton(container).textContent).toContain('Running 2 steps');
        });

        it('names what it waits on once the chat goes quiet', () => {
            const {container} = renderReply(
                [call('c1', {state: 'running', toolName: 'fetch_marks'})],
                {
                    lastActivityAt: Date.now() - 40_000,
                    stallAfterMs: 30_000
                }
            );

            const head = lineButton(container);
            expect(head.textContent).toContain('Waiting on Fetch marks');
            expect(head.textContent).toContain('no update for 40s');
            expect(timeline(container).classList).toContain('xh-chat-timeline--quiet');
        });

        it('swaps the line to its summary in place once the answer starts, and keeps it open', () => {
            const parts = [call('c1'), call('c2', {state: 'running'})],
                chatModel = createChat([reply(parts, {status: 'streaming'})]),
                {container} = renderChat(chatModel);
            fireEvent.click(lineButton(container));

            act(() =>
                setMessages(chatModel, [
                    reply([call('c1'), call('c2'), text('answer', 'The answer.')], {
                        status: 'streaming'
                    })
                ])
            );

            const head = lineButton(container);
            expect(head.textContent).toContain('Used 2 tools');
            expect(head.getAttribute('aria-expanded')).toBe('true');
            expect(head.querySelector('.xh-chat-spinner')).toBeNull();
        });
    });

    describe('when done', () => {
        it('separates the time taken and the failures with the same spaced dot', () => {
            const {container} = renderReply(
                [call('c1', {state: 'output-error'}), call('c2')],
                {},
                {status: 'complete', metadata: {elapsedMs: 20_000}}
            );

            const meta = timeline(container).querySelector('.xh-chat-timeline__meta');
            expect(meta.textContent).toBe('20s · 1 failed, retried');
            // One separator, outside the warning, styled to keep its spaces.
            const seps = meta.querySelectorAll('.xh-chat-timeline__sep');
            expect(seps).toHaveLength(1);
            expect(seps[0].textContent).toBe(' · ');
            expect(meta.querySelector('.xh-chat-timeline__fails').textContent).toBe(
                '1 failed, retried'
            );
        });

        it('counts failures in the warning color, and shows the error on the failed row', () => {
            const {container} = renderReply(
                [call('c1'), call('c2', {state: 'output-error', toolName: 'fetch_marks'})],
                {},
                {status: 'complete'}
            );

            const fails = timeline(container).querySelector('.xh-chat-timeline__fails');
            expect(fails.textContent).toBe('1 failed');
            fireEvent.click(lineButton(container));
            expect(screen.getAllByRole('treeitem')[1].textContent).toContain('504 Timeout');
            // The reply header leaves the count to the timeline.
            expect(container.querySelector('.xh-chat-message__header').textContent).not.toContain(
                'failed'
            );
        });

        it('leaves the failure count out of the line, open or closed, for ChatTimeline.defaults.showSummaryFailureCount false', () => {
            showSummaryFailureCount(false);
            const {container} = renderReply(
                [call('c1'), call('c2', {state: 'output-error', toolName: 'fetch_marks'})],
                {},
                {status: 'complete', metadata: {elapsedMs: 20_000}}
            );

            const meta = () => timeline(container).querySelector('.xh-chat-timeline__meta');
            expect(meta().textContent).toBe('20s');
            expect(meta().querySelector('.xh-chat-timeline__sep')).toBeNull();
            fireEvent.click(lineButton(container));
            expect(meta().textContent).toBe('20s');
            // The failed step still shows as failed, with its error.
            const failedRow = screen.getAllByRole('treeitem')[1];
            expect(failedRow.classList).toContain('xh-chat-timeline__item--failed');
            expect(failedRow.textContent).toContain('504 Timeout');
        });

        it('says how many tools ran before a stop, and marks running steps cancelled', () => {
            const {container} = renderReply(
                [call('c1'), call('c2', {state: 'running'})],
                {},
                {status: 'aborted'}
            );

            const head = lineButton(container);
            expect(head.textContent).toContain('Stopped after 1 tool');
            expect(head.textContent).toContain('1 cancelled');
            fireEvent.click(head);
            expect(screen.getAllByRole('treeitem')[1].getAttribute('aria-label')).toBe(
                'Lookup, Rates, cancelled'
            );
        });

        it('ends a failed run at its last step', () => {
            const {container} = renderReply([call('c1'), call('c2')], {}, {status: 'error'});
            expect(lineButton(container).textContent).toContain('Ended at step 2');
        });
    });

    describe('settling', () => {
        it('stops a sub-agent row once its run fails without an end event', async () => {
            const {container} = await runScript([
                {type: 'SUBAGENT_STARTED', subagentRunId: 'sa1', name: 'Checker'},
                {
                    type: 'TOOL_CALL_START',
                    toolCallId: 'c1',
                    toolCallName: 'lookup',
                    subagentRunId: 'sa1'
                },
                {type: 'TOOL_CALL_END', toolCallId: 'c1'},
                {type: 'TOOL_CALL_RESULT', messageId: 'r1', toolCallId: 'c1', content: 'ok'},
                errorEvents('Boom')
            ]);
            fireEvent.click(lineButton(container));

            const agent = screen.getAllByRole('treeitem')[0];
            expect(agent.getAttribute('aria-label')).toMatch(
                /^Checker, agent, 1 step, failed: The agent did not finish\.$/
            );
            expect(agent.getAttribute('aria-expanded')).toBe('false');
            expect(agent.querySelector('.xh-chat-spinner')).toBeNull();
        });

        it('stops a sub-agent row in a reply restored from history mid-run', () => {
            const model = new ChatModel({transport: new ScriptedChatTransport(), tools: TOOLS});
            onTestFinished(() => model.destroy());
            model.loadMessages([
                {role: 'user', content: 'Check the desks.'},
                {
                    id: 'a1',
                    role: 'assistant',
                    status: 'streaming',
                    parts: [
                        {
                            type: 'data',
                            id: 'sa1',
                            dataType: 'xh.chat.subagent',
                            data: {name: 'Checker', status: 'running', startedAt: 1000}
                        },
                        {...call('c1', {state: 'running'}), subagentRunId: 'sa1'}
                    ]
                }
            ]);
            const {container} = render(chatMessageList({model}));
            fireEvent.click(lineButton(container));

            const agent = screen.getAllByRole('treeitem')[0];
            expect(agent.getAttribute('aria-label')).toMatch(/^Checker, agent, 1 step, failed: /);
            expect(agent.querySelector('.xh-chat-spinner')).toBeNull();
            expect(model.messages[1].parts[0]).toMatchObject({
                data: {status: 'error', endedAt: expect.any(Number)}
            });
        });

        it('shows no spinner on a sub-agent of a reply that is no longer live', () => {
            const {container} = renderReply(
                [
                    {
                        type: 'data',
                        id: 'sa1',
                        dataType: 'xh.chat.subagent',
                        data: {name: 'Checker', status: 'running', startedAt: 1000}
                    }
                ],
                {},
                {status: 'error'}
            );
            fireEvent.click(lineButton(container));
            const agent = screen.getAllByRole('treeitem')[0];
            expect(agent.querySelector('.xh-chat-spinner')).toBeNull();
            expect(agent.getAttribute('aria-expanded')).toBe('false');
        });

        it('reads a call open at a stop as cancelled, not failed', async () => {
            const model = new ChatModel({
                transport: new ScriptedChatTransport({
                    responses: [
                        [
                            toolCallEvents(
                                'lookup',
                                {desk: 'Rates'},
                                {toolCallId: 'c1', result: 1}
                            ),
                            {type: 'TOOL_CALL_START', toolCallId: 'c2', toolCallName: 'lookup'},
                            scriptedDelay(60_000)
                        ]
                    ],
                    delayMs: 0
                }),
                tools: TOOLS
            });
            onTestFinished(() => model.destroy());
            const {container} = render(chatMessageList({model})),
                done = model.sendAsync('Look up the desks.');
            await vi.waitFor(() => expect(model.lastMessage.toolCalls).toHaveLength(2));
            act(() => model.stop());
            await act(() => done);

            const head = lineButton(container);
            expect(head.textContent).toContain('Stopped after 1 tool');
            expect(head.textContent).toContain('1 cancelled');
            expect(timeline(container).querySelector('.xh-chat-timeline__fails')).toBeNull();
            fireEvent.click(head);
            expect(screen.getAllByRole('treeitem')[1].getAttribute('aria-label')).toMatch(
                /, cancelled$/
            );
        });

        it('counts a call marked cancelled as cancelled, not failed', () => {
            const {container} = renderReply(
                [
                    call('c1'),
                    {...call('c2', {state: 'output-error'}), cancelled: true, endedAt: 2000}
                ],
                {},
                {status: 'aborted'}
            );

            const head = lineButton(container);
            expect(head.textContent).toContain('Stopped after 1 tool');
            expect(head.textContent).toContain('1 cancelled');
            expect(timeline(container).querySelector('.xh-chat-timeline__fails')).toBeNull();
            fireEvent.click(head);
            const row = screen.getAllByRole('treeitem')[1];
            expect(row.getAttribute('aria-label')).toBe('Lookup, Rates, cancelled');
            expect(row.classList).toContain('xh-chat-timeline__item--cancelled');
        });

        it('reads "Paused" while the reply waits on the user outside the block', () => {
            const {container} = renderReply(
                [call('c1'), call('c2')],
                {},
                {status: 'paused', metadata: {elapsedMs: 4000}}
            );
            const head = lineButton(container);
            expect(head.textContent).toContain('Paused');
            expect(head.textContent).not.toContain('Used 2 tools');
            expect(timeline(container).classList).toContain('xh-chat-timeline--paused');
        });

        it('gives each block of a reply its own body id', () => {
            const {container} = renderReply(
                [call('c1'), call('k1', {toolName: 'show_card'}), call('c2')],
                {},
                {status: 'complete'},
                [{name: 'show_card', display: 'card'}]
            );
            const heads = Array.from(
                container.querySelectorAll<HTMLElement>('.xh-chat-timeline__head')
            );
            expect(heads).toHaveLength(2);
            heads.forEach(it => fireEvent.click(it));

            const ids = heads.map(it => it.getAttribute('aria-controls'));
            expect(new Set(ids).size).toBe(2);
            ids.forEach(id => expect(document.getElementById(id)).toBeTruthy());
        });
    });

    describe('waiting for the user', () => {
        it('shows the approval panel while collapsed, with Allow and Deny that decide the call', () => {
            const chatModel = createChat(
                [
                    reply(
                        [
                            call('c1'),
                            call('c2', {state: 'approval-requested', toolName: 'insert_rows'})
                        ],
                        {status: 'paused'}
                    )
                ],
                [{name: 'insert_rows', display: 'timeline', approvalPrompt: 'Insert 2 rows?'}]
            );
            const {container} = renderChat(chatModel),
                block = timeline(container);

            expect(lineButton(container).getAttribute('aria-expanded')).toBe('false');
            expect(lineButton(container).textContent).toContain('Waiting for approval');
            expect(block.classList).toContain('xh-chat-timeline--attention');
            expect(block.textContent).toContain('Insert 2 rows?');

            fireEvent.click(within(block).getByRole('button', {name: 'Allow'}));
            expect(chatModel.approveToolCallAsync).toHaveBeenCalledWith('c2', undefined);
        });

        it('shows a call that waits for an answer as its card, open to its renderer', () => {
            const chatModel = createChat(
                [
                    reply(
                        [
                            call('c1'),
                            call('q1', {
                                state: 'input-available',
                                toolName: 'ask',
                                input: {question: 'Which marks should I use?'}
                            })
                        ],
                        {status: 'paused'}
                    )
                ],
                [
                    {
                        name: 'ask',
                        display: 'timeline',
                        interactive: true,
                        displayName: 'Choose marks',
                        renderer: (part, {chatModel}) =>
                            button({
                                text: 'Intraday',
                                onClick: () => chatModel.addToolOutputAsync(part.id, 'Intraday')
                            })
                    }
                ]
            );
            const {container} = renderChat(chatModel),
                block = timeline(container);

            expect(lineButton(container).getAttribute('aria-expanded')).toBe('false');
            expect(lineButton(container).textContent).toContain('Waiting for your answer');
            expect(block.classList).toContain('xh-chat-timeline--attention');
            const card = block.querySelector<HTMLElement>('.xh-chat-tool-call');
            expect(card.textContent).toContain('Choose marks');

            fireEvent.click(within(card).getByRole('button', {name: 'Intraday'}));
            expect(chatModel.addToolOutputAsync).toHaveBeenCalledWith('q1', 'Intraday');

            // The row in the tree defers to the card, so the renderer mounts once.
            fireEvent.click(lineButton(container));
            const row = screen.getAllByRole('treeitem')[1];
            expect(row.getAttribute('aria-label')).toBe('Choose marks, waiting for your answer');
            expect(row.getAttribute('aria-expanded')).toBeNull();
            expect(within(block).getAllByRole('button', {name: 'Intraday'})).toHaveLength(1);
        });

        it('shows the card of a waiting call that a sub-agent made', () => {
            const {container} = renderReply(
                [agentPart('agent1', 'Checker'), {...waiting('q1'), subagentRunId: 'agent1'}],
                {},
                {status: 'paused'},
                [counterTool]
            );
            expect(lineButton(container).textContent).toContain('Waiting for your answer');
            expect(within(timeline(container)).getByRole('button', {name: 'q1: 0'})).toBeTruthy();
        });

        it('gives each waiting call its own card, whose state never passes to the next', () => {
            const chatModel = createChat(
                    [reply([waiting('q1'), waiting('q2')], {status: 'paused'})],
                    [counterTool]
                ),
                {container} = renderChat(chatModel),
                block = timeline(container);

            expect(block.querySelectorAll('.xh-chat-tool-call')).toHaveLength(2);
            fireEvent.click(within(block).getByRole('button', {name: 'q1: 0'}));
            expect(within(block).getByRole('button', {name: 'q1: 1'})).toBeTruthy();
            expect(within(block).getByRole('button', {name: 'q2: 0'})).toBeTruthy();

            act(() =>
                setMessages(chatModel, [
                    reply([call('q1', {toolName: 'ask', output: 'ok'}), waiting('q2')], {
                        status: 'paused'
                    })
                ])
            );
            expect(block.querySelectorAll('.xh-chat-tool-call')).toHaveLength(1);
            expect(within(block).getByRole('button', {name: 'q2: 0'})).toBeTruthy();
        });

        it('moves focus to the reply once the answered card goes', () => {
            const chatModel = createChat(
                    [reply([waiting('q1')], {status: 'paused'})],
                    [counterTool]
                ),
                {container} = renderChat(chatModel),
                answer = within(timeline(container)).getByRole('button', {name: 'q1: 0'});
            act(() => answer.focus());

            act(() =>
                setMessages(chatModel, [
                    reply([call('q1', {toolName: 'ask', output: 'ok'})], {status: 'paused'})
                ])
            );
            expect(timeline(container).querySelector('.xh-chat-tool-call')).toBeNull();
            expect(document.activeElement).toBe(container.querySelector('.xh-chat-message'));
        });

        it('holds a question card until a pending approval is decided', () => {
            const parts = (approval: ChatToolCallState) => [
                    call('c1', {state: approval, toolName: 'insert_rows'}),
                    waiting('q1')
                ],
                tools = [counterTool, {name: 'insert_rows', display: 'timeline' as const}],
                chatModel = createChat(
                    [reply(parts('approval-requested'), {status: 'paused'})],
                    tools
                ),
                {container} = renderChat(chatModel),
                block = timeline(container);

            expect(lineButton(container).textContent).toContain('Waiting for approval');
            expect(within(block).getByRole('button', {name: 'Allow'})).toBeTruthy();
            expect(within(block).queryByRole('button', {name: 'q1: 0'})).toBeNull();

            act(() =>
                setMessages(chatModel, [reply(parts('output-available'), {status: 'paused'})])
            );
            expect(lineButton(container).textContent).toContain('Waiting for your answer');
            expect(within(block).queryByRole('button', {name: 'Allow'})).toBeNull();
            expect(within(block).getByRole('button', {name: 'q1: 0'})).toBeTruthy();
        });

        it('shows an answered call as a done row that opens to its renderer', () => {
            const {container} = renderReply(
                [call('q1', {toolName: 'ask', output: 'Intraday'})],
                {},
                {status: 'complete'},
                [
                    {
                        name: 'ask',
                        display: 'timeline',
                        interactive: true,
                        displayName: 'Choose marks',
                        renderer: part => `Chose ${part.output}`
                    }
                ]
            );
            fireEvent.click(lineButton(container));

            const row = screen.getByRole('treeitem');
            expect(row.getAttribute('aria-label')).toBe('Choose marks, Rates, done');
            fireEvent.keyDown(row, {key: 'Enter'});
            expect(row.textContent).toContain('Chose Intraday');
        });
    });

    describe('nested sub-agents', () => {
        it('names the parent of a row nested past the deepest indent', () => {
            const {container} = renderReply([
                agentPart('a0', 'Planner'),
                agentPart('a1', 'Researcher', 'a0'),
                agentPart('a2', 'Reader', 'a1'),
                agentPart('a3', 'Limits Checker', 'a2'),
                {...call('c1', {state: 'running', toolName: 'fetch_marks'}), subagentRunId: 'a3'}
            ]);
            fireEvent.click(lineButton(container));

            const row = screen
                .getAllByRole('treeitem')
                .find(it => it.getAttribute('data-id') === 'c1');
            expect(row.getAttribute('aria-level')).toBe(String(TIMELINE_MAX_DEPTH + 2));
            expect(row.querySelector('.xh-chat-timeline__parent').textContent).toBe(
                '› Limits Checker '
            );
            // Rows within the indent name no parent.
            expect(container.querySelectorAll('.xh-chat-timeline__parent')).toHaveLength(1);
        });
    });

    describe('in a narrow column', () => {
        it('takes the narrow layout, dropping the step count and shortening its words', () => {
            vi.stubGlobal('ResizeObserver', resizeObserverOf(380));
            const running = renderReply([call('c1'), call('c2', {state: 'running'})]);
            expect(timeline(running.container).classList).toContain('xh-chat-timeline--narrow');
            expect(lineButton(running.container).textContent).not.toContain('steps');
            running.unmount();

            const done = renderReply(
                [
                    {
                        type: 'data',
                        id: 'agent1',
                        dataType: 'xh.chat.subagent',
                        data: {name: 'Checker', status: 'complete'}
                    },
                    {...call('c1', {state: 'output-error'}), subagentRunId: 'agent1'},
                    call('c2')
                ],
                {},
                {status: 'complete'}
            );
            const head = lineButton(done.container);
            expect(head.textContent).toContain('Used 2 tools, 1 agent');
            expect(head.querySelector('.xh-chat-timeline__fails').textContent).toBe('1');
        });
    });
});

//------------------
// Helpers
//------------------
/** A ResizeObserver that reports one width as soon as it observes an element. */
function resizeObserverOf(width: number) {
    return class {
        constructor(private callback: ResizeObserverCallback) {}
        observe(el: Element) {
            this.callback(
                [{contentRect: {width, height: 28}} as ResizeObserverEntry],
                this as unknown as ResizeObserver
            );
            return el;
        }
        unobserve() {}
        disconnect() {}
    };
}

/** Send one message over a scripted response, and render the list once its turn ends. */
async function runScript(response: ScriptedItem[]) {
    const model = new ChatModel({
        transport: new ScriptedChatTransport({responses: [response], delayMs: 0}),
        tools: TOOLS
    });
    onTestFinished(() => model.destroy());
    const result = render(chatMessageList({model}));
    await act(() => model.sendAsync('Check the desks.'));
    return result;
}

async function runAgent({assistantName}: {assistantName?: string} = {}) {
    const model = new ChatModel({
        transport: new ScriptedChatTransport({responses: [agentRunScript()], delayMs: 0}),
        tools: AGENT_RUN_TOOLS
    });
    onTestFinished(() => model.destroy());
    const result = render(chatMessageList({model, assistantName}));
    await act(() => model.sendAsync('Check every desk against its gross limit.'));
    expect(model.messages[1].status).toBe('complete');
    return result;
}

const TOOLS: ChatToolSpec[] = [
    {name: 'lookup', display: 'timeline'},
    {name: 'load', display: 'timeline'},
    {name: 'fetch_marks', display: 'timeline'}
];

interface ChatState {
    /** Epoch millis of the chat's last activity, or null. */
    lastActivityAt?: number;
    stallAfterMs?: number;
}

/** A chat that shows the messages, with its decisions on calls spied on. */
function createChat(
    messages: ChatMessage[],
    tools: ChatToolSpec[] = [],
    {lastActivityAt = null, stallAfterMs}: ChatState = {}
): ChatModel {
    const chatModel = new ChatModel({
        transport: new ScriptedChatTransport(),
        tools: [...TOOLS, ...tools],
        stallAfterMs
    });
    onTestFinished(() => chatModel.destroy());
    setMessages(chatModel, messages);
    vi.spyOn(chatModel, 'lastActivityAt', 'get').mockReturnValue(lastActivityAt);
    vi.spyOn(chatModel, 'approveToolCallAsync').mockResolvedValue();
    vi.spyOn(chatModel, 'denyToolCallAsync').mockResolvedValue();
    vi.spyOn(chatModel, 'addToolOutputAsync').mockResolvedValue();
    return chatModel;
}

// Show messages as a streamed change would.
function setMessages(chatModel: ChatModel, messages: ChatMessage[]) {
    runInAction(() => {
        chatModel.messages = messages;
    });
}

function renderChat(chatModel: ChatModel) {
    return render(chatMessageList({model: chatModel}));
}

function showSummaryFailureCount(value: boolean) {
    const {defaults} = ChatTimeline;
    defaults.showSummaryFailureCount = value;
    onTestFinished(() => {
        defaults.showSummaryFailureCount = true;
    });
}

function renderReply(
    parts: ChatPart[],
    chatState: ChatState = {},
    replyProps: Partial<ChatMessageSpec> = {status: 'streaming'},
    tools: ChatToolSpec[] = []
) {
    return renderChat(createChat([reply(parts, replyProps)], tools, chatState));
}

function reply(parts: ChatPart[], rest: Partial<ChatMessageSpec> = {}): ChatMessage {
    return new ChatMessage({id: 'a1', role: 'assistant', parts, ...rest});
}

function text(id: string, content: string): ChatPart {
    return {type: 'text', id, text: content, state: 'done'};
}

function call(
    id: string,
    {
        toolName = 'lookup',
        state = 'output-available',
        input = {desk: 'Rates'},
        output = null
    }: {toolName?: string; state?: ChatToolCallState; input?: any; output?: any} = {}
): ChatToolCallPart {
    return {
        type: 'toolCall',
        id,
        toolName,
        state,
        step: 0,
        inputText: JSON.stringify(input),
        input,
        output,
        errorText: state === 'output-error' ? '504 Timeout' : null
    };
}

/** A call to {@link counterTool} that waits for an answer. */
function waiting(id: string): ChatToolCallPart {
    return call(id, {state: 'input-available', toolName: 'ask'});
}

function agentPart(id: string, name: string, parentSubagentRunId: string = null): ChatPart {
    return {
        type: 'data',
        id,
        dataType: 'xh.chat.subagent',
        data: {name, status: 'running', startedAt: 1000, parentSubagentRunId}
    };
}

class AppStandInModel extends HoistModel {}

// A Hoist app always renders inside the context of its models.
const appContext = hoistCmp.factory({
    displayName: 'TestAppContext',
    model: creates(AppStandInModel),
    render: ({children}) => fragment(children)
});

/** A button that counts its clicks in hook state, labeled with its call's id. */
const counter = hoistCmp.factory<HoistProps & {id: string}>({
    model: false,
    render({id}) {
        const [count, setCount] = useState(0);
        return button({text: `${id}: ${count}`, onClick: () => setCount(count + 1)});
    }
});

/** An interactive timeline tool whose renderer keeps state of its own. */
const counterTool: ChatToolSpec = {
    name: 'ask',
    display: 'timeline',
    interactive: true,
    renderer: part => counter({id: part.id})
};

function timeline(container: HTMLElement): HTMLElement {
    return container.querySelector('.xh-chat-timeline');
}

function lineButton(container: HTMLElement): HTMLElement {
    return container.querySelector('.xh-chat-timeline__head');
}
