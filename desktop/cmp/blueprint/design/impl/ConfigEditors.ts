import {card} from '@xh/hoist/cmp/card';
import {form, type FormModel} from '@xh/hoist/cmp/form';
import {SettingsFormModel} from './SettingsFormModel';
import {choiceLabel, fromFieldValue, isShortChoice, toFieldValue} from './settingValues';
import {formField} from '@xh/hoist/desktop/cmp/form';
import {div, filler, hbox, span} from '@xh/hoist/cmp/layout';
import {hoistCmp, type HoistProps, type PlainObject, useLocalModel} from '@xh/hoist/core';
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
    type SelectProps,
    textArea,
    textInput
} from '@xh/hoist/desktop/cmp/input';
import {Icon} from '@xh/hoist/icon';
import {tooltip} from '@xh/hoist/kit/blueprint';
import {compareStructural, computed, observable, runInAction} from '@xh/hoist/mobx';
import {wait} from '@xh/hoist/promise';
import {
    castArray,
    groupBy,
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
import {
    type ReactElement,
    type ReactNode,
    useCallback,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState
} from 'react';
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
            'x-advanced': true,
            enum: ['thousands', 'millions', 'billions', 'auto'],
            description: 'Show in thousands, millions or billions with a label, or compact.'
        },
        ledger: {type: 'boolean', description: 'Show a negative number in parentheses.'},
        colorSpec: {
            type: 'boolean',
            title: 'Color',
            'x-labels': {false: 'None', true: 'By sign'},
            description: 'Color a number by its sign.'
        },
        label: {
            'x-advanced': true,
            type: 'string',
            maxLength: 20,
            description: 'A unit after the number.'
        },
        date: {enum: ['date', 'dateTime', 'time', 'compact'], description: 'How a date shows.'},
        pattern: {
            'x-advanced': true,
            type: 'string',
            maxLength: 40,
            description: 'A date pattern, such as MMM D.'
        },
        nullDisplay: {
            'x-advanced': true,
            type: 'string',
            maxLength: 20,
            description: 'The text for no value.'
        }
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
    // True where a format's options show as rows of their own, as on an item's page.
    flatFormat?: boolean;
    // The field a setting belongs to, such as a column's.
    field?: string;
    // The form of the settings the row sits among, whose field for it the row shows.
    form?: FormModel;
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
 * A property as a Hoist form field: its label, its editor, its issues, and at its end the menu that
 * binds it and the ↺ that resets it, as Delete on a focused control does. A set value shows a dot
 * before its label, whose tooltip comes from its schema. The row is the field of the form its
 * context carries, else of a form of its own.
 */
export function propertyRow(props: RowProps) {
    const {node, value, commit, ctx, key} = props;
    if (ctx.form?.fields[node.key]) return formRow(props);
    // A setting outside any set's form takes a form of its own.
    return settingsForm({
        key,
        nodes: [node],
        values: {[node.key]: value},
        commit: (_, v) => commit(v),
        content: form => [formRow({...props, key: null, ctx: {...ctx, form}})]
    });
}

// A row as a Hoist form field: its label, its editor in place of the field's input, and its bind
// and reset at the end.
function formRow({node, value, commit, ctx, issues = [], key, badge}: RowProps) {
    const isSet = value !== undefined,
        locked = ctx.impl.readOnly || !!ctx.locked,
        canReset = isSet && !badge && !locked,
        reset = () => commit(undefined),
        bound = node.bindable && isVarBinding(value),
        // The form field binds a single input, and every other editor stands in for one.
        own = {...ctx, form: undefined},
        unbound = {...node, bindable: false},
        input = isFieldInput(node) && !bound,
        // In a row it shares, a setting stacks under its caption.
        caption = node.schema['x-caption'] as string;
    return formField({
        key,
        field: node.key,
        className: classNames(
            `${CLS}__row`,
            `${CLS}__form-row`,
            caption && `${CLS}__form-cell`,
            isSet && `${CLS}__row--set`,
            node.required && !isSet && !badge && `${CLS}__row--missing`
        ),
        inline: !caption && INLINE_KINDS.includes(node.kind) && !isMultiline(node),
        clickableLabel: false,
        label: span({
            className: `${CLS}__label`,
            title: caption ? node.label : null,
            children: [
                isSet ? span({className: `${CLS}__dot`, 'aria-hidden': true} as object) : null,
                caption ?? labelTooltip(node)
            ]
        }),
        domAttrs: {'data-config-key': node.key, role: 'group', 'aria-label': node.label},
        rightItems: locked
            ? null
            : [
                  node.bindable && !bound ? bindMenu(node, commit, ctx) : null,
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
                      : null
              ].filter(Boolean),
        inputRenderer: boundInput =>
            div({
                className: `${CLS}__row-body`,
                onKeyDown: (e: React.KeyboardEvent) => {
                    const target = e.target as HTMLElement;
                    if (e.key !== 'Delete' || !canReset || isTextEntry(target)) return;
                    if (LIST_EDITOR_KINDS.includes(node.kind)) return;
                    const row = (e.currentTarget as HTMLElement).closest('[data-config-key]');
                    if (target.closest('[data-config-key]') !== row) return;
                    e.preventDefault();
                    e.stopPropagation();
                    reset();
                },
                children: [
                    badge ? badgeOf(badge, ctx) : null,
                    bound
                        ? boundEditor(node, value, commit, own)
                        : input
                          ? boundInput
                          : editorFor(unbound, value, commit, own),
                    ...issueLines(issues),
                    node.kind === 'format' && !ctx.flatFormat
                        ? formatOptionsCard(value, commit, own, !!issues.length)
                        : null,
                    node.kind === 'sort' ? sortDrawer(node, value, commit, own) : null
                ]
            }),
        item: input ? editorFor(unbound, value, commit, own, true) : textInput()
    });
}

/**
 * Rows whose settings name one `x-row` as a single row under its label, at the first one's place,
 * each setting in it under its `x-caption`. Every other row stays as it is.
 */
