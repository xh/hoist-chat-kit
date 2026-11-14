import type {PlainObject} from '@xh/hoist/core';
import {
    compact,
    findKey,
    isBoolean,
    isEmpty,
    isNumber,
    isRegExp,
    isString,
    mapValues,
    minBy,
    omit,
    size,
    uniq,
    without
} from 'lodash';
import {isChatUiActionSchema} from '../../ChatUiAction';
import type {ChatUiCatalog} from '../../ChatUiCatalog';
import type {ChatUiComponentSpec, ChatUiDataPropSpec} from '../../ChatUiComponentSpec';
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

    /** True if the prompt lists the built-in functions. */
    builtinFunctions: boolean;

    /** True if a program may call a tool with `Query()`. */
    toolCalls: boolean;

    /** Writes a document as a program - the format's `formatOpenUiProgram`. */
    formatProgram: (doc: ChatUiDocument) => string;
}

/** What {@link rewritePromptSections} returns. */
export interface PromptSections {
    /** The prompt, with the kit's sections and lines. */
    prompt: string;

    /**
     * The text of lang-core that the kit expected and did not find: a section, by its heading,
     * or a stock line. The prompt keeps what lang-core wrote in its place. Empty for the
     * version of lang-core that the kit pins.
     */
    missing: string[];
}

/**
 * lang-core's prompt, with each part that names components written again by the kit.
 *
 * lang-core writes the grammar, which holds for any library. Its sections on actions, filters,
 * forms and data name the components of Thesys's own library, such as `FormControl` and
 * `SelectItem`, with the argument order of that library. They also teach `Mutation()` and
 * `@OpenUrl`, whatever the catalog takes. Lines of its other sections call components that no
 * library has, such as `SomeComp`. A model follows an example before it follows a rule that says
 * to ignore the example. So the kit writes each of these from the catalog: its examples call the
 * catalog's own components, with their arguments in order, and list only the steps that a
 * component accepts. A section whose component the catalog lacks is left out.
 *
 * Each change names the stock text that it replaces. A text that lang-core no longer writes is
 * reported in `missing`, so that a change of lang-core's wording does not pass unseen.
 * @internal
 */
export function rewritePromptSections(prompt: string, opts: PromptSectionOptions): PromptSections {
    const writer = new SectionWriter(opts),
        stock = new StockPrompt(prompt),
        {toolCalls, bindings, builtinFunctions} = opts,
        {takesActions} = writer;

    stock.section('Mutation', null, toolCalls);
    stock.section('Action', writer.actions(), takesActions);
    stock.section('Interactive Filters', writer.filters(), toolCalls && bindings);
    stock.section('Forms', writer.forms(), toolCalls && bindings);
    stock.section('Data Workflow', writer.dataWorkflow(), toolCalls);

    // Syntax Rules.
    stock.line(
        'component calls TypeName(arg1, arg2, ...)',
        `component calls such as ${opts.library.root}(arg1, arg2, ...)`
    );
    stock.line(
        'Write `SomeComp([children], "row", "l")` NOT `SomeComp([children], direction: "row", ' +
            `gap: "l")\` ${EM_DASH} colon syntax is NOT supported and silently breaks`,
        writer.positionalRule()
    );

    // Component Signatures.
    stock.line(
        /Props typed `ActionExpression` accept one @step, or Action\(\[@steps\.\.\.\]\) for several\. See the Action section for available steps \([^)\n]*\)\./,
        writer.actionTypes(),
        takesActions
    );
    stock.line(
        'Props typed like `@OpenUrl | @ToAssistant` accept only the steps listed.',
        null,
        writer.hasStepLists
    );

    // Built-in Functions.
    stock.line('Comp(item.field)', writer.eachTemplate('item.field'), builtinFunctions);
    stock.line('Comp(t.name)', writer.eachTemplate('t.name'), builtinFunctions);

    // Query.
    stock.line(
        'metrics = Query("tool_name", {arg1: value, arg2: $binding}, {defaultField: 0, ' +
            'defaultData: []}, refreshInterval?)',
        'data = Query("tool_name", {arg1: value, arg2: $binding}, {defaultField: 0, ' +
            'defaultData: []}, refreshInterval?)',
        toolCalls
    );
    stock.line(
        '- Use dot access on results: metrics.totalEvents, metrics.data.day (array pluck)',
        '- Use dot access on results: data.defaultField, data.defaultData.field (array pluck)',
        toolCalls
    );
    stock.line(
        '- Query results must use regular identifiers: `metrics = Query(...)`, NOT `$metrics = ' +
            'Query(...)`',
        '- Query results must use regular identifiers: `data = Query(...)`, NOT `$data = ' +
            'Query(...)`',
        toolCalls
    );
    stock.line(
        '- Manual refresh: `Button("Refresh", Action([@Run(query1), @Run(query2)]), ' +
            `"secondary")\` ${EM_DASH} re-fetches the listed queries`,
        writer.refreshRule(),
        toolCalls
    );
    stock.line('- Refresh all queries: create Action with @Run for each query', null, toolCalls);

    // Available Tools.
    stock.line(
        ' or Mutation() for write operations. The LLM decides which is appropriate based on ' +
            "the tool's purpose.",
        '. Each one reads data.',
        toolCalls
    );
    stock.line(' and Mutation() calls', ' calls', toolCalls);
    stock.line(
        "If the user asks for functionality that doesn't match any available tool, use " +
            'realistic mock data instead of fabricating a tool call.',
        'If no tool listed above gives the data that the user asks for, say in words that the ' +
            'data is not available. Never invent figures.',
        toolCalls
    );

    return {prompt: stock.text, missing: stock.missing};
}

