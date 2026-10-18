import type {PlainObject} from '@xh/hoist/core';
import {isArray, isPlainObject, isString, last, pick, uniq} from 'lodash';
import type {ChatUiDocument, ChatUiElement} from '../ChatUiDocument';
import type {ChatUiComponentSpec} from '../ChatUiComponentSpec';
import {formatError, propPath, typeOf} from '../../impl/validateSchema';

/** Options for {@link findStructureProblems}. */
export interface StructureOptions {
    isPartial: boolean;
    maxElements: number;
    maxDepth: number;
}

/** A reference from an element to a child, with the path of the reference. */
export interface ChildRef {
    id: string;
    path: string;

    /** True for the last id of its list. */
    isLast: boolean;
}

/**
 * Find what stops a document from rendering as a tree: a missing `elements` map or root, too many
 * elements, a cycle, an element listed under two parents, or nesting past the depth cap. While
 * the document is partial, a root that has not arrived is not a problem. Child ids that name no
 * element are left to {@link findDanglingRefs}, as each renders on its own as a placeholder or a
 * fallback.
 *
 * @returns problems in the kit's `path: message` form. Empty if the document renders as a tree.
 * @internal
 */
export function findStructureProblems(doc: unknown, opts: StructureOptions): string[] {
    const {isPartial, maxElements, maxDepth} = opts;
    if (!isPlainObject(doc)) return [formatError('', `expected object, got ${typeOf(doc)}`)];

    const {root, elements} = doc as PlainObject,
        ret: string[] = [];

    if (elements == null) {
        if (!isPartial) ret.push(formatError('elements', 'required'));
    } else if (!isPlainObject(elements)) {
        ret.push(formatError('elements', `expected object, got ${typeOf(elements)}`));
    }
    if (root == null) {
        if (!isPartial) ret.push(formatError('root', 'required'));
    } else if (!isString(root)) {
        ret.push(formatError('root', `expected string, got ${typeOf(root)}`));
    } else if (!isPartial && isPlainObject(elements) && !Object.hasOwn(elements, root)) {
        ret.push(formatError('root', `unknown element '${root}'`));
    }
    if (ret.length || !isPlainObject(elements)) return ret;

    const ids = Object.keys(elements);
    if (ids.length > maxElements) {
        ret.push(
            formatError('elements', `expected at most ${maxElements} elements, got ${ids.length}`)
        );
        return ret;
    }

    // Each element belongs to at most one parent, and the root to none. A child listed twice
    // would render twice, and a chain of such diamonds grows the render exponentially. While the
    // document streams, the last id of each list of the last element may be cut short, such as
    // `n1` on its way to `n12`, so it is checked once complete.
    const parentOf: Record<string, string> = {},
        streamingId = isPartial ? last(ids) : null;
    ids.forEach(id =>
        getChildRefs(elements[id], elementPath(id)).forEach(ref => {
            if (id === streamingId && ref.isLast) return;
            if (ref.id === root) {
                ret.push(formatError(ref.path, `'${ref.id}' is the root of the document`));
            } else if (Object.hasOwn(parentOf, ref.id)) {
                ret.push(
                    formatError(ref.path, `'${ref.id}' is already a child of '${parentOf[ref.id]}'`)
                );
            } else {
                parentOf[ref.id] = id;
            }
        })
    );
    if (ret.length) return ret;

    // With one parent each, a cycle is a chain of parents that comes back to its start.
    const checked = new Set<string>();
    ids.forEach(start => {
        const chain: string[] = [];
        let id = start;
        while (id != null && !checked.has(id)) {
            if (chain.includes(id)) {
                const cycle = [...chain.slice(chain.indexOf(id)), id].reverse();
                ret.push(formatError(elementPath(id), `cycle ${cycle.join(' > ')}`));
                break;
            }
            chain.push(id);
            id = parentOf[id];
        }
        chain.forEach(it => checked.add(it));
    });
    if (ret.length || root == null) return ret;

    const tooDeep = findTooDeep(elements, root, maxDepth);
    if (tooDeep) ret.push(formatError(elementPath(tooDeep), `more than ${maxDepth} levels deep`));
    return ret;
}

/**
 * Find child ids that name no element.
 * @returns a problem for each, in the kit's `path: message` form.
 * @internal
 */
