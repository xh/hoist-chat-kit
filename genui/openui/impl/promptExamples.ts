import type {PlainObject} from '@xh/hoist/core';
import type {ToolSpec} from '@openuidev/lang-core';
import {camelCase, compact, findKey, isEmpty, isString, take} from 'lodash';
import {getOwn} from '../../../impl/LangUtils';
import type {ChatUiComponentSpec} from '../../ChatUiComponentSpec';
import type {ChatUiElement} from '../../ChatUiDocument';
import {
    asExpression,
    findBoundInput,
    findTextLeaf,
    getActionProp,
    getDataPropNames,
    getVariableName,
    writeExpressions,
    type PromptSectionOptions
} from './promptSections';

/** What {@link createPromptExamples} needs to know of the format. */
export interface PromptExampleOptions extends PromptSectionOptions {
    /** The tools that a program may call, as lang-core's prompt lists them. */
    tools: (string | ToolSpec)[];

    /** The components that each slot accepts - the format's `slotAccepts`. */
    slotAccepts: Record<string, Record<string, string[]>>;
}

/**
 * The example programs of the prompt, written from the catalog. The signatures show each
 * component, so the examples show whole programs instead:
 *
 * - A brief: the root with the first components that show data, each with its own example.
 * - A view that the user changes, with `bindings` on: an input bound to a `$variable`, and a
 *   component that reads it. With a tool that takes the value, a `Query()` passes it to the
 *   tool, and a component shows the rows of the result. Otherwise a text shows the value. With
 *   no component for either, the input stands alone.
 *
 * An example whose components the catalog lacks is left out.
 * @internal
 */
export function createPromptExamples(opts: PromptExampleOptions): string[] {
    const {catalog, root, slotAccepts} = opts,
        accepted = getOwn(getOwn(slotAccepts, root), 'default'),
        // The components that an example can put in the root.
        specs = catalog.components.filter(
            it =>
                it.name !== root &&
                !isEmpty(it.example) &&
                isEmpty(it.slots) &&
                (!accepted || accepted.includes(it.name))
        ),
        view = createView(opts, specs),
        // The brief leaves the component that a Query feeds to the view, where the catalog has
        // enough others, so that the examples show more of the catalog.
        shown = specs.filter(isDisplay),
        others = shown.filter(it => it.name !== view?.fed),
        brief = take(others.length >= MAX_BRIEF_CHILDREN ? others : shown, MAX_BRIEF_CHILDREN);

    return compact([
        isEmpty(brief) ? null : createProgram(opts, brief.map(toElement)),
        view?.program
    ]);
}

//------------------
// Implementation
//------------------
const MAX_BRIEF_CHILDREN = 3,
    IDENTIFIER_RE = /^[A-Za-z_]\w*$/,
    // The types of a value that a tool parameter of the same JSON Schema type takes.
    PARAM_TYPES = ['string', 'number', 'boolean'];

// A view that the user changes, and the catalog name of the component that a Query feeds in it,
// or null if it has no Query.
interface ViewExample {
    program: string;
    fed: string;
}

// True for a component that only shows data: no input, and no button.
function isDisplay(spec: ChatUiComponentSpec): boolean {
    return isEmpty(spec.stateProps) && getActionProp(spec) == null;
}

function toElement(spec: ChatUiComponentSpec): ChatUiElement {
    return {component: spec.name, props: spec.example};
}

// A program with the elements in the root, each named for its component. The statements of
// `declarations` follow the root, ahead of the components, as the prompt recommends.
function createProgram(
    opts: PromptExampleOptions,
    children: ChatUiElement[],
    declarations: string[] = []
): string {
    const {catalog, root, formatProgram} = opts,
        ids = children.map(it => camelCase(it.component)),
        [first, ...rest] = writeExpressions(
            formatProgram({
                root: 'root',
                elements: {
                    root: {
                        component: root,
                        props: catalog.getComponent(root)?.example ?? {},
                        children: ids
                    },
                    ...Object.fromEntries(children.map((it, idx) => [ids[idx], it]))
                }
            })
        ).split('\n');
    return [first, ...declarations, ...rest].join('\n');
}

