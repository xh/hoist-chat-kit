import type * as LangCore from '@openuidev/lang-core';
import {fragment} from '@xh/hoist/cmp/layout';
import {creates, hoistCmp, HoistModel} from '@xh/hoist/core';
import {initTestAppAsync} from '@xh/hoist/test-support';
import type {ReactNode} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {beforeAll, describe, expect, it, onTestFinished, vi} from 'vitest';
import {ChatModel, type ChatTextPart} from '../../core';
import {chatUiMetricsSpec, chatUiStackSpec, chatUiTextSpec} from '../../desktop/cmp/genui';
import {type ChatEvent, ScriptedChatTransport, textEvents} from '../../transport';
import {chatUiActionSchema} from '../ChatUiAction';
import {ChatUiCatalog} from '../ChatUiCatalog';
import type {ChatUiComponentSpec} from '../ChatUiComponentSpec';
import type {ChatUiTextSegment} from '../ChatUiTextSegment';
import {openUiLangAdapter} from './OpenUiLangAdapter';
import {
    formatOpenUiProgram,
    openUiLangFormat,
    type OpenUiLangFormatOptions
} from './OpenUiLangFormat';
import {toOpenUiLibrary} from './OpenUiLibrary';

// Pass lang-core through, to count the programs that its parser reads. The kit's rule against
// mocks covers Hoist modules, whose real services the tests run. This is a pass-through spy on a
// third-party factory, which changes no behavior.
const parsed = vi.hoisted(() => ({count: 0}));
vi.mock('@openuidev/lang-core', async importOriginal => {
    const actual = await importOriginal<typeof LangCore>();
    return {
        ...actual,
        createParser: (...args: Parameters<typeof actual.createParser>) => {
            const parser = actual.createParser(...args);
            return {
                parse: (input: string) => {
                    parsed.count++;
                    return parser.parse(input);
                }
            };
        }
    };
});

/**
 * The OpenUI Lang format reads programs that the model writes into its reply, as it streams, and
 * renders each one as a document of catalog components. Apps rely on it to show each element as
 * its statement completes, to keep prose around a fenced program as markdown, to prompt the model
 * with lang-core's own grammar and the kit's rules, and to render a program sent in a data part.
 */
