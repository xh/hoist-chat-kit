import type {ElementFactory, PlainObject} from '@xh/hoist/core';
import {throwIf} from '@xh/hoist/utils/js';
import {castArray, isEmpty, isPlainObject} from 'lodash';
import {getOwn, toLookup} from './impl/pointer';
import {findSchemaProblems} from '../impl/SchemaUtils';
import type {ReactNode} from 'react';
import type {Blueprint, BlueprintIssue} from './Blueprint';
import type {BlueprintModel} from './BlueprintModel';
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
 * `x-template` marks text with `{variable}` and `{source.field}` references, which renames
 * follow and the validator checks. A
 * property's `default` is the value the widget takes while the config leaves it unset. The
 * validator ignores it, design mode shows it, and the widget applies it - see
 * `BlueprintWidgetModel.configDefault()`. State a default there, not in the description.
 */
/**
 * What a widget is, for the palette and for a container's `accepts`. A `container` has chrome,
 * and a `layout` widget only arranges or divides its siblings.
 */
export type WidgetCategory = 'container' | 'layout' | 'content' | 'data' | 'input' | 'action';

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
    category: WidgetCategory;
    config: PlainObject;
    example?: PlainObject;
    /** Paths inside the config that a preset can set, such as `/columnState`. */
    presetPaths?: string[];
    outputs?: WidgetOutputSpec[];
    /**
     * The type of value the widget shows and sets, for a variable whose `setBy` names it, or each
     * type it can show and set.
     */
    value?: {type: string | string[]};
    /**
     * For a container, the schema of its child references, and the widgets it accepts as
     * children: those of any category listed, plus any widget named. Default any widget.
     */
    children?: {schema: PlainObject; accepts?: {categories?: WidgetCategory[]; widgets?: string[]}};
    size?: {default: WidgetSize; min?: WidgetSize; max?: WidgetSize};
    /** True for a widget the app provides. */
    app?: boolean;
    /**
     * True for a widget that only the kit places, when it degrades a chat answer. An authored
     * blueprint cannot use it, and the Architect never sees it.
     */
    reserved?: boolean;
    /**
     * True for a widget that renders a config still arriving, as a chat kit component does. While
     * its element streams, the validator checks its config only for what a growing value could
     * not still satisfy, and skips `validate`. Every other widget gets complete configs only.
     */
    rendersPartial?: boolean;
    /**
     * Other ways to draw the widget, from the same config and model, beyond its own `panel`. An
     * element picks one with its config's `presentation`. Added with `addPresentation()`.
     */
    presentations?: PresentationSpec[];
    /**
     * The data the widget needs from each source it reads, by source name, given its config with
     * bindings resolved. A source merges every widget's demand on it into one request.
     */
    demand?: (config: PlainObject) => Record<string, WidgetDemand>;
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

/** Another way to draw a widget, from the same config and model - see `addPresentation()`. */
export interface PresentationSpec {
    /** Name an element's config picks it by. Never `panel`, the widget's own component. */
    name: string;
    label: string;
    /** When to use it, for the Architect. */
    guidance: string;
    component: ElementFactory;
    /** Config keys it does not draw, such as a grid's styles in a card. Default none. */
    ignores?: string[];
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
    /**
     * An object schema for the action's parameters, which sit beside its `type`. Each step's
     * values are checked against it, once resolved, before any step of a list runs. Mark a param
     * that names a variable to set with `x-variable`, which excludes `x-binding`.
     */
    params: PlainObject;
    guidance?: string;
    /** True if the action changes data. It always asks the user to confirm. */
    sideEffects?: boolean;
    /**
     * The blueprints that may use the action: dashboards, chat answers, or both. The validator
     * refuses it anywhere else, whatever registry holds it. Default both.
     */
    allowedIn?: ('dashboards' | 'answers')[];
    app?: boolean;
    /**
     * The action's description, built from its resolved parameters, shown as its tooltip and in
     * any confirmation. Default its type.
     */
    describe?: (params: PlainObject) => string;
    /**
     * Why the action cannot run now, or null if it can. Checked with its parameters, before the
     * user is asked to confirm.
     */
    check?: (params: PlainObject, ctx: ActionContext) => string;
    /**
     * Run an app action. Its parameters arrive resolved and checked against `params`, but treat
     * them as untrusted all the same: a model, or a user's input, may have chosen them. Throw to
     * stop the steps after it, with a message the user sees.
     */
    run?: (params: PlainObject, ctx: ActionContext) => unknown;
}

/** What an app action's `run` receives beside its parameters. */
export interface ActionContext {
    blueprintModel: BlueprintModel;
    /** The row a row action was run on, if any. */
    row?: PlainObject;
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
    /**
     * The largest absolute value of the field among the rows beside this one, for a renderer that
     * scales, such as a bar. Absent where there are no rows to compare, as in a stat card.
     */
    columnMax?: () => number;
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
 * resolvers, actions and renderers. Starts with Hoist Blueprints' built-ins, under bare names such
 * as `refresh`. An app adds its own under dotted names, such as `acme.publish`, so they never clash
 * with a built-in, and every `add` method refuses an app entry whose name has no dot.
 */
export class BlueprintRegistry {
    readonly widgets: Record<string, WidgetSpec> = toLookup({});
    readonly variableTypes: Record<string, VariableTypeSpec> = toLookup({});
    readonly resolvers: Record<string, ResolverSpec> = toLookup({});
    readonly actions: Record<string, ActionSpec> = toLookup({});
    readonly renderers: Record<string, RendererSpec> = toLookup({});

