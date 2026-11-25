import type {PlainObject} from '@xh/hoist/core';
import {cloneDeep, isArray, isEmpty, isPlainObject, isString} from 'lodash';
import type {Blueprint, BlueprintElement, BlueprintIssue, BlueprintOp, ChildRef} from './Blueprint';
import {dropDockView} from './impl/dockLayout';
import {childIds, insertRef, locate, parentOf, removeRef} from './impl/elements';
import {renameTemplateRefs} from './impl/template';
import {getOwn, isForbiddenKey, parsePointer, PointerError} from './impl/pointer';

/** Characters an element, variable or source ID may use, so a path never needs escaping. */
export const ID_RE = /^[A-Za-z0-9_-]+$/;

/**
 * Apply an edit's operations to a copy of a blueprint, in order. Structural checks only: the
 * caller validates the result as a whole. The copy shares every part the edit leaves alone, so an
 * unchanged element keeps its identity, and the original is never changed.
 *
 * @returns the new blueprint, or the issue that stopped the edit, with nothing applied.
 */
export function applyOps(
    bp: Blueprint,
    ops: BlueprintOp[]
): {result?: Blueprint; issue?: BlueprintIssue} {
    if (!isArray(ops) || isEmpty(ops)) {
        return {
            issue: {
                code: 'edit.noOps',
                severity: 'error',
                path: '',
                message: 'ops must be a non-empty list'
            }
        };
    }
    const draft = new Draft();
    let next = draft.copyOf(bp ?? {});
    for (let i = 0; i < ops.length; i++) {
        try {
            next = applyOp(next, ops[i], draft);
        } catch (e) {
            if (!(e instanceof OpError) && !(e instanceof PointerError)) throw e;
            return {
                issue: {
                    code: e.code,
                    severity: 'error',
                    path: (ops[i] as PlainObject)?.path ?? '',
                    message: e.message,
                    op: i
                }
            };
        }
    }
    return {result: next};
}

//------------------
// Implementation
//------------------
// Copy on write: each object an edit changes is copied once, before its first change.
class Draft {
    private readonly owned = new WeakSet<object>();
    private readonly deep = new WeakSet<object>();

    /** A shallow copy of an object, which this edit may change. */
    copyOf<T extends object>(o: T): T {
        const ret = (isArray(o) ? [...o] : {...o}) as T;
        this.owned.add(ret);
        return ret;
    }

    /** A child object of an owned parent, copied first unless this edit already copied it. */
    writable(parent: PlainObject, key: string): PlainObject {
        const v = parent[key];
        if (v == null || typeof v !== 'object' || this.owned.has(v)) return v;
        return (parent[key] = this.copyOf(v));
    }

    /** An element whose children an op rearranges, copied whole, or null if there is none. */
    element(bp: Blueprint, id: string): BlueprintElement {
        const elements = this.writable(bp, 'elements');
        if (!elements || !Object.hasOwn(elements, id)) return null;
        if (!this.deep.has(elements[id])) {
            elements[id] = cloneDeep(elements[id]);
            this.owned.add(elements[id]);
            this.deep.add(elements[id]);
        }
        return elements[id];
    }
}

class OpError extends Error {
    readonly code: string;

    constructor(message: string, code = 'edit.badOp') {
        super(message);
        this.code = code;
    }
}