/**
 * A value that {@link writeExpressions} writes as an OpenUI Lang expression, such as a
 * `$variable` or `data.rows`. `formatOpenUiProgram()` writes only literal values, so a prop takes
 * this in place of its value.
 * @internal
 */
export function asExpression(expression: string): string {
    return `${EXPRESSION_MARK}${expression}${EXPRESSION_MARK}`;
}

/**
 * A program with each {@link asExpression} value written as its expression.
 * @internal
 */
export function writeExpressions(program: string): string {
    return program.replace(EXPRESSION_RE, (_, body) => JSON.parse(`"${body}"`));
}

/**
 * The component to bind a `$variable` to in an example. The first one whose example gives its
 * state prop a value, so that the variable has a default to declare, else the first one with a
 * state prop. Null if none has an example.
 * @internal
 */
export function findBoundInput(specs: ChatUiComponentSpec[]): ChatUiComponentSpec {
    const inputs = specs.filter(it => it.example && !isEmpty(it.stateProps));
    return (
        inputs.find(it => (it.example as PlainObject)[it.stateProps[0]] != null) ??
        inputs[0] ??
        null
    );
}

/**
 * The `$variable` to bind to an input in an example: its own name, or that of its prop.
 * @internal
 */
export function getVariableName(input: ChatUiComponentSpec): string {
    const {name} = input.example as PlainObject;
    return '$' + (isString(name) && IDENTIFIER_RE.test(name) ? name : input.stateProps[0]);
}

/**
 * A simple component that shows a string, to stand for any component in an example. It has an
 * example of a few props, no children, no state and no action, and a string prop that holds a
 * value, not a reference. Of several, the one with the fewest props in its example. Null if
 * there is none.
 * @internal
 */
export function findTextLeaf(specs: ChatUiComponentSpec[]): {
    spec: ChatUiComponentSpec;
    prop: string;
} {
    const getProp = (spec: ChatUiComponentSpec) => {
            const {props, example} = spec,
                refs = getDataPropNames(spec);
            return (
                findKey(
                    props?.properties as PlainObject,
                    (schema, key) =>
                        schema?.type === 'string' &&
                        isString((example as PlainObject)?.[key]) &&
                        !refs.includes(key)
                ) ?? null
            );
        },
        leaves = specs.filter(
            it =>
                isEmpty(it.slots) &&
                isEmpty(it.stateProps) &&
                getActionProp(it) == null &&
                size(it.example) <= MAX_LEAF_PROPS &&
                getProp(it) != null
        ),
        spec = minBy(leaves, it => size(it.example));
    return spec ? {spec, prop: getProp(spec)} : null;
}

/**
 * The names of the props of a component that take data by reference - its `dataProps`.
 * @internal
 */
export function getDataPropNames(spec: ChatUiComponentSpec): string[] {
    return (spec.dataProps ?? []).map((it: string | ChatUiDataPropSpec) =>
        isString(it) ? it : it.name
    );
}

