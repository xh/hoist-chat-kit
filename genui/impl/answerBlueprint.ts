import type {PlainObject} from '@xh/hoist/core';
import {genDisplayName} from '@xh/hoist/data';
import {
    dropRight,
    isArray,
    isEmpty,
    isFinite,
    isPlainObject,
    isNil,
    isString,
    mapKeys,
    omit,
    omitBy,
    pick
} from 'lodash';
import type {Blueprint, BlueprintElement, ChildRef, SourceDecl} from '../../blueprint';
import type {ChatUiDocument, ChatUiElement} from '../ChatUiDocument';
import {type ChatUiBinding, isChatUiBindings} from '../ChatUiState';
import {getOwn} from '../../impl/LangUtils';
import {CHILD_REF_PROPS, fromWidgetName, toWidgetName, TRANSLATED_COMPONENTS} from './specWidgets';

/**
 * A document as an answer blueprint: each element's props become its config, and its children
 * and named slots become child references. A component a blueprint built-in shares its name with
 * becomes its bridged widget, as `chart` becomes `chatUiChart`. Leaves what it cannot read for
 * `degradeAnswer()` to report, so a document with problems still translates.
 *
 * Text, a callout, a section and a stack whose props pass the catalog become the dashboard's
 * `markdown`, `callout`, `panel` and `box`, and a card a card `panel` of a `propertyTable` and a
 * `buttonGroup`, so an answer holds the widgets a host does. A chat input stays on its bridge, as
 * its state lives in the chat.
 *
 * Stat cards and an inline grid whose props pass the catalog become a `tileFrame` of `statCard`s,
 * with any trend as a series field, or a `cubeGrid` over an inline source, so that their data lives
 * in a source. A property table becomes a `propertyTable`, and progress bars a `propertyTable` of
 * `progress` renderers, each over an inline row. While one streams, its
 * last card, row or point, which may be cut short, waits, so that no part-written value reaches a
 * source. A grid or chart by reference stays the spec: its artifact is its source.
 */
export function toAnswerBlueprint(
    doc: ChatUiDocument,
    opts: ToAnswerBlueprintOptions = {}
): Blueprint {
    if (!isPlainObject(doc)) return doc as unknown as Blueprint;
    const {partialIds = [], isValid = () => false, kitComponentOf = (it: string) => it} = opts,
        sources: Record<string, SourceDecl> = {},
        elements = isPlainObject(doc.elements)
            ? Object.fromEntries(
                  Object.entries(doc.elements).flatMap(([docId, el]) => {
                      const id = toAnswerId(docId),
                          isPartial = partialIds.includes(id),
                          translate = getOwn(TRANSLATORS, kitComponentOf(el?.component)),
                          translated =
                              translate && isValid(el.component, el.props ?? {}, isPartial, docId)
                                  ? translate(id, el.props ?? {}, isPartial, el)
                                  : null;
                      if (translated?.source) sources[id] = translated.source;
                      return [
                          [id, translated?.element ?? toElement(el)],
                          ...Object.entries(translated?.children ?? {})
                      ];
                  })
              )
            : doc.elements;
    return {
        ...(isEmpty(sources) ? {} : {sources}),
        root: toAnswerId(doc.root),
        elements
    } as Blueprint;
}

export interface ToAnswerBlueprintOptions {
    /** Elements still streaming, by answer ID. */
    partialIds?: string[];
    /**
     * True if an element's props pass the catalog's checks, as complete or as still arriving, and
     * nothing else found a problem with it, by its ID in the document.
     */
    isValid?: (component: string, props: PlainObject, isPartial: boolean, id: string) => boolean;
    /**
     * Which of chat kit's own components a component is, if any - see `kitComponent`. Only those
     * translate into dashboard widgets. Default the component's name.
     */
    kitComponentOf?: (component: string) => string;
}

/** The props of an element that a program's state holds, beside an answer's blueprint. */
export interface ChatUiBoundProps {
    /** Writes each prop to the program's state. */
    bindings: Record<string, ChatUiBinding>;
    /** The value of each prop, as the program's state resolved it. */
    values: PlainObject;
}

/**
 * The bound props of each element of a document, by answer ID, which an answer keeps beside its
 * blueprint: their bindings hold functions, and their values are the program's to hold. Like the
 * document path, nothing checks a bound value, as the user may be typing it.
 */
