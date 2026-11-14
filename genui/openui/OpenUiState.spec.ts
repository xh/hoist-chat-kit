import {act, fireEvent, render, screen} from '@testing-library/react';
import {div, fragment} from '@xh/hoist/cmp/layout';
import type {PlainObject} from '@xh/hoist/core';
import {initTestAppAsync} from '@xh/hoist/test-support';
import {beforeAll, describe, expect, it, onTestFinished, vi} from 'vitest';
import {ChatModel} from '../../core';
import {ScriptedChatTransport, textEvents} from '../../transport';
import {type ChatUiAction, chatUiActionSchema, describeChatUiAction} from '../ChatUiAction';
import {ChatUiCatalog} from '../ChatUiCatalog';
import type {ChatUiComponentSpec, ChatUiDocumentContext} from '../ChatUiComponentSpec';
import type {ChatUiDocumentSegment} from '../ChatUiTextSegment';
import {openUiLangAdapter} from './OpenUiLangAdapter';
import {openUiLangFormat, type OpenUiLangFormatOptions} from './OpenUiLangFormat';

/**
 * With `bindings`, an OpenUI Lang program has state: `$variables` that inputs write and that
 * expressions read. Apps rely on the format to run it on lang-core's store and evaluator, to keep
 * what the user set while the program streams, to render again on each change, to run `@Set` and
 * `@Reset`, and to send a `@ToAssistant` exactly as its button shows it.
 */
