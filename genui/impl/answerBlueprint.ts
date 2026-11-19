import {isArray, isPlainObject, isString} from 'lodash';
import type {Blueprint, BlueprintElement, ChildRef} from '../../blueprint';
import type {ChatUiDocument, ChatUiElement} from '../ChatUiDocument';
import {toWidgetName} from './specWidgets';

/**
 * A document as an answer blueprint: each element's props become its config, and its children
 * and named slots become child references. A component a blueprint built-in shares its name with
 * becomes its bridged widget, as `chart` becomes `chatUiChart`. Leaves what it cannot read for `degradeAnswer()` to
 * report, so a document with problems still translates.
 */
export function toAnswerBlueprint(doc: ChatUiDocument): Blueprint {
    if (!isPlainObject(doc)) return doc as unknown as Blueprint;
    const elements = isPlainObject(doc.elements)
        ? Object.fromEntries(
              Object.entries(doc.elements).map(([id, el]) => [toAnswerId(id), toElement(el)])
          )
        : doc.elements;
    return {root: toAnswerId(doc.root), elements} as Blueprint;
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

function ids(value: unknown): string[] {
    return isArray(value) ? value : [];
}