    // True while adding entries that keep bare names: the built-ins, and an XH library's own.
    private trusted = false;

    constructor(config: BlueprintRegistryConfig = {}) {
        this.addBuiltIns({
            widgets: BUILT_IN_WIDGETS,
            resolvers: BUILT_IN_RESOLVERS,
            actions: BUILT_IN_ACTIONS,
            renderers: BUILT_IN_RENDERERS
        });
        this.addWidgets(config.widgets ?? []);
        this.addResolvers(config.resolvers ?? []);
        this.addActions(config.actions ?? []);
        this.addRenderers(config.renderers ?? []);
        this.addVariableTypes(config.variableTypes ?? []);
    }

    /**
     * Add entries under bare names: the built-ins, and an XH library's own, as chat kit's catalog
     * adds its components. Not for an app, whose entries take dotted names.
     * @internal
     */
    addBuiltIns(
        config: BlueprintRegistryConfig & {
            presentations?: {widget: string; presentation: PresentationSpec}[];
        }
    ) {
        this.trusted = true;
        try {
            this.addWidgets(config.widgets ?? []);
            this.addResolvers(config.resolvers ?? []);
            this.addActions(config.actions ?? []);
            this.addRenderers(config.renderers ?? []);
            this.addVariableTypes(config.variableTypes ?? []);
            config.presentations?.forEach(it => this.addPresentation(it.widget, it.presentation));
        } finally {
            this.trusted = false;
        }
    }

    /**
     * Add a presentation to a widget: another way to draw it, from the same config and model. The
     * widget's config then takes `presentation`, with `panel` for its own component, and its
     * guidance says what each one is for. Throws for an unknown widget or a taken name.
     */
    addPresentation(widget: string, presentation: PresentationSpec) {
        const spec = getOwn(this.widgets, widget),
            {name} = presentation;
        this.checkName('presentation', name);
        throwIf(!spec, `No widget '${widget}' to add presentation '${name}' to.`);
        throwIf(
            name === 'panel' || spec.presentations?.some(it => it.name === name),
            `Widget '${widget}' already has a presentation '${name}'.`
        );
        const presentations = [...(spec.presentations ?? []), presentation],
            ignores = presentation.ignores ?? [],
            ignored = ignores.length ? ` It ignores ${ignores.join(', ')}.` : '';
        this.widgets[widget] = {
            ...spec,
            presentations,
            guidance: `${spec.guidance} Presentation "${name}" (${presentation.label}): ${presentation.guidance}${ignored}`,
            config: {
                ...spec.config,
                properties: {
                    ...spec.config.properties,
                    ...Object.fromEntries(
                        ignores
                            .filter(it => getOwn(spec.config.properties, it))
                            .map(it => {
                                const prop = spec.config.properties[it];
                                return [
                                    it,
                                    {
                                        ...prop,
                                        description:
                                            `${prop.description ?? ''} The ${name} presentation ignores it.`.trim()
                                    }
                                ];
                            })
                    ),
                    presentation: {
                        enum: ['panel', ...presentations.map(it => it.name)],
                        description: 'How the widget draws. Default "panel".'
                    }
                }
            }
        };
    }

    /** Add widgets. Throws if a config or children schema uses JSON Schema the validator lacks. */
    addWidgets(...specs: (WidgetSpec | WidgetSpec[])[]) {
        specs.flat().forEach(spec => {
            this.checkName('widget', spec.name);
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
        this.add('variable type', this.variableTypes, specs);
    }

    addResolvers(...specs: (ResolverSpec | ResolverSpec[])[]) {
        this.add('resolver', this.resolvers, specs);
    }

    /** Add actions. Throws if one has no object schema for its parameters. */
    addActions(...specs: (ActionSpec | ActionSpec[])[]) {
        specs.flat().forEach(spec => {
            this.checkName('action', spec?.name);
            const {params} = spec ?? ({} as ActionSpec),
                problems = isPlainObject(params) ? findSchemaProblems(params) : [],
                // A param that names a variable takes the name, never a binding to one.
                both = Object.entries<PlainObject>(params?.properties ?? {})
                    .filter(([, it]) => it?.['x-variable'] && it['x-binding'])
                    .map(([key]) => `${key} has both x-variable and x-binding`);
            problems.push(...both);
            throwIf(
                !isPlainObject(params) ||
                    (params as PlainObject).type !== 'object' ||
                    !isEmpty(problems),
                `Action '${spec?.name}' needs an object schema for its params${problems.length ? `: ${problems.join(', ')}` : ''}`
            );
            this.actions[spec.name] = spec;
        });
    }

    addRenderers(...specs: (RendererSpec | RendererSpec[])[]) {
        this.add('renderer', this.renderers, specs);
    }

    //------------------
    // Implementation
    //------------------
    private add<T extends {name: string}>(
        kind: string,
        target: Record<string, T>,
        specs: (T | T[])[]
    ) {
        specs
            .flatMap(it => castArray(it))
            .forEach(it => {
                this.checkName(kind, it.name);
                target[it.name] = it;
            });
    }

    private checkName(kind: string, name: string) {
        throwIf(
            !this.trusted && !APP_NAME.test(name ?? ''),
            `App ${kind} '${name}' needs a dotted name, such as 'acme.${name}', so it cannot clash with a built-in.`
        );
    }
}

// An app's entry name: a namespace and a name, joined by a dot, such as `acme.publish`.
const APP_NAME = /^[A-Za-z][A-Za-z0-9_-]*(\.[A-Za-z][A-Za-z0-9_-]*)+$/;