/**
 * The one prop of a component that takes a single action, or null.
 * @internal
 */
export function getActionProp(spec: ChatUiComponentSpec): string {
    const props: PlainObject = spec.props?.properties ?? {};
    return Object.keys(props).find(key => isChatUiActionSchema(props[key])) ?? null;
}

//------------------
// Implementation
//------------------
const ACTION_MARK = '__xhAction__',
    // lang-core joins clauses with this character. The kit names it by its code, to match
    // lang-core's lines, and writes none in its own text.
    EM_DASH = '\u2014',
    EXPRESSION_MARK = '__xhExpression__',
    // A marked value as the formatter writes it: a JSON string, with its quotes escaped.
    EXPRESSION_RE = /"__xhExpression__((?:[^"\\]|\\.)*?)__xhExpression__"/g,
    IDENTIFIER_RE = /^[A-Za-z_]\w*$/,
    MAX_LEAF_PROPS = 3,
    // The type of an action prop that takes every step on offer.
    ACTION_TYPE = 'ActionExpression',
    // The type of an action prop that lists its steps, such as `@ToAssistant[]`.
    STEP_LIST_RE = /(?<=: )\(?@[A-Z]\w*(?: \| @[A-Z]\w*)*(?:\)?\[\])?/g;

// Writes the kit's sections and lines for one catalog.
class SectionWriter {
    private readonly opts: PromptSectionOptions;

    // A component with one action prop, and an example to write it from.
    private readonly button: ChatUiComponentSpec;
    private readonly actionProp: string;

    // A component that a `$variable` binds to, with an example: the first one, for a form, and
    // the first one that has a value, for a filter.
    private readonly input: ChatUiComponentSpec;
    private readonly filterInput: ChatUiComponentSpec;
    private readonly form: ChatUiComponentSpec;

    // The types of the action props that list their steps, as the signatures show them.
    private readonly stepLists: string[];

    // True if the signature of some component has an action prop.
    readonly takesActions: boolean;

    constructor(opts: PromptSectionOptions) {
        const {components} = opts.catalog,
            others = components.filter(it => it.example && it.name !== opts.root),
            inputs = opts.bindings ? others.filter(it => !isEmpty(it.stateProps)) : [],
            signatures = Object.values(opts.library.components).map(it => it.signature ?? '');
        this.opts = opts;
        this.button = others.find(it => getActionProp(it) != null) ?? null;
        this.actionProp = this.button ? getActionProp(this.button) : null;
        this.input = inputs[0] ?? null;
        this.filterInput = findBoundInput(inputs);
        this.form = components.find(it => it.name === 'form' && it.slots?.includes('default'));
        this.stepLists = uniq(signatures.flatMap(it => it.match(STEP_LIST_RE) ?? []));
        this.takesActions = this.hasStepLists || signatures.some(it => it.includes(ACTION_TYPE));
    }

    get hasStepLists(): boolean {
        return !isEmpty(this.stepLists);
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

        return without(
            [
                '## Action - What a Click Does',
                '',
                'An action wires a click to operations. Write an action only in an argument that ' +
                    'Component Signatures types for one.' +
                    (one
                        ? ` Pass one @-prefixed step bare, such as \`${this.buttonCall(one, 'More')}\`.`
                        : '') +
                    (several
                        ? ` Put several steps in Action([...]), such as \`${this.buttonCall(several, 'Next')}\`.`
                        : ''),
                '',
                'Available steps:',
                ...steps.map(it => lines[it]),
                '',
                '- Write an action inline, or assign it to a name and use the name.',
                steps.includes('Set')
                    ? '- The steps run in order. A step reads the value that a @Set before it sets.'
                    : null
            ],
            null
        ).join('\n');
    }

