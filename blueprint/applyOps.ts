import type {PlainObject} from '@xh/hoist/core';
import {cloneDeep, isArray, isEmpty, isPlainObject} from 'lodash';
import type {Blueprint, BlueprintIssue, BlueprintOp} from './Blueprint';

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
            if (!(e instanceof OpError)) throw e;
            return {
                issue: {
                    code: 'edit.badOp',
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
class OpError extends Error {}

function applyOp(bp: Blueprint, op: any): Blueprint {
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
            if (bp.elements[op.id]) throw new OpError(`element '${op.id}' already exists`);
            bp.elements[op.id] = cloneDeep(op.element);
            if (op.parent) {
                placeChild(bp, op.parent, op.id, op.child, op.index);
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
            const el = bp.elements?.[op.id];
            if (!el) throw new OpError(`element '${op.id}' does not exist`);
            if (el.children?.length) {
                throw new OpError(
                    `element '${op.id}' still has children. Remove or move them first.`
                );
            }
            const p = parentOf(bp, op.id);
            if (p) bp.elements[p].children = bp.elements[p].children.filter(c => c.id !== op.id);
            if (bp.root === op.id) delete bp.root;
            delete bp.elements[op.id];
            return bp;
        }
        case 'moveElement': {
            if (!bp.elements?.[op.id]) throw new OpError(`element '${op.id}' does not exist`);
            const p = parentOf(bp, op.id);
            let old: PlainObject = {};
            if (p) {
                old = bp.elements[p].children.find(c => c.id === op.id);
                bp.elements[p].children = bp.elements[p].children.filter(c => c.id !== op.id);
            }
            const {id: _id, ...placement} = old;
            placeChild(
                bp,
                op.parent,
                op.id,
                op.child ?? (p === op.parent ? placement : {}),
                op.index
            );
            return bp;
        }
        case 'renameId': {
            const coll = {element: 'elements', variable: 'variables', source: 'sources'}[op.kind];
            if (!coll) throw new OpError(`kind must be element, variable or source`);
            checkId(op.to);
            if (!bp[coll]?.[op.from]) throw new OpError(`${op.kind} '${op.from}' does not exist`);
            if (bp[coll][op.to]) throw new OpError(`${op.kind} '${op.to}' already exists`);
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

function checkId(id: string) {
    if (!ID_RE.test(id ?? ''))
        throw new OpError(`id '${id}' may use only letters, digits, _ and -`);
}

function segments(path: string): string[] {
    if (typeof path !== 'string' || !path.startsWith('/')) {
        throw new OpError(`path '${path}' must start with '/'`);
    }
    return path.slice(1).split('/');
}

function walkTo(doc: PlainObject, segs: string[], create: boolean): PlainObject {
    let o = doc;
    for (const s of segs) {
        if (isArray(o)) {
            throw new OpError(
                `a path cannot index into an array (at '${s}'). Replace the whole array.`
            );
        }
        if (o[s] == null || typeof o[s] !== 'object') {
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
    if (!(last in parent)) throw new OpError(`no value at '${path}'`);
    delete parent[last];
}

function parentOf(bp: Blueprint, id: string): string {
    const entry = Object.entries(bp.elements ?? {}).find(([, el]) =>
        (el.children ?? []).some(c => c.id === id)
    );
    return entry?.[0] ?? null;
}

function placeChild(bp: Blueprint, parent: string, id: string, child: PlainObject, index: number) {
    const p = bp.elements?.[parent];
    if (!p) throw new OpError(`parent '${parent}' does not exist`);
    p.children ??= [];
    const ref = {...(child ?? {}), id};
    if (index == null || index >= p.children.length) {
        p.children.push(ref);
    } else {
        p.children.splice(Math.max(0, index), 0, ref);
    }
}

/** Rename every reference to an ID, including paths that name it. */
function renameRefs(o: any, kind: string, from: string, to: string): any {
    if (isArray(o)) return o.map(v => renameRefs(v, kind, from, to));
    if (isPlainObject(o)) {
        const ret: PlainObject = {};
        for (const [k, v] of Object.entries(o)) {
            const nk = kind === 'element' ? renamePath(k, 'elements', from, to) : k;
            let nv = renameRefs(v, kind, from, to);
            if (v === from) {
                if (kind === 'element' && (k === 'id' || k === 'element')) nv = to;
                if (kind === 'variable' && (k === '$var' || k === 'variable')) nv = to;
                if (kind === 'source' && k === 'source') nv = to;
            }
            ret[nk] = nv;
        }
        return ret;
    }
    if (typeof o === 'string') return renamePath(o, `${kind}s`, from, to);
    return o;
}

function renamePath(s: string, coll: string, from: string, to: string): string {
    const prefix = `/${coll}/${from}/`;
    return s.startsWith(prefix) ? `/${coll}/${to}/${s.slice(prefix.length)}` : s;
}
