import {div, hbox, placeholder, span} from '@xh/hoist/cmp/layout';
import {hoistCmp, type HoistProps, type PlainObject, useLocalModel, uses} from '@xh/hoist/core';
import {button} from '@xh/hoist/desktop/cmp/button';
import {select, textInput} from '@xh/hoist/desktop/cmp/input';
import {sortableList} from '@xh/hoist/cmp/sortablelist';
import {Icon} from '@xh/hoist/icon';
import {action, observableRef} from '@xh/hoist/mobx';
import {wait} from '@xh/hoist/promise';
import {castArray, isEqual, isString, without} from 'lodash';
import {useEffect, useRef} from 'react';
import {
    type BlueprintDesignModel,
    type EditorNode,
    labelOf,
    toEditorSpec
} from '../../../../blueprint';
import {locate, parentOf} from '../../../../blueprint/impl/elements';
import './ElementInspector.scss';
import {ConfigEditorModel} from './impl/ConfigEditorModel';
import {booleanEditor, CLS, propertyRow, removeItemButton, sectionCard} from './impl/ConfigEditors';
import {refuse, removeElementAsync} from './impl/designActions';
import {widgetIcon} from './impl/icons';

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
        const id = this.designModel.selectedElementId ?? this.designModel.selectedViewId;
        return id && this.element ? id : null;
    }

    override isPersonalizable(key: string): boolean {
        return !!this.element?.personalizable?.includes(`/config/${key}`);
    }

    /** True while the selection is the canvas view that holds the element, not the element. */
    get isView(): boolean {
        return !!this.designModel.selectedViewId;
    }

    /** The canvas the element sits in a cell of, or null. */
    get canvasId(): string {
        return this.designModel.viewOf(this.elementId)?.of ?? null;
    }

    /** The inputs in the element's canvas cell header. */
    get headerItemIds(): string[] {
        const ref = this.designModel.blueprintModel.blueprint?.elements?.[
            this.canvasId
        ]?.children?.find(it => it.id === this.elementId);
        return ((ref?.headerItems as {id: string}[]) ?? []).map(it => it.id);
    }

    /** Add an input to the element's cell header, from the Add panel. */
    addHeaderItem() {
        const {designModel, canvasId, elementId} = this;
        designModel.selectSlot({parent: canvasId, slot: 'headerItems', of: elementId});
        designModel.requestAdd();
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
    /** What a section's header counts: a lone list's items, else its properties. */
    countOf(nodes: EditorNode[]): number {
        const [only] = nodes;
        return nodes.length === 1 && LIST_KINDS.includes(only.kind)
            ? castArray(this.values[only.key] ?? []).length
            : nodes.length;
    }

    get nodes(): EditorNode[] {
        const ret = toEditorSpec(this.widgetSpec?.config),
            // A field list edits its settings map's entries in its drawer, so the map shows only
            // for an entry of a field the list leaves out.
            folded = ret.filter(it => {
                const list = ret.find(n => n.kind === 'fieldList' && n.settingsIn?.key === it.key);
                if (!list) return false;
                const listed = castArray(this.values[list.key] ?? []).map(n =>
                    isString(n) ? n : n?.field
                );
                return Object.keys(this.values[it.key] ?? {}).every(k => listed.includes(k));
            });
        return without(ret, ...folded);
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
        const {elementId: id, canvasId} = this,
            {issues} = this.designModel.setChildPlacement(
                id,
                {[key]: value},
                `${id}${canvasId ? ' view' : ''}: ${labelOf(key).toLowerCase()}`
            ),
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

    /**
     * The children of a container, in order, or null for an element that holds none. A tab
     * container lists its tabs in its own editor instead.
     */
    get childIds(): string[] {
        if (!this.widgetSpec?.children || this.tabs) return null;
        return (this.element?.children ?? []).map(it => it.id);
    }

    /** True if the container orders its children by place in the list, not by a layout. */
    get ordersChildren(): boolean {
        return !['dashCanvas', 'dashContainer'].includes(this.element?.component);
    }

    /** Move a child within the container, from one place in the list to another, as one edit. */
    moveChild(id: string, fromIndex: number, toIndex: number) {
        // A drop's index counts the list as it stands, the moved child included.
        const {designModel, elementId: container} = this,
            index = toIndex > fromIndex ? toIndex + 1 : toIndex;
        refuseMessage(designModel, designModel.dropAt({element: id}, {container, index}));
        // The container stays selected, as the drop would select the child.
        designModel.select({kind: 'element', id: container});
    }

    /** Open Add for the container, which adds at the end of its children. */
    addChild() {
        const {designModel, elementId} = this;
        designModel.selectSlot({parent: elementId, slot: 'children'});
        designModel.requestAdd();
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
            id = this.designModel.selectedElementId ?? this.designModel.selectedViewId;
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
// Show a drop's refusal, if any, as a toast.
function refuseMessage(designModel: BlueprintDesignModel, message: string) {
    if (message)
        refuse(designModel, [{code: 'edit.refused', severity: 'error', path: '', message}]);
}

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
        const ref = useRef<HTMLDivElement>(null),
            {designModel, elementId} = impl,
            {fieldFocus} = designModel;
        // A widget that needs a field set asks for it, and its editor takes focus.
        useEffect(() => {
            if (!fieldFocus || fieldFocus.id !== elementId) return;
            wait().then(() => {
                ref.current
                    ?.querySelector<HTMLElement>(
                        `[data-config-key="${fieldFocus.key}"] :is(input, button, [tabindex="0"])`
                    )
                    ?.focus();
                designModel.clearFieldFocus();
            });
        }, [designModel, fieldFocus, elementId]);
        if (!impl.elementId) return placeholder('Select an element to edit its config.');
        return div({
            ref,
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
                              div({className: `${CLS}__widget`, children: impl.label})
                          ]
                      }),
                ...[...impl.issuesFor(ID_KEY), ...impl.issuesFor(ELEMENT_KEY)].map((it, idx) =>
                    div({key: idx, className: `${CLS}__issue`, children: it.message})
                ),
                ...(impl.isView ? viewCards(impl) : []),
                !impl.isView && impl.tabs ? tabsEditor(impl) : null,
                !impl.isView && impl.setsOptions ? setsEditor(impl) : null,
                ...(impl.isView ? [] : (impl.sections.find(it => !it.label)?.nodes ?? [])).map(
                    node => configRow(impl, node)
                ),
                ...impl.sections
                    .filter(it => it.label && !impl.isView)
                    .map(section => {
                        const preset = section.nodes
                            .map(it => impl.presetFor(it.key))
                            .find(Boolean);
                        return sectionCard({
                            key: `section:${section.label}`,
                            title: section.label,
                            count: impl.countOf(section.nodes),
                            badge: preset
                                ? {
                                      text: `Preset · ${preset.itemLabel}`,
                                      onClick: () =>
                                          impl.designModel.select({
                                              kind: 'preset',
                                              id: preset.group
                                          })
                                  }
                                : null,
                            collapsed: section.collapsed,
                            onToggle: () => impl.toggleSection(section.label),
                            children: section.nodes.map(node => configRow(impl, node))
                        });
                    }),
                !impl.isView && impl.childIds ? childrenCard(impl) : null,
                // A widget in a canvas cell shows its view's settings folded, with a way there.
                !impl.isView && impl.canvasId
                    ? sectionCard({
                          key: 'canvas-view',
                          title: 'Canvas view',
                          collapsed: !impl.toggled[CANVAS_VIEW],
                          onToggle: () => impl.toggleSection(CANVAS_VIEW),
                          children: [
                              ...viewHeaderRows(impl),
                              div({
                                  className: `${CLS}__placement-row`,
                                  children: placementRows(impl, it => it.kind === 'number')
                              }),
                              button({
                                  className: `${CLS}__select-view`,
                                  icon: Icon.arrowRight(),
                                  text: 'Select the view',
                                  minimal: true,
                                  onClick: () =>
                                      impl.designModel.select({
                                          kind: 'view',
                                          id: impl.elementId,
                                          of: impl.canvasId
                                      })
                              })
                          ]
                      })
                    : null,
                !impl.canvasId && (impl.placementNodes.length || impl.slotOptions.length > 1)
                    ? sectionCard({
                          key: 'placement',
                          title: `Placement in ${impl.parentId}`,
                          children: [
                              impl.slotOptions.length > 1 ? slotEditor(impl) : null,
                              div({
                                  className: `${CLS}__placement-row`,
                                  children: placementRows(impl, it => inPlacementRow(impl, it))
                              }),
                              ...placementRows(impl, it => !inPlacementRow(impl, it))
                          ]
                      })
                    : null,
                impl.readOnly
                    ? null
                    : button({
                          className: `${CLS}__remove`,
                          icon: Icon.delete(),
                          text: impl.isView
                              ? `Remove ${impl.elementId} and its view`
                              : `Remove ${impl.elementId}`,
                          intent: 'danger',
                          minimal: true,
                          onClick: () => impl.removeAsync()
                      })
            ]
        });
    }
});

