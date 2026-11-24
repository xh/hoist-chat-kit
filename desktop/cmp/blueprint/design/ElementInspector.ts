import {div, hbox, placeholder, span} from '@xh/hoist/cmp/layout';
import {hoistCmp, type HoistProps, type PlainObject, useLocalModel, uses} from '@xh/hoist/core';
import {button} from '@xh/hoist/desktop/cmp/button';
import {select, textInput} from '@xh/hoist/desktop/cmp/input';
import {sortableList} from '@xh/hoist/cmp/sortablelist';
import {Icon} from '@xh/hoist/icon';
import {tooltip} from '@xh/hoist/kit/blueprint';
import {action, bindable, compareStructural, computed, observableRef} from '@xh/hoist/mobx';
import {wait} from '@xh/hoist/promise';
import classNames from 'classnames';
import {castArray, isArray, isEqual, isNumber, isPlainObject, isString, without} from 'lodash';
import {type KeyboardEvent as ReactKeyboardEvent, type ReactNode, useEffect, useMemo} from 'react';
import {
    type BlueprintDesignModel,
    type EditorNode,
    labelOf,
    SETTING_GROUPS,
    type SettingGroup,
    toEditorSpec
} from '../../../../blueprint';
import {
    type ChildNode,
    childGroups,
    locate,
    parentOf,
    viewTitle
} from '../../../../blueprint/impl/elements';
import './ElementInspector.scss';
import {ConfigEditorModel} from './impl/ConfigEditorModel';
import {
    booleanEditor,
    CLS,
    countLabel,
    fieldItemPage,
    firstSentence,
    listItemPage,
    moreLine,
    propertyRow,
    removeItemButton,
    sectionCard,
    useNamedInputs
} from './impl/ConfigEditors';
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
        return !!this.personalizable?.includes(`/config/${key}`);
    }

    // The same list across edits that leave it alone, so rows that read it do not draw again.
    @computed
    private get personalizable(): string[] {
        return this.element?.personalizable ?? null;
    }

    /** True while the selection is the view that holds the element, not the element. */
    get isView(): boolean {
        return !!this.designModel.selectedViewId;
    }

    /** The dashboard the element sits in a cell of, or null. */
    get dashboardId(): string {
        const of = this.designModel.viewOf(this.elementId)?.of;
        return this.designModel.blueprintModel.blueprint?.elements?.[of]?.component === 'dashboard'
            ? of
            : null;
    }

    /** The inputs in the element's dashboard cell header. */
    get headerItemIds(): string[] {
        const ref = this.designModel.blueprintModel.blueprint?.elements?.[
            this.dashboardId
        ]?.children?.find(it => it.id === this.elementId);
        return ((ref?.headerItems as {id: string}[]) ?? []).map(it => it.id);
    }

    /** Add an input to the element's cell header, from the Add panel. */
    addHeaderItem() {
        const {designModel, dashboardId, elementId} = this;
        designModel.selectSlot({parent: dashboardId, slot: 'headerItems', of: elementId});
        designModel.requestAdd();
    }

    get label(): string {
        return this.widgetSpec?.label ?? this.element?.component;
    }

    override get pageElement(): string {
        return this.isView ? null : this.elementId;
    }

    /** The list whose item's page is open, or null. */
    get pageNode(): Extract<EditorNode, {kind: 'fieldList' | 'list'}> {
        const list = this.designModel.itemPage?.list,
            node = list && this.pageKey(list) ? this.nodes.find(it => it.key === list) : null;
        return node?.kind === 'fieldList' || node?.kind === 'list' ? node : null;
    }

    /** What Find a setting looks for. */
    @bindable accessor findQuery = '';

    /**
     * The settings Find a setting matches, by label, key or description: the element's own, folded
     * ones included, then each grid column's, which open on its page.
     */
    @computed
    get findResults(): FindResult[] {
        const q = this.findQuery.trim().toLowerCase();
        if (!q) return [];
        const matches = (node: EditorNode) =>
                [node.label, node.key, node.description].some(it => it?.toLowerCase().includes(q)),
            own = this.sections.flatMap(section =>
                [...section.nodes, ...(section.moreOpen ? [] : section.folded)]
                    .filter(matches)
                    .map(node => ({
                        id: node.key,
                        label: node.label,
                        where: section.label,
                        node,
                        section
                    }))
            ),
            items = this.nodes.flatMap(list => {
                if (list.kind !== 'fieldList' || !list.settingsIn) return [];
                const settings = [...list.settings, ...list.settingsIn.settings].filter(matches),
                    seen: Record<string, number> = {};
                return castArray(this.values[list.key] ?? []).flatMap(it => {
                    const field = isString(it) ? it : it?.field,
                        n = (seen[field] = (seen[field] ?? 0) + 1),
                        itemKey = `${field}#${n}`;
                    return settings.map(node => ({
                        id: `${list.key}/${itemKey}/${node.key}`,
                        label: node.label,
                        where: `${list.label} › ${this.fieldLabel(field)}`,
                        node,
                        page: {list: list.key, key: itemKey}
                    }));
                });
            });
        return [...own, ...items].slice(0, 40);
    }

    /** Show a found setting: open its section, its N more or its item's page, and focus its row. */
    @action
    showFound(result: FindResult) {
        const {designModel} = this;
        designModel.findOpen = false;
        this.findQuery = '';
        if (result.page) {
            this.openPage(result.page.list, result.page.key);
        } else {
            const {section} = result;
            if (section.collapsed) this.toggleSection(section.group);
            if (section.folded.includes(result.node) && !section.moreOpen) {
                this.toggleSection(`more:${section.group}`);
            }
        }
        designModel.focusField(this.elementId, result.node.key);
    }

    /** Sections and their "N more" rows toggled from how they start, by widget type and key. */
    @observableRef accessor toggled: Record<string, boolean> = {};

    /**
     * The element's editors in its widget's sections, in order: Data, its list, Content,
     * Appearance and Behavior, each by its properties' `x-group`. A section of more than four
     * settings folds its advanced ones that are unset behind its "N more" row.
     */
    @computed
    get sections(): InspectorSection[] {
        const {nodes} = this;
        return SETTING_GROUPS.filter(it => it !== 'layout').flatMap(group => {
            const inGroup = nodes.filter(it => groupOf(it) === group);
            if (!inGroup.length) return [];
            const folded =
                    // A section of more than four folds its unset advanced settings, and any
                    // section an unset advanced code editor, such as Highcharts options.
                    inGroup.filter(
                        it =>
                            (inGroup.length > 4 || it.kind === 'json') &&
                            it.schema['x-advanced'] &&
                            this.values[it.key] === undefined &&
                            !this.presetFor(it.key)
                    ),
                moreOpen = this.isToggled(`more:${group}`);
            return [
                {
                    group,
                    label: group === 'list' ? inGroup[0].label : SECTION_LABELS[group],
                    nodes: [...without(inGroup, ...folded), ...(moreOpen ? folded : [])],
                    folded,
                    moreOpen,
                    collapsed: this.isToggled(group)
                }
            ];
        });
    }

    /** True if a section, or its "N more" row, is toggled from how it starts, for this widget. */
    isToggled(key: string): boolean {
        return !!this.toggled[`${this.element?.component}.${key}`];
    }

    @action
    toggleSection(key: string) {
        const at = `${this.element?.component}.${key}`;
        this.toggled = {...this.toggled, [at]: !this.toggled[at]};
    }

    /**
     * What a card's header counts, in words: a lone list's items ("5 columns", "none"), else the
     * settings set in it ("3 set"), or null for none. A binding or a preset counts as set, and a
     * schema default does not.
     */
    countOf(nodes: EditorNode[]): string {
        const [only] = nodes;
        if (nodes.length === 1 && LIST_KINDS.includes(only.kind)) {
            const n = castArray(this.values[only.key] ?? []).length,
                many = only.label.toLowerCase();
            return n ? countLabel(n, many.replace(/s$/, ''), many) : 'none';
        }
        const n = nodes.filter(
            it => this.values[it.key] !== undefined || this.presetFor(it.key)
        ).length;
        return n ? `${n} set` : null;
    }

    /** The element's editors, from its widget's config schema. */
    @computed
    get nodes(): EditorNode[] {
        const ret = this.schemaNodes,
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

    // Built once per widget, as an edit changes the config, not its schema.
    @computed
    private get schemaNodes(): EditorNode[] {
        return toEditorSpec(this.widgetSpec?.config);
    }

    /** The element's config as it shows, with the active presets applied. */
    @computed
    get values(): PlainObject {
        return this.element?.config ?? EMPTY;
    }

    @computed
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
    @computed
    get placementNodes(): EditorNode[] {
        const schema = this.parentSpec?.children?.schema;
        if (!schema || this.slot !== 'children') return [];
        return toEditorSpec(schema)
            .filter(it => it.key !== 'id' && !this.parentSpec.children.slots?.[it.key])
            .map(it =>
                this.dashboardId && DASHBOARD_PLACES[it.key]
                    ? ({...it, ...DASHBOARD_PLACES[it.key]} as EditorNode)
                    : it
            );
    }

    /**
     * What a placement shows over what its blueprint holds: 1 for a dashboard cell's column and
     * row, which read from 1 here though the blueprint counts its x and y from 0.
     */
    placementOffset(key: string): number {
        return this.dashboardId && (key === 'x' || key === 'y') ? 1 : 0;
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
        const {elementId: id, designModel} = this,
            {issues} = designModel.setChildPlacement(
                id,
                {[key]: value},
                `${id}${designModel.viewOf(id) ? ' view' : ''}: ${labelOf(key).toLowerCase()}`
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

    /** The views among {@link childIds}: a dashboard's cells, a panes widget's views. */
    get childViews(): ChildNode[] {
        const {elementId, element, widgetSpec} = this;
        return childGroups(elementId, element, {children: widgetSpec?.children})
            .flatMap(it => it.nodes)
            .filter(it => it.kind === 'view');
    }

    /** True if the container orders its children by place in the list, not by a layout. */
    get ordersChildren(): boolean {
        return !['dashboard', 'panes'].includes(this.element?.component);
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

    /** Add a tab holding a dashboard, and keep the container selected. */
    addTab() {
        this.designModel.addWidget('dashboard', this.elementId);
    }

    protected pathOf(key: string): string {
        return `/elements/${this.elementId}/config/${key}`;
    }

    protected write(key: string, value: unknown) {
        return this.designModel.setConfig(this.elementId, `/${key}`, value);
    }

    @computed
    private get element() {
        const id = this.designModel.selectedElementId ?? this.designModel.selectedViewId;
        return this.designModel.blueprintModel.effectiveElement(id);
    }

    /** The selected element's widget spec, the same across edits to the element. */
    @computed
    get widgetSpec() {
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
/** A setting Find a setting matched, as {@link ElementInspectorModel.findResults} gives it. */
export interface FindResult {
    id: string;
    label: string;
    /** Where it sits: its section, or its list and item. */
    where: string;
    node: EditorNode;
    section?: InspectorSection;
    /** The item whose page holds it, for a list item's setting. */
    page?: {list: string; key: string};
}

/** A section of the element's settings, as {@link ElementInspectorModel.sections} gives it. */
export interface InspectorSection {
    group: SettingGroup;
    label: string;
    /** The settings it shows, those its "N more" folds after the rest once opened. */
    nodes: EditorNode[];
    /** The unset advanced settings its "N more" row holds. */
    folded: EditorNode[];
    moreOpen: boolean;
    collapsed: boolean;
}

const SECTION_LABELS: Record<SettingGroup, string> = {
    data: 'Data',
    list: 'List',
    content: 'Content',
    appearance: 'Appearance',
    behavior: 'Behavior',
    layout: 'Layout'
};

// A property's section: its x-group, or for an app's widget that names none, Data for what reads
// the source and Content for the rest.
function groupOf(node: EditorNode): SettingGroup {
    const group = node.schema['x-group'];
    if (SETTING_GROUPS.includes(group)) return group;
    return ['source', 'field', 'fieldList', 'filter', 'sort'].includes(node.kind)
        ? 'data'
        : 'content';
}

// A dashboard cell's place as the mockup names it: a column and a row counted from 1, a width in
// columns and a height in rows.
const DASHBOARD_PLACES: Record<string, Partial<EditorNode>> = {
    x: {
        label: 'Column',
        description: 'The column the view starts in, from 1.',
        min: 1,
        required: false
    } as any,
    y: {
        label: 'Row',
        description: 'The row the view starts in, from 1.',
        min: 1,
        required: false
    } as any,
    w: {label: 'Width', description: 'How many of the 12 columns the view spans.', required: false},
    h: {label: 'Height', description: 'How many rows the view spans.', required: false}
};

// A number moved by an offset, as a placement shows or stores it. Anything else as it is.
const shifted = (v: unknown, by: number) => (isNumber(v) && by ? v + by : v);

const ELEMENT_KEY = '';

// A slot as the inspector's slot picker names it.
const EMPTY = {};

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
        const ref = useNamedInputs(),
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
        }, [designModel, fieldFocus, elementId, ref]);
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
                designModel.findOpen && !impl.isView ? findBox(impl) : null,
                ...[...impl.issuesFor(ID_KEY), ...impl.issuesFor(ELEMENT_KEY)].map((it, idx) =>
                    div({key: idx, className: `${CLS}__issue`, children: it.message})
                ),
                ...(impl.isView
                    ? viewCards(impl)
                    : impl.pageNode
                      ? [itemPage(impl)]
                      : [...sectionCards(impl), layoutCard(impl)])
            ]
        });
    }
});

