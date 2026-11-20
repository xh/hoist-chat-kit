import {div, hbox, placeholder, span} from '@xh/hoist/cmp/layout';
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
import type {FilterChooserFieldSpecConfig} from '@xh/hoist/cmp/filter';
import type {FieldType} from '@xh/hoist/data';
import {castArray, isEmpty, isEqual, isNumber, isString, omit, sortBy, uniq} from 'lodash';
import {
    type BlueprintDesignModel,
    type BlueprintIssue,
    type EditorNode,
    isVarBinding,
    toEditorSpec
} from '../../../../blueprint';
import {fieldHasRole, starterValue} from '../../../../blueprint/design/starterConfig';
import type {ReactElement} from 'react';
import './ElementInspector.scss';
import {filterEditor, groupingEditor} from './impl/ChooserEditors';

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

    /** A value a new item can start with, from fields of the element's source it does not use. */
    newValue(schema: PlainObject): unknown {
        const {blueprint, catalog} = this.designModel.blueprintModel,
            {values} = this,
            fields = this.designModel.blueprintModel.getSource(values.source)?.fields ?? {},
            used = new Set<string>();
        walkStrings(values, it => Object.hasOwn(fields, it) && used.add(it));
        return starterValue(schema, {blueprint, catalog, source: values.source, used: [...used]});
    }

    /** The blueprint's sources, for an `x-source` property. */
    get sourceOptions(): Option[] {
        const sources = this.designModel.blueprintModel.blueprint?.sources ?? {};
        return Object.keys(sources).map(it => ({value: it, label: it}));
    }

    /** The fields of the element's source that can fill a role, with their labels. */
    fieldOptions(role: string): Option[] {
        const source = this.designModel.blueprintModel.getSource(this.values.source);
        if (!source) return [];
        return Object.values(source.fields)
            .filter(it => fieldHasRole(it, role))
            .map(it => ({value: it.name, label: source.fieldLabel(it.name)}));
    }

    /** The variables a property can bind, by the type its schema takes. */
    variablesFor(node: EditorNode): string[] {
        const {blueprint, registry} = this.designModel.blueprintModel,
            want = variableTypeOf(node.schema),
            fits = (type: string) =>
                type === want ||
                registry.variableTypes[type]?.matches === want ||
                (want === 'number' && type === 'int');
        return Object.entries(blueprint?.variables ?? {})
            .filter(([, it]) => !want || fits(it.type))
            .map(([name]) => name);
    }

    /** A field's label, through the element's source. */
    fieldLabel(name: string): string {
        return (
            this.designModel.blueprintModel.getSource(this.values.source)?.fieldLabel(name) ?? name
        );
    }

    /**
     * The fields a filter chooser offers, from the element's source. A dimension also offers its
     * values, a snapshot of the source's rows, at most 1,000.
     */
    filterFieldSpecs(): FilterChooserFieldSpecConfig[] {
        const source = this.designModel.blueprintModel.getSource(this.values.source);
        if (!source) return [];
        const records = source.cube.store.allRecords;
        return Object.values(source.fields).map(it => ({
            field: it.name,
            displayName: source.fieldLabel(it.name),
            fieldType: (FILTER_FIELD_TYPES.includes(it.type) ? it.type : 'auto') as FieldType,
            ...(it.isDimension
                ? {
                      values: sortBy(
                          uniq(records.map(r => r.data[it.name]).filter(v => v != null))
                      ).slice(0, MAX_FILTER_VALUES)
                  }
                : {})
        }));
    }

    /** The value a property takes when unbound: none if optional, else one to start from. */
    unboundValue(node: EditorNode): unknown {
        return node.required ? this.newValue(node.schema) : undefined;
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
const CLS = 'xh-blueprint-element-inspector',
    MAX_FILTER_VALUES = 1000,
    FILTER_FIELD_TYPES = ['string', 'number', 'int', 'bool', 'date', 'localDate'];

interface Option {
    value: string;
    label: string;
}

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
    if (node.bindable) return bindableEditor(node, value, commit, ctx);
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
            return div({
                className: `${CLS}__switch`,
                item: switchInput({value: !!value, disabled, onCommit: v => commit(v)})
            });
        case 'choice':
            return select({
                value: value ?? null,
                options: node.options as any[],
                enableClear: !node.required,
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

function walkStrings(value: unknown, fn: (s: string) => void) {
    if (isString(value)) return fn(value);
    if (value != null && typeof value === 'object')
        Object.values(value).forEach(it => walkStrings(it, fn));
}

// The options, plus any current value they lack, so a select still shows it.
function withCurrent(options: Option[], value: unknown): Option[] {
    const missing = castArray(value ?? []).filter(
        (v): v is string => isString(v) && !options.some(it => it.value === v)
    );
    return [...options, ...missing.map(it => ({value: it, label: it}))];
}

// The variable type a schema takes: a filter, a plain type, or a list of strings.
function variableTypeOf(schema: PlainObject): string {
    if (schema['x-filter']) return 'filter';
    if (schema.type === 'array') return schema.items?.type === 'string' ? 'string[]' : null;
    return (
        {string: 'string', number: 'number', integer: 'int', boolean: 'bool'}[schema.type] ?? null
    );
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
