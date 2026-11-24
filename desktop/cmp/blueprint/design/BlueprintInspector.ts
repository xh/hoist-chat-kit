import {div, filler, hbox, span, vframe} from '@xh/hoist/cmp/layout';
import {
    hoistCmp,
    HoistModel,
    type HoistProps,
    type PlainObject,
    useLocalModel
} from '@xh/hoist/core';
import {button} from '@xh/hoist/desktop/cmp/button';
import {textInput} from '@xh/hoist/desktop/cmp/input';
import {menuButton} from '@xh/hoist/desktop/cmp/menu';
import {menuItem, popover} from '@xh/hoist/kit/blueprint';
import {Icon} from '@xh/hoist/icon';
import {action, computed, observable} from '@xh/hoist/mobx';
import {useHotkeys} from '@xh/hoist/desktop/hooks';
import {useOnResize} from '@xh/hoist/utils/react';
import {isString, sum} from 'lodash';
import type React from 'react';
import {type ReactElement, type ReactNode, useEffect, useRef, useState} from 'react';
import {
    type BlueprintDesignModel,
    type BlueprintDocumentModel,
    type BlueprintIssue,
    type BlueprintSelection,
    type DesignAction,
    toEditorSpec,
    variableTypeLabel,
    wiringFor,
    type WiringRef
} from '../../../../blueprint';
import {
    type ChildNode,
    childGroups,
    slotLabel,
    viewTitle
} from '../../../../blueprint/impl/elements';
import {getOwn} from '../../../../blueprint/impl/pointer';
import {variableText} from '../../../../blueprint/impl/variableText';
import './BlueprintInspector.scss';
import {elementInspector} from './ElementInspector';
import {selectChip} from './impl/chips';
import {refuse, runDesignActionAsync, selectionMenu} from './impl/designActions';
import {inspectorHotkeys} from './impl/designHotkeys';
import {type CrumbChild, type CrumbGroup, crumbMenu} from './impl/crumbMenu';
import {partIcon} from './impl/icons';
import {presetsEditor} from './PresetsEditor';
import {sourcesEditor} from './SourcesEditor';
import {variablesEditor} from './VariablesEditor';
import {widgetPalette} from './WidgetPalette';

export interface BlueprintInspectorProps extends HoistProps {
    designModel: BlueprintDesignModel;
    /** As for `elementInspector`: open a preset group from a property's badge. */
    onShowPresetGroup?: (name: string) => void;
    /** The stored blueprint, whose name and description show with nothing selected. */
    documentModel?: Pick<BlueprintDocumentModel, 'document'>;
}

/**
 * One panel for whatever is selected: an element, a source, a variable or a preset group. Its frame
 * is the same for each: the element's path, each step selectable, then a header with the id,
 * which a click renames, what it is and what it reads, and a menu, then its issues, each with a
 * way to show it, then the editor for its kind.
 */
export const [BlueprintInspector, blueprintInspector] =
    hoistCmp.withFactory<BlueprintInspectorProps>({
        displayName: 'BlueprintInspector',
        className: 'xh-blueprint-inspector',
        model: false,
        render({designModel, onShowPresetGroup, documentModel, className}) {
            const impl = useLocalModel(() => new BlueprintInspectorModel(designModel)),
                {selection} = impl;
            return useHotkeys(
                selection
                    ? vframe({
                          className,
                          children: [
                              breadcrumb({impl}),
                              // A list item's page brings its own head, in place of the element's.
                              impl.onItemPage ? null : header({impl}),
                              ...impl.issues.map((it, idx) =>
                                  issueRow({key: idx, impl, issue: it})
                              ),
                              impl.onItemPage ? null : wiringCard({impl}),
                              div({
                                  className: `${CLS}__body`,
                                  children: editorFor(selection, designModel, onShowPresetGroup)
                              })
                          ]
                      })
                    : summary({className, impl, document: documentModel?.document}),
                inspectorHotkeys(designModel)
            );
        }
    });

