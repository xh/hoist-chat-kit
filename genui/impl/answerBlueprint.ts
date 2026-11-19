import type {PlainObject} from '@xh/hoist/core';
import {dropRight, isArray, isEmpty, isFinite, isPlainObject, isString} from 'lodash';
import type {Blueprint, BlueprintElement, ChildRef, SourceDecl} from '../../blueprint';
import type {ChatUiDocument, ChatUiElement} from '../ChatUiDocument';
import {toWidgetName} from './specWidgets';

/**
 * A document as an answer blueprint: each element's props become its config, and its children
 * and named slots become child references. A component a blueprint built-in shares its name with
 * becomes its bridged widget, as `chart` becomes `chatUiChart`. Leaves what it cannot read for
 * `degradeAnswer()` to report, so a document with problems still translates.
 *
 * Stat cards whose props pass the catalog become a `statCardStrip` over an inline source, so that
 * their data lives in a source. While one streams, its last card, which may be cut short, waits.
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
                          translated =
                              el?.component === 'statCards' &&
                              isValid('statCards', el.props ?? {}, isPartial)
                                  ? toStatCardStrip(id, el.props, isPartial)
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

function toStatCardStrip(
    id: string,
    props: PlainObject,
    isPartial: boolean
): {element: BlueprintElement; source: SourceDecl} {
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
                ...(isNumber ? toFieldFormat(card.format, card.decimals) : {})
            });
            row[value] = card.value;

            const ret: PlainObject = {field: value};
            if (isFinite(card.delta)) {
                const format = card.deltaFormat ?? card.format;
                fields.push({
                    name: delta,
                    type: 'number',
                    aggregator: 'UNIQUE',
                    ...toFieldFormat(format, format === card.format ? card.decimals : null)
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
 * A chat number format as a field's kind and format. A number or currency shows in compact
 * form, such as `$48.5B`, as chat kit's headline figures do, and keeps its decimals only while
 * whole.
 */
function toFieldFormat(format: string, decimals: number): PlainObject {
    const precision = (fixed: unknown) => decimals ?? fixed,
        compact = {scale: 'auto', labelCls: null};
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

function ids(value: unknown): string[] {
    return isArray(value) ? value : [];
}