export function answerBindingsOf(doc: ChatUiDocument): Record<string, ChatUiBoundProps> {
    if (!isPlainObject(doc?.elements)) return {};
    return Object.fromEntries(
        Object.entries(doc.elements)
            .filter(([, el]) => isChatUiBindings(el?.bindings) && !isEmpty(el.bindings))
            .map(([id, el]) => [
                toAnswerId(id),
                {bindings: el.bindings, values: pick(el.props ?? {}, Object.keys(el.bindings))}
            ])
    );
}

/**
 * An element ID as an answer can hold it. A document may use a name that reaches a prototype,
 * such as `constructor`, which a blueprint refuses, so it takes a suffix.
 */
export function toAnswerId(id: unknown): string {
    return isString(id) && FORBIDDEN_IDS.includes(id) ? `${id}_` : (id as string);
}

//------------------
// Implementation
//------------------
// Slot names an element keeps for itself, or that hold its children.
const RESERVED_SLOTS = ['default', 'children', 'component', 'config', 'personalizable'];

function toElement(el: ChatUiElement): BlueprintElement {
    if (!isPlainObject(el)) return el as unknown as BlueprintElement;
    const refs: ChildRef[] = [
            ...ids(el.children).map(id => ({id: toAnswerId(id)})),
            ...ids(el.slots?.default).map(id => ({id: toAnswerId(id)}))
        ],
        // A named slot becomes a slot list of the same name.
        slots = Object.fromEntries(
            Object.entries(el.slots ?? {})
                .filter(([slot]) => !RESERVED_SLOTS.includes(slot))
                .map(([slot, slotIds]) => [slot, ids(slotIds).map(id => ({id: toAnswerId(id)}))])
                .filter(([, list]) => list.length)
        );
    // A bound prop stays beside the blueprint, with its binding.
    const bound = isChatUiBindings(el.bindings) ? Object.keys(el.bindings) : [],
        perChild = getOwn(CHILD_REF_PROPS, el.component),
        values = perChild ? el.props?.[perChild.prop] : null;
    if (isArray(values)) {
        refs.forEach((it, idx) => {
            if (idx < values.length) it[perChild.key] = values[idx];
        });
    }
    return {
        component: toWidgetName(el.component),
        config: omit(el.props ?? {}, perChild ? [...bound, perChild.prop] : bound),
        ...(refs.length ? {children: refs} : {}),
        ...slots
    };
}

/**
 * An answer with each bridge of a translated component turned into its dashboard widgets, as an
 * answer saved before the translation holds them. Leaves a bridge whose props fail the catalog.
 */
export function upgradeBridges(
    bp: Blueprint,
    opts: Pick<ToAnswerBlueprintOptions, 'isValid' | 'kitComponentOf'>
): Blueprint {
    if (!isPlainObject(bp?.elements)) return bp;
    const {isValid = () => false, kitComponentOf = (it: string) => it} = opts,
        elements: Record<string, BlueprintElement> = {},
        sources: Record<string, SourceDecl> = {...bp.sources};
    let changed = false;
    Object.entries(bp.elements).forEach(([id, el]) => {
        const name = fromWidgetName(el?.component),
            kind = kitComponentOf(name),
            translate = TRANSLATED_COMPONENTS.includes(kind) ? getOwn(TRANSLATORS, kind) : null,
            props = el?.config ?? {},
            refs = el?.children ?? [],
            translated =
                translate && isValid(name, props, false, fromAnswerId(id))
                    ? translate(id, props, false, {
                          component: name,
                          props,
                          children: refs.filter(it => !it.slot).map(it => fromAnswerId(it.id))
                      } as ChatUiElement)
                    : null;
        if (!translated) {
            elements[id] = el;
            return;
        }
        changed = true;
        elements[id] = translated.element;
        Object.assign(elements, translated.children ?? {});
        if (translated.source) sources[id] = translated.source;
    });
    return changed ? {...bp, ...(isEmpty(sources) ? {} : {sources}), elements} : bp;
}

/** The document's ID for an element of an answer, undoing {@link toAnswerId}. */
export function fromAnswerId(id: string): string {
    return id?.endsWith('_') && FORBIDDEN_IDS.includes(id.slice(0, -1)) ? id.slice(0, -1) : id;
}

const FORBIDDEN_IDS = ['__proto__', 'prototype', 'constructor'];

/** A chat component as an element, with the source it reads and the elements it holds, if any. */
type Translation = {
    element: BlueprintElement;
    source?: SourceDecl;
    children?: Record<string, BlueprintElement>;
};