describe('openUiLangFormat', () => {
    beforeAll(() => initTestAppAsync());

    it('parses a bare program as one document segment, partial while streaming and complete when done', () => {
        const catalog = createCatalog(),
            head = PROGRAM.slice(0, PROGRAM.indexOf('mar =')),
            [partial] = catalog.parseText(head, {isStreaming: true, messageId: 'm1', partId: 'p1'}),
            done = catalog.parseText(PROGRAM, {messageId: 'm1', partId: 'p1'});

        expect(partial).toMatchObject({type: 'document', isPartial: true, source: head});
        expectDocument(partial).toMatchObject({root: 'root', isPartial: true});

        expect(done).toHaveLength(1);
        expect(done[0]).toMatchObject({type: 'document', isPartial: false, source: PROGRAM});
        expectDocument(done[0]).toMatchObject({
            root: 'root',
            isPartial: false,
            elements: {
                root: {component: 'stack', children: ['lead', 'rev', 'mar']},
                lead: {component: 'text', props: {text: 'Q3 at a glance.'}},
                rev: {component: 'metrics', props: {metrics: [{label: 'Revenue', value: 1250000}]}},
                mar: {component: 'metrics', props: {metrics: [{label: 'Margin', value: 0.184}]}}
            }
        });
    });

    it('shows a fenced program with no root as a placeholder while it streams, and a fallback once done', () => {
        const catalog = createCatalog(),
            program = 'rev = Metrics([{label: "Revenue", value: 12}])';

        expect(catalog.parseText('root = St', {isStreaming: true})).toEqual([
            {type: 'placeholder', component: null, source: 'root = St'}
        ]);
        expect(catalog.parseText(`\`\`\`openui\n${program}`, {isStreaming: true})).toEqual([
            {type: 'placeholder', component: null, source: program}
        ]);
        expect(catalog.parseText(`\`\`\`openui\n${program}\n\`\`\``)).toEqual([
            {
                type: 'fallback',
                component: null,
                name: 'openui',
                props: {},
                errors: [expect.stringMatching(/No root statement/)],
                source: program
            }
        ]);
    });

    it('renders a bare program that ends with no root as markdown, and warns once', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        onTestFinished(() => warn.mockRestore());

        const catalog = createCatalog(),
            text = 'rev = Metrics([{label: "Revenue", value: 12}])',
            opts = {messageId: 'm-no-root', partId: 'p1'};

        expect(catalog.parseText(text, {...opts, isStreaming: true})).toEqual([
            {type: 'placeholder', component: null, source: text}
        ]);
        expect(catalog.parseText(text, opts)).toEqual([{type: 'markdown', text}]);
        expect(catalog.parseText(text, opts)).toEqual([{type: 'markdown', text}]);

        const warnings = warn.mock.calls.map(String).filter(it => it.includes('no root'));
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toContain('OpenUI program with no root rendered as text');
    });

    it('reads prose that opens with an assignment as markdown', () => {
        const catalog = createCatalog();

        ['x = 5 is the answer', 'Total = revenue - cost', 'Total = Revenue(Q3) - cost'].forEach(
            text => {
                expect(catalog.parseText(text, {isStreaming: true})).toEqual([
                    {type: 'markdown', text}
                ]);
                expect(catalog.parseText(text)).toEqual([{type: 'markdown', text}]);
            }
        );
    });

    it('logs the errors of a complete program that renders once per message', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        onTestFinished(() => warn.mockRestore());

        const catalog = createCatalog(),
            text = 'root = Stack([lead], "column")\nlead = Text("Q3 at a glance.", "extra")',
            opts = {messageId: 'm-errors', partId: 'p1'};

        catalog.parseText(text, {...opts, isStreaming: true});
        const [segment] = catalog.parseText(text, opts);
        catalog.parseText(text, opts);

        expectDocument(segment).toMatchObject({
            elements: {lead: {props: {text: 'Q3 at a glance.'}}}
        });
        const warnings = warn.mock.calls.map(String).filter(it => it.includes('Text takes'));
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toContain('elements.lead');
    });

    it('parses prose, a fenced program, prose and a second program into segments in order', () => {
        const catalog = createCatalog(),
            text = [
                'Here is the quarter.',
                '',
                '```openui',
                PROGRAM,
                '```',
                '',
                'And the code, which stays markdown:',
                '```ts',
                'root = 1',
                '```',
                '```openui-lang',
                'root = Stack([], "row")',
                '```',
                'Done.'
            ].join('\n'),
            segments = catalog.parseText(text);

        expect(segments.map(it => it.type)).toEqual([
            'markdown',
            'document',
            'markdown',
            'document',
            'markdown'
        ]);
        expect(segments[0]).toEqual({type: 'markdown', text: 'Here is the quarter.\n\n'});
        expect(segments[1]).toMatchObject({source: PROGRAM, isPartial: false});
        expect(segments[2]).toEqual({
            type: 'markdown',
            text: '\n\nAnd the code, which stays markdown:\n```ts\nroot = 1\n```\n'
        });
        expectDocument(segments[3]).toMatchObject({
            elements: {root: {component: 'stack', props: {direction: 'row'}}}
        });
        expect(segments[4]).toEqual({type: 'markdown', text: '\nDone.'});
    });

    it('streams prose and two fenced programs as segments in order, the first complete before the second opens', () => {
        const catalog = createCatalog(),
            second = 'root = Stack([mar], "row")\nmar = Metrics([{label: "Margin", value: 0.184}])',
            text = [
                'Here is the quarter.',
                '',
                '```openui-lang',
                PROGRAM,
                '```',
                '',
                'And the margin:',
                '',
                '```openui-lang',
                second,
                '```'
            ].join('\n'),
            order = ['markdown', 'program', 'markdown', 'program'],
            slot = (it: ChatUiTextSegment) => (it.type === 'markdown' ? 'markdown' : 'program');

        let sawSecond = false;
        for (let end = 1; end <= text.length; end += 5) {
            const segments = catalog.parseText(text.slice(0, end), {
                isStreaming: true,
                messageId: 'm-two',
                partId: 'p1'
            });
            expect(segments.map(slot)).toEqual(order.slice(0, segments.length));
            if (segments.length === 4) {
                sawSecond = true;
                expect(segments[1]).toMatchObject({type: 'document', isPartial: false});
                expectDocument(segments[1]).toMatchObject({isPartial: false});
            }
        }
        expect(sawSecond).toBe(true);

        const done = catalog.parseText(text, {messageId: 'm-two', partId: 'p1'});
        expect(done.map(it => it.type)).toEqual(['markdown', 'document', 'markdown', 'document']);
        expect(done[1]).toMatchObject({source: PROGRAM, isPartial: false});
        expect(done[3]).toMatchObject({source: second, isPartial: false});
        expectDocument(done[3]).toMatchObject({
            elements: {root: {component: 'stack', children: ['mar']}}
        });
    });

    it('holds an unclosed fence as a streaming program', () => {
        const catalog = createCatalog(),
            opts = {isStreaming: true, messageId: 'm1', partId: 'p1'};

        expect(catalog.parseText('Here:\n\n```openui', opts)).toEqual([
            {type: 'markdown', text: 'Here:\n\n'},
            {type: 'placeholder', component: null, source: ''}
        ]);

        const segments = catalog.parseText(
            'Here:\n\n```openui\nroot = Stack([], "row", "small"',
            opts
        );
        expect(segments[0]).toEqual({type: 'markdown', text: 'Here:\n\n'});
        expect(segments[1]).toMatchObject({
            type: 'document',
            isPartial: true,
            source: 'root = Stack([], "row", "small"'
        });
    });

    it('reads a closed fence as complete while the rest of the reply streams', () => {
        const catalog = createCatalog(),
            parse = (text: string) =>
                catalog.parseText(text, {isStreaming: true, messageId: 'm1', partId: 'p9'}),
            fenced =
                '```openui-lang\nroot = Stack([rev], "column", "medium")\n' +
                'rev = Metrics([{label: "Revenue"}])\n```\n\nRevenue is';
        parsed.count = 0;

        parse(fenced);
        const segments = parse(`${fenced} up.`);

        expect(segments[0]).toMatchObject({type: 'document', isPartial: false});
        expectDocument(segments[0]).toMatchObject({isPartial: false});
        expect(segments[1]).toEqual({type: 'markdown', text: '\n\nRevenue is up.'});
        // The program is checked and parsed once while the text after it streams.
        expect(parsed.count).toBe(1);
    });

    it('holds back a first line or a fence opener that may yet start a program', () => {
        const catalog = createCatalog(),
            parse = (text: string) => catalog.parseText(text, {isStreaming: true});

        expect(parse('ro')).toEqual([{type: 'placeholder', component: null, source: 'ro'}]);
        expect(parse('Revenue')).toEqual([{type: 'markdown', text: 'Revenue'}]);
        expect(parse('Here:\n```openui-l')).toEqual([
            {type: 'markdown', text: 'Here:\n'},
            {type: 'placeholder', component: null, source: ''}
        ]);
        expect(parse('Here:\n```ocaml\n')).toEqual([{type: 'markdown', text: 'Here:\n```ocaml\n'}]);
    });

    it('parses each text of a program once, however often it renders', () => {
        const catalog = createCatalog(),
            parse = (text: string, isStreaming: boolean, partId = 'p1') =>
                catalog.parseText(text, {isStreaming, messageId: 'm1', partId});
        parsed.count = 0;

        parse('root = Stack(', true);
        parse('root = Stack([], "row"', true);
        parse('root = Stack([], "row")', true);
        expect(parsed.count).toBe(3);

        // The same text in another part, and once the reply ends, is not parsed again.
        parse('root = Stack(', true, 'p2');
        parse('root = Stack([], "row")', false);
        parse('root = Stack([], "row")', false);
        expect(parsed.count).toBe(3);
    });

    it('writes a prompt from lang-core with no inline mode or bindings, and the kit rules', () => {
        const catalog = createCatalog({additionalRules: ['Lead with a Text.']}),
            prompt = catalog.toPrompt(),
            format = catalog.textFormats[0];

        // lang-core's grammar, with the components as OpenUI signatures.
        expect(prompt).toContain('## Syntax Rules');
        expect(prompt).toContain('root = Stack(...)');
        expect(prompt).toMatch(/^Stack\(children\?: .*direction\?: /m);
        expect(prompt).not.toContain('## Inline Mode');
        expect(prompt).not.toContain('Declare mutable state');
        expect(prompt).not.toContain('## Query');
        expect(prompt).not.toContain('## Built-in Functions');

        // An example per component that has one, wrapped in the root.
        expect(prompt).toContain('root = Stack([metrics, text], "column", "medium")');
        expect(prompt).toContain(
            'root = Stack([text], "column", "medium")\ntext = Text("Revenue **grew** in every region.")'
        );

        // The kit's rules, then the app's.
        expect(prompt).toContain(
            '- Write prose where it helps. Put each program in a fenced code block tagged ' +
                'openui-lang, with your words outside it.'
        );
        expect(prompt).toContain(
            '- Write every program in full, starting with root. Never write only changed statements.'
        );
        expect(prompt).toContain(
            '- When a question is best answered with UI, show it; when it is best answered with ' +
                'words, write them.'
        );
        expect(prompt).toContain('- Do not use $variables, Query, Mutation, @Set, @Reset or @Run.');
        expect(prompt).toContain('at most 50 components');
        expect(prompt).toContain('- Lead with a Text.');

        const wholeReply = createCatalog({inline: false}).toPrompt();
        expect(wholeReply).not.toContain('fenced code block');
        expect(wholeReply).toContain('- Do not use $variables');

        expect(format.toExport({catalog})).toEqual({
            root: 'Stack',
            schema: expect.objectContaining({$defs: expect.any(Object)}),
            components: expect.objectContaining({Metrics: expect.any(Object)}),
            prompt: expect.stringContaining('## Syntax Rules')
        });
    });

    it('writes a document as a program that parses back to the same document', () => {
        const catalog = createCatalog(),
            library = toOpenUiLibrary(catalog, {root: 'stack'}),
            [segment] = catalog.parseText(PROGRAM),
            doc = (segment as any).document;

        expect(formatOpenUiProgram(catalog, library, doc)).toBe(PROGRAM);
    });

    it('writes a document with actions OpenUI Lang cannot write, and skips them', () => {
        const button: ChatUiComponentSpec = {
                name: 'button',
                description: 'A button.',
                props: {
                    type: 'object',
                    required: ['label'],
                    properties: {
                        label: {type: 'string'},
                        action: chatUiActionSchema(),
                        more: {type: 'array', items: chatUiActionSchema()},
                        tone: {enum: ['primary', 'danger']}
                    }
                },
                render: () => null
            },
            catalog = new ChatUiCatalog({components: [chatUiStackSpec(), button]}),
            library = toOpenUiLibrary(catalog, {root: 'stack'}),
            program = formatOpenUiProgram(catalog, library, {
                root: 'root',
                elements: {
                    root: {component: 'stack', props: {}, children: ['one', 'two']},
                    one: {
                        component: 'button',
                        props: {
                            label: 'One',
                            action: {type: 'navigate', route: 'trades'},
                            more: [
                                {type: 'send', text: 'Why?'},
                                {type: 'app', name: 'approve'},
                                {type: 'openUrl', url: 'https://xh.io'},
                                {type: 'callTool', name: 'lookup'}
                            ],
                            tone: 'danger'
                        }
                    },
                    two: {
                        component: 'button',
                        props: {label: 'Two', action: {type: 'callTool', name: 'lookup'}}
                    }
                }
            });

        expect(program).toBe(
            [
                'root = Stack([one, two])',
                'one = Button("One", null, [@ToAssistant("Why?"), @OpenUrl("https://xh.io")], ' +
                    '"danger")',
                'two = Button("Two")'
            ].join('\n')
        );
    });

    it('renders a scripted reply through ChatModel and the message view, element by element', async () => {
        const catalog = createCatalog(),
            [start, , end] = textEvents('x', {messageId: 'a1'}),
            chunks = [
                'root = St',
                'ack([lead, rev, mar], "column", "medium")\nlead = Te',
                'xt("Q3 at a glance.")\nrev = Metrics([{label: "Rev',
                'enue", value: 1250000}])\nmar = Met',
                'rics([{label: "Margin", va',
                'lue: 0.184}])'
            ],
            events: ChatEvent[] = [
                start,
                ...chunks.map((delta): ChatEvent => ({
                    type: 'TEXT_MESSAGE_CONTENT',
                    messageId: 'a1',
                    delta
                })),
                end
            ],
            chatModel = new ChatModel({
                catalog,
                // Slower than the chat's stream batching, so each chunk renders on its own.
                transport: new ScriptedChatTransport({responses: [events], delayMs: 100})
            }),
            renders: {html: string; isStreaming: boolean}[] = [];
        onTestFinished(() => chatModel.destroy());

        // Render the text part on each change, as the message view does.
        chatModel.addReaction({
            track: () => {
                const message = chatModel.lastMessage;
                return [message?.text, message?.isStreaming];
            },
            run: () => {
                const message = chatModel.lastMessage,
                    part = message?.parts.find(it => it.type === 'text') as ChatTextPart;
                if (message?.role !== 'assistant' || !part) return;
                const {isStreaming} = message,
                    segments = catalog.parseText(part.text, {
                        isStreaming,
                        messageId: message.id,
                        partId: part.id
                    });
                renders.push({
                    html: markup(
                        segments.map(it =>
                            it.type === 'markdown'
                                ? it.text
                                : catalog.renderSegment(it, {
                                      chatModel,
                                      messageId: message.id,
                                      part
                                  })
                        )
                    ),
                    isStreaming
                });
            }
        });

        await chatModel.sendAsync('How was Q3?');

        const tiles = renders.map(it => countTiles(it.html));
        expect(renders[0].html).toContain('xh-chat-ui-placeholder');
        expect(tiles[0]).toBe(0);
        // Tiles only ever arrive, one statement at a time, and the Revenue tile shows while the
        // reply still streams.
        expect(tiles).toEqual([...tiles].sort((a, b) => a - b));
        const firstTile = renders.find(it => countTiles(it.html) === 1);
        expect(firstTile.isStreaming).toBe(true);
        expect(firstTile.html).toContain('Revenue');
        expect(firstTile.html).not.toContain('Margin');

        const last = renders.at(-1);
        expect(last.isStreaming).toBe(false);
        expect(countTiles(last.html)).toBe(2);
        expect(last.html).toContain('Q3 at a glance.');
        expect(last.html).not.toContain('xh-chat-ui-placeholder');
        expect(chatModel.lastMessage.metadata.catalogVersion).toBe(catalog.version);
    });
});

