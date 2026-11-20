import type {FilterChooserFieldSpecConfig} from '@xh/hoist/cmp/filter';
import {div, filler, hbox, placeholder} from '@xh/hoist/cmp/layout';
import {
    hoistCmp,
    HoistModel,
    type HoistProps,
    type PlainObject,
    useLocalModel,
    uses,
    XH
} from '@xh/hoist/core';
import {button, buttonGroup} from '@xh/hoist/desktop/cmp/button';
import {textInput} from '@xh/hoist/desktop/cmp/input';
import {Icon} from '@xh/hoist/icon';
import type {FieldType} from '@xh/hoist/data';
import {action, observableRef} from '@xh/hoist/mobx';
import {isString, sortBy, uniq} from 'lodash';
import {
    type ActionSpec,
    type BlueprintDesignModel,
    type BlueprintRemoval,
    type BlueprintIssue,
    type EditorNode,
    toEditorSpec
} from '../../../../blueprint';
import {fieldHasRole, starterValue} from '../../../../blueprint/design/starterConfig';
import './ElementInspector.scss';
import {CLS, type Option, propertyRow} from './impl/ConfigEditors';

export interface ElementInspectorProps extends HoistProps {
    designModel: BlueprintDesignModel;
}

/**
 * The selected element's config, with an editor for each property of its widget's schema. Text
 * commits on blur or Enter. Each commit is one edit, and a refused one shows its issues at the
 * property and leaves the blueprint as it was. A path that presets control edits the active
 * preset. Read-only outside design mode, or without write access.
 */
export const [ElementInspector, elementInspector] = hoistCmp.withFactory<ElementInspectorProps>({
    displayName: 'BlueprintElementInspector',
    className: 'xh-blueprint-element-inspector',
    model: false,
    render({designModel, className}) {
        const impl = useLocalModel(() => new ElementInspectorModel(designModel));
        return inspectorBody({model: impl, className});
    }
});

/** @internal */
export class ElementInspectorModel extends HoistModel {
    /** The refused property and its issues, until the next commit. */
    @observableRef accessor refusal: {key: string; issues: BlueprintIssue[]} = null;
    /** A counter per property, bumped on refusal, so its editors start again from the config. */
    @observableRef accessor resets: Record<string, number> = {};

    constructor(readonly designModel: BlueprintDesignModel) {
        super();
    }

    get elementId(): string {
        const id = this.designModel.selectedElementId;
        return id && this.element ? id : null;
    }

    get label(): string {
        return this.widgetSpec?.label ?? this.element?.component;
    }

    /** The element's editors, from its widget's config schema. */
    get nodes(): EditorNode[] {
        return toEditorSpec(this.widgetSpec?.config);
    }

    /** The element's config as it shows, with the active presets applied. */
    get values(): PlainObject {
        return this.element?.config ?? {};
    }

    get readOnly(): boolean {
        const {mode, access} = this.designModel.blueprintModel;
        return mode !== 'design' || access !== 'write';
    }

    @action
    commit(key: string, value: unknown) {
        const {issues} = this.designModel.setConfig(this.elementId, `/${key}`, value),
            errors = issues.filter(it => it.severity === 'error');
        if (errors.length) {
            this.refuseWith(key, errors);
        } else {
            this.refusal = null;
        }
    }

    /**
     * Remove an element, the selected one by default, with everything inside it and what names
     * it, in one edit, once the user confirms what goes.
     */
    async removeAsync(id: string = this.elementId) {
        const {designModel} = this,
            message = removalMessage(id, designModel.describeRemoval(id)),
            ok = await XH.confirm({
                title: 'Remove',
                message,
                confirmProps: {text: 'Remove', intent: 'danger'}
            });
        if (!ok) return;
        const {issues} = designModel.removeElement(id),
            errors = issues.filter(it => it.severity === 'error');
        if (errors.length) this.refuseWith(ELEMENT_KEY, errors);
    }

    /** The tabs of a container whose children take titles, or null for any other element. */
    get tabs(): {id: string; title: string}[] {
        const required: string[] = this.widgetSpec?.children?.schema?.required ?? [];
        if (!required.includes('title')) return null;
        return (this.element?.children ?? []).map(it => ({id: it.id, title: it.title as string}));
    }

    retitle(id: string, title: string) {
        this.designModel.setChildTitle(id, title);
    }

    moveTab(id: string, index: number) {
        this.designModel.moveElement(id, this.elementId, {index});
    }

