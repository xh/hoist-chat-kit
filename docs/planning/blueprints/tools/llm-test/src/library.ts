/**
 * The edit engine and validator, from the Hoist Blueprints library in chat kit. Both run under
 * plain Node: their import graph holds no Hoist runtime code.
 */
import type {BlueprintIssue} from '../../../../../../blueprint/Blueprint.ts';
import {DataCatalog} from '../../../../../../blueprint/DataCatalog.ts';
import {BUILT_IN_WIDGETS} from '../../../../../../blueprint/impl/builtInWidgets.ts';
import {validateBlueprint} from '../../../../../../blueprint/validateBlueprint.ts';
import {Blueprint, catalogs, registry} from './load.ts';

export {applyOps} from '../../../../../../blueprint/applyOps.ts';
export type Issue = BlueprintIssue;

const libraryCatalogs = Object.values(catalogs).map(it => new DataCatalog(it));

/** Every catalog's datasets, as one catalog. */
const catalog = {
    getDataset: (name: string) =>
        libraryCatalogs.map(it => it.getDataset(name)).find(Boolean) ?? null
};

/** The library's built-in widgets, plus the app entries the scenarios use, from registry.json. */
const named = (coll: string) =>
    Object.fromEntries(Object.entries<any>(registry[coll]).map(([name, it]) => [name, {name, ...it}]));
const libraryRegistry = {
    widgets: {
        ...named('widgets'),
        ...Object.fromEntries(BUILT_IN_WIDGETS.map(it => [it.name, it]))
    },
    variableTypes: named('variableTypes'),
    resolvers: named('resolvers'),
    actions: named('actions')
};

export interface ValidateContext {
    /** Dataset behind each artifact a chat answer can name. */
    artifacts: Record<string, string>;
    /** True for a chat answer, which may hold artifacts and inline sources. */
    isAnswer?: boolean;
}

/** Check a blueprint with the library's validator. */
export function validate(bp: Blueprint, ctx: ValidateContext): Issue[] {
    return validateBlueprint(bp, {catalog, registry: libraryRegistry, ...ctx});
}
