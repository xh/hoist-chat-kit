import type {PlainObject} from '@xh/hoist/core';
import {genDisplayName} from '@xh/hoist/data';
import {dropRight, isArray, isEmpty, isFinite, isPlainObject, isString, mapKeys} from 'lodash';
import type {Blueprint, BlueprintElement, ChildRef, SourceDecl} from '../../blueprint';
import type {ChatUiDocument, ChatUiElement} from '../ChatUiDocument';
import {getOwn} from '../../impl/LangUtils';
import {toWidgetName} from './specWidgets';

/**
 * A document as an answer blueprint: each element's props become its config, and its children
 * and named slots become child references. A component a blueprint built-in shares its name with
 * becomes its bridged widget, as `chart` becomes `chatUiChart`. Leaves what it cannot read for
 * `degradeAnswer()` to report, so a document with problems still translates.
 *
 * Stat cards and an inline grid whose props pass the catalog become a `statCardStrip` or a
 * `cubeGrid` over an inline source, so that their data lives in a source. While one streams, its
 * last card, row or point, which may be cut short, waits, so that no part-written value reaches a
 * source. A grid or chart by reference stays the spec: its artifact is its source.
 */
export function toAnswerBlueprint(
    doc: ChatUiDocument,
    opts: ToAnswerBlueprintOptions = {}
): Blueprint {
    if (!isPlainObject(doc)) return doc as unknown as Blueprint;
    const {partialIds = [], isValid = () => false} = opts,
        sources: Record<string, SourceDecl> = {},
        elements = isPlainObject(doc.elements)
            ? Object.fromEntries(
                  Object.entries(doc.elements).map(([docId, el]) => {
                      const id = toAnswerId(docId),
                          isPartial = partialIds.includes(id),
                          translate = getOwn(TRANSLATORS, el?.component),
                          translated =
                              translate && isValid(el.component, el.props ?? {}, isPartial)
                                  ? translate(id, el.props, isPartial)
                                  : null;
                      if (translated) sources[id] = translated.source;
                      return [id, translated?.element ?? toElement(el)];
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
    /** True if a component's props pass the catalog's checks, as complete or as still arriving. */
    isValid?: (component: string, props: PlainObject, isPartial: boolean) => boolean;
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
function toElement(el: ChatUiElement): BlueprintElement {
    if (!isPlainObject(el)) return el as unknown as BlueprintElement;
    const refs: ChildRef[] = [
        ...ids(el.children).map(id => ({id: toAnswerId(id)})),
        ...Object.entries(el.slots ?? {}).flatMap(([slot, slotIds]) =>
            ids(slotIds).map(id =>
                slot === 'default' ? {id: toAnswerId(id)} : {id: toAnswerId(id), slot}
            )
        )
    ];
    return {
        component: toWidgetName(el.component),
        config: el.props ?? {},
        ...(refs.length ? {children: refs} : {})
    };
}

/** The document's ID for an element of an answer, undoing {@link toAnswerId}. */
export function fromAnswerId(id: string): string {
    return id?.endsWith('_') && FORBIDDEN_IDS.includes(id.slice(0, -1)) ? id.slice(0, -1) : id;
}

const FORBIDDEN_IDS = ['__proto__', 'prototype', 'constructor'];

type Translation = {element: BlueprintElement; source: SourceDecl};

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

function toStatCardStrip(id: string, props: PlainObject, isPartial: boolean): Translation {
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

            const ret: PlainObject = {field: value};
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
            if (card.deltaLabel) ret.deltaLabel = card.deltaLabel;
            if (card.invert) ret.invert = true;
            if (card.intent && card.intent !== 'none') ret.intent = card.intent;
            return ret;
        });
    return {
        element: {
            component: 'statCardStrip',
            config: {source: id, presentation: 'card', cards: configs}
        },
        source: {inline: {fields, rows: [row]}} as SourceDecl
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

const TRANSLATORS: Record<
    string,
    (id: string, props: PlainObject, isPartial: boolean) => Translation
> = {
    statCards: toStatCardStrip,
    grid: toCubeGrid,
    chart: toChart
};

function ids(value: unknown): string[] {
    return isArray(value) ? value : [];
}
