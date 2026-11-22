import type {PlainObject} from '@xh/hoist/core';
import {cloneDeep, isArray, isEmpty, isPlainObject, isString} from 'lodash';
import type {Blueprint, BlueprintIssue, BlueprintOp, ChildRef} from './Blueprint';
import {dropDockView} from './impl/dockLayout';
import {childIds, insertRef, locate, parentOf, removeRef} from './impl/elements';
import {renameTemplateRefs} from './impl/template';
import {getOwn, isForbiddenKey, parsePointer, PointerError} from './impl/pointer';

/** Characters an element, variable or source ID may use, so a path never needs escaping. */
export const ID_RE = /^[A-Za-z0-9_-]+$/;

/**
 * Apply an edit's operations to a copy of a blueprint, in order. Structural checks only: the
 * caller validates the result as a whole.
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
    let next = cloneDeep(bp);
    for (let i = 0; i < ops.length; i++) {
        try {
            next = applyOp(next, ops[i]);
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
class OpError extends Error {
    readonly code: string;

    constructor(message: string, code = 'edit.badOp') {
        super(message);
        this.code = code;
    }
}

function applyOp(bp: Blueprint, op: any): Blueprint {
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
            setPath(bp, op.path, op.value);
            return bp;
        case 'remove':
            removePath(bp, op.path);
            return bp;
        case 'addElement': {
            checkId(op.id);
            bp.elements ??= {};
            if (Object.hasOwn(bp.elements, op.id)) {
                throw new OpError(`element '${op.id}' already exists`);
            }
            bp.elements[op.id] = cloneDeep(op.element);
            if (op.parent) {
                placeChild(bp, op.parent, op.id, op.child, op.index, op.slot, op.of);
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
                removeRef(bp.elements[p], op.id);
                dropDockView(bp.elements[p], op.id);
            }
            if (bp.root === op.id) delete bp.root;
            delete bp.elements[op.id];
            return bp;
        }
        case 'moveElement': {
            if (!ownElement(bp, op.id)) throw new OpError(`element '${op.id}' does not exist`);
            const from = locate(bp.elements, op.id),
                old: PlainObject = from ? removeRef(bp.elements[from.parent], op.id) : {},
                {id: _id, ...placement} = old,
                slot = op.slot ?? 'children',
                sameSlot = from?.parent === op.parent && from.slot === slot && from.of === op.of;
            // A view leaving its dash container leaves its layout too.
            if (from && from.parent !== op.parent) dropDockView(bp.elements[from.parent], op.id);
            placeChild(
                bp,
                op.parent,
                op.id,
                op.child ?? (sameSlot ? placement : {}),
                op.index,
                slot,
                op.of
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
            const next = renameRefs(bp, op.kind, op.from, op.to);
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

function walkTo(doc: PlainObject, segs: string[], create: boolean): PlainObject {
    let o = doc;
    for (const s of segs) {
        if (isArray(o)) {
            throw new OpError(
                `a path cannot index into an array (at '${s}'). Replace the whole array.`
            );
        }
        if (!Object.hasOwn(o, s) || o[s] == null || typeof o[s] !== 'object') {
            if (!create) throw new OpError(`no value at '${s}'`);
            o[s] = {};
        }
        o = o[s];
    }
    if (isArray(o)) {
        throw new OpError('a path cannot end inside an array. Replace the whole array.');
    }
    return o;
}

function setPath(doc: PlainObject, path: string, value: unknown) {
    const segs = segments(path),
        last = segs.pop();
    if (!last) throw new OpError('cannot replace the whole blueprint');
    walkTo(doc, segs, true)[last] = cloneDeep(value);
}

function removePath(doc: PlainObject, path: string) {
    const segs = segments(path),
        last = segs.pop(),
        parent = walkTo(doc, segs, false);
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
    of: string = null
) {
    const p = ownElement(bp, parent);
    if (!p) throw new OpError(`parent '${parent}' does not exist`);
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
