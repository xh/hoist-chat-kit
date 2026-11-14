import {createStreamingParser, type ParseResult} from '@openuidev/lang-core';
import {fragment} from '@xh/hoist/cmp/layout';
import {initTestAppAsync} from '@xh/hoist/test-support';
import type {ReactNode} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {beforeAll, describe, expect, it, onTestFinished, vi} from 'vitest';
import {ChatModel} from '../../core';
import {chatUiCardSpec, chatUiStackSpec} from '../../desktop/cmp/genui';
import {ScriptedChatTransport} from '../../transport';
import {chatUiActionSchema, type ChatUiAction} from '../ChatUiAction';
import {ChatUiCatalog} from '../ChatUiCatalog';
import type {ChatUiComponentSpec, ChatUiDocumentContext} from '../ChatUiComponentSpec';
import {openUiToAction} from './OpenUiActions';
import {openUiToDocument, type OpenUiTranslation} from './OpenUiDocument';
import {toOpenUiLibrary, type OpenUiLibrary} from './OpenUiLibrary';

/**
 * openUiToDocument turns what lang-core parsed from an OpenUI Lang program into a catalog
 * document, so that the catalog's checks, actions and fallbacks apply to it as to any other
 * answer. Apps rely on it to render a program element by element as it streams, to run only the
 * actions the kit can check, and to contain each broken element in a fallback.
 */