function toCubeGrid(id: string, props: PlainObject, isPartial: boolean): Translation {
    if (props.data != null || !isArray(props.columns) || !isArray(props.rows)) return null;
    const columns = props.columns.filter(isPlainObject),
        // A source keeps `id` for each row's key, so a column of that name takes a free one.
        names = new Map<string, string>(),
        taken = new Set(columns.map(it => it.field));
    columns.forEach(({field}) => {
        let name = field;
        while (name === 'id' || (name !== field && taken.has(name))) name = `${name}_`;
        names.set(field, name);
        taken.add(name);
    });
    const nameOf = (field: string) => names.get(field) ?? field,
        fields = columns.map(col => {
            const type = GRID_TYPES[col.type] ?? 'string',
                label = col.headerName ?? (col.field === 'id' ? genDisplayName('id') : null);
            return {
                name: nameOf(col.field),
                ...(label ? {label} : {}),
                type,
                ...(type === 'number' ? toFieldFormat(col.format, col.decimals, false) : {})
            };
        }),
        rows = (isPartial ? dropRight(props.rows) : props.rows)
            .filter(isPlainObject)
            .map((row: PlainObject) => mapKeys(row, (_, key) => nameOf(key)));
    return {
        element: {
            component: 'cubeGrid',
            config: {
                source: id,
                presentation: 'card',
                ...(props.title ? {title: props.title} : {}),
                ...(props.sortBy ? {sortBy: props.sortBy} : {}),
                columnState: columns.map(it => nameOf(it.field))
            }
        },
        source: {inline: {fields, rows}} as SourceDecl
    };
}

/**
 * A chart over an inline source: a row per point of the x-axis, with the value of each series.
 * Plain values take their category, in order, and pairs their x. Categories keep their order
 * through `xOrder`, as the Cube groups them by name. While the chart streams, the point still
 * arriving, which may be cut short, waits.
 */
function toChart(id: string, props: PlainObject, isPartial: boolean): Translation {
    if (props.data != null || !isArray(props.series)) return null;
    const series = props.series.filter(isPlainObject);
    if (!series.length || series.length > MAX_CHART_SERIES) return null;
    // The point still arriving is the last of the last series, as chat kit's chart has it.
    const lastIdx = series.length - 1;

    const isDatetime = props.xAxis?.type === 'datetime',
        categories: unknown[] = isArray(props.xAxis?.categories) ? props.xAxis.categories : [],
        rows = new Map<string, PlainObject>();
    series.forEach((it, idx) =>
        (isArray(it.data)
            ? isPartial && idx === lastIdx
                ? dropRight(it.data)
                : it.data
            : []
        ).forEach((point: unknown, pointIdx: number) => {
            const [x, value] = isArray(point)
                    ? point
                    : [categories[pointIdx] ?? String(pointIdx), point],
                key = String(x),
                row = rows.get(key) ?? {x, xOrder: rows.size};
            row[`s${idx}`] = value;
            rows.set(key, row);
        })
    );
    const xs = [...rows.values()].map(it => it.x),
        xField = isDatetime
            ? {name: 'x', type: xs.every(isString) ? 'localDate' : 'date'}
            : {name: 'x', type: 'string', isDimension: true},
        yFormat = toFieldFormat(props.yAxis?.format, props.yAxis?.decimals, false);
    return {
        element: {
            component: 'chart',
            config: {
                source: id,
                presentation: 'card',
                type: props.type,
                x: 'x',
                y: series.map((_, idx) => `s${idx}`),
                ...(isDatetime ? {} : {sortBy: 'xOrder|asc'}),
                ...(props.title ? {title: props.title} : {}),
                xTitle: props.xAxis?.title ?? '',
                yTitle: props.yAxis?.title ?? ''
            }
        },
        source: {
            inline: {
                fields: [
                    xField,
                    {name: 'xOrder', type: 'number', aggregator: 'MIN'},
                    ...series.map((it, idx) => ({
                        name: `s${idx}`,
                        ...(it.name ? {label: it.name} : {}),
                        type: 'number',
                        aggregator: 'SUM',
                        ...yFormat
                    }))
                ],
                rows: [...rows.values()]
            }
        } as SourceDecl
    };
}

// The most series a blueprint chart takes. A chart with more stays the spec.
const MAX_CHART_SERIES = 8;

const GRID_TYPES: Record<string, string> = {
    string: 'string',
    number: 'number',
    date: 'localDate',
    boolean: 'bool'
};