export function joinRows<T>(
    items: T[],
    nodeOf: (it: T) => EditorNode,
    rowOf: (it: T) => ReactNode
): ReactNode[] {
    const rowLabel = (it: T) => nodeOf(it).schema['x-row'] as string,
        shared = groupBy(items.filter(rowLabel), rowLabel);
    return items.flatMap((it): ReactNode[] => {
        const label = rowLabel(it);
        if (!label) return [rowOf(it)];
        if (nodeOf(shared[label][0]) !== nodeOf(it)) return [];
        return [
            div({
                key: `row:${label}`,
                className: `${CLS}__row ${CLS}__row-group`,
                ...({role: 'group', 'aria-label': label} as object),
                children: [
                    div({className: `${CLS}__label`, children: label}),
                    div({className: `${CLS}__row-cells`, children: shared[label].map(rowOf)})
                ]
            })
        ];
    });
}

// True for a setting whose editor is one Hoist input, which its form field binds.
function isFieldInput(node: EditorNode): boolean {
    switch (node.kind) {
        case 'text':
        case 'date':
        case 'number':
        case 'boolean':
        case 'choice':
        case 'icon':
        case 'preset':
        case 'variable':
        case 'blueprint':
        case 'source':
        case 'stringList':
            return true;
        case 'field':
            return !(node.multiple && node.role === 'dimension');
        default:
            return false;
    }
}

interface SettingsFormProps extends HoistProps {
    /** The settings, a field each. */
    nodes: EditorNode[];
    /** The settings' values as the blueprint holds them, an unset one absent. */
    values: PlainObject;
    /** Apply one setting's change as one edit. `undefined` unsets it. */
    commit: (key: string, value: unknown) => void;
    /** The rows, given the form their context carries. */
    content: (form: FormModel) => ReactNode[];
}

/**
 * A Hoist form over a set of settings, such as an element's config or a list item's, for the rows
 * it renders. Each row whose context carries the form shows as the form's field for its setting.
 */
export const settingsForm = hoistCmp.factory<SettingsFormProps>({
    displayName: 'BlueprintSettingsForm',
    model: false,
    render(props) {
        // A new set of settings takes a new form.
        return settingsFormBody({...props, key: props.nodes.map(it => it.key).join('|')});
    }
});

const settingsFormBody = hoistCmp.factory<SettingsFormProps>({
    model: false,
    render({nodes, values, commit, content}) {
        const latest = useRef(commit),
            [source] = useState(() => observable.box(values, {deep: false})),
            {formModel} = useLocalModel(
                () =>
                    new SettingsFormModel({
                        nodes,
                        values: () => source.get(),
                        commit: (key, value) => latest.current(key, value)
                    })
            );
        latest.current = commit;
        // Before paint, so a change from outside never shows the old value.
        useLayoutEffect(() => runInAction(() => source.set(values)), [source, values]);
        return form({
            model: formModel,
            fieldDefaults: {labelWidth: 104, rightItemsWidth: 52},
            items: content(formModel)
        });
    }
});

// The preset an edit changes, beside the label, which shows its group where it can.
function badgeOf(badge: string, ctx: EditorContext) {
    return div({
        className: classNames(
            `${CLS}__badge`,
            ctx.impl.canShowPresetGroups && `${CLS}__badge--link`
        ),
        title: ctx.impl.canShowPresetGroups ? 'Show the preset group' : null,
        onClick: () => ctx.impl.showPresetGroupFor(ctx.key),
        children: badge
    });
}

function issueLines(issues: BlueprintIssue[]) {
    return issues.map((it, idx) =>
        div({
            key: idx,
            className: classNames(
                `${CLS}__issue`,
                it.severity === 'warning' && `${CLS}__issue--warning`
            ),
            children: it.message
        })
    );
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

/**
 * A section's "N more" line, naming the settings it folds, or "Fewer" to fold them again: quiet
 * text, its count in the intent, that a click, Enter or Space toggles.
 */
export function moreLine(open: boolean, count: number, names: string[], toggle: () => void) {
    return div({
        key: '_more',
        className: `${CLS}__more`,
        role: 'button',
        tabIndex: 0,
        'aria-expanded': open,
        onClick: toggle,
        onKeyDown: (e: React.KeyboardEvent) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            e.preventDefault();
            toggle();
        },
        children: open
            ? [
                  Icon.chevronDown({key: 'i', className: `${CLS}__more-icon`}),
                  span({key: 'n', className: `${CLS}__more-n`, children: 'Fewer'})
              ]
            : [
                  Icon.chevronRight({key: 'i', className: `${CLS}__more-icon`}),
                  span({key: 'n', className: `${CLS}__more-n`, children: `${count} more`}),
                  span({key: 'names', className: `${CLS}__more-names`, children: names.join(', ')})
              ]
    } as object);
}

/** The first sentence of a description, for a line of help. */
export function firstSentence(text: string): string {
    return text.match(/^.*?[.!?](\s|$)/)?.[0].trim() ?? text;
}

const LIST_EDITOR_KINDS = ['fieldList', 'list', 'stringList', 'map'];

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
    'filter',
    'icon',
    'blueprint'
];

function isMultiline(node: EditorNode): boolean {
    return node.kind === 'text' && node.multiline;
}