function applyOp(bp: Blueprint, op: any, draft: Draft): Blueprint {
    // Every ID an op names keys an object, so none may reach a prototype.
    for (const id of [op?.id, op?.parent, op?.from, op?.to]) {
        if (isString(id) && isForbiddenKey(id))
            throw new OpError(`'${id}' is forbidden as an ID`, 'path.forbidden');
    }
    const keys = getOwn(OP_KEYS, op?.op),
        extra = keys && Object.keys(op).find(it => !keys.includes(it));
    if (extra) {
        throw new OpError(
            `'${extra}' is not a property of ${op.op}. It takes ${keys.join(', ')}.`,
            'edit.unknownProperty'
        );
    }
    switch (op?.op) {
        case 'set':
            setPath(bp, op.path, op.value, draft);
            return bp;
        case 'remove':
            removePath(bp, op.path, draft);
            return bp;
        case 'addElement': {
            checkId(op.id);
            bp.elements ??= {};
            if (Object.hasOwn(bp.elements, op.id)) {
                throw new OpError(`element '${op.id}' already exists`);
            }
            draft.writable(bp, 'elements')[op.id] = cloneDeep(op.element);
            if (op.parent) {
                placeChild(bp, op.parent, op.id, op.child, op.index, op.slot, op.of, draft);
            } else if (!bp.root) {
                bp.root = op.id;
            } else {
                throw new OpError(
                    'give a parent, or the element is not placed. The blueprint already has a root.'
                );
            }
            return bp;
        }
        case 'removeElement': {
            const el = ownElement(bp, op.id);
            if (!el) throw new OpError(`element '${op.id}' does not exist`);
            if (childIds(el).length) {
                throw new OpError(
                    `element '${op.id}' still has children. Remove or move them first.`
                );
            }
            const p = parentOf(bp.elements, op.id);
            if (p) {
                const parent = draft.element(bp, p);
                removeRef(parent, op.id);
                dropDockView(parent, op.id);
            }
            if (bp.root === op.id) delete bp.root;
            delete draft.writable(bp, 'elements')[op.id];
            return bp;
        }
        case 'moveElement': {
            if (!ownElement(bp, op.id)) throw new OpError(`element '${op.id}' does not exist`);
            if (op.parent === op.id) throw new OpError(`'${op.id}' cannot move into itself`);
            // Up from the new parent, the walk meets the element if it holds the parent.
            for (
                let it = parentOf(bp.elements, op.parent), seen = new Set<string>();
                it && !seen.has(it);
                seen.add(it), it = parentOf(bp.elements, it)
            ) {
                if (it === op.id) {
                    throw new OpError(`'${op.id}' cannot move into '${op.parent}', which it holds`);
                }
            }
            const from = locate(bp.elements, op.id),
                old: PlainObject = from ? removeRef(draft.element(bp, from.parent), op.id) : {},
                {id: _id, ...placement} = old,
                slot = op.slot ?? 'children',
                sameSlot = from?.parent === op.parent && from.slot === slot && from.of === op.of;
            // A view leaving its panes widget leaves its layout too.
            if (from && from.parent !== op.parent)
                dropDockView(draft.element(bp, from.parent), op.id);
            placeChild(
                bp,
                op.parent,
                op.id,
                op.child ?? (sameSlot ? placement : {}),
                op.index,
                slot,
                op.of,
                draft
            );
            return bp;
        }
        case 'renameId': {
            const coll = {element: 'elements', variable: 'variables', source: 'sources'}[op.kind];
            if (!coll) throw new OpError(`kind must be element, variable or source`);
            checkId(op.to);
            if (!bp[coll] || !Object.hasOwn(bp[coll], op.from)) {
                throw new OpError(`${op.kind} '${op.from}' does not exist`);
            }
            if (Object.hasOwn(bp[coll], op.to))
                throw new OpError(`${op.kind} '${op.to}' already exists`);
            // A rename can reach anywhere, so it builds the blueprint anew.
            const next = draft.copyOf(renameRefs(bp, op.kind, op.from, op.to));
            next[coll] = Object.fromEntries(
                Object.entries(next[coll]).map(([k, v]) => [k === op.from ? op.to : k, v])
            );
            if (op.kind === 'element' && next.root === op.from) next.root = op.to;
            return next;
        }
        default:
            throw new OpError(
                `unknown op '${op?.op}'. Use set, remove, addElement, removeElement, moveElement or renameId.`
            );
    }
}

const OP_KEYS: Record<string, string[]> = {
    set: ['op', 'path', 'value'],
    remove: ['op', 'path'],
    addElement: ['op', 'id', 'element', 'parent', 'child', 'index', 'slot', 'of'],
    removeElement: ['op', 'id'],
    moveElement: ['op', 'id', 'parent', 'child', 'index', 'slot', 'of'],
    renameId: ['op', 'kind', 'from', 'to']
};

