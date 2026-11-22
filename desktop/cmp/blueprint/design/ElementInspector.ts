import {div, filler, hbox, placeholder} from '@xh/hoist/cmp/layout';
import {hoistCmp, type HoistProps, type PlainObject, useLocalModel, uses} from '@xh/hoist/core';
import {button, buttonGroup} from '@xh/hoist/desktop/cmp/button';
import {select, textInput} from '@xh/hoist/desktop/cmp/input';
import {Icon} from '@xh/hoist/icon';
import {action, observableRef} from '@xh/hoist/mobx';
import classNames from 'classnames';
import {isEqual} from 'lodash';
import type {ReactNode} from 'react';
import {type BlueprintDesignModel, type EditorNode, toEditorSpec} from '../../../../blueprint';
import {locate, parentOf} from '../../../../blueprint/impl/elements';
import './ElementInspector.scss';
import {ConfigEditorModel} from './impl/ConfigEditorModel';
import {CLS, propertyRow} from './impl/ConfigEditors';
import {removeElementAsync} from './impl/designActions';

export interface ElementInspectorProps extends HoistProps {
    designModel: BlueprintDesignModel;
    /**
     * Called with a preset group's name when the user opens it from a property's badge, after the
     * group is selected. A host shows its presets editor. Without it, badges only label.
     */
    onShowPresetGroup?: (name: string) => void;
    /** True inside `blueprintInspector`, which draws the header in place of the editor's own. */
    framed?: boolean;
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
    render({designModel, onShowPresetGroup, framed, className}) {
        const impl = useLocalModel(() => new ElementInspectorModel(designModel));
        impl.onShowPresetGroup = onShowPresetGroup ?? null;
        impl.framed = !!framed;
        return inspectorBody({model: impl, className});
    }
});

/** @internal */
export class ElementInspectorModel extends ConfigEditorModel {
    get elementId(): string {
        const id = this.designModel.selectedElementId;
        return id && this.element ? id : null;
    }

    get label(): string {
        return this.widgetSpec?.label ?? this.element?.component;
    }

    /** Sections toggled from how they start, by label. */
    @observableRef accessor toggled: Record<string, boolean> = {};

    /**
     * The element's editors in sections: the keys no section of its widget lists, untitled, then
     * each section in order, folded or not.
     */
    get sections(): {label: string; nodes: EditorNode[]; collapsed: boolean}[] {
        const {nodes} = this,
            sections = this.widgetSpec?.sections ?? [],
            listed = new Set(sections.flatMap(it => it.keys)),
            ret = [
                {
                    label: null as string,
                    nodes: nodes.filter(it => !listed.has(it.key)),
                    collapsed: false
                }
            ];
        sections.forEach(({label, keys, collapsed = false}) => {
            const inSection = nodes.filter(it => keys.includes(it.key));
            if (!inSection.length) return;
            ret.push({label, nodes: inSection, collapsed: collapsed !== !!this.toggled[label]});
        });
        return ret.filter(it => it.nodes.length);
    }

    @action
    toggleSection(label: string) {
        this.toggled = {...this.toggled, [label]: !this.toggled[label]};
    }

    /** The element's editors, from its widget's config schema. */
    get nodes(): EditorNode[] {
        return toEditorSpec(this.widgetSpec?.config);
    }

    /** The element's config as it shows, with the active presets applied. */
    get values(): PlainObject {
        return this.element?.config ?? {};
    }

    get sourceName(): string {
        return this.values.source ?? null;
    }

    /**
     * Remove an element, the selected one by default, with everything inside it and what names
     * it, in one edit. See `removeElementAsync`.
     */
    async removeAsync(id: string = this.elementId) {
        const errors = await removeElementAsync(this.designModel, id);
        if (errors.length) this.refuseWith(ELEMENT_KEY, errors);
    }

    /** The variable an input element shows and sets, or null. */
    get setsVariable(): string {
        const writer = {element: this.elementId};
        return (
            Object.entries(this.designModel.blueprintModel.blueprint?.variables ?? {}).find(
                ([, v]) => isEqual(v.setBy, writer)
            )?.[0] ?? null
        );
    }

    /** The variables an input element can set, and a new one. Null for any other element. */
    get setsOptions(): {value: string; label: string}[] {
        if (!this.widgetSpec?.value) return null;
        return [
            ...this.designModel
                .inputVariableOptions(this.elementId)
                .map(it => ({value: it, label: it})),
            {value: NEW_VARIABLE, label: 'New variable'}
        ];
    }

    /** Make the element set a variable, or a new one named for it. */
    setSets(name: string) {
        const variables = this.designModel.blueprintModel.blueprint?.variables ?? {},
            {elementId} = this,
            target =
                name === NEW_VARIABLE
                    ? Object.hasOwn(variables, elementId)
                        ? `${elementId}Value`
                        : elementId
                    : name,
            {issues} = this.designModel.setInputVariable(elementId, target),
            errors = issues.filter(it => it.severity === 'error');
        if (errors.length) this.refuseWith(SETS_KEY, errors);
    }

