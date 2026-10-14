import type {PlainObject} from '@xh/hoist/core';
import {castArray, compact, isEmpty, isString, without} from 'lodash';
import type {ChatUiDeliveryMode} from '../ChatUiCatalog';
import type {ChatUiComponentSpec} from '../ChatUiComponentSpec';
import type {ChatUiLimits} from '../ChatUiDocument';

/** What the prompt and the document tool need from their catalog. */
export interface CatalogPromptSource {
    components: ChatUiComponentSpec[];
    instructions: string;
    tagPrefix: string;
    documentToolName: string;
    limits: Required<ChatUiLimits>;
    getToolName(component: ChatUiComponentSpec): string;
}

/**
 * System prompt text that explains a catalog to the model, for the delivery modes given: the
 * shared rules, then a section per mode, then the app's own rules and instructions.
 * @internal
 */
export function createPrompt(
    source: CatalogPromptSource,
    modes: ChatUiDeliveryMode[],
    rules: string[]
): string {
    const {components, instructions} = source,
        hasTools = modes.includes('tools') || modes.includes('document'),
        hasDataProps = components.some(it => !isEmpty(it.dataProps));

    const intro = [
        '## Showing UI',
        '',
        `You can show UI components to the user, inline in the chat${describeModes(source, modes)}.`,
        '',
        'Rules:',
        modes.includes('tools')
            ? '- Show one component per call. To show several, make several calls.'
            : null,
        '- Write the props in the order the schema lists them - for example the columns ' +
            'before the rows - so that the component can render as you write.',
        '- Keep the data within the limits of the schema, such as the maximum number of rows ' +
            'or items. Pick the most relevant data, or summarize it, rather than exceed a limit.',
        hasDataProps
            ? '- Some props name data by reference. Pass the id of a result a tool returned, ' +
              'and never write out its rows.'
            : null,
        '- Prefer a component for tabular and numeric results, such as a list of records, a set ' +
            'of figures, or a series over time.',
        '- Use text for explanation, context and conclusions. Do not repeat in text the data a ' +
            'component shows.',
        hasTools
            ? '- If a call fails, correct the props named in the error and call the tool again.'
            : null,
        ...(rules ?? []).map(it => `- ${it.trim()}`)
    ];

    return compact([
        compact(intro).join('\n'),
        modes.includes('tools') ? createToolsSection(source) : null,
        modes.includes('tags') ? createTagsSection(source) : null,
        modes.includes('document') ? createDocumentSection(source) : null,
        instructions?.trim()
    ]).join('\n\n');
}

/**
 * The input schema of the document tool: a flat document whose elements may be any catalog
 * component, each with the component's own props schema.
 * @internal
 */
export function createDocumentSchema(source: CatalogPromptSource): PlainObject {
    const {components, limits} = source,
        idList = {
            type: 'array',
            maxItems: limits.maxElements,
            items: {type: 'string', maxLength: MAX_ID_LENGTH}
        },
        elements = components.map(it => {
            const slots = it.slots ?? [],
                named = without(slots, 'default');
            return {
                type: 'object',
                required: ['component', 'props'],
                additionalProperties: false,
                properties: {
                    component: {const: it.name},
                    props: it.props,
                    ...(slots.includes('default') ? {children: idList} : {}),
                    ...(isEmpty(named)
                        ? {}
                        : {
                              slots: {
                                  type: 'object',
                                  additionalProperties: false,
                                  properties: Object.fromEntries(named.map(name => [name, idList]))
                              }
                          })
                }
            };
        });

    return {
        type: 'object',
        required: ['root', 'elements'],
        additionalProperties: false,
        properties: {
            root: {
                type: 'string',
                maxLength: MAX_ID_LENGTH,
                description: 'Id of the top element. Write it first.'
            },
            elements: {
                type: 'object',
                description:
                    `Each element by id - at most ${limits.maxElements}, parents before ` +
                    'their children.',
                additionalProperties: elements.length === 1 ? elements[0] : {anyOf: elements}
            }
        }
    };
}

/**
 * The description of the document tool, for the model: when to use it, the shape of a document,
 * and each component it can hold.
 * @internal
 */
export function createDocumentToolDescription(source: CatalogPromptSource): string {
    const {components, limits} = source;
    return [
        'Show several components together, nested, as one UI document - for example a summary ' +
            'above a chart and a table. For a single component, call its own tool.',
        '',
        'The input is a flat document. `root` is the id of the top element, and `elements` ' +
            'holds each element by id: its `component`, its `props`, and the ids of its ' +
            '`children`, or of the elements in each of its `slots`. An element has at most one ' +
            `parent. At most ${limits.maxElements} elements, ${limits.maxDepth} levels deep.`,
        '',
        'Components:',
        ...components.map(it => `- ${it.name}${describeSlots(it)}: ${firstLine(it.description)}`)
    ].join('\n');
}