const LIST_KINDS = ['fieldList', 'list', 'stringList'];

// Find a setting: a box that filters every setting, the hidden and those on item pages included,
// and its matches. Enter shows the first, a click any, and Escape closes it.
function findBox(impl: ElementInspectorModel): ReactNode {
    const close = () => {
        impl.designModel.findOpen = false;
        impl.findQuery = '';
    };
    return div({
        key: 'find',
        className: `${CLS}__find`,
        onKeyDown: (e: ReactKeyboardEvent) => {
            if (e.key !== 'Escape') return;
            e.preventDefault();
            e.stopPropagation();
            close();
            // Focus returns to the magnifier that opens it.
            wait().then(() =>
                document.querySelector<HTMLElement>('[aria-label="Find a setting"]')?.focus()
            );
        },
        children: [
            textInput({
                value: impl.findQuery,
                placeholder: 'Find a setting',
                autoFocus: true,
                commitOnChange: true,
                leftIcon: Icon.search(),
                width: '100%',
                onCommit: (v: string) => (impl.findQuery = v ?? ''),
                onKeyDown: (e: KeyboardEvent) => {
                    if (e.key === 'Enter' && impl.findResults.length) {
                        e.preventDefault();
                        impl.showFound(impl.findResults[0]);
                    }
                }
            }),
            impl.findQuery.trim()
                ? div({
                      className: `${CLS}__find-results`,
                      role: 'listbox',
                      children: impl.findResults.length
                          ? impl.findResults.map(it =>
                                div({
                                    key: it.id,
                                    className: `${CLS}__find-result`,
                                    role: 'option',
                                    tabIndex: 0,
                                    onClick: () => impl.showFound(it),
                                    onKeyDown: (e: ReactKeyboardEvent) => {
                                        if (e.key !== 'Enter' && e.key !== ' ') return;
                                        e.preventDefault();
                                        impl.showFound(it);
                                    },
                                    children: [
                                        span({className: `${CLS}__find-label`, children: it.label}),
                                        span({className: `${CLS}__find-where`, children: it.where})
                                    ]
                                } as object)
                            )
                          : div({className: `${CLS}__find-none`, children: 'No setting matches'})
                  } as object)
                : null
        ]
    });
}