function editorFor(
    node: EditorNode,
    value: unknown,
    commit: (value: unknown) => void,
    ctx: EditorContext,
    // True where a form field binds the input, which then takes no value or commit of its own.
    fieldBound = false
): ReactElement {
    const binding: {value?: any; onCommit?: (v: any) => void} = fieldBound
            ? {}
            : {value: toFieldValue(node, value), onCommit: v => commit(fromFieldValue(node, v))},
        disabled = ctx.impl.readOnly || !!ctx.locked,
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
                ...binding,
                inputRef: named(node.label),
                placeholder,
                disabled,
                width: '100%'
            });
        case 'date':
            return dateInput({
                ...binding,
                valueType: 'localDate',
                placeholder,
                disabled,
                width: '100%'
            });
        case 'number':
            return numberInput({
                ...binding,
                inputRef: named(node.label),
                min: node.min,
                max: node.max,
                precision: node.integer ? 0 : 4,
                placeholder,
                disabled,
                width: '100%'
            });
        case 'boolean':
            return booleanEditor({
                ...binding,
                labels: node.labels,
                disabled,
                implied
            });
        case 'choice':
            // A choice with pictures shows them inline: a small card each for four or fewer, a row
            // of thumbnails, named by their tooltips, for more, such as a chart's type.
            if (node.thumbnails) {
                const options = node.options.filter(it => it !== true),
                    many = options.length > 4;
                return radioCardInput({
                    ...binding,
                    options: [
                        ...(node.required || node.default !== undefined
                            ? []
                            : [{value: null, label: 'Default'}]),
                        ...options.map(it => {
                            const label = choiceLabel(node, it),
                                picture = thumbnailPreview(
                                    node.thumbnails[String(it)],
                                    many ? {width: 30, height: 18} : {width: 34, height: 16}
                                );
                            return {
                                value: it as any,
                                label,
                                preview: many
                                    ? tooltip({content: label, hoverOpenDelay: 300, item: picture})
                                    : picture
                            };
                        })
                    ],
                    disabled,
                    cardWidth: many ? 40 : 64,
                    className: classNames(
                        `${CLS}__pictures`,
                        many && `${CLS}__pictures--many`,
                        implied && `${CLS}__implied`
                    )
                });
            }
            // A choice with an off state, such as a summary row's place, shows every option at once.
            if (node.options.includes(false)) {
                const options = node.options.filter(it => it !== true);
                return segmentedControl({
                    ...binding,
                    options: options.map(it => ({
                        value: it as any,
                        label: choiceLabel(node, it)
                    })),
                    disabled,
                    compact: true,
                    intent: 'primary',
                    fill: false,
                    className: classNames(implied && `${CLS}__implied`)
                });
            }
            // A few short options, such as an alignment or a pin, show all at once. One with no
            // default leads with None while it may stay unset, up to three options besides.
            if (isShortChoice(node)) {
                const unsettable = node.default === undefined && !node.required,
                    withNone = unsettable && node.options.length < 3;
                return segmentedControl({
                    ...binding,
                    options: [
                        ...(withNone ? [{value: null, label: 'None'}] : []),
                        ...node.options.map(it => ({
                            value: it as any,
                            label: choiceLabel(node, it)
                        }))
                    ],
                    disabled,
                    compact: true,
                    intent: 'primary',
                    fill: false,
                    className: classNames(implied && `${CLS}__implied`)
                });
            }
            return select({
                ...binding,
                options: choiceOptions(node),
                enableClear: !node.required,
                placeholder: choicePlaceholder,
                ...(isDecided ? {title: 'The widget decides as it draws, when unset.'} : {}),
                disabled,
                width: '100%'
            });
        case 'icon':
            return iconPicker({
                ...binding,
                enableClear: !node.required,
                placeholder: unset ?? 'None',
                disabled,
                width: '100%'
            });
        case 'preset':
            return select({
                ...binding,
                options: withCurrent(
                    Object.keys(ctx.impl.presets).map(it => ({value: it, label: it})),
                    value
                ),
                disabled,
                width: '100%'
            });
        case 'variable':
            return select({
                ...binding,
                options: withCurrent(ctx.impl.settableVariables, value),
                enableClear: !node.required,
                disabled,
                width: '100%'
            });
        case 'blueprint': {
            const {impl} = ctx;
            if (!impl.blueprintOptions) impl.loadBlueprintOptionsAsync().catchDefault();
            return select({
                ...binding,
                options: withCurrent(impl.blueprintOptions ?? [], value),
                enableClear: !node.required,
                disabled,
                width: '100%'
            });
        }
        case 'source':
            return select({
                ...binding,
                options: ctx.impl.sourceOptions,
                enableClear: !node.required,
                disabled,
                width: '100%'
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
                      ...binding,
                      options,
                      enableMulti: true,
                      placeholder: unset ?? 'None',
                      disabled,
                      width: '100%'
                  })
                : select({
                      ...binding,
                      options,
                      enableClear: !node.required,
                      placeholder: unset ?? (node.required ? 'Pick a field…' : 'None'),
                      disabled,
                      width: '100%'
                  });
        }
        case 'stringList':
            return select({
                ...binding,
                options: (node.options ?? (value as string[]) ?? []) as any[],
                enableMulti: true,
                enableCreate: !node.options,
                disabled,
                width: '100%'
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
                placeholder: unset ?? 'All rows',
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
    const disabled = ctx.impl.readOnly;
    if (isVarBinding(value)) return boundEditor(node, value, commit, ctx);
    return div({
        className: `${CLS}__bindable`,
        children: [
            div({
                className: `${CLS}__value`,
                children: editorFor({...node, bindable: false}, value, commit, ctx)
            }),
            disabled ? null : bindMenu(node, commit, ctx)
        ]
    });
}

// A bound value as its variable's chip, whose remove unbinds it.
function boundEditor(
    node: EditorNode,
    value: unknown,
    commit: (value: unknown) => void,
    ctx: EditorContext
) {
    const {impl} = ctx,
        disabled = impl.readOnly,
        bound = (value as {$var: string}).$var;
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
                          const row = (e.currentTarget as HTMLElement).closest('[data-config-key]');
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
                              onSelect: () => impl.designModel.select({kind: 'variable', id: bound})
                          })
                      ]
                  })
                : null
        ]
    });
}