const LIST_KINDS = ['fieldList', 'list', 'stringList'],
    CANVAS_VIEW = 'Canvas view';

// A selected canvas view's settings: its header, the inputs in it, and its place on the canvas.
function viewCards(impl: ElementInspectorModel) {
    const {designModel} = impl,
        {registry, blueprint} = designModel.blueprintModel;
    return [
        sectionCard({key: 'view-header', title: 'Header', children: viewHeaderRows(impl)}),
        sectionCard({
            key: 'view-items',
            title: 'Header items',
            count: impl.headerItemIds.length,
            children: [
                impl.headerItemIds.length
                    ? sortableList({
                          key: 'items',
                          className: `${CLS}__columns`,
                          value: impl.headerItemIds.map(id => ({id})),
                          getItemLabel: (it: {id: string}) => it.id,
                          disabled: impl.readOnly,
                          compact: true,
                          onReorder: e =>
                              refuse(
                                  designModel,
                                  designModel.reorder(e.item.id, e.toIndex - e.fromIndex).issues
                              ),
                          renderItem: ({id}: {id: string}) =>
                              hbox({
                                  className: `${CLS}__item-header ${CLS}__header-item`,
                                  children: [
                                      div({className: `${CLS}__header-item-id`, children: id}),
                                      div({
                                          className: `${CLS}__header-item-meta`,
                                          children:
                                              registry.widgets[blueprint.elements[id]?.component]
                                                  ?.label
                                      }),
                                      button({
                                          icon: Icon.arrowRight(),
                                          title: `Select ${id}`,
                                          minimal: true,
                                          onClick: () => designModel.select({kind: 'element', id})
                                      }),
                                      impl.readOnly
                                          ? null
                                          : removeItemButton(`Remove ${id}`, false, () =>
                                                removeElementAsync(designModel, id)
                                            )
                                  ]
                              })
                      })
                    : null,
                impl.readOnly
                    ? null
                    : button({
                          key: '_add',
                          icon: Icon.add(),
                          intent: 'primary',
                          text: 'Add an input',
                          minimal: true,
                          onClick: () => impl.addHeaderItem()
                      })
            ]
        }),
        sectionCard({
            key: 'view-placement',
            title: `Placement in ${impl.canvasId}`,
            children: [
                div({
                    key: 'row',
                    className: `${CLS}__placement-row`,
                    children: placementRows(impl, it => it.kind === 'number')
                })
            ]
        })
    ];
}

