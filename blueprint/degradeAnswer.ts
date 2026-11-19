import type {PlainObject} from '@xh/hoist/core';
import {cloneDeep, isArray, isEmpty, isPlainObject, isString} from 'lodash';
import type {Blueprint, BlueprintIssue} from './Blueprint';
import {checkConfig} from './impl/configSchema';
import {decodePointer, getOwn, toLookup} from './impl/pointer';
import {validateBlueprint, type ValidateBlueprintContext} from './validateBlueprint';

export interface DegradeAnswerContext extends ValidateBlueprintContext {
    /** False while the answer streams: its last parts may still be arriving. */
    isComplete: boolean;
    /** Most passes of validating and replacing before the whole answer degrades. Default 5. */
    maxPasses?: number;
    /** Problems found before translation, such as a parser's, by element ID. Each is an error. */
    elementErrors?: Record<string, string[]>;
    /**
     * False when the caller has already trimmed what may be cut short, as a translation that
     * drops each streaming element's last item does. Default true.
     */
    trimInlineRows?: boolean;
}

/**
 * A chat answer that renders as far as it can. Checks the answer as strictly as any blueprint,
 * then stands in for each part with errors, and checks again, until it is valid:
 *
 *  - An element with errors, or one that has not arrived, becomes a `placeholder` while it may
 *    still be arriving, naming the component it will be, and a `fallback` once the answer is
 *    complete. With `partialIds`, an element not listed is complete, and falls back at once, as
 *    does an arriving element whose config has an error that more input cannot fix. A fallback lists the errors, and holds the
 *    element as written as JSON text, which no later check reads.
 *  - A source or a variable with errors is removed, so the elements that read it are replaced.
 *  - An element that no container places is removed, as it never shows.
 *  - An error it cannot place, such as a broken structure, degrades the whole answer.
 *
 * While the answer streams, each inline source drops its last row, which may be incomplete. An
 * authored placeholder or fallback is an error like any other.
 *
 * @returns a blueprint that is valid with `allowReserved`. The input is left as it was.
 */
export function degradeAnswer(input: unknown, ctx: DegradeAnswerContext): Blueprint {
    const {isComplete, maxPasses = 5} = ctx,
        // Without partialIds, every element of a streaming answer may still be arriving.
        isArriving = (id: string) =>
            !isComplete && (id == null || !ctx.partialIds || ctx.partialIds.includes(id)),
        // An error that the partial check still finds is one that more input cannot fix.
        canStillBeValid = (el: any) => {
            const spec = getOwn(ctx.registry.widgets, el?.component);
            return !spec || isEmpty(checkConfig(el.config ?? {}, spec.config, {isPartial: true}));
        },
        standIn = (errors: string[], original: any, id: string = null, canGrow = true) =>
            !isArriving(id) || !canGrow
                ? {component: 'fallback', config: {errors, input: toJson(original)}}
                : {
                      component: 'placeholder',
                      config: isString(original?.component) ? {component: original.component} : {}
                  },
        // Once complete, nothing is still arriving, so every element is checked in full.
        checkCtx = {...ctx, allowReserved: true, partialIds: isComplete ? [] : ctx.partialIds},
        whole = (issues: BlueprintIssue[]): Blueprint => ({
            root: 'root',
            elements: {root: standIn(issues.map(describeIssue), input)}
        });

    if (!isPlainObject(input)) return whole([notAnObject()]);
    const bp = cloneDeep(input) as Blueprint;
    if (!isComplete && ctx.trimInlineRows !== false) trimInlineRows(bp);
    if (isPlainObject(bp.elements)) {
        Object.entries(bp.elements).forEach(([id, el]) => {
            const errors = [...(getOwn(ctx.elementErrors, id) ?? [])];
            if (getOwn(ctx.registry.widgets, el?.component)?.reserved) {
                errors.push(
                    `/elements/${id}/component: '${el.component}' is for the kit's own use`
                );
            }
            if (errors.length) bp.elements[id] = standIn(errors, el, id);
        });
    }

    for (let pass = 0; pass < maxPasses; pass++) {
        const errors = validateBlueprint(bp, checkCtx).filter(it => it.severity === 'error');
        if (!errors.length) return bp;
        if (!isPlainObject(bp.elements)) return whole(errors);

        const byElement: Record<string, BlueprintIssue[]> = toLookup({}),
            missing = new Set<string>(),
            unplaced = new Set<string>();
        for (const issue of errors) {
            const [kind, name, ...rest] = decodePointer(issue.path || '/');
            if (issue.code === 'structure.unknownRoot') {
                missing.add(bp.root);
            } else if (issue.code === 'structure.unknownChild') {
                missing.add(getOwn(bp.elements, name)?.children?.[Number(rest[1])]?.id);
            } else if (issue.code === 'structure.notPlaced') {
                unplaced.add(name);
            } else if (kind === 'elements' && getOwn(bp.elements, name)) {
                (byElement[name] ??= []).push(issue);
            } else if (kind === 'sources' && getOwn(bp.sources, name)) {
                delete bp.sources[name];
            } else if (kind === 'variables' && getOwn(bp.variables, name)) {
                delete bp.variables[name];
            } else {
                return whole(errors);
            }
        }
        for (const [id, issues] of Object.entries(byElement)) {
            const el = bp.elements[id];
            bp.elements[id] = standIn(issues.map(describeIssue), el, id, canStillBeValid(el));
        }
        for (const id of missing) {
            if (typeof id !== 'string' || !id) return whole(errors);
            bp.elements[id] = standIn([`element '${id}' is missing`], null);
        }
        unplaced.forEach(id => delete bp.elements[id]);
    }
    return whole(validateBlueprint(bp, checkCtx));
}

//------------------
// Implementation
//------------------
function trimInlineRows(bp: Blueprint) {
    if (!isPlainObject(bp.sources)) return;
    Object.values(bp.sources).forEach((it: PlainObject) => {
        const rows = it?.inline?.rows;
        if (isArray(rows)) it.inline.rows = rows.slice(0, -1);
    });
}

function toJson(value: unknown): string {
    try {
        return JSON.stringify(value ?? null);
    } catch {
        return String(value);
    }
}

function describeIssue(issue: BlueprintIssue): string {
    return issue.path ? `${issue.path}: ${issue.message}` : issue.message;
}

function notAnObject(): BlueprintIssue {
    return {code: 'structure.notObject', severity: 'error', path: '', message: 'not a blueprint'};
}
