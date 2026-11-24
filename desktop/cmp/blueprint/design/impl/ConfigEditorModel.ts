import type {FilterChooserFieldSpecConfig} from '@xh/hoist/cmp/filter';
import {HoistModel, type PlainObject} from '@xh/hoist/core';
import type {FieldType} from '@xh/hoist/data';
import {action, compareStructural, computed, observableRef, runInAction} from '@xh/hoist/mobx';
import {isEmpty, isEqual, isString, omit, pickBy, sortBy, uniq} from 'lodash';
import {isSettableFromOutside, toEditorSpec} from '../../../../../blueprint';
import {getOwn} from '../../../../../blueprint/impl/pointer';
import {LocalDate} from '@xh/hoist/utils/datetime';
import type {
    ActionSpec,
    Blueprint,
    BlueprintDesignModel,
    BlueprintEditResult,
    BlueprintIssue,
    BlueprintRegistry,
    EditorNode
} from '../../../../../blueprint';
import {fieldHasRole, starterValue} from '../../../../../blueprint/design/starterConfig';
import {bindingTypesOf} from '../../../../../blueprint/impl/bindable';
import {
    boundValues,
    fitsProp,
    variableTypeLabel,
    variableTypeMatches
} from '../../../../../blueprint/validateBlueprint';
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
    @observableRef accessor openItems: Record<string, string> = {};
    /** The stored blueprints an `x-blueprint` param may name, once loaded. Null until then. */
    @observableRef accessor blueprintOptions: Option[] = null;
    private loadingBlueprints = false;

    /** The form an unset property with several shows, by its scope, as the user last chose it. */
    @observableRef accessor variants: Record<string, number> = {};

    @action
    chooseVariant(scope: string, index: number) {
        this.variants = {...this.variants, [scope]: index};
    }

    /** True for the open item of a list, by the list's scope and the item's key. */
    isItemOpen(scope: string, itemKey: string): boolean {
        return this.openItems[scope] === itemKey;
    }

    /** Open one item of a list, by the list's scope, or none with null. */
    @action
    setOpenItem(scope: string, itemKey: string) {
        this.openItems = {...this.openItems, [scope]: itemKey};
        // A top-level list's open item is the canvas's to outline.
        if (this.pageElement && !scope.includes('/')) {
            this.designModel.setOpenListItem(
                itemKey ? {element: this.pageElement, list: scope, key: itemKey} : null
            );
        }
    }

    /** The element whose list items can open a page of their own, or null for none. */
    get pageElement(): string {
        return null;
    }

    /** The key of the item whose page is open in a list, by the list's config key, or null. */
    pageKey(list: string): string {
        const page = this.designModel.itemPage;
        return page && page.element === this.pageElement && page.list === list ? page.key : null;
    }

    /** Open an item's page, by its list's config key and its key there. */
    openPage(list: string, key: string, label?: string) {
        this.designModel.openItemPage({element: this.pageElement, list, key, label});
    }

    @action
    toggleItem(scope: string, itemKey: string) {
        this.openItems = {
            ...this.openItems,
            [scope]: this.isItemOpen(scope, itemKey) ? null : itemKey
        };
    }

    /**
     * A key for each item of a list, by its scope, that stays with the item however the list
     * changes, so a row keeps its node, its focus and its open drawer: through a reorder, a removal,
     * an undo, or a refused edit. An item takes the key of an equal item from before, else, in a
     * list that kept its length, the key of its place, as an item edited in place does.
     */
    keysFor(scope: string, values: unknown[]): string[] {
        const prev = this.listKeys.get(scope) ?? {keys: [], values: []},
            used = new Set<number>(),
            matched = values.map(v => {
                const i = prev.values.findIndex((pv, j) => !used.has(j) && isEqual(pv, v));
                if (i < 0) return null;
                used.add(i);
                return prev.keys[i];
            }),
            keys = matched.map(
                (key, i) =>
                    key ??
                    (values.length === prev.values.length && !used.has(i)
                        ? (used.add(i), prev.keys[i])
                        : `k${++this.keySeq}`)
            );
        this.listKeys.set(scope, {keys, values});
        return keys;
    }

    /** A key for an item about to be added at the end of a list, so it can open as it lands. */
    addKey(scope: string, value: unknown): string {
        const prev = this.listKeys.get(scope) ?? {keys: [], values: []},
            key = `k${++this.keySeq}`;
        this.listKeys.set(scope, {keys: [...prev.keys, key], values: [...prev.values, value]});
        return key;
    }

    private readonly listKeys = new Map<string, {keys: string[]; values: unknown[]}>();
    private keySeq = 0;

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

    /**
     * Set one setting of a map's entry, such as a column's header in `columns`, or remove it with
     * `undefined`, as one edit. An entry left empty goes, and so does a map left empty.
     */
    commitItemSetting(mapKey: string, item: string, key: string, value: unknown) {
        const map: PlainObject = this.values[mapKey] ?? {},
            entry: PlainObject = getOwn(map, item) ?? {},
            nextEntry = value === undefined ? omit(entry, key) : {...entry, [key]: value},
            next = isEmpty(nextEntry) ? omit(map, item) : {...map, [item]: nextEntry};
        this.commit(mapKey, isEmpty(next) ? undefined : next);
    }

    /** The issues at one setting of a map's entry, such as a column's format in `columns`. */
    itemSettingIssues(mapKey: string, item: string, key: string): BlueprintIssue[] {
        const segment = item.replace(/~/g, '~0').replace(/\//g, '~1'),
            prefix = `${this.pathOf(mapKey)}/${segment}/${key}`;
        return this.issuesFor(mapKey).filter(
            it => it.path === prefix || it.path.startsWith(`${prefix}/`)
        );
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

    /**
     * A value a new item can start with, from fields of the source the values do not use. `field`
     * is one a filter starts on where it can, such as a column's own.
     */
    newValue(schema: PlainObject, field?: string): unknown {
        const {blueprint, catalog} = this.designModel.blueprintModel,
            {values, sourceName: source} = this,
            fields = this.source?.fields ?? {},
            used = new Set<string>();
        walkStrings(values, it => Object.hasOwn(fields, it) && used.add(it));
        return starterValue(schema, {blueprint, catalog, source, used: [...used], field});
    }

    /** The value a property takes when unbound: none if optional, else one to start from. */
    unboundValue(node: EditorNode): unknown {
        return node.required ? this.newValue(node.schema) : undefined;
    }

    /** True for a property a user may personalize at its own path, which a binding moves to its variable. */
    isPersonalizable(key: string): boolean {
        return false;
    }

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

    /** The preset group that controls a property, with the label of its active preset, or null. */
    presetFor(key: string): {group: string; itemLabel: string} {
        const {blueprintModel} = this.designModel,
            control = blueprintModel.getPresetControl(this.pathOf(key));
        if (!control) return null;
        const item = blueprintModel.blueprint.presets[control.group]?.items?.[control.item];
        return {group: control.group, itemLabel: item?.label ?? control.item};
    }

    /**
     * A badge for a property that presets control, naming the group and the active preset, which
     * an edit of it changes. Null for any other property.
     */
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

    /**
     * The blueprint's variables, sources and preset groups. Each keeps its identity across an
     * edit that leaves it alone, so an editor that reads one does not draw again.
     */
    @computed
    get variables(): Blueprint['variables'] {
        return this.designModel.blueprintModel.blueprint?.variables ?? {};
    }

    @computed
    get sources(): Blueprint['sources'] {
        return this.designModel.blueprintModel.blueprint?.sources ?? {};
    }

    @computed
    get presets(): Blueprint['presets'] {
        return this.designModel.blueprintModel.blueprint?.presets ?? {};
    }

    /** One property's value, which holds its identity across edits to the others. */
    propValue(key: string): unknown {
        return this.memo(`value:${key}`, () => this.values[key]);
    }

    /** The variables an action may set, for an `x-variable` param. */
    get settableVariables(): Option[] {
        return this.memo('settableVariables', () => this.buildSettableVariables());
    }

    private buildSettableVariables(): Option[] {
        return Object.entries(this.variables)
            .filter(([, decl]) => isSettableFromOutside(decl))
            .map(([name]) => ({value: name, label: name}));
    }

    /** The blueprint's sources, for an `x-source` property. */
    get sourceOptions(): Option[] {
        return this.memo('sourceOptions', () =>
            Object.keys(this.sources).map(it => ({value: it, label: it}))
        );
    }

    /** The fields of the source that can fill a role, with their labels. */
    fieldOptions(role: string): Option[] {
        return this.memo(`fieldOptions:${role}`, () => this.buildFieldOptions(role));
    }

    /**
     * The fields that can fill a role and that a field list does not hold yet, for its Add. One
     * computed per list, by its scope, replaced as the fields it holds change.
     */
    addFieldOptions(scope: string, role: string, held: string[]): Option[] {
        const key = `${role}:${held.join('|')}`;
        let entry = this.addOptions.get(scope);
        if (entry?.key !== key) {
            entry = {
                key,
                value: computed(
                    () => this.fieldOptions(role).filter(it => !held.includes(it.value)),
                    {equals: compareStructural}
                )
            };
            this.addOptions.set(scope, entry);
        }
        return entry.value.get();
    }

    private readonly addOptions = new Map<string, {key: string; value: {get(): Option[]}}>();

    private buildFieldOptions(role: string): Option[] {
        const {source} = this;
        if (!source) return [];
        return Object.values(source.fields)
            .filter(it => fieldHasRole(it, role))
            .map(it => ({value: it.name, label: source.fieldLabel(it.name)}));
    }

    /**
     * A field's format, renderer and header from its catalog field and kind, before a widget's own.
     */
    inheritedDisplay(name: string): {format: unknown; renderer: unknown; headerName: string} {
        return this.memo(`inherited:${name}`, () => this.buildInheritedDisplay(name));
    }

    private buildInheritedDisplay(name: string): {
        format: unknown;
        renderer: unknown;
        headerName: string;
    } {
        const field = this.source?.fields[name];
        if (!field) return {format: null, renderer: null, headerName: null};
        const kind = this.designModel.blueprintModel.catalogs
            .map(it => getOwn(it.kinds, field.kind))
            .find(Boolean);
        return {
            format: field.format ?? kind?.format ?? null,
            renderer: field.renderer ?? kind?.renderer ?? null,
            headerName: this.fieldLabel(name)
        };
    }

    /** A field's type, through the source, or null. */
    fieldType(name: string): string {
        return this.memo(`type:${name}`, () => this.source?.fields[name]?.type ?? null);
    }

    /** A field's label, through the source. */
    fieldLabel(name: string): string {
        return this.memo(`label:${name}`, () =>
            // A grid's `group` names its tree column, where the source has no such field.
            name === 'group' && !this.source?.fields[name]
                ? 'Tree column'
                : (this.source?.fieldLabel(name) ?? name)
        );
    }

    /**
     * The variables a property can bind: each whose type its schema takes and whose values fit it.
     * None where its schema says no type a variable holds.
     */
    variablesFor(node: EditorNode): string[] {
        return this.bindChoices(node)
            .filter(it => !it.reason)
            .map(it => it.name);
    }

    /**
     * Every variable, each with why a property cannot bind it, or null where it can: a type its
     * schema does not take, or a value outside its choices or range.
     */
    bindChoices(node: EditorNode): {name: string; reason: string}[] {
        const {registry} = this.designModel.blueprintModel,
            want = bindingTypesOf(node.schema);
        // What the setting takes, in words: one of its choices, or a kind of value.
        const phrase = (type: string) => typePhrase(registry, type),
            takes = node.schema.enum
                ? 'one of its choices'
                : uniq((want ?? []).map(phrase)).join(' or ');
        return Object.entries(this.variables).map(([name, it]) => {
            if (!want) return {name, reason: 'This setting takes no variable.'};
            if (!want.some(type => variableTypeMatches(registry, it.type, type))) {
                return {
                    name,
                    reason: `It holds ${phrase(it.type)}, but this takes ${takes}.`
                };
            }
            const values = boundValues(it);
            // A choice binds only a variable whose values it knows are among its own.
            if (node.schema.enum && !values.length) {
                return {name, reason: 'Its values are open, but this takes one of its choices.'};
            }
            const bad = values.find(v => !fitsProp(v, node.schema));
            return {
                name,
                reason:
                    bad !== undefined
                        ? `It may hold ${JSON.stringify(bad)}, which this does not take.`
                        : null
            };
        });
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
            // Hoist takes a date field only with a parser for what the user types.
            ...(it.type === 'date' ? {valueParser: parseDate} : {}),
            ...(it.isDimension
                ? {
                      values: sortBy(
                          uniq(records.map(r => r.data[it.name]).filter(v => v != null))
                      ).slice(0, MAX_FILTER_VALUES)
                  }
                : {})
        }));
    }

    /** A named format's options, from the blueprint's own formats or else a catalog's, or null. */
    formatDefinition(name: string): PlainObject {
        return this.memo(`format:${name}`, () => this.buildFormatDefinition(name));
    }

    private buildFormatDefinition(name: string): PlainObject {
        if (!name) return null;
        const {blueprint, catalogs} = this.designModel.blueprintModel;
        return (
            getOwn(blueprint?.formats, name) ??
            catalogs.map(it => getOwn(it.formats, name)).find(Boolean) ??
            null
        );
    }

    /**
     * The named formats a format can use: the catalogs', then the blueprint's own. A name the
     * blueprint redefines, or adds, says so.
     */
    get formatOptions(): Option[] {
        return this.memo('formatOptions', () => this.buildFormatOptions());
    }

    private buildFormatOptions(): Option[] {
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
        return this.memo('rendererOptions', () =>
            visibleOptions(this.designModel.blueprintModel.registry.renderers)
        );
    }

    /** A renderer's options schema, or null. */
    rendererConfig(name: string): PlainObject {
        return this.designModel.blueprintModel.registry.renderers[name]?.config ?? null;
    }

    /** The registry's action types that a dashboard may use. */
    get actionOptions(): Option[] {
        return this.memo('actionOptions', () => this.buildActionOptions());
    }

    private buildActionOptions(): Option[] {
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
        const decl = getOwn(this.variables, name);
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

    // A value through a computed per key, so an editor that reads it draws again only as the value
    // itself changes, not on every edit the blueprint takes.
    private memo<T>(key: string, fn: () => T): T {
        let ret = this.memos.get(key);
        if (!ret) {
            ret = computed(fn, {equals: compareStructural});
            this.memos.set(key, ret);
        }
        return ret.get() as T;
    }

    private readonly memos = new Map<string, {get(): unknown}>();

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

// A typed day, such as 2026-11-20, as a Date at its local midnight, or null if it reads as none.
function parseDate(input: string): Date {
    try {
        return LocalDate.get(input?.trim()).date;
    } catch {
        return null;
    }
}

function walkStrings(value: unknown, fn: (s: string) => void) {
    if (isString(value)) return fn(value);
    if (value != null && typeof value === 'object')
        Object.values(value).forEach(it => walkStrings(it, fn));
}

// A variable type as a reason names it: "text", "a date", "on or off", or an app type's label.
function typePhrase(registry: Pick<BlueprintRegistry, 'variableTypes'>, type: string): string {
    const builtIn = TYPE_PHRASES[type];
    if (builtIn) return builtIn;
    if (type?.endsWith('[]')) {
        return `a list of ${typePhrase(registry, type.slice(0, -2)).replace(/^an? /, '')}`;
    }
    const label = variableTypeLabel(registry, type).toLowerCase();
    return `${/^[aeiou]/.test(label) ? 'an' : 'a'} ${label}`;
}

const TYPE_PHRASES: Record<string, string> = {
    string: 'text',
    number: 'a number',
    int: 'a whole number',
    bool: 'on or off',
    date: 'a date and time',
    localDate: 'a date',
    filter: 'a filter',
    dateRange: 'a date range',
    period: 'a period'
};

function visibleOptions(specs: Record<string, {name: string; reserved?: boolean}>): Option[] {
    return Object.values(specs)
        .filter(it => !it.reserved)
        .map(it => ({value: it.name, label: it.name}));
}

// A period, such as 3M or +5D, as `parsePeriod()` reads one.
const PERIOD_PATTERN = '^\\+?[1-9]\\d{0,2}[DWMQY]$';