function toStatCards(id: string, props: PlainObject, isPartial: boolean): Translation {
    const cards = (isPartial ? dropRight(props.cards) : props.cards).filter(isPlainObject);
    if (!cards.length) return null;

    const fields: PlainObject[] = [],
        row: PlainObject = {},
        configs = cards.map((card, idx) => {
            const value = `v${idx}`,
                delta = `d${idx}`,
                isNumber = isFinite(card.value);
            fields.push({
                name: value,
                label: card.label,
                type: isNumber ? 'number' : 'string',
                aggregator: 'UNIQUE',
                ...(isNumber ? toFieldFormat(card.format, card.decimals, true) : {})
            });
            row[value] = card.value;

            const ret: PlainObject = {source: id, field: value};
            if (isFinite(card.delta)) {
                const format = card.deltaFormat ?? card.format;
                fields.push({
                    name: delta,
                    type: 'number',
                    aggregator: 'UNIQUE',
                    ...toFieldFormat(format, format === card.format ? card.decimals : null, true)
                });
                row[delta] = card.delta;
                ret.deltaField = delta;
            }
            // A sparkline draws two values or more.
            const trend = isArray(card.trend) ? card.trend.filter(isFinite) : [];
            if (trend.length > 1) {
                fields.push({name: `t${idx}`, type: 'number[]'});
                row[`t${idx}`] = trend;
                ret.trend = `t${idx}`;
            }
            if (card.deltaLabel) ret.deltaLabel = card.deltaLabel;
            if (card.invert) ret.invert = true;
            if (card.intent && card.intent !== 'none') ret.intent = card.intent;
            return ret;
        });
    const children = Object.fromEntries(
        configs.map((config, idx) => [
            `${id}-card${idx + 1}`,
            {component: 'statCard', config} as BlueprintElement
        ])
    );
    return {
        element: {
            component: 'tileFrame',
            config: {},
            children: Object.keys(children).map(it => ({id: it}))
        },
        source: {inline: {fields, rows: [row]}} as SourceDecl,
        children
    };
}

/**
 * A chat number format as a field's kind and format. With `isCompact`, a number or currency shows
 * in compact form, such as `$48.5B`, as chat kit's headline figures do, and keeps its decimals
 * only while whole.
 */
export function toFieldFormat(format: string, decimals: number, isCompact: boolean): PlainObject {
    const precision = (fixed: unknown) => decimals ?? fixed,
        compact = isCompact ? {scale: 'auto', labelCls: null} : {};
    switch (format) {
        case 'percent':
            return {kind: 'fraction', format: {precision: precision(1)}};
        case 'currency':
            return {format: {prefix: '$', precision: precision(2), ...compact}};
        case 'none':
            return {format: {precision: precision(null), withCommas: false}};
        default:
            return {format: {precision: precision('auto'), ...compact}};
    }
}

// Text in a markdown template, where a brace would start a reference.
const asTemplate = (text: unknown) => (isString(text) ? text.replace(/[{}]/g, '$&$&') : text);

const GAPS: Record<string, number> = {none: 0, small: 4, medium: 8, large: 16};

function toMarkdown(id: string, props: PlainObject): Translation {
    return {element: {component: 'markdown', config: {text: asTemplate(props.text)}}};
}

function toCallout(id: string, props: PlainObject): Translation {
    const {intent, title, text} = props;
    return {
        element: {
            component: 'callout',
            config: omitBy({intent, title: asTemplate(title), text: asTemplate(text)}, isNil)
        }
    };
}

function toPanel(id: string, props: PlainObject, _: boolean, el: ChatUiElement): Translation {
    const {title, intent, collapsible, collapsed} = props,
        {children} = toElement(el);
    return {
        element: {
            component: 'panel',
            config: omitBy({style: 'card', title, intent, collapsible, collapsed}, isNil),
            ...(children ? {children} : {})
        }
    };
}

// A card's fields become properties over an inline source of one row, and its actions buttons.
function toCard(id: string, props: PlainObject, isPartial: boolean): Translation {
    const fields = (isPartial ? dropRight(props.fields) : (props.fields ?? [])).filter(
            isPlainObject
        ),
        // As ChatUiCard does, no action shows until the card is complete.
        actions = (isPartial ? [] : (props.actions ?? [])).filter(isPlainObject);
    if (!fields.length) return null;
    const row: PlainObject = {},
        inline = fields.map((f, idx) => {
            const name = `v${idx}`,
                isNumber = isFinite(f.value);
            row[name] = f.value;
            return {
                name,
                label: f.label,
                type: isNumber ? 'number' : 'string',
                aggregator: 'UNIQUE',
                ...(isNumber ? toFieldFormat(f.format, f.decimals, false) : {})
            };
        }),
        children: Record<string, BlueprintElement> = {};
    if (props.subtitle) {
        children[`${id}-subtitle`] = {
            component: 'markdown',
            config: {text: asTemplate(props.subtitle)}
        };
    }
    children[`${id}-fields`] = {
        component: 'propertyTable',
        config: {source: id, fields: inline.map(it => it.name)}
    };
    if (actions.length) {
        children[`${id}-actions`] = {
            component: 'buttonGroup',
            config: {
                buttons: actions.map(({label, confirm, ...action}) => ({
                    label,
                    action: {...action, ...(confirm ? {confirm: true} : {})}
                }))
            }
        };
    }
    return {
        element: {
            component: 'panel',
            config: {style: 'card', title: props.title},
            children: Object.keys(children).map(it => ({id: it}))
        },
        source: {inline: {fields: inline, rows: [row]}} as SourceDecl,
        children
    };
}