// The menu that binds a setting to a variable, or null when no variable can take it.
function bindMenu(node: EditorNode, commit: (value: unknown) => void, ctx: EditorContext) {
    const {impl} = ctx,
        choices = impl.bindChoices(node);
    return !choices.some(it => !it.reason)
        ? null
        : tooltip({
              content: 'Bind to a variable',
              hoverOpenDelay: 500,
              item: menuButton({
                  className: `${CLS}__bind-button`,
                  icon: Icon.link(),
                  minimal: true,
                  'aria-label': `Bind ${node.label} to a variable`,
                  // Those it cannot bind show too, disabled, each saying why.
                  menuItems: [
                      ...sortBy(choices, it => !!it.reason).map(({name, reason}) => ({
                          // A variable it cannot take says why, under its name.
                          text: reason
                              ? div({
                                    children: [
                                        div(name),
                                        div({
                                            className: `${CLS}__menu-reason`,
                                            children: reason
                                        })
                                    ]
                                })
                              : name,
                          disabled: !!reason,
                          actionFn: () => commit({$var: name})
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
          });
}

interface ListEditorProps<N extends EditorNode> extends HoistProps {
    node: N;
    list: unknown[];
    commit: (value: unknown) => void;
    ctx: EditorContext;
}

type ListNode = Extract<EditorNode, {kind: 'list'}>;

// A list item's settings, for an item that is an object.
const itemSettings = (node: ListNode): EditorNode[] =>
    node.item.kind === 'group' ? node.item.children : [];

// True if a list's items get pages: an item of more than six settings or with a list inside, as
// an action's steps are, unless its schema's `x-page` says otherwise.
function itemsGetPages(node: ListNode, impl: ConfigEditorModel): boolean {
    const page = node.item.schema['x-page'],
        settings = itemSettings(node);
    if (!impl.pageElement || !settings.length || page === false) return false;
    return (
        page === true ||
        settings.length > 6 ||
        settings.some(it => LIST_EDITOR_KINDS.includes(it.kind) || it.kind === 'action')
    );
}

const listEditor = hoistCmp.factory<ListEditorProps<ListNode>>({
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
            namedRef = useNamedInputs(),
            settings = itemSettings(node),
            {schema} = node.item,
            // A top-level list's items get pages, and a list's on an item's page, a page within it.
            inPage = !!ctx.flatFormat,
            canPage = (!scope.includes('/') || inPage) && itemsGetPages(node, impl),
            open = (key: string, label: string) =>
                inPage
                    ? impl.designModel.openInnerPage({list: node.key, key, label})
                    : impl.openPage(ctx.key, key, label),
            summary = sortBy(
                settings.filter(it => schema['x-summary']?.includes(it.key)),
                it => schema['x-summary'].indexOf(it.key)
            ),
            common = schema['x-common']
                ? sortBy(
                      settings.filter(it => schema['x-common'].includes(it.key)),
                      it => schema['x-common'].indexOf(it.key)
                  )
                : null,
            // Called by key as a row acts, so a row that skipped drawing acts on the list as it is.
            ops = useLatest({
                remove: (key: string) => commitList(items.filter((_, j) => keys[j] !== key)),
                set: (key: string, v: unknown) =>
                    commitList(items.map((it, j) => (keys[j] === key ? v : it)))
            }),
            renderers = useStableRenderers({
                itemRenderer: (row: PlainObject) => {
                    const label = itemLabel(row.value, row.index),
                        chips = summary
                            .map(it => chipText(it, (row.value as PlainObject)?.[it.key]))
                            .filter(Boolean);
                    return hbox({
                        className: classNames(
                            `${CLS}__item-header`,
                            impl.isItemOpen(scope, row.key) && `${CLS}__column--open`
                        ),
                        ...({'data-row-key': row.key} as object),
                        // An item with a page has one way in: a click on its row, or its ›.
                        onClick: canPage
                            ? (e: React.MouseEvent) => clickOpens(e, () => open(row.key, label))
                            : undefined,
                        children: [
                            span({className: `${CLS}__column-label`, children: label}),
                            ...chips.map((it, idx) =>
                                span({key: idx, className: `${CLS}__chip-text`, children: it})
                            ),
                            canPage
                                ? button({
                                      className: `${CLS}__page-link`,
                                      icon: Icon.chevronRight(),
                                      minimal: true,
                                      small: true,
                                      title: `All settings of ${label}`,
                                      'aria-label': `All settings of ${label}`,
                                      onClick: (e: React.MouseEvent) => {
                                          e.stopPropagation();
                                          open(row.key, label);
                                      }
                                  })
                                : null
                        ]
                    });
                },
                // An item without a page opens its settings in place.
                detailRenderer: (row: PlainObject) => {
                    const itemScope = `${scope}/${row.key}`,
                        value = row.value as PlainObject;
                    if (canPage) return null;
                    if (!common) {
                        return div({
                            className: `${CLS}__settings`,
                            children: editorFor(
                                node.item,
                                row.value,
                                v => ops.current.set(row.key, v),
                                {
                                    ...ctx,
                                    scope: itemScope
                                }
                            )
                        });
                    }
                    return div({
                        className: `${CLS}__settings`,
                        children: [
                            ...common.map(setting =>
                                propertyRow({
                                    key: setting.key,
                                    node: setting,
                                    value: value?.[setting.key],
                                    commit: v =>
                                        ops.current.set(
                                            row.key,
                                            v === undefined
                                                ? omit(value, setting.key)
                                                : {...value, [setting.key]: v}
                                        ),
                                    ctx: {...ctx, scope: itemScope}
                                })
                            ),
                            button({
                                key: '_all',
                                className: `${CLS}__all-settings`,
                                text: `All ${settings.length} settings`,
                                rightIcon: Icon.arrowRight(),
                                minimal: true,
                                small: true,
                                onClick: () => open(row.key, itemLabel(row.value, row.index))
                            })
                        ]
                    });
                }
            });
        return div({
            ref: namedRef,
            className: `${CLS}__field-list`,
            onKeyDown: (e: React.KeyboardEvent) =>
                !disabled && onItemDelete(e, key => ops.current.remove(key)),
            children: [
                sortableList({
                    className: `${CLS}__columns`,
                    value: rows,
                    itemKey: 'key',
                    getItemLabel: (row: PlainObject) => itemLabel(row.value, row.index),
                    disabled,
                    compact: true,
                    onReorder: e => commitList(e.items.map((it: PlainObject) => it.value)),
                    ...openItemOf(impl, scope),
                    ...renderers,
                    variant: 'divided',
                    ...(canPage ? {isItemExpandable: () => false} : {}),
                    // The list's own Add row starts an item from the schema, which opens.
                    addText: `Add ${withArticle(singular(node.label).toLowerCase())}…`,
                    getNewItem: () => {
                        const value = impl.newValue(node.item.schema, ctx.field);
                        return {key: impl.addKey(scope, value), index: items.length, value};
                    },
                    onAdd: e => {
                        commitList([...items, e.item.value]);
                        if (!canPage) impl.setOpenItem(scope, e.item.key);
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
    /** The value, unless a form field binds the control. */
    value?: boolean;
    labels: {value: boolean; label: string}[];
    disabled: boolean;
    /** True while unset, which marks the default it shows more quietly than a value set. */
    implied?: boolean;
    onCommit?: (value: boolean) => void;
}) {
    return segmentedControl({
        className: classNames(implied && `${CLS}__implied`),
        ...(onCommit ? {value, onCommit} : {}),
        options: labels,
        intent: 'primary',
        toggleOnClick: true,
        fill: false,
        compact: true,
        disabled
    });
}

// A click on a list row opens its page, unless it lands on a control in the row.
function clickOpens(e: React.MouseEvent, open: () => void) {
    if ((e.target as HTMLElement).closest('button, input, a')) return;
    open();
}

/** Delete on a list item, its handle or its row, removes that item, not the list's row. */
export function onItemDelete(e: React.KeyboardEvent, remove: (key: string) => void) {
    const target = e.target as HTMLElement;
    if (e.key !== 'Delete' || isTextEntry(target)) return;
    const list = e.currentTarget as HTMLElement,
        anchor = list.parentElement?.closest<HTMLElement>('[data-config-key]'),
        key = itemOf(target, list)?.row.getAttribute('data-row-key');
    if (!key) return;
    e.preventDefault();
    e.stopPropagation();
    // Focus stays in the list: on the next item, else the one before, else its add control.
    const keys = [...list.querySelectorAll('[data-row-key]')].map(it =>
            it.getAttribute('data-row-key')
        ),
        at = keys.indexOf(key),
        next = keys[at + 1] ?? keys[at - 1];
    remove(key);
    if (next) {
        focusItem(next, [list, anchor]);
    } else {
        wait().then(() =>
            list
                .querySelector<HTMLElement>(
                    ':scope > :last-child input, :scope > button:last-child'
                )
                ?.focus()
        );
    }
}

// The list item an element sits in, within a list: its wrapper, which holds its handle beside the
// row drawn for it, and that row.
function itemOf(el: HTMLElement, list: HTMLElement): {item: HTMLElement; row: HTMLElement} {
    const own = el.closest<HTMLElement>('[data-row-key]');
    let item: HTMLElement = null,
        row: HTMLElement = own;
    for (let at = own ?? el; at && at !== list; at = at.parentElement) {
        const rows = at.querySelectorAll<HTMLElement>('[data-row-key]');
        if (rows.length > 1) break;
        if (rows.length === 1 || at === own) {
            item = at;
            row = rows[0] ?? own;
        }
    }
    return row ? {item, row} : null;
}

/** Focus a list item's handle by its row's key, as a page closes, so the keyboard stays there. */
export function focusItem(key: string, fallbacks: HTMLElement[] = []) {
    wait().then(() => {
        const row = document.querySelector<HTMLElement>(`[data-row-key="${CSS.escape(key)}"]`),
            list = row?.closest<HTMLElement>(`.${CLS}__field-list`),
            item = row && list ? itemOf(row, list)?.item : null,
            handle = item?.querySelector<HTMLElement>('[class*="handle"]'),
            // A list that now draws its one item without rows, such as a lone step, gives focus to
            // the first control still drawn around it.
            around = fallbacks
                .filter(it => it?.isConnected)
                .map(it => it.querySelector<HTMLElement>(FOCUSABLE))
                .find(Boolean);
        (handle ?? (row?.tabIndex >= 0 ? row : null) ?? around)?.focus();
    });
}

const FOCUSABLE = 'input, button:not([disabled]), [tabindex="0"]';

/** Focus a page's back button as it opens or steps, unless focus is already in it. */
function usePageFocus(ref: {current: HTMLElement}, itemKey: string) {
    useEffect(() => {
        // After the key or click that opened it, so its activation never lands on Back.
        wait().then(() => {
            const el = ref.current;
            if (el && !el.contains(document.activeElement)) {
                el.querySelector<HTMLElement>('button')?.focus();
            }
        });
    }, [ref, itemKey]);
}

/** A list's Add row as a picker of what to add: flush in the row, led by a +. */
export function addPicker(props: SelectProps & {key?: string | number}) {
    return select({
        className: `${CLS}__add-picker`,
        leftIcon: Icon.add(),
        hideDropdownIndicator: true,
        width: '100%',
        ...props
    });
}

/** Focus a list's add control again after it remounts for an add, so another add follows. */
export function refocusAdd(list: HTMLElement) {
    wait().then(() =>
        (
            list?.querySelector<HTMLElement>('.xh-sortable-list__add input') ??
            list?.querySelector<HTMLElement>(':scope > :last-child input')
        )?.focus()
    );
}

// A noun with its article, as "a column" or "an option".
const withArticle = (noun: string) => `${/^[aeiou]/.test(noun) ? 'an' : 'a'} ${noun}`;

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

// What a list item shows as: its label, title or name, a style rule's test and style, else its
// place.
function itemLabel(value: unknown, index: number): string {
    const v = value as PlainObject;
    if (!isPlainObject(v)) return `${index + 1}`;
    const named = [v.label, v.title, v.name].find(isString);
    if (named) return named;
    if (v.when) {
        const style = isPlainObject(v.style) ? Object.values(v.style).filter(isString) : [];
        return (
            [filterText(v.when), style.join(', ')].filter(Boolean).join(' · ') ||
            `Rule ${index + 1}`
        );
    }
    return `${index + 1}`;
}

// A filter in brief, as `mktVal < 0`, or how many clauses a compound one has.
function filterText(filter: unknown): string {
    const f = filter as PlainObject;
    if (!isPlainObject(f)) return null;
    if (isArray(f.filters)) return countLabel(f.filters.length, 'clause');
    if (!isString(f.field)) return null;
    const value =
        isPlainObject(f.value) && f.value.$var
            ? `{${f.value.$var}}`
            : castArray(f.value).join(', ');
    return `${f.field} ${f.op ?? '='} ${value}`;
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
    ops: ReturnType<typeof useFieldList>['ops'],
    flatFormat = false
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
              locked: ctx.locked,
              flatFormat,
              form: ctx.form
          })
        : drawerSetting({
              key: `${node.settingsIn.key}:${setting.key}`,
              impl: ctx.impl,
              node: setting,
              value: mapped[setting.key],
              listKey: node.settingsIn.key,
              scope,
              field: entry.field,
              locked: ctx.locked,
              flatFormat,
              form: ctx.form
          });
}

// A format setting's options as page settings of their own, in its section, the less used folded.
function formatOptionSettings(
    format: EditorNode,
    value: unknown,
    commit: (value: unknown) => void,
    ctx: EditorContext
): PageSetting[] {
    const {name, options} = splitNamed(value),
        nodes = formatOptionNodes(
            ctx.impl.formatDefinition(name ?? splitNamed(ctx.inherited?.format).name),
            options,
            ctx.fieldType
        );
    return nodes.map(it => {
        const node = {...it, schema: {...it.schema, 'x-group': format.schema['x-group']}};
        return {
            node,
            value: options[it.key],
            row: propertyRow({
                key: `format:${it.key}`,
                node,
                value: options[it.key],
                commit: v =>
                    commit(
                        joinNamed(
                            name,
                            v === undefined ? omit(options, it.key) : {...options, [it.key]: v}
                        )
                    ),
                ctx
            })
        };
    });
}

// Every setting of a field list entry: its own, then its settings map's, each marked by which.
const entrySettings = (node: FieldListNode) => [
    ...node.settings.map(it => ({setting: it, own: true})),
    ...(node.settingsIn?.settings ?? []).map(it => ({setting: it, own: false}))
];

// What a field list entry shows as: its own header or name, else its field's label.
function entryLabel(impl: ConfigEditorModel, entry: PlainObject, mapped: PlainObject): string {
    const own = [mapped.headerName, mapped.name, entry.headerName, entry.name].find(isString);
    return own || impl.fieldLabel(entry.field);
}

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
        case 'action': {
            const [first, ...rest] = castArray(value) as PlainObject[];
            if (!isString(first?.type)) return null;
            return labelOf(first.type) + (rest.length ? ` + ${rest.length}` : '');
        }
        case 'filter':
            return filterText(value);
        default:
            return isObject(value) ? null : String(value);
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
            namedRef = useNamedInputs(),
            fieldsOf = entries.map(it => it.field),
            options = withCurrent(impl.fieldOptions(node.role), fieldsOf),
            // The same props while the list's fields hold, so the select draws again only then.
            addOptions = useMemo(
                () => options.filter(it => !fieldsOf.includes(it.value)),
                // eslint-disable-next-line react-hooks/exhaustive-deps
                [options.length, fieldsOf.join('|'), impl.fieldOptions(node.role)]
            ),
            addField = useCallback((field: string) => ops.current.add(field), [ops]),
            addPlaceholder =
                node.role === 'measure'
                    ? 'Add a measure…'
                    : `Add ${withArticle(singular(node.label).toLowerCase())}…`,
            all = entrySettings(node),
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
                itemRenderer: (row: PlainObject) => {
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
                        ...({'data-field': entry.field, 'data-row-key': key} as object),
                        // An item with a page has one way in: a click on its row, or its ›.
                        onClick: canPage
                            ? (e: React.MouseEvent) =>
                                  clickOpens(e, () => impl.openPage(ctx.key, key))
                            : undefined,
                        children: [
                            span({
                                className: `${CLS}__column-label`,
                                children: entryLabel(impl, entry, mapped)
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
                // An item without a page opens its settings in place.
                detailRenderer: (row: PlainObject) => {
                    if (canPage) return null;
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
            onKeyDown: (e: React.KeyboardEvent) =>
                !disabled && onItemDelete(e, key => ops.current.remove(key)),
            children: [
                sortableList({
                    className: `${CLS}__columns`,
                    value: rows,
                    itemKey: 'key',
                    getItemLabel: (row: PlainObject) => impl.fieldLabel(row.entry.field),
                    disabled,
                    compact: true,
                    onReorder: e =>
                        ops.current.commitList(e.items.map((it: PlainObject) => it.entry)),
                    ...openItemOf(impl, scope),
                    ...renderers,
                    variant: 'divided',
                    ...(canPage ? {isItemExpandable: () => false} : {}),
                    // A picker of the fields it lacks, in the list's own Add row.
                    addRenderer: ({add, disabled: off}) =>
                        addPicker({
                            key: entries.length,
                            placeholder: addPlaceholder,
                            options: addOptions,
                            disabled: off,
                            onCommit: (field: string) => {
                                if (!field) return;
                                const n = entries.filter(it => it.field === field).length + 1;
                                add({key: `${field}#${n}`, entry: {field}});
                                refocusAdd(namedRef.current);
                            }
                        }),
                    onAdd: e => addField(e.item.entry.field)
                })
            ]
        });
    }
});

/** A setting on an item's page: its editor, its value, and its row. */
interface PageSetting {
    node: EditorNode;
    value: unknown;
    row: ReactNode;
}

/**
 * A list item's page, in place of its element's settings: a bar that goes back and steps through
 * the list, then the item's settings in its sections, each folding its unset advanced ones.
 * Alt+↑ and Alt+↓ step, and Escape goes back.
 */
function pageView(opts: {
    impl: ConfigEditorModel;
    scope: string;
    ref: React.Ref<HTMLDivElement>;
    listLabel: string;
    title: string;
    meta?: string;
    /** What the item is, under its name, such as `Column of mktVal · number`. */
    subtitle?: string;
    index: number;
    count: number;
    groups: {id: string; label: string; collapsed?: boolean}[];
    /** The item's common settings, which lead their sections. */
    common?: string[];
    settings: PageSetting[];
    onStep: (by: number) => void;
    onBack: () => void;
}): ReactNode {
    const {impl, scope, listLabel, title, meta, subtitle, index, count, onStep, onBack} = opts,
        common = opts.common ?? [],
        {settings} = opts,
        groups = opts.groups ?? [{id: null, label: null}],
        rank = (it: PageSetting) =>
            common.includes(it.node.key) ? common.indexOf(it.node.key) : common.length,
        // As in the mockup, a section's unset advanced settings fold behind its N more.
        isFolded = (it: PageSetting) => it.value === undefined && !!it.node.schema['x-advanced'];
    return div({
        ref: opts.ref,
        className: `${CLS}__page`,
        onKeyDown: (e: React.KeyboardEvent) => {
            if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
                e.preventDefault();
                onStep(e.key === 'ArrowUp' ? -1 : 1);
            } else if (e.key === 'Escape') {
                e.preventDefault();
                onBack();
            }
        },
        children: [
            div({
                key: 'head',
                className: `${CLS}__page-head`,
                children: [
                    pageBar({listLabel, index, count, onStep, onBack}),
                    div({
                        className: `${CLS}__page-name`,
                        children: [
                            span({children: title}),
                            meta ? span({className: `${CLS}__column-field`, children: meta}) : null
                        ]
                    }),
                    subtitle ? div({className: `${CLS}__page-subtitle`, children: subtitle}) : null
                ]
            }),
            ...groups.map(group => {
                // The item's common settings lead each section.
                const inGroup = sortBy(
                        settings.filter(
                            it => group.id == null || it.node.schema['x-group'] === group.id
                        ),
                        rank
                    ),
                    moreScope = `${scope}/page-more`,
                    moreOpen = impl.isItemOpen(moreScope, group.id),
                    folded = inGroup.filter(isFolded),
                    shown = [...without(inGroup, ...folded), ...(moreOpen ? folded : [])],
                    foldScope = `${scope}/page-fold`,
                    collapsed = impl.isItemOpen(foldScope, group.id) !== !!group.collapsed,
                    set = inGroup.filter(it => it.value !== undefined).length;
                if (!inGroup.length) return null;
                return sectionCard({
                    key: group.id ?? 'all',
                    title: group.label ?? title,
                    summary: inGroup.some(it => it.value !== undefined)
                        ? inGroup
                              .filter(it => it.value !== undefined)
                              .map(it => it.node.label)
                              .join(', ')
                        : `Nothing set · ${inGroup.map(it => it.node.label).join(', ')}`,
                    count: set ? `${set} set` : null,
                    collapsed,
                    onToggle: () => impl.toggleItem(foldScope, group.id),
                    children: [
                        ...joinRows(
                            shown,
                            it => it.node,
                            it => it.row
                        ),
                        folded.length
                            ? moreLine(
                                  moreOpen,
                                  folded.length,
                                  folded.map(it => it.node.label),
                                  () => impl.toggleItem(moreScope, group.id)
                              )
                            : null
                    ]
                });
            })
        ]
    });
}

/**
 * A list item's page bar: back to its list, its name, its place, and steps to the items either
 * side of it.
 */
export function pageBar(opts: {
    listLabel: string;
    index: number;
    count: number;
    onStep: (by: number) => void;
    onBack: () => void;
}): ReactNode {
    const {listLabel, index, count, onStep, onBack} = opts;
    return hbox({
        className: `${CLS}__page-bar`,
        children: [
            button({
                className: `${CLS}__page-back`,
                icon: Icon.arrowLeft(),
                text: listLabel,
                minimal: true,
                small: true,
                title: `Back to ${listLabel}`,
                onClick: onBack
            }),
            filler(),
            span({className: `${CLS}__page-count`, children: `${index + 1} of ${count}`}),
            button({
                icon: Icon.chevronUp(),
                minimal: true,
                small: true,
                disabled: index === 0,
                title: 'Previous · Alt+↑',
                'aria-label': 'Previous',
                onClick: () => onStep(-1)
            }),
            button({
                icon: Icon.chevronDown(),
                minimal: true,
                small: true,
                disabled: index === count - 1,
                title: 'Next · Alt+↓',
                'aria-label': 'Next',
                onClick: () => onStep(1)
            })
        ]
    });
}

// What one item of a list is called, from the list's label: Columns, a column.
const singular = (label: string) => label?.replace(/s$/, '') ?? '';

/** A field list item's page, as {@link pageView} draws it, such as a grid column's. */
export const fieldItemPage = hoistCmp.factory<ListEditorProps<FieldListNode> & {itemKey: string}>({
    displayName: 'BlueprintFieldItemPage',
    model: false,
    render({node, list: items, commit, ctx, itemKey}) {
        const {impl} = ctx,
            scope = scopeOf(ctx),
            {rows, ops, mappedOf} = useFieldList(node, items, commit, ctx),
            ref = useNamedInputs(),
            index = rows.findIndex(it => it.key === itemKey),
            row = rows[index];
        usePageFocus(ref, `${itemKey}/${impl.designModel.itemPage?.inner?.key ?? ''}`);
        if (!row) return null;
        const mapped = mappedOf(row.entry),
            {field} = row.entry,
            // A list on the page whose item's own page is open, such as a style rule's.
            inner = impl.designModel.itemPage?.inner,
            innerList = inner
                ? entrySettings(node).find(
                      it => it.setting.key === inner.list && it.setting.kind === 'list'
                  )
                : null;
        if (innerList) {
            const {setting, own} = innerList;
            return listItemPage({
                node: setting as ListNode,
                list: castArray((own ? row.entry : mapped)[setting.key] ?? []),
                commit: v =>
                    own
                        ? ops.current.set(row.key, setting.key, v)
                        : impl.commitItemSetting(node.settingsIn.key, field, setting.key, v),
                ctx: {
                    impl,
                    key: own ? ctx.key : node.settingsIn.key,
                    scope: `${scope}/${row.key}`,
                    flatFormat: true,
                    field,
                    inherited: impl.inheritedDisplay(field),
                    fieldType: impl.fieldType(field)
                },
                itemKey: inner.key,
                inner: true,
                of: entryLabel(impl, row.entry, mapped)
            });
        }
        const settings = entrySettings(node),
            ownKeys = settings.filter(it => it.own).map(it => it.setting.key),
            commitSetting = (key: string, v: unknown) =>
                ownKeys.includes(key)
                    ? ops.current.set(row.key, key, v)
                    : impl.commitItemSetting(node.settingsIn.key, field, key, v);
        const page = (form: FormModel) =>
            pageView({
                impl,
                scope,
                ref,
                listLabel: node.label,
                title: entryLabel(impl, row.entry, mapped),
                meta: row.entry.field,
                subtitle: [
                    `${singular(node.label)} of ${row.entry.field}`,
                    impl.fieldType(row.entry.field)
                ]
                    .filter(Boolean)
                    .join(' · '),
                common: node.settingsIn?.common,
                index,
                count: rows.length,
                groups: node.settingsIn?.groups,
                settings: settings.flatMap(({setting, own}) => {
                    const value = own ? row.entry[setting.key] : mapped[setting.key],
                        ret = {
                            node: setting,
                            value,
                            row: entrySetting(
                                node,
                                setting,
                                own,
                                row,
                                mapped,
                                {...ctx, form},
                                ops,
                                true
                            )
                        };
                    if (setting.kind !== 'format') return [ret];
                    const commitFormat = (v: unknown) =>
                        own
                            ? ops.current.set(row.key, setting.key, v)
                            : impl.commitItemSetting(node.settingsIn.key, field, setting.key, v);
                    return [
                        ret,
                        ...formatOptionSettings(setting, value, commitFormat, {
                            impl,
                            key: own ? ctx.key : node.settingsIn.key,
                            scope: `${scope}/${row.key}`,
                            inherited: impl.inheritedDisplay(field),
                            fieldType: impl.fieldType(field)
                        })
                    ];
                }),
                onStep: by => rows[index + by] && impl.openPage(ctx.key, rows[index + by].key),
                onBack: () => {
                    impl.designModel.closeItemPage();
                    impl.setOpenItem(scope, itemKey);
                    focusItem(itemKey);
                }
            });
        return settingsForm({
            nodes: settings.map(it => it.setting),
            values: Object.fromEntries(
                settings.map(({setting, own}) => [
                    setting.key,
                    own ? row.entry[setting.key] : mapped[setting.key]
                ])
            ),
            commit: commitSetting,
            content: form => [page(form)]
        });
    }
});

/** A list item's page, as {@link pageView} draws it, such as a grid row action's. */
export const listItemPage = hoistCmp.factory<
    ListEditorProps<ListNode> & {
        itemKey: string;
        inner?: boolean;
        /** The item whose list holds this one, for a page within its page, such as a column's. */
        of?: string;
    }
>({
    displayName: 'BlueprintListItemPage',
    model: false,
    render({node, list: items, commit, ctx, itemKey, inner, of}) {
        const {impl} = ctx,
            scope = scopeOf(ctx),
            keys = impl.keysFor(scope, items),
            ref = useNamedInputs(),
            index = keys.indexOf(itemKey),
            value = items[index] as PlainObject;
        usePageFocus(ref, itemKey);
        if (index < 0) return null;
        const set = (key: string, v: unknown) =>
            commit(
                items.map((it, j) =>
                    j === index ? (v === undefined ? omit(value, key) : {...value, [key]: v}) : it
                )
            );
        const page = (form: FormModel) =>
            pageView({
                impl,
                scope,
                ref,
                listLabel: node.label,
                title: itemLabel(value, index),
                subtitle: of
                    ? `${singular(node.label)} ${index + 1} of ${of}'s ${node.label.toLowerCase()}`
                    : singular(node.label),
                common: node.item.schema['x-common'],
                index,
                count: items.length,
                groups: node.item.schema['x-groups'],
                settings: itemSettings(node).map(setting => ({
                    node: setting,
                    value: value?.[setting.key],
                    row: propertyRow({
                        key: setting.key,
                        node: setting,
                        value: value?.[setting.key],
                        commit: v => set(setting.key, v),
                        ctx: {...ctx, scope: `${scope}/${itemKey}`, form}
                    })
                })),
                onStep: by => {
                    const to = keys[index + by],
                        label = to && itemLabel(items[index + by], index + by);
                    if (!to) return;
                    if (inner) impl.designModel.openInnerPage({list: node.key, key: to, label});
                    else impl.openPage(ctx.key, to, label);
                },
                onBack: () => {
                    if (inner) impl.designModel.closeInnerPage();
                    else impl.designModel.closeItemPage();
                    impl.setOpenItem(scope, itemKey);
                    focusItem(itemKey);
                }
            });
        return settingsForm({
            nodes: itemSettings(node),
            values: value ?? {},
            commit: set,
            content: form => [page(form)]
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
        flatFormat?: boolean;
        form?: FormModel;
    }
>({
    displayName: 'BlueprintDrawerSetting',
    model: false,
    render({impl, node, value, listKey, scope, field, rowKey, ops, locked, flatFormat, form}) {
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
                      flatFormat,
                      form,
                      field,
                      inherited: impl.inheritedDisplay(field),
                      fieldType: impl.fieldType(field)
                  }
                : {impl, key: listKey, scope, locked, flatFormat, form},
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

// itemRenderer and detailRenderer that keep their identity and call the latest functions given.
function useStableRenderers<R>(fns: {
    itemRenderer: (row: R) => ReactNode;
    detailRenderer: (row: R) => ReactNode;
}) {
    const latest = useLatest(fns);
    return useMemo(
        () => ({
            itemRenderer: (row: R) => latest.current.itemRenderer(row),
            detailRenderer: (row: R) => latest.current.detailRenderer(row)
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
// A choice of three or fewer short words, which a segmented control shows better than a select.
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
                      itemRenderer: ({index, key}: {index: number; key: SortKey}) =>
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
                ...({'data-row-key': keys[i]} as object),
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
        className: `${CLS}__list ${CLS}__field-list`,
        // Delete on a step removes it, though never the last of a required action.
        onKeyDown: (e: React.KeyboardEvent) =>
            !disabled &&
            !(node.required && steps.length === 1) &&
            onItemDelete(e, key => commitSteps(steps.filter((_, j) => keys[j] !== key))),
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
                          itemRenderer: (row: PlainObject) => stepHeader(row.step, row.index),
                          // Every step's body shows, with no chevron to fold it.
                          isItemExpandable: () => false,
                          detailRenderer: (row: PlainObject) => stepBody(row.step, row.index)
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
                className: `${CLS}__add-button`,
                icon: Icon.add(),
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
        className: `${CLS}__row ${CLS}__labelled`,
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
            // A folded card sums itself up on a line of its own, under its header.
            collapsed
                ? summary
                    ? div({className: `${CLS}__card-summary`, children: summary})
                    : null
                : div({className: `${CLS}__card-body`, children})
        ]
    });
}