/** @internal */
export class BlueprintInspectorModel extends HoistModel {
    /** True while the header's id is an input, to rename. */
    @observable accessor renaming = false;

    constructor(readonly designModel: BlueprintDesignModel) {
        super();
        this.addReaction({track: () => this.selection, run: () => this.setRenaming(false)});
    }

    /** The selection, if its target is still there. */
    get selection(): BlueprintSelection {
        return this.designModel.selection;
    }

    /** The list and item of the element's open item page, as its breadcrumb names them, or null. */
    pageCrumbs(id: string): {list: string; item: string; inner: string} {
        const page = this.designModel.itemPage;
        if (page?.element !== id) return null;
        const {blueprintModel} = this.designModel,
            element = blueprintModel.blueprint?.elements?.[id],
            spec = blueprintModel.registry.widgets[element?.component],
            list = toEditorSpec(spec?.config).find(it => it.key === page.list),
            field = page.key.replace(/#\d+$/, ''),
            source = blueprintModel.getSource(element?.config?.source);
        return {
            list: list?.label ?? page.list,
            item: page.label ?? source?.fieldLabel(field) ?? field,
            inner: page.inner ? (page.inner.label ?? page.inner.key) : null
        };
    }

    /**
     * An element's ancestors and itself, root first, with the view before each that sits in one.
     * A view's path ends with the view. Empty for other kinds.
     */
    @computed
    /** True while a list item's page of the selected element shows in the body. */
    get onItemPage(): boolean {
        const {itemPage, sourcePage, selection} = this.designModel;
        return (
            (!!itemPage && selection?.kind === 'element' && itemPage.element === selection.id) ||
            (!!sourcePage && selection?.kind === 'source' && sourcePage.source === selection.id)
        );
    }

    get breadcrumb(): BlueprintSelection[] {
        const {selection, designModel} = this;
        if (selection?.kind !== 'element' && selection?.kind !== 'view') return [];
        const ret = [...designModel.pathTo(selection.id), selection.id].flatMap(id => {
            const view = designModel.viewOf(id);
            return [
                ...(view ? [{kind: 'view', ...view} as BlueprintSelection] : []),
                {kind: 'element', id} as BlueprintSelection
            ];
        });
        return selection.kind === 'view' ? ret.slice(0, -1) : ret;
    }

    /** What the selection is, and what it reads. */
    @computed
    get subtitle(): string {
        const {selection, designModel} = this;
        if (!selection) return null;
        const {blueprint, registry} = designModel.blueprintModel,
            {id} = selection;
        if (selection.kind === 'view') return `View · holds ${id} · in ${selection.of}`;
        const what =
                selection.kind === 'element'
                    ? (registry.widgets[blueprint.elements[id]?.component]?.label ??
                      blueprint.elements[id]?.component)
                    : selection.kind === 'source'
                      ? blueprint.sources[id]?.dataset
                          ? `dataset ${blueprint.sources[id].dataset}`
                          : null
                      : selection.kind === 'variable'
                        ? this.variableWhat(id)
                        : blueprint.presets?.[id]?.label,
            reads = wiringFor(blueprint, selection, designModel.wiring).reads.map(it => it.id);
        return [what, reads.length ? `reads ${reads.join(', ')}` : null]
            .filter(Boolean)
            .join(' · ');
    }

    // A variable's type in users' words, then what sets it.
    private variableWhat(name: string): string {
        const {blueprint, registry} = this.designModel.blueprintModel,
            decl = blueprint.variables[name];
        if (!decl) return null;
        const writers = wiringFor(blueprint, {kind: 'variable', id: name}, this.designModel.wiring)
                .setBy.filter(it => it.kind === 'element')
                .map(it => it.id),
            setBy =
                decl.setBy === 'prompt'
                    ? 'prompt'
                    : decl.setBy === 'host'
                      ? 'set by the app'
                      : decl.setBy === 'resolver'
                        ? `computed by ${decl.compute?.resolver}`
                        : writers.length
                          ? `set by ${writers.join(', ')}`
                          : decl.setBy
                            ? null
                            : 'constant';
        return [variableTypeLabel(registry, decl.type), setBy].filter(Boolean).join(' · ');
    }

    /**
     * What the selection reads and sets, and what reads and sets it, as rows of chips that each
     * select their target: Reads, Sets and Presets for an element; Set by, Read by and Now for a
     * variable; Read by and Waits for a source; Controls and Shown by for a preset group.
     */
    @computed
    get wiringRows(): WiringRow[] {
        const {selection, designModel} = this;
        if (!selection) return [];
        const {blueprintModel} = designModel,
            w = wiringFor(blueprintModel.blueprint, selection, designModel.wiring),
            chip = (
                ref: WiringRef,
                text = ref.label ?? ref.id,
                kind: string = ref.kind
            ): WiringChip => ({
                text,
                kind,
                ...(['element', 'source', 'variable', 'preset'].includes(ref.kind)
                    ? {
                          select: () =>
                              designModel.select({
                                  kind: ref.kind,
                                  id: ref.id
                              } as BlueprintSelection)
                      }
                    : {})
            }),
            row = (
                label: string,
                refs: WiringRef[],
                text?: (ref: WiringRef) => string,
                kind?: string
            ) => (refs.length ? [{label, chips: refs.map(it => chip(it, text?.(it), kind))}] : []);
        switch (selection.kind) {
            case 'element':
                return [
                    ...row('Reads', w.reads),
                    // What an element sets draws as an output.
                    ...row('Sets', w.sets, undefined, 'set'),
                    ...row('Presets', w.presets)
                ];
            case 'variable': {
                const v = blueprintModel.getVariable(selection.id);
                return [
                    ...row('Set by', w.setBy, it =>
                        it.kind === 'prompt'
                            ? 'prompt'
                            : it.kind === 'resolver'
                              ? `${it.id}()`
                              : it.id
                    ),
                    ...row('Read by', w.readBy),
                    {label: 'Now', text: (v && variableText(v.value, v.decl.type)) || 'not set'}
                ];
            }
            case 'source':
                return [...row('Read by', w.readBy), ...row('Waits', w.waitsFor)];
            case 'preset':
                return [
                    ...row('Controls', w.presets, it => `${it.id} · ${it.path?.split('/').at(-1)}`),
                    ...row('Shown by', w.readBy)
                ];
        }
        return [];
    }

    /** The issues at the selection's path, or inside it. */
    get issues(): BlueprintIssue[] {
        const {selection, designModel} = this;
        if (!selection) return [];
        const {children} = designModel.blueprintModel.blueprint?.elements?.[selection.of] ?? {},
            base =
                selection.kind === 'view'
                    ? `/elements/${selection.of}/children/${children?.findIndex(it => it.id === selection.id)}`
                    : `/${COLLECTIONS[selection.kind]}/${selection.id}`;
        return designModel.blueprintModel.issues.filter(
            it => it.path === base || it.path?.startsWith(`${base}/`)
        );
    }

    get canEdit(): boolean {
        const {mode, access} = this.designModel.blueprintModel;
        return mode === 'design' && access === 'write';
    }

    @action
    setRenaming(renaming: boolean) {
        this.renaming = renaming && this.canEdit && this.selection?.kind !== 'preset';
    }

    /** Rename the selection's id, as one edit, or show why it cannot. */
    rename(to: string) {
        const {selection, designModel} = this;
        // An input cancelled with Escape still commits as it blurs on its way out.
        if (!this.renaming) return;
        this.setRenaming(false);
        if (!selection || !to || to === selection.id) return;
        if (selection.kind === 'preset' || selection.kind === 'view') return;
        refuse(designModel, designModel.renameId(selection.kind, selection.id, to).issues);
    }
}

//------------------
// Implementation
//------------------
const CLS = 'xh-blueprint-inspector',
    VIEW = 'view:';

/** A wire's other end, which selects it when it is part of the blueprint. */
export interface WiringChip {
    text: string;
    /** What it names, for its color: `element`, `source`, `variable`, `preset`, or `set`. */
    kind?: string;
    select?: () => void;
}

/** A row of the wiring card: chips, or a text such as a variable's value now. */
export interface WiringRow {
    label: string;
    chips?: WiringChip[];
    text?: string;
}

const COLLECTIONS = {
    element: 'elements',
    source: 'sources',
    variable: 'variables',
    preset: 'presets'
};

function editorFor(
    {kind}: BlueprintSelection,
    designModel: BlueprintDesignModel,
    onShowPresetGroup: (name: string) => void
) {
    switch (kind) {
        case 'element':
        case 'view':
            return elementInspector({designModel, onShowPresetGroup, framed: true});
        case 'source':
            return sourcesEditor({designModel, framed: true});
        case 'variable':
            return variablesEditor({designModel, framed: true});
        case 'preset':
            return presetsEditor({designModel, framed: true});
    }
}

const breadcrumb = hoistCmp.factory<HoistProps & {impl: BlueprintInspectorModel}>({
    displayName: 'BlueprintInspectorBreadcrumb',
    model: false,
    render({impl}) {
        const [width, setWidth] = useState(0),
            ref = useOnResize(({width}) => setWidth(width)),
            {breadcrumb: path, designModel} = impl,
            {blueprint, registry} = designModel.blueprintModel,
            specOf = (id: string) => registry.widgets[blueprint.elements[id]?.component],
            kindOf = (step: BlueprintSelection) =>
                step.kind === 'view' ? 'view' : specOf(step.id)?.label,
            last = path.length - 1;
        const elements = blueprint.elements,
            groupsOf = (id: string) => childGroups(id, getOwn(elements, id), specOf(id)),
            // A menu names a view by its element's ID after `view:`, unique as IDs hold no colon.
            menuId = (step: {kind: string; id: string}) =>
                step.kind === 'view' ? `${VIEW}${step.id}` : step.id,
            elementOf = (id: string) => (id?.startsWith(VIEW) ? id.slice(VIEW.length) : id),
            // A view's groups: its widget, then its own slots, such as a cell's header items.
            viewGroups = (id: string) =>
                groupsOf(designModel.viewOf(id)?.of)
                    .flatMap(it => it.nodes)
                    .find(it => it.kind === 'view' && it.id === id)
                    ?.groups.map(it => ({
                        slot: it.slot,
                        nodes: it.refs.map((ref): ChildNode => ({kind: 'element', id: ref.id}))
                    })) ?? [],
            hasMenu = (step: BlueprintSelection) =>
                step.kind === 'view' || (step.kind === 'element' && groupsOf(step.id).length > 0),
            page = path[last]?.kind === 'element' ? impl.pageCrumbs(path[last].id) : null,
            trailing = !page && path.length > 0 && hasMenu(path[last]);
        if (path.length < 2 && !trailing && !page) return null;
        const {shown, hidden} = foldCrumbs(
                path.map((step, idx) => crumbWidth(step.id, idx === last ? kindOf(step) : null)),
                width - BREADCRUMB_PADDING,
                trailing
            ),
            child = (node: ChildNode, of: string): CrumbChild => {
                if (node.kind === 'view') {
                    const ref = elements[of].children?.find(it => it.id === node.id);
                    return {
                        id: menuId(node),
                        icon: Icon.window(),
                        text: viewTitle(ref, elements[node.id]),
                        label: 'View',
                        hasChildren: true
                    };
                }
                const ref = of ? elements[of].children?.find(it => it.id === node.id) : null;
                return {
                    id: node.id,
                    icon: partIcon('element', specOf(node.id)),
                    text: isString(ref?.title) ? ref.title : node.id,
                    label: specOf(node.id)?.label,
                    hasChildren: groupsOf(node.id).length > 0
                };
            },
            childrenOf = (id: string): CrumbGroup[] => {
                const isView = id.startsWith(VIEW),
                    elId = elementOf(id),
                    groups = (isView ? viewGroups(elId) : groupsOf(elId))
                        .map(it => ({...it, nodes: it.nodes.filter(n => getOwn(elements, n.id))}))
                        .filter(it => it.nodes.length);
                return groups.map(group => ({
                    heading: groups.length > 1 ? slotLabel(group.slot, isView) : null,
                    // A view's own rows are its widget and header items, titled by their IDs.
                    children: group.nodes.map(it => child(it, isView ? null : elId))
                }));
            },
            selectChild = (id: string) => {
                const elId = elementOf(id),
                    view = id.startsWith(VIEW) ? designModel.viewOf(elId) : null;
                designModel.select(view ? {kind: 'view', ...view} : {kind: 'element', id: elId});
            },
            // A chevron after a container or a view opens its children. Any other is a plain
            // separator.
            separatorAfter = (step: BlueprintSelection, key: string) =>
                step && hasMenu(step)
                    ? crumbMenu({
                          key,
                          id: menuId(step),
                          className: `${CLS}__crumb-sep ${CLS}__crumb-sep--menu`,
                          menuClassName: `${CLS}__crumb-menu`,
                          // The Inspector sits at the right, so each submenu opens to the left.
                          submenuPlacement: 'left-start',
                          title: `Children of ${step.id}${step.kind === 'view' ? ' view' : ''}`,
                          childrenOf,
                          onSelect: selectChild,
                          onHover: id => designModel.setHovered(elementOf(id)),
                          emptyItems: (id, close) => addItems(designModel, id, close)
                      })
                    : separator(key),
            keyOf = (step: BlueprintSelection) => `${step.kind}:${step.id}`,
            icon = (step: BlueprintSelection) =>
                step.kind === 'view'
                    ? Icon.window({className: `${CLS}__crumb-icon`})
                    : partIcon('element', specOf(step.id), {className: `${CLS}__crumb-icon`}),
            select = (step: BlueprintSelection) => designModel.select(step),
            steps = shown.flatMap((idx, at) => {
                const step = path[idx],
                    kind = kindOf(step),
                    crumb =
                        idx === last && !page
                            ? span({
                                  key: keyOf(step),
                                  className: `${CLS}__crumb ${CLS}__crumb--current`,
                                  title: step.id,
                                  children: [
                                      icon(step),
                                      span({className: `${CLS}__crumb-id`, children: step.id}),
                                      kind
                                          ? span({className: `${CLS}__crumb-kind`, children: kind})
                                          : null
                                  ]
                              })
                            : crumbLink({
                                  key: keyOf(step),
                                  title: `Select ${step.id}${step.kind === 'view' ? ' view' : ''}`,
                                  icon: icon(step),
                                  onClick: () => select(step),
                                  text: [
                                      step.id,
                                      step.kind === 'view'
                                          ? span({
                                                key: 'kind',
                                                className: `${CLS}__crumb-kind`,
                                                children: 'view'
                                            })
                                          : null
                                  ]
                              }),
                    // The steps folded away sit between the first and the rest, in a menu.
                    fold =
                        at === 1 && hidden.length
                            ? [
                                  menuButton({
                                      key: '_more',
                                      className: `${CLS}__crumb ${CLS}__crumb--more`,
                                      icon: Icon.ellipsisHorizontal(),
                                      title: 'More of the path',
                                      minimal: true,
                                      menuItems: hidden.map(i => ({
                                          text:
                                              path[i].kind === 'view'
                                                  ? `${path[i].id} view`
                                                  : path[i].id,
                                          icon: icon(path[i]),
                                          actionFn: () => select(path[i])
                                      }))
                                  }),
                                  separatorAfter(path[hidden.at(-1)], '_more-sep')
                              ]
                            : [];
                return [
                    // Keyed by the step it follows, so picking from its menu keeps its focus.
                    ...(at
                        ? [separatorAfter(path[shown[at - 1]], `${keyOf(path[shown[at - 1]])}-sep`)]
                        : []),
                    ...fold,
                    crumb
                ];
            });
        // An open list item's page adds its list, which goes back to it, and the item itself.
        const pageSteps = page
            ? [
                  separator('_list-sep'),
                  crumbLink({
                      key: '_list',
                      title: `Back to ${page.list}`,
                      onClick: () => designModel.closeItemPage(),
                      text: page.list
                  }),
                  separator('_item-sep'),
                  page.inner
                      ? crumbLink({
                            key: '_item',
                            title: `Back to ${page.item}`,
                            onClick: () => designModel.closeInnerPage(),
                            text: page.item
                        })
                      : span({
                            key: '_item',
                            className: `${CLS}__crumb ${CLS}__crumb--current`,
                            title: page.item,
                            children: span({className: `${CLS}__crumb-id`, children: page.item})
                        }),
                  ...(page.inner
                      ? [
                            separator('_inner-sep'),
                            span({
                                key: '_inner',
                                className: `${CLS}__crumb ${CLS}__crumb--current`,
                                title: page.inner,
                                children: span({
                                    className: `${CLS}__crumb-id`,
                                    children: page.inner
                                })
                            })
                        ]
                      : [])
              ]
            : [];
        return hbox({
            ref,
            className: `${CLS}__breadcrumb`,
            children: [
                ...steps,
                ...pageSteps,
                ...(trailing ? [separatorAfter(path[last], `${keyOf(path[last])}-sep`)] : [])
            ]
        });
    }
});

const separator = (key: string) =>
    span({key, className: `${CLS}__crumb-sep`, children: Icon.chevronRight()});

// An empty container's way to add a child: Add, targeted at it, as its own design action opens.
function addItems(designModel: BlueprintDesignModel, id: string, close: () => void) {
    const add = designModel.designActions({kind: 'element', id}).find(it => it.id === 'addWidget');
    if (!add) return [];
    return [
        menuItem({
            key: '_add',
            icon: Icon.add(),
            text: 'Add…',
            onClick: () => {
                close();
                runDesignActionAsync(designModel, id, add);
            }
        })
    ];
}

/**
 * Which steps of a path show, by index, with the widths given, in the width available: all of
 * them if they fit or the width is unknown, else the first and last with as many before the last
 * as fit, and a fold for the rest. `trailing` keeps room for a chevron after the last step.
 * @internal
 */
export function foldCrumbs(
    widths: number[],
    available: number,
    trailing = false
): {shown: number[]; hidden: number[]} {
    const all = widths.map((_, idx) => idx),
        total = sum(widths) + (widths.length - (trailing ? 0 : 1)) * CRUMB_SEP;
    if (available <= 0 || widths.length < 3 || total <= available) return {shown: all, hidden: []};
    const last = widths.length - 1,
        shown = [0, last];
    let used = widths[0] + widths[last] + (trailing ? 3 : 2) * CRUMB_SEP + CRUMB_MORE;
    for (let idx = last - 1; idx > 0 && used + widths[idx] + CRUMB_SEP <= available; idx--) {
        used += widths[idx] + CRUMB_SEP;
        shown.splice(1, 0, idx);
    }
    return {shown, hidden: all.filter(it => !shown.includes(it))};
}

// A step's width, from its id in the mono face, its icon and padding, and any kind label.
const crumbWidth = (id: string, kind: string) =>
    CRUMB_CHROME + id.length * 7 + (kind ? 6 + kind.length * 6 : 0);

const CRUMB_CHROME = 32,
    CRUMB_SEP = 22,
    CRUMB_MORE = 30,
    BREADCRUMB_PADDING = 20;

const header = hoistCmp.factory<HoistProps & {impl: BlueprintInspectorModel}>({
    displayName: 'BlueprintInspectorHeader',
    model: false,
    render({impl}) {
        const {selection, designModel} = impl,
            actions = designModel.designActions(selection),
            // + adds after the selection where it can, else inside it. The other stays in ⋯.
            add =
                actions.find(it => it.id === 'addAfter') ??
                actions.find(it => it.id === 'addWidget'),
            items = selectionMenu(designModel, selection, add?.id),
            renameRef = useRef<HTMLInputElement>(null);
        // Focused and selected as it appears, so typing replaces the id and Enter or Esc acts.
        useEffect(() => {
            if (impl.renaming) {
                renameRef.current?.focus();
                renameRef.current?.select();
            }
        }, [impl.renaming]);
        return hbox({
            className: `${CLS}__header`,
            children: [
                div({
                    className: `${CLS}__titles`,
                    children: [
                        impl.renaming
                            ? textInput({
                                  key: selection.id,
                                  className: `${CLS}__rename`,
                                  value: selection.id,
                                  inputRef: renameRef,
                                  width: '100%',
                                  onCommit: (to: string) => impl.rename(to),
                                  onKeyDown: (e: KeyboardEvent) => {
                                      if (e.key === 'Escape') impl.setRenaming(false);
                                  }
                              })
                            : impl.canEdit && selection.kind !== 'preset'
                              ? button({
                                    className: `${CLS}__id`,
                                    text: selection.id,
                                    minimal: true,
                                    title: 'Rename',
                                    'aria-label': `Rename ${selection.id}`,
                                    onClick: () => impl.setRenaming(true)
                                })
                              : span({className: `${CLS}__id`, children: selection.id}),
                        impl.subtitle
                            ? div({className: `${CLS}__subtitle`, children: impl.subtitle})
                            : null
                    ]
                }),
                filler(),
                selection.kind === 'element'
                    ? button({
                          icon: Icon.search(),
                          minimal: true,
                          title: 'Find a setting · /',
                          'aria-label': 'Find a setting',
                          active: designModel.findOpen,
                          onClick: () => (designModel.findOpen = !designModel.findOpen)
                      })
                    : null,
                add
                    ? addWidgetButton({
                          designModel,
                          id: selection.id,
                          action: add,
                          buttonProps: {
                              icon: Icon.add(),
                              minimal: true,
                              title: add.label,
                              'aria-label': add.label
                          }
                      })
                    : null,
                items.length
                    ? menuButton({
                          icon: Icon.ellipsisHorizontal(),
                          minimal: true,
                          title: 'More',
                          'aria-label': 'More',
                          menuItems: () =>
                              selectionMenu(designModel, impl.selection, add?.id) as any[]
                      })
                    : null
            ]
        });
    }
});

// A button that offers the widgets a place takes, in a popover at the button: searchable, each
// with its picture, any it refuses disabled with the reason. A pick adds there and closes it, and
// the Add pane stays a way to more.
const addWidgetButton = hoistCmp.factory<
    HoistProps & {
        designModel: BlueprintDesignModel;
        id: string;
        action: DesignAction;
        buttonProps: PlainObject;
    }
>({
    displayName: 'BlueprintAddWidgetButton',
    model: false,
    render({designModel, id, action, buttonProps}) {
        const [isOpen, setIsOpen] = useState(false);
        return popover({
            isOpen,
            onInteraction: (open: boolean) => setIsOpen(open),
            position: 'bottom-left',
            minimal: true,
            popoverClassName: `${CLS}__add-popover`,
            item: button({...buttonProps, onClick: () => setIsOpen(!isOpen)}),
            content: div({
                className: `${CLS}__add-panel`,
                children: [
                    widgetPalette({
                        designModel,
                        place: action.place,
                        onAdded: () => setIsOpen(false)
                    }),
                    div({
                        className: `${CLS}__add-footer`,
                        children: button({
                            text: 'More in Add pane',
                            icon: Icon.arrowRight(),
                            minimal: true,
                            onClick: () => {
                                setIsOpen(false);
                                runDesignActionAsync(designModel, id, action);
                            }
                        })
                    })
                ]
            })
        });
    }
});

// The blueprint as a whole, with nothing selected: its name and description, what it holds, and
// its root.
const summary = hoistCmp.factory<
    HoistProps & {
        impl: BlueprintInspectorModel;
        document: {name?: string; description?: string};
        onKeyDown?: React.KeyboardEventHandler;
        onKeyUp?: React.KeyboardEventHandler;
    }
>({
    displayName: 'BlueprintInspectorSummary',
    model: false,
    // Takes the Inspector's hotkey handlers onto its frame.
    render({impl, document, className, onKeyDown, onKeyUp}) {
        const {blueprint, registry} = impl.designModel.blueprintModel,
            {elements = {}, sources = {}, variables = {}, presets = {}, root} = blueprint ?? {},
            count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;
        return vframe({
            className: `${className} ${CLS}--summary`,
            onKeyDown,
            onKeyUp,
            children: [
                div({className: `${CLS}__summary-name`, children: document?.name ?? 'Blueprint'}),
                document?.description
                    ? div({className: `${CLS}__subtitle`, children: document.description})
                    : null,
                div({
                    className: `${CLS}__summary-counts`,
                    children: [
                        count(Object.keys(elements).length, 'element'),
                        count(Object.keys(sources).length, 'source'),
                        count(Object.keys(variables).length, 'variable'),
                        count(Object.keys(presets).length, 'preset group')
                    ].join(' · ')
                }),
                root && elements[root]
                    ? hbox({
                          className: `${CLS}__wiring-row`,
                          children: [
                              span({className: `${CLS}__wiring-label`, children: 'Root'}),
                              selectChip({
                                  className: `${CLS}__chip ${CLS}__chip--element`,
                                  text: root,
                                  label: `Select ${root}`,
                                  onSelect: () =>
                                      impl.designModel.select({kind: 'element', id: root})
                              }),
                              span({
                                  className: `${CLS}__subtitle`,
                                  children: registry.widgets[elements[root].component]?.label
                              })
                          ]
                      })
                    : null
            ]
        });
    }
});

const wiringCard = hoistCmp.factory<HoistProps & {impl: BlueprintInspectorModel}>({
    displayName: 'BlueprintInspectorWiring',
    model: false,
    render({impl}) {
        const rows = impl.wiringRows;
        if (!rows.length) return null;
        return div({
            className: `${CLS}__wiring`,
            children: rows.map(({label, chips, text}) =>
                hbox({
                    key: label,
                    className: `${CLS}__wiring-row`,
                    role: 'group',
                    'aria-label': label,
                    children: [
                        span({className: `${CLS}__wiring-label`, children: label}),
                        div({
                            className: `${CLS}__chips`,
                            children: chips
                                ? chips.map((it, idx) =>
                                      it.select
                                          ? selectChip({
                                                key: idx,
                                                className: `${CLS}__chip`,
                                                kind: it.kind,
                                                text: it.text,
                                                label: `Select ${it.text}`,
                                                onSelect: it.select
                                            })
                                          : span({
                                                key: idx,
                                                className: `${CLS}__chip ${CLS}__chip--plain`,
                                                children: it.text
                                            })
                                  )
                                : span({className: `${CLS}__wiring-text`, children: text})
                        })
                    ]
                })
            )
        });
    }
});

const issueRow = hoistCmp.factory<
    HoistProps & {impl: BlueprintInspectorModel; issue: BlueprintIssue}
>({
    displayName: 'BlueprintInspectorIssue',
    model: false,
    render({impl, issue}) {
        return hbox({
            className: `${CLS}__issue ${CLS}__issue--${issue.severity}`,
            children: [
                span({children: issue.message}),
                filler(),
                button({
                    text: 'Show',
                    minimal: true,
                    onClick: () => impl.designModel.revealIssue(issue)
                })
            ]
        });
    }
});

// A step of the path that goes to it, as a minimal Hoist button.
function crumbLink(props: {
    key: string;
    title: string;
    icon?: ReactElement;
    text: ReactNode;
    onClick: () => void;
}) {
    return button({
        ...props,
        className: `${CLS}__crumb ${CLS}__crumb--link`,
        minimal: true,
        small: true
    });
}