// Whether a canvas view shows its header, and its title there.
function viewHeaderRows(impl: ElementInspectorModel) {
    const hidden = !!impl.placementValues.hideHeader;
    return [
        div({
            key: 'hideHeader',
            className: `${CLS}__row ${CLS}__row--inline`,
            ...({'data-config-key': 'hideHeader'} as object),
            children: [
                div({className: `${CLS}__label`, children: 'Header'}),
                div({
                    className: `${CLS}__row-body`,
                    children: booleanEditor({
                        value: hidden,
                        labels: [
                            {value: false, label: 'Show'},
                            {value: true, label: 'Hide'}
                        ],
                        disabled: impl.readOnly,
                        onCommit: v => impl.commitPlacement('hideHeader', v || undefined)
                    })
                })
            ]
        }),
        ...placementRows(impl, it => it.key === 'title')
    ];
}

// A canvas cell's grid numbers share one row, and its other settings take rows of their own.
const inPlacementRow = (impl: ElementInspectorModel, node: EditorNode) =>
    node.kind === 'number' || !impl.placementNodes.some(it => it.kind === 'number');

function placementRows(impl: ElementInspectorModel, filter: (node: EditorNode) => boolean) {
    return impl.placementNodes.filter(filter).map(node =>
        propertyRow({
            node,
            value: impl.placementValues[node.key],
            commit: v => impl.commitPlacement(node.key, v),
            ctx: {impl, key: placementKey(node.key)},
            issues: impl.issuesFor(placementKey(node.key)),
            key: `placement:${node.key}:${impl.resets[placementKey(node.key)] ?? 0}`
        })
    );
}

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
        ...({'data-config-key': 'sets'} as object),
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