describe('openUiToDocument', () => {
    beforeAll(() => initTestAppAsync());

    it('turns a complete program into a document with elements keyed by statement id', () => {
        const {document, isPartial, errors, elementErrors} = translate(
            ['root = Stack([rev, mar], "small", [])', 'rev = Metric("Revenue", 12)'].join('\n') +
                '\nmar = Metric("Margin", 0.4)'
        );

        expect(document).toEqual({
            root: 'root',
            elements: {
                root: {
                    component: 'stack',
                    props: {gap: 'small'},
                    children: ['rev', 'mar'],
                    slots: {footer: []},
                    isPartial: false
                },
                rev: {component: 'metric', props: {label: 'Revenue', value: 12}, isPartial: false},
                mar: {component: 'metric', props: {label: 'Margin', value: 0.4}, isPartial: false}
            }
        });
        expect(isPartial).toBe(false);
        expect(errors).toEqual([]);
        expect(elementErrors).toEqual({});
    });

    it('gives an inline component an id from its parent and position', () => {
        const {document} = translate(
            'root = Stack([rev, Metric("Margin", 0.4)], "small", [Button("Go")])\n' +
                'rev = Metric("Revenue", 12)'
        );

        expect(document.elements.root.children).toEqual(['rev', 'root.children[1]']);
        expect(document.elements.root.slots).toEqual({footer: ['root.footer[0]']});
        expect(document.elements['root.children[1]']).toEqual({
            component: 'metric',
            props: {label: 'Margin', value: 0.4},
            isPartial: false
        });
        expect(document.elements['root.footer[0]'].component).toBe('button');
    });

    it('moves child elements out of props into children and named slots', () => {
        const {document} = translate(
                'root = Stack([Stack([Metric("A", 1)], "small", [])], "large", [ok])\n' +
                    'ok = Button("OK")'
            ),
            {root} = document.elements,
            inner = document.elements['root.children[0]'];

        expect(root.props).toEqual({gap: 'large'});
        expect(root.slots).toEqual({footer: ['ok']});
        expect(root.children).toEqual(['root.children[0]']);
        expect(inner.props).toEqual({gap: 'small'});
        expect(inner.children).toEqual(['root.children[0].children[0]']);
        expect(document.elements['root.children[0].children[0]'].props).toEqual({
            label: 'A',
            value: 1
        });

        // A single element in a prop, as a hand-built tree: lang-core itself asks for an array.
        const single = openUiToDocument(
            parseResult({
                type: 'element',
                typeName: 'Stack',
                statementId: 'root',
                partial: false,
                props: {footer: element('Button', {label: 'Solo'})}
            }),
            createLibrary(),
            {complete: true}
        );
        expect(single.document.elements.root.slots).toEqual({footer: ['root.footer']});
        expect(single.document.elements['root.footer'].props).toEqual({label: 'Solo'});
    });

    it('marks each element partial by its own node, and the document by meta.incomplete', () => {
        const text =
                'root = Stack([rev, mar], "small", [])\nrev = Metric("Revenue", 12)\n' +
                'mar = Metric("Margin", 0.',
            parser = createStreamingParser(createLibrary().schema, 'Stack'),
            result = parser.set(text, false);

        // lang-core marks every node partial while the program is incomplete.
        const byNode = openUiToDocument(result, createLibrary(), {complete: false});
        expect(byNode.isPartial).toBe(true);
        expect(byNode.document.elements.rev.isPartial).toBe(true);
        expect(byNode.document.elements.mar.isPartial).toBe(true);

        // With the program text, only the statement the text ends in is partial.
        const byText = openUiToDocument(result, createLibrary(), {complete: false, text});
        expect(byText.isPartial).toBe(true);
        expect(byText.document.elements.root.isPartial).toBe(false);
        expect(byText.document.elements.rev.isPartial).toBe(false);
        expect(byText.document.elements.mar.isPartial).toBe(true);

        const done = openUiToDocument(parser.set(`${text}4)`, true), createLibrary(), {
            complete: true,
            text: `${text}4)`
        });
        expect(done.isPartial).toBe(false);
        expect(done.document.elements.mar).toMatchObject({props: {value: 0.4}, isPartial: false});

        // A stream that has not ended is partial, even where lang-core sees a whole program.
        expect(translate('root = Stack([], "small")', {complete: false}).isPartial).toBe(true);
    });

    it('renders a cut-off program: complete elements complete, the cut one partial', () => {
        const text =
                'root = Stack([rev, mar], "small", [])\nrev = Metric("Revenue", 12)\n' +
                'mar = Metric("Margin", 0.4',
            translation = translate(text, {complete: false, withText: true});

        expect(translation.errors).toEqual([]);
        expect(render(translation)).toBe('[(Revenue=12)(Margin=0.4…)]');

        // lang-core reads a number cut at its point as an expression, which the kit drops.
        expect(render(translate(text.slice(0, -1), {complete: false, withText: true}))).toBe(
            '[(Revenue=12)(Margin=undefined…)]'
        );
    });

    it('maps ToAssistant to send within the caps, flattening a nested context', () => {
        const long = 'x'.repeat(250),
            entries = Array.from({length: 10}, (_, idx) => `k${idx}: ${idx}`).join(', '),
            {document} = translate(
                'root = Stack([], "small", [a, b, c])\n' +
                    'a = Button("A", @ToAssistant("Show details", {id: 42, ok: true, ' +
                    `name: "${long}", nested: {rows: [1, 2]}, none: null}))\n` +
                    `b = Button("B", @ToAssistant("${long}", {${entries}}))\n` +
                    'c = Button("C", @ToAssistant("Why?", "Q3"))'
            ),
            action = (id: string) => document.elements[id].props.action;

        expect(action('a')).toEqual({
            type: 'send',
            text: 'Show details',
            context: {
                id: 42,
                ok: true,
                name: 'x'.repeat(100),
                nested: '{"rows":[1,2]}',
                none: 'null'
            }
        });
        expect(action('b').text).toBe('x'.repeat(200));
        expect(Object.keys(action('b').context)).toEqual([
            'k0',
            'k1',
            'k2',
            'k3',
            'k4',
            'k5',
            'k6',
            'k7'
        ]);
        expect(action('c')).toEqual({type: 'send', text: 'Why?', context: {value: 'Q3'}});
    });

    it('maps OpenUrl to openUrl, and an app action to app', () => {
        const library = createLibrary({
                Approve: {
                    description: 'Approve a trade.',
                    params: {
                        type: 'object',
                        properties: {id: {type: 'number'}, note: {type: 'string'}},
                        required: ['id']
                    }
                }
            }),
            {document} = translate(
                'root = Stack([], "small", [open, ok])\n' +
                    'open = Button("Open", @OpenUrl("https://xh.io/report"))\n' +
                    'ok = Button("Approve", @Approve(7, "fine"))',
                {library}
            );

        expect(document.elements.open.props.action).toEqual({
            type: 'openUrl',
            url: 'https://xh.io/report'
        });
        expect(document.elements.ok.props.action).toEqual({
            type: 'app',
            name: 'Approve',
            params: {id: 7, note: 'fine'}
        });
    });

    it('drops Set, Reset and Run, and keeps the first send of an Action list', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        onTestFinished(() => warn.mockRestore());

        const {document} = translate(
                'root = Stack([], "small", [set, reset, run, one, many])\n' +
                    'set = Button("Set", @Set($tab, "b"))\n' +
                    'reset = Button("Reset", @Reset($tab))\n' +
                    'run = Button("Run", @Run(q))\n' +
                    'one = Button("One", Action([@Set($tab, "b"), @OpenUrl("https://xh.io")]))\n' +
                    'many = Button("Many", Action([@OpenUrl("https://xh.io"), ' +
                    '@ToAssistant("First"), @ToAssistant("Second")]), ' +
                    '[@Set($tab, "a"), @ToAssistant("Kept")])'
            ),
            {elements} = document;

        expect(elements.set.props).toEqual({label: 'Set'});
        expect(elements.reset.props).toEqual({label: 'Reset'});
        expect(elements.run.props).toEqual({label: 'Run'});
        expect(elements.one.props.action).toEqual({type: 'openUrl', url: 'https://xh.io'});
        expect(elements.many.props.action).toEqual({type: 'send', text: 'First'});
        expect(elements.many.props.more).toEqual([{type: 'send', text: 'Kept'}]);
        // One warning for each action that cannot run with no state, and one for the steps
        // that the last list drops.
        const warnings = warn.mock.calls.map(String);
        expect(warnings.filter(it => it.includes('cannot run here'))).toHaveLength(4);
        expect(warnings.filter(it => it.includes('Second'))).toHaveLength(1);
    });

    it('reports an unknown component as a fallback for that element, and renders the rest', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        onTestFinished(() => warn.mockRestore());

        const translation = translate(
                'root = Stack([rev, chart, Metric("Inline")], "small", [])\n' +
                    'rev = Metric("Revenue", 12)\n' +
                    'chart = Chart("q3")'
            ),
            {document, errors, elementErrors} = translation;

        // lang-core drops the broken statement. A stand-in takes its place at the end of the root.
        expect(document.elements.root.children).toEqual(['rev', 'chart']);
        expect(document.elements.chart).toEqual({component: 'Chart', props: {}, isPartial: false});
        expect(elementErrors).toEqual({
            chart: [expect.stringMatching(/^elements\.chart: Unknown component "Chart"/)]
        });
        // A broken inline component has no element of its own.
        expect(errors).toEqual([
            expect.stringMatching(/^elements\.root: missing required field "\/value"/)
        ]);

        const html = render(translation);
        expect(html).toContain('(Revenue=12)');
        expect(html).toContain('This content could not be displayed.');
        expect(html).toContain('Unknown component "Chart"');
    });

    it('reports a problem with a kept element in errors, and renders the element', () => {
        const translation = translate(
                'root = Stack([rev], "small", [])\nrev = Metric("Revenue", 12, "huge")'
            ),
            {elementErrors, errors, document} = translation;

        expect(document.elements.rev.props).toEqual({label: 'Revenue', value: 12});
        expect(elementErrors).toEqual({});
        expect(errors).toEqual([expect.stringMatching(/^elements\.rev: Metric takes 2 arg/)]);
        expect(render(translation)).toBe('[(Revenue=12)]');
    });

    it('renders the root when an inline component of the same type has a bad prop', () => {
        const translation = translate(
                'root = Stack([Stack([Metric("A", 1)], "huge", [])], "small", [])'
            ),
            {elementErrors, errors, document} = translation;

        expect(document.elements['root.children[0]'].props).toEqual({});
        expect(elementErrors).toEqual({});
        expect(errors).toEqual([expect.stringMatching(/^elements\.root: .*"\/gap"/)]);
        expect(render(translation)).toBe('[[(A=1)]]');
    });

    it('keeps the statement a string with a newline is in as the one streaming', () => {
        const head = 'root = Stack([rev, t], "small", [])\nrev = Metric("Revenue", 12)\n',
            cut = translate(`${head}t = Metric("Line one\nTotal = 5`, {
                complete: false,
                withText: true
            }),
            valued = translate(`${head}t = Metric("Line one\nTotal = 5", 7`, {
                complete: false,
                withText: true
            });

        // `t` still streams, so its missing value is no error yet.
        expect(cut.elementErrors).toEqual({});
        expect(cut.errors).toEqual([]);
        expect(valued.document.elements.rev.isPartial).toBe(false);
        expect(valued.document.elements.t).toMatchObject({
            props: {label: 'Line one\nTotal = 5', value: 7},
            isPartial: true
        });
    });

    it('labels the actions of a component that requires labels, such as the built-in card', () => {
        const catalog = new ChatUiCatalog({
                components: [chatUiStackSpec(), chatUiCardSpec({actionTypes: ['send', 'openUrl']})]
            }),
            library = toOpenUiLibrary(catalog, {root: 'stack'}),
            text =
                'root = Stack([card], "column", "medium")\n' +
                'card = Card("Acme", "Tier 1", [{label: "Exposure", value: 4}], ' +
                '[@ToAssistant("Show details"), @OpenUrl("https://xh.io/report")])',
            result = createStreamingParser(library.schema, library.root).set(text, true),
            {document, isPartial, elementErrors} = openUiToDocument(result, library, {
                complete: true,
                catalog
            });

        expect(document.elements.card.props.actions).toEqual([
            {type: 'send', text: 'Show details', label: 'Show details'},
            {type: 'openUrl', url: 'https://xh.io/report', label: 'xh.io'}
        ]);
        const chatModel = new ChatModel({
            transport: new ScriptedChatTransport({responses: [], delayMs: 0})
        });
        onTestFinished(() => chatModel.destroy());

        const html = render(
            {
                document,
                isPartial,
                errors: [],
                elementErrors,
                openStatement: null,
                computed: [],
                unresolved: [],
                orphaned: []
            },
            catalog,
            chatModel
        );
        expect(html).not.toContain('could not be displayed');
        expect(html).toMatch(/<button[^>]*>(?:(?!<\/button>).)*Show details/s);
    });

    it('drops each action that the prop refuses, and renders the rest of the card', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        onTestFinished(() => warn.mockRestore());

        const translateCard = (actionTypes: ChatUiAction['type'][], actions: string) => {
            const catalog = new ChatUiCatalog({
                    components: [chatUiStackSpec(), chatUiCardSpec({actionTypes})]
                }),
                library = toOpenUiLibrary(catalog, {root: 'stack'}),
                text =
                    'root = Stack([card])\n' +
                    `card = Card("Acme", "Tier 1", [{label: "Exposure", value: 4}], ${actions})`,
                result = createStreamingParser(library.schema, library.root).set(text, true),
                translation = openUiToDocument(result, library, {complete: true, catalog});
            return {catalog, translation, card: translation.document.elements.card};
        };

        // An openUrl with a relative url, which the url pattern refuses.
        const {catalog, translation, card} = translateCard(
            ['send', 'openUrl'],
            '[@OpenUrl("/relative"), @ToAssistant("Why?")]'
        );
        expect(card.props.actions).toEqual([{type: 'send', text: 'Why?', label: 'Why?'}]);
        const chatModel = new ChatModel({
            transport: new ScriptedChatTransport({responses: [], delayMs: 0})
        });
        onTestFinished(() => chatModel.destroy());
        const html = render(translation, catalog, chatModel);
        expect(html).not.toContain('could not be displayed');
        expect(html.match(/<button/g)).toHaveLength(1);

        // An action of a type the prop does not allow.
        expect(
            translateCard(['send'], '[@OpenUrl("https://xh.io"), @ToAssistant("Why?")]').card.props
                .actions
        ).toEqual([{type: 'send', text: 'Why?', label: 'Why?'}]);

        // No actions left.
        expect(
            translateCard(['send'], '[@OpenUrl("https://xh.io/other")]').card.props.actions
        ).toEqual([]);

        // A program parses again with each chunk and render, and warns once.
        translateCard(['send', 'openUrl'], '[@OpenUrl("/relative"), @ToAssistant("Why?")]');
        const warnings = warn.mock.calls.map(String).filter(it => it.includes('dropped'));
        expect(warnings).toHaveLength(3);
        expect(warnings[0]).toContain('/relative');
    });

    it('omits an action list that requires items when it has none left', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        onTestFinished(() => warn.mockRestore());

        const menu: ChatUiComponentSpec = {
                name: 'menu',
                description: 'A menu.',
                props: {
                    type: 'object',
                    properties: {
                        items: {
                            type: 'array',
                            minItems: 1,
                            items: chatUiActionSchema({types: ['send']})
                        }
                    }
                },
                render: () => 'menu'
            },
            catalog = new ChatUiCatalog({components: [STACK, menu]}),
            library = toOpenUiLibrary(catalog, {root: 'stack'}),
            text = 'root = Stack([m])\nm = Menu([@OpenUrl("https://xh.io/other")])',
            result = createStreamingParser(library.schema, library.root).set(text, true),
            {document} = openUiToDocument(result, library, {complete: true, catalog});

        expect(document.elements.m.props).toEqual({});
    });

    it('renders a statement named after an Object member, such as constructor or __proto__', () => {
        ['constructor', '__proto__', 'toString', 'hasOwnProperty'].forEach(id => {
            const translation = translate(
                    `root = Stack([${id}], "small")\n${id} = Metric("Revenue", 12)`
                ),
                {document} = translation;

            expect(document.elements.root.children).toEqual([`${id}$`]);
            expect(Object.hasOwn(document.elements, `${id}$`)).toBe(true);
            expect(Object.getPrototypeOf(document.elements)).toBe(Object.prototype);
            expect(render(translation)).toBe('[(Revenue=12)]');
        });
    });

    it('returns a null root, and the parser errors, for a program with no root', () => {
        const {document, errors} = translate('rev = Metric("Revenue", 12)');

        expect(document).toEqual({root: null, elements: {}});
        expect(errors).toEqual([expect.stringContaining('No root statement')]);
    });
});

