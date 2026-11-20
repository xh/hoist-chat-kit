import {div, hbox, placeholder} from '@xh/hoist/cmp/layout';
import {
    hoistCmp,
    HoistModel,
    type HoistProps,
    type PlainObject,
    useLocalModel,
    uses
} from '@xh/hoist/core';
import {button, buttonGroup} from '@xh/hoist/desktop/cmp/button';
import {
    buttonGroupInput,
    jsonInput,
    numberInput,
    select,
    switchInput,
    textArea,
    textInput
} from '@xh/hoist/desktop/cmp/input';
import {Icon} from '@xh/hoist/icon';
import {action, observableRef} from '@xh/hoist/mobx';
import {isEmpty, isEqual, isNumber, isString, omit} from 'lodash';
import {
    type BlueprintDesignModel,
    type BlueprintIssue,
    type EditorNode,
    isVarBinding,
    toEditorSpec
} from '../../../../blueprint';
import {starterValue} from '../../../../blueprint/design/starterConfig';
import type {ReactElement} from 'react';
import './ElementInspector.scss';

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
export class ElementInspectorModel extends HoistModel {
    /** The refused property and its issues, until the next commit. */
    @observableRef accessor refusal: {key: string; issues: BlueprintIssue[]} = null;
    /** A counter per property, bumped on refusal, so its editors start again from the config. */
    @observableRef accessor resets: Record<string, number> = {};

    constructor(readonly designModel: BlueprintDesignModel) {
        super();
    }

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

    get readOnly(): boolean {
        const {mode, access} = this.designModel.blueprintModel;
        return mode !== 'design' || access !== 'write';
    }

    @action
    commit(key: string, value: unknown) {
        const {issues} = this.designModel.setConfig(this.elementId, `/${key}`, value),
            errors = issues.filter(it => it.severity === 'error');
        if (errors.length) {
            this.refuseWith(key, errors);
        } else {
            this.refusal = null;
        }
    }

    /** Refuse a value before it reaches the blueprint, such as JSON that does not parse. */
    @action
    refuse(key: string, message: string) {
        this.refuseWith(key, [{code: 'edit.invalid', severity: 'error', path: '', message}]);
    }

    /** The issues to show at a property: its refusal, and the blueprint's at its path. */
    issuesFor(key: string): BlueprintIssue[] {
        const {refusal, elementId} = this,
            prefix = `/elements/${elementId}/config/${key}`,
            standing = this.designModel.blueprintModel.issues.filter(
                it => it.path === prefix || it.path.startsWith(`${prefix}/`)
            );
        return refusal?.key === key ? [...refusal.issues, ...standing] : standing;
    }