/**
 * A tag for a component, as the model would write it - text in double quotes, and other values
 * as JSON in single quotes.
 * @internal
 */
export function formatTag(prefix: string, name: string, props: PlainObject): string {
    const attrs = Object.entries(props ?? {})
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) =>
            isString(value)
                ? `${key}="${escapeAttr(value, '"')}"`
                : `${key}='${escapeAttr(JSON.stringify(value), "'")}'`
        );
    return `<${prefix}${[name, ...attrs].join(' ')}/>`;
}

//------------------
// Implementation
//------------------
const MAX_ID_LENGTH = 64;

function describeModes(source: CatalogPromptSource, modes: ChatUiDeliveryMode[]): string {
    const ways = compact([
        modes.includes('tools') ? 'by calling the tool of a component' : null,
        modes.includes('tags') ? 'by writing a component tag in your answer' : null,
        modes.includes('document')
            ? `by calling \`${source.documentToolName}\` with a document`
            : null
    ]);
    if (isEmpty(ways)) return '';
    return ', ' + (ways.length > 1 ? `${ways.slice(0, -1).join(', ')} or ${ways.at(-1)}` : ways[0]);
}

function createToolsSection(source: CatalogPromptSource): string {
    return [
        '### Component tools',
        '',
        "Call a component's tool with the component's props as the input. Each call renders " +
            "one component, from props that match the tool's input schema.",
        ...source.components.map(it =>
            compact([
                '',
                `#### ${source.getToolName(it)}`,
                it.example ? `Example props: ${JSON.stringify(it.example)}` : null
            ]).join('\n')
        )
    ].join('\n');
}

function createTagsSection(source: CatalogPromptSource): string {
    const {tagPrefix: prefix} = source;
    return [
        '### Component tags',
        '',
        'Write a component as a tag in your answer, on a line of its own, where it belongs: ' +
            `\`<${prefix}NAME prop="text" prop='JSON'/>\`.`,
        `- Name the tag \`${prefix}\` followed by the component name.`,
        '- Write text values in double quotes. Write numbers, booleans, lists and objects as ' +
            'JSON in single quotes.',
        '- Close every tag with `/>`. Never put a tag in a code block.',
        ...source.components.map(it => {
            const {properties = {}, required = []} = it.props;
            return compact([
                '',
                `#### ${prefix}${it.name}`,
                it.description.trim(),
                isEmpty(properties) ? null : 'Props:',
                ...Object.entries(properties).map(([key, schema]: [string, PlainObject]) =>
                    describeProp(key, schema, required.includes(key))
                ),
                it.example ? `Example: ${formatTag(prefix, it.name, it.example)}` : null
            ]).join('\n');
        })
    ].join('\n');
}

function createDocumentSection(source: CatalogPromptSource): string {
    const {documentToolName, limits, components} = source,
        containers = components.filter(it => !isEmpty(it.slots));
    return compact([
        '### UI documents',
        '',
        `To show several components together, nested, call \`${documentToolName}\` with a ` +
            'document. List each element by a short, unique id, and refer to its children by id.',
        '- Write `root` first, then each element before its children.',
        '- An element has at most one parent.',
        `- Use at most ${limits.maxElements} elements, nested at most ${limits.maxDepth} levels deep.`,
        isEmpty(containers)
            ? null
            : `- Components that take children: ${containers.map(it => `${it.name}${describeSlots(it)}`).join(', ')}.`
    ]).join('\n');
}

function describeSlots(component: ChatUiComponentSpec): string {
    return isEmpty(component.slots) ? '' : ` (${component.slots.join(', ')})`;
}

function describeProp(key: string, schema: PlainObject, isRequired: boolean): string {
    const type = schema?.enum
            ? `one of ${schema.enum.map(it => JSON.stringify(it)).join(', ')}`
            : castArray(schema?.type ?? 'any').join(' or '),
        details = compact([type, isRequired ? 'required' : null]).join(', '),
        description = schema?.description ? `: ${firstLine(schema.description)}` : '';
    return `- ${key} (${details})${description}`;
}

function firstLine(text: string): string {
    return text.trim().split('\n')[0];
}

function escapeAttr(value: string, quote: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(quote === '"' ? /"/g : /'/g, quote === '"' ? '&quot;' : '&apos;');
}