describe('openUiToAction', () => {
    it('returns null for a node that is not an action', () => {
        const library = createLibrary();
        expect(openUiToAction(null, library)).toBeNull();
        expect(openUiToAction({k: 'Str', v: 'go'}, library)).toBeNull();
        expect(openUiToAction({k: 'Comp', name: 'ToAssistant', args: []}, library)).toBeNull();
        expect(openUiToAction({k: 'Comp', name: 'Sum', args: []}, library)).toBeNull();
    });

    it('reads a ToAssistant node with no mapped props from its args', () => {
        const action: ChatUiAction = openUiToAction(
            {k: 'Comp', name: 'ToAssistant', args: [{k: 'Str', v: 'Hi'}]},
            createLibrary()
        );
        expect(action).toEqual({type: 'send', text: 'Hi'});
    });
});

//------------------
// Helpers
//------------------
const STACK: ChatUiComponentSpec = {
    name: 'stack',
    description: 'A stack of children.',
    props: {type: 'object', properties: {gap: {enum: ['small', 'large']}}},
    slots: ['default', 'footer'],
    render: (_, {children, slots}) =>
        fragment({items: ['[', ...(slots.footer ?? []), ...children, ']']})
};

const METRIC: ChatUiComponentSpec = {
    name: 'metric',
    description: 'A KPI tile.',
    props: {
        type: 'object',
        required: ['label', 'value'],
        properties: {label: {type: 'string'}, value: {type: 'number'}}
    },
    render: ({label, value}, {isPartial}) => `(${label}=${value}${isPartial ? '…' : ''})`
};

