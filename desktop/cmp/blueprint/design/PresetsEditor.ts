import {box, div, filler, hbox, placeholder, span} from '@xh/hoist/cmp/layout';
import {hoistCmp, HoistModel, type HoistProps, useLocalModel, uses} from '@xh/hoist/core';
import {button, buttonGroup} from '@xh/hoist/desktop/cmp/button';
import {select, textInput} from '@xh/hoist/desktop/cmp/input';
import {Icon} from '@xh/hoist/icon';
import {action, observableRef} from '@xh/hoist/mobx';
import {
    type BlueprintDesignModel,
    type BlueprintEditResult,
    type BlueprintIssue,
    labelOf,
    type PresetGroup
} from '../../../../blueprint';
import './ElementInspector.scss';
import {CLS, labelled, type Option, sectionCard} from './impl/ConfigEditors';
import {removePresetGroupAsync} from './impl/designActions';

export interface PresetsEditorProps extends HoistProps {
    designModel: BlueprintDesignModel;
    /** True inside `blueprintInspector`, which draws the header in place of the editor's own. */
    framed?: boolean;
}

/**
 * The blueprint's groups of presets: a list to select one, make one over a widget's preset path,
 * or remove one, and the selected group - its label, the paths it controls, its default, and its
 * presets, each to relabel, copy, remove or make active. Edits in design mode to a controlled
 * path change the active preset. Its selection is the design model's.
 */
export const [PresetsEditor, presetsEditor] = hoistCmp.withFactory<PresetsEditorProps>({
    displayName: 'BlueprintPresetsEditor',
    className: 'xh-blueprint-element-inspector xh-blueprint-presets-editor',
    model: false,
    render({designModel, framed, className}) {
        const impl = useLocalModel(() => new PresetsEditorModel(designModel));
        impl.framed = !!framed;
        return presetsBody({model: impl, className});
    }
});

/** @internal */
export class PresetsEditorModel extends HoistModel {
    /** True when hosted in `blueprintInspector`, which draws the header. */
    framed = false;

    /** The last refused edit's issues, until the next edit. */
    @observableRef accessor issues: BlueprintIssue[] = [];

    constructor(readonly designModel: BlueprintDesignModel) {
        super();
    }

    /** The selected group's name, or null. */
    get name(): string {
        const {selection, blueprintModel} = this.designModel;
        return selection?.kind === 'preset' &&
            Object.hasOwn(blueprintModel.blueprint?.presets ?? {}, selection.id)
            ? selection.id
            : null;
    }

    get group(): PresetGroup {
        return this.name ? this.designModel.blueprintModel.blueprint.presets[this.name] : null;
    }

    get groupOptions(): Option[] {
        return Object.entries(this.designModel.blueprintModel.blueprint?.presets ?? {}).map(
            ([id, it]) => ({value: id, label: it.label ?? id})
        );
    }

    /** Each widget's preset paths, and each variable's default, that no group controls yet. */
    get candidatePaths(): Option[] {
        const {blueprint, registry} = this.designModel.blueprintModel,
            widgetPaths = Object.entries(blueprint?.elements ?? {}).flatMap(([id, el]) =>
                (registry.widgets[el.component]?.presetPaths ?? []).map(
                    rel => `/elements/${id}/config${rel}`
                )
            ),
            defaultPaths = Object.entries(blueprint?.variables ?? {})
                .filter(([, decl]) => Object.hasOwn(decl, 'default'))
                .map(([name]) => `/variables/${name}/default`);
        return [...widgetPaths, ...defaultPaths]
            .filter(path => !this.designModel.blueprintModel.getPresetControl(path))
            .map(path => ({value: path, label: pathLabel(path)}));
    }

    /** The paths the selected group controls. */
    get controls(): Option[] {
        return (this.group?.controls ?? []).map(it => ({
            value: it.path,
            label: pathLabel(it.path)
        }));
    }

    /** The selected group's presets, and which is active. */
    get items(): {id: string; label: string; isActive: boolean}[] {
        const active = this.designModel.blueprintModel.getActivePreset(this.name);
        return Object.entries(this.group?.items ?? {}).map(([id, it]) => ({
            id,
            label: it.label ?? id,
            isActive: id === active
        }));
    }

    get readOnly(): boolean {
        const {mode, access} = this.designModel.blueprintModel;
        return mode !== 'design' || access !== 'write';
    }

    /** Make a preset active, so edits to the paths the group controls fill it. */
    activate(item: string) {
        this.designModel.blueprintModel.setPreset(this.name, item);
    }

    addGroup(path: string) {
        this.done(this.designModel.addPresetGroup(path));
    }

    /** Remove the group, asking first when its selectors go with it. */
    async removeGroupAsync() {
        this.done({issues: await removePresetGroupAsync(this.designModel, this.name)});
    }

    setLabel(label: string) {
        this.done(this.designModel.setPresetGroupDecl(this.name, 'label', label || undefined));
    }

    setDefault(item: string) {
        this.done(this.designModel.setPresetGroupDecl(this.name, 'default', item || undefined));
    }

    /** True if a presetSelector shows the selected group. */
    get hasSelector(): boolean {
        return Object.values(this.designModel.blueprintModel.blueprint?.elements ?? {}).some(
            it => it.component === 'presetSelector' && it.config?.group === this.name
        );
    }

    /** Add a selector for the group, beside the widget it controls. */
    addSelector() {
        this.done(this.designModel.addPresetSelector(this.name));
    }

    addControl(path: string) {
        this.done(this.designModel.addPresetControl(this.name, path));
    }

    removeControl(path: string) {
        this.done(this.designModel.removePresetControl(this.name, path));
    }

    duplicate(item: string) {
        this.done(this.designModel.duplicatePreset(this.name, item));
    }

