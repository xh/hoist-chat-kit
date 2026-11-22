import {div, hbox, span} from '@xh/hoist/cmp/layout';
import type {PlainObject} from '@xh/hoist/core';
import {button, buttonGroup} from '@xh/hoist/desktop/cmp/button';
import {menuButton} from '@xh/hoist/desktop/cmp/menu';
import {
    buttonGroupInput,
    dateInput,
    iconPicker,
    jsonInput,
    numberInput,
    segmentedControl,
    select,
    switchInput,
    textArea,
    textInput
} from '@xh/hoist/desktop/cmp/input';
import {Icon} from '@xh/hoist/icon';
import {LocalDate} from '@xh/hoist/utils/datetime';
import {
    castArray,
    isEmpty,
    isEqual,
    isNumber,
    isObject,
    isPlainObject,
    isString,
    omit
} from 'lodash';
import classNames from 'classnames';
import type React from 'react';
import type {ReactElement, ReactNode} from 'react';
import {
    type BlueprintIssue,
    type EditorNode,
    isVarBinding,
    labelOf,
    toEditorSpec
} from '../../../../../blueprint';
import {
    joinNamed,
    joinSteps,
    splitNamed,
    stepsOf
} from '../../../../../blueprint/design/configValues';
import {getOwn} from '../../../../../blueprint/impl/pointer';
import type {ConfigEditorModel} from './ConfigEditorModel';
import {selectChip} from './chips';
import {filterEditor, groupingEditor} from './ChooserEditors';

/** The block class of the element inspector, which its editors' elements extend. */
export const CLS = 'xh-blueprint-element-inspector';

const MAX_STEPS = 8;

// The options of a Hoist number or date format that the editor shows. It keeps any others.
const FORMAT_OPTIONS = toEditorSpec({
    type: 'object',
    properties: {
        precision: {type: 'integer', minimum: 0, maximum: 12, description: 'Decimal places.'},
        scale: {
            enum: ['thousands', 'millions', 'billions', 'auto'],
            description: 'Show in thousands, millions or billions with a label, or compact.'
        },
        ledger: {type: 'boolean', description: 'Show a negative number in parentheses.'},
        colorSpec: {type: 'boolean', description: 'Color a number by its sign.'},
        label: {type: 'string', maxLength: 20, description: 'A unit after the number.'},
        date: {enum: ['date', 'dateTime', 'time', 'compact'], description: 'How a date shows.'},
        pattern: {type: 'string', maxLength: 40, description: 'A date pattern, such as MMM D.'},
        nullDisplay: {type: 'string', maxLength: 20, description: 'The text for no value.'}
    }
});

const CONFIRM_NODE = toEditorSpec({
    type: 'object',
    properties: {confirm: {type: 'boolean', description: 'Ask the user before it runs.'}}
})[0];

/** A choice in a select, by value and label. */
export interface Option {
    value: string;
    label: string;
}

/** What every editor reads beside its value. */
export interface EditorContext {
    impl: ConfigEditorModel;
    // True to show the value without letting it change, as for a confirm an action requires.
    locked?: boolean;
    // The top-level property, which a refusal names.
    key: string;
    // What the value falls back to while unset, which a format or renderer picker names.
    inherited?: {format?: unknown; renderer?: unknown};
}

export interface RowProps {
    /** A note beside the label, such as the preset an edit changes. */
    badge?: string;
    node: EditorNode;
    value: unknown;
    commit: (value: unknown) => void;
    ctx: EditorContext;
    issues?: BlueprintIssue[];
    key?: string;
}

/** A property's label, its editor, and its issues. */
export function propertyRow({node, value, commit, ctx, issues = [], key, badge}: RowProps) {
    return div({
        key,
        ...({'data-config-key': node.key} as object),
        // A one-line value sits beside its label. A structure takes the row's full width.
        className: classNames(
            `${CLS}__row`,
            INLINE_KINDS.includes(node.kind) && !isMultiline(node) && `${CLS}__row--inline`
        ),
        children: [
            div({
                className: `${CLS}__label`,
                title: node.description,
                children: [
                    node.label,
                    node.required ? span({className: `${CLS}__req`, children: '*'}) : null
                ]
            }),
            div({
                className: `${CLS}__row-body`,
                children: [
                    badge
                        ? div({
                              className: classNames(
                                  `${CLS}__badge`,
                                  ctx.impl.canShowPresetGroups && `${CLS}__badge--link`
                              ),
                              title: ctx.impl.canShowPresetGroups ? 'Show the preset group' : null,
                              onClick: () => ctx.impl.showPresetGroupFor(ctx.key),
                              children: badge
                          })
                        : null,
                    editorFor(node, value, commit, ctx),
                    ...issues.map((it, idx) =>
                        div({key: idx, className: `${CLS}__issue`, children: it.message})
                    )
                ]
            })
        ]
    });
}

