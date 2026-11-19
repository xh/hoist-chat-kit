import {Blueprint, clone} from './load.ts';

/** One problem found in a blueprint or an edit, in the spec's form. */
export interface Issue {
    code: string;
    severity: 'error' | 'warning';
    path: string;
    message: string;
    op?: number;
}

export type Op =
    | {op: 'set'; path: string; value: unknown}
    | {op: 'remove'; path: string}
    | {op: 'addElement'; id: string; element: any; parent?: string; child?: any; index?: number}
    | {op: 'removeElement'; id: string}
    | {op: 'moveElement'; id: string; parent: string; child?: any; index?: number}
    | {op: 'renameId'; kind: 'element' | 'variable' | 'source'; from: string; to: string};

const ID = /^[A-Za-z0-9_-]+$/;

class OpError extends Error {}

function segments(path: string): string[] {
    if (typeof path !== 'string' || !path.startsWith('/')) throw new OpError(`path '${path}' must start with '/'`);
    return path.slice(1).split('/');
}

function walkTo(doc: any, segs: string[], create: boolean): any {
    let o = doc;
    for (const s of segs) {
        if (Array.isArray(o)) throw new OpError(`a path cannot index into an array (at '${s}'). Replace the whole array.`);
        if (o[s] == null || typeof o[s] !== 'object') {
            if (!create) throw new OpError(`no value at '${s}'`);
            o[s] = {};
        }
        o = o[s];
    }
    if (Array.isArray(o)) throw new OpError('a path cannot end inside an array. Replace the whole array.');
    return o;
}

function setPath(doc: any, path: string, value: unknown) {
    const segs = segments(path),
        last = segs.pop()!;
    if (!last) throw new OpError('cannot replace the whole blueprint');
    walkTo(doc, segs, true)[last] = clone(value);
}

function removePath(doc: any, path: string) {
    const segs = segments(path),
        last = segs.pop()!,
        parent = walkTo(doc, segs, false);
    if (!(last in parent)) throw new OpError(`no value at '${path}'`);
    delete parent[last];
}

function parentOf(bp: Blueprint, id: string): string | null {
    for (const [eid, el] of Object.entries<any>(bp.elements ?? {})) {
        if ((el.children ?? []).some((c: any) => c.id === id)) return eid;
    }
    return null;
}

function placeChild(bp: Blueprint, parent: string, id: string, child: any, index?: number) {
    const p = bp.elements?.[parent];
    if (!p) throw new OpError(`parent '${parent}' does not exist`);
    p.children ??= [];
    const ref = {...(child ?? {}), id};
    if (index == null || index >= p.children.length) p.children.push(ref);
    else p.children.splice(Math.max(0, index), 0, ref);
}

/** Rename every reference to an ID, including paths that name it. */
function renameRefs(o: any, kind: string, from: string, to: string): any {
    if (Array.isArray(o)) return o.map(v => renameRefs(v, kind, from, to));
    if (o && typeof o === 'object') {
        const ret: any = {};
        for (const [k, v] of Object.entries(o)) {
            let nk = k;
            if (kind === 'element' && k.startsWith(`/elements/${from}/`)) nk = k.replace(`/elements/${from}/`, `/elements/${to}/`);
            let nv = renameRefs(v, kind, from, to);
            if (kind === 'element' && (k === 'id' || k === 'element') && v === from) nv = to;
            if (kind === 'variable' && (k === '$var' || k === 'variable') && v === from) nv = to;
            if (kind === 'source' && k === 'source' && v === from) nv = to;
            ret[nk] = nv;
        }
        return ret;
    }
    if (typeof o === 'string') {
        if (kind === 'element' && o.startsWith(`/elements/${from}/`)) return o.replace(`/elements/${from}/`, `/elements/${to}/`);
        if (kind === 'variable' && o.startsWith(`/variables/${from}/`)) return o.replace(`/variables/${from}/`, `/variables/${to}/`);
        if (kind === 'source' && o.startsWith(`/sources/${from}/`)) return o.replace(`/sources/${from}/`, `/sources/${to}/`);
    }
    return o;
}

function applyOp(bp: Blueprint, op: any): Blueprint {
    switch (op?.op) {
        case 'set':
            setPath(bp, op.path, op.value);
            return bp;
        case 'remove':
            removePath(bp, op.path);
            return bp;
        case 'addElement': {
            if (!ID.test(op.id ?? '')) throw new OpError(`id '${op.id}' may use only letters, digits, _ and -`);
            bp.elements ??= {};
            if (bp.elements[op.id]) throw new OpError(`element '${op.id}' already exists`);
            bp.elements[op.id] = clone(op.element);
            if (op.parent) placeChild(bp, op.parent, op.id, op.child, op.index);
            else if (!bp.root) bp.root = op.id;
            else throw new OpError('give a parent, or the element is not placed. The blueprint already has a root.');
            return bp;
        }
        case 'removeElement': {
            const el = bp.elements?.[op.id];
            if (!el) throw new OpError(`element '${op.id}' does not exist`);
            if (el.children?.length) throw new OpError(`element '${op.id}' still has children. Remove or move them first.`);
            const p = parentOf(bp, op.id);
            if (p) bp.elements[p].children = bp.elements[p].children.filter((c: any) => c.id !== op.id);
            if (bp.root === op.id) delete bp.root;
            delete bp.elements[op.id];
            return bp;
        }
        case 'moveElement': {
            if (!bp.elements?.[op.id]) throw new OpError(`element '${op.id}' does not exist`);
            const p = parentOf(bp, op.id);
            let old: any = {};
            if (p) {
                old = bp.elements[p].children.find((c: any) => c.id === op.id);
                bp.elements[p].children = bp.elements[p].children.filter((c: any) => c.id !== op.id);
            }
            const {id: _id, ...placement} = old;
            placeChild(bp, op.parent, op.id, op.child ?? (p === op.parent ? placement : {}), op.index);
            return bp;
        }
        case 'renameId': {
            const coll = {element: 'elements', variable: 'variables', source: 'sources'}[op.kind as string];
            if (!coll) throw new OpError(`kind must be element, variable or source`);
            if (!ID.test(op.to ?? '')) throw new OpError(`id '${op.to}' may use only letters, digits, _ and -`);
            if (!bp[coll]?.[op.from]) throw new OpError(`${op.kind} '${op.from}' does not exist`);
            if (bp[coll][op.to]) throw new OpError(`${op.kind} '${op.to}' already exists`);
            const next = renameRefs(bp, op.kind, op.from, op.to);
            next[coll] = Object.fromEntries(Object.entries(next[coll]).map(([k, v]) => [k === op.from ? op.to : k, v]));
            if (op.kind === 'element' && next.root === op.from) next.root = op.to;
            return next;
        }
        default:
            throw new OpError(`unknown op '${op?.op}'. Use set, remove, addElement, removeElement, moveElement or renameId.`);
    }
}

/** Apply ops to a copy. Returns the result, or the issue that stopped it. */
export function applyOps(bp: Blueprint, ops: unknown): {result?: Blueprint; issue?: Issue} {
    if (!Array.isArray(ops) || !ops.length) {
        return {issue: {code: 'edit.noOps', severity: 'error', path: '', message: 'ops must be a non-empty list'}};
    }
    let next = clone(bp);
    for (let i = 0; i < ops.length; i++) {
        try {
            next = applyOp(next, ops[i]);
        } catch (e) {
            if (!(e instanceof OpError)) throw e;
            return {issue: {code: 'edit.badOp', severity: 'error', path: (ops[i] as any)?.path ?? '', message: e.message, op: i}};
        }
    }
    return {result: next};
}