    /** Add a tab holding a canvas, and keep the container selected. */
    addTab() {
        this.designModel.addWidget('dashCanvas', this.elementId);
    }

    /** Refuse a value before it reaches the blueprint, such as JSON that does not parse. */
    @action
    refuse(key: string, message: string) {
        this.refuseWith(key, [{code: 'edit.invalid', severity: 'error', path: '', message}]);
    }

    /** The issues to show at a property: its refusal, and the blueprint's at its path. */
    issuesFor(key: string): BlueprintIssue[] {
        const {refusal, elementId} = this,
            prefix = `/elements/${elementId}/config/${key}`,
            standing = this.designModel.blueprintModel.issues.filter(
                it => it.path === prefix || it.path.startsWith(`${prefix}/`)
            );
        return refusal?.key === key ? [...refusal.issues, ...standing] : standing;
    }

    /** A value a new item can start with, from fields of the element's source it does not use. */
    newValue(schema: PlainObject): unknown {
        const {blueprint, catalog} = this.designModel.blueprintModel,
            {values} = this,
            fields = this.designModel.blueprintModel.getSource(values.source)?.fields ?? {},
            used = new Set<string>();
        walkStrings(values, it => Object.hasOwn(fields, it) && used.add(it));
        return starterValue(schema, {blueprint, catalog, source: values.source, used: [...used]});
    }

    /** The blueprint's sources, for an `x-source` property. */
    get sourceOptions(): Option[] {
        const sources = this.designModel.blueprintModel.blueprint?.sources ?? {};
        return Object.keys(sources).map(it => ({value: it, label: it}));
    }

