import {div, hbox, span} from '@xh/hoist/cmp/layout';
import type {PlainObject} from '@xh/hoist/core';
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
import {castArray, isEmpty, isEqual, isNumber, isString, omit, uniq} from 'lodash';
import type {ReactElement} from 'react';
import {type BlueprintIssue, type EditorNode, isVarBinding} from '../../../../../blueprint';
import type {ElementInspectorModel} from '../ElementInspector';
import {filterEditor, groupingEditor} from './ChooserEditors';

/** The block class of the element inspector, which its editors' elements extend. */
export const CLS = 'xh-blueprint-element-inspector';

/** A choice in a select, by value and label. */
export interface Option {
    value: string;
    label: string;
}

/** What every editor reads beside its value. */
export interface EditorContext {
    impl: ElementInspectorModel;
    // The top-level property, which a refusal names.
    key: string;
}

export interface RowProps {
    node: EditorNode;
    value: unknown;
    commit: (value: unknown) => void;
    ctx: EditorContext;
    issues?: BlueprintIssue[];
    key?: string;
}

/** A property's label, its editor, and its issues. */
export function propertyRow({node, value, commit, ctx, issues = [], key}: RowProps) {
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
        optional = (v: unknown) => (v == null || v === '' ? undefined : v),
        placeholder = node.default !== undefined ? `Default (${node.default})` : undefined;
    if (node.bindable) return bindableEditor(node, value, commit, ctx);
    if (isVarBinding(value) && node.kind !== 'json') {
        return div({className: `${CLS}__binding`, item: `Bound to variable ${value.$var}`});
    }
    switch (node.kind) {
        case 'text':
            return (node.multiline ? textArea : textInput)({
                value: (value as string) ?? null,
                placeholder,
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
                placeholder,
                disabled,
                width: '100%',
                onCommit: v => commit(optional(v))
            });
        case 'boolean':
            return div({
                className: `${CLS}__switch`,
                item: switchInput({
                    value: !!(value ?? node.default),
                    disabled,
                    onCommit: v => commit(v)
                })
            });
        case 'choice':
            return select({
                value: value ?? null,
                options: node.options as any[],
                enableClear: !node.required,
                placeholder,
                disabled,
                width: '100%',
                onCommit: v => commit(optional(v))
            });
        case 'source':
            return select({
                value: value ?? null,
                options: ctx.impl.sourceOptions,
                enableClear: !node.required,
                disabled,
                width: '100%',
                onCommit: v => commit(optional(v))
            });
        case 'field': {
            const options = withCurrent(ctx.impl.fieldOptions(node.role), value);
            if (node.multiple && node.role === 'dimension') {
                return groupingEditor({
                    value: (value as string[]) ?? [],
                    dimensions: options,
                    disabled,
                    onCommit: v => commit(isEmpty(v) && !node.required ? undefined : v)
                });
            }
            return node.multiple
                ? select({
                      value: (value as string[]) ?? [],
                      options,
                      enableMulti: true,
                      disabled,
                      width: '100%',
                      onCommit: v => commit(isEmpty(v) && !node.required ? undefined : v)
                  })
                : select({
                      value: value ?? null,
                      options,
                      enableClear: !node.required,
                      disabled,
                      width: '100%',
                      onCommit: v => commit(optional(v))
                  });
        }
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
        case 'filter':
            return filterEditor({
                key: ctx.impl.values.source,
                value: value as PlainObject,
                fieldSpecs: () => ctx.impl.filterFieldSpecs(),
                labelOf: it => ctx.impl.fieldLabel(it),
                disabled,
                onCommit: commit
            });
        case 'fieldList':
            return fieldListEditor(node, (value as unknown[]) ?? [], commit, ctx);
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

// A property that takes a value or a variable, with a switch between them.
function bindableEditor(
    node: EditorNode,
    value: unknown,
    commit: (value: unknown) => void,
    ctx: EditorContext
) {
    const {impl} = ctx,
        disabled = impl.readOnly,
        variables = impl.variablesFor(node),
        bound = isVarBinding(value) ? value.$var : null;
    return hbox({
        className: `${CLS}__bindable`,
        items: [
            bound != null
                ? select({
                      className: `${CLS}__bound`,
                      value: bound,
                      options: uniq([bound, ...variables]),
                      disabled,
                      flex: 1,
                      onCommit: (v: string) => commit({$var: v})
                  })
                : div({
                      className: `${CLS}__value`,
                      item: editorFor({...node, bindable: false}, value, commit, ctx)
                  }),
            button({
                icon: bound != null ? Icon.unlink() : Icon.link(),
                title: bound != null ? 'Use a value' : 'Bind to a variable',
                minimal: true,
                disabled: disabled || (bound == null && !variables.length),
                onClick: () =>
                    commit(bound != null ? impl.unboundValue(node) : {$var: variables[0]})
            })
        ]
    });
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
        commitMap = (obj: PlainObject) => commit(isEmpty(obj) && !node.required ? undefined : obj),
        addKey = (key: string) => {
            if (!key || Object.hasOwn(map, key)) return;
            commitMap({...map, [key]: ctx.impl.newValue(node.value.schema)});
        };
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
                                mapKeyLabel(key, node.keyRole ? ctx.impl.fieldLabel(key) : key),
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
            node.keyRole
                ? select({
                      key: entries.length,
                      placeholder: 'Add a field…',
                      options: ctx.impl
                          .fieldOptions(node.keyRole)
                          .filter(it => !Object.hasOwn(map, it.value)),
                      disabled,
                      width: '100%',
                      onCommit: addKey
                  })
                : textInput({
                      key: entries.length,
                      placeholder: 'Add key…',
                      disabled,
                      width: '100%',
                      onCommit: addKey
                  })
        ]
    });
}

