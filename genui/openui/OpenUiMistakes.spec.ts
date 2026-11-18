import {fragment} from '@xh/hoist/cmp/layout';
import {creates, hoistCmp, HoistModel} from '@xh/hoist/core';
import {initTestAppAsync} from '@xh/hoist/test-support';
import type {ReactNode} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {beforeAll, describe, expect, it, onTestFinished, vi} from 'vitest';
import {
    chatUiButtonSpec,
    chatUiCardSpec,
    chatUiDividerSpec,
    chatUiInputSpecs,
    chatUiMetricsSpec,
    chatUiSectionSpec,
    chatUiStackSpec,
    chatUiTabsSpec,
    chatUiTextSpec
} from '../../desktop/cmp/genui';
import {ChatUiCatalog, type ChatUiCatalogConfig} from '../ChatUiCatalog';
import type {ChatUiDocumentSegment} from '../ChatUiTextSegment';
import {
    isOpenUiDocumentSegment,
    openUiLangFormat,
    type OpenUiLangFormatOptions
} from './OpenUiLangFormat';

/**
 * A text format gets no retry: what the model writes is what the user sees. Apps rely on the
 * format to render a slip that has one clear reading, to show a fallback that names the problem
 * where a slip would otherwise render wrong, to report what the parser dropped, and to offer the
 * model only what the catalog can take.
 */
