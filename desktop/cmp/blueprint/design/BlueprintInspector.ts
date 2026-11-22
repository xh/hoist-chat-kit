import {div, filler, hbox, placeholder, span, vframe} from '@xh/hoist/cmp/layout';
import {hoistCmp, HoistModel, type HoistProps, useLocalModel} from '@xh/hoist/core';
import {button} from '@xh/hoist/desktop/cmp/button';
import {textInput} from '@xh/hoist/desktop/cmp/input';
import {menuButton} from '@xh/hoist/desktop/cmp/menu';
import {Icon} from '@xh/hoist/icon';
import {action, computed, observable} from '@xh/hoist/mobx';
import {Fragment, createElement} from 'react';
import {
    type BlueprintDesignModel,
    type BlueprintIssue,
    type BlueprintSelection,
    wiringFor
} from '../../../../blueprint';
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
        render({designModel, onShowPresetGroup, className}) {
            const impl = useLocalModel(() => new BlueprintInspectorModel(designModel)),
                {selection} = impl;
            if (!selection) {
                return placeholder({className, children: 'Select something to inspect it.'});
            }
            return vframe({
                className,
                children: [
                    breadcrumb({impl}),
                    header({impl}),
                    ...impl.issues.map((it, idx) => issueRow({key: idx, impl, issue: it})),
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
                        ? (blueprint.variables[id]?.label ?? blueprint.variables[id]?.type)
                        : blueprint.presets?.[id]?.label,
            reads = wiringFor(blueprint, selection, designModel.wiring).reads.map(it => it.id);
        return [what, reads.length ? `reads ${reads.join(', ')}` : null]
            .filter(Boolean)
            .join(' · ');
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
        this.setRenaming(false);
        if (!selection || selection.kind === 'preset' || !to || to === selection.id) return;
        refuse(designModel, designModel.renameId(selection.kind, selection.id, to).issues);
    }
}

//------------------
// Implementation
//------------------
const CLS = 'xh-blueprint-inspector';

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
            items = selectionMenu(designModel, selection);
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
                                  autoFocus: true,
                                  selectOnFocus: true,
                                  width: '100%',
                                  onCommit: (to: string) => impl.rename(to),
                                  onKeyDown: (e: KeyboardEvent) => {
                                      if (e.key === 'Escape') impl.setRenaming(false);
                                  }
                              })
                            : span({
                                  className: `${CLS}__id`,
                                  title: impl.canEdit ? 'Click to rename' : null,
                                  onClick: () => impl.setRenaming(true),
                                  children: selection.id
                              }),
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
