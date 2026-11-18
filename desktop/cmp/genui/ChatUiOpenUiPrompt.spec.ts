import {generateSystemPrompt, type ToolSpec} from '@openuidev/lang-core';
import {initTestAppAsync} from '@xh/hoist/test-support';
import {beforeAll, describe, expect, it} from 'vitest';
import {ChatUiCatalog, type ChatUiComponentSpec} from '../../../genui';
import {
    formatOpenUiProgram,
    isOpenUiDocumentSegment,
    openUiLangFormat,
    toOpenUiLibrary,
    type OpenUiLangFormatOptions
} from '../../../genui/openui';
import {rewritePromptSections} from '../../../genui/openui/impl/promptSections';
import {
    chatUiBadgesSpec,
    chatUiCalloutSpec,
    chatUiCardSpec,
    chatUiChartSpec,
    chatUiSeparatorSpec,
    chatUiGridSpec,
    chatUiInputSpecs,
    chatUiStatCardsSpec,
    chatUiSectionSpec,
    chatUiStackSpec,
    chatUiTabsSpec,
    chatUiTextSpec,
    chatUiTreeMapSpec
} from './index';

/**
 * The OpenUI Lang prompt for a catalog of the built-in components. lang-core writes the
 * grammar. The kit writes each part that names components, from the catalog. A model follows
 * an example before a rule, so the prompt must show nothing that the catalog cannot run.
 */
