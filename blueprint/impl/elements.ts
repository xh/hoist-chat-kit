import type {PlainObject} from '@xh/hoist/core';
import {isString, sortBy} from 'lodash';
import type {BlueprintElement, ChildRef} from '../Blueprint';

// Plain data and pure functions only, so a validator under plain Node can load these.

/** Where a child sits: its parent, the slot list, the child reference that holds that list, if any. */
export interface SlotPlace {
    parent: string;
    slot: string;
    /** The child of the parent whose reference holds the slot, such as a canvas cell. */
    of?: string;
    index: number;
}

/** One slot list of an element: on the element, or on one of its child references. */
export interface SlotList {
    slot: string;
    of?: string;
    refs: ChildRef[];
}

/**
 * An element's slot lists: `children` and its other slots, such as a panel's `tbar`, then those of
 * its child references, such as a canvas cell's `headerItems`. A slot list is a key whose value is
 * a list of child references, objects with an `id`.
 */
export function slotLists(el: BlueprintElement): SlotList[] {
    if (!el) return [];
    const own = Object.entries(el)
            .filter(([key, value]) => !ELEMENT_KEYS.includes(key) && isRefList(value))
            .map(([slot, refs]) => ({slot, refs: refs as ChildRef[]})),
        nested = (el.children ?? []).flatMap(ref =>
            Object.entries(ref)
                .filter(([key, value]) => key !== 'id' && isRefList(value))
                .map(([slot, refs]) => ({slot, of: ref.id, refs: refs as ChildRef[]}))
        );
    return [...own, ...nested];
}

/** A child as a designer reads it: an element, or the view of a canvas or dash container that holds one. */
export interface ChildNode {
    kind: 'element' | 'view';
    /** The element, or the one the view holds. */
    id: string;
    /** For a view, the container it is a view of. */
    of?: string;
    /** For a view, its element as `children`, then its own slots, such as a canvas cell's header. */
    groups?: {slot: string; refs: ChildRef[]}[];
}

/**
 * An element's own children as a designer reads them, such as in Structure: a group per slot where
 * its widget has more than one, else one group of every child. A canvas lists its cells in reading
 * order. Each group's `nodes` show a canvas cell or a dash container's child as a view over its
 * element, and any other child as itself. Empty for an element whose widget holds no children.
 */
export function childGroups(
    id: string,
    el: BlueprintElement,
    spec: {children?: {slots?: object}; slots?: object}
): {slot: string; refs: ChildRef[]; nodes: ChildNode[]}[] {
    const slots = [...(spec?.children ? ['children'] : []), ...Object.keys(spec?.slots ?? {})];
    if (!el || !slots.length) return [];
    const own = slotLists(el).filter(it => !it.of),
        views = hasViews(el.component),
        cellSlots = Object.keys(spec.children?.slots ?? {}),
        group = (slot: string, refs: ChildRef[]) => {
            const ordered = el.component === 'dashCanvas' ? sortBy(refs, ['y', 'x']) : refs;
            return {
                slot,
                refs: ordered,
                nodes: ordered.map((ref): ChildNode => {
                    if (!views || slot !== 'children') return {kind: 'element', id: ref.id};
                    return {
                        kind: 'view',
                        id: ref.id,
                        of: id,
                        groups: [
                            {slot: 'children', refs: [{id: ref.id}]},
                            ...cellSlots.map(it => ({
                                slot: it,
                                refs: (ref[it] as ChildRef[]) ?? []
                            }))
                        ]
                    };
                })
            };
        };
    return slots.length > 1
        ? slots.map(slot => group(slot, own.find(it => it.slot === slot)?.refs ?? []))
        : [
              group(
                  slots[0],
                  own.flatMap(it => it.refs)
              )
          ];
}

/** True for a widget whose children are views, each with a header or tab of its own. */
export function hasViews(component: string): boolean {
    return VIEW_CONTAINERS.includes(component);
}

/** A view's title: its reference's, else its element's, else the element's ID. */
export function viewTitle(ref: ChildRef, el: BlueprintElement): string {
    const title = [ref?.title, el?.config?.title].find(it => isString(it) && it);
    return (title as string) ?? ref.id;
}

