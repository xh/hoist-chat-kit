import {act, fireEvent, render, screen, within} from '@testing-library/react';
import {div, fragment} from '@xh/hoist/cmp/layout';
import {button} from '@xh/hoist/desktop/cmp/button';
import {creates, hoistCmp, HoistModel, type HoistProps} from '@xh/hoist/core';
import {initTestAppAsync} from '@xh/hoist/test-support';
import {useEffect} from 'react';
import {beforeAll, beforeEach, describe, expect, it, onTestFinished, vi} from 'vitest';
import {runInAction} from '@xh/hoist/mobx';
import {
    ChatComposerModel,
    ChatMessage,
    type ChatMessageSpec,
    chatToolResult,
    ChatModel,
    type ChatModelConfig,
    type ChatPart,
    type ChatSourcePart,
    type ChatTextPart,
    type ChatToolCallPart
} from '../../../core';
import {ChatUiCatalog} from '../../../genui';
import {ScriptedChatTransport, textEvents, toolCallEvents} from '../../../transport';
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

    it("renders component tags in a reply's text through the chat's catalog", () => {
        const catalog = new ChatUiCatalog({
                modes: ['tags'],
                components: [
                    {
                        name: 'badge',
                        description: 'A badge.',
                        props: {
                            type: 'object',
                            required: ['label'],
                            properties: {label: {type: 'string'}}
                        },
                        render: ({label}) => div({className: 'test-badge', item: label})
                    }
                ]
            }),
            tag = catalog.formatTag('badge', {label: 'Top seller'}),
            chatModel = createModel({catalog}, [
                reply([text('t1', `Before the badge.\n\n${tag}\n\nAfter **it**.`)])
            ]);
        renderList(chatModel);

        expect(screen.getByText('Top seller', {selector: '.test-badge'})).toBeTruthy();
        expect(screen.getByText('Before the badge.')).toBeTruthy();
        expect(screen.getByText('it', {selector: 'strong'})).toBeTruthy();
        expect(document.body.textContent).not.toContain('<ui-badge');
    });

    it('keeps a tag component mounted while the text after it streams', () => {
        const mounts = vi.fn(),
            badge = {
                name: 'badge',
                description: 'A badge.',
                props: {type: 'object', properties: {label: {type: 'string'}}},
                render: ({label}) => badgeView({label, onMount: mounts})
            },
            catalog = new ChatUiCatalog({modes: ['tags'], components: [badge]}),
            tag = catalog.formatTag('badge', {label: 'Top'}),
            chatModel = createModel({catalog}, []);
        showLiveReply(chatModel, [liveText('t1', 'Here: <ui-badge lab')]);
        renderList(chatModel);
        expect(screen.queryByText('Top')).toBeNull();

        act(() => showLiveReply(chatModel, [liveText('t1', `Here: ${tag}`)]));
        act(() => showLiveReply(chatModel, [liveText('t1', `Here: ${tag} and more`)]));
        act(() => showLiveReply(chatModel, [liveText('t1', `Here: ${tag} and more text.`)]));

        expect(screen.getByText('Top')).toBeTruthy();
        expect(mounts).toHaveBeenCalledTimes(1);
    });

    it("shows the structured context sent with a user's message", () => {
        const chatModel = createModel({}, [
            {
                role: 'user',
                parts: [{type: 'text', id: 't1', text: 'Explain it.', state: 'done'}],
                metadata: {context: {ticker: 'XYZ', quarter: 3}}
            }
        ]);
        renderList(chatModel);

        expect(screen.getByText('ticker: XYZ, quarter: 3')).toBeTruthy();
    });

    it('shows a data part whose type names a member every object inherits as JSON', () => {
        const chatModel = createModel({}, [
            reply([{type: 'data', id: 'd1', dataType: 'constructor', data: {a: 1}}])
        ]);
        renderList(chatModel);

        expect(screen.getByText('constructor')).toBeTruthy();
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
        expect(dataRenderer).toHaveBeenCalledWith(dataPart, {
            chatModel,
            host: chatModel,
            messageId: 'a1'
        });
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
            chatMessageList({
                model: chatModel,
                allowImages: src => new URL(src).origin === 'https://img.example'
            })
        );
        expect(container.querySelector('img').getAttribute('src')).toBe(
            'https://img.example/c.png'
        );
    });

    it('shows a file image at a URL as an icon unless images are allowed', () => {
        const remote: ChatPart = {
                type: 'file',
                id: 'f1',
                name: 'chart.png',
                mediaType: 'image/png',
                url: 'https://img.example/c.png'
            },
            chatModel = createModel({}, [reply([remote])]),
            {rerender, container} = renderList(chatModel);

        expect(container.querySelector('img')).toBeNull();
        expect(screen.getByText('chart.png')).toBeTruthy();

        rerender(chatMessageList({model: chatModel, allowImages: true}));
        expect(container.querySelector('img').getAttribute('src')).toBe(
            'https://img.example/c.png'
        );
    });

    it('always shows an inline image attachment, which loads nothing', () => {
        const attached: ChatPart = {
                type: 'file',
                id: 'f1',
                name: 'shot.png',
                mediaType: 'image/png',
                data: 'iVBORw0KGgo='
            },
            chatModel = createModel({}, [{id: 'u1', role: 'user', parts: [attached]}]),
            {container} = renderList(chatModel);

        expect(container.querySelector('img').getAttribute('src')).toBe(
            'data:image/png;base64,iVBORw0KGgo='
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
            // The reply's header says it runs tools. The call itself shows no progress status.
            const callEl = container.querySelector<HTMLElement>('.xh-chat-tool-call');
            expect(within(callEl).queryByText(/Pending|Running/)).toBeNull();
            expect(container.querySelector('.xh-chat-tool-call__caption--quiet')).toBeTruthy();
        });

        it('shows a quiet status while the input streams', () => {
            const chatModel = createModel({tools: [chartTool]}, []);
            showLiveReply(chatModel, [{...call('c1', 'show_chart'), state: 'input-streaming'}]);
            renderList(chatModel);

            expect(screen.getByText('Rendering…')).toBeTruthy();
        });

        it('renders nothing for a denied call', () => {
            const denied = {
                    ...call('c1', 'show_chart'),
                    state: 'output-denied' as const,
                    errorText: 'The user denied this call.'
                },
                chatModel = createModel({tools: [chartTool]}, [reply([denied])]);
            renderList(chatModel);

            expect(screen.queryByText('Chart body')).toBeNull();
            expect(screen.getByText('Denied - not shown.')).toBeTruthy();
        });

        it('renders a call waiting for approval only if its spec opts into a preview', () => {
            const approval = {...call('c1', 'show_chart'), state: 'approval-requested' as const},
                tool = {...chartTool, execute: () => 'ok', needsApproval: true},
                chatModel = createModel({tools: [tool]}, [
                    {...reply([approval]), status: 'paused'}
                ]),
                {rerender} = renderList(chatModel);

            expect(screen.queryByText('Chart body')).toBeNull();
            expect(screen.getByRole('button', {name: 'Allow'})).toBeTruthy();

            const trueModel = createModel({tools: [{...tool, preview: true}]}, [
                {...reply([approval]), status: 'paused'}
            ]);
            rerender(chatMessageList({model: trueModel}));
            expect(screen.getByText('Chart body')).toBeTruthy();
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

    it('shows what a call will do under its approval prompt, from the tool preview', () => {
        const approval = {...call('c1', 'hide_columns'), state: 'approval-requested' as const},
            chatModel = createModel(
                {
                    tools: [
                        {
                            name: 'hide_columns',
                            execute: () => 'ok',
                            needsApproval: true,
                            preview: input => `Will hide the ${input.city} column.`
                        }
                    ]
                },
                [{...reply([approval]), status: 'paused'}]
            );
        renderList(chatModel);

        expect(screen.getByText('Allow this action to run?')).toBeTruthy();
        expect(screen.getByText('Will hide the Tokyo column.')).toBeTruthy();
    });

    it('offers Undo on a reply whose tool calls made undoable changes', async () => {
        const undo = vi.fn(),
            chatModel = createModel(
                {
                    transport: new ScriptedChatTransport({
                        responses: [toolCallEvents('hide', {}), textEvents('Done.')],
                        delayMs: 0
                    }),
                    tools: [{name: 'hide', execute: () => chatToolResult('Hidden.', {undo})}]
                },
                []
            );
        await chatModel.sendAsync('Hide it');
        renderList(chatModel);

        await act(() => fireEvent.click(screen.getByRole('button', {name: 'Undo changes'})));

        expect(undo).toHaveBeenCalledOnce();
        expect(chatModel.lastMessage.metadata.undone).toBe(true);
        expect(screen.queryByRole('button', {name: 'Undo changes'})).toBeNull();
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
        expect(screen.getByRole('button', {name: 'Allow'})).toBeTruthy();
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

    describe('citation markers', () => {
        const SOURCES: ChatSourcePart[] = [
            {type: 'source', id: 's1', url: 'https://a.example', title: 'Rate outlook', marker: 1},
            {type: 'source', id: 's2', title: 'Guideline 4.2', marker: 2}
        ];

        it('leaves markers as written unless citationMarkers is on', () => {
            const chatModel = createModel({}, [reply([text('t1', 'Rates rose [1].'), ...SOURCES])]),
                {container} = renderList(chatModel);

            expect(container.querySelector('.xh-chat-message__text').textContent).toBe(
                'Rates rose [1].'
            );
            expect(screen.queryByRole('button', {name: /Source 1/})).toBeNull();
        });

        it('renders markers as buttons for the sources they cite', () => {
            const chatModel = createModel({}, [
                reply([text('t1', 'Rates rose [1, 2], not [3].'), ...SOURCES])
            ]);
            renderList(chatModel, {citationMarkers: true});

            expect(screen.getByRole('button', {name: 'Source 1: Rate outlook'})).toBeTruthy();
            expect(screen.getByRole('button', {name: 'Source 2: Guideline 4.2'})).toBeTruthy();
            expect(screen.getByText(/not \[3\]/)).toBeTruthy();
        });

        it('numbers the source list by marker, to match the text', () => {
            const sources: ChatSourcePart[] = [
                    {type: 'source', id: 's1', title: 'First', marker: 4},
                    {type: 'source', id: 's2', title: 'Second', marker: 2}
                ],
                chatModel = createModel({}, [reply([text('t1', 'See [2] and [4].'), ...sources])]),
                {container} = renderList(chatModel, {citationMarkers: true});

            const numbers = container.querySelectorAll('.xh-chat-sources__number');
            expect(Array.from(numbers).map(it => it.textContent)).toEqual(['2', '4']);
        });

        it('calls onSourceClick with the source and context from markers, chips and the list', () => {
            const onSourceClick = vi.fn(),
                cited: ChatTextPart = {
                    ...(text('t1', 'Rates rose [2].') as ChatTextPart),
                    citations: [{id: 'c1', sourceId: 's1'}]
                },
                chatModel = createModel({}, [reply([cited, ...SOURCES])]),
                context = {chatModel, host: chatModel, messageId: 'a1'},
                {container} = renderList(chatModel, {citationMarkers: true, onSourceClick});

            fireEvent.click(screen.getByRole('button', {name: /Source 2/}));
            expect(onSourceClick).toHaveBeenLastCalledWith(SOURCES[1], context);

            // A web page's marker pins its card, whose Open Link opens it.
            fireEvent.click(container.querySelector('.xh-chat-citations .xh-chat-citation-marker'));
            fireEvent.click(screen.getByRole('button', {name: 'Open Link'}));
            expect(onSourceClick).toHaveBeenLastCalledWith(SOURCES[0], context);

            fireEvent.click(screen.getByRole('button', {name: 'Guideline 4.2'}));
            expect(onSourceClick).toHaveBeenLastCalledWith(SOURCES[1], context);
        });

        it('turns markers into buttons once sources arrive after the text', () => {
            const chatModel = createModel({}, []);
            renderList(chatModel, {citationMarkers: true});

            const streaming: ChatTextPart = {
                ...(text('t1', 'Rates rose [1].') as ChatTextPart),
                state: 'streaming'
            };
            act(() => showLiveReply(chatModel, [streaming]));
            expect(screen.queryByRole('button', {name: /Source 1/})).toBeNull();

            act(() => showLiveReply(chatModel, [streaming, SOURCES[0]]));
            expect(screen.getByRole('button', {name: /Source 1/})).toBeTruthy();
        });
    });

    it('applies markdownPlugins to assistant text', () => {
        const rehypeMark = () => (tree: any) => {
                tree.children.forEach(it => {
                    if (it.tagName === 'p') it.properties.className = ['app-plugin'];
                });
            },
            chatModel = createModel({}, [reply([text('t1', 'Answer')])]),
            {container} = renderList(chatModel, {markdownPlugins: {rehype: [rehypeMark]}});

        expect(container.querySelector('.xh-chat-message__text p.app-plugin')).toBeTruthy();
    });

    describe('render errors', () => {
        // React logs each caught render error to the console - expected here.
        beforeEach(() => {
            vi.spyOn(console, 'error').mockImplementation(() => {});
        });

        it('replaces a part whose renderer throws with a note, and renders the rest', () => {
            const chatModel = createModel(
                {
                    dataRenderers: {
                        kpi: () => {
                            throw new Error('Bad KPI');
                        }
                    }
                },
                [
                    reply([
                        text('t1', 'Before'),
                        {type: 'data', id: 'd1', dataType: 'kpi', data: {}},
                        text('t2', 'After')
                    ])
                ]
            );
            renderList(chatModel);

            expect(screen.getByText('Before')).toBeTruthy();
            expect(screen.getByText('After')).toBeTruthy();
            expect(screen.getByText('This part could not be displayed.')).toBeTruthy();
            expect(screen.getByText('Bad KPI', {selector: 'pre'})).toBeTruthy();
        });

        it('contains a throwing tool renderer to its own call within a group', () => {
            const chatModel = createModel(
                {
                    tools: [
                        {
                            name: 'chart',
                            renderer: () => {
                                throw new Error('Bad chart');
                            }
                        }
                    ]
                },
                [reply([call('c1', 'get_weather'), call('c2', 'chart')])]
            );
            renderList(chatModel);

            fireEvent.click(screen.getByRole('button', {name: /Used 2 tools/}));
            expect(
                screen.getByText('Get weather', {selector: '.xh-chat-tool-call__title'})
            ).toBeTruthy();
            expect(screen.getByText('This part could not be displayed.')).toBeTruthy();
        });

        it('renders a failed streaming part again once its state moves on', () => {
            let fail = true;
            const chatModel = createModel(
                {
                    tools: [
                        {
                            name: 'show_chart',
                            display: 'inline',
                            renderer: () => {
                                if (fail) throw new Error('Partial props');
                                return div('Chart body');
                            }
                        }
                    ]
                },
                []
            );
            showLiveReply(chatModel, [{...call('c1', 'show_chart'), state: 'input-streaming'}]);
            renderList(chatModel);
            expect(screen.getByText('This part could not be displayed.')).toBeTruthy();

            fail = false;
            act(() => showLiveReply(chatModel, [call('c1', 'show_chart')]));
            expect(screen.getByText('Chart body')).toBeTruthy();
            expect(screen.queryByText('This part could not be displayed.')).toBeNull();
        });

        it('replaces a message that throws outside its parts with a note', () => {
            const chatModel = createModel({}, [
                {id: 'u1', role: 'user', parts: [text('t0', 'Question')]},
                reply([text('t1', 'Answer')])
            ]);
            renderList(chatModel, {
                messageHeaderItems: () => {
                    throw new Error('Bad header');
                }
            });

            expect(screen.getByText('Question')).toBeTruthy();
            expect(screen.getByText('This message could not be displayed.')).toBeTruthy();
        });
    });

    describe('suggestions over a host that is not a ChatModel', () => {
        it("fill the host's composer when it has one", () => {
            const composerModel = new ChatComposerModel({
                    host: {isBusy: false, sendAsync: () => Promise.resolve()},
                    drafts: 'memory'
                }),
                host = {messages: [], isBusy: false, composerModel};
            onTestFinished(() => composerModel.destroy());
            render(appContext({item: chatMessageList({host, suggestions: ['Show my limits']})}));

            expect(screen.queryByText('No model found', {exact: false})).toBeNull();
            fireEvent.click(screen.getByRole('button', {name: 'Show my limits'}));
            expect(composerModel.text).toBe('Show my limits');
        });

        it('render nothing when the host has no composer', () => {
            const {container} = render(
                appContext({
                    item: chatMessageList({
                        host: {messages: [], isBusy: false},
                        suggestions: ['Hi']
                    })
                })
            );
            expect(container.textContent).toContain('How can I help?');
            expect(container.textContent).not.toContain('No model found');
            expect(container.querySelector('.xh-chat-suggestions')).toBeNull();
        });
    });

    it('holds text in the held color while the server revises it, and only then', () => {
        const chatModel = createModel({}, []);
        renderList(chatModel);
        act(() =>
            showLiveReply(chatModel, [
                {...liveText('t1', 'Shorter text'), revising: true} as ChatPart
            ])
        );
        expect(document.querySelector('.xh-chat-message__text--revising')).toBeTruthy();

        act(() => showLiveReply(chatModel, [liveText('t1', 'Shorter text, now longer')]));
        expect(document.querySelector('.xh-chat-message__text--revising')).toBeNull();
    });

    it("names a message's actions as a group, not a toolbar it has no arrow keys for", () => {
        const chatModel = createModel({}, [reply([text('t1', 'Answer')])]);
        renderList(chatModel);

        expect(screen.getByRole('group', {name: 'Message actions'})).toBeTruthy();
        expect(screen.queryByRole('toolbar')).toBeNull();
    });

    it('adds app message actions after the built-in ones, with the message and its context', () => {
        const messageActions = vi.fn(() => [button({key: 'up', text: 'Helpful'})]),
            chatModel = createModel({}, [reply([text('t1', 'Answer')])]);
        renderList(chatModel, {messageActions});

        expect(screen.getByRole('button', {name: 'Helpful'})).toBeTruthy();
        expect(messageActions).toHaveBeenCalledWith(chatModel.lastMessage, {
            chatModel,
            host: chatModel,
            messageId: 'a1'
        });
    });
});

//------------------
// Helpers
//------------------
class AppStandInModel extends HoistModel {}

/** A model in context, as an app gives - the list's local model needs one. */
const appContext = hoistCmp.factory({
    displayName: 'TestAppContext',
    model: creates(AppStandInModel),
    render: ({children}) => fragment(children)
});

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

function liveText(id: string, content: string): ChatPart {
    return {type: 'text', id, text: content, state: 'streaming', step: 0};
}

interface BadgeViewProps extends HoistProps {
    label: string;
    onMount: () => void;
}

const badgeView = hoistCmp.factory<BadgeViewProps>({
    displayName: 'TestBadge',
    model: false,
    render({label, onMount}) {
        useEffect(() => onMount(), []); // eslint-disable-line react-hooks/exhaustive-deps
        return div(label);
    }
});

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
