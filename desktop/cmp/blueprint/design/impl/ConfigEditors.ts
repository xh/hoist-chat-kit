import {card} from '@xh/hoist/cmp/card';
import {div, hbox, span} from '@xh/hoist/cmp/layout';
import {hoistCmp, type HoistProps, type PlainObject} from '@xh/hoist/core';
import {button} from '@xh/hoist/desktop/cmp/button';
import {menuButton} from '@xh/hoist/desktop/cmp/menu';
import {sortableList} from '@xh/hoist/cmp/sortablelist';
import {
    buttonGroupInput,
    dateInput,
    iconPicker,
    jsonInput,
    numberInput,
    radioCardInput,
    segmentedControl,
    select,
    textArea,
    textInput
} from '@xh/hoist/desktop/cmp/input';
import {Icon} from '@xh/hoist/icon';
import {tooltip} from '@xh/hoist/kit/blueprint';
import {compareStructural, computed} from '@xh/hoist/mobx';
import {wait} from '@xh/hoist/promise';
import {LocalDate} from '@xh/hoist/utils/datetime';
import {
    castArray,
    isArray,
    isEmpty,
    isEqual,
    isNumber,
    isObject,
    isPlainObject,
    isString,
    omit,
    sortBy,
    without
} from 'lodash';
import classNames from 'classnames';
import type React from 'react';
import {type ReactElement, type ReactNode, useCallback, useEffect, useMemo, useRef} from 'react';
import {
    type BlueprintIssue,
    type EditorNode,
    isVarBinding,
    labelOf,
    toEditorSpec
} from '../../../../../blueprint';
import {
    joinNamed,
    joinSortKeys,
    joinSteps,
    type SortKey,
    sortKeysOf,
    splitNamed,
    stepsOf
} from '../../../../../blueprint/design/configValues';
import {listOf} from '../../../../../blueprint/impl/labels';
import {getOwn} from '../../../../../blueprint/impl/pointer';
export {listOf};
import {thumbnailPreview} from '../../BlueprintPreview';
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
        colorSpec: {
            type: 'boolean',
            title: 'Color',
            'x-labels': {true: 'By sign', false: 'None'},
            description: 'Color a number by its sign.'
        },
        label: {type: 'string', maxLength: 20, description: 'A unit after the number.'},
        date: {enum: ['date', 'dateTime', 'time', 'compact'], description: 'How a date shows.'},
        pattern: {type: 'string', maxLength: 40, description: 'A date pattern, such as MMM D.'},
        nullDisplay: {type: 'string', maxLength: 20, description: 'The text for no value.'}
    }
});

// The format options only a number takes, and those only a date takes.
const NUMBER_OPTIONS = ['precision', 'scale', 'ledger', 'colorSpec', 'label'],
    DATE_OPTIONS = ['date', 'pattern'],
    NUMBER_TYPES = ['number', 'int'],
    DATE_TYPES = ['date', 'localDate'];

// The options that fit a format: a number's or a date's, by the type of the field it formats where
// known, else by the options it and its named definition set, or all of them where those say
// neither or both.
function formatOptionNodes(
    definition: PlainObject,
    options: PlainObject,
    fieldType: string
): EditorNode[] {
    const keys = Object.keys({...definition, ...options}),
        isDate = DATE_TYPES.includes(fieldType) || keys.some(it => DATE_OPTIONS.includes(it)),
        isNumber = NUMBER_TYPES.includes(fieldType) || keys.some(it => NUMBER_OPTIONS.includes(it));
    if (isDate === isNumber) return FORMAT_OPTIONS;
    const others = isDate ? NUMBER_OPTIONS : DATE_OPTIONS;
    return FORMAT_OPTIONS.filter(it => !others.includes(it.key));
}

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
    inherited?: {format?: unknown; renderer?: unknown; headerName?: string};
    // Where in the config the editor sits, for the open state and keys of its lists. Default key.
    scope?: string;
    // The type of the field a setting belongs to, such as a column's, which a format's options fit.
    fieldType?: string;
}

const scopeOf = (ctx: EditorContext) => ctx.scope ?? ctx.key;

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

/**
 * A property's label, its editor, and its issues. A set value shows a dot before the label, which
 * hover turns to ↺ to reset it, as Delete on a focused control does. The label's tooltip and the
 * focused row's help line come from its schema.
 */
export function propertyRow({node, value, commit, ctx, issues = [], key, badge}: RowProps) {
    const isSet = value !== undefined,
        canReset = isSet && !badge && !ctx.impl.readOnly && !ctx.locked,
        reset = () => commit(undefined);
    return div({
        key,
        // Named for its label, so each control in it reads with the property it sets.
        ...({'data-config-key': node.key, role: 'group', 'aria-label': node.label} as object),
        // A one-line value sits beside its label. A structure takes the row's full width.
        className: classNames(
            `${CLS}__row`,
            INLINE_KINDS.includes(node.kind) && !isMultiline(node) && `${CLS}__row--inline`,
            isSet && `${CLS}__row--set`,
            node.required && !isSet && !badge && `${CLS}__row--missing`
        ),
        onKeyDown: (e: React.KeyboardEvent) => {
            const target = e.target as HTMLElement;
            if (e.key !== 'Delete' || !canReset || isTextEntry(target)) return;
            // Only for this row's own control, not one in a list or drawer inside it.
            if (target.closest('[data-config-key]') !== e.currentTarget) return;
            e.preventDefault();
            e.stopPropagation();
            reset();
        },
        children: [
            div({
                className: `${CLS}__label`,
                children: [
                    isSet ? span({className: `${CLS}__dot`, 'aria-hidden': true} as object) : null,
                    canReset
                        ? button({
                              className: `${CLS}__reset`,
                              icon: Icon.reset(),
                              minimal: true,
                              small: true,
                              title: `Reset ${node.label}`,
                              'aria-label': `Reset ${node.label}`,
                              onClick: reset
                          })
                        : null,
                    labelTooltip(node),
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
                        div({
                            key: idx,
                            className: classNames(
                                `${CLS}__issue`,
                                it.severity === 'warning' && `${CLS}__issue--warning`
                            ),
                            children: it.message
                        })
                    ),
                    node.description
                        ? div({
                              className: `${CLS}__help`,
                              children: firstSentence(node.description)
                          })
                        : null
                ]
            }),
            node.kind === 'format' ? formatOptionsCard(value, commit, ctx, !!issues.length) : null,
            node.kind === 'sort' ? sortDrawer(node, value, commit, ctx) : null
        ]
    });
}

