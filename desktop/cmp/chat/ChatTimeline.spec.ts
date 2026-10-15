import {act, fireEvent, render, screen, within} from '@testing-library/react';
import {runInAction} from '@xh/hoist/mobx';
import {initTestAppAsync} from '@xh/hoist/test-support';
import {afterEach, beforeAll, beforeEach, describe, expect, it, onTestFinished, vi} from 'vitest';
import {
    chatAnnouncer,
    ChatKit,
    ChatMessage,
    type ChatMessageSpec,
    ChatModel,
    type ChatPart,
    type ChatToolCallPart,
    type ChatToolCallState,
    type ChatToolSpec
} from '../../../core';
import {
    errorEvents,
    ScriptedChatTransport,
    scriptedDelay,
    type ScriptedItem,
    toolCallEvents
} from '../../../transport';
import {AGENT_RUN_TOOLS, agentRunScript} from '../../../test/fixtures/agentRunScript';
import {chatMessageList} from './ChatMessageList';

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

        it('opens to the pinned plan and a tree of rows: calls, narration, a batch and a sub-agent', async () => {
            const {container} = await runAgent();
            fireEvent.click(lineButton(container));

            const block = timeline(container);
            expect(lineButton(container).getAttribute('aria-expanded')).toBe('true');
            expect(within(block).getByRole('list', {name: 'Plan, 3 of 3'})).toBeTruthy();

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
            // The plan's calls are not tools, and narration is not the answer.
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

        it('announces every step with announceSteps "all", and none with "none"', () => {
            const announce = vi.spyOn(chatAnnouncer, 'announce'),
                running = [call('c1', {state: 'running'})],
                done = [{...call('c1'), startedAt: 1000, endedAt: 4100}];
            ChatKit.defaults.announceSteps = 'all';
            onTestFinished(() => {
                ChatKit.defaults.announceSteps = 'failures';
            });

            const chatModel = createChat([reply(running, {status: 'streaming'})]);
            renderChat(chatModel);
            act(() => setMessages(chatModel, [reply(done, {status: 'streaming'})]));
            expect(announce).toHaveBeenLastCalledWith('Step 1 done: Lookup, 3.1s.');

            ChatKit.defaults.announceSteps = 'none';
            act(() =>
                setMessages(chatModel, [
                    reply([...done, call('c2', {state: 'output-error'})], {status: 'streaming'})
                ])
            );
            expect(announce).toHaveBeenCalledTimes(1);
        });

        it('takes announceSteps from the message list, and counts steps across blocks', () => {
            const announce = vi.spyOn(chatAnnouncer, 'announce'),
                card = call('k1', {toolName: 'show_card'}),
                chatModel = createChat(
                    [
                        reply([call('c1'), card, call('c2', {state: 'running'})], {
                            status: 'streaming'
                        })
                    ],
                    [{name: 'show_card', display: 'card'}]
                );
            render(chatMessageList({model: chatModel, announceSteps: 'all'}));

            act(() =>
                setMessages(chatModel, [
                    reply([call('c1'), card, {...call('c2'), startedAt: 1000, endedAt: 2000}], {
                        status: 'streaming'
                    })
                ])
            );
            expect(announce.mock.calls.map(it => it[0])).toEqual(['Step 2 done: Lookup, 1.0s.']);
        });

        it('announces a failed call shown as a card under the default "failures"', () => {
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

        it('offers up to three choices as buttons, and answers with the one chosen', () => {
            const chatModel = createChat(
                [
                    reply(
                        [
                            call('c1'),
                            call('q1', {
                                state: 'input-available',
                                toolName: 'ask',
                                input: {
                                    question: 'Which marks should I use?',
                                    choices: ['Intraday', 'Prior Close', 'Official EOD']
                                }
                            })
                        ],
                        {status: 'paused'}
                    )
                ],
                [{name: 'ask', display: 'timeline', interactive: true}]
            );
            const {container} = renderChat(chatModel),
                question = within(timeline(container)).getByRole('group', {name: 'Question'});

            expect(lineButton(container).textContent).toContain('Waiting for your answer');
            expect(question.textContent).toContain('Which marks should I use?');
            expect(
                within(question)
                    .getAllByRole('button')
                    .map(it => it.textContent)
            ).toEqual(['Intraday', 'Prior Close', 'Official EOD']);

            fireEvent.click(within(question).getByRole('button', {name: 'Intraday'}));
            expect(chatModel.addToolOutputAsync).toHaveBeenCalledWith('q1', 'Intraday');
        });

        it('shows an answered question as one row with the answer as a token', () => {
            const {container} = renderReply(
                [call('q1', {toolName: 'ask', output: 'Intraday'})],
                {},
                {status: 'complete'},
                [
                    {
                        name: 'ask',
                        display: 'timeline',
                        interactive: true,
                        displayName: 'Asked which marks'
                    }
                ]
            );
            fireEvent.click(lineButton(container));

            const row = screen.getByRole('treeitem');
            expect(row.getAttribute('aria-label')).toBe('Asked which marks, you chose Intraday');
            expect(row.querySelector('.xh-chat-timeline__chosen').textContent).toBe('Intraday');
            expect(row.getAttribute('aria-expanded')).toBeNull();
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

function timeline(container: HTMLElement): HTMLElement {
    return container.querySelector('.xh-chat-timeline');
}

function lineButton(container: HTMLElement): HTMLElement {
    return container.querySelector('.xh-chat-timeline__head');
}
