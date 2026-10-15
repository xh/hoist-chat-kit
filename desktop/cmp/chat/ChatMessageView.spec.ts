import {act, fireEvent, render, screen} from '@testing-library/react';
import {fragment} from '@xh/hoist/cmp/layout';
import {creates, hoistCmp, HoistModel} from '@xh/hoist/core';
import {initTestAppAsync} from '@xh/hoist/test-support';
import {beforeAll, beforeEach, describe, expect, it, onTestFinished, vi} from 'vitest';
import {
    ChatMessage,
    type ChatMessageListHost,
    type ChatMessageSpec,
    ChatModel,
    type ChatModelConfig,
    type ChatPart
} from '../../../core';
import {type ChatTransport, ScriptedChatTransport} from '../../../transport';
import {chatMessageList, type ChatMessageListProps} from './ChatMessageList';

/**
 * How a message shows how its turn ended, and which actions it offers. Users rely on a failure
 * showing once, inline, with a way to edit the prompt, on "Not sent" for a message that never
 * left, and on the action bar offering only what can work. Apps rely on the views showing any
 * host that has the members they read - not only a ChatModel.
 */
describe('ChatMessageView', () => {
    beforeAll(() => initTestAppAsync());

    beforeEach(() => {
        vi.stubGlobal('ResizeObserver', NoopResizeObserver);
        Element.prototype.scrollTo ??= () => {};
    });

    describe('a failed reply', () => {
        it('shows what happened inline, keeping any text, with Edit Prompt and no Try Again', () => {
            const chatModel = createModel({}, [
                question(),
                failedReply({parts: [text('t1', 'Partial answer')], errorCode: 'model_timeout'})
            ]);
            const {container} = renderList(chatModel);

            const row = container.querySelector('.xh-chat-message__failed');
            // The status region announces the failure, so the row has no live role (D65).
            expect(row.getAttribute('role')).toBeNull();
            expect(row.getAttribute('aria-live')).toBeNull();
            expect(row.textContent).toContain('The reply failed.');
            expect(row.textContent).toContain('Model request timed out.');
            expect(screen.getByText('Partial answer')).toBeTruthy();
            expect(screen.getByRole('button', {name: /Edit Prompt/})).toBeTruthy();
            expect(screen.queryByRole('button', {name: /Try Again|Retry/})).toBeNull();
        });

        it('offers Copy Details, and no thumbs or Regenerate', () => {
            const chatModel = createModel({feedback: {submitAsync: vi.fn()}}, [
                question(),
                failedReply({errorCode: 'model_timeout'})
            ]);
            renderList(chatModel);

            expect(screen.getByRole('button', {name: 'Copy Details'})).toBeTruthy();
            expect(screen.queryByRole('button', {name: 'Regenerate'})).toBeNull();
            expect(screen.queryByRole('button', {name: 'Good response'})).toBeNull();
        });

        it('opens the user message that asked for it in edit on Edit Prompt', () => {
            const chatModel = createModel({}, [question(), failedReply({errorCode: 'x'})]);
            renderList(chatModel);

            fireEvent.click(screen.getByRole('button', {name: /Edit Prompt/}));

            const box = screen.getByRole('textbox', {name: 'Edit message'}) as HTMLInputElement;
            expect(box.value).toBe('What is the limit?');
        });

        it('gives an older failed reply no live role either', () => {
            const chatModel = createModel({}, [
                question('u1'),
                failedReply({id: 'a1', errorCode: 'x'}),
                question('u2'),
                reply('a2', [text('t2', 'Answer')])
            ]);
            const {container} = renderList(chatModel);

            const row = container.querySelector('.xh-chat-message__failed');
            expect(row).toBeTruthy();
            expect(row.getAttribute('role')).toBeNull();
        });
    });

    describe('a fixed "not found" reply', () => {
        const NO_ANSWER: ChatPart = {
            type: 'data',
            id: 'n1',
            dataType: 'xh.chat.noAnswer',
            data: {
                documents: [
                    'Credit Guidelines v4',
                    'Reserves Policy',
                    'Investor Overlay',
                    'Seasoning'
                ].map(name => ({name})),
                documentCount: 4
            }
        };
        const SOURCE: ChatPart = {type: 'source', id: 's1', title: 'Reserves Policy', marker: 1};

        it('renders the fixed template, listing three documents searched and a count of the rest', () => {
            const chatModel = createModel({}, [question(), reply('a1', [NO_ANSWER])]),
                {container} = renderList(chatModel);

            const frame = container.querySelector('.xh-chat-no-answer');
            expect(frame.textContent).toContain('Not found in the selected documents');
            expect(frame.textContent).toContain('Fixed reply');
            expect(frame.textContent).toContain(
                "I couldn't find this in the 4 documents searched, so I haven't answered."
            );
            expect(frame.querySelector('.xh-chat-no-answer__scope-names').textContent).toBe(
                'Searched: Credit Guidelines v4, Reserves Policy, Investor Overlay +1'
            );
        });

        it('shows no sources list and no Regenerate, and keeps only the thumbs down', () => {
            const chatModel = createModel({feedback: {submitAsync: vi.fn()}}, [
                    question(),
                    reply('a1', [NO_ANSWER, SOURCE])
                ]),
                {container} = renderList(chatModel);

            expect(container.querySelector('.xh-chat-sources')).toBeNull();
            expect(screen.queryByRole('button', {name: 'Regenerate'})).toBeNull();
            expect(screen.queryByRole('button', {name: 'Good response'})).toBeNull();
            expect(screen.getByRole('button', {name: 'It is in these documents'})).toBeTruthy();
        });

        it('opens the question in edit on Edit Question', () => {
            const chatModel = createModel({}, [question(), reply('a1', [NO_ANSWER])]);
            renderList(chatModel);

            fireEvent.click(screen.getByRole('button', {name: 'Edit Question'}));
            const box = screen.getByRole('textbox', {name: 'Edit message'}) as HTMLInputElement;
            expect(box.value).toBe('What is the limit?');
        });

        it("gives way to the app's own renderer for the type", () => {
            const chatModel = createModel(
                    {dataRenderers: {'xh.chat.noAnswer': () => 'App not found'}},
                    [question(), reply('a1', [NO_ANSWER])]
                ),
                {container} = renderList(chatModel);

            expect(container.querySelector('.xh-chat-no-answer')).toBeNull();
            expect(screen.getByText('App not found')).toBeTruthy();
        });
    });

    describe('a message that was never sent', () => {
        it('shows "Not sent" with Edit under the user message, and no reply', () => {
            const chatModel = createModel({}, [
                question(),
                failedReply({error: "You're offline.", parts: []})
            ]);
            const {container} = renderList(chatModel);

            const notSent = container.querySelector('.xh-chat-message__not-sent');
            expect(notSent.textContent).toContain('Not sent.');
            expect(notSent.textContent).toContain("You're offline.");
            expect(notSent.getAttribute('role')).toBeNull();
            expect(container.querySelector('.xh-chat-message--assistant')).toBeNull();
            expect(screen.getByRole('button', {name: 'Edit'})).toBeTruthy();
            expect(screen.queryByRole('button', {name: 'Copy'})).toBeNull();
        });

        it('shows "Not sent" when the request fails before the run starts', async () => {
            const transport: ChatTransport = {
                    // eslint-disable-next-line require-yield
                    async *run() {
                        throw new Error('Network unreachable.');
                    }
                },
                chatModel = createModel({transport}, []);
            const {container} = renderList(chatModel);

            await act(() => chatModel.sendAsync('Hello'));

            expect(container.querySelector('.xh-chat-message__not-sent').textContent).toContain(
                'Network unreachable.'
            );
            expect(container.querySelector('.xh-chat-message__failed')).toBeNull();
        });

        it('shows a failed row, not "Not sent", once the run has started', () => {
            const chatModel = createModel({}, [
                question(),
                failedReply({parts: [], errorCode: 'model_timeout'})
            ]);
            const {container} = renderList(chatModel);

            expect(container.querySelector('.xh-chat-message__not-sent')).toBeNull();
            expect(container.querySelector('.xh-chat-message__failed')).toBeTruthy();
        });
    });

    describe('how a reply ended', () => {
        it('notes a reply the user stopped, quietly', () => {
            const chatModel = createModel({}, [
                question(),
                reply('a1', [text('t1', 'Partial')], {status: 'aborted'})
            ]);
            const {container} = renderList(chatModel);

            const notice = container.querySelector('.xh-chat-message__notice');
            expect(notice.textContent).toBe('Stopped');
            expect(notice.classList.contains('xh-chat-message__notice--warning')).toBe(false);
        });

        it('warns of a reply cut off at the length limit', () => {
            const chatModel = createModel({}, [
                question(),
                reply('a1', [text('t1', 'Long')], {metadata: {finishReason: 'length'}})
            ]);
            const {container} = renderList(chatModel);

            expect(container.querySelector('.xh-chat-message__notice--warning').textContent).toBe(
                'Cut off at the length limit.'
            );
        });

        it("warns of a run the server interrupted, with the server's reason", () => {
            const chatModel = createModel({}, [
                question(),
                failedReply({errorCode: 'interrupted', error: 'The server restarted.'})
            ]);
            const {container} = renderList(chatModel);

            const notice = container.querySelector('.xh-chat-message__notice--warning');
            expect(notice.textContent).toContain('Interrupted');
            expect(notice.textContent).toContain('The server restarted.');
            expect(container.querySelector('.xh-chat-message__failed')).toBeNull();
        });
    });

    describe('the header', () => {
        it('counts failed tools of a finished reply', () => {
            const chatModel = createModel({}, [
                question(),
                reply('a1', [
                    {
                        type: 'toolCall',
                        id: 'c1',
                        toolName: 'compute_var',
                        state: 'output-error',
                        inputText: '{}',
                        input: {},
                        output: null,
                        errorText: 'ModuleNotFoundError: scipy\nTraceback...'
                    },
                    text('t1', 'Could not compute it.')
                ])
            ]);
            const {container} = renderList(chatModel);

            expect(header(container).textContent).toContain('1 tool failed');
            // The row shows the first line of the error only.
            expect(container.querySelector('.xh-chat-tool-call__detail').textContent).toBe(
                'ModuleNotFoundError: scipy'
            );
        });

        it("flags a reply that finished before the host's last data refresh", () => {
            const message = new ChatMessage({
                    id: 'a1',
                    role: 'assistant',
                    parts: [text('t1', 'Answer')],
                    createdAt: 1000,
                    metadata: {elapsedMs: 500}
                }),
                {container} = renderList(null, {
                    host: {messages: [message], isBusy: false, dataRefreshedAt: 2000}
                });

            expect(header(container).textContent).toContain('Data refreshed since');
        });
    });

    describe('the action bar', () => {
        it('waits for the turn to end, including a turn paused for the user', () => {
            const chatModel = createModel({}, [
                question(),
                reply('a1', [text('t1', 'Partial')], {status: 'paused'})
            ]);
            const {container} = renderList(chatModel);

            const assistant = container.querySelector('.xh-chat-message--assistant');
            expect(assistant).toBeTruthy();
            expect(assistant.querySelector('.xh-chat-message__actions')).toBeNull();
        });

        it('offers Regenerate on the last reply only', () => {
            const chatModel = createModel({}, [
                question('u1'),
                reply('a1', [text('t1', 'First')]),
                question('u2'),
                reply('a2', [text('t2', 'Second')])
            ]);
            const {container} = renderList(chatModel);

            const bars = container.querySelectorAll('.xh-chat-message--assistant');
            expect(bars[0].querySelector('[aria-label="Regenerate"]')).toBeNull();
            expect(bars[1].querySelector('[aria-label="Regenerate"]')).toBeTruthy();
            expect(bars[1].classList.contains('xh-chat-message--last')).toBe(true);
        });

        it('saves an up rating at once, keeps the chosen thumb shown, and clears it on a click', async () => {
            const submitAsync = vi.fn(() => Promise.resolve()),
                chatModel = createModel({feedback: {submitAsync}}, [
                    question(),
                    reply('a1', [text('t1', 'Answer')])
                ]);
            renderList(chatModel);

            const up = screen.getByRole('button', {name: 'Good response'});
            await act(() => fireEvent.click(up));

            expect(submitAsync).toHaveBeenLastCalledWith(
                expect.objectContaining({messageId: 'a1', rating: 'positive'})
            );
            expect(up.getAttribute('aria-pressed')).toBe('true');
            expect(up.classList.contains('xh-chat-message__thumb--chosen')).toBe(true);

            await act(() => fireEvent.click(up));
            expect(submitAsync).toHaveBeenLastCalledWith(expect.objectContaining({rating: null}));
            expect(up.getAttribute('aria-pressed')).toBe('false');
        });

        it('saves a down rating that requires a comment only once the comment is sent', async () => {
            const submitAsync = vi.fn(() => Promise.resolve()),
                chatModel = createModel(
                    {feedback: {submitAsync, commentOn: 'negative', requireComment: true}},
                    [question(), reply('a1', [text('t1', 'Answer')])]
                );
            renderList(chatModel);

            await act(() => fireEvent.click(screen.getByRole('button', {name: 'Bad response'})));
            expect(submitAsync).not.toHaveBeenCalled();

            const send = screen.getByRole('button', {name: 'Send Feedback'}) as HTMLButtonElement;
            expect(send.disabled).toBe(true);

            fireEvent.change(screen.getByRole('textbox', {name: 'What went wrong?'}), {
                target: {value: 'Wrong section.'}
            });
            await act(() => fireEvent.click(send));

            expect(submitAsync).toHaveBeenCalledOnce();
            expect(submitAsync).toHaveBeenCalledWith(
                expect.objectContaining({rating: 'negative', comment: 'Wrong section.'})
            );
            expect(screen.queryByRole('group', {name: 'What went wrong?'})).toBeNull();
        });

        it('restores the earlier state when a pending comment form is cancelled', async () => {
            const submitAsync = vi.fn(() => Promise.resolve()),
                chatModel = createModel({feedback: {submitAsync, requireComment: true}}, [
                    question(),
                    reply('a1', [text('t1', 'Answer')])
                ]);
            renderList(chatModel);

            const down = screen.getByRole('button', {name: 'Bad response'});
            await act(() => fireEvent.click(down));
            expect(down.getAttribute('aria-pressed')).toBe('true');

            fireEvent.click(screen.getByRole('button', {name: 'Cancel'}));
            expect(down.getAttribute('aria-pressed')).toBe('false');
            expect(submitAsync).not.toHaveBeenCalled();
        });
    });

    describe('over a plain host', () => {
        it('shows messages, and hides every action the host does not offer', () => {
            const host: ChatMessageListHost = {
                messages: [
                    new ChatMessage({id: 'u1', role: 'user', parts: [text('t0', 'Question')]}),
                    new ChatMessage({id: 'a1', role: 'assistant', parts: [text('t1', 'Answer')]})
                ],
                isBusy: false
            };
            renderList(null, {host});

            expect(screen.getByText('Question')).toBeTruthy();
            expect(screen.getByText('Answer')).toBeTruthy();
            expect(screen.getAllByRole('button', {name: 'Copy'})).toHaveLength(2);
            for (const name of ['Edit', 'Regenerate', 'Good response', 'Undo changes']) {
                expect(screen.queryByRole('button', {name})).toBeNull();
            }
        });

        it("calls the host's actions", async () => {
            const host: ChatMessageListHost = {
                messages: [
                    new ChatMessage({id: 'u1', role: 'user', parts: [text('t0', 'Question')]}),
                    new ChatMessage({id: 'a1', role: 'assistant', parts: [text('t1', 'Answer')]})
                ],
                isBusy: false,
                regenerateAsync: vi.fn(() => Promise.resolve()),
                editMessageAsync: vi.fn(() => Promise.resolve()),
                canSubmitFeedback: true,
                submitFeedbackAsync: vi.fn(() => Promise.resolve())
            };
            renderList(null, {host});

            fireEvent.click(screen.getByRole('button', {name: 'Regenerate'}));
            expect(host.regenerateAsync).toHaveBeenCalledWith('a1');

            await act(() => fireEvent.click(screen.getByRole('button', {name: 'Good response'})));
            expect(host.submitFeedbackAsync).toHaveBeenCalledWith(
                'a1',
                'positive',
                undefined,
                undefined
            );

            fireEvent.click(screen.getByRole('button', {name: 'Edit'}));
            fireEvent.change(screen.getByRole('textbox', {name: 'Edit message'}), {
                target: {value: 'New question'}
            });
            fireEvent.click(screen.getByRole('button', {name: /Save and Resend/}));
            expect(host.editMessageAsync).toHaveBeenCalledWith('u1', 'New question');
        });

        it('gives part renderers a context with no chatModel', () => {
            const renderer = vi.fn(() => null),
                host: ChatMessageListHost = {
                    messages: [
                        new ChatMessage({
                            id: 'a1',
                            role: 'assistant',
                            parts: [{type: 'data', id: 'd1', dataType: 'test.card', data: {}}]
                        })
                    ],
                    isBusy: false,
                    dataRenderers: {'test.card': renderer}
                };
            renderList(null, {host});

            expect(renderer).toHaveBeenCalledWith(expect.objectContaining({id: 'd1'}), {
                chatModel: null,
                messageId: 'a1'
            });
        });

        it('stops a busy reply on Escape, and moves between messages on Up and Down', () => {
            const host: ChatMessageListHost = {
                messages: [
                    new ChatMessage({id: 'u1', role: 'user', parts: [text('t0', 'Question')]}),
                    new ChatMessage({
                        id: 'a1',
                        role: 'assistant',
                        parts: [text('t1', 'Ans')],
                        status: 'streaming'
                    })
                ],
                isBusy: true,
                stop: vi.fn()
            };
            renderList(null, {host});

            const [user, assistant] = screen.getAllByRole('article');
            assistant.focus();
            fireEvent.keyDown(assistant, {key: 'ArrowUp'});
            expect(document.activeElement).toBe(user);

            fireEvent.keyDown(user, {key: 'Escape'});
            expect(host.stop).toHaveBeenCalledOnce();
        });

        it('is satisfied by ChatModel', () => {
            const chatModel = createModel({}, []),
                host: ChatMessageListHost = chatModel;
            expect(host.messages).toBe(chatModel.messages);
        });
    });

    describe('parts', () => {
        it('collapses reasoning by default, and opens it in place', () => {
            const chatModel = createModel({}, [
                question(),
                reply('a1', [
                    {
                        type: 'reasoning',
                        id: 'r1',
                        text: 'Check the limits table.',
                        state: 'done',
                        startedAt: 0,
                        endedAt: 3000
                    },
                    text('t1', 'Answer')
                ])
            ]);
            renderList(chatModel);

            const toggle = screen.getByRole('button', {name: /Thought for 3/});
            expect(toggle.getAttribute('aria-expanded')).toBe('false');
            expect(screen.queryByText('Check the limits table.')).toBeNull();

            fireEvent.click(toggle);
            expect(screen.getByText('Check the limits table.')).toBeTruthy();
        });

        it('stacks reasoning and tool rows in one process block, ended by text', () => {
            const chatModel = createModel({}, [
                question(),
                reply('a1', [
                    {
                        type: 'reasoning',
                        id: 'r1',
                        text: 'Plan.',
                        state: 'done',
                        startedAt: 0,
                        endedAt: 10
                    },
                    toolCall('c1', 0),
                    text('t1', 'Between'),
                    toolCall('c2', 1)
                ])
            ]);
            const {container} = renderList(chatModel);

            const blocks = container.querySelectorAll('.xh-chat-message__process');
            expect(blocks).toHaveLength(2);
            expect(blocks[0].querySelector('.xh-chat-reasoning')).toBeTruthy();
            expect(blocks[0].querySelector('.xh-chat-tool-call')).toBeTruthy();
        });

        it('shows the first 20 lines of a long code block, with a button for the rest', () => {
            const lines = Array.from({length: 25}, (_, idx) => `line ${idx + 1}`).join('\n'),
                chatModel = createModel({}, [
                    question(),
                    reply('a1', [text('t1', '```sql\n' + lines + '\n```')])
                ]);
            const {container} = renderList(chatModel);

            const code = () => container.querySelector('.xh-chat-code-block__body').textContent;
            expect(code()).toContain('line 20');
            expect(code()).not.toContain('line 21');

            fireEvent.click(screen.getByRole('button', {name: 'Show 5 more lines'}));
            expect(code()).toContain('line 25');
        });

        it('scrolls a markdown table of more than 12 rows inside its frame', () => {
            const table = (rows: number) =>
                    ['| A |', '|---|', ...Array.from({length: rows}, (_, i) => `| ${i} |`)].join(
                        '\n'
                    ),
                chatModel = createModel({}, [
                    question(),
                    reply('a1', [text('t1', `${table(12)}\n\nThen:\n\n${table(13)}`)])
                ]);
            const {container} = renderList(chatModel);

            const tables = container.querySelectorAll('.xh-chat-markdown table');
            expect(tables).toHaveLength(2);
            expect(tables[0].classList.contains('xh-chat-markdown__table--scroll')).toBe(false);
            expect(tables[1].classList.contains('xh-chat-markdown__table--scroll')).toBe(true);
        });
    });
});

