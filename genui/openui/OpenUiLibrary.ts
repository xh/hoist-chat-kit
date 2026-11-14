import type {PlainObject} from '@xh/hoist/core';
import {throwIf} from '@xh/hoist/utils/js';
import {buildSignature, type LibraryJSONSchema} from '@openuidev/lang-core';
import {
    castArray,
    findKey,
    invert,
    isArray,
    isEmpty,
    isPlainObject,
    isString,
    takeWhile,
    uniq,
    upperFirst,
    without
} from 'lodash';
import {getOwn} from '../../impl/LangUtils';
import {isChatUiActionSchema} from '../ChatUiAction';
import type {ChatUiCatalog} from '../ChatUiCatalog';
import type {ChatUiComponentSpec} from '../ChatUiComponentSpec';

/** Options for {@link toOpenUiLibrary}. */
export interface OpenUiLibraryOptions {
    /**
     * Catalog name of the component at the root of every program - a container, whose `slots`
     * include `default`.
     */
    root: string;

    /**
     * The OpenUI name of a catalog component. lang-core reads a lowercase call such as `stack()`
     * as a variable reference, so each name must start with an uppercase letter. Default the
     * catalog name with its first letter in uppercase, such as `Stack` for `stack`.
     */
    componentName?: (spec: ChatUiComponentSpec) => string;

    /**
     * The components each slot accepts, by catalog name: component, then slot, then the accepted
     * components. Default every component of the catalog, for every slot.
     */
    slotAccepts?: Record<string, Record<string, string[]>>;

    /**
     * True to mark each prop that a component lists in its `stateProps` as `$binding<type>` in
     * its signature, so the model knows it takes a `$variable`. Set by the format when it runs
     * programs with state. Default false.
     */
    bindings?: boolean;
}

/** A catalog as an OpenUI library - see {@link toOpenUiLibrary}. */
export interface OpenUiLibrary {
    /** The library's JSON Schema, for the lang-core parser and prompt. */
    schema: LibraryJSONSchema;

    /** OpenUI name of the root component. */
    root: string;

    /**
     * The prompt signature and description of each component, by OpenUI name. The description is
     * the component's own, then a `Props: ` line with the first line of each prop description.
     */
    components: Record<string, {signature: string; description: string}>;

    /** The catalog name of a component, by its OpenUI name, or null for an unknown name. */
    toCatalogName: (openUiName: string) => string;
}

/**
 * Turn a catalog into an OpenUI library: the JSON Schema that lang-core parses OpenUI Lang
 * against, with a definition per component, and the signature of each component for the prompt.
 *
 * Each component takes its `default` slot first, as `children`, as OpenUI's own components do.
 * Its props follow, in the order of its props schema, then its named slots. A prop typed with
 * {@link chatUiActionSchema} takes an OpenUI action expression, such as `@ToAssistant("...")`.
 * With `bindings`, a prop in the component's `stateProps` is typed `$binding<type>`.
 */