// The open item's page, for a field list such as a grid's columns or a list such as its actions.
function itemPage(impl: ElementInspectorModel): ReactNode {
    const node = impl.pageNode,
        props = {
            key: 'page',
            list: castArray(impl.values[node.key] ?? []),
            commit: (v: unknown) => impl.commit(node.key, v),
            ctx: {impl, key: node.key},
            itemKey: impl.pageKey(node.key)
        };
    return node.kind === 'fieldList'
        ? fieldItemPage({...props, node})
        : listItemPage({...props, node});
}

// The element's sections in order, its tabs or children as its list where its config has none.
function sectionCards(impl: ElementInspectorModel): ReactNode[] {
    const {sections} = impl,
        lists = [
            impl.tabs ? tabsEditor(impl) : null,
            impl.childIds ? childrenCard(impl) : null
        ].filter(Boolean),
        listAt = sections.findIndex(it => it.group !== 'data'),
        cards = sections.map(section => configCard(impl, section));
    // An input's Data is its Value: the variable it sets, then its options.
    if (impl.setsOptions && sections[0]?.group !== 'data') {
        cards.unshift(
            sectionCard({
                key: 'section:data',
                title: 'Value',
                collapsed: impl.isToggled('data'),
                onToggle: () => impl.toggleSection('data'),
                children: [setsEditor(impl), optionsRow(impl)]
            })
        );
        return insertLists(cards, lists, 1);
    }
    return insertLists(cards, lists, listAt);
}