    /**
     * Editors for where the element sits in its container, from the container's child schema.
     * None in a slot other than `children`, which holds no placement.
     */
    get placementNodes(): EditorNode[] {
        const schema = this.parentSpec?.children?.schema;
        if (!schema || this.slot !== 'children') return [];
        return toEditorSpec(schema).filter(
            it => it.key !== 'id' && !this.parentSpec.children.slots?.[it.key]
        );
    }

    /** The slot that holds the element, as `slot` or `slot:of` for a child reference's slot. */
    get slot(): string {
        const at = locate(this.designModel.blueprintModel.blueprint?.elements, this.elementId);
        return at ? slotValue(at.slot, at.of) : null;
    }

    /** The slots of the element's container that take it, as {@link slot} names them. */
    get slotOptions(): {value: string; label: string}[] {
        return this.designModel.slotsFor(this.elementId).map(({slot, of}) => ({
            value: slotValue(slot, of),
            label: of ? `${of} ${slot}` : slot
        }));
    }

    /** Move the element to another slot of its container, as {@link slot} names it. */
    moveToSlot(value: string) {
        const [slot, of] = value.split(':'),
            {issues} = this.designModel.moveToSlot(this.elementId, slot, of),
            errors = issues.filter(it => it.severity === 'error');
        if (errors.length) this.refuseWith(placementKey('slot'), errors);
    }

    /** The element's child reference in its container, without its ID. */
    get placementValues(): PlainObject {
        const {elements} = this.designModel.blueprintModel.blueprint ?? {},
            ref = elements?.[this.parentId]?.children?.find(it => it.id === this.elementId);
        if (!ref) return {};
        const {id: _id, ...ret} = ref;
        return ret;
    }

    /** Rename the element, everything that names it following, as one edit. */
    rename(to: string) {
        if (!to || to === this.elementId) return;
        const {issues} = this.designModel.renameId('element', this.elementId, to),
            errors = issues.filter(it => it.severity === 'error');
        if (errors.length) this.refuseWith(ID_KEY, errors);
    }

    commitPlacement(key: string, value: unknown) {
        const {issues} = this.designModel.setChildPlacement(this.elementId, {[key]: value}),
            errors = issues.filter(it => it.severity === 'error');
        if (errors.length) this.refuseWith(placementKey(key), errors);
    }

    get parentId(): string {
        return parentOf(this.designModel.blueprintModel.blueprint?.elements, this.elementId);
    }