export function findDanglingRefs(doc: ChatUiDocument): string[] {
    const {elements} = doc;
    return Object.keys(elements).flatMap(id =>
        getChildRefs(elements[id], elementPath(id))
            .filter(ref => !Object.hasOwn(elements, ref.id))
            .map(ref => formatError(ref.path, `unknown element '${ref.id}'`))
    );
}

/**
 * The well-formed child references of an element: its `children`, then each slot in turn. Ids
 * that are not strings are left out, for the element's own check to report.
 * @internal
 */
export function getChildRefs(element: unknown, path: string): ChildRef[] {
    if (!isPlainObject(element)) return [];
    const {children, slots} = element as PlainObject,
        refs = (list: unknown, listPath: string): ChildRef[] =>
            isArray(list)
                ? list.flatMap((id, idx) =>
                      isString(id)
                          ? [{id, path: `${listPath}[${idx}]`, isLast: idx === list.length - 1}]
                          : []
                  )
                : [];

    return [
        ...refs(children, `${path}.children`),
        ...(isPlainObject(slots)
            ? Object.entries(slots).flatMap(([name, list]) =>
                  refs(list, propPath(`${path}.slots`, name))
              )
            : [])
    ];
}

/**
 * Path of an element in its document - `elements.chart`, or `elements["my chart"]`.
 * @internal
 */
export function elementPath(id: string): string {
    return propPath('elements', id);
}

/**
 * Make the fixes to a document that lose nothing the model meant:
 *
 *  - Drop unknown top-level keys and unknown element keys.
 *  - Accept `elements` as a list of elements, each with a unique `id`.
 *  - Take an element's `type` as its `component`, if it has none.
 *  - Move a prop the component declares, written beside `props` in place of inside it, into
 *    `props` - unless `props` already has it.
 *  - Give an element with no `props` an empty object.
 *  - Wrap a single child id in a list.
 *
 * Returns a new document, and leaves the input as it was. Returns a value that is not an object
 * unchanged, for the checks to report.
 * @internal
 */
export function repairDocument(
    doc: unknown,
    getComponent: (name: string) => ChatUiComponentSpec
): ChatUiDocument {
    if (!isPlainObject(doc)) return doc as ChatUiDocument;

    const ret = pick(doc as PlainObject, DOCUMENT_KEYS) as PlainObject;
    let {elements} = ret;

    if (isArray(elements)) {
        const ids = elements.map(it => it?.id);
        if (ids.every(isString) && uniq(ids).length === ids.length) {
            elements = Object.fromEntries(elements.map(it => [it.id, it]));
        }
    }
    if (isPlainObject(elements)) {
        ret.elements = Object.fromEntries(
            Object.entries(elements).map(([id, it]) => [id, repairElement(it, getComponent)])
        );
    }
    return ret as ChatUiDocument;
}

//------------------
// Implementation
//------------------
const DOCUMENT_KEYS = ['root', 'elements', 'catalogVersion'],
    ELEMENT_KEYS = ['component', 'props', 'children', 'slots'];

function repairElement(
    element: unknown,
    getComponent: (name: string) => ChatUiComponentSpec
): ChatUiElement {
    if (!isPlainObject(element)) return element as ChatUiElement;

    const source = element as PlainObject,
        ret = pick(source, ELEMENT_KEYS) as PlainObject;

    if (ret.component == null && isString(source.type)) ret.component = source.type;
    if (ret.props == null) ret.props = {};
    if (isString(ret.children)) ret.children = [ret.children];

    const declared = getComponent(ret.component)?.props?.properties;
    if (isPlainObject(ret.props) && isPlainObject(declared)) {
        const misplaced = Object.keys(source).filter(
            key =>
                !ELEMENT_KEYS.includes(key) &&
                Object.hasOwn(declared, key) &&
                !Object.hasOwn(ret.props, key)
        );
        if (misplaced.length) ret.props = {...ret.props, ...pick(source, misplaced)};
    }
    return ret as ChatUiElement;
}

/** The first element found past `maxDepth` levels below the root, or null. */
function findTooDeep(elements: PlainObject, root: string, maxDepth: number): string {
    let level = [root];
    for (let depth = 1; level.length; depth++) {
        if (depth > maxDepth) return level[0];
        level = level.flatMap(id =>
            getChildRefs(elements[id], '')
                .map(it => it.id)
                .filter(it => Object.hasOwn(elements, it))
        );
    }
    return null;
}