function insertLists(cards: ReactNode[], lists: ReactNode[], at: number): ReactNode[] {
    cards.splice(at < 0 ? cards.length : at, 0, ...lists);
    return cards;
}

function configCard(impl: ElementInspectorModel, section: InspectorSection): ReactNode {
    const all = [...section.nodes, ...(section.moreOpen ? [] : section.folded)],
        preset = all.map(it => impl.presetFor(it.key)).find(Boolean);
    const isValue = section.group === 'data' && !!impl.setsOptions;
    return sectionCard({
        key: `section:${section.group}`,
        title: isValue ? 'Value' : section.label,
        count: impl.countOf(all),
        badge: preset
            ? {
                  text: `Preset · ${preset.itemLabel}`,
                  onClick: () => impl.designModel.select({kind: 'preset', id: preset.group})
              }
            : null,
        collapsed: section.collapsed,
        summary: setSummary(impl, all),
        onToggle: () => impl.toggleSection(section.group),
        children: [
            isValue ? setsEditor(impl) : null,
            isValue ? optionsRow(impl) : null,
            // A section's one list, such as Columns, is named by the section's header alone.
            ...section.nodes.map(node => configRow(impl, node)),
            moreRow(impl, section)
        ]
    });
}

// The labels of what a folded section has set, or that it has none.
function setSummary(impl: ElementInspectorModel, nodes: EditorNode[]): string {
    const set = nodes.filter(it => impl.values[it.key] !== undefined || impl.presetFor(it.key));
    return set.length ? set.map(it => it.label).join(', ') : 'Nothing set';
}

