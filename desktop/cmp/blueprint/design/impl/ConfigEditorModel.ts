import type {FilterChooserFieldSpecConfig} from '@xh/hoist/cmp/filter';
import {HoistModel, type PlainObject} from '@xh/hoist/core';
import type {FieldType} from '@xh/hoist/data';
import {action, observableRef, runInAction} from '@xh/hoist/mobx';
import {isEmpty, isString, pickBy, sortBy, uniq} from 'lodash';
import {isSettableFromOutside, toEditorSpec} from '../../../../../blueprint';
import {getOwn} from '../../../../../blueprint/impl/pointer';
import type {
    ActionSpec,
    BlueprintDesignModel,
    BlueprintEditResult,
    BlueprintIssue,
    EditorNode
} from '../../../../../blueprint';
import {fieldHasRole, starterValue} from '../../../../../blueprint/design/starterConfig';
import type {Option} from './ConfigEditors';

/**
 * What the config editors edit and ask of the blueprint: an object's values, each property's
 * commit and issues, and the choices its editors offer. An element's config, or a variable's
 * declaration, extends it.
 */
export abstract class ConfigEditorModel extends HoistModel {
    /** True when hosted in `blueprintInspector`, which draws the header. */
    framed = false;

    /** The refused property and its issues, until the next commit. */
    @observableRef accessor refusal: {key: string; issues: BlueprintIssue[]} = null;
    /** A counter per property, bumped on refusal, so its editors start again from the values. */
    @observableRef accessor resets: Record<string, number> = {};

    /** The item of each list whose settings are open, by the list's key. One at a time. */
    @observableRef accessor openItems: Record<string, number> = {};
    /** The stored blueprints an `x-blueprint` param may name, once loaded. Null until then. */
    @observableRef accessor blueprintOptions: Option[] = null;
    private loadingBlueprints = false;

    isItemOpen(key: string, index: number): boolean {
        return this.openItems[key] === index;
    }

    @action
    toggleItem(key: string, index: number) {
        this.openItems = {...this.openItems, [key]: this.isItemOpen(key, index) ? null : index};
    }

    constructor(readonly designModel: BlueprintDesignModel) {
        super();
    }

    /** The object edited, as it shows. */
    abstract get values(): PlainObject;

    /** The source whose fields the editors offer, or null. */
    abstract get sourceName(): string;

    /** Where a property sits in the blueprint, for the issues at it. */
    protected abstract pathOf(key: string): string;

    /** Set a property, or remove it with `undefined`, as one edit. */
    protected abstract write(key: string, value: unknown): BlueprintEditResult;

    get readOnly(): boolean {
        const {mode, access} = this.designModel.blueprintModel;
        return mode !== 'design' || access !== 'write';
    }

    @action
    commit(key: string, value: unknown) {
        const errors = this.write(key, value).issues.filter(it => it.severity === 'error');
        if (errors.length) {
            this.refuseWith(key, errors);
        } else {
            this.refusal = null;
        }
    }

    /** Refuse a value before it reaches the blueprint, such as JSON that does not parse. */
    @action
    refuse(key: string, message: string) {
        this.refuseWith(key, [{code: 'edit.invalid', severity: 'error', path: '', message}]);
    }

    /** The issues to show at a property: its refusal, and the blueprint's at its path. */
    issuesFor(key: string): BlueprintIssue[] {
        const {refusal} = this,
            prefix = this.pathOf(key),
            standing = this.designModel.blueprintModel.issues.filter(
                it => it.path === prefix || it.path.startsWith(`${prefix}/`)
            );
        return refusal?.key === key ? [...refusal.issues, ...standing] : standing;
    }

    /** A value a new item can start with, from fields of the source the values do not use. */
    newValue(schema: PlainObject): unknown {
        const {blueprint, catalog} = this.designModel.blueprintModel,
            {values, sourceName: source} = this,
            fields = this.source?.fields ?? {},
            used = new Set<string>();
        walkStrings(values, it => Object.hasOwn(fields, it) && used.add(it));
        return starterValue(schema, {blueprint, catalog, source, used: [...used]});
    }

    /** The value a property takes when unbound: none if optional, else one to start from. */
    unboundValue(node: EditorNode): unknown {
        return node.required ? this.newValue(node.schema) : undefined;
    }

    /**
     * A badge for a property that presets control, naming the group and the active preset, which
     * an edit of it changes. Null for any other property.
     */
    /** Called with a preset group's name when a badge opens it, for the host to show the group. */
    onShowPresetGroup: (name: string) => void = null;

    get canShowPresetGroups(): boolean {
        return !!this.onShowPresetGroup;
    }

