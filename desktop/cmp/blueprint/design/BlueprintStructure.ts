import {grid, GridModel} from '@xh/hoist/cmp/grid';
import {div, filler, hbox, span} from '@xh/hoist/cmp/layout';
import {
    hoistCmp,
    HoistModel,
    type HoistProps,
    managed,
    type PlainObject,
    useLocalModel
} from '@xh/hoist/core';
import type {StoreRecord} from '@xh/hoist/data';
import {button} from '@xh/hoist/desktop/cmp/button';
import {textInput} from '@xh/hoist/desktop/cmp/input';
import {panel} from '@xh/hoist/desktop/cmp/panel';
import {Icon} from '@xh/hoist/icon';
import {action, bindable, computed, observable} from '@xh/hoist/mobx';
import classNames from 'classnames';
import type React from 'react';
import type {ReactElement} from 'react';
import type {AddPlace, BlueprintDesignModel, BlueprintSelection} from '../../../../blueprint';
import {
    type ChildNode,
    childGroups,
    locate,
    parentMap,
    slotLabel,
    viewTitle
} from '../../../../blueprint/impl/elements';
import {variableText} from '../../../../blueprint/impl/variableText';
import './BlueprintStructure.scss';
import './BlueprintTree.scss';
import {elementDrag} from './impl/elementDrag';
import {issueSummary, selectionMenu} from './impl/designActions';
import {designHotkeys} from './impl/designHotkeys';
import {partIcon} from './impl/icons';

export type StructureSection = 'element' | 'source' | 'variable' | 'preset';

export interface BlueprintStructureProps extends HoistProps {
    designModel: BlueprintDesignModel;
    /**
     * Add to a section from its "+", such as by opening the host's palette for elements. Without
     * it, the Variables "+" adds a variable in place, and the others show no "+".
     */
    onAdd?: (section: StructureSection) => void;
}

/**
 * A blueprint's parts as a tree: its elements, with a node for each slot of a container that has
 * several, then its sources, variables and preset groups, each section counted. Its selection is
 * the design model's, and selecting a slot node makes it the place to add. A filter keeps the rows
 * whose id matches, with their ancestors. Each row's menu renames, duplicates, moves, adds into and
 * deletes.
 */
export const [BlueprintStructure, blueprintStructure] =
    hoistCmp.withFactory<BlueprintStructureProps>({
        displayName: 'BlueprintStructure',
        className: 'xh-blueprint-structure',
        model: false,
        render({designModel, onAdd, className}) {
            const impl = useLocalModel(() => new BlueprintStructureModel(designModel));
            impl.onAdd = onAdd ?? null;
            return panel({
                className,
                hotkeys: designHotkeys(designModel, {arrows: false}),
                tbar: [
                    textInput({
                        model: impl,
                        bind: 'filterText',
                        placeholder: 'Filter',
                        leftIcon: Icon.filter(),
                        commitOnChange: true,
                        enableClear: true,
                        flex: 1
                    })
                ],
                children: grid({model: impl.gridModel})
            });
        }
    });

/** @internal */
export class BlueprintStructureModel extends HoistModel {
    @bindable accessor filterText: string = null;

    /** The host's add, per section. Set by the component. */
    onAdd: (section: StructureSection) => void = null;

    @managed readonly gridModel: GridModel;