// A section's unset advanced settings, folded to one quiet line that names them, or the way to
// fold them again.
function moreRow(impl: ElementInspectorModel, section: InspectorSection): ReactNode {
    const {folded, moreOpen, group} = section;
    if (!folded.length) return null;
    const toggle = () => impl.toggleSection(`more:${group}`),
        names = folded.map(it => it.label);
    if (moreOpen) return moreLine(true, folded.length, names, toggle);
    return tooltip({
        key: 'more',
        className: `${CLS}__more-box`,
        hoverOpenDelay: 500,
        content: div({
            className: `${CLS}__more-tip`,
            children: folded.map(it =>
                div({
                    key: it.key,
                    children: [
                        span({className: `${CLS}__more-tip-label`, children: it.label}),
                        it.description ? ` ${firstSentence(it.description)}` : null
                    ]
                })
            )
        }),
        item: moreLine(false, folded.length, names, toggle)
    });
}

// Where the element sits in its parent, last and folded to one line: a dashboard cell's view
// settings, with a way to the view, or its placement in any other container.
function layoutCard(impl: ElementInspectorModel): ReactNode {
    const {dashboardId, parentId} = impl;
    if (!dashboardId && !impl.placementNodes.length && impl.slotOptions.length <= 1) return null;
    const placed = Object.entries(impl.placementValues)
            .filter(([k, v]) => v != null && !isPlainObject(v) && !isArray(v) && k !== 'title')
            .map(([k, v]) => `${labelOf(k).toLowerCase()} ${v}`),
        summary = [`In ${dashboardId ?? parentId}`, ...placed].join(' · ');
    return sectionCard({
        key: 'layout',
        title: 'Layout',
        collapsed: !impl.isToggled('layout'),
        summary,
        onToggle: () => impl.toggleSection('layout'),
        children: dashboardId
            ? [
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
                              of: dashboardId
                          })
                  })
              ]
            : [
                  impl.slotOptions.length > 1 ? slotEditor(impl) : null,
                  div({
                      className: `${CLS}__placement-row`,
                      children: placementRows(impl, it => inPlacementRow(impl, it))
                  }),
                  ...placementRows(impl, it => !inPlacementRow(impl, it))
              ]
    });
}

