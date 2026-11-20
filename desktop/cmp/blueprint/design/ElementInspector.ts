import {div, filler, hbox, placeholder} from '@xh/hoist/cmp/layout';
import {hoistCmp, type HoistProps, type PlainObject, useLocalModel, uses, XH} from '@xh/hoist/core';
import {button, buttonGroup} from '@xh/hoist/desktop/cmp/button';
import {textInput} from '@xh/hoist/desktop/cmp/input';
import {Icon} from '@xh/hoist/icon';
import {
    type BlueprintDesignModel,
    type BlueprintRemoval,
    type EditorNode,
    toEditorSpec
} from '../../../../blueprint';
import './ElementInspector.scss';
import {ConfigEditorModel} from './impl/ConfigEditorModel';
import {CLS, listOf, propertyRow} from './impl/ConfigEditors';

export interface ElementInspectorProps extends HoistProps {
    designModel: BlueprintDesignModel;
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
    render({designModel, className}) {
        const impl = useLocalModel(() => new ElementInspectorModel(designModel));
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
     * it, in one edit, once the user confirms what goes.
     */
    async removeAsync(id: string = this.elementId) {
        const {designModel} = this,
            message = removalMessage(id, designModel.describeRemoval(id)),
            ok = await XH.confirm({
                title: 'Remove',
                message,
                confirmProps: {text: 'Remove', intent: 'danger'}
            });
        if (!ok) return;
        const {issues} = designModel.removeElement(id),
            errors = issues.filter(it => it.severity === 'error');
        if (errors.length) this.refuseWith(ELEMENT_KEY, errors);
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

// Publishes the inspector's model, as Hoist inputs look one up even when controlled.
const inspectorBody = hoistCmp.factory<ElementInspectorModel>({
    model: uses(ElementInspectorModel),
    render({model: impl, className}) {
        if (!impl.elementId) return placeholder('Select an element to edit its config.');
        return div({
            className,
            children: [
                hbox({
                    className: `${CLS}__header`,
                    children: [
                        impl.elementId,
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
                ...impl
                    .issuesFor(ELEMENT_KEY)
                    .map((it, idx) =>
                        div({key: idx, className: `${CLS}__issue`, children: it.message})
                    ),
                impl.tabs ? tabsEditor(impl) : null,
                ...impl.nodes.map(node =>
                    propertyRow({
                        node,
                        value: impl.values[node.key],
                        commit: v => impl.commit(node.key, v),
                        ctx: {impl, key: node.key},
                        issues: impl.issuesFor(node.key),
                        badge: impl.badgeFor(node.key),
                        key: `${node.key}:${impl.resets[node.key] ?? 0}`
                    })
                )
            ]
        });
    }
});

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

// What removing an element takes with it, for the user to confirm.
function removalMessage(id: string, removal: BlueprintRemoval): string {
    const inside = removal.elements.length - 1,
        sentences = [
            inside
                ? `Remove ${id}, and the ${inside} element${inside > 1 ? 's' : ''} in it?`
                : `Remove ${id}?`
        ];
    const {removedVariables: gone, unboundVariables: unbound, presetPaths} = removal;
    if (gone.length)
        sentences.push(
            `Variable${gone.length > 1 ? 's' : ''} ${listOf(gone)} ${gone.length > 1 ? 'go' : 'goes'} too.`
        );
    if (unbound.length) {
        sentences.push(
            `${listOf(unbound)} ${unbound.length > 1 ? 'lose a writer' : 'loses a writer'}, and keep${unbound.length > 1 ? '' : 's'} its other writers or its default.`
        );
    }
    if (presetPaths.length) {
        sentences.push(
            `Presets stop setting ${presetPaths.length} path${presetPaths.length > 1 ? 's' : ''} in it.`
        );
    }
    return sentences.join(' ');
}
