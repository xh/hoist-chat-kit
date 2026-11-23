import type {PlainObject} from '@xh/hoist/core';
import {isEqual, sortBy, uniq} from 'lodash';
import {applyOps} from './applyOps';
import type {Blueprint, BlueprintOp} from './Blueprint';
import {diffOps} from './diffOps';
import type {BlueprintRename} from './repository/BlueprintRepository';

/** How one part of a blueprint, such as its elements, differs between two versions. */
export interface BlueprintPartDiff {
    added: string[];
    removed: string[];
    /** Ids the renames given carry from one version to the other. */
    renamed: {from: string; to: string}[];
    /** Entries in both, with the JSON Pointer of each value that changed within the entry. */
    changed: {id: string; paths: string[]}[];
}

/** How one version of a blueprint differs from another, part by part. */
export interface BlueprintDiff {
    elements: BlueprintPartDiff;
    sources: BlueprintPartDiff;
    variables: BlueprintPartDiff;
    presets: BlueprintPartDiff;
    formats: BlueprintPartDiff;
    /** Any other top-level key that differs, such as `root`. The schema map is left out. */
    other: string[];
    /** True if nothing differs. */
    isEmpty: boolean;
}

/**
 * How blueprint `b` differs from `a`, part by part, for a person to read: elements, sources,
 * variables, presets and formats added, removed, renamed or changed, with the paths that changed.
 * Plain Node, for a server or a script too.
 *
 * @param renames - the renames between the two, in order, as the publishes after `a` and up to
 *      `b` record them. An id they carry to a name in `b` is renamed, not removed and added, and
 *      references to it compare as the same. A rename the blueprints do not bear out is ignored.
 */
export function diffBlueprints(
    a: Blueprint,
    b: Blueprint,
    renames: BlueprintRename[] = []
): BlueprintDiff {
    const {result: from, applied} = withRenames(a ?? ({} as Blueprint), renames),
        to = b ?? ({} as Blueprint),
        part = (key: Part, kind?: BlueprintRename['kind']): BlueprintPartDiff => {
            const was: PlainObject = from[key] ?? {},
                now: PlainObject = to[key] ?? {},
                ids = sortBy(uniq([...Object.keys(was), ...Object.keys(now)]));
            return {
                added: ids.filter(id => !Object.hasOwn(was, id)),
                removed: ids.filter(id => !Object.hasOwn(now, id)),
                renamed: applied.filter(it => it.kind === kind).map(({from, to}) => ({from, to})),
                changed: ids
                    .filter(id => Object.hasOwn(was, id) && Object.hasOwn(now, id))
                    .filter(id => !isEqual(was[id], now[id]))
                    .map(id => ({id, paths: sortBy(diffOps(was[id], now[id]).map(op => op.path))}))
            };
        },
        ret = {
            elements: part('elements', 'element'),
            sources: part('sources', 'source'),
            variables: part('variables', 'variable'),
            presets: part('presets'),
            formats: part('formats'),
            other: sortBy(
                uniq([...Object.keys(from), ...Object.keys(to)]).filter(
                    key => !PARTS.includes(key as Part) && key !== 'schema'
                )
            ).filter(key => !isEqual(from[key], to[key]))
        };
    return {
        ...ret,
        isEmpty:
            !ret.other.length &&
            PARTS.every(key => {
                const it = ret[key];
                return (
                    !it.added.length &&
                    !it.removed.length &&
                    !it.renamed.length &&
                    !it.changed.length
                );
            })
    };
}

//------------------
// Implementation
//------------------
const PARTS = ['elements', 'sources', 'variables', 'presets', 'formats'] as const;
type Part = (typeof PARTS)[number];

// A blueprint with the renames applied that it bears out, each rewriting the references to its id.
function withRenames(
    bp: Blueprint,
    renames: BlueprintRename[]
): {result: Blueprint; applied: BlueprintRename[]} {
    const applied: BlueprintRename[] = [];
    let result = bp;
    renames.forEach(rename => {
        const step = applyOps(result, [{op: 'renameId', ...rename} as BlueprintOp]);
        if (step.issue) return;
        applied.push(rename);
        result = step.result;
    });
    return {result, applied};
}
