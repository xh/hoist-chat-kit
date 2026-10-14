import {act, fireEvent, render, screen} from '@testing-library/react';
import {div} from '@xh/hoist/cmp/layout';
import {button} from '@xh/hoist/desktop/cmp/button';
import {initTestAppAsync} from '@xh/hoist/test-support';
import {beforeAll, beforeEach, describe, expect, it, onTestFinished, vi} from 'vitest';
import {runInAction} from '@xh/hoist/mobx';
import {
    ChatMessage,
    type ChatMessageSpec,
    ChatModel,
    type ChatModelConfig,
    type ChatPart,
    type ChatTextPart,
    type ChatToolCallPart
} from '../../../core';
import {ScriptedChatTransport} from '../../../transport';
import {chatMessageList, type ChatMessageListProps} from './ChatMessageList';

/**
 * How the message list renders a conversation. Apps rely on runs of tool calls folding into one
 * row, on renderers mounting only when shown and receiving a render context that stays stable as
 * the message streams, on model-written images never loading by default, and on their own message
 * actions.
 */
describe('ChatMessageList', () => {
    beforeAll(() => initTestAppAsync());

    // jsdom has no layout, and so no ResizeObserver or element scrolling.
    beforeEach(() => {
        vi.stubGlobal('ResizeObserver', NoopResizeObserver);
        Element.prototype.scrollTo ??= () => {};
    });

    it('folds finished tool calls of one step into one row, which opens to show each call', () => {
        const chatModel = createModel({}, [
            reply([call('c1', 'get_weather'), call('c2', 'get_forecast'), call('c3', 'add_widget')])
        ]);
        renderList(chatModel);

        const header = screen.getByRole('button', {name: /Used 3 tools/});
        expect(header.getAttribute('aria-expanded')).toBe('false');
        expect(
            screen.queryByText('Get forecast', {selector: '.xh-chat-tool-call__title'})
        ).toBeNull();

        fireEvent.click(header);
        expect(
            screen.getByText('Get forecast', {selector: '.xh-chat-tool-call__title'})
        ).toBeTruthy();
    });

    it('mounts a tool renderer only while its card is open', () => {
        const renderer = vi.fn(() => div('Chart body')),
            chatModel = createModel({tools: [{name: 'chart', renderer}]}, [
                reply([call('c1', 'chart')])
            ]);
        renderList(chatModel);

        expect(screen.getByText('Chart body')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', {name: /Chart/, expanded: true}));
        expect(screen.queryByText('Chart body')).toBeNull();

        renderer.mockClear();
        act(() => loadReply(chatModel, [call('c1', 'chart'), text('t1', 'More')]));
        expect(renderer).not.toHaveBeenCalled();
    });

    it('renders a data part with a stable context, and skips it while other parts change', () => {
        const dataRenderer = vi.fn(() => div('Data')),
            dataPart: ChatPart = {type: 'data', id: 'd1', dataType: 'kpi', data: {}},
            chatModel = createModel({dataRenderers: {kpi: dataRenderer}}, [
                reply([dataPart, text('t1', 'One')])
            ]);
        renderList(chatModel);

        act(() => loadReply(chatModel, [dataPart, text('t1', 'One two')]));

        expect(dataRenderer).toHaveBeenCalledTimes(1);
        expect(dataRenderer).toHaveBeenCalledWith(dataPart, {chatModel, messageId: 'a1'});
    });

    it('shows a model-written image as a link unless images are allowed', () => {
        const markdown = '![chart](https://img.example/c.png)',
            chatModel = createModel({}, [reply([text('t1', markdown)])]),
            {rerender, container} = renderList(chatModel);

        expect(container.querySelector('img')).toBeNull();
        expect(screen.getByRole('link', {name: 'chart'}).getAttribute('href')).toBe(
            'https://img.example/c.png'
        );

        rerender(
            chatMessageList({model: chatModel, allowImages: src => src.startsWith('https://img.')})
        );
        expect(container.querySelector('img').getAttribute('src')).toBe(
            'https://img.example/c.png'
        );
    });

    it('renders no disclosure for reasoning with no text, and shows its time in the header', () => {
        const chatModel = createModel({}, [
            reply([
                {type: 'reasoning', id: 'r1', text: '', state: 'done', startedAt: 0, endedAt: 1200},
                text('t1', 'Answer')
            ])
        ]);
        const {container} = renderList(chatModel);

        expect(container.querySelector('.xh-chat-reasoning')).toBeNull();
        expect(screen.getByText('Thought for 1.2s')).toBeTruthy();
    });

    it('opens a group of tool calls while they run, and closes it once all are done', () => {
        const running = {...call('c2', 'get_forecast'), state: 'running' as const},
            chatModel = createModel({}, []);
        showLiveReply(chatModel, [call('c1', 'get_weather'), running]);
        renderList(chatModel);

        expect(
            screen.getByRole('button', {name: /Using 2 tools/}).getAttribute('aria-expanded')
        ).toBe('true');

        act(() => loadReply(chatModel, [call('c1', 'get_weather'), call('c2', 'get_forecast')]));
        expect(
            screen.getByRole('button', {name: /Used 2 tools/}).getAttribute('aria-expanded')
        ).toBe('false');
    });

    describe('inline tool calls', () => {
        const chartTool = {
            name: 'show_chart',
            displayName: 'Chart',
            display: 'inline' as const,
            renderer: () => div('Chart body')
        };

        it('shows the rendered output with no status once the input is complete', () => {
            const chatModel = createModel({tools: [chartTool]}, []);
            showLiveReply(chatModel, [{...call('c1', 'show_chart'), state: 'input-available'}]);
            const {container} = renderList(chatModel);

            expect(screen.getByText('Chart body')).toBeTruthy();
            expect(container.querySelector('.xh-chat-tool-call__caption-status')).toBeNull();
            expect(screen.queryByText(/Pending|Running/)).toBeNull();
            expect(container.querySelector('.xh-chat-tool-call__caption--quiet')).toBeTruthy();
        });

        it('shows a quiet status while the input streams', () => {
            const chatModel = createModel({tools: [chartTool]}, []);
            showLiveReply(chatModel, [{...call('c1', 'show_chart'), state: 'input-streaming'}]);
            renderList(chatModel);

            expect(screen.getByText('Rendering…')).toBeTruthy();
        });

        it('shows a short message on failure, with the error for the model behind View input', () => {
            const failed = {
                    ...call('c1', 'show_chart'),
                    state: 'output-error' as const,
                    errorText: 'Invalid props - nothing was shown. Fix and retry:\n- type: required'
                },
                chatModel = createModel({tools: [chartTool]}, [reply([failed])]);
            renderList(chatModel);

            expect(screen.getByText('Could not show the chart.')).toBeTruthy();
            expect(screen.queryByText(/Invalid props/)).toBeNull();

            fireEvent.click(screen.getByRole('button', {name: /View input/}));
            expect(screen.getByText(/Invalid props/)).toBeTruthy();
        });
    });

    it('asks for approval with the tool approvalPrompt, in place of the generic question', () => {
        const approval = {...call('c1', 'submit_order'), state: 'approval-requested' as const},
            chatModel = createModel(
                {
                    tools: [
                        {
                            name: 'submit_order',
                            execute: () => 'ok',
                            needsApproval: true,
                            approvalPrompt: input => `Sell 2,000 shares in ${input.city}?`
                        }
                    ]
                },
                [{...reply([approval]), status: 'paused'}]
            );
        renderList(chatModel);

        expect(screen.getByText('Sell 2,000 shares in Tokyo?')).toBeTruthy();
        expect(screen.queryByText('Allow this action to run?')).toBeNull();
        expect(screen.getByRole('button', {name: 'Approve'})).toBeTruthy();
    });

    it('places citation chips at the end of the last paragraph, not after a code block', () => {
        const cited: ChatTextPart = {
                type: 'text',
                id: 't1',
                state: 'done',
                text: 'Streams arrive as NDJSON.\n\n```groovy\nrender(lines)\n```',
                citations: [{id: 'c1', sourceId: 's1', title: 'Docs'}]
            },
            chatModel = createModel({}, [
                reply([cited, {type: 'source', id: 's1', url: 'https://xh.io', title: 'Docs'}])
            ]),
            {container} = renderList(chatModel);

        const chips = container.querySelector('.xh-chat-citations');
        expect(chips.closest('p').textContent).toBe('Streams arrive as NDJSON.1');
        expect(chips.textContent).toBe('1');
    });

    it('adds app message actions after the built-in ones, with the message and its context', () => {
        const messageActions = vi.fn(() => [button({key: 'up', text: 'Helpful'})]),
            chatModel = createModel({}, [reply([text('t1', 'Answer')])]);
        renderList(chatModel, {messageActions});

        expect(screen.getByRole('button', {name: 'Helpful'})).toBeTruthy();
        expect(messageActions).toHaveBeenCalledWith(chatModel.lastMessage, {
            chatModel,
            messageId: 'a1'
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
    return render(chatMessageList({model: chatModel, ...props}));
}

function reply(parts: ChatPart[]): ChatMessageSpec {
    return {id: 'a1', role: 'assistant', parts};
}

/** Show a reply that is still streaming, with the given parts in their live states. */
function showLiveReply(chatModel: ChatModel, parts: ChatPart[]) {
    runInAction(() => {
        chatModel.messages = [new ChatMessage({...reply(parts), status: 'streaming'})];
    });
}

/** Replace the reply with one that has the given parts, as a streamed change would. */
function loadReply(chatModel: ChatModel, parts: ChatPart[]) {
    chatModel.loadMessages([reply(parts)], chatModel.threadId);
}

function text(id: string, content: string): ChatPart {
    return {type: 'text', id, text: content, state: 'done', step: 0};
}

function call(id: string, toolName: string): ChatToolCallPart {
    return {
        type: 'toolCall',
        id,
        toolName,
        state: 'output-available',
        step: 0,
        inputText: '{"city":"Tokyo"}',
        input: {city: 'Tokyo'},
        output: 'ok',
        errorText: null
    };
}
