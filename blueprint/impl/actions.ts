import {type PlainObject, XH} from '@xh/hoist/core';
import {castArray, isArray, isPlainObject, isString, mapValues, omit} from 'lodash';
import {findSchemaErrors} from '../../impl/SchemaUtils';
import {isAllowedUrl} from '../../impl/UrlUtils';
import type {BlueprintModel} from '../BlueprintModel';
import {linkTextFor} from '../BlueprintLink';
import {BLUEPRINT_LINK_RESERVED} from './linkParams';
import {checkVariableValue} from './variableValues';

/** The most steps a list of actions can hold. */
export const MAX_ACTION_STEPS = 8;

/** What a run of actions can read beside variables: the row a row action was run on. */
export interface ActionRunContext {
    row?: PlainObject;
    /** The control that ran the action, for a popover drill-in to anchor to. */
    anchor?: string;
}

/**
 * Run an action, or a list of up to 8 as steps. Every step is checked before the first runs. Each
 * starts once the one before it finishes, after the user confirms it if it asks to. A step that
 * fails stops the rest, and the user sees why.
 *
 * @returns true if every step ran.
 */
export async function runActionsAsync(
    model: BlueprintModel,
    actions: PlainObject | PlainObject[],
    ctx: ActionRunContext = {}
): Promise<boolean> {
    const steps = castArray(actions).map(it => resolveAction(model, it, ctx)),
        problem = checkSteps(model, steps);
    if (problem) {
        XH.dangerToast(problem);
        return false;
    }

    for (const step of steps) {
        const spec = model.registry.actions[step.type],
            description = describeResolved(model, step);
        if ((spec.sideEffects || step.confirm) && !(await XH.confirm({message: description}))) {
            return false;
        }
        try {
            await runAction(model, step, ctx);
        } catch (e) {
            XH.dangerToast(`${description} failed: ${(e as Error)?.message ?? e}`);
            return false;
        }
    }
    return true;
}

/** Why an action, or any step of a list, cannot run now, or null if it can. */
export function actionBlockedReason(
    model: BlueprintModel,
    actions: PlainObject | PlainObject[],
    ctx: ActionRunContext = {}
): string {
    return checkSteps(
        model,
        castArray(actions).map(it => resolveAction(model, it, ctx))
    );
}

/** An action's description, with its values resolved as it would run now. */
export function describeAction(
    model: BlueprintModel,
    action: PlainObject,
    ctx: ActionRunContext = {}
): string {
    return describeResolved(model, resolveAction(model, action, ctx));
}

//------------------
// Implementation
//------------------
// What resolving a step left behind: the row fields it read that the row lacks, and the declared
// type of each `openBlueprint` value that came from a variable.
const RESOLVED = new WeakMap<
    PlainObject,
    {missingRow: string[]; varTypes: Record<string, string>}
>();

function resolveAction(
    model: BlueprintModel,
    action: PlainObject,
    {row}: ActionRunContext
): PlainObject {
    const missingRow: string[] = [],
        fromRow = (v: unknown): unknown => {
            if (isArray(v)) return v.map(fromRow);
            if (!isPlainObject(v)) return v;
            const o = v as PlainObject;
            if (!isString(o.$row)) return mapValues(o, fromRow);
            const value = row?.[o.$row] ?? null;
            if (value == null) missingRow.push(o.$row);
            return value;
        },
        varTypes = mapValues(
            isPlainObject(action?.variables) ? action.variables : {},
            (v: PlainObject) => (isString(v?.$var) ? model.getVariable(v.$var)?.decl.type : null)
        ),
        ret = model.resolve(fromRow(action));
    if (isPlainObject(ret)) RESOLVED.set(ret, {missingRow, varTypes});
    return ret;
}

function describeResolved(model: BlueprintModel, step: PlainObject): string {
    const spec = model.registry.actions[step.type];
    return spec?.describe?.(paramsOf(step)) ?? spec?.name ?? String(step.type);
}

function paramsOf(step: PlainObject): PlainObject {
    return omit(step, 'type', 'confirm');
}