// The label, with a tooltip of the property's description, its default, whether it binds, and
// the key the JSON and the Architect use.
function labelTooltip(node: EditorNode): ReactNode {
    const {description, default: dflt, bindable, key} = node;
    return tooltip({
        className: `${CLS}__label-text`,
        popoverClassName: `${CLS}__label-tip`,
        hoverOpenDelay: 500,
        content: div({
            children: [
                description ? div({children: description}) : null,
                dflt !== undefined
                    ? div({
                          className: `${CLS}__label-tip-fact`,
                          children: `Default ${defaultText(node)}`
                      })
                    : null,
                bindable
                    ? div({className: `${CLS}__label-tip-fact`, children: 'Can bind to a variable'})
                    : null,
                div({className: `${CLS}__label-tip-key`, children: key})
            ]
        }),
        item: span({tabIndex: 0, children: node.label})
    });
}

function defaultText(node: EditorNode): string {
    const dflt = node.default;
    if (node.kind === 'boolean' || node.kind === 'choice')
        return choiceLabel(node, dflt === true ? 'true' : dflt);
    return isArray(dflt) ? (dflt as unknown[]).join(', ') : String(dflt);
}

/** The first sentence of a description, for a line of help. */
export function firstSentence(text: string): string {
    return text.match(/^.*?[.!?](\s|$)/)?.[0].trim() ?? text;
}

// True where Delete edits text rather than resetting the setting.
function isTextEntry(el: HTMLElement): boolean {
    return el?.tagName === 'TEXTAREA' || el?.tagName === 'INPUT' || el?.isContentEditable;
}

// A ref that names an input for assistive tech, as Hoist's inputs take no aria-label.
const named = (name: string) => (el: HTMLElement) => el?.setAttribute('aria-label', name);

/**
 * A ref for a host of property rows that names each row's unnamed inputs, such as a select's, by
 * the row's label, after every draw.
 */
export function useNamedInputs() {
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
        ref.current
            ?.querySelectorAll<HTMLElement>('[data-config-key][aria-label]')
            .forEach(row =>
                row
                    .querySelectorAll(
                        'input:not([aria-label]), [role="combobox"]:not([aria-label])'
                    )
                    .forEach(it => it.setAttribute('aria-label', row.getAttribute('aria-label')))
            );
    });
    return ref;
}

const INLINE_KINDS = [
    'text',
    'date',
    'number',
    'boolean',
    'choice',
    'format',
    'pair',
    'sort',
    'variable',
    'preset',
    'source',
    'field',
    'icon',
    'blueprint'
];

function isMultiline(node: EditorNode): boolean {
    return (
        (node.kind === 'text' && node.multiline) ||
        (node.kind === 'field' && node.multiple) ||
        (node.kind === 'choice' && !!node.thumbnails)
    );
}