    /** Select the preset group that controls a property, and ask the host to show it. */
    showPresetGroupFor(key: string) {
        const group = this.designModel.blueprintModel.getPresetControl(this.pathOf(key))?.group;
        if (!group || !this.onShowPresetGroup) return;
        this.designModel.select({kind: 'preset', id: group});
        this.onShowPresetGroup(group);
    }

    badgeFor(key: string): string {
        const {blueprintModel} = this.designModel,
            control = blueprintModel.getPresetControl(this.pathOf(key));
        if (!control) return null;
        const group = blueprintModel.blueprint.presets[control.group],
            item = group.items?.[control.item];
        return `Preset: ${group.label ?? control.group} › ${item?.label ?? control.item}`;
    }

    /** Load the blueprints of the host's repository, for an `x-blueprint` param. */
    async loadBlueprintOptionsAsync() {
        // An editor asks as it draws, so a draw before the list arrives asks again.
        if (this.loadingBlueprints) return;
        this.loadingBlueprints = true;
        const repository = this.designModel.blueprintModel.drillInRepository,
            list = repository ? await repository.listAsync() : [];
        runInAction(() => {
            this.blueprintOptions = list.map(it => ({value: it.id, label: it.name}));
        });
    }

    /** The variables an action may set, for an `x-variable` param. */
    get settableVariables(): Option[] {
        return Object.entries(this.designModel.blueprintModel.blueprint?.variables ?? {})
            .filter(([, decl]) => isSettableFromOutside(decl))
            .map(([name]) => ({value: name, label: name}));
    }

    /** The blueprint's sources, for an `x-source` property. */
    get sourceOptions(): Option[] {
        const sources = this.designModel.blueprintModel.blueprint?.sources ?? {};
        return Object.keys(sources).map(it => ({value: it, label: it}));
    }

    /** The fields of the source that can fill a role, with their labels. */
    fieldOptions(role: string): Option[] {
        const {source} = this;
        if (!source) return [];
        return Object.values(source.fields)
            .filter(it => fieldHasRole(it, role))
            .map(it => ({value: it.name, label: source.fieldLabel(it.name)}));
    }

    /** A field's label, through the source. */
    fieldLabel(name: string): string {
        return this.source?.fieldLabel(name) ?? name;
    }

    /** The variables a property can bind, by the type its schema takes. */
    variablesFor(node: EditorNode): string[] {
        const {blueprint, registry} = this.designModel.blueprintModel,
            want = variableTypeOf(node.schema),
            fits = (type: string) =>
                type === want ||
                registry.variableTypes[type]?.matches === want ||
                (want === 'number' && type === 'int');
        return Object.entries(blueprint?.variables ?? {})
            .filter(([, it]) => !want || fits(it.type))
            .map(([name]) => name);
    }

    /**
     * The fields a filter chooser offers, from the source. A dimension also offers its values, a
     * snapshot of the source's rows, at most 1,000.
     */
    filterFieldSpecs(): FilterChooserFieldSpecConfig[] {
        const {source} = this;
        if (!source) return [];
        const records = source.cube.store.allRecords;
        return Object.values(source.fields).map(it => ({
            field: it.name,
            displayName: source.fieldLabel(it.name),
            fieldType: (FILTER_FIELD_TYPES.includes(it.type) ? it.type : 'auto') as FieldType,
            ...(it.isDimension
                ? {
                      values: sortBy(
                          uniq(records.map(r => r.data[it.name]).filter(v => v != null))
                      ).slice(0, MAX_FILTER_VALUES)
                  }
                : {})
        }));
    }

    /**
     * The named formats a format can use: the catalogs', then the blueprint's own. A name the
     * blueprint redefines, or adds, says so.
     */
    get formatOptions(): Option[] {
        const {blueprint, catalogs} = this.designModel.blueprintModel,
            own = blueprint?.formats ?? {},
            shared = new Set(catalogs.flatMap(it => Object.keys(it.formats ?? {})));
        return uniq([...shared, ...Object.keys(own)]).map(name => ({
            value: name,
            label: !Object.hasOwn(own, name)
                ? name
                : shared.has(name)
                  ? `${name} (redefined here)`
                  : `${name} (this blueprint)`
        }));
    }

    /** The registry's renderers. */
    get rendererOptions(): Option[] {
        return visibleOptions(this.designModel.blueprintModel.registry.renderers);
    }

    /** A renderer's options schema, or null. */
    rendererConfig(name: string): PlainObject {
        return this.designModel.blueprintModel.registry.renderers[name]?.config ?? null;
    }

    /** The registry's action types that a dashboard may use. */
    get actionOptions(): Option[] {
        const {actions} = this.designModel.blueprintModel.registry;
        return visibleOptions(
            pickBy(actions, it => !it.allowedIn || it.allowedIn.includes('dashboards'))
        );
    }

    actionSpec(type: string): ActionSpec {
        return this.designModel.blueprintModel.registry.actions[type] ?? null;
    }

