import {initTestAppAsync} from '@xh/hoist/test-support';
import {createStreamingParser} from '@openuidev/lang-core';
import {cloneDeep} from 'lodash';
import {beforeAll, describe, expect, it} from 'vitest';
import {
    chatUiCardSpec,
    chatUiChartSpec,
    chatUiMetricsSpec,
    chatUiStackSpec,
    chatUiTextSpec
} from '../../desktop/cmp/genui';
import {chatUiActionSchema} from '../ChatUiAction';
import {ChatUiCatalog} from '../ChatUiCatalog';
import type {ChatUiComponentSpec} from '../ChatUiComponentSpec';
import {toOpenUiLibrary} from './OpenUiLibrary';

/**
 * toOpenUiLibrary turns a catalog into the JSON Schema library that lang-core parses OpenUI Lang
 * against, and the signatures the prompt shows the model. Apps rely on it to accept the same
 * components, props and child lists the catalog declares, with no Zod library of their own.
 */
describe('toOpenUiLibrary', () => {
    beforeAll(async () => {
        await initTestAppAsync();
    });

    it('builds a $defs entry per component, with props in schema order and additionalProperties false', () => {
        const {schema} = toOpenUiLibrary(createCatalog(), {root: 'Stack'});

        expect(Object.keys(schema.$defs)).toEqual([
            'Stack',
            'Metric',
            'Button',
            'ActionExpression'
        ]);
        expect(schema.$defs.Metric).toEqual({
            type: 'object',
            properties: METRIC.props.properties,
            required: ['label', 'value'],
            additionalProperties: false,
            description: 'A KPI tile.'
        });
        expect(Object.keys(schema.$defs.Metric.properties)).toEqual(['label', 'value', 'format']);
        expect(schema).toMatchObject({
            type: 'object',
            properties: {
                Stack: {$ref: '#/$defs/Stack'},
                Metric: {$ref: '#/$defs/Metric'},
                Button: {$ref: '#/$defs/Button'}
            },
            required: ['Stack', 'Metric', 'Button'],
            additionalProperties: false
        });
    });

    it('turns the default slot into a first children array of refs, and a named slot into a property after the props', () => {
        const {schema} = toOpenUiLibrary(createCatalog(), {
                root: 'Stack',
                slotAccepts: {Stack: {footer: ['Button']}}
            }),
            {properties, required} = schema.$defs.Stack;

        expect(Object.keys(properties)).toEqual(['children', 'gap', 'title', 'footer']);
        expect(properties.children).toEqual({
            type: 'array',
            items: {
                anyOf: [{$ref: '#/$defs/Stack'}, {$ref: '#/$defs/Metric'}, {$ref: '#/$defs/Button'}]
            }
        });
        expect(properties.footer).toEqual({type: 'array', items: {$ref: '#/$defs/Button'}});
        expect(required).toEqual([]);
    });

    it('throws when a slot would replace a prop of the same name', () => {
        const stack = {
            ...STACK,
            props: {type: 'object', properties: {children: {type: 'string'}}}
        };
        expect(() =>
            toOpenUiLibrary(new ChatUiCatalog({components: [stack, METRIC]}), {root: 'Stack'})
        ).toThrow(`'Stack'`);
        expect(() =>
            toOpenUiLibrary(new ChatUiCatalog({components: [stack, METRIC]}), {root: 'Stack'})
        ).toThrow(`'children'`);
    });

    it('turns an action prop into a ref to ActionExpression', () => {
        const {schema} = toOpenUiLibrary(createCatalog(), {root: 'Stack'});

        expect(schema.$defs.Button.properties).toEqual({
            label: {type: 'string'},
            action: {$ref: '#/$defs/ActionExpression'},
            more: {type: 'array', items: {$ref: '#/$defs/ActionExpression'}}
        });
        expect(schema.$defs.ActionExpression).toEqual(ACTION_EXPRESSION);
    });

    it('maps the actions of the built-in card to an array of ActionExpression refs', () => {
        const catalog = new ChatUiCatalog({components: [chatUiStackSpec(), chatUiCardSpec()]}),
            {schema, components} = toOpenUiLibrary(catalog, {root: 'stack'});

        expect(schema.$defs.Card.properties.actions).toEqual({
            type: 'array',
            items: {$ref: '#/$defs/ActionExpression'}
        });
        expect(schema.$defs.ActionExpression).toEqual(ACTION_EXPRESSION);
        // The card takes only `send` actions, so its prop lists the one step that makes one.
        expect(components.Card.signature).toContain('actions?: @ToAssistant[]');
    });

    it('does not recognize a clone of an action schema, which must be placed as is', () => {
        const button = {
                ...BUTTON,
                props: {
                    type: 'object',
                    properties: {action: cloneDeep(chatUiActionSchema({types: ['send']}))}
                }
            },
            catalog = new ChatUiCatalog({components: [STACK, button]}),
            {schema, components} = toOpenUiLibrary(catalog, {root: 'Stack'});

        expect(schema.$defs.Button.properties.action).toEqual(button.props.properties.action);
        expect(schema.$defs.ActionExpression).toBeUndefined();
        expect(components.Button.signature).toMatch(
            /^Button\(action\?: \{type: "send"; text: string; context\?: object;/
        );
    });

    it('writes a signature per component, with optional props marked and enums listed', () => {
        const table: ChatUiComponentSpec = {
                name: 'Table',
                description: 'A table.',
                props: {
                    type: 'object',
                    required: ['rows'],
                    properties: {
                        rows: {type: 'array', items: {type: 'object'}},
                        tags: {type: 'array', items: {type: 'string'}},
                        meta: {type: 'object'},
                        count: {type: 'integer'},
                        shown: {type: 'boolean'},
                        extra: {}
                    }
                },
                render: () => null
            },
            catalog = new ChatUiCatalog({components: [STACK, METRIC, BUTTON, table]}),
            {components} = toOpenUiLibrary(catalog, {
                root: 'Stack',
                slotAccepts: {Stack: {default: ['Metric'], footer: ['Metric', 'Button']}}
            });

        expect(components.Metric).toEqual({
            signature: 'Metric(label: string, value: number, format?: "number" | "percent")',
            description: 'A KPI tile.'
        });
        expect(components.Stack.signature).toBe(
            'Stack(children?: Metric[], gap?: "small" | "large", title?: string, ' +
                'footer?: (Metric | Button)[])'
        );
        expect(components.Button.signature).toBe(
            'Button(label: string, action?: @ToAssistant, more?: ActionExpression[])'
        );
        expect(components.Table.signature).toBe(
            'Table(rows: object[], tags?: string[], meta?: object, count?: number, ' +
                'shown?: boolean, extra?: any)'
        );
    });

    it('shows the fields of objects and of object lists in the signatures of built-ins', () => {
        const catalog = new ChatUiCatalog({
                components: [
                    chatUiStackSpec(),
                    chatUiMetricsSpec(),
                    chatUiChartSpec(),
                    chatUiCardSpec()
                ]
            }),
            {components} = toOpenUiLibrary(catalog, {root: 'stack'}),
            formats = '"number" | "percent" | "currency" | "none"';

        expect(components.Metrics.signature).toContain(
            `Metrics(metrics: {label: string; value: number | string; format?: ${formats}; ` +
                'decimals?: number; delta?: number;'
        );
        expect(components.Chart.signature).toContain(
            'xAxis?: {type?: "category" | "datetime"; categories?: string[]; title?: string}'
        );
        expect(components.Chart.signature).toContain(
            'series: {name: string; data: (number | (number | string)[])[]}[]'
        );
        expect(components.Card.signature).toContain(
            `fields: {label: string; value: number | string; format?: ${formats}; ` +
                'decimals?: number}[]'
        );
    });

    it('adds a Props line to the description, with the first line of each prop description', () => {
        const catalog = new ChatUiCatalog({components: [chatUiStackSpec(), chatUiMetricsSpec()]}),
            {components} = toOpenUiLibrary(catalog, {root: 'stack'}),
            [description, props] = components.Metrics.description.split('\n');

        expect(description).toBe(chatUiMetricsSpec().description);
        expect(props).toMatch(/^Props: /);
        expect(props).toContain(
            'metrics[].value: A number, or short text shown as is. Send the full number - a ' +
                'large value is shown in a compact form, such as $48.5B.'
        );
        expect(props).toContain('; metrics[].delta: Change in the value');
        // A prop with no description is left out.
        expect(props).not.toContain('metrics[].label');
        expect(components.Stack.description).toContain(
            '\nProps: direction: Default "column".; gap: Space between children.'
        );
    });

    it('caps the Props line at 600 characters, at a prop boundary', () => {
        const spec: ChatUiComponentSpec = {
                name: 'Wide',
                description: 'Many props.',
                props: {
                    type: 'object',
                    properties: Object.fromEntries(
                        Array.from({length: 20}, (_, idx) => [
                            `p${idx}`,
                            {type: 'string', description: `${'x'.repeat(50)}\nSecond line.`}
                        ])
                    )
                },
                render: () => null
            },
            {components} = toOpenUiLibrary(new ChatUiCatalog({components: [STACK, spec]}), {
                root: 'Stack'
            }),
            props = components.Wide.description.split('\n')[1];

        expect(props.length).toBeLessThanOrEqual(600);
        expect(props).toMatch(/; p\d+: x{50}$/);
        expect(props).not.toContain('Second line.');
        expect(components.Stack.description).toBe('A stack of children.');
    });

    it('writes a union for a list of types or for anyOf, and quotes keys that need it', () => {
        const spec: ChatUiComponentSpec = {
                name: 'Odd',
                description: 'Odd props.',
                props: {
                    type: 'object',
                    properties: {
                        id: {type: ['string', 'integer', 'number']},
                        size: {anyOf: [{type: 'number'}, {enum: ['auto']}]},
                        meta: {type: 'object', properties: {'x-y': {type: 'boolean'}}},
                        loose: {anyOf: [{type: 'string'}, {}]}
                    }
                },
                render: () => null
            },
            catalog = new ChatUiCatalog({components: [STACK, spec]}),
            {components} = toOpenUiLibrary(catalog, {root: 'Stack'});

        expect(components.Odd.signature).toBe(
            'Odd(id?: string | number, size?: number | "auto", meta?: {"x-y"?: boolean}, ' +
                'loose?: any)'
        );
    });

    it('maps component names both ways with componentName', () => {
        const library = toOpenUiLibrary(createCatalog(), {
            root: 'Stack',
            componentName: spec => `Ui${spec.name}`
        });

        expect(library.root).toBe('UiStack');
        expect(Object.keys(library.components)).toEqual(['UiStack', 'UiMetric', 'UiButton']);
        expect(library.schema.$defs.UiStack.properties.children).toMatchObject({
            items: {
                anyOf: [
                    {$ref: '#/$defs/UiStack'},
                    {$ref: '#/$defs/UiMetric'},
                    {$ref: '#/$defs/UiButton'}
                ]
            }
        });
        expect(library.toCatalogName('UiMetric')).toBe('Metric');
        expect(library.toCatalogName('Metric')).toBeNull();
        expect(library.toCatalogName('constructor')).toBeNull();
    });

    it("maps the kit's lowercase built-in names to uppercase OpenUI names by default", () => {
        const catalog = new ChatUiCatalog({
                components: [chatUiStackSpec(), chatUiCardSpec(), chatUiTextSpec()]
            }),
            library = toOpenUiLibrary(catalog, {root: 'stack'});

        expect(library.root).toBe('Stack');
        expect(Object.keys(library.components)).toEqual(['Stack', 'Card', 'Text']);
        expect(library.toCatalogName('Card')).toBe('card');
        expect(library.toCatalogName('card')).toBeNull();
    });

    it('throws when a component name is not a valid OpenUI component name', () => {
        expect(() =>
            toOpenUiLibrary(createCatalog(), {
                root: 'Stack',
                componentName: spec => spec.name.toLowerCase()
            })
        ).toThrow(`'stack'`);
    });

    it('throws when two components map to the same OpenUI name', () => {
        const catalog = new ChatUiCatalog({components: [STACK, {...METRIC, name: 'stack'}]});
        expect(() => toOpenUiLibrary(catalog, {root: 'Stack'})).toThrow(
            "catalog component 'Stack' maps to it too"
        );
    });

    it('throws when root is not a container of the catalog', () => {
        const catalog = createCatalog();
        expect(() => toOpenUiLibrary(catalog, {root: 'Chart'})).toThrow(`'Chart'`);
        expect(() => toOpenUiLibrary(catalog, {root: 'Metric'})).toThrow('default');
        expect(() =>
            toOpenUiLibrary(catalog, {root: 'Stack', slotAccepts: {Stack: {default: ['Chart']}}})
        ).toThrow(`'Chart'`);
    });

    it('drives lang-core: a program over the schema parses to the right typeNames and props', () => {
        const library = toOpenUiLibrary(createCatalog(), {root: 'Stack'}),
            parser = createStreamingParser(library.schema, library.root),
            {root, meta} = parser.set(
                [
                    'root = Stack([rev, Metric("Margin", 0.4, "percent")], "small", "Q3", [ask])',
                    'rev = Metric("Revenue", 12)',
                    'ask = Button("Why?", @ToAssistant("Why did revenue fall?"))'
                ].join('\n'),
                true
            );

        expect(meta.errors).toEqual([]);
        expect(root).toMatchObject({
            typeName: 'Stack',
            props: {
                gap: 'small',
                title: 'Q3',
                footer: [{typeName: 'Button', props: {label: 'Why?'}}],
                children: [
                    {typeName: 'Metric', props: {label: 'Revenue', value: 12}},
                    {
                        typeName: 'Metric',
                        props: {label: 'Margin', value: 0.4, format: 'percent'}
                    }
                ]
            }
        });
        const action = (root.props.footer as any)[0].props.action;
        expect(action).toMatchObject({k: 'Comp', name: 'ToAssistant'});
    });
});

//------------------
// Helpers
//------------------
const STACK: ChatUiComponentSpec = {
    name: 'Stack',
    description: 'A stack of children.',
    props: {
        type: 'object',
        properties: {gap: {enum: ['small', 'large']}, title: {type: 'string', maxLength: 80}}
    },
    slots: ['default', 'footer'],
    render: () => null
};

const METRIC: ChatUiComponentSpec = {
    name: 'Metric',
    description: 'A KPI tile.',
    props: {
        type: 'object',
        required: ['label', 'value'],
        properties: {
            label: {type: 'string'},
            value: {type: 'number'},
            format: {type: 'string', enum: ['number', 'percent']}
        }
    },
    render: () => null
};

const BUTTON: ChatUiComponentSpec = {
    name: 'Button',
    description: 'A button that runs an action.',
    props: {
        type: 'object',
        required: ['label'],
        properties: {
            label: {type: 'string'},
            action: chatUiActionSchema({types: ['send']}),
            more: {type: 'array', items: chatUiActionSchema()}
        }
    },
    render: () => null
};

const ACTION_EXPRESSION = {
    anyOf: [
        {
            type: 'object',
            properties: {type: {type: 'string', const: 'open_url'}, url: {type: 'string'}},
            required: ['type', 'url'],
            additionalProperties: false
        },
        {
            type: 'object',
            properties: {
                type: {type: 'string', const: 'continue_conversation'},
                context: {type: 'string'}
            },
            required: ['type'],
            additionalProperties: false
        },
        {
            type: 'object',
            properties: {
                type: {type: 'string'},
                params: {
                    type: 'object',
                    propertyNames: {type: 'string'},
                    additionalProperties: {}
                }
            },
            required: ['type'],
            additionalProperties: false
        }
    ]
};

function createCatalog(): ChatUiCatalog {
    return new ChatUiCatalog({components: [STACK, METRIC, BUTTON]});
}