// A container's children: each by its glyph, id and kind, selected on a click, reordered by drag
// or Alt+arrows where the list sets their order, and removed, with a way to add one at the end.
function childrenCard(impl: ElementInspectorModel) {
    const {designModel, childIds, readOnly: disabled} = impl,
        {registry, blueprint} = designModel.blueprintModel,
        row = (id: string) => {
            const spec = registry.widgets[blueprint.elements[id]?.component];
            return hbox({
                className: `${CLS}__item-header ${CLS}__child`,
                ...({'data-child': id} as object),
                onClick: () => designModel.select({kind: 'element', id}),
                children: [
                    spec ? widgetIcon(spec, {className: `${CLS}__child-icon`}) : null,
                    span({className: `${CLS}__column-label ${CLS}__child-id`, children: id}),
                    span({className: `${CLS}__column-meta`, children: spec?.label}),
                    removeItemButton(`Remove ${id}`, disabled, () =>
                        removeElementAsync(designModel, id).then(it => refuse(designModel, it))
                    )
                ]
            });
        };
    return sectionCard({
        key: 'children',
        title: 'Children',
        count: childIds.length,
        children: [
            childIds.length
                ? impl.ordersChildren
                    ? sortableList({
                          key: 'list',
                          className: `${CLS}__columns`,
                          value: childIds.map(id => ({id})),
                          itemKey: 'id',
                          getItemLabel: (it: {id: string}) => it.id,
                          disabled,
                          compact: true,
                          onReorder: e => impl.moveChild(e.item.id, e.fromIndex, e.toIndex),
                          renderItem: (it: {id: string}) => row(it.id)
                      })
                    : div({
                          key: 'list',
                          className: `${CLS}__columns ${CLS}__columns--fixed`,
                          children: childIds.map(id => div({key: id, children: row(id)}))
                      })
                : null,
            disabled
                ? null
                : button({
                      key: '_add',
                      icon: Icon.add(),
                      intent: 'primary',
                      text: 'Add a widget…',
                      minimal: true,
                      onClick: () => impl.addChild()
                  })
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
                className: `${CLS}__field-list`,
                children: [
                    sortableList({
                        className: `${CLS}__columns`,
                        value: tabs,
                        itemKey: 'id',
                        getItemLabel: (tab: {title: string}) => tab.title,
                        disabled,
                        compact: true,
                        onReorder: e => impl.moveTab(e.item.id, e.toIndex),
                        renderItem: (tab: {id: string; title: string}) =>
                            hbox({
                                className: `${CLS}__item-header ${CLS}__tab`,
                                children: [
                                    textInput({
                                        value: tab.title,
                                        disabled,
                                        flex: 1,
                                        onCommit: (title: string) =>
                                            title &&
                                            title !== tab.title &&
                                            impl.retitle(tab.id, title)
                                    }),
                                    button({
                                        icon: Icon.arrowRight(),
                                        title: `Select ${tab.id}`,
                                        minimal: true,
                                        onClick: () =>
                                            impl.designModel.select({kind: 'element', id: tab.id})
                                    }),
                                    removeItemButton(`Remove ${tab.id}`, disabled, () =>
                                        impl.removeAsync(tab.id)
                                    )
                                ]
                            })
                    }),
                    button({
                        icon: Icon.add(),
                        intent: 'primary',
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
