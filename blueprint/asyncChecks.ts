import type {PlainObject} from '@xh/hoist/core';
import {isEqual, isPlainObject} from 'lodash';
import type {Blueprint, BlueprintIssue} from './Blueprint';
import type {BlueprintRegistry} from './BlueprintRegistry';

/**
 * The async checks of what an edit changed: each app widget's `checkAsync` for an element whose
 * component or config changed, and each variable type's `checkAsync` for the literal values of a
 * variable whose declaration changed. They run together, after the synchronous validator passes.
 * A check that throws gives a `check.failed` error.
 */
export async function runAsyncChecksAsync(
    before: Blueprint,
    after: Blueprint,
    registry: Pick<BlueprintRegistry, 'widgets' | 'variableTypes'>
): Promise<BlueprintIssue[]> {
    const checks: Promise<BlueprintIssue[]>[] = [];

    Object.entries(after.elements ?? {}).forEach(([id, el]) => {
        const check = registry.widgets[el?.component]?.checkAsync,
            prev = before?.elements?.[id];
        if (!check || (prev?.component === el.component && isEqual(prev.config, el.config))) return;
        const path = `/elements/${id}`;
        checks.push(
            guard(path, async () =>
                (await check(el.config ?? {}, {blueprint: after, id})).map(it => ({
                    ...it,
                    path: `${path}/config${it.path}`
                }))
            )
        );
    });

    Object.entries(after.variables ?? {}).forEach(([name, decl]) => {
        const check = registry.variableTypes[decl?.type?.replace(/\[\]$/, '')]?.checkAsync;
        if (!check || isEqual(before?.variables?.[name], decl)) return;
        const path = `/variables/${name}`,
            dflt = decl.default as PlainObject,
            options = decl.options as PlainObject,
            literals: [string, unknown[]][] = [
                ['default/value', isPlainObject(dflt) && 'value' in dflt ? [dflt.value] : []],
                ['options/values', Array.isArray(options?.values) ? options.values : []]
            ];
        literals.forEach(([at, values]) => {
            const items = values.flat().filter(it => it != null);
            if (!items.length) return;
            checks.push(
                guard(path, async () => {
                    const ctx = {blueprint: after, variable: name},
                        problems = await Promise.all(items.map(it => check(it, ctx)));
                    return problems.filter(Boolean).map(message => ({
                        code: 'variable.badValue',
                        severity: 'error' as const,
                        path: `${path}/${at}`,
                        message
                    }));
                })
            );
        });
    });

    return (await Promise.all(checks)).flat();
}

//------------------
// Implementation
//------------------
async function guard(path: string, fn: () => Promise<BlueprintIssue[]>): Promise<BlueprintIssue[]> {
    try {
        return (await fn()) ?? [];
    } catch (e) {
        return [
            {
                code: 'check.failed',
                severity: 'error',
                path,
                message: `its check could not run: ${(e as Error)?.message ?? e}`
            }
        ];
    }
}
