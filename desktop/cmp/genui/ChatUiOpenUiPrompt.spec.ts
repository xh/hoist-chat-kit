import {initTestAppAsync} from '@xh/hoist/test-support';
import {beforeAll, describe, expect, it} from 'vitest';
import {ChatUiCatalog} from '../../../genui';
import {
    openUiLangFormat,
    toOpenUiLibrary,
    type OpenUiLangFormatOptions
} from '../../../genui/openui';
import {
    chatUiBadgesSpec,
    chatUiCalloutSpec,
    chatUiCardSpec,
    chatUiChartSpec,
    chatUiDividerSpec,
    chatUiGridSpec,
    chatUiInputSpecs,
    chatUiMetricsSpec,
    chatUiSectionSpec,
    chatUiStackSpec,
    chatUiTabsSpec,
    chatUiTextSpec,
    chatUiTreeMapSpec
} from './index';

/**
 * The OpenUI Lang prompt for a catalog of the built-in components. lang-core writes the
 * grammar. The kit writes each section that names components, from the catalog. A model follows
 * an example before a rule, so the prompt must show nothing that the catalog cannot run.
 */
describe('OpenUI Lang prompt for the built-in components', () => {
    beforeAll(() => initTestAppAsync());

    it('calls only components of the catalog, with the steps that one accepts', () => {
        const prompt = createPrompt({queryTools: [SALES_TOOL]}),
            names = Object.keys(
                toOpenUiLibrary(createCatalog({queryTools: [SALES_TOOL]}), {root: 'stack'})
                    .components
            );

        const calls = [...prompt.matchAll(/(?<![@\w])([A-Z]\w*)\(/g)].map(it => it[1]),
            unknown = calls.filter(it => !names.includes(it) && !GRAMMAR_NAMES.includes(it));
        expect([...new Set(unknown)]).toEqual([]);

        const steps = [...prompt.matchAll(/@([A-Z]\w*)/g)].map(it => it[1]),
            unknownSteps = steps.filter(it => !STEPS.includes(it) && !FUNCTIONS.includes(it));
        expect([...new Set(unknownSteps)]).toEqual([]);
        expect(prompt).not.toContain('Mutation(');

        // No component here takes @OpenUrl, so the prompt does not name the step.
        expect(prompt).not.toContain('@OpenUrl');
    });

    it('writes the sections on actions, filters and forms from the catalog', () => {
        const prompt = createPrompt({queryTools: [SALES_TOOL]});

        expect(section(prompt, 'Action')).toContain(
            'Button("Show trades", Action([@Set($step, 2), @ToAssistant("Show the next step")]))'
        );
        expect(section(prompt, 'Query')).toContain(
            'Button("Show trades", Action([@Run(query1), @Run(query2)]))'
        );
        expect(section(prompt, 'Interactive Filters')).toMatch(/Bind it .*: `\w+\(.*\$\w+\)`/);
        expect(section(prompt, 'Forms')).toMatch(/form = Form\(\[field, submit\]/);
        expect(section(prompt, 'Forms')).toContain('submit = Button(');
        expect(section(prompt, 'Data Workflow')).toContain('cannot change it');
    });

    it('leaves out the section of a part that the catalog lacks', () => {
        const noForm = createPrompt({queryTools: [SALES_TOOL]}, ['form']),
            noInputs = createPrompt({queryTools: [SALES_TOOL]}, INPUT_NAMES),
            noState = createPrompt({});

        expect(section(noForm, 'Forms')).toBeNull();
        expect(section(noForm, 'Interactive Filters')).not.toBeNull();
        expect(section(noInputs, 'Interactive Filters')).toBeNull();
        expect(section(noInputs, 'Forms')).toBeNull();
        expect(section(noState, 'Action')).toContain('@ToAssistant');
        expect(section(noState, 'Action')).not.toContain('@Set');
        expect(section(noState, 'Data Workflow')).toBeNull();
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
    // The names that lang-core's grammar uses for its own syntax, and to stand for any component.
    GRAMMAR_NAMES = ['Query', 'Action', 'TypeName', 'SomeComp', 'Comp'],
    STEPS = ['ToAssistant', 'Set', 'Reset', 'Run'],
    FUNCTIONS = [
        ...['Count', 'First', 'Last', 'Sum', 'Avg', 'Min', 'Max', 'Sort', 'Filter'],
        ...['Round', 'Abs', 'Floor', 'Ceil', 'Each']
    ],
    INPUT_NAMES = chatUiInputSpecs()
        .filter(it => it.stateProps?.length)
        .map(it => it.name);

function createCatalog(opts: Partial<OpenUiLangFormatOptions>, without: string[] = []) {
    const components = [
        chatUiStackSpec(),
        chatUiTextSpec(),
        chatUiMetricsSpec(),
        chatUiGridSpec(),
        chatUiChartSpec(),
        chatUiCardSpec(),
        chatUiTabsSpec(),
        chatUiSectionSpec(),
        chatUiCalloutSpec(),
        chatUiBadgesSpec(),
        chatUiDividerSpec(),
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