// Fields in order, each a name, or an object with its field and settings when it has any.
function fieldListEditor(
    node: Extract<EditorNode, {kind: 'fieldList'}>,
    items: unknown[],
    commit: (value: unknown) => void,
    ctx: EditorContext
) {
    const {impl} = ctx,
        disabled = impl.readOnly,
        entries = items.map(it => (isString(it) ? {field: it} : (it as PlainObject))),
        fieldsOf = entries.map(it => it.field),
        options = withCurrent(impl.fieldOptions(node.role), fieldsOf),
        commitList = (list: PlainObject[]) => {
            const ret = list.map(it => (Object.keys(it).length === 1 ? it.field : it));
            commit(isEmpty(ret) && !node.required ? undefined : ret);
        },
        moved = (from: number, to: number) => {
            const ret = [...entries];
            ret.splice(to, 0, ...ret.splice(from, 1));
            return ret;
        };
    return div({
        className: `${CLS}__list`,
        items: [
            ...entries.map((entry, i) =>
                div({
                    key: `${i}:${entry.field}`,
                    className: `${CLS}__column`,
                    items: [
                        hbox({
                            className: `${CLS}__item-header`,
                            items: [
                                select({
                                    value: entry.field,
                                    options,
                                    disabled,
                                    flex: 1,
                                    onCommit: (field: string) =>
                                        commitList(
                                            entries.map((it, j) => (j === i ? {...it, field} : it))
                                        )
                                }),
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
                                            disabled: disabled || i === entries.length - 1,
                                            onClick: () => commitList(moved(i, i + 1))
                                        }),
                                        button({
                                            icon: Icon.delete(),
                                            title: 'Remove',
                                            disabled,
                                            onClick: () =>
                                                commitList(entries.filter((_, j) => j !== i))
                                        })
                                    ]
                                })
                            ]
                        }),
                        div({
                            className: `${CLS}__settings`,
                            items: node.settings.map(setting =>
                                propertyRow({
                                    key: setting.key,
                                    node: setting,
                                    value: entry[setting.key],
                                    commit: v =>
                                        commitList(
                                            entries.map((it, j) =>
                                                j !== i
                                                    ? it
                                                    : v === undefined
                                                      ? omit(it, setting.key)
                                                      : {...it, [setting.key]: v}
                                            )
                                        ),
                                    ctx
                                })
                            )
                        })
                    ]
                })
            ),
            select({
                key: entries.length,
                placeholder: 'Add a field…',
                options: options.filter(it => !fieldsOf.includes(it.value)),
                disabled,
                width: '100%',
                onCommit: (field: string) => field && commitList([...entries, {field}])
            })
        ]
    });
}

// A map entry's key, by its field label where it names a field, with the key itself beside.
function mapKeyLabel(key: string, label: string) {
    return div({
        className: `${CLS}__item-label`,
        items: label === key ? [key] : [label, span({className: `${CLS}__key`, item: key})]
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

// The options, plus any current value they lack, so a select still shows it.
function withCurrent(options: Option[], value: unknown): Option[] {
    const missing = castArray(value ?? []).filter(
        (v): v is string => isString(v) && !options.some(it => it.value === v)
    );
    return [...options, ...missing.map(it => ({value: it, label: it}))];
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