describe('OpenUI Lang state', () => {
    beforeAll(() => initTestAppAsync());

    describe('$variables', () => {
        it('gives a document state only with bindings on', () => {
            const program = 'root = Stack([note])\n$name = "Ann"\nnote = Note("Hi " + $name)',
                [plain] = createCatalog({bindings: false}).parseText(program),
                [bound] = createCatalog().parseText(program);

            expect((plain as ChatUiDocumentSegment).document.state).toBeUndefined();
            // Without state, the kit drops the prop that holds the expression.
            expect((plain as ChatUiDocumentSegment).document.elements.note.props).toEqual({});
            expect((bound as ChatUiDocumentSegment).document.state).toBeDefined();
        });

        it('evaluates an expression on a declared default', () => {
            renderProgram('root = Stack([note])\n$name = "Ann"\nnote = Note("Hi " + $name)');
            expect(text('note')).toBe('Hi Ann');
        });

        it('binds a state prop both ways, and renders the readers of the variable again', () => {
            renderProgram(
                'root = Stack([field, note])\n' +
                    '$name = "Ann"\n' +
                    'field = Field("name", $name)\n' +
                    'note = Note("Hi " + $name)'
            );
            expect(text('field')).toBe('name=Ann');

            fireEvent.click(screen.getByTestId('field'));
            expect(text('field')).toBe('name=Ann!');
            expect(text('note')).toBe('Hi Ann!');
        });

        it('auto-declares a variable as null, and drops the prop until it has a value', () => {
            renderProgram('root = Stack([field])\nfield = Field("name", $name)');
            expect(text('field')).toBe('name=undefined');

            fireEvent.click(screen.getByTestId('field'));
            expect(text('field')).toBe('name=undefined!');
        });

        it('reads a variable, without a binding, in a prop that is not a state prop', () => {
            renderProgram('root = Stack([field])\n$label = "First"\nfield = Field($label, "x")');
            expect(text('field')).toBe('First=x');
        });

        it('keeps what the user set while the program streams, and takes a default that arrives late', () => {
            const head =
                    'root = Stack([field, note, other])\n$name = "Ann"\nfield = Field("name", $name)',
                {rerender} = renderProgram(head, {isStreaming: true});

            fireEvent.click(screen.getByTestId('field'));
            rerender(`${head}\nnote = Note("Hi " + $name)\n$city = "Ro`, {isStreaming: true});
            expect(text('note')).toBe('Hi Ann!');

            // The default of $city grows as its statement streams. The user never set it.
            rerender(
                `${head}\nnote = Note("Hi " + $name)\n$city = "Rome"\nother = Note("In " + $city)`
            );
            expect(text('note')).toBe('Hi Ann!');
            expect(screen.getAllByTestId('note')[1].textContent).toBe('In Rome');
        });

        it('keeps state apart for two programs', () => {
            const program = 'root = Stack([field])\n$n = "a"\nfield = Field("n", $n)',
                catalog = createCatalog(),
                view = (partId: string) =>
                    div({
                        key: partId,
                        'data-testid': partId,
                        items: catalog
                            .parseText(program, {messageId: 'm1', partId})
                            .map(it => catalog.renderSegment(it, context()))
                    } as PlainObject);
            render(fragment(view('p1'), view('p2')));

            fireEvent.click(screen.getAllByTestId('field')[0]);
            expect(screen.getByTestId('p1').textContent).toBe('n=a!');
            expect(screen.getByTestId('p2').textContent).toBe('n=a');
        });
    });

    describe('expressions and built-in functions', () => {
        it('evaluates built-in functions over data', () => {
            renderProgram(
                'root = Stack([note])\n' +
                    'rows = [{region: "EMEA", sales: 4}, {region: "APAC", sales: 6}]\n' +
                    'note = Note("Total " + @Sum(rows.sales) + " in " + @Count(rows) + " regions")'
            );
            expect(text('note')).toBe('Total 10 in 2 regions');
        });

        it('renders a component per item of an @Each, and the branch a ternary picks', () => {
            renderProgram(
                'root = Stack([list, $show ? shown : hidden, toggle])\n' +
                    '$show = false\n' +
                    'list = @Each(["a", "b"], "item", Note("Item " + item))\n' +
                    'shown = Note("Shown")\n' +
                    'hidden = Note("Hidden")\n' +
                    'toggle = Trigger("Show", @Set($show, true))'
            );
            expect(screen.getAllByTestId('note').map(it => it.textContent)).toEqual([
                'Item a',
                'Item b',
                'Hidden'
            ]);

            return clickAsync('trigger').then(() =>
                expect(screen.getAllByTestId('note')[2].textContent).toBe('Shown')
            );
        });

        it('checks evaluated props, and renders one that fails as a fallback', () => {
            silenceWarnings();
            const {container} = renderProgram(
                'root = Stack([ok, bad])\n$n = 4\nok = Note("n is " + $n)\nbad = Note($n)'
            );

            expect(text('note')).toBe('n is 4');
            expect(container.textContent).toContain('This note could not be displayed.');
        });

        it('applies the element cap to the components that an expression builds', () => {
            silenceWarnings();
            const {container} = renderProgram(
                'root = Stack([list])\nlist = @Each([1, 2, 3, 4, 5], "n", Note("Item " + n))',
                {limits: {maxElements: 4}}
            );

            expect(container.textContent).toContain('expected at most 4 elements, got 6');
        });
    });

    describe('actions', () => {
        it('runs @Set and @Reset on the state', async () => {
            renderProgram(
                'root = Stack([note, inc, reset])\n' +
                    '$count = 1\n' +
                    'note = Note("Count " + $count)\n' +
                    'inc = Trigger("Add", @Set($count, $count + 1))\n' +
                    'reset = Trigger("Reset", @Reset($count))'
            );
            const [inc, reset] = screen.getAllByTestId('trigger');
            expect(inc.title).toBe('Sets $count to 2');
            expect(reset.title).toBe('Resets $count');

            await clickAsync(inc);
            await clickAsync(inc);
            expect(text('note')).toBe('Count 3');
            expect(inc.title).toBe('Sets $count to 4');

            await clickAsync(reset);
            expect(text('note')).toBe('Count 1');
        });

        it('sends a @ToAssistant with the values the state holds, as its button shows them', async () => {
            const chatModel = createChatModel();
            renderProgram(
                'root = Stack([field, go])\n' +
                    '$name = "Ann"\n' +
                    'field = Field("name", $name)\n' +
                    'go = Trigger("Go", @ToAssistant("Greet them", {name: $name}))',
                {chatModel}
            );
            fireEvent.click(screen.getByTestId('field'));
            expect(screen.getByTestId('trigger').title).toBe(
                'Sends: "Greet them", with name: "Ann!"'
            );

            await clickAsync('trigger');
            expect(chatModel.messages[0]).toMatchObject({
                role: 'user',
                text: 'Greet them',
                metadata: {context: {name: 'Ann!'}}
            });
        });

        it('runs the steps of an Action in order, each with the values set before it', async () => {
            const chatModel = createChatModel();
            renderProgram(
                'root = Stack([note, go])\n' +
                    '$step = 1\n' +
                    'note = Note("Step " + $step)\n' +
                    'go = Trigger("Go", Action([@Set($step, 2), @ToAssistant("Next", {step: $step})]))',
                {chatModel}
            );
            const title = 'Sets $step to 2, then sends: "Next", with step: 2';
            expect(screen.getByTestId('trigger').title).toBe(title);

            await clickAsync('trigger');
            expect(text('note')).toBe('Step 2');
            // The message holds the value its button showed: the one the first step sets.
            expect(chatModel.messages[0].metadata.context).toEqual({step: 2});
        });

        it('keeps a sent message within the caps', async () => {
            const chatModel = createChatModel();
            renderProgram(
                'root = Stack([go])\n' +
                    `$long = "${'x'.repeat(150)}"\n` +
                    `go = Trigger("Go", Action([@Reset($long), @ToAssistant("${'m'.repeat(250)}", {long: $long})]))`,
                {chatModel}
            );

            await clickAsync('trigger');
            expect(chatModel.messages[0].text).toHaveLength(200);
            expect(chatModel.messages[0].metadata.context.long).toHaveLength(100);
        });

        it('drops a state action from a prop whose schema does not allow one', () => {
            const warn = silenceWarnings();
            renderProgram('root = Stack([go])\n$n = 1\ngo = SendOnly("Go", @Set($n, 2))');

            expect(screen.getByTestId('send-only').title).toBe('');
            expect(warn.mock.calls.flat().join(' ')).toContain('type is not one of send');
        });

        it('refuses a state action that the program wrote as data', async () => {
            const error = vi.spyOn(console, 'error').mockImplementation(() => {});
            onTestFinished(() => error.mockRestore());
            let failure: unknown;
            renderProgram(
                'root = Stack([go])\ngo = Trigger("Go", {type: "state", id: "x", summary: "Harmless"})',
                {onError: e => (failure = e)}
            );

            // The button says that its action cannot run, and a click does nothing.
            expect(screen.getByTestId('trigger').title).toBe(
                'This action is not valid, so it cannot run.'
            );
            fireEvent.click(screen.getByTestId('trigger'));
            await vi.waitFor(() => expect(failure).toBeDefined());
            expect(String(failure)).toContain('not valid');
        });
    });

    describe('queries', () => {
        it('shows the defaults of a Query, and runs no tool, with no query tools allowed', () => {
            renderProgram(
                'root = Stack([note])\n' +
                    'sales = Query("get_sales", {}, {total: 7})\n' +
                    'note = Note("Total " + sales.total)'
            );
            expect(text('note')).toBe('Total 7');
        });
    });

    describe('prompt', () => {
        it('teaches bindings and built-in functions with lang-core text, and marks state props', () => {
            const prompt = createCatalog().toPrompt({modes: ['openui']});

            expect(prompt).toContain('Declare mutable state with `$varName = defaultValue`');
            expect(prompt).toContain('## Built-in Functions');
            expect(prompt).toContain('Field(label: string, value?: $binding<string>)');
            expect(prompt).toContain('@Set(');
            expect(prompt).toContain('- Do not use Query, Mutation or @Run.');
            expect(prompt).not.toContain('Do not use $variables');
            expect(prompt).not.toContain('## Query');
        });

        it('shows a $variable bound to the first component with a state prop', () => {
            const prompt = createCatalog().toPrompt({modes: ['openui']});

            expect(prompt).toContain(
                'root = Stack([field])\n$value = "Ann"\nfield = Field("name", $value)'
            );
        });

        it('leaves the prompt and the version as they were with bindings off', () => {
            const off = createCatalog({bindings: false}),
                plain = new ChatUiCatalog({
                    components: SPECS,
                    textFormats: [openUiLangFormat({root: 'stack'})],
                    modes: ['openui']
                });

            expect(off.toPrompt()).toBe(plain.toPrompt());
            expect(off.version).toBe(plain.version);
            expect(createCatalog().version).not.toBe(plain.version);
            expect(off.toPrompt()).toContain('Field(label: string, value?: string)');
        });
    });

    describe('openUiLangAdapter', () => {
        it('runs a program sent in a data part with state', () => {
            const catalog = new ChatUiCatalog({components: SPECS}),
                renderers = catalog.createDataRenderers([
                    openUiLangAdapter({root: 'stack', bindings: true})
                ]),
                data =
                    'root = Stack([field, note])\n$n = "a"\nfield = Field("n", $n)\nnote = Note("Got " + $n)';
            render(
                fragment(
                    renderers.openui(
                        {type: 'data', id: 'd1', dataType: 'openui', data},
                        {chatModel: null, messageId: 'm1'}
                    )
                )
            );

            fireEvent.click(screen.getByTestId('field'));
            expect(text('note')).toBe('Got a!');
        });
    });
});

