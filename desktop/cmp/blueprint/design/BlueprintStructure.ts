import {grid, GridModel} from '@xh/hoist/cmp/grid';
import {div, filler, hbox, span} from '@xh/hoist/cmp/layout';
import {
    hoistCmp,
    HoistModel,
    type HoistProps,
    managed,
    type PlainObject,
    useLocalModel,
    XH
} from '@xh/hoist/core';
import type {StoreRecord} from '@xh/hoist/data';
import {button} from '@xh/hoist/desktop/cmp/button';
import {textInput} from '@xh/hoist/desktop/cmp/input';
import {panel} from '@xh/hoist/desktop/cmp/panel';
import {Icon} from '@xh/hoist/icon';
import {bindable} from '@xh/hoist/mobx';
import classNames from 'classnames';
import type {ReactElement} from 'react';
import type {
    AddPlace,
    BlueprintDesignModel,
    BlueprintIssue,
    BlueprintSelection
} from '../../../../blueprint';
import {slotLabel, slotLists} from '../../../../blueprint/impl/elements';
import {variableText} from '../../../../blueprint/impl/variableText';
import './BlueprintStructure.scss';
import {duplicateElement, removeElementAsync} from './impl/designActions';
import {designHotkeys} from './impl/designHotkeys';

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
            hideHeaders: true,
            expandLevel: 3,
            emptyText: 'Nothing matches.',
            store: {fields: ['name', 'label', 'kind', 'count', 'place', 'component']},
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
                track: () => this.filterText,
                run: text =>
                    this.gridModel.store.setFilter(
                        text ? {field: 'name', op: 'like', value: text} : null
                    )
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

    /** The menu of a row: rename, duplicate, move, add into and delete, as its kind allows. */
    menuFor(record: StoreRecord): (PlainObject | string)[] {
        const {designModel} = this,
            {kind, name} = record.data,
            isWriter =
                designModel.blueprintModel.mode === 'design' &&
                designModel.blueprintModel.access === 'write',
            refuse = (issues: BlueprintIssue[]) => {
                const error = issues.find(it => it.severity === 'error');
                if (error) designModel.blueprintModel.showRefusal(error);
            },
            remove = {
                text: 'Delete',
                icon: Icon.delete(),
                intent: 'danger',
                disabled: !isWriter
            };
        if (!isWriter || !['element', 'source', 'variable', 'preset'].includes(kind)) return [];
        const rename = {
            text: 'Rename…',
            disabled: kind === 'preset',
            actionFn: async () => {
                const to = await XH.prompt<string>({
                    title: 'Rename',
                    message: `New id for ${name}`,
                    input: {initialValue: name}
                });
                if (to && to !== name) refuse(designModel.renameId(kind, name, to).issues);
            }
        };
        if (kind !== 'element') {
            return [
                rename,
                '-',
                {
                    ...remove,
                    actionFn: () =>
                        refuse(
                            (kind === 'source'
                                ? designModel.removeSource(name)
                                : kind === 'variable'
                                  ? designModel.removeVariable(name)
                                  : designModel.removePresetGroup(name)
                            ).issues
                        )
                }
            ];
        }
        const {registry} = designModel.blueprintModel,
            labelOf = (it: string) => registry.widgets[it]?.label ?? it,
            parent = designModel.pathTo(name).at(-1);
        return [
            rename,
            {
                text: 'Duplicate',
                icon: Icon.copy(),
                actionFn: () => duplicateElement(designModel, name)
            },
            {
                text: 'Move to',
                disabled: !parent,
                items: designModel.slotsFor(name).map(({slot, of}) => ({
                    text: of ? `${of} · ${slotLabel(slot, true)}` : slotLabel(slot),
                    actionFn: () => refuse(designModel.moveToSlot(name, slot, of).issues)
                }))
            },
            {
                text: 'Add child',
                items: designModel.addPlacesFor(name).flatMap(({place, label, widgets}) => [
                    {text: label, disabled: true},
                    ...widgets.map(it => ({
                        text: labelOf(it),
                        actionFn: () => this.add(it, place)
                    }))
                ])
            },
            '-',
            {
                ...remove,
                actionFn: () => removeElementAsync(designModel, name).then(refuse)
            }
        ];
    }

    //------------------
    // Implementation
    //------------------
    private add(widget: string, {parent, slot, of}: AddPlace) {
        const {designModel} = this,
            {id, issues} = designModel.addWidget(widget, parent, {
                ...(slot && slot !== 'children' ? {slot} : {}),
                ...(of ? {of} : {})
            }),
            error = issues.find(it => it.severity === 'error');
        if (error) {
            designModel.blueprintModel.showRefusal(error);
        } else {
            designModel.select({kind: 'element', id});
        }
    }

    private selected(record: StoreRecord) {
        const {designModel} = this,
            {kind, name, place} = record?.data ?? {};
        if (kind === 'slot') {
            if (!isSamePlace(place, designModel.slotTarget)) designModel.selectSlot(place);
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
                    own = slotLists(el).filter(it => !it.of),
                    ownSlots = [
                        ...(spec?.children ? ['children'] : []),
                        ...Object.keys(spec?.slots ?? {})
                    ],
                    cellSlots = Object.keys(spec?.children?.slots ?? {}),
                    refsOf = (slot: string, of?: string) =>
                        (
                            slotLists(el).find(it => it.slot === slot && it.of === of)?.refs ?? []
                        ).filter(it => Object.hasOwn(elements, it.id) && !placed.has(it.id)),
                    childRow = (childId: string): PlainObject => {
                        const row = elementRow(childId);
                        // A cell's slots, such as its header, sit under its element.
                        const cells = cellSlots.map(slot =>
                            slotRow({parent: id, slot, of: childId}, refsOf(slot, childId))
                        );
                        return {...row, children: [...cells, ...row.children]};
                    },
                    slotRow = (place: AddPlace, refs: {id: string}[]): PlainObject => ({
                        id: slotKey(place),
                        name: slotLabel(place.slot, !!place.of),
                        kind: 'slot',
                        place,
                        children: refs.map(it => childRow(it.id))
                    }),
                    children =
                        ownSlots.length > 1
                            ? ownSlots.map(slot => slotRow({parent: id, slot}, refsOf(slot)))
                            : own
                                  .flatMap(it => it.refs)
                                  .filter(
                                      ref => Object.hasOwn(elements, ref.id) && !placed.has(ref.id)
                                  )
                                  .map(ref => childRow(ref.id));
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
            readers = (name: string) =>
                Object.values(elements).filter(it => it.config?.source === name).length,
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

    private renderRow(record: StoreRecord): ReactElement {
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
                    span({className: `${CLS}__count`, children: String(count)}),
                    filler(),
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
        const base = `/${COLLECTIONS[kind]}/${name}`,
            issues = blueprintModel.issues.filter(
                it => it.path === base || it.path?.startsWith(`${base}/`)
            );
        return hbox({
            className: `${CLS}__row`,
            children: [
                iconFor(kind, component, blueprintModel.registry.widgets[component]?.category),
                span({className: `${CLS}__name`, children: name}),
                label ? span({className: `${CLS}__label`, children: label}) : null,
                issues.length
                    ? div({
                          className: classNames(
                              `${CLS}__issue`,
                              issues.some(it => it.severity === 'error') && `${CLS}__issue--error`
                          ),
                          title: issues.map(it => it.message).join('\n')
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

const COLLECTIONS = {
    element: 'elements',
    source: 'sources',
    variable: 'variables',
    preset: 'presets'
};

const slotKey = ({parent, slot, of}: AddPlace) => `slot:${parent}|${slot}|${of ?? ''}`;

const isSamePlace = (a: AddPlace, b: AddPlace) =>
    !!a && !!b && a.parent === b.parent && a.slot === b.slot && (a.of ?? null) === (b.of ?? null);

function iconFor(kind: string, component: string, category: string) {
    const className = `${CLS}__icon`;
    switch (kind) {
        case 'source':
            return Icon.database({className});
        case 'variable':
            return Icon.tag({className});
        case 'preset':
            return Icon.gear({className});
    }
    if (component === 'cubeGrid') return Icon.grid({className});
    return (CATEGORY_ICONS[category] ?? Icon.square)({className});
}

const CATEGORY_ICONS: Record<string, (p?: PlainObject) => ReactElement> = {
    container: Icon.folder,
    layout: Icon.square,
    content: Icon.code,
    data: Icon.chartBar,
    input: Icon.edit,
    action: Icon.bolt
};