// The widget a selected view holds, a row a click selects.
function holdsCard(impl: ElementInspectorModel): ReactNode {
    const {designModel, elementId} = impl,
        spec = impl.widgetSpec,
        select = () => designModel.select({kind: 'element', id: elementId});
    return sectionCard({
        key: 'holds',
        title: 'Holds',
        children: [
            div({
                key: 'list',
                className: `${CLS}__held-list`,
                children: hbox({
                    key: 'held',
                    className: `${CLS}__item-header ${CLS}__held`,
                    role: 'button',
                    tabIndex: 0,
                    title: `Select ${elementId}`,
                    onClick: select,
                    onKeyDown: (e: ReactKeyboardEvent) => {
                        if (e.key !== 'Enter' && e.key !== ' ') return;
                        e.preventDefault();
                        select();
                    },
                    children: [
                        spec ? widgetIcon(spec, {className: `${CLS}__child-icon`}) : null,
                        span({
                            className: `${CLS}__column-label ${CLS}__child-id`,
                            children: elementId
                        }),
                        span({className: `${CLS}__column-meta`, children: spec?.label}),
                        Icon.chevronRight({className: `${CLS}__held-go`})
                    ]
                } as object)
            })
        ]
    });
}

// Where an input's options come from: its variable's own values, a field's values over a source,
// or anything, with a way to the variable.
function optionsRow(impl: ElementInspectorModel): ReactNode {
    const name = impl.setsVariable,
        decl = name ? impl.designModel.blueprintModel.blueprint?.variables?.[name] : null;
    if (!decl) return null;
    const options = decl.options as PlainObject,
        text = isArray(options?.values)
            ? countLabel(options.values.length, 'value')
            : options?.source
              ? `From ${options.source}'s ${options.field ?? 'values'}`
              : `From ${name}'s values`;
    return div({
        key: 'options',
        className: `${CLS}__row ${CLS}__row--inline`,
        ...({'data-config-key': 'options', role: 'group', 'aria-label': 'Options'} as object),
        children: [
            div({className: `${CLS}__label`, children: 'Options'}),
            div({
                className: `${CLS}__row-body`,
                children: button({
                    className: `${CLS}__options-link`,
                    text,
                    minimal: true,
                    small: true,
                    title: `Show variable ${name}`,
                    onClick: () => impl.designModel.select({kind: 'variable', id: name})
                })
            })
        ]
    });
}

