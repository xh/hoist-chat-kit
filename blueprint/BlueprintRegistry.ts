import type {ElementFactory, PlainObject} from '@xh/hoist/core';
import {throwIf} from '@xh/hoist/utils/js';
import {castArray, isEmpty} from 'lodash';
import {findSchemaProblems} from '../impl/SchemaUtils';
import type {ReactNode} from 'react';
import type {Blueprint, BlueprintIssue} from './Blueprint';
import type {BlueprintVariable} from './BlueprintVariable';
import type {BlueprintWidgetConfig, BlueprintWidgetModel} from './BlueprintWidgetModel';
import type {FieldDef} from './DataCatalog';
import {BUILT_IN_RENDERERS, BUILT_IN_RESOLVERS} from './impl/builtInSpecs';
import {BUILT_IN_ACTIONS, BUILT_IN_WIDGETS} from './impl/builtInWidgets';

/**
 * A widget a blueprint can configure. The config schema uses chat kit's JSON Schema subset, plus
 * annotations that the validator reads: `x-binding` marks a value that accepts `{"$var": name}`,
 * `x-source` a source name, `x-field` a field of the widget's source (`"dimension"`, `"measure"` or
 * `"any"`), and `x-filter`, `x-format`, `x-renderer` and `x-action` a value of that form.
 */
export interface WidgetSpec {
    /** Registry key, the Hoist factory name of the component it renders, such as `cubeGrid`. */
    name: string;
    version: number;
    /** The name users see, such as "Grid". */
    label: string;
    /** The words users use for it, such as "table" or "pivot". */
    terms?: string[];
    description?: string;
    /** For the LLM: when to choose it, and over what. */
    guidance: string;
    category: 'container' | 'data' | 'input' | 'action';
    config: PlainObject;
    example?: PlainObject;
    /** Paths inside the config that a preset can set, such as `/columnState`. */
    presetPaths?: string[];
    outputs?: WidgetOutputSpec[];
    /** The type of value the widget shows and sets, for a variable whose `setBy` names it. */
    value?: {type: string};
    /** For a container, the schema of its child references. */
    children?: {schema: PlainObject; accepts?: string[]};
    size?: {default: WidgetSize; min?: WidgetSize; max?: WidgetSize};
    /** True for a widget the app provides. */
    app?: boolean;
    /**
     * The data the widget needs from its source, given its config with bindings resolved. A
     * source merges every widget's demand into one request.
     */
    demand?: (config: PlainObject) => WidgetDemand;
    /** The widget's model class. Default the platform's built-in model, or `BlueprintWidgetModel`. */
    model?: new (config: BlueprintWidgetConfig) => BlueprintWidgetModel;
    /** The widget's component factory, rendered with its model. Default the platform's built-in one. */
    component?: ElementFactory;
    /** Checks the schema cannot express. Paths are inside the widget's config. */
    validate?: (config: PlainObject, ctx: WidgetValidateContext) => BlueprintIssue[];
}

/** What a widget's own checks can read beyond its config. */
export interface WidgetValidateContext {
    blueprint: Blueprint;
    /** The element's ID. */
    id: string;
}

/** The fields a widget reads from its source, and the dimensions it groups them by. */
export interface WidgetDemand {
    fields: string[];
    groupBy: string[];
}

export interface WidgetOutputSpec {
    name: string;
    /** `filter`, a variable type, or `field` for the value of the field named by its argument. */
    type: string;
    args?: Record<string, string>;
    description?: string;
    /**
     * For a filter output: true if it only ever sets single-value `=` clauses on dimensions, as a
     * single-select grid's selection does. Such a filter folds into server grouping sets.
     */
    folds?: boolean;
}

export interface WidgetSize {
    w: number;
    h: number;
}

/** An app variable type, such as `fund`. */
export interface VariableTypeSpec {
    name: string;
    /** The field type its values match, so it can bind a parameter or filter of that type. */
    matches: string;
    guidance?: string;
    app?: boolean;
    /**
     * Render the prompt input for a variable of this type, in place of the built-in input for its
     * `matches` type. The input shows `value` and calls `onCommit` with a new one.
     */
    input?: (props: VariableInputProps) => ReactNode;
}

/** What a variable type's prompt input receives. */
export interface VariableInputProps {
    variable: BlueprintVariable;
    value: unknown;
    onCommit: (value: unknown) => void;
}

