import {isArray, isPlainObject} from 'lodash';
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
        ? Object.fromEntries(Object.entries(doc.elements).map(([id, el]) => [id, toElement(el)]))
        : doc.elements;
    return {root: doc.root, elements} as Blueprint;
}

//------------------
// Implementation
//------------------
function toElement(el: ChatUiElement): BlueprintElement {
    if (!isPlainObject(el)) return el as unknown as BlueprintElement;
    const refs: ChildRef[] = [
        ...ids(el.children).map(id => ({id})),
        ...Object.entries(el.slots ?? {}).flatMap(([slot, slotIds]) =>
            ids(slotIds).map(id => (slot === 'default' ? {id} : {id, slot}))
        )
    ];
    return {
        component: toWidgetName(el.component),
        config: el.props ?? {},
        ...(refs.length ? {children: refs} : {})
    };
}

function ids(value: unknown): string[] {
    return isArray(value) ? value : [];
}