export function toOpenUiLibrary(catalog: ChatUiCatalog, opts: OpenUiLibraryOptions): OpenUiLibrary {
    const {
            root,
            componentName = spec => upperFirst(spec.name),
            slotAccepts = {},
            bindings = false
        } = opts,
        specs = catalog.components,
        openUiNames: Record<string, string> = {};

    specs.forEach(spec => {
        const name = componentName(spec);
        throwIf(
            !NAME_RE.test(name ?? ''),
            `OpenUI name '${name}' of catalog component '${spec.name}' must start with an ` +
                'uppercase letter, and hold only letters, digits and _. Map it with componentName.'
        );
        const other = findKey(openUiNames, it => it === name);
        throwIf(
            other != null || name === ACTION_DEF,
            `OpenUI name '${name}' of catalog component '${spec.name}' must be unique, and not ` +
                `${ACTION_DEF}` +
                (other != null ? ` - catalog component '${other}' maps to it too.` : '.')
        );
        openUiNames[spec.name] = name;
    });
    const names = Object.values(openUiNames);

    const rootSpec = catalog.getComponent(root);
    throwIf(!rootSpec, `OpenUI root '${root}' is not a component of the catalog.`);
    throwIf(
        !rootSpec.slots?.includes('default'),
        `OpenUI root '${root}' must be a container, with a 'default' slot.`
    );

    const toOpenUiName = (name: string) => {
        throwIf(!getOwn(openUiNames, name), `'${name}' is not a component of the catalog.`);
        return openUiNames[name];
    };
    const getAccepted = (spec: ChatUiComponentSpec, slot: string) => {
        const accepted = getOwn(getOwn(slotAccepts, spec.name), slot);
        return (accepted ?? specs.map(it => it.name)).map(toOpenUiName);
    };
    Object.entries(slotAccepts).forEach(([name, slots]) =>
        Object.keys(slots).forEach(slot =>
            throwIf(
                !catalog.getComponent(name)?.slots?.includes(slot),
                `OpenUI slotAccepts names slot '${slot}' of '${name}', which has no such slot.`
            )
        )
    );

    const $defs: Record<string, PlainObject> = {},
        components: OpenUiLibrary['components'] = {};
    let usesActions = false;
    specs.forEach(spec => {
        const name = openUiNames[spec.name],
            {def, fields} = toComponentDef(spec, name, getAccepted, bindings);
        $defs[name] = def;
        components[name] = {
            signature: buildSignature(name, fields),
            description: toDescription(spec)
        };
        usesActions ||= fields.some(it => ACTION_TYPES.includes(it.typeAnnotation));
    });
    if (usesActions) $defs[ACTION_DEF] = ACTION_EXPRESSION;

    const catalogNames = invert(openUiNames);
    return {
        schema: {
            type: 'object',
            properties: Object.fromEntries(names.map(it => [it, toRef(it)])),
            required: names,
            additionalProperties: false,
            $defs
        } as LibraryJSONSchema,
        root: openUiNames[root],
        components,
        toCatalogName: openUiName => getOwn(catalogNames, openUiName)
    };
}

//------------------
// Implementation
//------------------
type FieldInfo = Parameters<typeof buildSignature>[1][number];

const NAME_RE = /^[A-Z][A-Za-z0-9_]*$/,
    KEY_RE = /^[A-Za-z_$][\w$]*$/,
    MAX_TYPE_DEPTH = 3,
    ACTION_DEF = 'ActionExpression',
    ACTION_REF = toRef(ACTION_DEF),
    ACTION_TYPES = [ACTION_DEF, `${ACTION_DEF}[]`],
    PROPS_LABEL = 'Props: ',
    PROPS_SEPARATOR = '; ',
    MAX_PROPS_LENGTH = 600;

// The action expression lang-core expects, as `library.toJSONSchema()` writes it.
const ACTION_EXPRESSION: PlainObject = {
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
                params: {type: 'object', propertyNames: {type: 'string'}, additionalProperties: {}}
            },
            required: ['type'],
            additionalProperties: false
        }
    ]
};

function toComponentDef(
    spec: ChatUiComponentSpec,
    name: string,
    getAccepted: (spec: ChatUiComponentSpec, slot: string) => string[],
    bindings: boolean
): {def: PlainObject; fields: FieldInfo[]} {
    const {properties = {}, required = []} = spec.props,
        props: PlainObject = {},
        fields: FieldInfo[] = [],
        add = (key: string, schema: PlainObject, type: string) => {
            props[key] = schema;
            fields.push({
                name: key,
                isOptional: !required.includes(key),
                isArray: type.endsWith('[]'),
                typeAnnotation: type
            });
        };

    const slots = spec.slots ?? [],
        addSlot = (slot: string) => {
            const key = slot === 'default' ? 'children' : slot,
                accepted = getAccepted(spec, slot),
                items = accepted.length === 1 ? toRef(accepted[0]) : {anyOf: accepted.map(toRef)},
                itemType = accepted.join(' | ');
            throwIf(
                Object.hasOwn(properties, key),
                `OpenUI component '${name}' has a prop '${key}', which its '${slot}' slot would ` +
                    'replace. Rename the prop.'
            );
            add(
                key,
                {type: 'array', items},
                accepted.length === 1 ? `${itemType}[]` : `(${itemType})[]`
            );
        };

    // The default slot first, as `children`, as in OpenUI's own components.
    if (slots.includes('default')) addSlot('default');

    Object.entries<PlainObject>(properties).forEach(([key, schema]) => {
        if (isChatUiActionSchema(schema)) {
            add(key, ACTION_REF, ACTION_DEF);
        } else if (schema?.type === 'array' && isChatUiActionSchema(schema.items)) {
            add(key, {type: 'array', items: ACTION_REF}, `${ACTION_DEF}[]`);
        } else {
            const type = toTypeAnnotation(schema),
                isBound = bindings && spec.stateProps?.includes(key);
            add(key, schema, isBound ? `$binding<${type}>` : type);
        }
    });

    // Named slots after the props, in their declared order.
    without(slots, 'default').forEach(addSlot);

    return {
        def: {
            type: 'object',
            properties: props,
            required,
            additionalProperties: false,
            description: spec.description
        },
        fields
    };
}