/** A slot as a designer reads it, such as `Top toolbar`, or `Cell header` for a cell's slot. */
export function slotLabel(slot: string, cell = false): string {
    const label =
        SLOT_LABELS[slot] ?? slot.replace(/([A-Z])/g, ' $1').replace(/^./, it => it.toUpperCase());
    return cell ? `Cell ${label.toLowerCase()}` : label;
}

const SLOT_LABELS: Record<string, string> = {
    children: 'Content',
    headerItems: 'Header',
    tbar: 'Top toolbar',
    bbar: 'Bottom toolbar'
};

/** The IDs of every child of an element, across its slot lists. */
export function childIds(el: BlueprintElement): string[] {
    return slotLists(el).flatMap(it => it.refs.map(ref => ref.id));
}

/** The ID of the container that holds an element, or null for the root or an unplaced element. */
export function parentOf(elements: Record<string, BlueprintElement>, id: string): string {
    return locate(elements, id)?.parent ?? null;
}

/** Each placed element's container, by ID, in one pass: for many lookups over one blueprint. */
export function parentMap(elements: Record<string, BlueprintElement>): Map<string, string> {
    const ret = new Map<string, string>();
    Object.entries(elements ?? {}).forEach(([parent, el]) =>
        slotLists(el).forEach(({refs}) => refs.forEach(it => ret.set(it.id, parent)))
    );
    return ret;
}

/** The parent and slot that hold an element, or null for the root or an unplaced element. */
export function locate(elements: Record<string, BlueprintElement>, id: string): SlotPlace {
    for (const [parent, el] of Object.entries(elements ?? {})) {
        for (const {slot, of, refs} of slotLists(el)) {
            const index = refs.findIndex(it => it.id === id);
            if (index >= 0) return {parent, slot, ...(of ? {of} : {}), index};
        }
    }
    return null;
}

/** Remove an element's reference from whichever slot of a parent holds it. Returns it, or null. */
export function removeRef(el: BlueprintElement, id: string): ChildRef {
    for (const {slot, of, refs} of slotLists(el)) {
        const index = refs.findIndex(it => it.id === id);
        if (index < 0) continue;
        const [ref] = refs.splice(index, 1),
            holder: PlainObject = of ? el.children.find(it => it.id === of) : el;
        // An emptied slot other than children goes, so a blueprint keeps no empty lists.
        if (!refs.length && (of || slot !== 'children')) delete holder[slot];
        return ref;
    }
    return null;
}

/** Insert a reference into a slot of an element, at an index or at the end. */
export function insertRef(
    el: BlueprintElement,
    ref: ChildRef,
    {slot = 'children', of, index}: {slot?: string; of?: string; index?: number} = {}
) {
    const holder: PlainObject = of ? el.children?.find(it => it.id === of) : el;
    if (!holder) throw new Error(`'${of}' is not a child of the element`);
    const refs: ChildRef[] = (holder[slot] ??= []);
    if (index == null || index >= refs.length) refs.push(ref);
    else refs.splice(Math.max(0, index), 0, ref);
}

/**
 * A blueprint with each child reference that marks a slot, `{id, slot: 'tbar'}` as blueprints wrote
 * it before slot lists, moved into the list it names. The same blueprint if it has none.
 */
export function upgradeSlots<T extends {elements?: Record<string, BlueprintElement>}>(bp: T): T {
    const marked = Object.values(bp?.elements ?? {}).some(el =>
        el.children?.some(it => typeof it.slot === 'string')
    );
    if (!marked) return bp;
    const elements = Object.fromEntries(
        Object.entries(bp.elements).map(([id, el]) => {
            if (!el.children?.some(it => typeof it.slot === 'string')) return [id, el];
            const ret: PlainObject = {...el, children: []};
            el.children.forEach(({slot, ...ref}) => {
                const list = typeof slot === 'string' && slot !== 'default' ? slot : 'children';
                (ret[list] ??= []).push(ref);
            });
            return [id, ret as BlueprintElement];
        })
    );
    return {...bp, elements};
}

//------------------
// Implementation
//------------------
const VIEW_CONTAINERS = ['dashCanvas', 'dashContainer'];

// The keys of an element that are never slots.
const ELEMENT_KEYS = ['component', 'config', 'personalizable'];

function isRefList(value: unknown): boolean {
    return (
        Array.isArray(value) &&
        value.length > 0 &&
        value.every(it => it && typeof it === 'object' && typeof it.id === 'string')
    );
}