function ownElement(bp: Blueprint, id: string) {
    return bp.elements && Object.hasOwn(bp.elements, id) ? bp.elements[id] : null;
}

function checkId(id: string) {
    if (!ID_RE.test(id ?? ''))
        throw new OpError(`id '${id}' may use only letters, digits, _ and -`);
}

function segments(path: string): string[] {
    return parsePointer(path);
}

// The object at a path, each one on the way copied before it changes.
function walkTo(doc: PlainObject, segs: string[], create: boolean, draft: Draft): PlainObject {
    let o = doc;
    for (const s of segs) {
        if (isArray(o)) {
            throw new OpError(
                `a path cannot index into an array (at '${s}'). Replace the whole array.`
            );
        }
        if (!Object.hasOwn(o, s) || o[s] == null || typeof o[s] !== 'object') {
            if (!create) throw new OpError(`no value at '${s}'`);
            o[s] = draft.copyOf({});
        }
        o = draft.writable(o, s);
    }
    if (isArray(o)) {
        throw new OpError('a path cannot end inside an array. Replace the whole array.');
    }
    return o;
}

function setPath(doc: PlainObject, path: string, value: unknown, draft: Draft) {
    const segs = segments(path),
        last = segs.pop();
    if (!last) throw new OpError('cannot replace the whole blueprint');
    walkTo(doc, segs, true, draft)[last] = cloneDeep(value);
}

function removePath(doc: PlainObject, path: string, draft: Draft) {
    const segs = segments(path),
        last = segs.pop(),
        parent = walkTo(doc, segs, false, draft);
    if (!Object.hasOwn(parent, last)) throw new OpError(`no value at '${path}'`);
    delete parent[last];
}

function placeChild(
    bp: Blueprint,
    parent: string,
    id: string,
    child: PlainObject,
    index: number,
    slot = 'children',
    of: string = null,
    draft: Draft
) {
    if (!ownElement(bp, parent)) throw new OpError(`parent '${parent}' does not exist`);
    const p = draft.element(bp, parent);
    if (of && !p.children?.some(it => it.id === of)) {
        throw new OpError(`'${of}' is not a child of '${parent}'`);
    }
    const ref = {...(child ?? {}), id},
        holder: PlainObject = of ? p.children.find(it => it.id === of) : p,
        refs: PlainObject[] = holder[slot] ?? [],
        listed = refs.findIndex(it => it.id === id);
    // A parent added with its children listed already holds a place for this one: take it.
    if (listed >= 0 && index == null) {
        refs[listed] = {...refs[listed], ...ref};
        return;
    }
    if (listed >= 0) refs.splice(listed, 1);
    insertRef(p, ref as ChildRef, {slot, ...(of ? {of} : {}), index});
}

/** Rename every reference to an ID, including paths that name it. */
function renameRefs(o: any, kind: string, from: string, to: string, parentKey?: string): any {
    if (isArray(o)) return o.map(v => renameRefs(v, kind, from, to));
    if (isPlainObject(o)) {
        const ret: PlainObject = {};
        for (const [k, v] of Object.entries(o)) {
            // A preset's values have the blueprint's shape, so the ID is a key there too.
            const nk =
                parentKey === `${kind}s` && k === from
                    ? to
                    : kind === 'element'
                      ? renamePath(k, 'elements', from, to)
                      : k;
            let nv = renameRefs(v, kind, from, to, k);
            if (v === from) {
                if (kind === 'element' && (k === 'id' || k === 'element')) nv = to;
                if (kind === 'variable' && (k === '$var' || k === 'variable')) nv = to;
                if (kind === 'source' && k === 'source') nv = to;
            }
            ret[nk] = nv;
        }
        return ret;
    }
    if (typeof o === 'string') {
        const renamed = renamePath(o, `${kind}s`, from, to);
        return kind === 'variable' || kind === 'source'
            ? renameTemplateRefs(renamed, kind, from, to)
            : renamed;
    }
    return o;
}

function renamePath(s: string, coll: string, from: string, to: string): string {
    const prefix = `/${coll}/${from}/`;
    return s.startsWith(prefix) ? `/${coll}/${to}/${s.slice(prefix.length)}` : s;
}
