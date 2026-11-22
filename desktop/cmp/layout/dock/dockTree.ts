import {cloneDeep, isFinite, sumBy} from 'lodash';

/**
 * A layout tree of splits, stacks and views. A `row` or `column` splits its content, sized by each
 * child's `width` or `height`, in percent. A `stack` shows its views as tabs. A `view` names its
 * content by `id`.
 */
export interface DockItem {
    type: 'row' | 'column' | 'stack' | 'view';
    id?: string;
    width?: number;
    height?: number;
    content?: DockItem[];
}

/** Where in a stack a view lands: as a tab, or in a new stack split off at an edge. */
export type DockZone = 'center' | 'left' | 'right' | 'top' | 'bottom';

/** A stack, named by a view in it, and where in it a view lands, or an edge of the whole layout. */
export type DockTarget =
    | {view: string; zone: DockZone}
    | {view: string; zone: 'tab'; index: number}
    | {zone: 'root-left' | 'root-right' | 'root-top' | 'root-bottom'};

/**
 * The layout with a view moved to a target, or null if the move has nowhere to go: an unknown view
 * or target, or a stack's only view dropped on its own stack. A stack left empty goes, a split left
 * with one child gives way to it, and each split's sizes sum to 100.
 */
export function moveView(layout: DockItem[], viewId: string, target: DockTarget): DockItem[] {
    const root = {type: ROOT, content: cloneDeep(layout ?? [])} as unknown as DockItem,
        from = findStackOf(root, viewId),
        to = 'view' in target ? findStackOf(root, target.view) : null;
    if (!from || ('view' in target && !to)) return null;
    if (
        to === from &&
        target.zone !== 'tab' &&
        (target.zone === 'center' || from.content.length === 1)
    ) {
        return null;
    }

    const [moved] = from.content.splice(indexOfView(from, viewId), 1);
    if ('view' in target) {
        if (target.zone === 'tab') {
            to.content.splice(Math.max(0, Math.min(target.index, to.content.length)), 0, moved);
        } else if (target.zone === 'center') {
            to.content.push(moved);
        } else {
            splitAt(root, to, target.zone, moved);
        }
    } else {
        splitRoot(root, target.zone, moved);
    }
    return normalize(root).content;
}

/** Each stack's views, in reading order. */
export function stacksOf(layout: DockItem[]): string[][] {
    const ret: string[][] = [],
        visit = (it: DockItem) => {
            if (it.type === 'stack') ret.push((it.content ?? []).map(v => v.id));
            else it.content?.forEach(visit);
        };
    (layout ?? []).forEach(visit);
    return ret;
}

//------------------
// Implementation
//------------------
const EDGE_DIR = {left: 'row', right: 'row', top: 'column', bottom: 'column'} as const;

// The whole layout's holder, which has no direction and sizes nothing.
const ROOT = 'root';

function sizeKey(type: DockItem['type']): 'width' | 'height' {
    return type === 'column' ? 'height' : 'width';
}

function findStackOf(item: DockItem, viewId: string): DockItem {
    if (item.type === 'stack') return indexOfView(item, viewId) >= 0 ? item : null;
    for (const it of item.content ?? []) {
        const found = findStackOf(it, viewId);
        if (found) return found;
    }
    return null;
}

function indexOfView(stack: DockItem, viewId: string): number {
    return (stack.content ?? []).findIndex(it => it.id === viewId);
}

function parentOf(item: DockItem, child: DockItem): DockItem {
    for (const it of item.content ?? []) {
        if (it === child) return item;
        const found = parentOf(it, child);
        if (found) return found;
    }
    return null;
}