function checkSteps(model: BlueprintModel, steps: PlainObject[]): string {
    return steps.length > MAX_ACTION_STEPS
        ? `An action list holds at most ${MAX_ACTION_STEPS} steps.`
        : (steps.map(it => checkAction(model, it)).find(Boolean) ?? null);
}

/** Why a step cannot run, or null if it can. */
function checkAction(model: BlueprintModel, step: PlainObject): string {
    const spec = model.registry.actions[step?.type];
    if (!spec) return `Unknown action '${step?.type}'.`;
    const [problem] = findSchemaErrors(paramsOf(step), spec.params);
    if (problem) {
        const at = problem.path.length ? ` at ${problem.path.join('.')}` : '';
        return `${spec.name} cannot run${at}: ${problem.message}.`;
    }
    const refused = spec.check?.(paramsOf(step), {blueprintModel: model});
    if (refused) return refused;
    switch (step.type) {
        case 'setVariable':
        case 'resetVariable': {
            const v = model.getVariable(step.variable);
            if (!v) return `Unknown variable '${step.variable}'.`;
            if (!v.isSettable) return `An action cannot set '${step.variable}'.`;
            return step.type === 'setVariable'
                ? checkVariableValue(v.name, v.decl, step.value, model.registry)
                : null;
        }
        case 'navigate':
            return XH.hasRoute(step.route) ? null : `The app has no route '${step.route}'.`;
        case 'openUrl':
            return isAllowedUrl(step.url, model.urlAllowList)
                ? null
                : `'${step.url}' is not on the app's list of URLs that may open.`;
        case 'refresh': {
            const unknown = castArray(step.sources ?? []).find(it => !model.getSource(it));
            return unknown ? `Unknown source '${unknown}'.` : null;
        }
        case 'openBlueprint': {
            if (model.isDrillIn) return 'A drill-in cannot open another blueprint.';
            if (!model.drillInRepository) return 'This blueprint opens no other blueprints here.';
            // A group row's value for a field below it is a total, often none: never pass it as null.
            const [missing] = RESOLVED.get(step)?.missingRow ?? [];
            return missing ? `Pick a row with one ${missing}.` : null;
        }
        default:
            return spec.run ? null : `The app cannot run '${step.type}'.`;
    }
}

async function runAction(model: BlueprintModel, step: PlainObject, ctx: ActionRunContext) {
    switch (step.type) {
        case 'setVariable':
            model.setVariable(step.variable, step.value);
            return;
        case 'resetVariable':
            model.resetVariable(step.variable);
            return;
        case 'refresh': {
            const names: string[] = step.sources?.length
                ? castArray(step.sources)
                : Object.keys(model.sources);
            await Promise.all(names.map(it => model.getSource(it).reloadAsync()));
            return;
        }
        case 'navigate':
            XH.navigate(step.route, step.params ?? {});
            return;
        case 'openUrl':
            window.open(step.url, '_blank', 'noopener');
            return;
        case 'openBlueprint': {
            const params: Record<string, string | string[]> = {id: step.blueprint},
                dropped: string[] = [],
                varTypes = RESOLVED.get(step)?.varTypes ?? {};
            // As a link carries them, so the target's link parser takes them on its own terms.
            Object.entries<unknown>(step.variables ?? {}).forEach(([name, value]) => {
                if (BLUEPRINT_LINK_RESERVED.includes(name) || value == null) return;
                const text = linkTextFor(value, varTypes[name], model.registry);
                if (text == null) dropped.push(name);
                else params[name] = text;
            });
            model.openDrillIn({
                id: step.blueprint,
                as: step.as ?? 'dialog',
                title: step.title ?? null,
                params,
                ...(dropped.length ? {dropped} : {}),
                ...(step.as === 'popover' && ctx.anchor ? {anchor: ctx.anchor} : {})
            });
            return;
        }
        default:
            await model.registry.actions[step.type].run(paramsOf(step), {
                blueprintModel: model,
                row: ctx.row
            });
    }
}