    /** The fields of the element's source that can fill a role, with their labels. */
    fieldOptions(role: string): Option[] {
        const source = this.designModel.blueprintModel.getSource(this.values.source);
        if (!source) return [];
        return Object.values(source.fields)
            .filter(it => fieldHasRole(it, role))
            .map(it => ({value: it.name, label: source.fieldLabel(it.name)}));
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

    /** A field's label, through the element's source. */
    fieldLabel(name: string): string {
        return (
            this.designModel.blueprintModel.getSource(this.values.source)?.fieldLabel(name) ?? name
        );
    }

    /**
     * The fields a filter chooser offers, from the element's source. A dimension also offers its
     * values, a snapshot of the source's rows, at most 1,000.
     */
    filterFieldSpecs(): FilterChooserFieldSpecConfig[] {
        const source = this.designModel.blueprintModel.getSource(this.values.source);
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

    /** The registry's action types. */
    get actionOptions(): Option[] {
        return visibleOptions(this.designModel.blueprintModel.registry.actions);
    }

    actionSpec(type: string): ActionSpec {
        return this.designModel.blueprintModel.registry.actions[type] ?? null;
    }

    /** True if an action type always asks the user to confirm, as one that changes data does. */
    confirmLocked(type: string): boolean {
        return !!this.actionSpec(type)?.sideEffects;
    }

    /** A step's description, as its tooltip and any confirmation show it, or null. */
    describeStep(step: PlainObject): string {
        try {
            return this.designModel.blueprintModel.describeAction(step);
        } catch {
            return null;
        }
    }

    /** The value a property takes when unbound: none if optional, else one to start from. */
    unboundValue(node: EditorNode): unknown {
        return node.required ? this.newValue(node.schema) : undefined;
    }

    private get element() {
        const {effective} = this.designModel.blueprintModel,
            id = this.designModel.selectedElementId;
        return id && Object.hasOwn(effective?.elements ?? {}, id) ? effective.elements[id] : null;
    }

    private get widgetSpec() {
        const component = this.element?.component;
        return component ? this.designModel.blueprintModel.registry.widgets[component] : null;
    }

    private refuseWith(key: string, issues: BlueprintIssue[]) {
        this.refusal = {key, issues};
        this.resets = {...this.resets, [key]: (this.resets[key] ?? 0) + 1};
    }
}

//------------------
// Implementation
//------------------
// The key a refusal of the element itself, such as its removal, goes under.
const ELEMENT_KEY = '',
    MAX_FILTER_VALUES = 1000,
    FILTER_FIELD_TYPES = ['string', 'number', 'int', 'bool', 'date', 'localDate'];

// Publishes the inspector's model, as Hoist inputs look one up even when controlled.
const inspectorBody = hoistCmp.factory<ElementInspectorModel>({
    model: uses(ElementInspectorModel),
    render({model: impl, className}) {
        if (!impl.elementId) return placeholder('Select an element to edit its config.');
        return div({
            className,
            items: [
                hbox({
                    className: `${CLS}__header`,
                    items: [
                        impl.elementId,
                        div({className: `${CLS}__widget`, item: impl.label}),
                        filler(),
                        button({
                            icon: Icon.delete(),
                            title: `Remove ${impl.elementId}`,
                            minimal: true,
                            disabled: impl.readOnly,
                            onClick: () => impl.removeAsync()
                        })
                    ]
                }),
                ...impl
                    .issuesFor(ELEMENT_KEY)
                    .map((it, idx) =>
                        div({key: idx, className: `${CLS}__issue`, item: it.message})
                    ),
                impl.tabs ? tabsEditor(impl) : null,
                ...impl.nodes.map(node =>
                    propertyRow({
                        node,
                        value: impl.values[node.key],
                        commit: v => impl.commit(node.key, v),
                        ctx: {impl, key: node.key},
                        issues: impl.issuesFor(node.key),
                        key: `${node.key}:${impl.resets[node.key] ?? 0}`
                    })
                )
            ]
        });
    }
});

// A container's tabs: each title, its order, a way to select or remove it, and a way to add one.
function tabsEditor(impl: ElementInspectorModel) {
    const {tabs, readOnly: disabled} = impl;
    return div({
        className: `${CLS}__row`,
        items: [
            div({className: `${CLS}__label`, item: 'Tabs'}),
            div({
                className: `${CLS}__list`,
                items: [
                    ...tabs.map((tab, i) =>
                        hbox({
                            key: `${tab.id}:${tab.title}`,
                            className: `${CLS}__tab`,
                            items: [
                                textInput({
                                    value: tab.title,
                                    disabled,
                                    flex: 1,
                                    onCommit: (title: string) =>
                                        title && title !== tab.title && impl.retitle(tab.id, title)
                                }),
                                buttonGroup({
                                    items: [
                                        button({
                                            icon: Icon.arrowUp(),
                                            title: 'Move up',
                                            disabled: disabled || i === 0,
                                            onClick: () => impl.moveTab(tab.id, i - 1)
                                        }),
                                        button({
                                            icon: Icon.arrowDown(),
                                            title: 'Move down',
                                            disabled: disabled || i === tabs.length - 1,
                                            onClick: () => impl.moveTab(tab.id, i + 1)
                                        }),
                                        button({
                                            icon: Icon.edit(),
                                            title: `Select ${tab.id}`,
                                            onClick: () =>
                                                impl.designModel.select({
                                                    kind: 'element',
                                                    id: tab.id
                                                })
                                        }),
                                        button({
                                            icon: Icon.delete(),
                                            title: `Remove ${tab.id}`,
                                            disabled,
                                            onClick: () => impl.removeAsync(tab.id)
                                        })
                                    ]
                                })
                            ]
                        })
                    ),
                    button({
                        icon: Icon.add(),
                        text: 'Add a tab',
                        minimal: true,
                        disabled,
                        onClick: () => impl.addTab()
                    })
                ]
            })
        ]
    });
}

// What removing an element takes with it, for the user to confirm.
function removalMessage(id: string, removal: BlueprintRemoval): string {
    const inside = removal.elements.length - 1,
        list = (names: string[]) =>
            names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0],
        sentences = [
            inside
                ? `Remove ${id}, and the ${inside} element${inside > 1 ? 's' : ''} in it?`
                : `Remove ${id}?`
        ];
    const {removedVariables: gone, unboundVariables: unbound, presetPaths} = removal;
    if (gone.length)
        sentences.push(
            `Variable${gone.length > 1 ? 's' : ''} ${list(gone)} ${gone.length > 1 ? 'go' : 'goes'} too.`
        );
    if (unbound.length) {
        sentences.push(
            `${list(unbound)} ${unbound.length > 1 ? 'lose a writer' : 'loses a writer'}, and keep${unbound.length > 1 ? '' : 's'} its other writers or its default.`
        );
    }
    if (presetPaths.length) {
        sentences.push(
            `Presets stop setting ${presetPaths.length} path${presetPaths.length > 1 ? 's' : ''} in it.`
        );
    }
    return sentences.join(' ');
}

function walkStrings(value: unknown, fn: (s: string) => void) {
    if (isString(value)) return fn(value);
    if (value != null && typeof value === 'object')
        Object.values(value).forEach(it => walkStrings(it, fn));
}

// The variable type a schema takes: a filter, a plain type, or a list of strings.
function variableTypeOf(schema: PlainObject): string {
    if (schema['x-filter']) return 'filter';
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
