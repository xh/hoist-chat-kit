import type {PlainObject} from '@xh/hoist/core';
import {compact, isEmpty, isString, omit} from 'lodash';
import {isChatUiActionSchema} from '../../ChatUiAction';
import type {ChatUiCatalog} from '../../ChatUiCatalog';
import type {ChatUiComponentSpec} from '../../ChatUiComponentSpec';
import type {ChatUiDocument, ChatUiElement} from '../../ChatUiDocument';
import type {OpenUiLibrary} from '../OpenUiLibrary';

/** What {@link rewritePromptSections} needs to know of the format. */
export interface PromptSectionOptions {
    catalog: ChatUiCatalog;
    library: OpenUiLibrary;

    /** Catalog name of the root component. */
    root: string;

    /** True if programs run `$variables`, `@Set` and `@Reset`. */
    bindings: boolean;

    /** True if a program may call a tool with `Query()`. */
    toolCalls: boolean;

    /** Writes a document as a program - the format's `formatOpenUiProgram`. */
    formatProgram: (doc: ChatUiDocument) => string;
}

/**
 * lang-core's prompt, with each section that names components written again by the kit.
 *
 * lang-core writes the grammar, which holds for any library. Its sections on actions, filters,
 * forms and data name the components of Thesys's own library, such as `FormControl` and
 * `SelectItem`, with the argument order of that library. They also teach `Mutation()` and
 * `@OpenUrl`, whatever the catalog takes. A model follows an example before it follows a rule
 * that says to ignore the example. So the kit writes each of these sections from the catalog:
 * its examples call the catalog's own components, with their arguments in order, and list only
 * the steps that a component accepts. A section whose component the catalog lacks is left out.
 * @internal
 */