// A component's description, then a line that lists the guidance of its props, such as
// `Props: metrics: The tiles.; metrics[].value: A number.`, cut at a prop to fit the cap.
function toDescription(spec: ChatUiComponentSpec): string {
    const props = describeProps(spec.props.properties);
    let length = PROPS_LABEL.length - PROPS_SEPARATOR.length;
    const kept = takeWhile(
        props,
        it => (length += PROPS_SEPARATOR.length + it.length) <= MAX_PROPS_LENGTH
    );
    return isEmpty(kept)
        ? spec.description
        : `${spec.description}\n${PROPS_LABEL}${kept.join(PROPS_SEPARATOR)}`;
}

// The first line of the description of each prop that has one, as `name: line`, with the fields
// of an object or of a list of objects after it, such as `metrics[].value`.
function describeProps(properties: PlainObject, prefix: string = '', depth: number = 0): string[] {
    if (!isPlainObject(properties) || depth > MAX_TYPE_DEPTH) return [];
    return Object.entries<PlainObject>(properties).flatMap(([key, schema]) => {
        if (!isPlainObject(schema)) return [];
        const name = `${prefix}${key}`,
            line = isString(schema.description) ? schema.description.split('\n', 1)[0].trim() : '',
            ret = line ? [`${name}: ${line}`] : [];
        if (isChatUiActionSchema(schema) || isChatUiActionSchema(schema.items)) return ret;

        const isList = schema.type === 'array',
            fields = (isList ? schema.items : schema)?.properties;
        return [...ret, ...describeProps(fields, isList ? `${name}[].` : `${name}.`, depth + 1)];
    });
}

function toRef(name: string): PlainObject {
    return {$ref: `#/$defs/${name}`};
}

// The type of a prop in a signature, such as `string`, `"a" | "b"` or
// `{label: string; value?: number}[]`. An object lists its fields, with `?` on those it does not
// require, down to a few levels of nesting.
function toTypeAnnotation(schema: PlainObject, depth: number = 0): string {
    return toTypes(schema, depth).join(' | ');
}

// The members of a schema's type - one, or several for a union.
function toTypes(schema: PlainObject, depth: number): string[] {
    if (!isPlainObject(schema)) return ['any'];
    const values = schema.enum ?? (Object.hasOwn(schema, 'const') ? [schema.const] : null);
    if (isArray(values)) return uniq(values.map(it => JSON.stringify(it)));

    const branches = schema.anyOf ?? schema.oneOf,
        types = isArray(branches)
            ? branches.flatMap(it => toTypes(it, depth))
            : castArray(schema.type ?? []).map(it => toType(it, schema, depth));
    return isEmpty(types) || types.includes('any') ? ['any'] : uniq(types);
}

function toType(type: string, schema: PlainObject, depth: number): string {
    switch (type) {
        case 'string':
        case 'boolean':
        case 'null':
            return type;
        case 'number':
        case 'integer':
            return 'number';
        case 'object': {
            const {properties, required} = schema;
            if (!isPlainObject(properties) || isEmpty(properties) || depth >= MAX_TYPE_DEPTH) {
                return 'object';
            }
            const fields = Object.entries<PlainObject>(properties).map(([key, it]) => {
                const name = KEY_RE.test(key) ? key : JSON.stringify(key),
                    optional = isArray(required) && required.includes(key) ? '' : '?';
                return `${name}${optional}: ${toTypeAnnotation(it, depth + 1)}`;
            });
            return `{${fields.join('; ')}}`;
        }
        case 'array': {
            const items = toTypes(schema.items, depth);
            return items.length > 1 ? `(${items.join(' | ')})[]` : `${items[0]}[]`;
        }
        default:
            return 'any';
    }
}