//------------------
// Helpers
//------------------
class NoopResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
}

function createModel(config: Partial<ChatModelConfig>, initialMessages: ChatMessageSpec[]) {
    const model = new ChatModel({
        transport: new ScriptedChatTransport(),
        initialMessages,
        ...config
    });
    onTestFinished(() => model.destroy());
    return model;
}

function renderList(chatModel: ChatModel, props: Partial<ChatMessageListProps> = {}) {
    return render(
        chatModel
            ? chatMessageList({model: chatModel, ...props})
            : appContext({item: chatMessageList(props)})
    );
}

class AppStandInModel extends HoistModel {}

// A Hoist app always renders inside the context of its models. Show a plain host in one too, as
// an app does, with no ChatModel in it.
const appContext = hoistCmp.factory({
    displayName: 'TestAppContext',
    model: creates(AppStandInModel),
    render: ({children}) => fragment(children)
});

function header(container: HTMLElement): HTMLElement {
    return container.querySelector('.xh-chat-message--assistant .xh-chat-message__header');
}

function question(id: string = 'u1'): ChatMessageSpec {
    return {id, role: 'user', parts: [text(`${id}-t`, 'What is the limit?')]};
}

function reply(
    id: string,
    parts: ChatPart[],
    rest: Partial<ChatMessageSpec> = {}
): ChatMessageSpec {
    return {id, role: 'assistant', parts, ...rest};
}

function failedReply({
    id = 'a1',
    parts = [],
    error = 'Model request timed out.',
    errorCode = null
}: {
    id?: string;
    parts?: ChatPart[];
    error?: string;
    errorCode?: string;
}): ChatMessageSpec {
    return {
        id,
        role: 'assistant',
        parts,
        status: 'error',
        error,
        metadata: errorCode ? {errorCode} : {}
    };
}

function text(id: string, content: string): ChatPart {
    return {type: 'text', id, text: content, state: 'done', step: 0};
}

function toolCall(id: string, step: number): ChatPart {
    return {
        type: 'toolCall',
        id,
        toolName: 'run_sql',
        state: 'output-available',
        step,
        inputText: '{}',
        input: {},
        output: 'ok',
        errorText: null
    };
}