function toPropertyTable(id: string, props: PlainObject, isPartial: boolean): Translation {
    const entries = (isPartial ? dropRight(props.entries) : (props.entries ?? [])).filter(
        it => isPlainObject(it) && isString(it.label)
    );
    if (!entries.length) return null;
    const row: PlainObject = {},
        fields = entries.map((entry, idx) => {
            const name = `v${idx}`,
                {value} = entry,
                isNumber = isFinite(value);
            // As the chat's table shows them: a boolean as Yes or No, and a missing value as blank.
            row[name] = typeof value === 'boolean' ? (value ? 'Yes' : 'No') : (value ?? null);
            return {
                name,
                label: entry.label,
                type: isNumber ? 'number' : 'string',
                aggregator: 'UNIQUE',
                ...(isNumber ? toFieldFormat(entry.format, entry.decimals, false) : {})
            };
        });
    return {
        element: {
            component: 'propertyTable',
            config: {
                source: id,
                fields: fields.map(it => it.name),
                ...(isFinite(props.columns)
                    ? {columns: Math.min(4, Math.max(1, props.columns))}
                    : {})
            }
        },
        source: {inline: {fields, rows: [row]}} as SourceDecl
    };
}

// Each bar a field drawn by the progress renderer, its max and any target fields of the same row.
function toProgressBars(id: string, props: PlainObject, isPartial: boolean): Translation {
    const bars = (isPartial ? dropRight(props.bars) : (props.bars ?? [])).filter(
        it => isPlainObject(it) && isString(it.label) && isFinite(it.value)
    );
    if (!bars.length) return null;
    const row: PlainObject = {},
        fields: PlainObject[] = [],
        entries = bars.map((bar, idx) => {
            const [value, max, target] = [`v${idx}`, `m${idx}`, `t${idx}`],
                renderer: PlainObject = {name: 'progress', maxField: max};
            row[value] = bar.value;
            row[max] = isFinite(bar.max) ? bar.max : bar.format === 'percent' ? 1 : 100;
            fields.push(
                {
                    name: value,
                    label: bar.label,
                    type: 'number',
                    aggregator: 'UNIQUE',
                    ...toFieldFormat(bar.format, null, false)
                },
                {name: max, type: 'number', aggregator: 'UNIQUE'}
            );
            if (isFinite(bar.target)) {
                row[target] = bar.target;
                fields.push({name: target, type: 'number', aggregator: 'UNIQUE'});
                renderer.targetField = target;
            }
            if (bar.intent && bar.intent !== 'none') renderer.intent = bar.intent;
            return {field: value, renderer};
        });
    return {
        element: {
            component: 'propertyTable',
            config: {source: id, labelSide: 'top', fields: entries}
        },
        source: {inline: {fields, rows: [row]}} as SourceDecl
    };
}

// A titled stack draws a frame, as a card panel around its box.
function toBox(id: string, props: PlainObject, _: boolean, el: ChatUiElement): Translation {
    const {children} = toElement(el),
        box: BlueprintElement = {
            component: 'box',
            config: {
                direction: props.direction ?? 'column',
                gap: GAPS[props.gap] ?? GAPS.medium,
                fill: false
            },
            ...(children ? {children} : {})
        };
    if (!props.title) return {element: box};
    const boxId = `${id}-box`;
    return {
        element: {
            component: 'panel',
            config: {style: 'card', title: props.title},
            children: [{id: boxId}]
        },
        children: {[boxId]: box}
    };
}

const TRANSLATORS: Record<
    string,
    (id: string, props: PlainObject, isPartial: boolean, el: ChatUiElement) => Translation
> = {
    statCards: toStatCards,
    grid: toCubeGrid,
    chart: toChart,
    text: toMarkdown,
    callout: toCallout,
    section: toPanel,
    stack: toBox,
    card: toCard,
    propertyTable: toPropertyTable,
    progressBars: toProgressBars
};

function ids(value: unknown): string[] {
    return isArray(value) ? value : [];
}