function createView(opts: PromptExampleOptions, specs: ChatUiComponentSpec[]): ViewExample {
    const input = opts.bindings ? findBoundInput(specs) : null;
    if (!input) return null;

    const prop = input.stateProps[0],
        variable = getVariableName(input),
        value = (input.example as PlainObject)[prop],
        others = specs.filter(it => it !== input),
        reader =
            createQueryReader(opts, others, variable, value) ??
            createTextReader(others, variable, value),
        bound: ChatUiElement = {
            component: input.name,
            props: {...input.example, [prop]: asExpression(variable)}
        };
    return {
        program: createProgram(
            opts,
            compact([bound, reader?.element]),
            compact([
                value != null ? `${variable} = ${JSON.stringify(value)}` : null,
                reader?.statement
            ])
        ),
        fed: reader?.statement ? reader.element.component : null
    };
}

// An element that reads the state of a view, and a statement that it needs.
interface ViewReader {
    element: ChatUiElement;
    statement?: string;
}

// A Query that passes the variable to a listed tool, and a component that shows its rows. Null
// if no listed tool has a parameter for the value, or no component takes rows as they are.
function createQueryReader(
    opts: PromptExampleOptions,
    specs: ChatUiComponentSpec[],
    variable: string,
    value: unknown
): ViewReader {
    // A parameter takes the value if its schema names the type of the value.
    const type = typeof value;
    if (!opts.toolCalls || !PARAM_TYPES.includes(type)) return null;

    const getParam = (tool: string | ToolSpec) =>
            isString(tool)
                ? null
                : findKey(
                      tool.inputSchema?.properties as PlainObject,
                      (it, key) => it?.type === type && IDENTIFIER_RE.test(key)
                  ),
        tool = opts.tools.find(it => getParam(it) != null) as ToolSpec,
        spec = specs.find(it => getRowsProp(it) != null);
    if (!tool || !spec) return null;

    // The rows are the result, or its first list by the schema of the tool, else its `rows`.
    const returns: PlainObject = tool.outputSchema,
        isList = returns?.type === 'array',
        key =
            findKey(
                returns?.properties as PlainObject,
                (it, name) => it?.type === 'array' && IDENTIFIER_RE.test(name)
            ) ?? 'rows',
        // The statements of the components take their names, so the query takes another.
        isTaken = opts.catalog.components.some(it => camelCase(it.name) === 'data'),
        name = isTaken ? 'result' : 'data';
    return {
        element: {
            component: spec.name,
            props: {
                ...spec.example,
                [getRowsProp(spec)]: asExpression(isList ? name : `${name}.${key}`)
            }
        },
        statement:
            `${name} = Query(${JSON.stringify(tool.name)}, {${getParam(tool)}: ${variable}}, ` +
            `${isList ? '[]' : `{${key}: []}`})`
    };
}

// A text that shows the value of the variable, where the value is a string.
function createTextReader(
    specs: ChatUiComponentSpec[],
    variable: string,
    value: unknown
): ViewReader {
    const leaf = isString(value) ? findTextLeaf(specs) : null;
    return leaf
        ? {
              element: {
                  component: leaf.spec.name,
                  props: {...leaf.spec.example, [leaf.prop]: asExpression(variable)}
              }
          }
        : null;
}

// The prop of a component that takes rows as they are: a list of objects of any shape, held in
// the prop and not named by reference. Null if it has none.
function getRowsProp(spec: ChatUiComponentSpec): string {
    const refs = getDataPropNames(spec);
    return (
        findKey(
            spec.props?.properties as PlainObject,
            (schema, key) =>
                schema?.type === 'array' &&
                schema.items?.type === 'object' &&
                isEmpty(schema.items.properties) &&
                !refs.includes(key)
        ) ?? null
    );
}