    /** The type a new step starts as: the first a dashboard may use that needs no parameters. */
    get defaultActionType(): string {
        const options = this.actionOptions;
        return (
            options.find(it => isEmpty(this.actionSpec(it.value)?.params?.required))?.value ??
            options[0]?.value ??
            null
        );
    }

    /** The editor of a literal value of a variable: its type, or one of its options. Null if none. */
    valueNodeFor(name: string): EditorNode {
        const decl = getOwn(this.designModel.blueprintModel.blueprint?.variables, name);
        if (!decl) return null;
        const options = (decl.options as PlainObject)?.values as unknown[],
            schema = this.valueSchema(decl.type, options);
        return toEditorSpec({type: 'object', properties: {value: schema}})[0];
    }

    /**
     * A step of an action type to start from: each required parameter bound to a variable that
     * fits it, the one of the same name first, and no others. A parameter that names a variable
     * takes the first the action may set. A parameter no variable fits stays unset, for the
     * validator to name.
     */
    stepStart(type: string): PlainObject {
        const params: PlainObject = this.actionSpec(type)?.params ?? {},
            props: PlainObject = params.properties ?? {},
            ret: PlainObject = {type};
        for (const key of (params.required as string[]) ?? []) {
            if (props[key]?.['x-variable']) {
                const first = this.settableVariables[0]?.value;
                if (first) ret[key] = first;
                continue;
            }
            const fitting = this.variablesFor({schema: props[key] ?? {}} as EditorNode),
                variable = fitting.includes(key) ? key : fitting[0];
            if (variable) ret[key] = {$var: variable};
        }
        return ret;
    }

    /** True if an action type always asks the user to confirm, as one that changes data does. */
    confirmLocked(type: string): boolean {
        return !!this.actionSpec(type)?.sideEffects;
    }

    /** The schema of a literal value of a variable or parameter type, one of `options` if given. */
    valueSchema(type: string, options?: unknown[]): PlainObject {
        if (type?.endsWith('[]'))
            return {type: 'array', items: this.valueSchema(type.slice(0, -2), options)};
        if (options?.length) return {enum: options};
        const base = this.designModel.blueprintModel.registry.variableTypes[type]?.matches ?? type;
        switch (base) {
            case 'number':
                return {type: 'number'};
            case 'int':
                return {type: 'integer'};
            case 'bool':
                return {type: 'boolean'};
            case 'localDate':
                return {type: 'string', format: 'date'};
            case 'filter':
                return {};
            case 'dateRange':
                return {
                    type: 'string',
                    enum: Object.keys(this.designModel.blueprintModel.registry.dateRangePresets)
                };
            case 'period':
                return {type: 'string', pattern: PERIOD_PATTERN};
            default:
                return {type: 'string'};
        }
    }

    /** A step's description, as its tooltip and any confirmation show it, or null. */
    describeStep(step: PlainObject): string {
        try {
            return this.designModel.blueprintModel.describeAction(step);
        } catch {
            return null;
        }
    }

    @action
    protected refuseWith(key: string, issues: BlueprintIssue[]) {
        this.refusal = {key, issues};
        this.resets = {...this.resets, [key]: (this.resets[key] ?? 0) + 1};
    }

    private get source() {
        const {sourceName} = this;
        return sourceName ? this.designModel.blueprintModel.getSource(sourceName) : null;
    }
}

//------------------
// Implementation
//------------------
const MAX_FILTER_VALUES = 1000,
    FILTER_FIELD_TYPES = ['string', 'number', 'int', 'bool', 'date', 'localDate'];

function walkStrings(value: unknown, fn: (s: string) => void) {
    if (isString(value)) return fn(value);
    if (value != null && typeof value === 'object')
        Object.values(value).forEach(it => walkStrings(it, fn));
}

// The variable type a schema takes: a filter, a plain type, or a list of strings.
function variableTypeOf(schema: PlainObject): string {
    if (schema['x-filter']) return 'filter';
    if (schema.type === 'string' && schema.format === 'date') return 'localDate';
    if (schema.type === 'string' && schema.format === 'date-time') return 'date';
    if (schema.type === 'array') return schema.items?.type === 'string' ? 'string[]' : null;
    return (
        {string: 'string', number: 'number', integer: 'int', boolean: 'bool'}[schema.type] ?? null
    );
}

function visibleOptions(specs: Record<string, {name: string; reserved?: boolean}>): Option[] {
    return Object.values(specs)
        .filter(it => !it.reserved)
        .map(it => ({value: it.name, label: it.name}));
}

// A period, such as 3M or +5D, as `parsePeriod()` reads one.
const PERIOD_PATTERN = '^\\+?[1-9]\\d{0,2}[DWMQY]$';