const BUTTON: ChatUiComponentSpec = {
    name: 'button',
    description: 'A button that runs an action.',
    props: {
        type: 'object',
        required: ['label'],
        properties: {
            label: {type: 'string'},
            action: chatUiActionSchema({types: ['send', 'openUrl', 'app']}),
            more: {type: 'array', items: chatUiActionSchema()}
        }
    },
    render: ({label}) => `<${label}>`
};

function createCatalog(): ChatUiCatalog {
    return new ChatUiCatalog({components: [STACK, METRIC, BUTTON]});
}

function createLibrary(actions: Record<string, any> = null): OpenUiLibrary {
    const library = toOpenUiLibrary(createCatalog(), {root: 'stack'});
    return actions ? {...library, schema: {...library.schema, actions}} : library;
}

function translate(
    text: string,
    opts: {complete?: boolean; withText?: boolean; library?: OpenUiLibrary} = {}
): OpenUiTranslation {
    const {complete = true, withText = false, library = createLibrary()} = opts,
        result = createStreamingParser(library.schema, library.root).set(text, complete);
    return openUiToDocument(result, library, {complete, ...(withText ? {text} : {})});
}

function render(
    {document, isPartial, elementErrors}: OpenUiTranslation,
    catalog: ChatUiCatalog = createCatalog(),
    chatModel: ChatModel = null
): string {
    const context: ChatUiDocumentContext = {
        chatModel,
        messageId: 'm1',
        part: {type: 'text', id: 'p1', text: ''} as any,
        isPartial,
        elementErrors
    };
    return markup(catalog.renderDocument(document, context));
}

function markup(content: ReactNode): string {
    return renderToStaticMarkup(fragment({items: content}))
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"');
}

function element(typeName: string, props: Record<string, unknown>, statementId?: string) {
    return {type: 'element' as const, typeName, props, partial: false, statementId};
}

function parseResult(root: ParseResult['root']): ParseResult {
    return {
        root,
        meta: {incomplete: false, unresolved: [], orphaned: [], statementCount: 1, errors: []},
        stateDeclarations: {},
        queryStatements: [],
        mutationStatements: []
    };
}