    private get parentSpec() {
        const component =
            this.designModel.blueprintModel.blueprint?.elements?.[this.parentId]?.component;
        return component ? this.designModel.blueprintModel.registry.widgets[component] : null;
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

    protected pathOf(key: string): string {
        return `/elements/${this.elementId}/config/${key}`;
    }

    protected write(key: string, value: unknown) {
        return this.designModel.setConfig(this.elementId, `/${key}`, value);
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
}

//------------------
// Implementation
//------------------
// The key a refusal of the element itself, such as its removal, goes under.
const ELEMENT_KEY = '';

// A slot as the inspector's slot picker names it.
const slotValue = (slot: string, of?: string) => (of ? `${slot}:${of}` : slot);

// The key a placement property's refusals go under, apart from the config's own.
const placementKey = (key: string) => `$placement.${key}`;

// The key a rename's refusals go under.
const ID_KEY = '$id';

// The key the Sets row's refusals go under.
const SETS_KEY = '$sets';

/** The Sets option that makes a new variable for the input. */
export const NEW_VARIABLE = '$new';

// Publishes the inspector's model, as Hoist inputs look one up even when controlled.
const inspectorBody = hoistCmp.factory<ElementInspectorModel>({
    model: uses(ElementInspectorModel),
    render({model: impl, className}) {
        if (!impl.elementId) return placeholder('Select an element to edit its config.');
        return div({
            className,
            children: [
                impl.framed
                    ? null
                    : hbox({
                          className: `${CLS}__header`,
                          children: [
                              textInput({
                                  key: `${impl.elementId}:${impl.resets[ID_KEY] ?? 0}`,
                                  className: `${CLS}__id`,
                                  value: impl.elementId,
                                  disabled: impl.readOnly,
                                  width: 160,
                                  onCommit: (to: string) => impl.rename(to)
                              }),
                              div({className: `${CLS}__widget`, children: impl.label}),
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
                ...[...impl.issuesFor(ID_KEY), ...impl.issuesFor(ELEMENT_KEY)].map((it, idx) =>
                    div({key: idx, className: `${CLS}__issue`, children: it.message})
                ),
                impl.tabs ? tabsEditor(impl) : null,
                impl.setsOptions ? setsEditor(impl) : null,
                ...(impl.sections.find(it => !it.label)?.nodes ?? []).map(node =>
                    configRow(impl, node)
                ),
                ...impl.sections
                    .filter(it => it.label)
                    .map(section =>
                        sectionCard({
                            key: `section:${section.label}`,
                            title: `${section.label} (${section.nodes.length})`,
                            collapsed: section.collapsed,
                            onToggle: () => impl.toggleSection(section.label),
                            children: section.nodes.map(node => configRow(impl, node))
                        })
                    ),
                impl.placementNodes.length || impl.slotOptions.length > 1
                    ? sectionCard({
                          key: 'placement',
                          title: `Placement in ${impl.parentId}`,
                          children: [
                              impl.slotOptions.length > 1 ? slotEditor(impl) : null,
                              div({
                                  className: `${CLS}__placement-row`,
                                  children: impl.placementNodes.map(node =>
                                      propertyRow({
                                          node,
                                          value: impl.placementValues[node.key],
                                          commit: v => impl.commitPlacement(node.key, v),
                                          ctx: {impl, key: placementKey(node.key)},
                                          issues: impl.issuesFor(placementKey(node.key)),
                                          key: `placement:${node.key}:${impl.resets[placementKey(node.key)] ?? 0}`
                                      })
                                  )
                              })
                          ]
                      })
                    : null
            ]
        });
    }
});

// One config property's row, with its issues and preset badge.
function configRow(impl: ElementInspectorModel, node: EditorNode) {
    return propertyRow({
        node,
        value: impl.values[node.key],
        commit: v => impl.commit(node.key, v),
        ctx: {impl, key: node.key},
        issues: impl.issuesFor(node.key),
        badge: impl.badgeFor(node.key),
        key: `${node.key}:${impl.resets[node.key] ?? 0}`
    });
}

// A titled group of rows, drawn as a card, which folds where it can.
function sectionCard({
    key,
    title,
    collapsed = false,
    onToggle,
    children
}: {
    key: string;
    title: string;
    collapsed?: boolean;
    onToggle?: () => void;
    children: ReactNode[];
}) {
    return div({
        key,
        className: `${CLS}__card`,
        children: [
            div({
                className: classNames(
                    `${CLS}__card-header`,
                    onToggle && `${CLS}__card-header--toggle`
                ),
                onClick: onToggle,
                children: [
                    onToggle ? (collapsed ? Icon.chevronRight() : Icon.chevronDown()) : null,
                    title
                ]
            }),
            collapsed ? null : div({className: `${CLS}__card-body`, children})
        ]
    });
}

// The slot of its container that holds the element.
function slotEditor(impl: ElementInspectorModel) {
    return div({
        className: `${CLS}__row`,
        children: [
            div({className: `${CLS}__label`, children: 'Slot'}),
            select({
                value: impl.slot,
                options: impl.slotOptions,
                disabled: impl.readOnly,
                width: '100%',
                onCommit: (it: string) => it && it !== impl.slot && impl.moveToSlot(it)
            }),
            ...impl
                .issuesFor(placementKey('slot'))
                .map((it, idx) => div({key: idx, className: `${CLS}__issue`, children: it.message}))
        ]
    });
}

// The variable an input shows and sets.
function setsEditor(impl: ElementInspectorModel) {
    return div({
        className: `${CLS}__row`,
        children: [
            div({className: `${CLS}__label`, children: 'Sets'}),
            select({
                value: impl.setsVariable,
                options: impl.setsOptions,
                placeholder: 'Pick a variable…',
                disabled: impl.readOnly,
                width: '100%',
                onCommit: (it: string) => it && it !== impl.setsVariable && impl.setSets(it)
            }),
            ...impl
                .issuesFor(SETS_KEY)
                .map((it, idx) => div({key: idx, className: `${CLS}__issue`, children: it.message}))
        ]
    });
}

// A container's tabs: each title, its order, a way to select or remove it, and a way to add one.
function tabsEditor(impl: ElementInspectorModel) {
    const {tabs, readOnly: disabled} = impl;
    return div({
        className: `${CLS}__row`,
        children: [
            div({className: `${CLS}__label`, children: 'Tabs'}),
            div({
                className: `${CLS}__list`,
                children: [
                    ...tabs.map((tab, i) =>
                        hbox({
                            key: `${tab.id}:${tab.title}`,
                            className: `${CLS}__tab`,
                            children: [
                                textInput({
                                    value: tab.title,
                                    disabled,
                                    flex: 1,
                                    onCommit: (title: string) =>
                                        title && title !== tab.title && impl.retitle(tab.id, title)
                                }),
                                buttonGroup({
                                    children: [
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