    filters(): string {
        const input = this.filterInput;
        if (!input || !this.opts.toolCalls) return null;

        const prop = input.stateProps[0],
            variable = getVariableName(input),
            name = variable.slice(1);
        return [
            '## Interactive Filters',
            '',
            'To let the user filter data with an input:',
            `1. Declare a $variable with a default: \`${variable} = ${JSON.stringify(input.example[prop] ?? '')}\``,
            `2. Bind it to the argument marked $binding: \`${this.callOf(input, {...input.example, [prop]: asExpression(variable)})}\``,
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

        const variable = getVariableName(input),
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
                        ...this.buttonProps('Submit'),
                        [actionProp]: {type: 'send', text: 'Use these details.'}
                    }
                }
            },
            plain = this.statements(elements),
            bound = this.statements({
                ...elements,
                field: {
                    component: input.name,
                    props: {...input.example, [prop]: asExpression(variable)}
                }
            });
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
        const {toolCalls, builtinFunctions} = this.opts;
        if (!toolCalls) return null;

        // The arguments that take data by reference, such as `data` of Grid.
        const refs = this.opts.catalog.components.flatMap(spec =>
                getDataPropNames(spec).map(it => `\`${it}\` of ${this.openUiName(spec)}`)
            ),
            rules = compact([
                ...(isEmpty(refs)
                    ? [
                          'Use Query() for data that should stay live. Do not write the result ' +
                              'of a tool as a literal list or object.'
                      ]
                    : [
                          'Choose how a view gets its data. For a fixed view, call the tool ' +
                              'yourself, then pass the id of its result to an argument that ' +
                              `takes data by reference: ${refs.join(', ')}. For a view that ` +
                              'the user changes, such as one with a filter, use Query(). ' +
                              'Either way, do not write the result of a tool as a literal ' +
                              'list or object.',
                          'A Query result is plain data, and keeps no artifact. It cannot go ' +
                              'in an argument that takes data by reference.'
                      ]),
                'Give each Query short defaults, with the shape of the real result, so that ' +
                    'the UI renders at once.',
                builtinFunctions
                    ? 'Derive counts and totals from Query results with the @-prefixed ' +
                      'built-in functions.'
                    : null,
                'Write a list by hand only for static data, such as labels and options.'
            ]);
        return without(
            [
                '## Data Workflow',
                '',
                'When tools are available:',
                ...rules.map((it, idx) => `${idx + 1}. ${it}`),
                '',
                '```',
                'data = Query("tool_name", {}, {rows: []})',
                builtinFunctions
                    ? 'openCount = @Count(@Filter(data.rows, "field", "==", "value"))'
                    : null,
                '```'
            ],
            null
        ).join('\n');
    }

    // How to write arguments by position, shown on a component of the catalog: the root, or the
    // first other one whose example holds two plain values or more.
    positionalRule(): string {
        const {catalog, root} = this.opts,
            isPlain = (it: unknown) => isString(it) || isNumber(it) || isBoolean(it),
            closing = 'an argument written by name is NOT supported, and breaks its component';

        for (const spec of [catalog.getComponent(root), ...catalog.components]) {
            const example: PlainObject = spec?.example ?? {};
            if (size(example) < 2 || !Object.values(example).every(isPlain)) continue;

            const children = spec.slots?.includes('default') ? ['children'] : null,
                right = this.callOf(spec, example, children),
                byName = mapValues(example, (value, key) =>
                    asExpression(`${key}: ${JSON.stringify(value)}`)
                );
            // An argument left out ahead of another one would show as a null with no name.
            if (/\bnull\b/.test(right)) continue;
            return `Write \`${right}\` NOT \`${this.callOf(spec, byName, children)}\` - ${closing}`;
        }
        return `Write only the value of each argument - ${closing}`;
    }

    // The line on the types of an action prop, which names the types that the signatures show.
    // Null if no component has an action prop.
    actionTypes(): string {
        const {stepLists, takesActions, hasStepLists} = this,
            hasFullType = takesActions && this.signatureHas(ACTION_TYPE),
            listed = stepLists.map(it => `\`${it}\``).join(' or ');
        if (!takesActions) return null;
        return compact([
            hasFullType
                ? `A prop typed \`${ACTION_TYPE}\` takes one @step, or Action([@steps...]) for ` +
                  'several.'
                : null,
            hasStepLists
                ? `A prop typed ${listed} takes only the steps that its type lists` +
                  (hasFullType ? '.' : ': one @step, or Action([@steps...]) for several.')
                : null,
            'See the Action section for what each step does.'
        ]).join(' ');
    }

    // The template of an `@Each` in lang-core's text: the simplest component that shows a
    // string, with the expression as that string. The expression alone if there is none.
    eachTemplate(expression: string): string {
        const {catalog, root} = this.opts,
            leaf = findTextLeaf(catalog.components.filter(it => it.name !== root));
        return leaf
            ? this.callOf(leaf.spec, {...leaf.spec.example, [leaf.prop]: asExpression(expression)})
            : expression;
    }

    // lang-core's line on a manual refresh, with the catalog's button. Null if no button runs
    // a query again.
    refreshRule(): string {
        const canRun = this.opts.library.actionSteps.includes('Run') && this.buttonTakes('state');
        return canRun
            ? `- Manual refresh: \`${this.buttonCall('Action([@Run(query1), @Run(query2)])', 'Refresh')}\` ` +
                  'fetches the listed queries again.'
            : null;
    }

    private signatureHas(text: string): boolean {
        return Object.values(this.opts.library.components).some(it => it.signature?.includes(text));
    }

    // True if the example button takes an action of a type.
    private buttonTakes(type: string): boolean {
        const {button, actionProp} = this,
            schema: PlainObject = button?.props.properties[actionProp],
            branches: PlainObject[] = schema?.anyOf ?? compact([schema]);
        return branches.some(it => it?.properties?.type?.const === type);
    }

    // The example button with an action expression in its action argument.
    private buttonCall(action: string, label: string): string {
        const {button, actionProp} = this;
        if (!button) return action;
        return this.callOf(button, {
            ...this.buttonProps(label),
            [actionProp]: {type: 'send', text: ACTION_MARK}
        }).replace(`@ToAssistant(${JSON.stringify(ACTION_MARK)})`, action);
    }

    // The props of the example button, with a label that fits the example where it has one.
    private buttonProps(label: string): PlainObject {
        const example = this.button.example as PlainObject;
        return {...example, ...(isString(example.label) ? {label} : {})};
    }

    // The name of a component in a program.
    private openUiName(spec: ChatUiComponentSpec): string {
        const {library} = this.opts;
        return (
            findKey(library.components, (_, key) => library.toCatalogName(key) === spec.name) ??
            spec.name
        );
    }

    // A component as a call, with its arguments in the order of its signature. Each child is a
    // name, which stands for a statement.
    private callOf(spec: ChatUiComponentSpec, props: PlainObject, children?: string[]): string {
        const program = this.format({
            root: 'call',
            elements: {call: {component: spec.name, props, ...(children ? {children} : {})}}
        });
        return program.split('\n', 1)[0].slice('root = '.length);
    }

    // The statements of a document, without its root.
    private statements(elements: Record<string, ChatUiElement>): string {
        return this.format({root: 'root', elements})
            .split('\n')
            .filter(it => !it.startsWith('root = '))
            .join('\n');
    }

    private format(doc: ChatUiDocument): string {
        return writeExpressions(this.opts.formatProgram(doc));
    }
}