export function rewritePromptSections(prompt: string, opts: PromptSectionOptions): string {
    const writer = new SectionWriter(opts);
    let ret = prompt;
    ret = replaceSection(ret, 'Mutation', null);
    ret = replaceSection(ret, 'Action', writer.actions());
    ret = replaceSection(ret, 'Interactive Filters', writer.filters());
    ret = replaceSection(ret, 'Forms', writer.forms());
    ret = replaceSection(ret, 'Data Workflow', writer.dataWorkflow());
    ret = editSection(ret, 'Query', text => writer.query(text));
    ret = editSection(ret, 'Available Tools', text => writer.tools(text));
    // Two lines of the signatures section name every step, whatever the catalog takes.
    return ret
        .replace(/(See the Action section for available steps) \([^)\n]*\)\./, '$1.')
        .replace(
            /Props typed like `[^`\n]*` accept only the steps listed\./,
            'A prop typed with a list of @steps accepts only those steps.'
        );
}

//------------------
// Implementation
//------------------
const ACTION_MARK = '__xhAction__',
    BINDING_MARK = '__xhBinding__',
    CANNOT_CHANGE_DATA =
        'A program reads data, and cannot change it. To change something, send a message with ' +
        '@ToAssistant that asks the assistant to do it.';

// Writes the kit's sections for one catalog.
class SectionWriter {
    private readonly opts: PromptSectionOptions;

    // A component with one action prop, and an example to write it from.
    private readonly button: ChatUiComponentSpec;
    private readonly actionProp: string;

    // A component that a `$variable` binds to, with an example.
    private readonly input: ChatUiComponentSpec;
    private readonly form: ChatUiComponentSpec;

    constructor(opts: PromptSectionOptions) {
        const {components} = opts.catalog,
            hasExample = (it: ChatUiComponentSpec) => !!it.example && it.name !== opts.root;
        this.opts = opts;
        this.button = components.find(it => hasExample(it) && getActionProp(it) != null) ?? null;
        this.actionProp = this.button ? getActionProp(this.button) : null;
        this.input = opts.bindings
            ? (components.find(it => hasExample(it) && !isEmpty(it.stateProps)) ?? null)
            : null;
        this.form = components.find(it => it.name === 'form' && it.slots?.includes('default'));
    }

    // The steps that some component accepts, in the order that the prompt lists them.
    private get steps(): string[] {
        const {library, bindings, toolCalls} = this.opts,
            offered = [
                'ToAssistant',
                'OpenUrl',
                ...(bindings ? ['Set', 'Reset'] : []),
                ...(toolCalls ? ['Run'] : [])
            ];
        return offered.filter(it => library.actionSteps.includes(it));
    }

    actions(): string {
        const {steps} = this;
        if (isEmpty(steps)) return null;

        const one =
                steps.includes('ToAssistant') && this.buttonTakes('send')
                    ? '@ToAssistant("Tell me more")'
                    : null,
            several =
                one && steps.includes('Set') && this.buttonTakes('state')
                    ? 'Action([@Set($step, 2), @ToAssistant("Show the next step")])'
                    : null,
            lines = {
                ToAssistant:
                    '- @ToAssistant(message: string, context?: object) - Send a message to the ' +
                    'assistant, as the user. The optional context is a flat object of short ' +
                    'values that goes with the message, such as {id: row.id}.',
                OpenUrl: '- @OpenUrl(url: string) - Open a URL in a new tab.',
                Set: '- @Set(variable: $variable, value: any) - Set a $variable to a value.',
                Reset:
                    '- @Reset(variable: $variable) - Reset $variables to their declared ' +
                    'defaults. Pass several to reset each.',
                Run: '- @Run(ref: Query) - Fetch a declared Query again.'
            } as Record<string, string>;

        return compact([
            '## Action - What a Click Does',
            '',
            'An action wires a click to operations. Write an action only in an argument that ' +
                'Component Signatures types for one.' +
                (one
                    ? ` Pass one @-prefixed step bare, such as \`${this.buttonCall(one)}\`.`
                    : '') +
                (several
                    ? ` Put several steps in Action([...]), such as \`${this.buttonCall(several)}\`.`
                    : ''),
            '',
            'Available steps:',
            ...steps.map(it => lines[it]),
            '',
            '- Write an action inline, or assign it to a name and use the name.',
            steps.includes('Set')
                ? '- The steps run in order. A step reads the value that a @Set before it sets.'
                : null,
            this.opts.bindings ? `- ${CANNOT_CHANGE_DATA}` : null
        ]).join('\n');
    }

    filters(): string {
        const {input} = this;
        if (!input || !this.opts.toolCalls) return null;

        const prop = input.stateProps[0],
            variable = this.variableOf(input),
            name = variable.slice(1);
        return [
            '## Interactive Filters',
            '',
            'To let the user filter data with an input:',
            `1. Declare a $variable with a default: \`${variable} = ${JSON.stringify(input.example[prop] ?? '')}\``,
            `2. Bind it to the argument marked $binding: \`${this.callOf(input, {...input.example, [prop]: BINDING_MARK}).replace(JSON.stringify(BINDING_MARK), variable)}\``,
            `3. Pass it in the arguments of a Query: \`Query("tool_name", {${name}: ${variable}}, {rows: []})\``,
            '4. When the user changes the input, the $variable changes, and the Query fetches again.',
            '',
            'FILTER WIRING RULE: If the UI shows an input for a $variable, every Query that it ' +
                'should filter must read that $variable in its arguments.',
            '',
            'Rules for $variables:',
            '- Bind a $variable only to an argument marked $binding. Any other argument reads it.',
            '- A Query uses a regular name, not a $variable: `data = Query(...)`.',
            '- A $variable with no declaration starts as null. Declare it to set a default.'
        ].join('\n');
    }

    forms(): string {
        const {form, input, button, actionProp, opts} = this;
        if (!form || !input || !this.buttonTakes('send')) return null;

        const variable = this.variableOf(input),
            prop = input.stateProps[0],
            elements: Record<string, ChatUiElement> = {
                root: {component: opts.root, props: {}, children: ['form']},
                form: {
                    component: form.name,
                    props: form.example ?? {},
                    children: ['field', 'submit']
                },
                field: {component: input.name, props: omit(input.example, prop)},
                submit: {
                    component: button.name,
                    props: {
                        ...button.example,
                        [actionProp]: {type: 'send', text: 'Use these details.'}
                    }
                }
            },
            plain = this.statements(elements),
            bound = this.statements({
                ...elements,
                field: {component: input.name, props: {...input.example, [prop]: BINDING_MARK}}
            }).replace(JSON.stringify(BINDING_MARK), variable);
        return [
            '## Forms',
            '',
            'Put inputs and a button in a form. A click on the button checks each field first. ' +
                'A message that the button sends then carries the value of each field, by its name:',
            '```',
            plain,
            '```',
            '',
            'Bind a $variable to an input only where another part of the program reads its value:',
            '```',
            bound,
            '```'
        ].join('\n');
    }

    dataWorkflow(): string {
        if (!this.opts.toolCalls) return null;
        return [
            '## Data Workflow',
            '',
            'When tools are available:',
            '1. Use Query() for data that should stay live. Do not write the result of a tool ' +
                'as a literal list or object.',
            '2. Give each Query short defaults, with the shape of the real result, so that the ' +
                'UI renders at once.',
            '3. Derive counts and totals from Query results with the @-prefixed built-in ' +
                'functions, where they are listed above.',
            '4. Write a list by hand only for static data, such as labels and options.',
            `5. ${CANNOT_CHANGE_DATA}`,
            '',
            '```',
            'data = Query("tool_name", {}, {rows: []})',
            'openCount = @Count(@Filter(data.rows, "field", "==", "value"))',
            '```'
        ].join('\n');
    }

    // lang-core's Query section, with its refresh button written for the catalog.
    query(text: string): string {
        const canRun = this.opts.library.actionSteps.includes('Run') && this.buttonTakes('state'),
            lines = text
                .split('\n')
                .filter(it => !/^- (Manual refresh|Refresh all queries)/.test(it));
        if (canRun) {
            lines.push(
                `- Manual refresh: \`${this.buttonCall('Action([@Run(query1), @Run(query2)])')}\` ` +
                    'fetches the listed queries again.'
            );
        }
        return lines.join('\n').trimEnd();
    }

    // lang-core's list of tools, with no word of the writes that the kit does not run.
    tools(text: string): string {
        return text
            .replace(/ or Mutation\(\) for write operations\.[^\n]*/, '. Each one reads data.')
            .replace(' and Mutation() calls', ' calls');
    }

    // True if the example button takes an action of a type.
    private buttonTakes(type: string): boolean {
        const {button, actionProp} = this,
            schema: PlainObject = button?.props.properties[actionProp],
            branches: PlainObject[] = schema?.anyOf ?? compact([schema]);
        return branches.some(it => it?.properties?.type?.const === type);
    }

    // The example button with an action expression in its action argument.
    private buttonCall(action: string): string {
        const {button, actionProp} = this;
        if (!button) return action;
        return this.callOf(button, {
            ...button.example,
            [actionProp]: {type: 'send', text: ACTION_MARK}
        }).replace(`@ToAssistant(${JSON.stringify(ACTION_MARK)})`, action);
    }

    // A component as a call, with its arguments in the order of its signature.
    private callOf(spec: ChatUiComponentSpec, props: PlainObject): string {
        const program = this.opts.formatProgram({
            root: 'root',
            elements: {
                root: {component: this.opts.root, props: {}, children: ['x']},
                x: {component: spec.name, props}
            }
        });
        return (
            program
                .split('\n')
                .find(it => it.startsWith('x = '))
                ?.slice(4) ?? ''
        );
    }

    // The statements of a document, without its root.
    private statements(elements: Record<string, ChatUiElement>): string {
        return this.opts
            .formatProgram({root: 'root', elements})
            .split('\n')
            .filter(it => !it.startsWith('root = '))
            .join('\n');
    }

    // The `$variable` to bind to an input in an example: its own name, or that of its prop.
    private variableOf(input: ChatUiComponentSpec): string {
        const {name} = input.example as PlainObject;
        return '$' + (isString(name) && /^[A-Za-z_]\w*$/.test(name) ? name : input.stateProps[0]);
    }
}

// The one prop of a component that takes a single action, or null.
function getActionProp(spec: ChatUiComponentSpec): string {
    const props: PlainObject = spec.props?.properties ?? {};
    return Object.keys(props).find(key => isChatUiActionSchema(props[key])) ?? null;
}

// The start and the end of a section of the prompt, by the first words of its heading.
function findSection(prompt: string, heading: string): {start: number; end: number} {
    const start = prompt.indexOf(`\n## ${heading}`);
    if (start < 0) return null;
    const next = prompt.indexOf('\n## ', start + 1);
    return {start: start + 1, end: next < 0 ? prompt.length : next + 1};
}

// The prompt with a section replaced, or removed for null.
function replaceSection(prompt: string, heading: string, text: string): string {
    const at = findSection(prompt, heading);
    if (!at) return prompt;
    return prompt.slice(0, at.start) + (text ? `${text}\n\n` : '') + prompt.slice(at.end);
}

function editSection(prompt: string, heading: string, edit: (text: string) => string): string {
    const at = findSection(prompt, heading);
    return at
        ? replaceSection(prompt, heading, edit(prompt.slice(at.start, at.end)).trimEnd())
        : prompt;
}