    relabel(item: string, label: string) {
        this.done(this.designModel.setPresetLabel(this.name, item, label));
    }

    remove(item: string) {
        this.done(this.designModel.removePreset(this.name, item));
    }

    @action
    private done(result: BlueprintEditResult) {
        this.issues = result.issues.filter(it => it.severity === 'error');
    }
}

//------------------
// Implementation
//------------------
const presetsBody = hoistCmp.factory<PresetsEditorModel>({
    model: uses(PresetsEditorModel),
    render({model: impl, className}) {
        const {name, readOnly: disabled} = impl;
        return div({
            className,
            children: [
                impl.framed
                    ? null
                    : hbox({
                          className: `${CLS}__header`,
                          children: [
                              select({
                                  value: name,
                                  options: impl.groupOptions,
                                  placeholder: 'Select a group of presets…',
                                  flex: 1,
                                  onCommit: (id: string) =>
                                      id && impl.designModel.select({kind: 'preset', id})
                              }),
                              filler(),
                              button({
                                  icon: Icon.delete(),
                                  title: name ? `Remove ${name}` : 'Remove',
                                  minimal: true,
                                  disabled: disabled || !name,
                                  onClick: () => impl.removeGroupAsync()
                              })
                          ]
                      }),
                select({
                    key: impl.groupOptions.length,
                    placeholder: 'Make presets for…',
                    options: impl.candidatePaths,
                    disabled: disabled || !impl.candidatePaths.length,
                    width: '100%',
                    onCommit: (path: string) => path && impl.addGroup(path)
                }),
                ...impl.issues.map((it, idx) =>
                    div({key: idx, className: `${CLS}__issue`, children: it.message})
                ),
                ...(name ? group(impl) : [placeholder('Select a group of presets to edit it.')])
            ]
        });
    }
});

function group(impl: PresetsEditorModel) {
    const {readOnly: disabled, items} = impl;
    return [
        impl.hasSelector
            ? null
            : labelled(
                  'Selector',
                  button({
                      icon: Icon.add(),
                      text: 'Add selector',
                      minimal: true,
                      disabled,
                      onClick: () => impl.addSelector()
                  }),
                  [],
                  null,
                  'No selector shows the group yet, so it stays at its default.'
              ),
        sectionCard({
            key: 'group',
            title: 'Group',
            children: [
                labelled(
                    'Label',
                    textInput({
                        key: `${impl.name}:label`,
                        value: impl.group.label ?? null,
                        placeholder: impl.name,
                        disabled,
                        width: '100%',
                        onCommit: (it: string) => impl.setLabel(it)
                    })
                ),
                labelled(
                    'Default',
                    select({
                        value: impl.group.default ?? null,
                        options: items.map(it => ({value: it.id, label: it.label})),
                        enableClear: true,
                        placeholder: 'The first',
                        disabled,
                        width: '100%',
                        onCommit: (it: string) => impl.setDefault(it)
                    }),
                    [],
                    null,
                    'The preset a user starts on.'
                )
            ]
        }),
        sectionCard({
            key: 'controls',
            title: 'Controls',
            count: impl.controls.length,
            children: [
                div({
                    className: `${CLS}__hint`,
                    children: "The paths the group's presets set. Each leaves the config."
                }),
                div({
                    className: `${CLS}__list`,
                    children: [
                        ...impl.controls.map(it =>
                            hbox({
                                key: it.value,
                                className: `${CLS}__tab`,
                                children: [
                                    box({flex: 1, children: it.label}),
                                    button({
                                        icon: Icon.x(),
                                        title: 'Stop controlling it, keeping the active value',
                                        minimal: true,
                                        disabled,
                                        onClick: () => impl.removeControl(it.value)
                                    })
                                ]
                            })
                        ),
                        select({
                            key: impl.controls.length,
                            placeholder: 'Add a path…',
                            options: impl.candidatePaths,
                            disabled: disabled || !impl.candidatePaths.length,
                            width: '100%',
                            onCommit: (path: string) => path && impl.addControl(path)
                        })
                    ]
                })
            ]
        }),
        sectionCard({
            key: 'presets',
            title: 'Presets',
            count: items.length,
            children: [
                div({
                    className: `${CLS}__list`,
                    children: items.map(it =>
                        hbox({
                            key: `${it.id}:${it.label}`,
                            className: `${CLS}__tab`,
                            children: [
                                button({
                                    icon: it.isActive ? Icon.checkCircle() : Icon.circle(),
                                    title: it.isActive
                                        ? 'Active: edits to the paths fill this preset'
                                        : 'Make active, so edits to the paths fill it',
                                    minimal: true,
                                    onClick: () => impl.activate(it.id)
                                }),
                                textInput({
                                    value: it.label,
                                    disabled,
                                    flex: 1,
                                    onCommit: (label: string) =>
                                        label !== it.label && impl.relabel(it.id, label)
                                }),
                                it.isActive
                                    ? span({
                                          className: `${CLS}__editing`,
                                          title: 'Edits to the paths fill this preset',
                                          children: 'editing'
                                      })
                                    : null,
                                buttonGroup({
                                    children: [
                                        button({
                                            icon: Icon.copy(),
                                            title: 'Copy',
                                            disabled,
                                            onClick: () => impl.duplicate(it.id)
                                        }),
                                        button({
                                            icon: Icon.delete(),
                                            title: 'Remove',
                                            disabled: disabled || items.length === 1,
                                            onClick: () => impl.remove(it.id)
                                        })
                                    ]
                                })
                            ]
                        })
                    )
                })
            ]
        })
    ];
}

// A controlled path as its element or variable and property, such as "posGrid › Column state".
function pathLabel(path: string): string {
    const segs = path.split('/');
    return `${segs[2]} › ${labelOf(segs.at(-1))}`;
}