    constructor(readonly designModel: BlueprintDesignModel) {
        super();
        this.gridModel = new GridModel({
            treeMode: true,
            treeStyle: 'none',
            stripeRows: false,
            rowClassFn: record => (record ? this.rowClassOf(record) : null),
            hideHeaders: true,
            expandLevel: -1,
            emptyText: 'Nothing matches.',
            store: {
                fields: [
                    'name',
                    'label',
                    'kind',
                    'count',
                    'place',
                    'component',
                    'empty',
                    'of',
                    'element',
                    'path'
                ]
            },
            contextMenu: agParams => {
                const record = agParams.node?.data as StoreRecord;
                return record ? (this.menuFor(record) as any[]) : [];
            },
            columns: [
                {
                    field: 'name',
                    isTreeColumn: true,
                    flex: 1,
                    rendererIsComplex: true,
                    renderer: (_, {record}) => this.renderRow(record)
                }
            ]
        });
        this.addReaction(
            {
                track: () => [
                    designModel.blueprintModel.blueprint,
                    designModel.blueprintModel.issues
                ],
                run: () => this.loadRows(),
                fireImmediately: true
            },
            {
                // Rows draw through ag-Grid's renderers, which redraw only when told to.
                track: () => [designModel.activeTabs, designModel.hiddenViews],
                run: () => this.gridModel.agApi?.refreshCells({force: true})
            },
            {
                track: () => [this.filterText, this.dragging, designModel.selectedElementId],
                run: () => this.applyFilter(),
                fireImmediately: true
            },
            {
                track: () => this.gridModel.selectedRecord,
                run: record => this.selected(record)
            },
            {
                track: () => [designModel.selection, designModel.slotTarget],
                run: () => this.showSelection(),
                fireImmediately: true
            }
        );
    }

    /** True for an element on a tab its container is not showing, as the dashboard reports it. */
    isOffscreen(id: string): boolean {
        const {activeTabs, hiddenViews} = this.designModel;
        for (let it = id, parent = this.parents.get(id); parent;) {
            const active = activeTabs[parent];
            if ((active && active !== it) || hiddenViews[parent]?.includes(it)) return true;
            it = parent;
            parent = this.parents.get(parent);
        }
        return false;
    }

    // Each element's container, built once per blueprint.
    @computed
    private get parents(): Map<string, string> {
        return parentMap(this.designModel.blueprintModel.blueprint?.elements);
    }

    /**
     * A row's class by its type: a category such as Elements, a container that holds elements, a
     * slot, or a leaf. The classes are global, so any blueprint tree can take them.
     */
    rowClassOf(record: StoreRecord): string {
        const {kind, component} = record.data,
            type =
                kind === 'section'
                    ? 'category'
                    : kind === 'slot'
                      ? 'slot'
                      : kind === 'view' ||
                          (kind === 'element' &&
                              this.designModel.blueprintModel.registry.widgets[component]?.children)
                        ? 'container'
                        : 'leaf';
        return `xh-blueprint-tree__row--${type}`;
    }

    /** The menu of a row: rename, duplicate, move, add into and delete, as its kind allows. */
    menuFor(record: StoreRecord): (PlainObject | string)[] {
        const {kind, name, element, of} = record.data;
        if (kind === 'view') return selectionMenu(this.designModel, {kind, id: element, of});
        return ['element', 'source', 'variable', 'preset'].includes(kind)
            ? selectionMenu(this.designModel, {kind, id: name})
            : [];
    }

    /** Start dragging an element, which a row then takes or refuses. */
    @action
    startDrag(id: string) {
        this.dragging = id;
        this.verdicts.clear();
        // Also a drag the dashboard takes, onto any container in it.
        elementDrag.start({element: id, designModel: this.designModel});
    }

    @action
    endDrag() {
        this.dragging = null;
        this.verdicts.clear();
        elementDrag.end();
    }

    /**
     * Where the element dragged would go on a row, from how far down the row the pointer is, from
     * 0 to 1, with the reason it cannot, if it cannot. Null for a row that takes no drop. Each
     * target is checked once per drag.
     */
    dropVerdict(rowId: string, fraction: number): DropVerdict {
        const {dragging, designModel} = this,
            row = this.rowData(rowId);
        if (!dragging || !row || row.name === dragging) return null;
        let where: DropVerdict['where'];
        if (row.kind === 'slot') {
            where = 'into';
        } else if (row.kind === 'element') {
            const isContainer =
                !!designModel.blueprintModel.registry.widgets[row.component]?.children;
            where =
                isContainer && fraction > 0.25 && fraction < 0.75
                    ? 'into'
                    : fraction < 0.5
                      ? 'before'
                      : 'after';
        } else {
            return null;
        }
        const key = `${rowId}|${where}`;
        if (!this.verdicts.has(key)) {
            const place: AddPlace =
                    row.kind === 'slot'
                        ? row.place
                        : where === 'into'
                          ? {parent: row.name, slot: 'children'}
                          : locate(designModel.blueprintModel.blueprint.elements, row.name),
                component = designModel.blueprintModel.blueprint.elements[dragging]?.component,
                // A slot's own words for what it takes, before the validator's.
                refusal = place ? designModel.addRefusal(component, place) : null,
                [issue] = refusal
                    ? []
                    : row.kind === 'slot'
                      ? designModel.canMoveToPlace(dragging, row.place)
                      : designModel.canMoveTo(dragging, row.name, where),
                reason = refusal ?? issue?.message;
            this.verdicts.set(key, reason ? {where, reason} : {where});
        }
        return this.verdicts.get(key);
    }