// Split a stack at an edge: beside it in its own split, halving its share, or in a new split.
function splitAt(root: DockItem, stack: DockItem, zone: keyof typeof EDGE_DIR, view: DockItem) {
    const dir = EDGE_DIR[zone],
        key = sizeKey(dir),
        parent = parentOf(root, stack),
        added: DockItem = {type: 'stack', content: [view]},
        before = zone === 'left' || zone === 'top',
        idx = parent.content.indexOf(stack);
    if (parent !== root && parent.type === dir) {
        const share = stack[key] ?? 100 / parent.content.length;
        stack[key] = share / 2;
        added[key] = share / 2;
        parent.content.splice(before ? idx : idx + 1, 0, added);
        return;
    }
    const split: DockItem = {type: dir, ...sizesOf(stack), content: []};
    delete stack.width;
    delete stack.height;
    stack[key] = 50;
    added[key] = 50;
    split.content = before ? [added, stack] : [stack, added];
    parent.content.splice(idx, 1, split);
}

// Split the whole layout at an edge, giving the new side a third.
function splitRoot(
    root: DockItem,
    zone: 'root-left' | 'root-right' | 'root-top' | 'root-bottom',
    view: DockItem
) {
    const edge = zone.slice(5) as keyof typeof EDGE_DIR,
        dir = EDGE_DIR[edge],
        key = sizeKey(dir),
        added: DockItem = {type: 'stack', [key]: 100 / 3, content: [view]},
        before = edge === 'left' || edge === 'top',
        [only] = root.content;
    if (root.content.length === 1 && only.type === dir) {
        only.content.forEach(it => (it[key] = ((it[key] ?? 100 / only.content.length) * 2) / 3));
        only.content.splice(before ? 0 : only.content.length, 0, added);
        return;
    }
    const rest: DockItem =
            root.content.length === 1
                ? only
                : {type: 'stack', content: root.content.flatMap(viewsOf)},
        restSized = {...rest, [key]: 200 / 3};
    root.content = [{type: dir, content: before ? [added, restSized] : [restSized, added]}];
}

function viewsOf(item: DockItem): DockItem[] {
    return item.type === 'view' ? [item] : (item.content ?? []).flatMap(viewsOf);
}

function sizesOf(item: DockItem): Pick<DockItem, 'width' | 'height'> {
    return {
        ...(item.width != null ? {width: item.width} : {}),
        ...(item.height != null ? {height: item.height} : {})
    };
}

// Drop empty stacks and splits, collapse single-child splits, flatten nested splits of one
// direction, and size each split's children to sum to 100.
function normalize(item: DockItem): DockItem {
    if (item.type === 'view') return item;
    if (item.type === 'stack') return item.content?.length ? item : null;

    const isRoot = (item.type as string) === ROOT,
        key = sizeKey(item.type);
    let content: DockItem[] = [];
    for (const raw of item.content ?? []) {
        let child = normalize(raw);
        if (!child) continue;
        if (child.type === 'row' || child.type === 'column') {
            if (child.content.length === 1) {
                const [only] = child.content;
                delete only.width;
                delete only.height;
                child = {...only, ...sizesOf(child)};
            }
        }
        if (!isRoot && child.type === item.type) {
            const share = child[key] ?? 100;
            content.push(
                ...child.content.map(it => ({
                    ...it,
                    [key]: ((it[key] ?? 100 / child.content.length) * share) / 100
                }))
            );
        } else {
            content.push(child);
        }
    }
    if (!content.length) return null;
    return {...item, content: isRoot ? content : resize(content, key)};
}

// Scale children's sizes to sum to 100, at two decimals, the last taking any rounding left over.
function resize(content: DockItem[], key: 'width' | 'height'): DockItem[] {
    const other = key === 'width' ? 'height' : 'width',
        known = content.filter(it => isFinite(it[key])),
        missing = content.length - known.length,
        knownSum = sumBy(known, it => it[key]),
        fill = missing ? Math.max(0, 100 - knownSum) / missing || 100 / content.length : 0,
        raw = content.map(it => (isFinite(it[key]) ? it[key] : fill)),
        total = sumBy(raw) || 1,
        sized = raw.map(it => Math.round((it * 10000) / total) / 100),
        drift = Math.round((100 - sumBy(sized)) * 100) / 100;
    sized[sized.length - 1] = Math.round((sized[sized.length - 1] + drift) * 100) / 100;
    return content.map((it, idx) => {
        const {[other]: _drop, ...rest} = it;
        return {...rest, [key]: sized[idx]};
    });
}