function editorFor(
    node: EditorNode,
    value: unknown,
    commit: (value: unknown) => void,
    ctx: EditorContext
): ReactElement {
    const disabled = ctx.impl.readOnly || !!ctx.locked,
        optional = (v: unknown) => (v == null || v === '' ? undefined : v),
        unset = node.schema['x-unset'] as string,
        // While unset, a value shows its default, else what it takes from its field, else what
        // unset means.
        fromField = getOwn<unknown>(ctx.inherited as PlainObject, node.key),
        placeholder =
            node.default !== undefined
                ? String(node.default)
                : typeof fromField === 'string'
                  ? `${fromField} (from the field)`
                  : unset,
        // An optional choice with neither takes one the widget decides as it draws.
        isDecided = node.default === undefined && !unset && !node.required,
        choicePlaceholder =
            node.default !== undefined
                ? `${choiceLabel(node, node.default)} (default)`
                : (unset ?? (isDecided ? 'Default' : undefined)),
        implied = value === undefined;
    if (node.bindable) return bindableEditor(node, value, commit, ctx);
    if (isVarBinding(value) && node.kind !== 'json') {
        return div({className: `${CLS}__binding`, children: `Bound to variable ${value.$var}`});
    }
    switch (node.kind) {
        case 'text':
            return (node.multiline ? textArea : textInput)({
                value: (value as string) ?? null,
                inputRef: named(node.label),
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
                inputRef: named(node.label),
                min: node.min,
                max: node.max,
                precision: node.integer ? 0 : 4,
                placeholder,
                disabled,
                width: '100%',
                onCommit: v => commit(optional(v))
            });
        case 'boolean':
            return booleanEditor({
                value: !!(value ?? node.default),
                labels: node.labels,
                disabled,
                implied,
                onCommit: v => commit(v === (node.default ?? false) ? undefined : v)
            });
        case 'choice':
            // A choice of four pictures or fewer shows a card for each. A longer one is a select
            // with a small picture per option.
            if (node.thumbnails && node.options.filter(it => it !== true).length <= 4) {
                const options = node.options.filter(it => it !== true);
                return radioCardInput({
                    value: value === true ? options[0] : (value ?? node.default ?? null),
                    options: [
                        ...(node.required || node.default !== undefined
                            ? []
                            : [{value: null, label: 'Default'}]),
                        ...options.map(it => ({
                            value: it as any,
                            label: choiceLabel(node, it),
                            preview: thumbnailPreview(node.thumbnails[String(it)])
                        }))
                    ],
                    disabled,
                    cardWidth: 76,
                    className: classNames(implied && `${CLS}__implied`),
                    onCommit: v => commit(v === node.default || v == null ? undefined : v)
                });
            }
            // A choice with an off state, such as a summary row's place, shows every option at once.
            if (node.options.includes(false)) {
                const options = node.options.filter(it => it !== true);
                return segmentedControl({
                    value: value === true ? options[0] : (value ?? node.default ?? false),
                    options: options.map(it => ({
                        value: it as any,
                        label: choiceLabel(node, it)
                    })),
                    disabled,
                    compact: true,
                    className: classNames(implied && `${CLS}__implied`),
                    onCommit: v => commit(v === node.default ? undefined : v)
                });
            }
            return select({
                value: value ?? null,
                options: choiceOptions(node),
                ...(node.thumbnails
                    ? {
                          optionRenderer: (opt: Option) =>
                              hbox({
                                  className: `${CLS}__pictured-option`,
                                  children: [
                                      thumbnailPreview(node.thumbnails[String(opt.value)], {
                                          width: 30,
                                          height: 18
                                      }),
                                      span(opt.label)
                                  ]
                              })
                      }
                    : {}),
                enableClear: !node.required,
                placeholder: choicePlaceholder,
                ...(isDecided ? {title: 'The widget decides as it draws, when unset.'} : {}),
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
                    Object.keys(ctx.impl.presets).map(it => ({value: it, label: it})),
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
            return listEditor({node, list: (value as unknown[]) ?? [], commit, ctx});
        case 'filter':
            return filterEditor({
                key: ctx.impl.sourceName,
                value: value as PlainObject,
                fieldSpecs: () => ctx.impl.filterFieldSpecs(),
                labelOf: it => ctx.impl.fieldLabel(it),
                disabled,
                onCommit: commit
            });
        case 'fieldList':
            return fieldListEditor({node, list: (value as unknown[]) ?? [], commit, ctx});
        case 'map':
            return mapEditor(node, (value as PlainObject) ?? {}, commit, ctx);
        case 'oneOf': {
            // An unset value shows the form last chosen, so a switch needs no edit to stick.
            const scope = scopeOf(ctx),
                at =
                    value == null
                        ? (ctx.impl.variants[scope] ?? 0)
                        : Math.max(
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
                        onCommit: (i: number) => {
                            if (i === at) return;
                            const next = switchedValue(value, node.options[i], node, ctx);
                            // A list whose first item the other form cannot take stays a list.
                            if (next === undefined && Array.isArray(value) && value.length) {
                                ctx.impl.refuse(
                                    ctx.key,
                                    `${variantLabel(node.options[i])} cannot take ${JSON.stringify(value[0])}. Edit the list first.`
                                );
                                return;
                            }
                            ctx.impl.chooseVariant(scope, i);
                            if (next !== undefined || value !== undefined) commit(next);
                        },
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
        case 'sort':
            return sortSummary(value, ctx);
        case 'pair':
            return pairEditor(node, value, commit, disabled);
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
                // Its remove unbinds, back to a value.
                selectChip({
                    className: `${CLS}__var-chip`,
                    kind: 'variable',
                    text: bound,
                    // A bound value changes through its variable, so it is not personalized here.
                    label: `Set by variable ${bound}, which a user changes in its place, not here. Show the variable.`,
                    onSelect: () => impl.designModel.select({kind: 'variable', id: bound}),
                    onRemove: disabled
                        ? null
                        : e => {
                              // Focus stays in the row, on the editor that takes the chip's place.
                              const row = (e.currentTarget as HTMLElement).closest(
                                  '[data-config-key]'
                              );
                              commit(impl.unboundValue(node));
                              wait().then(() =>
                                  row
                                      ?.querySelector<HTMLElement>(
                                          'input, textarea, [tabindex="0"], button'
                                      )
                                      ?.focus()
                              );
                          },
                    removeHint: 'Delete unbinds.'
                }),
                // Where users could change it in place, say that the variable now takes their changes.
                impl.isPersonalizable(ctx.key)
                    ? div({
                          className: `${CLS}__bound-note`,
                          children: [
                              'Users change this through ',
                              selectChip({
                                  className: `${CLS}__var-chip`,
                                  kind: 'variable',
                                  text: bound,
                                  label: `Show variable ${bound}`,
                                  onSelect: () =>
                                      impl.designModel.select({kind: 'variable', id: bound})
                              })
                          ]
                      })
                    : null
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
                : tooltip({
                      content: 'Bind to a variable',
                      hoverOpenDelay: 500,
                      item: menuButton({
                          className: `${CLS}__bind-button`,
                          icon: Icon.link(),
                          minimal: true,
                          'aria-label': `Bind ${node.label} to a variable`,
                          menuItems: [
                              ...variables.map(it => ({
                                  text: it,
                                  actionFn: () => commit({$var: it})
                              })),
                              ...(impl.isPersonalizable(ctx.key)
                                  ? [
                                        '-' as const,
                                        {
                                            text: 'Binding moves user changes to the variable.',
                                            className: `${CLS}__menu-note`,
                                            disabled: true
                                        }
                                    ]
                                  : [])
                          ]
                      })
                  })
        ]
    });
}

interface ListEditorProps<N extends EditorNode> extends HoistProps {
    node: N;
    list: unknown[];
    commit: (value: unknown) => void;
    ctx: EditorContext;
}

const listEditor = hoistCmp.factory<ListEditorProps<Extract<EditorNode, {kind: 'list'}>>>({
    displayName: 'BlueprintListEditor',
    model: false,
    render({node, list: items, commit, ctx}) {
        const {impl} = ctx,
            scope = scopeOf(ctx),
            disabled = impl.readOnly,
            commitList = (list: unknown[]) =>
                commit(isEmpty(list) && !node.required ? undefined : list),
            keys = impl.keysFor(scope, items),
            rows = useStableRows(items.map((value, index) => ({key: keys[index], index, value}))),
            // Called by key as a row acts, so a row that skipped drawing acts on the list as it is.
            ops = useLatest({
                remove: (key: string) => commitList(items.filter((_, j) => keys[j] !== key)),
                set: (key: string, v: unknown) =>
                    commitList(items.map((it, j) => (keys[j] === key ? v : it)))
            }),
            renderers = useStableRenderers({
                renderItem: (row: PlainObject) =>
                    hbox({
                        className: classNames(
                            `${CLS}__item-header`,
                            impl.isItemOpen(scope, row.key) && `${CLS}__column--open`
                        ),
                        children: [
                            span({
                                className: `${CLS}__column-label`,
                                children: itemLabel(row.value, row.index)
                            }),
                            removeItemButton('Remove', impl.readOnly, () =>
                                ops.current.remove(row.key)
                            )
                        ]
                    }),
                renderDetail: (row: PlainObject) =>
                    div({
                        className: `${CLS}__settings`,
                        children: editorFor(
                            node.item,
                            row.value,
                            v => ops.current.set(row.key, v),
                            {...ctx, scope: `${scope}/${row.key}`}
                        )
                    })
            });
        return div({
            className: `${CLS}__field-list`,
            children: [
                rows.length
                    ? sortableList({
                          className: `${CLS}__columns`,
                          value: rows,
                          itemKey: 'key',
                          getItemLabel: (row: PlainObject) => itemLabel(row.value, row.index),
                          disabled,
                          compact: true,
                          onReorder: e => commitList(e.items.map((it: PlainObject) => it.value)),
                          ...openItemOf(impl, scope),
                          ...renderers
                      })
                    : null,
                button({
                    icon: Icon.add(),
                    intent: 'primary',
                    text: 'Add',
                    minimal: true,
                    disabled,
                    onClick: () => {
                        // A new item opens, for its settings.
                        const item = impl.newValue(node.item.schema),
                            key = impl.addKey(scope, item);
                        commitList([...items, item]);
                        impl.setOpenItem(scope, key);
                    }
                })
            ]
        });
    }
});

/** A boolean as two segments, the positive state first, which a click anywhere flips. */
export function booleanEditor({
    value,
    labels,
    disabled,
    implied = false,
    onCommit
}: {
    value: boolean;
    labels: {value: boolean; label: string}[];
    disabled: boolean;
    /** True while unset, which marks the default it shows more quietly than a value set. */
    implied?: boolean;
    onCommit: (value: boolean) => void;
}) {
    return segmentedControl({
        className: classNames(implied && `${CLS}__implied`),
        value,
        options: labels,
        intent: 'primary',
        toggleOnClick: true,
        fill: false,
        compact: true,
        disabled,
        onCommit
    });
}

// A list's one open item, kept by the Inspector, so it stays open while the list remounts.
function openItemOf(impl: ConfigEditorModel, scope: string) {
    const open = impl.openItems[scope];
    return {
        expandedKeys: open != null ? [open] : [],
        onExpandedChange: (keys: Array<string | number>) =>
            impl.setOpenItem(scope, keys.length ? String(keys[0]) : null)
    };
}

// A field's drawer chevron, which turns while its drawer is open.
function drawerButton(open: boolean, onClick: () => void) {
    return button({
        className: `${CLS}__chevron`,
        icon: Icon.chevronDown(),
        title: 'Settings',
        minimal: true,
        intent: open ? 'primary' : null,
        onClick,
        ...({'aria-expanded': open} as object)
    });
}

/** A list item's remove button. */
export function removeItemButton(title: string, disabled: boolean, onClick: () => void) {
    return button({
        icon: Icon.minusCircle(),
        title,
        intent: 'danger',
        minimal: true,
        disabled,
        onClick
    });
}

// What a list item shows as: its label, title or name, else its place.
function itemLabel(value: unknown, index: number): string {
    const v = value as PlainObject;
    return (isPlainObject(v) && [v.label, v.title, v.name].find(isString)) || `${index + 1}`;
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
type FieldListNode = Extract<EditorNode, {kind: 'fieldList'}>;

// A field list's entries and the ops that change them, by a row's key, for its list and its pages.
function useFieldList(
    node: FieldListNode,
    items: unknown[],
    commit: (v: unknown) => void,
    ctx: EditorContext
) {
    const {impl} = ctx,
        {settingsIn} = node,
        entries = items.map(it => (isString(it) ? {field: it} : (it as PlainObject))),
        commitList = (list: PlainObject[]) => {
            const ret = list.map(it => (Object.keys(it).length === 1 ? it.field : it));
            commit(isEmpty(ret) && !node.required ? undefined : ret);
        },
        // Keyed by field, and by place among the same field's, so a list with a repeated or a
        // missing field still draws, for the user to fix.
        seen: Record<string, number> = {},
        rows = useStableRows(
            entries.map(entry => {
                const name = isString(entry.field) ? entry.field : '?',
                    n = (seen[name] = (seen[name] ?? 0) + 1);
                return {key: `${name}#${n}`, entry};
            })
        ),
        // Called by key as a row acts, so a row that skipped drawing acts on the list as it is.
        ops = useLatest({
            commitList,
            add: (field: string) => field && commitList([...entries, {field}]),
            remove: (key: string) => commitList(entries.filter((_, j) => rows[j].key !== key)),
            set: (key: string, settingKey: string, v: unknown) =>
                commitList(
                    entries.map((it, j) =>
                        rows[j].key !== key
                            ? it
                            : v === undefined
                              ? omit(it, settingKey)
                              : {...it, [settingKey]: v}
                    )
                )
        }),
        mappedOf = (entry: PlainObject): PlainObject =>
            settingsIn
                ? (getOwn(impl.propValue(settingsIn.key) as PlainObject, entry.field) ?? {})
                : {};
    return {entries, rows, ops, mappedOf};
}

// One setting of a field list entry, its own or in its settings map, as a row of its own.
function entrySetting(
    node: FieldListNode,
    setting: EditorNode,
    own: boolean,
    {key, entry}: PlainObject,
    mapped: PlainObject,
    ctx: EditorContext,
    ops: ReturnType<typeof useFieldList>['ops']
) {
    const scope = `${scopeOf(ctx)}/${key}`;
    return own
        ? drawerSetting({
              key: setting.key,
              impl: ctx.impl,
              node: setting,
              value: entry[setting.key],
              listKey: ctx.key,
              scope,
              rowKey: key,
              ops,
              locked: ctx.locked
          })
        : drawerSetting({
              key: `${node.settingsIn.key}:${setting.key}`,
              impl: ctx.impl,
              node: setting,
              value: mapped[setting.key],
              listKey: node.settingsIn.key,
              scope,
              field: entry.field,
              locked: ctx.locked
          });
}

// Every setting of a field list entry: its own, then its settings map's, each marked by which.
const entrySettings = (node: FieldListNode) => [
    ...node.settings.map(it => ({setting: it, own: true})),
    ...(node.settingsIn?.settings ?? []).map(it => ({setting: it, own: false}))
];

// What a set value shows as on its item's row, such as `$m 1dp`, `pinned left` or `90px`.
function chipText(setting: EditorNode, value: unknown): string {
    if (value == null || value === false) return null;
    switch (setting.kind) {
        case 'format': {
            const {name, options} = splitNamed(value);
            return (
                [name, options.precision != null ? `${options.precision}dp` : null]
                    .filter(Boolean)
                    .join(' ') || 'format'
            );
        }
        case 'number':
            return `${value}${setting.schema['x-unit'] ?? 'px'}`;
        case 'boolean':
            return setting.label.toLowerCase();
        case 'choice':
            return `${setting.label.toLowerCase()} ${choiceLabel(setting, value).toLowerCase()}`;
        default:
            return String(value);
    }
}

const fieldListEditor = hoistCmp.factory<ListEditorProps<FieldListNode>>({
    displayName: 'BlueprintFieldListEditor',
    model: false,
    render({node, list: items, commit, ctx}) {
        const {impl} = ctx,
            scope = scopeOf(ctx),
            {settingsIn} = node,
            disabled = impl.readOnly,
            {entries, rows, ops, mappedOf} = useFieldList(node, items, commit, ctx),
            fieldsOf = entries.map(it => it.field),
            options = withCurrent(impl.fieldOptions(node.role), fieldsOf),
            // The same props while the list's fields hold, so the select draws again only then.
            addOptions = useMemo(
                () => options.filter(it => !fieldsOf.includes(it.value)),
                // eslint-disable-next-line react-hooks/exhaustive-deps
                [options.length, fieldsOf.join('|'), impl.fieldOptions(node.role)]
            ),
            addField = useCallback((field: string) => ops.current.add(field), [ops]),
            all = entrySettings(node),
            namedRef = useNamedInputs(),
            canPage = !!impl.pageElement && all.length > 6,
            summary = sortBy(
                all.filter(it => settingsIn?.summary?.includes(it.setting.key)),
                it => settingsIn.summary.indexOf(it.setting.key)
            ),
            common = settingsIn?.common
                ? sortBy(
                      all.filter(it => settingsIn.common.includes(it.setting.key)),
                      it => settingsIn.common.indexOf(it.setting.key)
                  )
                : all,
            renderers = useStableRenderers({
                renderItem: (row: PlainObject) => {
                    const {key, entry} = row,
                        mapped = mappedOf(entry),
                        chips = summary
                            .map(({setting, own}) =>
                                chipText(setting, own ? entry[setting.key] : mapped[setting.key])
                            )
                            .filter(Boolean);
                    return hbox({
                        className: classNames(
                            `${CLS}__item-header`,
                            impl.isItemOpen(scope, key) && `${CLS}__column--open`,
                            entry.hidden && `${CLS}__column--hidden`
                        ),
                        ...({'data-field': entry.field} as object),
                        // Delete on the row removes the item.
                        onKeyDown: (e: React.KeyboardEvent) => {
                            if (e.key !== 'Delete' || disabled) return;
                            if ((e.target as HTMLElement).closest('input, textarea')) return;
                            e.preventDefault();
                            e.stopPropagation();
                            ops.current.remove(key);
                        },
                        children: [
                            span({
                                className: `${CLS}__column-label`,
                                children: impl.fieldLabel(entry.field)
                            }),
                            span({className: `${CLS}__column-field`, children: entry.field}),
                            ...chips.map((it, idx) =>
                                span({key: idx, className: `${CLS}__chip-text`, children: it})
                            ),
                            canPage
                                ? button({
                                      className: `${CLS}__page-link`,
                                      icon: Icon.chevronRight(),
                                      minimal: true,
                                      small: true,
                                      title: `All settings of ${impl.fieldLabel(entry.field)}`,
                                      'aria-label': `All settings of ${impl.fieldLabel(entry.field)}`,
                                      onClick: (e: React.MouseEvent) => {
                                          e.stopPropagation();
                                          impl.openPage(ctx.key, key);
                                      }
                                  })
                                : null
                        ]
                    });
                },
                // An opened row shows its common settings, with the way to all of them.
                renderDetail: (row: PlainObject) => {
                    const mapped = mappedOf(row.entry),
                        shown = canPage ? common : all;
                    return div({
                        className: `${CLS}__settings`,
                        children: [
                            ...shown.map(({setting, own}) =>
                                entrySetting(node, setting, own, row, mapped, ctx, ops)
                            ),
                            canPage
                                ? button({
                                      key: '_all',
                                      className: `${CLS}__all-settings`,
                                      text: `All ${all.length} settings`,
                                      rightIcon: Icon.arrowRight(),
                                      minimal: true,
                                      small: true,
                                      onClick: () => impl.openPage(ctx.key, row.key)
                                  })
                                : null
                        ]
                    });
                }
            });
        return div({
            ref: namedRef,
            className: `${CLS}__field-list`,
            children: [
                entries.length
                    ? sortableList({
                          className: `${CLS}__columns`,
                          value: rows,
                          itemKey: 'key',
                          getItemLabel: (row: PlainObject) => impl.fieldLabel(row.entry.field),
                          disabled,
                          compact: true,
                          onReorder: e =>
                              ops.current.commitList(e.items.map((it: PlainObject) => it.entry)),
                          ...openItemOf(impl, scope),
                          ...renderers
                      })
                    : null,
                select({
                    key: entries.length,
                    placeholder: 'Add a field…',
                    options: addOptions,
                    disabled,
                    width: '100%',
                    onCommit: addField
                })
            ]
        });
    }
});

/**
 * A field list item's page, in place of its element's settings: a bar that goes back and steps
 * through the list, then the item's settings in its sections, each folding its unset advanced
 * ones. Alt+↑ and Alt+↓ step, and Escape goes back.
 */
export const fieldItemPage = hoistCmp.factory<ListEditorProps<FieldListNode> & {itemKey: string}>({
    displayName: 'BlueprintFieldItemPage',
    model: false,
    render({node, list: items, commit, ctx, itemKey}) {
        const {impl} = ctx,
            {designModel} = impl,
            scope = scopeOf(ctx),
            {rows, ops, mappedOf} = useFieldList(node, items, commit, ctx),
            namedRef = useNamedInputs(),
            index = rows.findIndex(it => it.key === itemKey),
            row = rows[index],
            step = (by: number) => {
                const to = rows[index + by];
                if (to) impl.openPage(ctx.key, to.key);
            },
            back = () => {
                designModel.closeItemPage();
                impl.setOpenItem(scope, itemKey);
            };
        if (!row) return null;
        const mapped = mappedOf(row.entry),
            label = impl.fieldLabel(row.entry.field),
            all = entrySettings(node),
            groups = node.settingsIn?.groups ?? [{id: null, label: null}],
            valueOf = ({setting, own}: {setting: EditorNode; own: boolean}) =>
                own ? row.entry[setting.key] : mapped[setting.key];
        return div({
            ref: namedRef,
            className: `${CLS}__page`,
            onKeyDown: (e: React.KeyboardEvent) => {
                if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
                    e.preventDefault();
                    step(e.key === 'ArrowUp' ? -1 : 1);
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    back();
                }
            },
            children: [
                hbox({
                    className: `${CLS}__page-bar`,
                    children: [
                        button({
                            icon: Icon.arrowLeft(),
                            text: node.label,
                            minimal: true,
                            small: true,
                            title: `Back to ${node.label}`,
                            onClick: back
                        }),
                        div({
                            className: `${CLS}__page-title`,
                            children: [
                                span({children: label}),
                                span({className: `${CLS}__column-field`, children: row.entry.field})
                            ]
                        }),
                        span({
                            className: `${CLS}__page-count`,
                            children: `${index + 1} of ${rows.length}`
                        }),
                        button({
                            icon: Icon.chevronUp(),
                            minimal: true,
                            small: true,
                            disabled: index === 0,
                            title: 'Previous · Alt+↑',
                            'aria-label': 'Previous',
                            onClick: () => step(-1)
                        }),
                        button({
                            icon: Icon.chevronDown(),
                            minimal: true,
                            small: true,
                            disabled: index === rows.length - 1,
                            title: 'Next · Alt+↓',
                            'aria-label': 'Next',
                            onClick: () => step(1)
                        })
                    ]
                }),
                ...groups.map(group => {
                    const inGroup = all.filter(
                            it => group.id == null || it.setting.schema['x-group'] === group.id
                        ),
                        moreScope = `${scope}/page-more`,
                        moreOpen = impl.isItemOpen(moreScope, group.id),
                        folded =
                            inGroup.length > 4
                                ? inGroup.filter(
                                      it =>
                                          it.setting.schema['x-advanced'] &&
                                          valueOf(it) === undefined
                                  )
                                : [],
                        shown = [...without(inGroup, ...folded), ...(moreOpen ? folded : [])],
                        foldScope = `${scope}/page-fold`,
                        collapsed = impl.isItemOpen(foldScope, group.id) !== !!group.collapsed;
                    if (!inGroup.length) return null;
                    return sectionCard({
                        key: group.id ?? 'all',
                        title: group.label ?? label,
                        count: (() => {
                            const n = inGroup.filter(it => valueOf(it) !== undefined).length;
                            return n ? `${n} set` : null;
                        })(),
                        collapsed,
                        onToggle: () => impl.toggleItem(foldScope, group.id),
                        children: [
                            ...shown.map(it =>
                                entrySetting(node, it.setting, it.own, row, mapped, ctx, ops)
                            ),
                            folded.length
                                ? button({
                                      key: '_more',
                                      className: `${CLS}__more`,
                                      text: moreOpen
                                          ? 'Fewer'
                                          : `${folded.length} more · ${folded.map(it => it.setting.label).join(', ')}`,
                                      minimal: true,
                                      small: true,
                                      onClick: () => impl.toggleItem(moreScope, group.id)
                                  })
                                : null
                        ]
                    });
                })
            ]
        });
    }
});

/**
 * One setting in a field list entry's drawer, which draws again only as its own value or issues
 * change: of the entry itself, set through `ops` by the row's key, or with `field`, of the entry's
 * settings map, such as a column's format in `columns`.
 */
const drawerSetting = hoistCmp.factory<
    HoistProps & {
        impl: ConfigEditorModel;
        node: EditorNode;
        value: unknown;
        listKey: string;
        scope: string;
        field?: string;
        rowKey?: string;
        ops?: {readonly current: {set: (key: string, settingKey: string, v: unknown) => void}};
        locked?: boolean;
    }
>({
    displayName: 'BlueprintDrawerSetting',
    model: false,
    render({impl, node, value, listKey, scope, field, rowKey, ops, locked}) {
        const issues = useMemo(
            () =>
                computed(() => (field ? impl.itemSettingIssues(listKey, field, node.key) : []), {
                    equals: compareStructural
                }),
            [impl, listKey, field, node.key]
        ).get();
        return propertyRow({
            node,
            value,
            commit: v =>
                field
                    ? impl.commitItemSetting(listKey, field, node.key, v)
                    : ops.current.set(rowKey, node.key, v),
            ctx: field
                ? {
                      impl,
                      key: listKey,
                      scope,
                      locked,
                      inherited: impl.inheritedDisplay(field),
                      fieldType: impl.fieldType(field)
                  }
                : {impl, key: listKey, scope, locked},
            issues
        });
    }
});

// Rows that keep their identity while they hold the same, so a SortableList's memoized row draws
// again only when its own row changes.
function useStableRows<T extends {key: string}>(rows: T[]): T[] {
    const prev = useRef(new Map<string, T>()),
        ret = rows.map(row => {
            const was = prev.current.get(row.key);
            return was && isEqual(was, row) ? was : row;
        });
    prev.current = new Map(ret.map(it => [it.key, it]));
    return ret;
}

// A ref that always holds the latest value given.
function useLatest<T>(value: T): {readonly current: T} {
    const ret = useRef(value);
    ret.current = value;
    return ret;
}

// renderItem and renderDetail that keep their identity and call the latest functions given.
function useStableRenderers<R>(fns: {
    renderItem: (row: R) => ReactNode;
    renderDetail: (row: R) => ReactNode;
}) {
    const latest = useLatest(fns);
    return useMemo(
        () => ({
            renderItem: (row: R) => latest.current.renderItem(row),
            renderDetail: (row: R) => latest.current.renderDetail(row)
        }),
        [latest]
    );
}

// A picker's empty choice, naming what an unset value falls back to and where it comes from.
function inheritedLabel(empty: string, inherited: unknown): string {
    return inherited == null ? empty : `${splitNamed(inherited).name ?? 'Custom'} (from the field)`;
}

// A map entry's key, by its field label where it names a field, with the key itself beside.
function mapKeyLabel(key: string, label: string) {
    return div({
        className: `${CLS}__item-label`,
        children: label === key ? [key] : [label, span({className: `${CLS}__key`, children: key})]
    });
}

// A named format, a custom one, or a name with changes. Its options sit in a card under its row.
function formatEditor(value: unknown, commit: (value: unknown) => void, ctx: EditorContext) {
    const {name, options} = splitNamed(value);
    return select({
        value: name,
        options: withCurrent(ctx.impl.formatOptions, name),
        enableClear: true,
        placeholder: isEmpty(options) ? inheritedLabel('Default', ctx.inherited?.format) : 'Custom',
        disabled: ctx.impl.readOnly,
        width: '100%',
        onCommit: (it: string) => commit(joinNamed(it, options))
    });
}

// A format's options across its row: folded until one is set, and summarizing those set.
function formatOptionsCard(
    value: unknown,
    commit: (value: unknown) => void,
    ctx: EditorContext,
    invalid: boolean
) {
    const {name, options} = splitNamed(value),
        nodes = formatOptionNodes(
            ctx.impl.formatDefinition(name ?? splitNamed(ctx.inherited?.format).name),
            options,
            ctx.fieldType
        ),
        // Each option set, by its label and the value as its editor shows it: "color none".
        summary = FORMAT_OPTIONS.filter(it => options[it.key] !== undefined)
            .map(node => {
                const v = options[node.key],
                    shown =
                        node.kind === 'boolean'
                            ? node.labels.find(it => it.value === v)?.label
                            : String(v);
                return `${node.label} ${shown}`.toLowerCase();
            })
            .join(' · ');
    return card({
        key: 'format-options',
        className: `${CLS}__format-options`,
        title: [
            span({key: 'title', children: 'Format options'}),
            summary
                ? span({key: 'summary', className: `${CLS}__format-summary`, children: summary})
                : null
        ],
        intent: invalid ? ('danger' as const) : null,
        modelConfig: {collapsible: true, defaultCollapsed: isEmpty(options)},
        children: optionsGroup(nodes, options, it => commit(joinNamed(name, it)), ctx)
    });
}

// A choice's label: its `x-labels` entry, else Off for false, else its value in words.
// A choice's options, built once per node, so its select keeps the same props as it draws again.
const choiceOptionsCache = new WeakMap<EditorNode, Option[]>();

function choiceOptions(node: Extract<EditorNode, {kind: 'choice'}>): Option[] {
    let ret = choiceOptionsCache.get(node);
    if (!ret) {
        ret = (node.options as unknown[]).map(it => ({
            value: it as any,
            label: choiceLabel(node, it)
        }));
        choiceOptionsCache.set(node, ret);
    }
    return ret;
}

function choiceLabel(node: EditorNode, value: unknown): string {
    return (
        node.schema['x-labels']?.[String(value)] ??
        (value === false ? 'Off' : labelOf(String(value)))
    );
}

// Two numbers side by side, across then down, each showing its default while unset. Setting one
// sets both, the other at its default, and a pair back at its defaults goes unset.
function pairEditor(
    node: Extract<EditorNode, {kind: 'pair'}>,
    value: unknown,
    commit: (value: unknown) => void,
    disabled: boolean
) {
    const pair = Array.isArray(value) ? value : [],
        defaults = (Array.isArray(node.default) ? node.default : []) as number[],
        {item} = node as {item: Extract<EditorNode, {kind: 'number'}>},
        set = (i: number, v: number) => {
            const next = [0, 1].map(j =>
                j === i ? (v ?? defaults[j] ?? null) : (pair[j] ?? defaults[j] ?? null)
            );
            commit(
                next.every(it => it == null) || isEqual(next, defaults)
                    ? undefined
                    : next.map(it => it ?? 0)
            );
        };
    return hbox({
        className: `${CLS}__pair`,
        children: ['Across', 'Down'].map((label, i) =>
            numberInput({
                key: label,
                value: isNumber(pair[i]) ? pair[i] : null,
                min: item.min,
                max: item.max,
                precision: 0,
                placeholder: defaults[i] != null ? String(defaults[i]) : label,
                disabled,
                flex: 1,
                width: null,
                commitOnChange: false,
                onCommit: (v: number) => set(i, v),
                ...({'aria-label': label} as object)
            })
        )
    });
}

// A sort's keys in brief, as chips with their directions, and the chevron that opens its drawer.
function sortSummary(value: unknown, ctx: EditorContext) {
    const {impl} = ctx,
        scope = scopeOf(ctx),
        keys = sortKeysOf(value),
        open = impl.isItemOpen(scope, SORT_DRAWER);
    return hbox({
        className: classNames(`${CLS}__sort`, open && `${CLS}__sort--open`),
        children: [
            div({
                className: `${CLS}__sort-chips`,
                children: keys.length
                    ? keys.map(({field, desc}, idx) =>
                          selectChip({
                              key: idx,
                              text: field,
                              icon: desc ? Icon.sortDesc() : Icon.sortAsc(),
                              label: `${impl.fieldLabel(field)}, ${desc ? 'descending' : 'ascending'}`
                          })
                      )
                    : span({className: `${CLS}__sort-none`, children: 'None'})
            }),
            drawerButton(open, () => impl.toggleItem(scope, SORT_DRAWER))
        ]
    });
}

// A sort's keys across its row, each a field and a direction, in order, with a way to add one. A
// part a key holds that the drawer has no control for, such as abs, shows as a tag and stays.
function sortDrawer(
    node: Extract<EditorNode, {kind: 'sort'}>,
    value: unknown,
    commit: (value: unknown) => void,
    ctx: EditorContext
) {
    const {impl} = ctx,
        scope = scopeOf(ctx);
    if (!impl.isItemOpen(scope, SORT_DRAWER)) return null;
    const keys = sortKeysOf(value),
        disabled = impl.readOnly,
        used = keys.map(it => it.field),
        options = withCurrent(impl.fieldOptions('any'), used),
        commitKeys = (list: SortKey[]) => commit(joinSortKeys(list)),
        replace = (index: number, key: SortKey) =>
            commitKeys(keys.map((it, j) => (j === index ? key : it))),
        ids = impl.keysFor(`${scope}/keys`, used),
        rows = keys.map((key, index) => ({id: ids[index], index, key}));
    return div({
        key: 'sort-drawer',
        className: `${CLS}__sort-drawer`,
        children: [
            rows.length
                ? sortableList({
                      className: `${CLS}__sort-keys`,
                      value: rows,
                      itemKey: 'id',
                      getItemLabel: (row: PlainObject) => impl.fieldLabel(row.key.field),
                      disabled,
                      compact: true,
                      onReorder: e => commitKeys(e.items.map((it: PlainObject) => it.key)),
                      renderItem: ({index, key}: {index: number; key: SortKey}) =>
                          hbox({
                              className: `${CLS}__sort-key`,
                              ...({'data-sort-field': key.field} as object),
                              children: [
                                  select({
                                      value: key.field,
                                      options: options.filter(
                                          it => it.value === key.field || !used.includes(it.value)
                                      ),
                                      optionRenderer: fieldOption,
                                      disabled,
                                      flex: 1,
                                      width: null,
                                      onCommit: (field: string) =>
                                          field &&
                                          field !== key.field &&
                                          replace(index, {...key, field})
                                  }),
                                  key.abs
                                      ? span({
                                            className: `${CLS}__sort-tag`,
                                            title: 'Sorts by absolute value',
                                            children: 'abs'
                                        })
                                      : null,
                                  segmentedControl({
                                      value: key.desc,
                                      options: [
                                          {value: false, label: 'Asc', icon: Icon.sortAsc()},
                                          {value: true, label: 'Desc', icon: Icon.sortDesc()}
                                      ],
                                      intent: 'primary',
                                      toggleOnClick: true,
                                      fill: false,
                                      compact: true,
                                      disabled,
                                      onCommit: (desc: boolean) => replace(index, {...key, desc})
                                  }),
                                  removeItemButton(`Remove ${key.field}`, disabled, () =>
                                      commitKeys(keys.filter((_, j) => j !== index))
                                  )
                              ]
                          })
                  })
                : null,
            keys.length < node.maxKeys
                ? select({
                      key: keys.length,
                      placeholder: 'Add a sort key…',
                      options: options.filter(it => !used.includes(it.value)),
                      optionRenderer: fieldOption,
                      disabled,
                      width: '100%',
                      onCommit: (field: string) =>
                          field && commitKeys([...keys, {field, desc: false, abs: false}])
                  })
                : null
        ]
    });
}

// The open-item key of a sort's drawer, in its property's scope.
const SORT_DRAWER = '$drawer';

// A field in a picker: its label, then its name in mono.
function fieldOption(opt: Option) {
    return hbox({
        className: `${CLS}__field-option`,
        children: [
            span({children: opt.label}),
            opt.label !== opt.value ? span({className: `${CLS}__key`, children: opt.value}) : null
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
        stepScope = `${scopeOf(ctx)}/steps`,
        keys = impl.keysFor(stepScope, steps),
        commitSteps = (list: PlainObject[]) => commit(joinSteps(list)),
        replace = (i: number, step: PlainObject) =>
            commitSteps(steps.map((it, j) => (j === i ? step : it)));
    const stepHeader = (step: PlainObject, i: number) =>
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
                    button({
                        icon: Icon.delete(),
                        title: 'Remove',
                        intent: 'danger',
                        minimal: true,
                        disabled: disabled || (node.required && steps.length === 1),
                        onClick: () => commitSteps(steps.filter((_, j) => j !== i))
                    })
                ]
            }),
        stepBody = (step: PlainObject, i: number) => {
            const spec = impl.actionSpec(step.type),
                locked = impl.confirmLocked(step.type),
                params = spec ? toEditorSpec(spec.params) : [];
            return div({
                className: `${CLS}__step`,
                children: [
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
        };
    return div({
        className: `${CLS}__list`,
        children: [
            ...(steps.length > 1
                ? [
                      sortableList({
                          key: 'steps',
                          className: `${CLS}__steps`,
                          value: steps.map((step, index) => ({key: keys[index], index, step})),
                          itemKey: 'key',
                          getItemLabel: (row: PlainObject) => impl.describeStep(row.step),
                          disabled,
                          compact: true,
                          onReorder: e => commitSteps(e.items.map((it: PlainObject) => it.step)),
                          renderItem: (row: PlainObject) => stepHeader(row.step, row.index),
                          // Every step's body shows, with no chevron to fold it.
                          isItemExpandable: () => false,
                          renderDetail: (row: PlainObject) => stepBody(row.step, row.index)
                      })
                  ]
                : steps.map((step, i) =>
                      div({
                          key: i,
                          className: `${CLS}__step-one`,
                          children: [stepHeader(step, i), stepBody(step, i)]
                      })
                  )),
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
        variables = Object.keys(impl.variables),
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
                                                  kind: isVarBinding(value)
                                                      ? 'variable'
                                                      : 'element',
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

// A setVariable step's value takes the editor of the variable it sets.
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

// A value carried into another form of a property: one value becomes a list of it, and a list its
// first item. Where nothing carries, an optional property is left unset rather than given a starter
// that fails its own checks, so switching back always works.
function switchedValue(
    value: unknown,
    to: EditorNode,
    node: EditorNode,
    ctx: EditorContext
): unknown {
    if (to.kind === 'stringList' && isString(value) && value) return [value];
    if (to.kind !== 'stringList' && Array.isArray(value) && value.length) {
        return fits(to, value[0]) ? value[0] : undefined;
    }
    if (!node.required) return undefined;
    const start = ctx.impl.newValue(to.schema);
    return fits(to, start) ? start : undefined;
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

/**
 * A titled group of rows under a band that spans the Inspector and sticks as its rows scroll past.
 * The whole band folds the group, where it can.
 */
/** A count with its noun, such as "1 item" or "3 children", for a card header's tooltip. */
export function countLabel(n: number, one: string, many = `${one}s`): string {
    return `${n} ${n === 1 ? one : many}`;
}

export function sectionCard({
    key,
    title,
    count,
    badge,
    collapsed = false,
    summary,
    onToggle,
    children
}: {
    key: string;
    title: string;
    /** What is set in the group, or the items of its list, in words: "3 set", "5 columns", "none". */
    count?: string;
    /** A link beside the title, such as to the preset group a path in the card belongs to. */
    badge?: {text: string; onClick: () => void};
    collapsed?: boolean;
    /** One line of what the card holds, shown in place of its body while it is folded. */
    summary?: string;
    onToggle?: () => void;
    children: ReactNode[];
}) {
    // The title and count are the toggle for assistive tech. A click anywhere on the band, outside
    // the badge, also toggles.
    const toggle = onToggle
        ? {
              role: 'button',
              tabIndex: 0,
              'aria-expanded': !collapsed,
              onKeyDown: (e: React.KeyboardEvent) => {
                  if (e.key !== 'Enter' && e.key !== ' ') return;
                  e.preventDefault();
                  onToggle();
              }
          }
        : {};
    return div({
        key,
        className: classNames(`${CLS}__card`, collapsed && `${CLS}__card--collapsed`),
        children: [
            div({
                className: classNames(
                    `${CLS}__card-header`,
                    onToggle && `${CLS}__card-header--toggle`
                ),
                onClick: onToggle,
                children: [
                    span({
                        className: `${CLS}__card-toggle`,
                        ...toggle,
                        children: [
                            span({className: `${CLS}__card-title`, children: title}),
                            collapsed && summary
                                ? span({className: `${CLS}__card-summary`, children: summary})
                                : null,
                            count ? span({className: `${CLS}__card-count`, children: count}) : null
                        ]
                    } as object),
                    badge
                        ? span({
                              className: `${CLS}__card-badge-box`,
                              onClick: (e: React.MouseEvent) => e.stopPropagation(),
                              onKeyDown: (e: React.KeyboardEvent) => e.stopPropagation(),
                              children: selectChip({
                                  className: `${CLS}__card-badge`,
                                  kind: 'preset',
                                  text: badge.text,
                                  label: 'Show the preset group',
                                  onSelect: badge.onClick
                              })
                          })
                        : null,
                    onToggle
                        ? span({
                              className: `${CLS}__card-chevron`,
                              'aria-hidden': true,
                              children: collapsed ? Icon.chevronRight() : Icon.chevronDown()
                          } as object)
                        : null
                ]
            }),
            collapsed ? null : div({className: `${CLS}__card-body`, children})
        ]
    });
}