// lang-core's prompt, as the kit changes it. Each change names the stock text that it expects.
// A text that is expected and not there goes to `missing`, and the prompt stays as it is.
class StockPrompt {
    text: string;
    readonly missing: string[] = [];

    constructor(text: string) {
        this.text = text;
    }

    // Replace a section, by the first words of its heading. Null removes it.
    section(heading: string, text: string, isExpected: boolean) {
        const at = findSection(this.text, heading);
        if (!at) {
            if (isExpected) this.missing.push(`## ${heading}`);
            return;
        }
        this.text =
            this.text.slice(0, at.start) + (text ? `${text}\n\n` : '') + this.text.slice(at.end);
    }

    // Replace each occurrence of a stock line or sentence. Null removes it, with the line
    // break ahead of it.
    line(stock: string | RegExp, text: string, isExpected: boolean = true) {
        const found = isRegExp(stock) ? stock.exec(this.text)?.[0] : stock;
        if (found == null || !this.text.includes(found)) {
            if (isExpected) this.missing.push(isRegExp(stock) ? stock.source : stock);
            return;
        }
        this.text =
            text == null
                ? this.text.split(`\n${found}`).join('').split(found).join('')
                : this.text.split(found).join(text);
    }
}

// The start and the end of a section of the prompt, by the first words of its heading.
function findSection(prompt: string, heading: string): {start: number; end: number} {
    const start = prompt.indexOf(`\n## ${heading}`);
    if (start < 0) return null;
    const next = prompt.indexOf('\n## ', start + 1);
    return {start: start + 1, end: next < 0 ? prompt.length : next + 1};
}
