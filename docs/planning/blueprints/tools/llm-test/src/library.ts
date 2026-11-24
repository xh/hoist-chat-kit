/**
 * The edit engine and validator, from the Hoist Blueprints library in chat kit. Both run under
 * plain Node: their import graph holds no Hoist runtime code.
 */
import type {BlueprintIssue} from '../../../../../../blueprint/Blueprint.ts';
import {DataCatalog} from '../../../../../../blueprint/DataCatalog.ts';
import {
    BUILT_IN_ACTIONS,
    BUILT_IN_RENDERER_INFO,
    BUILT_IN_RESOLVER_INFO,
    BUILT_IN_WIDGETS
} from '../../../../../../blueprint/impl/builtInWidgets.ts';
import {validateBlueprint} from '../../../../../../blueprint/validateBlueprint.ts';
import {Blueprint, catalogs, registry} from './load.ts';

export {applyOps} from '../../../../../../blueprint/applyOps.ts';
export {architectPrompt, UI_CONTEXT_DESCRIPTION} from '../../../../../../blueprint/architect/architectPrompt.ts';
export {
    ArchitectToolError,
    availableArchitectTools,
    type ArchitectTarget
} from '../../../../../../blueprint/architect/ArchitectTools.ts';
export {answerBlueprintSchema, answerToolDescription} from '../../../../../../genui/impl/answerTool.ts';
export {hostSourceFor} from '../../../../../../blueprint/architect/hostSource.ts';
export {READ_ANSWER_SPEC, REQUEST_DESIGN_MODE_SPEC, REQUEST_FEATURE_SPEC} from '../../../../../../genui/architect/toolSpecs.ts';
export {checkFeatureRequest} from '../../../../../../genui/architect/featureRequestCheck.ts';
export type Issue = BlueprintIssue;

export const libraryCatalogs = Object.values(catalogs).map(it => new DataCatalog(it));

/** The config keys a built-in widget marks x-advanced, which the Architect leaves unset unless asked. */
export const advancedKeysOf = (widget: string): string[] =>
    Object.entries<any>(BUILT_IN_WIDGETS.find(it => it.name === widget)?.config?.properties ?? {})
        .filter(([, prop]) => prop['x-advanced'])
        .map(([key]) => key);

/** Every catalog's datasets, as one catalog. */
const catalog = {
    getDataset: (name: string) =>
        libraryCatalogs.map(it => it.getDataset(name)).find(Boolean) ?? null
};

/** The library's built-ins, plus the app's entries from registry.json. */
const byName = (specs: any[]) => Object.fromEntries(specs.map(it => [it.name, it])),
    named = (coll: string) =>
        Object.fromEntries(Object.entries<any>(registry[coll]).map(([name, it]) => [name, {name, ...it}]));
export const libraryRegistry = {
    widgets: {...byName(BUILT_IN_WIDGETS), ...named('widgets')},
    variableTypes: named('variableTypes'),
    resolvers: {...byName(BUILT_IN_RESOLVER_INFO), ...named('resolvers')},
    actions: {...byName(BUILT_IN_ACTIONS), ...named('actions')},
    renderers: {...byName(BUILT_IN_RENDERER_INFO), ...named('renderers')}
};

export interface ValidateContext {
    /** Dataset behind each artifact a chat answer can name. */
    artifacts: Record<string, string>;
    /** True for a chat answer, which may hold artifacts and inline sources. */
    isAnswer?: boolean;
}

/** Check a blueprint with the library's validator, strictly, as for the Architect: an unfinished widget is an error. */
export function validate(bp: Blueprint, ctx: ValidateContext): Issue[] {
    return validateBlueprint(bp, {catalog, registry: libraryRegistry, strict: true, ...ctx});
}
