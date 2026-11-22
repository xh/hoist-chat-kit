import {div, filler, hbox, span, vframe} from '@xh/hoist/cmp/layout';
import {hoistCmp, HoistModel, type HoistProps, useLocalModel} from '@xh/hoist/core';
import {button} from '@xh/hoist/desktop/cmp/button';
import {textInput} from '@xh/hoist/desktop/cmp/input';
import {menuButton} from '@xh/hoist/desktop/cmp/menu';
import {Icon} from '@xh/hoist/icon';
import {action, computed, observable} from '@xh/hoist/mobx';
import {Fragment, createElement, useEffect, useRef} from 'react';
import {
    type BlueprintDesignModel,
    type BlueprintDocumentModel,
    type BlueprintIssue,
    type BlueprintSelection,
    variableTypeLabel,
    wiringFor,
    type WiringRef
} from '../../../../blueprint';
import {variableText} from '../../../../blueprint/impl/variableText';
import './BlueprintInspector.scss';
import {elementInspector} from './ElementInspector';
import {refuse, selectionMenu} from './impl/designActions';
import {presetsEditor} from './PresetsEditor';
import {sourcesEditor} from './SourcesEditor';
import {variablesEditor} from './VariablesEditor';

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

    /** An element's ancestors and itself, root first. Empty for other kinds. */
    @computed
    get breadcrumb(): string[] {
        const {selection} = this;
        return selection?.kind === 'element'
            ? [...this.designModel.pathTo(selection.id), selection.id]
            : [];
    }

    /** What the selection is, and what it reads. */
    @computed
    get subtitle(): string {
        const {selection, designModel} = this;
        if (!selection) return null;
        const {blueprint, registry} = designModel.blueprintModel,
            {id} = selection,
            what =
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
            chip = (ref: WiringRef, text = ref.label ?? ref.id): WiringChip => ({
                text,
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
            row = (label: string, refs: WiringRef[], text?: (ref: WiringRef) => string) =>
                refs.length ? [{label, chips: refs.map(it => chip(it, text?.(it)))}] : [];
        switch (selection.kind) {
            case 'element':
                return [
                    ...row('Reads', w.reads),
                    ...row('Sets', w.sets),
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
                    {label: 'Now', text: (v && variableText(v.value, v.decl.type)) || '—'}
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
        const base = `/${COLLECTIONS[selection.kind]}/${selection.id}`;
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
        if (!selection || selection.kind === 'preset' || !to || to === selection.id) return;
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

const ICONS = {element: Icon.square, source: Icon.database, variable: Icon.tag, preset: Icon.gear};

function editorFor(
    {kind}: BlueprintSelection,
    designModel: BlueprintDesignModel,
    onShowPresetGroup: (name: string) => void
) {
    switch (kind) {
        case 'element':
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
        const {breadcrumb: path} = impl;
        if (path.length < 2) return null;
        return hbox({
            className: `${CLS}__breadcrumb`,
            children: path.map((id, idx) =>
                createElement(
                    Fragment,
                    {key: id},
                    idx ? span({className: `${CLS}__crumb-sep`, children: '›'}) : null,
                    idx === path.length - 1
                        ? span({className: `${CLS}__crumb ${CLS}__crumb--current`, children: id})
                        : button({
                              className: `${CLS}__crumb`,
                              text: id,
                              minimal: true,
                              onClick: () => impl.designModel.select({kind: 'element', id})
                          })
                )
            )
        });
    }
});

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
                ICONS[selection.kind]({className: `${CLS}__icon`}),
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
                              button({
                                  className: `${CLS}__chip`,
                                  text: root,
                                  minimal: true,
                                  onClick: () =>
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
                    children: [
                        span({className: `${CLS}__wiring-label`, children: label}),
                        div({
                            className: `${CLS}__chips`,
                            children: chips
                                ? chips.map((it, idx) =>
                                      it.select
                                          ? button({
                                                key: idx,
                                                className: `${CLS}__chip`,
                                                text: it.text,
                                                minimal: true,
                                                onClick: it.select
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