/** A named function that computes a variable's value, such as `previousBusinessDay`. */
export interface ResolverSpec {
    name: string;
    /** The type of value it returns. */
    returns: string;
    /** Each argument, with a description for the LLM. */
    args: Record<string, string>;
    guidance?: string;
    app?: boolean;
    /** Compute the value from resolved arguments. */
    resolve: (args: PlainObject) => unknown;
}

/** A type of action that a widget's action prop can run. */
export interface ActionSpec {
    name: string;
    /** Each parameter, with a description for the LLM. */
    params: Record<string, string>;
    guidance?: string;
    /** True if the action changes data. It always asks the user to confirm. */
    sideEffects?: boolean;
    app?: boolean;
}

/** A renderer that draws a value as more than text. */
export interface RendererSpec {
    name: string;
    appliesTo: {types?: string[]; kinds?: string[]};
    config?: PlainObject;
    guidance?: string;
    app?: boolean;
    /** Draw a value. Use `ctx.formatValue` for any text, and never treat text as markup. */
    render?: (value: unknown, ctx: RendererContext) => ReactNode;
    /** The value for an export or a copy, such as a bar's number. Default the raw value. */
    exportValue?: (value: unknown, ctx: RendererContext) => string | number;
}

/** What a renderer receives with each value. */
export interface RendererContext {
    field: FieldDef;
    /** The renderer's options, as the blueprint or catalog names them. */
    config: PlainObject;
    /** The field's resolved format options. */
    format: PlainObject;
    /** True on a group or summary row. */
    isAggregate: boolean;
    /** The row's data, when the value is in a row. */
    record?: PlainObject;
    /** Format a value with the field's format. */
    formatValue: (value: unknown) => ReactNode;
}

export interface BlueprintRegistryConfig {
    widgets?: WidgetSpec[];
    variableTypes?: VariableTypeSpec[];
    resolvers?: ResolverSpec[];
    actions?: ActionSpec[];
    renderers?: RendererSpec[];
}

/**
 * The things an app provides in code for blueprints to configure: widget types, variable types,
 * resolvers, actions and renderers. Starts with Hoist Blueprints' built-ins, which an app extends
 * with its own entries, or replaces by registering an entry under the same name.
 */
export class BlueprintRegistry {
    readonly widgets: Record<string, WidgetSpec> = {};
    readonly variableTypes: Record<string, VariableTypeSpec> = {};
    readonly resolvers: Record<string, ResolverSpec> = {};
    readonly actions: Record<string, ActionSpec> = {};
    readonly renderers: Record<string, RendererSpec> = {};

    constructor(config: BlueprintRegistryConfig = {}) {
        this.addWidgets(BUILT_IN_WIDGETS, config.widgets ?? []);
        this.addResolvers(BUILT_IN_RESOLVERS, config.resolvers ?? []);
        this.addActions(BUILT_IN_ACTIONS, config.actions ?? []);
        this.addRenderers(BUILT_IN_RENDERERS, config.renderers ?? []);
        this.addVariableTypes(config.variableTypes ?? []);
    }

    /** Add widgets. Throws if a config or children schema uses JSON Schema the validator lacks. */
    addWidgets(...specs: (WidgetSpec | WidgetSpec[])[]) {
        specs.flat().forEach(spec => {
            const problems = [
                ...findSchemaProblems(spec.config),
                ...findSchemaProblems(spec.children?.schema)
            ];
            throwIf(
                !isEmpty(problems),
                `Widget '${spec.name}' uses unsupported JSON Schema: ${problems.join(', ')}`
            );
            this.widgets[spec.name] = spec;
        });
    }

    addVariableTypes(...specs: (VariableTypeSpec | VariableTypeSpec[])[]) {
        add(this.variableTypes, specs);
    }

    addResolvers(...specs: (ResolverSpec | ResolverSpec[])[]) {
        add(this.resolvers, specs);
    }

    addActions(...specs: (ActionSpec | ActionSpec[])[]) {
        add(this.actions, specs);
    }

    addRenderers(...specs: (RendererSpec | RendererSpec[])[]) {
        add(this.renderers, specs);
    }
}

function add<T extends {name: string}>(target: Record<string, T>, specs: (T | T[])[]) {
    specs.flatMap(it => castArray(it)).forEach(it => (target[it.name] = it));
}