    /** Drop the element dragged on a row, as one edit, if the row takes it. */
    drop(rowId: string, fraction: number) {
        const verdict = this.dropVerdict(rowId, fraction),
            row = this.rowData(rowId);
        if (!verdict || verdict.reason) return;
        const {designModel, dragging} = this,
            {issues} =
                row.kind === 'slot'
                    ? designModel.moveToPlace(dragging, row.place)
                    : designModel.moveTo(dragging, row.name, verdict.where),
            error = issues.find(it => it.severity === 'error');
        if (error) designModel.blueprintModel.showRefusal(error);
    }

    //------------------
    // Implementation
    //------------------
    @observable private accessor dragging: string = null;

    // A row's data, with a view's row standing for the widget it holds, as drag and hover take it.
    private rowData(rowId: string): PlainObject {
        const data = this.gridModel.store.getById(rowId)?.data;
        if (data?.kind !== 'view') return data;
        const component =
            this.designModel.blueprintModel.blueprint?.elements?.[data.element]?.component;
        return {...data, kind: 'element', name: data.element, component};
    }

    // Rows whose id matches the filter, with their ancestors. An empty slot shows only during a
    // drag, or under the selected element, so it is there as a target but quiet otherwise.
    private applyFilter() {
        const text = this.filterText?.trim().toLowerCase(),
            {dragging} = this,
            selected = this.designModel.selectedElementId;
        this.gridModel.store.setFilter(rec => {
            const {kind, name, place, empty} = rec.data;
            if (kind === 'slot' && empty && !dragging) {
                if (selected !== place.parent && selected !== place.of) return false;
            }
            return !text || String(name).toLowerCase().includes(text);
        });
    }
    private readonly verdicts = new Map<string, DropVerdict>();

    private selected(record: StoreRecord) {
        const {designModel} = this,
            {kind, name, place} = record?.data ?? {};
        if (kind === 'slot') {
            if (!isSamePlace(place, designModel.slotTarget)) designModel.selectSlot(place);
        } else if (kind === 'section') {
            // A section is not a part of the blueprint, so nothing stays selected for a key to act on.
            if (designModel.selection) designModel.select(null);
        } else if (kind === 'view') {
            const {selection} = designModel,
                {of} = record.data;
            const {element} = record.data;
            if (selection?.kind !== 'view' || selection.id !== element || selection.of !== of) {
                designModel.select({kind: 'view', id: element, of});
            }
        } else if (['element', 'source', 'variable', 'preset'].includes(kind)) {
            const {selection, slotTarget} = designModel;
            if (slotTarget || selection?.kind !== kind || selection.id !== name) {
                designModel.select({kind, id: name} as BlueprintSelection);
            }
        }
    }

    private showSelection() {
        const {selection, slotTarget} = this.designModel,
            id = slotTarget
                ? slotKey(slotTarget)
                : selection
                  ? `${selection.kind}:${selection.id}`
                  : null,
            {gridModel} = this;
        if (id === gridModel.selectedId) return;
        if (id && gridModel.store.getById(id)) {
            gridModel.selectAsync(id, {ensureVisible: true});
        } else {
            gridModel.clearSelection();
        }
    }