// A selected view's settings: a dashboard cell's header, the inputs in it and its place, or a dash
// container view's title.
function viewCards(impl: ElementInspectorModel) {
    const {designModel} = impl,
        {registry, blueprint} = designModel.blueprintModel;
    // A panes widget's view has its title alone.
    if (!impl.dashboardId) {
        return [
            sectionCard({
                key: 'view',
                title: 'View',
                collapsed: impl.isToggled('view'),
                onToggle: () => impl.toggleSection('view'),
                children: placementRows(impl, it => it.key === 'title')
            })
        ];
    }
    return [
        sectionCard({
            key: 'view',
            title: 'View',
            collapsed: impl.isToggled('view'),
            onToggle: () => impl.toggleSection('view'),
            children: [
                ...viewHeaderRows(impl),
                div({
                    key: 'items-label',
                    className: `${CLS}__label`,
                    children: `Header items · ${impl.headerItemIds.length ? countLabel(impl.headerItemIds.length, 'item') : 'none'}`
                }),
                sortableList({
                    key: 'items',
                    className: `${CLS}__columns`,
                    variant: 'divided',
                    addRenderer: impl.readOnly
                        ? null
                        : addPanelRow('Add an input…', () => impl.addHeaderItem()),
                    value: impl.headerItemIds.map(id => ({id})),
                    getItemLabel: (it: {id: string}) => it.id,
                    disabled: impl.readOnly,
                    compact: true,
                    onReorder: e =>
                        refuse(
                            designModel,
                            designModel.reorder(e.item.id, e.toIndex - e.fromIndex).issues
                        ),
                    itemRenderer: ({id}: {id: string}) =>
                        hbox({
                            className: `${CLS}__item-header ${CLS}__header-item`,
                            children: [
                                div({className: `${CLS}__header-item-id`, children: id}),
                                div({
                                    className: `${CLS}__header-item-meta`,
                                    children:
                                        registry.widgets[blueprint.elements[id]?.component]?.label
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
            ]
        }),
        sectionCard({
            key: 'position',
            title: 'Position',
            collapsed: impl.isToggled('position'),
            onToggle: () => impl.toggleSection('position'),
            children: [
                div({
                    key: 'row',
                    className: `${CLS}__placement-row`,
                    children: placementRows(impl, it => it.kind === 'number')
                }),
                div({
                    key: 'hint',
                    className: `${CLS}__hint`,
                    children: 'Drag the view on the canvas to move it; its edges resize it.'
                })
            ]
        }),
        holdsCard(impl)
    ];
}

// Whether a dashboard view shows its header, and its title there.
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

// A dashboard cell's grid numbers share one row, and its other settings take rows of their own.
const inPlacementRow = (impl: ElementInspectorModel, node: EditorNode) =>
    node.kind === 'number' || !impl.placementNodes.some(it => it.kind === 'number');

function placementRows(impl: ElementInspectorModel, filter: (node: EditorNode) => boolean) {
    return impl.placementNodes.filter(filter).map(node =>
        inspectorRow({
            impl,
            node,
            placement: true,
            key: `placement:${node.key}:${impl.resets[placementKey(node.key)] ?? 0}`
        })
    );
}

// One config property's row, with its issues and preset badge.
function configRow(impl: ElementInspectorModel, node: EditorNode) {
    return inspectorRow({impl, node, key: `${node.key}:${impl.resets[node.key] ?? 0}`});
}

/**
 * A property's row, which draws again only as its own value, issues or badge change, so an edit
 * to one property leaves the others as they are.
 */
const inspectorRow = hoistCmp.factory<
    HoistProps & {
        impl: ElementInspectorModel;
        node: EditorNode;
        placement?: boolean;
    }
>({
    displayName: 'ElementInspectorRow',
    model: false,
    render({impl, node, placement}) {
        const key = placement ? placementKey(node.key) : node.key,
            state = useMemo(
                () =>
                    computed(
                        () => ({
                            value: placement
                                ? shifted(
                                      impl.placementValues[node.key],
                                      impl.placementOffset(node.key)
                                  )
                                : impl.values[node.key],
                            issues: impl.issuesFor(key),
                            badge: placement ? null : impl.badgeFor(node.key)
                        }),
                        {equals: compareStructural}
                    ),
                [impl, node, placement, key]
            ).get();
        return propertyRow({
            node,
            value: state.value,
            commit: v =>
                placement
                    ? impl.commitPlacement(node.key, shifted(v, -impl.placementOffset(node.key)))
                    : impl.commit(node.key, v),
            ctx: {impl, key},
            issues: state.issues,
            badge: state.badge
        });
    }
});

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
        className: `${CLS}__row ${CLS}__row--inline`,
        ...({'data-config-key': 'sets', role: 'group', 'aria-label': 'Sets'} as object),
        children: [
            div({className: `${CLS}__label`, children: 'Sets'}),
            div({
                className: `${CLS}__row-body`,
                children: [
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
                        .map((it, idx) =>
                            div({key: idx, className: `${CLS}__issue`, children: it.message})
                        )
                ]
            })
        ]
    });
}

// A container's children: each by its glyph, id and kind, selected on a click, reordered by drag
// or Alt+arrows where the list sets their order, and removed, with a way to add one at the end.
// A list's Add row that opens the Add panel, which adds the widget chosen there.
function addPanelRow(text: string, open: () => void) {
    return ({disabled}: {disabled: boolean}) =>
        button({
            icon: Icon.add(),
            intent: 'primary',
            text,
            minimal: true,
            disabled,
            onClick: open
        });
}

function childrenCard(impl: ElementInspectorModel) {
    const {designModel, childIds, readOnly: disabled} = impl,
        {registry, blueprint} = designModel.blueprintModel,
        row = (id: string) => {
            const el = blueprint.elements[id],
                spec = registry.widgets[el?.component],
                view = impl.childViews.find(it => it.id === id),
                ref = blueprint.elements[impl.elementId].children.find(it => it.id === id);
            return hbox({
                className: `${CLS}__item-header ${CLS}__child`,
                ...({'data-child': id} as object),
                onClick: () =>
                    designModel.select(
                        view ? {kind: 'view', id, of: view.of} : {kind: 'element', id}
                    ),
                children: [
                    view
                        ? Icon.window({className: `${CLS}__child-icon`})
                        : spec
                          ? widgetIcon(spec, {className: `${CLS}__child-icon`})
                          : null,
                    span({
                        className: `${CLS}__column-label ${CLS}__child-id`,
                        children: view ? viewTitle(ref, el) : id
                    }),
                    span({className: `${CLS}__column-meta`, children: view ? 'View' : spec?.label}),
                    removeItemButton(`Remove ${id}`, disabled, () =>
                        removeElementAsync(designModel, id).then(it => refuse(designModel, it))
                    )
                ]
            });
        };
    return sectionCard({
        key: 'children',
        title: 'Children',
        count: childIds.length ? countLabel(childIds.length, 'child', 'children') : 'none',
        collapsed: impl.isToggled('children'),
        onToggle: () => impl.toggleSection('children'),
        children: [
            sortableList({
                key: 'list',
                className: classNames(
                    `${CLS}__columns`,
                    !impl.ordersChildren && `${CLS}__columns--fixed`
                ),
                value: childIds.map(id => ({id})),
                itemKey: 'id',
                getItemLabel: (it: {id: string}) => it.id,
                disabled,
                compact: true,
                variant: 'divided',
                // Children a layout places have no order to change, so no handle.
                ...(impl.ordersChildren ? {} : {handle: 'custom' as const}),
                onReorder: e => impl.moveChild(e.item.id, e.fromIndex, e.toIndex),
                itemRenderer: (it: {id: string}) => row(it.id),
                addRenderer: disabled ? null : addPanelRow('Add a widget…', () => impl.addChild())
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
                        itemRenderer: (tab: {id: string; title: string}) =>
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