describe('openUiLangAdapter', () => {
    beforeAll(() => initTestAppAsync());

    it('the adapter renders a data part that holds a program', () => {
        const catalog = createCatalog(),
            adapter = openUiLangAdapter({root: 'stack'}),
            renderers = catalog.createDataRenderers([adapter]),
            html = markup(
                renderers.openui(
                    {type: 'data', id: 'd1', dataType: 'openui', data: {program: PROGRAM}},
                    {chatModel: null, messageId: 'm1'}
                )
            );

        expect(adapter.dataType).toBe('openui');
        expect(countTiles(html)).toBe(2);
        expect(html).toContain('Q3 at a glance.');

        const partial = adapter.translate(PROGRAM.slice(0, PROGRAM.indexOf('mar =')), {
            catalog,
            isPartial: true
        });
        expect(partial).toMatchObject({root: 'root', isPartial: true});
        expect(partial.elements.rev.props).toEqual({
            metrics: [{label: 'Revenue', value: 1250000}]
        });
    });
});

//------------------
// Helpers
//------------------
const PROGRAM = [
    'root = Stack([lead, rev, mar], "column", "medium")',
    'lead = Text("Q3 at a glance.")',
    'rev = Metrics([{label: "Revenue", value: 1250000}])',
    'mar = Metrics([{label: "Margin", value: 0.184}])'
].join('\n');

function createCatalog(opts: Partial<OpenUiLangFormatOptions> = {}): ChatUiCatalog {
    return new ChatUiCatalog({
        components: [chatUiStackSpec(), chatUiMetricsSpec(), chatUiTextSpec()],
        textFormats: [openUiLangFormat({root: 'stack', ...opts})],
        modes: ['openui']
    });
}

function expectDocument(segment: ChatUiTextSegment) {
    expect(segment.type).toBe('document');
    return expect(segment.type === 'document' ? segment.document : null);
}

function countTiles(html: string): number {
    return html.match(/class="xh-stat-card[ "]/g)?.length ?? 0;
}

function markup(content: ReactNode): string {
    return renderToStaticMarkup(appContext({items: content}));
}

class AppStandInModel extends HoistModel {}

// A Hoist app renders inside the context of its models, which the text's markdown looks up.
const appContext = hoistCmp.factory({
    displayName: 'TestAppContext',
    model: creates(AppStandInModel),
    render: ({children}) => fragment(children)
});