    /** A value a new item can start with, its fields from the element's source. */
    newValue(schema: PlainObject): unknown {
        const {blueprint, catalog} = this.designModel.blueprintModel;
        return starterValue(schema, {blueprint, catalog, source: this.values.source});
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

    private refuseWith(key: string, issues: BlueprintIssue[]) {
        this.refusal = {key, issues};
        this.resets = {...this.resets, [key]: (this.resets[key] ?? 0) + 1};
    }
}

//------------------
// Implementation
//------------------
const CLS = 'xh-blueprint-element-inspector';

// Publishes the inspector's model, as Hoist inputs look one up even when controlled.
const inspectorBody = hoistCmp.factory<ElementInspectorModel>({
    model: uses(ElementInspectorModel),
    render({model: impl, className}) {
        if (!impl.elementId) return placeholder('Select an element to edit its config.');
        return div({
            className,
            items: [
                div({
                    className: `${CLS}__header`,
                    items: [impl.elementId, div({className: `${CLS}__widget`, item: impl.label})]
                }),
                ...impl.nodes.map(node =>
                    propertyRow({
                        node,
                        value: impl.values[node.key],
                        commit: v => impl.commit(node.key, v),
                        ctx: {impl, key: node.key},
                        issues: impl.issuesFor(node.key),
                        key: `${node.key}:${impl.resets[node.key] ?? 0}`
                    })
                )
            ]
        });
    }
});

interface EditorContext {
    impl: ElementInspectorModel;
    // The top-level property, which a refusal names.
    key: string;
}

interface RowProps {
    node: EditorNode;
    value: unknown;
    commit: (value: unknown) => void;
    ctx: EditorContext;
    issues?: BlueprintIssue[];
    key?: string;
}

function propertyRow({node, value, commit, ctx, issues = [], key}: RowProps) {
    return div({
        key,
        className: `${CLS}__row`,
        items: [
            div({
                className: `${CLS}__label`,
                title: node.description,
                item: node.required ? `${node.label} *` : node.label
            }),
            editorFor(node, value, commit, ctx),
            ...issues.map((it, idx) =>
                div({key: idx, className: `${CLS}__issue`, item: it.message})
            )
        ]
    });
}

function editorFor(
    node: EditorNode,
    value: unknown,
    commit: (value: unknown) => void,
    ctx: EditorContext
): ReactElement {
    const disabled = ctx.impl.readOnly,
        optional = (v: unknown) => (v == null || v === '' ? undefined : v);
    if (isVarBinding(value) && node.kind !== 'json') {
        return div({className: `${CLS}__binding`, item: `Bound to variable ${value.$var}`});
    }
    switch (node.kind) {
        case 'text':
            return (node.multiline ? textArea : textInput)({
                value: (value as string) ?? null,
                disabled,
                width: '100%',
                onCommit: v => commit(optional(v))
            });
        case 'number':
            return numberInput({
                value: isNumber(value) ? value : null,
                min: node.min,
                max: node.max,
                precision: node.integer ? 0 : 4,
                disabled,
                width: '100%',
                onCommit: v => commit(optional(v))
            });
        case 'boolean':
            return switchInput({value: !!value, disabled, onCommit: v => commit(v)});
        case 'choice':
            return select({
                value: value ?? null,
                options: node.options as any[],
                enableClear: !node.required,
                disabled,
                width: '100%',
                onCommit: v => commit(optional(v))
            });
        case 'stringList':
            return select({
                value: (value as string[]) ?? [],
                options: (node.options ?? (value as string[]) ?? []) as any[],
                enableMulti: true,
                enableCreate: !node.options,
                disabled,
                width: '100%',
                onCommit: v => commit(isEmpty(v) && !node.required ? undefined : v)
            });
        case 'group': {
            const obj = (value ?? {}) as PlainObject;
            return div({
                className: `${CLS}__group`,
                items: node.children.map(child =>
                    propertyRow({
                        key: child.key,
                        node: child,
                        value: obj[child.key],
                        commit: v =>
                            commit(
                                v === undefined ? omit(obj, child.key) : {...obj, [child.key]: v}
                            ),
                        ctx
                    })
                )
            });
        }
        case 'list':
            return listEditor(node, (value as unknown[]) ?? [], commit, ctx);
        case 'map':
            return mapEditor(node, (value as PlainObject) ?? {}, commit, ctx);
        case 'oneOf': {
            const at = Math.max(
                    node.options.findIndex(it => fits(it, value)),
                    0
                ),
                variant = node.options[at];
            return div({
                className: `${CLS}__one-of`,
                items: [
                    buttonGroupInput({
                        value: at,
                        disabled,
                        onCommit: (i: number) =>
                            i !== at && commit(ctx.impl.newValue(node.options[i].schema)),
                        items: node.options.map((it, i) =>
                            button({key: i, value: i, text: variantLabel(it)})
                        )
                    }),
                    editorFor(variant, value, commit, ctx)
                ]
            });
        }
        default:
            return jsonEditor(value, commit, ctx);
    }
}

function listEditor(
    node: Extract<EditorNode, {kind: 'list'}>,
    items: unknown[],
    commit: (value: unknown) => void,
    ctx: EditorContext
) {
    const disabled = ctx.impl.readOnly,
        moved = (from: number, to: number) => {
            const ret = [...items];
            ret.splice(to, 0, ...ret.splice(from, 1));
            return ret;
        },
        commitList = (list: unknown[]) =>
            commit(isEmpty(list) && !node.required ? undefined : list);
    return div({
        className: `${CLS}__list`,
        items: [
            ...items.map((item, i) =>
                div({
                    key: i,
                    className: `${CLS}__item`,
                    items: [
                        hbox({
                            className: `${CLS}__item-header`,
                            items: [
                                div({className: `${CLS}__item-label`, item: `${i + 1}`}),
                                buttonGroup({
                                    items: [
                                        button({
                                            icon: Icon.arrowUp(),
                                            title: 'Move up',
                                            disabled: disabled || i === 0,
                                            onClick: () => commitList(moved(i, i - 1))
                                        }),
                                        button({
                                            icon: Icon.arrowDown(),
                                            title: 'Move down',
                                            disabled: disabled || i === items.length - 1,
                                            onClick: () => commitList(moved(i, i + 1))
                                        }),
                                        button({
                                            icon: Icon.delete(),
                                            title: 'Remove',
                                            disabled,
                                            onClick: () =>
                                                commitList(items.filter((_, j) => j !== i))
                                        })
                                    ]
                                })
                            ]
                        }),
                        editorFor(
                            node.item,
                            item,
                            v => commitList(items.map((it, j) => (j === i ? v : it))),
                            ctx
                        )
                    ]
                })
            ),
            button({
                icon: Icon.add(),
                text: 'Add',
                minimal: true,
                disabled,
                onClick: () => commitList([...items, ctx.impl.newValue(node.item.schema)])
            })
        ]
    });
}

function mapEditor(
    node: Extract<EditorNode, {kind: 'map'}>,
    map: PlainObject,
    commit: (value: unknown) => void,
    ctx: EditorContext
) {
    const disabled = ctx.impl.readOnly,
        entries = Object.entries(map),
        commitMap = (obj: PlainObject) => commit(isEmpty(obj) && !node.required ? undefined : obj);
    return div({
        className: `${CLS}__list`,
        items: [
            ...entries.map(([key, val]) =>
                div({
                    key,
                    className: `${CLS}__item`,
                    items: [
                        hbox({
                            className: `${CLS}__item-header`,
                            items: [
                                div({className: `${CLS}__item-label`, item: key}),
                                button({
                                    icon: Icon.delete(),
                                    title: 'Remove',
                                    disabled,
                                    onClick: () => commitMap(omit(map, key))
                                })
                            ]
                        }),
                        editorFor(node.value, val, v => commitMap({...map, [key]: v}), ctx)
                    ]
                })
            ),
            textInput({
                key: entries.length,
                placeholder: 'Add key…',
                disabled,
                width: '100%',
                onCommit: (key: string) => {
                    if (!key || Object.hasOwn(map, key)) return;
                    commitMap({...map, [key]: ctx.impl.newValue(node.value.schema)});
                }
            })
        ]
    });
}

function jsonEditor(value: unknown, commit: (value: unknown) => void, ctx: EditorContext) {
    return jsonInput({
        value: value === undefined ? '' : JSON.stringify(value, null, 2),
        disabled: ctx.impl.readOnly,
        width: '100%',
        height: 120,
        onCommit: (text: string) => {
            if (!text?.trim()) return commit(undefined);
            let parsed: unknown;
            try {
                parsed = JSON.parse(text);
            } catch {
                return ctx.impl.refuse(ctx.key, 'Not valid JSON.');
            }
            if (!isEqual(parsed, value)) commit(parsed);
        }
    });
}

// True if a value is of the kind a variant edits.
function fits(node: EditorNode, value: unknown): boolean {
    switch (node.kind) {
        case 'choice':
            return node.options.includes(value);
        case 'text':
            return isString(value);
        case 'number':
            return isNumber(value);
        case 'boolean':
            return typeof value === 'boolean';
        case 'stringList':
            return Array.isArray(value);
        default:
            return false;
    }
}

function variantLabel(node: EditorNode): string {
    if (node.kind === 'choice' && node.options.length === 1) return String(node.options[0]);
    return {
        text: 'Text',
        number: 'Number',
        boolean: 'Yes/No',
        choice: 'Choice',
        stringList: 'List'
    }[node.kind];
}