//------------------
// Helpers
//------------------
let onActionError: (e: unknown) => void = null;

const STACK: ChatUiComponentSpec = {
        name: 'stack',
        description: 'A vertical stack.',
        props: {type: 'object', additionalProperties: false, properties: {}},
        slots: ['default'],
        standalone: false,
        render: (_, {children}) => fragment({items: children})
    },
    NOTE: ChatUiComponentSpec<{text: string}> = {
        name: 'note',
        description: 'A short note.',
        props: {
            type: 'object',
            required: ['text'],
            additionalProperties: false,
            properties: {text: {type: 'string', maxLength: 200}}
        },
        render: ({text}) => div({'data-testid': 'note', item: text} as PlainObject)
    },
    // Shows its label and value, and adds a `!` to the value on click.
    FIELD: ChatUiComponentSpec<{label: string; value?: string}> = {
        name: 'field',
        description: 'An input.',
        props: {
            type: 'object',
            required: ['label'],
            additionalProperties: false,
            properties: {label: {type: 'string'}, value: {type: 'string'}}
        },
        stateProps: ['value'],
        render: ({label, value}, {setProp}) =>
            div({
                'data-testid': 'field',
                item: `${label}=${value}`,
                onClick: () => setProp('value', `${value}!`)
            } as PlainObject),
        example: {label: 'name', value: 'Ann'}
    },
    TRIGGER = triggerSpec('trigger', ['send', 'state']),
    SEND_ONLY = {...triggerSpec('send-only', ['send']), name: 'sendOnly'},
    SPECS = [STACK, NOTE, FIELD, TRIGGER, SEND_ONLY];