const INLINE_KINDS = [
    'text',
    'date',
    'number',
    'boolean',
    'choice',
    'variable',
    'preset',
    'source',
    'field',
    'icon',
    'blueprint'
];

function isMultiline(node: EditorNode): boolean {
    return (node.kind === 'text' && node.multiline) || (node.kind === 'field' && node.multiple);
}

function editorFor(
    node: EditorNode,
    value: unknown,
    commit: (value: unknown) => void,
    ctx: EditorContext
): ReactElement {
    const disabled = ctx.impl.readOnly || !!ctx.locked,
        optional = (v: unknown) => (v == null || v === '' ? undefined : v),
        placeholder = node.default !== undefined ? `Default (${node.default})` : undefined,
        // An optional choice with no default in its schema takes one the widget decides.
        choicePlaceholder = placeholder ?? (node.required ? undefined : 'Default');
    if (node.bindable) return bindableEditor(node, value, commit, ctx);
    if (isVarBinding(value) && node.kind !== 'json') {
        return div({className: `${CLS}__binding`, children: `Bound to variable ${value.$var}`});
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
        case 'date':
            return dateInput({
                value: isString(value) && value ? LocalDate.get(value) : null,
                valueType: 'localDate',
                placeholder,
                disabled,
                width: '100%',
                onCommit: (d: LocalDate) => commit(d?.isoString ?? undefined)
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
                children: switchInput({
                    value: !!(value ?? node.default),
                    disabled,
                    onCommit: v => commit(v)
                })
            });
        case 'choice':
            // A choice with an off state, such as a summary row's place, shows every option at once.
            if (node.options.includes(false)) {
                const options = node.options.filter(it => it !== true);
                return segmentedControl({
                    value: value === true ? options[0] : (value ?? node.default ?? false),
                    options: options.map(it => ({
                        value: it as any,
                        label: it === false ? 'Off' : labelOf(String(it))
                    })),
                    disabled,
                    compact: true,
                    onCommit: v => commit(v === node.default ? undefined : v)
                });
            }
            return select({
                value: value ?? null,
                options: node.options as any[],
                enableClear: !node.required,
                placeholder: choicePlaceholder,
                disabled,
                width: '100%',
                onCommit: v => commit(optional(v))
            });
        case 'icon':
            return iconPicker({
                value: (value as string) ?? null,
                enableClear: !node.required,
                disabled,
                width: '100%',
                onCommit: v => commit(optional(v))
            });
        case 'preset':
            return select({
                value: value ?? null,
                options: withCurrent(
                    Object.keys(ctx.impl.designModel.blueprintModel.blueprint?.presets ?? {}).map(
                        it => ({value: it, label: it})
                    ),
                    value
                ),
                disabled,
                width: '100%',
                onCommit: v => commit(optional(v))
            });
        case 'variable':
            return select({
                value: value ?? null,
                options: withCurrent(ctx.impl.settableVariables, value),
                enableClear: !node.required,
                disabled,
                width: '100%',
                onCommit: v => commit(optional(v))
            });
        case 'blueprint': {
            const {impl} = ctx;
            if (!impl.blueprintOptions) impl.loadBlueprintOptionsAsync().catchDefault();
            return select({
                value: value ?? null,
                options: withCurrent(impl.blueprintOptions ?? [], value),
                enableClear: !node.required,
                disabled,
                width: '100%',
                onCommit: v => commit(optional(v))
            });
        }
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
                children: node.children.map(child =>
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
                children: [
                    buttonGroupInput({
                        value: at,
                        disabled,
                        onCommit: (i: number) =>
                            i !== at && commit(ctx.impl.newValue(node.options[i].schema)),
                        children: node.options.map((it, i) =>
                            button({key: i, value: i, text: variantLabel(it)})
                        )
                    }),
                    editorFor(variant, value, commit, ctx)
                ]
            });
        }
        case 'format':
            return formatEditor(value, commit, ctx);
        case 'renderer':
            return rendererEditor(value, commit, ctx);
        case 'action':
            return actionEditor(node, value, commit, ctx);
        default:
            return jsonEditor(value, commit, ctx);
    }
}