describe('OpenUI Lang prompt for the built-in components', () => {
    beforeAll(() => initTestAppAsync());

    it.each(['tool', 'bindings', 'plain'])(
        'calls only components of the catalog, with the steps that one accepts - %s',
        format => {
            const opts = FORMATS[format],
                prompt = createPrompt(opts),
                names = Object.keys(
                    toOpenUiLibrary(createCatalog(opts), {root: 'stack'}).components
                );

            const calls = [...prompt.matchAll(/(?<![@\w])([A-Z]\w*)\(/g)].map(it => it[1]),
                unknown = calls.filter(it => !names.includes(it) && !GRAMMAR_NAMES.includes(it));
            expect([...new Set(unknown)]).toEqual([]);

            const steps = [...prompt.matchAll(/@([A-Z]\w*)/g)].map(it => it[1]),
                unknownSteps = steps.filter(it => !STEPS.includes(it) && !FUNCTIONS.includes(it));
            expect([...new Set(unknownSteps)]).toEqual([]);
            expect(prompt).not.toContain('Mutation');

            // No component here takes @OpenUrl, so the prompt does not name the step.
            expect(prompt).not.toContain('@OpenUrl');
        }
    );

    it('writes the sections on actions, filters and forms from the catalog', () => {
        const prompt = createPrompt(FORMATS.tool);

        expect(section(prompt, 'Action')).toContain(
            'Button("Next", Action([@Set($step, 2), @ToAssistant("Show the next step")]))'
        );
        expect(section(prompt, 'Query')).toContain(
            '- Manual refresh: `Button("Refresh", Action([@Run(query1), @Run(query2)]))` ' +
                'fetches the listed queries again.'
        );
        // The filter is the first input whose example has a value to declare as the default.
        expect(section(prompt, 'Interactive Filters')).toContain('`$region = "emea"`');
        expect(section(prompt, 'Interactive Filters')).toMatch(
            /Bind it .*: `Select\(.*\$region\)`/
        );
        expect(section(prompt, 'Forms')).toMatch(/form = Form\(\[field, submit\]/);
        expect(section(prompt, 'Forms')).toContain('submit = Button("Submit", @ToAssistant(');
        expect(section(prompt, 'Data Workflow')).toContain('1. Use Query() for data that should');
    });

    it('leaves out the section of a part that the catalog lacks', () => {
        const noForm = createPrompt(FORMATS.tool, ['form']),
            noInputs = createPrompt(FORMATS.tool, INPUT_NAMES),
            noState = createPrompt({}),
            noFunctions = createPrompt({...FORMATS.tool, builtinFunctions: false});

        expect(section(noForm, 'Forms')).toBeNull();
        expect(section(noForm, 'Interactive Filters')).not.toBeNull();
        expect(section(noInputs, 'Interactive Filters')).toBeNull();
        expect(section(noInputs, 'Forms')).toBeNull();
        expect(section(noState, 'Action')).toContain('@ToAssistant');
        expect(section(noState, 'Action')).not.toContain('@Set');
        expect(section(noState, 'Data Workflow')).toBeNull();
        expect(section(noFunctions, 'Data Workflow')).not.toContain('@Count');
    });

    describe("lang-core's stock lines", () => {
        it('shows arguments by position on the root, with its own values', () => {
            const prompt = createPrompt(FORMATS.tool);

            expect(section(prompt, 'Syntax Rules')).toContain(
                '6. Arguments are POSITIONAL (order matters, not names). Write ' +
                    '`Stack([children], "column", "medium")` NOT `Stack([children], direction: ' +
                    '"column", gap: "medium")` - an argument written by name is NOT supported'
            );
            expect(section(prompt, 'Syntax Rules')).toContain(
                'component calls such as Stack(arg1, arg2, ...)'
            );
        });

        it('shows an @Each template and a query result with no made-up name', () => {
            const prompt = createPrompt(FORMATS.tool),
                noText = createPrompt(FORMATS.tool, ['text', 'callout']);

            expect(section(prompt, 'Built-in Functions')).toContain(
                '`@Each(data.rows, "item", Text(item.field))`'
            );
            expect(section(prompt, 'Built-in Functions')).toContain(
                'CORRECT: `list = @Each(rows, "t", Text(t.name))`'
            );
            // With no component that shows a string, the template is the expression alone.
            expect(section(noText, 'Built-in Functions')).toContain(
                'CORRECT: `list = @Each(rows, "t", t.name)`'
            );
            expect(section(prompt, 'Query')).toContain(
                '- Use dot access on results: data.defaultField, data.defaultData.field'
            );
            ['SomeComp', 'TypeName', 'Comp(', 'totalEvents', 'metrics = Query'].forEach(it =>
                expect(prompt).not.toContain(it)
            );
        });

        it('says to state that data is not available, and never to invent it', () => {
            const prompt = createPrompt(FORMATS.tool);

            expect(section(prompt, 'Available Tools')).toContain(
                'Do NOT invent or guess tool names. If no tool listed above gives the data ' +
                    'that the user asks for, say in words that the data is not available. ' +
                    'Never invent figures.'
            );
            expect(prompt).not.toContain('mock data');
        });

        it.each(['tool', 'bindings', 'plain'])(
            "finds each line that it replaces in lang-core's text - %s",
            format => {
                expect(rewriteStock(FORMATS[format]).missing).toEqual([]);
            }
        );

        it('reports a line that lang-core has changed, and keeps the changed line', () => {
            const {prompt, missing} = rewriteStock(FORMATS.tool, stock =>
                stock
                    .replace('use realistic mock data', 'use sample data')
                    .replace('SomeComp([children], "row", "l")', 'AnyComp([children], "row")')
                    .replace('## Mutation', '## Writes')
            );

            expect(missing).toEqual([
                '## Mutation',
                expect.stringContaining('Write `SomeComp([children], "row", "l")` NOT'),
                expect.stringContaining('use realistic mock data instead of fabricating')
            ]);
            expect(prompt).toContain('use sample data');
            expect(prompt).toContain('AnyComp([children], "row")');
        });
    });

    describe('data by reference', () => {
        it('says when to call a tool and show its result by id, and when to write a Query', () => {
            const prompt = createCatalog(FORMATS.tool, [], true).instructions,
                workflow = section(prompt, 'Data Workflow');

            expect(workflow).toContain(
                '1. Choose how a view gets its data. For a fixed view, call the tool yourself, ' +
                    'then pass the id of its result to an argument that takes data by ' +
                    'reference: `data` of Grid, `data` of Chart. For a view that the user ' +
                    'changes, such as one with a filter, use Query().'
            );
            expect(workflow).toContain(
                '2. A Query result is plain data, and keeps no artifact. It cannot go in an ' +
                    'argument that takes data by reference.'
            );
            // The brief shows a result by its id.
            expect(examplePrograms(prompt)[0]).toContain(
                'grid = Grid("Largest positions", "positions-1", '
            );
        });

        it('gives no such choice with no tool, or with no component that takes a reference', () => {
            const noTool = createCatalog({}, [], true).instructions,
                inline = createPrompt(FORMATS.tool);

            expect(noTool).not.toContain('Choose how a view gets its data');
            expect(inline).not.toContain('Choose how a view gets its data');
        });
    });

    describe('examples', () => {
        it('shows a brief and a view that a Query feeds, each in a fence', () => {
            const prompt = createPrompt(FORMATS.tool),
                [brief, view, ...rest] = examplePrograms(prompt);

            expect(rest).toEqual([]);
            expect(section(prompt, 'Examples').match(/```openui-lang\n/g)).toHaveLength(2);
            expect(brief.split('\n').map(it => it.replace(/\(.*/, ''))).toEqual([
                'root = Stack',
                'text = Text',
                'statCards = StatCards',
                'chart = Chart'
            ]);
            expect(view.split('\n')).toEqual([
                'root = Stack([select, grid], "column", "medium")',
                '$region = "emea"',
                'data = Query("get_sales", {region: $region}, {rows: []})',
                expect.stringMatching(/^select = Select\("region", .*, \$region\)$/),
                expect.stringMatching(/^grid = Grid\("Top positions", .*, data\.rows\)$/)
            ]);
        });

        it('shows no program per component, and puts no separator in a root', () => {
            const prompt = createPrompt(FORMATS.tool),
                examples = section(prompt, 'Examples');

            expect(examplePrograms(prompt)).toHaveLength(2);
            expect(examples).not.toContain('Separator()');
            ['Tabs', 'Section', 'Card', 'Button', 'Checkbox'].forEach(it =>
                expect(examples).not.toContain(`${it}(`)
            );
        });

        it('writes each program with no fence where the reply is one program', () => {
            const prompt = createPrompt({...FORMATS.tool, inline: false});

            expect(prompt).not.toContain('```openui-lang');
            expect(examplePrograms(prompt)).toHaveLength(2);
        });

        it('reads the rows of a result from the schema of the tool', () => {
            const tool = {
                    ...SALES_TOOL,
                    returns: {
                        type: 'object',
                        properties: {total: {type: 'number'}, sales: {type: 'array'}}
                    }
                },
                [, view] = examplePrograms(createPrompt({queryTools: [tool]}));

            expect(view).toContain('data = Query("get_sales", {region: $region}, {sales: []})');
            expect(view).toMatch(/, data\.sales\)$/);
        });

        it('shows a text that reads the variable where no Query can take it', () => {
            const view = [
                'root = Stack([select, text], "column", "medium")',
                '$region = "emea"',
                expect.stringMatching(/^select = Select\("region", .*, \$region\)$/),
                'text = Text($region)'
            ];

            // With no tool, with a tool that the prompt knows by name only, and with no
            // component that takes the rows of a result.
            expect(examplePrograms(createPrompt(FORMATS.bindings))[1].split('\n')).toEqual(view);
            expect(
                examplePrograms(createPrompt({queryTools: ['get_sales']}))[1].split('\n')
            ).toEqual(view);
            expect(examplePrograms(createPrompt(FORMATS.tool, ['grid']))[1].split('\n')).toEqual(
                view
            );
        });

        it('leaves out an example whose components the catalog lacks', () => {
            const noState = examplePrograms(createPrompt({})),
                noInputs = examplePrograms(createPrompt(FORMATS.tool, INPUT_NAMES)),
                onlyInputs = examplePrograms(createPrompt(FORMATS.tool, DISPLAY_NAMES)),
                nothingShown = createPrompt({}, DISPLAY_NAMES);

            // A brief only, with the first components that show data.
            expect(noState).toEqual([
                expect.stringMatching(/^root = Stack\(\[text, statCards, grid\]/)
            ]);
            expect(noInputs).toEqual([
                expect.stringMatching(/^root = Stack\(\[text, statCards, grid\]/)
            ]);
            // The input alone, with no component to read its variable.
            expect(onlyInputs).toEqual([
                expect.stringMatching(
                    /^root = Stack\(\[select\], .*\n\$region = "emea"\nselect = Select\(.*, \$region\)$/
                )
            ]);
            expect(section(nothingShown, 'Examples')).toBeNull();
        });

        it("shows the app's own examples in place of all of these", () => {
            const prompt = createPrompt({...FORMATS.tool, examples: ['root = Stack([])']});

            expect(section(prompt, 'Examples').trim()).toBe('## Examples\n\nroot = Stack([])');
        });

        it.each(['tool', 'bindings', 'plain', 'one program', 'by reference', 'inputs only'])(
            'writes examples that parse with no error - %s',
            name => {
                const catalog = EXAMPLE_CATALOGS[name](),
                    programs = examplePrograms(catalog.instructions);

                expect(programs.length).toBeGreaterThan(0);
                programs.forEach(program => {
                    const segments = catalog.parseText(program),
                        [segment] = segments;

                    expect(segments).toHaveLength(1);
                    expect(isOpenUiDocumentSegment(segment)).toBe(true);
                    if (!isOpenUiDocumentSegment(segment)) return;
                    expect(segment.elementErrors).toBeUndefined();
                    expect(segment.openui).toMatchObject({
                        errors: [],
                        unresolved: [],
                        orphaned: []
                    });

                    // The props pass each schema, once the state of the program gives its values.
                    const {state} = segment.document,
                        resolved = state
                            ? state.resolve(state.create(CONTEXT), CONTEXT)
                            : segment.document;
                    expect(catalog.validateDocument(resolved)).toEqual([]);
                });
            }
        );
    });
});

//------------------
// Helpers
//------------------
const SALES_TOOL = {
        name: 'get_sales',
        description: 'Sales by region.',
        parameters: {type: 'object', properties: {region: {type: 'string'}}}
    },
    // The parts of OpenUI Lang that a format can run, from none to all.
    FORMATS: Record<string, Partial<OpenUiLangFormatOptions>> = {
        tool: {queryTools: [SALES_TOOL]},
        bindings: {bindings: true},
        plain: {}
    },
    // The names that lang-core's grammar uses for its own syntax.
    GRAMMAR_NAMES = ['Query', 'Action'],
    STEPS = ['ToAssistant', 'Set', 'Reset', 'Run'],
    FUNCTIONS = [
        ...['Count', 'First', 'Last', 'Sum', 'Avg', 'Min', 'Max', 'Sort', 'Filter'],
        ...['Round', 'Abs', 'Floor', 'Ceil', 'Each']
    ],
    INPUT_NAMES = chatUiInputSpecs()
        .filter(it => it.stateProps?.length)
        .map(it => it.name),
    DISPLAY_NAMES = [
        ...['text', 'statCards', 'grid', 'chart', 'card', 'tabs', 'section', 'callout'],
        ...['badges', 'separator', 'treemap']
    ],
    CONTEXT = {
        chatModel: null as null,
        messageId: 'm1',
        part: {type: 'text' as const, id: 'p1', text: '', state: 'done' as const},
        isPartial: false
    },
    // A catalog for each kind of example that the format writes.
    EXAMPLE_CATALOGS: Record<string, () => ChatUiCatalog> = {
        tool: () => createCatalog(FORMATS.tool),
        bindings: () => createCatalog(FORMATS.bindings),
        plain: () => createCatalog(FORMATS.plain),
        'one program': () => createCatalog({...FORMATS.tool, inline: false}),
        'by reference': () => createCatalog(FORMATS.tool, [], true),
        'inputs only': () => createCatalog(FORMATS.tool, DISPLAY_NAMES)
    };

function createCatalog(
    opts: Partial<OpenUiLangFormatOptions>,
    without: string[] = [],
    byReference: boolean = false
) {
    const components: ChatUiComponentSpec<any>[] = [
        chatUiStackSpec(),
        chatUiTextSpec(),
        chatUiStatCardsSpec(),
        // Inline, the model writes the rows. By reference, it names an artifact.
        byReference ? chatUiGridSpec({byReference}) : chatUiGridSpec(),
        byReference ? chatUiChartSpec({byReference}) : chatUiChartSpec(),
        chatUiCardSpec(),
        chatUiTabsSpec(),
        chatUiSectionSpec(),
        chatUiCalloutSpec(),
        chatUiBadgesSpec(),
        chatUiSeparatorSpec(),
        chatUiTreeMapSpec(),
        // The form, the button and each input.
        ...chatUiInputSpecs()
    ];
    return new ChatUiCatalog({
        components: components.filter(it => !without.includes(it.name)),
        textFormats: [openUiLangFormat({root: 'stack', ...opts})],
        modes: ['openui']
    });
}

function createPrompt(opts: Partial<OpenUiLangFormatOptions>, without: string[] = []): string {
    return createCatalog(opts, without).instructions;
}

// A section of the prompt, by the first words of its heading. Null if the prompt has none.
function section(prompt: string, heading: string): string {
    const start = prompt.indexOf(`\n## ${heading}`);
    if (start < 0) return null;
    const end = prompt.indexOf('\n## ', start + 1);
    return prompt.slice(start, end < 0 ? prompt.length : end);
}

// The example programs of a prompt, each without its fence.
function examplePrograms(prompt: string): string[] {
    return (section(prompt, 'Examples') ?? '')
        .split('\n\n')
        .map(it => it.trim().replace(/^```openui-lang\n|\n```$/g, ''))
        .filter(it => it.startsWith('root = '));
}

// What the kit makes of lang-core's own prompt for the catalog, after `change` edits that prompt
// as a later version of lang-core could.
function rewriteStock(
    opts: Partial<OpenUiLangFormatOptions>,
    change: (stock: string) => string = stock => stock
) {
    const toolCalls = !!opts.queryTools?.length,
        bindings = opts.bindings ?? toolCalls,
        catalog = createCatalog(opts),
        library = toOpenUiLibrary(catalog, {root: 'stack', bindings, toolCalls}),
        {root, components, schema} = library,
        stock = generateSystemPrompt({
            library: {root, components, schema},
            promptOptions: {
                bindings,
                toolCalls,
                tools: toolCalls ? [{name: 'get_sales'} as ToolSpec] : undefined,
                builtinFunctions: bindings
            }
        });
    return rewritePromptSections(change(stock), {
        catalog,
        library,
        root: 'stack',
        bindings,
        builtinFunctions: bindings,
        toolCalls,
        formatProgram: doc => formatOpenUiProgram(catalog, library, doc)
    });
}
