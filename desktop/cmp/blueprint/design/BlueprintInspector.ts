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
import {toolbar} from '@xh/hoist/desktop/cmp/toolbar';
import {menuItem, popover} from '@xh/hoist/kit/blueprint';
import {Icon} from '@xh/hoist/icon';
import {action, computed, observable} from '@xh/hoist/mobx';
import {useOnResize} from '@xh/hoist/utils/react';
import {isString, partition, sum} from 'lodash';
import type React from 'react';
import {useEffect, useRef, useState} from 'react';
import {
    type BlueprintDesignModel,
    type BlueprintDocumentModel,
    type BlueprintIssue,
    type BlueprintSelection,
    type DesignAction,
    variableTypeLabel,
    wiringFor,
    type WiringRef
} from '../../../../blueprint';
import {childGroups, slotLabel} from '../../../../blueprint/impl/elements';
import {getOwn} from '../../../../blueprint/impl/pointer';
import {variableText} from '../../../../blueprint/impl/variableText';
import './BlueprintInspector.scss';
import {elementInspector} from './ElementInspector';
import {selectChip} from './impl/chips';
import {
    actionIcon,
    actionMenuItems,
    refuse,
    runDesignActionAsync,
    selectionMenu
} from './impl/designActions';
import {type CrumbGroup, crumbMenu} from './impl/crumbMenu';
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
            if (!selection) return summary({className, impl, document: documentModel?.document});
            return vframe({
                className,
                children: [
                    breadcrumb({impl}),
                    header({impl}),
                    actionBar({impl}),
                    ...impl.issues.map((it, idx) => issueRow({key: idx, impl, issue: it})),
                    wiringCard({impl}),
                    div({
                        className: `${CLS}__body`,
                        children: editorFor(selection, designModel, onShowPresetGroup)
                    })
                ]
            });
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

    /**
     * An element's ancestors and itself, root first, with the canvas view of each that sits in a
     * canvas cell before it. A view's path ends with the view. Empty for other kinds.
     */
    @computed
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
        if (selection.kind === 'view') return `Canvas view · holds ${id} · in ${selection.of}`;
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
const CLS = 'xh-blueprint-inspector';

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
            groupsOf = (id: string) => childGroups(getOwn(elements, id), specOf(id)),
            hasMenu = (step: BlueprintSelection) =>
                step.kind === 'element' && groupsOf(step.id).length > 0,
            trailing = path.length > 0 && hasMenu(path[last]);
        if (path.length < 2 && !trailing) return null;
        const {shown, hidden} = foldCrumbs(
                path.map((step, idx) => crumbWidth(step.id, idx === last ? kindOf(step) : null)),
                width - BREADCRUMB_PADDING,
                trailing
            ),
            childrenOf = (id: string): CrumbGroup[] => {
                const groups = groupsOf(id);
                return groups.map(group => ({
                    heading: groups.length > 1 ? slotLabel(group.slot) : null,
                    children: group.refs
                        .filter(ref => getOwn(elements, ref.id))
                        .map(ref => ({
                            id: ref.id,
                            icon: partIcon('element', specOf(ref.id)),
                            text: isString(ref.title) ? ref.title : ref.id,
                            label: specOf(ref.id)?.label,
                            hasChildren: groupsOf(ref.id).length > 0
                        }))
                }));
            },
            // A chevron after a container opens its children. Any other is a plain separator.
            separatorAfter = (step: BlueprintSelection, key: string) =>
                step && hasMenu(step)
                    ? crumbMenu({
                          key,
                          id: step.id,
                          className: `${CLS}__crumb-sep ${CLS}__crumb-sep--menu`,
                          menuClassName: `${CLS}__crumb-menu`,
                          // The Inspector sits at the right, so each submenu opens to the left.
                          submenuPlacement: 'left-start',
                          title: `Children of ${step.id}`,
                          childrenOf,
                          onSelect: id => designModel.select({kind: 'element', id}),
                          onHover: id => designModel.setHovered(id),
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
                        idx === last
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
                            : span({
                                  key: keyOf(step),
                                  className: `${CLS}__crumb ${CLS}__crumb--link`,
                                  role: 'button',
                                  tabIndex: 0,
                                  title: `Select ${step.id}${step.kind === 'view' ? ' view' : ''}`,
                                  onClick: () => select(step),
                                  onKeyDown: (e: React.KeyboardEvent) => {
                                      if (e.key !== 'Enter' && e.key !== ' ') return;
                                      e.preventDefault();
                                      e.stopPropagation();
                                      select(step);
                                  },
                                  children: [
                                      icon(step),
                                      step.id,
                                      step.kind === 'view'
                                          ? span({
                                                className: `${CLS}__crumb-kind`,
                                                children: 'view'
                                            })
                                          : null
                                  ]
                              } as object),
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
        return hbox({
            ref,
            className: `${CLS}__breadcrumb`,
            children: [
                ...steps,
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
            items = selectionMenu(designModel, selection),
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
                items.length
                    ? menuButton({
                          icon: Icon.ellipsisHorizontal(),
                          minimal: true,
                          title: 'More',
                          'aria-label': 'More',
                          menuItems: () => selectionMenu(designModel, impl.selection) as any[]
                      })
                    : null
            ]
        });
    }
});

// The selection's quick actions, as the design menu and keys run them: Duplicate, Wrap in and its
// own actions, then Delete apart at the right. Each says its key, or why it cannot run.
const actionBar = hoistCmp.factory<HoistProps & {impl: BlueprintInspectorModel}>({
    displayName: 'BlueprintInspectorActions',
    model: false,
    render({impl}) {
        const {selection, designModel} = impl,
            actions = designModel.designActions(selection);
        if (!actions.length) return null;
        const [rest, remove] = partition(actions, it => it.id !== 'delete'),
            control = (action: DesignAction) => {
                const props = {
                    key: action.id,
                    icon: actionIcon(action.icon),
                    text: action.label,
                    title:
                        action.disabledReason ??
                        [action.label, action.shortcut].filter(Boolean).join(' · '),
                    intent: action.intent,
                    minimal: true,
                    disabled: !!action.disabledReason
                };
                if (action.host === 'addWidget') {
                    return addWidgetButton({
                        key: action.id,
                        designModel,
                        id: selection.id,
                        action,
                        buttonProps: props
                    });
                }
                return action.items
                    ? menuButton({
                          ...props,
                          menuItems: () => actionMenuItems(designModel, selection.id, action.items)
                      })
                    : button({
                          ...props,
                          onClick: () => runDesignActionAsync(designModel, selection.id, action)
                      });
            };
        return toolbar({
            className: `${CLS}__actions`,
            compact: true,
            children: [...rest.map(control), filler(), ...remove.map(control)]
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
    HoistProps & {impl: BlueprintInspectorModel; document: {name?: string; description?: string}}
>({
    displayName: 'BlueprintInspectorSummary',
    model: false,
    render({impl, document, className}) {
        const {blueprint, registry} = impl.designModel.blueprintModel,
            {elements = {}, sources = {}, variables = {}, presets = {}, root} = blueprint ?? {},
            count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;
        return vframe({
            className: `${className} ${CLS}--summary`,
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