    private loadRows() {
        const {blueprintModel} = this.designModel,
            {blueprint, registry} = blueprintModel,
            {elements = {}, sources = {}, variables = {}, presets = {}, root} = blueprint ?? {},
            placed = new Set<string>(),
            elementRow = (id: string): PlainObject => {
                placed.add(id);
                const el = elements[id],
                    spec = registry.widgets[el.component],
                    groups = childGroups(id, el, spec),
                    live = (nodes: ChildNode[]) =>
                        nodes.filter(it => Object.hasOwn(elements, it.id) && !placed.has(it.id)),
                    nodeRow = (node: ChildNode): PlainObject => {
                        if (node.kind === 'element') return elementRow(node.id);
                        const ref = el.children.find(it => it.id === node.id),
                            [, ...slots] = node.groups;
                        return {
                            id: `view:${node.id}`,
                            name: viewTitle(ref, elements[node.id]),
                            label: 'View',
                            kind: 'view',
                            element: node.id,
                            of: id,
                            path: `/elements/${id}/children/${el.children.indexOf(ref)}`,
                            children: [
                                elementRow(node.id),
                                // A cell's slots, such as its header, sit under its view.
                                ...slots.map(it =>
                                    slotRow(
                                        {parent: id, slot: it.slot, of: node.id},
                                        it.refs.map(ref => ({kind: 'element', id: ref.id}))
                                    )
                                )
                            ]
                        };
                    },
                    slotRow = (place: AddPlace, nodes: ChildNode[]): PlainObject => ({
                        id: slotKey(place),
                        name: slotLabel(place.slot, !!place.of),
                        kind: 'slot',
                        place,
                        empty: !live(nodes).length,
                        children: live(nodes).map(nodeRow)
                    }),
                    children =
                        groups.length > 1
                            ? groups.map(it => slotRow({parent: id, slot: it.slot}, it.nodes))
                            : live(groups[0]?.nodes ?? []).map(nodeRow);
                return {
                    id: `element:${id}`,
                    name: id,
                    label: spec?.label ?? el.component,
                    kind: 'element',
                    component: el.component,
                    children
                };
            },
            elementRows = root && Object.hasOwn(elements, root) ? [elementRow(root)] : [],
            readers = (name: string) => this.designModel.sourceReaders(name).length,
            section = (kind: string, name: string, children: PlainObject[], count: number) => ({
                id: `section:${kind}`,
                name,
                kind: 'section',
                count,
                place: kind,
                children
            });
        this.gridModel.loadData([
            section('element', 'Elements', elementRows, placed.size),
            section(
                'source',
                'Sources',
                Object.entries(sources).map(([name, decl]) => {
                    const n = readers(name),
                        what = decl.dataset ?? (decl.artifact ? 'artifact' : 'inline');
                    return {
                        id: `source:${name}`,
                        name,
                        kind: 'source',
                        label: `${what} · ${n} widget${n === 1 ? '' : 's'}`
                    };
                }),
                Object.keys(sources).length
            ),
            section(
                'variable',
                'Variables',
                Object.entries(variables).map(([name, decl]) => {
                    const v = blueprintModel.getVariable(name);
                    return {
                        id: `variable:${name}`,
                        name,
                        kind: 'variable',
                        label: v ? variableText(v.value, decl.type) : null
                    };
                }),
                Object.keys(variables).length
            ),
            section(
                'preset',
                'Presets',
                Object.entries(presets).map(([name, decl]) => ({
                    id: `preset:${name}`,
                    name,
                    kind: 'preset',
                    label: decl.label
                })),
                Object.keys(presets).length
            )
        ]);
        this.showSelection();
    }