describe('OpenUI Lang mistakes', () => {
    beforeAll(() => initTestAppAsync());

    describe('an argument written by name', () => {
        it('renders the element as a fallback that names the argument, not with shifted props', () => {
            silenceWarnings();
            const catalog = createCatalog(),
                segment = parse(
                    catalog,
                    'root = Stack([note], direction: "row")\nnote = Text("Hello")'
                );

            expect(segment.elementErrors).toEqual({
                root: [
                    "elements.root: argument 'direction' is written by name - OpenUI Lang takes " +
                        'arguments by position, so write only the value'
                ]
            });
            const html = markup(catalog.renderSegment(segment, CONTEXT));
            expect(html).toContain('This stack could not be displayed.');
            expect(html).toContain('written by name');
        });

        it('takes the colon of an object, and of a ternary, as it is written', () => {
            const segment = parse(
                createCatalog({bindings: true}),
                'root = Stack([kpis, note])\n' +
                    'kpis = Metrics([{label: "Revenue", value: 12}])\n' +
                    'note = Text($big ? "Large" : "Small")'
            );

            expect(segment.elementErrors).toBeUndefined();
        });
    });

    describe('one value where a list goes', () => {
        it('takes a single action as a list of one', () => {
            const catalog = createCatalog(),
                segment = parse(
                    catalog,
                    'root = Stack([acme])\n' +
                        'acme = Card("Acme", null, [{label: "Rating", value: "A+"}], @ToAssistant("More"))'
                );

            expect(segment.document.elements.acme.props.actions).toEqual([
                {type: 'send', text: 'More', label: 'More'}
            ]);
            expect(catalog.validateDocument(segment.document)).toEqual([]);
        });

        it('takes a single action as a list of one in a program with state', () => {
            const catalog = createCatalog({bindings: true}),
                segment = parse(
                    catalog,
                    'root = Stack([acme])\n' +
                        'acme = Card("Acme", null, [{label: "Rating", value: "A+"}], @ToAssistant("More"))'
                ),
                resolved = segment.document.state.resolve(
                    segment.document.state.create({...CONTEXT, isPartial: false}),
                    {...CONTEXT, isPartial: false}
                );

            expect(resolved.elements.acme.props.actions).toEqual([
                {type: 'send', text: 'More', label: 'More'}
            ]);
        });
    });

    describe('what the parser found', () => {
        it('reports dropped props, undefined names and unused statements on the segment', () => {
            silenceWarnings();
            const segment = parse(
                createCatalog(),
                'root = Stack([kpis, missing])\n' +
                    'kpis = Metrics([{label: "Revenue", value: 12}], "extra")\n' +
                    'unused = Text("Never shown")'
            );

            expect(isOpenUiDocumentSegment(segment)).toBe(true);
            if (!isOpenUiDocumentSegment(segment)) return;
            expect(segment.openui.unresolved).toEqual(['missing']);
            expect(segment.openui.orphaned).toEqual(['unused']);
            expect(segment.openui.errors).toEqual([
                expect.stringMatching(/^elements\.kpis: Metrics takes 1 arg/)
            ]);
        });

        it('tells its own segments from those of another format', () => {
            const [tag] = new ChatUiCatalog({
                components: [chatUiMetricsSpec()],
                modes: ['tags']
            }).parseText('<ui-metrics metrics=\'[{"label": "A", "value": 1}]\'/>');

            expect(isOpenUiDocumentSegment(tag)).toBe(false);
        });
    });

    describe('prompt', () => {
        const prompt = (config: Partial<ChatUiCatalogConfig>, opts = {}) =>
            new ChatUiCatalog({
                components: [],
                textFormats: [openUiLangFormat({root: 'stack', ...opts})],
                modes: ['openui'],
                ...config
            }).toPrompt();

        it('offers each action prop only the steps that its schema accepts', () => {
            const text = prompt(
                {components: [chatUiStackSpec(), chatUiCardSpec(), chatUiButtonSpec()]},
                {bindings: true}
            );

            expect(text).toContain('actions?: @ToAssistant[]');
            expect(text).toContain('action?: @ToAssistant | @Set | @Reset');
            // The line ahead of the signatures names these types, and no type that none shows.
            expect(text).toContain(
                'A prop typed `@ToAssistant[]` or `@ToAssistant | @Set | @Reset` takes only the ' +
                    'steps that its type lists: one @step, or Action([@steps...]) for several. ' +
                    'See the Action section for what each step does.'
            );
            expect(text).not.toContain('ActionExpression');
            // The prompt lists the steps that a component takes, and names no other.
            expect(text).toContain('- @Set(variable: $variable, value: any)');
            expect(text).not.toContain('@OpenUrl');
        });

        it('leaves a prop that takes every step as an ActionExpression', () => {
            const text = prompt({
                components: [
                    chatUiStackSpec(),
                    chatUiCardSpec({actionTypes: ['send', 'openUrl']}),
                    chatUiButtonSpec()
                ]
            });

            expect(text).toContain('actions?: ActionExpression[]');
            expect(text).toContain('- @OpenUrl(url: string)');
            expect(text).toContain(
                'A prop typed `ActionExpression` takes one @step, or Action([@steps...]) for ' +
                    'several. A prop typed `@ToAssistant` takes only the steps that its type ' +
                    'lists. See the Action section for what each step does.'
            );
        });

        it('says nothing of actions where no prop takes one', () => {
            const text = prompt({components: [chatUiStackSpec(), chatUiTextSpec()]});

            expect(text).not.toContain('A prop typed');
            expect(text).not.toContain('Action');
            expect(text).not.toContain('@ToAssistant');
        });

        it('says once that a program cannot change data, and names no way to write', () => {
            const rule = '- A program cannot change data.',
                send =
                    ' To change something, send a message with @ToAssistant that asks the ' +
                    'assistant to do it.',
                buttons = [chatUiStackSpec(), chatUiCardSpec(), chatUiButtonSpec()],
                noActions = prompt({components: [chatUiStackSpec(), chatUiTextSpec()]}),
                noState = prompt({components: buttons}),
                withState = prompt({components: buttons}, {bindings: true}),
                withTool = prompt({components: buttons}, {queryTools: ['get_sales']});

            // With no component that sends a message, the rule names no step.
            expect(noActions).toContain(`${rule}\n`);
            [noState, withState, withTool].forEach(text => {
                expect(text).toContain(rule + send);
                expect(text.match(/cannot change/g)).toHaveLength(1);
            });
            [noActions, noState, withState, withTool].forEach(text =>
                expect(text).not.toContain('Mutation')
            );
            // A format that runs every part of the language lists no part as off.
            expect(noState).toContain('- Do not use $variables, Query, @Set, @Reset or @Run.');
            expect(withState).toContain('- Do not use Query or @Run.');
            expect(withTool).not.toContain('Do not use');
        });

        it('shows no button that the catalog lacks, and says when it has no inputs', () => {
            const text = prompt({
                components: [chatUiStackSpec(), chatUiTextSpec(), chatUiCardSpec()]
            });

            expect(text).not.toContain('Button(');
            expect(text).not.toContain('## Forms');
            expect(text).toContain('- This library has no inputs and no forms.');

            const full = prompt({components: [chatUiStackSpec(), ...chatUiInputSpecs()]});
            expect(full).not.toContain('This library has no');
        });

        it('shows one program with the components that show data, not one per component', () => {
            const text = prompt({
                components: [
                    chatUiStackSpec(),
                    chatUiDividerSpec(),
                    chatUiTabsSpec(),
                    chatUiSectionSpec(),
                    chatUiTextSpec(),
                    chatUiMetricsSpec(),
                    ...chatUiInputSpecs()
                ]
            });

            // The root holds no divider, no empty container and no input.
            expect(text.match(/^root = .*$/gm)).toEqual([
                'root = Stack([text, metrics], "column", "medium")'
            ]);
            expect(text).not.toMatch(/^\w+ = (Divider|Tabs|Section|Form|Button|TextInput)\(/m);
        });

        it("puts the kit's rules with lang-core's rules, ahead of its final checks", () => {
            const text = prompt(
                {components: [chatUiStackSpec(), chatUiTextSpec()]},
                {additionalRules: ['Lead with the answer.']}
            );
            const rules = text.indexOf('## Important Rules'),
                checks = text.indexOf('## Final Verification');

            expect(rules).toBeGreaterThan(0);
            [
                '- Write every program in full',
                '- A program holds at most',
                '- Lead with the answer.'
            ].forEach(rule => {
                expect(text.indexOf(rule)).toBeGreaterThan(rules);
                expect(text.indexOf(rule)).toBeLessThan(checks);
            });
        });
    });
});

//------------------
// Helpers
//------------------
const CONTEXT = {
    chatModel: null as null,
    messageId: 'm1',
    part: {type: 'text' as const, id: 'p1', text: '', state: 'done' as const}
};

class AppStandInModel extends HoistModel {}

// A Hoist app renders inside the context of its models, which the components look up.
const appContext = hoistCmp.factory({
    displayName: 'TestAppContext',
    model: creates(AppStandInModel),
    render: ({children}) => fragment(children)
});

function createCatalog(opts: Partial<OpenUiLangFormatOptions> = {}): ChatUiCatalog {
    return new ChatUiCatalog({
        components: [chatUiStackSpec(), chatUiTextSpec(), chatUiMetricsSpec(), chatUiCardSpec()],
        textFormats: [openUiLangFormat({root: 'stack', ...opts})],
        modes: ['openui']
    });
}

function parse(catalog: ChatUiCatalog, program: string): ChatUiDocumentSegment {
    const [segment] = catalog.parseText(program);
    expect(segment.type).toBe('document');
    return segment as ChatUiDocumentSegment;
}

function markup(content: ReactNode): string {
    return renderToStaticMarkup(appContext({children: content}));
}

function silenceWarnings() {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    onTestFinished(() => warn.mockRestore());
}