// A property that takes a value or a variable. A bound one shows its variable, which a click
// selects, with a way to unbind. An unbound one offers its variables on hover or focus.
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
    if (bound != null) {
        return div({
            className: `${CLS}__bindable`,
            children: [
                selectChip({
                    className: `${CLS}__var-chip`,
                    text: bound,
                    // A bound value changes through its variable, so it is not personalized here.
                    label: `Set by variable ${bound}, which a user changes in its place, not here. Show the variable.`,
                    onSelect: () => impl.designModel.select({kind: 'variable', id: bound})
                }),
                disabled
                    ? null
                    : button({
                          className: `${CLS}__unbind`,
                          icon: Icon.x(),
                          minimal: true,
                          title: 'Use a value',
                          'aria-label': `Unbind ${bound}`,
                          onClick: () => commit(impl.unboundValue(node))
                      })
            ]
        });
    }
    return div({
        className: `${CLS}__bindable`,
        children: [
            div({
                className: `${CLS}__value`,
                children: editorFor({...node, bindable: false}, value, commit, ctx)
            }),
            disabled || !variables.length
                ? null
                : menuButton({
                      className: `${CLS}__bind-button`,
                      icon: Icon.link(),
                      minimal: true,
                      title: 'Bind to a variable',
                      'aria-label': `Bind ${node.label} to a variable`,
                      menuItems: variables.map(it => ({
                          text: it,
                          actionFn: () => commit({$var: it})
                      }))
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
        children: [
            ...items.map((item, i) =>
                div({
                    key: i,
                    className: `${CLS}__item`,
                    children: [
                        hbox({
                            className: `${CLS}__item-header`,
                            children: [
                                div({className: `${CLS}__item-label`, children: `${i + 1}`}),
                                buttonGroup({
                                    children: [
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
                                            intent: 'danger',
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
                intent: 'primary',
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
        children: [
            ...entries.map(([key, val]) =>
                div({
                    key,
                    className: `${CLS}__item`,
                    children: [
                        hbox({
                            className: `${CLS}__item-header`,
                            children: [
                                mapKeyLabel(key, node.keyRole ? ctx.impl.fieldLabel(key) : key),
                                button({
                                    icon: Icon.delete(),
                                    title: 'Remove',
                                    intent: 'danger',
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
        className: `${CLS}__field-list`,
        children: [
            entries.length
                ? div({
                      className: `${CLS}__columns`,
                      children: entries.map((entry, i) => {
                          const open = impl.isItemOpen(ctx.key, i),
                              more = impl.isItemOpen(`${ctx.key}/more`, i),
                              {settingsIn} = node,
                              mapped: PlainObject = settingsIn
                                  ? (getOwn(impl.values[settingsIn.key], entry.field) ?? {})
                                  : {},
                              inherited = impl.inheritedDisplay(entry.field),
                              mappedRow = (setting: EditorNode) =>
                                  propertyRow({
                                      key: `${settingsIn.key}:${setting.key}`,
                                      node: setting,
                                      value: mapped[setting.key],
                                      commit: v =>
                                          impl.commitItemSetting(
                                              settingsIn.key,
                                              entry.field,
                                              setting.key,
                                              v
                                          ),
                                      ctx: {...ctx, key: settingsIn.key, inherited}
                                  });
                          return div({
                              key: `${i}:${entry.field}`,
                              className: classNames(
                                  `${CLS}__column`,
                                  open && `${CLS}__column--open`
                              ),
                              ...({'data-field': entry.field} as object),
                              children: [
                                  hbox({
                                      className: `${CLS}__item-header`,
                                      children: [
                                          span({
                                              className: `${CLS}__column-label`,
                                              children: impl.fieldLabel(entry.field)
                                          }),
                                          span({
                                              className: `${CLS}__column-meta`,
                                              children: columnMeta(mapped, inherited)
                                          }),
                                          buttonGroup({
                                              children: [
                                                  button({
                                                      icon: open
                                                          ? Icon.chevronUp()
                                                          : Icon.chevronDown(),
                                                      text: settingsCount(entry, mapped) || null,
                                                      title: 'Settings',
                                                      minimal: true,
                                                      intent: open ? 'primary' : null,
                                                      onClick: () => impl.toggleItem(ctx.key, i)
                                                  }),
                                                  button({
                                                      icon: Icon.arrowUp(),
                                                      title: 'Move up',
                                                      disabled: disabled || i === 0,
                                                      onClick: () => commitList(moved(i, i - 1))
                                                  }),
                                                  button({
                                                      icon: Icon.arrowDown(),
                                                      title: 'Move down',
                                                      disabled:
                                                          disabled || i === entries.length - 1,
                                                      onClick: () => commitList(moved(i, i + 1))
                                                  }),
                                                  button({
                                                      icon: Icon.delete(),
                                                      title: 'Remove',
                                                      intent: 'danger',
                                                      disabled,
                                                      onClick: () =>
                                                          commitList(
                                                              entries.filter((_, j) => j !== i)
                                                          )
                                                  })
                                              ]
                                          })
                                      ]
                                  }),
                                  open
                                      ? div({
                                            className: `${CLS}__settings`,
                                            children: [
                                                ...(
                                                    settingsIn?.settings.slice(
                                                        0,
                                                        settingsIn.shown
                                                    ) ?? []
                                                ).map(mappedRow),
                                                ...node.settings.map(setting =>
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
                                                                          : {
                                                                                ...it,
                                                                                [setting.key]: v
                                                                            }
                                                                )
                                                            ),
                                                        ctx
                                                    })
                                                ),
                                                settingsIn?.settings.length > settingsIn?.shown
                                                    ? button({
                                                          key: '_more',
                                                          className: `${CLS}__more`,
                                                          text: more
                                                              ? 'Fewer settings'
                                                              : 'More settings',
                                                          icon: more
                                                              ? Icon.chevronUp()
                                                              : Icon.chevronDown(),
                                                          minimal: true,
                                                          onClick: () =>
                                                              impl.toggleItem(`${ctx.key}/more`, i)
                                                      })
                                                    : null,
                                                ...(more
                                                    ? settingsIn.settings
                                                          .slice(settingsIn.shown)
                                                          .map(mappedRow)
                                                    : [])
                                            ]
                                        })
                                      : null
                              ]
                          });
                      })
                  })
                : null,
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

// How many settings a field list entry sets beside its field, with those of its settings map entry,
// as its drawer button shows.
function settingsCount(entry: PlainObject, mapped: PlainObject): number {
    return Object.keys(entry).filter(it => it !== 'field').length + Object.keys(mapped).length;
}

// How a column shows in brief, its own settings over what it inherits, as `mv · 2dp · bar`.
function columnMeta(
    mapped: PlainObject,
    inherited: {format?: unknown; renderer?: unknown}
): string {
    const own = splitNamed(mapped.format),
        base = splitNamed(inherited.format),
        precision = own.options.precision ?? base.options.precision,
        renderer = splitNamed(mapped.renderer ?? inherited.renderer).name;
    return [own.name ?? base.name, precision != null ? `${precision}dp` : null, renderer]
        .filter(Boolean)
        .join(' · ');
}

// A picker's empty choice, naming what an unset value falls back to.
function inheritedLabel(empty: string, inherited: unknown): string {
    return inherited == null ? empty : `Default (${splitNamed(inherited).name ?? 'custom'})`;
}

// A map entry's key, by its field label where it names a field, with the key itself beside.
function mapKeyLabel(key: string, label: string) {
    return div({
        className: `${CLS}__item-label`,
        children: label === key ? [key] : [label, span({className: `${CLS}__key`, children: key})]
    });
}

// A named format, a custom one, or a name with changes: the name, then the options it sets.
function formatEditor(value: unknown, commit: (value: unknown) => void, ctx: EditorContext) {
    const {name, options} = splitNamed(value);
    return div({
        className: `${CLS}__format`,
        children: [
            select({
                value: name,
                options: withCurrent(ctx.impl.formatOptions, name),
                enableClear: true,
                placeholder: isEmpty(options)
                    ? inheritedLabel('Default', ctx.inherited?.format)
                    : 'Custom',
                disabled: ctx.impl.readOnly,
                width: '100%',
                onCommit: (it: string) => commit(joinNamed(it, options))
            }),
            optionsGroup(FORMAT_OPTIONS, options, it => commit(joinNamed(name, it)), ctx)
        ]
    });
}

// A renderer from the registry, with the options its spec takes.
function rendererEditor(value: unknown, commit: (value: unknown) => void, ctx: EditorContext) {
    const {name, options} = splitNamed(value),
        schema = name ? ctx.impl.rendererConfig(name) : null;
    return div({
        className: `${CLS}__renderer`,
        children: [
            select({
                value: name,
                options: withCurrent(ctx.impl.rendererOptions, name),
                enableClear: true,
                placeholder: inheritedLabel('None', ctx.inherited?.renderer),
                disabled: ctx.impl.readOnly,
                width: '100%',
                // Another renderer's options mean nothing to this one.
                onCommit: (it: string) => commit(joinNamed(it, {}))
            }),
            schema?.properties
                ? optionsGroup(
                      toEditorSpec(schema),
                      options,
                      it => commit(joinNamed(name, it)),
                      ctx
                  )
                : null
        ]
    });
}

// The editors for an object's options, which keep any options they do not show.
function optionsGroup(
    nodes: EditorNode[],
    options: PlainObject,
    commit: (options: PlainObject) => void,
    ctx: EditorContext
) {
    return div({
        className: `${CLS}__group`,
        children: nodes.map(node =>
            propertyRow({
                key: node.key,
                node,
                value: options[node.key],
                commit: v =>
                    commit(v === undefined ? omit(options, node.key) : {...options, [node.key]: v}),
                ctx
            })
        )
    });
}

// One action, or steps run in order: each a type from the registry, its parameters, and whether
// it asks the user to confirm.
function actionEditor(
    node: EditorNode,
    value: unknown,
    commit: (value: unknown) => void,
    ctx: EditorContext
) {
    const {impl} = ctx,
        disabled = impl.readOnly,
        steps = stepsOf(value),
        commitSteps = (list: PlainObject[]) => commit(joinSteps(list)),
        replace = (i: number, step: PlainObject) =>
            commitSteps(steps.map((it, j) => (j === i ? step : it))),
        moved = (from: number, to: number) => {
            const ret = [...steps];
            ret.splice(to, 0, ...ret.splice(from, 1));
            return ret;
        };
    return div({
        className: `${CLS}__list`,
        children: [
            ...steps.map((step, i) => {
                const spec = impl.actionSpec(step.type),
                    locked = impl.confirmLocked(step.type),
                    params = spec ? toEditorSpec(spec.params) : [];
                return div({
                    key: i,
                    className: `${CLS}__step`,
                    children: [
                        hbox({
                            className: `${CLS}__item-header`,
                            children: [
                                select({
                                    value: step.type,
                                    options: withCurrent(impl.actionOptions, step.type),
                                    disabled,
                                    flex: 1,
                                    onCommit: (type: string) =>
                                        type !== step.type &&
                                        replace(i, {
                                            ...impl.stepStart(type),
                                            ...(step.confirm ? {confirm: true} : {})
                                        })
                                }),
                                buttonGroup({
                                    children: [
                                        button({
                                            icon: Icon.arrowUp(),
                                            title: 'Move up',
                                            disabled: disabled || i === 0,
                                            onClick: () => commitSteps(moved(i, i - 1))
                                        }),
                                        button({
                                            icon: Icon.arrowDown(),
                                            title: 'Move down',
                                            disabled: disabled || i === steps.length - 1,
                                            onClick: () => commitSteps(moved(i, i + 1))
                                        }),
                                        button({
                                            icon: Icon.delete(),
                                            title: 'Remove',
                                            intent: 'danger',
                                            disabled:
                                                disabled || (node.required && steps.length === 1),
                                            onClick: () =>
                                                commitSteps(steps.filter((_, j) => j !== i))
                                        })
                                    ]
                                })
                            ]
                        }),
                        div({className: `${CLS}__description`, children: impl.describeStep(step)}),
                        // An action's values are literals or variables.
                        ...params.map(param =>
                            step.type === 'openBlueprint' && param.key === 'variables'
                                ? labelled(
                                      param.label,
                                      linkValuesEditor(
                                          (step.variables as PlainObject) ?? {},
                                          v =>
                                              replace(
                                                  i,
                                                  isEmpty(v)
                                                      ? omit(step, 'variables')
                                                      : {...step, variables: v}
                                              ),
                                          ctx
                                      ),
                                      [],
                                      null,
                                      param.description
                                  )
                                : propertyRow({
                                      key: param.key,
                                      node: {
                                          ...stepParamNode(step, param, impl),
                                          bindable: param.kind !== 'variable'
                                      },
                                      value: step[param.key],
                                      commit: v =>
                                          replace(
                                              i,
                                              v === undefined
                                                  ? omit(step, param.key)
                                                  : {...step, [param.key]: v}
                                          ),
                                      ctx
                                  })
                        ),
                        propertyRow({
                            key: 'confirm',
                            node: CONFIRM_NODE,
                            value: locked || !!step.confirm,
                            commit: v =>
                                replace(i, v ? {...step, confirm: true} : omit(step, 'confirm')),
                            ctx: locked ? {...ctx, locked: true} : ctx
                        })
                    ]
                });
            }),
            button({
                icon: Icon.add(),
                intent: 'primary',
                text: steps.length ? 'Add a step' : 'Add an action',
                minimal: true,
                disabled: disabled || steps.length >= MAX_STEPS || !impl.defaultActionType,
                onClick: () => commitSteps([...steps, impl.stepStart(impl.defaultActionType)])
            })
        ]
    });
}

// A setVariable step's value takes the editor of the variable it sets.
// The values an openBlueprint passes, a row each: a variable, a field of the row in a row action, or
// a value as written.
function linkValuesEditor(
    values: PlainObject,
    commit: (values: PlainObject) => void,
    ctx: EditorContext
) {
    const {impl} = ctx,
        disabled = impl.readOnly,
        rowFields = ctx.key === 'rowActions' ? impl.fieldOptions('any') : [],
        variables = Object.keys(impl.designModel.blueprintModel.blueprint?.variables ?? {}),
        set = (name: string, value: unknown) => commit({...values, [name]: value}),
        // A new name starts from the variable or row field it shares a name with, if any.
        starter = (name: string) =>
            variables.includes(name)
                ? {$var: name}
                : rowFields.some(it => it.value === name)
                  ? {$row: name}
                  : '';
    return div({
        className: `${CLS}__link-values`,
        children: [
            ...Object.entries(values).map(([name, value]) => {
                const v = value as PlainObject,
                    chip = isVarBinding(value)
                        ? {text: v.$var, label: `Show variable ${v.$var}`}
                        : isPlainObject(value) && isString(v.$row)
                          ? {text: `row · ${v.$row}`, label: `Row field ${v.$row}`}
                          : null;
                return div({
                    key: name,
                    className: classNames(
                        `${CLS}__row`,
                        `${CLS}__row--inline`,
                        `${CLS}__link-value`
                    ),
                    children: [
                        div({className: `${CLS}__label`, children: name}),
                        div({
                            className: `${CLS}__row-body`,
                            children: [
                                div({
                                    className: `${CLS}__bindable`,
                                    children: [
                                        chip
                                            ? selectChip({
                                                  className: `${CLS}__var-chip`,
                                                  text: chip.text,
                                                  label: chip.label,
                                                  onSelect: () =>
                                                      isVarBinding(value) &&
                                                      impl.designModel.select({
                                                          kind: 'variable',
                                                          id: v.$var
                                                      })
                                              })
                                            : isObject(value)
                                              ? jsonEditor(value, it => set(name, it), ctx)
                                              : textInput({
                                                    value: value == null ? '' : String(value),
                                                    disabled,
                                                    width: '100%',
                                                    onCommit: (it: string) =>
                                                        set(
                                                            name,
                                                            isNumber(value) &&
                                                                it !== '' &&
                                                                !isNaN(+it)
                                                                ? +it
                                                                : it
                                                        )
                                                }),
                                        disabled
                                            ? null
                                            : menuButton({
                                                  className: `${CLS}__bind-button`,
                                                  icon: Icon.link(),
                                                  minimal: true,
                                                  title: 'Pass a variable or a row field',
                                                  menuItems: [
                                                      ...variables.map(it => ({
                                                          text: it,
                                                          actionFn: () => set(name, {$var: it})
                                                      })),
                                                      ...(rowFields.length && variables.length
                                                          ? ['-' as const]
                                                          : []),
                                                      ...rowFields.map(it => ({
                                                          text: `row · ${it.label}`,
                                                          actionFn: () =>
                                                              set(name, {$row: it.value})
                                                      })),
                                                      ...(chip
                                                          ? [
                                                                '-' as const,
                                                                {
                                                                    text: 'A value',
                                                                    actionFn: () => set(name, '')
                                                                }
                                                            ]
                                                          : [])
                                                  ]
                                              })
                                    ]
                                }),
                                disabled
                                    ? null
                                    : button({
                                          className: `${CLS}__link-remove`,
                                          icon: Icon.delete(),
                                          title: 'Remove',
                                          intent: 'danger',
                                          minimal: true,
                                          onClick: () => commit(omit(values, name))
                                      })
                            ]
                        })
                    ]
                });
            }),
            disabled
                ? null
                : textInput({
                      key: Object.keys(values).length,
                      placeholder: 'Pass a variable of the target…',
                      width: '100%',
                      onCommit: (name: string) =>
                          name && !Object.hasOwn(values, name) && set(name, starter(name))
                  })
        ]
    });
}

function stepParamNode(step: PlainObject, param: EditorNode, impl: ConfigEditorModel): EditorNode {
    if (step.type !== 'setVariable' || param.key !== 'value') return param;
    const typed = impl.valueNodeFor(step.variable);
    return typed ? {...typed, key: param.key, label: param.label, required: param.required} : param;
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

/** A row of a label, an editor, and the issues under them. */
export function labelled(
    label: string,
    editor: unknown,
    rowIssues: {message: string}[] = [],
    badge: string = null,
    hint: string = null
) {
    return div({
        key: label,
        className: `${CLS}__row`,
        children: [
            div({className: `${CLS}__label`, children: label}),
            hint ? div({className: `${CLS}__hint`, children: hint}) : null,
            badge ? div({className: `${CLS}__badge`, children: badge}) : null,
            editor as any,
            ...rowIssues.map((it, idx) =>
                div({key: idx, className: `${CLS}__issue`, children: it.message})
            )
        ]
    });
}

/** The issues at a key, each as a row. */
export function issueRows(impl: ConfigEditorModel, key: string) {
    return impl
        .issuesFor(key)
        .map((it, idx) => div({key: idx, className: `${CLS}__issue`, children: it.message}));
}

/** The editor node of one property with the schema given. */
export function nodeOf(key: string, schema: PlainObject): EditorNode {
    return toEditorSpec({type: 'object', properties: {[key]: schema}})[0];
}

/** Names as a list in prose: "a", "a and b", or "a, b and c". */
export function listOf(names: string[]): string {
    return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0];
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

/** A titled group of rows, drawn as a card, which folds where it can. */
export function sectionCard({
    key,
    title,
    badge,
    collapsed = false,
    onToggle,
    children
}: {
    key: string;
    title: string;
    /** A link beside the title, such as to the preset group a path in the card belongs to. */
    badge?: {text: string; onClick: () => void};
    collapsed?: boolean;
    onToggle?: () => void;
    children: ReactNode[];
}) {
    return div({
        key,
        className: `${CLS}__card`,
        children: [
            div({
                className: classNames(
                    `${CLS}__card-header`,
                    onToggle && `${CLS}__card-header--toggle`
                ),
                onClick: onToggle,
                children: [
                    onToggle ? (collapsed ? Icon.chevronRight() : Icon.chevronDown()) : null,
                    title,
                    badge
                        ? button({
                              className: `${CLS}__card-badge`,
                              text: badge.text,
                              minimal: true,
                              title: 'Show the preset group',
                              onClick: (e: React.MouseEvent) => {
                                  e.stopPropagation();
                                  badge.onClick();
                              }
                          })
                        : null
                ]
            }),
            collapsed ? null : div({className: `${CLS}__card-body`, children})
        ]
    });
}