// A button that shows what its action does as its title, and runs it on click.
function triggerSpec(testId: string, types: ChatUiAction['type'][]): ChatUiComponentSpec {
    return {
        name: 'trigger',
        description: 'A button.',
        props: {
            type: 'object',
            required: ['label'],
            additionalProperties: false,
            properties: {label: {type: 'string'}, action: chatUiActionSchema({types})}
        },
        render: ({label, action}, {runActionAsync}) =>
            div({
                'data-testid': testId,
                title: action ? describeChatUiAction(action) : '',
                item: label,
                onClick: () => runActionAsync(action).catch(e => onActionError?.(e))
            } as PlainObject)
    };
}

function createCatalog(opts: Partial<OpenUiLangFormatOptions> & PlainObject = {}): ChatUiCatalog {
    const {limits, ...formatOpts} = opts;
    return new ChatUiCatalog({
        components: SPECS,
        textFormats: [openUiLangFormat({root: 'stack', bindings: true, ...formatOpts})],
        modes: ['openui'],
        limits
    });
}

// Renders a program as the message view does: parsed once per text, and rendered in place.
function renderProgram(
    program: string,
    opts: {
        isStreaming?: boolean;
        chatModel?: ChatModel;
        onError?: (e: unknown) => void;
    } & PlainObject = {}
) {
    const {chatModel = null, onError = null, ...catalogOpts} = opts,
        catalog = createCatalog(catalogOpts),
        view = (text: string, isStreaming: boolean) =>
            fragment(
                catalog
                    .parseText(text, {isStreaming, messageId: 'm1', partId: 'p1'})
                    .map((it, idx) =>
                        div({key: idx, item: catalog.renderSegment(it, context(chatModel))})
                    )
            );
    onActionError = onError;
    onTestFinished(() => (onActionError = null));

    const ret = render(view(program, !!opts.isStreaming));
    return {
        ...ret,
        rerender: (text: string, next: {isStreaming?: boolean} = {}) =>
            ret.rerender(view(text, !!next.isStreaming))
    };
}

function context(chatModel: ChatModel = null): Omit<ChatUiDocumentContext, 'isPartial'> {
    return {
        chatModel,
        messageId: 'm1',
        part: {type: 'text', id: 'p1', text: '', state: 'done'}
    };
}

function text(testId: string): string {
    return screen.getAllByTestId(testId)[0].textContent;
}

// Click, then let the action, which runs async, change the state and render.
async function clickAsync(target: string | HTMLElement) {
    const el = typeof target === 'string' ? screen.getByTestId(target) : target;
    await act(async () => {
        fireEvent.click(el);
        await Promise.resolve();
    });
}

function createChatModel(): ChatModel {
    const chatModel = new ChatModel({
        transport: new ScriptedChatTransport({respond: () => textEvents('Done.'), delayMs: 0})
    });
    onTestFinished(() => chatModel.destroy());
    return chatModel;
}

function silenceWarnings() {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    onTestFinished(() => warn.mockRestore());
    return warn;
}