    // A row with its drag and drop, the drop marked on it as the pointer moves.
    private renderRow(record: StoreRecord): ReactElement {
        const {kind, name} = this.rowData(record.id as string),
            {blueprintModel} = this.designModel,
            canDrag =
                kind === 'element' &&
                blueprintModel.mode === 'design' &&
                blueprintModel.access === 'write',
            fractionOf = (e: React.DragEvent) => {
                const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
                return box.height ? (e.clientY - box.top) / box.height : 0.5;
            },
            clear = (el: HTMLElement) => {
                delete el.dataset.drop;
                el.removeAttribute('title');
            };
        return div({
            className: `${CLS}__drop`,
            draggable: canDrag,
            // An element's row marks it in the blueprint as the dashboard's hover does, where it shows.
            onMouseEnter: () => kind === 'element' && this.designModel.setHovered(name),
            onMouseLeave: () => {
                if (this.designModel.hoveredId === name) this.designModel.setHovered(null);
            },
            onDragStart: (e: React.DragEvent) => {
                this.startDrag(name);
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', name);
            },
            onDragEnd: () => this.endDrag(),
            onDragOver: (e: React.DragEvent) => {
                const verdict = this.dropVerdict(record.id as string, fractionOf(e)),
                    el = e.currentTarget as HTMLElement;
                if (!verdict) return;
                if (verdict.reason) {
                    // Not taken, so the pointer shows the drop is refused.
                    el.dataset.drop = 'refused';
                    el.title = verdict.reason;
                } else {
                    e.preventDefault();
                    el.dataset.drop = verdict.where;
                    el.removeAttribute('title');
                }
            },
            onDragLeave: (e: React.DragEvent) => clear(e.currentTarget as HTMLElement),
            onDrop: (e: React.DragEvent) => {
                e.preventDefault();
                clear(e.currentTarget as HTMLElement);
                this.drop(record.id as string, fractionOf(e));
                this.endDrag();
            },
            children: this.renderContent(record)
        });
    }

    private renderContent(record: StoreRecord): ReactElement {
        const {kind, name, label, count, place, component} = record.data,
            {designModel, onAdd} = this,
            {blueprintModel} = designModel;
        if (kind === 'section') {
            const canAdd =
                blueprintModel.mode === 'design' &&
                blueprintModel.access === 'write' &&
                (onAdd || place === 'variable');
            return hbox({
                className: `${CLS}__section`,
                children: [
                    span({className: `${CLS}__section-name`, children: name}),
                    filler(),
                    span({className: `${CLS}__count`, children: String(count)}),
                    canAdd
                        ? button({
                              icon: Icon.add(),
                              minimal: true,
                              title: `Add to ${name}`,
                              'aria-label': `Add to ${name}`,
                              onClick: e => {
                                  e.stopPropagation();
                                  this.addTo(place);
                              }
                          })
                        : null
                ]
            });
        }
        if (kind === 'slot') return span({className: `${CLS}__slot`, children: name});
        const base = kind === 'view' ? record.data.path : `/${COLLECTIONS[kind]}/${name}`,
            issues = blueprintModel.issues.filter(
                it => it.path === base || it.path?.startsWith(`${base}/`)
            );
        return hbox({
            className: classNames(
                `${CLS}__row`,
                (kind === 'element' || kind === 'view') &&
                    this.isOffscreen(record.data.element ?? name) &&
                    `${CLS}__row--offscreen`
            ),
            children: [
                kind === 'view'
                    ? Icon.window({className: `${CLS}__icon`})
                    : partIcon(kind, blueprintModel.registry.widgets[component], {
                          className: `${CLS}__icon`
                      }),
                span({className: `${CLS}__name`, children: name}),
                label ? span({className: `${CLS}__label`, children: label}) : null,
                issues.length
                    ? div({
                          className: classNames(
                              `${CLS}__issue`,
                              issues.some(it => it.severity === 'error') && `${CLS}__issue--error`
                          ),
                          title: issues.map(it => it.message).join('\n'),
                          role: 'img',
                          'aria-label': issueSummary(issues)
                      })
                    : null
            ]
        });
    }

    private addTo(section: StructureSection) {
        if (this.onAdd) {
            this.onAdd(section);
        } else if (section === 'variable') {
            this.designModel.addVariable();
        }
    }
}

//------------------
// Implementation
//------------------
const CLS = 'xh-blueprint-structure';

interface DropVerdict {
    where: 'into' | 'before' | 'after';
    reason?: string;
}

const COLLECTIONS = {
    element: 'elements',
    source: 'sources',
    variable: 'variables',
    preset: 'presets'
};

const slotKey = ({parent, slot, of}: AddPlace) => `slot:${parent}|${slot}|${of ?? ''}`;

const isSamePlace = (a: AddPlace, b: AddPlace) =>
    !!a && !!b && a.parent === b.parent && a.slot === b.slot && (a.of ?? null) === (b.of ?? null);
